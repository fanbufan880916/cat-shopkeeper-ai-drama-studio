import { describe, expect, it } from "vitest";
import { inferAudioStyleProfile } from "./audio-prompt.js";

describe("audio style guard", () => {
  it("does not turn generic neon into Hong Kong 90s", () => {
    expect(inferAudioStyleProfile("现代都市夜景，霓虹倒影，人物用普通话交谈。")).toBe("modern_realistic");
  });

  it("honors an explicit rejection of Hong Kong Mandarin", () => {
    expect(inferAudioStyleProfile("旧版是90年代香港电影质感，当前全部台词使用标准普通话，不得改为港式普通话。")).toBe("modern_realistic");
  });
});
