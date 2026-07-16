import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { WorkbenchUpdateStatus } from "../shared/workbench-update.js";
import { rootDir } from "./paths.js";

const execFileAsync = promisify(execFile);
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")) as { version?: string };

export type UpdateCommandRunner = (command: string, args: string[], cwd: string) => Promise<string>;

const defaultRunner: UpdateCommandRunner = async (command, args, cwd) => {
  const { stdout } = await execFileAsync(command, args, {
    cwd,
    windowsHide: true,
    timeout: 10 * 60 * 1000,
    maxBuffer: 10 * 1024 * 1024
  });
  return stdout.trim();
};

function gitRunner(runner: UpdateCommandRunner, args: string[]) {
  return runner("git", args, rootDir);
}

export function normalizeGitHubRemote(remote: string) {
  const value = remote.trim();
  const sshMatch = value.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (sshMatch) return `https://github.com/${sshMatch[1]}/${sshMatch[2].replace(/\.git$/i, "")}`;
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() !== "github.com") return "";
    const pathname = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
    if (pathname.split("/").length !== 2) return "";
    return `https://github.com/${pathname}`;
  } catch {
    return "";
  }
}

export function parseAheadBehind(value: string) {
  const [aheadText = "0", behindText = "0"] = value.trim().split(/\s+/);
  return {
    ahead: Number.parseInt(aheadText, 10) || 0,
    behind: Number.parseInt(behindText, 10) || 0
  };
}

function unavailable(message: string): WorkbenchUpdateStatus {
  return {
    version: packageJson.version ?? "0.0.0",
    state: "unavailable",
    branch: "",
    upstream: "",
    repositoryUrl: "",
    localCommit: "",
    remoteCommit: "",
    ahead: 0,
    behind: 0,
    dirty: false,
    updateAvailable: false,
    canUpdate: false,
    message,
    checkedAt: new Date().toISOString()
  };
}

export async function inspectWorkbenchUpdate(
  options: { fetch?: boolean; runner?: UpdateCommandRunner } = {}
): Promise<WorkbenchUpdateStatus> {
  const runner = options.runner ?? defaultRunner;
  try {
    const inside = await gitRunner(runner, ["rev-parse", "--is-inside-work-tree"]);
    if (inside !== "true") return unavailable("当前目录不是 Git 仓库，无法在工作台内直接更新。");
  } catch {
    return unavailable("当前是压缩包安装或未安装 Git。请使用 Git clone 安装后再使用一键更新。");
  }

  try {
    const remoteRaw = await gitRunner(runner, ["remote", "get-url", "origin"]);
    const repositoryUrl = normalizeGitHubRemote(remoteRaw);
    if (!repositoryUrl) return unavailable("origin 不是可识别的 GitHub 仓库，已停止自动更新。");
    if (options.fetch) await gitRunner(runner, ["fetch", "--quiet", "--prune", "origin"]);

    const branch = await gitRunner(runner, ["branch", "--show-current"]);
    if (!branch) return unavailable("当前处于临时提交状态，请先切回正常分支再更新。");
    let upstream = "";
    try {
      upstream = await gitRunner(runner, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    } catch {
      return unavailable(`当前分支 ${branch} 没有关联 GitHub 远端分支，无法自动更新。`);
    }

    const [localCommit, remoteCommit, dirtyOutput, distance] = await Promise.all([
      gitRunner(runner, ["rev-parse", "--short=12", "HEAD"]),
      gitRunner(runner, ["rev-parse", "--short=12", "@{u}"]),
      gitRunner(runner, ["status", "--porcelain"]),
      gitRunner(runner, ["rev-list", "--left-right", "--count", "HEAD...@{u}"])
    ]);
    const { ahead, behind } = parseAheadBehind(distance);
    const dirty = Boolean(dirtyOutput.trim());
    let state: WorkbenchUpdateStatus["state"] = "current";
    let message = "当前已经是 GitHub 最新版本。";
    if (dirty) {
      state = "dirty";
      message = "检测到未提交的源码修改。为避免覆盖你的改动，工作台不会自动更新。";
    } else if (ahead > 0 && behind > 0) {
      state = "diverged";
      message = "本地和 GitHub 都有不同修改，不能安全自动合并，请先人工处理 Git 冲突。";
    } else if (ahead > 0) {
      state = "ahead";
      message = "本地版本领先 GitHub，请先推送本地提交，再检查更新。";
    } else if (behind > 0) {
      state = "available";
      message = `发现 ${behind} 个 GitHub 更新，可以安全拉取。`;
    }

    return {
      version: packageJson.version ?? "0.0.0",
      state,
      branch,
      upstream,
      repositoryUrl,
      localCommit,
      remoteCommit,
      ahead,
      behind,
      dirty,
      updateAvailable: behind > 0,
      canUpdate: state === "available",
      message,
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    return unavailable(`检查更新失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function applyWorkbenchUpdate(
  options: { runner?: UpdateCommandRunner } = {}
): Promise<WorkbenchUpdateStatus> {
  const runner = options.runner ?? defaultRunner;
  const before = await inspectWorkbenchUpdate({ fetch: true, runner });
  if (!before.canUpdate) throw new Error(before.message);

  const changedFiles = await gitRunner(runner, ["diff", "--name-only", "HEAD..@{u}"]);
  await gitRunner(runner, ["pull", "--ff-only"]);

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const dependencyFilesChanged = changedFiles.split(/\r?\n/).some((file) =>
    ["package.json", "package-lock.json", "npm-shrinkwrap.json"].includes(file.trim())
  );
  if (dependencyFilesChanged) {
    await runner(npmCommand, ["install", "--no-audit", "--no-fund"], rootDir);
  }
  await runner(npmCommand, ["run", "build"], rootDir);

  const after = await inspectWorkbenchUpdate({ runner });
  return {
    ...after,
    dependenciesInstalled: dependencyFilesChanged,
    buildCompleted: true,
    restartRequired: true,
    message: "更新内容已经拉取并完成构建。请重新启动工作台，使服务端更新正式生效。"
  };
}
