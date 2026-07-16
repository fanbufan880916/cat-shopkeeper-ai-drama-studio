import fs from "node:fs";
import path from "node:path";
import type { GenerationJob } from "../../shared/types.js";
import type { GenerationProvider, PollResult, SubmitResult } from "./types.js";

const baseUrl = "https://api.apimart.ai";

function generationPayload(job: GenerationJob) {
  const payload: Record<string, unknown> = { model: job.model, prompt: job.prompt, ...job.params };
  if (job.kind === "image" && job.model === "midjourney") delete payload.model;
  if (job.kind === "image" && job.model === "gpt-image-2") {
    // The regular channel does not expose the official channel's quality field.
    delete payload.quality;
  }
  return payload;
}

function normalizeError(status: number, body: unknown) {
  const data = body as { error?: { message?: string; type?: string }; message?: string };
  const message = data?.error?.message ?? data?.message ?? `APIMart 请求失败（HTTP ${status}）`;
  if (status === 401) return `API Key 无效：${message}`;
  if (status === 402) return `账户余额不足：${message}`;
  if (status === 403) return `当前 API Key 没有访问权限：${message}`;
  if (status === 429) return `请求过于频繁：${message}`;
  if (status === 400) return `生成参数或内容不符合要求：${message}`;
  if (status >= 500) return `APIMart 或上游模型暂时不可用：${message}`;
  return message;
}

async function request(apiKey: string, endpoint: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init.headers
    },
    signal: AbortSignal.timeout(60_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(normalizeError(response.status, body));
  return body as Record<string, unknown>;
}

function taskIdFrom(body: Record<string, unknown>) {
  const data = body.data;
  if (Array.isArray(data)) return String((data[0] as Record<string, unknown>)?.task_id ?? "");
  if (data && typeof data === "object") return String((data as Record<string, unknown>).task_id ?? (data as Record<string, unknown>).id ?? "");
  return String(body.task_id ?? body.id ?? "");
}

export class APIMartProvider implements GenerationProvider {
  name = "apimart" as const;

  async uploadImage(apiKey: string, localPath: string) {
    const form = new FormData();
    const buffer = fs.readFileSync(localPath);
    form.append("file", new Blob([buffer]), path.basename(localPath));
    const body = await request(apiKey, "/v1/uploads/images", { method: "POST", body: form });
    if (!body.url) throw new Error("APIMart 上传成功，但没有返回图片 URL。");
    return { url: String(body.url), expiresAt: new Date(Date.now() + 72 * 3600_000).toISOString() };
  }

  async submit(job: GenerationJob, apiKey: string): Promise<SubmitResult> {
    const endpoint = job.kind === "image"
      ? job.model === "midjourney" ? "/v1/midjourney/generations" : "/v1/images/generations"
      : "/v1/videos/generations";
    const payload = generationPayload(job);
    const body = await request(apiKey, endpoint, { method: "POST", body: JSON.stringify(payload) });
    const taskId = taskIdFrom(body);
    if (!taskId) throw new Error("APIMart 没有返回 task_id，任务无法追踪。");
    return { taskId, status: "submitted" };
  }

  async poll(job: GenerationJob, apiKey: string): Promise<PollResult> {
    if (!job.externalTaskId) throw new Error("任务缺少 APIMart task_id。");
    const body = await request(apiKey, `/v1/tasks/${encodeURIComponent(job.externalTaskId)}`);
    const data = (body.data ?? body) as Record<string, unknown>;
    const rawStatus = String(data.status ?? "submitted");
    const status = rawStatus === "completed" ? "completed" : rawStatus === "failed" ? "failed" : rawStatus === "processing" || rawStatus === "in_progress" ? "processing" : "submitted";
    const errorData = data.error as { message?: string } | undefined;
    return {
      status,
      progress: Number(data.progress ?? (status === "completed" ? 100 : 0)),
      cost: Number(data.cost ?? 0),
      creditsCost: Number(data.credits_cost ?? 0),
      output: data.result ?? {},
      error: errorData?.message ?? ""
    };
  }

  async testConnection(apiKey: string) {
    try {
      const body = await request(apiKey, "/v1/balance");
      if (body.success === false) return { ok: false, message: String(body.message ?? "API Key 无效或已被删除。") };
      if (body.unlimited_quota === true) return { ok: true, message: "连接成功，当前 API Key 为无限额度。" };
      const balance = body.remain_balance ?? body.remain_credits;
      return { ok: true, message: balance === undefined ? "连接成功，API Key 可用。" : `连接成功，当前可用额度：${String(balance)}` };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }
}
