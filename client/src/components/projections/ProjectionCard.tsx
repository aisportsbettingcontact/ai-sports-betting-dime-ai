import { rankMarkets, type MarketInsight } from "@/lib/gameInsight";
import { MatchupPanel } from "./MatchupPanel";
import { MlbPregamePanel } from "./MlbPregamePanel";
import { ProjectionMarketsPopover } from "./ProjectionMarketsPopover";
import { ProjectionSummary } from "./ProjectionSummary";
import { SummaryCarousel } from "./SummaryCarousel";
import type { ProjectionGame } from "./types";
import "./ProjectionCard.css";

/**
 * ProjectionCard — one game, structured for a 3-second decision (Law v3).
 *
 * Order: status (live/final only) → matchup block (matchup line · ballpark ·
 * first pitch, owner directive 2026-07-17) → scheduled-MLB probable pitchers →
 * the dominant model insight (summary) → the full market tables in an anchored,
 * paginated popover. There is
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
/** Every actionable edge on the game, ranked strongest → weakest by the
 *  decision engine, at most one side per market. */
export function rankedEdges(game: ProjectionGame): MarketInsight[] {
  const seen = new Set<string>();
  return rankMarkets(game.markets.flatMap((m) => m.sides)).filter((m) => {
    if (m.recommendation === "NO_EDGE" || seen.has(m.marketKey)) return false;
    seen.add(m.marketKey);
    return true;
  });
}

/**
 * A no-action game's most useful market context: the highest canonical no-vig
 * ROI side from each scorable market, ranked best → worst. Zero and negative ROI
 * remain eligible; each item stays visually neutral because none cleared
 * WATCH/BET. `roiPct` is the product's canonical no-vig ROI, so this order is
 * independent of raw probability-edge and posted-price EV order.
 */
export function rankedNoEdgeCandidates(game: ProjectionGame): MarketInsight[] {
  const seen = new Set<string>();
  return rankMarkets(game.markets.flatMap((m) => m.sides))
    .filter((insight) => insight.recommendation === "NO_EDGE")
    .sort((a, b) => {
      const aRoi = a.roiPct ?? Number.NEGATIVE_INFINITY;
      const bRoi = b.roiPct ?? Number.NEGATIVE_INFINITY;
      if (bRoi !== aRoi) return bRoi - aRoi;
      if (b.edgePP !== a.edgePP) return b.edgePP - a.edgePP;
      if (b.evUnits !== a.evUnits) return b.evUnits - a.evUnits;
      const marketOrder = a.marketKey.localeCompare(b.marketKey);
      return marketOrder || a.sideLabel.localeCompare(b.sideLabel);
    })
    .filter((insight) => {
      if (seen.has(insight.marketKey)) return false;
      seen.add(insight.marketKey);
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
  const fallbackCandidates = edges.length === 0 ? rankedNoEdgeCandidates(game) : [];
  const displayInsights = edges.length > 0 ? edges : fallbackCandidates;
  const showsNoEdgeRanking = edges.length === 0 && fallbackCandidates.length > 0;
  // Whole-card PASS state (Round 4 Wave 1, item 3 / page law "PASS games"):
  // no market on this game clears the WATCH/BET threshold. The fallback
  // candidates remain recommendation=NO_EDGE, so their richer readout can
  // never disagree with this whole-card state.
  // A LIVE card never takes PASS (final-review I2 precedence ruling,
  // 2026-07-23 — annotated in the page law):
  // live+no-edges is reachable (a mid-game model invalidation nulls every
  // model price). Live-ness wins that semantic conflict; lifecycle compaction
  // may still quiet the whole card independently of PASS.
  const isPass = game.status !== "live" && edges.length === 0;
  const isCompact = game.status !== "scheduled";
  const showPregame = game.status === "scheduled" && game.pregameLineups != null;

  return (
    <article
      className={`projection-card ds-cq projection-card--${game.status}${isCompact ? " projection-card--compact" : ""}${showPregame ? " projection-card--with-pregame" : ""}${isPass ? " projection-card--pass" : ""}`}
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

      {game.status === "scheduled" && game.pregameLineups && (
        <MlbPregamePanel
          away={game.away}
          home={game.home}
          lineups={game.pregameLineups}
        />
      )}

      {/* Actionable games rank qualifying edges. Pass games use the same stable
          slot for one best-ROI candidate per market (including negative ROI),
          while every ROI-only badge remains explicitly neutral. */}
      {displayInsights.length > 1 ? (
        <SummaryCarousel
          insights={displayInsights}
          teams={[game.away, game.home]}
          variant={showsNoEdgeRanking ? "no-edge" : "edge"}
        />
      ) : (
        <ProjectionSummary
          insight={displayInsights[0] ?? null}
          teams={[game.away, game.home]}
        />
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
