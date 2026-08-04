/**
 * ParlayBuilder.tsx — the ticket half of parlay entry.
 *
 * The Add Bet card already knows how to pick a game, market, side and price.
 * In parlay mode that same form produces a LEG instead of a bet, and this
 * component owns everything above and below it: the legs collected so far, the
 * ticket price, the single stake, and the submit.
 *
 * It lives in its own file rather than inside BetTracker.tsx, which is already
 * 5,300 lines and slated for decomposition.
 *
 * Brand: every colour, radius and duration comes from the Dime tokens in
 * design-system/dime-ai/MASTER.md via the bt-* recipes and --dime-* variables.
 * One accent (mint), no gradients, 160ms motion.
 */

import { X, AlertCircle, Layers } from "lucide-react";
import {
  MAX_PARLAY_LEGS,
  MIN_PARLAY_LEGS,
  combineLegOdds,
  calcParlayToWin,
} from "@shared/parlayPricing";

export interface DraftLeg {
  anGameId: number;
  gameNumber: number;
  sport: string;
  gameDate: string;
  awayTeam: string;
  homeTeam: string;
  market: "ML" | "RL" | "TOTAL";
  pickSide: "AWAY" | "HOME" | "OVER" | "UNDER";
  timeframe: string;
  line: number | null;
  odds: number;
  /** Display label, derived where the leg is built. */
  label: string;
}

const fmtOdds = (n: number): string => (n > 0 ? `+${n}` : String(n));

/**
 * The price these legs multiply out to, or null when it cannot be computed.
 *
 * Only ever a SUGGESTION. The user enters what their book actually gave them,
 * and that entered price is what the ticket settles at — which matters because
 * a correlated same-game price or a boost is deliberately not the product of
 * its legs, and this contract allows both.
 */
export function suggestPrice(legs: DraftLeg[]): number | null {
  if (legs.length < MIN_PARLAY_LEGS) return null;
  try {
    return combineLegOdds(legs.map(l => l.odds));
  } catch {
    return null;
  }
}

export default function ParlayBuilder({
  legs,
  onRemoveLeg,
  ticketOdds,
  onTicketOddsChange,
  risk,
  stakeMode,
  unitSize,
  onSubmit,
  isPending,
  error,
}: {
  legs: DraftLeg[];
  onRemoveLeg: (index: number) => void;
  ticketOdds: string;
  onTicketOddsChange: (v: string) => void;
  risk: number;
  stakeMode: "$" | "U";
  unitSize: number;
  onSubmit: () => void;
  isPending: boolean;
  error: string | null;
}) {
  const suggested = suggestPrice(legs);
  const parsedOdds = parseInt(ticketOdds, 10);
  const oddsValid = Number.isFinite(parsedOdds) && Math.abs(parsedOdds) >= 100;

  const riskDollars = stakeMode === "U" ? risk * unitSize : risk;
  const toWin = oddsValid ? calcParlayToWin(riskDollars, parsedOdds) : null;

  const enough = legs.length >= MIN_PARLAY_LEGS;
  const full = legs.length >= MAX_PARLAY_LEGS;
  const canSubmit = enough && oddsValid && risk > 0 && !isPending;

  const fmtStake = (dollars: number): string =>
    stakeMode === "$"
      ? `$${dollars.toFixed(2)}`
      : `${(unitSize > 0 ? dollars / unitSize : dollars).toFixed(2)}u`;

  return (
    <div className="flex flex-col gap-3">
      {/* ── Legs collected so far ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="bt-label">
            Legs ({legs.length}/{MAX_PARLAY_LEGS})
          </span>
          {full && (
            <span className="bt-faint text-[11px]">Maximum reached</span>
          )}
        </div>

        {legs.length === 0 ? (
          <div
            className="flex items-center gap-2 rounded-[10px] px-3 py-3 bt-faint text-xs"
            style={{ border: "1px dashed var(--dime-border)" }}
          >
            <Layers size={14} />
            Pick a game above and add it as your first leg.
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {legs.map((leg, i) => (
              <li
                key={`${leg.anGameId}-${leg.market}-${leg.pickSide}-${i}`}
                className="bt-row-hover flex items-center gap-2 rounded-[10px] px-3 py-2"
                style={{
                  background: "var(--dime-surface-card)",
                  border: "1px solid var(--dime-border)",
                }}
              >
                <span
                  className="bt-num shrink-0 text-[11px] font-bold"
                  style={{ color: "var(--dime-mint)" }}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{leg.label}</div>
                  <div className="bt-faint truncate text-[11px]">
                    {leg.awayTeam} @ {leg.homeTeam} · {leg.gameDate}
                  </div>
                </div>
                <span className="bt-num shrink-0 text-[13px] font-bold">
                  {fmtOdds(leg.odds)}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveLeg(i)}
                  aria-label={`Remove leg ${i + 1}: ${leg.label}`}
                  className="bt-press shrink-0 rounded-md p-1 transition-colors"
                  style={{ color: "var(--dime-text-muted)" }}
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Ticket price ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1">
        <label htmlFor="bt-parlay-odds" className="bt-label">
          Ticket odds
        </label>
        <div className="flex items-center gap-2">
          <input
            id="bt-parlay-odds"
            inputMode="numeric"
            value={ticketOdds}
            onChange={e => onTicketOddsChange(e.target.value)}
            placeholder={suggested != null ? fmtOdds(suggested) : "+264"}
            className="bt-input bt-num w-full"
          />
          {suggested != null && parsedOdds !== suggested && (
            <button
              type="button"
              onClick={() => onTicketOddsChange(String(suggested))}
              className="bt-press shrink-0 rounded-[10px] px-2.5 py-2 text-[11px] font-semibold tracking-wider transition-colors"
              style={{
                color: "var(--dime-mint-on-light, var(--dime-mint))",
                border: "1px solid var(--dime-border)",
              }}
            >
              USE {fmtOdds(suggested)}
            </button>
          )}
        </div>
        <span className="bt-faint text-[11px]">
          {suggested != null
            ? `These legs multiply to ${fmtOdds(suggested)}. Enter what your book actually paid — same-game and boosted tickets price differently, and the entered price is what settles.`
            : "Add at least two legs to see a suggested price."}
        </span>
      </div>

      {/* ── Payout ────────────────────────────────────────────────────────── */}
      {toWin != null && risk > 0 && (
        <div
          className="flex items-center justify-between rounded-[10px] px-3 py-2 text-[13px]"
          style={{
            background: "var(--dime-surface-card)",
            border: "1px solid var(--dime-border)",
          }}
        >
          <span className="bt-dim">Risking {fmtStake(riskDollars)} to win</span>
          <span className="bt-num font-bold" style={{ color: "var(--dime-mint)" }}>
            {fmtStake(toWin)}
          </span>
        </div>
      )}

      {/* ── Why submit is blocked ─────────────────────────────────────────── */}
      {!enough && legs.length > 0 && (
        <span className="bt-faint text-[11px]">
          A parlay needs at least {MIN_PARLAY_LEGS} legs.
        </span>
      )}
      {enough && !oddsValid && ticketOdds.trim() !== "" && (
        <span className="bt-faint text-[11px]">
          Odds must be American, at least +100 or -100.
        </span>
      )}

      {error && (
        <div className="bt-dim flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
             style={{ border: "1px solid var(--dime-border)" }}>
          <AlertCircle size={13} />
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit}
        className="bg-primary bt-press w-full rounded-xl py-3 text-sm font-bold tracking-wider text-black transition-all hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isPending ? "Saving…" : `TRACK ${legs.length}-LEG PARLAY`}
      </button>
    </div>
  );
}
