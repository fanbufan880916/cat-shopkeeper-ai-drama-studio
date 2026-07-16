import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ArtifactType, Asset, AudioAsset, AudioClip, CodexImageRequest, DashboardData, GenerationJob, MediaFile, Project, Review, Shot, WorkflowStage, ContentMode, VisualStyleProfile } from "../shared/types.js";
import { dataDir, dbPath, previewDir } from "./paths.js";
import { asJson, id, now, parseJson } from "./utils.js";
import { cleanIdentityAnchor, cleanImagePrompt, extractAssetReferenceCode } from "../shared/image-prompt.js";
import { inferVisualStyleProfile } from "../shared/creative-profile.js";

fs.mkdirSync(dataDir, { recursive: true });
export const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', template TEXT NOT NULL,
  aspect_ratio TEXT NOT NULL, target_duration INTEGER NOT NULL,
  content_mode TEXT NOT NULL DEFAULT 'short_film', target_platform TEXT NOT NULL DEFAULT 'douyin',
  visual_style_status TEXT NOT NULL DEFAULT 'needs_review', visual_style_json TEXT NOT NULL DEFAULT '{}', stage TEXT NOT NULL,
  internal_revision_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL, version INTEGER NOT NULL, title TEXT NOT NULL, content_json TEXT NOT NULL,
  status TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(project_id, type, version)
);
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  artifact_id TEXT, gate TEXT NOT NULL, decision TEXT NOT NULL, scores_json TEXT NOT NULL,
  feedback TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL, name TEXT NOT NULL, reference_code TEXT NOT NULL DEFAULT '', description TEXT NOT NULL, identity_anchor TEXT NOT NULL,
  prompt TEXT NOT NULL, negative_prompt TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL,
  reference_media_id TEXT, approved_job_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shots (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  shot_number INTEGER NOT NULL, title TEXT NOT NULL, duration REAL NOT NULL, narrative_purpose TEXT NOT NULL,
  composition TEXT NOT NULL, camera TEXT NOT NULL, action TEXT NOT NULL, dialogue TEXT NOT NULL,
  image_prompt TEXT NOT NULL, video_prompt TEXT NOT NULL, asset_ids_json TEXT NOT NULL,
  status TEXT NOT NULL, sample_approved INTEGER NOT NULL DEFAULT 0, observed_end_state TEXT NOT NULL DEFAULT '',
  observed_audio_state TEXT NOT NULL DEFAULT '',
  last_frame_media_id TEXT, scene_id TEXT NOT NULL DEFAULT '', parent_shot_id TEXT,
  sequence_relation TEXT NOT NULL DEFAULT 'intentional_next_shot', felt_intent TEXT NOT NULL DEFAULT '',
  planned_start_state TEXT NOT NULL DEFAULT '', planned_end_state TEXT NOT NULL DEFAULT '',
  already_happened TEXT NOT NULL DEFAULT '', reserved_for_later TEXT NOT NULL DEFAULT '',
  continuity_locks TEXT NOT NULL DEFAULT '', allowed_changes TEXT NOT NULL DEFAULT '',
  audio_mode TEXT NOT NULL DEFAULT 'generated', audio_asset_ids_json TEXT NOT NULL DEFAULT '[]', video_reference_media_ids_json TEXT NOT NULL DEFAULT '[]',
  speaker_map TEXT NOT NULL DEFAULT '', audio_direction TEXT NOT NULL DEFAULT '', lip_sync_notes TEXT NOT NULL DEFAULT '',
  approved_image_job_id TEXT, approved_image_media_id TEXT, approved_video_job_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(project_id, shot_number)
);
CREATE TABLE IF NOT EXISTS prompt_versions (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL,
  kind TEXT NOT NULL, version INTEGER NOT NULL, prompt TEXT NOT NULL, source_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS generation_jobs (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  shot_id TEXT, asset_id TEXT, kind TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
  prompt TEXT NOT NULL, params_json TEXT NOT NULL, external_task_id TEXT, status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0, cost REAL NOT NULL DEFAULT 0, credits_cost REAL NOT NULL DEFAULT 0,
  output_json TEXT NOT NULL DEFAULT '{}', error TEXT NOT NULL DEFAULT '', attempt INTEGER NOT NULL DEFAULT 0,
  next_poll_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS codex_image_requests (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asset_id TEXT, shot_id TEXT, prompt TEXT NOT NULL, negative_prompt TEXT NOT NULL DEFAULT '',
  aspect_ratio TEXT NOT NULL, quality TEXT NOT NULL, resolution TEXT NOT NULL DEFAULT '1k', count INTEGER NOT NULL DEFAULT 1,
  reference_paths_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL,
  result_job_id TEXT, error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS revision_requests (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL, target_id TEXT, category TEXT NOT NULL, feedback TEXT NOT NULL,
  status TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS media_files (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, job_id TEXT, kind TEXT NOT NULL, local_path TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '', expires_at TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audio_assets (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL, name TEXT NOT NULL, character_asset_id TEXT, local_path TEXT NOT NULL DEFAULT '',
  remote_url TEXT NOT NULL DEFAULT '', duration REAL NOT NULL DEFAULT 0, rights_note TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audio_clips (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_audio_asset_id TEXT NOT NULL REFERENCES audio_assets(id) ON DELETE CASCADE,
  audio_asset_id TEXT NOT NULL REFERENCES audio_assets(id) ON DELETE CASCADE,
  shot_id TEXT REFERENCES shots(id) ON DELETE SET NULL,
  speaker TEXT NOT NULL DEFAULT '', text TEXT NOT NULL DEFAULT '', start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL, handle_ms INTEGER NOT NULL DEFAULT 150, status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS skill_status (
  name TEXT PRIMARY KEY, version TEXT NOT NULL, source TEXT NOT NULL, commit_hash TEXT NOT NULL DEFAULT '',
  checksum TEXT NOT NULL DEFAULT '', valid INTEGER NOT NULL DEFAULT 0, details TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
);
`);

const projectColumns = db.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
const addProjectColumn = (name: string, definition: string) => { if (!projectColumns.some((column) => column.name === name)) db.exec(`ALTER TABLE projects ADD COLUMN ${name} ${definition}`); };
addProjectColumn("content_mode", "TEXT NOT NULL DEFAULT 'short_film'");
addProjectColumn("target_platform", "TEXT NOT NULL DEFAULT 'douyin'");
addProjectColumn("visual_style_status", "TEXT NOT NULL DEFAULT 'needs_review'");
addProjectColumn("visual_style_json", "TEXT NOT NULL DEFAULT '{}'");

// The previous workbench release treated the existing cat-shopkeeper project as a
// Hong Kong 90s project. Preserve those files as history, but remove them from
// the active visual source until the director confirms a new style.
function storeMigrationApplied(key: string) {
  return Boolean(db.prepare("SELECT value FROM settings WHERE key=?").get(key));
}
if (!storeMigrationApplied("creative_profile_v1")) {
  db.prepare("UPDATE projects SET visual_style_status='needs_review',visual_style_json=? WHERE name=?").run(
    asJson(inferVisualStyleProfile("")), "猫掌柜·洗鞋的温度");
  const legacyProject = db.prepare("SELECT id FROM projects WHERE name=?").get("猫掌柜·洗鞋的温度") as { id: string } | undefined;
  if (legacyProject) {
    db.prepare("UPDATE assets SET status='stale',approved_job_id=NULL,updated_at=? WHERE project_id=? AND type='style' AND reference_code LIKE 'STYLE_HK90%'").run(now(), legacyProject.id);
    db.prepare("UPDATE shots SET status='stale',sample_approved=0,approved_image_job_id=NULL,approved_image_media_id=NULL,approved_video_job_id=NULL,updated_at=? WHERE project_id=? AND EXISTS (SELECT 1 FROM json_each(shots.asset_ids_json) WHERE value IN (SELECT id FROM assets WHERE project_id=? AND type='style' AND reference_code LIKE 'STYLE_HK90%'))").run(now(), legacyProject.id, legacyProject.id);
  }
  db.prepare("INSERT INTO settings (key,value,updated_at) VALUES (?,?,?)").run("creative_profile_v1", "legacy-style-marked-stale", now());
}

const assetColumns = db.prepare("PRAGMA table_info(assets)").all() as { name: string }[];
if (!assetColumns.some((column) => column.name === "reference_code")) db.exec("ALTER TABLE assets ADD COLUMN reference_code TEXT NOT NULL DEFAULT ''");
if (!assetColumns.some((column) => column.name === "approved_job_id")) db.exec("ALTER TABLE assets ADD COLUMN approved_job_id TEXT");
const shotColumns = db.prepare("PRAGMA table_info(shots)").all() as { name: string }[];
const addShotColumn = (name: string, definition: string) => { if (!shotColumns.some((column) => column.name === name)) db.exec(`ALTER TABLE shots ADD COLUMN ${name} ${definition}`); };
addShotColumn("scene_id", "TEXT NOT NULL DEFAULT ''");
addShotColumn("observed_audio_state", "TEXT NOT NULL DEFAULT ''");
addShotColumn("parent_shot_id", "TEXT");
addShotColumn("sequence_relation", "TEXT NOT NULL DEFAULT 'intentional_next_shot'");
addShotColumn("felt_intent", "TEXT NOT NULL DEFAULT ''");
addShotColumn("planned_start_state", "TEXT NOT NULL DEFAULT ''");
addShotColumn("planned_end_state", "TEXT NOT NULL DEFAULT ''");
addShotColumn("already_happened", "TEXT NOT NULL DEFAULT ''");
addShotColumn("reserved_for_later", "TEXT NOT NULL DEFAULT ''");
addShotColumn("continuity_locks", "TEXT NOT NULL DEFAULT ''");
addShotColumn("allowed_changes", "TEXT NOT NULL DEFAULT ''");
addShotColumn("audio_mode", "TEXT NOT NULL DEFAULT 'generated'");
addShotColumn("audio_asset_ids_json", "TEXT NOT NULL DEFAULT '[]'");
addShotColumn("video_reference_media_ids_json", "TEXT NOT NULL DEFAULT '[]'");
addShotColumn("speaker_map", "TEXT NOT NULL DEFAULT ''");
addShotColumn("audio_direction", "TEXT NOT NULL DEFAULT ''");
addShotColumn("lip_sync_notes", "TEXT NOT NULL DEFAULT ''");
addShotColumn("approved_image_job_id", "TEXT");
addShotColumn("approved_image_media_id", "TEXT");
addShotColumn("approved_video_job_id", "TEXT");
// Asset approvals originally stored only the job id. Promote the approved
// job's local image to the canonical reference used everywhere downstream.
db.exec(`
UPDATE assets
SET reference_media_id = (
  SELECT m.id FROM media_files m
  WHERE m.job_id = assets.approved_job_id AND m.kind = 'image'
  ORDER BY m.created_at ASC LIMIT 1
)
WHERE approved_job_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM media_files m
    WHERE m.job_id = assets.approved_job_id AND m.kind = 'image'
  );
`);
const legacyAssets = db.prepare("SELECT id,reference_code,identity_anchor,prompt FROM assets").all() as { id: string; reference_code: string; identity_anchor: string; prompt: string }[];
const migrateAssetPrompt = db.prepare("UPDATE assets SET reference_code=?,identity_anchor=?,prompt=? WHERE id=?");
for (const asset of legacyAssets) {
  const referenceCode = asset.reference_code || extractAssetReferenceCode(asset.identity_anchor) || extractAssetReferenceCode(asset.prompt);
  const identityAnchor = cleanIdentityAnchor(asset.identity_anchor);
  const prompt = cleanImagePrompt(asset.prompt);
  if (referenceCode !== asset.reference_code || identityAnchor !== asset.identity_anchor || prompt !== asset.prompt) {
    migrateAssetPrompt.run(referenceCode, identityAnchor, prompt, asset.id);
  }
}

function projectFrom(row: Record<string, unknown>): Project {
  const rawStyle = parseJson<Partial<VisualStyleProfile>>(String(row.visual_style_json ?? "{}"), {});
  const visualStyle: VisualStyleProfile = {
    status: String(row.visual_style_status ?? rawStyle.status ?? "needs_review") as VisualStyleProfile["status"],
    name: rawStyle.name ?? "", descriptors: Array.isArray(rawStyle.descriptors) ? rawStyle.descriptors : [],
    evidence: rawStyle.evidence ?? "尚未锁定视觉风格。", source: rawStyle.source ?? "none", sourceArtifactId: rawStyle.sourceArtifactId ?? null
  };
  return {
    id: String(row.id), name: String(row.name), description: String(row.description), template: String(row.template),
    aspectRatio: String(row.aspect_ratio), targetDuration: Number(row.target_duration), contentMode: (row.content_mode ?? "short_film") as ContentMode,
    targetPlatform: String(row.target_platform ?? "douyin"), visualStyle, stage: row.stage as WorkflowStage,
    internalRevisionCount: Number(row.internal_revision_count), createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

function artifactFrom(row: Record<string, unknown>) {
  return { id: String(row.id), projectId: String(row.project_id), type: row.type as ArtifactType, version: Number(row.version),
    title: String(row.title), content: parseJson(String(row.content_json), {}), status: row.status as "draft" | "review" | "locked" | "superseded",
    createdBy: String(row.created_by), createdAt: String(row.created_at) };
}

function assetFrom(row: Record<string, unknown>): Asset {
  return { id: String(row.id), projectId: String(row.project_id), type: row.type as Asset["type"], name: String(row.name), referenceCode: String(row.reference_code ?? ""),
    description: String(row.description), identityAnchor: String(row.identity_anchor), prompt: String(row.prompt),
    negativePrompt: String(row.negative_prompt), status: row.status as Asset["status"], version: Number(row.version),
    referenceMediaId: row.reference_media_id ? String(row.reference_media_id) : null,
    approvedJobId: row.approved_job_id ? String(row.approved_job_id) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

function shotFrom(row: Record<string, unknown>): Shot {
  return { id: String(row.id), projectId: String(row.project_id), shotNumber: Number(row.shot_number), title: String(row.title),
    duration: Number(row.duration), narrativePurpose: String(row.narrative_purpose), composition: String(row.composition),
    camera: String(row.camera), action: String(row.action), dialogue: String(row.dialogue), imagePrompt: String(row.image_prompt),
    videoPrompt: String(row.video_prompt), assetIds: parseJson(String(row.asset_ids_json), []),
    sceneId: String(row.scene_id ?? ""), parentShotId: row.parent_shot_id ? String(row.parent_shot_id) : null,
    sequenceRelation: String(row.sequence_relation ?? "intentional_next_shot") as Shot["sequenceRelation"], feltIntent: String(row.felt_intent ?? ""),
    plannedStartState: String(row.planned_start_state ?? ""), plannedEndState: String(row.planned_end_state ?? ""),
    alreadyHappened: String(row.already_happened ?? ""), reservedForLater: String(row.reserved_for_later ?? ""),
    continuityLocks: String(row.continuity_locks ?? ""), allowedChanges: String(row.allowed_changes ?? ""), status: row.status as Shot["status"],
    audioMode: String(row.audio_mode ?? "generated") as Shot["audioMode"], audioAssetIds: parseJson(String(row.audio_asset_ids_json ?? "[]"), []), videoReferenceMediaIds: parseJson(String(row.video_reference_media_ids_json ?? "[]"), []),
    speakerMap: String(row.speaker_map ?? ""), audioDirection: String(row.audio_direction ?? ""), lipSyncNotes: String(row.lip_sync_notes ?? ""),
    sampleApproved: Boolean(row.sample_approved), approvedImageJobId: row.approved_image_job_id ? String(row.approved_image_job_id) : null,
    approvedImageMediaId: row.approved_image_media_id ? String(row.approved_image_media_id) : null,
    approvedVideoJobId: row.approved_video_job_id ? String(row.approved_video_job_id) : null, observedEndState: String(row.observed_end_state),
    observedAudioState: String(row.observed_audio_state ?? ""),
    lastFrameMediaId: row.last_frame_media_id ? String(row.last_frame_media_id) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

function audioClipFrom(row: Record<string, unknown>): AudioClip {
  return { id: String(row.id), projectId: String(row.project_id), sourceAudioAssetId: String(row.source_audio_asset_id),
    audioAssetId: String(row.audio_asset_id), shotId: row.shot_id ? String(row.shot_id) : null,
    speaker: String(row.speaker ?? ""), text: String(row.text ?? ""), startMs: Number(row.start_ms), endMs: Number(row.end_ms),
    handleMs: Number(row.handle_ms ?? 150), status: row.status as AudioClip["status"], notes: String(row.notes ?? ""),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

function jobFrom(row: Record<string, unknown>): GenerationJob {
  return { id: String(row.id), projectId: String(row.project_id), shotId: row.shot_id ? String(row.shot_id) : null,
    assetId: row.asset_id ? String(row.asset_id) : null, kind: row.kind as GenerationJob["kind"], provider: row.provider as GenerationJob["provider"],
    model: String(row.model), prompt: String(row.prompt), params: parseJson(String(row.params_json), {}),
    externalTaskId: row.external_task_id ? String(row.external_task_id) : null, status: row.status as GenerationJob["status"],
    progress: Number(row.progress), cost: Number(row.cost), creditsCost: Number(row.credits_cost), output: parseJson(String(row.output_json), {}),
    error: String(row.error), attempt: Number(row.attempt), nextPollAt: row.next_poll_at ? String(row.next_poll_at) : null,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

function codexImageRequestFrom(row: Record<string, unknown>): CodexImageRequest {
  return {
    id: String(row.id), projectId: String(row.project_id), assetId: row.asset_id ? String(row.asset_id) : null,
    shotId: row.shot_id ? String(row.shot_id) : null, prompt: String(row.prompt), negativePrompt: String(row.negative_prompt),
    aspectRatio: String(row.aspect_ratio), quality: row.quality as CodexImageRequest["quality"], resolution: String(row.resolution), count: Number(row.count),
    referencePaths: parseJson(String(row.reference_paths_json), []), status: row.status as CodexImageRequest["status"],
    resultJobId: row.result_job_id ? String(row.result_job_id) : null, error: String(row.error),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

export const store = {
  listProjects: () => (db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as Record<string, unknown>[]).map(projectFrom),
  getProject(projectId: string) {
    const row = db.prepare("SELECT * FROM projects WHERE id=?").get(projectId) as Record<string, unknown> | undefined;
    if (!row) throw new Error("项目不存在。");
    return projectFrom(row);
  },
  createProject(input: { name: string; description?: string; template?: string; aspectRatio?: string; targetDuration?: number; contentMode?: ContentMode; targetPlatform?: string; visualStyle?: VisualStyleProfile }) {
    const defaultVisualStyle = input.visualStyle ?? (process.env.NODE_ENV === "test" ? { status: "locked" as const, name: "测试用现代现实主义", descriptors: ["测试"], evidence: "仅用于自动化测试。", source: "user" as const, sourceArtifactId: null } : inferVisualStyleProfile(""));
    const project: Project = { id: id("prj"), name: input.name, description: input.description ?? "", template: input.template ?? "90秒竖屏",
      aspectRatio: input.aspectRatio ?? "9:16", targetDuration: input.targetDuration ?? 90, contentMode: input.contentMode ?? "short_film", targetPlatform: input.targetPlatform ?? "douyin",
      visualStyle: defaultVisualStyle, stage: "idea", internalRevisionCount: 0, createdAt: now(), updatedAt: now() };
    db.prepare("INSERT INTO projects (id,name,description,template,aspect_ratio,target_duration,content_mode,target_platform,visual_style_status,visual_style_json,stage,internal_revision_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      project.id, project.name, project.description, project.template, project.aspectRatio, project.targetDuration, project.contentMode, project.targetPlatform,
      project.visualStyle.status, asJson(project.visualStyle), project.stage, project.internalRevisionCount, project.createdAt, project.updatedAt);
    return project;
  },
  setCreativeProfile(projectId: string, input: { contentMode?: ContentMode; targetPlatform?: string; visualStyle?: VisualStyleProfile }) {
    const current = this.getProject(projectId);
    const visualStyle = input.visualStyle ?? current.visualStyle;
    db.prepare("UPDATE projects SET content_mode=?,target_platform=?,visual_style_status=?,visual_style_json=?,updated_at=? WHERE id=?").run(
      input.contentMode ?? current.contentMode, input.targetPlatform ?? current.targetPlatform, visualStyle.status, asJson(visualStyle), now(), projectId);
    return this.getProject(projectId);
  },
  deleteProject(projectId: string) {
    this.getProject(projectId);
    const mediaRows = db.prepare("SELECT local_path FROM media_files WHERE project_id=? AND local_path!=''").all(projectId) as Array<{ local_path: string }>;
    const audioRows = db.prepare("SELECT local_path FROM audio_assets WHERE project_id=? AND local_path!=''").all(projectId) as Array<{ local_path: string }>;
    const safeRoot = `${path.resolve(dataDir)}${path.sep}`;
    const files = [...mediaRows, ...audioRows].map((row) => path.resolve(row.local_path)).filter((file, index, all) => file.startsWith(safeRoot) && all.indexOf(file) === index);
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM audio_clips WHERE project_id=?").run(projectId);
      for (const table of ["artifacts", "reviews", "assets", "shots", "prompt_versions", "generation_jobs", "codex_image_requests", "revision_requests", "media_files", "audio_assets"]) {
        db.prepare(`DELETE FROM ${table} WHERE project_id=?`).run(projectId);
      }
      db.prepare("DELETE FROM projects WHERE id=?").run(projectId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    for (const file of files) { try { if (fs.existsSync(file)) fs.rmSync(file, { force: true }); } catch { /* cleanup must not undo database deletion */ } }
    const previewPrefix = path.resolve(previewDir, `${projectId}-`);
    if (fs.existsSync(previewDir)) for (const entry of fs.readdirSync(previewDir)) {
      const file = path.resolve(previewDir, entry);
      if (file.startsWith(previewPrefix)) { try { fs.rmSync(file, { force: true }); } catch { /* best effort */ } }
    }
    return { projectId, deletedFiles: files.length };
  },
  setStage(projectId: string, stage: WorkflowStage) {
    db.prepare("UPDATE projects SET stage=?, updated_at=? WHERE id=?").run(stage, now(), projectId);
    return this.getProject(projectId);
  },
  incrementRevision(projectId: string) {
    db.prepare("UPDATE projects SET internal_revision_count=internal_revision_count+1, updated_at=? WHERE id=?").run(now(), projectId);
    return this.getProject(projectId);
  },
  addArtifact(projectId: string, input: { type: ArtifactType; title: string; content: unknown; status?: string; createdBy?: string }) {
    const current = db.prepare("SELECT COALESCE(MAX(version),0) AS version FROM artifacts WHERE project_id=? AND type=?").get(projectId, input.type) as { version: number };
    const artifact = { id: id("art"), projectId, type: input.type, version: Number(current.version) + 1, title: input.title,
      content: input.content, status: input.status ?? "review", createdBy: input.createdBy ?? "main-director", createdAt: now() };
    db.prepare("UPDATE artifacts SET status='superseded' WHERE project_id=? AND type=? AND status!='locked'").run(projectId, input.type);
    db.prepare("INSERT INTO artifacts VALUES (?,?,?,?,?,?,?,?,?)").run(artifact.id, projectId, artifact.type, artifact.version, artifact.title,
      asJson(artifact.content), artifact.status, artifact.createdBy, artifact.createdAt);
    if (input.type === "script") {
      const inferred = inferVisualStyleProfile(JSON.stringify(input.content), artifact.id);
      const current = this.getProject(projectId);
      const preserveExplicitStyle = current.visualStyle.status === "locked"
        && (current.visualStyle.source === "user" || current.visualStyle.source === "style_asset");
      this.setCreativeProfile(projectId, {
        visualStyle: preserveExplicitStyle ? current.visualStyle : inferred,
        contentMode: current.contentMode,
        targetPlatform: current.targetPlatform
      });
    }
    return artifact;
  },
  lockArtifact(artifactId: string) {
    db.prepare("UPDATE artifacts SET status='locked' WHERE id=?").run(artifactId);
  },
  addReview(review: Omit<Review, "id" | "createdAt">) {
    const value: Review = { ...review, id: id("rev"), createdAt: now() };
    db.prepare("INSERT INTO reviews VALUES (?,?,?,?,?,?,?,?)").run(value.id, value.projectId, value.artifactId, value.gate,
      value.decision, asJson(value.scores), value.feedback, value.createdAt);
    return value;
  },
  upsertAsset(projectId: string, input: Partial<Asset> & Pick<Asset, "type" | "name">) {
    const stamp = now();
    if (input.id) {
      const previous = db.prepare("SELECT * FROM assets WHERE id=?").get(input.id) as Record<string, unknown> | undefined;
      if (!previous) throw new Error("资产不存在。");
      const previousAsset = assetFrom(previous);
      const merged = { ...previousAsset, ...input, status: previousAsset.status === "draft" ? "draft" as const : "stale" as const,
        approvedJobId: null, version: Number(previous.version) + 1, updatedAt: stamp };
      db.prepare(`UPDATE assets SET type=?,name=?,reference_code=?,description=?,identity_anchor=?,prompt=?,negative_prompt=?,status=?,version=?,reference_media_id=?,approved_job_id=?,updated_at=? WHERE id=?`).run(
        merged.type, merged.name, merged.referenceCode, merged.description, merged.identityAnchor, merged.prompt, merged.negativePrompt, merged.status, merged.version, merged.referenceMediaId, merged.approvedJobId, stamp, merged.id);
      db.prepare("UPDATE shots SET status='stale', updated_at=? WHERE project_id=? AND asset_ids_json LIKE ?").run(stamp, projectId, `%${merged.id}%`);
      return merged;
    }
    const asset: Asset = { id: id("ast"), projectId, type: input.type, name: input.name, referenceCode: input.referenceCode ?? "", description: input.description ?? "",
      identityAnchor: input.identityAnchor ?? "", prompt: input.prompt ?? "", negativePrompt: input.negativePrompt ?? "", status: input.status ?? "draft",
      version: 1, referenceMediaId: input.referenceMediaId ?? null, approvedJobId: null, createdAt: stamp, updatedAt: stamp };
    db.prepare("INSERT INTO assets (id,project_id,type,name,reference_code,description,identity_anchor,prompt,negative_prompt,status,version,reference_media_id,approved_job_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(asset.id, projectId, asset.type, asset.name, asset.referenceCode, asset.description,
      asset.identityAnchor, asset.prompt, asset.negativePrompt, asset.status, asset.version, asset.referenceMediaId, asset.approvedJobId, stamp, stamp);
    return asset;
  },
  upsertShot(projectId: string, input: Partial<Shot> & Pick<Shot, "shotNumber" | "title">) {
    const stamp = now();
    const existing = input.id ? db.prepare("SELECT * FROM shots WHERE id=?").get(input.id) as Record<string, unknown> | undefined : undefined;
    const previousShot = existing ? shotFrom(existing) : undefined;
    const shot: Shot = { id: input.id ?? id("shot"), projectId, shotNumber: input.shotNumber, title: input.title,
      duration: input.duration ?? previousShot?.duration ?? 5, narrativePurpose: input.narrativePurpose ?? previousShot?.narrativePurpose ?? "",
      composition: input.composition ?? previousShot?.composition ?? "", camera: input.camera ?? previousShot?.camera ?? "",
      action: input.action ?? previousShot?.action ?? "", dialogue: input.dialogue ?? previousShot?.dialogue ?? "",
      imagePrompt: input.imagePrompt ?? previousShot?.imagePrompt ?? "", videoPrompt: input.videoPrompt ?? previousShot?.videoPrompt ?? "",
      assetIds: input.assetIds ?? previousShot?.assetIds ?? [], sceneId: input.sceneId ?? previousShot?.sceneId ?? "scene-01",
      parentShotId: input.parentShotId ?? previousShot?.parentShotId ?? null,
      sequenceRelation: input.sequenceRelation ?? previousShot?.sequenceRelation ?? (input.shotNumber === 1 ? "sequence_first_clip" : "intentional_next_shot"),
      feltIntent: input.feltIntent ?? previousShot?.feltIntent ?? input.narrativePurpose ?? "",
      plannedStartState: input.plannedStartState ?? previousShot?.plannedStartState ?? "", plannedEndState: input.plannedEndState ?? previousShot?.plannedEndState ?? "",
      alreadyHappened: input.alreadyHappened ?? previousShot?.alreadyHappened ?? "", reservedForLater: input.reservedForLater ?? previousShot?.reservedForLater ?? "",
      continuityLocks: input.continuityLocks ?? previousShot?.continuityLocks ?? "", allowedChanges: input.allowedChanges ?? previousShot?.allowedChanges ?? "",
      audioMode: input.audioMode ?? previousShot?.audioMode ?? "generated", audioAssetIds: input.audioAssetIds ?? previousShot?.audioAssetIds ?? [], videoReferenceMediaIds: input.videoReferenceMediaIds ?? previousShot?.videoReferenceMediaIds ?? [],
      speakerMap: input.speakerMap ?? previousShot?.speakerMap ?? "", audioDirection: input.audioDirection ?? previousShot?.audioDirection ?? "",
      lipSyncNotes: input.lipSyncNotes ?? previousShot?.lipSyncNotes ?? "",
      status: input.status ?? previousShot?.status ?? "draft", sampleApproved: input.sampleApproved ?? previousShot?.sampleApproved ?? false,
      approvedImageJobId: input.approvedImageJobId ?? previousShot?.approvedImageJobId ?? null,
      approvedImageMediaId: input.approvedImageMediaId ?? previousShot?.approvedImageMediaId ?? null,
      approvedVideoJobId: input.approvedVideoJobId ?? previousShot?.approvedVideoJobId ?? null,
      observedEndState: input.observedEndState ?? previousShot?.observedEndState ?? "", observedAudioState: input.observedAudioState ?? previousShot?.observedAudioState ?? "",
      lastFrameMediaId: input.lastFrameMediaId ?? previousShot?.lastFrameMediaId ?? null,
      createdAt: existing ? String(existing.created_at) : stamp, updatedAt: stamp };
    if (previousShot) {
      const imageChanged = shot.composition !== previousShot.composition || shot.imagePrompt !== previousShot.imagePrompt || JSON.stringify(shot.assetIds) !== JSON.stringify(previousShot.assetIds);
      const videoChanged = imageChanged || shot.duration !== previousShot.duration || shot.camera !== previousShot.camera || shot.action !== previousShot.action ||
        shot.dialogue !== previousShot.dialogue || shot.videoPrompt !== previousShot.videoPrompt || shot.parentShotId !== previousShot.parentShotId ||
        shot.sequenceRelation !== previousShot.sequenceRelation || shot.plannedStartState !== previousShot.plannedStartState || shot.plannedEndState !== previousShot.plannedEndState ||
        shot.alreadyHappened !== previousShot.alreadyHappened || shot.reservedForLater !== previousShot.reservedForLater || shot.continuityLocks !== previousShot.continuityLocks ||
        shot.audioMode !== previousShot.audioMode || JSON.stringify(shot.audioAssetIds) !== JSON.stringify(previousShot.audioAssetIds) || JSON.stringify(shot.videoReferenceMediaIds) !== JSON.stringify(previousShot.videoReferenceMediaIds) ||
        shot.speakerMap !== previousShot.speakerMap || shot.audioDirection !== previousShot.audioDirection || shot.lipSyncNotes !== previousShot.lipSyncNotes;
      if (imageChanged) { shot.approvedImageJobId = null; shot.approvedImageMediaId = null; }
      if (videoChanged) { shot.approvedVideoJobId = null; shot.lastFrameMediaId = null; shot.observedEndState = ""; shot.observedAudioState = ""; shot.sampleApproved = false; }
      if (imageChanged || videoChanged) shot.status = "stale";
    }
    if (existing) {
      db.prepare(`UPDATE shots SET shot_number=?,title=?,duration=?,narrative_purpose=?,composition=?,camera=?,action=?,dialogue=?,image_prompt=?,video_prompt=?,asset_ids_json=?,scene_id=?,parent_shot_id=?,sequence_relation=?,felt_intent=?,planned_start_state=?,planned_end_state=?,already_happened=?,reserved_for_later=?,continuity_locks=?,allowed_changes=?,audio_mode=?,audio_asset_ids_json=?,video_reference_media_ids_json=?,speaker_map=?,audio_direction=?,lip_sync_notes=?,status=?,sample_approved=?,approved_image_job_id=?,approved_image_media_id=?,approved_video_job_id=?,observed_end_state=?,observed_audio_state=?,last_frame_media_id=?,updated_at=? WHERE id=?`).run(
        shot.shotNumber, shot.title, shot.duration, shot.narrativePurpose, shot.composition, shot.camera, shot.action, shot.dialogue,
        shot.imagePrompt, shot.videoPrompt, asJson(shot.assetIds), shot.sceneId, shot.parentShotId, shot.sequenceRelation, shot.feltIntent,
        shot.plannedStartState, shot.plannedEndState, shot.alreadyHappened, shot.reservedForLater, shot.continuityLocks, shot.allowedChanges,
        shot.audioMode, asJson(shot.audioAssetIds), asJson(shot.videoReferenceMediaIds), shot.speakerMap, shot.audioDirection, shot.lipSyncNotes,
        shot.status, shot.sampleApproved ? 1 : 0, shot.approvedImageJobId, shot.approvedImageMediaId, shot.approvedVideoJobId, shot.observedEndState, shot.observedAudioState, shot.lastFrameMediaId, stamp, shot.id);
    } else {
      db.prepare(`INSERT INTO shots (id,project_id,shot_number,title,duration,narrative_purpose,composition,camera,action,dialogue,image_prompt,video_prompt,asset_ids_json,status,sample_approved,observed_end_state,observed_audio_state,last_frame_media_id,scene_id,parent_shot_id,sequence_relation,felt_intent,planned_start_state,planned_end_state,already_happened,reserved_for_later,continuity_locks,allowed_changes,audio_mode,audio_asset_ids_json,video_reference_media_ids_json,speaker_map,audio_direction,lip_sync_notes,approved_image_job_id,approved_image_media_id,approved_video_job_id,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(shot.id, projectId, shot.shotNumber, shot.title, shot.duration,
        shot.narrativePurpose, shot.composition, shot.camera, shot.action, shot.dialogue, shot.imagePrompt, shot.videoPrompt, asJson(shot.assetIds),
        shot.status, 0, shot.observedEndState, shot.observedAudioState, shot.lastFrameMediaId, shot.sceneId, shot.parentShotId, shot.sequenceRelation, shot.feltIntent,
        shot.plannedStartState, shot.plannedEndState, shot.alreadyHappened, shot.reservedForLater, shot.continuityLocks, shot.allowedChanges,
        shot.audioMode, asJson(shot.audioAssetIds), asJson(shot.videoReferenceMediaIds), shot.speakerMap, shot.audioDirection, shot.lipSyncNotes,
        shot.approvedImageJobId, shot.approvedImageMediaId, shot.approvedVideoJobId, stamp, stamp);
    }
    return shot;
  },
  addRevision(projectId: string, input: { targetType: string; targetId?: string | null; category: string; feedback: string }) {
    const value = { id: id("rr"), projectId, targetType: input.targetType, targetId: input.targetId ?? null, category: input.category,
      feedback: input.feedback, status: "open", createdAt: now(), resolvedAt: null };
    db.prepare("INSERT INTO revision_requests VALUES (?,?,?,?,?,?,?,?,?)").run(value.id, projectId, value.targetType, value.targetId,
      value.category, value.feedback, value.status, value.createdAt, value.resolvedAt);
    return value;
  },
  resolveRevision(revisionId: string) {
    db.prepare("UPDATE revision_requests SET status='resolved',resolved_at=? WHERE id=?").run(now(), revisionId);
  },
  resolveOpenRevisions(projectId: string, targetType: string, targetId?: string) {
    const resolvedAt = now();
    const result = targetId
      ? db.prepare("UPDATE revision_requests SET status='resolved',resolved_at=? WHERE project_id=? AND target_type=? AND target_id=? AND status!='resolved'").run(resolvedAt, projectId, targetType, targetId)
      : db.prepare("UPDATE revision_requests SET status='resolved',resolved_at=? WHERE project_id=? AND target_type=? AND status!='resolved'").run(resolvedAt, projectId, targetType);
    return Number(result.changes);
  },
  addJob(input: Omit<GenerationJob, "id" | "createdAt" | "updatedAt" | "status" | "progress" | "cost" | "creditsCost" | "output" | "error" | "attempt" | "externalTaskId" | "nextPollAt">) {
    const stamp = now();
    const job: GenerationJob = { ...input, id: id("job"), externalTaskId: null, status: "draft", progress: 0, cost: 0, creditsCost: 0,
      output: {}, error: "", attempt: 0, nextPollAt: null, createdAt: stamp, updatedAt: stamp };
    db.prepare("INSERT INTO generation_jobs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(job.id, job.projectId, job.shotId, job.assetId,
      job.kind, job.provider, job.model, job.prompt, asJson(job.params), job.externalTaskId, job.status, job.progress, job.cost, job.creditsCost,
      asJson(job.output), job.error, job.attempt, job.nextPollAt, stamp, stamp);
    return job;
  },
  updateJob(jobId: string, patch: Partial<GenerationJob>) {
    const current = jobFrom(db.prepare("SELECT * FROM generation_jobs WHERE id=?").get(jobId) as Record<string, unknown>);
    const job = { ...current, ...patch, updatedAt: now() };
    db.prepare(`UPDATE generation_jobs SET params_json=?,external_task_id=?,status=?,progress=?,cost=?,credits_cost=?,output_json=?,error=?,attempt=?,next_poll_at=?,updated_at=? WHERE id=?`).run(
      asJson(job.params), job.externalTaskId, job.status, job.progress, job.cost, job.creditsCost, asJson(job.output), job.error, job.attempt, job.nextPollAt, job.updatedAt, jobId);
    return job;
  },
  getJob(jobId: string) { return jobFrom(db.prepare("SELECT * FROM generation_jobs WHERE id=?").get(jobId) as Record<string, unknown>); },
  addCodexImageRequest(input: Omit<CodexImageRequest, "id" | "status" | "resultJobId" | "error" | "createdAt" | "updatedAt" | "resolution"> & { resolution?: string }) {
    const stamp = now();
    const value: CodexImageRequest = { ...input, resolution: input.resolution ?? "1k", id: id("cximg"), status: "queued", resultJobId: null, error: "", createdAt: stamp, updatedAt: stamp };
    db.prepare("INSERT INTO codex_image_requests (id,project_id,asset_id,shot_id,prompt,negative_prompt,aspect_ratio,quality,resolution,count,reference_paths_json,status,result_job_id,error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      value.id, value.projectId, value.assetId, value.shotId, value.prompt, value.negativePrompt, value.aspectRatio, value.quality, value.resolution,
      value.count, asJson(value.referencePaths), value.status, value.resultJobId, value.error, value.createdAt, value.updatedAt
    );
    return value;
  },
  getCodexImageRequest(requestId: string) {
    const row = db.prepare("SELECT * FROM codex_image_requests WHERE id=?").get(requestId) as Record<string, unknown> | undefined;
    if (!row) throw new Error("Codex 生图任务不存在。");
    return codexImageRequestFrom(row);
  },
  updateCodexImageRequest(requestId: string, patch: Partial<CodexImageRequest>) {
    const current = this.getCodexImageRequest(requestId);
    const value = { ...current, ...patch, updatedAt: now() };
    db.prepare("UPDATE codex_image_requests SET status=?,result_job_id=?,error=?,updated_at=? WHERE id=?").run(value.status, value.resultJobId, value.error, value.updatedAt, requestId);
    return value;
  },
  listPendingCodexImageRequests(projectId?: string) {
    const rows = projectId
      ? db.prepare("SELECT * FROM codex_image_requests WHERE project_id=? AND status IN ('queued','processing') ORDER BY created_at").all(projectId)
      : db.prepare("SELECT * FROM codex_image_requests WHERE status IN ('queued','processing') ORDER BY created_at").all();
    return (rows as Record<string, unknown>[]).map(codexImageRequestFrom);
  },
  pendingJobs() { return (db.prepare("SELECT * FROM generation_jobs WHERE status IN ('draft','submitted','processing') ORDER BY created_at").all() as Record<string, unknown>[]).map(jobFrom); },
  getSetting(key: string) { return (db.prepare("SELECT value FROM settings WHERE key=?").get(key) as { value: string } | undefined)?.value ?? null; },
  setSetting(key: string, value: string) { db.prepare("INSERT INTO settings VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(key, value, now()); },
  dashboard(projectId: string): DashboardData {
    const rows = (table: string) => db.prepare(`SELECT * FROM ${table} WHERE project_id=? ORDER BY created_at DESC`).all(projectId) as Record<string, unknown>[];
    return {
      project: this.getProject(projectId), artifacts: rows("artifacts").map(artifactFrom),
      reviews: rows("reviews").map((r) => ({ id: String(r.id), projectId: String(r.project_id), artifactId: r.artifact_id ? String(r.artifact_id) : null,
        gate: r.gate as Review["gate"], decision: r.decision as Review["decision"], scores: parseJson(String(r.scores_json), {}), feedback: String(r.feedback), createdAt: String(r.created_at) })),
      assets: rows("assets").map(assetFrom), shots: (db.prepare("SELECT * FROM shots WHERE project_id=? ORDER BY shot_number").all(projectId) as Record<string, unknown>[]).map(shotFrom),
      jobs: rows("generation_jobs").map(jobFrom),
      mediaFiles: rows("media_files").map((r) => ({ id: String(r.id), projectId: String(r.project_id), jobId: r.job_id ? String(r.job_id) : null,
        kind: r.kind as MediaFile["kind"], localPath: String(r.local_path), sourceUrl: String(r.source_url ?? ""), expiresAt: r.expires_at ? String(r.expires_at) : null, metadata: parseJson(String(r.metadata_json), {}), createdAt: String(r.created_at) })),
      audioAssets: rows("audio_assets").map((r) => ({ id: String(r.id), projectId: String(r.project_id), type: r.type as AudioAsset["type"], name: String(r.name),
        characterAssetId: r.character_asset_id ? String(r.character_asset_id) : null, localPath: String(r.local_path), remoteUrl: String(r.remote_url),
        duration: Number(r.duration), rightsNote: String(r.rights_note), description: String(r.description), createdAt: String(r.created_at), updatedAt: String(r.updated_at) })),
      audioClips: (db.prepare("SELECT * FROM audio_clips WHERE project_id=? ORDER BY created_at DESC").all(projectId) as Record<string, unknown>[]).map(audioClipFrom),
      codexImageRequests: rows("codex_image_requests").map(codexImageRequestFrom),
      revisions: rows("revision_requests").map((r) => ({ id: String(r.id), projectId: String(r.project_id), targetType: r.target_type as "script", targetId: r.target_id ? String(r.target_id) : null,
        category: String(r.category), feedback: String(r.feedback), status: r.status as "open", createdAt: String(r.created_at), resolvedAt: r.resolved_at ? String(r.resolved_at) : null })),
      skillStatus: db.prepare("SELECT name,version,source,commit_hash AS commitHash,checksum,valid,details,updated_at AS updatedAt FROM skill_status ORDER BY name").all() as Record<string, unknown>[]
    };
  }
};
