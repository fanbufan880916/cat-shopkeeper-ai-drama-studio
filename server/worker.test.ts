import { describe, expect, it } from "vitest";
import type { GenerationProvider } from "./providers/types.js";
import { db, store } from "./db.js";
import { attachLocalReferences } from "./worker.js";

describe("Seedance local reference attachment", () => {
  it("uses image_urls instead of incompatible image_with_roles when audio is attached", async () => {
    const project = store.createProject({ name: `worker-audio-${Date.now()}` });
    const shot = store.upsertShot(project.id, { shotNumber: 1, title: "MV", duration: 5 });
    const imageJob = store.addJob({ projectId: project.id, shotId: shot.id, assetId: null, kind: "image", provider: "mock", model: "gpt-image-2", prompt: "首帧", params: {} });
    const mediaId = `med_worker_${Date.now()}`;
    db.prepare("INSERT INTO media_files VALUES (?,?,?,?,?,?,?,?,?)").run(mediaId, project.id, imageJob.id, "image", "E:\\frame.png", "", null, "{}", new Date().toISOString());
    db.prepare("UPDATE shots SET approved_image_job_id=?,approved_image_media_id=? WHERE id=?").run(imageJob.id, mediaId, shot.id);
    const videoJob = store.addJob({ projectId: project.id, shotId: shot.id, assetId: null, kind: "video", provider: "apimart", model: "doubao-seedance-2.0", prompt: "按音乐节拍表演", params: {
      audio_urls: ["https://example.com/music.mp3"], first_frame_media_id: mediaId, return_last_frame: true
    } });
    const provider: GenerationProvider = { name: "apimart", submit: async () => ({ taskId: "task", status: "submitted" }), poll: async () => ({ status: "completed", progress: 100 }), uploadImage: async () => ({ url: "https://example.com/frame.png", expiresAt: new Date(Date.now() + 1000).toISOString() }), testConnection: async () => ({ ok: true, message: "ok" }) };

    const attached = await attachLocalReferences(store.getJob(videoJob.id), provider, "key");

    expect(attached.params.image_urls).toEqual(["https://example.com/frame.png"]);
    expect(attached.params.audio_urls).toEqual(["https://example.com/music.mp3"]);
    expect(attached.params.image_with_roles).toBeUndefined();
    db.prepare("DELETE FROM projects WHERE id=?").run(project.id);
  });
});
