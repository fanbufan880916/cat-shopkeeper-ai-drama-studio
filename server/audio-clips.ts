import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mediaDir } from "./paths.js";
import { id } from "./utils.js";

const execFileAsync = promisify(execFile);

/**
 * Cut a clean, seekable WAV clip from a generated scene master.
 * We deliberately re-encode instead of stream-copying so the clip starts
 * cleanly at the requested boundary and can be used as a lip-sync reference.
 */
export async function cutAudioClip(sourcePath: string, startMs: number, endMs: number, handleMs = 150) {
  if (!fs.existsSync(sourcePath)) throw new Error("场景母带本地文件不存在，无法切片。请先等待音频任务完成下载。");
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) throw new Error("音频切片的起止时间不正确。");
  const safeHandle = Math.max(0, Math.min(1000, Math.round(handleMs)));
  const sourceStart = Math.max(0, Math.round(startMs) - safeHandle);
  const sourceEnd = Math.round(endMs) + safeHandle;
  const duration = Math.max(0.05, (sourceEnd - sourceStart) / 1000);
  fs.mkdirSync(mediaDir, { recursive: true });
  const outputPath = path.join(mediaDir, `audio-clip-${id("ac")}.wav`);
  try {
    await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(sourceStart / 1000), "-i", sourcePath,
      "-t", String(duration), "-vn", "-acodec", "pcm_s16le", "-ar", "24000", outputPath], { timeout: 120_000 });
  } catch (error) {
    fs.rmSync(outputPath, { force: true });
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`音频切片失败：${detail}`);
  }
  if (!fs.existsSync(outputPath)) throw new Error("音频切片失败，没有生成本地文件。");
  return { localPath: outputPath, duration: Number(duration.toFixed(3)), startMs: sourceStart, endMs: sourceEnd };
}
