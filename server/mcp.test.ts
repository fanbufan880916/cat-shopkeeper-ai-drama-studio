import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let client: Client;
let transport: StdioClientTransport;

beforeAll(async () => {
  transport = new StdioClientTransport({
    command: "npm.cmd",
    args: ["run", "mcp"],
    cwd: process.cwd(),
    stderr: "pipe"
  });
  client = new Client({ name: "cat-studio-test", version: "0.1.0" });
  await client.connect(transport);
});

afterAll(async () => {
  await client.close();
});

describe("MCP bridge", () => {
  it("lists tools and reads projects", async () => {
    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "list_open_revisions")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "get_skill_status")).toBe(true);
    const response = await client.callTool({ name: "list_projects", arguments: {} });
    expect(response.isError).not.toBe(true);
  }, 20_000);

  it("keeps new creative goal fields optional in MCP tools", async () => {
    const tools = await client.listTools();
    for (const name of ["create_project", "set_creative_profile"]) {
      const tool = tools.tools.find((item) => item.name === name);
      expect(tool).toBeDefined();
      const properties = (tool?.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
      expect(Object.keys(properties)).toEqual(expect.arrayContaining(["targetAudience", "creativePurpose", "targetEmotion"]));
      const required = (tool?.inputSchema as { required?: string[] }).required ?? [];
      expect(required).not.toContain("targetAudience");
      expect(required).not.toContain("creativePurpose");
      expect(required).not.toContain("targetEmotion");
    }
  }, 20_000);

  it("reports all four validated project skills", async () => {
    const response = await client.callTool({ name: "get_skill_status", arguments: {} });
    expect(response.isError).not.toBe(true);
    const content = (response.content as Array<{ type: string; text?: string }>)[0];
    expect(content.type).toBe("text");
    const payload = JSON.parse(content.type === "text" ? content.text ?? "{}" : "{}") as { skills: { name: string; valid: number }[] };
    expect(payload.skills.filter((skill) => skill.valid === 1).map((skill) => skill.name)).toEqual(expect.arrayContaining([
      "creative-production-orchestration", "doubao-audio-generation", "gpt-image-2-storyboard", "seedance-20"
    ]));
  }, 20_000);
});
