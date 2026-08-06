/**
 * scripts/os/observe-crons.test.ts — guards on LOOP-002's instrument.
 *
 * WHY. The LOOP-002 precision audit found that the observer shipped two ways to
 * manufacture a finding out of nothing:
 *
 *   1. It defaulted to measuring TODAY. The daily workflow fires at 10:40 UTC, so
 *      a perfectly honoured five-minute job could have produced at most 129 of the
 *      day's 288 runs — 45%, under the 0.5 floor. Every high-frequency workflow
 *      would have been reported unhonoured EVERY DAY regardless of reality.
 *   2. It had no guard for a workflow that did not exist for the whole window.
 *      `12-nightly-verification.yml` reached main at 2026-08-06T04:38Z and was
 *      reported as 0 of 1 for 2026-08-05 — a cadence finding about a file that did
 *      not exist at its own scheduled time. That figure was published in OBS-0002.
 *
 * These tests run the real script. They deliberately avoid the network: both
 * guards fire before any `gh` call, which is also the property that makes them
 * safe — a broken instrument must refuse to report, not report zero.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(__dirname, "..", "..");
let sandbox: string;

function runObserver(cwd: string, args: string[]): { out: string; err: string; code: number } {
  try {
    const out = execFileSync("npx", ["tsx", join(cwd, "scripts/os/observe-crons.mts"), ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { out, err: "", code: 0 };
  } catch (e) {
    const x = e as { stdout?: string; stderr?: string; status?: number };
    return { out: x.stdout ?? "", err: x.stderr ?? "", code: x.status ?? 1 };
  }
}

const git = (cwd: string, ...a: string[]) =>
  execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), "os-observe-"));
  mkdirSync(join(sandbox, "scripts/os"), { recursive: true });
  mkdirSync(join(sandbox, ".github/workflows"), { recursive: true });
  cpSync(join(REPO, "scripts/os/observe-crons.mts"), join(sandbox, "scripts/os/observe-crons.mts"));
  cpSync(join(REPO, "shared/os"), join(sandbox, "shared/os"), { recursive: true });
  execFileSync("ln", ["-sfn", join(REPO, "node_modules"), join(sandbox, "node_modules")]);

  writeFileSync(
    join(sandbox, ".github/workflows/probe.yml"),
    'name: probe\non:\n  schedule:\n    - cron: "*/5 * * * *"\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - run: "true"\n',
  );

  git(sandbox, "init", "-q", "-b", "main");
  git(sandbox, "config", "user.email", "t@e.com");
  git(sandbox, "config", "user.name", "t");
  git(sandbox, "add", "-A");
  git(sandbox, "commit", "-qm", "base");
});

afterAll(() => {
  if (sandbox) rmSync(sandbox, { recursive: true, force: true });
});

describe("a partial day cannot be scored", () => {
  it("refuses to measure today, loudly and with a reason", () => {
    const today = new Date().toISOString().slice(0, 10);
    const { out, err, code } = runObserver(sandbox, ["--date", today]);
    expect(code, "measuring an incomplete day must fail the run").not.toBe(0);
    expect(err).toMatch(/not a complete UTC day/i);
    // It must not emit a verdict it cannot support.
    expect(out).not.toMatch(/NOT honoured/);
    expect(out).not.toMatch(/honoured on/);
  });

  it("refuses a future date", () => {
    const { err, code } = runObserver(sandbox, ["--date", "2099-01-01"]);
    expect(code).not.toBe(0);
    expect(err).toMatch(/not a complete UTC day/i);
  });
});

describe("a workflow that did not exist cannot have missed its schedule", () => {
  it("excludes a workflow first added after the measured day, and names it", () => {
    // The exact shape of the false positive published in OBS-0002.
    // The run now EXITS NON-ZERO because excluding the only workflow leaves
    // nothing measured — see "zero measured is not zero broken". The exclusion
    // must still be reported on stdout, which is what this test pins.
    const { out } = runObserver(sandbox, ["--dry-run", "--date", "2020-01-02"]);
    expect(out, "a workflow newer than the window must be excluded").toMatch(/newer than the measured day/);
    expect(out).toMatch(/probe\.yml/);
    // Excluded, never scored: no drift verdict may be attributed to it.
    expect(out).not.toMatch(/probe\.yml.*\d+%/);
    // …and never reported as an all-clear.
    expect(out).not.toMatch(/all \d+ declared schedules honoured/);
  });

  it("names what it excluded rather than silently shrinking the denominator", () => {
    const { out } = runObserver(sandbox, ["--dry-run", "--date", "2020-01-02"]);
    expect(out).toMatch(/excluded:/);
  });
});

describe("the DEFAULT measured day — the path the daily workflow actually takes", () => {
  it("defaults to yesterday, not today", () => {
    // Mutation testing caught this gap: every other test passes an explicit
    // --date, so reverting the default to `today` left the suite green while
    // restoring the guaranteed-daily-false-positive the guard exists to prevent.
    // The daily workflow passes no --date, so this is the only covered path.
    const { out } = runObserver(sandbox, ["--dry-run"]);
    const now = new Date();
    const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))
      .toISOString()
      .slice(0, 10);
    const today = now.toISOString().slice(0, 10);

    expect(out, "the observer must measure the last COMPLETE day").toMatch(
      new RegExp(`observation — ${yesterday}`),
    );
    expect(out).not.toMatch(new RegExp(`observation — ${today}`));
  });
});

describe("a shallow clone must not read as a clean bill of health", () => {
  it("refuses to run when git history is unavailable", () => {
    // THE CRITICAL DEFECT. `actions/checkout` defaults to fetch-depth 1, and the
    // observer's own workflow did not override it. In a depth-1 clone
    // `git log --diff-filter=A` reports the single available commit as the add
    // date for EVERY file, so every workflow looked "added today", all were
    // excluded, and the observer printed:
    //
    //     all 0 declared schedules honoured on 2026-08-05
    //
    // Exit 0. Green. Forever. The guard added to prevent false POSITIVES created
    // a false NEGATIVE that defeats the loop entirely — strictly worse, because
    // a red check gets investigated and a green one does not.
    const shallow = mkdtempSync(join(tmpdir(), "os-shallow-"));
    try {
      mkdirSync(join(shallow, "scripts/os"), { recursive: true });
      mkdirSync(join(shallow, ".github/workflows"), { recursive: true });
      cpSync(join(REPO, "scripts/os/observe-crons.mts"), join(shallow, "scripts/os/observe-crons.mts"));
      cpSync(join(REPO, "shared/os"), join(shallow, "shared/os"), { recursive: true });
      execFileSync("ln", ["-sfn", join(REPO, "node_modules"), join(shallow, "node_modules")]);
      writeFileSync(
        join(shallow, ".github/workflows/probe.yml"),
        'name: probe\non:\n  schedule:\n    - cron: "*/5 * * * *"\n',
      );
      git(shallow, "init", "-q", "-b", "main");
      git(shallow, "config", "user.email", "t@e.com");
      git(shallow, "config", "user.name", "t");
      git(shallow, "add", "-A");
      git(shallow, "commit", "-qm", "base");
      // Mark it shallow, exactly as actions/checkout@v4 with default depth does.
      writeFileSync(join(shallow, ".git/shallow"), git(shallow, "rev-parse", "HEAD"));

      const { out, err, code } = runObserver(shallow, ["--dry-run", "--date", "2020-01-02"]);
      expect(code, "a shallow clone must fail the run, not pass it").not.toBe(0);
      expect(err).toMatch(/shallow/i);
      expect(out, "it must never claim everything is honoured").not.toMatch(/all \d+ declared schedules honoured/);
    } finally {
      rmSync(shallow, { recursive: true, force: true });
    }
  });
});

describe("it never reports an all-clear it cannot support", () => {
  it("refuses a malformed --date instead of silently measuring a different day", () => {
    // The flag was validated by regex and, on a miss, silently fell back to the
    // default — so the operator asked for one day and got a report about another,
    // with the requested date appearing nowhere in the output.
    for (const bad of ["2026-8-5", "05-08-2026", "yesterday", "2026-08-05T00:00:00Z", ""]) {
      const { err, code } = runObserver(sandbox, ["--dry-run", "--date", bad]);
      expect(code, `--date ${JSON.stringify(bad)} should fail`).not.toBe(0);
      expect(err).toMatch(/--date/);
    }
  });

  it("refuses a calendar-invalid date that matches the format", () => {
    const { err, code } = runObserver(sandbox, ["--dry-run", "--date", "2026-02-31"]);
    expect(code).not.toBe(0);
    expect(err).toMatch(/date/i);
  });

  it("refuses when every workflow was excluded — zero measured is not zero broken", () => {
    // With all workflows excluded (too new / unknown to GitHub), `verdicts` is
    // empty and the report read "all 0 declared schedules honoured" — a green
    // that means "I measured nothing", which is the shallow-clone failure again
    // by a different route.
    const { out, err, code } = runObserver(sandbox, ["--dry-run", "--date", "2020-01-02"]);
    expect(code, "measuring nothing must not exit 0").not.toBe(0);
    expect(err).toMatch(/nothing was measured|no workflow/i);
    expect(out).not.toMatch(/all \d+ declared schedules honoured/);
  });
});
