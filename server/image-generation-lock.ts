import { db } from "./db.js";

type ImageTarget = { projectId: string; shotId?: string | null; assetId?: string | null };

export type ActiveImageGeneration = {
  id: string;
  channel: "codex" | "apimart";
  status: string;
};

export function findActiveImageGeneration(target: ImageTarget): ActiveImageGeneration | null {
  const column = target.shotId ? "shot_id" : target.assetId ? "asset_id" : null;
  const targetId = target.shotId ?? target.assetId ?? null;
  if (!column || !targetId) return null;

  const codex = db.prepare(`
    SELECT id,status FROM codex_image_requests
    WHERE project_id=? AND ${column}=? AND status IN ('queued','processing')
    ORDER BY created_at DESC LIMIT 1
  `).get(target.projectId, targetId) as { id: string; status: string } | undefined;
  if (codex) return { id: codex.id, channel: "codex", status: codex.status };

  const apimart = db.prepare(`
    SELECT id,status FROM generation_jobs
    WHERE project_id=? AND ${column}=? AND kind='image' AND provider='apimart'
      AND status IN ('draft','submitted','processing')
    ORDER BY created_at DESC LIMIT 1
  `).get(target.projectId, targetId) as { id: string; status: string } | undefined;
  return apimart ? { id: apimart.id, channel: "apimart", status: apimart.status } : null;
}

export function assertNoActiveImageGeneration(target: ImageTarget) {
  const active = findActiveImageGeneration(target);
  if (!active) return;
  if (active.channel === "codex") {
    throw new Error("当前对象已有 Codex 生图任务等待处理或正在生成。请先取消该任务，再切换到 APIMart；不能同时使用两种生图方式。");
  }
  throw new Error("当前对象已有 APIMart 付费生图任务正在提交或处理。上游任务不能可靠取消，完成或失败前不能切换到 Codex，也不能重复提交。");
}
