/**
 * Today's Market Signals — sample slate with tier gating.
 * Pass rows are the trust signal; locked rows gate Elite/Max scope honestly
 * (no fake paywall on public data — locked rows are future/deeper products).
 */

import { useState } from "react";
import { SIGNAL_FILTERS, SIGNAL_ROWS } from "../landing-content";
import { SectionHead, StatePill, TeleFrame } from "./shared";

export default function MarketSignals() {
  const [filter, setFilter] = useState<string>("All");

  const rows = SIGNAL_ROWS.filter(
    (r) => filter === "All" || r.filters.includes(filter) || r.state === "locked"
  );

  return (
    <section className="sec" id="signals" aria-label="Today's market signals — demo">
      <div className="wrap">
        <TeleFrame label="SIGNALS // SAMPLE SLATE — LIVE BOARD IS THE PRODUCT" />
        <div className="sec-body">
          <SectionHead
            eyebrow="Today's market signals"
            headline={{ before: "Most rows say ", em: "Pass", after: ". That's the point." }}
            sub="A sample of how the board classifies a slate. Pass is discipline, Monitor is patience, Edge Detected is the reason you're here."
          />

          <div style={{ marginTop: "clamp(24px, 4vw, 36px)" }}>
            <div className="signal-filters" role="group" aria-label="Filter signals">
              {SIGNAL_FILTERS.map((f) => (
                <button key={f} type="button" className="sfilter" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {f}
                </button>
              ))}
            </div>

            <div className="signals-table">
              <div className="sig-head" aria-hidden="true">
                <span>Market</span><span>Sport</span><span>Price</span><span>Implied</span><span>Projection</span><span>Edge</span><span style={{ textAlign: "right" }}>Classification</span>
              </div>
              {rows.map((r) => (
                <div key={r.id} className={`sig-row${r.state === "pass" ? " sig-row--pass" : ""}${r.state === "locked" ? " sig-row--locked" : ""}`}>
                  <span className="market">{r.market}</span>
                  <span className="cell">{r.sport}</span>
                  <span className="cell num">{r.price}</span>
                  <span className="cell num">{r.implied}</span>
                  <span className="cell proj num">{r.projection}</span>
                  <span className="cell num">{r.edge}</span>
                  <span className="statecell" style={{ justifySelf: "end" }}>
                    {r.state === "locked" ? (
                      <a
                        href={r.lockedTier === "Max" ? "#access" : "#pricing"}
                        className="state-pill"
                        style={{ textDecoration: "none" }}
                        data-cta-id={`signals-unlock-${r.lockedTier?.toLowerCase()}`}
                        data-cta-location="market-signals"
                        data-plan={r.lockedTier === "Elite" ? "annual" : undefined}
                        data-mode="paid"
                      >
                        <span className="dot" aria-hidden="true" />
                        {r.lockedTier} — Unlock →
                      </a>
                    ) : (
                      <StatePill state={r.state} label={r.stateLabel} />
                    )}
                  </span>
                  {/* Mobile fact line (hidden on desktop via grid areas) */}
                  <span className="factline mono num" aria-hidden="true">
                    <span>{r.sport}</span><span>{r.price}</span><span>{r.implied} → {r.projection}</span><span>{r.edge}</span>
                  </span>
                </div>
              ))}
            </div>

            <div className="signals-foot">
              <span className="mono">Sample data — the live board prices every game, every market</span>
              <span className="lead" aria-hidden="true" />
              <a
                href="#pricing"
                style={{ font: "600 15px 'Familjen Grotesk', sans-serif", color: "var(--text-primary)", textDecoration: "none" }}
                data-cta-id="signals-get-access"
                data-cta-location="market-signals"
                data-mode="paid"
              >
                See the live board →
              </a>
            </div>
          </div>
        </div>
        <TeleFrame />
      </div>
    </section>
  );
}
