export type VideoResolution = "480p" | "720p" | "1080p";

export const videoModelOptions = [
  { id: "doubao-seedance-2.0", label: "doubao-seedance-2.0 标准版", resolutions: ["480p", "720p", "1080p"] as VideoResolution[] },
  { id: "doubao-seedance-2.0-fast", label: "doubao-seedance-2.0-fast 快速版", resolutions: ["480p", "720p"] as VideoResolution[] },
  { id: "doubao-seedance-2.0-mini", label: "doubao-seedance-2.0-mini 轻量版", resolutions: ["480p", "720p"] as VideoResolution[] },
] as const;

export function videoModelOption(model: string) {
  return videoModelOptions.find((option) => option.id === model) ?? videoModelOptions[0];
}

export function isVideoResolution(value: unknown): value is VideoResolution {
  return value === "480p" || value === "720p" || value === "1080p";
}
