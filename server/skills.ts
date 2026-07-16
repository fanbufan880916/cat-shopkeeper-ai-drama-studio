import fs from "node:fs";
import path from "node:path";
import { db } from "./db.js";
import { rootDir } from "./paths.js";

interface SkillMarker {
  name: string;
  version: string;
  source: string;
  commitHash?: string;
  checksum?: string;
  valid: boolean;
  details?: string;
  updatedAt: string;
}

export function refreshSkillStatus() {
  const skillsRoot = path.join(rootDir, ".agents", "skills");
  if (!fs.existsSync(skillsRoot)) return;
  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const markerPath = path.join(skillsRoot, entry.name, ".validated.json");
    if (!fs.existsSync(markerPath)) continue;
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8").replace(/^\uFEFF/, "")) as SkillMarker;
    db.prepare(`INSERT INTO skill_status(name,version,source,commit_hash,checksum,valid,details,updated_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET version=excluded.version,source=excluded.source,
      commit_hash=excluded.commit_hash,checksum=excluded.checksum,valid=excluded.valid,details=excluded.details,updated_at=excluded.updated_at`).run(
      marker.name, marker.version, marker.source, marker.commitHash ?? "", marker.checksum ?? "", marker.valid ? 1 : 0, marker.details ?? "", marker.updatedAt);
  }
}
