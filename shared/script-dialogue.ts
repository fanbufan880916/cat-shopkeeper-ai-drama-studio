import type { ArtifactVersion, Shot } from "./types.js";

export interface ScriptDialogueLine {
  id: string;
  sceneId: string;
  sceneNumber: number;
  sceneName: string;
  shotId: string | null;
  shotNumber: number | null;
  shotTitle: string;
  speaker: string;
  text: string;
  description: string;
}

type ScriptScene = { id?: string; beat?: number; name?: string; dialogue?: unknown };
type StructuredScript = { scenes?: ScriptScene[] };

function parseLine(raw: string) {
  const match = raw.trim().match(/^([^：:]{1,30})[：:]\s*(.+)$/);
  return { speaker: match?.[1]?.trim() || "未指定角色", text: (match?.[2] ?? raw).trim() };
}

function dialogueStrings(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
  if (typeof value === "string") return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  return [];
}

export function latestLockedScript(artifacts: ArtifactVersion[]) {
  return artifacts
    .filter((artifact) => artifact.type === "script" && artifact.status === "locked")
    .slice()
    .sort((a, b) => b.version - a.version)[0];
}

export function extractLockedScriptDialogue(artifacts: ArtifactVersion[], shots: Shot[]): ScriptDialogueLine[] {
  const script = latestLockedScript(artifacts);
  if (!script || !script.content || typeof script.content !== "object") return [];
  const scenes = (script.content as StructuredScript).scenes;
  if (!Array.isArray(scenes)) return [];
  return scenes.flatMap((scene, sceneIndex) => {
    const sceneNumber = Number(scene.beat) || sceneIndex + 1;
    const sceneId = scene.id?.trim() || `scene-${String(sceneNumber).padStart(2, "0")}`;
    const sceneName = scene.name?.trim() || `场景 ${sceneNumber}`;
    return dialogueStrings(scene.dialogue).map((raw, lineIndex) => {
      const parsed = parseLine(raw);
      const shot = shots.find((item) => {
        const sameScene = !item.sceneId || item.sceneId === sceneId || item.sceneId === String(sceneNumber) || item.sceneId.endsWith(String(sceneNumber).padStart(2, "0"));
        return sameScene && item.dialogue.includes(parsed.text);
      }) ?? shots.find((item) => item.dialogue.includes(parsed.text));
      return {
        id: `${script.id}-${sceneId}-${lineIndex}`,
        sceneId, sceneNumber, sceneName,
        shotId: shot?.id ?? null,
        shotNumber: shot?.shotNumber ?? null,
        shotTitle: shot?.title ?? "",
        speaker: parsed.speaker,
        text: parsed.text,
        description: shot
          ? `镜头${shot.shotNumber}成品台词；用于稳定音色与口型时序。`
          : `${sceneName}对白母带；分镜产生后将按对白内容和场景关系绑定镜头。`
      };
    });
  });
}
