import type { GenerationJob } from "../../shared/types.js";

export interface SubmitResult {
  taskId: string;
  status: "submitted" | "processing" | "completed";
  output?: unknown;
}

export interface PollResult {
  status: "submitted" | "processing" | "completed" | "failed";
  progress: number;
  cost?: number;
  creditsCost?: number;
  output?: unknown;
  error?: string;
}

export interface GenerationProvider {
  name: GenerationJob["provider"];
  uploadImage?(apiKey: string, localPath: string): Promise<{ url: string; expiresAt: string }>;
  submit(job: GenerationJob, apiKey: string): Promise<SubmitResult>;
  poll(job: GenerationJob, apiKey: string): Promise<PollResult>;
  testConnection(apiKey: string): Promise<{ ok: boolean; message: string }>;
}
