/**
 * scripts/os/contradiction.test.ts — coverage for the script that actually runs.
 *
 * WHY. The #399 adversarial audit landed this verdict on the previous version:
 * "the script that actually computes D13 against merge history has zero test
 * coverage, is not run by any workflow or hook, and is excluded from tsc; it can
 * be gutted with the entire suite green." That was true, and it is the same
 * failure one level up from the D4 duplicate matcher — a mechanism nothing
 * exercises is a mechanism that quietly stops working.
 *
 * These tests EXECUTE the real script against a purpose-built git repository, so
 * they cover the parts a unit test of `shared/os/goal.ts` cannot: ledger reading,
 * commit resolution, the shallow-clone degradation, and the report itself.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(__dirname, "..", "..");
const SCRIPT = join(REPO, "scripts/os/contradiction.mts");

let sandbox: string;
let onGoalSha: string;

/** Run the real script inside `cwd`, returning stdout (stderr suppressed). */
function run(cwd: string): string {
  return execFileSync("npx", ["tsx", join(cwd, "scripts/os/contradiction.mts")], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

const git = (cwd: string, ...a: string[]) =>
  execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/**
 * Point `origin/os-ledger` at a commit whose tree is exactly `cycles.jsonl`.
 *
 * Built with plumbing (hash-object / mktree / commit-tree) rather than by
 * checking out an orphan branch: an orphan checkout leaves the whole working
 * tree untracked, and switching back to main then fails with "would be
 * overwritten". No branch is ever switched here, so the sandbox stays intact.
 */
function writeLedgerRef(cwd: string, contents: string): void {
  const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], {
    cwd,
    input: contents,
    encoding: "utf8",
  }).trim();
  const tree = execFileSync("git", ["mktree"], {
    cwd,
    input: `100644 blob ${blob}\tcycles.jsonl\n`,
    encoding: "utf8",
  }).trim();
  const commit = execFileSync("git", ["commit-tree", tree, "-m", "ledger"], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@e.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@e.com",
    },
  }).trim();
  git(cwd, "update-ref", "refs/remotes/origin/os-ledger", commit);
}

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), "os-contradiction-"));

  // A minimal repo carrying the real script, the real library, and a real goal.
  mkdirSync(join(sandbox, "scripts/os"), { recursive: true });
  mkdirSync(join(sandbox, "shared/os"), { recursive: true });
  mkdirSync(join(sandbox, "os/goals"), { recursive: true });
  cpSync(SCRIPT, join(sandbox, "scripts/os/contradiction.mts"));
  cpSync(join(REPO, "shared/os/goal.ts"), join(sandbox, "shared/os/goal.ts"));
  cpSync(join(REPO, "shared/os/cycle.ts"), join(sandbox, "shared/os/cycle.ts"));
  writeFileSync(
    join(sandbox, "os/goals/GR-0001-test.md"),
    readFileSync(join(REPO, "os/goals/GR-0001-ai-native-certification.md"), "utf8"),
  );
  // node_modules is needed for `tsx`; symlink rather than install.
  execFileSync("ln", ["-sfn", join(REPO, "node_modules"), join(sandbox, "node_modules")]);

  git(sandbox, "init", "-q", "-b", "main");
  git(sandbox, "config", "user.email", "test@example.com");
  git(sandbox, "config", "user.name", "test");
  git(sandbox, "add", "-A");
  git(sandbox, "commit", "-qm", "base");

  // Two commits: one touching a declared path, one not.
  mkdirSync(join(sandbox, "os/x"), { recursive: true });
  writeFileSync(join(sandbox, "os/x/on.md"), "on goal\n");
  git(sandbox, "add", "-A");
  git(sandbox, "commit", "-qm", "on-goal change");
  const onSha = git(sandbox, "rev-parse", "HEAD").trim();

  mkdirSync(join(sandbox, "server"), { recursive: true });
  writeFileSync(join(sandbox, "server/off.ts"), "export const x = 1;\n");
  git(sandbox, "add", "-A");
  git(sandbox, "commit", "-qm", "off-goal change");
  const offSha = git(sandbox, "rev-parse", "HEAD").trim();

  // The ledger, on the ref the script reads.
  writeLedgerRef(
    sandbox,
    [
      JSON.stringify({ commitSha: onSha, prNumber: 1 }),
      JSON.stringify({ commitSha: offSha, prNumber: 2 }),
    ].join("\n") + "\n",
  );
  onGoalSha = onSha;
});

afterAll(() => {
  if (sandbox) rmSync(sandbox, { recursive: true, force: true });
});

describe("contradiction.mts, executed end to end", () => {
  it("resolves real commits and reports a real share", () => {
    const out = run(sandbox);
    expect(out).toMatch(/cycles\s+2/);
    // One of the two commits touches os/**; the other does not.
    expect(out).toMatch(/on-goal\s+1 \(50%\)/);
  });

  it("names the goal it measured", () => {
    expect(run(sandbox)).toMatch(/goal\s+GR-0001-test/);
  });

  it("measures EVERY goal record, not just the first on disk", () => {
    const second = join(sandbox, "os/goals/GR-0002-second.md");
    cpSync(join(sandbox, "os/goals/GR-0001-test.md"), second);
    writeFileSync(second, readFileSync(second, "utf8").replace("# GR-0001", "# GR-0002"));
    try {
      const out = run(sandbox);
      expect(out).toMatch(/GR-0001-test/);
      expect(out, "a second goal record was silently ignored").toMatch(/GR-0002-second/);
    } finally {
      rmSync(second, { force: true });
    }
  });

  it("reports UNRESOLVED rather than scoring an unreachable commit as off-goal", () => {
    // The shallow-clone case. Previously every failed `git diff` degraded to "no
    // files changed", which counted as OFF-goal and could invert the verdict.
    const good = git(sandbox, "show", "origin/os-ledger:cycles.jsonl");
    const bogus = "0".repeat(40);
    writeLedgerRef(
      sandbox,
      JSON.stringify({ commitSha: onGoalSha, prNumber: 1 }) +
        "\n" +
        JSON.stringify({ commitSha: bogus, prNumber: 99 }) +
        "\n",
    );
    try {
      const out = run(sandbox);
      expect(out, "an unreachable commit must be named, not silently absorbed").toMatch(/UNRESOLVED/);
      expect(out).toMatch(/#99/);
      // The one resolvable cycle IS on-goal, so the verdict must not be a
      // contradiction — which is exactly what the old degradation produced.
      expect(out).not.toMatch(/contradiction YES/);
    } finally {
      writeLedgerRef(sandbox, good.endsWith("\n") ? good : good + "\n");
    }
  });

  it("says no_ledger — not 'no cycles' — when the ledger ref is missing", () => {
    const bare = mkdtempSync(join(tmpdir(), "os-noledger-"));
    try {
      cpSync(join(sandbox, "scripts"), join(bare, "scripts"), { recursive: true });
      cpSync(join(sandbox, "shared"), join(bare, "shared"), { recursive: true });
      cpSync(join(sandbox, "os"), join(bare, "os"), { recursive: true });
      execFileSync("ln", ["-sfn", join(REPO, "node_modules"), join(bare, "node_modules")]);
      git(bare, "init", "-q", "-b", "main");
      git(bare, "config", "user.email", "t@e.com");
      git(bare, "config", "user.name", "t");
      git(bare, "add", "-A");
      git(bare, "commit", "-qm", "base");

      const out = run(bare);
      expect(out).toMatch(/no_ledger/);
      // The distinction that matters: "I could not read it" vs "there is nothing".
      expect(out).not.toMatch(/contradiction/);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});
