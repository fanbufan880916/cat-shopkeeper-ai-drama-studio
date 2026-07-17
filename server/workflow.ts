import type { ArtifactType, Project, ReviewGate, WorkflowStage } from "../shared/types.js";
import { styleGateMessage } from "../shared/creative-profile.js";

export const nextStageForGate: Partial<Record<ReviewGate, WorkflowStage>> = {
  director: "script_internal_review",
  audience: "script_user_review",
  script_user: "asset_design",
  asset_user: "storyboard_design",
  storyboard_user: "sample_image",
  final_user: "completed"
};

export function assertGateAllowed(stage: WorkflowStage, gate: ReviewGate) {
  const allowed: Record<ReviewGate, WorkflowStage[]> = {
    director: ["script_internal_review"],
    audience: ["script_internal_review"],
    script_user: ["script_user_review"],
    asset_user: ["asset_user_review"],
    storyboard_user: ["storyboard_user_review"],
    final_user: ["final_review"]
  };
  if (!allowed[gate].includes(stage)) {
    throw new Error(`当前阶段“${stage}”不能执行“${gate}”审核。`);
  }
}

export function scoresPass(scores: Record<string, number>) {
  const values = Object.values(scores);
  if (!values.length) return false;
  return values.every((score) => score >= 3) && values.reduce((sum, score) => sum + score, 0) / values.length >= 4;
}

export function assertVisualStyleLocked(project: Project) {
  if (project.visualStyle.status !== "locked" || !project.visualStyle.name.trim()) {
    throw new Error(styleGateMessage(project));
  }
}

export function assertArtifactWriteAllowed(stage: WorkflowStage, type: ArtifactType) {
  const allowed: Record<ArtifactType, WorkflowStage[]> = {
    idea: ["idea"],
    script: ["idea", "script_internal_review"],
    director_review: ["script_internal_review"],
    audience_review: ["script_internal_review"],
    asset_plan: ["asset_design", "asset_user_review"],
    storyboard: ["storyboard_design", "storyboard_user_review"],
    final_export: []
  };
  if (!allowed[type].includes(stage)) {
    if (type === "final_export") throw new Error("成片预览只能由预览接口根据全部已通过镜头生成，不能直接写入导出产物。");
    throw new Error(`当前阶段“${stage}”不能写入“${type}”产物。`);
  }
}

export function assertEditPrepareAllowed(stage: WorkflowStage) {
  if (!(["batch_generation", "edit_prepare"] as WorkflowStage[]).includes(stage)) {
    throw new Error(`当前阶段“${stage}”不能生成剪辑清单。请先让全部镜头视频通过审核。`);
  }
}

export function assertEditRenderAllowed(stage: WorkflowStage) {
  if (!(["edit_prepare", "edit_render"] as WorkflowStage[]).includes(stage)) {
    throw new Error(`当前阶段“${stage}”不能调用剪映导出。请先生成并确认剪辑清单。`);
  }
}

export function assertShotWriteAllowed(stage: WorkflowStage) {
  const allowed: WorkflowStage[] = ["storyboard_design", "storyboard_user_review", "sample_image", "sample_video", "batch_generation"];
  if (!allowed.includes(stage)) throw new Error(`当前阶段“${stage}”不能新增或修改分镜。`);
}
