/**
 * Pricing — the three real membership plans (owner directive 2026-07-31):
 *   Pro   → /checkout?plan=dime-pro
 *   Sharp → /checkout?plan=dime-sharp
 *   Max   → /checkout?plan=dime-max
 *
 * Prices are READ FROM THE DATABASE, not typed here. Each card asks
 * stripe.publicListCheckoutPrices for its plan's sellable intervals, takes the
 * 1-month row, prints it as a per-day figure on the button with "billed
 * monthly" underneath, and deep-links checkout to that exact price row. Two
 * reasons: the landing can never drift from what the owner sets in admin, and
 * Max's stored DEFAULT price is not the monthly one — linking by slug alone
 * would open a weekly checkout under a card that says billed monthly.
 *
 * The TIERS content block stays as the fallback so the section always renders
 * even before (or without) the lookup.
 *
 * Surfaces are the owner's: Pro on the grey grid, Sharp on mint, Max on white.
 */

import { Link } from "wouter";
import {
  LANDING_MODE,
  PRICING_HEAD,
  TIERS,
  type Tier,
} from "../landing-content";
import { SectionHead } from "./shared";
import { trpc } from "@/lib/trpc";

/** Monthly price expressed per day — the site's existing convention. */
const DAYS_PER_MONTH = 30;

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function TierCard({ tier }: { tier: Tier }) {
  const slug = tier.action.type === "checkout" ? tier.action.plan : null;
  const { data } = trpc.stripe.publicListCheckoutPrices.useQuery(
    { slug: slug ?? "dime-pro" },
    { enabled: !!slug, staleTime: 300_000 }
  );

  const monthly =
    data?.prices.find(p => p.interval === "month" && p.intervalCount === 1) ??
    null;
  const monthlyCents = monthly?.amountCents ?? null;
  const fallbackCents = Math.round(
    parseFloat(tier.price.replace("$", "")) * 100
  );
  const shownCents = monthlyCents ?? fallbackCents;
  const perDay = money(Math.round(shownCents / DAYS_PER_MONTH));

  const href =
    LANDING_MODE === "paid" && slug
      ? monthly
        ? `/checkout?plan=${slug}&price=${monthly.id}`
        : `/checkout?plan=${slug}`
      : "/#waitlist";

  const label = LANDING_MODE === "paid" ? tier.cta.paid : tier.cta.waitlist;

  return (
    <article className={`tier tier--${tier.id}`}>
      <header className="tier-head">
        <h3 className="tier-name">{tier.name}</h3>
        <p className="tier-aud">{tier.audience}</p>
      </header>

      <ul className="tier-features">
        {tier.features.map(f => (
          <li key={f}>{f}</li>
        ))}
      </ul>

      <div className="tier-foot">
        <Link
          href={href}
          className="tier-cta"
          data-cta-id={`pricing-${tier.id}`}
          data-cta-location="pricing"
          data-mode={LANDING_MODE}
          data-plan={slug ?? tier.id}
        >
          <span className="tier-cta-label">{label}</span>
          <span className="tier-cta-price num">{perDay} / day</span>
        </Link>
        <span className="tier-billed">
          billed monthly · {money(shownCents)}
        </span>
      </div>
    </article>
  );
}

export default function Pricing() {
  return (
    <section className="sec sec--pricing" id="pricing" aria-label="Pricing">
      <div className="wrap">
        <div className="sec-body">
          <SectionHead
            center
            headline={PRICING_HEAD.headline}
            sub={PRICING_HEAD.sub}
          />

          <div className="tier-grid">
            {TIERS.map(tier => (
              <TierCard key={tier.id} tier={tier} />
            ))}
          </div>

          <p className="pricing-proof">{PRICING_HEAD.proof}</p>
          <span className="mono pricing-legal">{PRICING_HEAD.legal}</span>
        </div>
      </div>
    </section>
  );
}
