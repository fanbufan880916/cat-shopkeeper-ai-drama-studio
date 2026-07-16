import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { registerRoutes } from "./routes.js";
import { db, store } from "./db.js";
import { encryptSecret } from "./crypto.js";
import { dbPath, rootDir } from "./paths.js";

vi.mock("./preview.js", () => ({ buildPreview: vi.fn((projectId: string) => `C:\\preview\\${projectId}-${Date.now()}.mp4`) }));
vi.mock("./workbench-update.js", () => ({
  inspectWorkbenchUpdate: vi.fn(async ({ fetch = false }: { fetch?: boolean } = {}) => ({
    version: "0.2.0", state: fetch ? "available" : "current", branch: "main", upstream: "origin/main",
    repositoryUrl: "https://github.com/example/workbench", localCommit: "111111111111", remoteCommit: "222222222222",
    ahead: 0, behind: fetch ? 1 : 0, dirty: false, updateAvailable: fetch, canUpdate: fetch,
    message: fetch ? "发现 1 个 GitHub 更新，可以安全拉取。" : "当前已经是 GitHub 最新版本。", checkedAt: new Date().toISOString()
  })),
  applyWorkbenchUpdate: vi.fn(async () => ({
    version: "0.2.0", state: "current", branch: "main", upstream: "origin/main",
    repositoryUrl: "https://github.com/example/workbench", localCommit: "222222222222", remoteCommit: "222222222222",
    ahead: 0, behind: 0, dirty: false, updateAvailable: false, canUpdate: false,
    message: "更新内容已经拉取并完成构建。", checkedAt: new Date().toISOString(),
    buildCompleted: true, restartRequired: true
  }))
}));

const app = Fastify({ logger: false });
const testProjectIds: string[] = [];
const validCharacterPrompt = "角色设定图，角色设计参考拼版，3:2 横向构图。左侧约40%为同一角色的脸部特写；右侧约60%为正面全身、侧面全身、背面全身三视图。浅灰中性背景，柔和均匀棚光，棉布材质和服装配色清楚。左右同一角色，脸部特写与三视图面部完全一致，不要改变脸型、五官比例和发型。";

beforeAll(async () => {
  expect(dbPath.startsWith(rootDir)).toBe(false);
  await registerRoutes(app);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  const remove = db.prepare("DELETE FROM projects WHERE id=?");
  for (const projectId of testProjectIds) remove.run(projectId);
});

describe("workbench update routes", () => {
  it("allows a read-only local status check", async () => {
    const response = await app.inject({ method: "GET", url: "/api/system/update-status" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ version: "0.2.0", state: "current" });
  });

  it("requires the local confirmation header before network checks or updates", async () => {
    const check = await app.inject({ method: "POST", url: "/api/system/check-update" });
    const apply = await app.inject({ method: "POST", url: "/api/system/apply-update" });
    expect(check.statusCode).toBe(403);
    expect(apply.statusCode).toBe(403);
  });

  it("checks GitHub and applies an explicitly confirmed update", async () => {
    const check = await app.inject({
      method: "POST", url: "/api/system/check-update",
      headers: { "x-workbench-update-confirm": "check-github" }
    });
    expect(check.json()).toMatchObject({ state: "available", canUpdate: true });
    const apply = await app.inject({
      method: "POST", url: "/api/system/apply-update",
      headers: { "x-workbench-update-confirm": "pull-latest" }
    });
    expect(apply.json()).toMatchObject({ buildCompleted: true, restartRequired: true });
  });
});

describe("project creative profile fields", () => {
  it("stores the three new goal fields through project creation and profile updates", async () => {
    const response = await app.inject({ method: "POST", url: "/api/projects", payload: {
      name: `profile-fields-${Date.now()}`, description: "一条完整创意简报", contentMode: "ad",
      targetPlatform: "xiaohongshu", targetDuration: 30, targetAudience: "本地年轻家庭",
      creativePurpose: "引导购买团购券", targetEmotion: "先好奇，最后信任"
    } });
    expect(response.statusCode).toBe(201);
    const project = response.json();
    testProjectIds.push(project.id);
    expect(project).toMatchObject({ targetAudience: "本地年轻家庭", creativePurpose: "引导购买团购券", targetEmotion: "先好奇，最后信任" });

    const updated = await app.inject({ method: "PUT", url: `/api/projects/${project.id}/creative-profile`, payload: {
      targetAudience: "六盘水本地用户", creativePurpose: "引导到店", targetEmotion: "安心"
    } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ targetAudience: "六盘水本地用户", creativePurpose: "引导到店", targetEmotion: "安心" });
  });

  it("continues accepting the old request body", async () => {
    const response = await app.inject({ method: "POST", url: "/api/projects", payload: { name: `legacy-project-${Date.now()}` } });
    expect(response.statusCode).toBe(201);
    const project = response.json();
    testProjectIds.push(project.id);
    expect(project).toMatchObject({ targetAudience: "", creativePurpose: "", targetEmotion: "" });
  });
});

describe("user script review", () => {
  it("requires feedback when rejecting a script", async () => {
    const project = store.createProject({ name: `review-reject-${Date.now()}` });
    testProjectIds.push(project.id);
    const script = store.addArtifact(project.id, { type: "script", title: "Test", content: "Test script" });
    store.setStage(project.id, "script_user_review");
    const response = await app.inject({ method: "POST", url: `/api/projects/${project.id}/reviews`, payload: { gate: "script_user", artifactId: script.id, decision: "rejected", scores: {}, feedback: "" } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("必须填写具体审核意见");
  });

  it("stores rejection feedback and moves back to internal review", async () => {
    const project = store.createProject({ name: `review-feedback-${Date.now()}` });
    testProjectIds.push(project.id);
    const script = store.addArtifact(project.id, { type: "script", title: "Test", content: "Test script" });
    store.setStage(project.id, "script_user_review");
    const response = await app.inject({ method: "POST", url: `/api/projects/${project.id}/reviews`, payload: { gate: "script_user", artifactId: script.id, decision: "rejected", scores: {}, feedback: "加强结尾反转", category: "用户剧本审核意见" } });
    expect(response.statusCode).toBe(201);
    const dashboard = store.dashboard(project.id);
    expect(dashboard.project.stage).toBe("script_internal_review");
    expect(dashboard.revisions.some((revision) => revision.feedback === "加强结尾反转")).toBe(true);
  });

  it("approves a script and advances to asset design", async () => {
    const project = store.createProject({ name: `review-approve-${Date.now()}` });
    testProjectIds.push(project.id);
    const script = store.addArtifact(project.id, { type: "script", title: "Test", content: "Test script" });
    store.setStage(project.id, "script_user_review");
    const response = await app.inject({ method: "POST", url: `/api/projects/${project.id}/reviews`, payload: { gate: "script_user", artifactId: script.id, decision: "approved", scores: {}, feedback: "通过" } });
    expect(response.statusCode).toBe(201);
    expect(store.getProject(project.id).stage).toBe("asset_design");
  });

  it("resolves older script feedback when a revised script is approved", async () => {
    const project = store.createProject({ name: `review-resolve-${Date.now()}` });
    testProjectIds.push(project.id);
    const rejectedScript = store.addArtifact(project.id, { type: "script", title: "V1", content: "Old script" });
    store.setStage(project.id, "script_user_review");
    await app.inject({ method: "POST", url: `/api/projects/${project.id}/reviews`, payload: {
      gate: "script_user", artifactId: rejectedScript.id, decision: "rejected", scores: {}, feedback: "对白不自然", category: "用户剧本审核意见"
    } });

    const revisedScript = store.addArtifact(project.id, { type: "script", title: "V2", content: "Revised script" });
    store.setStage(project.id, "script_user_review");
    const response = await app.inject({ method: "POST", url: `/api/projects/${project.id}/reviews`, payload: {
      gate: "script_user", artifactId: revisedScript.id, decision: "approved", scores: {}, feedback: "通过"
    } });

    expect(response.statusCode).toBe(201);
    const dashboard = store.dashboard(project.id);
    expect(dashboard.revisions).toHaveLength(1);
    expect(dashboard.revisions[0].status).toBe("resolved");
    expect(dashboard.revisions[0].resolvedAt).not.toBeNull();
  });
});

describe("script review version isolation", () => {
  it("does not reuse a director approval from an older script version", async () => {
    const project = store.createProject({ name: `review-lineage-${Date.now()}` });
    testProjectIds.push(project.id);
    const first = store.addArtifact(project.id, { type: "script", title: "V1", content: "第一版剧本" });
    store.setStage(project.id, "script_internal_review");
    const director = await app.inject({ method: "POST", url: `/api/projects/${project.id}/reviews`, payload: {
      gate: "director", artifactId: first.id, decision: "approved", scores: { story: 4, feasibility: 4 }, feedback: "通过"
    } });
    expect(director.statusCode).toBe(201);

    const second = store.addArtifact(project.id, { type: "script", title: "V2", content: "第二版剧本" });
    store.setStage(project.id, "script_internal_review");
    const audience = await app.inject({ method: "POST", url: `/api/projects/${project.id}/reviews`, payload: {
      gate: "audience", artifactId: second.id, decision: "approved", scores: { hook: 4, clarity: 4 }, feedback: "通过"
    } });

    expect(audience.statusCode).toBe(400);
    expect(audience.json().error).toContain("当前剧本版本尚未通过总导演审核");
    expect(store.getProject(project.id).stage).toBe("script_internal_review");
  });

  it("rejects an attempt to review a superseded script", async () => {
    const project = store.createProject({ name: `review-old-version-${Date.now()}` });
    testProjectIds.push(project.id);
    const first = store.addArtifact(project.id, { type: "script", title: "V1", content: "第一版剧本" });
    store.addArtifact(project.id, { type: "script", title: "V2", content: "第二版剧本" });
    store.setStage(project.id, "script_internal_review");

    const response = await app.inject({ method: "POST", url: `/api/projects/${project.id}/reviews`, payload: {
      gate: "director", artifactId: first.id, decision: "approved", scores: { story: 4, feasibility: 4 }, feedback: "通过"
    } });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("只能审核当前最新剧本版本");
  });

  it("preserves a user-locked visual style when the script is revised", () => {
    const project = store.createProject({ name: `style-lock-${Date.now()}` });
    testProjectIds.push(project.id);
    store.setCreativeProfile(project.id, { visualStyle: {
      status: "locked", name: "现代纪实广告", descriptors: ["自然窗光", "克制色彩"], evidence: "用户已确认", source: "user", sourceArtifactId: null
    } });

    store.addArtifact(project.id, { type: "script", title: "修订稿", content: "雨夜街头有霓虹反光，但不改变已确认的视觉方案。" });

    expect(store.getProject(project.id).visualStyle).toMatchObject({ status: "locked", name: "现代纪实广告", source: "user" });
  });
});

describe("APIMart settings", () => {
  it("accepts an unsaved API key for a connection test", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.apimart.ai/v1/balance");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-unsaved");
      return new Response(JSON.stringify({ success: true, remain_balance: 8.8 }), { status: 200 });
    }) as typeof fetch;
    try {
      const response = await app.inject({ method: "POST", url: "/api/settings/test", payload: { provider: "apimart", apiKey: "sk-unsaved" } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true, message: "连接成功，当前可用额度：8.8" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not report a malformed saved key as usable", async () => {
    store.setSetting("apimart_api_key", "not-an-encrypted-secret");
    const response = await app.inject({ method: "GET", url: "/api/settings" });
    expect(response.statusCode).toBe(200);
    expect(response.json().hasApiKey).toBe(false);
  });

  it("rejects Mock generation from the asset center", async () => {
    const project = store.createProject({ name: `asset-real-generation-${Date.now()}` });
    testProjectIds.push(project.id);
    store.setStage(project.id, "asset_design");
    const asset = store.upsertAsset(project.id, { type: "character", name: "Test character", prompt: "valid prompt" });
    const response = await app.inject({ method: "POST", url: `/api/projects/${project.id}/jobs`, payload: {
      assetId: asset.id, kind: "image", provider: "mock", model: "gpt-image-2-official", prompt: "valid prompt",
      params: { size: "3:2", resolution: "1k", quality: "high", n: 1 }
    } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("不支持Mock模拟生成");
  });

  it("normalizes Nano Banana asset generation parameters and strips management text", async () => {
    const project = store.createProject({ name: `asset-nano-${Date.now()}` });
    testProjectIds.push(project.id);
    store.setStage(project.id, "asset_design");
    store.setSetting("apimart_api_key", encryptSecret("sk-test-placeholder"));
    const asset = store.upsertAsset(project.id, { type: "style", name: "Test style", referenceCode: "STYLE_TEST_001", prompt: "风格设定图" });
    const response = await app.inject({ method: "POST", url: `/api/projects/${project.id}/jobs`, payload: {
      assetId: asset.id, kind: "image", provider: "apimart", model: "gemini-2.5-flash-image-preview-official",
      prompt: "整体风格样板图，风格资产 ID：STYLE_TEST_001，用于《测试项目》统一影像。3:2构图，暖灯照明，棉布和木材质清楚，保持色彩一致。",
      params: { size: "3:2", resolution: "1k", n: 1 }
    } });
    expect(response.statusCode).toBe(201);
    const value = response.json();
    expect(value.prompt).not.toContain("资产 ID");
    expect(value.prompt).not.toContain("用于《");
    expect(value.params).toEqual({ size: "3:2", resolution: "1K", n: 1 });
  });

  it("rejects unsupported multi-image requests for Seedream 5.0 Pro", async () => {
    const project = store.createProject({ name: `asset-seedream-${Date.now()}` });
    testProjectIds.push(project.id);
    store.setStage(project.id, "asset_design");
    store.setSetting("apimart_api_key", encryptSecret("sk-test-placeholder"));
    const asset = store.upsertAsset(project.id, { type: "character", name: "Test character", prompt: "角色设定图" });
    const response = await app.inject({ method: "POST", url: `/api/projects/${project.id}/jobs`, payload: {
      assetId: asset.id, kind: "image", provider: "apimart", model: "doubao-seedream-5-0-pro", prompt: "角色设定图，正面构图，柔和灯光，棉布材质，保持身份一致。",
      params: { size: "3:2", resolution: "2k", n: 2 }
    } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("不支持当前生成数量");
  });

  it("rejects an incomplete cinematic portrait used as a character reference asset", async () => {
    const project = store.createProject({ name: `asset-character-layout-${Date.now()}` });
    testProjectIds.push(project.id);
    store.setStage(project.id, "asset_design");
    store.setSetting("apimart_api_key", encryptSecret("sk-test-placeholder"));
    const asset = store.upsertAsset(project.id, { type: "character", name: "Test character", prompt: "雨夜霓虹中的角色电影静帧" });

    const response = await app.inject({ method: "POST", url: `/api/projects/${project.id}/jobs`, payload: {
      assetId: asset.id, kind: "image", provider: "apimart", model: "gpt-image-2-official", prompt: asset.prompt,
      params: { size: "3:2", resolution: "1k", quality: "high", n: 1 }
    } });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("角色设定图提示词未通过规范检查");
  });

  it("does not allow an image job to bind an asset from another project", async () => {
    const project = store.createProject({ name: `asset-owner-${Date.now()}` });
    const other = store.createProject({ name: `asset-owner-other-${Date.now()}` });
    testProjectIds.push(project.id, other.id);
    store.setStage(project.id, "asset_design");
    store.setSetting("apimart_api_key", encryptSecret("sk-test-placeholder"));
    const foreignAsset = store.upsertAsset(other.id, { type: "prop", name: "Foreign prop", prompt: "道具设定图" });

    const response = await app.inject({ method: "POST", url: `/api/projects/${project.id}/jobs`, payload: {
      assetId: foreignAsset.id, kind: "image", provider: "apimart", model: "gpt-image-2-official", prompt: foreignAsset.prompt,
      params: { size: "1:1", resolution: "1k", quality: "high", n: 1 }
    } });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("不属于当前项目");
  });
});

describe("asset-by-asset user review", () => {
  function createCompletedAsset(projectId: string, name: string) {
    const asset = store.upsertAsset(projectId, { type: "character", name, prompt: "角色设定图" });
    const job = store.addJob({ projectId, shotId: null, assetId: asset.id, kind: "image", provider: "mock", model: "gpt-image-2-official", prompt: "角色设定图", params: {} });
    store.updateJob(job.id, { status: "completed", progress: 100, output: { localPaths: [`.data/media/${job.id}.png`] } });
    const mediaId = `med_asset_${Date.now()}_${Math.random()}`;
    db.prepare("INSERT INTO media_files VALUES (?,?,?,?,?,?,?,?,?)").run(mediaId, projectId, job.id, "image", `.data/media/${job.id}.png`, "", null, "{}", new Date().toISOString());
    return { asset, job, mediaId };
  }

  it("approves one asset against its latest completed result", async () => {
    const project = store.createProject({ name: `asset-item-approve-${Date.now()}` });
    testProjectIds.push(project.id);
    store.setStage(project.id, "asset_user_review");
    const { asset, job, mediaId } = createCompletedAsset(project.id, "Test asset");
    const response = await app.inject({ method: "POST", url: `/api/assets/${asset.id}/review`, payload: { decision: "approved", feedback: "" } });
    expect(response.statusCode).toBe(200);
    const updated = store.dashboard(project.id).assets.find((item) => item.id === asset.id)!;
    expect(updated.status).toBe("approved");
    expect(updated.approvedJobId).toBe(job.id);
    expect(updated.referenceMediaId).toBe(mediaId);
  });

  it("locks the exact generated image selected by the user", async () => {
    const project = store.createProject({ name: `asset-image-lock-${Date.now()}` });
    testProjectIds.push(project.id);
    store.setStage(project.id, "asset_user_review");
    const { asset, job, mediaId: firstMediaId } = createCompletedAsset(project.id, "Multi image asset");
    const secondMediaId = `med_asset_second_${Date.now()}_${Math.random()}`;
    db.prepare("INSERT INTO media_files VALUES (?,?,?,?,?,?,?,?,?)").run(secondMediaId, project.id, job.id, "image", `.data/media/${job.id}-2.png`, "", null, "{}", new Date().toISOString());

    const response = await app.inject({ method: "POST", url: `/api/assets/${asset.id}/lock-image`, payload: { jobId: job.id, mediaId: secondMediaId } });

    expect(response.statusCode).toBe(200);
    const updated = store.dashboard(project.id).assets.find((item) => item.id === asset.id)!;
    expect(updated.status).toBe("approved");
    expect(updated.approvedJobId).toBe(job.id);
    expect(updated.referenceMediaId).toBe(secondMediaId);
    expect(updated.referenceMediaId).not.toBe(firstMediaId);
  });

  it("invalidates only storyboard shots that reference an asset whose main image changed", async () => {
    const project = store.createProject({ name: `asset-lock-shot-isolation-${Date.now()}` });
    testProjectIds.push(project.id);
    store.setStage(project.id, "asset_user_review");
    const target = createCompletedAsset(project.id, "Target asset");
    const other = createCompletedAsset(project.id, "Other asset");
    const affectedShot = store.upsertShot(project.id, { shotNumber: 1, title: "Affected", assetIds: [target.asset.id] });
    const untouchedShot = store.upsertShot(project.id, { shotNumber: 2, title: "Untouched", assetIds: [other.asset.id] });
    db.prepare("UPDATE shots SET status='approved',sample_approved=1,approved_image_job_id='img-job',approved_image_media_id='img-media',approved_video_job_id='vid-job',last_frame_media_id='tail-media' WHERE id IN (?,?)").run(affectedShot.id, untouchedShot.id);
    db.prepare("UPDATE assets SET reference_media_id=? WHERE id=?").run(target.mediaId, target.asset.id);
    const replacementMediaId = `med_asset_replacement_${Date.now()}_${Math.random()}`;
    db.prepare("INSERT INTO media_files VALUES (?,?,?,?,?,?,?,?,?)").run(replacementMediaId, project.id, target.job.id, "image", `.data/media/${target.job.id}-replacement.png`, "", null, "{}", new Date().toISOString());

    const response = await app.inject({ method: "POST", url: `/api/assets/${target.asset.id}/lock-image`, payload: { jobId: target.job.id, mediaId: replacementMediaId } });

    expect(response.statusCode).toBe(200);
    const dashboard = store.dashboard(project.id);
    const affected = dashboard.shots.find((shot) => shot.id === affectedShot.id)!;
    const untouched = dashboard.shots.find((shot) => shot.id === untouchedShot.id)!;
    expect(affected).toMatchObject({ status: "stale", sampleApproved: false, approvedImageJobId: null, approvedImageMediaId: null, approvedVideoJobId: null, lastFrameMediaId: null });
    expect(untouched).toMatchObject({ status: "approved", sampleApproved: true, approvedImageJobId: "img-job", approvedImageMediaId: "img-media", approvedVideoJobId: "vid-job", lastFrameMediaId: "tail-media" });
  });

  it("selects a completed project image as a generation reference without approving the asset", async () => {
    const project = store.createProject({ name: `asset-project-library-${Date.now()}` });
    testProjectIds.push(project.id);
    store.setStage(project.id, "asset_user_review");
    const target = createCompletedAsset(project.id, "Target asset");
    const source = createCompletedAsset(project.id, "Source asset");
    await app.inject({ method: "POST", url: `/api/assets/${target.asset.id}/review`, payload: { decision: "approved", feedback: "" } });

    const response = await app.inject({ method: "POST", url: `/api/assets/${target.asset.id}/reference/select`, payload: { mediaId: source.mediaId } });

    expect(response.statusCode).toBe(200);
    const updated = store.dashboard(project.id).assets.find((item) => item.id === target.asset.id)!;
    expect(updated.referenceMediaId).toBe(source.mediaId);
    expect(updated.status).toBe("stale");
    expect(updated.approvedJobId).toBeNull();
  });

  it("rejects a project-library image from another project", async () => {
    const project = store.createProject({ name: `asset-project-library-owner-${Date.now()}` });
    const other = store.createProject({ name: `asset-project-library-foreign-${Date.now()}` });
    testProjectIds.push(project.id, other.id);
    store.setStage(project.id, "asset_user_review");
    const target = createCompletedAsset(project.id, "Target asset");
    const foreign = createCompletedAsset(other.id, "Foreign asset");

    const response = await app.inject({ method: "POST", url: `/api/assets/${target.asset.id}/reference/select`, payload: { mediaId: foreign.mediaId } });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("不属于当前项目");
  });

  it("rejects an asset only with specific feedback", async () => {
    const project = store.createProject({ name: `asset-item-reject-${Date.now()}` });
    testProjectIds.push(project.id);
    store.setStage(project.id, "asset_user_review");
    const { asset } = createCompletedAsset(project.id, "Test asset");
    const missing = await app.inject({ method: "POST", url: `/api/assets/${asset.id}/review`, payload: { decision: "rejected", feedback: "" } });
    expect(missing.statusCode).toBe(400);
    const response = await app.inject({ method: "POST", url: `/api/assets/${asset.id}/review`, payload: { decision: "rejected", feedback: "服装颜色不一致" } });
    expect(response.statusCode).toBe(200);
    const dashboard = store.dashboard(project.id);
    expect(dashboard.assets.find((item) => item.id === asset.id)?.status).toBe("stale");
    expect(dashboard.revisions.some((revision) => revision.targetId === asset.id && revision.feedback === "服装颜色不一致")).toBe(true);
  });

  it("does not enter storyboard until every asset is individually approved", async () => {
    const project = store.createProject({ name: `asset-gate-${Date.now()}` });
    testProjectIds.push(project.id);
    store.setStage(project.id, "asset_user_review");
    const first = createCompletedAsset(project.id, "First asset");
    createCompletedAsset(project.id, "Second asset");
    await app.inject({ method: "POST", url: `/api/assets/${first.asset.id}/review`, payload: { decision: "approved", feedback: "" } });
    const blocked = await app.inject({ method: "POST", url: `/api/projects/${project.id}/reviews`, payload: { gate: "asset_user", decision: "approved", scores: {}, feedback: "完成" } });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error).toContain("没有逐项确认");
    expect(store.getProject(project.id).stage).toBe("asset_user_review");
    expect(store.dashboard(project.id).reviews).toHaveLength(0);
  });

  it("invalidates approval when a new generation is submitted", async () => {
    const project = store.createProject({ name: `asset-invalidate-${Date.now()}` });
    testProjectIds.push(project.id);
    store.setStage(project.id, "asset_user_review");
    store.setSetting("apimart_api_key", encryptSecret("sk-test-placeholder"));
    const { asset } = createCompletedAsset(project.id, "Test asset");
    await app.inject({ method: "POST", url: `/api/assets/${asset.id}/review`, payload: { decision: "approved", feedback: "" } });
    const response = await app.inject({ method: "POST", url: `/api/projects/${project.id}/jobs`, payload: {
      assetId: asset.id, kind: "image", provider: "apimart", model: "gpt-image-2-official", prompt: validCharacterPrompt,
      params: { size: "3:2", resolution: "1k", quality: "high", n: 1 }
    } });
    expect(response.statusCode).toBe(201);
    const updated = store.dashboard(project.id).assets.find((item) => item.id === asset.id)!;
    expect(updated.status).toBe("stale");
    expect(updated.approvedJobId).toBeNull();
  });
});

describe("Codex image bridge", () => {
  it("creates a queued Codex request without an APIMart API key", async () => {
    const project = store.createProject({ name: `codex-image-${Date.now()}` });
    testProjectIds.push(project.id);
    store.setStage(project.id, "asset_user_review");
    const asset = store.upsertAsset(project.id, { type: "prop", name: "Test prop", prompt: "道具设定图，3:2构图，柔和灯光，金属材质，保持造型一致。", negativePrompt: "不要文字" });
    const response = await app.inject({ method: "POST", url: `/api/assets/${asset.id}/codex-image-requests`, payload: {
      prompt: asset.prompt, aspectRatio: "3:2", quality: "high", count: 1
    } });
    expect(response.statusCode).toBe(201);
    const value = response.json();
    expect(value).toMatchObject({ projectId: project.id, assetId: asset.id, status: "queued", aspectRatio: "3:2", quality: "high", count: 1 });
    expect(store.dashboard(project.id).codexImageRequests).toHaveLength(1);
  });

  it("blocks asset approval while a Codex request is pending", async () => {
    const project = store.createProject({ name: `codex-pending-${Date.now()}` });
    testProjectIds.push(project.id);
    store.setStage(project.id, "asset_user_review");
    const asset = store.upsertAsset(project.id, { type: "prop", name: "Test prop", prompt: "道具设定图" });
    const oldJob = store.addJob({ projectId: project.id, shotId: null, assetId: asset.id, kind: "image", provider: "mock", model: "gpt-image-2", prompt: "旧图", params: {} });
    store.updateJob(oldJob.id, { status: "completed", progress: 100 });
    store.addCodexImageRequest({ projectId: project.id, assetId: asset.id, shotId: null, prompt: "新图", negativePrompt: "", aspectRatio: "3:2", quality: "high", count: 1, referencePaths: [] });
    const response = await app.inject({ method: "POST", url: `/api/assets/${asset.id}/review`, payload: { decision: "approved", feedback: "" } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("Codex 生图任务未完成");
  });

  it("creates a storyboard Codex request with locked asset references", async () => {
    const project = store.createProject({ name: `codex-shot-${Date.now()}`, aspectRatio: "9:16" });
    testProjectIds.push(project.id);
    store.setStage(project.id, "storyboard_design");
    const asset = store.upsertAsset(project.id, { type: "character", name: "Locked character", prompt: "角色设定图", negativePrompt: "不要改变脸型" });
    const mediaId = `med_test_${Date.now()}`;
    const referencePath = `E:\\test-assets\\locked-character.png`;
    db.prepare("INSERT INTO media_files VALUES (?,?,?,?,?,?,?,?,?)").run(mediaId, project.id, null, "image", referencePath, "", null, "{}", new Date().toISOString());
    db.prepare("UPDATE assets SET reference_media_id=? WHERE id=?").run(mediaId, asset.id);
    const shot = store.upsertShot(project.id, { shotNumber: 1, title: "开场", duration: 5, imagePrompt: "竖屏中景，角色站在柜台前。", assetIds: [asset.id] });

    const response = await app.inject({ method: "POST", url: `/api/shots/${shot.id}/codex-image-requests`, payload: {
      prompt: shot.imagePrompt, aspectRatio: "9:16", quality: "high", count: 1
    } });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ projectId: project.id, shotId: shot.id, assetId: null, status: "queued", aspectRatio: "9:16" });
    expect(response.json().referencePaths).toEqual([referencePath]);
    expect(response.json().negativePrompt).toContain("不要改变脸型");
    expect(store.dashboard(project.id).codexImageRequests.some((request) => request.shotId === shot.id)).toBe(true);
  });

  it("accepts a validated APIMart image job during storyboard design", async () => {
    const project = store.createProject({ name: `apimart-shot-${Date.now()}`, aspectRatio: "9:16" });
    testProjectIds.push(project.id);
    store.setStage(project.id, "storyboard_design");
    store.setSetting("apimart_api_key", encryptSecret("sk-test-placeholder"));
    const shot = store.upsertShot(project.id, { shotNumber: 1, title: "开场", duration: 5, imagePrompt: "竖屏中景，角色站在柜台前。" });

    const response = await app.inject({ method: "POST", url: `/api/projects/${project.id}/jobs`, payload: {
      shotId: shot.id, kind: "image", provider: "apimart", model: "gpt-image-2-official", prompt: shot.imagePrompt,
      params: { size: "9:16", resolution: "2k", quality: "high", n: 1 }, batch: false
    } });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ projectId: project.id, shotId: shot.id, provider: "apimart", status: "draft" });
  });

  it("locks the other image channel until the active Codex task is cancelled", async () => {
    const project = store.createProject({ name: `image-channel-lock-${Date.now()}`, aspectRatio: "9:16" });
    testProjectIds.push(project.id);
    store.setStage(project.id, "storyboard_design");
    store.setSetting("apimart_api_key", encryptSecret("sk-test-placeholder"));
    const shot = store.upsertShot(project.id, { shotNumber: 1, title: "开场", duration: 5, imagePrompt: "雨夜门口，竖屏中景。" });

    const codex = await app.inject({ method: "POST", url: `/api/shots/${shot.id}/codex-image-requests`, payload: {
      prompt: shot.imagePrompt, aspectRatio: "9:16", quality: "high", count: 1
    } });
    expect(codex.statusCode).toBe(201);

    const blockedApimart = await app.inject({ method: "POST", url: `/api/projects/${project.id}/jobs`, payload: {
      shotId: shot.id, kind: "image", provider: "apimart", model: "gpt-image-2-official", prompt: shot.imagePrompt,
      params: { size: "9:16", resolution: "2k", quality: "high", n: 1 }, batch: false
    } });
    expect(blockedApimart.statusCode).toBe(400);
    expect(blockedApimart.json().error).toContain("不能同时使用两种生图方式");

    const cancelled = await app.inject({ method: "POST", url: `/api/codex-image-requests/${codex.json().id}/cancel` });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().status).toBe("cancelled");

    const apimart = await app.inject({ method: "POST", url: `/api/projects/${project.id}/jobs`, payload: {
      shotId: shot.id, kind: "image", provider: "apimart", model: "gpt-image-2-official", prompt: shot.imagePrompt,
      params: { size: "9:16", resolution: "2k", quality: "high", n: 1 }, batch: false
    } });
    expect(apimart.statusCode).toBe(201);

    const blockedCodex = await app.inject({ method: "POST", url: `/api/shots/${shot.id}/codex-image-requests`, payload: {
      prompt: shot.imagePrompt, aspectRatio: "9:16", quality: "high", count: 1
    } });
    expect(blockedCodex.statusCode).toBe(400);
    expect(blockedCodex.json().error).toContain("完成或失败前不能切换到 Codex");
  });

  it("applies the same channel lock to asset generation", async () => {
    const project = store.createProject({ name: `asset-channel-lock-${Date.now()}` });
    testProjectIds.push(project.id);
    store.setStage(project.id, "asset_user_review");
    store.setSetting("apimart_api_key", encryptSecret("sk-test-placeholder"));
    const asset = store.upsertAsset(project.id, { type: "prop", name: "黑箱", prompt: "黑色装备箱设定图。" });

    const codex = await app.inject({ method: "POST", url: `/api/assets/${asset.id}/codex-image-requests`, payload: {
      prompt: asset.prompt, aspectRatio: "3:2", quality: "high", count: 1
    } });
    expect(codex.statusCode).toBe(201);

    const blocked = await app.inject({ method: "POST", url: `/api/projects/${project.id}/jobs`, payload: {
      assetId: asset.id, kind: "image", provider: "apimart", model: "gpt-image-2-official", prompt: asset.prompt,
      params: { size: "3:2", resolution: "2k", quality: "high", n: 1 }, batch: false
    } });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error).toContain("不能同时使用两种生图方式");
  });
});

describe("storyboard production contracts", () => {
  function completedImage(projectId: string, shotId: string) {
    const job = store.addJob({ projectId, shotId, assetId: null, kind: "image", provider: "mock", model: "gpt-image-2", prompt: "首帧", params: {} });
    store.updateJob(job.id, { status: "completed", progress: 100, output: { localPaths: [`.data/media/${job.id}.png`] } });
    const mediaId = `med_image_${Date.now()}_${Math.random()}`;
    db.prepare("INSERT INTO media_files VALUES (?,?,?,?,?,?,?,?,?)").run(mediaId, projectId, job.id, "image", `.data/media/${job.id}.png`, "", null, "{}", new Date().toISOString());
    return { job, mediaId };
  }

  it("locks an exact image candidate and requires it before video generation", async () => {
    const project = store.createProject({ name: `shot-lock-${Date.now()}` });
    testProjectIds.push(project.id);
    store.setStage(project.id, "sample_video");
    store.setSetting("apimart_api_key", encryptSecret("sk-test-placeholder"));
    const shot = store.upsertShot(project.id, { shotNumber: 1, title: "开场", duration: 5, videoPrompt: "角色抬头，镜头缓慢推进。", plannedEndState: "角色抬头看向镜头" });

    const blocked = await app.inject({ method: "POST", url: `/api/projects/${project.id}/jobs`, payload: {
      shotId: shot.id, kind: "video", provider: "apimart", model: "doubao-seedance-2.0", prompt: shot.videoPrompt,
      params: { size: "9:16", resolution: "720p", duration: 5, generate_audio: true }
    } });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error).toContain("锁定该镜头的首帧");

    const image = completedImage(project.id, shot.id);
    const locked = await app.inject({ method: "POST", url: `/api/shots/${shot.id}/lock-image`, payload: { jobId: image.job.id, mediaId: image.mediaId } });
    expect(locked.statusCode).toBe(200);
    expect(store.dashboard(project.id).shots[0]).toMatchObject({ approvedImageJobId: image.job.id, approvedImageMediaId: image.mediaId });

    const response = await app.inject({ method: "POST", url: `/api/projects/${project.id}/jobs`, payload: {
      shotId: shot.id, kind: "video", provider: "apimart", model: "doubao-seedance-2.0", prompt: shot.videoPrompt,
      params: { size: "9:16", resolution: "720p", duration: 5, generate_audio: true }
    } });
    expect(response.statusCode).toBe(201);
    expect(response.json().params).toMatchObject({ return_last_frame: true, first_frame_media_id: image.mediaId });
  });

  it("blocks a seamless continuation until its parent video is accepted", async () => {
    const project = store.createProject({ name: `shot-continuity-${Date.now()}` });
    testProjectIds.push(project.id);
    store.setStage(project.id, "batch_generation");
    store.setSetting("apimart_api_key", encryptSecret("sk-test-placeholder"));
    const parent = store.upsertShot(project.id, { shotNumber: 1, title: "上一镜", duration: 5, plannedEndState: "角色站在门边" });
    const child = store.upsertShot(project.id, { shotNumber: 2, title: "连续镜头", duration: 5, parentShotId: parent.id, sequenceRelation: "seamless_continuation", videoPrompt: "角色继续推门。" });

    const response = await app.inject({ method: "POST", url: `/api/projects/${project.id}/jobs`, payload: {
      shotId: child.id, kind: "video", provider: "apimart", model: "doubao-seedance-2.0", prompt: child.videoPrompt,
      params: { size: "9:16", resolution: "720p", duration: 5, generate_audio: true }, batch: false
    } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("上一镜头尚未通过视频审核");
  });

  it("accepts a completed video, records its actual state, and rejects do not enter canon", async () => {
    const project = store.createProject({ name: `shot-video-review-${Date.now()}` });
    testProjectIds.push(project.id);
    store.setStage(project.id, "batch_generation");
    const shot = store.upsertShot(project.id, { shotNumber: 1, title: "镜头", duration: 5, plannedEndState: "计划结束" });
    const job = store.addJob({ projectId: project.id, shotId: shot.id, assetId: null, kind: "video", provider: "mock", model: "doubao-seedance-2.0", prompt: "提示词", params: {} });
    store.updateJob(job.id, { status: "completed", progress: 100, output: { localPaths: [`.data/media/${job.id}.mp4`] } });
    const videoMedia = `med_video_${Date.now()}`;
    const lastFrame = `med_last_${Date.now()}`;
    db.prepare("INSERT INTO media_files VALUES (?,?,?,?,?,?,?,?,?)").run(videoMedia, project.id, job.id, "video", `.data/media/${job.id}.mp4`, "", null, JSON.stringify({ role: "output" }), new Date().toISOString());
    db.prepare("INSERT INTO media_files VALUES (?,?,?,?,?,?,?,?,?)").run(lastFrame, project.id, job.id, "image", `.data/media/${job.id}.last.png`, "", null, JSON.stringify({ role: "last_frame" }), new Date().toISOString());

    const rejected = await app.inject({ method: "POST", url: `/api/shots/${shot.id}/video-review`, payload: { jobId: job.id, decision: "rejected", feedback: "动作重复", observedEndState: "", observedAudioState: "" } });
    expect(rejected.statusCode).toBe(200);
    expect(store.dashboard(project.id).shots[0].approvedVideoJobId).toBeNull();

    const approved = await app.inject({ method: "POST", url: `/api/shots/${shot.id}/video-review`, payload: { jobId: job.id, decision: "approved", feedback: "", observedEndState: "角色站在门右侧，手扶门把", observedAudioState: "台词说话人正确，口型同步" } });
    expect(approved.statusCode).toBe(200);
    expect(store.dashboard(project.id).shots[0]).toMatchObject({ approvedVideoJobId: job.id, lastFrameMediaId: lastFrame, observedEndState: "角色站在门右侧，手扶门把", observedAudioState: "台词说话人正确，口型同步" });
  });

  it("attaches rights-cleared dialogue audio to a lip-sync video request", async () => {
    const project = store.createProject({ name: `shot-audio-${Date.now()}` });
    testProjectIds.push(project.id);
    store.setStage(project.id, "sample_video");
    store.setSetting("apimart_api_key", encryptSecret("sk-test-placeholder"));
    const stamp = new Date().toISOString();
    const audioId = `aud_dialogue_${Date.now()}`;
    db.prepare("INSERT INTO audio_assets VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(audioId, project.id, "dialogue_line", "猫掌柜台词", null, "", "https://example.com/dialogue.wav", 4.2, "本人录制并授权使用", "干声台词", stamp, stamp);
    const shot = store.upsertShot(project.id, { shotNumber: 1, title: "对白", duration: 5, videoPrompt: "猫掌柜正对镜头说话。", plannedEndState: "猫掌柜说完后停顿",
      audioMode: "dialogue_lipsync", audioAssetIds: [audioId], speakerMap: "猫掌柜说完整台词", lipSyncNotes: "稳定中近景，不转头" });
    const image = completedImage(project.id, shot.id);
    await app.inject({ method: "POST", url: `/api/shots/${shot.id}/lock-image`, payload: { jobId: image.job.id, mediaId: image.mediaId } });

    const response = await app.inject({ method: "POST", url: `/api/projects/${project.id}/jobs`, payload: {
      shotId: shot.id, kind: "video", provider: "apimart", model: "doubao-seedance-2.0", prompt: "猫掌柜正对镜头说话。音频参考：@Audio1提供准确台词和口型时序。",
      params: { size: "9:16", resolution: "720p", duration: 5, generate_audio: true }
    } });

    expect(response.statusCode).toBe(201);
    expect(response.json().params).toMatchObject({ audio_urls: ["https://example.com/dialogue.wav"], audio_reference_mode: "dialogue_lipsync", first_frame_media_id: image.mediaId });
  });

  it("blocks local-only audio and audio references longer than fifteen seconds", async () => {
    const project = store.createProject({ name: `shot-audio-guard-${Date.now()}` });
    testProjectIds.push(project.id);
    store.setStage(project.id, "sample_video");
    store.setSetting("apimart_api_key", encryptSecret("sk-test-placeholder"));
    const stamp = new Date().toISOString();
    const localOnlyId = `aud_local_${Date.now()}`;
    db.prepare("INSERT INTO audio_assets VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(localOnlyId, project.id, "music", "本地音乐", null, "E:\\music.mp3", "", 8, "已获商用授权", "", stamp, stamp);
    const shot = store.upsertShot(project.id, { shotNumber: 1, title: "MV", duration: 8, videoPrompt: "角色按节拍表演。", audioMode: "music_sync", audioAssetIds: [localOnlyId] });
    const image = completedImage(project.id, shot.id);
    await app.inject({ method: "POST", url: `/api/shots/${shot.id}/lock-image`, payload: { jobId: image.job.id, mediaId: image.mediaId } });
    const localOnly = await app.inject({ method: "POST", url: `/api/projects/${project.id}/jobs`, payload: {
      shotId: shot.id, kind: "video", provider: "apimart", model: "doubao-seedance-2.0", prompt: shot.videoPrompt,
      params: { size: "9:16", resolution: "720p", duration: 8, generate_audio: true }
    } });
    expect(localOnly.statusCode).toBe(400);
    expect(localOnly.json().error).toContain("没有 APIMart 可访问的 HTTPS URL");

    db.prepare("UPDATE audio_assets SET remote_url=?,duration=? WHERE id=?").run("https://example.com/full-song.mp3", 18, localOnlyId);
    const tooLong = await app.inject({ method: "POST", url: `/api/projects/${project.id}/jobs`, payload: {
      shotId: shot.id, kind: "video", provider: "apimart", model: "doubao-seedance-2.0", prompt: shot.videoPrompt,
      params: { size: "9:16", resolution: "720p", duration: 8, generate_audio: true }
    } });
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json().error).toContain("总时长超过 15 秒");
  });
});

describe("final preview gate", () => {
  it("blocks preview until every shot video is approved", async () => {
    const project = store.createProject({ name: `preview-gate-${Date.now()}` });
    testProjectIds.push(project.id);
    store.upsertShot(project.id, { shotNumber: 1, title: "镜头一", duration: 5 });
    const response = await app.inject({ method: "POST", url: `/api/projects/${project.id}/preview` });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("未通过审核");
    expect(store.getProject(project.id).stage).not.toBe("final_review");
  });

  it("persists preview artifacts and binds final approval to the latest version", async () => {
    const project = store.createProject({ name: `preview-artifact-${Date.now()}` });
    testProjectIds.push(project.id);
    const first = store.addArtifact(project.id, { type: "final_export", title: "预览V1", content: { localPath: "one.mp4", url: "/one.mp4", createdAt: "2026-01-01T00:00:00.000Z" } });
    const second = store.addArtifact(project.id, { type: "final_export", title: "预览V2", content: { localPath: "two.mp4", url: "/two.mp4", createdAt: "2026-01-02T00:00:00.000Z" } });
    store.setStage(project.id, "final_review");

    const oldVersion = await app.inject({ method: "POST", url: `/api/projects/${project.id}/reviews`, payload: { gate: "final_user", artifactId: first.id, decision: "approved", scores: {}, feedback: "" } });
    expect(oldVersion.statusCode).toBe(400);
    expect(oldVersion.json().error).toContain("最新预览片版本");

    const approved = await app.inject({ method: "POST", url: `/api/projects/${project.id}/reviews`, payload: { gate: "final_user", artifactId: second.id, decision: "approved", scores: {}, feedback: "" } });
    expect(approved.statusCode).toBe(201);
    const dashboard = store.dashboard(project.id);
    expect(dashboard.project.stage).toBe("completed");
    expect(dashboard.artifacts.find((artifact) => artifact.id === second.id)?.status).toBe("locked");
    expect(dashboard.artifacts.filter((artifact) => artifact.type === "final_export")).toHaveLength(2);
  });

  it("returns the persisted artifact id and restores the latest preview after refresh", async () => {
    const project = store.createProject({ name: `preview-refresh-${Date.now()}` });
    testProjectIds.push(project.id);
    const shot = store.upsertShot(project.id, { shotNumber: 1, title: "镜头一" });
    db.prepare("UPDATE shots SET approved_video_job_id=? WHERE id=?").run("job-approved-for-preview", shot.id);
    const response = await app.inject({ method: "POST", url: `/api/projects/${project.id}/preview` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ artifactId: expect.stringMatching(/^art_/), localPath: expect.stringContaining(project.id), url: expect.stringContaining("/api/files?path=") });
    const refreshed = store.dashboard(project.id);
    const latest = refreshed.artifacts.filter((artifact) => artifact.type === "final_export").sort((a, b) => b.version - a.version)[0];
    expect(latest.id).toBe(response.json().artifactId);
    expect(latest.content).toMatchObject({ localPath: response.json().localPath, url: response.json().url, createdAt: expect.any(String) });
    expect(refreshed.project.stage).toBe("final_review");
  });
});

describe("storyboard review prerequisites", () => {
  it("does not approve an empty storyboard even at the review stage", async () => {
    const project = store.createProject({ name: `empty-storyboard-${Date.now()}` });
    testProjectIds.push(project.id);
    store.setStage(project.id, "storyboard_user_review");
    const response = await app.inject({ method: "POST", url: `/api/projects/${project.id}/reviews`, payload: {
      gate: "storyboard_user", decision: "approved", scores: {}, feedback: ""
    } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("没有镜头");
  });
});

describe("local media boundary", () => {
  it("does not allow files from a similarly prefixed directory", async () => {
    const outside = path.join(rootDir, ".data-copy", "secret.png");
    fs.mkdirSync(path.dirname(outside), { recursive: true });
    fs.writeFileSync(outside, "secret");
    const response = await app.inject({ method: "GET", url: `/api/files?path=${encodeURIComponent(outside)}` });
    expect(response.statusCode).toBe(403);
    fs.rmSync(path.dirname(outside), { recursive: true, force: true });
  });
});

describe("Volcengine audio generation", () => {
  it("creates a queued audio job without exposing the API key", async () => {
    const project = store.createProject({ name: `audio-job-${Date.now()}` });
    testProjectIds.push(project.id);
    store.setSetting("volcengine_audio_api_key", encryptSecret("volc-secret"));
    const response = await app.inject({ method: "POST", url: `/api/projects/${project.id}/audio-assets/generate`, payload: {
      styleProfile: "hk90",
      type: "dialogue_line", name: "猫掌柜测试台词", textPrompt: "猫掌柜是成年男性，港式普通话，声线中低略沙哑，语气冷淡市井。\n\n先有雨声、店内风扇声，音乐用低音贝斯压低。\n\n猫掌柜用港式普通话，先停顿半拍，再用克制的语气说道：‘两位大哥，鞋可以带走，尊严要留下。’", rightsNote: "本人授权使用"
    } });
    expect(response.statusCode).toBe(202);
    expect(response.json().job).toMatchObject({ kind: "audio", provider: "volcengine", model: "seed-audio-1.0" });
    expect(JSON.stringify(response.json())).not.toContain("volc-secret");
  });

  it("rejects generic dialogue prompts before queuing a paid job", async () => {
    const project = store.createProject({ name: `audio-prompt-lint-${Date.now()}` });
    testProjectIds.push(project.id);
    store.setSetting("volcengine_audio_api_key", encryptSecret("volc-secret"));
    const response = await app.inject({ method: "POST", url: `/api/projects/${project.id}/audio-assets/generate`, payload: {
      type: "dialogue_line", name: "不合格台词", textPrompt: "请自然地说：你好。", rightsNote: "本人授权使用"
    } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("音频提示词未通过检查");
  });
});

describe("project deletion", () => {
  it("deletes one project and its project-scoped records without touching the global skill table", async () => {
    const project = store.createProject({ name: `delete-project-${Date.now()}` });
    testProjectIds.push(project.id);
    store.addArtifact(project.id, { type: "script", title: "待删除剧本", content: "临时内容" });
    const response = await app.inject({ method: "DELETE", url: `/api/projects/${project.id}` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, projectId: project.id });
    expect(() => store.getProject(project.id)).toThrow("项目不存在");
    expect(db.prepare("SELECT COUNT(*) AS count FROM artifacts WHERE project_id=?").get(project.id)).toMatchObject({ count: 0 });
  });
});
