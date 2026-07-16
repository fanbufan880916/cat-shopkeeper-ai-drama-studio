import type { FastifyReply } from "fastify";

const clients = new Set<FastifyReply>();

export function addEventClient(reply: FastifyReply) {
  clients.add(reply);
  reply.raw.on("close", () => clients.delete(reply));
}

export function emitEvent(type: string, payload: unknown = {}) {
  const body = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    try {
      client.raw.write(body);
    } catch {
      clients.delete(client);
    }
  }
}
