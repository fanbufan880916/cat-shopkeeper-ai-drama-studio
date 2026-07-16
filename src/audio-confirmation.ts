import type { AudioClip, Shot } from "../shared/types";

export interface AudioConfirmationLine {
  text: string;
  shotId: string | null;
}

export interface AudioConfirmationProgress {
  confirmed: number;
  total: number;
  complete: boolean;
}

type ConfirmationClip = Pick<AudioClip, "id" | "audioAssetId" | "shotId" | "status" | "text">;
type ConfirmationShot = Pick<Shot, "id" | "audioAssetIds">;

export function getAudioConfirmationProgress(
  lines: AudioConfirmationLine[],
  clips: ConfirmationClip[],
  shots: ConfirmationShot[]
): AudioConfirmationProgress {
  const usedClipIds = new Set<string>();
  let confirmed = 0;

  for (const line of lines) {
    const clip = clips.find((item) => {
      if (usedClipIds.has(item.id) || item.status !== "approved" || item.text !== line.text || !item.shotId) return false;
      if (line.shotId && item.shotId !== line.shotId) return false;
      return shots.find((shot) => shot.id === item.shotId)?.audioAssetIds.includes(item.audioAssetId);
    });
    if (!clip) continue;
    usedClipIds.add(clip.id);
    confirmed += 1;
  }

  return {
    confirmed,
    total: lines.length,
    complete: lines.length > 0 && confirmed === lines.length
  };
}
