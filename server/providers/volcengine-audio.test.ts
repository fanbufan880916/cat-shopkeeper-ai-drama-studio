import { afterEach, describe, expect, it, vi } from "vitest";
import { VolcengineAudioProvider } from "./volcengine-audio.js";

describe("VolcengineAudioProvider", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends the documented audio generation payload", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: {
      produce_id: "produce-1", audio: Buffer.from("RIFF").toString("base64"), original_duration: 2.4, format: "wav"
    } }), { status: 200 }));
    const provider = new VolcengineAudioProvider();
    const result = await provider.submit({ id: "job-1", projectId: "p", shotId: null, assetId: null, audioAssetId: "aud-1", kind: "audio", provider: "volcengine", model: "seed-audio-1.0", prompt: "猫掌柜用沉稳普通话说：鞋可以带走。", params: {
      speaker: "S_demo", referenceAudioUrls: ["https://example.com/voice.mp3"], format: "wav", sampleRate: 24000, enableSubtitle: true, speechRate: 5, pitchRate: -1, loudnessRate: 0
    }, externalTaskId: null, status: "draft", progress: 0, cost: 0, creditsCost: 0, output: {}, error: "", attempt: 0, nextPollAt: null, createdAt: "", updatedAt: "" }, "secret");
    const [, init] = fetchMock.mock.calls[0];
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://openspeech.bytedance.com/api/v3/tts/create");
    expect((init?.headers as Record<string, string>)["X-Api-Key"]).toBe("secret");
    const payload = JSON.parse(String(init?.body));
    expect(payload).toMatchObject({ model: "seed-audio-1.0", text_prompt: "猫掌柜用沉稳普通话说：鞋可以带走。", speaker: "S_demo" });
    expect(payload.references).toEqual([{ audio_url: "https://example.com/voice.mp3" }]);
    expect(payload.audio_config).toMatchObject({ format: "wav", sample_rate: 24000, enable_subtitle: true, speech_rate: 5, pitch_rate: -1 });
    expect(result).toMatchObject({ taskId: "produce-1", status: "completed" });
  });
});
