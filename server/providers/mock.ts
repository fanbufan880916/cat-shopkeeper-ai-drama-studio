import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { GenerationJob } from "../../shared/types.js";
import { mediaDir } from "../paths.js";
import type { GenerationProvider, PollResult, SubmitResult } from "./types.js";

function mockImageSize(aspectRatio: unknown) {
  const sizes: Record<string, string> = {
    "1:1": "1024x1024",
    "3:2": "1200x800",
    "2:3": "800x1200",
    "4:3": "1024x768",
    "3:4": "768x1024",
    "16:9": "1280x720",
    "9:16": "720x1280"
  };
  return sizes[String(aspectRatio)] ?? "720x1280";
}

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
      const outputPath = path.join(mediaDir, `${job.id}.png`);
      if (!fs.existsSync(outputPath)) {
        execFileSync("ffmpeg", [
          "-y",
          "-f", "lavfi",
          "-i", `color=c=0x17131f:s=${mockImageSize(job.params.size)}:d=1`,
          "-vf", "drawbox=x=0:y=0:w=iw:h=ih:color=0x8f4f3f@0.25:t=fill,drawtext=text='MOCK IMAGE - NO API COST':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=(h-text_h)/2",
          "-frames:v", "1",
          "-update", "1",
          outputPath
        ], { windowsHide: true, stdio: "ignore" });
      }
      return { status: "completed", progress: 100, output: { localPaths: [outputPath], mock: true } };
    }
    const outputPath = path.join(mediaDir, `${job.id}.mp4`);
    if (!fs.existsSync(outputPath)) {
      const duration = Math.max(4, Math.min(15, Number(job.params.duration ?? 5)));
      execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", `color=c=0x17131f:s=720x1280:d=${duration}`, "-vf", "drawtext=text='MOCK VIDEO - NO API COST':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=(h-text_h)/2", "-c:v", "libx264", "-pix_fmt", "yuv420p", outputPath], { windowsHide: true, stdio: "ignore" });
    }
    return { status: "completed", progress: 100, output: { localPaths: [outputPath], mock: true } };
  }

  async testConnection() {
    return { ok: true, message: "Mock 模式可用，不会产生任何费用。" };
  }
}
