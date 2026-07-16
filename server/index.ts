import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import { dataDir, mediaDir, previewDir, rootDir, uploadDir } from "./paths.js";
import { registerRoutes } from "./routes.js";
import { refreshSkillStatus } from "./skills.js";
import { startWorker, stopWorker } from "./worker.js";

for (const dir of [dataDir, mediaDir, previewDir, uploadDir]) fs.mkdirSync(dir, { recursive: true });
refreshSkillStatus();

const app = Fastify({ logger: { level: process.env.NODE_ENV === "test" ? "silent" : "info", redact: ["req.headers.authorization", "body.apiKey"] } });
await app.register(multipart, { limits: { files: 1, fileSize: 10 * 1024 * 1024 } });
await registerRoutes(app);

const webRoot = path.join(rootDir, "dist", "web");
if (fs.existsSync(webRoot)) {
  await app.register(fastifyStatic, { root: webRoot });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) return reply.code(404).send({ error: "接口不存在。" });
    return reply.type("text/html").send(fs.readFileSync(path.join(webRoot, "index.html"), "utf8"));
  });
}

startWorker();
const port = Number(process.env.PORT ?? 4310);
await app.listen({ host: "127.0.0.1", port });

const shutdown = async () => {
  stopWorker();
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
