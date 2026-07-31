/**
 * Hero — five-second comprehension: eyebrow states the category, headline
 * states the promise, sub states the mechanism, CTAs carry the visitor on.
 * (The scripted Dime Market Console was removed 2026-07-31 by owner
 * directive — the live chat embed and the real odds-history panel further
 * down the page are the product proof now.)
 */

import { HERO, STATS } from "../landing-content";

export default function Hero() {
  return (
    <>
      <header className="hero" id="top">
        <div className="wrap">
          <span className="mono mono--mint">{HERO.eyebrow}</span>
          <h1>
            {HERO.headline.before}
            <em>{HERO.headline.em}</em>
            {HERO.headline.after}
          </h1>
          <p className="lede">{HERO.sub}</p>
          <div className="hero-ctas">
            <a
              href="#pricing"
              className="btn btn--mint"
              data-cta-id="hero-get-access"
              data-cta-location="hero"
              data-mode="paid"
            >
              {HERO.primaryCta}
            </a>
            <a
              href="#chat-demo"
              className="btn btn--ghost"
              data-cta-id="hero-preview-chat"
              data-cta-location="hero"
              data-mode="paid"
            >
              {HERO.secondaryCta}
            </a>
          </div>
        </div>
      </header>

      {/* Instrument strip — whitelisted numbers only */}
      <section className="strip" aria-label="Key numbers">
        <div className="wrap strip-grid">
          {STATS.map((s) => (
            <div className="readout" key={s.label}>
              <div className="row">
                <b className="num">{s.value}</b>
                <span className="lead" aria-hidden="true" />
              </div>
              <span className="mono">{s.label}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
