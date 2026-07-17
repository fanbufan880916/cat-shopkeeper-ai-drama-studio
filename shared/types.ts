export const workflowStages = [
  "idea",
  "script_internal_review",
  "script_user_review",
  "asset_design",
  "asset_user_review",
  "storyboard_design",
  "storyboard_user_review",
  "sample_image",
  "sample_video",
  "batch_generation",
  "edit_prepare",
  "edit_render",
  "final_review",
  "completed"
] as const;

export type WorkflowStage = (typeof workflowStages)[number];
export type ArtifactType = "idea" | "script" | "director_review" | "audience_review" | "asset_plan" | "storyboard" | "final_export";
export type ReviewGate = "director" | "audience" | "script_user" | "asset_user" | "storyboard_user" | "final_user";
export type ReviewDecision = "approved" | "rejected";
export type AssetType = "character" | "scene" | "prop" | "style";
export type JobKind = "image" | "video" | "audio" | "audio_registration" | "preview" | "edit";
export type JobStatus = "draft" | "submitted" | "processing" | "completed" | "failed" | "cancelled";
export type EditStatus = "draft" | "queued" | "running" | "completed" | "failed" | "cancelled";
export type CodexImageRequestStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";
export type ShotRelation = "sequence_first_clip" | "intentional_next_shot" | "seamless_continuation" | "reanchor_after_drift";
export type AudioAssetType = "character_voice" | "dialogue_line" | "scene_master" | "music" | "ambience" | "sfx";
export type AudioAssetStatus = "draft" | "locked" | "superseded";
export type ShotAudioMode = "generated" | "voice_reference" | "dialogue_lipsync" | "music_sync" | "silent";
export interface ShotVoiceBinding { speaker: string; characterAssetId: string; }
export type AudioClipStatus = "draft" | "ready" | "approved" | "rejected";
export type ContentMode = "short_film" | "ad" | "mv";
export type VisualStyleStatus = "needs_review" | "locked";

export interface VisualStyleProfile {
  status: VisualStyleStatus;
  name: string;
  descriptors: string[];
  evidence: string;
  source: "script" | "user" | "style_asset" | "none";
  sourceArtifactId: string | null;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  template: string;
  dryRun: boolean;
  aspectRatio: string;
  targetDuration: number;
  contentMode: ContentMode;
  targetPlatform: string;
  targetAudience: string;
  creativePurpose: string;
  targetEmotion: string;
  visualStyle: VisualStyleProfile;
  stage: WorkflowStage;
  internalRevisionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactVersion {
  id: string;
  projectId: string;
  type: ArtifactType;
  version: number;
  title: string;
  content: unknown;
  status: "draft" | "review" | "locked" | "superseded";
  createdBy: string;
  createdAt: string;
}

export interface Review {
  id: string;
  projectId: string;
  artifactId: string | null;
  gate: ReviewGate;
  decision: ReviewDecision;
  scores: Record<string, number>;
  feedback: string;
  createdAt: string;
}

export interface Asset {
  id: string;
  projectId: string;
  type: AssetType;
  name: string;
  referenceCode: string;
  description: string;
  identityAnchor: string;
  prompt: string;
  negativePrompt: string;
  status: "draft" | "approved" | "stale";
  version: number;
  referenceMediaId: string | null;
  approvedJobId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Shot {
  id: string;
  projectId: string;
  shotNumber: number;
  title: string;
  duration: number;
  narrativePurpose: string;
  composition: string;
  camera: string;
  action: string;
  dialogue: string;
  imagePrompt: string;
  videoPrompt: string;
  assetIds: string[];
  sceneId: string;
  parentShotId: string | null;
  sequenceRelation: ShotRelation;
  feltIntent: string;
  plannedStartState: string;
  plannedEndState: string;
  alreadyHappened: string;
  reservedForLater: string;
  continuityLocks: string;
  allowedChanges: string;
  audioMode: ShotAudioMode;
  audioAssetIds: string[];
  voiceBindings: ShotVoiceBinding[];
  videoReferenceMediaIds: string[];
  speakerMap: string;
  audioDirection: string;
  lipSyncNotes: string;
  status: "draft" | "approved" | "stale";
  sampleApproved: boolean;
  approvedImageJobId: string | null;
  approvedImageMediaId: string | null;
  approvedVideoJobId: string | null;
  observedEndState: string;
  observedAudioState: string;
  lastFrameMediaId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GenerationJob {
  id: string;
  projectId: string;
  shotId: string | null;
  assetId: string | null;
  audioAssetId: string | null;
  kind: JobKind;
  provider: "apimart" | "mock" | "codex" | "volcengine";
  model: string;
  prompt: string;
  params: Record<string, unknown>;
  externalTaskId: string | null;
  status: JobStatus;
  progress: number;
  cost: number;
  creditsCost: number;
  output: unknown;
  error: string;
  attempt: number;
  nextPollAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EditClip {
  shotId: string;
  videoPath: string;
  startTime: number;
  duration: number;
  audioPath: string | null;
  subtitle: string;
  transition: string;
}

export interface EditManifest {
  projectId: string;
  version: number;
  aspectRatio: string;
  targetDuration: number;
  subtitleSafeArea: "9:16-safe";
  generatedAt: string;
  clips: EditClip[];
  music: { path: string; volume: number } | null;
  output: { path: string; format: "mp4"; resolution: string };
}

export interface EditQualityReport {
  ok: boolean;
  checkedAt: string;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  metadata: { duration?: number; width?: number; height?: number; hasAudio?: boolean; sizeBytes?: number };
}

export interface EditJob {
  id: string;
  projectId: string;
  status: EditStatus;
  adapter: string;
  cliPath: string;
  manifestPath: string;
  planPath: string;
  projectRoot: string;
  outputPath: string;
  version: number;
  commandOutput: string;
  error: string;
  qualityReport: EditQualityReport | null;
  finalReviewStatus: "pending" | "approved" | "rejected" | null;
  exportedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MediaFile {
  id: string;
  projectId: string;
  jobId: string | null;
  kind: "image" | "video" | "audio";
  localPath: string;
  sourceUrl: string;
  expiresAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AudioAsset {
  id: string;
  projectId: string;
  type: AudioAssetType;
  name: string;
  characterAssetId: string | null;
  localPath: string;
  remoteUrl: string;
  duration: number;
  rightsNote: string;
  description: string;
  status: AudioAssetStatus;
  version: number;
  sourceJobId: string | null;
  sourceExpiresAt: string | null;
  voiceProfileHash: string;
  seedanceAssetUrl: string;
  registrationJobId: string | null;
  lockedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AudioClip {
  id: string;
  projectId: string;
  sourceAudioAssetId: string;
  audioAssetId: string;
  shotId: string | null;
  speaker: string;
  text: string;
  startMs: number;
  endMs: number;
  handleMs: number;
  status: AudioClipStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface CodexImageRequest {
  id: string;
  projectId: string;
  assetId: string | null;
  shotId: string | null;
  prompt: string;
  negativePrompt: string;
  aspectRatio: string;
  quality: "standard" | "high";
  resolution: string;
  count: number;
  referencePaths: string[];
  status: CodexImageRequestStatus;
  resultJobId: string | null;
  error: string;
  createdAt: string;
  updatedAt: string;
}

export interface RevisionRequest {
  id: string;
  projectId: string;
  targetType: "script" | "asset" | "storyboard" | "image" | "video" | "final";
  targetId: string | null;
  category: string;
  feedback: string;
  status: "open" | "in_progress" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
}

export interface DashboardData {
  project: Project;
  artifacts: ArtifactVersion[];
  reviews: Review[];
  assets: Asset[];
  shots: Shot[];
  jobs: GenerationJob[];
  editJobs: EditJob[];
  mediaFiles: MediaFile[];
  audioAssets: AudioAsset[];
  audioClips: AudioClip[];
  codexImageRequests: CodexImageRequest[];
  revisions: RevisionRequest[];
  skillStatus: Array<Record<string, unknown>>;
}

export const stageLabels: Record<WorkflowStage, string> = {
  idea: "创意",
  script_internal_review: "剧本内部审核",
  script_user_review: "剧本审核",
  asset_design: "资产设计",
  asset_user_review: "资产审核",
  storyboard_design: "分镜生产",
  storyboard_user_review: "完整分镜审核",
  sample_image: "样片生图",
  sample_video: "样片视频",
  batch_generation: "批量生成",
  edit_prepare: "剪辑准备",
  edit_render: "剪辑导出",
  final_review: "成片审核",
  completed: "已完成"
};
