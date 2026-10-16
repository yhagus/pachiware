import { afterEach, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workspace = process.cwd();
const hook = join(workspace, ".githooks/commit-msg");

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function text(data: Uint8Array | undefined) {
  return new TextDecoder().decode(data).trim();
}

/** The environment without git's own variables, which a surrounding hook run (pre-push) would otherwise leak into the scratch repo. */
function cleanEnv(extra: Record<string, string> = {}) {
  const env: Record<string, string | undefined> = { ...process.env, ...extra };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_") && !(key in extra)) delete env[key];
  return env;
}

/** A scratch repository whose only hook is the commit-msg hook under test. */
function scratchRepo() {
  const directory = mkdtempSync(join(tmpdir(), "pachiware-commit-msg-"));
  directories.push(directory);
  const hooks = join(directory, "hooks"), repo = join(directory, "repo");
  mkdirSync(hooks);
  mkdirSync(repo);
  copyFileSync(hook, join(hooks, "commit-msg"));
  const git = (args: string[], env: Record<string, string> = {}) => {
    const result = Bun.spawnSync({ cmd: ["git", ...args], cwd: repo, env: cleanEnv({ GIT_CONFIG_NOSYSTEM: "1", HOME: directory, ...env }), stdin: "ignore" });
    return { exitCode: result.exitCode, stdout: text(result.stdout), stderr: text(result.stderr) };
  };
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "dev@example.com"]);
  git(["config", "user.name", "Dev"]);
  git(["config", "core.hooksPath", hooks]);
  const commitFile = (content: string, message: string) => {
    writeFileSync(join(repo, "notes.txt"), content);
    git(["add", "notes.txt"]);
    return git(["commit", "-q", "-m", message]);
  };
  /** Leaves `main` mid-merge with notes.txt conflicted, then resolves the file. */
  const conflictedMerge = () => {
    commitFile("base\n", "chore: base");
    git(["checkout", "-q", "-b", "other"]);
    commitFile("other\n", "chore: other side");
    git(["checkout", "-q", "main"]);
    commitFile("main\n", "chore: main side");
    expect(git(["merge", "other"]).exitCode).not.toBe(0);
    writeFileSync(join(repo, "notes.txt"), "resolved\n");
    git(["add", "notes.txt"]);
  };
  const lastMessage = () => git(["log", "-1", "--format=%B"]).stdout;
  return { git, repo, commitFile, conflictedMerge, lastMessage };
}

describe("commit-msg hook", () => {
  test("is installed by bun install like the other hooks: tracked as executable in .githooks", () => {
    const prepare = JSON.parse(readFileSync(join(workspace, "package.json"), "utf8")).scripts.prepare;
    expect(prepare).toContain("core.hooksPath .githooks");
    const tracked = Bun.spawnSync({ cmd: ["git", "ls-files", "-s", ".githooks/commit-msg"], cwd: workspace, env: cleanEnv() });
    expect(text(tracked.stdout)).toStartWith("100755 ");
  });

  test("refuses a conflicted merge committed with --no-edit, which would keep git's Conflicts block", () => {
    const repo = scratchRepo();
    repo.conflictedMerge();

    const result = repo.git(["commit", "--no-edit"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Conflicts");
    expect(result.stderr).toContain("git commit");
    expect(existsSync(join(repo.repo, ".git/MERGE_HEAD"))).toBe(true);
    expect(repo.lastMessage()).toBe("chore: main side");
  });

  test("lets the conflicted merge through once it is committed through the editor, which drops the comment lines", () => {
    const repo = scratchRepo();
    repo.conflictedMerge();
    repo.git(["commit", "--no-edit"]);

    const result = repo.git(["commit"], { GIT_EDITOR: "true" });

    expect(result.exitCode).toBe(0);
    expect(repo.lastMessage()).toBe("Merge branch 'other'");
  });

  test("follows commit.cleanup: refuses through the editor when comments are kept, allows --no-edit when they are stripped", () => {
    const kept = scratchRepo();
    kept.git(["config", "commit.cleanup", "whitespace"]);
    kept.conflictedMerge();
    expect(kept.git(["commit"], { GIT_EDITOR: "true" }).exitCode).not.toBe(0);

    const stripped = scratchRepo();
    stripped.git(["config", "commit.cleanup", "strip"]);
    stripped.conflictedMerge();
    expect(stripped.git(["commit", "--no-edit"]).exitCode).toBe(0);
    expect(stripped.lastMessage()).toBe("Merge branch 'other'");
  });

  test("refuses the block under another core.commentChar", () => {
    const repo = scratchRepo();
    repo.git(["config", "core.commentChar", ";"]);
    repo.conflictedMerge();

    const result = repo.git(["commit", "--no-edit"]);

    expect(result.exitCode).not.toBe(0);
    expect(repo.lastMessage()).toBe("chore: main side");
  });

  test("lets an ordinary commit through, even one that mentions conflicts in prose", () => {
    const repo = scratchRepo();
    repo.commitFile("base\n", "chore: base");
    const message = "fix(db): settle merge conflicts in the seed\n\nConflicts: none left after the rebase.\n# Conflicts:\nwere listed in the issue, not here.";

    const result = repo.commitFile("next\n", message);

    expect(result.exitCode).toBe(0);
    expect(repo.lastMessage()).toBe(message);
  });

  test("lets a clean merge through", () => {
    const repo = scratchRepo();
    repo.commitFile("base\n", "chore: base");
    repo.git(["checkout", "-q", "-b", "other"]);
    writeFileSync(join(repo.repo, "other.txt"), "other\n");
    repo.git(["add", "other.txt"]);
    repo.git(["commit", "-q", "-m", "chore: other side"]);
    repo.git(["checkout", "-q", "main"]);
    repo.commitFile("main\n", "chore: main side");

    const result = repo.git(["merge", "--no-edit", "other"]);

    expect(result.exitCode).toBe(0);
    expect(repo.lastMessage()).toBe("Merge branch 'other'");
  });
});
