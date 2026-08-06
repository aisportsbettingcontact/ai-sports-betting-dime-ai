#!/usr/bin/env -S npx tsx
/**
 * scripts/os/observe-crons.mts — LOOP-002's observer.
 *
 * Compares the cron cadence each workflow DECLARES against the runs GitHub
 * actually recorded, and reports the gap. Read-only: it changes no schedule,
 * retries nothing, and touches no production system.
 *
 * WHY IT IS .mts AND NOT THE .mjs ISSUE-013 SPECIFIED. A plain-JS script cannot
 * import shared/os/cadence.ts, and the alternative — reimplementing the cron
 * arithmetic inline — is exactly the defect that made PR #398's headline number
 * untrustworthy: a runner that duplicates its library produces a second reality
 * and prints a figure no test covers. The deviation from the issue is a
 * correction to the issue.
 *
 * WHY IT FAILS LOUDLY. An observer that swallows its own errors reports "nothing
 * to see" when it is broken, which is strictly worse than no observer. Every
 * failure mode below is distinguished and none is silent.
 *
 * Usage:
 *   npx tsx scripts/os/observe-crons.mts [--dry-run] [--date YYYY-MM-DD]
 *   --dry-run   report only; always exit 0 (for local inspection)
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractSchedules } from "../../shared/os/workflowSchedules.js";
import {
  expectedRunsOnDate,
  cadenceVerdict,
  defaultMeasureDate,
  isCompleteDay,
  runGaps,
  type CadenceVerdict,
} from "../../shared/os/cadence.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WORKFLOWS = join(ROOT, ".github/workflows");
const REPO = "aisportsbettingcontact/ai-sports-betting-dime-ai";
/** gh run list page size. Binding on high-frequency workflows — see the coverage guard. */
const RUN_LIMIT = 300;

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const dateArg = argv[argv.indexOf("--date") + 1];
const NOW = new Date().toISOString();
// The most recent COMPLETE day, never today. Measuring a partial day against a
// full day's expectation made every high-frequency workflow look ~45% short even
// if perfectly honoured — a guaranteed daily false positive.
let DATE: string;
if (argv.includes("--date")) {
  // Silently falling back to the default meant the operator asked for one day
  // and got a report about another, with the requested date nowhere in sight.
  if (!dateArg || !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
    console.error(`  ERROR --date must be YYYY-MM-DD, got ${JSON.stringify(dateArg ?? "")}`);
    process.exit(1);
  }
  DATE = dateArg;
} else {
  // The most recent COMPLETE day, never today. Measuring a partial day against a
  // full day's expectation made every high-frequency workflow look ~45% short
  // even if perfectly honoured — a guaranteed daily false positive.
  DATE = defaultMeasureDate(NOW);
}

function die(msg: string): never {
  console.error(`  ERROR ${msg}`);
  process.exit(1);
}

/**
 * Every cron declared under `on.schedule`, per workflow file.
 *
 * Delegates to `shared/os/workflowSchedules.ts`. The previous inline regex scan
 * silently DROPPED three valid YAML shapes and INVENTED two schedules that did
 * not exist; a dropped workflow is one LOOP-002 reports as fine forever. The
 * reader now refuses shapes it cannot parse, by name, and a refusal fails the
 * run rather than looking like compliance.
 */
function declaredSchedules(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const refusals: string[] = [];
  for (const file of readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f))) {
    const { crons, refused } = extractSchedules(readFileSync(join(WORKFLOWS, file), "utf8"), file);
    if (refused) {
      refusals.push(refused);
      continue;
    }
    if (crons.length > 0) out.set(file, crons);
  }
  if (refusals.length > 0) {
    die(
      `${refusals.length} workflow(s) could not be parsed, so their schedules cannot be observed:\n` +
        refusals.map((r) => `    ${r}`).join("\n")
    );
  }
  return out;
}

/** Completed scheduled runs GitHub recorded for `workflow` on the measured day. */
function actualRuns(
  workflow: string
): { total: number; conclusions: Record<string, number>; createdAt: string[] } | null {
  let raw: string;
  let stderr = "";
  try {
    const r = execFileSync(
      "gh",
      ["run", "list", "--repo", REPO, "--workflow", workflow, "--event", "schedule",
       "--limit", String(RUN_LIMIT), "--json", "createdAt,conclusion"],
      { encoding: "utf8", cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
    );
    raw = r;
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    raw = err.stdout ?? "";
    stderr = err.stderr ?? "";
  }

  // THREE outcomes, deliberately distinguished. Collapsing them was a real defect:
  // adding this very workflow made `gh` 404 (GitHub does not know a workflow until
  // it exists on the default branch), which killed the whole observation. One
  // not-yet-known workflow must not blind the observer to the other twelve.
  const combined = `${raw}\n${stderr}`;
  if (/not found on the default branch/i.test(combined)) {
    return null; // known-unknown: not yet on main, so it has no runs to have
  }
  if (raw.trim() === "") {
    // Genuinely broken: unauthenticated, offline, rate-limited. An observer that
    // reports "nothing to see" when it is broken is worse than no observer.
    return die(`gh run list failed for ${workflow} — is gh authenticated? (this is not a cadence finding)`);
  }
  let runs: { createdAt: string; conclusion: string | null }[];
  try {
    runs = JSON.parse(raw);
  } catch {
    return die(`gh returned unparseable JSON for ${workflow}`);
  }
  // COVERAGE GUARD. `--limit 300` binds on high-frequency workflows: for three of
  // Dime's, the API returns exactly 300 rows. That is fine only while the window
  // reaches back past the measured date. If the oldest row is newer than DATE,
  // the count is a FLOOR, not a count, and reporting it as a count would
  // understate the cadence and manufacture drift.
  const oldest = runs.length > 0 ? runs.map((r) => r.createdAt.slice(0, 10)).sort()[0] : null;
  // `>` missed the case where the window truncates INSIDE the measured day: the
  // oldest row is then ON that date, the guard stayed silent, and a partial count
  // was reported as a count.
  if (runs.length >= RUN_LIMIT && oldest !== null && oldest >= DATE) {
    return die(
      `${workflow}: the ${RUN_LIMIT}-run window only reaches back to ${oldest}, which is after ` +
        `${DATE} — the count would be a floor, not a count. Re-run with a nearer --date.`,
    );
  }

  const onDate = runs.filter((r) => r.createdAt.slice(0, 10) === DATE);
  const conclusions: Record<string, number> = {};
  for (const r of onDate) {
    const k = r.conclusion ?? "running";
    conclusions[k] = (conclusions[k] ?? 0) + 1;
  }
  return { total: onDate.length, conclusions, createdAt: onDate.map((r) => r.createdAt) };
}

const declared = declaredSchedules();
if (declared.size === 0) die(`no scheduled workflows found under ${WORKFLOWS}`);

// A shallow clone has no history, so `git log --diff-filter=A` reports the single
// available commit as the add date for EVERY file — every workflow then looks
// newer than the window, all are excluded, and the report reads
// "all 0 declared schedules honoured". Exit 0, green, forever. That is the
// observer certifying its own blindness, so it refuses to run instead.
try {
  const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
    encoding: "utf8",
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (shallow === "true") {
    die(
      "this is a SHALLOW clone — file history is unavailable, so every workflow would be " +
        "excluded as 'newer than the window' and the run would report a false all-clear. " +
        "Check out with fetch-depth: 0.",
    );
  }
} catch (e) {
  if (e instanceof Error && /SHALLOW/.test(e.message)) throw e;
  // `--is-shallow-repository` is old enough to rely on; a failure here means git
  // itself is unusable, which the calls below will surface.
}

if (!isCompleteDay(DATE, NOW)) {
  die(`${DATE} is not a complete UTC day yet — a partial day cannot be scored against a full day's expectation`);
}

/**
 * When the workflow file first appeared in this branch's history.
 *
 * A workflow that did not exist for the whole measured day cannot have run for
 * it. `12-nightly-verification.yml` reached main at 2026-08-06T04:38Z and was
 * nonetheless reported as 0 of 1 — a 0% "cadence finding" about a file that did
 * not exist at its own scheduled time. Answered from git rather than the API
 * because git is the authority on when a file was on this branch.
 */
function addedAt(workflow: string): string | null {
  try {
    // The EARLIEST add, not the most recent. `-1` returns the latest, and a file
    // that was moved, deleted-and-restored, or touched by a rename shows a recent
    // add — which wrongly excused two long-standing workflows from measurement
    // and would have hidden real drift behind a "too new" label.
    const out = execFileSync(
      "git",
      ["log", "--diff-filter=A", "--format=%cI", "--reverse", "--", `.github/workflows/${workflow}`],
      { encoding: "utf8", cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
    const first = out.split("\n").filter(Boolean)[0];
    return first || null;
  } catch {
    return null;
  }
}

console.log(`  LOOP-002 cron cadence observation — ${DATE} (UTC)`);
console.log(`  ${declared.size} workflow(s) declare a schedule\n`);

const verdicts: CadenceVerdict[] = [];
const successOnly: string[] = [];
const notYetKnown: string[] = [];
const tooNew: string[] = [];

for (const [workflow, exprs] of Array.from(declared.entries()).sort()) {
  let expected: number;
  try {
    expected = exprs.reduce((n: number, e: string) => n + expectedRunsOnDate(e, DATE), 0);
  } catch (e) {
    // A malformed expression must not score as "0 expected, honoured".
    die(`${workflow}: ${(e as Error).message}`);
  }
  const added = addedAt(workflow);
  // `%cI` carries the committer's LOCAL offset, so a lexicographic compare against
  // a `Z` literal is not a time comparison at all. Parse both to instants.
  const windowStart = Date.parse(`${DATE}T00:00:00Z`);
  const addedMs = added ? Date.parse(added) : null;
  if (addedMs !== null && !Number.isNaN(addedMs) && addedMs > windowStart) {
    tooNew.push(`${workflow} (added ${added!.slice(0, 10)})`);
    console.log(
      `     ${workflow.padEnd(34)} declared ${exprs.join(" + ").padEnd(24)} added ${added!.slice(0, 10)} — did not exist for the whole of ${DATE}`,
    );
    continue;
  }
  const runs = actualRuns(workflow);
  if (runs === null) {
    // Declared here but not yet on the default branch — GitHub has no history for
    // it, which is not a cadence finding. Named, never silently dropped.
    notYetKnown.push(workflow);
    console.log(`     ${workflow.padEnd(34)} declared ${exprs.join(" + ").padEnd(24)} not yet on the default branch — no history to observe`);
    continue;
  }
  const { total, conclusions } = runs;
  // Gaps, computed from IN-WINDOW runs by the instrument itself. The first
  // published figures were produced by hand over a 35.6-hour trailing window and
  // then described as a complete day; nothing could reproduce or regression-test
  // them. Only emitted where a cadence is dense enough for a gap to mean anything.
  if (expected >= 24 && total >= 2) {
    const g = runGaps(runs.createdAt, DATE);
    if (g.medianMin !== null) {
      console.log(
        `        gaps (in-window): n=${g.gaps.length} median=${g.medianMin}m max=${g.maxMin}m` +
          `  [${g.gaps.join(", ")}]`
      );
    }
  }
  const v = cadenceVerdict({ workflow, expected, actual: total });
  verdicts.push(v);

  const ratio = v.ratio === null ? "  —  " : `${(v.ratio * 100).toFixed(0).padStart(4)}%`;
  const flag = v.honoured ? "   " : "!! ";
  console.log(
    `  ${flag}${workflow.padEnd(34)} declared ${exprs.join(" + ").padEnd(24)} expected ${String(expected).padStart(4)}  actual ${String(total).padStart(4)}  ${ratio}${v.note ? "  " + v.note : ""}`,
  );

  // The finding that outranks the drift itself: an under-running workflow whose
  // every recorded run is green. Absence has no conclusion, so it has no colour.
  if (!v.honoured && total > 0 && Object.keys(conclusions).every((k) => k === "success")) {
    successOnly.push(`${workflow} (${total}/${expected}, ${total} success, 0 failure)`);
  }
}

const broken = verdicts.filter((v) => !v.honoured);

console.log("");
// Print WHAT was excluded before deciding whether anything is left: an operator
// who gets a refusal needs to see the reason in the same output.
if (tooNew.length > 0) {
  console.log(`  ${tooNew.length} workflow(s) newer than the measured day, excluded: ${tooNew.join(", ")}`);
}
if (notYetKnown.length > 0) {
  console.log(`  ${notYetKnown.length} workflow(s) not yet on the default branch, excluded: ${notYetKnown.join(", ")}`);
}

// "all 0 honoured" is not an all-clear; it is "I measured nothing". That reading
// is how the shallow-clone defect presented, and it can arrive by other routes
// too — every workflow too new, or every one unknown to GitHub. Refuse it.
if (verdicts.length === 0) {
  if (notYetKnown.length > 0 || tooNew.length > 0) {
    die(
      `nothing was measured on ${DATE}: every declared workflow was excluded ` +
        `(${tooNew.length} newer than the window, ${notYetKnown.length} not on the default branch). ` +
        `Zero measured is not zero broken.`
    );
  }
  die(`nothing was measured on ${DATE} — no workflow produced a comparable schedule`);
}
if (broken.length === 0) {
  console.log(`  all ${verdicts.length} declared schedules honoured on ${DATE}`);
} else {
  console.log(`  ${broken.length} of ${verdicts.length} schedule(s) NOT honoured on ${DATE}`);
}
if (successOnly.length > 0) {
  console.log("");
  console.log("  EVERY UNDER-RUN REPORTS SUCCESS — the gap is invisible to CI:");
  for (const s of successOnly) console.log(`    ${s}`);
}

if (DRY_RUN) {
  console.log("\n  --dry-run: reporting only, exit 0");
  process.exit(0);
}
process.exit(broken.length > 0 ? 1 : 0);
