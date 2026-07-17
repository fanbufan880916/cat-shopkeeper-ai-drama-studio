import { createHash } from "node:crypto";
import type { AudioAsset, Shot, ShotVoiceBinding } from "../shared/types.js";
import { compileSeedanceVoicePrompt, parseShotDialogue } from "../shared/voice-anchors.js";
import { db } from "./db.js";
import { asJson, now, parseJson } from "./utils.js";

type AudioRow = {
  id: string;
  project_id: string;
  type: string;
  name: string;
  character_asset_id: string | null;
  remote_url: string;
  duration: number;
  status: AudioAsset["status"];
  version: number;
  source_expires_at: string | null;
  voice_profile_hash: string;
  seedance_asset_url: string;
  registration_job_id: string | null;
};

function audioFromRow(row: AudioRow): AudioAsset {
  return {
    id: row.id, projectId: row.project_id, type: row.type as AudioAsset["type"], name: row.name,
    characterAssetId: row.character_asset_id, localPath: "", remoteUrl: row.remote_url, duration: Number(row.duration),
    rightsNote: "", description: "", status: row.status, version: Number(row.version), sourceJobId: null,
    sourceExpiresAt: row.source_expires_at, voiceProfileHash: row.voice_profile_hash, seedanceAssetUrl: row.seedance_asset_url,
    registrationJobId: row.registration_job_id, lockedAt: null, createdAt: "", updatedAt: ""
  };
}

export function voiceProfileHash(input: { projectId: string; characterAssetId: string; prompt: string }) {
  return createHash("sha256").update(`${input.projectId}\n${input.characterAssetId}\n${input.prompt.trim()}`).digest("hex");
}

function projectShots(projectId: string) {
  return db.prepare("SELECT id,shot_number,title,parent_shot_id,sequence_relation,voice_bindings_json,dialogue FROM shots WHERE project_id=? ORDER BY shot_number").all(projectId) as Array<{
    id: string; shot_number: number; title: string; parent_shot_id: string | null; sequence_relation: string; voice_bindings_json: string; dialogue: string;
  }>;
}

export function shotsUsingCharacter(projectId: string, characterAssetId: string) {
  return projectShots(projectId).filter((shot) => parseJson<ShotVoiceBinding[]>(shot.voice_bindings_json || "[]", []).some((binding) => binding.characterAssetId === characterAssetId));
}

export function voiceLockImpact(audioId: string) {
  const audio = db.prepare("SELECT * FROM audio_assets WHERE id=?").get(audioId) as AudioRow | undefined;
  if (!audio) throw new Error("角色音色候选不存在。");
  if (audio.type !== "character_voice" || !audio.character_asset_id) throw new Error("只有绑定角色资产的角色音色候选才能锁定。");
  const shots = shotsUsingCharacter(audio.project_id, audio.character_asset_id);
  const activeVideoJobs = shots.length ? db.prepare(`SELECT id,shot_id,status FROM generation_jobs WHERE project_id=? AND kind='video' AND status IN ('draft','submitted','processing') AND shot_id IN (${shots.map(() => "?").join(",")})`).all(audio.project_id, ...shots.map((shot) => shot.id)) as Array<{ id: string; shot_id: string; status: string }> : [];
  const current = db.prepare("SELECT id,name,version FROM audio_assets WHERE project_id=? AND type='character_voice' AND character_asset_id=? AND status='locked' ORDER BY version DESC LIMIT 1").get(audio.project_id, audio.character_asset_id) as { id: string; name: string; version: number } | undefined;
  return {
    audioId, projectId: audio.project_id, characterAssetId: audio.character_asset_id,
    replacingAudioId: current && current.id !== audioId ? current.id : null,
    replacingAudioName: current && current.id !== audioId ? current.name : "",
    affectedShots: shots.map((shot) => ({ id: shot.id, shotNumber: shot.shot_number, title: shot.title })),
    activeVideoJobs
  };
}

export function invalidateShotCascade(projectId: string, rootShotIds: string[], clearRootImage: boolean) {
  const all = projectShots(projectId);
  const affected = new Set(rootShotIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const shot of all) {
      if (shot.sequence_relation === "seamless_continuation" && shot.parent_shot_id && affected.has(shot.parent_shot_id) && !affected.has(shot.id)) {
        affected.add(shot.id);
        changed = true;
      }
    }
  }
  const updateRoot = db.prepare("UPDATE shots SET status='stale',sample_approved=0,approved_image_job_id=NULL,approved_image_media_id=NULL,approved_video_job_id=NULL,observed_end_state='',observed_audio_state='',last_frame_media_id=NULL,updated_at=? WHERE id=? AND project_id=?");
  const updateDownstream = db.prepare("UPDATE shots SET status='stale',sample_approved=0,approved_video_job_id=NULL,observed_end_state='',observed_audio_state='',last_frame_media_id=NULL,updated_at=? WHERE id=? AND project_id=?");
  for (const shotId of affected) {
    if (clearRootImage && rootShotIds.includes(shotId)) updateRoot.run(now(), shotId, projectId);
    else updateDownstream.run(now(), shotId, projectId);
  }
  return all.filter((shot) => affected.has(shot.id)).map((shot) => ({ id: shot.id, shotNumber: shot.shot_number, title: shot.title, downstream: !rootShotIds.includes(shot.id) }));
}

export function lockVoiceAnchor(audioId: string, confirmInvalidation = false) {
  const impact = voiceLockImpact(audioId);
  const audio = db.prepare("SELECT * FROM audio_assets WHERE id=?").get(audioId) as AudioRow;
  if (impact.activeVideoJobs.length) throw new Error("受影响镜头仍有视频任务处理中，任务结束或失败后才能更换角色音色。");
  if (!(Number(audio.duration) >= 4 && Number(audio.duration) <= 5.5)) throw new Error("角色音色候选必须是4到5秒的短样本，当前时长不符合要求。");
  if (!audio.remote_url && !db.prepare("SELECT local_path FROM audio_assets WHERE id=? AND local_path!=''").get(audioId)) throw new Error("角色音色候选还没有可试听文件。");
  if (impact.replacingAudioId && impact.affectedShots.length && !confirmInvalidation) throw new Error(`更换音色会让 ${impact.affectedShots.length} 个镜头的视频状态失效，请确认影响后再继续。`);
  const stamp = now();
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE audio_assets SET status='superseded',locked_at=NULL,updated_at=? WHERE project_id=? AND type='character_voice' AND character_asset_id=? AND status='locked' AND id!=?").run(stamp, audio.project_id, audio.character_asset_id, audioId);
    db.prepare("UPDATE audio_assets SET status='locked',locked_at=?,updated_at=? WHERE id=?").run(stamp, stamp, audioId);
    if (impact.replacingAudioId) invalidateShotCascade(audio.project_id, impact.affectedShots.map((shot) => shot.id), false);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { ...impact, status: "locked" as const, lockedAt: stamp };
}

export function resolveShotVoiceReferences(shot: Shot, audioAssets: AudioAsset[]) {
  const lines = parseShotDialogue(shot.dialogue, shot.speakerMap);
  if (!lines.length) return { lines, resolved: [] as Array<{ binding: ShotVoiceBinding; audio: AudioAsset }>, errors: [] as string[], prompt: shot.videoPrompt, audioUrls: [] as string[] };
  const orderedSpeakers = [...new Set(lines.map((line) => line.speaker))];
  const resolved: Array<{ binding: ShotVoiceBinding; audio: AudioAsset }> = [];
  const errors: string[] = [];
  for (const speaker of orderedSpeakers) {
    const binding = shot.voiceBindings.find((item) => item.speaker.trim() === speaker.trim());
    if (!binding?.characterAssetId) { errors.push(`说话人“${speaker}”尚未绑定角色资产`); continue; }
    const audio = audioAssets.filter((item) => item.type === "character_voice" && item.characterAssetId === binding.characterAssetId && item.status === "locked").sort((a, b) => b.version - a.version)[0];
    if (!audio) { errors.push(`说话人“${speaker}”没有锁定角色音色`); continue; }
    if (!audio.seedanceAssetUrl.startsWith("asset://")) { errors.push(`说话人“${speaker}”的音色尚未通过Seedance审核`); continue; }
    if (audio.duration > 5.5 || audio.duration < 4) { errors.push(`说话人“${speaker}”的音色样本必须为4到5秒`); continue; }
    resolved.push({ binding, audio });
  }
  const unique = [...new Map(resolved.map((item) => [item.binding.characterAssetId, item])).values()];
  if (orderedSpeakers.length > 3 || unique.length > 3) errors.push("单镜头最多允许3个说话角色，请拆分镜头后再生成视频");
  const duration = unique.reduce((sum, item) => sum + item.audio.duration, 0);
  if (duration > 15) errors.push("角色音色锚点总时长超过15秒，请缩短样本或拆分镜头");
  return {
    lines, resolved: unique, errors,
    prompt: compileSeedanceVoicePrompt(shot, unique),
    audioUrls: unique.map((item) => item.audio.seedanceAssetUrl)
  };
}

export function voiceSnapshot(resolved: Array<{ binding: ShotVoiceBinding; audio: AudioAsset }>) {
  return resolved.map(({ binding, audio }, index) => ({
    reference: `@Audio${index + 1}`, speaker: binding.speaker, characterAssetId: binding.characterAssetId,
    audioAssetId: audio.id, version: audio.version, voiceProfileHash: audio.voiceProfileHash, seedanceAssetUrl: audio.seedanceAssetUrl,
    duration: audio.duration
  }));
}

export function writeVoiceBindings(shotId: string, bindings: ShotVoiceBinding[]) {
  db.prepare("UPDATE shots SET voice_bindings_json=?,updated_at=? WHERE id=?").run(asJson(bindings), now(), shotId);
}
