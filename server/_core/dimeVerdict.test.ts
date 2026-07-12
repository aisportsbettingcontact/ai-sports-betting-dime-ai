import { describe, expect, it } from "vitest";
import {
  americanToImpliedProbability,
  expectedValue,
  probabilityToAmericanOdds,
  validateDimeResponseText,
  validateDimeStructuredVerdict,
} from "./dimeVerdict";

const now = new Date("2026-07-12T12:00:00.000Z");

function validMoneyline() {
  return {
    schema_version: "1",
    market_type: "moneyline",
    verdict: "edge_detected",
    event_id: "mlb-123",
    sport: "MLB",
    league: "MLB",
    event_start_time: "2026-07-12T23:00:00.000Z",
    selection: "NYY",
    sportsbook: "DraftKings",
    current_odds: 120,
    odds_format: "american",
    odds_observed_at: "2026-07-12T11:55:00.000Z",
    model_id: "dime-mlb",
    model_version: "v1",
    projection_observed_at: "2026-07-12T11:50:00.000Z",
    model_probability: 0.52,
    no_vig_market_probability: 0.46,
    probability_edge: 0.06,
    confidence: "medium",
    data_quality: "platform_verified",
    source_ids: ["games:123", "odds:456", "projection:789"],
    missing_data_fields: [],
    calculation_provenance: ["input"],
  } as const;
}

describe("Dime structured verdict validation", () => {
  it("parses and deterministically corrects a valid moneyline edge", () => {
    const result = validateDimeStructuredVerdict(validMoneyline(), now);
    expect(result.ok).toBe(true);
    expect(result.corrected?.fair_odds).toBe(probabilityToAmericanOdds(0.52));
    expect(result.corrected?.expected_value).toBe(expectedValue(0.52, 120));
  });

  it("rejects edge_detected without current price", () => {
    const verdict = validMoneyline();
    const { current_odds: _drop, ...withoutPrice } = verdict;
    const result = validateDimeStructuredVerdict(withoutPrice, now);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("edge_detected_missing_current_odds");
  });

  it("rejects edge_detected without model version", () => {
    const verdict = validMoneyline();
    const { model_version: _drop, ...withoutModelVersion } = verdict;
    const result = validateDimeStructuredVerdict(withoutModelVersion, now);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("edge_detected_missing_model_version");
  });

  it("rejects stale odds for confirmed edges", () => {
    const result = validateDimeStructuredVerdict({ ...validMoneyline(), odds_observed_at: "2026-07-12T11:00:00.000Z" }, now);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("edge_detected_stale_odds");
  });

  it("rejects generated arithmetic outside tolerance", () => {
    const result = validateDimeStructuredVerdict({ ...validMoneyline(), probability_edge: 0.25 }, now);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("probability_edge_mismatch");
  });

  it("allows need_more_data only when missing fields are explicit", () => {
    const result = validateDimeStructuredVerdict({
      schema_version: "1",
      market_type: "total",
      verdict: "need_more_data",
      selection: "over",
      data_quality: "missing",
      missing_data_fields: ["current_odds", "model_version"],
    }, now);
    expect(result.ok).toBe(true);
  });

  it("blocks legacy edge text without a valid structured verdict", () => {
    const result = validateDimeResponseText("[EDGE] verdict=edge_detected market=ML model_line=x market_line=y [/EDGE]", now);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("edge_claim_without_valid_structured_verdict");
  });

  it("validates a structured verdict embedded in a response", () => {
    const result = validateDimeResponseText(`Verdict below\n\n\`\`\`json\n${JSON.stringify(validMoneyline())}\n\`\`\``, now);
    expect(result.ok).toBe(true);
  });

  it("computes American implied probabilities", () => {
    expect(americanToImpliedProbability(-150)).toBeCloseTo(0.6, 6);
    expect(americanToImpliedProbability(120)).toBeCloseTo(0.454545, 6);
  });
});
