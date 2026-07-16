import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { db } from "./db.js";
import { previewDir } from "./paths.js";

export function buildPreview(projectId: string) {
  const rows = db.prepare(`
    SELECT s.shot_number,m.local_path
    FROM shots s
    JOIN generation_jobs j ON j.id=s.approved_video_job_id AND j.kind='video' AND j.status='completed'
    JOIN media_files m ON m.job_id=j.id AND m.kind='video'
    WHERE s.project_id=?
    ORDER BY s.shot_number
  `).all(projectId) as Array<{ shot_number: number; local_path: string }>;
  if (!rows.length) throw new Error("还没有通过审核、可用于拼接的镜头视频。");
  const missing = rows.find((row) => !fs.existsSync(row.local_path));
  if (missing) throw new Error(`镜头 ${missing.shot_number} 的已通过视频文件不存在，请重新下载或生成。`);

  fs.mkdirSync(previewDir, { recursive: true });
  const listPath = path.join(previewDir, `${projectId}-concat.txt`);
  fs.writeFileSync(listPath, rows.map((row) => `file '${row.local_path.replaceAll("'", "'\\''")}'`).join("\n"), "utf8");
  const outputPath = path.join(previewDir, `${projectId}-preview.mp4`);
  execFileSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-vf", "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:black", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", outputPath], { windowsHide: true, stdio: "ignore" });
  return outputPath;
}
