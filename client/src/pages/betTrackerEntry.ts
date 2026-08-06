/**
 * betTrackerEntry.ts — entry-time decisions for the add-bet form.
 *
 * The Action Network slate serves ONE odds snapshot per game: pregame lines
 * before first pitch, the book's CURRENT (live) lines while in progress,
 * closing lines after. The form must never present one as the other, so the
 * autofill decision lives here as a pure function of (game status, wager
 * type) — testable, and shared by the straight path and the leg path.
 *
 * The other two decisions keep a parlay ticket honest: legs are stamped with
 * the wager type they were priced under, a ticket cannot mix pregame and
 * live legs, and the submitted ticket's wagerType derives from its legs
 * rather than from whatever the toggle reads at submit time.
 */

export type WagerType = "PREGAME" | "LIVE";
export type GameStatus = "scheduled" | "in_progress" | "complete" | string;

export function decideEntrySource(
  status: GameStatus,
  wagerType: WagerType
): {
  /** May odds/lines fill from the slate for this (game, wager type)? */
  autofill: boolean;
  /** May LIVE be chosen for this game at all? */
  liveSelectable: boolean;
  /** Chip shown beside autofilled odds; null when entry is manual. */
  sourceLabel: "PRE" | "LIVE" | null;
} {
  if (status === "in_progress") {
    return wagerType === "LIVE"
      ? { autofill: true, liveSelectable: true, sourceLabel: "LIVE" }
      : { autofill: false, liveSelectable: true, sourceLabel: null };
  }
  if (status === "complete") {
    return wagerType === "PREGAME"
      ? { autofill: true, liveSelectable: true, sourceLabel: "PRE" }
      : { autofill: false, liveSelectable: true, sourceLabel: null };
  }
  // "scheduled" — and any status this code does not recognize, which must
  // fail safe as "not started": pregame lines only, no live wagers yet.
  return wagerType === "PREGAME"
    ? { autofill: true, liveSelectable: false, sourceLabel: "PRE" }
    : { autofill: false, liveSelectable: false, sourceLabel: null };
}

/** Selecting a game sets the toggle to what the game can actually be. */
export function defaultWagerType(status: GameStatus): WagerType {
  return status === "in_progress" ? "LIVE" : "PREGAME";
}

/** One ticket is placed at one moment: pregame and live legs cannot share it. */
export function checkLegCoherence(
  existing: WagerType[],
  adding: WagerType
): { ok: true } | { ok: false; message: string } {
  if (existing.length === 0 || existing.every(w => w === adding))
    return { ok: true };
  return {
    ok: false,
    message:
      adding === "LIVE"
        ? "This ticket has pregame legs. A live leg goes on its own ticket."
        : "This ticket has live legs. A pregame leg goes on its own ticket.",
  };
}

/** The ticket's stored wagerType comes from its legs, not the toggle. */
export function deriveTicketWagerType(legs: WagerType[]): WagerType {
  return legs.length > 0 && legs.every(w => w === "LIVE") ? "LIVE" : "PREGAME";
}
