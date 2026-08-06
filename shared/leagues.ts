/**
 * League registry — canonical source for league metadata.
 * All logo URLs point to the project CDN (same lifecycle as the webdev project).
 */

// NCAAM season ended April 2026 — removed from active display.
export type SportKey = "nba" | "nhl" | "mlb";

export interface League {
  /** Internal sport key used throughout the codebase */
  sport: SportKey;
  /** Display name shown in the UI */
  name: string;
  /** Short label for tabs/toggles */
  shortName: string;
  /** CDN URL for the league logo SVG */
  logoUrl: string;
}

export const LEAGUES: League[] = [
  {
    sport: "nba",
    name: "NBA",
    shortName: "NBA",
    logoUrl:
      "https://d2xsxph8kpxj0f.cloudfront.net/310519663397752079/MW3FicTy7ae3qrm8dx8Lua/logo-nba_87c4f333.svg",
  },
];

/** Lookup by sport key */
export const LEAGUE_BY_SPORT: Record<SportKey, League> = Object.fromEntries(
  LEAGUES.map(l => [l.sport, l])
) as Record<SportKey, League>;
