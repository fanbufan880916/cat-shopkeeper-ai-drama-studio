import { describe, expect, it } from "vitest";
import type { Asset, GenerationJob, Shot } from "../shared/types";
import { sortTasks, taskObject } from "./task-ui";

describe("任务中心名称与排序", () => {
  it("优先显示资产名或镜头编号和镜头名", () => {
    const assets = [{ id: "ast_1", name: "猫掌柜角色" }] as Asset[];
    const shots = [{ id: "shot_1", shotNumber: 3, title: "递鞋特写" }] as Shot[];
    expect(taskObject({ id: "job_1", assetId: "ast_1", shotId: null }, assets, shots).label).toBe("猫掌柜角色");
    expect(taskObject({ id: "job_2", assetId: null, shotId: "shot_1" }, assets, shots).label).toBe("镜头 03 · 递鞋特写");
  });

  it("历史来源已删除时显示明确状态且不提供失效入口", () => {
    const result = taskObject({ id: "job_old", assetId: "ast_deleted", shotId: null }, [], []);
    expect(result.label).toBe("历史资产（已不存在）");
    expect(result.sourceId).toBeNull();
  });

  it("默认把处理中和失败任务排在前面，已取消放最后", () => {
    const jobs = [
      { id: "done", status: "completed", createdAt: "3" },
      { id: "cancelled", status: "cancelled", createdAt: "4" },
      { id: "failed", status: "failed", createdAt: "2" },
      { id: "processing", status: "processing", createdAt: "1" }
    ] as GenerationJob[];
    expect(sortTasks(jobs).map((job) => job.id)).toEqual(["processing", "failed", "done", "cancelled"]);
  });
});
