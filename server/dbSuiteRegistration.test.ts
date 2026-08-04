/**
 * dbSuiteRegistration.test.ts — every real-database suite must be wired into CI.
 *
 * THE PATTERN THIS EXISTS TO BREAK
 *
 * A `*.db.test.ts` has to be registered in TWO places, and neither one
 * complains when it is missing:
 *
 *   1. `.github/workflows/ci.yml` runs its DB suites from a HARDCODED list of
 *      file paths, because they share one database and must run with
 *      `--no-file-parallelism`. A suite nobody adds to that list does not fail
 *      — it simply never runs. The file sits in the tree looking like coverage,
 *      CI stays green, and the invariants it was written to protect are
 *      unguarded.
 *   2. `vitest.environment-failure-allowlist.json` must declare it, because a
 *      DB suite SKIPS in the secretless Vitest job and
 *      `scripts/check-environment-failures.mjs --profile=ci` fails on any skip
 *      that is not in `expectedCiSkips`. Miss this one and CI goes red for a
 *      reason that reads like an unrelated gate failure.
 *
 * Point 2 is not hypothetical: `betTrackerParlay.db.test.ts` shipped into the
 * ci.yml list with no allowlist entry at all, which is exactly the half-wired
 * state this file now catches.
 *
 * That failure shape has now cost this repo four times in one programme:
 *
 *   - three copies of the stats reducer drifted, and the one the UI actually
 *     called was missing half its fields
 *   - the delete cascade covered the `delete` mutation and not
 *     `reviewEditRequest`, which reaches the same outcome
 *   - the parlay leg sweep was wired into `runBetGradeCycle` only, so the
 *     GitHub cron path swept legs while three in-process pollers did not
 *   - and the fix for THAT was itself wired at two more call sites before
 *     being moved down into the one function they all share
 *
 * Every one was logic attached to a call site while sibling call sites were
 * missed. The durable fix is never "remember next time" — it is a check that
 * fails when someone forgets. This is that check for the DB suites.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SERVER_DIR = __dirname;
const CI_WORKFLOW = join(SERVER_DIR, "..", ".github", "workflows", "ci.yml");
const ALLOWLIST = join(SERVER_DIR, "..", "vitest.environment-failure-allowlist.json");

/** Every real-database suite present in the tree. */
function discoveredSuites(): string[] {
  return readdirSync(SERVER_DIR)
    .filter(f => f.endsWith(".db.test.ts"))
    .sort();
}

/**
 * Just the `vitest run` invocation inside the DB Tests step.
 *
 * Scoping is load-bearing, not tidiness. ci.yml says "real-database suites" in
 * three places — the pipeline header, the job comment and the step name — and a
 * filename search over the whole file would count a suite named in a COMMENT as
 * registered. That is the same guard-shaped-hole this file exists to close, so
 * it must not be reintroduced by the guard itself.
 */
function dbStepBlock(ci: string): string {
  const start = ci.indexOf("--no-file-parallelism");
  const end = ci.indexOf("--reporter=verbose", start);
  if (start < 0 || end < 0) {
    throw new Error("ci.yml no longer has a --no-file-parallelism DB step; this guard is blind");
  }
  return ci.slice(start, end);
}

/** The suite files ci.yml actually names in its DB Tests step. */
function registeredSuites(ci: string): string[] {
  return Array.from(dbStepBlock(ci).matchAll(/server\/([A-Za-z0-9_.-]+\.db\.test\.ts)/g))
    .map(m => m[1])
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort();
}

const ci = readFileSync(CI_WORKFLOW, "utf8");
const allowlist = JSON.parse(readFileSync(ALLOWLIST, "utf8")) as {
  entries: { id: string }[];
  expectedCiSkips: { file: string; reason: string }[];
};

describe("real-database suites are registered in CI", () => {
  it("finds the DB Tests step", () => {
    expect(ci).toMatch(/real-database suites/);
    expect(ci).toMatch(/--no-file-parallelism/);
  });

  it("REGRESSION: every *.db.test.ts in server/ is named in ci.yml", () => {
    const found = discoveredSuites();
    const registered = registeredSuites(ci);
    const missing = found.filter(f => !registered.includes(f));
    expect(
      missing,
      `these suites exist but CI never runs them: ${missing.join(", ")}. ` +
      `Add them to the DB Tests step in .github/workflows/ci.yml.`,
    ).toEqual([]);
  });

  it("no zombie registrations: every file ci.yml names still exists", () => {
    const found = discoveredSuites();
    const registered = registeredSuites(ci);
    const ghosts = registered.filter(f => !found.includes(f));
    expect(
      ghosts,
      `ci.yml runs files that no longer exist: ${ghosts.join(", ")}`,
    ).toEqual([]);
  });

  it("REGRESSION: a suite named only in prose does not count as registered", () => {
    // The obvious implementation — search the whole file for `server/*.db.test.ts`
    // — would call a suite registered because ci.yml mentions it in a comment,
    // while the step that actually runs files never names it.
    const doctored = ci.replace("# ─── Stage 3b:", "# ─── Stage 3b: server/neverRuns.db.test.ts");
    expect(registeredSuites(doctored)).not.toContain("neverRuns.db.test.ts");
  });

  it("there is at least one bet-tracker suite, so this guard has teeth", () => {
    // A guard that passes vacuously because nothing matches is not a guard.
    expect(discoveredSuites().some(f => f.startsWith("betTracker"))).toBe(true);
  });

  it("the step name matches how many suites it runs", () => {
    // A stale count is the first sign someone added a file without reading the
    // step around it.
    const WORDS: Record<number, string> = {
      6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten",
      11: "eleven", 12: "twelve", 13: "thirteen", 14: "fourteen", 15: "fifteen",
    };
    const step = ci.match(/Run the (\w+) real-database suites/);
    expect(step, "the DB Tests step should say how many suites it runs").not.toBeNull();

    // Count every suite the step names, .db.test.ts or not — four of the ten
    // are plain *.test.ts files that happen to need the database.
    const named = Array.from(
      dbStepBlock(ci).matchAll(/server\/[A-Za-z0-9_.-]+\.test\.ts/g),
    ).length;
    expect(WORDS[named], `no word for ${named}; extend the WORDS map`).toBeDefined();
    expect(step![1]).toBe(WORDS[named]);
  });
});

describe("suites cannot collide on one shared database", () => {
  const suites = discoveredSuites().filter(f => f.startsWith("betTracker"));

  it("each bet-tracker suite cleans up after itself", () => {
    for (const f of suites) {
      const src = readFileSync(join(SERVER_DIR, f), "utf8");
      expect(src, `${f} has no afterAll cleanup`).toMatch(/afterAll/);
    }
  });

  it("REGRESSION: no suite issues an unscoped delete", () => {
    // CI runs these sequentially against ONE database alongside six other
    // suites. An unscoped delete would destroy another suite's fixtures and
    // produce a failure in a file that did nothing wrong.
    for (const f of suites) {
      const src = readFileSync(join(SERVER_DIR, f), "utf8");
      const unscoped = Array.from(src.matchAll(/\.delete\(/g)).filter(
        m => !src.slice(m.index!, m.index! + 240).includes(".where"),
      );
      expect(unscoped.length, `${f} deletes without a where clause`).toBe(0);
    }
  });

  it("REGRESSION: bet-tracker suites own disjoint userId ranges", () => {
    // Overlapping ids would let one suite's cleanup delete another's rows
    // mid-run — a failure that reproduces only in CI, only sometimes.
    const ranges = new Map<string, Set<number>>();
    for (const f of suites) {
      const src = readFileSync(join(SERVER_DIR, f), "utf8");
      const ids = new Set(
        Array.from(src.matchAll(/\b(88\d{4})\b/g))
          .map(m => Number(m[1]))
          // anGameId values share the prefix but are not user ids; only count
          // literals that appear as a user id.
          .filter(n => {
            const re = new RegExp(`(userId|USER[A-Z_]*)\\s*[:=]\\s*${n}\\b`);
            return re.test(src);
          }),
      );
      ranges.set(f, ids);
    }
    const files = Array.from(ranges.keys());
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const a = ranges.get(files[i])!;
        const b = ranges.get(files[j])!;
        const shared = [...a].filter(x => b.has(x));
        expect(shared, `${files[i]} and ${files[j]} both use userId ${shared.join(", ")}`).toEqual([]);
      }
    }
  });
});
