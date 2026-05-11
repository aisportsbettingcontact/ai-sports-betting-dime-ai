/**
 * mlbFullBacktestEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Comprehensive multi-market backtest engine for the MLB AI Model.
 *
 * MARKETS COVERED:
 *   Full Game: ML Home/Away, RL Home/Away (+1.5/-1.5), Over/Under
 *   First Five: ML Home/Away, RL Home/Away (+0.5/-0.5), Over/Under
 *   YRFI / NRFI
 *   Strikeout Props (K-Props): OVER/UNDER per pitcher
 *   Home Run Props (HR Props): OVER per player
 *
 * REPORT OUTPUTS:
 *   getFullBacktestReport()     → per-market W/L/Push, accuracy, ROI, edge stats
 *   getDailyBacktestTimeSeries() → per-day cumulative ROI curve
 *   getEdgeBucketAccuracy()     → calibration: edge bucket → accuracy
 *   getKPropsBacktestReport()   → K-Props MAE, bias, RMSE, per-line breakdown
 *   getHrPropsBacktestReport()  → HR Props calibration, P(HR) distribution
 *   runHistoricalBacktestRange() → re-evaluate all games in a date range
 *
 * ACCURACY TARGET: 70%+ on filtered (high-edge) picks across all markets.
 *
 * [INPUT]  days: number, minEdge: number, minSample: number
 * [OUTPUT] BacktestFullReport
 */

import * as dotenv from "dotenv";
dotenv.config();

import { getDb } from "./db";
import {
  games,
  mlbGameBacktest,
  mlbStrikeoutProps,
  mlbHrProps,
} from "../drizzle/schema";
import { and, eq, gte, isNotNull, sql, desc, inArray } from "drizzle-orm";

const TAG = "[FullBacktestEngine]";

// ─── Market keys (must match mlbMultiMarketBacktest.ts MARKETS) ──────────────
export const ALL_MARKETS = [
  "fg_ml_home", "fg_ml_away",
  "fg_rl_home", "fg_rl_away",
  "fg_over",    "fg_under",
  "f5_ml_home", "f5_ml_away",
  "f5_rl_home", "f5_rl_away",
  "f5_over",    "f5_under",
  "nrfi",       "yrfi",
  "k_prop",     "hr_prop",
] as const;

export type MarketKey = typeof ALL_MARKETS[number];

// ─── Market display metadata ──────────────────────────────────────────────────
export const MARKET_META: Record<MarketKey, { label: string; group: string; breakeven: number }> = {
  fg_ml_home:  { label: "FG ML Home",   group: "Full Game ML",  breakeven: 0.524 },
  fg_ml_away:  { label: "FG ML Away",   group: "Full Game ML",  breakeven: 0.524 },
  fg_rl_home:  { label: "FG RL Home",   group: "Full Game RL",  breakeven: 0.524 },
  fg_rl_away:  { label: "FG RL Away",   group: "Full Game RL",  breakeven: 0.524 },
  fg_over:     { label: "FG Over",      group: "Full Game O/U", breakeven: 0.524 },
  fg_under:    { label: "FG Under",     group: "Full Game O/U", breakeven: 0.524 },
  f5_ml_home:  { label: "F5 ML Home",   group: "F5 ML",         breakeven: 0.524 },
  f5_ml_away:  { label: "F5 ML Away",   group: "F5 ML",         breakeven: 0.524 },
  f5_rl_home:  { label: "F5 RL Home",   group: "F5 RL",         breakeven: 0.524 },
  f5_rl_away:  { label: "F5 RL Away",   group: "F5 RL",         breakeven: 0.524 },
  f5_over:     { label: "F5 Over",      group: "F5 O/U",        breakeven: 0.524 },
  f5_under:    { label: "F5 Under",     group: "F5 O/U",        breakeven: 0.524 },
  nrfi:        { label: "NRFI",         group: "YRFI/NRFI",     breakeven: 0.524 },
  yrfi:        { label: "YRFI",         group: "YRFI/NRFI",     breakeven: 0.524 },
  k_prop:      { label: "K-Props",      group: "Props",         breakeven: 0.524 },
  hr_prop:     { label: "HR Props",     group: "Props",         breakeven: 0.476 }, // avg +110 odds
};

// ─── Optimal edge thresholds (from 2026 backtest analysis) ───────────────────
export const OPTIMAL_EDGE_THRESHOLDS: Record<MarketKey, number> = {
  fg_ml_home:  0.06,
  fg_ml_away:  0.08,
  fg_rl_home:  0.10,
  fg_rl_away:  0.06,
  fg_over:     0.08,
  fg_under:    0.06,
  f5_ml_home:  0.12,
  f5_ml_away:  0.12,
  f5_rl_home:  0.06,
  f5_rl_away:  0.08,
  f5_over:     0.08,
  f5_under:    0.06,
  nrfi:        0.05,
  yrfi:        0.05,
  k_prop:      0.04,
  hr_prop:     0.06,
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MarketStat {
  market:      MarketKey;
  label:       string;
  group:       string;
  wins:        number;
  losses:      number;
  pushes:      number;
  noAction:    number;
  total:       number;
  accuracy:    number;        // wins / (wins + losses)
  roi:         number;        // (wins * avgPayout - losses) / (wins + losses)
  avgEdge:     number;        // mean edge across all bets
  avgModelProb: number;       // mean model probability
  avgBookProb:  number;       // mean book no-vig probability
  breakeven:   number;        // breakeven accuracy for this market
  status:      "above_target" | "below_target" | "insufficient_data";
  // Filtered stats at optimal edge threshold
  filteredWins:     number;
  filteredLosses:   number;
  filteredAccuracy: number;
  filteredRoi:      number;
  optimalEdge:      number;
}

export interface DailyPoint {
  date:          string;
  wins:          number;
  losses:        number;
  accuracy:      number;
  cumulativeRoi: number;
  bets:          number;
}

export interface EdgeBucket {
  bucket:    string;   // e.g. "0.00–0.02"
  minEdge:   number;
  maxEdge:   number;
  wins:      number;
  losses:    number;
  accuracy:  number;
  count:     number;
  avgEdge:   number;
}

export interface KPropsReport {
  totalPredictions: number;
  mae:              number;
  bias:             number;   // mean(predicted - actual), negative = under-projection
  rmse:             number;
  overAccuracy:     number;
  underAccuracy:    number;
  overWins:         number;
  overLosses:       number;
  underWins:        number;
  underLosses:      number;
  byLine:           Array<{ line: number; wins: number; losses: number; accuracy: number; count: number }>;
  byEdgeTier:       Array<{ tier: string; wins: number; losses: number; accuracy: number; avgEdge: number }>;
  calibrationBias:  number;   // P5 recalibrated bias (should be near 0 post-fix)
}

export interface HrPropsReport {
  totalPredictions:  number;
  overWins:          number;
  overLosses:        number;
  overAccuracy:      number;
  avgModelPHr:       number;
  avgActualHrRate:   number;
  calibrationBias:   number;  // avgModelPHr - avgActualHrRate (positive = over-predicting)
  byOddsTier:        Array<{ tier: string; wins: number; losses: number; accuracy: number; avgOdds: number; count: number }>;
  byProbBucket:      Array<{ bucket: string; wins: number; losses: number; accuracy: number; avgProb: number; count: number }>;
  highEdgeAccuracy:  number;  // accuracy at edge >= 0.06
  highEdgeCount:     number;
}

export interface BacktestFullReport {
  generatedAt:   number;
  periodDays:    number;
  totalGames:    number;
  totalBets:     number;
  overallAccuracy: number;
  overallRoi:    number;
  markets:       MarketStat[];
  summary:       {
    marketsAbove70pct:  number;
    marketsAbove60pct:  number;
    marketsAbove50pct:  number;
    bestMarket:         string;
    bestAccuracy:       number;
    worstMarket:        string;
    worstAccuracy:      number;
    totalWins:          number;
    totalLosses:        number;
    filteredWins:       number;
    filteredLosses:     number;
    filteredAccuracy:   number;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cutoffTs(days: number): bigint {
  return BigInt(Date.now() - days * 24 * 60 * 60 * 1000);
}

function roiFromWL(wins: number, losses: number, avgPayout = 0.909): number {
  const total = wins + losses;
  if (total === 0) return 0;
  return parseFloat(((wins * avgPayout - losses) / total).toFixed(4));
}

function accuracy(wins: number, losses: number): number {
  const total = wins + losses;
  if (total === 0) return 0;
  return parseFloat((wins / total).toFixed(4));
}

// ─── Core: per-market stats from mlb_game_backtest ───────────────────────────

async function getMarketStats(
  market: MarketKey,
  days: number,
  minEdge: number,
): Promise<{
  wins: number; losses: number; pushes: number; noAction: number;
  avgEdge: number; avgModelProb: number; avgBookProb: number;
  filteredWins: number; filteredLosses: number;
}> {
  const db = await getDb();
  const cutoff = cutoffTs(days);

  const rows = await db
    .select({
      correct:      mlbGameBacktest.correct,
      result:       mlbGameBacktest.result,
      edge:         mlbGameBacktest.edge,
      modelProb:    mlbGameBacktest.modelProb,
      bookNoVigProb: mlbGameBacktest.bookNoVigProb,
    })
    .from(mlbGameBacktest)
    .where(
      and(
        eq(mlbGameBacktest.market, market),
        sql`${mlbGameBacktest.backtestRunAt} >= ${cutoff}`,
      )
    );

  let wins = 0, losses = 0, pushes = 0, noAction = 0;
  let edgeSum = 0, edgeCount = 0;
  let probSum = 0, bookProbSum = 0;
  let filteredWins = 0, filteredLosses = 0;

  for (const row of rows) {
    const result = row.result as string;
    const edge = row.edge != null ? parseFloat(String(row.edge)) : null;
    const modelProb = row.modelProb != null ? parseFloat(String(row.modelProb)) : null;
    const bookProb = row.bookNoVigProb != null ? parseFloat(String(row.bookNoVigProb)) : null;

    if (result === "WIN")       wins++;
    else if (result === "LOSS") losses++;
    else if (result === "PUSH") pushes++;
    else                        noAction++;

    if (edge != null) { edgeSum += edge; edgeCount++; }
    if (modelProb != null) probSum += modelProb;
    if (bookProb != null)  bookProbSum += bookProb;

    // Filtered stats at optimal edge threshold
    if (edge != null && edge >= minEdge && (result === "WIN" || result === "LOSS")) {
      if (result === "WIN") filteredWins++;
      else filteredLosses++;
    }
  }

  const total = rows.length;
  return {
    wins, losses, pushes, noAction,
    avgEdge:      edgeCount > 0 ? parseFloat((edgeSum / edgeCount).toFixed(4)) : 0,
    avgModelProb: total > 0 ? parseFloat((probSum / total).toFixed(4)) : 0,
    avgBookProb:  total > 0 ? parseFloat((bookProbSum / total).toFixed(4)) : 0,
    filteredWins, filteredLosses,
  };
}

// ─── Main report ──────────────────────────────────────────────────────────────

export async function getFullBacktestReport(
  days: number,
  minEdge: number,
  minSample: number,
): Promise<BacktestFullReport> {
  console.log(`\n${TAG} ============================================================`);
  console.log(`${TAG} [INPUT] days=${days} minEdge=${minEdge} minSample=${minSample}`);

  const db = await getDb();

  // Count total games in period
  const cutoff = cutoffTs(days);
  const gameCountRows = await db
    .select({ count: sql<number>`count(distinct ${mlbGameBacktest.gameId})` })
    .from(mlbGameBacktest)
    .where(sql`${mlbGameBacktest.backtestRunAt} >= ${cutoff}`);
  const totalGames = Number(gameCountRows[0]?.count ?? 0);

  const marketStats: MarketStat[] = [];
  let totalWins = 0, totalLosses = 0, totalBets = 0;
  let filteredWins = 0, filteredLosses = 0;

  for (const market of ALL_MARKETS) {
    const optEdge = Math.max(minEdge, OPTIMAL_EDGE_THRESHOLDS[market]);
    const stats = await getMarketStats(market, days, optEdge);
    const meta = MARKET_META[market];

    const total = stats.wins + stats.losses + stats.pushes;
    const acc = accuracy(stats.wins, stats.losses);
    const roi = roiFromWL(stats.wins, stats.losses);
    const fAcc = accuracy(stats.filteredWins, stats.filteredLosses);
    const fRoi = roiFromWL(stats.filteredWins, stats.filteredLosses);

    let status: MarketStat["status"] = "insufficient_data";
    if (stats.wins + stats.losses >= minSample) {
      status = acc >= 0.70 ? "above_target" : "below_target";
    }

    totalWins   += stats.wins;
    totalLosses += stats.losses;
    totalBets   += stats.wins + stats.losses;
    filteredWins   += stats.filteredWins;
    filteredLosses += stats.filteredLosses;

    marketStats.push({
      market,
      label:       meta.label,
      group:       meta.group,
      wins:        stats.wins,
      losses:      stats.losses,
      pushes:      stats.pushes,
      noAction:    stats.noAction,
      total,
      accuracy:    acc,
      roi,
      avgEdge:     stats.avgEdge,
      avgModelProb: stats.avgModelProb,
      avgBookProb:  stats.avgBookProb,
      breakeven:   meta.breakeven,
      status,
      filteredWins:     stats.filteredWins,
      filteredLosses:   stats.filteredLosses,
      filteredAccuracy: fAcc,
      filteredRoi:      fRoi,
      optimalEdge:      optEdge,
    });
  }

  // Sort by accuracy descending
  marketStats.sort((a, b) => b.accuracy - a.accuracy);

  const overallAcc = accuracy(totalWins, totalLosses);
  const overallRoi = roiFromWL(totalWins, totalLosses);
  const filteredAcc = accuracy(filteredWins, filteredLosses);

  const above70 = marketStats.filter(m => m.accuracy >= 0.70 && m.wins + m.losses >= minSample).length;
  const above60 = marketStats.filter(m => m.accuracy >= 0.60 && m.wins + m.losses >= minSample).length;
  const above50 = marketStats.filter(m => m.accuracy >= 0.50 && m.wins + m.losses >= minSample).length;

  const withData = marketStats.filter(m => m.wins + m.losses >= minSample);
  const best  = withData.length > 0 ? withData[0] : null;
  const worst = withData.length > 0 ? withData[withData.length - 1] : null;

  console.log(`${TAG} [OUTPUT] totalGames=${totalGames} totalBets=${totalBets} overallAcc=${(overallAcc * 100).toFixed(1)}% overallRoi=${(overallRoi * 100).toFixed(1)}%`);
  console.log(`${TAG} [VERIFY] above70=${above70} above60=${above60} above50=${above50}`);

  return {
    generatedAt:   Date.now(),
    periodDays:    days,
    totalGames,
    totalBets,
    overallAccuracy: overallAcc,
    overallRoi,
    markets: marketStats,
    summary: {
      marketsAbove70pct:  above70,
      marketsAbove60pct:  above60,
      marketsAbove50pct:  above50,
      bestMarket:    best?.label  ?? "N/A",
      bestAccuracy:  best?.accuracy ?? 0,
      worstMarket:   worst?.label  ?? "N/A",
      worstAccuracy: worst?.accuracy ?? 0,
      totalWins,
      totalLosses,
      filteredWins,
      filteredLosses,
      filteredAccuracy: filteredAcc,
    },
  };
}

// ─── Daily time series ────────────────────────────────────────────────────────

export async function getDailyBacktestTimeSeries(
  days: number,
  market: string,
): Promise<DailyPoint[]> {
  const db = await getDb();
  const cutoff = cutoffTs(days);

  const whereClause = market === "all"
    ? sql`${mlbGameBacktest.backtestRunAt} >= ${cutoff}`
    : and(
        sql`${mlbGameBacktest.backtestRunAt} >= ${cutoff}`,
        eq(mlbGameBacktest.market, market as MarketKey),
      );

  const rows = await db
    .select({
      gameDate:  mlbGameBacktest.gameDate,
      correct:   mlbGameBacktest.correct,
      result:    mlbGameBacktest.result,
    })
    .from(mlbGameBacktest)
    .where(whereClause)
    .orderBy(mlbGameBacktest.gameDate);

  // Group by date
  const byDate = new Map<string, { wins: number; losses: number }>();
  for (const row of rows) {
    const date = row.gameDate ?? "unknown";
    if (!byDate.has(date)) byDate.set(date, { wins: 0, losses: 0 });
    const d = byDate.get(date)!;
    if (row.result === "WIN")       d.wins++;
    else if (row.result === "LOSS") d.losses++;
  }

  const points: DailyPoint[] = [];
  let cumWins = 0, cumLosses = 0;

  for (const [date, d] of Array.from(byDate.entries()).sort()) {
    cumWins   += d.wins;
    cumLosses += d.losses;
    const total = cumWins + cumLosses;
    const dailyTotal = d.wins + d.losses;
    points.push({
      date,
      wins:          d.wins,
      losses:        d.losses,
      accuracy:      dailyTotal > 0 ? parseFloat((d.wins / dailyTotal).toFixed(4)) : 0,
      cumulativeRoi: roiFromWL(cumWins, cumLosses),
      bets:          dailyTotal,
    });
  }

  return points;
}

// ─── Edge bucket calibration ──────────────────────────────────────────────────

export async function getEdgeBucketAccuracy(
  days: number,
  market: string,
): Promise<EdgeBucket[]> {
  const db = await getDb();
  const cutoff = cutoffTs(days);

  const whereClause = market === "all"
    ? and(
        sql`${mlbGameBacktest.backtestRunAt} >= ${cutoff}`,
        isNotNull(mlbGameBacktest.edge),
      )
    : and(
        sql`${mlbGameBacktest.backtestRunAt} >= ${cutoff}`,
        eq(mlbGameBacktest.market, market as MarketKey),
        isNotNull(mlbGameBacktest.edge),
      );

  const rows = await db
    .select({
      edge:   mlbGameBacktest.edge,
      result: mlbGameBacktest.result,
    })
    .from(mlbGameBacktest)
    .where(whereClause);

  // Define buckets: 0–0.02, 0.02–0.04, 0.04–0.06, 0.06–0.08, 0.08–0.10, 0.10–0.15, 0.15+
  const bucketDefs = [
    { label: "0.00–0.02", min: 0.00, max: 0.02 },
    { label: "0.02–0.04", min: 0.02, max: 0.04 },
    { label: "0.04–0.06", min: 0.04, max: 0.06 },
    { label: "0.06–0.08", min: 0.06, max: 0.08 },
    { label: "0.08–0.10", min: 0.08, max: 0.10 },
    { label: "0.10–0.15", min: 0.10, max: 0.15 },
    { label: "0.15+",     min: 0.15, max: 1.00 },
  ];

  const buckets: EdgeBucket[] = bucketDefs.map(b => ({
    bucket:   b.label,
    minEdge:  b.min,
    maxEdge:  b.max,
    wins:     0,
    losses:   0,
    accuracy: 0,
    count:    0,
    avgEdge:  0,
  }));

  for (const row of rows) {
    const edge = row.edge != null ? parseFloat(String(row.edge)) : null;
    if (edge === null || edge < 0) continue;
    const result = row.result as string;
    if (result !== "WIN" && result !== "LOSS") continue;

    for (const b of buckets) {
      if (edge >= b.minEdge && edge < b.maxEdge) {
        b.count++;
        b.avgEdge += edge;
        if (result === "WIN") b.wins++;
        else b.losses++;
        break;
      }
    }
  }

  for (const b of buckets) {
    b.accuracy = accuracy(b.wins, b.losses);
    b.avgEdge  = b.count > 0 ? parseFloat((b.avgEdge / b.count).toFixed(4)) : 0;
  }

  return buckets.filter(b => b.count > 0);
}

// ─── K-Props detailed report ──────────────────────────────────────────────────

export async function getKPropsBacktestReport(days: number): Promise<KPropsReport> {
  const db = await getDb();
  const cutoff = cutoffTs(days);

  // Get K-props rows with actual results
  const rows = await db
    .select({
      kProj:         mlbStrikeoutProps.kProj,
      bookLine:      mlbStrikeoutProps.bookLine,
      actualKs:      mlbStrikeoutProps.actualKs,
      verdict:       mlbStrikeoutProps.verdict,
      backtestResult: mlbStrikeoutProps.backtestResult,
      edgeOver:      mlbStrikeoutProps.edgeOver,
      edgeUnder:     mlbStrikeoutProps.edgeUnder,
      modelRunAt:    mlbStrikeoutProps.modelRunAt,
    })
    .from(mlbStrikeoutProps)
    .where(
      and(
        isNotNull(mlbStrikeoutProps.actualKs),
        isNotNull(mlbStrikeoutProps.kProj),
        sql`${mlbStrikeoutProps.modelRunAt} >= ${Number(cutoff)}`,
      )
    );

  let mae = 0, biasSum = 0, rmseSum = 0, count = 0;
  let overWins = 0, overLosses = 0, underWins = 0, underLosses = 0;

  // By-line breakdown
  const byLine = new Map<number, { wins: number; losses: number }>();
  // By-edge-tier
  const edgeTiers = [
    { tier: "0.00–0.04", min: 0.00, max: 0.04, wins: 0, losses: 0, edgeSum: 0, count: 0 },
    { tier: "0.04–0.08", min: 0.04, max: 0.08, wins: 0, losses: 0, edgeSum: 0, count: 0 },
    { tier: "0.08–0.12", min: 0.08, max: 0.12, wins: 0, losses: 0, edgeSum: 0, count: 0 },
    { tier: "0.12+",     min: 0.12, max: 1.00, wins: 0, losses: 0, edgeSum: 0, count: 0 },
  ];

  for (const row of rows) {
    const kProj   = row.kProj      != null ? parseFloat(String(row.kProj))      : null;
    const actual  = row.actualKs   != null ? parseFloat(String(row.actualKs))   : null;
    const bookLine = row.bookLine  != null ? parseFloat(String(row.bookLine))   : null;
    const verdict = row.verdict as string | null;
    const btResult = row.backtestResult as string | null;
    const edge = verdict === "OVER"
      ? (row.edgeOver  != null ? parseFloat(String(row.edgeOver))  : null)
      : (row.edgeUnder != null ? parseFloat(String(row.edgeUnder)) : null);

    if (kProj !== null && actual !== null) {
      const diff = kProj - actual;
      mae     += Math.abs(diff);
      biasSum += diff;
      rmseSum += diff * diff;
      count++;
    }

    if (btResult === "WIN") {
      if (verdict === "OVER")  overWins++;
      else                     underWins++;
    } else if (btResult === "LOSS") {
      if (verdict === "OVER")  overLosses++;
      else                     underLosses++;
    }

    // By-line
    if (bookLine !== null && (btResult === "WIN" || btResult === "LOSS")) {
      const lineKey = Math.round(bookLine * 2) / 2; // round to nearest 0.5
      if (!byLine.has(lineKey)) byLine.set(lineKey, { wins: 0, losses: 0 });
      const bl = byLine.get(lineKey)!;
      if (btResult === "WIN") bl.wins++;
      else bl.losses++;
    }

    // By-edge-tier
    if (edge !== null && (btResult === "WIN" || btResult === "LOSS")) {
      for (const tier of edgeTiers) {
        if (edge >= tier.min && edge < tier.max) {
          tier.count++;
          tier.edgeSum += edge;
          if (btResult === "WIN") tier.wins++;
          else tier.losses++;
          break;
        }
      }
    }
  }

  const byLineArr = Array.from(byLine.entries())
    .sort(([a], [b]) => a - b)
    .map(([line, d]) => ({
      line,
      wins:     d.wins,
      losses:   d.losses,
      accuracy: accuracy(d.wins, d.losses),
      count:    d.wins + d.losses,
    }));

  const byEdgeTierArr = edgeTiers
    .filter(t => t.count > 0)
    .map(t => ({
      tier:     t.tier,
      wins:     t.wins,
      losses:   t.losses,
      accuracy: accuracy(t.wins, t.losses),
      avgEdge:  t.count > 0 ? parseFloat((t.edgeSum / t.count).toFixed(4)) : 0,
    }));

  return {
    totalPredictions: count,
    mae:   count > 0 ? parseFloat((mae / count).toFixed(3))  : 0,
    bias:  count > 0 ? parseFloat((biasSum / count).toFixed(3)) : 0,
    rmse:  count > 0 ? parseFloat(Math.sqrt(rmseSum / count).toFixed(3)) : 0,
    overAccuracy:  accuracy(overWins, overLosses),
    underAccuracy: accuracy(underWins, underLosses),
    overWins, overLosses, underWins, underLosses,
    byLine:       byLineArr,
    byEdgeTier:   byEdgeTierArr,
    calibrationBias: count > 0 ? parseFloat((biasSum / count).toFixed(3)) : 0,
  };
}

// ─── HR Props detailed report ─────────────────────────────────────────────────

export async function getHrPropsBacktestReport(days: number): Promise<HrPropsReport> {
  const db = await getDb();
  const cutoff = cutoffTs(days);

  const rows = await db
    .select({
      modelPHr:      mlbHrProps.modelPHr,
      actualHr:      mlbHrProps.actualHr,
      modelOverOdds: mlbHrProps.modelOverOdds,
      consensusOverOdds: mlbHrProps.consensusOverOdds,
      edgeOver:      mlbHrProps.edgeOver,
      verdict:       mlbHrProps.verdict,
      backtestResult: mlbHrProps.backtestResult,
      modelRunAt:    mlbHrProps.modelRunAt,
    })
    .from(mlbHrProps)
    .where(
      and(
        isNotNull(mlbHrProps.actualHr),
        isNotNull(mlbHrProps.modelPHr),
        sql`${mlbHrProps.modelRunAt} >= ${Number(cutoff)}`,
      )
    );

  let overWins = 0, overLosses = 0;
  let modelPHrSum = 0, actualHrSum = 0, count = 0;

  // By-odds-tier
  const oddsTiers = [
    { tier: "+100 to +149", min: 100, max: 149, wins: 0, losses: 0, oddsSum: 0, count: 0 },
    { tier: "+150 to +199", min: 150, max: 199, wins: 0, losses: 0, oddsSum: 0, count: 0 },
    { tier: "+200 to +299", min: 200, max: 299, wins: 0, losses: 0, oddsSum: 0, count: 0 },
    { tier: "+300 to +499", min: 300, max: 499, wins: 0, losses: 0, oddsSum: 0, count: 0 },
    { tier: "+500+",        min: 500, max: 9999, wins: 0, losses: 0, oddsSum: 0, count: 0 },
  ];

  // By-prob-bucket
  const probBuckets = [
    { bucket: "0–10%",   min: 0.00, max: 0.10, wins: 0, losses: 0, probSum: 0, count: 0 },
    { bucket: "10–15%",  min: 0.10, max: 0.15, wins: 0, losses: 0, probSum: 0, count: 0 },
    { bucket: "15–20%",  min: 0.15, max: 0.20, wins: 0, losses: 0, probSum: 0, count: 0 },
    { bucket: "20–25%",  min: 0.20, max: 0.25, wins: 0, losses: 0, probSum: 0, count: 0 },
    { bucket: "25–30%",  min: 0.25, max: 0.30, wins: 0, losses: 0, probSum: 0, count: 0 },
    { bucket: "30%+",    min: 0.30, max: 1.00, wins: 0, losses: 0, probSum: 0, count: 0 },
  ];

  let highEdgeWins = 0, highEdgeLosses = 0;

  for (const row of rows) {
    const modelPHr  = row.modelPHr  != null ? parseFloat(String(row.modelPHr))  : null;
    const actualHr  = row.actualHr  != null ? parseInt(String(row.actualHr), 10) : null;
    const bookOdds  = row.consensusOverOdds != null ? parseInt(String(row.consensusOverOdds), 10) : null;
    const edge      = row.edgeOver  != null ? parseFloat(String(row.edgeOver)) : null;
    const btResult  = row.backtestResult as string | null;
    const verdict   = row.verdict as string | null;

    if (modelPHr !== null && actualHr !== null) {
      modelPHrSum  += modelPHr;
      actualHrSum  += actualHr > 0 ? 1 : 0;
      count++;
    }

    if (verdict === "OVER") {
      if (btResult === "WIN")  overWins++;
      else if (btResult === "LOSS") overLosses++;
    }

    // High-edge (edge >= 0.06)
    if (edge !== null && edge >= 0.06 && (btResult === "WIN" || btResult === "LOSS")) {
      if (btResult === "WIN") highEdgeWins++;
      else highEdgeLosses++;
    }

    // By-odds-tier
    if (bookOdds !== null && bookOdds > 0 && (btResult === "WIN" || btResult === "LOSS")) {
      for (const tier of oddsTiers) {
        if (bookOdds >= tier.min && bookOdds <= tier.max) {
          tier.count++;
          tier.oddsSum += bookOdds;
          if (btResult === "WIN") tier.wins++;
          else tier.losses++;
          break;
        }
      }
    }

    // By-prob-bucket
    if (modelPHr !== null && (btResult === "WIN" || btResult === "LOSS")) {
      for (const pb of probBuckets) {
        if (modelPHr >= pb.min && modelPHr < pb.max) {
          pb.count++;
          pb.probSum += modelPHr;
          if (btResult === "WIN") pb.wins++;
          else pb.losses++;
          break;
        }
      }
    }
  }

  const avgModelPHr    = count > 0 ? parseFloat((modelPHrSum / count).toFixed(4)) : 0;
  const avgActualHrRate = count > 0 ? parseFloat((actualHrSum / count).toFixed(4)) : 0;

  return {
    totalPredictions:  count,
    overWins, overLosses,
    overAccuracy:      accuracy(overWins, overLosses),
    avgModelPHr,
    avgActualHrRate,
    calibrationBias:   parseFloat((avgModelPHr - avgActualHrRate).toFixed(4)),
    byOddsTier: oddsTiers
      .filter(t => t.count > 0)
      .map(t => ({
        tier:     t.tier,
        wins:     t.wins,
        losses:   t.losses,
        accuracy: accuracy(t.wins, t.losses),
        avgOdds:  t.count > 0 ? Math.round(t.oddsSum / t.count) : 0,
        count:    t.count,
      })),
    byProbBucket: probBuckets
      .filter(pb => pb.count > 0)
      .map(pb => ({
        bucket:   pb.bucket,
        wins:     pb.wins,
        losses:   pb.losses,
        accuracy: accuracy(pb.wins, pb.losses),
        avgProb:  pb.count > 0 ? parseFloat((pb.probSum / pb.count).toFixed(4)) : 0,
        count:    pb.count,
      })),
    highEdgeAccuracy: accuracy(highEdgeWins, highEdgeLosses),
    highEdgeCount:    highEdgeWins + highEdgeLosses,
  };
}

// ─── Historical range runner ──────────────────────────────────────────────────

export async function runHistoricalBacktestRange(
  startDate: string,
  endDate: string,
): Promise<{ processed: number; errors: number; dates: string[] }> {
  console.log(`\n${TAG} ============================================================`);
  console.log(`${TAG} [INPUT] runHistoricalBacktestRange start=${startDate} end=${endDate}`);

  const db = await getDb();

  // Get all dates with final MLB games in range
  const dateRows = await db
    .selectDistinct({ gameDate: games.gameDate })
    .from(games)
    .where(
      and(
        eq(games.sport, "MLB"),
        eq(games.gameStatus, "final"),
        sql`${games.gameDate} >= ${startDate}`,
        sql`${games.gameDate} <= ${endDate}`,
        isNotNull(games.awayScore),
        isNotNull(games.homeScore),
      )
    )
    .orderBy(games.gameDate);

  const dates = dateRows.map((r: { gameDate: string | null }) => r.gameDate).filter(Boolean) as string[];
  console.log(`${TAG} [STATE] Found ${dates.length} dates to backtest`);

  let processed = 0, errors = 0;
  const { runMultiMarketBacktestForDate } = await import('./mlbMultiMarketBacktest');

  for (const date of dates) {
    try {
      await runMultiMarketBacktestForDate(date);
      processed++;
      if (processed % 5 === 0) {
        console.log(`${TAG} [STATE] Progress: ${processed}/${dates.length} dates processed`);
      }
    } catch (err) {
      errors++;
      console.error(`${TAG} [ERROR] date=${date}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`${TAG} [OUTPUT] processed=${processed} errors=${errors}`);
  console.log(`${TAG} [VERIFY] ${errors === 0 ? "PASS" : "WARN"} — ${errors} errors in ${dates.length} dates`);

  return { processed, errors, dates };
}
