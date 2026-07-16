import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { GenerationJob } from "../../shared/types.js";
import { mediaDir } from "../paths.js";
import type { GenerationProvider, PollResult, SubmitResult } from "./types.js";

export class MockProvider implements GenerationProvider {
  name = "mock" as const;

  async submit(job: GenerationJob): Promise<SubmitResult> {
    return { taskId: `mock_${job.id}`, status: "submitted" };
  }

  async poll(job: GenerationJob): Promise<PollResult> {
    const age = Date.now() - new Date(job.updatedAt).getTime();
    if (age < 800) return { status: "processing", progress: 45 };
    fs.mkdirSync(mediaDir, { recursive: true });
    if (job.kind === "image") {
      const outputPath = path.join(mediaDir, `${job.id}.svg`);
      if (!fs.existsSync(outputPath)) {
        const text = job.prompt.replace(/[<>&]/g, "").slice(0, 80);
        fs.writeFileSync(outputPath, `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#18121f"/><stop offset="1" stop-color="#652b34"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="540" cy="710" r="250" fill="#e0a15d" opacity=".75"/><text x="70" y="1450" fill="#fff" font-size="48" font-family="sans-serif">Mock 样片图</text><foreignObject x="70" y="1510" width="940" height="300"><div xmlns="http://www.w3.org/1999/xhtml" style="color:#ddd;font:32px sans-serif;line-height:1.5">${text}</div></foreignObject></svg>`, "utf8");
      }
      return { status: "completed", progress: 100, output: { localPaths: [outputPath], mock: true } };
    }
    const outputPath = path.join(mediaDir, `${job.id}.mp4`);
    if (!fs.existsSync(outputPath)) {
      execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=0x17131f:s=720x1280:d=4", "-vf", "drawtext=text='Mock Seedance Clip':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=(h-text_h)/2", "-c:v", "libx264", "-pix_fmt", "yuv420p", outputPath], { windowsHide: true, stdio: "ignore" });
    }
    return { status: "completed", progress: 100, output: { localPaths: [outputPath], mock: true } };
  }

  async testConnection() {
    return { ok: true, message: "Mock 模式可用，不会产生任何费用。" };
  }
}
