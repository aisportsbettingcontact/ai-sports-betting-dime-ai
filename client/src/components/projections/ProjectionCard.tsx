import { primaryInsight } from "@/lib/gameInsight";
import { MatchupPanel } from "./MatchupPanel";
import { MarketTable } from "./MarketTable";
import { ProjectionSummary } from "./ProjectionSummary";
import type { ProjectionGame } from "./types";
import "./ProjectionCard.css";

/**
 * ProjectionCard — one game, structured for a 3-second decision (Law v3).
 *
 * Order: status/league → matchup → the dominant model insight (summary) →
 * the supporting market tables. The card is its own container (`ds-cq`), so the
 * layout REFLOWS by the card's width, not the viewport: stacked on narrow, a
 * 2/3-column market grid as it widens, and matchup | markets | summary in one
 * row on wide desktop — structure adapts before type ever shrinks.
 */
export function ProjectionCard({
  game,
  defaultMarketsOpen = true,
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
        <span className={`projection-card__status projection-card__status--${game.status}`}>
          {game.statusLabel}
        </span>
      </header>

      <MatchupPanel game={game} />

      <ProjectionSummary insight={insight} />

      <details className="projection-card__markets" open={defaultMarketsOpen}>
        <summary className="projection-card__markets-toggle ds-label">
          <span>Markets</span>
          <span className="projection-card__markets-count ds-caption">{game.markets.length}</span>
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
