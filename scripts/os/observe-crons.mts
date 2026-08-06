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
import { expectedRunsOnDate, cadenceVerdict, type CadenceVerdict } from "../../shared/os/cadence.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WORKFLOWS = join(ROOT, ".github/workflows");
const REPO = "aisportsbettingcontact/ai-sports-betting-dime-ai";

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const dateArg = argv[argv.indexOf("--date") + 1];
const DATE = argv.includes("--date") && /^\d{4}-\d{2}-\d{2}$/.test(dateArg ?? "")
  ? dateArg
  : new Date().toISOString().slice(0, 10);

function die(msg: string): never {
  console.error(`  ERROR ${msg}`);
  process.exit(1);
}

/** Every `- cron: <expr>` under a `schedule:` block, per workflow file. */
function declaredSchedules(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const file of readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f))) {
    const text = readFileSync(join(WORKFLOWS, file), "utf8");
    const lines = text.split("\n");
    const exprs: string[] = [];
    let inSchedule = false;
    let scheduleIndent = -1;
    for (const line of lines) {
      const m = /^(\s*)schedule:\s*$/.exec(line);
      if (m) {
        inSchedule = true;
        scheduleIndent = m[1].length;
        continue;
      }
      if (!inSchedule) continue;
      if (line.trim() === "" || line.trim().startsWith("#")) continue;
      const indent = line.length - line.trimStart().length;
      // A key at or above the schedule block's own indent ends the block.
      if (indent <= scheduleIndent && line.trim() !== "") {
        inSchedule = false;
        continue;
      }
      const c = /^\s*-\s*cron:\s*['"]?([^'"#]+?)['"]?\s*(?:#.*)?$/.exec(line);
      if (c) exprs.push(c[1].trim());
    }
    if (exprs.length > 0) out.set(file, exprs);
  }
  return out;
}

/** Completed scheduled runs GitHub recorded for `workflow` on the measured day. */
function actualRuns(workflow: string): { total: number; conclusions: Record<string, number> } | null {
  let raw: string;
  let stderr = "";
  try {
    const r = execFileSync(
      "gh",
      ["run", "list", "--repo", REPO, "--workflow", workflow, "--event", "schedule",
       "--limit", "300", "--json", "createdAt,conclusion"],
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
  const onDate = runs.filter((r) => r.createdAt.slice(0, 10) === DATE);
  const conclusions: Record<string, number> = {};
  for (const r of onDate) {
    const k = r.conclusion ?? "running";
    conclusions[k] = (conclusions[k] ?? 0) + 1;
  }
  return { total: onDate.length, conclusions };
}

const declared = declaredSchedules();
if (declared.size === 0) die(`no scheduled workflows found under ${WORKFLOWS}`);

console.log(`  LOOP-002 cron cadence observation — ${DATE} (UTC)`);
console.log(`  ${declared.size} workflow(s) declare a schedule\n`);

const verdicts: CadenceVerdict[] = [];
const successOnly: string[] = [];
const notYetKnown: string[] = [];

for (const [workflow, exprs] of Array.from(declared.entries()).sort()) {
  let expected: number;
  try {
    expected = exprs.reduce((n: number, e: string) => n + expectedRunsOnDate(e, DATE), 0);
  } catch (e) {
    // A malformed expression must not score as "0 expected, honoured".
    die(`${workflow}: ${(e as Error).message}`);
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
if (broken.length === 0) {
  console.log(`  all ${verdicts.length} declared schedules honoured on ${DATE}`);
} else {
  console.log(`  ${broken.length} of ${verdicts.length} schedule(s) NOT honoured on ${DATE}`);
}
if (notYetKnown.length > 0) {
  console.log(`  ${notYetKnown.length} workflow(s) not yet on the default branch, excluded: ${notYetKnown.join(", ")}`);
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
