import { describe, expect, it } from "vitest";
import { globalSettingsRoute, projectRoute } from "./navigation";
import { canAccessSection, getNavigationState, getStageAction } from "./workflow-ui";
import { workflowStages } from "../shared/types";

describe("projectRoute", () => {
  it("always builds navigation from the project root", () => {
    expect(projectRoute("prj_123", "assets")).toBe("/project/prj_123/assets");
    expect(projectRoute("prj_123", "storyboard")).toBe("/project/prj_123/storyboard");
    expect(projectRoute("prj_123")).toBe("/project/prj_123");
  });
});

describe("globalSettingsRoute", () => {
  it("keeps a safe one-click return path to the originating project", () => {
    expect(globalSettingsRoute("/project/prj_123")).toBe("/settings?from=%2Fproject%2Fprj_123");
    expect(globalSettingsRoute()).toBe("/settings");
  });
});

describe("桌面工作台阶段规则", () => {
  it("14个阶段都有唯一的当前任务入口和明确按钮", () => {
    const actions = workflowStages.map((stage) => getStageAction(stage));
    expect(actions).toHaveLength(14);
    actions.forEach((action) => {
      expect(action.section).toMatch(/^(script|assets|storyboard|preview)$/);
      expect(action.label.trim().length).toBeGreaterThan(3);
      expect(action.description.trim().length).toBeGreaterThan(8);
    });
  });

  it.each([
    ["idea", false, false, false, false],
    ["script_user_review", true, false, false, false],
    ["asset_user_review", true, true, false, false],
    ["storyboard_user_review", true, true, true, false],
    ["final_review", true, true, true, true]
  ] as const)("%s阶段只开放已经到达的制作页面", (stage, script, assets, storyboard, preview) => {
    expect(canAccessSection(stage, "script")).toBe(script);
    expect(canAccessSection(stage, "assets")).toBe(assets);
    expect(canAccessSection(stage, "audio")).toBe(assets);
    expect(canAccessSection(stage, "storyboard")).toBe(storyboard);
    expect(canAccessSection(stage, "preview")).toBe(preview);
    expect(canAccessSection(stage, "dashboard")).toBe(true);
    expect(canAccessSection(stage, "jobs")).toBe(true);
  });

  it("旧项目只要已经存在剧本，仍可进入剧本历史页", () => {
    expect(canAccessSection("idea", "script", true)).toBe(true);
  });

  it("导航能区分当前、已完成和未解锁", () => {
    expect(getNavigationState("asset_user_review", "assets")).toBe("current");
    expect(getNavigationState("asset_user_review", "script")).toBe("completed");
    expect(getNavigationState("asset_user_review", "storyboard")).toBe("locked");
  });

  it("全部声音切片确认并绑定后，声音生产导航显示完成", () => {
    expect(getNavigationState("storyboard_user_review", "audio", true, { audio: false })).toBe("available");
    expect(getNavigationState("storyboard_user_review", "audio", true, { audio: true })).toBe("completed");
  });
});
