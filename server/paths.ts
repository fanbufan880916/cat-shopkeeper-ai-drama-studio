import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
export const rootDir = path.resolve(serverDir, "..");
const defaultDataDir = process.env.VITEST
  ? path.join(os.tmpdir(), "cat-studio-vitest", String(process.pid))
  : path.join(rootDir, ".data");
export const dataDir = process.env.CAT_STUDIO_DATA_DIR ?? defaultDataDir;
export const mediaDir = path.join(dataDir, "media");
export const uploadDir = path.join(dataDir, "uploads");
export const previewDir = path.join(dataDir, "previews");
export const deliveryRoot = path.join(rootDir, "delivery");
export function projectDeliveryDir(projectId: string) { return path.join(deliveryRoot, projectId); }
export const dbPath = process.env.CAT_STUDIO_DB ?? path.join(dataDir, "cat-studio.sqlite");
