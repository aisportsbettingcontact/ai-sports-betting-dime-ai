/**
 * Terms.tsx — Terms of Service page
 * PROD-001: Required for production compliance.
 * Compliance vocab: "intelligence software" not "picks/guaranteed"; "matches" for soccer.
 */

import { useEffect } from "react";

export default function Terms() {
  useEffect(() => {
    document.title = "Terms of Service — dıme";
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Escape hatch: these documents were dead ends (audit D-DOCS-ESCAPE) */}
      <header className="max-w-3xl mx-auto px-4 pt-6">
        <a href="/" className="font-bold tracking-tight text-foreground no-underline" aria-label="Back to dime home">
          dıme
        </a>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
        <p className="text-muted-foreground mb-8">
          Last updated: July 7, 2026
        </p>

        <section className="space-y-6 text-sm leading-relaxed">
          <div>
            <h2 className="text-xl font-semibold mb-2">1. Acceptance of Terms</h2>
            <p>
              By accessing or using AI Sports Betting Models ("the Platform"), you agree
              to be bound by these Terms of Service. If you do not agree, do not use the
              Platform.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">2. Description of Service</h2>
            <p>
              The Platform provides sports intelligence software that generates
              AI-powered analytical outputs including probability distributions, no-vig
              pricing, Monte Carlo simulations, and market edge analysis. The Platform
              covers multiple sports including soccer (matches), baseball, basketball,
              and hockey.
            </p>
            <p className="mt-2 font-semibold">
              The Platform does NOT provide guaranteed outcomes, financial advice, or
              wagering services. All outputs are probabilistic analytical tools.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">3. Subscription Terms</h2>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>
                Subscriptions are billed on a recurring basis (monthly or annually)
                through Stripe.
              </li>
              <li>
                Your subscription renews automatically unless cancelled before the
                renewal date.
              </li>
              <li>
                Cancellation takes effect at the end of the current billing period.
                No prorated refunds are issued for partial periods.
              </li>
              <li>
                We reserve the right to modify pricing with 30 days advance notice.
                Existing subscribers retain their current rate until the next renewal
                cycle after the notice period.
              </li>
              <li>
                AI credit allocations (DIME credits) are included with your subscription
                tier. Unused credits do not roll over between billing periods.
              </li>
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">4. Acceptable Use</h2>
            <p>You agree NOT to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Redistribute, resell, or publicly share Platform outputs</li>
              <li>Use automated tools to scrape or bulk-download data</li>
              <li>Attempt to reverse-engineer our AI models or algorithms</li>
              <li>Use the Platform for any unlawful purpose</li>
              <li>Share your account credentials with others</li>
              <li>Circumvent rate limits or credit allocation systems</li>
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">5. Intellectual Property</h2>
            <p>
              All models, algorithms, analytical frameworks, and software comprising the
              Platform are the intellectual property of AI Sports Betting Models. Your
              subscription grants a limited, non-transferable license to use Platform
              outputs for personal analytical purposes only.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">6. Disclaimers</h2>
            <p>
              THE PLATFORM IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND. WE DO NOT
              GUARANTEE THE ACCURACY, COMPLETENESS, OR RELIABILITY OF ANY ANALYTICAL
              OUTPUT. PAST PERFORMANCE OF OUR MODELS DOES NOT GUARANTEE FUTURE RESULTS.
            </p>
            <p className="mt-2">
              Our intelligence software generates probabilistic analysis based on
              historical data and statistical modeling. No output should be interpreted
              as a guarantee of any outcome or as financial advice.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">7. Limitation of Liability</h2>
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE SHALL NOT BE LIABLE FOR ANY
              INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY
              LOSS OF PROFITS OR REVENUES, WHETHER INCURRED DIRECTLY OR INDIRECTLY, OR
              ANY LOSS OF DATA, USE, GOODWILL, OR OTHER INTANGIBLE LOSSES RESULTING FROM
              YOUR USE OF THE PLATFORM.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">8. Responsible Gambling</h2>
            <p>
              This Platform provides sports intelligence software for informational and
              analytical purposes only. We do not facilitate, process, or accept wagers.
              You are solely responsible for compliance with all applicable laws in your
              jurisdiction regarding sports wagering.
            </p>
            <p className="mt-2 font-semibold">
              If you or someone you know has a gambling problem, call{" "}
              <a href="tel:1-800-426-2537" className="text-primary underline">
                1-800-GAMBLER
              </a>{" "}
              (1-800-426-2537) for free, confidential help.
            </p>
            <p className="mt-1 text-muted-foreground">
              National Council on Problem Gambling:{" "}
              <a
                href="https://www.ncpgambling.org"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                ncpgambling.org
              </a>
            </p>
            <p className="mt-2">
              You must be of legal age in your jurisdiction to use this Platform. By
              using the Platform, you represent that you meet the minimum age requirement.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">9. Account Termination</h2>
            <p>
              We reserve the right to suspend or terminate your account if you violate
              these Terms. Upon termination, your access to the Platform and all
              associated data will be revoked.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">10. Changes to Terms</h2>
            <p>
              We may modify these Terms at any time. Material changes will be
              communicated via email or a prominent notice on the Platform at least 14
              days before taking effect. Continued use after changes constitutes
              acceptance.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">11. Governing Law</h2>
            <p>
              These Terms are governed by the laws of the United States. Any disputes
              shall be resolved through binding arbitration in accordance with the rules
              of the American Arbitration Association.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">12. Contact</h2>
            <p>
              For questions about these Terms, contact us through the Platform's support
              channels or at the email associated with your account.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
