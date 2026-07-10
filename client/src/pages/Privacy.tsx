/**
 * Privacy.tsx — Privacy Policy page
 * PROD-001: Required for production compliance.
 * Compliance vocab: "intelligence software" not "picks/guaranteed"; "matches" for soccer.
 */

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-muted-foreground mb-8">
          Last updated: July 7, 2026
        </p>

        <section className="space-y-6 text-sm leading-relaxed">
          <div>
            <h2 className="text-xl font-semibold mb-2">1. Information We Collect</h2>
            <p>
              When you create an account or use our sports intelligence software, we may collect:
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Account information (name, email address, login method)</li>
              <li>Usage data (pages visited, features used, session duration)</li>
              <li>Subscription and payment information (processed securely via Stripe)</li>
              <li>AI interaction data (queries submitted to our intelligence models)</li>
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">2. How We Use Your Information</h2>
            <p>We use collected information to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Provide and improve our sports intelligence software services</li>
              <li>Process subscription payments and manage your account</li>
              <li>Generate AI-powered analysis and model projections</li>
              <li>Send service-related communications</li>
              <li>Maintain platform security and prevent abuse</li>
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">3. AI & Data Processing Disclosures</h2>
            <p>
              Our platform uses artificial intelligence models to generate sports analysis,
              probability distributions, and market projections. Specifically:
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>
                AI models process publicly available sports data (match statistics,
                odds, team performance metrics) to generate analytical outputs.
              </li>
              <li>
                Your queries to our AI intelligence system may be logged for quality
                assurance and model improvement purposes.
              </li>
              <li>
                AI-generated outputs are probabilistic in nature and do not constitute
                financial advice, guaranteed outcomes, or endorsements of any wagering activity.
              </li>
              <li>
                We do not sell or share your AI interaction data with third parties for
                advertising purposes.
              </li>
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">4. Data Retention</h2>
            <p>
              We retain your account data for as long as your account is active. AI query
              logs are retained for up to 90 days for quality assurance, then anonymized
              or deleted. Payment records are retained as required by applicable law.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">5. Data Security</h2>
            <p>
              We implement industry-standard security measures including encrypted
              connections (TLS), secure authentication (OAuth 2.0), and access controls
              to protect your personal information.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">6. Third-Party Services</h2>
            <p>We use the following third-party services that may process your data:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Stripe — payment processing</li>
              <li>Anthropic (Claude) — AI model inference</li>
              <li>Railway — application hosting</li>
              <li>Discord — OAuth authentication</li>
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">7. Your Rights</h2>
            <p>
              You may request access to, correction of, or deletion of your personal data
              by contacting us. You may also close your account at any time through your
              profile settings.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">8. Responsible Gambling Notice</h2>
            <p>
              This platform provides sports intelligence software for informational and
              analytical purposes only. We do not facilitate, process, or accept wagers.
              All analytical outputs are probabilistic and should not be interpreted as
              guaranteed outcomes.
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
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">9. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify you of
              material changes via email or a prominent notice on our platform.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">10. Contact</h2>
            <p>
              For privacy-related inquiries, contact us at the email associated with your
              account or through the platform's support channels.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
