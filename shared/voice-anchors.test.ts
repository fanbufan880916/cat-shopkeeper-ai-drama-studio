import { describe, expect, it } from "vitest";
import type { Asset, AudioAsset, Shot } from "./types.js";
import { compileSeedanceVoicePrompt, inferShotVoiceBindings, voiceAnchorProgress } from "./voice-anchors.js";

const character = (id: string, name: string) => ({ id, name, type: "character", referenceCode: name } as Asset);
const audio = (patch: Partial<AudioAsset> & Pick<AudioAsset, "id" | "characterAssetId">) => ({
  ...patch,
  id: patch.id, projectId: "prj", type: "character_voice", name: patch.id, characterAssetId: patch.characterAssetId,
  localPath: "voice.wav", remoteUrl: "https://example.com/voice.wav", duration: 5, rightsNote: "已授权", description: "",
  status: "locked", version: 1, sourceJobId: null, sourceExpiresAt: null, voiceProfileHash: `hash-${patch.id}`,
  seedanceAssetUrl: patch.seedanceAssetUrl ?? `asset://voice/${patch.id}`, registrationJobId: null, lockedAt: new Date().toISOString(), createdAt: "", updatedAt: ""
} as AudioAsset);
const shot = (patch: Partial<Shot>) => ({
  id: "shot", projectId: "prj", shotNumber: 1, title: "对白", duration: 5, narrativePurpose: "",
  composition: "", camera: "", action: "", dialogue: "", imagePrompt: "", videoPrompt: "稳定中近景。", assetIds: [],
  videoReferenceMediaIds: [], sceneId: "scene", parentShotId: null, sequenceRelation: "sequence_first_clip", feltIntent: "",
  plannedStartState: "", plannedEndState: "", alreadyHappened: "", reservedForLater: "", continuityLocks: "", allowedChanges: "",
  audioMode: "voice_reference", audioAssetIds: [], voiceBindings: [], speakerMap: "", audioDirection: "", lipSyncNotes: "",
  approvedImageJobId: null, approvedImageMediaId: null, approvedVideoJobId: null, observedEndState: "", observedAudioState: "",
  lastFrameMediaId: null, status: "draft", sampleApproved: false, createdAt: "", updatedAt: "", ...patch
} as Shot);

describe("voice anchor contracts", () => {
  it("infers speaker bindings in first-dialogue order", () => {
    const assets = [character("ast_xiaoman", "小曼 - 女高中生"), character("ast_ajie", "阿杰")];
    expect(inferShotVoiceBindings("小曼：你今天不一样。\n阿杰：哪里不一样？\n小曼：说不上来。", "", assets)).toEqual([
      { speaker: "小曼", characterAssetId: "ast_xiaoman" },
      { speaker: "阿杰", characterAssetId: "ast_ajie" }
    ]);
  });

  it("keeps target dialogue separate from the sample voice text", () => {
    const current = shot({ dialogue: "小曼：你今天，不一样。", voiceBindings: [{ speaker: "小曼", characterAssetId: "ast_xiaoman" }] });
    const prompt = compileSeedanceVoicePrompt(current, [{ binding: current.voiceBindings[0], audio: audio({ id: "aud_xiaoman", characterAssetId: "ast_xiaoman" }) }]);
    expect(prompt).toContain("@Audio1 仅提供小曼的年龄感、音色、口音和说话质感，不复用示例台词");
    expect(prompt).toContain("小曼用@Audio1的音色说：“你今天，不一样。”");
  });

  it("requires locked asset URLs and excludes historical dialogue clips from completion", () => {
    const current = shot({ dialogue: "小曼：你好。", voiceBindings: [{ speaker: "小曼", characterAssetId: "ast_xiaoman" }] });
    const historical = { ...audio({ id: "old_line", characterAssetId: "ast_xiaoman" }), type: "dialogue_line", seedanceAssetUrl: "" } as AudioAsset;
    expect(voiceAnchorProgress([current], [historical])).toMatchObject({ total: 1, locked: 0, ready: 0, complete: false });
    expect(voiceAnchorProgress([current], [historical, audio({ id: "current_voice", characterAssetId: "ast_xiaoman" })])).toMatchObject({ total: 1, locked: 1, ready: 1, complete: true });
  });
});
