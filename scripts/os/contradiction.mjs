#!/usr/bin/env node
/**
 * scripts/os/contradiction.mjs — D13's founder-loop requirement, computed.
 *
 * Compares a goal's DECLARED priority paths against where engineering activity
 * ACTUALLY went, using the engineering loop's own cycle artifacts. Surfaces
 * "a claimed priority that engineering activity ignores" without anyone
 * remembering to look.
 */
import { execFileSync } from "child_process";
import { readFileSync, readdirSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const git = (...a) => execFileSync("git", a, { encoding: "utf8", cwd: ROOT }).trim();

const goalsDir = join(ROOT, "os/goals");
const goalFile = readdirSync(goalsDir).find((f) => /^GR-\d+.*\.md$/.test(f));
const md = readFileSync(join(goalsDir, goalFile), "utf8");
const paths = (md.split(/^## Activity paths$/m)[1] ?? "").split(/^## /m)[0]
  .split("\n").map((l) => l.trim()).filter((l) => l.startsWith("-"))
  .map((l) => l.replace(/^-\s*/, "").replace(/`/g, "").trim()).filter(Boolean);

let cycles = [];
try {
  cycles = git("show", "origin/os-ledger:cycles.jsonl").split("\n").filter(Boolean).map((l) => JSON.parse(l));
} catch { /* no ledger yet */ }

const filesPerCycle = cycles.map((c) => {
  try { return git("diff", "--name-only", `${c.commitSha}^1`, c.commitSha).split("\n").filter(Boolean); }
  catch { return []; }
});

const rx = (g) => new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, " ").replace(/\*/g, "[^/]*").replace(/ /g, ".*") + "$");
const globs = paths.map(rx);
const onGoal = filesPerCycle.filter((fs) => fs.some((f) => globs.some((g) => g.test(f)))).length;
const total = filesPerCycle.length;

if (total === 0) { console.log(`  state=not_measured — no recorded cycles`); process.exit(0); }
const share = onGoal / total;
console.log(`  goal          ${goalFile.replace(/\.md$/, "")}`);
console.log(`  declared      ${paths.join(", ")}`);
console.log(`  cycles        ${total}`);
console.log(`  on-goal       ${onGoal} (${(share * 100).toFixed(0)}%)`);
console.log(`  contradiction ${share < 0.5 ? "YES — declared priority is not where the work went" : "no"}`);
