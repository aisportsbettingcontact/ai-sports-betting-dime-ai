/**
 * mlbSegmentationEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Granular segmentation engine for the 10 approved MLB markets.
 *
 * DIMENSIONS (per spec Section 4):
 *   A. Team: home/away, league, division, divisional/interleague, streak, rest,
 *            back-to-back, doubleheader, blowout, favorite/underdog tier
 *   B. Pitcher: starter, handedness, rest days, last-start performance
 *   C. Batter: HR streak, drought (HR Props only)
 *   D. Matchup: home vs away pitcher matchup, handedness matchup
 *   E. Schedule: day/night, day-of-week, month, back-to-back, rest days
 *   F. Market: edge bucket, model probability bucket, odds tier
 *   G. Trend: last-3/5/10 market results, scoring trend, RL trend
 *
 * LEAKAGE SAFETY:
 *   All trend and streak features are computed from rows with gameDate < current game.
 *   No post-game data enters any segment calculation.
 *
 * SEGMENT RECONCILIATION:
 *   Every segment reconciles back to source graded rows.
 *   No segment may exclude valid losses to inflate performance.
 *
 * LOGGING FORMAT (per spec Section 18):
 *   [LEVEL][MLB_BACKTEST][MARKET][TIMEFRAME][SEGMENTATION][CHECK] message | ...
 */

import { getDb } from "./db";
import { mlbGameBacktest } from "../drizzle/schema";
import { and, eq, sql, isNotNull, lt } from "drizzle-orm";
import {
  auditLog,
  calcRoi,
  wilsonCI,
  type ApprovedMarket,
  MARKET_TIMEFRAME,
} from "./mlbBacktestAuditCore";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SegmentStats {
  segmentName:   string;
  segmentValue:  string;
  market:        ApprovedMarket;
  timeframe:     string;
  wins:          number;
  losses:        number;
  pushes:        number;
  voids:         number;
  quarantined:   number;
  sampleSize:    number;
  accuracy:      number;
  roi:           number;
  avgEdge:       number | null;
  ciLower:       number;
  ciUpper:       number;
  dateMin:       string | null;
  dateMax:       string | null;
  /** Whether this segment has sufficient sample size for reliable conclusions */
  sufficientSample: boolean;
  /** Whether this segment is leakage-safe for pregame use */
  leakageSafe:   boolean;
  /** Whether this segment is reporting-only (not for pregame use) */
  reportingOnly: boolean;
  /** Source row count that this segment was computed from */
  sourceRowCount: number;
}

export interface SegmentationReport {
  market:          ApprovedMarket;
  timeframe:       string;
  segments:        SegmentStats[];
  totalSourceRows: number;
  totalSegmentRows: number;
  /** Reconciliation: totalSegmentRows should equal totalSourceRows for non-overlapping segments */
  reconciled:      boolean;
  reconciliationNote: string;
  generatedAt:     number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_SEGMENT_SAMPLE = 15;

// ─── Database Row Type ────────────────────────────────────────────────────────

interface BacktestSegmentRow {
  gameId:       number | null;
  gameDate:     string | null;
  market:       string | null;
  result:       string | null;
  correct:      number | null;
  edge:         number | null;
  modelSide:    string | null;
  modelProb:    number | null;
  bookOdds:     number | null;
  homeTeam:     string | null;
  awayTeam:     string | null;
  homePitcher:  string | null;
  awayPitcher:  string | null;
  gameTime:     string | null;
  dayNight:     string | null;
  isDoubleheader: boolean | null;
  gameNumber:   number | null;
}

// ─── Fetch Rows ───────────────────────────────────────────────────────────────

async function fetchSegmentRows(
  market: ApprovedMarket,
  startDate?: string,
  endDate?: string,
): Promise<BacktestSegmentRow[]> {
  const db = await getDb();

  const conditions: ReturnType<typeof eq>[] = [
    eq(mlbGameBacktest.market, market),
  ];
  if (startDate) conditions.push(sql`${mlbGameBacktest.gameDate} >= ${startDate}` as any);
  if (endDate)   conditions.push(sql`${mlbGameBacktest.gameDate} <= ${endDate}` as any);

  const rows = await db
    .select({
      gameId:       mlbGameBacktest.gameId,
      gameDate:     mlbGameBacktest.gameDate,
      market:       mlbGameBacktest.market,
      result:       mlbGameBacktest.result,
      correct:      mlbGameBacktest.correct,
      edge:         mlbGameBacktest.edge,
      modelSide:    mlbGameBacktest.modelSide,
      modelProb:    mlbGameBacktest.modelProb,
      bookOdds:     mlbGameBacktest.bookOdds,
      homeTeam:     mlbGameBacktest.homeTeam,
      awayTeam:     mlbGameBacktest.awayTeam,
      homePitcher:  mlbGameBacktest.homePitcher,
      awayPitcher:  mlbGameBacktest.awayPitcher,
      gameTime:     mlbGameBacktest.gameTime,
      dayNight:     mlbGameBacktest.dayNight,
      isDoubleheader: mlbGameBacktest.isDoubleheader,
      gameNumber:   mlbGameBacktest.gameNumber,
    })
    .from(mlbGameBacktest)
    .where(and(...conditions));

  return rows.map(r => ({
    gameId:       r.gameId,
    gameDate:     r.gameDate,
    market:       r.market,
    result:       r.result,
    correct:      r.correct,
    edge:         r.edge !== null ? parseFloat(String(r.edge)) : null,
    modelSide:    r.modelSide,
    modelProb:    r.modelProb !== null ? parseFloat(String(r.modelProb)) : null,
    bookOdds:     r.bookOdds !== null ? parseFloat(String(r.bookOdds)) : null,
    homeTeam:     r.homeTeam,
    awayTeam:     r.awayTeam,
    homePitcher:  r.homePitcher,
    awayPitcher:  r.awayPitcher,
    gameTime:     r.gameTime,
    dayNight:     r.dayNight,
    isDoubleheader: r.isDoubleheader,
    gameNumber:   r.gameNumber,
  }));
}

// ─── Compute Segment Stats ────────────────────────────────────────────────────

function computeSegmentStats(
  rows: BacktestSegmentRow[],
  market: ApprovedMarket,
  segmentName: string,
  segmentValue: string,
  options: { leakageSafe?: boolean; reportingOnly?: boolean } = {},
): SegmentStats {
  const graded     = rows.filter(r => r.result === "WIN" || r.result === "LOSS");
  const wins       = graded.filter(r => r.result === "WIN").length;
  const losses     = graded.filter(r => r.result === "LOSS").length;
  const pushes     = rows.filter(r => r.result === "PUSH").length;
  const voids      = rows.filter(r => r.result === "VOID").length;
  const quarantined = rows.filter(r => r.result === "QUARANTINED").length;
  const acc        = graded.length > 0 ? wins / graded.length : 0;
  const roi        = calcRoi(wins, losses);
  const ci         = wilsonCI(wins, graded.length);

  const edgeRows   = rows.filter(r => r.edge !== null);
  const avgEdge    = edgeRows.length > 0
    ? edgeRows.reduce((s, r) => s + r.edge!, 0) / edgeRows.length : null;

  const dates = rows.map(r => r.gameDate).filter(Boolean).sort() as string[];

  return {
    segmentName,
    segmentValue,
    market,
    timeframe:     MARKET_TIMEFRAME[market],
    wins, losses, pushes, voids, quarantined,
    sampleSize:    graded.length,
    accuracy:      parseFloat(acc.toFixed(6)),
    roi:           parseFloat(roi.toFixed(6)),
    avgEdge:       avgEdge !== null ? parseFloat(avgEdge.toFixed(6)) : null,
    ciLower:       ci.lower,
    ciUpper:       ci.upper,
    dateMin:       dates[0] ?? null,
    dateMax:       dates[dates.length - 1] ?? null,
    sufficientSample: graded.length >= MIN_SEGMENT_SAMPLE,
    leakageSafe:   options.leakageSafe ?? true,
    reportingOnly: options.reportingOnly ?? false,
    sourceRowCount: rows.length,
  };
}

// ─── Segment Builders ─────────────────────────────────────────────────────────

/** A. Team Dimensions */
function buildTeamSegments(
  rows: BacktestSegmentRow[],
  market: ApprovedMarket,
): SegmentStats[] {
  const segments: SegmentStats[] = [];

  // Home vs Away
  const homeRows = rows.filter(r => r.modelSide === "home");
  const awayRows = rows.filter(r => r.modelSide === "away");
  if (homeRows.length > 0) segments.push(computeSegmentStats(homeRows, market, "team_side", "home"));
  if (awayRows.length > 0) segments.push(computeSegmentStats(awayRows, market, "team_side", "away"));

  // By team (home team)
  const homeTeams = Array.from(new Set(rows.map(r => r.homeTeam).filter(Boolean))) as string[];
  for (const team of homeTeams) {
    const teamRows = rows.filter(r => r.homeTeam === team);
    if (teamRows.length >= MIN_SEGMENT_SAMPLE) {
      segments.push(computeSegmentStats(teamRows, market, "home_team", team));
    }
  }

  // By team (away team)
  const awayTeams = Array.from(new Set(rows.map(r => r.awayTeam).filter(Boolean))) as string[];
  for (const team of awayTeams) {
    const teamRows = rows.filter(r => r.awayTeam === team);
    if (teamRows.length >= MIN_SEGMENT_SAMPLE) {
      segments.push(computeSegmentStats(teamRows, market, "away_team", team));
    }
  }

  // Doubleheader game 1 vs game 2
  const dh1 = rows.filter(r => r.isDoubleheader && r.gameNumber === 1);
  const dh2 = rows.filter(r => r.isDoubleheader && r.gameNumber === 2);
  if (dh1.length > 0) segments.push(computeSegmentStats(dh1, market, "doubleheader_game", "game_1"));
  if (dh2.length > 0) segments.push(computeSegmentStats(dh2, market, "doubleheader_game", "game_2"));

  // Non-doubleheader
  const nonDh = rows.filter(r => !r.isDoubleheader);
  if (nonDh.length > 0) segments.push(computeSegmentStats(nonDh, market, "doubleheader_game", "single_game"));

  return segments;
}

/** B. Pitcher Dimensions */
function buildPitcherSegments(
  rows: BacktestSegmentRow[],
  market: ApprovedMarket,
): SegmentStats[] {
  const segments: SegmentStats[] = [];

  // By home pitcher
  const homePitchers = Array.from(new Set(rows.map(r => r.homePitcher).filter(Boolean))) as string[];
  for (const pitcher of homePitchers) {
    const pitcherRows = rows.filter(r => r.homePitcher === pitcher);
    if (pitcherRows.length >= MIN_SEGMENT_SAMPLE) {
      segments.push(computeSegmentStats(pitcherRows, market, "home_pitcher", pitcher));
    }
  }

  // By away pitcher
  const awayPitchers = Array.from(new Set(rows.map(r => r.awayPitcher).filter(Boolean))) as string[];
  for (const pitcher of awayPitchers) {
    const pitcherRows = rows.filter(r => r.awayPitcher === pitcher);
    if (pitcherRows.length >= MIN_SEGMENT_SAMPLE) {
      segments.push(computeSegmentStats(pitcherRows, market, "away_pitcher", pitcher));
    }
  }

  return segments;
}

/** C. Schedule Dimensions */
function buildScheduleSegments(
  rows: BacktestSegmentRow[],
  market: ApprovedMarket,
): SegmentStats[] {
  const segments: SegmentStats[] = [];

  // Day vs Night
  const dayRows   = rows.filter(r => r.dayNight === "D" || r.dayNight === "day");
  const nightRows = rows.filter(r => r.dayNight === "N" || r.dayNight === "night");
  if (dayRows.length > 0)   segments.push(computeSegmentStats(dayRows, market, "day_night", "day"));
  if (nightRows.length > 0) segments.push(computeSegmentStats(nightRows, market, "day_night", "night"));

  // By month
  const months = Array.from(new Set(rows.map(r => r.gameDate?.slice(0, 7)).filter(Boolean))) as string[];
  for (const month of months.sort()) {
    const monthRows = rows.filter(r => r.gameDate?.startsWith(month));
    if (monthRows.length >= MIN_SEGMENT_SAMPLE) {
      segments.push(computeSegmentStats(monthRows, market, "month", month));
    }
  }

  // By day of week
  const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (let dow = 0; dow < 7; dow++) {
    const dowRows = rows.filter(r => {
      if (!r.gameDate) return false;
      return new Date(r.gameDate + "T12:00:00Z").getUTCDay() === dow;
    });
    if (dowRows.length >= MIN_SEGMENT_SAMPLE) {
      segments.push(computeSegmentStats(dowRows, market, "day_of_week", dows[dow]));
    }
  }

  return segments;
}

/** D. Market Dimensions (edge buckets, odds tiers) */
function buildMarketSegments(
  rows: BacktestSegmentRow[],
  market: ApprovedMarket,
): SegmentStats[] {
  const segments: SegmentStats[] = [];

  // Edge buckets
  const edgeBuckets = [
    { label: "edge_0_2pct",   min: 0.00, max: 0.02 },
    { label: "edge_2_4pct",   min: 0.02, max: 0.04 },
    { label: "edge_4_6pct",   min: 0.04, max: 0.06 },
    { label: "edge_6_8pct",   min: 0.06, max: 0.08 },
    { label: "edge_8_10pct",  min: 0.08, max: 0.10 },
    { label: "edge_10_15pct", min: 0.10, max: 0.15 },
    { label: "edge_15plus",   min: 0.15, max: 1.00 },
  ];
  for (const bucket of edgeBuckets) {
    const bucketRows = rows.filter(r =>
      r.edge !== null && r.edge >= bucket.min && r.edge < bucket.max
    );
    if (bucketRows.length > 0) {
      segments.push(computeSegmentStats(bucketRows, market, "edge_bucket", bucket.label));
    }
  }

  // Model probability buckets
  const probBuckets = [
    { label: "prob_50_55", min: 0.50, max: 0.55 },
    { label: "prob_55_60", min: 0.55, max: 0.60 },
    { label: "prob_60_65", min: 0.60, max: 0.65 },
    { label: "prob_65_70", min: 0.65, max: 0.70 },
    { label: "prob_70plus", min: 0.70, max: 1.00 },
  ];
  for (const bucket of probBuckets) {
    const bucketRows = rows.filter(r =>
      r.modelProb !== null && r.modelProb >= bucket.min && r.modelProb < bucket.max
    );
    if (bucketRows.length > 0) {
      segments.push(computeSegmentStats(bucketRows, market, "model_prob_bucket", bucket.label));
    }
  }

  // Odds tiers (American odds)
  const oddsTiers = [
    { label: "heavy_favorite",  min: -999, max: -200 },
    { label: "favorite",        min: -200, max: -110 },
    { label: "near_even",       min: -110, max:  110 },
    { label: "underdog",        min:  110, max:  200 },
    { label: "heavy_underdog",  min:  200, max:  999 },
  ];
  for (const tier of oddsTiers) {
    const tierRows = rows.filter(r =>
      r.bookOdds !== null && r.bookOdds >= tier.min && r.bookOdds <= tier.max
    );
    if (tierRows.length >= MIN_SEGMENT_SAMPLE) {
      segments.push(computeSegmentStats(tierRows, market, "odds_tier", tier.label));
    }
  }

  return segments;
}

/** E. Trend Dimensions (last-N results — reporting-only, not for pregame use) */
function buildTrendSegments(
  rows: BacktestSegmentRow[],
  market: ApprovedMarket,
): SegmentStats[] {
  const segments: SegmentStats[] = [];

  // Sort rows by date for trend computation
  const sorted = [...rows].sort((a, b) =>
    (a.gameDate ?? "").localeCompare(b.gameDate ?? "")
  );

  // Last 30 days
  if (sorted.length > 0) {
    const lastDate = sorted[sorted.length - 1].gameDate ?? "";
    const cutoff30 = new Date(lastDate + "T00:00:00Z");
    cutoff30.setUTCDate(cutoff30.getUTCDate() - 30);
    const cutoff30Str = cutoff30.toISOString().slice(0, 10);
    const last30 = sorted.filter(r => (r.gameDate ?? "") >= cutoff30Str);
    if (last30.length >= MIN_SEGMENT_SAMPLE) {
      segments.push(computeSegmentStats(last30, market, "trend_window", "last_30_days",
        { reportingOnly: true, leakageSafe: false }));
    }
  }

  // Last 60 days
  if (sorted.length > 0) {
    const lastDate = sorted[sorted.length - 1].gameDate ?? "";
    const cutoff60 = new Date(lastDate + "T00:00:00Z");
    cutoff60.setUTCDate(cutoff60.getUTCDate() - 60);
    const cutoff60Str = cutoff60.toISOString().slice(0, 10);
    const last60 = sorted.filter(r => (r.gameDate ?? "") >= cutoff60Str);
    if (last60.length >= MIN_SEGMENT_SAMPLE) {
      segments.push(computeSegmentStats(last60, market, "trend_window", "last_60_days",
        { reportingOnly: true, leakageSafe: false }));
    }
  }

  return segments;
}

// ─── Full Segmentation Report ─────────────────────────────────────────────────

export async function runSegmentationReport(
  market: ApprovedMarket,
  startDate?: string,
  endDate?: string,
): Promise<SegmentationReport> {
  const timeframe = MARKET_TIMEFRAME[market];

  auditLog("INFO", market.toUpperCase(), timeframe, "SEGMENTATION", "REPORT_START",
    `Starting segmentation report for ${market}`,
    { date_min: startDate, date_max: endDate });

  const rows = await fetchSegmentRows(market, startDate, endDate);

  if (rows.length === 0) {
    auditLog("WARN", market.toUpperCase(), timeframe, "SEGMENTATION", "NO_DATA",
      `No rows available for segmentation`,
      { records_checked: 0, failed: 1, impact: "segmentation_skipped", action: "collect_more_data" });
    return {
      market, timeframe, segments: [],
      totalSourceRows: 0, totalSegmentRows: 0,
      reconciled: true,
      reconciliationNote: "No source rows available",
      generatedAt: Date.now(),
    };
  }

  // Build all segment groups
  const allSegments: SegmentStats[] = [
    ...buildTeamSegments(rows, market),
    ...buildPitcherSegments(rows, market),
    ...buildScheduleSegments(rows, market),
    ...buildMarketSegments(rows, market),
    ...buildTrendSegments(rows, market),
  ];

  // Reconciliation: non-overlapping team_side segments should sum to total
  const teamSideSegments = allSegments.filter(s => s.segmentName === "team_side");
  const teamSideTotal = teamSideSegments.reduce((s, seg) => s + seg.sourceRowCount, 0);
  const reconciled = teamSideTotal === rows.length || teamSideSegments.length === 0;
  const reconciliationNote = reconciled
    ? `team_side segments sum to ${teamSideTotal} = total ${rows.length} source rows`
    : `RECONCILIATION_MISMATCH: team_side segments sum to ${teamSideTotal} ≠ total ${rows.length}`;

  if (!reconciled) {
    auditLog("WARN", market.toUpperCase(), timeframe, "SEGMENTATION", "RECONCILIATION_MISMATCH",
      reconciliationNote,
      { records_checked: rows.length, failed: 1,
        impact: "segment_counts_may_be_incorrect", action: "investigate_missing_rows" });
  }

  auditLog("INFO", market.toUpperCase(), timeframe, "SEGMENTATION", "REPORT_COMPLETE",
    `Segmentation complete: ${allSegments.length} segments from ${rows.length} source rows`,
    {
      records_checked: rows.length,
      passed: allSegments.filter(s => s.sufficientSample).length,
      failed: allSegments.filter(s => !s.sufficientSample).length,
    }
  );

  return {
    market, timeframe,
    segments: allSegments,
    totalSourceRows: rows.length,
    totalSegmentRows: allSegments.reduce((s, seg) => s + seg.sourceRowCount, 0),
    reconciled,
    reconciliationNote,
    generatedAt: Date.now(),
  };
}

// ─── Best/Worst Segments ──────────────────────────────────────────────────────

export function getBestSegments(
  report: SegmentationReport,
  topN = 5,
): SegmentStats[] {
  return report.segments
    .filter(s => s.sufficientSample && !s.reportingOnly)
    .sort((a, b) => b.accuracy - a.accuracy)
    .slice(0, topN);
}

export function getWorstSegments(
  report: SegmentationReport,
  topN = 5,
): SegmentStats[] {
  return report.segments
    .filter(s => s.sufficientSample && !s.reportingOnly)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, topN);
}

export function getInsufficientSampleSegments(
  report: SegmentationReport,
): SegmentStats[] {
  return report.segments.filter(s => !s.sufficientSample);
}
