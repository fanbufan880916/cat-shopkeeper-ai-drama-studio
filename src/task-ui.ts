import type { Asset, AudioAsset, CodexImageRequest, GenerationJob, Shot } from "../shared/types";

const statusPriority: Record<string, number> = {
  processing: 0, failed: 1, submitted: 2, queued: 2, draft: 3, completed: 4, cancelled: 5
};

export function taskObject(job: Pick<GenerationJob, "assetId" | "shotId" | "id"> & { audioAssetId?: string | null }, assets: Asset[], shots: Shot[], audioAssets: AudioAsset[] = []) {
  if (job.assetId) {
    const asset = assets.find((item) => item.id === job.assetId);
    return {
      label: asset?.name ?? "历史资产（已不存在）",
      detail: job.id,
      section: "assets" as const,
      sourceId: asset ? job.assetId : null
    };
  }
  if (job.shotId) {
    const shot = shots.find((item) => item.id === job.shotId);
    return {
      label: shot ? `镜头 ${String(shot.shotNumber).padStart(2, "0")} · ${shot.title}` : "历史镜头（已不存在）",
      detail: job.id,
      section: "storyboard" as const,
      sourceId: shot ? job.shotId : null
    };
  }
  if (job.audioAssetId) {
    const audio = audioAssets.find((item) => item.id === job.audioAssetId);
    return { label: audio?.name ?? "历史声音资产（已不存在）", detail: job.id, section: "audio" as const, sourceId: audio ? job.audioAssetId : null };
  }
  return { label: "项目级任务", detail: job.id, section: "jobs" as const, sourceId: null };
}

export function codexTaskObject(request: CodexImageRequest, assets: Asset[], shots: Shot[]) {
  return taskObject({ id: request.id, assetId: request.assetId, audioAssetId: null, shotId: request.shotId }, assets, shots);
}

export function sortTasks<T extends { status: string; createdAt: string }>(tasks: T[]) {
  return tasks.slice().sort((a, b) => (statusPriority[a.status] ?? 9) - (statusPriority[b.status] ?? 9) || b.createdAt.localeCompare(a.createdAt));
}
