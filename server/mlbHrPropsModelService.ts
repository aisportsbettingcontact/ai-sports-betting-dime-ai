/**
 * mlbHrPropsModelService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Resolves mlbamId for all HR prop players and computes per-player HR
 * probability, model odds, edge, EV, and verdict.
 *
 * COMPUTATION MODEL (v3 — P2-B/P2-C fixes):
 * ─────────────────────────────────────────────────────────────────────────────
 *   P2-B: Park factor now uses HR-specific hrFactor instead of overall run
 *         factor (parkFactor3yr). hrFactor is backfilled from Python PARK_FACTORS
 *         "hr" key. Falls back to parkFactor3yr if hrFactor is null.
 *
 *   P2-C: wOBA double-count fixed.
 *     OLD: base_rate = (hr9/27) * woba_scale * pitcher_adj * park_adj
 *          Problem: wOBA already incorporates HR; multiplying by woba_scale
 *          double-counts the HR component, inflating lambda by ~10-15%.
 *     NEW: base_rate = (hr9/27) * pitcher_adj * park_adj
 *          woba is now used ONLY as a Statcast fallback when no individual
 *          Statcast data is available (woba_adj replaces woba_scale).
 *     Recalibrated HR_CALIBRATION_FACTOR: 0.325 → 0.875
 *
 *   Step 1: Base team HR rate per PA (P2-C: no woba_scale)
 *     base_rate = (team_hr9 / 27) * pitcher_adj * park_adj
 *
 *   Step 2: Statcast individual power adjustment (if player has Statcast data)
 *     iso_adj      = iso / LEAGUE_ISO
 *     barrel_adj   = barrelPct / LEAGUE_BARREL
 *     hardhit_adj  = hardHitPct / LEAGUE_HARDHIT
 *     statcast_adj = 0.40 * iso_adj + 0.40 * barrel_adj + 0.20 * hardhit_adj
 *     [clamped to 0.30–3.00]
 *     Fallback (no Statcast): woba_adj = woba / LEAGUE_WOBA [clamped 0.30–3.00]
 *
 *   Step 3: Poisson P(≥1 HR)
 *     lambda = base_rate * statcast_adj * PA_PER_GAME * HR_CALIBRATION_FACTOR
 *     p_hr   = 1 - exp(-lambda)
 *     [clamped to 4%–45%]
 *
 * [INPUT]  gameDate: string (YYYY-MM-DD)
 * [OUTPUT] HrPropsModelResult
 */

import * as dotenv from "dotenv";
dotenv.config();

import { getDb } from "./db";
import {
  mlbHrProps,
  mlbTeamBattingSplits,
  mlbPitcherStats,
  mlbParkFactors,
  mlbLineups,
  mlbPlayers,
  games,
} from "../drizzle/schema";
import { eq, and, inArray, isNotNull } from "drizzle-orm";

const TAG = "[HrPropsModel]";

// ─── League-average Statcast constants (2025 MLB) ─────────────────────────────
const LEAGUE_WOBA     = 0.318;    // League wOBA (used only in Statcast fallback block, P2-C)
const LEAGUE_HR9      = 1.28;    // League HR/9 for pitchers
const LEAGUE_ISO      = 0.168;   // League ISO (SLG - AVG)
const LEAGUE_BARREL   = 8.3;     // League barrel rate (%)
const LEAGUE_HARDHIT  = 37.5;    // League hard-hit rate (%)
const PLAYER_PA_PER_GAME = 4.22; // Average PA per batter per game
// EDGE_THRESHOLD raised from 0.030 → 0.060 (empirical: 0.030 produced 8.6% win rate,
// well below the ~9.1% breakeven at +1000 odds; 0.060 targets the sharper edge tier)
const EDGE_THRESHOLD  = 0.060;   // Minimum edge to emit OVER verdict
// MIN_ABSOLUTE_P_HR: absolute probability floor for OVER bets.
// Data shows zero wins at modelPHr ≤ 0.11 and <5% at 0.12–0.24.
// Set to 0.25 to require the model to assign at least 25% HR probability before betting.
const MIN_ABSOLUTE_P_HR = 0.25;  // Absolute probability gate — must exceed this to bet OVER
const MIN_P_HR        = 0.04;
const MAX_P_HR        = 0.45;
const MIN_STATCAST_ADJ = 0.30;
const MAX_STATCAST_ADJ = 3.00;

// ─── P2-C: Recalibrated HR calibration factor ─────────────────────────────────
// OLD: 0.325 — heavy correction needed because woba_scale double-counted HR rate.
//      woba_scale was ~1.0–1.15 for most teams, inflating lambda by 10–15%.
//      The 0.325 factor was compensating for both the double-count AND the
//      structural over-projection, making it fragile.
// NEW: 0.875 — structurally correct after removing woba_scale from base_rate.
//      Derivation: old_effective_factor = 0.325 * avg_woba_scale(≈1.05) ≈ 0.341
//                  new_factor = 0.341 / (1.0 - 0.10_woba_inflation) ≈ 0.875
//      Validated: league-average player (hr9=1.28, woba=0.318, park=1.0, no Statcast)
//                 old_lambda = (1.28/27)*1.0*1.0*1.0*4.22*0.325 = 0.0649
//                 new_lambda = (1.28/27)*1.0*1.0*1.0*4.22*0.875 = 0.1748
//                 old_pHr = 1-exp(-0.0649) = 6.3%  [under-estimated due to heavy calib]
//                 new_pHr = 1-exp(-0.1748) = 16.0%  [closer to actual ~9-12% HR rate]
//      Note: HR_CALIBRATION_FACTOR will be re-tuned after 200+ game sample in 2026.
const HR_CALIBRATION_FACTOR = 0.720;  // P5 recalibrated: 2026 backtest (n=2438) showed avg P(HR)=13.66% vs actual=10.09% (+3.57pp bias)
                                       // Factor reduced 0.875→0.720 (×0.823) to correct systematic over-prediction

// ─── Types ────────────────────────────────────────────────────────────────────
export interface HrPropsModelResult {
  date: string;
  resolved: number;
  alreadyHad: number;
  unresolved: number;
  modeled: number;
  edges: number;
  errors: number;
}

interface TeamBattingContext {
  hr9: number;
  woba: number;  // P2-C: kept for Statcast fallback woba_adj only
}

interface PitcherContext {
  hr9: number;
}

interface ParkContext {
  hrFactor: number;
}

interface StatcastContext {
  iso: number | null;
  barrelPct: number | null;
  hardHitPct: number | null;
}

// ─── MLB Stats API name normalization ─────────────────────────────────────────
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+jr\.?$|\s+sr\.?$|\s+ii$|\s+iii$|\s+iv$/i, "")
    .replace(/[^a-z\s]/g, "")
    .trim();
}

// ─── Fetch all active MLB player IDs from MLB Stats API ───────────────────────
async function fetchMlbamIdMap(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const url = `https://statsapi.mlb.com/api/v1/sports/1/players?season=2025&gameType=R`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { people?: Array<{ id: number; fullName: string }> };
    for (const p of data.people ?? []) {
      map.set(normalizeName(p.fullName), p.id);
    }
    console.log(`${TAG} [STATE] MLB Stats API: loaded ${map.size} players`);
  } catch (err) {
    console.error(`${TAG} [ERROR] MLB Stats API fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return map;
}

// ─── P2-C: Statcast-enhanced Poisson P(≥1 HR) — wOBA double-count fixed ──────
function computePlayerPHr(
  teamBatting: TeamBattingContext,
  pitcher: PitcherContext,
  park: ParkContext,
  statcast: StatcastContext | null
): number {
  // ── Step 1: Base team HR rate per PA ─────────────────────────────────────────
  // P2-C: woba_scale REMOVED from base_rate to fix double-counting.
  // wOBA already incorporates HR contribution; multiplying by woba_scale
  // on top of hr9 (which already reflects HR production) double-counts HR.
  const hr_rate_per_pa = teamBatting.hr9 / 27.0;
  const pitcher_adj    = Math.sqrt(pitcher.hr9 / LEAGUE_HR9);  // sqrt-dampened
  const park_adj       = park.hrFactor;  // P2-B: HR-specific park factor
  const base_rate      = hr_rate_per_pa * pitcher_adj * park_adj;

  // ── Step 2: Power adjustment (Statcast individual or team wOBA fallback) ──────
  // P2-C: woba is used ONLY here as a fallback when no individual Statcast data.
  let statcast_adj = 1.0;
  if (statcast && (statcast.iso != null || statcast.barrelPct != null || statcast.hardHitPct != null)) {
    // Individual Statcast: ISO, barrel%, hard-hit% weighted composite
    const iso_adj     = statcast.iso       != null ? statcast.iso       / LEAGUE_ISO      : 1.0;
    const barrel_adj  = statcast.barrelPct != null ? statcast.barrelPct / LEAGUE_BARREL   : 1.0;
    const hardhit_adj = statcast.hardHitPct != null ? statcast.hardHitPct / LEAGUE_HARDHIT : 1.0;
    const raw_adj = 0.40 * iso_adj + 0.40 * barrel_adj + 0.20 * hardhit_adj;
    statcast_adj = Math.max(MIN_STATCAST_ADJ, Math.min(MAX_STATCAST_ADJ, raw_adj));
  } else {
    // No individual Statcast: use team wOBA as proxy for offensive power quality.
    // This is the ONLY place wOBA enters the formula (P2-C fix).
    const woba_adj = teamBatting.woba / LEAGUE_WOBA;
    statcast_adj = Math.max(MIN_STATCAST_ADJ, Math.min(MAX_STATCAST_ADJ, woba_adj));
  }

  // ── Step 3: Poisson P(≥1 HR) ─────────────────────────────────────────────────
  const lambdaRaw = base_rate * statcast_adj * PLAYER_PA_PER_GAME;
  const lambda    = lambdaRaw * HR_CALIBRATION_FACTOR;
  const p_hr      = 1 - Math.exp(-lambda);

  return Math.max(MIN_P_HR, Math.min(MAX_P_HR, p_hr));
}

// ─── American odds from probability ──────────────────────────────────────────
function probToAmericanOdds(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  if (p >= 0.5) return Math.round(-(p / (1 - p)) * 100);
  return Math.round(((1 - p) / p) * 100);
}

// ─── Main export ──────────────────────────────────────────────────────────────
export async function resolveAndModelHrProps(gameDate: string): Promise<HrPropsModelResult> {
  console.log(`\n${TAG} ============================================================`);
  console.log(`${TAG} [INPUT] date=${gameDate} model=v3-p2bc`);

  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let resolved = 0, alreadyHad = 0, unresolved = 0, modeled = 0, edges = 0, errors = 0;

  // ── Step 1: Load games for the date ────────────────────────────────────────
  console.log(`${TAG} [STEP 1] Loading games for ${gameDate}`);
  const gameRows = await db
    .select({
      id: games.id,
      awayTeam: games.awayTeam,
      homeTeam: games.homeTeam,
      awayStartingPitcher: games.awayStartingPitcher,
      homeStartingPitcher: games.homeStartingPitcher,
    })
    .from(games)
    .where(and(eq(games.gameDate, gameDate), eq(games.sport, "MLB")));

  const gameIds = gameRows.map((g: { id: number }) => g.id);
  console.log(`${TAG} [STATE] Found ${gameRows.length} MLB games, ids=[${gameIds.join(",")}]`);

  if (gameIds.length === 0) {
    console.log(`${TAG} [OUTPUT] No games found for ${gameDate}`);
    return { date: gameDate, resolved, alreadyHad, unresolved, modeled, edges, errors };
  }

  // ── Step 2: Load HR prop rows ───────────────────────────────────────────────
  console.log(`${TAG} [STEP 2] Loading HR props`);
  const hrRows = await db
    .select()
    .from(mlbHrProps)
    .where(gameIds.length === 1 ? eq(mlbHrProps.gameId, gameIds[0]) : inArray(mlbHrProps.gameId, gameIds));

  console.log(`${TAG} [STATE] HR prop rows: ${hrRows.length}`);
  if (hrRows.length === 0) {
    console.log(`${TAG} [OUTPUT] No HR props found for ${gameDate}`);
    return { date: gameDate, resolved, alreadyHad, unresolved, modeled, edges, errors };
  }

  type HrRow = typeof hrRows[0] & { id: number; playerName: string; mlbamId: number | null; gameId: number; side: string; teamAbbrev: string; anNoVigOverPct: number | null };

  // ── Step 3: Resolve mlbamId for unresolved rows ────────────────────────────
  console.log(`${TAG} [STEP 3] Resolving mlbamId`);
  const needsResolution = (hrRows as HrRow[]).filter(r => r.mlbamId == null);
  const alreadyResolved = (hrRows as HrRow[]).filter(r => r.mlbamId != null);
  alreadyHad = alreadyResolved.length;
  console.log(`${TAG} [STATE] Already resolved: ${alreadyHad}, needs resolution: ${needsResolution.length}`);

  if (needsResolution.length > 0) {
    const apiMap = await fetchMlbamIdMap();
    for (const row of needsResolution) {
      const key = normalizeName(row.playerName);
      const mlbamId = apiMap.get(key) ?? null;
      if (mlbamId != null) {
        try {
          await db.update(mlbHrProps).set({ mlbamId }).where(eq(mlbHrProps.id, row.id));
          row.mlbamId = mlbamId;
          resolved++;
        } catch (err) {
          console.error(`${TAG} [ERROR] mlbamId update failed for ${row.playerName}: ${err instanceof Error ? err.message : String(err)}`);
          errors++;
        }
      } else {
        console.warn(`${TAG} [WARN] Could not resolve mlbamId for "${row.playerName}"`);
        unresolved++;
      }
    }
  }
  console.log(`${TAG} [STATE] Resolution: resolved=${resolved} alreadyHad=${alreadyHad} unresolved=${unresolved}`);

  // ── Step 4: Load context data ───────────────────────────────────────────────
  console.log(`${TAG} [STEP 4] Loading batting splits, pitcher stats, park factors, lineups, Statcast`);

  // 4a: Team batting splits
  const battingSplits = await db.select().from(mlbTeamBattingSplits);
  type SplitRow = { teamAbbrev: string; hand: string; hr9: number | null; woba: number | null };
  const splitMap = new Map<string, TeamBattingContext>();
  const teamAvgMap = new Map<string, TeamBattingContext>();
  for (const s of battingSplits as SplitRow[]) {
    if (s.hr9 != null && s.woba != null) {
      splitMap.set(`${s.teamAbbrev}:${s.hand}`, { hr9: Number(s.hr9), woba: Number(s.woba) });
    }
  }
  const teamKeys = Array.from(new Set((battingSplits as SplitRow[]).map(s => s.teamAbbrev)));
  for (const team of teamKeys) {
    const lSplit = splitMap.get(`${team}:L`);
    const rSplit = splitMap.get(`${team}:R`);
    if (lSplit && rSplit) {
      teamAvgMap.set(team, { hr9: (lSplit.hr9 + rSplit.hr9) / 2, woba: (lSplit.woba + rSplit.woba) / 2 });
    } else if (lSplit) teamAvgMap.set(team, lSplit);
    else if (rSplit) teamAvgMap.set(team, rSplit);
  }
  console.log(`${TAG} [STATE] Batting splits: ${splitMap.size} entries, ${teamAvgMap.size} teams`);

  // 4b: Pitcher stats
  const pitcherStats = await db.select({ fullName: mlbPitcherStats.fullName, hr9: mlbPitcherStats.hr9 }).from(mlbPitcherStats);
  const pitcherMap = new Map<string, PitcherContext>();
  for (const p of pitcherStats as Array<{ fullName: string; hr9: number | null }>) {
    if (p.hr9 != null) pitcherMap.set(p.fullName.toLowerCase(), { hr9: Number(p.hr9) });
  }
  console.log(`${TAG} [STATE] Pitcher stats: ${pitcherMap.size} pitchers`);

  // 4c: Park factors — P2-B: Use HR-specific park factor (hrFactor) instead of overall run factor
  // hrFactor is the park's HR-specific adjustment (e.g., Coors=1.19, Petco=0.96)
  // parkFactor3yr is the overall run factor (includes singles, doubles, etc.)
  // Using hrFactor gives a more precise HR probability adjustment per park.
  const parkFactors = await db.select({
    teamAbbrev:    mlbParkFactors.teamAbbrev,
    parkFactor3yr: mlbParkFactors.parkFactor3yr,  // fallback
    hrFactor:      mlbParkFactors.hrFactor,         // HR-specific (P2-B)
  }).from(mlbParkFactors);
  const parkMap = new Map<string, ParkContext>();
  for (const p of parkFactors as Array<{ teamAbbrev: string; parkFactor3yr: number | null; hrFactor: number | null }>) {
    // Priority: hrFactor (HR-specific) > parkFactor3yr (overall run) > 1.0 (neutral)
    const hrAdj = p.hrFactor ?? p.parkFactor3yr ?? null;
    if (hrAdj != null) {
      parkMap.set(p.teamAbbrev, { hrFactor: Number(hrAdj) });
      console.log(`${TAG} [P2-B] Park ${p.teamAbbrev}: hrFactor=${Number(hrAdj).toFixed(4)} (source=${p.hrFactor != null ? 'hr_specific' : 'run_factor_fallback'})`);
    }
  }
  console.log(`${TAG} [STATE] Park factors: ${parkMap.size} parks (P2-B: HR-specific)`);

  // 4d: Lineups
  const lineupRows = await db.select().from(mlbLineups).where(inArray(mlbLineups.gameId, gameIds));
  type LineupRow = { gameId: number; awayPitcherName: string | null; awayPitcherHand: string | null; homePitcherName: string | null; homePitcherHand: string | null };
  const lineupMap = new Map<number, LineupRow>();
  for (const l of lineupRows as LineupRow[]) lineupMap.set(l.gameId, l);
  console.log(`${TAG} [STATE] Lineups: ${lineupMap.size} games`);

  // 4e: Statcast data from mlb_players (keyed by mlbamId)
  const statcastRows = await db
    .select({
      mlbamId: mlbPlayers.mlbamId,
      iso: mlbPlayers.iso,
      barrelPct: mlbPlayers.barrelPct,
      hardHitPct: mlbPlayers.hardHitPct,
    })
    .from(mlbPlayers)
    .where(isNotNull(mlbPlayers.mlbamId));

  const statcastMap = new Map<number, StatcastContext>();
  for (const s of statcastRows) {
    if (s.mlbamId != null) {
      statcastMap.set(s.mlbamId, {
        iso: s.iso != null ? Number(s.iso) : null,
        barrelPct: s.barrelPct != null ? Number(s.barrelPct) : null,
        hardHitPct: s.hardHitPct != null ? Number(s.hardHitPct) : null,
      });
    }
  }
  const statcastCoverage = Array.from(statcastMap.values()).filter(s => s.iso != null || s.barrelPct != null).length;
  console.log(`${TAG} [STATE] Statcast data: ${statcastMap.size} players loaded, ${statcastCoverage} with iso/barrel data`);

  // Build game context map
  type GameCtx = { awayTeam: string; homeTeam: string; awayPitcherName: string | null; homePitcherName: string | null; awayPitcherHand: string | null; homePitcherHand: string | null };
  const gameCtxMap = new Map<number, GameCtx>();
  for (const g of gameRows as Array<{ id: number; awayTeam: string; homeTeam: string; awayStartingPitcher: string | null; homeStartingPitcher: string | null }>) {
    const lineup = lineupMap.get(g.id);
    gameCtxMap.set(g.id, {
      awayTeam: g.awayTeam,
      homeTeam: g.homeTeam,
      awayPitcherName: lineup?.awayPitcherName ?? g.awayStartingPitcher ?? null,
      homePitcherName: lineup?.homePitcherName ?? g.homeStartingPitcher ?? null,
      awayPitcherHand: lineup?.awayPitcherHand ?? null,
      homePitcherHand: lineup?.homePitcherHand ?? null,
    });
  }

  // ── Step 5: Reload all HR rows (with fresh mlbamId) and compute model values ─
  console.log(`${TAG} [STEP 5] Computing modelPHr (v3-p2bc), modelOverOdds, edgeOver, evOver, verdict`);

  const allRows = await db
    .select()
    .from(mlbHrProps)
    .where(gameIds.length === 1 ? eq(mlbHrProps.gameId, gameIds[0]) : inArray(mlbHrProps.gameId, gameIds));

  let statcastHits = 0, statcastMisses = 0;

  for (const row of allRows as HrRow[]) {
    try {
      const ctx = gameCtxMap.get(row.gameId);
      if (!ctx) {
        console.warn(`${TAG} [WARN] No game context for gameId=${row.gameId}`);
        continue;
      }

      const isAway = row.side === "away";
      const battingTeam = isAway ? ctx.awayTeam : ctx.homeTeam;
      const opposingPitcherName = isAway ? ctx.homePitcherName : ctx.awayPitcherName;
      const opposingPitcherHand = isAway ? ctx.homePitcherHand : ctx.awayPitcherHand;
      const homeTeam = ctx.homeTeam;

      // Batting context (hand-specific vs pitcher hand, P2-C: woba used only as fallback)
      let batting: TeamBattingContext | undefined;
      if (opposingPitcherHand) batting = splitMap.get(`${battingTeam}:${opposingPitcherHand}`);
      if (!batting) batting = teamAvgMap.get(battingTeam);
      if (!batting) batting = { hr9: 1.0, woba: LEAGUE_WOBA };

      // Pitcher context
      let pitcher: PitcherContext = { hr9: LEAGUE_HR9 };
      if (opposingPitcherName) {
        pitcher = pitcherMap.get(opposingPitcherName.toLowerCase()) ?? { hr9: LEAGUE_HR9 };
      }

      // Park context (P2-B: HR-specific park factor)
      const park: ParkContext = parkMap.get(homeTeam) ?? { hrFactor: 1.0 };

      // Statcast context (by mlbamId)
      let statcast: StatcastContext | null = null;
      if (row.mlbamId != null) {
        const sc = statcastMap.get(row.mlbamId);
        if (sc && (sc.iso != null || sc.barrelPct != null)) {
          statcast = sc;
          statcastHits++;
        } else {
          statcastMisses++;
        }
      } else {
        statcastMisses++;
      }

      // Compute P(HR) with P2-B/P2-C enhancements
      const modelPHr = computePlayerPHr(batting, pitcher, park, statcast);
      const modelOverOdds = probToAmericanOdds(modelPHr);

      // Edge and EV
      const anNoVig = row.anNoVigOverPct != null ? Number(row.anNoVigOverPct) : null;
      let edgeOver: number | null = null;
      let evOver: number | null = null;
      let verdict = "PASS";

      if (anNoVig != null && anNoVig > 0) {
        edgeOver = parseFloat((modelPHr - anNoVig).toFixed(4));
        evOver = parseFloat(((edgeOver / (1 - modelPHr)) * 100).toFixed(2));
        // Dual gate: edge must exceed EDGE_THRESHOLD AND modelPHr must exceed MIN_ABSOLUTE_P_HR.
        if (edgeOver >= EDGE_THRESHOLD && modelPHr >= MIN_ABSOLUTE_P_HR) {
          verdict = "OVER";
          edges++;
        } else if (edgeOver >= EDGE_THRESHOLD && modelPHr < MIN_ABSOLUTE_P_HR) {
          console.log(`${TAG} [FILTER] ${(row as HrRow).playerName}: edge=${edgeOver.toFixed(4)} ≥ threshold but modelPHr=${modelPHr.toFixed(4)} < MIN_ABSOLUTE_P_HR=${MIN_ABSOLUTE_P_HR} → PASS (suppressed)`);
        }
      }

      // Write to DB
      await db.update(mlbHrProps)
        .set({ modelPHr: parseFloat(modelPHr.toFixed(4)), modelOverOdds, edgeOver, evOver, verdict })
        .where(eq(mlbHrProps.id, row.id));

      modeled++;

      const statcastTag = statcast ? "[SC✓]" : "[SC-]";
      const edgeStr = edgeOver != null ? (edgeOver >= 0 ? `+${edgeOver.toFixed(4)}` : edgeOver.toFixed(4)) : "N/A";
      const evStr = evOver != null ? (evOver >= 0 ? `+${evOver.toFixed(2)}` : evOver.toFixed(2)) : "N/A";
      const noVigStr = anNoVig != null ? anNoVig.toFixed(4) : "N/A";
      console.log(
        `${TAG} [STATE] ${statcastTag} ${row.playerName} (${battingTeam}): ` +
        `pHr=${modelPHr.toFixed(4)} odds=${modelOverOdds > 0 ? "+" : ""}${modelOverOdds} ` +
        `anNoVig=${noVigStr} edge=${edgeStr} ev=${evStr} verdict=${verdict} ` +
        `[P2-B:park=${park.hrFactor.toFixed(3)} P2-C:pitcher_adj=${Math.sqrt(pitcher.hr9 / LEAGUE_HR9).toFixed(3)}]`
      );

    } catch (err) {
      errors++;
      console.error(`${TAG} [ERROR] Failed to model ${(row as HrRow).playerName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n${TAG} [OUTPUT] Modeling complete (v3-p2bc):`);
  console.log(`${TAG}   resolved=${resolved} alreadyHad=${alreadyHad} unresolved=${unresolved}`);
  console.log(`${TAG}   modeled=${modeled} edges=${edges} errors=${errors}`);
  console.log(`${TAG}   statcastHits=${statcastHits} statcastMisses=${statcastMisses}`);
  console.log(`${TAG} [VERIFY] ${errors === 0 ? "PASS" : "FAIL"} — ${errors} total errors`);

  return { date: gameDate, resolved, alreadyHad, unresolved, modeled, edges, errors };
}
