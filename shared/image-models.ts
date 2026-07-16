export const imageModelOptions = [
  { id: "gpt-image-2-official", label: "GPT-Image-2 官方通道", resolutions: ["1k", "2k"], counts: [1, 2, 3, 4] },
  { id: "gpt-image-2", label: "GPT-Image-2 常规通道", resolutions: ["1k", "2k"], counts: [1, 2, 3, 4] },
  { id: "gemini-2.5-flash-image-preview-official", label: "Nano Banana 官方通道", resolutions: ["1k"], counts: [1] },
  { id: "doubao-seedream-5-0-pro", label: "Doubao Seedream 5.0 Pro", resolutions: ["1k", "2k"], counts: [1] },
  { id: "midjourney", label: "Midjourney", resolutions: ["standard", "fast", "turbo"], counts: [4] }
] as const;

export type ImageModelId = (typeof imageModelOptions)[number]["id"];

export function imageModelOption(model: string) {
  return imageModelOptions.find((option) => option.id === model) ?? imageModelOptions[0];
}

export function imageModelParams(model: string, resolution: string, size: string, count: number) {
  if (model === "midjourney") return { size, speed: resolution, version: "7", style: "raw" };
  if (model === "gemini-2.5-flash-image-preview-official") return { size, resolution: "1K", n: 1 };
  if (model === "doubao-seedream-5-0-pro") return { size, resolution: resolution.toUpperCase(), n: 1 };
  return { size, resolution, quality: "high", n: count };
}

export function imageResolutionLabel(model: string, value: string) {
  if (model === "midjourney") return value === "turbo" ? "极速模式" : value === "fast" ? "快速模式" : "标准模式";
  return value === "1k" ? "1K 草稿" : "2K 精细";
}
