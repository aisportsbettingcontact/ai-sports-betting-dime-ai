/**
 * Dime Market Console — the hero's interactive product theater.
 *
 * A framed console that simulates a market scan: progress rail steps through
 * the pipeline, probability bars animate to their values, and the market
 * resolves to Pass / Monitor / Edge Detected. Market tabs switch between three
 * demo markets (one per state); Run Market Scan replays the sequence.
 *
 * Honesty: all data is a labeled DEMO with abstract team names (landing-content).
 * Reduced motion: the scan renders its final state instantly.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { CONSOLE_MARKETS, CONSOLE_SCAN_STEPS, CHAT_SIDE } from "../landing-content";
import { StatePill } from "./shared";

const STEP_MS = 420;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function MarketConsole() {
  const [activeId, setActiveId] = useState(CONSOLE_MARKETS[0].id);
  const [scanStep, setScanStep] = useState<number>(CONSOLE_SCAN_STEPS.length); // start resolved
  const [creditsUsed, setCreditsUsed] = useState(1);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const market = CONSOLE_MARKETS.find((m) => m.id === activeId) ?? CONSOLE_MARKETS[0];
  const done = scanStep >= CONSOLE_SCAN_STEPS.length;
  const progressPct = Math.min(100, (scanStep / CONSOLE_SCAN_STEPS.length) * 100);

  const runScan = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    if (prefersReducedMotion()) {
      setScanStep(CONSOLE_SCAN_STEPS.length);
      return;
    }
    setScanStep(0);
    timer.current = setInterval(() => {
      setScanStep((s) => {
        if (s + 1 >= CONSOLE_SCAN_STEPS.length) {
          if (timer.current) clearInterval(timer.current);
        }
        return s + 1;
      });
    }, STEP_MS);
  }, []);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const selectMarket = (id: string) => {
    if (id === activeId) return;
    setActiveId(id);
    setCreditsUsed((c) => Math.min(CHAT_SIDE.creditsTotal, c + 1));
    runScan();
  };

  const replay = () => {
    setCreditsUsed((c) => Math.min(CHAT_SIDE.creditsTotal, c + 1));
    runScan();
  };

  return (
    <div className="console" id="console" aria-label="Dime Market Console — interactive demo">
      {/* Chrome bar */}
      <div className="console-chrome">
        <span className="pulse" aria-hidden="true" />
        <span>dime.market-console</span>
        <span className="right">
          <span>scan // 400,000_sims</span>
          <span className="demo-tag">Demo · sample markets</span>
        </span>
      </div>

      <div className="console-grid">
        {/* Left rail: market tabs */}
        <div className="console-rail" role="tablist" aria-label="Demo markets">
          <span className="mono rail-head">Markets</span>
          {CONSOLE_MARKETS.map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={m.id === activeId}
              className="market-tab"
              onClick={() => selectMarket(m.id)}
            >
              {m.tab}
              <small>{m.sport} · {m.stateLabel}</small>
            </button>
          ))}
          <div className="rail-foot">
            <div className="credit-meter">
              <span className="mono num">{CHAT_SIDE.creditsLabel} · {creditsUsed}/{CHAT_SIDE.creditsTotal}</span>
              <span className="bar"><b style={{ width: `${(creditsUsed / CHAT_SIDE.creditsTotal) * 100}%` }} /></span>
            </div>
          </div>
        </div>

        {/* Main: intelligence card */}
        <div className="console-main">
          <div className="scan-rail">
            <span className="track"><b style={{ width: `${progressPct}%` }} /></span>
            <span className="mono step" role="status" aria-live="polite">
              {done ? "Scan complete · market classified" : CONSOLE_SCAN_STEPS[scanStep]}
            </span>
          </div>

          <div className="console-market-head">
            {/* Not a heading: the console lives inside the hero, so an <h3> here
                would jump h1→h3. It's a data label — styled, not structural. */}
            <div className="market-name">{market.market}</div>
            <span className="mono">{market.sport}</span>
            {done && <StatePill state={market.state} label={market.stateLabel} />}
          </div>

          <div className="console-facts">
            <div className="fact">
              <span className="mono">Book price</span>
              <b>{market.bookPrice}</b>
            </div>
            <div className="fact">
              <span className="mono">Fair price</span>
              <b className={done && market.state === "edge" ? "signal" : undefined}>{done ? market.fairPrice : "···"}</b>
            </div>
            <div className="fact">
              <span className="mono">Edge</span>
              <b className={done && market.state === "edge" ? "signal" : undefined}>{done ? market.edge : "···"}</b>
            </div>
            <div className="fact">
              <span className="mono">Confidence</span>
              <b>{done ? market.confidence : "···"}</b>
            </div>
          </div>

          <div className="prob-compare">
            <div className="prob-row">
              <span className="mono">Implied probability</span>
              <span className="track"><b style={{ width: done ? `${market.impliedProb}%` : "0%" }} /></span>
              <span className="val num">{market.impliedProb}%</span>
            </div>
            <div className="prob-row prob-row--model">
              <span className="mono">Dime projection</span>
              <span className="track"><b style={{ width: done ? `${market.dimeProjection}%` : "0%" }} /></span>
              <span className="val num">{market.dimeProjection}%</span>
            </div>
          </div>

          <div className="movement">
            <span className="mono num">{market.movement.open} open</span>
            <span className="track" aria-hidden="true"><i className="open" /><i className="now" /></span>
            <span className="mono num" style={{ color: "var(--text-secondary)" }}>{market.movement.current} current</span>
          </div>

          <div className="console-verdict">
            <span className="state-pill">
              <span className="dot" aria-hidden="true" />
              {market.risk}
            </span>
            <span className="status">{done ? market.status : "Classifying…"}</span>
          </div>

          <div className="console-actions">
            <button
              type="button"
              className="btn btn--scan"
              onClick={replay}
              data-cta-id="console-run-scan"
              data-cta-location="market-console"
              data-mode="paid"
            >
              ↻ Run market scan
            </button>
            <span className="mono num">Cost: {market.creditCost} Dime Credit</span>
          </div>
        </div>

        {/* Right rail: Dime insight + locked tiers */}
        <div className="console-insight">
          <span className="mono">Dime insight</span>
          <div className="insight-bubble">{done ? market.signal : "Running simulations…"}</div>
          <div className="insight-bubble" style={{ color: "var(--text-secondary)" }}>
            {done ? market.status : "Comparing implied vs projected…"}
          </div>
          <div className="locked-row">
            <span className="mono">Sharp</span>
            <span>Player prop volatility scan</span>
            <a href="#pricing" data-cta-id="console-unlock-sharp" data-cta-location="market-console" data-plan="sharp" data-mode="paid">Unlock →</a>
          </div>
          <div className="locked-row">
            <span className="mono">Operator</span>
            <span>Full slate simulation</span>
            <a href="#pricing" data-cta-id="console-unlock-operator" data-cta-location="market-console" data-plan="operator" data-mode="paid">Unlock →</a>
          </div>
        </div>
      </div>
    </div>
  );
}
