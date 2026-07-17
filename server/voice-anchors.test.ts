import { describe, expect, it } from "vitest";
import type { AudioAsset, Shot } from "../shared/types.js";
import { resolveShotVoiceReferences } from "./voice-anchors.js";

const audio = (id: string, characterAssetId: string): AudioAsset => ({
  id, projectId: "prj", type: "character_voice", name: id, characterAssetId, localPath: "voice.wav",
  remoteUrl: `https://example.com/${id}.wav`, duration: 5, rightsNote: "已授权", description: "", status: "locked", version: 1,
  sourceJobId: null, sourceExpiresAt: null, voiceProfileHash: `hash-${id}`, seedanceAssetUrl: `asset://voice/${id}`,
  registrationJobId: null, lockedAt: "", createdAt: "", updatedAt: ""
});

describe("server voice anchor limits", () => {
  it("blocks more than three speaking roles and reference audio over fifteen seconds", () => {
    const bindings = [1, 2, 3, 4].map((index) => ({ speaker: `角色${index}`, characterAssetId: `ast_${index}` }));
    const shot = {
      dialogue: bindings.map((item) => `${item.speaker}：台词${item.speaker}`).join("\n"), speakerMap: "", voiceBindings: bindings,
      videoPrompt: "多人按顺序说话。", audioMode: "voice_reference"
    } as Shot;
    const result = resolveShotVoiceReferences(shot, bindings.map((item, index) => audio(`aud_${index}`, item.characterAssetId)));
    expect(result.errors).toContain("单镜头最多允许3个说话角色，请拆分镜头后再生成视频");
    expect(result.errors).toContain("角色音色锚点总时长超过15秒，请缩短样本或拆分镜头");
  });
});
