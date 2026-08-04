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
  ticketOddsManual,
  onTicketOddsManualChange,
  risk,
  onRiskChange,
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
  ticketOddsManual: boolean;
  onTicketOddsManualChange: (v: boolean) => void;
  risk: string;
  onRiskChange: (v: string) => void;
  stakeMode: "$" | "U";
  unitSize: number;
  onSubmit: () => void;
  isPending: boolean;
  error: string | null;
}) {
  const suggested = suggestPrice(legs);
  const parsedOdds = parseInt(ticketOdds, 10);
  const oddsValid = Number.isFinite(parsedOdds) && Math.abs(parsedOdds) >= 100;

  const riskNum = parseFloat(risk);
  const riskValid = Number.isFinite(riskNum) && riskNum > 0;
  const riskDollars = stakeMode === "U" ? riskNum * unitSize : riskNum;
  const toWin = oddsValid && riskValid ? calcParlayToWin(riskDollars, parsedOdds) : null;

  const enough = legs.length >= MIN_PARLAY_LEGS;
  const full = legs.length >= MAX_PARLAY_LEGS;
  const canSubmit = enough && oddsValid && riskValid && !isPending;

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
        <div className="flex items-center justify-between">
          <label htmlFor="bt-parlay-odds" className="bt-label">
            Ticket odds
          </label>
          {ticketOddsManual && suggested != null && (
            <button
              type="button"
              onClick={() => onTicketOddsManualChange(false)}
              className="bt-press text-[11px] underline"
              style={{ color: "var(--dime-mint)" }}
            >
              use calculated {fmtOdds(suggested)}
            </button>
          )}
        </div>
        <input
          id="bt-parlay-odds"
          inputMode="numeric"
          value={ticketOdds}
          onChange={e => {
            onTicketOddsChange(e.target.value);
            onTicketOddsManualChange(true);
          }}
          placeholder={enough ? "" : "add two legs"}
          className="bt-input bt-num w-full"
          style={ticketOddsManual ? { borderColor: "var(--dime-mint-border)" } : undefined}
        />
        <span className="bt-faint text-[11px]">
          {!enough
            ? `A parlay needs at least ${MIN_PARLAY_LEGS} legs.`
            : ticketOddsManual
              ? "Using your price. Same-game and boosted tickets price differently from the legs, and the price you enter is what settles."
              : `Calculated from ${legs.length} legs. Edit it if your book quoted something else — that price is what settles.`}
        </span>
      </div>

      {/* ── Stake — ONE per ticket, not per leg ───────────────────────────── */}
      <div className="flex flex-col gap-1">
        <label htmlFor="bt-parlay-risk" className="bt-label">
          {stakeMode === "U" ? "Risk (U)" : "Risk ($)"}
        </label>
        <input
          id="bt-parlay-risk"
          type="number"
          inputMode="decimal"
          value={risk}
          onChange={e => onRiskChange(e.target.value)}
          placeholder={stakeMode === "U" ? "2" : "200"}
          min={0}
          step={stakeMode === "U" ? "0.5" : "10"}
          aria-label={stakeMode === "U" ? "Risk amount in units for the whole ticket" : "Risk amount in dollars for the whole ticket"}
          className="bt-input bt-num w-full"
        />
        <span className="bt-faint text-[11px]">
          One stake on the whole ticket — legs are not staked separately.
        </span>
      </div>

      {/* ── Payout ────────────────────────────────────────────────────────── */}
      {toWin != null && (
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
      {enough && !oddsValid && ticketOdds.trim() !== "" && (
        <span className="bt-faint text-[11px]">
          Odds must be American — at least +100 or -100.
        </span>
      )}
      {enough && oddsValid && !riskValid && (
        <span className="bt-faint text-[11px]">Enter a stake for the ticket.</span>
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
