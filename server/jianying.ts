import fs from "node:fs";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { dataDir, rootDir } from "./paths.js";
import { store } from "./db.js";

const execFile = promisify(execFileCallback);

export type JianyingOperation = "check" | "create-project" | "import-media" | "write-timeline" | "render" | "status" | "cancel";
export type JianyingCommandTemplates = Partial<Record<Exclude<JianyingOperation, "check" | "status" | "cancel">, string[]>>;

export interface JianyingConfig {
  enabled: boolean;
  executable: string;
  adapter: string;
  projectRoot: string;
  timeoutSeconds: number;
  commandTemplates: JianyingCommandTemplates;
}

export interface JianyingCommandResult {
  ok: boolean;
  operation: JianyingOperation;
  stdout: string;
  stderr: string;
  data?: unknown;
}

const defaultConfig = (): JianyingConfig => ({
  enabled: true,
  executable: "",
  adapter: path.join(rootDir, "scripts", "jianying-adapter.ps1"),
  projectRoot: path.join(dataDir, "jianying-projects"),
  timeoutSeconds: 900,
  commandTemplates: {}
});

function parseConfig(raw: string | null): JianyingConfig {
  if (!raw) return defaultConfig();
  try {
    const value = JSON.parse(raw) as Partial<JianyingConfig>;
    const defaults = defaultConfig();
    return {
      ...defaults,
      ...value,
      timeoutSeconds: Number(value.timeoutSeconds ?? defaults.timeoutSeconds),
      commandTemplates: value.commandTemplates ?? defaults.commandTemplates
    };
  } catch {
    return defaultConfig();
  }
}

export function getJianyingConfig(): JianyingConfig {
  return parseConfig(store.getSetting("jianying_config"));
}

export function saveJianyingConfig(input: Partial<JianyingConfig>) {
  const current = getJianyingConfig();
  const next: JianyingConfig = {
    ...current,
    ...input,
    timeoutSeconds: Math.max(1, Math.min(86400, Number(input.timeoutSeconds ?? current.timeoutSeconds))),
    commandTemplates: input.commandTemplates ?? current.commandTemplates
  };
  store.setSetting("jianying_config", JSON.stringify(next));
  return next;
}

function resolveConfiguredPath(value: string) {
  return path.isAbsolute(value) ? value : path.resolve(rootDir, value);
}

async function executableExists(executable: string) {
  if (!executable.trim()) return false;
  const candidate = resolveConfiguredPath(executable);
  if (path.isAbsolute(executable) || executable.includes("\\") || executable.includes("/")) {
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
  }
  try {
    await execFile("where.exe", [executable], { timeout: 5000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function parseAdapterOutput(stdout: string) {
  const text = stdout.trim();
  if (!text) return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
}

export async function checkJianyingCli(config = getJianyingConfig()): Promise<JianyingCommandResult> {
  const adapterPath = resolveConfiguredPath(config.adapter);
  if (!config.enabled) return { ok: false, operation: "check", stdout: "", stderr: "剪映 CLI 已在配置中禁用。" };
  if (!fs.existsSync(adapterPath)) return { ok: false, operation: "check", stdout: "", stderr: `剪映适配器不存在：${adapterPath}` };
  if (!(await executableExists(config.executable))) {
    return { ok: false, operation: "check", stdout: "", stderr: `剪映 CLI 不可用：${config.executable || "尚未配置路径"}` };
  }
  return invokeAdapter("check", config);
}

export async function invokeAdapter(operation: JianyingOperation, config = getJianyingConfig(), options: { manifestPath?: string; outputPath?: string; projectRoot?: string } = {}): Promise<JianyingCommandResult> {
  const adapterPath = resolveConfiguredPath(config.adapter);
  const projectRoot = options.projectRoot || config.projectRoot;
  const template = (operation in config.commandTemplates) ? config.commandTemplates[operation as keyof JianyingCommandTemplates] : undefined;
  const args = [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", adapterPath,
    "-Operation", operation,
    "-Executable", config.executable,
    "-ProjectRoot", projectRoot
  ];
  if (options.manifestPath) args.push("-Manifest", options.manifestPath);
  if (options.outputPath) args.push("-Output", options.outputPath);
  if (template) args.push("-CommandJson", JSON.stringify(template));
  try {
    const result = await execFile("powershell.exe", args, {
      cwd: rootDir,
      timeout: config.timeoutSeconds * 1000,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    });
    const data = parseAdapterOutput(result.stdout);
    const ok = Boolean((data as { ok?: boolean } | undefined)?.ok ?? true);
    return { ok, operation, stdout: result.stdout, stderr: result.stderr, data };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message?: string };
    const stdout = String(failure.stdout ?? "");
    const stderr = String(failure.stderr ?? failure.message ?? error);
    const data = parseAdapterOutput(stdout);
    return { ok: false, operation, stdout, stderr, data };
  }
}

export async function runJianyingEdit(config: JianyingConfig, manifestPath: string, outputPath: string, projectRoot: string) {
  const check = await checkJianyingCli(config);
  if (!check.ok) throw new Error(check.stderr || "剪映 CLI 检查失败。");
  const operations: JianyingOperation[] = ["create-project", "import-media", "write-timeline", "render"];
  const results: JianyingCommandResult[] = [];
  for (const operation of operations) {
    const template = (operation in config.commandTemplates) ? config.commandTemplates[operation as keyof JianyingCommandTemplates] : undefined;
    if (operation !== "render" && !template) continue;
    const result = await invokeAdapter(operation, config, { manifestPath, outputPath, projectRoot });
    results.push(result);
    if (!result.ok) throw new Error(result.stderr || `${operation} 执行失败。`);
  }
  if (!config.commandTemplates.render) throw new Error("剪映 CLI 尚未配置 render 命令模板，已停止导出。");
  return results;
}

export function serializeCommandResults(results: JianyingCommandResult[]) {
  return results.map((item) => ({ operation: item.operation, ok: item.ok, stdout: item.stdout, stderr: item.stderr, data: item.data }));
}
