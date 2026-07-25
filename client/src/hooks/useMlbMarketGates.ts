/**
 * useMlbMarketGates — M-201 publication-gate revival (client side).
 *
 * Reads the per-market PUBLISH / BACKTEST-ONLY verdicts surfaced by
 * games.mlbMarketGates (server: loadMlbMarketGates over the
 * mlb_calibration_constants publish_* rows, cached 5 minutes server-side).
 *
 * FAIL-OPEN CONTRACT: every flag defaults to TRUE — placeholderData renders
 * instantly and any query failure falls back to the same defaults — so
 * nothing flickers or breaks, and behavior is unchanged until the audit's
 * Phase 7 writes BACKTEST-ONLY verdicts.
 *
 * applyMlbMarketGates() is the one shared enforcement transform: for an MLB
 * game row it nulls the model-output fields of every gated market, which
 * routes each consumer through its existing "model value absent" rendering
 * (the same path used when modelRunAt is null). When all gates are true it
 * returns the input object unchanged (reference-equal — zero re-render cost).
 */
import { useMemo } from "react";
import { trpc } from "@/lib/trpc";

export interface MlbMarketGates {
  publish_fg_ml: boolean;
  publish_fg_rl: boolean;
  publish_fg_total: boolean;
  publish_f5_ml: boolean;
  publish_f5_rl: boolean;
  publish_f5_total: boolean;
  publish_nrfi_yrfi: boolean;
  publish_k_props: boolean;
  publish_hr_props: boolean;
}

export const DEFAULT_MLB_MARKET_GATES: MlbMarketGates = {
  publish_fg_ml: true,
  publish_fg_rl: true,
  publish_fg_total: true,
  publish_f5_ml: true,
  publish_f5_rl: true,
  publish_f5_total: true,
  publish_nrfi_yrfi: true,
  publish_k_props: true,
  publish_hr_props: true,
};

export function useMlbMarketGates(): MlbMarketGates {
  const query = trpc.games.mlbMarketGates.useQuery(undefined, {
    // placeholderData (not initialData) so the defaults render instantly
    // while the real gates still fetch immediately on first mount.
    placeholderData: DEFAULT_MLB_MARKET_GATES,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  return useMemo(
    () => ({ ...DEFAULT_MLB_MARKET_GATES, ...(query.data ?? {}) }) as MlbMarketGates,
    [query.data]
  );
}

// ─── Gated model-output fields per market ────────────────────────────────────
// Field names match the games table columns delivered by games.list.

const FG_ML_FIELDS = [
  "modelAwayML",
  "modelHomeML",
  "modelAwayWinPct",
  "modelHomeWinPct",
] as const;

const FG_RL_FIELDS = [
  "modelAwaySpreadOdds",
  "modelHomeSpreadOdds",
  "modelAwayPLOdds",
  "modelHomePLOdds",
  "awayModelSpread",
  "homeModelSpread",
  "spreadDiff",
  "modelCoverDirection",
] as const;

const FG_TOTAL_FIELDS = [
  "modelTotal",
  "modelOverRate",
  "modelUnderRate",
  "modelOverOdds",
  "modelUnderOdds",
  "totalDiff",
  "modelProjTotal",
  "modelWeatherAdj",
] as const;

const F5_ML_FIELDS = [
  "modelF5AwayML",
  "modelF5HomeML",
  "modelF5AwayWinPct",
  "modelF5HomeWinPct",
  // F5 push is part of the three-way F5 ML presentation.
  "modelF5PushPct",
  "modelF5PushRaw",
] as const;

const F5_RL_FIELDS = [
  "modelF5AwayRlOdds",
  "modelF5HomeRlOdds",
  "modelF5AwayRLCoverPct",
  "modelF5HomeRLCoverPct",
] as const;

const F5_TOTAL_FIELDS = [
  "modelF5Total",
  "modelF5OverRate",
  "modelF5UnderRate",
  "modelF5OverOdds",
  "modelF5UnderOdds",
  "modelF5AwayScore",
  "modelF5HomeScore",
] as const;

const NRFI_YRFI_FIELDS = [
  "modelPNrfi",
  "modelNrfiOdds",
  "modelYrfiOdds",
  "nrfiFilterPass",
  "nrfiCombinedSignal",
] as const;

/**
 * Null the model-output fields of every gated market on an MLB game row.
 * Non-MLB rows (and rows with no gated markets) are returned unchanged,
 * reference-equal. K/HR props live in separate tables and are gated at the
 * section level, not here.
 */
export function applyMlbMarketGates<T extends object>(
  game: T,
  gates: MlbMarketGates
): T {
  const row = game as unknown as Record<string, unknown>;
  if (row.sport !== "MLB") return game;

  const gatedGroups: Array<[boolean, readonly string[]]> = [
    [gates.publish_fg_ml, FG_ML_FIELDS],
    [gates.publish_fg_rl, FG_RL_FIELDS],
    [gates.publish_fg_total, FG_TOTAL_FIELDS],
    [gates.publish_f5_ml, F5_ML_FIELDS],
    [gates.publish_f5_rl, F5_RL_FIELDS],
    [gates.publish_f5_total, F5_TOTAL_FIELDS],
    [gates.publish_nrfi_yrfi, NRFI_YRFI_FIELDS],
  ];

  let out: Record<string, unknown> | null = null;
  for (const [published, fields] of gatedGroups) {
    if (published) continue;
    for (const field of fields) {
      const source = out ?? row;
      if (source[field] != null) {
        if (out == null) out = { ...row };
        out[field] = null;
      }
    }
  }

  return (out ?? row) as unknown as T;
}
