import { decryptSecret } from "./crypto.js";
import { emitEvent } from "./events.js";
import { persistRemoteOutputs } from "./media.js";
import { APIMartProvider } from "./providers/apimart.js";
import { MockProvider } from "./providers/mock.js";
import { VolcengineAudioProvider } from "./providers/volcengine-audio.js";
import type { GenerationProvider } from "./providers/types.js";
import { db, store } from "./db.js";

const providers: Record<string, GenerationProvider> = { apimart: new APIMartProvider(), mock: new MockProvider(), volcengine: new VolcengineAudioProvider() };
let running = false;
let timer: NodeJS.Timeout | null = null;

function apiKeyFor(provider: string) {
  if (provider === "mock") return "mock";
  const settingKey = provider === "volcengine" ? "volcengine_audio_api_key" : "apimart_api_key";
  const providerLabel = provider === "volcengine" ? "火山豆包音频" : "APIMart";
  const encrypted = store.getSetting(settingKey);
  if (!encrypted) throw new Error("尚未配置 APIMart API Key。");
  try {
    return decryptSecret(encrypted);
  } catch {
    throw new Error("本机保存的 APIMart API Key 已损坏，请在 API 设置中重新保存后再生成。");
  }
}

function nextPoll(attempt: number) {
  const delay = Math.min(30_000, 1500 * Math.pow(1.55, attempt));
  return new Date(Date.now() + delay).toISOString();
}

async function uploadLocalReference(localPath: string, provider: GenerationProvider, apiKey: string) {
  const existing = db.prepare("SELECT id,source_url,expires_at FROM media_files WHERE local_path=? ORDER BY created_at DESC LIMIT 1").get(localPath) as
    { id: string; source_url: string; expires_at: string | null } | undefined;
  const expiresSoon = !existing?.expires_at || new Date(existing.expires_at).getTime() < Date.now() + 5 * 60_000;
  if (existing?.source_url && !expiresSoon) return existing.source_url;
  if (!provider.uploadImage) return "";
  const uploaded = await provider.uploadImage(apiKey, localPath);
  if (existing) db.prepare("UPDATE media_files SET source_url=?,expires_at=? WHERE id=?").run(uploaded.url, uploaded.expiresAt, existing.id);
  return uploaded.url;
}

export async function attachLocalReferences(job: ReturnType<typeof store.getJob>, provider: GenerationProvider, apiKey: string) {
  if (!provider.uploadImage) return job;
  if (job.kind === "video" && job.shotId) {
    const shot = db.prepare("SELECT approved_image_media_id,parent_shot_id,sequence_relation,asset_ids_json FROM shots WHERE id=?").get(job.shotId) as
      { approved_image_media_id: string | null; parent_shot_id: string | null; sequence_relation: string; asset_ids_json: string } | undefined;
    if (!shot) return job;
    let firstFrame = shot.approved_image_media_id ? db.prepare("SELECT local_path FROM media_files WHERE id=? AND kind='image'").get(shot.approved_image_media_id) as { local_path: string } | undefined : undefined;
    if (shot.sequence_relation === "seamless_continuation" && shot.parent_shot_id) {
      firstFrame = db.prepare(`SELECT m.local_path FROM shots s JOIN media_files m ON m.id=s.last_frame_media_id WHERE s.id=?`).get(shot.parent_shot_id) as { local_path: string } | undefined;
    }
    const params = { ...job.params };
    const assetIds = Array.isArray(params.image_reference_asset_ids)
      ? params.image_reference_asset_ids.filter((value): value is string => typeof value === "string")
      : JSON.parse(shot.asset_ids_json || "[]") as string[];
    const assetPaths = assetIds.length ? db.prepare(`
      SELECT m.local_path FROM assets a JOIN media_files m ON m.id=a.reference_media_id
      WHERE a.id IN (${assetIds.map(() => "?").join(",")})
    `).all(...assetIds) as { local_path: string }[] : [];
    const imagePaths = [...assetPaths.map((item) => item.local_path).filter(Boolean), ...(firstFrame?.local_path ? [firstFrame.local_path] : [])];
    const uploadedUrls = (await Promise.all([...new Set(imagePaths)].map((localPath) => uploadLocalReference(localPath, provider, apiKey)))).filter(Boolean);
    const existingImages = Array.isArray(params.image_urls) ? params.image_urls.filter((value): value is string => typeof value === "string" && Boolean(value)) : [];
    const hasMixedRefs = (Array.isArray(params.audio_urls) && params.audio_urls.length > 0) || (Array.isArray(params.video_urls) && params.video_urls.length > 0);
    if (hasMixedRefs || uploadedUrls.length > 1 || existingImages.length > 0) {
      params.image_urls = [...new Set([...existingImages, ...uploadedUrls])];
      delete params.image_with_roles;
    } else if (uploadedUrls[0]) {
      params.image_with_roles = [{ url: uploadedUrls[0], role: "first_frame" }];
    }
    delete params.image_reference_asset_ids;
    delete params.first_frame_media_id;
    delete params.continuity_parent_shot_id;
    delete params.audio_reference_mode;
    return { ...job, params };
  }
  if (job.kind !== "image") return job;
  const directReference = job.assetId ? db.prepare(`
    SELECT m.id, m.local_path, m.source_url, m.expires_at
    FROM assets a JOIN media_files m ON m.id=a.reference_media_id
    WHERE a.id=?
  `).get(job.assetId) as { local_path: string } | undefined : undefined;
  const shotReferences = job.shotId ? db.prepare(`
    SELECT m.local_path FROM shots s
    JOIN json_each(s.asset_ids_json) refs
    JOIN assets a ON a.id=refs.value
    JOIN media_files m ON m.id=a.reference_media_id
    WHERE s.id=? ORDER BY a.type,a.name
  `).all(job.shotId) as { local_path: string }[] : [];
  const localPaths = [...new Set([...(directReference?.local_path ? [directReference.local_path] : []), ...shotReferences.map((item) => item.local_path)])];
  if (!localPaths.length) return job;

  const existing = Array.isArray(job.params.image_urls)
    ? job.params.image_urls.filter((value) => typeof value === "string" && !value.startsWith("<"))
    : [];
  const uploadedUrls = (await Promise.all(localPaths.map((localPath) => uploadLocalReference(localPath, provider, apiKey)))).filter(Boolean);
  const params: Record<string, unknown> = { ...job.params, image_urls: [...new Set([...existing, ...uploadedUrls])] };
  return { ...job, params };
}

export async function processJobs() {
  if (running) return;
  running = true;
  try {
    for (const job of store.pendingJobs()) {
      if (job.provider === "codex") continue;
      if (job.nextPollAt && new Date(job.nextPollAt).getTime() > Date.now()) continue;
      const provider = providers[job.provider];
      try {
        if (job.status === "draft") {
          const apiKey = apiKeyFor(job.provider);
          const submittedJob = job.provider === "apimart" ? await attachLocalReferences(job, provider, apiKey) : job;
          if (submittedJob !== job) store.updateJob(job.id, { params: submittedJob.params });
          const submitted = await provider.submit(submittedJob, apiKey);
          let output = submitted.output ?? {};
          if (submitted.status === "completed") output = await persistRemoteOutputs(job.projectId, job.id, job.kind, output);
          store.updateJob(job.id, { params: submittedJob.params, externalTaskId: submitted.taskId, status: submitted.status === "completed" ? "completed" : "submitted", progress: submitted.status === "completed" ? 100 : 0, output, attempt: job.attempt + 1, nextPollAt: submitted.status === "completed" ? null : nextPoll(job.attempt) });
          if (submitted.status === "completed" && job.kind === "audio") {
            const result = output as { localPaths?: string[]; audioUrl?: string; original_duration?: number; duration?: number };
            const audioAssetId = String((submittedJob.params as Record<string, unknown>).audioAssetId ?? "");
            if (audioAssetId && result.localPaths?.[0]) {
              db.prepare("UPDATE audio_assets SET local_path=?,remote_url=?,duration=?,updated_at=? WHERE id=?").run(result.localPaths[0], result.audioUrl ?? "", Number(result.original_duration ?? result.duration ?? 0), new Date().toISOString(), audioAssetId);
            }
          }
          emitEvent("job.updated", { projectId: job.projectId, jobId: job.id });
          continue;
        }
        const result = await provider.poll(job, apiKeyFor(job.provider));
        let output = result.output ?? {};
        if (result.status === "completed") output = await persistRemoteOutputs(job.projectId, job.id, job.kind, output);
        store.updateJob(job.id, { status: result.status, progress: result.progress, cost: result.cost ?? job.cost,
          creditsCost: result.creditsCost ?? job.creditsCost, output, error: result.error ?? "", attempt: job.attempt + 1,
          nextPollAt: result.status === "submitted" || result.status === "processing" ? nextPoll(job.attempt) : null });
        emitEvent("job.updated", { projectId: job.projectId, jobId: job.id });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const retryable = job.attempt < 5 && /频繁|暂时|timeout|fetch|网络/i.test(message);
        store.updateJob(job.id, { status: retryable ? "processing" : "failed", error: message, attempt: job.attempt + 1, nextPollAt: retryable ? nextPoll(job.attempt + 2) : null });
        emitEvent("job.updated", { projectId: job.projectId, jobId: job.id });
      }
    }
  } finally {
    running = false;
  }
}

export function startWorker() {
  if (timer) return;
  timer = setInterval(() => void processJobs(), 1200);
  void processJobs();
}

export function stopWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
