import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = process.env.CAT_STUDIO_DB ?? path.join(rootDir, ".data", "cat-studio.sqlite");
const mediaDir = path.join(path.dirname(dbPath), "media");
const args = process.argv.slice(2);
const projectIndex = args.indexOf("--project");
const projectId = projectIndex >= 0 ? args[projectIndex + 1] : "";
const mappings = args.filter((value, index) => index !== projectIndex && index !== projectIndex + 1 && /^\d+=/.test(value));

if (!projectId || !mappings.length) {
  console.error('用法：node scripts/import-shot-images.mjs --project <项目ID> "1=C:\\path\\shot1.png" "2=C:\\path\\shot2.png"');
  process.exit(1);
}

const database = new DatabaseSync(dbPath);
database.exec("PRAGMA busy_timeout=10000");
fs.mkdirSync(mediaDir, { recursive: true });
const stamp = new Date().toISOString();
const imported = [];

database.exec("BEGIN IMMEDIATE");
try {
  for (const mapping of mappings) {
    const separator = mapping.indexOf("=");
    const shotNumber = Number(mapping.slice(0, separator));
    const sourcePath = path.resolve(mapping.slice(separator + 1));
    if (!Number.isInteger(shotNumber) || shotNumber < 1) throw new Error(`镜头号无效：${mapping}`);
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) throw new Error(`图片不存在：${sourcePath}`);
    const ext = path.extname(sourcePath).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) throw new Error(`不支持的图片格式：${sourcePath}`);
    const shot = database.prepare("SELECT id,title,image_prompt FROM shots WHERE project_id=? AND shot_number=?").get(projectId, shotNumber);
    if (!shot) throw new Error(`项目中不存在镜头 ${shotNumber}`);

    const buffer = fs.readFileSync(sourcePath);
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const duplicate = database.prepare(`
      SELECT m.id,m.job_id AS jobId,m.local_path AS localPath
      FROM media_files m JOIN generation_jobs j ON j.id=m.job_id
      WHERE m.project_id=? AND j.shot_id=? AND json_extract(m.metadata_json,'$.sha256')=?
      LIMIT 1
    `).get(projectId, shot.id, sha256);
    if (duplicate) {
      imported.push({ shotNumber, title: shot.title, skipped: true, mediaId: duplicate.id, jobId: duplicate.jobId, localPath: duplicate.localPath });
      continue;
    }

    const jobId = `job_${crypto.randomUUID().replaceAll("-", "")}`;
    const mediaId = `med_${crypto.randomUUID().replaceAll("-", "")}`;
    const filename = `import-shot-${String(shotNumber).padStart(2, "0")}-${jobId.slice(-8)}${ext === ".jpeg" ? ".jpg" : ext}`;
    const localPath = path.join(mediaDir, filename);
    fs.copyFileSync(sourcePath, localPath);
    const params = { source: "user_import", shot_number: shotNumber };
    const output = { localPaths: [localPath], imported: true };
    const metadata = { source: "user_import", sourcePath, sha256, shotNumber };
    database.prepare(`
      INSERT INTO generation_jobs
      (id,project_id,shot_id,asset_id,kind,provider,model,prompt,params_json,external_task_id,status,progress,cost,credits_cost,output_json,error,attempt,next_poll_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(jobId, projectId, shot.id, null, "image", "codex", "用户导入分镜", shot.image_prompt || `镜头${shotNumber}候选图`, JSON.stringify(params), null,
      "completed", 100, 0, 0, JSON.stringify(output), "", 0, null, stamp, stamp);
    database.prepare(`
      INSERT INTO media_files (id,project_id,job_id,kind,local_path,source_url,expires_at,metadata_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(mediaId, projectId, jobId, "image", localPath, "", null, JSON.stringify(metadata), stamp);
    imported.push({ shotNumber, title: shot.title, skipped: false, mediaId, jobId, localPath });
  }
  database.exec("COMMIT");
} catch (error) {
  database.exec("ROLLBACK");
  throw error;
} finally {
  database.close();
}

console.log(JSON.stringify({ projectId, imported }, null, 2));
