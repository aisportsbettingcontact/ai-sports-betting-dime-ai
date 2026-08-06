import { americanToImpliedProbability } from "./dimeVerdict";

export const DIME_EDUCATIONAL_MATH_VERSION = "dime-educational-math-v1";

export interface DimeEducationalMathResult {
  version: typeof DIME_EDUCATIONAL_MATH_VERSION;
  kind:
    | "american_odds_implied_probability"
    | "american_odds_expected_value"
    | "math_input_required";
  answer: string;
}

const IMPLIED_PROBABILITY_INTENT =
  /\b(?:implied probability|break[- ]?even probability)\b/i;
const EXPECTED_VALUE_INTENT =
  /\b(?:expected value|ev|roi|return on investment)\b/i;
const CALCULATION_CUE =
  /\b(?:calculate|compute|determine|find|example|hypothetical)\b/i;
const SIGNED_ODDS_SYNTAX = /(?<![A-Za-z0-9.])[+-]\d{1,6}/;
const PROBABILITY_SYNTAX =
  /(?<![A-Za-z0-9.])\d+(?:[.,]\d+)?\s*(?:%|percent(?:age)?)/i;
const CASH_AMOUNT_SYNTAX = /\$|\b(?:dollars?|usd)\b/i;

export function hasDimeEducationalMathIntent(query: string): boolean {
  const hasCalculationCue = CALCULATION_CUE.test(query);
  const hasOdds = SIGNED_ODDS_SYNTAX.test(query);
  if (IMPLIED_PROBABILITY_INTENT.test(query)) {
    return hasOdds || hasCalculationCue;
  }
  if (EXPECTED_VALUE_INTENT.test(query)) {
    return (
      hasOdds ||
      hasCalculationCue ||
      PROBABILITY_SYNTAX.test(query) ||
      CASH_AMOUNT_SYNTAX.test(query)
    );
  }
  return false;
}

function parseAmericanOdds(query: string): number[] {
  return Array.from(
    new Set(
      Array.from(
        query.matchAll(/(?<![A-Za-z0-9.])([+-]\d{2,6})(?![A-Za-z0-9]|\.\d)/g)
      ).flatMap(match => {
        const odds = Number(match[1]);
        return Number.isInteger(odds) &&
          Math.abs(odds) >= 100 &&
          Math.abs(odds) <= 100_000
          ? [odds]
          : [];
      })
    )
  );
}

function parseProbabilities(query: string): number[] {
  return Array.from(
    new Set(
      Array.from(
        query.matchAll(
          /(?<![A-Za-z0-9.,])(\d+(?:\.\d+)?)\s*(?:%|percent(?:age)?)(?![A-Za-z])/gi
        )
      ).flatMap(match => {
        const percentage = Number(match[1]);
        return Number.isFinite(percentage) && percentage > 0 && percentage < 100
          ? [percentage / 100]
          : [];
      })
    )
  );
}

function parseCashAmounts(query: string): number[] {
  const matches = [
    ...Array.from(
      query.matchAll(/\$\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)(?![A-Za-z0-9.,])/g)
    ),
    ...Array.from(
      query.matchAll(
        /(?<![$A-Za-z0-9.,])(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:dollars?|usd)\b/gi
      )
    ),
  ];
  return Array.from(
    new Set(
      matches.flatMap(match => {
        const amount = Number(match[1].replaceAll(",", ""));
        return Number.isFinite(amount) && amount > 0 && amount <= 1_000_000_000
          ? [amount]
          : [];
      })
    )
  );
}

function hasCashAmountSyntax(query: string): boolean {
  return CASH_AMOUNT_SYNTAX.test(query);
}

function hasUnsupportedStakeSemantics(query: string): boolean {
  return /\b(?:bonus bet|free bet|free play|risk[- ]?free|to win|units?\s+risked|risk(?:ing|ed)?\s+\d+(?:\.\d+)?\s+units?)\b/i.test(
    query
  );
}

function inputRequired(operation: "implied" | "ev"): DimeEducationalMathResult {
  return {
    version: DIME_EDUCATIONAL_MATH_VERSION,
    kind: "math_input_required",
    answer:
      operation === "implied"
        ? "I can calculate implied probability deterministically, but I need exactly one valid signed American price, such as -110 or +150. Please provide one price."
        : "I can calculate expected value deterministically, but I need exactly one valid signed American price, exactly one estimated win probability, and at most one cash amount risked. Bonus bets, free bets, “to win” amounts, and unit-based stakes require separate handling.",
  };
}

function americanOddsLabel(odds: number): string {
  return `${odds >= 0 ? "+" : ""}${odds}`;
}

function signedMoney(value: number): string {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;
}

function signedPercentage(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function impliedProbabilityFormula(odds: number): string {
  const magnitude = Math.abs(odds);
  return odds < 0
    ? `${magnitude} ÷ (${magnitude} + 100)`
    : `100 ÷ (${magnitude} + 100)`;
}

function renderImpliedProbability(
  odds: number,
  hypothetical: boolean
): DimeEducationalMathResult {
  const probability = americanToImpliedProbability(odds);
  const percentage = probability * 100;
  const prefix = hypothetical ? "Hypothetical example: " : "";

  return {
    version: DIME_EDUCATIONAL_MATH_VERSION,
    kind: "american_odds_implied_probability",
    answer: `${prefix}At American odds ${americanOddsLabel(odds)}, the implied break-even probability is ${percentage.toFixed(2)}%.

Calculation: ${impliedProbabilityFormula(odds)} = ${probability.toFixed(4)} = ${percentage.toFixed(2)}%.

This is the mathematical break-even point before other costs, not a guarantee of the outcome.`,
  };
}

function renderExpectedValue(
  odds: number,
  probability: number,
  stake: number
): DimeEducationalMathResult {
  const probabilityPercentage = probability * 100;
  const lossProbability = 1 - probability;
  const winProfit = stake * (odds < 0 ? 100 / Math.abs(odds) : odds / 100);
  const evPerDollar =
    probability * (odds < 0 ? 100 / Math.abs(odds) : odds / 100) -
    lossProbability;
  const expectedProfit = evPerDollar * stake;
  const roiPercentage = evPerDollar * 100;
  const breakEvenPercentage = americanToImpliedProbability(odds) * 100;
  const edgePercentagePoints = probabilityPercentage - breakEvenPercentage;

  return {
    version: DIME_EDUCATIONAL_MATH_VERSION,
    kind: "american_odds_expected_value",
    answer: `At ${americanOddsLabel(odds)} with a ${probabilityPercentage.toFixed(2)}% estimated win probability and $${stake.toFixed(2)} risked:

- Win profit: $${winProfit.toFixed(2)}
- Loss if the wager loses: -$${stake.toFixed(2)}
- Expected value: (${probabilityPercentage.toFixed(2)}% × $${winProfit.toFixed(2)}) − (${(lossProbability * 100).toFixed(2)}% × $${stake.toFixed(2)}) = ${signedMoney(expectedProfit)}
- Expected ROI: ${signedPercentage(roiPercentage)}
- Break-even probability: ${breakEvenPercentage.toFixed(2)}%
- Probability edge: ${edgePercentagePoints >= 0 ? "+" : ""}${edgePercentagePoints.toFixed(2)} percentage points

The expected value is ${signedMoney(expectedProfit)} per $${stake.toFixed(2)} risked. The probability-edge figure is not dollar EV. This is a mathematical estimate, not a guarantee.`,
  };
}

export function resolveDimeEducationalMath(
  query: string
): DimeEducationalMathResult | undefined {
  if (!hasDimeEducationalMathIntent(query)) return undefined;
  const oddsCandidates = parseAmericanOdds(query);

  if (EXPECTED_VALUE_INTENT.test(query)) {
    const probabilityCandidates = parseProbabilities(query);
    const cashAmounts = parseCashAmounts(query);
    if (
      oddsCandidates.length !== 1 ||
      probabilityCandidates.length !== 1 ||
      cashAmounts.length > 1 ||
      (hasCashAmountSyntax(query) && cashAmounts.length !== 1) ||
      hasUnsupportedStakeSemantics(query)
    ) {
      return inputRequired("ev");
    }
    return renderExpectedValue(
      oddsCandidates[0],
      probabilityCandidates[0],
      cashAmounts[0] ?? 100
    );
  }

  if (!IMPLIED_PROBABILITY_INTENT.test(query)) return undefined;
  if (oddsCandidates.length === 1) {
    return renderImpliedProbability(oddsCandidates[0], false);
  }
  if (
    oddsCandidates.length === 0 &&
    !/[+-]\d{2,6}/.test(query) &&
    /\b(?:explain|example|hypothetical)\b/i.test(query)
  ) {
    return renderImpliedProbability(-150, true);
  }
  return inputRequired("implied");
}
