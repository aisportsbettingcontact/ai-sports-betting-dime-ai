/**
 * parlayGrader.ts — settle parlay tickets from their legs.
 *
 * WHY THIS IS A SEPARATE SWEEP
 *
 * Straight bets are graded by `gradePendingRows`, which selects PENDING rows
 * for a given gameDate. A parlay cannot work that way. Its parent row carries
 * the LAST leg's date (so the stuck-bet alarm doesn't fire while earlier legs
 * are still waiting on later games), but its legs settle on their own dates,
 * days apart. Driving settlement off the parent's date would leave a leg
 * graded and the ticket untouched until the final game.
 *
 * So legs are graded on their own dates through `idx_tbl_result_date`, exactly
 * as straight bets are, and any ticket touched by a settled leg is then
 * re-folded. Because `settleParlay` is a pure function of current leg state,
 * re-folding a ticket that has not changed is a no-op — which is what makes it
 * safe to run on every cycle.
 */

import { and, eq, gt, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { trackedBets, trackedBetLegs } from "../drizzle/schema";
import {
  fetchScores,
  gradeTrackedBet,
  type Sport as GraderSport,
  type Timeframe as GraderTimeframe,
  type Market as GraderMarket,
  type PickSide as GraderPickSide,
} from "./scoreGrader";
import { settleParlay, calcParlayToWin, type ParlayLeg } from "./parlayCore";
import { effectiveLine, type BetResult, type Market, type PickSide, type Timeframe } from "./betTrackerCore";
import { invalidateStatsCacheForUser } from "./betTrackerStatsCache";

const TAG = "[ParlayGrade]";

/** A row of tracked_bet_legs, as the grader consumes it. */
type LegRow = typeof trackedBetLegs.$inferSelect;

/** A stranded leg joined to the ticket that owns it. */
interface StuckLegRow {
  legId: number; betId: number; userId: number; sport: string; gameDate: string;
  awayTeam: string | null; homeTeam: string | null;
}

export interface ParlayGradeSummary {
  date: string;
  legsExamined: number;
  legsSettled: number;
  ticketsExamined: number;
  ticketsSettled: number;
  errors: number;
  details: Array<{ betId: number; result: string; reason: string }>;
}

export function emptyParlaySummary(date: string): ParlayGradeSummary {
  return {
    date,
    legsExamined: 0,
    legsSettled: 0,
    ticketsExamined: 0,
    ticketsSettled: 0,
    errors: 0,
    details: [],
  };
}

/**
 * Grade every open leg on `date`, then re-fold each ticket those legs belong to.
 *
 * Returns a summary shaped like the straight-bet grader's so the two can be
 * reported and alarmed on together.
 */
export async function gradeParlaysForDate(date: string, trigger: string): Promise<ParlayGradeSummary> {
  const summary = emptyParlaySummary(date);
  const db = await getDb();
  if (!db) {
    console.log(`${TAG}[ERROR] gradeParlaysForDate: no database`);
    summary.errors++;
    return summary;
  }

  const openLegs = await db
    .select()
    .from(trackedBetLegs)
    .where(and(eq(trackedBetLegs.result, "PENDING"), eq(trackedBetLegs.gameDate, date)));

  summary.legsExamined = openLegs.length;
  if (openLegs.length === 0) {
    console.log(`${TAG}[STATE] gradeParlaysForDate: date=${date} trigger=${trigger} — no open legs`);
    return summary;
  }

  // ── 1. Settle individual legs ───────────────────────────────────────────────
  const touchedBetIds = new Set<number>();
  for (const leg of openLegs) {
    touchedBetIds.add(leg.betId);
    try {
      if (await gradeLeg(leg)) summary.legsSettled++;
    } catch (err) {
      summary.errors++;
      console.log(`${TAG}[ERROR] leg ${leg.id} (ticket ${leg.betId}): ${(err as Error).message}`);
    }
  }

  // ── 2. Re-fold every touched ticket ─────────────────────────────────────────
  await settleTickets(Array.from(touchedBetIds), summary);

  console.log(
    `${TAG}[OUTPUT] gradeParlaysForDate: date=${date} trigger=${trigger} ` +
    `legs=${summary.legsExamined} legsSettled=${summary.legsSettled} ` +
    `tickets=${summary.ticketsExamined} ticketsSettled=${summary.ticketsSettled} errors=${summary.errors}`,
  );
  return summary;
}

/**
 * Grade EVERY open leg regardless of date, then re-fold every ticket that has
 * an open leg or is still PENDING.
 *
 * WHY THIS EXISTS
 *
 * `gradeParlaysForDate` only ever ran for today and yesterday, because that is
 * the window `runBetGradeCycle` sweeps. Straight bets have a catch-all —
 * `gradeAllPendingAllDates` — for exactly the case that window misses: an
 * outage, a container restart across midnight, a feed that was down for two
 * days, or a bet logged for a date already outside the window. Legs had no
 * equivalent, so any leg that fell out of that two-day window was never looked
 * at again and its ticket stayed PENDING forever.
 *
 * It also re-folds tickets whose legs are ALL already terminal. A ticket only
 * settles as a side effect of one of its legs being graded, so a single failed
 * or interrupted `settleTickets` call would otherwise strand a fully-decided
 * ticket permanently — nothing would ever revisit it.
 */
export async function gradeAllParlaysAllDates(trigger: string): Promise<ParlayGradeSummary> {
  const summary = emptyParlaySummary("ALL");
  const db = await getDb();
  if (!db) {
    console.log(`${TAG}[ERROR] gradeAllParlaysAllDates: no database`);
    summary.errors++;
    return summary;
  }

  const openLegs = await db
    .select()
    .from(trackedBetLegs)
    .where(eq(trackedBetLegs.result, "PENDING"));

  summary.legsExamined = openLegs.length;
  console.log(`${TAG}[INPUT] gradeAllParlaysAllDates: trigger=${trigger} openLegs=${openLegs.length}`);

  // Warm the score cache once per (sport, date) rather than per leg.
  const pairs = new Set<string>(openLegs.map((l: LegRow) => `${l.sport}|${l.gameDate}`));
  await Promise.all(Array.from(pairs).map(async (p: string) => {
    const [sport, date] = p.split("|");
    try {
      await fetchScores(sport as GraderSport, date);
    } catch (err) {
      console.log(`${TAG}[ERROR] score pre-fetch failed: sport=${sport} date=${date} err=${(err as Error).message}`);
    }
  }));

  const touched = new Set<number>();
  for (const leg of openLegs) {
    touched.add(leg.betId);
    try {
      const settled = await gradeLeg(leg);
      if (settled) summary.legsSettled++;
    } catch (err) {
      summary.errors++;
      console.log(`${TAG}[ERROR] leg ${leg.id} (ticket ${leg.betId}): ${(err as Error).message}`);
    }
  }

  // Every still-PENDING ticket, not just the ones touched above. This is what
  // rescues a ticket whose legs are all terminal but which never got folded.
  const stillOpen = await db
    .select({ id: trackedBets.id })
    .from(trackedBets)
    .where(and(eq(trackedBets.result, "PENDING"), gt(trackedBets.legCount, 0)));
  for (const t of stillOpen) touched.add(t.id);

  await settleTickets(Array.from(touched), summary);

  console.log(
    `${TAG}[OUTPUT] gradeAllParlaysAllDates: trigger=${trigger} ` +
    `legs=${summary.legsExamined} legsSettled=${summary.legsSettled} ` +
    `tickets=${summary.ticketsExamined} ticketsSettled=${summary.ticketsSettled} errors=${summary.errors}`,
  );
  return summary;
}

/**
 * Grade one user's open parlay legs and re-fold their tickets.
 *
 * Backs the interactive "grade my bets" path. Without it that button excluded
 * parlay parents (correctly — they are not straight bets) and then did nothing
 * for legs, so a user could press it forever and never settle a ticket.
 */
export async function gradeParlaysForUser(userId: number, trigger: string): Promise<ParlayGradeSummary> {
  const summary = emptyParlaySummary("USER");
  const db = await getDb();
  if (!db) return summary;

  const tickets = await db
    .select({ id: trackedBets.id })
    .from(trackedBets)
    .where(and(eq(trackedBets.userId, userId), gt(trackedBets.legCount, 0)));
  if (tickets.length === 0) return summary;

  const ids = tickets.map((t: { id: number }) => t.id);
  const openLegs = await db
    .select()
    .from(trackedBetLegs)
    .where(and(eq(trackedBetLegs.result, "PENDING"), inArray(trackedBetLegs.betId, ids)));

  summary.legsExamined = openLegs.length;
  for (const leg of openLegs) {
    try {
      if (await gradeLeg(leg)) summary.legsSettled++;
    } catch (err) {
      summary.errors++;
      console.log(`${TAG}[ERROR] leg ${leg.id} (ticket ${leg.betId}): ${(err as Error).message}`);
    }
  }

  await settleTickets(ids, summary);
  console.log(
    `${TAG}[OUTPUT] gradeParlaysForUser: userId=${userId} trigger=${trigger} ` +
    `legs=${summary.legsExamined} legsSettled=${summary.legsSettled} ticketsSettled=${summary.ticketsSettled}`,
  );
  return summary;
}

/** Grade a single leg and persist its outcome. Returns true if it settled. */
async function gradeLeg(leg: {
  id: number; betId: number; legIndex: number; sport: string; gameDate: string;
  awayTeam: string | null; homeTeam: string | null; timeframe: string | null;
  market: string | null; pickSide: string | null; odds: number;
  line: string | null; anGameId: number | null; gameNumber: number | null;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const out = await gradeTrackedBet({
    sport:      leg.sport as GraderSport,
    gameDate:   leg.gameDate,
    awayTeam:   leg.awayTeam ?? "",
    homeTeam:   leg.homeTeam ?? "",
    timeframe:  (leg.timeframe ?? "FULL_GAME") as GraderTimeframe,
    market:     (leg.market ?? "ML") as GraderMarket,
    pickSide:   (leg.pickSide ?? "AWAY") as GraderPickSide,
    odds:       leg.odds,
    line:       effectiveLine(leg.line, null),
    anGameId:   leg.anGameId,
    gameNumber: (leg.gameNumber ?? 1) as 1 | 2,
  });

  if (out.result === "PENDING" || out.result === "NO_RESULT") return false;

  await db
    .update(trackedBetLegs)
    .set({
      result:    out.result as BetResult,
      awayScore: out.awayScore != null ? String(out.awayScore) : null,
      homeScore: out.homeScore != null ? String(out.homeScore) : null,
    })
    .where(eq(trackedBetLegs.id, leg.id));

  console.log(
    `${TAG}[STATE] leg ${leg.id} (ticket ${leg.betId} leg ${leg.legIndex + 1}) -> ${out.result}: ${out.reason}`,
  );
  return true;
}

/**
 * Legs that should have settled long ago.
 *
 * `checkStuckBets` watches tracked_bets and therefore cannot see these: a
 * ticket is dated by its LAST leg, so a leg stranded on an early date sits
 * inside the parent's alarm window for the whole life of the ticket and never
 * trips it.
 */
export async function findStuckLegs(thresholdHours = 36): Promise<Array<{
  legId: number; betId: number; userId: number; sport: string; gameDate: string;
  awayTeam: string | null; homeTeam: string | null; hoursPending: number;
}>> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({
      legId:    trackedBetLegs.id,
      betId:    trackedBetLegs.betId,
      userId:   trackedBets.userId,
      sport:    trackedBetLegs.sport,
      gameDate: trackedBetLegs.gameDate,
      awayTeam: trackedBetLegs.awayTeam,
      homeTeam: trackedBetLegs.homeTeam,
    })
    .from(trackedBetLegs)
    .innerJoin(trackedBets, eq(trackedBets.id, trackedBetLegs.betId))
    .where(and(eq(trackedBetLegs.result, "PENDING"), eq(trackedBets.result, "PENDING")));

  const now = Date.now();
  return rows
    .map((r: StuckLegRow) => ({
      ...r,
      // Measured from the END of the leg's game day, matching how the
      // straight-bet stuck check treats gameDate.
      hoursPending: (now - (Date.parse(`${r.gameDate}T23:59:59Z`))) / 3_600_000,
    }))
    .filter((r: StuckLegRow & { hoursPending: number }) => r.hoursPending >= thresholdHours);
}

/**
 * Fold the given tickets from their current leg state and write the result.
 *
 * Exported so a leg edited by hand can re-settle its ticket immediately rather
 * than waiting for the next sweep.
 */
export async function settleTickets(betIds: number[], summary: ParlayGradeSummary): Promise<void> {
  if (betIds.length === 0) return;
  const db = await getDb();
  if (!db) return;

  const tickets = await db
    .select()
    .from(trackedBets)
    .where(inArray(trackedBets.id, betIds));

  const allLegs = await db
    .select()
    .from(trackedBetLegs)
    .where(inArray(trackedBetLegs.betId, betIds));

  type LegRow = (typeof allLegs)[number];
  const legsByBet = new Map<number, LegRow[]>();
  for (const l of allLegs) {
    const list = legsByBet.get(l.betId);
    if (list) list.push(l);
    else legsByBet.set(l.betId, [l]);
  }

  for (const ticket of tickets) {
    summary.ticketsExamined++;
    try {
      const legs = legsByBet.get(ticket.id) ?? [];
      if (legs.length === 0) {
        console.log(`${TAG}[ERROR] ticket ${ticket.id} has legCount=${ticket.legCount} but no leg rows`);
        summary.errors++;
        continue;
      }

      // The price to reprice FROM. Older tickets predating originalOdds fall
      // back to the current odds, which is correct for a ticket that has never
      // been repriced.
      const original = ticket.originalOdds ?? ticket.odds;

      const modelLegs: ParlayLeg[] = legs
        .sort((a, b) => a.legIndex - b.legIndex)
        .map(l => ({
          legIndex:  l.legIndex,
          sport:     l.sport,
          gameDate:  l.gameDate,
          awayTeam:  l.awayTeam ?? "",
          homeTeam:  l.homeTeam ?? "",
          market:    (l.market ?? "ML") as Market,
          pickSide:  (l.pickSide ?? "AWAY") as PickSide,
          timeframe: (l.timeframe ?? "FULL_GAME") as Timeframe,
          odds:      l.odds,
          line:      l.line != null ? Number(l.line) : null,
          result:    l.result as BetResult,
        }));

      const settlement = settleParlay(modelLegs, original);

      // Nothing to write while the ticket is still open AND already PENDING.
      if (settlement.result === "PENDING" && ticket.result === "PENDING") continue;

      // Never walk a settled ticket back to PENDING. An owner may hand-set a
      // result the grader cannot reach (a game the feed never resolves), and a
      // sweep that reverted it would undo that correction every 30 minutes —
      // silently, and forever. A ticket leaves a terminal result only when a
      // human edits it.
      if (settlement.result === "PENDING" && ticket.result !== "PENDING") {
        console.log(
          `${TAG}[STATE] ticket ${ticket.id} left at ${ticket.result}: legs are open but the ` +
          `result was set outside the grader — not reverting`,
        );
        continue;
      }

      if (settlement.result === ticket.result && settlement.odds === ticket.odds) continue;

      const risk = Number(ticket.risk);
      const patch: Record<string, unknown> = { result: settlement.result };

      if (settlement.odds != null) {
        patch.odds = settlement.odds;
        // toWin follows the repriced odds, so the ticket never displays one
        // price while paying another. Units track it for the same reason.
        const toWin = calcParlayToWin(risk, settlement.odds);
        patch.toWin = toWin.toFixed(2);
        // toWinUnits has to move with the price or unit P&L keeps paying the
        // original odds. When it cannot be recomputed (no riskUnits, or a
        // degenerate unit size) it is cleared rather than left stale —
        // aggregateStats falls back to dollars/unitSize, which is right,
        // whereas a stale figure is silently wrong.
        const units = ticket.riskUnits != null ? Number(ticket.riskUnits) : NaN;
        const unitSize = Number.isFinite(units) && units > 0 ? risk / units : NaN;
        patch.toWinUnits =
          Number.isFinite(unitSize) && unitSize > 0 ? (toWin / unitSize).toFixed(2) : null;
      }

      await db.update(trackedBets).set(patch).where(eq(trackedBets.id, ticket.id));
      invalidateStatsCacheForUser(ticket.userId);

      summary.ticketsSettled++;
      summary.details.push({ betId: ticket.id, result: settlement.result, reason: settlement.reason });
      console.log(
        `${TAG}[STATE] ticket ${ticket.id} -> ${settlement.result} ` +
        `(${settlement.survivingLegs} surviving, ${settlement.droppedLegs} dropped): ${settlement.reason}`,
      );
    } catch (err) {
      summary.errors++;
      console.log(`${TAG}[ERROR] ticket ${ticket.id}: ${(err as Error).message}`);
    }
  }
}
