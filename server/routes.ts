import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ArtifactType, ReviewGate, WorkflowStage, ContentMode, VisualStyleProfile } from "../shared/types.js";
import { characterAssetPromptIssues, cleanImagePrompt } from "../shared/image-prompt.js";
import { imageModelOption, imageModelParams, imageModelOptions } from "../shared/image-models.js";
import { isVideoResolution, videoModelOption, videoModelOptions } from "../shared/video-models.js";
import { encryptSecret, decryptSecret } from "./crypto.js";
import { db, store } from "./db.js";
import { mediaDir, uploadDir } from "./paths.js";
import { asJson, id, now } from "./utils.js";
import { addEventClient, emitEvent } from "./events.js";
import { buildPreview } from "./preview.js";
import { APIMartProvider } from "./providers/apimart.js";
import { MockProvider } from "./providers/mock.js";
import { VolcengineAudioProvider } from "./providers/volcengine-audio.js";
import { assertArtifactWriteAllowed, assertGateAllowed, assertShotWriteAllowed, assertVisualStyleLocked, scoresPass } from "./workflow.js";
import { assertNoActiveImageGeneration } from "./image-generation-lock.js";
import { cutAudioClip } from "./audio-clips.js";
import { inferAudioStyleProfile, validateAudioPrompt } from "../shared/audio-prompt.js";
import { applyWorkbenchUpdate, inspectWorkbenchUpdate } from "./workbench-update.js";

let updateInProgress = false;

const projectSchema = z.object({
  name: z.string().min(1), description: z.string().optional(), template: z.string().optional(),
  dryRun: z.boolean().optional(),
  aspectRatio: z.string().optional(), targetDuration: z.number().int().min(15).max(1800).optional(),
  contentMode: z.enum(["short_film", "ad", "mv"]).optional(), targetPlatform: z.string().min(1).optional(),
  targetAudience: z.string().optional(), creativePurpose: z.string().optional(), targetEmotion: z.string().optional()
});

const artifactSchema = z.object({
  type: z.enum(["idea", "script", "director_review", "audience_review", "asset_plan", "storyboard", "final_export"]),
  title: z.string().min(1), content: z.unknown(), status: z.enum(["draft", "review", "locked"]).optional(), createdBy: z.string().optional()
});

function latestArtifact(projectId: string, type: string) {
  return db.prepare("SELECT * FROM artifacts WHERE project_id=? AND type=? ORDER BY version DESC LIMIT 1").get(projectId, type) as Record<string, unknown> | undefined;
}

function approvedReviewExists(projectId: string, gate: string, artifactId: string) {
  return Boolean(db.prepare("SELECT id FROM reviews WHERE project_id=? AND artifact_id=? AND gate=? AND decision='approved' ORDER BY created_at DESC LIMIT 1").get(projectId, artifactId, gate));
}

function hasUsableApiKey() {
  const encrypted = store.getSetting("apimart_api_key");
  if (!encrypted) return false;
  try {
    return Boolean(decryptSecret(encrypted));
  } catch {
    return false;
  }
}

function stageForArtifact(type: ArtifactType): WorkflowStage | null {
  if (type === "idea") return "idea";
  if (type === "script") return "script_internal_review";
  if (type === "asset_plan") return "asset_user_review";
  if (type === "storyboard") return "storyboard_user_review";
  return null;
}

function invalidateShotsUsingAsset(projectId: string, assetId: string) {
  const stamp = now();
  db.prepare(`
    UPDATE shots
    SET status='stale', sample_approved=0,
        approved_image_job_id=NULL, approved_image_media_id=NULL, approved_video_job_id=NULL,
        observed_end_state='', observed_audio_state='', last_frame_media_id=NULL, updated_at=?
    WHERE project_id=?
      AND EXISTS (SELECT 1 FROM json_each(shots.asset_ids_json) WHERE value=?)
  `).run(stamp, projectId, assetId);
}

export async function registerRoutes(app: FastifyInstance) {
  app.get("/api/health", async () => ({ ok: true, name: "猫掌柜 AI 漫剧创作工作台", time: new Date().toISOString() }));

  app.get("/api/system/update-status", async () => inspectWorkbenchUpdate());
  app.post("/api/system/check-update", async (request, reply) => {
    if (request.headers["x-workbench-update-confirm"] !== "check-github") {
      return reply.code(403).send({ error: "更新检查请求未通过本机安全确认。" });
    }
    if (updateInProgress) return reply.code(409).send({ error: "工作台正在执行更新，请稍候。" });
    updateInProgress = true;
    try {
      return await inspectWorkbenchUpdate({ fetch: true });
    } finally {
      updateInProgress = false;
    }
  });
  app.post("/api/system/apply-update", async (request, reply) => {
    if (request.headers["x-workbench-update-confirm"] !== "pull-latest") {
      return reply.code(403).send({ error: "更新请求未通过本机安全确认。" });
    }
    if (updateInProgress) return reply.code(409).send({ error: "工作台正在执行更新，请不要重复点击。" });
    updateInProgress = true;
    try {
      return await applyWorkbenchUpdate();
    } finally {
      updateInProgress = false;
    }
  });

  app.get("/api/events", async (_request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "Access-Control-Allow-Origin": "*" });
    reply.raw.write(`event: ready\ndata: {}\n\n`);
    addEventClient(reply);
  });

  app.get("/api/projects", async () => store.listProjects());
  app.post("/api/projects", async (request, reply) => {
    const body = projectSchema.parse(request.body);
    const project = store.createProject(body);
    emitEvent("project.updated", { projectId: project.id });
    return reply.code(201).send(project);
  });
  app.delete("/api/projects/:projectId", async (request) => {
    const { projectId } = request.params as { projectId: string };
    const result = store.deleteProject(projectId);
    emitEvent("project.updated", { projectId, deleted: true });
    return { ok: true, ...result };
  });
  app.get("/api/projects/:projectId", async (request) => store.dashboard((request.params as { projectId: string }).projectId));

  app.put("/api/projects/:projectId/creative-profile", async (request) => {
    const { projectId } = request.params as { projectId: string };
    const current = store.getProject(projectId);
    const body = z.object({
      contentMode: z.enum(["short_film", "ad", "mv"]).optional(),
      targetPlatform: z.string().min(1).optional(),
      targetAudience: z.string().optional(),
      creativePurpose: z.string().optional(),
      targetEmotion: z.string().optional(),
      visualStyle: z.object({
        status: z.enum(["needs_review", "locked"]),
        name: z.string().default(""),
        descriptors: z.array(z.string()).default([]),
        evidence: z.string().default(""),
        source: z.enum(["script", "user", "style_asset", "none"]).default("user"),
        sourceArtifactId: z.string().nullable().default(null)
      }).optional()
    }).parse(request.body) as { contentMode?: ContentMode; targetPlatform?: string; targetAudience?: string; creativePurpose?: string; targetEmotion?: string; visualStyle?: VisualStyleProfile };
    const visualStyle = body.visualStyle ? { ...body.visualStyle, source: body.visualStyle.source ?? "user" } : current.visualStyle;
    const project = store.setCreativeProfile(projectId, { ...body, visualStyle });
    emitEvent("project.updated", { projectId });
    return project;
  });

  app.post("/api/projects/:projectId/artifacts", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = artifactSchema.parse(request.body);
    assertArtifactWriteAllowed(store.getProject(projectId).stage, body.type);
    const artifact = store.addArtifact(projectId, body);
    const stage = stageForArtifact(body.type);
    if (stage) store.setStage(projectId, stage);
    emitEvent("project.updated", { projectId });
    return reply.code(201).send(artifact);
  });

  app.post("/api/projects/:projectId/reviews", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = z.object({ gate: z.enum(["director", "audience", "script_user", "asset_user", "storyboard_user", "final_user"]),
      artifactId: z.string().nullable().optional(), decision: z.enum(["approved", "rejected"]), scores: z.record(z.string(), z.number().min(1).max(5)).default({}),
      feedback: z.string().default(""), category: z.string().default("综合意见") }).parse(request.body);
    const project = store.getProject(projectId);
    assertGateAllowed(project.stage, body.gate as ReviewGate);
    if (body.decision === "rejected" && !body.feedback.trim()) {
      throw new Error("退回时必须填写具体审核意见，方便 Agent 准确修改。");
    }
    if (body.gate === "director" || body.gate === "audience" || body.gate === "script_user") {
      const currentScript = latestArtifact(projectId, "script");
      if (!currentScript) throw new Error("项目还没有可审核的剧本版本。");
      if (!body.artifactId || body.artifactId !== String(currentScript.id)) {
        throw new Error("只能审核当前最新剧本版本，旧版本的审核结果不能沿用。");
      }
    }
    if (body.gate === "audience" && !approvedReviewExists(projectId, "director", body.artifactId!)) {
      throw new Error("当前剧本版本尚未通过总导演审核，不能提交观众审核。");
    }
    if (body.gate === "final_user") {
      const currentExport = latestArtifact(projectId, "final_export");
      if (!currentExport) throw new Error("当前还没有可审核的预览片版本。");
      if (!body.artifactId || body.artifactId !== String(currentExport.id)) throw new Error("最终审核必须绑定当前最新预览片版本。");
    }
    if ((body.gate === "director" || body.gate === "audience") && body.decision === "approved" && !scoresPass(body.scores)) {
      throw new Error("内部审核评分未达标：平均分需不低于4分，且任何关键项不能低于3分。");
    }
    if (body.gate === "asset_user" && body.decision === "approved") {
      const assets = db.prepare("SELECT id,name,status,approved_job_id FROM assets WHERE project_id=?").all(projectId) as { id: string; name: string; status: string; approved_job_id: string | null }[];
      if (!assets.length) throw new Error("当前项目还没有资产，不能完成资产审核。");
      const incomplete = assets.filter((asset) => asset.status !== "approved" || !asset.approved_job_id);
      if (incomplete.length) throw new Error(`还有 ${incomplete.length} 个资产没有逐项确认：${incomplete.slice(0, 4).map((asset) => asset.name).join("、")}${incomplete.length > 4 ? "等" : ""}。`);
    }
    if (body.gate === "storyboard_user" && body.decision === "approved") {
      const shotCount = Number((db.prepare("SELECT COUNT(*) AS count FROM shots WHERE project_id=?").get(projectId) as { count: number }).count);
      if (!shotCount) throw new Error("当前完整分镜没有镜头，不能通过审核。");
    }
    const review = store.addReview({ projectId, artifactId: body.artifactId ?? null, gate: body.gate, decision: body.decision, scores: body.scores, feedback: body.feedback });
    if (body.decision === "rejected") {
      const targetType = body.gate === "asset_user" ? "asset" : body.gate === "storyboard_user" ? "storyboard" : body.gate === "final_user" ? "final" : "script";
      store.addRevision(projectId, { targetType, targetId: body.artifactId, category: body.category, feedback: body.feedback || "审核未通过，请修改后重新提交。" });
      if (body.gate === "director" || body.gate === "audience") {
        const updated = store.incrementRevision(projectId);
        if (updated.internalRevisionCount >= 3) store.addRevision(projectId, { targetType: "script", category: "内部审核三轮未通过", feedback: "已达到最多三轮自动返工，请用户裁决。" });
        store.setStage(projectId, "script_internal_review");
      } else if (body.gate === "script_user") store.setStage(projectId, "script_internal_review");
      else if (body.gate === "asset_user") store.setStage(projectId, "asset_design");
      else if (body.gate === "storyboard_user") store.setStage(projectId, "storyboard_design");
      else store.setStage(projectId, "batch_generation");
    } else if (body.gate === "director") {
      // Wait for audience approval in the same internal-review stage.
    } else if (body.gate === "audience") {
      store.setStage(projectId, "script_user_review");
    } else if (body.gate === "script_user") {
      if (body.artifactId) store.lockArtifact(body.artifactId);
      store.resolveOpenRevisions(projectId, "script");
      store.setStage(projectId, "asset_design");
    } else if (body.gate === "asset_user") {
      store.resolveOpenRevisions(projectId, "asset");
      store.setStage(projectId, "storyboard_design");
    } else if (body.gate === "storyboard_user") {
      db.prepare("UPDATE shots SET status='approved',updated_at=? WHERE project_id=?").run(new Date().toISOString(), projectId);
      store.resolveOpenRevisions(projectId, "storyboard");
      const lockedImage = db.prepare("SELECT id FROM shots WHERE project_id=? AND approved_image_media_id IS NOT NULL LIMIT 1").get(projectId);
      store.setStage(projectId, lockedImage ? "sample_video" : "sample_image");
    } else if (body.gate === "final_user") {
      if (body.artifactId) store.lockArtifact(body.artifactId);
      store.resolveOpenRevisions(projectId, "final");
      store.setStage(projectId, "completed");
    }
    emitEvent("project.updated", { projectId });
    return reply.code(201).send(review);
  });

  app.post("/api/projects/:projectId/assets", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = z.object({ id: z.string().optional(), type: z.enum(["character", "scene", "prop", "style"]), name: z.string().min(1), referenceCode: z.string().default(""),
      description: z.string().default(""), identityAnchor: z.string().default(""), prompt: z.string().default(""), negativePrompt: z.string().default("") }).parse(request.body);
    const asset = store.upsertAsset(projectId, body);
    emitEvent("project.updated", { projectId });
    return reply.code(201).send(asset);
  });

  app.post("/api/assets/:assetId/reference", async (request, reply) => {
    const { assetId } = request.params as { assetId: string };
    const asset = db.prepare("SELECT id,project_id,reference_media_id FROM assets WHERE id=?").get(assetId) as { id: string; project_id: string; reference_media_id: string | null } | undefined;
    if (!asset) throw new Error("资产不存在。");
    const file = await request.file();
    if (!file) throw new Error("请选择要锁定的参考图片。");
    const mimeToExt: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
    const ext = mimeToExt[file.mimetype];
    if (!ext) throw new Error("参考图只支持 JPG、PNG 或 WebP 格式。");
    const localPath = path.join(uploadDir, `${assetId}-${Date.now()}${ext}`);
    await fs.promises.writeFile(localPath, await file.toBuffer());
    const mediaId = id("med");
    db.prepare("INSERT INTO media_files VALUES (?,?,?,?,?,?,?,?,?)").run(mediaId, asset.project_id, null, "image", localPath, "", null, JSON.stringify({ role: "locked_asset_reference", originalName: file.filename }), now());
    db.prepare("UPDATE assets SET reference_media_id=?,status=CASE WHEN status='draft' THEN 'draft' ELSE 'stale' END,approved_job_id=NULL,updated_at=? WHERE id=?").run(mediaId, now(), assetId);
    if (asset.reference_media_id !== mediaId) invalidateShotsUsingAsset(asset.project_id, assetId);
    emitEvent("project.updated", { projectId: asset.project_id });
    return reply.code(201).send({ ok: true, mediaId });
  });

  app.post("/api/assets/:assetId/reference/select", async (request) => {
    const { assetId } = request.params as { assetId: string };
    const body = z.object({ mediaId: z.string().min(1) }).parse(request.body);
    const asset = db.prepare("SELECT id,project_id,reference_media_id FROM assets WHERE id=?").get(assetId) as { id: string; project_id: string; reference_media_id: string | null } | undefined;
    if (!asset) throw new Error("资产不存在。");
    const media = db.prepare("SELECT id,project_id,job_id,kind FROM media_files WHERE id=?").get(body.mediaId) as { id: string; project_id: string; job_id: string | null; kind: string } | undefined;
    if (!media || media.project_id !== asset.project_id || media.kind !== "image") throw new Error("所选图片不属于当前项目，或不是可用图片。");
    if (!media.job_id) throw new Error("项目图库只允许选择已经生成的图片；本地图片请使用上传入口。");
    const job = db.prepare("SELECT id,project_id,kind,status FROM generation_jobs WHERE id=?").get(media.job_id) as { id: string; project_id: string; kind: string; status: string } | undefined;
    if (!job || job.project_id !== asset.project_id || job.kind !== "image" || job.status !== "completed") throw new Error("所选图片的生成任务尚未完成，不能设为参考图。");
    db.prepare("UPDATE assets SET reference_media_id=?,status=CASE WHEN status='draft' THEN 'draft' ELSE 'stale' END,approved_job_id=NULL,updated_at=? WHERE id=?").run(media.id, now(), assetId);
    if (asset.reference_media_id !== media.id) invalidateShotsUsingAsset(asset.project_id, assetId);
    emitEvent("project.updated", { projectId: asset.project_id });
    return { ok: true, mediaId: media.id };
  });

  app.post("/api/assets/:assetId/lock-image", async (request) => {
    const { assetId } = request.params as { assetId: string };
    const body = z.object({ jobId: z.string().min(1), mediaId: z.string().min(1) }).parse(request.body);
    const asset = db.prepare("SELECT id,project_id,reference_media_id FROM assets WHERE id=?").get(assetId) as { id: string; project_id: string; reference_media_id: string | null } | undefined;
    if (!asset) throw new Error("资产不存在。");
    const stage = store.getProject(asset.project_id).stage;
    if (!["asset_design", "asset_user_review"].includes(stage)) throw new Error("当前阶段不能锁定资产主图。");
    const job = db.prepare("SELECT id,project_id,asset_id,kind,status FROM generation_jobs WHERE id=?").get(body.jobId) as { id: string; project_id: string; asset_id: string | null; kind: string; status: string } | undefined;
    if (!job || job.project_id !== asset.project_id || job.asset_id !== assetId || job.kind !== "image") throw new Error("所选生图任务不属于当前资产。");
    if (job.status !== "completed") throw new Error("这张图片尚未生成完成，不能锁定。");
    const media = db.prepare("SELECT id FROM media_files WHERE id=? AND project_id=? AND job_id=? AND kind='image'").get(body.mediaId, asset.project_id, job.id) as { id: string } | undefined;
    if (!media) throw new Error("所选图片不存在，或不属于这次生图任务。");
    db.prepare("UPDATE assets SET status='approved',approved_job_id=?,reference_media_id=?,updated_at=? WHERE id=?").run(job.id, media.id, now(), assetId);
    if (asset.reference_media_id !== media.id) invalidateShotsUsingAsset(asset.project_id, assetId);
    store.resolveOpenRevisions(asset.project_id, "asset", assetId);
    emitEvent("project.updated", { projectId: asset.project_id });
    return { ok: true, jobId: job.id, mediaId: media.id };
  });

  app.post("/api/assets/:assetId/review", async (request) => {
    const { assetId } = request.params as { assetId: string };
    const body = z.object({ decision: z.enum(["approved", "rejected"]), feedback: z.string().default("") }).parse(request.body);
    const asset = db.prepare("SELECT id,project_id,name,reference_media_id FROM assets WHERE id=?").get(assetId) as { id: string; project_id: string; name: string; reference_media_id: string | null } | undefined;
    if (!asset) throw new Error("资产不存在。");
    const stage = store.getProject(asset.project_id).stage;
    if (!["asset_design", "asset_user_review"].includes(stage)) throw new Error("当前阶段不能审核资产。");
    const latestJob = db.prepare("SELECT id,status FROM generation_jobs WHERE asset_id=? AND kind='image' ORDER BY created_at DESC LIMIT 1").get(assetId) as { id: string; status: string } | undefined;
    if (body.decision === "approved") {
      const pendingCodex = db.prepare("SELECT id FROM codex_image_requests WHERE asset_id=? AND status IN ('queued','processing') LIMIT 1").get(assetId);
      if (pendingCodex) throw new Error("该资产还有 Codex 生图任务未完成，不能确认锁定旧结果。");
      if (!latestJob || latestJob.status !== "completed") throw new Error("该资产最新生图尚未完成，不能确认锁定。");
      const approvedMedia = db.prepare("SELECT id FROM media_files WHERE job_id=? AND kind='image' ORDER BY created_at ASC LIMIT 1").get(latestJob.id) as { id: string } | undefined;
      if (!approvedMedia) throw new Error("该生图任务没有可用的本地图片，请刷新任务状态后重试。");
      db.prepare("UPDATE assets SET status='approved',approved_job_id=?,reference_media_id=?,updated_at=? WHERE id=?").run(latestJob.id, approvedMedia.id, now(), assetId);
      if (asset.reference_media_id !== approvedMedia.id) invalidateShotsUsingAsset(asset.project_id, assetId);
      store.resolveOpenRevisions(asset.project_id, "asset", assetId);
    } else {
      if (!body.feedback.trim()) throw new Error("退回资产时必须填写具体修改意见。");
      db.prepare("UPDATE assets SET status='stale',approved_job_id=NULL,updated_at=? WHERE id=?").run(now(), assetId);
      store.addRevision(asset.project_id, { targetType: "asset", targetId: assetId, category: `${asset.name}资产退回`, feedback: body.feedback.trim() });
    }
    emitEvent("project.updated", { projectId: asset.project_id });
    return { ok: true };
  });

  app.post("/api/assets/:assetId/codex-image-requests", async (request, reply) => {
    const { assetId } = request.params as { assetId: string };
    const body = z.object({ prompt: z.string().min(1), aspectRatio: z.string(), quality: z.enum(["standard", "high"]).default("high"), resolution: z.string().default("1k"), count: z.number().int().min(1).max(4).default(1) }).parse(request.body);
    const asset = db.prepare("SELECT id,project_id,type,negative_prompt,reference_media_id FROM assets WHERE id=?").get(assetId) as { id: string; project_id: string; type: string; negative_prompt: string; reference_media_id: string | null } | undefined;
    if (!asset) throw new Error("资产不存在。");
    assertVisualStyleLocked(store.getProject(asset.project_id));
    assertNoActiveImageGeneration({ projectId: asset.project_id, assetId });
    const stage = store.getProject(asset.project_id).stage;
    if (!["asset_design", "asset_user_review"].includes(stage)) throw new Error("当前阶段不能创建 Codex 生图任务。");
    const allowedSizes = ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"];
    if (!allowedSizes.includes(body.aspectRatio)) throw new Error("请选择工作台支持的图片画幅比例。");
    const cleanedPrompt = cleanImagePrompt(body.prompt);
    if (asset.type === "character") {
      if (body.resolution !== "1k" || body.quality !== "high" || body.count !== 1) {
        throw new Error("角色设定图固定使用 1K、高质量、单张生成，先锁定标准参考拼版再进入分镜。");
      }
      const issues = characterAssetPromptIssues(cleanedPrompt, body.aspectRatio);
      if (issues.length) throw new Error(`角色设定图提示词未通过规范检查：${issues.join("；")}。`);
    }
    const referencePaths = asset.reference_media_id
      ? (db.prepare("SELECT local_path FROM media_files WHERE id=?").get(asset.reference_media_id) as { local_path: string } | undefined)?.local_path
      : undefined;
    const value = store.addCodexImageRequest({ projectId: asset.project_id, assetId, shotId: null, prompt: cleanedPrompt,
      negativePrompt: asset.negative_prompt.split("\nAPIMart参数：")[0], aspectRatio: body.aspectRatio, quality: body.quality, resolution: body.resolution, count: body.count,
      referencePaths: referencePaths ? [referencePaths] : [] });
    db.prepare("UPDATE assets SET status=CASE WHEN status='draft' THEN 'draft' ELSE 'stale' END,approved_job_id=NULL,updated_at=? WHERE id=?").run(now(), assetId);
    emitEvent("project.updated", { projectId: asset.project_id });
    return reply.code(201).send(value);
  });

  app.post("/api/projects/:projectId/shots", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    assertShotWriteAllowed(store.getProject(projectId).stage);
    const body = z.object({ id: z.string().optional(), shotNumber: z.number().int().positive(), title: z.string().min(1), duration: z.number().min(4).max(15).default(5),
      narrativePurpose: z.string().default(""), composition: z.string().default(""), camera: z.string().default(""), action: z.string().default(""), dialogue: z.string().default(""),
      imagePrompt: z.string().default(""), videoPrompt: z.string().default(""), assetIds: z.array(z.string()).default([]),
      sceneId: z.string().default("scene-01"), parentShotId: z.string().nullable().default(null),
      sequenceRelation: z.enum(["sequence_first_clip", "intentional_next_shot", "seamless_continuation", "reanchor_after_drift"]).default("intentional_next_shot"),
      feltIntent: z.string().default(""), plannedStartState: z.string().default(""), plannedEndState: z.string().default(""),
      alreadyHappened: z.string().default(""), reservedForLater: z.string().default(""), continuityLocks: z.string().default(""),
      allowedChanges: z.string().default(""), audioMode: z.enum(["generated", "voice_reference", "dialogue_lipsync", "music_sync", "silent"]).default("generated"),
      audioAssetIds: z.array(z.string()).max(3).default([]), videoReferenceMediaIds: z.array(z.string()).max(3).default([]), speakerMap: z.string().default(""), audioDirection: z.string().default(""),
      lipSyncNotes: z.string().default(""), observedEndState: z.string().default("") }).parse(request.body);
    const shot = store.upsertShot(projectId, body);
    emitEvent("project.updated", { projectId });
    return reply.code(201).send(shot);
  });

  app.post("/api/projects/:projectId/audio-assets", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    store.getProject(projectId);
    const fields: Record<string, string> = {};
    let audioFile: { filename: string; mimetype: string; buffer: Buffer } | null = null;
    for await (const part of request.parts()) {
      if (part.type === "file") audioFile = { filename: part.filename, mimetype: part.mimetype, buffer: await part.toBuffer() };
      else fields[part.fieldname] = String(part.value ?? "");
    }
    const body = z.object({ type: z.enum(["character_voice", "dialogue_line", "scene_master", "music", "ambience", "sfx"]), name: z.string().min(1),
      characterAssetId: z.string().default(""), remoteUrl: z.string().default(""), duration: z.coerce.number().min(0).max(900).default(0),
      rightsNote: z.string().min(1), description: z.string().default("") }).parse(fields);
    if (!audioFile && !body.remoteUrl) throw new Error("请上传本地试听文件，或填写可供 APIMart 访问的音频 URL。");
    if (body.remoteUrl && !/^https:\/\//i.test(body.remoteUrl)) throw new Error("远程音频地址必须是 HTTPS URL。");
    let localPath = "";
    if (audioFile) {
      const extByMime: Record<string, string> = { "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/mp4": ".m4a", "audio/aac": ".aac" };
      const ext = extByMime[audioFile.mimetype] ?? path.extname(audioFile.filename).toLowerCase();
      if (![".mp3", ".wav", ".m4a", ".aac"].includes(ext)) throw new Error("音频只支持 MP3、WAV、M4A 或 AAC。");
      localPath = path.join(uploadDir, `audio-${Date.now()}-${id("aud")}${ext}`);
      await fs.promises.writeFile(localPath, audioFile.buffer);
    }
    const stamp = now();
    const audioId = id("aud");
    db.prepare("INSERT INTO audio_assets VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(audioId, projectId, body.type, body.name, body.characterAssetId || null,
      localPath, body.remoteUrl, body.duration, body.rightsNote, body.description, stamp, stamp);
    emitEvent("project.updated", { projectId });
    return reply.code(201).send({ id: audioId, localPath, remoteUrl: body.remoteUrl });
  });

  app.put("/api/audio-assets/:audioId", async (request) => {
    const { audioId } = request.params as { audioId: string };
    const body = z.object({ remoteUrl: z.string().default(""), rightsNote: z.string().min(1), description: z.string().default("") }).parse(request.body);
    if (body.remoteUrl && !/^https:\/\//i.test(body.remoteUrl)) throw new Error("远程音频地址必须是 HTTPS URL。");
    const asset = db.prepare("SELECT project_id FROM audio_assets WHERE id=?").get(audioId) as { project_id: string } | undefined;
    if (!asset) throw new Error("声音资产不存在。");
    db.prepare("UPDATE audio_assets SET remote_url=?,rights_note=?,description=?,updated_at=? WHERE id=?").run(body.remoteUrl, body.rightsNote, body.description, now(), audioId);
    emitEvent("project.updated", { projectId: asset.project_id });
    return { ok: true };
  });

  app.delete("/api/audio-assets/:audioId", async (request) => {
    const { audioId } = request.params as { audioId: string };
    const result = store.deleteAudioAsset(audioId);
    emitEvent("project.updated", { projectId: result.projectId });
    return { ok: true, ...result };
  });

  app.post("/api/projects/:projectId/audio-assets/generate", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = store.getProject(projectId);
    if (project.dryRun) throw new Error("空跑测试项目不会调用真实音频API；请只保存和检查音频提示词。");
    if (!store.getSetting("volcengine_audio_api_key")) throw new Error("尚未配置火山豆包音频 API Key，请先前往 API 设置。");
    const body = z.object({
      audioAssetId: z.string().optional(),
      type: z.enum(["character_voice", "dialogue_line", "scene_master", "music", "ambience", "sfx"]).default("dialogue_line"),
      name: z.string().min(1),
      characterAssetId: z.string().default(""),
      textPrompt: z.string().min(1).max(3000),
      styleProfile: z.enum(["hk90", "modern_realistic", "documentary", "animation", "custom", "needs_review", "auto"]).default("auto"),
      speaker: z.string().default(""),
      referenceAudioUrls: z.array(z.string().url().refine((value) => /^https:\/\//i.test(value), "参考音频必须是 HTTPS URL")).max(3).default([]),
      format: z.enum(["wav", "mp3", "pcm", "ogg_opus"]).default("wav"),
      sampleRate: z.number().int().refine((value) => [8000, 16000, 24000, 32000, 44100, 48000].includes(value), "采样率不受支持").default(24000),
      enableSubtitle: z.boolean().default(true),
      speechRate: z.number().int().min(-50).max(100).default(0),
      pitchRate: z.number().int().min(-12).max(12).default(0),
      loudnessRate: z.number().int().min(-50).max(100).default(0),
      propagateId: z.string().default(""), contentProducer: z.string().default("猫掌柜AI漫剧工作台"), contentPropagator: z.string().default("猫掌柜工作室"),
      aigcWatermark: z.boolean().default(true), enableWatermark: z.boolean().default(true),
      rightsNote: z.string().min(1),
      description: z.string().default("")
    }).parse(request.body);
    const effectiveStyle = body.styleProfile === "auto" ? inferAudioStyleProfile(body.textPrompt) : body.styleProfile;
    if (body.type === "scene_master" || body.type === "dialogue_line") {
      const promptErrors = validateAudioPrompt(body.textPrompt, effectiveStyle);
      if (promptErrors.length) throw new Error(`音频提示词未通过检查：${promptErrors.join("；")}`);
    }
    let audioAssetId = body.audioAssetId ?? "";
    if (audioAssetId) {
      const existing = db.prepare("SELECT id FROM audio_assets WHERE id=? AND project_id=?").get(audioAssetId, projectId);
      if (!existing) throw new Error("指定的声音资产不属于当前项目。");
      db.prepare("UPDATE audio_assets SET name=?,type=?,character_asset_id=?,rights_note=?,description=?,updated_at=? WHERE id=?").run(body.name, body.type, body.characterAssetId || null, body.rightsNote, body.description, now(), audioAssetId);
    } else {
      audioAssetId = id("aud");
      const stamp = now();
      db.prepare("INSERT INTO audio_assets VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(audioAssetId, projectId, body.type, body.name, body.characterAssetId || null, "", "", 0, body.rightsNote, body.description, stamp, stamp);
    }
    const job = store.addJob({ projectId, shotId: null, assetId: null, kind: "audio", provider: "volcengine", model: "seed-audio-1.0", prompt: body.textPrompt,
      params: { audioAssetId, styleProfile: effectiveStyle, speaker: body.speaker || undefined, referenceAudioUrls: body.referenceAudioUrls, format: body.format, sampleRate: body.sampleRate, enableSubtitle: body.enableSubtitle, speechRate: body.speechRate, pitchRate: body.pitchRate, loudnessRate: body.loudnessRate, propagateId: body.propagateId || undefined, contentProducer: body.contentProducer, contentPropagator: body.contentPropagator, aigcWatermark: body.aigcWatermark, enableWatermark: body.enableWatermark } });
    emitEvent("job.updated", { projectId, jobId: job.id });
    return reply.code(202).send({ audioAssetId, job });
  });

  app.get("/api/audio-assets/:audioId/file", async (request, reply) => {
    const { audioId } = request.params as { audioId: string };
    const asset = db.prepare("SELECT local_path FROM audio_assets WHERE id=?").get(audioId) as { local_path: string } | undefined;
    if (!asset?.local_path || !fs.existsSync(asset.local_path)) return reply.code(404).send({ error: "该声音资产没有本地试听文件。" });
    const ext = path.extname(asset.local_path).toLowerCase();
    const mime = ext === ".mp3" ? "audio/mpeg" : ext === ".wav" ? "audio/wav" : ext === ".aac" ? "audio/aac" : ext === ".ogg" ? "audio/ogg" : ext === ".pcm" ? "audio/L16" : "audio/mp4";
    return reply.type(mime).send(fs.createReadStream(asset.local_path));
  });

  app.post("/api/projects/:projectId/audio-assets/:audioAssetId/split", async (request, reply) => {
    const { projectId, audioAssetId } = request.params as { projectId: string; audioAssetId: string };
    store.getProject(projectId);
    const source = db.prepare("SELECT id,name,local_path,duration FROM audio_assets WHERE id=? AND project_id=?").get(audioAssetId, projectId) as
      { id: string; name: string; local_path: string; duration: number } | undefined;
    if (!source) throw new Error("场景母带不存在或不属于当前项目。");
    if (!source.local_path || !fs.existsSync(source.local_path)) throw new Error("场景母带还没有本地文件，生成完成后才能切片。");
    const existingClips = db.prepare("SELECT COUNT(*) AS count FROM audio_clips WHERE project_id=? AND source_audio_asset_id=?").get(projectId, audioAssetId) as { count: number };
    if (Number(existingClips.count) > 0) throw new Error("该场景母带已经自动切片，请直接试听并调整现有片段，避免重复创建。");
    const body = z.object({ segments: z.array(z.object({ shotId: z.string().nullable().default(null), speaker: z.string().default(""), text: z.string().default(""), startMs: z.number().int().min(0), endMs: z.number().int().positive(), handleMs: z.number().int().min(0).max(1000).default(150) })).min(1).max(200) }).parse(request.body);
    const validated = body.segments.map((segment) => {
      if (segment.endMs <= segment.startMs) throw new Error("音频切片的结束时间必须大于开始时间。");
      const shot = segment.shotId
        ? db.prepare("SELECT id,shot_number,title FROM shots WHERE id=? AND project_id=?").get(segment.shotId, projectId) as { id: string; shot_number: number; title: string } | undefined
        : undefined;
      if (segment.shotId && !shot) throw new Error("切片绑定的镜头不存在或不属于当前项目。");
      return { segment, shot };
    });
    const pending: Array<{
      segment: (typeof body.segments)[number];
      shot: { id: string; shot_number: number; title: string } | undefined;
      cut: Awaited<ReturnType<typeof cutAudioClip>>;
      childId: string;
      clipId: string;
      name: string;
      stamp: string;
    }> = [];
    let transactionStarted = false;
    try {
      for (const { segment, shot } of validated) {
        const cut = await cutAudioClip(source.local_path, segment.startMs, segment.endMs, segment.handleMs);
        pending.push({
          segment,
          shot,
          cut,
          childId: id("aud"),
          clipId: id("aclip"),
          name: `${source.name} · ${shot ? `镜头${shot.shot_number}` : "片段"}${segment.speaker ? ` · ${segment.speaker}` : ""}`,
          stamp: now()
        });
      }
      db.exec("BEGIN");
      transactionStarted = true;
      for (const item of pending) {
        db.prepare(`INSERT INTO audio_assets
          (id,project_id,type,name,character_asset_id,local_path,remote_url,duration,rights_note,description,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          item.childId, projectId, "dialogue_line", item.name, null, item.cut.localPath, "", item.cut.duration,
          "继承场景母带权利说明，请确认",
          `场景母带「${source.name}」${item.segment.startMs}ms-${item.segment.endMs}ms；镜头级口型参考。`,
          item.stamp, item.stamp
        );
        db.prepare(`INSERT INTO audio_clips
          (id,project_id,source_audio_asset_id,audio_asset_id,shot_id,speaker,text,start_ms,end_ms,handle_ms,status,notes,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          item.clipId, projectId, audioAssetId, item.childId, item.segment.shotId, item.segment.speaker, item.segment.text,
          item.segment.startMs, item.segment.endMs, item.segment.handleMs, "draft", "待人工试听确认后绑定镜头",
          item.stamp, item.stamp
        );
      }
      db.exec("COMMIT");
      transactionStarted = false;
    } catch (error) {
      if (transactionStarted) {
        try { db.exec("ROLLBACK"); } catch { /* retain the original failure */ }
      }
      for (const item of pending) {
        try { fs.rmSync(item.cut.localPath, { force: true }); } catch { /* best-effort rollback of generated clips */ }
      }
      throw error;
    }
    const created = pending.map((item) => ({
      id: item.clipId,
      audioAssetId: item.childId,
      localPath: item.cut.localPath,
      duration: item.cut.duration,
      shotId: item.segment.shotId,
      startMs: item.segment.startMs,
      endMs: item.segment.endMs
    }));
    emitEvent("project.updated", { projectId });
    return reply.code(201).send({ clips: created });
  });

  app.put("/api/audio-clips/:clipId", async (request) => {
    const { clipId } = request.params as { clipId: string };
    const current = db.prepare("SELECT * FROM audio_clips WHERE id=?").get(clipId) as Record<string, unknown> | undefined;
    if (!current) throw new Error("音频切片不存在。");
    const body = z.object({ shotId: z.string().nullable().optional(), speaker: z.string().optional(), text: z.string().optional(), startMs: z.number().int().min(0).optional(), endMs: z.number().int().positive().optional(), handleMs: z.number().int().min(0).max(1000).optional(), notes: z.string().optional() }).parse(request.body);
    const startMs = body.startMs ?? Number(current.start_ms);
    const endMs = body.endMs ?? Number(current.end_ms);
    const handleMs = body.handleMs ?? Number(current.handle_ms);
    if (endMs <= startMs) throw new Error("音频切片的结束时间必须大于开始时间。");
    const source = db.prepare("SELECT local_path FROM audio_assets WHERE id=? AND project_id=?").get(String(current.source_audio_asset_id), String(current.project_id)) as { local_path: string } | undefined;
    const child = db.prepare("SELECT local_path FROM audio_assets WHERE id=? AND project_id=?").get(String(current.audio_asset_id), String(current.project_id)) as { local_path: string } | undefined;
    if (!source?.local_path) throw new Error("源场景母带不存在。");
    if ((body.startMs !== undefined || body.endMs !== undefined || body.handleMs !== undefined) && child) {
      const cut = await cutAudioClip(source.local_path, startMs, endMs, handleMs);
      if (child.local_path && child.local_path !== cut.localPath) fs.rmSync(child.local_path, { force: true });
      db.prepare("UPDATE audio_assets SET local_path=?,duration=?,updated_at=? WHERE id=?").run(cut.localPath, cut.duration, now(), String(current.audio_asset_id));
    }
    db.prepare("UPDATE audio_clips SET shot_id=?,speaker=?,text=?,start_ms=?,end_ms=?,handle_ms=?,notes=?,updated_at=? WHERE id=?").run(
      body.shotId !== undefined ? body.shotId : (current.shot_id ? String(current.shot_id) : null), body.speaker ?? String(current.speaker ?? ""), body.text ?? String(current.text ?? ""), startMs, endMs, handleMs, body.notes ?? String(current.notes ?? ""), now(), clipId);
    const projectId = String(current.project_id);
    emitEvent("project.updated", { projectId });
    return { ok: true };
  });

  app.post("/api/audio-clips/:clipId/approve", async (request) => {
    const { clipId } = request.params as { clipId: string };
    const body = z.object({ shotId: z.string().nullable().optional() }).parse(request.body ?? {});
    const clip = db.prepare("SELECT * FROM audio_clips WHERE id=?").get(clipId) as Record<string, unknown> | undefined;
    if (!clip) throw new Error("音频切片不存在。");
    const projectId = String(clip.project_id);
    const shotId = body.shotId !== undefined ? body.shotId : (clip.shot_id ? String(clip.shot_id) : null);
    if (shotId) {
      const shot = db.prepare("SELECT id,audio_asset_ids_json FROM shots WHERE id=? AND project_id=?").get(shotId, projectId) as { id: string; audio_asset_ids_json: string } | undefined;
      if (!shot) throw new Error("指定镜头不存在或不属于当前项目。");
      const currentIds = JSON.parse(shot.audio_asset_ids_json || "[]") as string[];
      const nextIds = currentIds.includes(String(clip.audio_asset_id)) ? currentIds : [...currentIds, String(clip.audio_asset_id)];
      db.prepare("UPDATE shots SET audio_asset_ids_json=?,audio_mode='dialogue_lipsync',updated_at=? WHERE id=?").run(JSON.stringify(nextIds), now(), shot.id);
    }
    db.prepare("UPDATE audio_clips SET shot_id=?,status='approved',notes=?,updated_at=? WHERE id=?").run(shotId, "已试听确认并绑定镜头", now(), clipId);
    emitEvent("project.updated", { projectId });
    return { ok: true, shotId, audioAssetId: String(clip.audio_asset_id) };
  });

  app.post("/api/shots/:shotId/codex-image-requests", async (request, reply) => {
    const { shotId } = request.params as { shotId: string };
    const body = z.object({ prompt: z.string().min(1), aspectRatio: z.string(), quality: z.enum(["standard", "high"]).default("high"), resolution: z.string().default("1k"), count: z.number().int().min(1).max(4).default(1) }).parse(request.body);
    const shot = db.prepare("SELECT id,project_id,asset_ids_json FROM shots WHERE id=?").get(shotId) as { id: string; project_id: string; asset_ids_json: string } | undefined;
    if (!shot) throw new Error("分镜不存在。");
    assertVisualStyleLocked(store.getProject(shot.project_id));
    assertNoActiveImageGeneration({ projectId: shot.project_id, shotId });
    const stage = store.getProject(shot.project_id).stage;
    if (!["storyboard_design", "storyboard_user_review", "sample_image", "batch_generation"].includes(stage)) throw new Error("当前阶段不能创建分镜 Codex 生图任务。");
    const allowedSizes = ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"];
    if (!allowedSizes.includes(body.aspectRatio)) throw new Error("请选择工作台支持的图片画幅比例。");
    const assetIds = JSON.parse(shot.asset_ids_json) as string[];
    const referencePaths = assetIds.length ? (db.prepare(`
      SELECT m.local_path FROM assets a JOIN media_files m ON m.id=a.reference_media_id
      WHERE a.id IN (${assetIds.map(() => "?").join(",")}) ORDER BY a.type,a.name
    `).all(...assetIds) as { local_path: string }[]).map((item) => item.local_path) : [];
    const negativePrompts = assetIds.length ? (db.prepare(`
      SELECT negative_prompt FROM assets WHERE id IN (${assetIds.map(() => "?").join(",")}) ORDER BY type,name
    `).all(...assetIds) as { negative_prompt: string }[]).map((item) => item.negative_prompt.split("\nAPIMart参数：")[0]).filter(Boolean) : [];
    const value = store.addCodexImageRequest({ projectId: shot.project_id, assetId: null, shotId, prompt: cleanImagePrompt(body.prompt),
      negativePrompt: [...new Set(negativePrompts)].join("；"), aspectRatio: body.aspectRatio, quality: body.quality, resolution: body.resolution, count: body.count,
      referencePaths: [...new Set(referencePaths)] });
    emitEvent("project.updated", { projectId: shot.project_id });
    return reply.code(201).send(value);
  });

  app.post("/api/codex-image-requests/:requestId/cancel", async (request) => {
    const { requestId } = request.params as { requestId: string };
    const current = store.getCodexImageRequest(requestId);
    if (!['queued', 'processing'].includes(current.status)) throw new Error("该 Codex 生图任务已经结束，不能重复取消。");
    const value = store.updateCodexImageRequest(requestId, {
      status: "cancelled",
      error: current.status === "processing"
        ? "用户已取消：如果模型已经开始渲染，生成过程可能仍会结束，但结果不会再导入工作台。"
        : "用户已取消，任务未被 Codex 领取。"
    });
    emitEvent("project.updated", { projectId: current.projectId });
    return value;
  });

  app.post("/api/shots/:shotId/lock-image", async (request) => {
    const { shotId } = request.params as { shotId: string };
    const body = z.object({ jobId: z.string().min(1), mediaId: z.string().min(1) }).parse(request.body);
    const shot = db.prepare("SELECT id,project_id FROM shots WHERE id=?").get(shotId) as { id: string; project_id: string } | undefined;
    if (!shot) throw new Error("分镜不存在。");
    const job = db.prepare("SELECT id,status,kind,shot_id FROM generation_jobs WHERE id=?").get(body.jobId) as { id: string; status: string; kind: string; shot_id: string | null } | undefined;
    if (!job || job.kind !== "image" || job.shot_id !== shotId) throw new Error("请选择该镜头自己的首帧生成结果。");
    if (job.status !== "completed") throw new Error("首帧尚未生成完成，不能锁定。");
    const media = db.prepare("SELECT id FROM media_files WHERE id=? AND job_id=? AND kind='image'").get(body.mediaId, job.id) as { id: string } | undefined;
    if (!media) throw new Error("所选首帧本地文件不存在，请刷新后重试。");
    db.prepare("UPDATE shots SET approved_image_job_id=?,approved_image_media_id=?,status=CASE WHEN status='stale' THEN 'draft' ELSE status END,updated_at=? WHERE id=?").run(job.id, media.id, now(), shotId);
    store.resolveOpenRevisions(shot.project_id, "image", shotId);
    if (store.getProject(shot.project_id).stage === "sample_image") store.setStage(shot.project_id, "sample_video");
    emitEvent("project.updated", { projectId: shot.project_id });
    return { ok: true, jobId: job.id, mediaId: media.id };
  });

  app.post("/api/shots/:shotId/video-review", async (request) => {
    const { shotId } = request.params as { shotId: string };
    const body = z.object({ jobId: z.string().min(1), decision: z.enum(["approved", "rejected"]), feedback: z.string().default(""), observedEndState: z.string().default(""), observedAudioState: z.string().default("") }).parse(request.body);
    const shot = db.prepare("SELECT id,project_id,planned_end_state,audio_mode,audio_direction FROM shots WHERE id=?").get(shotId) as { id: string; project_id: string; planned_end_state: string; audio_mode: string; audio_direction: string } | undefined;
    if (!shot) throw new Error("分镜不存在。");
    const job = db.prepare("SELECT id,status,kind,shot_id FROM generation_jobs WHERE id=?").get(body.jobId) as { id: string; status: string; kind: string; shot_id: string | null } | undefined;
    if (!job || job.kind !== "video" || job.shot_id !== shotId) throw new Error("请选择该镜头自己的视频版本。");
    if (job.status !== "completed") throw new Error("视频尚未生成完成，不能审核。");
    if (body.decision === "rejected") {
      if (!body.feedback.trim()) throw new Error("退回视频时必须填写具体原因。");
      store.addRevision(shot.project_id, { targetType: "video", targetId: shotId, category: "镜头视频退回", feedback: body.feedback.trim() });
      db.prepare("UPDATE shots SET approved_video_job_id=NULL,updated_at=? WHERE id=?").run(now(), shotId);
    } else {
      const mediaRows = db.prepare("SELECT id,kind,local_path,metadata_json FROM media_files WHERE job_id=? ORDER BY created_at").all(job.id) as { id: string; kind: string; local_path: string; metadata_json: string }[];
      let lastFrame = mediaRows.find((item) => { try { return JSON.parse(item.metadata_json || "{}").role === "last_frame"; } catch { return false; } });
      if (!lastFrame) {
        const video = mediaRows.find((item) => item.kind === "video" && fs.existsSync(item.local_path));
        if (video) {
          fs.mkdirSync(mediaDir, { recursive: true });
          const framePath = path.join(mediaDir, `${job.id}-accepted-last-frame.png`);
          execFileSync("ffmpeg", ["-y", "-sseof", "-0.04", "-i", video.local_path, "-frames:v", "1", framePath], { windowsHide: true, stdio: "ignore" });
          const frameId = id("med");
          db.prepare("INSERT INTO media_files VALUES (?,?,?,?,?,?,?,?,?)").run(frameId, shot.project_id, job.id, "image", framePath, "", null, asJson({ role: "last_frame", source: "ffmpeg_fallback" }), now());
          lastFrame = { id: frameId, kind: "image", local_path: framePath, metadata_json: asJson({ role: "last_frame" }) };
        }
      }
      if (!lastFrame) throw new Error("视频已完成，但无法取得尾帧。请检查本机 FFmpeg 后重试通过操作。");
      const observedEndState = body.observedEndState.trim() || shot.planned_end_state;
      if (!observedEndState) throw new Error("请填写该视频真实结束时的可见状态，连续镜头需要据此承接。");
      const observedAudioState = body.observedAudioState.trim() || (shot.audio_mode === "silent" ? "无声视频，声音留待后期" : shot.audio_direction || "用户确认本镜头声音与口型可用");
      db.prepare("UPDATE shots SET approved_video_job_id=?,observed_end_state=?,observed_audio_state=?,last_frame_media_id=?,sample_approved=1,updated_at=? WHERE id=?").run(job.id, observedEndState, observedAudioState, lastFrame.id, now(), shotId);
      store.resolveOpenRevisions(shot.project_id, "video", shotId);
      if (store.getProject(shot.project_id).stage === "sample_video") store.setStage(shot.project_id, "batch_generation");
    }
    emitEvent("project.updated", { projectId: shot.project_id });
    return { ok: true };
  });

  app.post("/api/projects/:projectId/sample-approval", async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = z.object({ shotId: z.string(), kind: z.enum(["image", "video"]), approved: z.boolean(), feedback: z.string().default("") }).parse(request.body);
    const stage = store.getProject(projectId).stage;
    if (body.kind === "image" && stage !== "sample_image") throw new Error("当前不是样片生图审核阶段。");
    if (body.kind === "video" && stage !== "sample_video") throw new Error("当前不是样片视频审核阶段。");
    if (!body.approved) {
      store.addRevision(projectId, { targetType: body.kind, targetId: body.shotId, category: "样片未通过", feedback: body.feedback || "请修改提示词后重新生成。" });
    } else if (body.kind === "image") {
      store.resolveOpenRevisions(projectId, "image");
      store.setStage(projectId, "sample_video");
    }
    else {
      db.prepare("UPDATE shots SET sample_approved=1,updated_at=? WHERE id=?").run(new Date().toISOString(), body.shotId);
      store.resolveOpenRevisions(projectId, "video");
      store.setStage(projectId, "batch_generation");
    }
    emitEvent("project.updated", { projectId });
    return { ok: true };
  });

  app.post("/api/projects/:projectId/jobs", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = z.object({ shotId: z.string().nullable().optional(), assetId: z.string().nullable().optional(), kind: z.enum(["image", "video"]),
      provider: z.enum(["apimart", "mock"]), model: z.string().min(1), prompt: z.string().min(1), params: z.record(z.string(), z.unknown()).default({}), batch: z.boolean().default(false) }).parse(request.body);
    const project = store.getProject(projectId);
    if (body.provider !== "mock" || project.dryRun) assertVisualStyleLocked(project);
    const allowedStages: WorkflowStage[] = body.kind === "image" ? ["asset_design", "asset_user_review", "storyboard_design", "storyboard_user_review", "sample_image", "batch_generation"] : ["sample_video", "batch_generation"];
    if (!allowedStages.includes(project.stage)) throw new Error(`当前阶段“${project.stage}”不允许提交${body.kind === "image" ? "图片" : "视频"}任务。`);
    if (body.provider === "mock" && !project.dryRun && (body.assetId || body.shotId)) throw new Error("只有明确标记为空跑测试的项目才能绑定Mock结果；正式项目请使用Codex或APIMart真实生成。");
    if (project.dryRun && body.provider !== "mock") throw new Error("空跑测试项目只允许使用Mock，不得提交Codex或APIMart真实生成。");
    if (body.kind === "image" && body.assetId && body.shotId) throw new Error("图片任务不能同时绑定资产和分镜。");
    let imageAsset: { id: string; type: string } | undefined;
    if (body.kind === "image" && body.assetId) {
      imageAsset = db.prepare("SELECT id,type FROM assets WHERE id=? AND project_id=?").get(body.assetId, projectId) as { id: string; type: string } | undefined;
      if (!imageAsset) throw new Error("资产不存在或不属于当前项目。");
    }
    if (body.kind === "image" && body.shotId) {
      const imageShot = db.prepare("SELECT id FROM shots WHERE id=? AND project_id=?").get(body.shotId, projectId);
      if (!imageShot) throw new Error("分镜不存在或不属于当前项目。");
    }
    if (body.kind === "image" && (body.assetId || body.shotId)) {
      assertNoActiveImageGeneration({ projectId, shotId: body.shotId, assetId: body.assetId });
      if (body.provider === "apimart" && !store.getSetting("apimart_api_key")) throw new Error("尚未配置APIMart API Key，请先前往API设置。");
      if (!imageModelOptions.some((option) => option.id === body.model)) throw new Error("所选生图模型不受支持。");
      const allowedSizes = ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"];
      if (!allowedSizes.includes(String(body.params.size))) throw new Error("请选择工作台支持的图片画幅比例。");
      const option = imageModelOption(body.model);
      const resolution = String(body.params.resolution ?? (body.model === "midjourney" ? body.params.speed : "" )).toLowerCase();
      const count = body.model === "midjourney" ? 4 : Number(body.params.n ?? 1);
      if (!option.resolutions.some((value) => value === resolution)) throw new Error("所选模型不支持当前生图质量。");
      if (!option.counts.some((value) => value === count)) throw new Error("所选模型不支持当前生成数量。");
      body.prompt = cleanImagePrompt(body.prompt);
      body.params = imageModelParams(body.model, resolution, String(body.params.size), count);
      if (!body.prompt) throw new Error("清理工作台管理信息后，生图提示词不能为空。");
      if (imageAsset?.type === "character") {
        if (body.model !== "gpt-image-2-official" || resolution !== "1k" || count !== 1) {
          throw new Error("角色设定图固定使用 gpt-image-2-official、1K、高质量、单张生成。");
        }
        const issues = characterAssetPromptIssues(body.prompt, String(body.params.size));
        if (issues.length) throw new Error(`角色设定图提示词未通过规范检查：${issues.join("；")}。`);
      }
    }
    if (body.batch && !db.prepare("SELECT id FROM shots WHERE project_id=? AND sample_approved=1 LIMIT 1").get(projectId)) throw new Error("代表性镜头样片尚未通过，不能批量生成。");
    if (body.kind === "video") {
      const modelOption = videoModelOption(body.model);
      if (!videoModelOptions.some((option) => option.id === body.model)) throw new Error("所选视频模型不受支持。");
      if (!isVideoResolution(body.params.resolution) || !modelOption.resolutions.includes(body.params.resolution)) throw new Error(`${modelOption.label}不支持当前分辨率，请重新选择。`);
      const duration = Number(body.params.duration ?? 5);
      if (duration < 4 || duration > 15) throw new Error("Seedance 2.0 视频时长必须在 4—15 秒之间。");
      if (body.params.image_with_roles && (body.params.video_urls || body.params.audio_urls)) throw new Error("首尾帧模式不能同时使用参考视频或参考音频。");
      if (!body.shotId) throw new Error("视频任务必须绑定一个分镜。");
      const shot = db.prepare("SELECT * FROM shots WHERE id=? AND project_id=?").get(String(body.shotId), projectId) as Record<string, unknown> | undefined;
      if (!shot) throw new Error("分镜不存在。");
      if (shot.sequence_relation !== "seamless_continuation" && (!shot.approved_image_job_id || !shot.approved_image_media_id)) throw new Error("请先选择并锁定该镜头的首帧，再生成视频。");
      if (shot.sequence_relation === "seamless_continuation") {
        if (!shot.parent_shot_id) throw new Error("连续镜头必须指定上一镜头。");
        const parent = db.prepare("SELECT approved_video_job_id,observed_end_state,last_frame_media_id FROM shots WHERE id=?").get(String(shot.parent_shot_id)) as { approved_video_job_id: string | null; observed_end_state: string; last_frame_media_id: string | null } | undefined;
        if (!parent?.approved_video_job_id || !parent.observed_end_state || !parent.last_frame_media_id) throw new Error("上一镜头尚未通过视频审核并记录尾帧，当前连续镜头不能生成。");
      }
      const audioIds = JSON.parse(String(shot.audio_asset_ids_json ?? "[]")) as string[];
      const videoReferenceIds = JSON.parse(String(shot.video_reference_media_ids_json ?? "[]")) as string[];
      if (videoReferenceIds.length > 3) throw new Error("每个镜头最多绑定3段视频参考。");
      const videoReferences = videoReferenceIds.length ? db.prepare(`SELECT id,source_url,expires_at,kind FROM media_files WHERE project_id=? AND id IN (${videoReferenceIds.map(() => "?").join(",")})`).all(projectId, ...videoReferenceIds) as { id: string; source_url: string; expires_at: string | null; kind: string }[] : [];
      if (videoReferences.length !== videoReferenceIds.length || videoReferences.some((item) => item.kind !== "video")) throw new Error("镜头绑定的视频参考不存在或类型不正确，请重新选择。");
      if (videoReferences.some((item) => !/^https:\/\//i.test(item.source_url) || (item.expires_at && new Date(item.expires_at).getTime() <= Date.now()))) throw new Error("视频参考缺少有效 HTTPS 地址，请先补充或重新上传远程素材。");
      body.params.video_urls = videoReferences.map((item) => item.source_url);
      const assetIds = JSON.parse(String(shot.asset_ids_json ?? "[]")) as string[];
      if (assetIds.length + (shot.approved_image_media_id ? 1 : 0) > 9) throw new Error("每个镜头最多提交9张图片参考（包含锁定首帧）。");
      body.params.image_reference_asset_ids = assetIds;
      if (audioIds.length > 3) throw new Error("Seedance 2.0 每个镜头最多绑定 3 个音频参考。");
      const audioAssets = audioIds.length ? db.prepare(`SELECT id,remote_url FROM audio_assets WHERE project_id=? AND id IN (${audioIds.map(() => "?").join(",")})`).all(projectId, ...audioIds) as { id: string; remote_url: string }[] : [];
      const audioDuration = audioIds.length ? db.prepare(`SELECT COALESCE(SUM(duration),0) AS total FROM audio_assets WHERE project_id=? AND id IN (${audioIds.map(() => "?").join(",")})`).get(projectId, ...audioIds) as { total: number } : { total: 0 };
      if (audioIds.length && audioAssets.length !== audioIds.length) throw new Error("镜头绑定的声音资产已不存在，请重新选择。");
      if (audioIds.length && audioAssets.some((item) => !item.remote_url)) throw new Error("镜头使用了声音参考，但部分声音资产没有 APIMart 可访问的 HTTPS URL。请先补充远程地址。");
      if (Number(audioDuration.total) > 15) throw new Error("该镜头绑定的参考音频总时长超过 15 秒。请为当前镜头切分更短的台词或音乐片段。");
      if (shot.audio_mode === "silent") body.params.generate_audio = false;
      else if (shot.audio_mode !== "generated") {
        if (!audioAssets.length) throw new Error("当前音频模式需要至少绑定一个声音资产。");
        body.params.audio_urls = audioAssets.map((item) => item.remote_url);
        body.params.audio_reference_mode = String(shot.audio_mode);
        body.params.generate_audio = true;
      }
      const audioTypes = audioIds.length ? db.prepare(`SELECT type FROM audio_assets WHERE project_id=? AND id IN (${audioIds.map(() => "?").join(",")})`).all(projectId, ...audioIds) as { type: string }[] : [];
      if (shot.audio_mode === "voice_reference" && !audioTypes.some((item) => item.type === "character_voice")) throw new Error("角色音色参考模式必须绑定至少一个“角色音色”资产。");
      if (shot.audio_mode === "dialogue_lipsync" && !audioTypes.some((item) => item.type === "dialogue_line")) throw new Error("成品台词口型模式必须绑定至少一个“成品台词”资产。");
      if (shot.audio_mode === "music_sync" && !audioTypes.some((item) => item.type === "music")) throw new Error("MV音乐节拍模式必须绑定至少一个“音乐片段”资产。");
      body.params = { ...body.params, return_last_frame: true, first_frame_media_id: shot.approved_image_media_id ? String(shot.approved_image_media_id) : "" };
      if (shot.sequence_relation === "seamless_continuation" && shot.parent_shot_id) body.params.continuity_parent_shot_id = String(shot.parent_shot_id);
    }
    const job = store.addJob({ projectId, shotId: body.shotId ?? null, assetId: body.assetId ?? null, kind: body.kind,
      provider: body.provider, model: body.model, prompt: body.prompt, params: body.params });
    if (body.kind === "image" && body.assetId) {
      db.prepare("UPDATE assets SET status=CASE WHEN status='draft' THEN 'draft' ELSE 'stale' END,approved_job_id=NULL,updated_at=? WHERE id=?").run(now(), body.assetId);
    }
    emitEvent("job.updated", { projectId, jobId: job.id });
    return reply.code(201).send(job);
  });

  app.post("/api/jobs/:jobId/retry", async (request) => {
    const { jobId } = request.params as { jobId: string };
    const job = store.updateJob(jobId, { status: "draft", externalTaskId: null, error: "", progress: 0, nextPollAt: null });
    emitEvent("job.updated", { projectId: job.projectId, jobId });
    return job;
  });

  app.get("/api/projects/:projectId/revisions/open", async (request) => {
    const { projectId } = request.params as { projectId: string };
    return db.prepare("SELECT * FROM revision_requests WHERE project_id=? AND status!='resolved' ORDER BY created_at").all(projectId);
  });
  app.post("/api/revisions/:revisionId/resolve", async (request) => {
    store.resolveRevision((request.params as { revisionId: string }).revisionId);
    return { ok: true };
  });

  app.post("/api/projects/:projectId/preview", async (request) => {
    const { projectId } = request.params as { projectId: string };
    const counts = db.prepare("SELECT COUNT(*) AS total,COUNT(approved_video_job_id) AS approved FROM shots WHERE project_id=?").get(projectId) as { total: number; approved: number };
    if (!counts.total) throw new Error("当前项目还没有分镜，不能生成成片预览。");
    if (counts.approved !== counts.total) throw new Error(`还有 ${counts.total - counts.approved} 个镜头视频未通过审核，不能提前生成成片。`);
    const localPath = buildPreview(projectId);
    const createdAt = now();
    const url = `/api/files?path=${encodeURIComponent(localPath)}`;
    const artifact = store.addArtifact(projectId, { type: "final_export", title: `成片预览 · ${createdAt}`, content: { localPath, url, createdAt }, status: "review", createdBy: "preview-builder" });
    store.setStage(projectId, "final_review");
    emitEvent("project.updated", { projectId });
    return { artifactId: artifact.id, localPath, url };
  });

  app.get("/api/assets/:assetId/reference", async (request, reply) => {
    const { assetId } = request.params as { assetId: string };
    const media = db.prepare(`SELECT m.local_path FROM assets a JOIN media_files m ON m.id=a.reference_media_id WHERE a.id=?`).get(assetId) as { local_path: string } | undefined;
    if (!media?.local_path || !fs.existsSync(media.local_path)) return reply.code(404).send({ error: "该资产没有本地参考图。" });
    const ext = path.extname(media.local_path).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    return reply.type(mime).send(fs.createReadStream(media.local_path));
  });

  app.get("/api/media/:mediaId", async (request, reply) => {
    const { mediaId } = request.params as { mediaId: string };
    const media = db.prepare("SELECT local_path,kind FROM media_files WHERE id=?").get(mediaId) as { local_path: string; kind: string } | undefined;
    if (!media?.local_path || !fs.existsSync(media.local_path)) return reply.code(404).send({ error: "素材文件不存在。" });
    const ext = path.extname(media.local_path).toLowerCase();
    const mime = ext === ".mp4" ? "video/mp4" : ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    return reply.type(mime).send(fs.createReadStream(media.local_path));
  });

  app.get("/api/files", async (request, reply) => {
    const filePath = String((request.query as { path?: string }).path ?? "");
    const resolved = path.resolve(filePath);
    const dataRoot = path.resolve(path.dirname(store.getSetting("data_root") ?? path.join(process.cwd(), ".data", "placeholder")));
    const safeRoot = path.resolve(process.cwd(), ".data");
    const isWithin = (root: string) => {
      const relative = path.relative(root, resolved);
      return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    };
    if (!isWithin(safeRoot) && !isWithin(dataRoot)) return reply.code(403).send({ error: "禁止访问工作台数据目录之外的文件。" });
    if (!fs.existsSync(resolved)) return reply.code(404).send({ error: "文件不存在。" });
    const ext = path.extname(resolved).toLowerCase();
    const mime = ext === ".mp4" ? "video/mp4" : ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : ext === ".svg" ? "image/svg+xml" : "application/octet-stream";
    return reply.type(mime).send(fs.createReadStream(resolved));
  });

  app.get("/api/settings", async () => ({
    hasApiKey: hasUsableApiKey(),
    hasVolcengineAudioApiKey: Boolean(store.getSetting("volcengine_audio_api_key")),
    imageModel: store.getSetting("image_model") ?? "gpt-image-2-official",
    imageResolution: store.getSetting("image_resolution") ?? "2k",
    videoModel: store.getSetting("video_model") ?? "doubao-seedance-2.0",
    defaultProvider: store.getSetting("default_provider") ?? "mock"
    ,audioModel: store.getSetting("audio_model") ?? "seed-audio-1.0"
  }));
  app.put("/api/settings", async (request) => {
    const body = z.object({ apiKey: z.string().optional(), volcengineAudioApiKey: z.string().optional(), imageModel: z.string().optional(), imageResolution: z.string().optional(), videoModel: z.string().optional(), audioModel: z.literal("seed-audio-1.0").optional(), defaultProvider: z.enum(["apimart", "mock"]).optional() }).parse(request.body);
    if (body.apiKey) store.setSetting("apimart_api_key", encryptSecret(body.apiKey.trim()));
    if (body.volcengineAudioApiKey) store.setSetting("volcengine_audio_api_key", encryptSecret(body.volcengineAudioApiKey.trim()));
    if (body.imageModel) {
      const option = imageModelOptions.find((item) => item.id === body.imageModel);
      if (!option) throw new Error("默认生图模型不受支持。");
      if (body.imageResolution && !option.resolutions.some((value) => value === body.imageResolution)) throw new Error("默认生图质量与所选模型不兼容。");
      store.setSetting("image_model", body.imageModel);
    }
    if (body.imageResolution) store.setSetting("image_resolution", body.imageResolution);
    if (body.videoModel) {
      if (!videoModelOptions.some((option) => option.id === body.videoModel)) throw new Error("默认视频模型不受支持。");
      store.setSetting("video_model", body.videoModel);
    }
    if (body.audioModel) store.setSetting("audio_model", body.audioModel);
    if (body.defaultProvider) store.setSetting("default_provider", body.defaultProvider);
    return { ok: true };
  });
  app.post("/api/settings/test", async (request) => {
    const body = z.object({ provider: z.enum(["apimart", "mock", "volcengine_audio"]), apiKey: z.string().optional() }).parse(request.body);
    if (body.provider === "mock") return new MockProvider().testConnection();
    if (body.provider === "volcengine_audio") {
      const apiKey = body.apiKey?.trim() || (store.getSetting("volcengine_audio_api_key") ? decryptSecret(store.getSetting("volcengine_audio_api_key")!) : "");
      return new VolcengineAudioProvider().testConnection(apiKey);
    }
    const apiKey = body.apiKey?.trim();
    if (apiKey) return new APIMartProvider().testConnection(apiKey);
    const encrypted = store.getSetting("apimart_api_key");
    if (!encrypted) return { ok: false, message: "请先输入 APIMart API Key。" };
    return new APIMartProvider().testConnection(decryptSecret(encrypted));
  });

  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join("；")
      : error instanceof Error ? error.message : String(error);
    reply.code(400).send({ error: message });
  });
}
