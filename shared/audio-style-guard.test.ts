import { describe, expect, it } from "vitest";
import { inferAudioStyleProfile } from "./audio-prompt.js";

describe("audio style guard", () => {
  it("does not turn generic neon into Hong Kong 90s", () => {
    expect(inferAudioStyleProfile("现代都市夜景，霓虹倒影，人物用普通话交谈。")).toBe("modern_realistic");
  });
});
