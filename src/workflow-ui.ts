import { workflowStages, type WorkflowStage } from "../shared/types";

export type WorkspaceSection = "dashboard" | "script" | "assets" | "audio" | "storyboard" | "jobs" | "preview";
export type StageNavigationState = "available" | "completed" | "current" | "locked";

export interface StageAction {
  section: Exclude<WorkspaceSection, "jobs">;
  label: string;
  description: string;
}

export interface NavigationCompletion {
  audio?: boolean;
}

const stageActions: Record<WorkflowStage, StageAction> = {
  idea: { section: "script", label: "进入剧本准备", description: "先让编剧 Agent 产出第一版剧本。" },
  script_internal_review: { section: "script", label: "查看内部审核", description: "查看总导演与观众 Agent 的审核进度。" },
  script_user_review: { section: "script", label: "审阅剧本", description: "确认当前剧本，或写明具体意见退回修改。" },
  asset_design: { section: "assets", label: "查看资产设计", description: "检查角色、场景、道具和视觉风格是否完整。" },
  asset_user_review: { section: "assets", label: "审核资产", description: "逐项锁定资产主图，再通过完整资产审核。" },
  storyboard_design: { section: "storyboard", label: "继续制作分镜", description: "等待分镜 Agent 写入镜头，或人工补录镜头。" },
  storyboard_user_review: { section: "storyboard", label: "审核完整分镜", description: "确认镜头顺序、叙事、画面和连续性设计。" },
  sample_image: { section: "storyboard", label: "确认代表性首帧", description: "先通过代表性首帧，再开放视频样片。" },
  sample_video: { section: "storyboard", label: "确认代表性视频", description: "先确认视频样片的动作、声音和连续性。" },
  batch_generation: { section: "storyboard", label: "继续批量生成", description: "逐镜头完成首帧、声音、视频和尾帧确认。" },
  final_review: { section: "preview", label: "审核成片", description: "查看已保存的最新预览版本并完成最终审核。" },
  completed: { section: "preview", label: "查看已完成成片", description: "项目已经完成，可以查看最终版本和历史记录。" }
};

const unlockStage: Partial<Record<WorkspaceSection, WorkflowStage>> = {
  script: "script_internal_review",
  assets: "asset_design",
  audio: "asset_design",
  storyboard: "storyboard_design",
  preview: "final_review"
};

const unlockReason: Partial<Record<WorkspaceSection, string>> = {
  script: "需要先由剧本 Agent 产出剧本或进入剧本阶段。",
  assets: "剧本通过后才会解锁资产中心。",
  audio: "剧本通过后才会解锁声音生产。",
  storyboard: "资产审核通过并进入分镜设计后才会解锁。",
  preview: "全部镜头视频通过并进入成片审核后才会解锁。"
};

function stageIndex(stage: WorkflowStage) {
  return workflowStages.indexOf(stage);
}

export function getStageAction(stage: WorkflowStage): StageAction {
  return stageActions[stage];
}

export function canAccessSection(stage: WorkflowStage, section: WorkspaceSection, hasScript = false) {
  if (section === "dashboard" || section === "jobs") return true;
  if (section === "script" && hasScript) return true;
  const required = unlockStage[section];
  return required ? stageIndex(stage) >= stageIndex(required) : true;
}

export function getSectionUnlockReason(section: WorkspaceSection) {
  return unlockReason[section] ?? "请先完成当前制作阶段。";
}

export function getNavigationState(
  stage: WorkflowStage,
  section: WorkspaceSection,
  hasScript = false,
  completion: NavigationCompletion = {}
): StageNavigationState {
  if (!canAccessSection(stage, section, hasScript)) return "locked";
  const current = getStageAction(stage).section;
  if (section === current) return "current";
  const index = stageIndex(stage);
  if (section === "script" && index > stageIndex("script_user_review")) return "completed";
  if (section === "assets" && index > stageIndex("asset_user_review")) return "completed";
  if (section === "audio" && completion.audio) return "completed";
  if (section === "audio" && index >= stageIndex("final_review")) return "completed";
  if (section === "storyboard" && index >= stageIndex("final_review")) return "completed";
  if (section === "preview" && stage === "completed") return "completed";
  return "available";
}

export function sectionPath(section: WorkspaceSection) {
  return section === "dashboard" ? "" : section;
}
