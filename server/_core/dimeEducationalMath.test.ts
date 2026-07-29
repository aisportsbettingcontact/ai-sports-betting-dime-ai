import { describe, expect, it } from "vitest";
import {
  hasDimeEducationalMathIntent,
  resolveDimeEducationalMath,
} from "./dimeEducationalMath";

describe("Dime deterministic educational math", () => {
  it.each([
    ["What is the implied probability at -150?", "60.00%"],
    ["What is the implied probability at +150?", "40.00%"],
  ])("calculates American-odds probability for %s", (query, expected) => {
    const result = resolveDimeEducationalMath(query);

    expect(result?.kind).toBe("american_odds_implied_probability");
    expect(result?.answer).toContain(expected);
    expect(result?.answer).not.toContain("87.07%");
  });

  it("uses a fixed, labeled hypothetical when no price is supplied", () => {
    const result = resolveDimeEducationalMath(
      "Explain implied probability using a hypothetical example."
    );

    expect(result?.answer).toContain("Hypothetical example:");
    expect(result?.answer).toContain("-150");
    expect(result?.answer).toContain("60.00%");
  });

  it("keeps probability edge and dollar EV in separate units", () => {
    const result = resolveDimeEducationalMath(
      "At -110 with a 55% win probability, what is EV per $100 risked?"
    );

    expect(result?.kind).toBe("american_odds_expected_value");
    expect(result?.answer).toContain("Expected value:");
    expect(result?.answer).toContain("+$5.00");
    expect(result?.answer).toContain("Expected ROI: +5.00%");
    expect(result?.answer).toContain("+2.62 percentage points");
    expect(result?.answer).toContain(
      "The probability-edge figure is not dollar EV."
    );
    expect(result?.answer).not.toContain("+$2.62");
  });

  it.each([
    "What is the implied probability at -99?",
    "Compare the implied probability at +120 and -110.",
    "At -110 with a 105% win probability, what is EV?",
    "At -110 with 55% versus 60% win probability, what is EV?",
    "At -110 with a 55,5% win probability, what is EV?",
    "At -110 with a 55% win probability, what is EV per $0 risked?",
    "At -110 with a 55% win probability, what is EV per $1,00 risked?",
    "With a $1,000 bankroll, what is EV at -110 and 55% per $100 risked?",
    "At -110 and 55%, what is EV on a $100 bonus bet?",
    "At -110 and 55%, what is EV for 2 units risked?",
  ])("fails closed with deterministic input guidance: %s", query => {
    const result = resolveDimeEducationalMath(query);
    expect(result?.kind).toBe("math_input_required");
    expect(result?.answer).toMatch(/exactly one|need exactly one/i);
  });

  it("does not claim unrelated education is deterministic math", () => {
    expect(
      resolveDimeEducationalMath("Tell me about bankroll discipline.")
    ).toBeUndefined();
    expect(
      resolveDimeEducationalMath("What is expected value in sports betting?")
    ).toBeUndefined();
    expect(resolveDimeEducationalMath("What does ROI mean?")).toBeUndefined();
  });

  it("does not amplify rounded per-dollar EV at large stakes", () => {
    const result = resolveDimeEducationalMath(
      "At +123 with a 33.333333% win probability, what is EV per $1,000,000,000 risked?"
    );

    expect(result?.kind).toBe("american_odds_expected_value");
    expect(result?.answer).toContain("-$256666674.10");
    expect(result?.answer).not.toContain("-$256667000.00");
  });

  it("recognizes only explicit supported math intent", () => {
    expect(hasDimeEducationalMathIntent("Calculate EV at -110.")).toBe(true);
    expect(hasDimeEducationalMathIntent("Explain implied probability.")).toBe(
      false
    );
    expect(
      hasDimeEducationalMathIntent(
        "Explain implied probability with a hypothetical example."
      )
    ).toBe(true);
    expect(hasDimeEducationalMathIntent("Who will win tonight?")).toBe(false);
  });
});
