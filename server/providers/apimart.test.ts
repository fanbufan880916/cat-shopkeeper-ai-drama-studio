import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenerationJob } from "../../shared/types.js";
import { APIMartProvider } from "./apimart.js";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function job(patch: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: "job_test", projectId: "prj_test", shotId: null, assetId: null, kind: "image", provider: "apimart",
    model: "gpt-image-2-official", prompt: "test", params: {}, externalTaskId: null, status: "draft",
    progress: 0, cost: 0, creditsCost: 0, output: {}, error: "", attempt: 0, nextPollAt: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...patch, audioAssetId: patch.audioAssetId ?? null
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("APIMartProvider", () => {
  it("tests the API key with the documented balance endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ success: true, remain_balance: 10.5 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new APIMartProvider().testConnection("sk-test");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.apimart.ai/v1/balance");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer sk-test");
    expect(result).toEqual({ ok: true, message: "连接成功，当前可用额度：10.5" });
  });

  it("reads task IDs from asynchronous generation responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ code: 200, data: [{ status: "submitted", task_id: "task_123" }] })));
    await expect(new APIMartProvider().submit(job(), "sk-test")).resolves.toEqual({ taskId: "task_123", status: "submitted" });
  });

  it("removes official-only quality when using the regular image channel", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ code: 200, data: [{ status: "submitted", task_id: "task_regular" }] }));
    vi.stubGlobal("fetch", fetchMock);
    await new APIMartProvider().submit(job({ model: "gpt-image-2", params: { size: "9:16", resolution: "2k", quality: "high", n: 1 } }), "sk-test");
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload).toEqual({ model: "gpt-image-2", prompt: "test", size: "9:16", resolution: "2k", n: 1 });
  });

  it("uses the dedicated Midjourney endpoint without a model field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ code: 200, data: [{ status: "submitted", task_id: "task_mj" }] }));
    vi.stubGlobal("fetch", fetchMock);
    await new APIMartProvider().submit(job({ model: "midjourney", params: { size: "3:2", speed: "fast", version: "7", style: "raw" } }), "sk-test");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.apimart.ai/v1/midjourney/generations");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ prompt: "test", size: "3:2", speed: "fast", version: "7", style: "raw" });
  });

  it("submits Seedance first-frame roles and requests the last frame", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ code: 200, data: [{ status: "submitted", task_id: "task_video" }] }));
    vi.stubGlobal("fetch", fetchMock);
    await new APIMartProvider().submit(job({ kind: "video", model: "doubao-seedance-2.0", params: {
      size: "9:16", resolution: "720p", duration: 5, generate_audio: true, return_last_frame: true,
      image_with_roles: [{ url: "https://example.com/first.png", role: "first_frame" }]
    } }), "sk-test");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ return_last_frame: true, image_with_roles: [{ url: "https://example.com/first.png", role: "first_frame" }] });
  });

  it("submits private Seedance audio with the documented endpoint and payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ code: 200, data: { task_id: "task_voice" } }));
    vi.stubGlobal("fetch", fetchMock);
    await new APIMartProvider().submit(job({
      kind: "audio_registration", model: "seedance-private-audio", audioAssetId: "aud_voice",
      params: { project_name: "洗鞋的温度", asset_type: "Audio", url: "https://example.com/xiaoman.wav", name: "小曼音色" }
    }), "sk-test");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.apimart.ai/v1/seedance2/private-avatar");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ project_name: "洗鞋的温度", asset_type: "Audio", url: "https://example.com/xiaoman.wav" });
  });

  it("treats a returned asset URL as a completed private audio registration", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ code: 200, data: { status: "processing", result: { usable_assets: [{ asset_url: "asset://voice/xiaoman" }] } } })));
    const result = await new APIMartProvider().poll(job({ kind: "audio_registration", externalTaskId: "task_voice", status: "processing" }), "sk-test");
    expect(result.status).toBe("completed");
    expect(result.output).toEqual({ usable_assets: [{ asset_url: "asset://voice/xiaoman" }] });
  });

  it("maps completed task results for local persistence", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ code: 200, data: { status: "completed", progress: 100, cost: 0.15, credits_cost: 1.5, result: { images: [{ url: ["https://example.com/result.png"], expires_at: 123 }] } } })));
    const result = await new APIMartProvider().poll(job({ externalTaskId: "task_123", status: "submitted" }), "sk-test");
    expect(result).toMatchObject({ status: "completed", progress: 100, cost: 0.15, creditsCost: 1.5 });
    expect(result.output).toEqual({ images: [{ url: ["https://example.com/result.png"], expires_at: 123 }] });
  });
});
