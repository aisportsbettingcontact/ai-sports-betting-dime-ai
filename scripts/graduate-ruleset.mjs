#!/usr/bin/env node
/**
 * graduate-ruleset.mjs — promote verification checks to REQUIRED, by wave.
 *
 * docs/verification/ROLLOUT.md defines when each check may block merges.
 * Getting this wrong is expensive in a specific way: requiring a context that
 * never reports leaves every PR stuck on "Expected — waiting for status", and
 * requiring one that false-fires blocks all merges. So this script refuses to
 * act unless it can prove, against live GitHub data, that:
 *
 *   1. the wave's observation window from ROLLOUT.md has actually elapsed,
 *   2. every context it is about to require REPORTED on a recent real PR,
 *   3. every one of those reports was a PASS (no known-red check graduates).
 *
 * Dry-run by default — it only reads. `--apply` performs the ruleset PUT.
 *
 *   node scripts/graduate-ruleset.mjs --wave=1
 *   node scripts/graduate-ruleset.mjs --wave=1 --apply
 *
 * `--force` skips ONLY the calendar check (for an owner-directed early
 * graduation, as happened for format-check on 2026-08-05). It never skips the
 * reported-and-green proof.
 */
import { execFileSync } from "node:child_process";

const REPO = "tailered-ai/dime-ai";
const RULESET_ID = "18701573";
// GitHub Actions app — pins check identity so a same-named check from another
// app cannot satisfy a required context (RULESETS.md).
const ACTIONS_INTEGRATION_ID = 15368;

// Wave 0 started when the framework merged to main (PR #371).
const WAVE0_START = Date.parse("2026-08-05T14:22:58Z");
const DAY = 86_400_000;

const WAVES = {
  1: {
    afterDays: 7,
    rationale: "ROLLOUT Wave 1 — deterministic core, after 1 clean week",
    contexts: [
      "01-pr-proof-contract",
      "05-workflow-security",
      "06-dependency-review",
      "08-contract-and-data-integrity",
      "10-ai-eval-critical",
    ],
  },
  2: {
    afterDays: 14,
    rationale:
      "ROLLOUT Wave 2 — scanners, after 02/03 baselines triaged to zero delta",
    contexts: [
      "02-codeql (javascript-typescript)",
      "02-codeql (python)",
      "03-semgrep-blocking",
      "09-artifact-build-and-smoke",
      "11-artifact-attestation",
    ],
  },
  3: {
    afterDays: 21,
    rationale:
      "ROLLOUT Wave 3 — calibrated gates (07 needs >=2 weeks advisory first)",
    contexts: ["07-coverage-patch", "format-check"],
  },
};

const args = process.argv.slice(2);
const wave = String(
  (args.find(a => a.startsWith("--wave=")) || "").split("=")[1] || ""
);
const apply = args.includes("--apply");
const force = args.includes("--force");

if (!WAVES[wave]) {
  console.error(
    `usage: graduate-ruleset.mjs --wave=<1|2|3> [--apply] [--force]`
  );
  process.exit(2);
}
const plan = WAVES[wave];

function gh(endpoint, extra = []) {
  return JSON.parse(
    execFileSync("gh", ["api", endpoint, ...extra], {
      encoding: "utf8",
      maxBuffer: 64e6,
    })
  );
}

// ── 1. observation window ────────────────────────────────────────────────────
const elapsedDays = (Date.now() - WAVE0_START) / DAY;
console.log(`[wave ${wave}] ${plan.rationale}`);
console.log(
  `[window] ${elapsedDays.toFixed(1)}d elapsed since Wave 0 start; requires ${plan.afterDays}d`
);
if (elapsedDays < plan.afterDays) {
  if (!force) {
    console.error(
      `[HALT] observation window not met — ${(plan.afterDays - elapsedDays).toFixed(1)}d remaining. ` +
        `Re-run after that date, or pass --force for an owner-directed early graduation.`
    );
    process.exit(1);
  }
  console.warn("[force] calendar check overridden by owner direction");
}

// ── 2+3. every context must have REPORTED and PASSED on a recent real PR ─────
const recentPrs = gh(
  `repos/${REPO}/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=10`
).filter(pr => pr.merged_at);
if (recentPrs.length === 0) {
  console.error("[HALT] no recently merged PRs to verify contexts against");
  process.exit(1);
}

const seen = new Map(); // context -> conclusion seen most recently
for (const pr of recentPrs) {
  const runs = gh(
    `repos/${REPO}/commits/${pr.head.sha}/check-runs?per_page=100`
  ).check_runs;
  for (const run of runs) {
    if (!seen.has(run.name)) seen.set(run.name, run.conclusion);
  }
  if (plan.contexts.every(c => seen.has(c))) break;
}

const missing = plan.contexts.filter(c => !seen.has(c));
const red = plan.contexts.filter(
  c => seen.has(c) && seen.get(c) !== "success" && seen.get(c) !== "neutral"
);
for (const c of plan.contexts) {
  console.log(`  ${seen.get(c) ?? "NEVER REPORTED"}  ${c}`);
}
if (missing.length) {
  console.error(
    `[HALT] these contexts never reported on a recent PR — requiring them would wedge every merge:\n  ${missing.join("\n  ")}`
  );
  process.exit(1);
}
if (red.length) {
  console.error(
    `[HALT] these contexts are not green on their latest run — fix before requiring:\n  ${red.join("\n  ")}`
  );
  process.exit(1);
}

// ── 4. build the new ruleset body ────────────────────────────────────────────
const ruleset = gh(`repos/${REPO}/rulesets/${RULESET_ID}`);
const checksRule = ruleset.rules.find(r => r.type === "required_status_checks");
if (!checksRule) {
  console.error("[HALT] ruleset has no required_status_checks rule");
  process.exit(1);
}
const existing = checksRule.parameters.required_status_checks;
const have = new Set(existing.map(c => c.context));

// Two enforcement surfaces guard `main`: this ruleset and classic branch
// protection. They are independent, and drift between them is silent — a
// context present in only one is weaker than it looks. Report it every run.
try {
  const classic = gh(
    `repos/${REPO}/branches/main/protection/required_status_checks`
  );
  const classicSet = new Set(classic.contexts ?? []);
  const rulesetOnly = [...have].filter(c => !classicSet.has(c));
  const classicOnly = [...classicSet].filter(c => !have.has(c));
  if (rulesetOnly.length || classicOnly.length) {
    console.warn("[drift] ruleset and classic protection disagree:");
    for (const c of classicOnly) {
      console.warn(`  classic-only (NOT in ruleset): ${c}`);
    }
    for (const c of rulesetOnly) {
      console.warn(`  ruleset-only (NOT in classic): ${c}`);
    }
  } else {
    console.log("[drift] ruleset and classic protection agree");
  }
} catch {
  console.warn("[drift] could not read classic protection — skipping check");
}
const adding = plan.contexts.filter(c => !have.has(c));
if (adding.length === 0) {
  console.log("[done] all wave contexts are already required — nothing to do");
  process.exit(0);
}
for (const context of adding) {
  existing.push({ context, integration_id: ACTIONS_INTEGRATION_ID });
}
console.log(`[plan] adding ${adding.length}: ${adding.join(", ")}`);
console.log(`[plan] required checks after: ${existing.length}`);

if (!apply) {
  console.log("[dry-run] no changes made — re-run with --apply to write");
  process.exit(0);
}

const body = {
  name: ruleset.name,
  target: ruleset.target,
  enforcement: ruleset.enforcement,
  conditions: ruleset.conditions,
  rules: ruleset.rules,
  bypass_actors: ruleset.bypass_actors,
};
execFileSync(
  "gh",
  ["api", "-X", "PUT", `repos/${REPO}/rulesets/${RULESET_ID}`, "--input", "-"],
  { input: JSON.stringify(body), encoding: "utf8", maxBuffer: 64e6 }
);
console.log(
  `[applied] wave ${wave} graduated — ${adding.length} checks now required`
);
