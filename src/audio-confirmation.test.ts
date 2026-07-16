import { describe, expect, it } from "vitest";
import { getAudioConfirmationProgress } from "./audio-confirmation";

describe("声音生产完成状态", () => {
  const lines = [
    { text: "我的鞋还能救吗？", shotId: "shot_1" },
    { text: "交给我。", shotId: "shot_2" }
  ];
  const clips = [
    { id: "clip_1", audioAssetId: "audio_1", shotId: "shot_1", status: "approved" as const, text: "我的鞋还能救吗？" },
    { id: "clip_2", audioAssetId: "audio_2", shotId: "shot_2", status: "approved" as const, text: "交给我。" }
  ];

  it("所有台词切片通过并绑定后标记为完成", () => {
    expect(getAudioConfirmationProgress(lines, clips, [
      { id: "shot_1", audioAssetIds: ["audio_1"] },
      { id: "shot_2", audioAssetIds: ["audio_2"] }
    ])).toEqual({ confirmed: 2, total: 2, complete: true });
  });

  it("切片只通过但没有绑定到镜头时仍未完成", () => {
    expect(getAudioConfirmationProgress(lines, clips, [
      { id: "shot_1", audioAssetIds: ["audio_1"] },
      { id: "shot_2", audioAssetIds: [] }
    ])).toEqual({ confirmed: 1, total: 2, complete: false });
  });

  it("同一条已通过切片不能重复确认两句相同台词", () => {
    expect(getAudioConfirmationProgress([
      { text: "好。", shotId: "shot_1" },
      { text: "好。", shotId: "shot_1" }
    ], [
      { id: "clip_1", audioAssetId: "audio_1", shotId: "shot_1", status: "approved", text: "好。" }
    ], [
      { id: "shot_1", audioAssetIds: ["audio_1"] }
    ])).toEqual({ confirmed: 1, total: 2, complete: false });
  });
});
