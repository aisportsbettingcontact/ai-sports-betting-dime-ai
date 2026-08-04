/**
 * betTrackerCore.ts — pure, dependency-free core of the Bet Tracker.
 *
 * Everything here is a total function over plain data: no DB, no tRPC, no clock,
 * no network. That is deliberate. The router (`routers/betTracker.ts`) is a thin
 * transport shell around these functions, so the rules that actually matter —
 * who may see whose bets, how a stake becomes a unit count, what a stored line
 * means, how a bet list becomes a stats block — are unit-testable without a
 * database. See `server/betTrackerCore.test.ts`.
 *
 * Sections:
 *   1. Access control      — the single source of truth for visibility + mutation
 *   2. Stake math          — American odds, unit normalization, unit buckets
 *   3. Line semantics      — the invariants that keep RL/TOTAL grading correct
 *   4. Cursor codec        — keyset pagination encode/decode
 *   5. Aggregation         — one single-pass reducer producing the full stats block
 */

// ─── Shared vocabulary ────────────────────────────────────────────────────────

export type Role = "owner" | "admin" | "handicapper" | "user";
export type BetResult = "PENDING" | "WIN" | "LOSS" | "PUSH" | "VOID";
export type Market = "ML" | "RL" | "TOTAL";
export type PickSide = "AWAY" | "HOME" | "OVER" | "UNDER";
export type Timeframe =
  | "FULL_GAME" | "FIRST_5" | "FIRST_INNING" | "NRFI" | "YRFI"
  | "REGULATION" | "FIRST_PERIOD" | "FIRST_HALF" | "FIRST_QUARTER";

/** Roles permitted to read and act on another user's bets. */
const PRIVILEGED_ROLES: readonly Role[] = ["owner", "admin"] as const;

export function isPrivilegedRole(role: string): boolean {
  return PRIVILEGED_ROLES.includes(role as Role);
}

// ─── 1. Access control ────────────────────────────────────────────────────────

export type ViewResolution =
  | { ok: true; userId: number; scope: "self" | "other" }
  | { ok: false; code: "FORBIDDEN"; message: string };

/**
 * Resolve which user's bets a request is allowed to read.
 *
 * The rule, in one place, for every read procedure:
 *   - No targetUserId, or targetUserId === self  → own bets ("self")
 *   - targetUserId !== self AND role is owner/admin → that user's bets ("other")
 *   - targetUserId !== self AND role is anything else → FORBIDDEN
 *
 * A regular user can never widen their own scope: the only way `userId` differs
 * from `viewerId` is through the privileged branch.
 */
export function resolveViewUserId(args: {
  role: string;
  viewerId: number;
  targetUserId?: number | null;
}): ViewResolution {
  const { role, viewerId, targetUserId } = args;
  if (targetUserId == null || targetUserId === viewerId) {
    return { ok: true, userId: viewerId, scope: "self" };
  }
  if (!isPrivilegedRole(role)) {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "Owner or Admin required to view another user's bets",
    };
  }
  return { ok: true, userId: targetUserId, scope: "other" };
}

export type MutationDecision =
  | { allowed: true }
  | { allowed: false; code: "FORBIDDEN"; message: string };

/**
 * Decide whether an actor may directly edit or delete a specific bet.
 *
 * Matrix (actorRole × bet ownership):
 *   owner       → own bets only. Never another owner's bets.
 *   admin       → any non-owner-owned bet (handicapper/user), plus their own.
 *   handicapper → never directly; must go through submitEditRequest.
 *   user        → own bets only.
 *
 * The handicapper immutability rule is checked before ownership on purpose: a
 * handicapper editing their OWN bet is still forbidden, which is the entire
 * point of the edit-request workflow.
 */
export function decideBetMutation(args: {
  actorRole: string;
  actorId: number;
  betOwnerId: number;
  betOwnerRole: string;
  action: "update" | "delete";
}): MutationDecision {
  const { actorRole, actorId, betOwnerId, betOwnerRole, action } = args;
  const verb = action === "update" ? "edit" : "delete";

  if (actorRole === "handicapper") {
    return {
      allowed: false,
      code: "FORBIDDEN",
      message: `Handicappers cannot directly ${verb} bets. Use the edit request system.`,
    };
  }

  if (actorRole === "admin") {
    if (betOwnerRole === "owner" && betOwnerId !== actorId) {
      return {
        allowed: false,
        code: "FORBIDDEN",
        message: `Admins cannot ${verb} owner bets`,
      };
    }
    return { allowed: true };
  }

  // owner and user are both self-scoped.
  if (betOwnerId !== actorId) {
    return {
      allowed: false,
      code: "FORBIDDEN",
      message: `Cannot ${verb} another user's bet`,
    };
  }
  return { allowed: true };
}

/** Owner/admin-only procedures (listHandicappers, getLogs, reviewEditRequest, …). */
export function decidePrivilegedAccess(role: string, what: string): MutationDecision {
  if (isPrivilegedRole(role)) return { allowed: true };
  return { allowed: false, code: "FORBIDDEN", message: `Owner or Admin required to ${what}` };
}

/**
 * Decide whether an actor may hand-write a bet's `result`.
 *
 * Results are supposed to come from the grading engine, which is deterministic
 * and independently verified (471/471 agreement against the official MLB feed
 * over the 2026 season, audited 2026-08-03). A self-service result field is a
 * different thing entirely: it lets someone rewrite their own W/L record with no
 * score, no reviewer and no history.
 *
 * That was not hypothetical. Five rows carry a W/L/PUSH with NULL scores, and
 * bet 390003 was hand-marked PUSH at 21:53:31Z for a game whose first pitch was
 * 00:05Z the next day — 2h11m later. The engine cannot produce that; only a
 * manual override can.
 *
 * Owner/admin keep the override because bets the grader genuinely cannot resolve
 * (game never found, abandoned fixture) still need a human endpoint. Everyone
 * else corrects a mistake by editing or deleting the bet, which they can now do
 * directly.
 */
export function decideResultOverride(actorRole: string): MutationDecision {
  if (isPrivilegedRole(actorRole)) return { allowed: true };
  return {
    allowed: false,
    code: "FORBIDDEN",
    message:
      "Results are set by the grading engine. Edit or delete the bet instead, " +
      "or ask an admin if a game cannot be graded.",
  };
}

// ─── 2. Stake math ────────────────────────────────────────────────────────────

/** Compute the to-win amount from American odds and a risk amount. */
export function calcToWin(odds: number, risk: number): number {
  if (odds >= 100) return parseFloat((risk * (odds / 100)).toFixed(2));
  return parseFloat((risk * (100 / Math.abs(odds))).toFixed(2));
}

/**
 * Normalize a dollar amount to a unit count.
 *
 * Bets created after the riskUnits/toWinUnits columns landed carry their unit
 * count explicitly, which is authoritative regardless of the viewer's current
 * unit-size setting. Legacy rows have NULL there, so we divide the dollar amount
 * by the viewer's unit size.
 */
export function toUnits(
  dollarAmt: number,
  storedUnits: string | number | null | undefined,
  unitSize: number,
): number {
  if (storedUnits != null && storedUnits !== "") {
    const v = typeof storedUnits === "number" ? storedUnits : parseFloat(storedUnits);
    if (Number.isFinite(v) && v > 0) return v;
  }
  const size = unitSize > 0 ? unitSize : 1;
  return dollarAmt / size;
}

export const UNIT_BUCKET_ORDER = ["10U", "5U", "4U", "3U", "2U", "1U", "<1U"] as const;

/**
 * Bucket a bet by the number of units it represents.
 *
 * Unit-size convention:
 *   Plus money  (+odds): the RISK is the unit count  (+155 risking 3U → a 3U play)
 *   Minus money (-odds): the TO-WIN is the unit count (-153 to win 5U → a 5U play)
 *
 * Legacy rows (no stored unit columns) are normalized through `toUnits` so they
 * bucket on unit counts like every other row. Dividing by unitSize here is what
 * keeps `bySize` consistent with the ROI/net figures shown beside it — before
 * this, a $300 legacy risk was read as "300 units" and collapsed into 10U.
 */
export function calcUnitBucket(args: {
  odds: number;
  risk: number;
  toWin: number;
  riskUnits?: string | number | null;
  toWinUnits?: string | number | null;
  unitSize: number;
}): string {
  const { odds, risk, toWin, riskUnits, toWinUnits, unitSize } = args;
  const unitCount = odds > 0
    ? toUnits(risk, riskUnits, unitSize)
    : toUnits(toWin, toWinUnits, unitSize);

  // Sub-unit stakes get their own bucket instead of being rounded up into "1U".
  // Rounding hid real mis-entries: a $1.10 stake at $100/unit is 0.011 units,
  // which Math.round sent to 0 and the old chain then labelled "1U" — a 110x
  // overstatement sitting in the BY UNIT SIZE breakdown next to genuine 1U
  // plays. Four such rows existed on 2026-08-03, the smallest 0.01U.
  if (unitCount < 0.5) return "<1U";

  const u = Math.round(unitCount);
  if (u >= 10) return "10U";
  if (u >= 5) return "5U";
  if (u >= 4) return "4U";
  if (u >= 3) return "3U";
  if (u >= 2) return "2U";
  return "1U";
}

/** Derive the human-readable pick label from the structured fields. */
export function derivePickLabel(
  pickSide: PickSide,
  market: Market,
  awayTeam: string,
  homeTeam: string,
  timeframe?: Timeframe,
): string {
  if (timeframe === "NRFI") return "NRFI";
  if (timeframe === "YRFI") return "YRFI";
  if (market === "TOTAL") return pickSide === "OVER" ? "OVER" : "UNDER";
  const team = pickSide === "AWAY" ? awayTeam : homeTeam;
  return `${team} ${market === "ML" ? "ML" : "RL"}`;
}

// ─── 3. Line semantics ────────────────────────────────────────────────────────
//
// The `line` column carries two different meanings depending on market:
//
//   RL    — a SIGNED spread from the picked side's perspective.
//           "SEA RL -1.5" stores -1.5; the grader asks pickedMargin + line > 0.
//   TOTAL — an UNSIGNED total (8.5 means the game total line is 8.5).
//   ML    — unused.
//
// Two invariants keep that from going wrong, both enforced here:
//
//   I1  A RL or TOTAL bet must carry a line. There is no safe default: guessing
//       -1.5 inverts every underdog run line, and guessing 0 grades a spread as
//       a moneyline.
//   I2  Changing pickSide on an RL bet flips the spread's sign, and changing
//       market invalidates the stored line entirely (a -1.5 spread is not a
//       total of -1.5). Both must be resolved at write time, not at grade time.

export function marketRequiresLine(market: Market): boolean {
  return market === "RL" || market === "TOTAL";
}

/** The effective line used for grading: an explicit custom line wins over the book line. */
export function effectiveLine(
  line: number | string | null | undefined,
  customLine: number | string | null | undefined,
): number | null {
  const pick = (v: number | string | null | undefined): number | null => {
    if (v == null || v === "") return null;
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  return pick(customLine) ?? pick(line);
}

export type LineResolution =
  | { ok: true; line: number | null; customLine: number | null; flipped: boolean }
  | { ok: false; code: "BAD_REQUEST"; message: string };

/**
 * Resolve the line columns for an update, enforcing I1 and I2.
 *
 * `nextLine` / `nextCustomLine` are the values explicitly supplied by the caller
 * (undefined means "not supplied"). Returns the values to persist, or an error
 * explaining what the caller must send.
 */
export function resolveLineForUpdate(args: {
  prevMarket: Market;
  nextMarket: Market;
  prevPickSide: PickSide;
  nextPickSide: PickSide;
  prevLine: number | string | null | undefined;
  prevCustomLine: number | string | null | undefined;
  nextLine?: number | null;
  nextCustomLine?: number | null;
}): LineResolution {
  const {
    prevMarket, nextMarket, prevPickSide, nextPickSide,
    prevLine, prevCustomLine, nextLine, nextCustomLine,
  } = args;

  const num = (v: number | string | null | undefined): number | null => {
    if (v == null || v === "") return null;
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };

  const suppliedLine = nextLine !== undefined ? nextLine : null;
  const suppliedCustom = nextCustomLine !== undefined ? nextCustomLine : null;
  const anySupplied = nextLine !== undefined || nextCustomLine !== undefined;

  // Market unchanged from here down unless stated.
  const marketChanged = prevMarket !== nextMarket;

  if (marketChanged) {
    // A line stored under the old market's convention is meaningless under the
    // new one. Require the caller to supply a fresh line (or drop to ML).
    if (!marketRequiresLine(nextMarket)) {
      return { ok: true, line: null, customLine: null, flipped: false };
    }
    if (!anySupplied || effectiveLine(suppliedLine, suppliedCustom) === null) {
      return {
        ok: false,
        code: "BAD_REQUEST",
        message: `Changing market to ${nextMarket} requires a new line — the stored ${prevMarket} line cannot be reused`,
      };
    }
    return { ok: true, line: suppliedLine, customLine: suppliedCustom, flipped: false };
  }

  // Market unchanged. An explicitly supplied line always wins.
  if (anySupplied) {
    if (marketRequiresLine(nextMarket) && effectiveLine(suppliedLine, suppliedCustom) === null) {
      return {
        ok: false,
        code: "BAD_REQUEST",
        message: `${nextMarket} bets require a line`,
      };
    }
    return { ok: true, line: suppliedLine, customLine: suppliedCustom, flipped: false };
  }

  const keptLine = num(prevLine);
  const keptCustom = num(prevCustomLine);

  // Side flip on a run line: the opposing side of a spread is its negation.
  // Without this, flipping AWAY↔HOME keeps the old sign and inverts the grade
  // on every one-run/one-goal margin.
  const sideFlipped =
    nextMarket === "RL" &&
    prevPickSide !== nextPickSide &&
    (prevPickSide === "AWAY" || prevPickSide === "HOME") &&
    (nextPickSide === "AWAY" || nextPickSide === "HOME");

  if (sideFlipped) {
    return {
      ok: true,
      line: keptLine === null ? null : -keptLine,
      customLine: keptCustom === null ? null : -keptCustom,
      flipped: true,
    };
  }

  return { ok: true, line: keptLine, customLine: keptCustom, flipped: false };
}

// ─── 4. Cursor codec ──────────────────────────────────────────────────────────
//
// Keyset pagination on (gameDate DESC, id DESC). Encoded as JSON so the shape is
// self-describing in logs; decode is total (a malformed cursor restarts from the
// first page rather than throwing).

export interface BetCursor { gameDate: string; id: number }

export function encodeCursor(c: BetCursor): string {
  return JSON.stringify({ gameDate: c.gameDate, id: c.id });
}

export function decodeCursor(raw: string | null | undefined): BetCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BetCursor>;
    if (typeof parsed?.gameDate !== "string") return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.gameDate)) return null;
    if (!Number.isInteger(parsed?.id)) return null;
    return { gameDate: parsed.gameDate, id: parsed.id as number };
  } catch {
    return null;
  }
}

// ─── 5. Aggregation ───────────────────────────────────────────────────────────

/**
 * The narrow row projection the stats pass needs.
 *
 * Deliberately NOT the full `tracked_bets` row: the aggregation never reads
 * notes, book, scores, team names, or timestamps, and pulling them wastes wire
 * and heap on every cache miss.
 */
export interface StatRow {
  id: number;
  gameDate: string;
  result: string;
  sport: string;
  market: string | null;
  betType: string | null;
  timeframe: string | null;
  wagerType: string | null;
  pick: string;
  odds: number;
  risk: string;
  toWin: string;
  riskUnits: string | null;
  toWinUnits: string | null;
  /**
   * Legs on a parlay ticket; 0 or absent for a straight bet.
   *
   * Needed here because the `byType` breakdown keys on `market`, which a
   * parlay parent carries as the column default "ML". Without this a ticket
   * would be filed under moneyline and the PARLAY row would never appear.
   */
  legCount?: number | null;
}

export interface BreakdownEntry {
  key: string;
  wins: number;
  losses: number;
  pushes: number;
  totalRisk: number;
  netProfit: number;
  roi: number;
  dollarNetProfit: number;
}

export interface EquityPoint {
  date: string;
  cumPL: number;
  betId: number;
  label: string;
  /** Legacy alias kept so older consumers of this payload keep working. */
  pick: string;
  result: string;
  pl: number;
  odds: number;
  units: number;
  isSpecial?: boolean;
}

/**
 * Ceiling on equity points returned to the client.
 *
 * The curve is one point per settled bet, so it grows without bound. Measured
 * on a real MySQL (scripts/bench-bet-stats.mts): at 50,000 bets the stats block
 * is 4,045 KB of which the curve is 3,992 KB — 99%. Every other figure
 * (scalars plus all seven breakdowns) totals 53 KB and stays flat, because it
 * is keyed by month/sport/market rather than by bet.
 *
 * 750 points across a chart under ~900 CSS px is already sub-pixel. Anything
 * beyond it is bytes the client pays for and cannot draw.
 */
export const EQUITY_CURVE_MAX_POINTS = 750;

/**
 * Bound the equity curve for transport while keeping the curve's *shape* and
 * every point the rest of the stats block refers to.
 *
 * Two rules make this safe to render:
 *
 *   1. Mandatory points always survive — the first, the last, and every point
 *      flagged `isSpecial` (the all-time high and the max-drawdown trough).
 *      Those carry chart markers keyed by betId; dropping one would leave a
 *      marker pointing at a bet absent from the series.
 *   2. Within each bucket the *extreme* is kept, not the mean or the first.
 *      An equity curve is read for its peaks and troughs, so averaging would
 *      flatten precisely the features a bettor is looking for.
 *
 * Scalars are NOT derived from this result. `ath`, `maxDrawdown`,
 * `longestWinStreak`, `currentRunUnits` and the day records are all computed
 * over the complete series in `aggregateStats` before any thinning, so the
 * headline numbers stay exact no matter how aggressively the curve is thinned.
 */
export function downsampleEquityCurve(
  curve: EquityPoint[],
  maxPoints: number = EQUITY_CURVE_MAX_POINTS,
): EquityPoint[] {
  if (maxPoints < 2) throw new Error("downsampleEquityCurve: maxPoints must be >= 2");
  if (curve.length <= maxPoints) return curve;

  const mandatory = new Set<number>([0, curve.length - 1]);
  for (let i = 0; i < curve.length; i++) {
    if (curve[i].isSpecial) mandatory.add(i);
  }

  // If the anchors alone fill the budget, return exactly those. The curve is
  // then sparse but every referenced point is still present.
  const budget = maxPoints - mandatory.size;
  if (budget <= 0) return Array.from(mandatory).sort((a, b) => a - b).map(i => curve[i]);

  const optional: number[] = [];
  for (let i = 0; i < curve.length; i++) {
    if (!mandatory.has(i)) optional.push(i);
  }

  // One representative per bucket: the point furthest from the running mean of
  // the bucket, which is the local peak or trough.
  const chosen = new Set<number>(mandatory);
  const bucketSize = optional.length / budget;
  for (let b = 0; b < budget; b++) {
    const start = Math.floor(b * bucketSize);
    const end = Math.min(Math.floor((b + 1) * bucketSize), optional.length);
    if (start >= end) continue;

    let mean = 0;
    for (let i = start; i < end; i++) mean += curve[optional[i]].cumPL;
    mean /= end - start;

    let bestIdx = optional[start];
    let bestDev = -1;
    for (let i = start; i < end; i++) {
      const dev = Math.abs(curve[optional[i]].cumPL - mean);
      if (dev > bestDev) { bestDev = dev; bestIdx = optional[i]; }
    }
    chosen.add(bestIdx);
  }

  return Array.from(chosen).sort((a, b) => a - b).map(i => curve[i]);
}

export interface BetStats {
  totalBets: number;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  voids: number;
  gradedBets: number;
  totalRisk: number;
  totalWon: number;
  totalLost: number;
  netProfit: number;
  dollarNetProfit: number;
  roi: number;
  bestWin: number;
  worstLoss: number;
  byType: BreakdownEntry[];
  bySize: BreakdownEntry[];
  byMonth: BreakdownEntry[];
  bySport: BreakdownEntry[];
  byResult: BreakdownEntry[];
  byTimeframe: BreakdownEntry[];
  byWagerType: BreakdownEntry[];
  equityCurve: EquityPoint[];
  /** Points in the complete curve before thinning; equals equityCurve.length when untouched. */
  equityCurveTotal?: number;
  biggestDayDate: string;
  biggestDayUnits: number;
  longestWinStreak: number;
  maxDrawdown: number;
  currentRunUnits: number;
  currentRunSince: string;
  ath: number;
  worstDayDate: string;
  worstDayUnits: number;
}

const round2 = (n: number): number => parseFloat(n.toFixed(2));

interface BkEntry {
  wins: number; losses: number; pushes: number;
  risk: number; won: number; lost: number;
}

/**
 * Reduce a chronologically-ascending row set to the complete stats block.
 *
 * ONE implementation. Previously `getStats`, `listWithStats` and
 * `listWithStatsPaginated` each carried their own copy and had drifted: the
 * paginated one (the only one the UI actually called) silently omitted dollar
 * P&L, drawdown, current-run, ATH, worst-day and the equity point metadata, so
 * those UI affordances rendered blank with no error.
 *
 * Accounting rules:
 *   WIN     → stake at risk, profit = toWin
 *   LOSS    → stake at risk, loss = risk
 *   PUSH    → counted, stake returned, contributes nothing to risk or P/L
 *   VOID    → counted, bet never happened, contributes nothing
 *   PENDING → counted only
 *
 * `rows` MUST be ordered by (gameDate ASC, id ASC); the equity curve, streaks
 * and drawdown are order-dependent.
 */
export function aggregateStats(rows: StatRow[], unitSize: number): BetStats {
  const size = unitSize > 0 ? unitSize : 100;

  let wins = 0, losses = 0, pushes = 0, pending = 0, voids = 0;
  let totalRisk = 0, totalWon = 0, totalLost = 0;
  let bestWin = 0, worstLoss = 0;

  const byTypeMap = new Map<string, BkEntry>();
  const bySizeMap = new Map<string, BkEntry>();
  const byMonthMap = new Map<string, BkEntry>();
  const bySportMap = new Map<string, BkEntry>();
  const byResultMap = new Map<string, BkEntry>();
  const byTimeframeMap = new Map<string, BkEntry>();
  const byWagerTypeMap = new Map<string, BkEntry>();

  const dayPLMap = new Map<string, number>();
  const dayWorstBet = new Map<string, { pl: number; betId: number }>();

  const equityCurve: EquityPoint[] = [];
  let cumPL = 0;
  let longestWinStreak = 0, currentWinStreak = 0;
  let ath = 0, athBetId = -1;
  let peakForDrawdown = 0, maxDrawdown = 0, maxDrawdownBetId = -1;

  const bkApply = (map: Map<string, BkEntry>, key: string, result: string, riskU: number, toWinU: number): void => {
    let e = map.get(key);
    if (!e) { e = { wins: 0, losses: 0, pushes: 0, risk: 0, won: 0, lost: 0 }; map.set(key, e); }
    if (result === "WIN") { e.wins++; e.risk += riskU; e.won += toWinU; }
    else if (result === "LOSS") { e.losses++; e.risk += riskU; e.lost += riskU; }
    else if (result === "PUSH") { e.pushes++; }
  };

  for (const bet of rows) {
    const riskDollar = parseFloat(bet.risk);
    const toWinDollar = parseFloat(bet.toWin);
    const riskU = toUnits(riskDollar, bet.riskUnits, size);
    const toWinU = toUnits(toWinDollar, bet.toWinUnits, size);
    const res = bet.result;

    switch (res) {
      case "WIN":
        wins++; totalRisk += riskU; totalWon += toWinU;
        if (toWinU > bestWin) bestWin = toWinU;
        break;
      case "LOSS":
        losses++; totalRisk += riskU; totalLost += riskU;
        if (riskU > worstLoss) worstLoss = riskU;
        break;
      case "PUSH": pushes++; break;
      case "PENDING": pending++; break;
      case "VOID": voids++; break;
    }

    // A parlay is its own type. Its `market` column holds the schema default
    // "ML", so keying on market alone would file every ticket under moneyline.
    const typeKey = (bet.legCount ?? 0) > 0 ? "PARLAY" : (bet.market ?? bet.betType ?? "ML");
    bkApply(byTypeMap, typeKey, res, riskU, toWinU);
    bkApply(bySizeMap, calcUnitBucket({
      odds: bet.odds,
      risk: riskDollar,
      toWin: toWinDollar,
      riskUnits: bet.riskUnits,
      toWinUnits: bet.toWinUnits,
      unitSize: size,
    }), res, riskU, toWinU);
    bkApply(byMonthMap, bet.gameDate.substring(0, 7), res, riskU, toWinU);
    bkApply(bySportMap, bet.sport, res, riskU, toWinU);
    bkApply(byResultMap, res, res, riskU, toWinU);
    bkApply(byTimeframeMap, bet.timeframe ?? "FULL_GAME", res, riskU, toWinU);
    bkApply(byWagerTypeMap, bet.wagerType ?? "PREGAME", res, riskU, toWinU);

    if (res !== "WIN" && res !== "LOSS") continue;

    const pl = res === "WIN" ? toWinU : -riskU;
    dayPLMap.set(bet.gameDate, (dayPLMap.get(bet.gameDate) ?? 0) + pl);
    const worst = dayWorstBet.get(bet.gameDate);
    if (!worst || pl < worst.pl) dayWorstBet.set(bet.gameDate, { pl, betId: bet.id });

    cumPL += pl;
    const cp = round2(cumPL);
    equityCurve.push({
      date: bet.gameDate,
      cumPL: cp,
      betId: bet.id,
      label: bet.pick,
      pick: bet.pick,
      result: res,
      pl: round2(pl),
      odds: bet.odds,
      units: round2(riskU),
    });

    if (cp > ath) { ath = cp; athBetId = bet.id; }
    if (cp > peakForDrawdown) peakForDrawdown = cp;
    const drawdown = peakForDrawdown - cp;
    if (drawdown > maxDrawdown) { maxDrawdown = drawdown; maxDrawdownBetId = bet.id; }

    if (res === "WIN") {
      currentWinStreak++;
      if (currentWinStreak > longestWinStreak) longestWinStreak = currentWinStreak;
    } else {
      currentWinStreak = 0;
    }
  }

  const finalize = (map: Map<string, BkEntry>): BreakdownEntry[] =>
    Array.from(map.entries()).map(([key, e]) => {
      const np = e.won - e.lost;
      return {
        key,
        wins: e.wins,
        losses: e.losses,
        pushes: e.pushes,
        totalRisk: round2(e.risk),
        netProfit: round2(np),
        roi: e.risk > 0 ? parseFloat(((np / e.risk) * 100).toFixed(2)) : 0,
        dollarNetProfit: round2(np * size),
      };
    }).sort((a, b) => a.key.localeCompare(b.key));

  const bySize = finalize(bySizeMap).sort((a, b) => {
    const ai = UNIT_BUCKET_ORDER.indexOf(a.key as typeof UNIT_BUCKET_ORDER[number]);
    const bi = UNIT_BUCKET_ORDER.indexOf(b.key as typeof UNIT_BUCKET_ORDER[number]);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  let biggestDayDate = "", biggestDayUnits = 0;
  let worstDayDate = "", worstDayUnits = 0;
  dayPLMap.forEach((pl, date) => {
    if (pl > biggestDayUnits) { biggestDayUnits = pl; biggestDayDate = date; }
    if (pl < worstDayUnits) { worstDayUnits = pl; worstDayDate = date; }
  });

  // Current run: gain since the most recent trough. Walk back from the final
  // point while the curve is non-increasing in reverse (i.e. non-decreasing
  // forward); the point where that stops is the trough the run started from.
  let currentRunUnits = 0, currentRunSince = "";
  if (equityCurve.length > 0) {
    const finalCum = equityCurve[equityCurve.length - 1].cumPL;
    let troughPL = finalCum;
    let troughDate = equityCurve[equityCurve.length - 1].date;
    for (let i = equityCurve.length - 1; i >= 0; i--) {
      if (equityCurve[i].cumPL <= troughPL) {
        troughPL = equityCurve[i].cumPL;
        troughDate = equityCurve[i].date;
      } else break;
    }
    currentRunUnits = round2(finalCum - troughPL);
    currentRunSince = troughDate;
  }

  const specialBetIds = new Set<number>();
  if (athBetId >= 0) specialBetIds.add(athBetId);
  if (maxDrawdownBetId >= 0) specialBetIds.add(maxDrawdownBetId);
  const worstDayEntry = worstDayDate ? dayWorstBet.get(worstDayDate) : undefined;
  if (worstDayEntry) specialBetIds.add(worstDayEntry.betId);
  for (const pt of equityCurve) {
    if (specialBetIds.has(pt.betId)) pt.isSpecial = true;
  }

  const netProfit = totalWon - totalLost;

  return {
    totalBets: rows.length,
    wins, losses, pushes, pending, voids,
    gradedBets: wins + losses + pushes,
    totalRisk: round2(totalRisk),
    totalWon: round2(totalWon),
    totalLost: round2(totalLost),
    netProfit: round2(netProfit),
    dollarNetProfit: round2(netProfit * size),
    roi: totalRisk > 0 ? parseFloat(((netProfit / totalRisk) * 100).toFixed(2)) : 0,
    bestWin: round2(bestWin),
    worstLoss: round2(worstLoss),
    byType: finalize(byTypeMap),
    bySize,
    byMonth: finalize(byMonthMap),
    bySport: finalize(bySportMap),
    byResult: finalize(byResultMap),
    byTimeframe: finalize(byTimeframeMap),
    byWagerType: finalize(byWagerTypeMap),
    equityCurve,
    biggestDayDate,
    biggestDayUnits: round2(biggestDayUnits),
    longestWinStreak,
    maxDrawdown: round2(maxDrawdown),
    currentRunUnits,
    currentRunSince,
    ath: round2(ath),
    worstDayDate,
    worstDayUnits: round2(worstDayUnits),
  };
}

/** Empty stats block — used when a query returns no rows. */
export function emptyStats(unitSize: number): BetStats {
  return aggregateStats([], unitSize);
}
