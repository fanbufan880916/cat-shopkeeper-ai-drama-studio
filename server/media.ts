import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { db } from "./db.js";
import { mediaDir } from "./paths.js";
import { asJson, id, now } from "./utils.js";

type RemoteOutput = { url: string; role: "output" | "last_frame" };

function collectRemoteOutputs(value: unknown, keyPath = "", outputs: RemoteOutput[] = []): RemoteOutput[] {
  if (typeof value === "string" && /^https?:\/\//.test(value)) outputs.push({ url: value, role: /last.?frame|tail.?frame/i.test(keyPath) ? "last_frame" : "output" });
  else if (Array.isArray(value)) value.forEach((item) => collectRemoteOutputs(item, keyPath, outputs));
  else if (value && typeof value === "object") Object.entries(value as Record<string, unknown>).forEach(([childKey, item]) => collectRemoteOutputs(item, `${keyPath}.${childKey}`, outputs));
  return outputs.filter((item, index) => outputs.findIndex((candidate) => candidate.url === item.url) === index);
}

export async function persistRemoteOutputs(projectId: string, jobId: string, kind: string, output: unknown) {
  if (kind === "audio") return persistAudioOutput(projectId, jobId, output);
  const localExisting = (output as { localPaths?: string[] } | undefined)?.localPaths ?? [];
  const remoteOutputs = collectRemoteOutputs(output);
  const saved = [...localExisting];
  fs.mkdirSync(mediaDir, { recursive: true });
  for (let index = 0; index < remoteOutputs.length; index++) {
    const { url, role } = remoteOutputs[index];
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok || !response.body) throw new Error(`生成结果下载失败（HTTP ${response.status}），任务将保留以便重试。`);
    const extFromUrl = path.extname(new URL(url).pathname);
    const contentType = response.headers.get("content-type") ?? "";
    const ext = extFromUrl || (role === "last_frame" || contentType.startsWith("image/") ? ".png" : kind === "video" ? ".mp4" : ".png");
    const localPath = path.join(mediaDir, `${jobId}-${index + 1}${ext}`);
    const partialPath = `${localPath}.partial`;
    try {
      await pipeline(Readable.fromWeb(response.body as never), fs.createWriteStream(partialPath));
      fs.renameSync(partialPath, localPath);
    } catch (error) {
      fs.rmSync(partialPath, { force: true });
      throw error;
    }
    saved.push(localPath);
    db.prepare("INSERT INTO media_files VALUES (?,?,?,?,?,?,?,?,?)").run(id("med"), projectId, jobId, role === "last_frame" ? "image" : kind, localPath, url, null, asJson({ role }), now());
  }
  for (const localPath of localExisting) {
    const exists = db.prepare("SELECT id FROM media_files WHERE job_id=? AND local_path=?").get(jobId, localPath);
    if (!exists) db.prepare("INSERT INTO media_files VALUES (?,?,?,?,?,?,?,?,?)").run(id("med"), projectId, jobId, kind, localPath, "", null, asJson({ mock: true }), now());
  }
  if (!saved.length) throw new Error("生成任务已完成，但没有可保存的本地结果，请稍后重试。");
  return { ...(output as Record<string, unknown>), localPaths: saved };
}

async function persistAudioOutput(projectId: string, jobId: string, output: unknown) {
  const value = (output && typeof output === "object" ? output : {}) as Record<string, unknown>;
  const format = String((value.audio_config as Record<string, unknown> | undefined)?.format ?? value.format ?? "wav");
  const extension = format === "mp3" ? ".mp3" : format === "ogg_opus" ? ".ogg" : format === "pcm" ? ".pcm" : ".wav";
  fs.mkdirSync(mediaDir, { recursive: true });
  const localPath = path.join(mediaDir, `${jobId}-1${extension}`);
  const base64 = typeof value.audio === "string" ? value.audio : "";
  const url = typeof value.url === "string" && /^https?:\/\//.test(value.url) ? value.url : "";
  if (base64) {
    fs.writeFileSync(localPath, Buffer.from(base64, "base64"));
  } else if (url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok || !response.body) throw new Error(`豆包音频结果下载失败（HTTP ${response.status}）。`);
    await pipeline(Readable.fromWeb(response.body as never), fs.createWriteStream(`${localPath}.partial`));
    fs.renameSync(`${localPath}.partial`, localPath);
  } else {
    throw new Error("豆包音频已完成，但没有可保存的音频内容。");
  }
  const mediaId = id("med");
  db.prepare("INSERT INTO media_files VALUES (?,?,?,?,?,?,?,?,?)").run(mediaId, projectId, jobId, "audio", localPath, url, url ? new Date(Date.now() + 2 * 3600_000).toISOString() : null,
    asJson({ role: "audio_output", format, duration: Number(value.original_duration ?? value.duration ?? 0), subtitle: value.subtitle ?? null }), now());
  const { audio: _audio, ...safeValue } = value;
  return { ...safeValue, localPaths: [localPath], audioUrl: url, mediaId };
}
