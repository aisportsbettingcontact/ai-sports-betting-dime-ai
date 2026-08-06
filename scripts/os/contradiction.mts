#!/usr/bin/env -S npx tsx
/**
 * scripts/os/contradiction.mts — D13's founder-loop requirement, computed.
 *
 * Compares a goal's DECLARED priority paths against where engineering activity
 * ACTUALLY went, using the engineering loop's own cycle artifacts. Surfaces
 * "a claimed priority that engineering activity ignores" without anyone
 * remembering to look.
 *
 * WHY THIS IS .mts AND NOT .mjs. The first version was plain JavaScript and
 * reimplemented the glob matcher inline. That produced a second reality (D4):
 * the running script and the tested library disagreed. The script used a SPACE
 * as its `**` sentinel where the library uses NUL, so on a glob containing a
 * space the two returned different answers —
 *   library: `docs/a b/**` vs `docs/aXXXb/x.md` -> false   (correct)
 *   script:  same inputs                        -> true    (over-matches)
 * The number this script printed was therefore produced by code that no test
 * covered. It now imports the library and owns no matching logic of its own.
 *
 * WHY IT FAILS LOUDLY. The first version wrapped both git calls in bare
 * `catch {}`. A missing ref, a malformed ledger line, or the wrong working
 * directory all came out as "no recorded cycles" — a governance check that
 * reports "nothing to see" when it is broken is worse than no check at all.
 * Each failure mode is now distinguished and none of them is silent.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseGoal, findPriorityContradiction } from "../../shared/os/goal.js";
import { assertRevish } from "../../shared/os/cycle.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const LEDGER_REF = "origin/os-ledger:cycles.jsonl";

const git = (...a: string[]): string =>
  execFileSync("git", a, { encoding: "utf8", cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }).trim();

function die(msg: string): never {
  console.error(`  ERROR ${msg}`);
  process.exit(1);
}

// ---- the goals -----------------------------------------------------------
// EVERY goal record, not just the first one on disk. `.find()` measured GR-0001
// and silently ignored every later record — a second goal would have been added
// believing it was watched, and it would not have been.
const goalsDir = join(ROOT, "os/goals");
const goalFiles = readdirSync(goalsDir)
  .filter((f) => /^GR-\d+.*\.md$/.test(f))
  .sort();
if (goalFiles.length === 0) die(`no goal record found in ${goalsDir}`);

// ---- the ledger ----------------------------------------------------------
let raw: string;
try {
  raw = git("show", LEDGER_REF);
} catch {
  // Distinguished from "the ledger is empty": there is nothing to measure YET,
  // which is a legitimate state, but it is not the same as a clean result.
  console.log(`  state=no_ledger — ${LEDGER_REF} is unreadable (branch not fetched, or no merges yet)`);
  console.log(`  fix: git fetch origin os-ledger`);
  process.exit(0);
}

interface Cycle {
  commitSha: string;
  prNumber: number;
}

const cycles: Cycle[] = raw
  .split("\n")
  .filter(Boolean)
  .map((l, i) => {
    try {
      return JSON.parse(l) as Cycle;
    } catch {
      // A corrupt ledger must never read as "no contradiction".
      return die(`${LEDGER_REF} line ${i + 1} is not valid JSON — the ledger is corrupt`);
    }
  });

// ---- where the work actually went ---------------------------------------
const unresolved: string[] = [];
const filesPerCycle: string[][] = cycles.map((c) => {
  const sha = assertRevish(c.commitSha);
  try {
    // First parent: for a merge commit, "what this merge brought to main".
    return git("diff", "--name-only", `${sha}^1`, sha).split("\n").filter(Boolean);
  } catch {
    // Counting an unresolvable commit as "changed nothing" silently scores it
    // OFF-goal and biases the metric. Record it and exclude it instead.
    unresolved.push(`#${c.prNumber} ${sha.slice(0, 9)}`);
    return null as unknown as string[];
  }
});

const measurable = filesPerCycle.filter((f) => f !== null);

// ---- report --------------------------------------------------------------
if (unresolved.length > 0) {
  // Never a silent cap: say what was dropped and why the denominator is smaller.
  // Before this, an unresolvable commit degraded to "changed no files" and was
  // counted OFF-goal — in a shallow clone every cycle failed that way and the
  // script confidently reported a contradiction that did not exist.
  console.log(
    `  UNRESOLVED    ${unresolved.length} of ${cycles.length} cycle(s) excluded, commit not in this clone: ${unresolved.join(", ")}`,
  );
  console.log(`                (a shallow checkout does this — fetch with depth 0)`);
}

// The library is asked to explain zero cycles, and truthfully answers "you gave me
// none". Only the script knows WHY there were none — and "no recorded cycles yet"
// is false when ten were recorded and all were unreadable. The state line must not
// contradict the UNRESOLVED line printed directly above it.
const allExcluded = cycles.length > 0 && measurable.length === 0;

for (const goalFile of goalFiles) {
  const goal = parseGoal(readFileSync(join(goalsDir, goalFile), "utf8"));
  const r = findPriorityContradiction(goal.activityPaths, measurable);

  console.log(`  goal          ${goalFile.replace(/\.md$/, "")}`);
  console.log(`  declared      ${goal.activityPaths.join(", ")}`);
  if (allExcluded) {
    console.log(
      `  state         not_measured — none of the ${cycles.length} recorded cycles could be resolved in this clone`,
    );
  } else if (r.state === "not_measured") {
    console.log(`  state         not_measured — ${r.reason}`);
  } else {
    console.log(`  cycles        ${r.totalCycles}`);
    console.log(`  on-goal       ${r.onGoalCycles} (${((r.onGoalShare ?? 0) * 100).toFixed(0)}%)`);
    console.log(
      `  contradiction ${r.contradiction ? `YES — ${r.reason}` : "no — declared priority matches where the work went"}`,
    );
  }
}
