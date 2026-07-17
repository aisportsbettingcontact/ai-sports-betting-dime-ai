import { ChevronDown, ChevronUp } from "lucide-react";
import { primaryInsight } from "@/lib/gameInsight";
import { MatchupPanel } from "./MatchupPanel";
import { MarketTable } from "./MarketTable";
import { ProjectionSummary } from "./ProjectionSummary";
import type { ProjectionGame } from "./types";
import "./ProjectionCard.css";

/**
 * ProjectionCard — one game, structured for a 3-second decision (Law v3).
 *
 * Order: league/status → matchup block (matchup line · ballpark · first pitch,
 * owner directive 2026-07-17) → the dominant model insight (summary) → the full
 * market tables behind an explicit disclosure. The header renders the status
 * only for live/final games — a scheduled game's start time is owned by the
 * matchup block's third line (single rendering ownership, directive §3).
 *
 * The market tables collapse by default behind "View full AI model projections"
 * with a chevron-down affordance to expand and a chevron-up to collapse — the
 * ChevronDown/ChevronUp pair swaps via CSS on the details [open] state.
 * The card is its own container (`ds-cq`), so the layout REFLOWS by the card's
 * width, not the viewport — structure adapts before type ever shrinks.
 */
export function ProjectionCard({
  game,
  defaultMarketsOpen = false,
}: {
  game: ProjectionGame;
  defaultMarketsOpen?: boolean;
}) {
  const allSides = game.markets.flatMap((m) => m.sides);
  const insight = primaryInsight(allSides);

  return (
    <article className="projection-card ds-cq" aria-label={`${game.away.name} at ${game.home.name}`}>
      <header className="projection-card__head">
        <span className="projection-card__league ds-label">{game.league}</span>
        {game.status !== "scheduled" && (
          <span className={`projection-card__status projection-card__status--${game.status}`}>
            {game.statusLabel}
          </span>
        )}
      </header>

      <MatchupPanel game={game} />

      <ProjectionSummary insight={insight} />

      <details className="projection-card__markets" open={defaultMarketsOpen}>
        <summary className="projection-card__markets-toggle ds-label">
          <span>View full AI model projections</span>
          <ChevronDown className="projection-card__markets-chev projection-card__markets-chev--expand" aria-hidden="true" />
          <ChevronUp className="projection-card__markets-chev projection-card__markets-chev--collapse" aria-hidden="true" />
        </summary>
        <div className="projection-card__markets-grid">
          {game.markets.map((m) => (
            <MarketTable key={m.key} market={m} />
          ))}
        </div>
      </details>
    </article>
  );
}
