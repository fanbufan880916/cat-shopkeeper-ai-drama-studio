import type { DashboardData, Project } from "../shared/types";
import type { WorkbenchUpdateStatus } from "../shared/workbench-update";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...(options?.headers as Record<string, string> | undefined) };
  if (options?.body) headers["Content-Type"] = "application/json";
  const response = await fetch(url, { ...options, headers, signal: options?.signal ?? AbortSignal.timeout(30_000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "操作失败，请稍后重试。");
  return body as T;
}

async function upload<T>(url: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(url, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "上传失败，请稍后重试。");
  return body as T;
}

async function uploadForm<T>(url: string, fields: Record<string, string>, file?: File): Promise<T> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (file) form.append("file", file);
  const response = await fetch(url, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "上传失败，请稍后重试。");
  return body as T;
}

export const api = {
  updateStatus: () => request<WorkbenchUpdateStatus>("/api/system/update-status"),
  checkUpdate: () => request<WorkbenchUpdateStatus>("/api/system/check-update", {
    method: "POST",
    headers: { "x-workbench-update-confirm": "check-github" },
    signal: AbortSignal.timeout(60_000)
  }),
  applyUpdate: () => request<WorkbenchUpdateStatus>("/api/system/apply-update", {
    method: "POST",
    headers: { "x-workbench-update-confirm": "pull-latest" },
    signal: AbortSignal.timeout(10 * 60_000)
  }),
  projects: () => request<Project[]>("/api/projects"),
  project: (id: string) => request<DashboardData>(`/api/projects/${id}`),
  createProject: (body: unknown) => request<Project>("/api/projects", { method: "POST", body: JSON.stringify(body) }),
  setCreativeProfile: (projectId: string, body: unknown) => request<Project>("/api/projects/" + projectId + "/creative-profile", { method: "PUT", body: JSON.stringify(body) }),
  deleteProject: (projectId: string) => request<{ ok: boolean; projectId: string; deletedFiles: number }>(`/api/projects/${projectId}`, { method: "DELETE" }),
  addArtifact: (projectId: string, body: unknown) => request(`/api/projects/${projectId}/artifacts`, { method: "POST", body: JSON.stringify(body) }),
  review: (projectId: string, body: unknown) => request(`/api/projects/${projectId}/reviews`, { method: "POST", body: JSON.stringify(body) }),
  saveAsset: (projectId: string, body: unknown) => request(`/api/projects/${projectId}/assets`, { method: "POST", body: JSON.stringify(body) }),
  uploadAssetReference: (assetId: string, file: File) => upload<{ ok: true; mediaId: string }>(`/api/assets/${assetId}/reference`, file),
  selectAssetReference: (assetId: string, mediaId: string) => request<{ ok: true; mediaId: string }>(`/api/assets/${assetId}/reference/select`, { method: "POST", body: JSON.stringify({ mediaId }) }),
  lockAssetImage: (assetId: string, jobId: string, mediaId: string) => request<{ ok: true; jobId: string; mediaId: string }>(`/api/assets/${assetId}/lock-image`, { method: "POST", body: JSON.stringify({ jobId, mediaId }) }),
  reviewAsset: (assetId: string, body: { decision: "approved" | "rejected"; feedback: string }) => request(`/api/assets/${assetId}/review`, { method: "POST", body: JSON.stringify(body) }),
  createCodexImageRequest: (assetId: string, body: { prompt: string; aspectRatio: string; quality: "standard" | "high"; count: number }) => request(`/api/assets/${assetId}/codex-image-requests`, { method: "POST", body: JSON.stringify(body) }),
  saveShot: (projectId: string, body: unknown) => request(`/api/projects/${projectId}/shots`, { method: "POST", body: JSON.stringify(body) }),
  createAudioAsset: (projectId: string, fields: Record<string, string>, file?: File) => uploadForm(`/api/projects/${projectId}/audio-assets`, fields, file),
  generateAudioAsset: (projectId: string, body: unknown) => request<{ audioAssetId: string; job: unknown }>(`/api/projects/${projectId}/audio-assets/generate`, { method: "POST", body: JSON.stringify(body) }),
  splitAudioAsset: (projectId: string, audioAssetId: string, body: unknown) => request<{ clips: unknown[] }>(`/api/projects/${projectId}/audio-assets/${audioAssetId}/split`, { method: "POST", body: JSON.stringify(body) }),
  updateAudioClip: (clipId: string, body: unknown) => request(`/api/audio-clips/${clipId}`, { method: "PUT", body: JSON.stringify(body) }),
  approveAudioClip: (clipId: string, shotId?: string | null) => request(`/api/audio-clips/${clipId}/approve`, { method: "POST", body: JSON.stringify({ shotId }) }),
  updateAudioAsset: (audioId: string, body: { remoteUrl: string; rightsNote: string; description: string }) => request(`/api/audio-assets/${audioId}`, { method: "PUT", body: JSON.stringify(body) }),
  createCodexShotImageRequest: (shotId: string, body: { prompt: string; aspectRatio: string; quality: "standard" | "high"; count: number }) => request(`/api/shots/${shotId}/codex-image-requests`, { method: "POST", body: JSON.stringify(body) }),
  cancelCodexImageRequest: (requestId: string) => request(`/api/codex-image-requests/${requestId}/cancel`, { method: "POST" }),
  lockShotImage: (shotId: string, jobId: string, mediaId: string) => request(`/api/shots/${shotId}/lock-image`, { method: "POST", body: JSON.stringify({ jobId, mediaId }) }),
  reviewShotVideo: (shotId: string, body: { jobId: string; decision: "approved" | "rejected"; feedback: string; observedEndState: string; observedAudioState: string }) => request(`/api/shots/${shotId}/video-review`, { method: "POST", body: JSON.stringify(body) }),
  createJob: (projectId: string, body: unknown) => request(`/api/projects/${projectId}/jobs`, { method: "POST", body: JSON.stringify(body) }),
  retryJob: (jobId: string) => request(`/api/jobs/${jobId}/retry`, { method: "POST" }),
  sampleApproval: (projectId: string, body: unknown) => request(`/api/projects/${projectId}/sample-approval`, { method: "POST", body: JSON.stringify(body) }),
  preview: (projectId: string) => request<{ artifactId: string; localPath: string; url: string }>(`/api/projects/${projectId}/preview`, { method: "POST" }),
  settings: () => request<{ hasApiKey: boolean; hasVolcengineAudioApiKey: boolean; imageModel: string; imageResolution: string; videoModel: string; audioModel: string; defaultProvider: "mock" | "apimart" }>("/api/settings"),
  saveSettings: (body: unknown) => request("/api/settings", { method: "PUT", body: JSON.stringify(body) }),
  testSettings: (provider: "mock" | "apimart" | "volcengine_audio", apiKey?: string) => request<{ ok: boolean; message: string }>("/api/settings/test", { method: "POST", body: JSON.stringify({ provider, apiKey }) })
};
