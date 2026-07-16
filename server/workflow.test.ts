import { describe, expect, it } from "vitest";
import { assertArtifactWriteAllowed, assertGateAllowed, assertShotWriteAllowed, assertVisualStyleLocked, scoresPass } from "./workflow.js";

describe("workflow guards", () => {
  it("requires strong internal review scores", () => {
    expect(scoresPass({ core: 4, cinema: 4, pace: 4 })).toBe(true);
    expect(scoresPass({ core: 5, cinema: 2, pace: 5 })).toBe(false);
    expect(scoresPass({ core: 3, cinema: 3, pace: 3 })).toBe(false);
  });

  it("blocks reviews at the wrong stage", () => {
    expect(() => assertGateAllowed("script_internal_review", "director")).not.toThrow();
    expect(() => assertGateAllowed("idea", "director")).toThrow();
    expect(() => assertGateAllowed("asset_user_review", "asset_user")).not.toThrow();
  });

  it("blocks artifacts and shots from skipping future stages", () => {
    expect(() => assertArtifactWriteAllowed("idea", "script")).not.toThrow();
    expect(() => assertArtifactWriteAllowed("idea", "storyboard")).toThrow(/不能写入/);
    expect(() => assertArtifactWriteAllowed("batch_generation", "final_export")).toThrow(/预览接口/);
    expect(() => assertShotWriteAllowed("storyboard_design")).not.toThrow();
    expect(() => assertShotWriteAllowed("idea")).toThrow(/不能新增或修改分镜/);
    expect(() => assertShotWriteAllowed("completed")).toThrow(/不能新增或修改分镜/);
  });

  it("blocks real generation until the visual style is locked", () => {
    const project = {
      id: "p", name: "test", description: "", template: "", dryRun: false, aspectRatio: "9:16", targetDuration: 30,
      contentMode: "short_film" as const, targetPlatform: "douyin", targetAudience: "", creativePurpose: "", targetEmotion: "",
      visualStyle: { status: "needs_review" as const, name: "", descriptors: [], evidence: "", source: "none" as const, sourceArtifactId: null },
      stage: "sample_image" as const, internalRevisionCount: 0, createdAt: "", updatedAt: ""
    };
    expect(() => assertVisualStyleLocked(project)).toThrow(/视觉风格/);
    expect(() => assertVisualStyleLocked({ ...project, visualStyle: { ...project.visualStyle, status: "locked", name: "现代现实主义" } })).not.toThrow();
  });
});
