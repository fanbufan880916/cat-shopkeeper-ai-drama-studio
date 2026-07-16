import { describe, expect, it } from "vitest";
import { applyWorkbenchUpdate, inspectWorkbenchUpdate, normalizeGitHubRemote, parseAheadBehind, type UpdateCommandRunner } from "./workbench-update.js";

function createRunner(overrides: Record<string, string> = {}) {
  const calls: string[] = [];
  const values: Record<string, string> = {
    "git rev-parse --is-inside-work-tree": "true",
    "git remote get-url origin": "https://github.com/example/workbench.git",
    "git fetch --quiet --prune origin": "",
    "git branch --show-current": "main",
    "git rev-parse --abbrev-ref --symbolic-full-name @{u}": "origin/main",
    "git rev-parse --short=12 HEAD": "111111111111",
    "git rev-parse --short=12 @{u}": "222222222222",
    "git status --porcelain": "",
    "git rev-list --left-right --count HEAD...@{u}": "0 2",
    "git diff --name-only HEAD..@{u}": "src/App.tsx",
    "git pull --ff-only": "",
    "npm.cmd run build": "",
    "npm run build": "",
    ...overrides
  };
  const runner: UpdateCommandRunner = async (command, args) => {
    const key = `${command} ${args.join(" ")}`;
    calls.push(key);
    if (!(key in values)) throw new Error(`unexpected command: ${key}`);
    return values[key];
  };
  return { runner, calls };
}

describe("workbench GitHub updater", () => {
  it("sanitizes supported GitHub remotes without exposing credentials", () => {
    expect(normalizeGitHubRemote("git@github.com:owner/repo.git")).toBe("https://github.com/owner/repo");
    expect(normalizeGitHubRemote("https://token@github.com/owner/repo.git")).toBe("https://github.com/owner/repo");
    expect(normalizeGitHubRemote("https://example.com/owner/repo.git")).toBe("");
  });

  it("parses ahead and behind counts", () => {
    expect(parseAheadBehind("3\t7")).toEqual({ ahead: 3, behind: 7 });
  });

  it("allows a clean fast-forward update", async () => {
    const { runner } = createRunner();
    const status = await inspectWorkbenchUpdate({ fetch: true, runner });
    expect(status).toMatchObject({ state: "available", behind: 2, ahead: 0, dirty: false, canUpdate: true });
  });

  it("refuses to overwrite local changes", async () => {
    const { runner } = createRunner({ "git status --porcelain": " M src/App.tsx" });
    const status = await inspectWorkbenchUpdate({ runner });
    expect(status).toMatchObject({ state: "dirty", canUpdate: false });
    expect(status.message).toContain("不会自动更新");
  });

  it("pulls with fast-forward only and rebuilds without reinstalling unchanged dependencies", async () => {
    const { runner, calls } = createRunner({
      "git rev-list --left-right --count HEAD...@{u}": "0 1",
      "git rev-parse --short=12 HEAD": "111111111111",
      "git rev-parse --short=12 @{u}": "222222222222"
    });
    const result = await applyWorkbenchUpdate({ runner });
    expect(calls).toContain("git pull --ff-only");
    expect(calls.some((call) => call.endsWith("run build"))).toBe(true);
    expect(calls.some((call) => call.includes(" install "))).toBe(false);
    expect(result).toMatchObject({ buildCompleted: true, restartRequired: true });
  });
});
