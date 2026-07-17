import type { Asset, AudioAsset, Shot, ShotVoiceBinding } from "./types.js";

export interface ParsedDialogueLine {
  speaker: string;
  text: string;
}

function normalize(value: string) {
  return value
    .trim()
    .replace(/[“”‘’"']/g, "")
    .replace(/\s+/g, "")
    .replace(/[·・]/g, "-")
    .toLowerCase();
}

function assetAliases(asset: Pick<Asset, "name" | "referenceCode">) {
  const values = [asset.name, asset.referenceCode]
    .flatMap((value) => value.split(/\s*(?:-|—|–|·|\/|／|、|（|\()\s*/))
    .map(normalize)
    .filter(Boolean);
  return [...new Set(values)];
}

export function parseShotDialogue(dialogue: string, speakerMap = ""): ParsedDialogueLine[] {
  const rawLines = dialogue.split(/\r?\n+/).map((line) => line.trim()).filter(Boolean);
  const fallbackSpeakers = speakerMap
    .split(/[\n；;]+/)
    .map((line) => line.match(/^([^：:,，]{1,30})[：:,，]/)?.[1]?.trim() ?? "")
    .filter(Boolean);

  return rawLines.flatMap((raw, index) => {
    const match = raw.match(/^([^：:]{1,30})[：:]\s*(.+)$/);
    const text = (match?.[2] ?? raw).trim();
    const speaker = (match?.[1] ?? fallbackSpeakers[index] ?? (fallbackSpeakers.length === 1 ? fallbackSpeakers[0] : "")).trim();
    return text && speaker ? [{ speaker, text }] : [];
  });
}

export function matchCharacterAsset(speaker: string, assets: Pick<Asset, "id" | "type" | "name" | "referenceCode">[]) {
  const wanted = normalize(speaker);
  if (!wanted) return null;
  const characters = assets.filter((asset) => asset.type === "character");
  const exact = characters.filter((asset) => assetAliases(asset).includes(wanted));
  if (exact.length === 1) return exact[0];
  const partial = characters.filter((asset) => assetAliases(asset).some((alias) => alias.includes(wanted) || wanted.includes(alias)));
  return partial.length === 1 ? partial[0] : null;
}

export function inferShotVoiceBindings(
  dialogue: string,
  speakerMap: string,
  assets: Pick<Asset, "id" | "type" | "name" | "referenceCode">[],
  existing: ShotVoiceBinding[] = []
) {
  const speakers = [...new Set(parseShotDialogue(dialogue, speakerMap).map((line) => line.speaker))];
  return speakers.map((speaker) => {
    const prior = existing.find((binding) => normalize(binding.speaker) === normalize(speaker));
    if (prior && assets.some((asset) => asset.id === prior.characterAssetId && asset.type === "character")) return { speaker, characterAssetId: prior.characterAssetId };
    return { speaker, characterAssetId: matchCharacterAsset(speaker, assets)?.id ?? "" };
  });
}

export function speakingCharacterIds(shots: Pick<Shot, "dialogue" | "voiceBindings">[]) {
  return [...new Set(shots.filter((shot) => shot.dialogue.trim()).flatMap((shot) => shot.voiceBindings.map((binding) => binding.characterAssetId)).filter(Boolean))];
}

export function lockedVoiceForCharacter(audioAssets: AudioAsset[], characterAssetId: string) {
  return audioAssets
    .filter((audio) => audio.type === "character_voice" && audio.characterAssetId === characterAssetId && audio.status === "locked")
    .sort((a, b) => b.version - a.version)[0] ?? null;
}

export function voiceAnchorProgress(
  shots: Pick<Shot, "dialogue" | "voiceBindings">[],
  audioAssets: AudioAsset[]
) {
  const ids = speakingCharacterIds(shots);
  const locked = ids.filter((characterId) => Boolean(lockedVoiceForCharacter(audioAssets, characterId)));
  const ready = ids.filter((characterId) => Boolean(lockedVoiceForCharacter(audioAssets, characterId)?.seedanceAssetUrl.startsWith("asset://")));
  return { total: ids.length, locked: locked.length, ready: ready.length, complete: ids.length === 0 || ready.length === ids.length };
}

export function compileSeedanceVoicePrompt(
  shot: Pick<Shot, "dialogue" | "speakerMap" | "voiceBindings" | "videoPrompt">,
  resolved: Array<{ binding: ShotVoiceBinding; audio: AudioAsset }>
) {
  const lines = parseShotDialogue(shot.dialogue, shot.speakerMap);
  if (!lines.length) return shot.videoPrompt.trim();
  const orderedCharacterIds = [...new Set(lines.map((line) => shot.voiceBindings.find((binding) => normalize(binding.speaker) === normalize(line.speaker))?.characterAssetId).filter(Boolean))];
  const references = orderedCharacterIds.map((characterAssetId, index) => {
    const item = resolved.find(({ binding }) => binding.characterAssetId === characterAssetId);
    return item ? `@Audio${index + 1} 仅提供${item.binding.speaker}的年龄感、音色、口音和说话质感，不复用示例台词。` : "";
  }).filter(Boolean);
  const dialogue = lines.map((line) => {
    const binding = shot.voiceBindings.find((item) => normalize(item.speaker) === normalize(line.speaker));
    const index = orderedCharacterIds.indexOf(binding?.characterAssetId ?? "");
    return `${line.speaker}用@Audio${index + 1}的音色说：“${line.text}”`;
  });
  const overlap = orderedCharacterIds.length > 1 ? "多角色台词严格按以上顺序出现，禁止重叠说话。" : "";
  return [shot.videoPrompt.trim(), ...references, ...dialogue, overlap].filter(Boolean).join("\n");
}
