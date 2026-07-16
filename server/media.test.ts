import { afterEach, describe, expect, it, vi } from "vitest";
import { persistRemoteOutputs } from "./media.js";

afterEach(() => vi.unstubAllGlobals());

describe("remote media persistence", () => {
  it("fails a completed task when its result cannot be downloaded", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, body: null }));
    await expect(persistRemoteOutputs("project", "job", "image", { images: ["https://example.com/result.png"] }))
      .rejects.toThrow("下载失败");
  });

  it("rejects an empty completed result", async () => {
    await expect(persistRemoteOutputs("project", "job", "image", {})).rejects.toThrow("没有可保存的本地结果");
  });
});
