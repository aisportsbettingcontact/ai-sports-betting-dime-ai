/**
 * Pricing — four-tier presentation over the two REAL Stripe plans + application tier.
 *   Free Preview → scrolls to the on-page demos (no fake free product)
 *   Pro          → /checkout?plan=monthly  ($99.99/mo — real Stripe price)
 *   Elite        → /checkout?plan=annual   ($499.99/yr — real Stripe price)
 *   Founder      → #access application form (real waitlist backend)
 * Dime Credits are explained, not sold — no credit SKU exists in Stripe yet.
 */

import { Link } from "wouter";
import { CREDITS_NOTE, LANDING_MODE, PRICING_HEAD, TIERS, type Tier } from "../landing-content";
import { MintCheck, SectionHead, TeleFrame } from "./shared";

function TierCta({ tier }: { tier: Tier }) {
  const label = LANDING_MODE === "paid" ? tier.cta.paid : tier.cta.waitlist;
  const cls = tier.featured ? "btn btn--mint btn--wide" : "btn btn--ghost btn--wide";
  const tracking = {
    "data-cta-id": `pricing-${tier.id}`,
    "data-cta-location": "pricing",
    "data-mode": LANDING_MODE,
  } as const;

  if (tier.action.type === "checkout") {
    const dest = LANDING_MODE === "paid" ? `/checkout?plan=${tier.action.plan}` : "/#waitlist";
    return (
      <Link href={dest} className={cls} {...tracking} data-plan={tier.action.plan}>
        {label}
      </Link>
    );
  }
  if (tier.action.type === "apply") {
    return (
      <a href="#access" className={cls} {...tracking} data-plan="founder">
        {label}
      </a>
    );
  }
  return (
    <a href={`#${tier.action.target}`} className={cls} {...tracking} data-plan="free">
      {label}
    </a>
  );
}

export default function Pricing() {
  return (
    <section className="sec" id="pricing" aria-label="Pricing">
      <div className="wrap">
        <TeleFrame label="PRICING // SUBSCRIPTION + CREDITS · CANCEL ANYTIME · 21+" />
        <div className="sec-body">
          <SectionHead center eyebrow={PRICING_HEAD.eyebrow} headline={PRICING_HEAD.headline} sub={PRICING_HEAD.sub} />

          <div className="tier-grid" style={{ marginTop: "clamp(28px, 4vw, 44px)" }}>
            {TIERS.map((tier) => (
              <div key={tier.id} className={tier.featured ? "tier tier--featured" : "tier"}>
                {tier.badge && (
                  <span className={tier.featured ? "tier-badge tier-badge--mint" : "tier-badge tier-badge--ghost"}>
                    {tier.badge}
                  </span>
                )}
                <span className="tier-name">{tier.name}</span>
                <span className="tier-aud">{tier.audience}</span>
                <div className="tier-price">
                  <b>{tier.price}</b>
                  {tier.period && <span>{tier.period}</span>}
                </div>
                <span className="tier-perday num">{tier.perDay ?? ""}</span>
                <ul className="tier-features">
                  {tier.features.map((f) => (
                    <li key={f}>
                      <MintCheck muted={!tier.featured} />
                      {f}
                    </li>
                  ))}
                </ul>
                <TierCta tier={tier} />
              </div>
            ))}
          </div>

          <div className="credits-note">
            <h4>{CREDITS_NOTE.title}</h4>
            <p>{CREDITS_NOTE.copy}</p>
          </div>

          <p className="pricing-proof">{PRICING_HEAD.proof}</p>
          <span className="mono pricing-legal">{PRICING_HEAD.legal}</span>
        </div>
        <TeleFrame />
      </div>
    </section>
  );
}
