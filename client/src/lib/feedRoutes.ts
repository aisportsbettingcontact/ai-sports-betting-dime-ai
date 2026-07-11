/**
 * feedRoutes — canonical navigation targets for the Dime AI surfaces.
 *
 * The ONLY link targets app code may emit for these surfaces:
 *   • AI Model Projections → /feed/model/{mlb|wc}-MM-DD-YYYY
 *   • Betting Splits       → /betting-splits/{MLB|NHL|NBA}
 *
 * Legacy slugs (/feed, /feed?tab=…, /splits, /projections, /dashboard) must
 * never populate from any link, tab, or redirect default. They survive only
 * as permanent redirects INTO the paths built here (client: App.tsx,
 * server: server/_core/index.ts).
 */
import { todayUTC } from "@/components/CalendarPicker";

export type FeedSport = "MLB" | "WC";
export type SplitsSport = "MLB" | "NHL" | "NBA";

const SPLITS_SPORTS: readonly SplitsSport[] = ["MLB", "NHL", "NBA"];

/** YYYY-MM-DD → MM-DD-YYYY (the feed slug date form). */
export function toFeedSlugDate(iso: string): string {
  const [y, mo, d] = iso.split("-");
  return `${mo}-${d}-${y}`;
}

/**
 * Canonical AI Model Projections path, e.g. /feed/model/mlb-07-11-2026.
 * Defaults to today's effective feed date (todayUTC — the 07:00 UTC /
 * 00:00 PT rollover shared by the whole feed stack).
 */
export function feedModelPath(sport: FeedSport = "MLB", isoDate?: string): string {
  const iso = isoDate ?? todayUTC();
  return `/feed/model/${sport.toLowerCase()}-${toFeedSlugDate(iso)}`;
}

/** Canonical Betting Splits path, e.g. /betting-splits/MLB. */
export function bettingSplitsPath(sport: SplitsSport = "MLB"): string {
  return `/betting-splits/${sport}`;
}

/** Validates a /betting-splits/:sport route segment (case-insensitive). */
export function parseSplitsSport(seg: string | undefined): SplitsSport | null {
  const s = (seg ?? "").toUpperCase();
  return (SPLITS_SPORTS as readonly string[]).includes(s) ? (s as SplitsSport) : null;
}

/**
 * Maps a legacy /feed?… URL onto its canonical replacement. Pure — pass the
 * query string (window.location.search); "" handles the bare /feed slug.
 *   ?tab=splits            → /betting-splits/MLB
 *   ?sport=WC[&date=ISO]   → /feed/model/wc-…
 *   anything else          → /feed/model/mlb-… (today, or legacy ?date=)
 */
export function legacyFeedRedirectTarget(search: string): string {
  const params = new URLSearchParams(search);
  if (params.get("tab") === "splits") return bettingSplitsPath("MLB");
  const sport: FeedSport = (params.get("sport") ?? "").toUpperCase() === "WC" ? "WC" : "MLB";
  const date = params.get("date");
  const iso = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
  return feedModelPath(sport, iso);
}
