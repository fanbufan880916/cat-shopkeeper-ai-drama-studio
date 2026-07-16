import type { Asset, AssetType } from "../shared/types";

export type AssetUiStatus = "pending" | "reference_only" | "main_locked" | "needs_review";

export const assetUiStatusLabels: Record<AssetUiStatus, string> = {
  pending: "待生成",
  reference_only: "仅参考图",
  main_locked: "主图已锁定",
  needs_review: "需复核"
};

export function getAssetUiStatus(asset: Asset): AssetUiStatus {
  if (asset.status === "stale") return "needs_review";
  if (asset.status === "approved" && asset.approvedJobId && asset.referenceMediaId) return "main_locked";
  if (asset.referenceMediaId) return "reference_only";
  return "pending";
}

const priority: Record<AssetUiStatus, number> = {
  needs_review: 0,
  pending: 1,
  reference_only: 2,
  main_locked: 3
};

export function filterAndSortAssets(
  assets: Asset[],
  filters: { query?: string; type?: AssetType | "all"; status?: AssetUiStatus | "all" }
) {
  const query = filters.query?.trim().toLocaleLowerCase() ?? "";
  return assets
    .filter((asset) => !query || `${asset.name} ${asset.referenceCode} ${asset.description}`.toLocaleLowerCase().includes(query))
    .filter((asset) => !filters.type || filters.type === "all" || asset.type === filters.type)
    .filter((asset) => !filters.status || filters.status === "all" || getAssetUiStatus(asset) === filters.status)
    .slice()
    .sort((a, b) => priority[getAssetUiStatus(a)] - priority[getAssetUiStatus(b)] || a.name.localeCompare(b.name, "zh-CN"));
}
