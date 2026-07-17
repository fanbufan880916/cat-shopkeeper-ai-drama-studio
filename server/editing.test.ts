import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mediaDir } from "./paths.js";
import { store } from "./db.js";
import { prepareEditManifest, validateEditManifest } from "./editing.js";
import { checkJianyingCli } from "./jianying.js";

const projectIds: string[] = [];

afterEach(() => {
  for (const projectId of projectIds.splice(0)) {
    try { store.deleteProject(projectId); } catch { /* test cleanup */ }
  }
});

function projectWithApprovedShot() {
  const project = store.createProject({ name: `editing-test-${Date.now()}`, targetDuration: 15, aspectRatio: "9:16" });
  projectIds.push(project.id);
  store.setStage(project.id, "batch_generation");
  const shot = store.upsertShot(project.id, { shotNumber: 1, title: "测试镜头", duration: 5, dialogue: "测试台词", narrativePurpose: "验证剪辑流程" });
  const job = store.addJob({ projectId: project.id, shotId: shot.id, assetId: null, kind: "video", provider: "mock", model: "mock", prompt: "test" , params: {} });
  store.updateJob(job.id, { status: "completed", progress: 100 });
  fs.mkdirSync(mediaDir, { recursive: true });
  const mediaPath = path.join(mediaDir, `${job.id}.mp4`);
  fs.writeFileSync(mediaPath, "test video placeholder");
  store.addMediaFile({ projectId: project.id, jobId: job.id, kind: "video", localPath: mediaPath, sourceUrl: "", expiresAt: null, metadata: { source: "test" } });
  store.upsertShot(project.id, { id: shot.id, shotNumber: 1, title: shot.title, approvedVideoJobId: job.id });
  return project;
}

describe("editing workflow", () => {
  it("blocks projects with unapproved shots", () => {
    const project = store.createProject({ name: `editing-gate-${Date.now()}` });
    projectIds.push(project.id);
    store.setStage(project.id, "batch_generation");
    store.upsertShot(project.id, { shotNumber: 1, title: "未通过镜头", duration: 5 });
    expect(() => prepareEditManifest(project.id)).toThrow(/尚未通过视频审核/);
  });

  it("writes versioned manifest and plan without overwriting", () => {
    const project = projectWithApprovedShot();
    const first = prepareEditManifest(project.id);
    expect(first.editJob.version).toBe(1);
    expect(fs.existsSync(first.manifestPath)).toBe(true);
    expect(fs.existsSync(first.planPath)).toBe(true);
    store.setStage(project.id, "edit_prepare");
    const second = prepareEditManifest(project.id);
    expect(second.editJob.version).toBe(2);
    expect(first.manifestPath).not.toBe(second.manifestPath);
    expect(fs.existsSync(first.manifestPath)).toBe(true);
    expect(validateEditManifest(second.manifest).length).toBe(0);
  });

  it("reports a missing Jianying executable instead of falling back", async () => {
    const result = await checkJianyingCli({ enabled: true, executable: "", adapter: "scripts/jianying-adapter.ps1", projectRoot: "", timeoutSeconds: 10, commandTemplates: {} });
    expect(result.ok).toBe(false);
    expect(result.stderr).toMatch(/剪映 CLI/);
  });
});
