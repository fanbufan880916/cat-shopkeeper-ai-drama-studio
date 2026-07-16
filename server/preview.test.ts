import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { db, store } from "./db.js";
import { buildPreview } from "./preview.js";
import { dataDir, previewDir } from "./paths.js";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));

const projectIds: string[] = [];
afterAll(() => {
  const remove = db.prepare("DELETE FROM projects WHERE id=?");
  for (const projectId of projectIds) remove.run(projectId);
});

describe("preview assembly", () => {
  it("uses only the approved video for each shot", () => {
    const project = store.createProject({ name: `preview-${Date.now()}` });
    projectIds.push(project.id);
    const shot = store.upsertShot(project.id, { shotNumber: 1, title: "镜头一" });
    const rejected = store.addJob({ projectId: project.id, shotId: shot.id, assetId: null, kind: "video", provider: "mock", model: "mock", prompt: "旧版", params: {} });
    const approved = store.addJob({ projectId: project.id, shotId: shot.id, assetId: null, kind: "video", provider: "mock", model: "mock", prompt: "通过版", params: {} });
    store.updateJob(rejected.id, { status: "completed" });
    store.updateJob(approved.id, { status: "completed" });

    const rejectedPath = path.join(dataDir, `${rejected.id}.mp4`);
    const approvedPath = path.join(dataDir, `${approved.id}.mp4`);
    fs.mkdirSync(path.dirname(approvedPath), { recursive: true });
    fs.writeFileSync(rejectedPath, "old");
    fs.writeFileSync(approvedPath, "approved");
    db.prepare("INSERT INTO media_files VALUES (?,?,?,?,?,?,?,?,?)").run(`med-${rejected.id}`, project.id, rejected.id, "video", rejectedPath, "", null, "{}", new Date().toISOString());
    db.prepare("INSERT INTO media_files VALUES (?,?,?,?,?,?,?,?,?)").run(`med-${approved.id}`, project.id, approved.id, "video", approvedPath, "", null, "{}", new Date().toISOString());
    db.prepare("UPDATE shots SET approved_video_job_id=? WHERE id=?").run(approved.id, shot.id);

    buildPreview(project.id);
    const list = fs.readFileSync(path.join(previewDir, `${project.id}-concat.txt`), "utf8");
    expect(list).toContain(approvedPath);
    expect(list).not.toContain(rejectedPath);
  });
});
