import { scoreMarketSide } from "@/lib/gameInsight";
import { formatEdge } from "./EdgeIndicator";
import type { ProjectionMarket } from "./types";

/**
 * MarketTable — one market rendered as a semantic <table> (Law v3 §markets):
 * SIDE, Sportsbook price, Model fair price. Explicit column terminology
 * replaces the ambiguous BOOK / MODEL. Numeric cells are tabular-nums. The
 * model column goes mint ONLY on the side that actually carries the edge — a
 * tinted mint cell with the accessible foreground, never small mint text. One
 * existing result row is preserved. No nested frames: the table is flat.
 */
function fmtPrice(p: number | null | undefined): string {
  if (typeof p !== "number" || !Number.isFinite(p)) return "—";
  return p > 0 ? `+${p}` : `${p}`; // American odds keep their own sign; − is U+2212 via CSS? keep ASCII for odds
}

export function MarketTable({ market }: { market: ProjectionMarket }) {
  // Which side (if any) is the signal? Highest positive edge among this market's sides.
  const scored = market.sides.map((s) => scoreMarketSide(s));
  let signalIdx = -1;
  let best = 0;
  scored.forEach((m, i) => {
    if (m && m.recommendation !== "NO_EDGE" && m.edgePP > best) {
      best = m.edgePP;
      signalIdx = i;
    }
  });

  return (
    <table className="market-table">
      <caption className="market-table__caption ds-label">{market.label}</caption>
      <thead>
        <tr>
          <th scope="col">Side</th>
          <th scope="col">Sportsbook price</th>
          <th scope="col">Model fair price</th>
        </tr>
      </thead>
      <tbody>
        {market.sides.map((side, i) => {
          const isSignal = i === signalIdx;
          const s = scored[i];
          return (
            <tr key={side.sideLabel} className={isSignal ? "market-table__row--signal" : undefined}>
              <th scope="row" className="market-table__side">{side.sideLabel}</th>
              <td className="odds-value">{fmtPrice(side.bookPrice)}</td>
              <td className={`odds-value${isSignal ? " market-table__model--signal" : ""}`}>
                {fmtPrice(side.modelPrice)}
                {isSignal && s && (
                  <span className="market-table__edge"> {formatEdge(s.edgePP)}</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
      {market.resultLabel && (
        <tfoot>
          <tr>
            <td colSpan={3} className="market-table__result ds-label">{market.resultLabel}</td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}
