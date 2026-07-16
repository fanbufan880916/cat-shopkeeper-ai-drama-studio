import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const [, , dbPath, inputPath] = process.argv;
if (!dbPath || !inputPath) throw new Error("Usage: node scripts/update-asset-from-json.mjs <db-path> <utf8-json-path>");

const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const required = ["id", "identityAnchor", "prompt", "negativePrompt"];
for (const field of required) {
  if (typeof input[field] !== "string" || !input[field].trim()) throw new Error(`Missing ${field}`);
}

const db = new DatabaseSync(dbPath);
const asset = db.prepare("SELECT id FROM assets WHERE id=?").get(input.id);
if (!asset) throw new Error("Asset not found");
db.prepare(`
  UPDATE assets
  SET identity_anchor=?, prompt=?, negative_prompt=?, status='stale', approved_job_id=NULL, updated_at=?
  WHERE id=?
`).run(input.identityAnchor, input.prompt, input.negativePrompt, new Date().toISOString(), input.id);

const updated = db.prepare(`
  SELECT id,name,version,status,
    length(identity_anchor)-length(replace(identity_anchor,'?','')) AS anchor_q,
    length(prompt)-length(replace(prompt,'?','')) AS prompt_q,
    length(negative_prompt)-length(replace(negative_prompt,'?','')) AS negative_q
  FROM assets WHERE id=?
`).get(input.id);
console.log(JSON.stringify(updated));
