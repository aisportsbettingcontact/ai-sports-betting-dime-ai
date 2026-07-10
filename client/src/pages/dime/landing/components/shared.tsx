/**
 * Dime landing v2 — shared primitives.
 * Brand law: mint only on signal; PASS/locked stay grey; state never by color alone.
 */

import type { MarketState } from "../landing-content";

export function Wordmark({ fontSize }: { fontSize?: number }) {
  return (
    <span className="wordmark" style={fontSize ? { fontSize } : undefined}>
      d<span className="i">ı</span>me
    </span>
  );
}

/** Check bullet. Mint = signal (featured tier only); muted grey everywhere else. */
export function MintCheck({ muted }: { muted?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width={13} height={13} aria-hidden="true">
      <path d="M4 12 L10 18 L20 6" fill="none" stroke={muted ? "#6A6A78" : "#45E0A8"} strokeWidth={3} strokeLinecap="square" />
    </svg>
  );
}

/** Classification pill. Screen readers get an explicit "Classification:" prefix. */
export function StatePill({ state, label }: { state: MarketState | "locked"; label: string }) {
  const cls =
    state === "edge" ? "state-pill state-pill--edge"
    : state === "monitor" ? "state-pill state-pill--monitor"
    : "state-pill state-pill--pass";
  return (
    <span className={cls}>
      <span className="dot" aria-hidden="true" />
      <span className="sr-only">Classification: </span>
      {label}
    </span>
  );
}

export interface Headline {
  before: string;
  em: string;
  after: string;
}

export function SectionHead({
  eyebrow,
  headline,
  sub,
  center,
}: {
  eyebrow: string;
  headline: Headline;
  sub?: string;
  center?: boolean;
}) {
  return (
    <div className={center ? "section-head section-head--center" : "section-head"}>
      <span className="mono mono--mint">{eyebrow}</span>
      <h2>
        {headline.before}
        <em>{headline.em}</em>
        {headline.after}
      </h2>
      {sub && <p>{sub}</p>}
    </div>
  );
}

/** Box-drawing telemetry frame — top edge with label, or bottom closing edge. */
export function TeleFrame({ label }: { label?: string }) {
  if (!label) {
    return (
      <div className="tele" style={{ marginTop: "clamp(40px, 6vw, 64px)" }} aria-hidden="true">
        <span className="corner">└</span>
        <span className="line" />
        <span className="corner">┘</span>
      </div>
    );
  }
  return (
    <div className="tele" aria-hidden="true">
      <span className="corner">┌</span>
      <span className="lbl">{label}</span>
      <span className="line" />
      <span className="corner">┐</span>
    </div>
  );
}

/** Quiet ledger-voiced repeated CTA row. */
export function CtaRow({
  label,
  cta,
  href,
  ctaId,
  location,
}: {
  label: string;
  cta: string;
  href: string;
  ctaId: string;
  location: string;
}) {
  return (
    <div className="cta-row">
      <span className="mono">{label}</span>
      <span className="lead" aria-hidden="true" />
      <a href={href} data-cta-id={ctaId} data-cta-location={location} data-mode="paid">
        {cta} →
      </a>
    </div>
  );
}
