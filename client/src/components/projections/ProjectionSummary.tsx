import { EdgeIndicator } from "./EdgeIndicator";
import type { MarketInsight } from "@/lib/gameInsight";
import type { ProjectionTeam } from "./types";

/**
 * ProjectionSummary — the card's dominant, 3-second insight (Law v3). Surfaces
 * the single strongest opportunity from primaryInsight(): the EdgeIndicator plus
 * the readout — MODEL EDGE / BOOK / MODEL, each on its own labeled element.
 * Every value is derived by the decision engine, never styled in. When there's
 * no edge, it states that plainly.
 *
 * Owner directive 2026-07-17: the MODEL EDGE value is spelled out — "U 7"
 * reads "Under 7", "ATH ML" reads "Athletics ML" (CSS uppercases the display).
 * Since 2026-07-18 the presentation adapter pre-spells team-sport labels
 * ("Yankees ML", "Under 9"), so spellOutPick is the safety net for any label
 * that still arrives compact.
 */
function fmtPrice(p: number): string {
  return p > 0 ? `+${p}` : `${p}`;
}

/** Expand a market side label for the readout: O/U → Over/Under, a leading
 *  team abbreviation → that team's name. Anything unrecognized passes through
 *  verbatim, so soccer labels ("Spain Win or Draw", "Draw") are never mangled. */
export function spellOutPick(label: string, teams: ProjectionTeam[]): string {
  const [head, ...rest] = label.trim().split(/\s+/);
  if (!head) return label;
  const tail = rest.join(" ");
  const withTail = (s: string) => (tail ? `${s} ${tail}` : s);
  if (head.toUpperCase() === "U") return withTail("Under");
  if (head.toUpperCase() === "O") return withTail("Over");
  const team = teams.find((t) => t.abbr === head && t.name && t.name !== head);
  if (team) return withTail(team.name);
  return label;
}

export function ProjectionSummary({
  insight,
  teams = [],
}: {
  insight: MarketInsight | null;
  teams?: ProjectionTeam[];
}) {
  // Readout above the EdgeIndicator (owner directive 2026-07-18): the
  // MODEL EDGE / BOOK / MODEL facts lead, the mint edge cell sits beneath.
  //
  // Round 4 Wave 1 (item 3, page law "PASS games"): the no-edge case uses the
  // SAME <dl className="summary__readout"> grid as an edge card — "No edge"
  // already occupies the chip slot via EdgeIndicator below — instead of a
  // divergent bare <p>, so a PASS card never breaks the row's shape. The
  // shipped copy is unchanged, just relocated into the structure's value row.
  return (
    <div className="summary">
      <dl className="summary__readout">
        {insight ? (
          <>
            <div className="summary__item">
              <dt className="ds-label">Model edge</dt>
              <dd className="summary__pick">{spellOutPick(insight.sideLabel, teams)}</dd>
            </div>
            <div className="summary__item">
              {/* "Book" not "Best price" — owner directive 2026-07-17 */}
              <dt className="ds-label">Book</dt>
              <dd className="odds-value">{fmtPrice(insight.bookPrice)}</dd>
            </div>
            <div className="summary__item">
              {/* "Model" not "Model fair price" — owner directive 2026-07-17 */}
              <dt className="ds-label">Model</dt>
              <dd className="odds-value">{fmtPrice(insight.modelFairPrice)}</dd>
            </div>
          </>
        ) : (
          <div className="summary__item summary__item--message">
            <dd className="summary__none ds-body-sm">Every market is efficiently priced. No action.</dd>
          </div>
        )}
      </dl>
      <EdgeIndicator insight={insight} className="summary__edge" />
    </div>
  );
}
