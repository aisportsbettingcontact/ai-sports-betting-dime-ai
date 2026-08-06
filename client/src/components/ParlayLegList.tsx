/**
 * ParlayLegList.tsx — the legs of a tracked parlay, as shown on its card.
 *
 * Two things this has to communicate that a straight bet never needs:
 *
 *   1. WHICH LEG KILLED THE TICKET. A parlay is all-or-nothing, so on a losing
 *      ticket the only interesting fact is the leg that lost. It is marked, and
 *      the surviving winners are visibly demoted so the eye lands on the cause.
 *   2. WHY THE PAYOUT CHANGED. A pushed leg is dropped and the ticket reprices
 *      at reduced odds. Without saying so, a user sees a number that is not the
 *      one they wrote down and has no way to find out why.
 *
 * Brand: one accent (mint) for wins, the single red token for losses, tokens
 * only, no gradients.
 */

import { Check, X, Minus, Clock } from "lucide-react";

export interface ParlayLegView {
  id: number;
  legIndex: number;
  awayTeam: string | null;
  homeTeam: string | null;
  gameDate: string;
  pick: string;
  odds: number;
  result: string;
  awayScore: string | null;
  homeScore: string | null;
}

const fmtOdds = (n: number): string => (n > 0 ? `+${n}` : String(n));

/** Colour + glyph per leg outcome. PUSH/VOID share the "dropped" treatment. */
function legStyle(result: string): { color: string; Icon: typeof Check; label: string } {
  switch (result) {
    case "WIN":
      return { color: "var(--dime-mint)", Icon: Check, label: "Won" };
    case "LOSS":
      return { color: "var(--bt-red)", Icon: X, label: "Lost" };
    case "PUSH":
    case "VOID":
      return { color: "var(--dime-text-muted)", Icon: Minus, label: "Dropped" };
    default:
      return { color: "var(--dime-text-muted)", Icon: Clock, label: "Open" };
  }
}

export default function ParlayLegList({
  legs,
  ticketResult,
  odds,
  originalOdds,
}: {
  legs: ParlayLegView[];
  ticketResult: string;
  odds: number;
  /** The price as entered. Differs from `odds` once a leg has been dropped. */
  originalOdds: number | null;
}) {
  if (legs.length === 0) return null;

  const dropped = legs.filter(l => l.result === "PUSH" || l.result === "VOID").length;
  const wasRepriced = originalOdds != null && originalOdds !== odds;
  const ticketLost = ticketResult === "LOSS";

  return (
    <div className="mt-2 flex flex-col gap-1">
      {legs
        .slice()
        .sort((a, b) => a.legIndex - b.legIndex)
        .map(leg => {
          const { color, Icon, label } = legStyle(leg.result);
          const isDropped = leg.result === "PUSH" || leg.result === "VOID";
          const killedIt = ticketLost && leg.result === "LOSS";
          // On a lost ticket the losing leg is the whole story; everything else
          // is context, so it recedes.
          const demoted = ticketLost && !killedIt;

          return (
            <div
              key={leg.id}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px]"
              style={{
                background: killedIt
                  ? "color-mix(in srgb, var(--bt-red) 8%, transparent)"
                  : "transparent",
                opacity: demoted ? 0.55 : 1,
                transition: "opacity var(--dime-t, 160ms) var(--dime-ease, ease)",
              }}
            >
              <Icon size={12} style={{ color }} aria-hidden />
              <span className="sr-only">{label}:</span>
              <span
                className="min-w-0 flex-1 truncate"
                style={{ textDecoration: isDropped ? "line-through" : undefined }}
              >
                {leg.pick}
                <span className="bt-faint"> · {leg.awayTeam}@{leg.homeTeam}</span>
              </span>
              {leg.awayScore != null && leg.homeScore != null && (
                <span className="bt-faint bt-num shrink-0 text-[11px]">
                  {leg.awayScore}-{leg.homeScore}
                </span>
              )}
              <span className="bt-num shrink-0 font-semibold" style={{ color }}>
                {fmtOdds(leg.odds)}
              </span>
            </div>
          );
        })}

      {/* The payout moved, and the user is owed the reason. */}
      {wasRepriced && (
        <div
          className="mt-1 rounded-lg px-2 py-1.5 text-[11px]"
          style={{
            background: "var(--dime-surface-card)",
            border: "1px solid var(--dime-border)",
          }}
        >
          <span className="bt-dim">
            {dropped === 1 ? "1 leg pushed" : `${dropped} legs pushed`} — repriced{" "}
          </span>
          <span className="bt-num" style={{ textDecoration: "line-through", opacity: 0.6 }}>
            {fmtOdds(originalOdds!)}
          </span>
          <span className="bt-dim"> → </span>
          <span className="bt-num font-bold" style={{ color: "var(--dime-mint)" }}>
            {fmtOdds(odds)}
          </span>
        </div>
      )}
    </div>
  );
}
