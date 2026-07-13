import { EdgeIndicator } from "./EdgeIndicator";
import type { MarketInsight } from "@/lib/gameInsight";

/**
 * ProjectionSummary — the card's dominant, 3-second insight (Law v3). Surfaces
 * the single strongest opportunity from primaryInsight(): the EdgeIndicator plus
 * the concise readout the directive specifies — best price, model fair price,
 * edge, action — each on its own labeled element. Every value is derived by the
 * decision engine, never styled in. When there's no edge, it states that plainly.
 */
function fmtPrice(p: number): string {
  return p > 0 ? `+${p}` : `${p}`;
}

export function ProjectionSummary({ insight }: { insight: MarketInsight | null }) {
  return (
    <div className="summary">
      <EdgeIndicator insight={insight} className="summary__edge" />
      {insight ? (
        <dl className="summary__readout">
          <div className="summary__item">
            <dt className="ds-label">Model edge</dt>
            <dd className="summary__pick">{insight.sideLabel}</dd>
          </div>
          <div className="summary__item">
            <dt className="ds-label">Best price</dt>
            <dd className="odds-value">{fmtPrice(insight.bookPrice)}</dd>
          </div>
          <div className="summary__item">
            <dt className="ds-label">Model fair price</dt>
            <dd className="odds-value">{fmtPrice(insight.modelFairPrice)}</dd>
          </div>
        </dl>
      ) : (
        <p className="summary__none ds-body-sm">Every market is efficiently priced. No action.</p>
      )}
    </div>
  );
}
