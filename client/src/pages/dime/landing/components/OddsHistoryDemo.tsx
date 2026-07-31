/**
 * Odds history sample — the REAL product panel, on real data.
 *
 * Owner directive 2026-07-31: "use the actual elements and rendering from the
 * site backend, not a screenshot". This mounts the shipped
 * <OddsHistoryPanel> in `demo` mode, so the landing page renders the exact
 * component the /betting-splits surface renders — same dedupe, same EST
 * timestamps, same tokens, same team crests — reading live rows from the DB.
 *
 * Scope: the panel's `demo` prop swaps ONLY the data source, from the gated
 * per-game procedure to `oddsHistory.listForDemoGame`, which takes no input
 * and can resolve exactly one pinned, already-completed matchup. Premium
 * odds movement for the live slate stays gated; this is one finished game
 * shown as the product sample.
 */

import { OddsHistoryPanel } from "@/components/OddsHistoryPanel";
import { trpc } from "@/lib/trpc";
import { SectionHead } from "./shared";

export default function OddsHistoryDemo() {
  // Resolves the pinned demo matchup (and its real team names) so the panel
  // header and crests match whatever the backend actually served.
  const { data } = trpc.oddsHistory.listForDemoGame.useQuery(undefined, {
    staleTime: Infinity,
  });

  const game = data?.game;
  // Nothing to show if the pinned game is not in the database — the section
  // simply does not render rather than shipping an empty frame.
  if (!game) return null;

  return (
    <section className="sec" id="odds-history" aria-label="Odds history sample">
      <div className="wrap">
        <div className="sec-body">
          <SectionHead
            eyebrow="Odds + splits history"
            headline={{
              before: "Every line move, ",
              em: "timestamped",
              after: ".",
            }}
            sub="Every price, every split, every timestamp."
          />

          <div
            className="odds-demo-frame"
            style={{ marginTop: "clamp(28px, 4vw, 44px)" }}
          >
            <OddsHistoryPanel
              gameId={game.id}
              awayTeam={game.awayTeam}
              homeTeam={game.homeTeam}
              activeMarket="ml"
              demo
            />
          </div>

        </div>
      </div>
    </section>
  );
}
