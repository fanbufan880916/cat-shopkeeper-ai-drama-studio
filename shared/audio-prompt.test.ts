import { describe, expect, it } from "vitest";
import { buildAudioPrompt, inferAudioStyleProfile, validateAudioPrompt } from "./audio-prompt.js";

describe("audio prompt style selection", () => {
  it("only selects Hong Kong style when the script says so", () => {
    expect(inferAudioStyleProfile("90年代香港市井电影，雨夜反转喜剧")).toBe("hk90");
    expect(inferAudioStyleProfile("现代校园悬疑，写实对白")).toBe("modern_realistic");
    expect(inferAudioStyleProfile("一个普通故事，没有明确时代和口音")).toBe("needs_review");
  });

  it("builds a non-Hong-Kong prompt without forcing Hong Kong Mandarin", () => {
    const prompt = buildAudioPrompt([{ speaker: "林老师", text: "请把这份报告再核对一遍。" }], { style: "documentary" });
    expect(prompt).toContain("标准普通话");
    expect(prompt).not.toContain("港式普通话");
    expect(validateAudioPrompt(prompt, "documentary")).toEqual([]);
  });
});
