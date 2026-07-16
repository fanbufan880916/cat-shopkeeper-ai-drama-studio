import type { GenerationJob } from "../../shared/types.js";
import type { GenerationProvider, PollResult, SubmitResult } from "./types.js";

const endpoint = "https://openspeech.bytedance.com/api/v3/tts/create";

type AudioParams = {
  speaker?: string;
  referenceAudioUrls?: string[];
  format?: "wav" | "mp3" | "pcm" | "ogg_opus";
  sampleRate?: number;
  enableSubtitle?: boolean;
  speechRate?: number;
  pitchRate?: number;
  loudnessRate?: number;
  propagateId?: string;
  contentProducer?: string;
  contentPropagator?: string;
  aigcWatermark?: boolean;
  enableWatermark?: boolean;
};

function errorMessage(status: number, body: unknown) {
  const value = body as { message?: string; Message?: string; error?: { message?: string } };
  const message = value?.message ?? value?.Message ?? value?.error?.message ?? `HTTP ${status}`;
  if (status === 401 || status === 403) return `火山豆包音频 API Key 无效或没有权限：${message}`;
  if (status === 429) return `火山豆包音频请求过于频繁：${message}`;
  if (status === 400) return `火山豆包音频参数不正确：${message}`;
  if (status >= 500) return `火山豆包音频服务暂时不可用：${message}`;
  return `火山豆包音频请求失败：${message}`;
}

async function request(apiKey: string, body: Record<string, unknown>) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorMessage(response.status, payload));
  const result = (payload as { data?: unknown }).data;
  return (result && typeof result === "object" ? result : payload) as Record<string, unknown>;
}

function buildPayload(job: GenerationJob) {
  const params = job.params as AudioParams;
  const audioConfig: Record<string, unknown> = {};
  if (params.format) audioConfig.format = params.format;
  if (params.sampleRate) audioConfig.sample_rate = params.sampleRate;
  if (params.enableSubtitle !== undefined) audioConfig.enable_subtitle = params.enableSubtitle;
  if (params.speechRate !== undefined) audioConfig.speech_rate = params.speechRate;
  if (params.pitchRate !== undefined) audioConfig.pitch_rate = params.pitchRate;
  if (params.loudnessRate !== undefined) audioConfig.loudness_rate = params.loudnessRate;

  const payload: Record<string, unknown> = {
    model: job.model || "seed-audio-1.0",
    text_prompt: job.prompt,
    audio_config: audioConfig
  };
  if (params.speaker) payload.speaker = params.speaker;
  if (params.referenceAudioUrls?.length) {
    payload.references = params.referenceAudioUrls.slice(0, 3).map((audio_url) => ({ audio_url }));
  }
  if (params.propagateId) payload.propagate_id = params.propagateId;
  if (params.contentProducer) payload.content_producer = params.contentProducer;
  if (params.contentPropagator) payload.content_propagator = params.contentPropagator;
  if (params.aigcWatermark !== undefined || params.enableWatermark !== undefined) {
    payload.watermark = {
      aigc_watermark: Boolean(params.aigcWatermark),
      enable: Boolean(params.enableWatermark)
    };
  }
  return payload;
}

export class VolcengineAudioProvider implements GenerationProvider {
  name = "volcengine" as const;

  async submit(job: GenerationJob, apiKey: string): Promise<SubmitResult> {
    if (!apiKey.trim()) throw new Error("尚未配置火山豆包音频 API Key。");
    if (job.kind !== "audio") throw new Error("火山豆包音频通道只接受音频任务。");
    const result = await request(apiKey, buildPayload(job));
    const audio = String(result.audio ?? "");
    const url = String(result.url ?? "");
    if (!audio && !url) throw new Error("豆包音频接口返回成功，但没有返回音频数据或音频地址。");
    const taskId = String(result.produce_id ?? result.id ?? `volc-audio-${job.id}`);
    return { taskId, status: "completed", output: { ...result, model: job.model || "seed-audio-1.0" } };
  }

  async poll(job: GenerationJob): Promise<PollResult> {
    if (job.status === "completed") return { status: "completed", progress: 100, output: job.output };
    return { status: "processing", progress: 50 };
  }

  async testConnection(apiKey: string) {
    if (!apiKey.trim()) return { ok: false, message: "请先填写火山豆包音频 API Key。" };
    return { ok: true, message: "API Key 格式已保存。火山音频接口是计费生成接口，工作台不会用测试按钮发起真实生成；首次点击“生成音频”时才会验证权限。" };
  }
}

