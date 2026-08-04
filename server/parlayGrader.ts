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

import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { trackedBets, trackedBetLegs } from "../drizzle/schema";
import {
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

      if (out.result === "PENDING" || out.result === "NO_RESULT") continue;

      await db
        .update(trackedBetLegs)
        .set({
          result:    out.result as BetResult,
          awayScore: out.awayScore != null ? String(out.awayScore) : null,
          homeScore: out.homeScore != null ? String(out.homeScore) : null,
        })
        .where(eq(trackedBetLegs.id, leg.id));

      summary.legsSettled++;
      console.log(
        `${TAG}[STATE] leg ${leg.id} (ticket ${leg.betId} leg ${leg.legIndex + 1}) -> ${out.result}: ${out.reason}`,
      );
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
      if (settlement.result === ticket.result && settlement.odds === ticket.odds) continue;

      const risk = Number(ticket.risk);
      const patch: Record<string, unknown> = { result: settlement.result };

      if (settlement.odds != null) {
        patch.odds = settlement.odds;
        // toWin follows the repriced odds, so the ticket never displays one
        // price while paying another. Units track it for the same reason.
        const toWin = calcParlayToWin(risk, settlement.odds);
        patch.toWin = toWin.toFixed(2);
        if (ticket.riskUnits != null) {
          const unitSize = risk / Number(ticket.riskUnits);
          if (Number.isFinite(unitSize) && unitSize > 0) {
            patch.toWinUnits = (toWin / unitSize).toFixed(2);
          }
        }
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
