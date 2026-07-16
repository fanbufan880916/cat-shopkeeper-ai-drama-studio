import fs from "node:fs";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

const root = path.resolve(import.meta.dirname, "..");
const dataDir = path.join(root, ".data");
const snapshotDir = process.argv[2];
if (!snapshotDir) throw new Error("缺少备份临时目录。");

fs.mkdirSync(snapshotDir, { recursive: true });
const sourceDbPath = path.join(dataDir, "cat-studio.sqlite");
if (!fs.existsSync(sourceDbPath)) throw new Error("尚未找到工作台数据库。");

const sourceDb = new DatabaseSync(sourceDbPath, { readOnly: true });
try {
  await backup(sourceDb, path.join(snapshotDir, "cat-studio.sqlite"));
} finally {
  sourceDb.close();
}

for (const name of ["media", "uploads", "previews"]) {
  const source = path.join(dataDir, name);
  if (fs.existsSync(source)) fs.cpSync(source, path.join(snapshotDir, name), { recursive: true });
}
