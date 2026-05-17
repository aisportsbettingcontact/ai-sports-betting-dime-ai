/**
 * mlbKPropsModelService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Computes per-pitcher strikeout probability, model odds, edge, EV, and
 * verdict for all K-Props rows for a given game date.
 *
 * COMPUTATION MODEL (v1 — Poisson K-rate):
 * ─────────────────────────────────────────────────────────────────────────────
 *   Step 1: Pitcher K9 (season stats blended with rolling-5 recent form)
 *     pitcher_k9 = 0.70 * season_k9 + 0.30 * rolling5_k9
 *     [fallback: LEAGUE_K9 = 8.5 if no stats]
 *
 *   Step 2: xFIP quality adjustment
 *     xfip_adj = LEAGUE_XFIP / pitcher_xfip
 *     [clamped to 0.70–1.40]
 *
 *   Step 3: Opponent K-rate adjustment (vs pitcher hand)
 *     opp_k9 = team_batting_splits.k9 (vs pitcher hand)
 *     opp_adj = opp_k9 / LEAGUE_OPP_K9
 *     [clamped to 0.70–1.40]
 *
 *   Step 4: Expected innings pitched
 *     ip_expected = bookLine / pitcher_k9 * 9
 *     [clamped to 3.0–7.0 innings]
 *
 *   Step 5: Poisson lambda
 *     lambda = pitcher_k9 * xfip_adj * opp_adj * ip_expected / 9
 *
 *   Step 6: P(Ks > bookLine) using Poisson CDF
 *     p_over = 1 - Poisson_CDF(floor(bookLine), lambda)
 *     [clamped to 3%–85%]
 *
 *   Step 7: Edge and EV
 *     edge = p_over - anNoVigOverPct
 *     ev   = edge * 100  (on $100 bet)
 *     verdict = "OVER" if edge >= EDGE_THRESHOLD, else "PASS"
 *
 * Book source: Consensus (Action Network book_id=15)
 *   anNoVigOverPct = consensus no-vig implied probability for OVER
 *
 * [INPUT]  gameDate: string (YYYY-MM-DD)
 * [OUTPUT] KPropsModelResult
 */

import * as dotenv from "dotenv";
dotenv.config();

import { getDb } from "./db";
import {
  mlbStrikeoutProps,
  mlbPitcherStats,
  mlbPitcherRolling5,
  mlbTeamBattingSplits,
  games,
  mlbLineups,
} from "../drizzle/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getMlbamIdMap, normalizeMlbamName } from "./mlbamIdCache";

const TAG = "[KPropsModel]";

// ─── League-average constants (2025 MLB) ─────────────────────────────────────
const LEAGUE_K9       = 8.5;    // League-average K/9 for starters
const LEAGUE_XFIP     = 4.10;   // League-average xFIP
const LEAGUE_OPP_K9   = 8.2;    // League-average team K/9 vs RHP (baseline)
const EDGE_THRESHOLD  = 0.040;  // Minimum edge to emit UNDER verdict
// ─── Direction-split edge thresholds (empirical, 288-game backtest 2026) ──────
// OVER at line>=6.5 has 33.3% win rate — model over-projects for elite pitchers.
// Fix: gate OVER verdicts to lines <= 5.5 AND require higher edge (0.15).
// UNDER has consistent 60.7% accuracy across all edge buckets >= 0.05.
const EDGE_THRESHOLD_OVER = 0.150;  // Raised from 0.040 — filters low-confidence OVER bets
const EDGE_THRESHOLD_UNDER = 0.040; // Unchanged — UNDER is profitable at all edge levels
const MAX_OVER_LINE = 5.5;          // Gate: no OVER bets on lines > 5.5 (33.3% win rate at 6.5+)
const MIN_P_OVER      = 0.03;
const MAX_P_OVER      = 0.85;
const MIN_XFIP_ADJ    = 0.70;
const MAX_XFIP_ADJ    = 1.40;
const MIN_OPP_ADJ     = 0.70;
const MAX_OPP_ADJ     = 1.40;
const MIN_IP          = 3.0;
const MAX_IP          = 7.0;
// ─── Direction-split calibration factors (empirical, 288-game backtest 2026) ──
// OVER bias: model over-projects at high lines (6.5+) → use stronger factor
// UNDER bias: model over-projects by +0.507 Ks → standard factor
// P5 recalibration: 2026 backtest (n=693) showed Bias=-0.521 Ks/start (model UNDER-projects).
// MAE=2.023, RMSE=2.570. Negative bias means lambdaRaw is too low → increase factors.
// Old OVER=0.800, UNDER=0.739. Correction: +0.521/5.1 ≈ +0.102 proportionally.
const K_CALIBRATION_FACTOR_OVER  = 0.870;  // P5: 0.800 → 0.870 (+0.070) to correct -0.52 under-projection
const K_CALIBRATION_FACTOR_UNDER = 0.810;  // P5: 0.739 → 0.810 (+0.071) to correct -0.52 under-projection
// Legacy alias (used in kProj display)
const K_CALIBRATION_FACTOR = K_CALIBRATION_FACTOR_UNDER;
const EMPIRICAL_IP_PER_START = 5.1;   // 2025 MLB starter avg IP/start
// ─── P4-B: Platoon composition constants (2025 MLB empirical) ─────────────────
// LHP vs RHH platoon advantage: LHP K% is ~8% higher vs RHH than vs LHH
// RHP vs LHH platoon advantage: RHP K% is ~5% higher vs LHH than vs RHH
// Source: 2024-2025 Statcast platoon splits (FanGraphs)
const PLATOON_LHP_VS_RHH_BOOST = 1.08;   // LHP gets +8% K-rate vs RHH-heavy lineup
const PLATOON_LHP_VS_LHH_PENALTY = 0.94; // LHP gets -6% K-rate vs LHH-heavy lineup
const PLATOON_RHP_VS_LHH_BOOST = 1.05;   // RHP gets +5% K-rate vs LHH-heavy lineup
const PLATOON_RHP_VS_RHH_PENALTY = 0.97; // RHP gets -3% K-rate vs RHH-heavy lineup
const PLATOON_NEUTRAL_THRESHOLD = 0.60;  // >= 60% same-hand batters = "heavy" composition
const MIN_PLATOON_ADJ = 0.88;
const MAX_PLATOON_ADJ = 1.15;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KPropsModelResult {
  date: string;
  modeled: number;
  edges: number;
  errors: number;
  skipped: number;
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

/**
 * Poisson PMF: P(X = k) = e^(-lambda) * lambda^k / k!
 */
function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

/**
 * Poisson CDF: P(X <= k) = sum_{i=0}^{k} P(X = i)
 */
function poissonCdf(k: number, lambda: number): number {
  let cdf = 0;
  for (let i = 0; i <= k; i++) cdf += poissonPmf(i, lambda);
  return Math.min(cdf, 1.0);
}

/**
 * P(X > threshold) for a Poisson distribution.
 * For half-lines (e.g. 4.5), threshold = floor(4.5) = 4, so P(X > 4) = P(X >= 5)
 */
function poissonPOver(bookLine: number, lambda: number): number {
  const threshold = Math.floor(bookLine); // e.g. 4.5 → 4, 5.0 → 5
  return 1 - poissonCdf(threshold, lambda);
}

/**
 * Convert probability to American odds.
 */
function probToAmericanOdds(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  if (p >= 0.5) return Math.round(-(p / (1 - p)) * 100);
  return Math.round(((1 - p) / p) * 100);
}

/**
 * Clamp a value to [min, max].
 */
function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// ─── P4-B: Platoon composition adjustment helper ──────────────────────────────
/**
 * computePlatoonAdj: Compute K-rate multiplier based on pitcher hand vs lineup
 * batting hand composition.
 *
 * Logic:
 * - Parse lineup JSON to count R/L/S batters (switch-hitters = 0.5R + 0.5L)
 * - LHP vs RHH-heavy (>=60% RHH): +8% K-rate boost
 * - LHP vs LHH-heavy (>=60% LHH): -6% K-rate penalty
 * - RHP vs LHH-heavy (>=60% LHH): +5% K-rate boost
 * - RHP vs RHH-heavy (>=60% RHH): -3% K-rate penalty
 * - Otherwise: neutral (1.0)
 *
 * @param lineupJson  JSON string from mlbLineups.awayLineup / homeLineup
 * @param pitcherHand 'L' | 'R'
 * @param confirmed   true if lineup is confirmed
 * @param tag         Logging tag
 * @returns Platoon adjustment multiplier (clamped to [0.88, 1.15])
 */
function computePlatoonAdj(
  lineupJson: string | null | undefined,
  pitcherHand: string,
  confirmed: boolean | null | undefined,
  tag: string,
): number {
  if (!confirmed || !lineupJson) {
    console.log(`${tag} [P4-B] No confirmed lineup — platoon adj = 1.0`);
    return 1.0;
  }
  let lineup: Array<{ bats?: string }> = [];
  try {
    lineup = JSON.parse(lineupJson);
  } catch {
    console.log(`${tag} [P4-B] JSON parse error — platoon adj = 1.0`);
    return 1.0;
  }
  if (!Array.isArray(lineup) || lineup.length < 7) {
    console.log(`${tag} [P4-B] Lineup < 7 players — platoon adj = 1.0`);
    return 1.0;
  }
  // Count R/L/S batters (switch-hitters count as 0.5 R + 0.5 L)
  let rCount = 0, lCount = 0;
  for (const player of lineup.slice(0, 9)) {
    const bats = (player.bats ?? 'R').toUpperCase();
    if (bats === 'R') { rCount += 1; }
    else if (bats === 'L') { lCount += 1; }
    else if (bats === 'S') { rCount += 0.5; lCount += 0.5; }
    else { rCount += 1; }
  }
  const total = rCount + lCount;
  if (total === 0) return 1.0;
  const rPct = rCount / total;
  const lPct = lCount / total;
  const hand = pitcherHand.toUpperCase();
  let adj = 1.0;
  let reason = 'neutral';

  if (hand === 'L') {
    if (rPct >= PLATOON_NEUTRAL_THRESHOLD) {
      adj = PLATOON_LHP_VS_RHH_BOOST;
      reason = `LHP vs RHH-heavy (${(rPct * 100).toFixed(0)}% RHH) +${((adj - 1) * 100).toFixed(0)}%`;
    } else if (lPct >= PLATOON_NEUTRAL_THRESHOLD) {
      adj = PLATOON_LHP_VS_LHH_PENALTY;
      reason = `LHP vs LHH-heavy (${(lPct * 100).toFixed(0)}% LHH) ${((adj - 1) * 100).toFixed(0)}%`;
    }
  } else {
    if (lPct >= PLATOON_NEUTRAL_THRESHOLD) {
      adj = PLATOON_RHP_VS_LHH_BOOST;
      reason = `RHP vs LHH-heavy (${(lPct * 100).toFixed(0)}% LHH) +${((adj - 1) * 100).toFixed(0)}%`;
    } else if (rPct >= PLATOON_NEUTRAL_THRESHOLD) {
      adj = PLATOON_RHP_VS_RHH_PENALTY;
      reason = `RHP vs RHH-heavy (${(rPct * 100).toFixed(0)}% RHH) ${((adj - 1) * 100).toFixed(0)}%`;
    }
  }

  const clamped = Math.min(Math.max(adj, MIN_PLATOON_ADJ), MAX_PLATOON_ADJ);
  console.log(
    `${tag} [P4-B] Platoon: pitcher=${hand} R=${rCount.toFixed(1)} L=${lCount.toFixed(1)} ` +
    `(${(rPct * 100).toFixed(0)}%R/${(lPct * 100).toFixed(0)}%L) ${reason} adj=${clamped.toFixed(4)}`
  );
  return clamped;
}


// ─── Name normalization ───────────────────────────────────────────────────────

// normalizeName delegated to shared mlbamIdCache (6h TTL, no duplicate API calls)
const normalizeName = normalizeMlbamName;
const fetchMlbamIdMap = getMlbamIdMap;

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Compute K-Props model EV for all pitchers on a given game date.
 * Updates mlb_strikeout_props rows with:
 *   kProj, pOver, pUnder, modelOverOdds, modelUnderOdds,
 *   edgeOver, edgeUnder, verdict, bestEdge, bestSide, bestMlStr, modelRunAt
 */
export async function modelKPropsForDate(gameDate: string): Promise<KPropsModelResult> {
  console.log(`\n${TAG} ============================================================`);
  console.log(`${TAG} [INPUT] date=${gameDate} model=v1-poisson`);
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let modeled = 0, edges = 0, errors = 0, skipped = 0;

  // ── Step 1: Load all K-Props rows for this date ──────────────────────────
  const kPropsRows = await db
    .select({
      id: mlbStrikeoutProps.id,
      gameId: mlbStrikeoutProps.gameId,
      side: mlbStrikeoutProps.side,
      pitcherName: mlbStrikeoutProps.pitcherName,
      bookLine: mlbStrikeoutProps.bookLine,
      anNoVigOverPct: mlbStrikeoutProps.anNoVigOverPct,
      awayTeam: games.awayTeam,
      homeTeam: games.homeTeam,
      // P4-B: Lineup data for platoon composition adjustment (from mlbLineups)
      awayLineup: mlbLineups.awayLineup,
      homeLineup: mlbLineups.homeLineup,
      awayLineupConfirmed: mlbLineups.awayLineupConfirmed,
      homeLineupConfirmed: mlbLineups.homeLineupConfirmed,
    })
    .from(mlbStrikeoutProps)
    .innerJoin(games, eq(mlbStrikeoutProps.gameId, games.id))
    .leftJoin(mlbLineups, eq(mlbStrikeoutProps.gameId, mlbLineups.gameId))
    .where(eq(games.gameDate, gameDate));

  console.log(`${TAG} [STATE] Found ${kPropsRows.length} K-Props rows for ${gameDate}`);

  if (kPropsRows.length === 0) {
    console.log(`${TAG} [WARN] No K-Props rows found — run upsertKPropsFromAN first`);
    return { date: gameDate, modeled: 0, edges: 0, errors: 0, skipped: 0 };
  }

  // ── Step 2: Load pitcher season stats ────────────────────────────────────
  const pitcherNames = (kPropsRows as Array<{ pitcherName: string }>).map((r) => r.pitcherName);
  const pitcherStatsRows = await db
    .select({
      fullName:    mlbPitcherStats.fullName,
      k9:          mlbPitcherStats.k9,
      xfip:        mlbPitcherStats.xfip,
      fip:         mlbPitcherStats.fip,
      throwsHand:  mlbPitcherStats.throwsHand,
      // P2-A: IP fallback fields
      ipMean3yr:   mlbPitcherStats.ipMean3yr,     // 3yr mean IP/start (most reliable)
      ip:          mlbPitcherStats.ip,            // season total IP
      gamesStarted: mlbPitcherStats.gamesStarted, // season GS (for ip/gs calc)
    })
    .from(mlbPitcherStats);

  // Build name → stats map (normalized)
  const pitcherStatsByName = new Map<string, {
    k9: number | null;
    xfip: number | null;
    fip: number | null;
    throwsHand: string | null;
    // P2-A: IP fallback fields
    ipMean3yr: number | null;    // 3yr mean IP/start (most reliable)
    ip: number | null;           // season total IP
    gamesStarted: number | null; // season GS
  }>();
  for (const row of pitcherStatsRows) {
    pitcherStatsByName.set(normalizeName(row.fullName), {
      k9:          row.k9,
      xfip:        row.xfip,
      fip:         row.fip,
      throwsHand:  row.throwsHand,
      ipMean3yr:   row.ipMean3yr   != null ? Number(row.ipMean3yr)   : null,
      ip:          row.ip          != null ? Number(row.ip)          : null,
      gamesStarted: row.gamesStarted != null ? Number(row.gamesStarted) : null,
    });
  }

  // ── Step 3: Load pitcher rolling-5 stats ─────────────────────────────────
  const rolling5Rows = await db
    .select({
      fullName: mlbPitcherRolling5.fullName,
      k9_5: mlbPitcherRolling5.k9_5,
      ip5: mlbPitcherRolling5.ip5,
    })
    .from(mlbPitcherRolling5);

  const rolling5ByName = new Map<string, { k9_5: number | null; ip5: number | null }>();
  for (const row of rolling5Rows) {
    rolling5ByName.set(normalizeName(row.fullName), {
      k9_5: row.k9_5,
      ip5: row.ip5,
    });
  }

  // ── Step 4: Load team batting splits ─────────────────────────────────────
  const allTeamsArr: string[] = [];
  for (const r of kPropsRows as Array<{ awayTeam: string; homeTeam: string }>) {
    allTeamsArr.push(r.awayTeam, r.homeTeam);
  }
  const allTeams = Array.from(new Set(allTeamsArr));
  const battingSplitsRows = await db
    .select({
      teamAbbrev: mlbTeamBattingSplits.teamAbbrev,
      hand: mlbTeamBattingSplits.hand,
      k9: mlbTeamBattingSplits.k9,
    })
    .from(mlbTeamBattingSplits)
    .where(inArray(mlbTeamBattingSplits.teamAbbrev, allTeams));

  // Build teamAbbrev:hand → k9 map
  const battingSplitsByTeamHand = new Map<string, number>();
  for (const row of battingSplitsRows) {
    if (row.k9 !== null) {
      battingSplitsByTeamHand.set(`${row.teamAbbrev}:${row.hand}`, row.k9);
    }
  }

  console.log(`${TAG} [STATE] Loaded ${pitcherStatsRows.length} pitcher stats, ${rolling5Rows.length} rolling-5, ${battingSplitsRows.length} batting splits`);

  // ── Step 5: Model each pitcher ────────────────────────────────────────────
  console.log(`${TAG} [STEP] Computing Poisson K-rate model for ${kPropsRows.length} pitchers`);

  for (const row of kPropsRows) {
    const pitcherNameNorm = normalizeName(row.pitcherName);

    // Determine opposing team (pitcher's team is away or home)
    const oppTeam = row.side === "away" ? row.homeTeam : row.awayTeam;

    // Parse book line
    const bookLine = row.bookLine !== null ? parseFloat(row.bookLine) : null;
    if (bookLine === null || isNaN(bookLine)) {
      console.log(`${TAG} [SKIP] ${row.pitcherName}: no bookLine`);
      skipped++;
      continue;
    }

    // Parse AN no-vig probability
    const anNoVig = row.anNoVigOverPct !== null ? parseFloat(row.anNoVigOverPct) : null;
    if (anNoVig === null || isNaN(anNoVig)) {
      console.log(`${TAG} [SKIP] ${row.pitcherName}: no anNoVigOverPct`);
      skipped++;
      continue;
    }

    try {
      // ── Pitcher stats ──────────────────────────────────────────────────
      const stats = pitcherStatsByName.get(pitcherNameNorm);
      const rolling5 = rolling5ByName.get(pitcherNameNorm);

      let seasonK9 = stats?.k9 ?? null;
      let rolling5K9 = rolling5?.k9_5 ?? null;
      const xfip = stats?.xfip ?? null;
      const throwsHand = stats?.throwsHand ?? "R"; // default to RHP if unknown

      // Blend season + rolling-5 (70/30 if both available)
      let pitcherK9: number;
      if (seasonK9 !== null && rolling5K9 !== null) {
        pitcherK9 = 0.70 * seasonK9 + 0.30 * rolling5K9;
      } else if (seasonK9 !== null) {
        pitcherK9 = seasonK9;
      } else if (rolling5K9 !== null) {
        pitcherK9 = rolling5K9;
      } else {
        pitcherK9 = LEAGUE_K9; // fallback
      }

      // ── xFIP adjustment ────────────────────────────────────────────────
      let xfipAdj = 1.0;
      if (xfip !== null && xfip > 0) {
        xfipAdj = clamp(LEAGUE_XFIP / xfip, MIN_XFIP_ADJ, MAX_XFIP_ADJ);
      }

      // ── Opponent K-rate adjustment ─────────────────────────────────────
      // Use opponent team's K/9 vs this pitcher's hand
      const oppK9Key = `${oppTeam}:${throwsHand}`;
      const oppK9 = battingSplitsByTeamHand.get(oppK9Key) ?? LEAGUE_OPP_K9;
      const oppAdj = clamp(oppK9 / LEAGUE_OPP_K9, MIN_OPP_ADJ, MAX_OPP_ADJ);

      // ── P2-A: Expected innings pitched (4-tier priority fallback) ─────────────────────────────────────────────────────
      // Priority 1: ipMean3yr (3yr empirical mean IP/start — most stable, backtest-calibrated)
      // Priority 2: ip / gamesStarted (current season IP per start — reflects current workload)
      // Priority 3: rolling5Ip (last-5 starts IP — most recent form, but high variance)
      // Priority 4: EMPIRICAL_IP_PER_START (2025 league average 5.1 — last resort)
      const rolling5Ip = rolling5?.ip5 ?? null;
      const seasonIpPerStart = (stats?.ip != null && stats?.gamesStarted != null && stats.gamesStarted > 0)
        ? stats.ip / stats.gamesStarted
        : null;
      const ipRaw = stats?.ipMean3yr ?? seasonIpPerStart ?? rolling5Ip ?? EMPIRICAL_IP_PER_START;
      const ipSource = stats?.ipMean3yr != null ? '3yr' : seasonIpPerStart != null ? 'season' : rolling5Ip != null ? 'r5' : 'empirical';
      const ipExpected = clamp(ipRaw, MIN_IP, MAX_IP);
      console.log(
        `[KProps][P2-A][IP] ${row.pitcherName}: ` +
        `ipMean3yr=${stats?.ipMean3yr ?? 'N/A'} ` +
        `seasonIpPerStart=${seasonIpPerStart != null ? seasonIpPerStart.toFixed(2) : 'N/A'} ` +
        `r5Ip=${rolling5Ip ?? 'N/A'} ` +
        `→ used=${ipRaw.toFixed(2)} (source=${ipSource}) clamped=${ipExpected.toFixed(2)}`
      );
      // ── P4-B: Platoon composition adjustment ───────────────────────────
      // Determine which lineup to use: pitcher is on 'away' side → faces home lineup
      // pitcher is on 'home' side → faces away lineup
      const oppLineupJson = row.side === "away" ? row.homeLineup : row.awayLineup;
      const oppLineupConfirmed = row.side === "away" ? row.homeLineupConfirmed : row.awayLineupConfirmed;
      const platoonTag = `[KProps][P4-B][${row.pitcherName}]`;
      const platoonAdj = computePlatoonAdj(oppLineupJson, throwsHand, oppLineupConfirmed, platoonTag);
      // ── Poisson lambda (direction-split calibration) ─────────────────────
      // OVER uses stronger factor (0.800) to correct high-line over-projection.
      // UNDER uses standard factor (0.739) calibrated from full-sample backtest.
      // P4-B: platoonAdj multiplied into lambdaRaw (adjusts K-rate for lineup hand composition)
      const lambdaRaw = pitcherK9 * xfipAdj * oppAdj * platoonAdj * (ipExpected / 9);
      const lambdaOver  = lambdaRaw * K_CALIBRATION_FACTOR_OVER;  // for OVER probability
      const lambdaUnder = lambdaRaw * K_CALIBRATION_FACTOR_UNDER; // for UNDER probability
      // Use lambdaUnder as the display lambda (kProj) since UNDER is the primary signal
      const lambda = lambdaUnder;

      // ── P(Ks > bookLine) ───────────────────────────────────────────────
      const pOver  = clamp(poissonPOver(bookLine, lambdaOver),  MIN_P_OVER, MAX_P_OVER);
      const pUnder = clamp(1 - poissonPOver(bookLine, lambdaUnder), MIN_P_OVER, MAX_P_OVER);

      // ── Model odds ────────────────────────────────────────────────────
      const modelOverOdds  = probToAmericanOdds(pOver);
      const modelUnderOdds = probToAmericanOdds(pUnder);

      // ── Edge and EV ───────────────────────────────────────────────────
      const edgeOver  = parseFloat((pOver  - anNoVig).toFixed(4));
      const edgeUnder = parseFloat((pUnder - (1 - anNoVig)).toFixed(4));

      // ── Verdict (direction-split thresholds + MAX_OVER_LINE gate) ─────
      // OVER: requires edge >= 0.15 AND line <= 5.5 (empirical: line>5.5 has 33% win rate)
      // UNDER: requires edge >= 0.04 (consistent 60.7% accuracy at all edge levels)
      let verdict = "PASS";
      let bestEdge: number | null = null;
      let bestSide: string | null = null;
      let bestMlStr: string | null = null;

      const overGatePass = bookLine <= MAX_OVER_LINE;
      if (edgeOver >= EDGE_THRESHOLD_OVER && overGatePass) {
        verdict = "OVER";
        bestEdge = edgeOver;
        bestSide = "OVER";
        bestMlStr = modelOverOdds > 0 ? `+${modelOverOdds}` : `${modelOverOdds}`;
        edges++;
        console.log(`${TAG} [STATE] OVER gate: bookLine=${bookLine} <= MAX_OVER_LINE=${MAX_OVER_LINE} ✓ edge=${edgeOver.toFixed(4)} >= ${EDGE_THRESHOLD_OVER} ✓`);
      } else if (edgeOver >= EDGE_THRESHOLD_OVER && !overGatePass) {
        // Log filtered OVER bets for monitoring
        console.log(`${TAG} [STATE] OVER FILTERED: bookLine=${bookLine} > MAX_OVER_LINE=${MAX_OVER_LINE} — edge=${edgeOver.toFixed(4)} but line too high`);
      } else if (edgeUnder >= EDGE_THRESHOLD_UNDER) {
        verdict = "UNDER";
        bestEdge = edgeUnder;
        bestSide = "UNDER";
        bestMlStr = modelUnderOdds > 0 ? `+${modelUnderOdds}` : `${modelUnderOdds}`;
        edges++;
      }

      // ── kProj = lambda (expected Ks) ──────────────────────────────────
      const kProj = parseFloat(lambda.toFixed(2));

      // ── Update DB row ─────────────────────────────────────────────────
      await db
        .update(mlbStrikeoutProps)
        .set({
          kProj: kProj.toString(),
          pOver: pOver.toFixed(4),
          pUnder: pUnder.toFixed(4),
          modelOverOdds: modelOverOdds > 0 ? `+${modelOverOdds}` : `${modelOverOdds}`,
          modelUnderOdds: modelUnderOdds > 0 ? `+${modelUnderOdds}` : `${modelUnderOdds}`,
          edgeOver: edgeOver.toFixed(4),
          edgeUnder: edgeUnder.toFixed(4),
          verdict,
          bestEdge: bestEdge !== null ? bestEdge.toFixed(4) : null,
          bestSide,
          bestMlStr,
          modelRunAt: Date.now(),
        })
        .where(eq(mlbStrikeoutProps.id, row.id));

      modeled++;

      // ── Logging ───────────────────────────────────────────────────────
      const statsTag = stats ? `k9=${pitcherK9.toFixed(2)} xfip=${xfip?.toFixed(2) ?? "N/A"}` : `k9=FALLBACK(${LEAGUE_K9})`;
      const edgeStr = edgeOver >= 0 ? `+${edgeOver.toFixed(4)}` : edgeOver.toFixed(4);
      const evStr = (edgeOver * 100).toFixed(1);
      console.log(
        `${TAG} [STATE] ${row.pitcherName} (${row.side}@${oppTeam}) | ${statsTag} | ` +
        `xfipAdj=${xfipAdj.toFixed(3)} oppAdj=${oppAdj.toFixed(3)} platoonAdj=${platoonAdj.toFixed(4)} ` +
        `ip=${ipExpected.toFixed(1)} lambdaRaw=${lambdaRaw.toFixed(3)} lambda=${lambda.toFixed(3)} ` +
        `(calib=${K_CALIBRATION_FACTOR}) | pOver=${pOver.toFixed(4)} anNoVig=${anNoVig.toFixed(4)} ` +
        `edge=${edgeStr} ev=${evStr} | verdict=${verdict}`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${TAG} [ERROR] ${row.pitcherName}: ${msg}`);
      errors++;
    }
  }

  console.log(`\n${TAG} ============================================================`);
  console.log(`${TAG} [OUTPUT] date=${gameDate} modeled=${modeled} edges=${edges} skipped=${skipped} errors=${errors}`);
  console.log(`${TAG} [VERIFY] ${errors === 0 ? "PASS" : "WARN"} — ${errors} total errors`);
  console.log(`${TAG} ============================================================\n`);

  return { date: gameDate, modeled, edges, errors, skipped };
}

// ─── Resolve mlbamId for K-Props rows on a specific date (fast, targeted) ────
/**
 * Resolves MLBAM IDs only for K-Props rows on a given date that are missing
 * their mlbamId. Called automatically after every modelKPropsForDate run.
 * Fetches the MLB Stats API once per call; no-ops if all IDs already present.
 */
export async function resolveKPropsMlbamIdsForDate(gameDate: string): Promise<{
  resolved: number;
  alreadyHad: number;
  unresolved: number;
  errors: number;
}> {
  const RTAG = "[MLBAM_BACKFILL]";
  const db = await getDb();
  if (!db) return { resolved: 0, alreadyHad: 0, unresolved: 0, errors: 1 };

  // Load only rows for this date that are missing mlbamId
  const rows = await db
    .select({ id: mlbStrikeoutProps.id, pitcherName: mlbStrikeoutProps.pitcherName, mlbamId: mlbStrikeoutProps.mlbamId })
    .from(mlbStrikeoutProps)
    .innerJoin(games, eq(mlbStrikeoutProps.gameId, games.id))
    .where(eq(games.gameDate, gameDate));

  type Row = { id: number; pitcherName: string; mlbamId: number | null };
  const allRows = rows as Row[];
  const alreadyHad = allRows.filter(r => r.mlbamId != null).length;
  const needsResolution = allRows.filter(r => r.mlbamId == null);

  console.log(`${RTAG} [INPUT] date=${gameDate} total=${allRows.length} alreadyHad=${alreadyHad} needsResolution=${needsResolution.length}`);

  if (needsResolution.length === 0) {
    console.log(`${RTAG} [VERIFY] PASS — all ${alreadyHad} rows already have mlbamId`);
    return { resolved: 0, alreadyHad, unresolved: 0, errors: 0 };
  }

  const apiMap = await fetchMlbamIdMap();
  if (apiMap.size === 0) {
    console.error(`${RTAG} [ERROR] MLB Stats API returned 0 players — skipping`);
    return { resolved: 0, alreadyHad, unresolved: needsResolution.length, errors: 1 };
  }

  let resolved = 0, unresolved = 0, errors = 0;

  // Deduplicate by name
  const nameToId = new Map<string, number | null>();
  for (const row of needsResolution) {
    const key = normalizeName(row.pitcherName);
    if (!nameToId.has(key)) nameToId.set(key, apiMap.get(key) ?? null);
  }

  for (const row of needsResolution) {
    const key = normalizeName(row.pitcherName);
    const mlbamId = nameToId.get(key) ?? null;
    if (mlbamId != null) {
      try {
        await db.update(mlbStrikeoutProps).set({ mlbamId }).where(eq(mlbStrikeoutProps.id, row.id));
        resolved++;
        console.log(`${RTAG} [OUTPUT] Resolved "${row.pitcherName}" -> mlbamId=${mlbamId}`);
      } catch (err) {
        console.error(`${RTAG} [ERROR] DB update failed for "${row.pitcherName}": ${err instanceof Error ? err.message : String(err)}`);
        errors++;
      }
    } else {
      console.warn(`${RTAG} [WARN] Could not resolve mlbamId for "${row.pitcherName}" (not in MLB Stats API 2025 roster)`);
      unresolved++;
    }
  }

  console.log(`${RTAG} [VERIFY] ${errors === 0 ? "PASS" : "WARN"} — resolved=${resolved} alreadyHad=${alreadyHad} unresolved=${unresolved} errors=${errors}`);
  return { resolved, alreadyHad, unresolved, errors };
}

// ─── MLB Stats API: fetch all active player IDs — delegated to shared mlbamIdCache ─────

// ─── Backfill mlbamId for all K-Props rows missing it ────────────────────────
export async function backfillAllKPropsMlbamIds(): Promise<{
  resolved: number;
  alreadyHad: number;
  unresolved: number;
  errors: number;
}> {
  console.log(`\n${TAG} ============================================================`);
  console.log(`${TAG} [INPUT] backfillAllKPropsMlbamIds`);
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let resolved = 0, alreadyHad = 0, unresolved = 0, errors = 0;

  const allRows = await db
    .select({ id: mlbStrikeoutProps.id, pitcherName: mlbStrikeoutProps.pitcherName, mlbamId: mlbStrikeoutProps.mlbamId })
    .from(mlbStrikeoutProps);

  type KPropsRow = { id: number; pitcherName: string; mlbamId: number | null };
  const needsResolution = (allRows as KPropsRow[]).filter(r => r.mlbamId == null);
  alreadyHad = allRows.length - needsResolution.length;
  console.log(`${TAG} [STATE] Total=${allRows.length} alreadyHad=${alreadyHad} needsResolution=${needsResolution.length}`);

  if (needsResolution.length === 0) {
    return { resolved: 0, alreadyHad, unresolved: 0, errors: 0 };
  }

  const apiMap = await fetchMlbamIdMap();
  if (apiMap.size === 0) {
    return { resolved: 0, alreadyHad, unresolved: needsResolution.length, errors: 1 };
  }

  // Deduplicate by name to minimize API calls
  const nameToId = new Map<string, number | null>();
  for (const row of needsResolution) {
    const key = normalizeName(row.pitcherName);
    if (!nameToId.has(key)) nameToId.set(key, apiMap.get(key) ?? null);
  }

  for (const row of needsResolution) {
    const key = normalizeName(row.pitcherName);
    const mlbamId = nameToId.get(key) ?? null;
    if (mlbamId != null) {
      try {
        await db.update(mlbStrikeoutProps).set({ mlbamId }).where(eq(mlbStrikeoutProps.id, row.id));
        resolved++;
        console.log(`${TAG} [OUTPUT] Resolved ${row.pitcherName} -> mlbamId=${mlbamId}`);
      } catch (err) {
        console.error(`${TAG} [ERROR] DB update failed for ${row.pitcherName}: ${err instanceof Error ? err.message : String(err)}`);
        errors++;
      }
    } else {
      console.warn(`${TAG} [WARN] Could not resolve mlbamId for "${row.pitcherName}"`);
      unresolved++;
    }
  }

  console.log(`${TAG} [OUTPUT] resolved=${resolved} alreadyHad=${alreadyHad} unresolved=${unresolved} errors=${errors}`);
  console.log(`${TAG} ============================================================\n`);
  return { resolved, alreadyHad, unresolved, errors };
}
