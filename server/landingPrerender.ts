/**
 * landingPrerender.ts
 *
 * Server-side prerender middleware for the landing page + legal pages.
 *
 * ARCHITECTURE:
 * - /privacy and /terms: serve full legal HTML to ALL user agents (browser or not).
 *   There is no correct reason for these routes to ever serve homepage HTML.
 *   Browsers get the legal content directly (fast, no JS required); React hydrates on top.
 * - /: serve prerendered landing HTML to bots only; browsers get the SPA shell.
 *
 * LOGGING:
 *   [Prerender][INPUT]  - UA + path
 *   [Prerender][STEP]   - detection result
 *   [Prerender][OUTPUT] - bytes sent
 *   [Prerender][VERIFY] - PASS/SKIP
 */

import { Request, Response, NextFunction } from "express";

// Bot / crawler UA patterns (used for landing page only)
const BOT_PATTERNS = [
  /googlebot/i, /bingbot/i, /slurp/i, /duckduckbot/i, /baiduspider/i,
  /yandexbot/i, /facebookexternalhit/i, /twitterbot/i, /linkedinbot/i,
  /whatsapp/i, /telegrambot/i, /discordbot/i, /slackbot/i, /applebot/i,
  /semrushbot/i, /ahrefsbot/i, /mj12bot/i, /dotbot/i, /rogerbot/i,
  /curl\//i, /wget\//i, /python-requests/i, /python-urllib/i,
  /node-fetch/i, /axios\//i, /go-http-client/i, /java\//i, /okhttp/i,
  /httpie/i, /insomnia/i, /postman/i,
  /claude-web/i, /anthropic/i, /gpt-crawler/i, /openai/i,
  /perplexitybot/i, /claudebot/i, /chatgpt/i, /cohere-ai/i,
  /ia_archiver/i, /archive\.org/i, /scrapy/i, /heritrix/i, /nutch/i,
  /spider/i, /crawler/i, /bot\b/i,
];

function isBot(ua: string): boolean {
  return BOT_PATTERNS.some((p) => p.test(ua));
}

// ─── Legal page builders (served to ALL user agents) ───────────────────────

function buildPrivacyHtml(): string {
  const title = "Privacy Policy | AI Sports Betting Models";
  const canonical = "https://aisportsbettingmodels.com/privacy";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${title}</title>
<meta name="description" content="Privacy Policy for AI Sports Betting Models — how we collect, use, and protect your data."/>
<link rel="canonical" href="${canonical}"/>
<meta property="og:type" content="website"/>
<meta property="og:url" content="${canonical}"/>
<meta property="og:title" content="${title}"/>
<meta name="robots" content="index,follow"/>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Familjen Grotesk",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#000000;color:#FFFFFF;line-height:1.7;padding:48px 24px}
.container{max-width:720px;margin:0 auto}
h1{font-size:2rem;font-weight:900;color:#FFFFFF;margin-bottom:8px}
h2{font-size:1.25rem;font-weight:700;color:#FFFFFF;margin-top:32px;margin-bottom:12px}
p{margin-bottom:12px;font-size:14px;color:#FFFFFF}
ul{padding-left:24px;margin-bottom:12px}
li{font-size:14px;color:#FFFFFF;margin-bottom:6px}
a{color:#45E0A8;text-decoration:underline}
.updated{color:#FFFFFF;font-size:13px;margin-bottom:32px}
.footer{margin-top:48px;padding-top:24px;border-top:1px solid #FFFFFF;text-align:center;color:#FFFFFF;font-size:12px}
</style>
</head>
<body>
<div class="container">
<h1>Privacy Policy</h1>
<p class="updated">Last updated: July 7, 2026</p>

<h2>1. Information We Collect</h2>
<p>When you create an account or use our sports intelligence software, we may collect:</p>
<ul>
<li>Account information (name, email address, login method)</li>
<li>Usage data (pages visited, features used, session duration)</li>
<li>Subscription and payment information (processed securely via Stripe)</li>
<li>AI interaction data (queries submitted to our intelligence models)</li>
</ul>

<h2>2. How We Use Your Information</h2>
<p>We use collected information to:</p>
<ul>
<li>Provide and improve our sports intelligence software services</li>
<li>Process subscription payments and manage your account</li>
<li>Generate AI-powered analysis and model projections</li>
<li>Send service-related communications</li>
<li>Maintain platform security and prevent abuse</li>
</ul>

<h2>3. AI &amp; Data Processing Disclosures</h2>
<p>Our platform uses artificial intelligence models to generate sports analysis, probability distributions, and market projections. Specifically:</p>
<ul>
<li>AI models process publicly available sports data (match statistics, odds, team performance metrics) to generate analytical outputs.</li>
<li>Your queries to our AI intelligence system may be logged for quality assurance and model improvement purposes.</li>
<li>AI-generated outputs are probabilistic in nature and do not constitute financial advice, guaranteed outcomes, or endorsements of any wagering activity.</li>
<li>We do not sell or share your AI interaction data with third parties for advertising purposes.</li>
</ul>

<h2>4. Data Retention</h2>
<p>We retain your account data for as long as your account is active. AI query logs are retained for up to 90 days for quality assurance, then anonymized or deleted. Payment records are retained as required by applicable law.</p>

<h2>5. Data Security</h2>
<p>We implement industry-standard security measures including encrypted connections (TLS), secure authentication (OAuth 2.0), and access controls to protect your personal information.</p>

<h2>6. Third-Party Services</h2>
<p>We use the following third-party services that may process your data:</p>
<ul>
<li>Stripe &mdash; payment processing</li>
<li>Anthropic (Claude) &mdash; AI model inference</li>
<li>Manus Platform &mdash; authentication and hosting</li>
</ul>

<h2>7. Your Rights</h2>
<p>You may request access to, correction of, or deletion of your personal data by contacting us. You may also close your account at any time through your profile settings.</p>

<h2>8. Responsible Gambling Notice</h2>
<p>This platform provides sports intelligence software for informational and analytical purposes only. We do not facilitate, process, or accept wagers. All analytical outputs are probabilistic and should not be interpreted as guaranteed outcomes.</p>
<p><strong>If you or someone you know has a gambling problem, call <a href="tel:1-800-426-2537">1-800-GAMBLER</a> (1-800-426-2537) for free, confidential help.</strong></p>
<p>National Council on Problem Gambling: <a href="https://www.ncpgambling.org" target="_blank" rel="noopener noreferrer">ncpgambling.org</a></p>

<h2>9. Changes to This Policy</h2>
<p>We may update this Privacy Policy from time to time. We will notify you of material changes via email or a prominent notice on our platform.</p>

<h2>10. Contact</h2>
<p>For privacy-related inquiries, contact us at the email associated with your account or through the platform's support channels.</p>

<div class="footer">&copy; ${new Date().getFullYear()} AI Sports Betting Models. All rights reserved.</div>
</div>
</body>
</html>`;
}

function buildTermsHtml(): string {
  const title = "Terms of Service | AI Sports Betting Models";
  const canonical = "https://aisportsbettingmodels.com/terms";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${title}</title>
<meta name="description" content="Terms of Service for AI Sports Betting Models — subscription terms, acceptable use, and disclaimers."/>
<link rel="canonical" href="${canonical}"/>
<meta property="og:type" content="website"/>
<meta property="og:url" content="${canonical}"/>
<meta property="og:title" content="${title}"/>
<meta name="robots" content="index,follow"/>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Familjen Grotesk",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#000000;color:#FFFFFF;line-height:1.7;padding:48px 24px}
.container{max-width:720px;margin:0 auto}
h1{font-size:2rem;font-weight:900;color:#FFFFFF;margin-bottom:8px}
h2{font-size:1.25rem;font-weight:700;color:#FFFFFF;margin-top:32px;margin-bottom:12px}
p{margin-bottom:12px;font-size:14px;color:#FFFFFF}
ul{padding-left:24px;margin-bottom:12px}
li{font-size:14px;color:#FFFFFF;margin-bottom:6px}
a{color:#45E0A8;text-decoration:underline}
.updated{color:#FFFFFF;font-size:13px;margin-bottom:32px}
.caps{text-transform:uppercase;font-size:13px}
.footer{margin-top:48px;padding-top:24px;border-top:1px solid #FFFFFF;text-align:center;color:#FFFFFF;font-size:12px}
</style>
</head>
<body>
<div class="container">
<h1>Terms of Service</h1>
<p class="updated">Last updated: July 7, 2026</p>

<h2>1. Acceptance of Terms</h2>
<p>By accessing or using AI Sports Betting Models ("the Platform"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Platform.</p>

<h2>2. Description of Service</h2>
<p>The Platform provides sports intelligence software that generates AI-powered analytical outputs including probability distributions, no-vig pricing, Monte Carlo simulations, and market edge analysis. The Platform covers multiple sports including soccer (matches), baseball, basketball, and hockey.</p>
<p><strong>The Platform does NOT provide guaranteed outcomes, financial advice, or wagering services. All outputs are probabilistic analytical tools.</strong></p>

<h2>3. Subscription Terms</h2>
<ul>
<li>Subscriptions are billed on a recurring basis (monthly or annually) through Stripe.</li>
<li>Your subscription renews automatically unless cancelled before the renewal date.</li>
<li>Cancellation takes effect at the end of the current billing period. No prorated refunds are issued for partial periods.</li>
<li>We reserve the right to modify pricing with 30 days advance notice. Existing subscribers retain their current rate until the next renewal cycle after the notice period.</li>
<li>AI credit allocations (DIME credits) are included with your subscription tier. Unused credits do not roll over between billing periods.</li>
</ul>

<h2>4. Acceptable Use</h2>
<p>You agree NOT to:</p>
<ul>
<li>Redistribute, resell, or publicly share Platform outputs</li>
<li>Use automated tools to scrape or bulk-download data</li>
<li>Attempt to reverse-engineer our AI models or algorithms</li>
<li>Use the Platform for any unlawful purpose</li>
<li>Share your account credentials with others</li>
<li>Circumvent rate limits or credit allocation systems</li>
</ul>

<h2>5. Intellectual Property</h2>
<p>All models, algorithms, analytical frameworks, and software comprising the Platform are the intellectual property of AI Sports Betting Models. Your subscription grants a limited, non-transferable license to use Platform outputs for personal analytical purposes only.</p>

<h2>6. Disclaimers</h2>
<p class="caps"><strong>THE PLATFORM IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND. WE DO NOT GUARANTEE THE ACCURACY, COMPLETENESS, OR RELIABILITY OF ANY ANALYTICAL OUTPUT. PAST PERFORMANCE OF OUR MODELS DOES NOT GUARANTEE FUTURE RESULTS.</strong></p>
<p>Our intelligence software generates probabilistic analysis based on historical data and statistical modeling. No output should be interpreted as a guarantee of any outcome or as financial advice.</p>

<h2>7. Limitation of Liability</h2>
<p class="caps"><strong>TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS OR REVENUES, WHETHER INCURRED DIRECTLY OR INDIRECTLY, OR ANY LOSS OF DATA, USE, GOODWILL, OR OTHER INTANGIBLE LOSSES RESULTING FROM YOUR USE OF THE PLATFORM.</strong></p>

<h2>8. Responsible Gambling</h2>
<p>This Platform provides sports intelligence software for informational and analytical purposes only. We do not facilitate, process, or accept wagers. You are solely responsible for compliance with all applicable laws in your jurisdiction regarding sports wagering.</p>
<p><strong>If you or someone you know has a gambling problem, call <a href="tel:1-800-426-2537">1-800-GAMBLER</a> (1-800-426-2537) for free, confidential help.</strong></p>
<p>National Council on Problem Gambling: <a href="https://www.ncpgambling.org" target="_blank" rel="noopener noreferrer">ncpgambling.org</a></p>
<p>You must be of legal age in your jurisdiction to use this Platform. By using the Platform, you represent that you meet the minimum age requirement.</p>

<h2>9. Account Termination</h2>
<p>We reserve the right to suspend or terminate your account if you violate these Terms. Upon termination, your access to the Platform and all associated data will be revoked.</p>

<h2>10. Changes to Terms</h2>
<p>We may modify these Terms at any time. Material changes will be communicated via email or a prominent notice on the Platform at least 14 days before taking effect. Continued use after changes constitutes acceptance.</p>

<h2>11. Governing Law</h2>
<p>These Terms are governed by the laws of the United States. Any disputes shall be resolved through binding arbitration in accordance with the rules of the American Arbitration Association.</p>

<h2>12. Contact</h2>
<p>For questions about these Terms, contact us through the Platform's support channels or at the email associated with your account.</p>

<div class="footer">&copy; ${new Date().getFullYear()} AI Sports Betting Models. All rights reserved.</div>
</div>
</body>
</html>`;
}

// ─── Landing page builder (served to bots only) ────────────────────────────
//
// CONTENT PARITY: this is a static snapshot of Dime landing v2
// (client/src/pages/dime/landing/ — copy source: landing-content.ts).
// Brand law: design-system/dime-ai/MASTER.md — mint #45E0A8 only, grey PASS
// states, Familjen Grotesk / IBM Plex Mono stacks, no gradients, no #39FF14.
// Guarded by server/landingPrerender.test.ts — update both together.

function buildLandingHtml(): string {
  const title = "dıme — See where price and probability disagree | Sports Betting Intelligence Software";
  const desc  = "Dime AI compares sportsbook prices against projected probability, movement, volatility, matchup context, and risk flags so every market resolves to Pass, Monitor, or Edge Detected.";
  const url   = "https://aisportsbettingmodels.com/";
  const year  = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${title}</title>
<meta name="description" content="${desc}"/>
<link rel="canonical" href="${url}"/>
<meta property="og:type" content="website"/>
<meta property="og:url" content="${url}"/>
<meta property="og:title" content="${title}"/>
<meta property="og:description" content="${desc}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${title}"/>
<meta name="twitter:description" content="${desc}"/>
<meta name="robots" content="index,follow"/>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0B0B0F;--surface:#121218;--line:rgba(255,255,255,.08);--text:#F2F2F5;--text-secondary:#9A9AA3;--text-muted:#6B6B75;--mint:#45E0A8}
body{font-family:"Familjen Grotesk","Familjen Grotesk",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);line-height:1.6}
a{color:inherit;text-decoration:none}
.mono{font-family:"Familjen Grotesk", system-ui, -apple-system, sans-serif;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted)}
.nav{display:flex;align-items:center;justify-content:space-between;padding:16px 32px;border-bottom:1px solid var(--line);background:var(--bg)}
.nav-logo{font-weight:700;font-size:18px;letter-spacing:-.02em}
.nav-cta{background:var(--mint);color:#0B0B0F;font-weight:600;font-size:13px;padding:8px 20px;border-radius:8px}
.hero{text-align:center;padding:88px 24px 56px}
h1{font-size:clamp(2.25rem,5.5vw,4.25rem);font-weight:700;letter-spacing:-.03em;line-height:1.06;color:var(--text);max-width:880px;margin:16px auto 0}
h1 em{font-style:normal;color:var(--mint)}
.sub{max-width:620px;margin:20px auto 28px;color:var(--text-secondary);font-size:clamp(1rem,1.5vw,1.125rem)}
.cta{display:inline-block;background:var(--mint);color:#0B0B0F;font-weight:600;font-size:15px;padding:14px 32px;border-radius:10px}
.micro{margin-top:16px;color:var(--text-muted);font-size:12px}
.section{max-width:1040px;margin:0 auto;padding:64px 24px}
.section h2{font-size:clamp(1.6rem,3vw,2.25rem);font-weight:700;letter-spacing:-.02em;margin-bottom:12px}
.section .lead{color:var(--text-secondary);font-size:15px;max-width:640px;margin-bottom:36px}
table{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden}
th{padding:10px 14px;text-align:left;border-bottom:1px solid var(--line)}
td{padding:12px 14px;font-size:14px;border-bottom:1px solid var(--line);color:var(--text-secondary)}
td b{color:var(--text);font-weight:700}
.state{font-weight:600}
.state-edge{color:var(--mint)}
.state-monitor{color:var(--text)}
.state-pass{color:var(--text-secondary);opacity:.82}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:20px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:24px}
.card h3{font-size:16px;font-weight:600;margin-bottom:8px}
.card p{font-size:14px;color:var(--text-secondary);line-height:1.6}
.price{font-size:28px;font-weight:700;color:var(--text);margin:6px 0}
.per{font-size:12px;color:var(--text-muted)}
.faq-item{border-bottom:1px solid var(--line);padding:18px 0}
.faq-q{font-size:15px;font-weight:600;margin-bottom:8px}
.faq-a{font-size:14px;color:var(--text-secondary);line-height:1.7}
.footer{border-top:1px solid var(--line);padding:32px 24px;text-align:center;color:var(--text-muted);font-size:12px}
.disclaimer{max-width:720px;margin:0 auto 12px;line-height:1.7}
</style>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"SoftwareApplication","name":"Dime AI (AI Sports Betting Models)","applicationCategory":"SportsApplication","description":"${desc}","url":"${url}","offers":[{"@type":"Offer","name":"Pro Monthly","price":"99","priceCurrency":"USD"},{"@type":"Offer","name":"Sharp Monthly","price":"249","priceCurrency":"USD"},{"@type":"Offer","name":"Operator Monthly","price":"499","priceCurrency":"USD"}]}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Is this a picks service?","acceptedAnswer":{"@type":"Answer","text":"No. Dime AI is analytical software. It compares sportsbook prices against projected probability and classifies every market as Pass, Monitor, or Edge Detected. You make your own decisions."}},{"@type":"Question","name":"How does the model work?","acceptedAnswer":{"@type":"Answer","text":"10,000 simulations per game generate probability distributions, which are compared against the book's implied probability along with movement, volatility, and matchup context. Outputs are Brier-scored against closing prices."}},{"@type":"Question","name":"What does it cost?","acceptedAnswer":{"@type":"Answer","text":"Pro is $99/month, Sharp is $249/month and Operator is $499/month. On-page demos are free to preview, and founder access is by application."}}]}</script>
</head>
<body>
<nav class="nav">
  <span class="nav-logo">d&#305;me</span>
  <a href="/checkout?plan=pro" class="nav-cta">Get Access</a>
</nav>
<section class="hero">
  <div class="mono">Sports betting intelligence software</div>
  <h1>See where price and probability <em>disagree</em>.</h1>
  <p class="sub">Dime AI compares sportsbook prices against projected probability, movement, volatility, matchup context, and risk flags so every market resolves to Pass, Monitor, or Edge Detected.</p>
  <a href="/checkout?plan=pro" class="cta">Get Access</a>
  <p class="micro">Analytical software. No guaranteed outcomes. Built for disciplined market evaluation.</p>
</section>
<section class="section" id="console">
  <div class="mono">Demo &mdash; sample markets</div>
  <h2>Every market resolves to one of three states.</h2>
  <p class="lead">The Dime Market Console runs the comparison and classifies the result. Pass is a first-class output &mdash; most markets are efficiently priced, and the software says so.</p>
  <table>
    <thead><tr><th class="mono">Market</th><th class="mono">Book</th><th class="mono">Implied</th><th class="mono">Projection</th><th class="mono">Edge</th><th class="mono">State</th></tr></thead>
    <tbody>
      <tr><td><b>Team A Moneyline</b> &middot; MLB</td><td>&minus;115</td><td>53.5%</td><td><b>58.9%</b></td><td><b>+5.4%</b></td><td class="state state-edge">Edge Detected</td></tr>
      <tr><td><b>Team C &minus;4.5 Spread</b> &middot; NBA</td><td>&minus;110</td><td>52.4%</td><td><b>55.8%</b></td><td><b>+3.4%</b></td><td class="state state-monitor">Monitor</td></tr>
      <tr><td><b>Team E Over 8.5 Total</b> &middot; MLB</td><td>&minus;105</td><td>51.2%</td><td>49.6%</td><td>&minus;1.6%</td><td class="state state-pass">Pass</td></tr>
    </tbody>
  </table>
</section>
<section class="section">
  <h2>What the engine does</h2>
  <div class="grid">
    <div class="card"><h3>10,000 simulations per game</h3><p>Probability distributions for every outcome, generated per market and compared against the book's implied probability.</p></div>
    <div class="card"><h3>No-vig fair pricing</h3><p>Every line is stripped of the book's margin so the comparison starts from an honest baseline.</p></div>
    <div class="card"><h3>Movement &amp; volatility flags</h3><p>Open-to-current movement and volatility context qualify every classification &mdash; an edge that is shrinking is labeled Monitor, not Edge.</p></div>
    <div class="card"><h3>Scored against the close</h3><p>Outputs are Brier-scored versus closing prices, with odds frozen at first pitch. 55+ outputs per market, 124 enforcement tests.</p></div>
    <div class="card"><h3>Dime Chat</h3><p>Ask the engine directly. Restrained, numbers-first answers with the same Pass / Monitor / Edge classification.</p></div>
    <div class="card"><h3>MLB + World Cup 2026</h3><p>Live coverage today, with the same methodology extending across sports.</p></div>
  </div>
</section>
<section class="section" id="pricing">
  <h2>One engine. Priced like software.</h2>
  <p class="lead">No picks packages. No units sold. Software pricing for disciplined market evaluation.</p>
  <div class="grid">
    <div class="card"><div class="mono">Free Preview</div><div class="price">$0</div><div class="per">On-page demos</div><p>Explore the Market Console and Dime Chat demos on this page.</p></div>
    <div class="card"><div class="mono">Pro</div><div class="price">$99</div><div class="per">per month &mdash; &asymp;$3.30/day &middot; cancel anytime</div><p>Full projections board, Standard + Pro Analyst chat, 1,000 AI Analyst credits / month.</p><p><a class="cta" style="margin-top:12px" href="/checkout?plan=pro">Start Pro</a></p></div>
    <div class="card"><div class="mono">Sharp</div><div class="price">$249</div><div class="per">per month &mdash; &asymp;$8.30/day &middot; cancel anytime</div><p>Everything in Pro, MAX Analyst access (monthly cap), 3,000 AI Analyst credits / month.</p><p><a class="cta" style="margin-top:12px" href="/checkout?plan=sharp">Start Sharp</a></p></div>
    <div class="card"><div class="mono">Operator</div><div class="price">$499</div><div class="per">per month &mdash; &asymp;$16.63/day &middot; cancel anytime</div><p>Everything in Sharp, full MAX Analyst access (no cap), 8,000 AI Analyst credits / month.</p><p><a class="cta" style="margin-top:12px" href="/checkout?plan=operator">Start Operator</a></p></div>
  </div>
  <div class="grid" style="margin-top:20px">
    <div class="card"><div class="mono">Founder</div><div class="price">By application</div><div class="per">Limited</div><p>Controlled access for serious operators. Application reviewed manually.</p></div>
  </div>
</section>
<section class="section">
  <h2>Frequently asked questions</h2>
  <div class="faq-item"><div class="faq-q">Is this a picks service?</div><div class="faq-a">No. Dime AI is analytical software. It classifies markets as Pass, Monitor, or Edge Detected based on where price and projected probability disagree. You make your own decisions.</div></div>
  <div class="faq-item"><div class="faq-q">How does the model work?</div><div class="faq-a">10,000 simulations per game generate probability distributions, compared against the book's implied probability alongside movement, volatility, and matchup context. Outputs are Brier-scored against closing prices.</div></div>
  <div class="faq-item"><div class="faq-q">Why does it say Pass so often?</div><div class="faq-a">Because most markets are efficiently priced. A tool that finds an edge everywhere is not measuring anything. Pass means: no action, keep your bankroll.</div></div>
  <div class="faq-item"><div class="faq-q">Can I cancel at any time?</div><div class="faq-a">Yes. No long-term commitments &mdash; cancel from your account settings and access runs to the end of the billing period.</div></div>
</section>
<footer class="footer">
  <p class="disclaimer">Dime AI (AI Sports Betting Models) is sports betting intelligence software. All projections, probabilities, and classifications are generated by mathematical models for informational purposes only. No guaranteed outcomes. Past model performance does not guarantee future results. Sports betting involves financial risk &mdash; bet responsibly and within your means.</p>
  <p class="disclaimer"><b>21+ only.</b> If you or someone you know has a gambling problem, call <a href="tel:1-800-426-2537" style="color:var(--mint)">1-800-GAMBLER</a> for free, confidential help.</p>
  <p>&copy; ${year} AI Sports Betting Models. All rights reserved.</p>
</footer>
</body>
</html>`;
}

// ─── Middleware ──────────────────────────────────────────────────────────────

export function landingPrerenderMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (req.method !== "GET") {
    return next();
  }

  const path = req.path;
  const ua = (req.headers["user-agent"] ?? "").toLowerCase();

  // /privacy and /terms: serve legal content to ALL user agents unconditionally.
  // There is no correct reason for these routes to ever serve homepage HTML.
  if (path === "/privacy") {
    console.log(`[Prerender][INPUT] path=${path} ua="${ua.slice(0, 80)}"`);
    console.log("[Prerender][STEP] Legal page — serving to ALL user agents");
    const html = buildPrivacyHtml();
    console.log(`[Prerender][OUTPUT] /privacy bytes=${html.length}`);
    console.log("[Prerender][VERIFY] PASS — privacy content served");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=7200");
    res.setHeader("X-Prerender", "legal");
    res.status(200).send(html);
    return;
  }

  if (path === "/terms") {
    console.log(`[Prerender][INPUT] path=${path} ua="${ua.slice(0, 80)}"`);
    console.log("[Prerender][STEP] Legal page — serving to ALL user agents");
    const html = buildTermsHtml();
    console.log(`[Prerender][OUTPUT] /terms bytes=${html.length}`);
    console.log("[Prerender][VERIFY] PASS — terms content served");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=7200");
    res.setHeader("X-Prerender", "legal");
    res.status(200).send(html);
    return;
  }

  // Landing page (/): bot-only prerender
  if (path !== "/") {
    return next();
  }

  console.log(`[Prerender][INPUT] path=${path} ua="${ua.slice(0, 120)}"`);

  const botDetected = isBot(ua);

  console.log(`[Prerender][STEP] botDetected=${botDetected}`);

  if (!botDetected) {
    console.log("[Prerender][VERIFY] SKIP -- real browser, serving SPA");
    return next();
  }

  const html = buildLandingHtml();

  console.log(`[Prerender][OUTPUT] serving static HTML -- bytes=${html.length}`);
  console.log("[Prerender][VERIFY] PASS -- static landing HTML sent to crawler");

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=600");
  res.setHeader("X-Prerender", "1");
  res.status(200).send(html);
}
