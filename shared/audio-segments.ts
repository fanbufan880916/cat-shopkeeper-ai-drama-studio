export type AutomaticAudioLine = {
  shotId: string | null;
  speaker: string;
  text: string;
};

export type AudioSubtitleSentence = {
  startMs: number;
  endMs: number;
  text: string;
};

export type AutomaticAudioSegment = AutomaticAudioLine & {
  startMs: number;
  endMs: number;
  handleMs: number;
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedDialogue(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[\s“”"'‘’「」『』，。！？：；、,.!?:;…—-]/g, "");
}

export function subtitleSentencesFromJobOutput(output: unknown): AudioSubtitleSentence[] {
  const root = objectValue(output);
  const subtitle = objectValue(root?.subtitle);
  if (!Array.isArray(subtitle?.sentences)) return [];
  return subtitle.sentences.flatMap((value) => {
    const sentence = objectValue(value);
    const startMs = numberValue(sentence?.start_time ?? sentence?.startMs);
    const endMs = numberValue(sentence?.end_time ?? sentence?.endMs);
    const text = typeof sentence?.text === "string" ? sentence.text.trim() : "";
    if (!text || endMs <= startMs) return [];
    return [{ startMs: Math.round(startMs), endMs: Math.round(endMs), text }];
  });
}

function subtitleSegments(lines: AutomaticAudioLine[], sentences: AudioSubtitleSentence[]) {
  const used = new Set<number>();
  const matched = lines.map((line) => {
    const target = normalizedDialogue(line.text);
    const index = sentences.findIndex((sentence, sentenceIndex) => {
      if (used.has(sentenceIndex)) return false;
      const candidate = normalizedDialogue(sentence.text);
      return candidate === target || candidate.includes(target) || target.includes(candidate);
    });
    if (index < 0) return null;
    used.add(index);
    const sentence = sentences[index];
    return { ...line, startMs: sentence.startMs, endMs: sentence.endMs, handleMs: 150 };
  });
  return matched.every((segment): segment is AutomaticAudioSegment => segment !== null) ? matched : null;
}

function estimatedSegments(lines: AutomaticAudioLine[], masterDurationSeconds: number) {
  const estimates = lines.map((line) => Math.max(700, line.text.length * 230 + 420));
  const totalEstimate = estimates.reduce((sum, value) => sum + value, 0);
  const masterMs = masterDurationSeconds > 0 ? masterDurationSeconds * 1000 : totalEstimate;
  const scale = totalEstimate > masterMs ? masterMs / totalEstimate : 1;
  let cursor = 0;
  return lines.map((line, index) => {
    const startMs = Math.round(cursor * scale);
    cursor += estimates[index];
    const endMs = Math.max(startMs + 500, Math.round(cursor * scale));
    return { ...line, startMs, endMs, handleMs: 150 };
  });
}

export function buildAutomaticAudioSegments(lines: AutomaticAudioLine[], masterDurationSeconds: number, output: unknown) {
  const sentences = subtitleSentencesFromJobOutput(output);
  const exact = subtitleSegments(lines, sentences);
  return exact
    ? { source: "subtitle" as const, segments: exact }
    : { source: "estimate" as const, segments: estimatedSegments(lines, masterDurationSeconds) };
}
