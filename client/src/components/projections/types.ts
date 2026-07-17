import type { MarketSideInput } from "@/lib/gameInsight";

/** A team as the projection card renders it. `logo` is a transparent asset URL;
 *  when absent, the card falls back to a monogram disc (logo-exception color). */
export interface ProjectionTeam {
  abbr: string;
  name: string;
  logo?: string | null;
  /** primary color for the monogram-disc fallback only (Three-Color Law logo exception) */
  color?: string | null;
  score?: number | null;
  /** "country" ⇒ render the flag emoji (no frame); "team" ⇒ logo/monogram. */
  kind?: "team" | "country";
  /** Country flag emoji, bound to the participant's name from the same source. */
  flag?: string | null;
}

export type GameStatus = "scheduled" | "live" | "final" | "postponed";

/** One market (run line / total / moneyline) with its two sides. */
export interface ProjectionMarket {
  key: string; // "runline" | "total" | "moneyline"
  label: string; // "Run line" | "Total" | "Moneyline"
  sides: MarketSideInput[]; // exactly the shape the decision engine consumes
  /** the existing result/verdict row text, preserved verbatim */
  resultLabel?: string;
}

export interface ProjectionGame {
  id: string;
  league: string; // "MLB"
  status: GameStatus;
  statusLabel: string; // "FINAL" | "8:40 PM ET" | "POSTPONED"
  away: ProjectionTeam;
  home: ProjectionTeam;
  /** Secondary context under the matchup line — ballpark, "Semifinal · Stadium". */
  matchupContext?: string;
  venue?: string;
  /** First pitch / kickoff in ET ("10:10 PM ET"); unset for finals. */
  startTime?: string;
  markets: ProjectionMarket[];
}
