import { describe, expect, it } from "vitest";
import { assessDimeResponsibleGamblingSafety, containsProhibitedBettingCertainty } from "./dimeSafety";

describe("Dime responsible gambling safety", () => {
  it("does not hardcode a US hotline for unknown jurisdiction", () => {
    const result = assessDimeResponsibleGamblingSafety("I am chasing losses and cannot stop", "unknown");
    expect(result.risk).toBe("distress");
    expect(result.resourceText).toContain("local support resources");
    expect(result.resourceText).not.toContain("1-800-GAMBLER");
  });

  it("uses validated US resource only for US jurisdiction", () => {
    const result = assessDimeResponsibleGamblingSafety("I need to borrow to bet", "US");
    expect(result.resourceText).toContain("1-800-GAMBLER");
  });

  it("detects prohibited certainty language", () => {
    expect(containsProhibitedBettingCertainty("This is a guaranteed lock")).toBe(true);
    expect(containsProhibitedBettingCertainty("This is a small edge with risk")).toBe(false);
  });
});
