import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs module without type declarations
import { evaluateAgreement, parseRatings, ranks, spearman, DIMENSIONS } from "./rubric-agreement.mjs";

describe("rubric agreement harness (Q6)", () => {
  it("ranks handle ties with averaged positions", () => {
    expect(ranks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  });

  it("spearman: perfect, inverse, and undefined cases", () => {
    expect(spearman([1, 2, 3, 4], [2, 3, 4, 5])).toBe(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBe(-1);
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull(); // zero variance
    expect(spearman([1], [1])).toBeNull(); // n < 2
  });

  function csv(rows: string[]): string {
    return ["sample_id,rater,faithfulness,uncertainty_honesty,actionability,brand_tone,auto_fail,notes", ...rows].join("\n");
  }

  it("parses ratings and skips incomplete rows", () => {
    const { byId, skipped } = parseRatings(
      csv(["s1,owner,5,4,4,5,,ok", "s1,grader,5,4,4,5,,", "s2,owner,,,,,,unrated"]),
    );
    expect(byId.get("s1").owner.scores.faithfulness).toBe(5);
    expect(skipped).toEqual(["s2/owner"]);
  });

  it("passes calibration when grader tracks humans and honors auto-fails", () => {
    const rows: string[] = [];
    for (let i = 0; i < 6; i++) {
      const score = 1 + (i % 5);
      for (const rater of ["owner", "reviewer", "grader"]) {
        rows.push(`s${i},${rater},${score},${score},${score},${score},,`);
      }
    }
    const { byId } = parseRatings(csv(rows));
    const result = evaluateAgreement(byId);
    expect(result.ok).toBe(true);
    for (const dim of DIMENSIONS) {
      for (const { rho } of result.perDimension[dim]) expect(rho).toBe(1);
    }
  });

  it("fails when the grader passes a sample a human auto-failed (hard rule)", () => {
    const rows: string[] = [];
    for (let i = 0; i < 6; i++) {
      const score = 1 + (i % 5);
      const humanAutoFail = i === 2 ? "1" : "";
      rows.push(`s${i},owner,${score},${score},${score},${score},${humanAutoFail},`);
      rows.push(`s${i},reviewer,${score},${score},${score},${score},,`);
      rows.push(`s${i},grader,${score},${score},${score},${score},,`); // grader never auto-fails
    }
    const result = evaluateAgreement(parseRatings(csv(rows)).byId);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("AUTO_FAIL_DISAGREEMENT");
    expect(result.violations).toEqual(["s2: grader passed a human auto-fail"]);
  });

  it("fails below the Spearman threshold instead of rounding up", () => {
    // Grader anti-correlated with owner on one dimension.
    const ownerScores = [1, 2, 3, 4, 5, 1];
    const graderScores = [5, 4, 3, 2, 1, 5];
    const rows: string[] = [];
    for (let i = 0; i < 6; i++) {
      rows.push(`s${i},owner,${ownerScores[i]},${ownerScores[i]},${ownerScores[i]},${ownerScores[i]},,`);
      rows.push(`s${i},reviewer,${ownerScores[i]},${ownerScores[i]},${ownerScores[i]},${ownerScores[i]},,`);
      rows.push(`s${i},grader,${graderScores[i]},${ownerScores[i]},${ownerScores[i]},${ownerScores[i]},,`);
    }
    const result = evaluateAgreement(parseRatings(csv(rows)).byId);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("BELOW_THRESHOLD");
  });
});
