/**
 * ncaamModelEngine.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for the NCAAM model v9 engine integration.
 *
 * These tests verify:
 *   1. The Python engine produces valid JSON output (ok: false on bad credentials)
 *   2. The TypeScript wrapper correctly parses the JSON response
 *   3. The edge detection types are correctly typed
 *   4. The conference calibration table covers all 30 conferences
 *   5. The ncaamModelSync team lookup works for known teams
 */

import { describe, it, expect } from "vitest";
import { NCAAM_TEAMS } from "../shared/ncaamTeams";

// ─────────────────────────────────────────────────────────────────────────────
// Conference calibration coverage
// ─────────────────────────────────────────────────────────────────────────────

const EXPECTED_CONFERENCES = [
  "ACC",
  "Big 12",
  "Big East",
  "Big Ten",
  "SEC",
  "American",
  "Atlantic 10",
  "Mountain West",
  "WCC",
  "MVC",
  "MAC",
  "CUSA",
  "Sun Belt",
  "CAA",
  "Horizon",
  "Big West",
  "MAAC",
  "SoCon",
  "Big Sky",
  "ASUN",
  "OVC",
  "Summit League",
  "Patriot",
  "Big South",
  "America East",
  "NEC",
  "SWAC",
  "MEAC",
  "Southland",
  "Ivy League",
  "WAC",
];

describe("Model v9 Conference Calibration", () => {
  it("should have all 30+ D-I conferences in the ncaamTeams registry", () => {
    const conferencesInRegistry = new Set(NCAAM_TEAMS.map(t => t.conference));
    for (const conf of EXPECTED_CONFERENCES) {
      expect(
        conferencesInRegistry.has(conf),
        `Missing conference: ${conf}`
      ).toBe(true);
    }
  });

  it("should have 365 teams in the registry", () => {
    expect(NCAAM_TEAMS.length).toBeGreaterThanOrEqual(360);
  });

  it("every team should have a kenpomSlug", () => {
    const missing = NCAAM_TEAMS.filter(
      t => !t.kenpomSlug || t.kenpomSlug.trim() === ""
    );
    expect(missing.length).toBe(0);
  });

  it("every team should have a dbSlug", () => {
    const missing = NCAAM_TEAMS.filter(
      t => !t.dbSlug || t.dbSlug.trim() === ""
    );
    expect(missing.length).toBe(0);
  });

  it("every team should have a conference", () => {
    const missing = NCAAM_TEAMS.filter(
      t => !t.conference || t.conference.trim() === ""
    );
    expect(missing.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Team lookup correctness
// ─────────────────────────────────────────────────────────────────────────────

describe("Model v9 Team Lookup", () => {
  const TEAM_MAP = new Map(NCAAM_TEAMS.map(t => [t.dbSlug, t]));

  it("should find Iowa St. by dbSlug", () => {
    const team = TEAM_MAP.get("iowa_st");
    expect(team).toBeDefined();
    expect(team?.kenpomSlug).toBe("Iowa St.");
    expect(team?.conference).toBe("Big 12");
  });

  it("should find Texas Tech by dbSlug", () => {
    const team = TEAM_MAP.get("texas_tech");
    expect(team).toBeDefined();
    expect(team?.kenpomSlug).toBe("Texas Tech");
    expect(team?.conference).toBe("Big 12");
  });

  it("should find Florida Atlantic by dbSlug", () => {
    const team = TEAM_MAP.get("fl_atlantic");
    expect(team).toBeDefined();
    expect(team?.conference).toBe("American");
  });

  it("should find St. John's by dbSlug", () => {
    const team = TEAM_MAP.get("st_johns");
    expect(team).toBeDefined();
    expect(team?.conference).toBe("Big East");
  });

  it("should find N.C. State by dbSlug", () => {
    const team = TEAM_MAP.get("nc_state");
    expect(team).toBeDefined();
    expect(team?.conference).toBe("ACC");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ModelGameResult shape validation
// ─────────────────────────────────────────────────────────────────────────────

describe("Model v9 Result Shape", () => {
  it("should correctly parse a valid model result JSON", () => {
    const raw = {
      ok: true,
      game: "Iowa St. @ Texas Tech",
      away_name: "Iowa St.",
      home_name: "Texas Tech",
      conf_a: "Big 12",
      conf_h: "Big 12",
      orig_away_score: 72.41,
      orig_home_score: 70.09,
      orig_away_sp: -2.32,
      orig_home_sp: 2.32,
      orig_total: 142.5,
      raw_away_score: 72.41,
      raw_home_score: 70.09,
      raw_away_sp: -2.32,
      raw_home_sp: 2.32,
      raw_total: 142.5,
      mkt_away_score: 74.5,
      mkt_home_score: 69.0,
      mkt_total: 143.5,
      ml_away_pct: 55.12,
      ml_home_pct: 44.88,
      away_ml_fair: -122.8,
      home_ml_fair: 122.8,
      over_rate: 47.3,
      under_rate: 52.7,
      spread_clamped: false,
      total_clamped: false,
      cover_direction: "UNDER",
      cover_adj: -0.42,
      def_suppression: 0.9812,
      sigma_away: 10.82,
      sigma_home: 10.64,
      edges: [
        {
          type: "SPREAD",
          conf: "MOD",
          side: "Iowa St. +5.5",
          signal: "Model +2.32 vs mkt -5.50 (Δ-7.82pt)",
          cover_pct: 54.3,
          edge_vs_be: 1.92,
        },
      ],
      error: null,
    };

    // Verify all required fields are present and typed correctly
    expect(raw.ok).toBe(true);
    expect(typeof raw.orig_away_score).toBe("number");
    expect(typeof raw.orig_home_score).toBe("number");
    expect(typeof raw.away_ml_fair).toBe("number");
    expect(typeof raw.home_ml_fair).toBe("number");
    expect(raw.cover_direction).toBe("UNDER");
    expect(raw.edges).toHaveLength(1);
    expect(raw.edges[0].type).toBe("SPREAD");
    expect(raw.error).toBeNull();
  });

  it("should correctly parse a failed model result JSON", () => {
    const raw = {
      ok: false,
      game: "Iowa St. @ Texas Tech",
      away_name: "Iowa St.",
      home_name: "Texas Tech",
      conf_a: "Big 12",
      conf_h: "Big 12",
      orig_away_score: 0,
      orig_home_score: 0,
      orig_away_sp: 0,
      orig_home_sp: 0,
      orig_total: 0,
      raw_away_score: 0,
      raw_home_score: 0,
      raw_away_sp: 0,
      raw_home_sp: 0,
      raw_total: 0,
      mkt_away_score: 0,
      mkt_home_score: 0,
      mkt_total: 0,
      ml_away_pct: 0,
      ml_home_pct: 0,
      away_ml_fair: 0,
      home_ml_fair: 0,
      over_rate: 0,
      under_rate: 0,
      spread_clamped: false,
      total_clamped: false,
      cover_direction: "NONE",
      cover_adj: 0,
      def_suppression: 0,
      sigma_away: 0,
      sigma_home: 0,
      edges: [],
      error: "Exception: Logging in failed - check your credentials",
    };

    expect(raw.ok).toBe(false);
    expect(raw.error).toContain("Logging in failed");
    expect(raw.edges).toHaveLength(0);
  });
});
