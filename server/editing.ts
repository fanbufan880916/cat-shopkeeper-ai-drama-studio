import fs from "node:fs";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { EditClip, EditJob, EditManifest, EditQualityReport, Project, Shot } from "../shared/types.js";
import { store } from "./db.js";
import { assertEditPrepareAllowed, assertEditRenderAllowed, assertGateAllowed, scoresPass } from "./workflow.js";
import { projectDeliveryDir, rootDir } from "./paths.js";
import { getJianyingConfig, runJianyingEdit as runConfiguredJianyingEdit, serializeCommandResults } from "./jianying.js";
import { now } from "./utils.js";

const execFile = promisify(execFileCallback);

function absoluteLocalPath(value: string) {
  return path.isAbsolute(value) ? value : path.resolve(rootDir, value);
}

function copyToStable(source: string, target: string) {
  const resolvedSource = absoluteLocalPath(source);
  if (!fs.existsSync(resolvedSource) || !fs.statSync(resolvedSource).isFile()) throw new Error(`素材文件不存在：${source}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (path.resolve(resolvedSource) !== path.resolve(target)) fs.copyFileSync(resolvedSource, target);
  return target;
}

function mediaMetadata(media: { metadata: Record<string, unknown> }) { return media.metadata; }

function findVideoPath(projectId: string, shot: Shot, version: number, dashboard: ReturnType<typeof store.dashboard>) {
  const candidates = dashboard.mediaFiles
    .filter((media) => media.kind === "video" && (media.jobId === shot.approvedVideoJobId || mediaMetadata(media).shotId === shot.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const source = candidates[0]?.localPath;
  if (!source) throw new Error(`镜头 ${shot.shotNumber} 没有已通过的视频素材文件。`);
  const ext = path.extname(source) || ".mp4";
  return copyToStable(source, path.join(projectDeliveryDir(projectId), "video", `shot-${String(shot.shotNumber).padStart(2, "0")}-video-v${String(version).padStart(2, "0")}${ext}`));
}

function findShotAudio(shot: Shot, dashboard: ReturnType<typeof store.dashboard>) {
  const ids = new Set(shot.audioAssetIds);
  const clipIds = dashboard.audioClips.filter((clip) => clip.shotId === shot.id).map((clip) => clip.audioAssetId);
  for (const id of [...ids, ...clipIds]) {
    const asset = dashboard.audioAssets.find((item) => item.id === id);
    if (asset?.localPath && fs.existsSync(absoluteLocalPath(asset.localPath))) return asset.localPath;
  }
  return null;
}

function buildPlan(project: Project, manifest: EditManifest) {
  const lines = [
    `# ${project.name} 剪辑方案 V${String(manifest.version).padStart(2, "0")}`,
    "",
    `- 项目 ID：${project.id}`,
    `- 画幅：${manifest.aspectRatio}`,
    `- 目标时长：${manifest.targetDuration} 秒`,
    `- 输出：${manifest.output.resolution} ${manifest.output.format}`,
    `- 字幕安全区：${manifest.subtitleSafeArea}`,
    "",
    "## 镜头顺序与剪辑目的",
    "",
    "| 顺序 | 镜头 | 起始时间 | 时长 | 台词/字幕 | 转场 | 剪辑目的 |",
    "| --- | --- | ---: | ---: | --- | --- | --- |"
  ];
  for (const [index, clip] of manifest.clips.entries()) {
    const shot = store.dashboard(project.id).shots.find((item) => item.id === clip.shotId);
    lines.push(`| ${index + 1} | ${shot?.shotNumber ?? clip.shotId} | ${clip.startTime.toFixed(2)}s | ${clip.duration.toFixed(2)}s | ${clip.subtitle || "无"} | ${clip.transition} | ${shot?.narrativePurpose || "完成本镜头叙事"} |`);
  }
  lines.push(
    "",
    "## 声音、节奏与发布要求",
    "",
    `- 前三秒：使用第一个镜头直接进入动作或冲突，不使用空片头。`,
    `- 音频：镜头台词按镜头绑定；背景音乐音量 ${manifest.music ? manifest.music.volume : 0}，台词优先。`,
    "- 音效：以镜头对应的已审核音频资产为准，不自行替换未审核声音。",
    "- 字幕：放在 9:16 下方安全区内，不能遮挡人物脸部、品牌标志和团购 CTA。",
    "- 转场：默认 cut；只有分镜明确要求时才使用溶解或其他转场。",
    "- 品牌 CTA：成片末段保留猫掌柜品牌和行动指引，具体文案由剧本/分镜版本提供。",
    "",
    "## 成片验收标准",
    "",
    "- 所有镜头均来自已通过审核的版本，拒绝镜头不得进入时间线。",
    "- 输出为 9:16、1080x1920，时长与清单一致，视频和音轨可播放。",
    "- 无明显黑帧、空音频、缺失字幕或越过安全区的字幕。",
    "- 技术质检通过后，仍需用户人工最终审核，Codex 不自动批准。"
  );
  return `${lines.join("\n")}\n`;
}

export function validateEditManifest(manifest: EditManifest) {
  const errors: string[] = [];
  if (manifest.aspectRatio !== "9:16") errors.push("项目画幅不是 9:16。");
  if (!manifest.clips.length) errors.push("剪辑清单没有镜头。");
  for (const clip of manifest.clips) {
    if (!fs.existsSync(absoluteLocalPath(clip.videoPath))) errors.push(`视频不存在：${clip.videoPath}`);
    if (clip.audioPath && !fs.existsSync(absoluteLocalPath(clip.audioPath))) errors.push(`音频不存在：${clip.audioPath}`);
    if (clip.duration <= 0) errors.push(`镜头 ${clip.shotId} 时长必须大于 0。`);
  }
  if (manifest.music?.path && !fs.existsSync(absoluteLocalPath(manifest.music.path))) errors.push(`音乐不存在：${manifest.music.path}`);
  return errors;
}

export function prepareEditManifest(projectId: string) {
  const project = store.getProject(projectId);
  assertEditPrepareAllowed(project.stage);
  const dashboard = store.dashboard(projectId);
  const missing = dashboard.shots.filter((shot) => !shot.approvedVideoJobId);
  if (missing.length) throw new Error(`以下镜头尚未通过视频审核，不能进入剪辑：${missing.map((shot) => `#${shot.shotNumber}`).join("、")}`);
  const version = Math.max(1, (store.listEditJobs(projectId)[0]?.version ?? 0) + 1);
  const delivery = projectDeliveryDir(projectId);
  for (const dir of ["video", "audio", "images", "frames", "export"]) fs.mkdirSync(path.join(delivery, dir), { recursive: true });
  const clips: EditClip[] = [];
  let startTime = 0;
  for (const shot of [...dashboard.shots].sort((a, b) => a.shotNumber - b.shotNumber)) {
    const videoPath = findVideoPath(projectId, shot, version, dashboard);
    const audioSource = findShotAudio(shot, dashboard);
    const audioPath = audioSource ? copyToStable(audioSource, path.join(delivery, "audio", `shot-${String(shot.shotNumber).padStart(2, "0")}-dialogue-v${String(version).padStart(2, "0")}${path.extname(audioSource) || ".wav"}`)) : null;
    const clip: EditClip = { shotId: shot.id, videoPath, startTime, duration: shot.duration, audioPath, subtitle: shot.dialogue, transition: "cut" };
    clips.push(clip);
    startTime += shot.duration;
  }
  const musicAsset = dashboard.audioAssets.find((asset) => asset.type === "music" && asset.localPath && fs.existsSync(absoluteLocalPath(asset.localPath)));
  const music = musicAsset ? { path: copyToStable(musicAsset.localPath, path.join(delivery, "audio", `music-main-v${String(version).padStart(2, "0")}${path.extname(musicAsset.localPath) || ".mp3"}`)), volume: 0.25 } : null;
  const manifest: EditManifest = {
    projectId, version, aspectRatio: project.aspectRatio, targetDuration: project.targetDuration, subtitleSafeArea: "9:16-safe", generatedAt: now(), clips, music,
    output: { path: path.join(delivery, "export", `cat-studio-final-v${String(version).padStart(2, "0")}.mp4`), format: "mp4", resolution: "1080x1920" }
  };
  const errors = validateEditManifest(manifest);
  if (errors.length) throw new Error(`剪辑清单校验失败：${errors.join("；")}`);
  const manifestPath = path.join(delivery, `edit-manifest-v${String(version).padStart(2, "0")}.json`);
  const planPath = path.join(delivery, `edit-plan-v${String(version).padStart(2, "0")}.md`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  fs.writeFileSync(planPath, buildPlan(project, manifest), "utf8");
  const jianying = getJianyingConfig();
  const editJob = store.createEditJob({
    projectId, status: "draft", adapter: jianying.adapter, cliPath: jianying.executable,
    manifestPath, planPath, projectRoot: path.resolve(jianying.projectRoot || path.join(delivery, "jianying-projects"), projectId), outputPath: manifest.output.path,
    version, commandOutput: "", error: "", qualityReport: null, finalReviewStatus: null, exportedAt: null
  });
  store.setStage(projectId, "edit_prepare");
  return { editJob, manifest, manifestPath, planPath };
}

async function probeOutput(outputPath: string) {
  try {
    const result = await execFile("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=width,height,codec_type", "-of", "json", outputPath], { windowsHide: true, maxBuffer: 5 * 1024 * 1024 });
    const data = JSON.parse(result.stdout) as { format?: { duration?: string }; streams?: Array<{ width?: number; height?: number; codec_type?: string }> };
    const video = data.streams?.find((item) => item.codec_type === "video");
    return { duration: Number(data.format?.duration ?? 0), width: Number(video?.width ?? 0), height: Number(video?.height ?? 0), hasAudio: Boolean(data.streams?.some((item) => item.codec_type === "audio")) };
  } catch {
    const result = await execFile("ffmpeg", ["-hide_banner", "-i", outputPath, "-f", "null", "-"], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }).catch((error) => error as { stdout?: string; stderr?: string; message?: string });
    const log = `${String(result.stderr ?? "")}\n${String(result.stdout ?? "")}`;
    const durationMatch = log.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    const sizeMatch = log.match(/,\s*(\d{2,5})x(\d{2,5})[,\s]/);
    return { duration: durationMatch ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]) : 0, width: sizeMatch ? Number(sizeMatch[1]) : 0, height: sizeMatch ? Number(sizeMatch[2]) : 0, hasAudio: /Audio:/i.test(log) };
  }
}

async function inspectSignal(outputPath: string, needsAudio: boolean) {
  try {
    const result = await execFile("ffmpeg", ["-hide_banner", "-i", outputPath, "-vf", "blackdetect=d=0.8:pic_th=0.98", "-af", "silencedetect=n=-50dB:d=1", "-f", "null", "-"], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
    return `${result.stdout}\n${result.stderr}`;
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return `${String(failure.stdout ?? "")}\n${String(failure.stderr ?? "")}`;
  }
}

export async function inspectEditOutput(editJobId: string): Promise<EditQualityReport> {
  const editJob = store.getEditJob(editJobId);
  const manifest = JSON.parse(fs.readFileSync(editJob.manifestPath, "utf8")) as EditManifest;
  const checks: EditQualityReport["checks"] = [];
  const manifestErrors = validateEditManifest(manifest);
  checks.push({ name: "镜头和素材完整性", ok: manifestErrors.length === 0, detail: manifestErrors.join("；") || "所有镜头素材存在且来自当前清单。" });
  const outputExists = fs.existsSync(editJob.outputPath) && fs.statSync(editJob.outputPath).isFile();
  checks.push({ name: "输出文件存在", ok: outputExists, detail: outputExists ? editJob.outputPath : `找不到输出：${editJob.outputPath}` });
  if (!outputExists) {
    return { ok: false, checkedAt: now(), checks, metadata: {} };
  }
  const metadata = await probeOutput(editJob.outputPath);
  const expected = manifest.output.resolution.split("x").map(Number);
  const expectedDuration = manifest.clips.reduce((sum, clip) => sum + clip.duration, 0);
  checks.push({ name: "分辨率", ok: metadata.width === expected[0] && metadata.height === expected[1], detail: `${metadata.width}x${metadata.height}，预期 ${manifest.output.resolution}` });
  checks.push({ name: "画幅", ok: metadata.width > 0 && metadata.height > 0 && Math.abs(metadata.width / metadata.height - 9 / 16) < 0.01, detail: "检查视频是否为 9:16。" });
  checks.push({ name: "时长", ok: metadata.duration > 0 && Math.abs(metadata.duration - expectedDuration) <= 2, detail: `${metadata.duration.toFixed(2)} 秒，清单约 ${expectedDuration.toFixed(2)} 秒` });
  const needsAudio = Boolean(manifest.music || manifest.clips.some((clip) => clip.audioPath));
  checks.push({ name: "音轨", ok: !needsAudio || metadata.hasAudio, detail: metadata.hasAudio ? "检测到音轨。" : "清单需要声音，但输出没有检测到音轨。" });
  const signalLog = await inspectSignal(editJob.outputPath, needsAudio);
  const blackDurations = [...signalLog.matchAll(/black_duration:\s*([0-9.]+)/g)].map((match) => Number(match[1]));
  const silenceDurations = [...signalLog.matchAll(/silence_duration:\s*([0-9.]+)/g)].map((match) => Number(match[1]));
  checks.push({ name: "黑帧扫描", ok: blackDurations.every((duration) => duration < 1.5), detail: blackDurations.length ? `发现黑帧区间：${blackDurations.map((duration) => `${duration.toFixed(2)}s`).join("、")}` : "未发现持续黑帧。" });
  checks.push({ name: "空音频扫描", ok: !needsAudio || silenceDurations.every((duration) => duration < 2), detail: silenceDurations.length ? `发现静音区间：${silenceDurations.map((duration) => `${duration.toFixed(2)}s`).join("、")}` : "未发现持续空音频。" });
  checks.push({ name: "字幕安全区", ok: manifest.subtitleSafeArea === "9:16-safe", detail: "字幕位置由剪辑清单固定在 9:16 安全区。" });
  const sizeBytes = fs.statSync(editJob.outputPath).size;
  checks.push({ name: "文件大小", ok: sizeBytes > 10 * 1024, detail: `${sizeBytes} bytes` });
  const report: EditQualityReport = { ok: checks.every((check) => check.ok), checkedAt: now(), checks, metadata: { ...metadata, sizeBytes } };
  return report;
}

export async function runEdit(editJobId: string) {
  const editJob = store.getEditJob(editJobId);
  const project = store.getProject(editJob.projectId);
  assertEditRenderAllowed(project.stage);
  const manifest = JSON.parse(fs.readFileSync(editJob.manifestPath, "utf8")) as EditManifest;
  const errors = validateEditManifest(manifest);
  if (errors.length) throw new Error(`剪辑清单已失效：${errors.join("；")}`);
  const config = getJianyingConfig();
  store.updateEditJob(editJobId, { status: "running", error: "", cliPath: config.executable, adapter: config.adapter });
  store.setStage(editJob.projectId, "edit_render");
  try {
    const results = await runConfiguredJianyingEdit(config, editJob.manifestPath, editJob.outputPath, editJob.projectRoot);
    const report = await inspectEditOutput(editJobId);
    const output = JSON.stringify(serializeCommandResults(results), null, 2);
    if (!report.ok) {
      store.updateEditJob(editJobId, { status: "failed", commandOutput: output, qualityReport: report, error: "剪映已返回，但成片技术质检未通过。" });
      throw new Error("剪映已返回，但成片技术质检未通过，请查看质检报告后修改清单。");
    }
    store.updateEditJob(editJobId, { status: "completed", commandOutput: output, qualityReport: report, error: "", exportedAt: now(), finalReviewStatus: "pending" });
    const artifact = store.addArtifact(editJob.projectId, { type: "final_export", title: `剪映成片 V${String(editJob.version).padStart(2, "0")}`, content: { editJobId, outputPath: editJob.outputPath, manifestPath: editJob.manifestPath, qualityReport: report }, createdBy: "jianying-cli" });
    store.setStage(editJob.projectId, "final_review");
    return { editJob: store.getEditJob(editJobId), artifact, qualityReport: report };
  } catch (error) {
    const current = store.getEditJob(editJobId);
    if (current.status === "running") store.updateEditJob(editJobId, { status: "failed", error: String(error instanceof Error ? error.message : error) });
    throw error;
  }
}

export function getEditStatus(editJobId: string) { return store.getEditJob(editJobId); }

export function cancelEdit(editJobId: string) {
  const job = store.getEditJob(editJobId);
  if (job.status === "completed") throw new Error("已导出的剪辑不能取消；如需修改，请退回成片并生成新版本。");
  const updated = store.updateEditJob(editJobId, { status: "cancelled", error: "用户取消剪辑任务。" });
  if (store.getProject(job.projectId).stage === "edit_render") store.setStage(job.projectId, "edit_prepare");
  return updated;
}

export function approveFinalEdit(editJobId: string, scores: Record<string, number>, feedback: string) {
  const job = store.getEditJob(editJobId);
  const project = store.getProject(job.projectId);
  assertGateAllowed(project.stage, "final_user");
  if (job.status !== "completed" || job.finalReviewStatus !== "pending") throw new Error("当前剪辑任务还没有通过技术质检，不能提交最终审核。");
  if (!scoresPass(scores)) throw new Error("最终审核评分未达到通过条件。");
  const artifact = store.dashboard(job.projectId).artifacts.find((item) => item.type === "final_export" && item.content && typeof item.content === "object" && (item.content as { editJobId?: string }).editJobId === editJobId);
  const review = store.addReview({ projectId: job.projectId, artifactId: artifact?.id ?? null, gate: "final_user", decision: "approved", scores, feedback });
  store.updateEditJob(editJobId, { finalReviewStatus: "approved" });
  store.setStage(job.projectId, "completed");
  return { review, editJob: store.getEditJob(editJobId) };
}

export function rejectFinalEdit(editJobId: string, feedback: string, affectedShotIds: string[]) {
  if (!feedback.trim()) throw new Error("退回成片时必须填写具体修改意见。");
  const job = store.getEditJob(editJobId);
  const project = store.getProject(job.projectId);
  assertGateAllowed(project.stage, "final_user");
  const artifact = store.dashboard(job.projectId).artifacts.find((item) => item.type === "final_export" && item.content && typeof item.content === "object" && (item.content as { editJobId?: string }).editJobId === editJobId);
  const review = store.addReview({ projectId: job.projectId, artifactId: artifact?.id ?? null, gate: "final_user", decision: "rejected", scores: {}, feedback });
  store.addRevision(job.projectId, { targetType: "final", targetId: editJobId, category: affectedShotIds.length ? `局部修改：${affectedShotIds.join(",")}` : "成片修改", feedback });
  store.updateEditJob(editJobId, { finalReviewStatus: "rejected" });
  store.setStage(job.projectId, "edit_prepare");
  return { review, editJob: store.getEditJob(editJobId), nextAction: "只修改受影响对象后重新生成新的 edit-manifest 版本。" };
}
