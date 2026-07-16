import type { Project, ReviewGate, WorkflowStage } from "../shared/types.js";
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
