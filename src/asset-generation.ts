import type { Asset, GenerationJob } from "../shared/types";

export function assetImageSize(asset: Pick<Asset, "type" | "negativePrompt">) {
  const match = asset.negativePrompt.match(/APIMart参数：(\{[^\n]+\})/);
  if (match) {
    try {
      const value = JSON.parse(match[1]) as { size?: unknown };
      if (typeof value.size === "string" && value.size) return value.size;
    } catch {
      // Fall back to a sensible standard ratio for manually created assets.
    }
  }
  if (asset.type === "scene") return "16:9";
  if (asset.type === "character" || asset.type === "style") return "3:2";
  return "1:1";
}

export function isActiveAssetResultJob(job: Pick<GenerationJob, "status">) {
  return job.status === "draft" || job.status === "submitted" || job.status === "processing";
}
