import { rankMarkets, type MarketInsight } from "@/lib/gameInsight";
import { MatchupPanel } from "./MatchupPanel";
import { ProjectionMarketsPopover } from "./ProjectionMarketsPopover";
import { ProjectionSummary } from "./ProjectionSummary";
import { SummaryCarousel } from "./SummaryCarousel";
import type { ProjectionGame } from "./types";
import "./ProjectionCard.css";

/**
 * ProjectionCard — one game, structured for a 3-second decision (Law v3).
 *
 * Order: status (live/final only) → matchup block (matchup line · ballpark ·
 * first pitch, owner directive 2026-07-17) → the dominant model insight
 * (summary) → the full market tables in an anchored, paginated popover. There is
 * no corner league label: the feed's sport chip already names the competition
 * (owner directive 2026-07-18), so a scheduled card renders no header at all —
 * its start time is owned by the matchup block's third line (single rendering
 * ownership, directive §3).
 *
 * The market popover is closed by default behind "View full AI model
 * projections". It renders one market per page, preserving source order
 * without changing the card's height.
 * The card is its own container (`ds-cq`), so the layout REFLOWS by the card's
 * width, not the viewport — structure adapts before type ever shrinks.
 */
/** Every REAL edge on the game, ranked strongest → weakest by the decision
 *  engine, at most one side per market (rankMarkets sorts desc, so the first
 *  side seen for a market is its best). NO_EDGE sides never make the list —
 *  they must not populate the carousel (owner directive 2026-07-18). */
export function rankedEdges(game: ProjectionGame): MarketInsight[] {
  const seen = new Set<string>();
  return rankMarkets(game.markets.flatMap((m) => m.sides)).filter((m) => {
    if (m.recommendation === "NO_EDGE" || seen.has(m.marketKey)) return false;
    seen.add(m.marketKey);
    return true;
  });
}

export function ProjectionCard({
  game,
  defaultMarketsOpen = false,
  onOpen,
}: {
  game: ProjectionGame;
  defaultMarketsOpen?: boolean;
  /** Fired when the user opens the market popover (analytics; presentational
   *  component stays pure — the caller owns the emit). Fire-and-forget. */
  onOpen?: () => void;
}) {
  const edges = rankedEdges(game);
  // Whole-card PASS state (Round 4 Wave 1, item 3 / page law "PASS games"):
  // no market on this game clears the WATCH/BET threshold — the same
  // rankedEdges() ground truth that already drives the summary's "No edge"
  // rendering, so this can never disagree with what the card itself shows.
  // A LIVE card never takes PASS (final-review I2 precedence ruling,
  // 2026-07-23, pending owner ratification — annotated in the page law):
  // live+no-edges is reachable (a mid-game model invalidation nulls every
  // model price), and dimming an in-progress game while its mint LIVE
  // signal renders would put the PASS zero-mint law and the live-state law
  // in direct conflict. Live-ness wins; PASS stays absolute for non-live
  // cards, so neither law needs a carve-out inside the other.
  const isPass = game.status !== "live" && edges.length === 0;

  return (
    <article
      className={`projection-card ds-cq${game.status === "scheduled" ? " projection-card--scheduled" : ""}${isPass ? " projection-card--pass" : ""}`}
      aria-label={`${game.away.name} at ${game.home.name}`}
    >
      {game.status !== "scheduled" && (
        <header className="projection-card__head">
          <span className={`projection-card__status projection-card__status--${game.status}`}>
            {/* Live indicator (owner directive / page law "Live state"): pulsing
                7px mint dot ahead of the mono-styled status text. Desktop/tablet
                only (Round 4 Wave 1 scoping, item 8) — see ProjectionCard.css. */}
            {game.status === "live" && (
              <span className="projection-card__live-dot" aria-hidden="true" />
            )}
            {game.statusLabel}
          </span>
        </header>
      )}

      <MatchupPanel game={game} />

      {/* One edge (or none) → the single dominant summary. Two or more →
          the ranked swipe strip, largest edge first (directive 2026-07-18). */}
      {edges.length > 1 ? (
        <SummaryCarousel insights={edges} teams={[game.away, game.home]} />
      ) : (
        <ProjectionSummary insight={edges[0] ?? null} teams={[game.away, game.home]} />
      )}

      <ProjectionMarketsPopover
        game={game}
        isPass={isPass}
        defaultOpen={defaultMarketsOpen}
        onOpen={onOpen}
      />
    </article>
  );
}
