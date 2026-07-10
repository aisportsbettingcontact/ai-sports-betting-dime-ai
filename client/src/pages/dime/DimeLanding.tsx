/**
 * Dime AI — landing page (public test hook at /landingpage)
 * ----------------------------------------------------------
 * React port of dime-ai/reference-pages/dime-landing.html with a
 * whitelabel pricing section wired to the existing Stripe checkout flow.
 *
 * Brand law: design-system/dime-ai/MASTER.md (one-accent mint).
 * Checkout notes:
 *  - All plan CTAs navigate to the on-domain /checkout page (Stripe Embedded
 *    Checkout). Never a hosted checkout.stripe.com redirect — owner directive.
 *  - Prices shown match what Stripe actually bills ($99.99 / $499.99).
 */

import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import "./dime-landing.css";

type PlanId = "monthly" | "annual";

/** The brand caret+plus submit glyph (4a/4b in the Dime kit). */
function CaretPlusGlyph({ size, caret, plus }: { size: number; caret: string; plus: string }) {
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} aria-hidden="true">
      <path d="M96 140 L248 256 L96 372" fill="none" stroke={caret} strokeWidth={64} strokeLinecap="square" />
      <rect x={330} y={228} width={150} height={56} fill={plus} />
      <rect x={377} y={181} width={56} height={150} fill={plus} />
    </svg>
  );
}

/** The 1|0 squircle chat avatar (4d app icon, white tile). */
function DimeAvatar({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} aria-hidden="true">
      <rect width={512} height={512} rx={116} fill="#FFFFFF" />
      <rect x={1} y={1} width={510} height={510} rx={115} fill="none" stroke="#D5D5DC" strokeWidth={2} />
      <g transform="translate(97 97) scale(0.62)">
        <path d="M28 142 L66 104 L104 104 L104 408 L28 408 Z" fill="#0B0B0F" />
        <path
          fillRule="evenodd"
          fill="#45E0A8"
          stroke="#0B0B0F"
          strokeWidth={10}
          d="M180 256 a152 152 0 1 0 304 0 a152 152 0 1 0 -304 0 Z M256 256 a76 76 0 1 0 152 0 a76 76 0 1 0 -152 0 Z"
        />
      </g>
    </svg>
  );
}

function MintCheck() {
  return (
    <svg viewBox="0 0 24 24" width={13} height={13} aria-hidden="true">
      <path d="M4 12 L10 18 L20 6" fill="none" stroke="#45E0A8" strokeWidth={3} strokeLinecap="square" />
    </svg>
  );
}

function Wordmark({ fontSize }: { fontSize?: number }) {
  return (
    <span className="wordmark" style={fontSize ? { fontSize } : undefined}>
      d<span className="i">ı</span>me
    </span>
  );
}

const PLANS: Array<{
  id: PlanId;
  name: string;
  price: string;
  period: string;
  perDay: string;
  featured: boolean;
  features: string[];
}> = [
  {
    id: "monthly",
    name: "Monthly",
    price: "$99.99",
    period: "/month",
    perDay: "≈ $3.30 / day · cancel anytime",
    featured: false,
    features: [
      "Full AI Model Projections board — every game, priced",
      "Dime Chat — ask the engine anything on the slate",
      "F5, NRFI, K props & HR props markets",
      "Live edge grades, honest PASS signals",
    ],
  },
  {
    id: "annual",
    name: "Annual",
    price: "$499.99",
    period: "/year",
    perDay: "≈ $1.37 / day · two months of edges free",
    featured: true,
    features: [
      "Everything in Monthly",
      "Save 58% vs paying monthly",
      "Locked-in price through the World Cup and full MLB season",
      "Priority access to new model markets",
    ],
  },
];

function useStartCheckout() {
  const [loadingPlan, setLoadingPlan] = useState<PlanId | null>(null);

  // Embedded checkout only — owner directive: Stripe must never redirect to a
  // hosted checkout.stripe.com page. /checkout mounts Embedded Checkout on-domain.
  const startCheckout = (plan: PlanId) => {
    if (loadingPlan) return;
    setLoadingPlan(plan);
    window.location.assign(`/checkout?plan=${plan}`);
  };

  return { startCheckout, loadingPlan };
}

const scrollToPricing = () => {
  document.getElementById("dime-pricing")?.scrollIntoView({ behavior: "smooth", block: "start" });
};

export default function DimeLanding() {
  const { appUser } = useAppAuth();
  const { startCheckout, loadingPlan } = useStartCheckout();

  useEffect(() => {
    document.title = "dıme — The AI engine that prices the edge";
    return () => {
      document.title = "AI Sports Betting Models";
    };
  }, []);

  const currentPlan = appUser?.hasAccess ? appUser.stripePlanId : null;

  return (
    <div className="dime-landing">
      {/* ═══ NAV ═══ */}
      <nav className="nav">
        <div className="wrap nav-inner">
          <a href="#top" aria-label="dime home">
            <Wordmark />
          </a>
          <div className="nav-links">
            <a href="#model">The Model</a>
            <a href="#product">Product</a>
            <a href="#discipline">Discipline</a>
            <a href="#dime-pricing">Pricing</a>
          </div>
          <button className="btn btn--mint" type="button" onClick={scrollToPricing}>
            Get access
          </button>
        </div>
      </nav>

      <main id="top">
        {/* ═══ HERO ═══ */}
        <header className="hero">
          <div className="wrap">
            <span className="mono mono--mint">Not a pick service&nbsp;&nbsp;·&nbsp;&nbsp;a pricing engine</span>
            <h1>
              The AI engine that prices <em>the edge</em> in every line.
            </h1>
            <div className="hero-grid">
              <div>
                <p className="lede">
                dime runs 10,000 Monte Carlo simulations on every matchup — pricing moneylines, totals, props and
                first-five markets against the books in real time, then telling you exactly where the value is. Or
                when there isn't any.
              </p>
              <div className="hero-ctas">
                <button className="btn btn--mint" type="button" onClick={scrollToPricing}>
                  Get access
                  <span className="glyph">
                    <CaretPlusGlyph size={12} caret="#FFFFFF" plus="#45E0A8" />
                  </span>
                </button>
                <Link href="/feed" className="btn btn--ghost" style={{ textDecoration: "none" }}>
                  See tonight's board
                </Link>
              </div>
                <div className="hero-trust">
                  <span className="mono">MLB</span>
                  <span className="dot" />
                  <span className="mono">World Cup 2026</span>
                  <span className="dot" />
                  <span className="mono">Live 24/7 pipeline</span>
                </div>
              </div>

              {/* Product mock: chat answer + live edge card */}
              <div className="mock-stack" aria-label="Product preview">
              <div className="mock-user">Will Messi score a goal today vs Egypt?</div>
              <div className="mock-chat">
                <span className="mock-avatar">
                  <DimeAvatar size={44} />
                </span>
                <div className="mock-bubble">
                  Ran 10,000 sims. Messi projects 0.68 xG — anytime-scorer probability{" "}
                  <span className="signal">54.2%</span> vs 46.5% implied at +115. That's{" "}
                  <span className="signal">+7.7% edge</span> — grade A.
                </div>
              </div>
              <div className="mock-card">
                <div className="mock-topline">
                  <span className="live-dot" />
                  <span className="mono mono--mint">Live · Top 6</span>
                  <span className="mono" style={{ marginLeft: "auto" }}>
                    Coors Field
                  </span>
                </div>
                <div className="mock-match">
                  Dodgers 4 <span>@</span> Rockies 2
                </div>
                <div className="statrow">
                  <div className="stat">
                    <span className="mono">Pick</span>
                    <b className="signal">LAD −1.5</b>
                  </div>
                  <div className="stat">
                    <span className="mono">Model prob</span>
                    <b>64.4%</b>
                  </div>
                  <div className="stat">
                    <span className="mono">Edge</span>
                    <b className="signal">+6.1%</b>
                  </div>
                  <div className="stat">
                    <span className="mono">Grade</span>
                    <b>A−</b>
                  </div>
                </div>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* ═══ STATS BAND ═══ */}
        <section className="band" aria-label="Key numbers">
          <div className="wrap band-grid">
            <div className="bigstat">
              <b>10,000</b>
              <span className="mono">Simulations per game</span>
            </div>
            <div className="bigstat">
              <b>
                55<i>+</i>
              </b>
              <span className="mono">Model outputs per matchup</span>
            </div>
            <div className="bigstat">
              <b>6</b>
              <span className="mono">Markets priced, book vs model</span>
            </div>
            <div className="bigstat">
              <b>24/7</b>
              <span className="mono">Odds, lineups &amp; weather pipeline</span>
            </div>
          </div>
        </section>

        {/* ═══ HOW IT WORKS ═══ */}
        <section className="section" id="model">
          <div className="wrap">
            <div className="section-head">
              <span className="mono mono--mint">The Model</span>
              <h2>From raw feeds to a priced edge in three moves.</h2>
              <p>
                Every number on the site traces back to the same engine — ingested live, simulated in full, and graded
                against the close.
              </p>
            </div>
            <div className="cards3">
              <div className="step">
                <span className="num">01 — INGEST</span>
                <h3>Everything the game knows</h3>
                <p>
                  Live book odds, confirmed lineups, starting pitchers, park factors, bullpens, umpires and weather —
                  refreshed around the clock, frozen the moment a game goes live.
                </p>
                <svg viewBox="0 0 120 36" width={120} height={36} aria-hidden="true">
                  <path d="M4 18 H74" stroke="#24242E" strokeWidth={2} />
                  <path d="M58 8 L74 18 L58 28" fill="none" stroke="#45E0A8" strokeWidth={2.5} strokeLinecap="square" />
                  <rect x={86} y={6} width={24} height={24} rx={6} fill="none" stroke="#6A6A78" strokeWidth={2} />
                </svg>
              </div>
              <div className="step">
                <span className="num">02 — SIMULATE</span>
                <h3>10,000 full games, every game</h3>
                <p>
                  A Monte Carlo engine plays each matchup inning by inning — scoring distributions, win rates,
                  first-five splits, scorer probabilities — 55+ outputs per game.
                </p>
                <svg viewBox="0 0 120 36" width={120} height={36} aria-hidden="true">
                  <path d="M4 32 C22 32 24 6 38 6 C52 6 54 32 72 32" fill="none" stroke="#6A6A78" strokeWidth={2} />
                  <path d="M48 32 C66 32 68 10 82 10 C96 10 98 32 116 32" fill="none" stroke="#45E0A8" strokeWidth={2.5} />
                </svg>
              </div>
              <div className="step">
                <span className="num">03 — PRICE</span>
                <h3>Model vs book, graded</h3>
                <p>
                  Every simulated probability becomes a fair price and gets compared to the best available line.
                  Positive edge gets a grade. No edge gets a PASS — in grey.
                </p>
                <svg viewBox="0 0 120 36" width={120} height={36} aria-hidden="true">
                  <path d="M6 28 H30 M6 20 H30" stroke="#6A6A78" strokeWidth={2} />
                  <path d="M44 18 H70" stroke="#24242E" strokeWidth={2} />
                  <circle cx={98} cy={18} r={12} fill="none" stroke="#45E0A8" strokeWidth={2.5} />
                  <path d="M92 18 L97 23 L105 13" fill="none" stroke="#45E0A8" strokeWidth={2.5} strokeLinecap="square" />
                </svg>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ PRODUCT DUO ═══ */}
        <section className="section" id="product">
          <div className="wrap">
            <div className="section-head">
              <span className="mono mono--mint">Product</span>
              <h2>One engine. Two ways to use it.</h2>
              <p>
                Scan the whole slate on the feed, or interrogate a single number in chat — both surfaces read from the
                same simulations.
              </p>
            </div>
            <div className="duo">
              <div className="panel" aria-label="Feed preview">
                <div className="panel-head">
                  <h3>The Board</h3>
                  <span className="mono">AI Model Projections</span>
                </div>
                <div className="minirow">
                  <span className="team">
                    NYY @ BOS <small>Cole (R) vs Crochet (L) · 7:10 PM</small>
                  </span>
                  <span className="val">
                    <span className="mono">Book ML</span>
                    <b>−136</b>
                  </span>
                  <span className="val">
                    <span className="mono">Model</span>
                    <b className="signal">−171</b>
                  </span>
                  <span className="pick">
                    NYY ML<small>+5.5% · A</small>
                  </span>
                </div>
                <div className="minirow">
                  <span className="team">
                    MIL @ CHC <small>Peralta (L) vs Assad (R) · 8:05 PM</small>
                  </span>
                  <span className="val">
                    <span className="mono">Book total</span>
                    <b>8.5</b>
                  </span>
                  <span className="val">
                    <span className="mono">Model</span>
                    <b className="signal">7.6</b>
                  </span>
                  <span className="pick">
                    UNDER 8.5<small>+4.8% · B+</small>
                  </span>
                </div>
                <div className="minirow pass">
                  <span className="team">
                    HOU @ SEA <small>Valdez (L) vs Gilbert (R) · 9:40 PM</small>
                  </span>
                  <span className="val">
                    <span className="mono">Book ML</span>
                    <b>−118</b>
                  </span>
                  <span className="val">
                    <span className="mono">Model</span>
                    <b>−121</b>
                  </span>
                  <span className="pick">
                    PASS<small>+0.7% · —</small>
                  </span>
                </div>
                <span className="mono" style={{ alignSelf: "flex-end" }}>
                  Moneyline · Run line · Totals · F5 · NRFI · K &amp; HR props
                </span>
              </div>
              <div className="panel" aria-label="Chat preview">
                <div className="panel-head">
                  <h3>Dime Chat</h3>
                  <span className="mono">Ask the engine</span>
                </div>
                <div className="mock-user">Any NRFI angles tonight?</div>
                <div className="mock-chat">
                  <span className="mock-avatar">
                    <DimeAvatar size={36} />
                  </span>
                  <div className="mock-bubble">
                    Wheeler–Senga at Citi is the spot: model has first-inning zero at <span className="signal">62.4%</span>{" "}
                    against −138 (58% implied). <span className="signal">+3.9% edge</span>, grade B. The other four
                    games on the slate price clean — I'd pass.
                  </div>
                </div>
                <div className="composer">
                  <span className="hint">Ask dime about tonight's slate…</span>
                  <button className="send" type="button" aria-label="Open Dime Chat" onClick={scrollToPricing}>
                    <CaretPlusGlyph size={18} caret="#0B0B0F" plus="#45E0A8" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ DISCIPLINE ═══ */}
        <section className="section" id="discipline">
          <div className="wrap discipline">
            <div className="section-head">
              <span className="mono mono--mint">Discipline</span>
              <h2>
                Built to tell you when <em>not</em> to bet.
              </h2>
              <p>
                Touts get paid when you buy picks — win or lose. dime is built the other way: mint lights up only
                when the math is there, and when it isn't, the answer is keep your money.
              </p>
            </div>
            <div className="creed">
              {[
                {
                  title: "One signal color",
                  copy: "Mint appears only where the model holds an edge. No edge, no color — PASS games fade to grey instead of shouting.",
                },
                {
                  title: "Graded against the close",
                  copy: "Every projection is scored after the final out — outcome ingestion, Brier scores, and drift detection keep the engine honest.",
                },
                {
                  title: "Source-grounded answers",
                  copy: "If the engine didn't compute it, chat won't say it — every answer traces back to a table the model wrote.",
                },
                {
                  title: "Frozen at the line",
                  copy: "Odds lock the moment a game goes live. What you saw priced is what gets graded — no retroactive edge.",
                },
              ].map((item) => (
                <div className="creed-item" key={item.title}>
                  <span className="check">
                    <MintCheck />
                  </span>
                  <div>
                    <h4>{item.title}</h4>
                    <p>{item.copy}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══ STRAIGHT ANSWERS (objection layer) ═══ */}
        <section className="section" id="answers">
          <div className="wrap">
            <div className="section-head">
              <span className="mono mono--mint">Straight answers</span>
              <h2>The questions you should be asking.</h2>
              <p>
                You're about to pay for numbers that touch your bankroll. Here's what we'd want to know before
                subscribing — answered without the sales voice.
              </p>
            </div>
            <div className="answers-grid">
              <div className="qa">
                <span className="qa-q">Isn't this just another pick service?</span>
                <p>
                  No — dime doesn't sell picks. It's a pricing engine —{" "}
                  <span className="signal">10,000 simulations per game</span>, 55+ outputs — and when the math isn't
                  there, the answer is PASS.
                </p>
                <span className="qa-stamp">No</span>
              </div>
              <div className="qa">
                <span className="qa-q">Where's the track record?</span>
                <p>
                  We don't post cherry-picked win streaks — no honest model can promise you profit. Instead, every
                  projection is <span className="signal">graded against the close</span> after the final out, Brier-scored,
                  with odds frozen the moment a game goes live. The grading is the record, and it's built into the engine.
                </p>
                <span className="qa-stamp">Graded</span>
              </div>
              <div className="qa">
                <span className="qa-q">Why $99.99 a month?</span>
                <p>
                  That's ≈ $3.30 a day for every market the model prices — full board, full chat, all 55+ outputs per
                  game. Annual drops it to ≈ $1.37 a day.
                </p>
                <span className="qa-stamp">≈ $3.30/day</span>
              </div>
              <div className="qa">
                <span className="qa-q">What if I want out?</span>
                <p>
                  Cancel anytime — no contracts, no cancellation calls, no fees to leave. Billing runs through Stripe's
                  secure checkout, and your access runs through the period you've already paid for.
                </p>
                <span className="qa-stamp">Anytime</span>
              </div>
              <div className="qa">
                <span className="qa-q">How do I know the numbers are real?</span>
                <p>
                  Dime Chat can only speak from the model's own tables — <span className="signal">124 enforcement tests</span>{" "}
                  stand between the engine and a made-up number, and frozen odds mean nothing is graded retroactively. This
                  is statistical analysis, not gambling advice: 21+, bet responsibly, and no one here will ever guarantee
                  you a profit.
                </p>
                <span className="qa-stamp">124 tests</span>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ PRICING (whitelabel) ═══ */}
        <section className="section" id="dime-pricing">
          <div className="wrap wrap--center">
            <div className="section-head section-head--center">
              <span className="mono mono--mint">Pricing</span>
              <h2>One subscription. Every edge.</h2>
              <p>
                Full board, full chat, every market the model prices. No tiers, no add-ons, no contracts — cancel
                anytime and keep access through the period you paid for.
              </p>
            </div>
            <div className="pricing-grid">
              {PLANS.map((plan) => (
                <div className={plan.featured ? "plan plan--featured" : "plan"} key={plan.id}>
                  {plan.featured && <span className="plan-badge">Best value · Save 58%</span>}
                  <span className="plan-name">{plan.name}</span>
                  <div className="plan-price">
                    <b>{plan.price}</b>
                    <span>{plan.period}</span>
                  </div>
                  <span className="mono plan-sub">{plan.perDay}</span>
                  <ul className="plan-features">
                    {plan.features.map((feature) => (
                      <li key={feature}>
                        <MintCheck />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  {currentPlan === plan.id ? (
                    <span className="current-chip">
                      <MintCheck /> Current plan
                    </span>
                  ) : (
                    <button
                      className={plan.featured ? "btn btn--mint btn--wide" : "btn btn--ghost btn--wide"}
                      type="button"
                      disabled={loadingPlan !== null}
                      onClick={() => startCheckout(plan.id)}
                    >
                      {loadingPlan === plan.id ? "Opening secure checkout…" : `Get ${plan.name}`}
                    </button>
                  )}
                </div>
              ))}
            </div>
            <p className="pricing-proof">
              Every number you're paying for is <span className="signal">graded against the close</span> after the
              final out — and when there's no edge, the model says PASS instead of selling you a pick.
            </p>
            <p className="mono pricing-legal">Secure checkout · Auto-renews · Cancel anytime · 21+</p>

            {/* CTA plate */}
            <div className="plate">
              <span className="mono">No noise · No gut calls · Just the number</span>
              <h2>Bet with the math.</h2>
              <p>Price every line against 10,000 simulations before a dollar of your bankroll moves.</p>
              <button className="btn btn--black" type="button" onClick={() => startCheckout("annual")} disabled={loadingPlan !== null}>
                Get started with <Wordmark fontSize={17} />
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* ═══ FOOTER ═══ */}
      <footer>
        <div className="wrap">
          <div className="foot-top">
            <div className="foot-brand">
              <span className="lockup">AI Sports Betting</span>
              <span className="mono">
                powered by <Wordmark fontSize={14} />
              </span>
            </div>
            <div className="foot-links">
              <a href="#model">The Model</a>
              <a href="#product">Product</a>
              <a href="#dime-pricing">Pricing</a>
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
            </div>
          </div>
          <p className="foot-legal">
            © 2026 AI Sports Betting. dime provides statistical model projections for informational and entertainment
            purposes only — nothing here is financial advice, and no model guarantees a profit. Must be 21+ (or of
            legal betting age in your jurisdiction) to wager. Please bet responsibly. If you or someone you know has a
            gambling problem, call 1-800-GAMBLER.
          </p>
        </div>
      </footer>
    </div>
  );
}
