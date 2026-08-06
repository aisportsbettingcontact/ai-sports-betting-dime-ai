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

import { X, AlertCircle, Layers, Pencil } from "lucide-react";
import {
  MAX_PARLAY_LEGS,
  MIN_PARLAY_LEGS,
  combineLegOdds,
  calcParlayToWin,
} from "@shared/parlayPricing";
import { deriveTicketWagerType, type WagerType } from "../pages/betTrackerEntry";
import { fmtDate } from "../pages/betTrackerDisplay";

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
  /** Stamped when the leg is added — the wager type it was priced under. */
  wagerType: WagerType;
  awayLogo: string | null;
  homeLogo: string | null;
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
  onEditLeg,
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
  /** Load this leg back into the add-bet form for editing (and remove it here). */
  onEditLeg: (index: number) => void;
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
  /** The ticket's label comes from its legs, not from any toggle. */
  const ticketWager: WagerType = deriveTicketWagerType(legs.map(l => l.wagerType));

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
          <ul className="flex flex-col gap-2">
            {legs.map((leg, i) => (
              <li
                key={`${leg.anGameId}-${leg.market}-${leg.pickSide}-${i}`}
                className="bt-row-hover flex items-center gap-3 rounded-[10px] px-3 py-3"
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
                {/* Team logos — a TOTAL is not a team claim, so it shows none
                    (same rule BetCard uses). */}
                {leg.market !== "TOTAL" && (leg.awayLogo || leg.homeLogo) && (
                  <span className="flex shrink-0 items-center" aria-hidden>
                    {leg.awayLogo && (
                      <img src={leg.awayLogo} alt="" width={20} height={20} className="rounded-full" />
                    )}
                    {leg.homeLogo && (
                      <img src={leg.homeLogo} alt="" width={20} height={20} className="-ml-2 rounded-full" />
                    )}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold">{leg.label}</div>
                  <div className="bt-dim truncate text-[12px]">
                    {leg.awayTeam} @ {leg.homeTeam} · {fmtDate(leg.gameDate)}
                  </div>
                </div>
                <span
                  className="shrink-0 text-[10px] font-bold uppercase"
                  style={{
                    letterSpacing: "0.08em",
                    color: leg.wagerType === "LIVE" ? "var(--dime-mint)" : "var(--dime-text-muted)",
                  }}
                >
                  {leg.wagerType === "LIVE" ? "LIVE" : "PRE"}
                </span>
                <span className="bt-num shrink-0 text-[16px] font-bold">
                  {fmtOdds(leg.odds)}
                </span>
                <button
                  type="button"
                  onClick={() => onEditLeg(i)}
                  aria-label={`Edit leg ${i + 1}: ${leg.label}`}
                  className="bt-press shrink-0 rounded-md p-2 transition-colors"
                  style={{ color: "var(--dime-text-muted)" }}
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveLeg(i)}
                  aria-label={`Remove leg ${i + 1}: ${leg.label}`}
                  className="bt-press shrink-0 rounded-md p-2 transition-colors"
                  style={{ color: "var(--dime-text-muted)" }}
                >
                  <X size={14} />
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
      </div>

      {/* ── Review — the last look before the ticket is tracked ───────────── */}
      {toWin != null && (
        <div
          className="flex flex-col gap-1.5 rounded-[10px] px-3 py-3"
          style={{
            background: "var(--dime-surface-card)",
            border: "1px solid var(--dime-border)",
          }}
        >
          <div className="flex items-center justify-between">
            <span className="bt-label">
              {legs.length} legs · {ticketWager === "LIVE" ? "LIVE" : "PREGAME"}
            </span>
            <span className="bt-num text-[13px] font-bold">{oddsValid ? fmtOdds(parsedOdds) : ""}</span>
          </div>
          <div className="flex items-center justify-between text-[15px]">
            <span className="bt-dim">Risking {fmtStake(riskDollars)} to win</span>
            <span className="bt-num font-bold" style={{ color: "var(--dime-mint)" }}>
              {fmtStake(toWin)}
            </span>
          </div>
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
