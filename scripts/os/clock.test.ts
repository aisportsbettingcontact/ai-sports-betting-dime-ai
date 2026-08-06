/**
 * scripts/os/clock.test.ts — the per-prompt clock, under test at last.
 *
 * WHY. PR #400 added "ACTIVE" to OWES_OBSERVATION so that ACTIVE artifacts —
 * including the mission's own goal record — would finally be watched. The #400
 * audit then showed that deleting "ACTIVE" again left the entire os suite green:
 * the fix shipped with no executable guard, so the regression it corrected could
 * return silently. #400 locked in its finding 6 with a test and left finding 1
 * bare. This closes that.
 *
 * It also pins the date boundary. The clock compared a UTC-parsed observe_by
 * against a local `new Date()`, so an item became overdue at 17:00 PDT on its own
 * deadline day — seven hours before that day ended. Comparison is now whole local
 * calendar days, and OS_CLOCK_NOW makes the boundary testable.
 *
 * The clock runs on EVERY prompt via .claude/scripts/prompt-capsule.sh, so its
 * two hard requirements are: never throw, never exit non-zero.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(__dirname, "..", "..");
const CLOCK = join(REPO, "scripts/os/clock.mjs");

let sandbox: string;

/** Run the clock in `cwd` with a pinned today. Returns stdout (never throws). */
function runClock(cwd: string, now?: string): { out: string; code: number } {
  try {
    const out = execFileSync("node", [join(cwd, "scripts/os/clock.mjs")], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, ...(now ? { OS_CLOCK_NOW: now } : {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { out, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; status?: number };
    return { out: err.stdout ?? "", code: err.status ?? 1 };
  }
}

function artifact(dir: string, name: string, status: string, observeBy: string | null): void {
  writeFileSync(
    join(dir, `${name}.md`),
    `# ${name} — probe\n\n**Status:** ${status} · **DRI:** Prez` +
      (observeBy ? ` · **observe_by:** ${observeBy}` : "") +
      "\n\nbody\n",
  );
}

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), "os-clock-"));
  mkdirSync(join(sandbox, "scripts/os"), { recursive: true });
  mkdirSync(join(sandbox, "os/probe"), { recursive: true });
  cpSync(CLOCK, join(sandbox, "scripts/os/clock.mjs"));
  // A git tree, so the clock can name the ref it read. Without one it still
  // works — the ref lookup is best-effort — but the branch tests need it.
  const g = (...a: string[]) =>
    execFileSync("git", a, { cwd: sandbox, stdio: ["ignore", "pipe", "ignore"] });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@e.com");
  g("config", "user.name", "t");
  g("add", "-A");
  g("commit", "-qm", "base");
});

afterAll(() => {
  if (sandbox) rmSync(sandbox, { recursive: true, force: true });
});

describe("which statuses owe an observation", () => {
  it("watches ACTIVE — the regression #400 fixed, now guarded", () => {
    const d = join(sandbox, "os/probe");
    artifact(d, "ZZ-0001", "ACTIVE", "2026-01-01");
    try {
      const { out, code } = runClock(sandbox, "2026-06-01");
      expect(out, "an ACTIVE artifact past observe_by must be reported").toMatch(/ZZ-0001/);
      expect(code).toBe(0);
    } finally {
      rmSync(join(d, "ZZ-0001.md"), { force: true });
    }
  });

  it.each(["AWAITING RULING", "BLOCKED — needs input", "OPEN", "IN PROGRESS", "ACTIVE"])(
    "watches %s",
    (status) => {
      const d = join(sandbox, "os/probe");
      artifact(d, "ZZ-0002", status, "2026-01-01");
      try {
        expect(runClock(sandbox, "2026-06-01").out).toMatch(/ZZ-0002/);
      } finally {
        rmSync(join(d, "ZZ-0002.md"), { force: true });
      }
    },
  );

  it.each(["CLOSED", "RULED", "SUPERSEDED", "DONE"])("does NOT watch %s", (status) => {
    const d = join(sandbox, "os/probe");
    artifact(d, "ZZ-0003", status, "2026-01-01");
    try {
      expect(runClock(sandbox, "2026-06-01").out).not.toMatch(/ZZ-0003/);
    } finally {
      rmSync(join(d, "ZZ-0003.md"), { force: true });
    }
  });
});

describe("the overdue boundary is a whole local calendar day", () => {
  const d = () => join(sandbox, "os/probe");

  it("is silent ON the deadline day, and reports the day after", () => {
    artifact(d(), "ZZ-0004", "ACTIVE", "2026-08-31");
    try {
      expect(runClock(sandbox, "2026-08-30").out, "before the deadline").not.toMatch(/ZZ-0004/);
      // The defect: this reported "(1d)" from 17:00 PDT on 2026-08-31 itself.
      expect(runClock(sandbox, "2026-08-31").out, "ON the deadline day").not.toMatch(/ZZ-0004/);
      expect(runClock(sandbox, "2026-09-01").out, "the day after").toMatch(/ZZ-0004 \(1d\)/);
      expect(runClock(sandbox, "2026-09-05").out).toMatch(/ZZ-0004 \(5d\)/);
    } finally {
      rmSync(join(d(), "ZZ-0004.md"), { force: true });
    }
  });

  it("reports an item with no observe_by at all", () => {
    artifact(d(), "ZZ-0005", "OPEN", null);
    try {
      expect(runClock(sandbox, "2026-06-01").out).toMatch(/ZZ-0005 \(no observe_by\)/);
    } finally {
      rmSync(join(d(), "ZZ-0005.md"), { force: true });
    }
  });
});

describe("a clock must never wedge a prompt", () => {
  it("exits 0 and stays silent with nothing overdue", () => {
    const { out, code } = runClock(sandbox, "2026-06-01");
    expect(out).toBe("");
    expect(code).toBe(0);
  });

  it("exits 0 when os/ does not exist at all", () => {
    const bare = mkdtempSync(join(tmpdir(), "os-clock-bare-"));
    try {
      mkdirSync(join(bare, "scripts/os"), { recursive: true });
      cpSync(CLOCK, join(bare, "scripts/os/clock.mjs"));
      const { out, code } = runClock(bare, "2026-06-01");
      expect(code).toBe(0);
      expect(out).toBe("");
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it("exits 0 when an artifact is malformed", () => {
    const d = join(sandbox, "os/probe");
    writeFileSync(join(d, "ZZ-0006.md"), "**Status:** ACTIVE · **observe_by:** not-a-date\n");
    try {
      const { code } = runClock(sandbox, "2026-06-01");
      expect(code).toBe(0);
    } finally {
      rmSync(join(d, "ZZ-0006.md"), { force: true });
    }
  });

  it("skips appendix/ — immutable evidence is not a live obligation", () => {
    const ap = join(sandbox, "os/probe/appendix");
    mkdirSync(ap, { recursive: true });
    artifact(ap, "ZZ-0007", "OPEN", "2026-01-01");
    try {
      expect(runClock(sandbox, "2026-06-01").out).not.toMatch(/ZZ-0007/);
    } finally {
      rmSync(ap, { recursive: true, force: true });
    }
  });
});

describe("the clock says which tree it read", () => {
  // Added after a real confusion: the per-prompt hook reported ISSUE-012 overdue
  // from a feature branch six commits behind main, AFTER the fix had landed. The
  // report was true of the files on disk and said nothing about which disk.
  it("names a non-main branch in the report", () => {
    const d = join(sandbox, "os/probe");
    artifact(d, "ZZ-0100", "ACTIVE", "2026-01-01");
    try {
      execFileSync("git", ["checkout", "-q", "-b", "some/feature"], { cwd: sandbox });
      const { out } = runClock(sandbox, "2026-06-01");
      expect(out).toMatch(/\[some\/feature\]/);
      expect(out).toMatch(/ZZ-0100/);
    } finally {
      execFileSync("git", ["checkout", "-q", "main"], { cwd: sandbox });
      rmSync(join(d, "ZZ-0100.md"), { force: true });
    }
  });

  it("stays quiet about the ref when it IS main — no noise on the common path", () => {
    const d = join(sandbox, "os/probe");
    artifact(d, "ZZ-0101", "ACTIVE", "2026-01-01");
    try {
      const { out } = runClock(sandbox, "2026-06-01");
      expect(out).toMatch(/ZZ-0101/);
      expect(out).not.toMatch(/\[main\]/);
    } finally {
      rmSync(join(d, "ZZ-0101.md"), { force: true });
    }
  });
});
