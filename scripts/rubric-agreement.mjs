/**
 * rubric-agreement.mjs — calibration scorer for the display-copy rubric (Q6).
 *
 * Consumes a filled ratings CSV (see ratings.template.csv: one row per
 * sample × rater, raters = owner/reviewer/grader) and computes, per rubric
 * dimension, the Spearman rank correlation between the LLM grader and each
 * human rater, plus the auto-fail agreement check the protocol requires:
 * the grader may NEVER pass a sample a human auto-failed.
 *
 * Acceptance (docs/ai-native/factory/display-copy-rubric.md): grader–human
 * Spearman ≥ 0.7 on every dimension AND zero grader-passes-human-auto-fail.
 *
 * Usage: node scripts/rubric-agreement.mjs --input=docs/ai-native/factory/calibration/ratings.csv
 * Exit codes: 0 calibration passes; 1 fails; 2 input error.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DIMENSIONS = ["faithfulness", "uncertainty_honesty", "actionability", "brand_tone"];
export const SPEARMAN_THRESHOLD = 0.7;

/** Average ranks with tie handling. */
export function ranks(values) {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const out = new Array(values.length);
  let pos = 0;
  while (pos < indexed.length) {
    let end = pos;
    while (end + 1 < indexed.length && indexed[end + 1].v === indexed[pos].v) end++;
    const avgRank = (pos + end) / 2 + 1;
    for (let k = pos; k <= end; k++) out[indexed[k].i] = avgRank;
    pos = end + 1;
  }
  return out;
}

/** Spearman rho via Pearson on ranks (tie-safe). Returns null when undefined (n<2 or zero variance). */
export function spearman(a, b) {
  if (a.length !== b.length || a.length < 2) return null;
  const ra = ranks(a);
  const rb = ranks(b);
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  if (da === 0 || db === 0) return null;
  return Number((num / Math.sqrt(da * db)).toFixed(4));
}

/** Parse the ratings CSV into {sampleId → {rater → row}}. Incomplete rows are skipped with a note. */
export function parseRatings(csv) {
  const lines = csv.trim().split("\n");
  const header = lines[0].split(",").map((h) => h.trim());
  const byId = new Map();
  const skipped = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = line.split(",");
    const row = Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? "").trim()]));
    const complete = DIMENSIONS.every((d) => row[d] !== "" && !Number.isNaN(Number(row[d])));
    if (!complete) {
      skipped.push(`${row.sample_id}/${row.rater}`);
      continue;
    }
    const entry = byId.get(row.sample_id) ?? {};
    entry[row.rater] = {
      scores: Object.fromEntries(DIMENSIONS.map((d) => [d, Number(row[d])])),
      autoFail: /^(1|true|yes)$/i.test(row.auto_fail ?? ""),
    };
    byId.set(row.sample_id, entry);
  }
  return { byId, skipped };
}

/**
 * The calibration verdict. Pure — unit-tested. Compares the grader against
 * each human rater on samples both rated.
 */
export function evaluateAgreement(byId, humanRaters = ["owner", "reviewer"], graderName = "grader") {
  const perDimension = {};
  const violations = [];
  for (const dimension of DIMENSIONS) {
    const rhos = [];
    for (const human of humanRaters) {
      const graderScores = [];
      const humanScores = [];
      for (const entry of byId.values()) {
        if (entry[graderName] && entry[human]) {
          graderScores.push(entry[graderName].scores[dimension]);
          humanScores.push(entry[human].scores[dimension]);
        }
      }
      const rho = spearman(graderScores, humanScores);
      rhos.push({ human, n: graderScores.length, rho });
    }
    perDimension[dimension] = rhos;
  }
  for (const [sampleId, entry] of byId.entries()) {
    const humanAutoFail = humanRaters.some((h) => entry[h]?.autoFail);
    const graderPassed = entry[graderName] && !entry[graderName].autoFail;
    if (humanAutoFail && graderPassed) {
      violations.push(`${sampleId}: grader passed a human auto-fail`);
    }
  }
  const rhoValues = Object.values(perDimension).flat().map((r) => r.rho);
  const allMeasured = rhoValues.every((rho) => rho !== null);
  const allAboveThreshold = rhoValues.every((rho) => rho !== null && rho >= SPEARMAN_THRESHOLD);
  return {
    ok: allMeasured && allAboveThreshold && violations.length === 0,
    perDimension,
    violations,
    reason: !allMeasured
      ? "UNMEASURABLE: a dimension has too few overlapping ratings or zero variance"
      : !allAboveThreshold
        ? `BELOW_THRESHOLD: at least one grader-human Spearman < ${SPEARMAN_THRESHOLD}`
        : violations.length > 0
          ? "AUTO_FAIL_DISAGREEMENT: grader passed sample(s) a human auto-failed"
          : null,
  };
}

function main() {
  const inputArg = process.argv.find((a) => a.startsWith("--input="));
  if (!inputArg) {
    console.error("Usage: node scripts/rubric-agreement.mjs --input=<ratings.csv>");
    process.exit(2);
  }
  let csv;
  try {
    csv = readFileSync(inputArg.slice("--input=".length), "utf8");
  } catch (err) {
    console.error(`[RubricAgree] cannot read input: ${err.message}`);
    process.exit(2);
  }
  const { byId, skipped } = parseRatings(csv);
  if (skipped.length > 0) {
    console.log(`[RubricAgree] [STATE] ${skipped.length} incomplete row(s) skipped: ${skipped.join(", ")}`);
  }
  const result = evaluateAgreement(byId);
  for (const [dimension, rhos] of Object.entries(result.perDimension)) {
    for (const { human, n, rho } of rhos) {
      console.log(`[RubricAgree] [OUTPUT] ${dimension}: grader vs ${human} rho=${rho ?? "n/a"} (n=${n})`);
    }
  }
  for (const violation of result.violations) console.error(`[RubricAgree] [VERIFY] FAIL — ${violation}`);
  console.log(result.ok ? "[RubricAgree] PASS — calibration accepted" : `[RubricAgree] FAIL — ${result.reason}`);
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
