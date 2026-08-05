#!/usr/bin/env node
/**
 * check-patch-coverage.mjs — native patch-coverage gate (no Codecov account).
 *
 * Inputs:  coverage/coverage-final.json (vitest --coverage, v8 provider)
 *          BASE_REF env (default origin/main) for the changed-line diff
 * Policy:  >=90% on changed lines overall; 100% on money/auth paths;
 *          a missing or empty coverage report FAILS (fail-closed).
 *
 * Uncovered changed lines print as file:line so justifications can be written
 * in the PR. Exit 0 = pass, 1 = coverage below floor, 2 = report/scan error.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_REF || "origin/main";
const REPORT = process.env.COVERAGE_REPORT || "coverage/coverage-final.json";
const FLOOR = Number(process.env.PATCH_COVERAGE_FLOOR || 90);
const CRITICAL_PATHS = [
  /^server\/stripe\//,
  /^server\/routers\/stripe\.ts$/,
  /appUsers/,
  /ownerAuth/,
  /parlayCore/,
  /betTrackerCore/,
];

if (!fs.existsSync(REPORT)) {
  console.error(
    `[patch-coverage] FAIL-CLOSED: ${REPORT} missing — coverage collection itself failed`
  );
  process.exit(2);
}
const coverage = JSON.parse(fs.readFileSync(REPORT, "utf8"));
if (Object.keys(coverage).length === 0) {
  console.error("[patch-coverage] FAIL-CLOSED: empty coverage report");
  process.exit(2);
}

// changed lines per file (added/modified only), server+shared TS non-test
const diff = execSync(
  `git diff --unified=0 ${BASE}...HEAD -- 'server/**/*.ts' 'shared/**/*.ts'`,
  {
    encoding: "utf8",
    maxBuffer: 64e6,
  }
);
const changed = new Map(); // file -> Set(lines)
let file = null;
for (const line of diff.split("\n")) {
  const f = line.match(/^\+\+\+ b\/(.+)$/);
  if (f) {
    file = f[1];
    continue;
  }
  const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
  if (h && file && !/\.(test|spec)\./.test(file)) {
    const start = Number(h[1]);
    const count = h[2] === undefined ? 1 : Number(h[2]);
    if (!changed.has(file)) changed.set(file, new Set());
    for (let i = 0; i < count; i++) changed.get(file).add(start + i);
  }
}

if (changed.size === 0) {
  console.log("[patch-coverage] no changed server/shared source lines — pass");
  process.exit(0);
}

// Format-neutral change detection (added for the 2026-08-05 format-all
// commit, kept because any future formatting churn has the same shape):
// a changed file is exempt ONLY when prettier-normalizing its BASE version
// yields byte-identical HEAD content — proof the diff is pure formatting
// with zero behavioral change. Everything else keeps full line accounting.
// Fail-closed: if the base blob or prettier is unavailable, the file stays in.
const mergeBase = execSync(`git merge-base ${BASE} HEAD`, {
  encoding: "utf8",
}).trim();
let prettierLib = null;
try {
  prettierLib = await import("prettier");
} catch {
  console.log(
    "[patch-coverage] prettier unavailable — format-neutral exemption disabled"
  );
}
if (prettierLib) {
  let exempt = 0;
  for (const f of [...changed.keys()]) {
    let baseSrc;
    try {
      baseSrc = execSync(`git show ${mergeBase}:${JSON.stringify(f)}`, {
        encoding: "utf8",
        maxBuffer: 64e6,
      });
    } catch {
      continue; // new or renamed file — real change, keep
    }
    let headSrc;
    try {
      headSrc = fs.readFileSync(f, "utf8");
    } catch {
      continue; // deleted at HEAD — nothing to cover, but keep conservative
    }
    try {
      // Mirror the CLI exactly: resolve .prettierrc/editorconfig for this
      // path — the bare API applies defaults only, which would silently
      // break the byte-equality proof. Compare against prettier's FIXPOINT
      // (≤3 passes): prettier is not idempotent on some comment placements,
      // and the committed tree is itself a fixpoint (--check clean).
      const resolved =
        (await prettierLib.resolveConfig(f, { editorconfig: true })) ?? {};
      let normalizedBase = baseSrc;
      for (let pass = 0; pass < 3; pass++) {
        const next = await prettierLib.format(normalizedBase, {
          ...resolved,
          filepath: f,
        });
        if (next === normalizedBase) break;
        normalizedBase = next;
      }
      if (normalizedBase === headSrc) {
        changed.delete(f);
        exempt++;
      }
    } catch {
      // base version unparseable by prettier — real change territory, keep
    }
  }
  if (exempt > 0) {
    console.log(
      `[patch-coverage] ${exempt} file(s) exempt: prettier(base) === head (pure-format diff, zero behavioral change)`
    );
  }
}

if (changed.size === 0) {
  console.log("[patch-coverage] all changed files proven format-only — pass");
  process.exit(0);
}

// v8 coverage-final: keyed by abs path, statementMap + s counts
const byRelPath = new Map();
for (const [abs, entry] of Object.entries(coverage)) {
  byRelPath.set(path.relative(process.cwd(), abs), entry);
}

let total = 0,
  covered = 0,
  criticalTotal = 0,
  criticalCovered = 0;
const uncovered = [];
for (const [f, lines] of changed) {
  const entry = byRelPath.get(f);
  const isCritical = CRITICAL_PATHS.some(rx => rx.test(f));
  // executable lines = lines appearing in the statement map
  const execLines = new Map(); // line -> hit?
  if (entry) {
    for (const [sid, loc] of Object.entries(entry.statementMap)) {
      const hits = entry.s[sid];
      for (let l = loc.start.line; l <= loc.end.line; l++) {
        execLines.set(l, execLines.get(l) || false || hits > 0);
      }
    }
  }
  for (const l of lines) {
    if (!execLines.has(l)) continue; // non-executable (comment/type/blank)
    total++;
    if (isCritical) criticalTotal++;
    if (execLines.get(l)) {
      covered++;
      if (isCritical) criticalCovered++;
    } else {
      uncovered.push(`${f}:${l}${isCritical ? "  [CRITICAL PATH]" : ""}`);
    }
  }
}

const pct = total === 0 ? 100 : (covered / total) * 100;
const critPct =
  criticalTotal === 0 ? 100 : (criticalCovered / criticalTotal) * 100;
console.log(
  `[patch-coverage] changed executable lines: ${total}, covered: ${covered} (${pct.toFixed(1)}%)`
);
console.log(
  `[patch-coverage] critical-path lines: ${criticalTotal}, covered: ${criticalCovered} (${critPct.toFixed(1)}%)`
);
for (const u of uncovered.slice(0, 50)) console.log(`  uncovered: ${u}`);

if (critPct < 100) {
  console.error(
    "[patch-coverage] FAIL: money/auth paths require 100% patch coverage"
  );
  process.exit(1);
}
if (pct < FLOOR) {
  console.error(
    `[patch-coverage] FAIL: ${pct.toFixed(1)}% < ${FLOOR}% floor — cover the lines or justify in the PR and adjust with owner approval`
  );
  process.exit(1);
}
console.log("[patch-coverage] PASS");
