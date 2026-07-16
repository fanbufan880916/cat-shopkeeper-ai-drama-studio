import { describe, expect, it } from "vitest";
import type { ArtifactVersion, Shot } from "./types.js";
import { extractLockedScriptDialogue } from "./script-dialogue.js";

const script: ArtifactVersion = {
  id: "art_script", projectId: "prj", type: "script", version: 2, title: "锁定剧本",
  content: { scenes: [{ beat: 1, name: "雨夜门口", dialogue: ["阿强：我的鞋还能救吗？", "猫掌柜：交给我。"] }] },
  status: "locked", createdBy: "screenwriter", createdAt: ""
};

function shot(patch: Partial<Shot>): Shot {
  return {
    id: "shot_1", projectId: "prj", shotNumber: 1, title: "递鞋", duration: 5, narrativePurpose: "", composition: "",
    camera: "", action: "", dialogue: "阿强：我的鞋还能救吗？", imagePrompt: "", videoPrompt: "", assetIds: [],
    sceneId: "scene-01", parentShotId: null, sequenceRelation: "sequence_first_clip", feltIntent: "", plannedStartState: "",
    plannedEndState: "", alreadyHappened: "", reservedForLater: "", continuityLocks: "", allowedChanges: "",
    audioMode: "dialogue_lipsync", audioAssetIds: [], videoReferenceMediaIds: [], speakerMap: "", audioDirection: "",
    lipSyncNotes: "", status: "draft", sampleApproved: false, approvedImageJobId: null, approvedImageMediaId: null,
    approvedVideoJobId: null, observedEndState: "", observedAudioState: "", lastFrameMediaId: null, createdAt: "", updatedAt: "", ...patch
  };
}

describe("锁定剧本对白提取", () => {
  it("分镜产生前按场景提供对白母带行", () => {
    const lines = extractLockedScriptDialogue([script], []);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ sceneId: "scene-01", sceneName: "雨夜门口", shotId: null, speaker: "阿强", text: "我的鞋还能救吗？" });
  });

  it("分镜产生后按场景和对白内容绑定具体镜头", () => {
    const lines = extractLockedScriptDialogue([script], [shot({ audioDirection: "17岁男高中生，标准普通话，音量偏低。" })]);
    expect(lines[0]).toMatchObject({ shotId: "shot_1", shotNumber: 1, shotTitle: "递鞋", voiceDirection: "17岁男高中生，标准普通话，音量偏低。" });
    expect(lines[1].shotId).toBeNull();
  });

  it("不会从未锁定剧本读取生产对白", () => {
    expect(extractLockedScriptDialogue([{ ...script, status: "review" }], [])).toEqual([]);
  });
});
