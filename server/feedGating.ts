import type { Request } from "express";
import { parse as parseCookieHeader } from "cookie";
import { verifyAppUserToken, APP_USER_COOKIE } from "./routers/appUsers";

/**
 * Feed IP gating (Phase 3, credential-protected data).
 *
 * The proprietary product is the MODEL: projections, win probabilities, edges,
 * fair odds. Schedules, book lines, and betting splits are commodity facts
 * anyone can get from a sportsbook — those stay public. For ANONYMOUS callers
 * we null the model fields at the wire layer (like the existing NCAAM
 * publishedModel gate and stripSportNullFields) so a direct API scrape returns
 * only commodity data. Authenticated callers get the full payload — the logged
 * -in UX is unchanged (the feed surface is already RequireAuth-gated).
 *
 * Amends the previously-public data contract (ai-model-projections.md /
 * DIME-FEED-MIGRATION-DRAFT.md) — owner-ratified via the PR.
 */

/** Is this request from a logged-in app user? (cookie + JWT verify, no DB hit.) */
export async function isRequestAuthenticated(req: Request): Promise<boolean> {
  try {
    const header = req?.headers?.cookie;
    if (!header) return false;
    const token = parseCookieHeader(header)[APP_USER_COOKIE];
    if (!token) return false;
    return (await verifyAppUserToken(token)) != null;
  } catch {
    return false;
  }
}

// Proprietary Game fields whose NAMES do NOT contain "model" (so the
// includes-"model" rule below misses them). Verified against the model-field
// inventory (db.ts MODEL_FIELDS, routers.ts stripSportNullFields) + a leak
// audit: edges/diffs, the NRFI edge signal + pass flag, the Brier scores
// (which algebraically reconstruct the nulled model probabilities on completed
// games), and the model-correctness flags (reveal the model's pick direction).
// Actual game RESULTS (fgMlResult, actual* scores) stay public — commodity.
const PROPRIETARY_GAME_FIELDS = [
  "spreadEdge",
  "spreadDiff",
  "totalEdge",
  "totalDiff",
  "nrfiCombinedSignal",
  "nrfiFilterPass",
  "brierFgTotal",
  "brierF5Total",
  "brierNrfi",
  "brierFgMl",
  "brierF5Ml",
  "fgMlCorrect",
  "fgRlCorrect",
  "fgTotalCorrect",
  "f5MlCorrect",
  "f5RlCorrect",
  "f5TotalCorrect",
  "nrfiCorrect",
] as const;

/**
 * Null the proprietary model IP on a Game row for an anonymous caller.
 * Strips every field whose name contains "model" (case-insensitive — covers
 * `modelTotal`, `awayModelSpread`, `modelF5*`, `modelPNrfi`, `modelPHr`, and
 * anything added later) PLUS the explicit `PROPRIETARY_GAME_FIELDS` that carry
 * IP without a "model" token. Keeps schedule, book lines, splits, lineups, and
 * actual results (commodity/public — none contain "model").
 */
export function stripGameModelFields<T extends Record<string, unknown>>(
  row: T
): T {
  const copy = { ...row } as Record<string, unknown>;
  for (const key of Object.keys(copy)) {
    if (key.toLowerCase().includes("model")) copy[key] = null;
  }
  for (const f of PROPRIETARY_GAME_FIELDS) {
    if (f in copy) copy[f] = null;
  }
  return copy as T;
}

/** Shared: null model* fields (prefix rule) + an explicit proprietary list. */
function stripByModelRuleAndList<T extends Record<string, unknown>>(
  row: T,
  extra: readonly string[]
): T {
  const copy = { ...row } as Record<string, unknown>;
  for (const key of Object.keys(copy)) {
    if (key.toLowerCase().includes("model")) copy[key] = null;
  }
  for (const f of extra) {
    if (f in copy) copy[f] = null;
  }
  return copy as T;
}

// Strikeout-prop proprietary fields WITHOUT a "model" token (the prefix rule
// catches modelOverOdds/modelUnderOdds/modelError/modelCorrect/modelRunAt). NOTE
// kLine is the MODEL-recommended line (schema: "Model recommended line") — IP;
// bookLine is the commodity book line and stays.
const STRIKEOUT_PROPRIETARY_FIELDS = [
  "kProj",
  "kMedian",
  "kP5",
  "kP95",
  "kLine",
  "kPer9",
  "pOver",
  "pUnder",
  "edgeOver",
  "edgeUnder",
  "verdict",
  "bestEdge",
  "bestSide",
  "bestMlStr",
  "signalBreakdown",
  "distribution",
  "matchupRows",
  "inningBreakdown",
] as const;

export function stripStrikeoutPropModelFields<
  T extends Record<string, unknown>,
>(row: T): T {
  return stripByModelRuleAndList(row, STRIKEOUT_PROPRIETARY_FIELDS);
}

// HR-prop proprietary fields without a "model" token (prefix rule catches
// modelPHr/modelOverOdds/modelCorrect/modelRunAt).
const HR_PROPRIETARY_FIELDS = ["edgeOver", "evOver", "verdict"] as const;

export function stripHrPropModelFields<T extends Record<string, unknown>>(
  row: T
): T {
  return stripByModelRuleAndList(row, HR_PROPRIETARY_FIELDS);
}

// WC2026 matchup proprietary fields WITHOUT a "model" token (prefix rule
// catches modelOdds/modelVersion). The projection object + its derived
// odds/edges/probs/scores.
const WC_PROPRIETARY_FIELDS = [
  "projection",
  "homeEdge",
  "drawEdge",
  "awayEdge",
  "homeWinProb",
  "drawProb",
  "awayWinProb",
  "projHomeScore",
  "projAwayScore",
  "projTotal",
  "isFrozen",
  "frozenAt",
] as const;

export function stripWcMatchupModelFields<T extends Record<string, unknown>>(
  row: T
): T {
  return stripByModelRuleAndList(row, WC_PROPRIETARY_FIELDS);
}

/**
 * Cache headers for model-bearing feed endpoints, so gated model IP can never
 * be shared-cached and cross-served to an anonymous scraper (Phase 4 cache-leak
 * fix — closes the path-confusion / header-less-endpoint edge-cache vector at
 * the ORIGIN, independent of any Cloudflare cache rule).
 *
 * - authed: the response carries full model IP → `private, no-store` so no
 *   shared/edge cache stores it, even one that ignores `Vary: Cookie` (which
 *   Cloudflare does). `private` alone is not enough against an "Override TTL"
 *   edge rule — `no-store` is the belt-and-suspenders.
 * - anon: the stripped commodity shape → a short public cache is fine.
 * - always `Vary: Cookie` so a compliant cache keys on auth state.
 *
 * Mirrors the games.list auth-aware header (Phase 3), extended to the strikeout
 * / HR / WC endpoints that previously set NO Cache-Control at all.
 */
export function setGatedCacheHeaders(
  res: { setHeader?: (name: string, value: string) => void } | undefined,
  authed: boolean
): void {
  if (!res || typeof res.setHeader !== "function") return;
  res.setHeader("Vary", "Cookie");
  res.setHeader(
    "Cache-Control",
    authed
      ? "private, no-store"
      : "public, max-age=30, stale-while-revalidate=60"
  );
}
