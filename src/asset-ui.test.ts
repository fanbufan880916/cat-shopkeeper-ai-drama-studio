import { describe, expect, it } from "vitest";
import type { Asset } from "../shared/types";
import { filterAndSortAssets, getAssetUiStatus } from "./asset-ui";

function asset(patch: Partial<Asset>): Asset {
  return {
    id: "ast_1", projectId: "prj_1", type: "character", name: "资产", referenceCode: "",
    description: "", identityAnchor: "", prompt: "", negativePrompt: "", status: "draft",
    version: 1, referenceMediaId: null, approvedJobId: null, createdAt: "", updatedAt: "", ...patch
  };
}

describe("资产中心状态与筛选", () => {
  it("只使用四种不冲突的用户状态", () => {
    expect(getAssetUiStatus(asset({ status: "draft" }))).toBe("pending");
    expect(getAssetUiStatus(asset({ referenceMediaId: "med_1" }))).toBe("reference_only");
    expect(getAssetUiStatus(asset({ status: "approved", approvedJobId: "job_1", referenceMediaId: "med_1" }))).toBe("main_locked");
    expect(getAssetUiStatus(asset({ status: "stale", approvedJobId: "job_1", referenceMediaId: "med_1" }))).toBe("needs_review");
  });

  it("默认把需复核和未锁定资产排在前面", () => {
    const result = filterAndSortAssets([
      asset({ id: "locked", name: "已锁定", status: "approved", approvedJobId: "job_1", referenceMediaId: "med_1" }),
      asset({ id: "reference", name: "仅参考", referenceMediaId: "med_2" }),
      asset({ id: "pending", name: "待生成" }),
      asset({ id: "stale", name: "需复核", status: "stale" })
    ], {});
    expect(result.map((item) => item.id)).toEqual(["stale", "pending", "reference", "locked"]);
  });

  it("名称、类型和状态筛选不会改变项目总资产集合", () => {
    const source = [asset({ id: "a", name: "阿强" }), asset({ id: "b", name: "雨夜", type: "scene", referenceMediaId: "med_1" })];
    expect(filterAndSortAssets(source, { query: "雨", type: "scene", status: "reference_only" }).map((item) => item.id)).toEqual(["b"]);
    expect(source).toHaveLength(2);
  });
});
