import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { db, store } from "./db.js";
import { emitEvent } from "./events.js";
import { assertArtifactWriteAllowed, assertGateAllowed, assertShotWriteAllowed, assertVisualStyleLocked, scoresPass } from "./workflow.js";
import { mediaDir } from "./paths.js";
import { refreshSkillStatus } from "./skills.js";
import { asJson, id, now } from "./utils.js";

const server = new McpServer({ name: "cat-studio", version: "0.1.0" });
const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], structuredContent: value as Record<string, unknown> });

server.registerTool("list_projects", {
  description: "列出猫掌柜 AI 漫剧工作台中的所有项目。",
  inputSchema: {}
}, async () => result({ projects: store.listProjects() }));

server.registerTool("create_project", {
  description: "创建一个新的漫剧项目，默认90秒9:16竖屏。",
  inputSchema: { name: z.string().min(1), description: z.string().default(""), dryRun: z.boolean().default(false), targetDuration: z.number().int().min(15).max(1800).default(90), aspectRatio: z.string().default("9:16"), contentMode: z.enum(["short_film", "ad", "mv"]).default("short_film"), targetPlatform: z.string().default("douyin"), targetAudience: z.string().optional(), creativePurpose: z.string().optional(), targetEmotion: z.string().optional() }
}, async (input) => {
  const project = store.createProject({ name: input.name, description: input.description, dryRun: input.dryRun, targetDuration: input.targetDuration, aspectRatio: input.aspectRatio, contentMode: input.contentMode, targetPlatform: input.targetPlatform, targetAudience: input.targetAudience, creativePurpose: input.creativePurpose, targetEmotion: input.targetEmotion });
  emitEvent("project.updated", { projectId: project.id });
  return result(project);
});

server.registerTool("set_creative_profile", {
  description: "锁定或退回项目的内容模式、目标平台与视觉风格。视觉风格未锁定时禁止真实生图和生视频。",
  inputSchema: {
    projectId: z.string(),
    contentMode: z.enum(["short_film", "ad", "mv"]).optional(),
    targetPlatform: z.string().min(1).optional(),
    targetAudience: z.string().optional(),
    creativePurpose: z.string().optional(),
    targetEmotion: z.string().optional(),
    visualStyle: z.object({
      status: z.enum(["needs_review", "locked"]),
      name: z.string().default(""),
      descriptors: z.array(z.string()).default([]),
      evidence: z.string().default(""),
      source: z.enum(["script", "user", "style_asset", "none"]).default("user"),
      sourceArtifactId: z.string().nullable().default(null)
    }).optional()
  }
}, async ({ projectId, ...input }) => {
  const project = store.setCreativeProfile(projectId, input);
  emitEvent("project.updated", { projectId });
  return result(project);
});

server.registerTool("get_project_context", {
  description: "读取项目全部上下文，包括当前阶段、剧本版本、审核、资产、分镜、生成任务和退回项。",
  inputSchema: { projectId: z.string() }
}, async ({ projectId }) => result(store.dashboard(projectId)));

server.registerTool("save_artifact_version", {
  description: "保存创意、剧本、审核报告、资产方案或分镜的新版本。通过版本不能覆盖。",
  inputSchema: {
    projectId: z.string(), type: z.enum(["idea", "script", "director_review", "audience_review", "asset_plan", "storyboard", "final_export"]),
    title: z.string(), content: z.unknown(), createdBy: z.string().default("main-director")
  }
}, async ({ projectId, type, title, content, createdBy }) => {
  assertArtifactWriteAllowed(store.getProject(projectId).stage, type);
  const artifact = store.addArtifact(projectId, { type, title, content, createdBy });
  if (type === "script") store.setStage(projectId, "script_internal_review");
  if (type === "asset_plan") store.setStage(projectId, "asset_user_review");
  if (type === "storyboard") store.setStage(projectId, "storyboard_user_review");
  emitEvent("project.updated", { projectId });
  return result(artifact);
});

server.registerTool("submit_internal_review", {
  description: "提交总导演或观众结构化审核。平均分必须不低于4，所有关键项不低于3才可通过。",
  inputSchema: { projectId: z.string(), artifactId: z.string().nullable().default(null), gate: z.enum(["director", "audience"]),
    decision: z.enum(["approved", "rejected"]), scores: z.record(z.string(), z.number().min(1).max(5)), feedback: z.string() }
}, async ({ projectId, artifactId, gate, decision, scores, feedback }) => {
  const project = store.getProject(projectId);
  assertGateAllowed(project.stage, gate);
  if (decision === "rejected" && !feedback.trim()) throw new Error("退回时必须填写具体审核意见。");
  const currentScript = db.prepare("SELECT id FROM artifacts WHERE project_id=? AND type='script' ORDER BY version DESC LIMIT 1").get(projectId) as { id: string } | undefined;
  if (!currentScript) throw new Error("项目还没有可审核的剧本版本。");
  if (!artifactId || artifactId !== currentScript.id) throw new Error("只能审核当前最新剧本版本，旧版本的审核结果不能沿用。");
  if (decision === "approved" && !scoresPass(scores)) throw new Error("评分未达标，不能标记为通过。");
  if (gate === "audience" && !db.prepare("SELECT id FROM reviews WHERE project_id=? AND artifact_id=? AND gate='director' AND decision='approved'").get(projectId, artifactId)) {
    throw new Error("当前剧本版本尚未通过总导演审核。");
  }
  const review = store.addReview({ projectId, artifactId, gate, decision, scores, feedback });
  if (decision === "rejected") {
    const project = store.incrementRevision(projectId);
    store.addRevision(projectId, { targetType: "script", targetId: artifactId, category: `${gate}审核未通过`, feedback });
    if (project.internalRevisionCount >= 3) store.addRevision(projectId, { targetType: "script", category: "三轮返工上限", feedback: "请用户裁决后再继续。" });
  } else if (gate === "audience") store.setStage(projectId, "script_user_review");
  emitEvent("project.updated", { projectId });
  return result(review);
});

server.registerTool("upsert_asset", {
  description: "新增或修改角色、场景、道具或风格资产。修改资产只会让引用它的镜头标记为需复核。",
  inputSchema: { projectId: z.string(), id: z.string().optional(), type: z.enum(["character", "scene", "prop", "style"]), name: z.string(), referenceCode: z.string().default(""),
    description: z.string(), identityAnchor: z.string(), prompt: z.string(), negativePrompt: z.string().default("") }
}, async ({ projectId, ...input }) => {
  const asset = store.upsertAsset(projectId, input);
  emitEvent("project.updated", { projectId });
  return result(asset);
});

server.registerTool("upsert_shot", {
  description: "新增或修改分镜。视频时长应为4到15秒，最终图片和视频提示词必须分别经过项目 Skills。",
  inputSchema: { projectId: z.string(), id: z.string().optional(), shotNumber: z.number().int().positive(), title: z.string(), duration: z.number().min(4).max(15),
    narrativePurpose: z.string(), composition: z.string(), camera: z.string(), action: z.string(), dialogue: z.string().default(""),
    imagePrompt: z.string(), videoPrompt: z.string(), assetIds: z.array(z.string()), sceneId: z.string().default("scene-01"), parentShotId: z.string().nullable().default(null),
    sequenceRelation: z.enum(["sequence_first_clip", "intentional_next_shot", "seamless_continuation", "reanchor_after_drift"]).default("intentional_next_shot"),
    feltIntent: z.string().default(""), plannedStartState: z.string().default(""), plannedEndState: z.string().default(""),
    alreadyHappened: z.string().default(""), reservedForLater: z.string().default(""), continuityLocks: z.string().default(""),
    allowedChanges: z.string().default(""), audioMode: z.enum(["generated", "voice_reference", "dialogue_lipsync", "music_sync", "silent"]).default("generated"),
    audioAssetIds: z.array(z.string()).max(3).default([]), speakerMap: z.string().default(""), audioDirection: z.string().default(""),
    lipSyncNotes: z.string().default(""), observedEndState: z.string().default("") }
}, async ({ projectId, ...input }) => {
  assertShotWriteAllowed(store.getProject(projectId).stage);
  const shot = store.upsertShot(projectId, input);
  emitEvent("project.updated", { projectId });
  return result(shot);
});

server.registerTool("list_open_revisions", {
  description: "读取项目中尚未解决的用户退回意见。用户说处理最新退回项时先调用此工具。",
  inputSchema: { projectId: z.string() }
}, async ({ projectId }) => result({ revisions: db.prepare("SELECT * FROM revision_requests WHERE project_id=? AND status!='resolved' ORDER BY created_at").all(projectId) }));

server.registerTool("list_pending_codex_image_requests", {
  description: "读取等待 Codex 内置生图处理的任务。用户说‘处理工作台待生图任务’时先调用此工具。",
  inputSchema: { projectId: z.string().optional() }
}, async ({ projectId }) => result({ requests: store.listPendingCodexImageRequests(projectId) }));

server.registerTool("claim_codex_image_request", {
  description: "领取一个 Codex 生图任务并标记为处理中。领取后根据提示词和本地参考图使用内置 imagegen。",
  inputSchema: { requestId: z.string() }
}, async ({ requestId }) => {
  const request = store.getCodexImageRequest(requestId);
  assertVisualStyleLocked(store.getProject(request.projectId));
  if (request.status !== "queued") throw new Error("该任务当前不可领取。");
  const updated = store.updateCodexImageRequest(requestId, { status: "processing", error: "" });
  emitEvent("project.updated", { projectId: request.projectId });
  return result(updated);
});

server.registerTool("complete_codex_image_request", {
  description: "将 Codex 内置生图结果导入工作台。imagePaths 必须是本机已生成的图片文件路径。",
  inputSchema: { requestId: z.string(), imagePaths: z.array(z.string()).min(1).max(4) }
}, async ({ requestId, imagePaths }) => {
  const request = store.getCodexImageRequest(requestId);
  if (!['queued', 'processing'].includes(request.status)) throw new Error("该任务不能重复完成。");
  fs.mkdirSync(mediaDir, { recursive: true });
  const copiedPaths = imagePaths.map((sourcePath, index) => {
    const resolved = path.resolve(sourcePath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw new Error(`生成图片不存在：${sourcePath}`);
    const ext = path.extname(resolved).toLowerCase() || ".png";
    const target = path.join(mediaDir, `${request.id}-${index + 1}${ext}`);
    fs.copyFileSync(resolved, target);
    return target;
  });
  const job = store.addJob({ projectId: request.projectId, assetId: request.assetId, shotId: request.shotId, kind: "image", provider: "codex",
    model: "gpt-image-2", prompt: request.prompt, params: { size: request.aspectRatio, resolution: request.resolution, quality: request.quality, n: copiedPaths.length, codex_request_id: request.id } });
  store.updateJob(job.id, { externalTaskId: request.id, status: "completed", progress: 100, output: { localPaths: copiedPaths, codex: true }, cost: 0, creditsCost: 0 });
  for (const localPath of copiedPaths) db.prepare("INSERT INTO media_files VALUES (?,?,?,?,?,?,?,?,?)").run(id("med"), request.projectId, job.id, "image", localPath, "", null, asJson({ source: "codex_builtin", requestId }), now());
  store.updateCodexImageRequest(requestId, { status: "completed", resultJobId: job.id, error: "" });
  emitEvent("job.updated", { projectId: request.projectId, jobId: job.id });
  return result({ requestId, jobId: job.id, localPaths: copiedPaths });
});

server.registerTool("fail_codex_image_request", {
  description: "记录 Codex 生图任务失败，保留错误原因供用户重试。",
  inputSchema: { requestId: z.string(), error: z.string().min(1) }
}, async ({ requestId, error }) => {
  const request = store.getCodexImageRequest(requestId);
  const updated = store.updateCodexImageRequest(requestId, { status: "failed", error });
  emitEvent("project.updated", { projectId: request.projectId });
  return result(updated);
});

server.registerTool("resolve_revision", {
  description: "新版本已经完成并重新提交后，将对应退回任务标记为已解决。",
  inputSchema: { revisionId: z.string() }
}, async ({ revisionId }) => { store.resolveRevision(revisionId); return result({ ok: true }); });

server.registerTool("get_skill_status", {
  description: "检查四个项目级 Skills 的版本、来源、校验和和最近验证结果。",
  inputSchema: {}
}, async () => {
  refreshSkillStatus();
  return result({ skills: db.prepare("SELECT * FROM skill_status ORDER BY name").all() });
});

await server.connect(new StdioServerTransport());
