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


/**
 * A minimal, VALID goal record with the given activity paths.
 *
 * The fixture previously copied the live os/goals/GR-0001. That coupled the
 * script's test to a governance document: editing GR-0001's activity paths — the
 * documented way to steer the goal — turned this suite red with a message about
 * the script. A test of the script must depend on the script, not on today's
 * priorities.
 */
function goalDoc(id: string, paths: string[]): string {
  return [
    `# ${id} — fixture`,
    "",
    "**Status:** ACTIVE · **DRI:** Prez · **Kind:** goal · **observe_by:** 2027-01-01",
    "",
    ...["Desired outcome", "The need behind it", "Evidence that justified pursuing it"].map(
      (h) => `## ${h}\nx\n`,
    ),
    "## Acceptance criteria",
    "- [ ] x",
    "",
    "## Constraints",
    "x",
    "",
    "## Time horizon",
    "2027-01-01",
    "",
    "## Responsible individual",
    "Prez",
    "",
    "## Current status",
    "x",
    "",
    "## Evaluation measures",
    "| Measure | Threshold | Current |",
    "|---|---|---|",
    "| a | 1 of 1 | 0 |",
    "",
    "## Activity paths",
    ...paths.map((p) => `- \`${p}\``),
    "",
  ].join("\n");
}

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
  // Copy the whole shared/os tree, not a named list. Listing files meant the
  // sandbox broke the moment the script gained a new dependency — which it did,
  // when the fence reader was extracted into shared/os/markdown.ts.
  cpSync(join(REPO, "shared/os"), join(sandbox, "shared/os"), { recursive: true });
  writeFileSync(join(sandbox, "os/goals/GR-0001-test.md"), goalDoc("GR-0001", ["os/**"]));
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
    // The second record declares DIFFERENT paths, and they are paths the fixture
    // history actually touches. Asserting only that its filename is printed would
    // pass even if the loop reused the first record's globs for both.
    const second = join(sandbox, "os/goals/GR-0002-second.md");
    writeFileSync(second, goalDoc("GR-0002", ["server/**"]));
    try {
      const out = run(sandbox);
      expect(out).toMatch(/GR-0001-test/);
      expect(out, "a second goal record was silently ignored").toMatch(/GR-0002-second/);
      // Each goal must be measured against ITS OWN declaration.
      expect(out, "GR-0002's own globs were not used").toMatch(/declared\s+server\/\*\*/);
      expect(out).toMatch(/declared\s+os\/\*\*/);
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

  it("does not claim 'no recorded cycles' when cycles exist but none resolved", () => {
    // Found auditing #400 itself. When EVERY cycle is unresolvable, `measurable`
    // is empty, so findPriorityContradiction correctly answers "you gave me zero
    // cycles" — but the script printed that verbatim as "no recorded cycles yet".
    // Ten cycles WERE recorded; they were all unreadable. The UNRESOLVED line
    // carried the truth while the state line asserted something false, and this
    // happens precisely in the degraded case the reporting exists to expose.
    const good = git(sandbox, "show", "origin/os-ledger:cycles.jsonl");
    writeLedgerRef(
      sandbox,
      [
        JSON.stringify({ commitSha: "0".repeat(40), prNumber: 91 }),
        JSON.stringify({ commitSha: "1".repeat(40), prNumber: 92 }),
      ].join("\n") + "\n",
    );
    try {
      const out = run(sandbox);
      expect(out).toMatch(/UNRESOLVED\s+2 of 2/);
      expect(out, "the ledger was not empty — saying so is false").not.toMatch(/no recorded cycles/);
      expect(out).toMatch(/none of the 2 recorded cycles could be resolved/i);
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

describe("the verdict the mechanism exists to produce", () => {
  // The #400 audit: "no test ever produces a `contradiction YES` verdict; the
  // mechanism's only actionable output can be hard-coded off with the suite
  // green." GR-0001's own Readings record a real flagged contradiction, so this
  // is an exercised path, not a hypothetical one.
  it("prints contradiction YES when most cycles are off-goal", () => {
    const goal = join(sandbox, "os/goals/GR-0001-test.md");
    const original = readFileSync(goal, "utf8");
    writeFileSync(goal, goalDoc("GR-0001", ["nowhere/**"]));
    try {
      const out = run(sandbox);
      expect(out).toMatch(/contradiction YES/);
      expect(out).toMatch(/on-goal\s+0 \(0%\)/);
    } finally {
      writeFileSync(goal, original);
    }
  });

  it("prints contradiction no when the declared priority is where the work went", () => {
    const goal = join(sandbox, "os/goals/GR-0001-test.md");
    const original = readFileSync(goal, "utf8");
    // Both fixture commits touch paths under these globs.
    writeFileSync(goal, goalDoc("GR-0001", ["os/**", "server/**"]));
    try {
      const out = run(sandbox);
      expect(out).toMatch(/on-goal\s+2 \(100%\)/);
      expect(out).toMatch(/contradiction no/);
      expect(out).not.toMatch(/contradiction YES/);
    } finally {
      writeFileSync(goal, original);
    }
  });
});

describe("it fails loudly, and the failure is not a clean result", () => {
  const runRaw = (cwd: string): { out: string; err: string; code: number } => {
    try {
      const out = execFileSync("npx", ["tsx", join(cwd, "scripts/os/contradiction.mts")], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { out, err: "", code: 0 };
    } catch (e) {
      const x = e as { stdout?: string; stderr?: string; status?: number };
      return { out: x.stdout ?? "", err: x.stderr ?? "", code: x.status ?? 1 };
    }
  };

  it("exits non-zero on a corrupt ledger line instead of reporting a share", () => {
    // A corrupt ledger must never read as a clean result. Both die() paths were
    // untested, so this could have been relaxed into a silent skip.
    const good = git(sandbox, "show", "origin/os-ledger:cycles.jsonl");
    writeLedgerRef(sandbox, good.trim() + "\nthis is not json\n");
    try {
      const { out, err, code } = runRaw(sandbox);
      expect(code, "a corrupt ledger must fail the run").not.toBe(0);
      expect(out).not.toMatch(/contradiction/);
      expect(out).not.toMatch(/on-goal/);
      // Assert the DIAGNOSIS, not merely a non-zero exit. Mutation testing caught
      // this: replacing die() with a silent skip still exited non-zero — via an
      // uncaught TypeError downstream — so an exit-code-only assertion passed
      // while the deliberate failure path had been removed. A test that cannot
      // tell a diagnosis from a crash is not testing the diagnosis.
      expect(err, "the run must say WHY it failed").toMatch(/not valid JSON|corrupt/i);
      expect(err).not.toMatch(/TypeError|Cannot read propert/);
    } finally {
      writeLedgerRef(sandbox, good.endsWith("\n") ? good : good + "\n");
    }
  });

  it("exits non-zero when there is no goal record at all", () => {
    const goal = join(sandbox, "os/goals/GR-0001-test.md");
    const original = readFileSync(goal, "utf8");
    rmSync(goal, { force: true });
    try {
      const { out, code } = runRaw(sandbox);
      expect(code).not.toBe(0);
      expect(out).not.toMatch(/contradiction/);
    } finally {
      writeFileSync(goal, original);
    }
  });

  it("exits non-zero on a goal record that violates its own contract", () => {
    const goal = join(sandbox, "os/goals/GR-0001-test.md");
    const original = readFileSync(goal, "utf8");
    writeFileSync(goal, original.replace("## Constraints", "## Notes"));
    try {
      const { code, out } = runRaw(sandbox);
      expect(code).not.toBe(0);
      expect(out).not.toMatch(/contradiction/);
    } finally {
      writeFileSync(goal, original);
    }
  });
});

describe("merge commits — the shape every real ledger entry has", () => {
  // The fixture held only ordinary commits, so the first-parent semantics the
  // script is built around was never exercised. `git show` on a merge emits no
  // diff by default; a refactor that looked right for linear history would make
  // every real cycle resolve to zero files.
  it("resolves a merge commit's contribution via its first parent", () => {
    const base = git(sandbox, "rev-parse", "HEAD").trim();
    git(sandbox, "checkout", "-q", "-b", "feature");
    mkdirSync(join(sandbox, "os/merged"), { recursive: true });
    writeFileSync(join(sandbox, "os/merged/from-merge.md"), "merged content\n");
    git(sandbox, "add", "-A");
    git(sandbox, "commit", "-qm", "feature work");
    git(sandbox, "checkout", "-q", "main");
    git(sandbox, "merge", "-q", "--no-ff", "-m", "Merge pull request #7 from feature", "feature");
    const mergeSha = git(sandbox, "rev-parse", "HEAD").trim();

    const good = git(sandbox, "show", "origin/os-ledger:cycles.jsonl");
    writeLedgerRef(sandbox, JSON.stringify({ commitSha: mergeSha, prNumber: 7 }) + "\n");
    try {
      const out = run(sandbox);
      // The merge brought os/merged/from-merge.md, which is under os/**.
      expect(out).toMatch(/cycles\s+1/);
      expect(out, "a merge commit resolved to no files").toMatch(/on-goal\s+1 \(100%\)/);
      expect(out).not.toMatch(/UNRESOLVED/);
    } finally {
      writeLedgerRef(sandbox, good.endsWith("\n") ? good : good + "\n");
      git(sandbox, "reset", "-q", "--hard", base);
      git(sandbox, "branch", "-qD", "feature");
    }
  });
});

describe("unresolved cycles must not re-enter the denominator", () => {
  // The exact defect finding #5 of the #400 audit exists to close: a regression
  // that collapses excluded cycles back into the denominator scores them off-goal
  // and can invert the verdict. CI checks out shallow by default, so this is the
  // realistic production shape, not an exotic one.
  it("one unresolvable cycle does not drag a fully on-goal result into a contradiction", () => {
    const onlyOnGoal = git(sandbox, "show", "origin/os-ledger:cycles.jsonl")
      .trim()
      .split("\n")[0];
    const good = git(sandbox, "show", "origin/os-ledger:cycles.jsonl");
    writeLedgerRef(
      sandbox,
      [onlyOnGoal, JSON.stringify({ commitSha: "0".repeat(40), prNumber: 98 })].join("\n") + "\n",
    );
    try {
      const out = run(sandbox);
      expect(out).toMatch(/UNRESOLVED\s+1 of 2/);
      // 1 resolvable cycle, and it is on-goal. Counting the unresolvable one as
      // off-goal would give 1/2 = 50% and, one more unresolvable, a false YES.
      expect(out).toMatch(/cycles\s+1/);
      expect(out).toMatch(/on-goal\s+1 \(100%\)/);
      expect(out).not.toMatch(/contradiction YES/);
    } finally {
      writeLedgerRef(sandbox, good.endsWith("\n") ? good : good + "\n");
    }
  });
});
