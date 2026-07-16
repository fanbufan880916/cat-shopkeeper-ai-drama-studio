import fs from "node:fs";
import { describe, expect, it } from "vitest";
import type { GenerationJob } from "../shared/types.js";
import { MockProvider } from "./providers/mock.js";

function job(kind: "image" | "video"): GenerationJob {
  const old = new Date(Date.now() - 2000).toISOString();
  return { id: `test-${kind}-${Date.now()}`, projectId: "project", shotId: "shot", assetId: null, kind, provider: "mock", model: "mock",
    prompt: "测试生成结果", params: {}, externalTaskId: "mock", status: "processing", progress: 50, cost: 0, creditsCost: 0,
    output: {}, error: "", attempt: 1, nextPollAt: null, createdAt: old, updatedAt: old };
}

describe("mock generation", () => {
  it("creates a local image", async () => {
    const result = await new MockProvider().poll(job("image"));
    const local = (result.output as { localPaths: string[] }).localPaths[0];
    expect(result.status).toBe("completed");
    expect(fs.existsSync(local)).toBe(true);
  });
});
