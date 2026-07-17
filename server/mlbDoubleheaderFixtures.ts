/**
 * mlbDoubleheaderFixtures.ts — Deterministic fixtures for the 2026-07-17
 * TB@BOS split-doubleheader incident and generalized doubleheader testing.
 *
 * PROVENANCE / HONESTY NOTE
 * ─────────────────────────
 * Live capture of the authoritative statsapi.mlb.com payload was BLOCKED in
 * the remediation environment (network policy denies statsapi.mlb.com,
 * mlb.com, espn.com). Schedule facts below (split day-night doubleheader on
 * 2026-07-17 at Fenway Park: Game 1 1:35 PM ET — makeup of the May 9
 * rainout — and Game 2 7:10 PM ET) are corroborated by public reporting
 * (boston.com 2026-05-09, si.com, stubhub event listings).
 *
 * The gamePk values here are SYNTHETIC (9xxxxx range) and are deliberately
 * NOT real MLB identifiers. Payload SHAPE mirrors the statsapi schedule
 * endpoint exactly (officialDate, gameDate, doubleHeader "S", gameNumber,
 * seriesGameNumber, dayNight, rescheduledFrom, status). Fixture-based
 * verification must never be described as live verification.
 */

import type { MlbProviderGame } from "./mlbEventIdentity";
import type { DbGameRow } from "./mlbEventIdentity";

// Real statsapi team ids per shared/mlbTeams.ts registry: TB=139, BOS=111.
export const TB_TEAM_ID = 139;
export const BOS_TEAM_ID = 111;

/** SYNTHETIC gamePk for Game 1 (1:35 PM ET makeup of 2026-05-09). */
export const G1_GAMEPK = 900101;
/** SYNTHETIC gamePk for Game 2 (7:10 PM ET, originally scheduled). */
export const G2_GAMEPK = 900102;
/** SYNTHETIC gamePk for a control single game the same day (NYY@DET 6:40 PM ET). */
export const SINGLE_GAMEPK = 900201;

/** 1:35 PM EDT == 17:35 UTC on 2026-07-17. */
export const G1_START_UTC = "2026-07-17T17:35:00Z";
/** 7:10 PM EDT == 23:10 UTC on 2026-07-17. */
export const G2_START_UTC = "2026-07-17T23:10:00Z";

/** Normalized provider event for Game 1 of the split doubleheader. */
export function raysRedSoxGame1(overrides: Partial<MlbProviderGame> = {}): MlbProviderGame {
  return {
    gamePk: G1_GAMEPK,
    officialDate: "2026-07-17",
    startUtc: G1_START_UTC,
    awayAbbrev: "TB",
    homeAbbrev: "BOS",
    doubleHeader: "S",
    gameNumber: 1,
    seriesGameNumber: 1,
    dayNight: "day",
    abstractGameState: "Preview",
    detailedState: "Scheduled",
    rescheduledFrom: "2026-05-09",
    venueName: "Fenway Park",
    ...overrides,
  };
}

/** Normalized provider event for Game 2 of the split doubleheader. */
export function raysRedSoxGame2(overrides: Partial<MlbProviderGame> = {}): MlbProviderGame {
  return {
    gamePk: G2_GAMEPK,
    officialDate: "2026-07-17",
    startUtc: G2_START_UTC,
    awayAbbrev: "TB",
    homeAbbrev: "BOS",
    doubleHeader: "S",
    gameNumber: 2,
    seriesGameNumber: 2,
    dayNight: "night",
    abstractGameState: "Preview",
    detailedState: "Scheduled",
    venueName: "Fenway Park",
    ...overrides,
  };
}

/** Control: a normal single game on the same slate. */
export function controlSingleGame(overrides: Partial<MlbProviderGame> = {}): MlbProviderGame {
  return {
    gamePk: SINGLE_GAMEPK,
    officialDate: "2026-07-17",
    startUtc: "2026-07-17T22:40:00Z",
    awayAbbrev: "NYY",
    homeAbbrev: "DET",
    doubleHeader: "N",
    gameNumber: 1,
    seriesGameNumber: 1,
    dayNight: "night",
    abstractGameState: "Preview",
    detailedState: "Scheduled",
    venueName: "Comerica Park",
    ...overrides,
  };
}

/** Full incident slate as the provider returns it (chronological). */
export function incidentSlate(): MlbProviderGame[] {
  return [raysRedSoxGame1(), controlSingleGame(), raysRedSoxGame2()];
}

/**
 * Pre-incident DB state: the season pre-seed created ONLY the originally
 * scheduled 7:10 PM game for 2026-07-17 (the May 9 makeup did not exist when
 * the season was seeded). This row is what production had when the feed
 * showed a single TB@BOS card.
 *
 * `mlbGamePk: null` mirrors the legacy seed rows that predate identity
 * stamping; a variant with the pk populated is provided for both eras.
 */
export function preSeededEveningRow(overrides: Partial<DbGameRow> = {}): DbGameRow {
  return {
    id: 7101,
    gameDate: "2026-07-17",
    startTimeEst: "7:10 PM",
    awayTeam: "TB",
    homeTeam: "BOS",
    sport: "MLB",
    mlbGamePk: null,
    gameNumber: 1,
    doubleHeader: "N",
    gameStatus: "upcoming",
    ...overrides,
  };
}

/** Same evening row but already stamped with its provider identity. */
export function preSeededEveningRowWithPk(overrides: Partial<DbGameRow> = {}): DbGameRow {
  return preSeededEveningRow({ mlbGamePk: G2_GAMEPK, ...overrides });
}

/** The postponed original May 9 row (kept forever; never deleted by sync). */
export function postponedMay9Row(overrides: Partial<DbGameRow> = {}): DbGameRow {
  return {
    id: 5091,
    gameDate: "2026-05-09",
    startTimeEst: "4:10 PM",
    awayTeam: "TB",
    homeTeam: "BOS",
    sport: "MLB",
    mlbGamePk: 900100, // SYNTHETIC pk of the postponed original event
    gameNumber: 1,
    doubleHeader: "N",
    gameStatus: "postponed",
    ...overrides,
  };
}

// ─── Seeded pseudo-random generator for property-style tests ─────────────────
// (fast-check is not a repo dependency; this keeps generated tests deterministic.)

/** Mulberry32 PRNG — deterministic across platforms for a given seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GEN_TEAMS = ["TB", "BOS", "NYY", "DET", "LAD", "SF", "CHC", "CLE", "HOU", "BAL"] as const;

export interface GeneratedSlateCase {
  seed: number;
  slate: MlbProviderGame[];
  /** Distinct gamePks in the slate (the invariant target N). */
  distinctPks: number[];
}

/**
 * Generate a randomized-but-deterministic slate containing single games and
 * doubleheaders with varied team order, dates (incl. DST boundaries and games
 * crossing UTC midnight), start times, provider flags (sometimes missing or
 * wrong), gameNumbers (sometimes missing/duplicated), and payload order.
 */
export function generateSlateCase(seed: number): GeneratedSlateCase {
  const rnd = mulberry32(seed);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
  const dates = [
    "2026-07-17",
    "2026-04-05",        // near spring DST context
    "2026-11-01",        // fall-back DST boundary (2 AM repeats in America/New_York)
    "2026-03-08",        // spring-forward DST boundary
    "2026-06-30",
  ];
  const slate: MlbProviderGame[] = [];
  let nextPk = 910000 + Math.floor(rnd() * 1000) * 10;
  const nGroups = 1 + Math.floor(rnd() * 4);
  for (let i = 0; i < nGroups; i++) {
    const away = pick(GEN_TEAMS);
    let home = pick(GEN_TEAMS);
    while (home === away) home = pick(GEN_TEAMS);
    const officialDate = pick(dates);
    const isDh = rnd() < 0.5;
    const count = isDh ? 2 : 1;
    // Late games can cross UTC midnight (e.g. 10:10 PM ET = 02:10 UTC next day)
    const hoursUtc = isDh ? [17, 23] : [rnd() < 0.3 ? 26 : 22]; // 26 → 02:00 next UTC day
    for (let gi = 0; gi < count; gi++) {
      const h = hoursUtc[gi] ?? 22;
      const base = new Date(`${officialDate}T00:00:00Z`).getTime();
      const startUtc = new Date(base + h * 3600_000 + Math.floor(rnd() * 50) * 60_000)
        .toISOString().replace(/\.\d{3}Z$/, "Z");
      const flagRoll = rnd();
      const numberRoll = rnd();
      slate.push({
        gamePk: nextPk++,
        officialDate,
        startUtc,
        awayAbbrev: away,
        homeAbbrev: home,
        // flags: sometimes correct, sometimes missing, sometimes wrong ("N" on a DH)
        doubleHeader: !isDh ? "N" : flagRoll < 0.5 ? "S" : flagRoll < 0.7 ? undefined : "N",
        // gameNumbers: sometimes correct, sometimes missing, sometimes duplicated
        gameNumber: !isDh ? 1 : numberRoll < 0.5 ? gi + 1 : numberRoll < 0.75 ? undefined : 1,
        dayNight: rnd() < 0.5 ? (gi === 0 ? "day" : "night") : undefined,
        abstractGameState: rnd() < 0.85 ? "Preview" : "Final",
        detailedState: rnd() < 0.9 ? "Scheduled" : "Postponed",
        ...(isDh && gi === 0 && rnd() < 0.4 ? { rescheduledFrom: "2026-05-09" } : {}),
      });
    }
  }
  // Shuffle payload order deterministically (provider order must not matter)
  for (let i = slate.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [slate[i], slate[j]] = [slate[j], slate[i]];
  }
  return { seed, slate, distinctPks: [...new Set(slate.map(g => g.gamePk))] };
}
