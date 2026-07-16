import { describe, expect, it } from "vitest";
import { buildAutomaticAudioSegments, subtitleSentencesFromJobOutput } from "./audio-segments.js";

const lines = [
  { shotId: "shot_1", speaker: "同学甲", text: "阿杰，你这鞋是从土里刨出来的吧？" },
  { shotId: "shot_2", speaker: "小曼", text: "你今天，不一样。" }
];

describe("automatic audio segmentation", () => {
  it("uses exact provider subtitle timings when every dialogue line matches", () => {
    const output = { subtitle: { sentences: [
      { start_time: 3970, end_time: 6289, text: "阿杰，你这鞋是从土里刨出来的吧？" },
      { start_time: 28210, end_time: 31449, text: "你今天，不一样。" }
    ] } };
    expect(subtitleSentencesFromJobOutput(output)).toHaveLength(2);
    expect(buildAutomaticAudioSegments(lines, 33.28, output)).toEqual({
      source: "subtitle",
      segments: [
        { ...lines[0], startMs: 3970, endMs: 6289, handleMs: 150 },
        { ...lines[1], startMs: 28210, endMs: 31449, handleMs: 150 }
      ]
    });
  });

  it("falls back to estimates only when subtitle timing is unavailable", () => {
    const result = buildAutomaticAudioSegments(lines, 33.28, {});
    expect(result.source).toBe("estimate");
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].startMs).toBe(0);
  });
});
