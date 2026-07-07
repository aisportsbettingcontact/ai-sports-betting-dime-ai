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
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#050810;color:#e5e7eb;line-height:1.7;padding:48px 24px}
.container{max-width:720px;margin:0 auto}
h1{font-size:2rem;font-weight:900;color:#fff;margin-bottom:8px}
h2{font-size:1.25rem;font-weight:700;color:#fff;margin-top:32px;margin-bottom:12px}
p{margin-bottom:12px;font-size:14px;color:#9ca3af}
ul{padding-left:24px;margin-bottom:12px}
li{font-size:14px;color:#9ca3af;margin-bottom:6px}
a{color:#39FF14;text-decoration:underline}
.updated{color:#6b7280;font-size:13px;margin-bottom:32px}
.footer{margin-top:48px;padding-top:24px;border-top:1px solid rgba(255,255,255,.06);text-align:center;color:#4b5563;font-size:12px}
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
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#050810;color:#e5e7eb;line-height:1.7;padding:48px 24px}
.container{max-width:720px;margin:0 auto}
h1{font-size:2rem;font-weight:900;color:#fff;margin-bottom:8px}
h2{font-size:1.25rem;font-weight:700;color:#fff;margin-top:32px;margin-bottom:12px}
p{margin-bottom:12px;font-size:14px;color:#9ca3af}
ul{padding-left:24px;margin-bottom:12px}
li{font-size:14px;color:#9ca3af;margin-bottom:6px}
a{color:#39FF14;text-decoration:underline}
.updated{color:#6b7280;font-size:13px;margin-bottom:32px}
.caps{text-transform:uppercase;font-size:13px}
.footer{margin-top:48px;padding-top:24px;border-top:1px solid rgba(255,255,255,.06);text-align:center;color:#4b5563;font-size:12px}
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

function buildLandingHtml(): string {
  const title = "AI Sports Betting Models | Sports Betting Intelligence Software";
  const desc  = "Be First to Access the Future of Sports Betting. AI-powered projections, betting splits, line movement, and sharp indicators in one dashboard.";
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
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#050810;color:#fff;line-height:1.6}
a{color:inherit;text-decoration:none}
.nav{display:flex;align-items:center;justify-content:space-between;padding:16px 32px;border-bottom:1px solid rgba(255,255,255,.06);background:rgba(5,8,16,.9)}
.nav-logo{font-weight:900;font-size:16px}
.nav-cta{background:#39FF14;color:#000;font-weight:700;font-size:13px;padding:8px 20px;border-radius:8px}
.hero{text-align:center;padding:80px 24px 60px;background:radial-gradient(ellipse 80% 50% at 50% 0%,rgba(57,255,20,.06) 0%,transparent 70%)}
.badge{display:inline-flex;align-items:center;gap:8px;padding:4px 14px;border-radius:999px;margin-bottom:24px;background:rgba(57,255,20,.08);border:1px solid rgba(57,255,20,.2);color:#39FF14;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
.dot{width:6px;height:6px;border-radius:50%;background:#39FF14;box-shadow:0 0 6px #39FF14;display:inline-block}
h1{font-size:clamp(2.5rem,6vw,5rem);font-weight:900;letter-spacing:-.04em;line-height:1.05;color:#fff}
.green{color:#39FF14}
.sub{max-width:560px;margin:20px auto 32px;color:#9ca3af;font-size:clamp(1rem,1.6vw,1.15rem)}
.cta{display:inline-block;background:#39FF14;color:#000;font-weight:700;font-size:16px;padding:16px 36px;border-radius:10px;box-shadow:0 0 24px rgba(57,255,20,.3)}
.sports{display:flex;flex-wrap:wrap;justify-content:center;gap:28px;padding:40px 24px;border-top:1px solid rgba(255,255,255,.05);border-bottom:1px solid rgba(255,255,255,.05)}
.sport{text-align:center}
.sport-emoji{font-size:28px;display:block;margin-bottom:6px}
.sport-name{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#9ca3af}
.sport-live{font-size:10px;color:#39FF14;margin-top:2px}
.sport-soon{font-size:10px;color:#4b5563;margin-top:2px}
.features{padding:64px 24px;max-width:1100px;margin:0 auto}
.features h2,.faq h2,.waitlist h2{text-align:center;font-size:clamp(1.75rem,3.5vw,2.5rem);font-weight:900;letter-spacing:-.03em;margin-bottom:48px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:24px}
.card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:28px}
.card h3{font-size:17px;font-weight:700;margin-bottom:8px}
.card p{font-size:14px;color:#9ca3af;line-height:1.6}
.waitlist{max-width:560px;margin:0 auto;padding:64px 24px;text-align:center}
.waitlist-sub{color:#9ca3af;font-size:15px;margin-bottom:32px}
.wcard{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:32px;text-align:left}
.lbl{display:block;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#9ca3af;margin-bottom:8px}
.inp{width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:12px 16px;color:#fff;font-size:15px;margin-bottom:16px;outline:none}
.sbtn{width:100%;background:#39FF14;color:#000;font-weight:700;font-size:15px;padding:16px;border-radius:10px;border:none;cursor:pointer;box-shadow:0 0 24px rgba(57,255,20,.25)}
.faq{padding:64px 24px;max-width:720px;margin:0 auto}
.faq-item{border-bottom:1px solid rgba(255,255,255,.07);padding:20px 0}
.faq-q{font-size:16px;font-weight:700;margin-bottom:10px}
.faq-a{font-size:14px;color:#9ca3af;line-height:1.7}
.footer{border-top:1px solid rgba(255,255,255,.06);padding:32px 24px;text-align:center;color:#4b5563;font-size:12px}
.disclaimer{max-width:700px;margin:0 auto 12px;line-height:1.7}
</style>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"SoftwareApplication","name":"AI Sports Betting Models","applicationCategory":"SportsApplication","description":"${desc}","url":"${url}","offers":[{"@type":"Offer","name":"Monthly","price":"99","priceCurrency":"USD"},{"@type":"Offer","name":"Annual","price":"499","priceCurrency":"USD"}]}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"What sports are covered?","acceptedAnswer":{"@type":"Answer","text":"MLB and World Cup 2026 are live now. NFL, NBA, NHL, CFP, NCAAM, and UFC are coming soon."}},{"@type":"Question","name":"How do the AI models work?","acceptedAnswer":{"@type":"Answer","text":"Dixon-Coles Poisson modeling combined with large-scale Monte Carlo simulations generates probability distributions for every game outcome."}},{"@type":"Question","name":"How do I get access?","acceptedAnswer":{"@type":"Answer","text":"Access is currently invite-only. Join the waitlist and we will notify you when your access is ready."}}]}</script>
</head>
<body>
<nav class="nav">
  <span class="nav-logo">AI Sports Betting</span>
  <a href="#waitlist" class="nav-cta">Join Waitlist</a>
</nav>
<section class="hero">
  <div class="badge"><span class="dot"></span>Early Access &mdash; Limited Spots</div>
  <h1>Be First to Access<br/><span class="green">The Future of Sports Betting.</span></h1>
  <p class="sub">AI model projections, betting splits, line movement, and sharp indicators &mdash; all in one dashboard. Research smarter. Bet with conviction.</p>
  <a href="#waitlist" class="cta">Join the Waitlist &rarr;</a>
</section>
<div class="sports">
  <div class="sport"><span class="sport-emoji">&#9918;</span><div class="sport-name">MLB</div><div class="sport-live">&#9679; Live</div></div>
  <div class="sport"><span class="sport-emoji">&#9917;</span><div class="sport-name">World Cup</div><div class="sport-live">&#9679; Live</div></div>
  <div class="sport"><span class="sport-emoji">&#127944;</span><div class="sport-name">NFL</div><div class="sport-soon">Coming Soon</div></div>
  <div class="sport"><span class="sport-emoji">&#127936;</span><div class="sport-name">NBA</div><div class="sport-soon">Coming Soon</div></div>
  <div class="sport"><span class="sport-emoji">&#127944;</span><div class="sport-name">NHL</div><div class="sport-soon">Coming Soon</div></div>
  <div class="sport"><span class="sport-emoji">&#127942;</span><div class="sport-name">CFP</div><div class="sport-soon">Coming Soon</div></div>
  <div class="sport"><span class="sport-emoji">&#127979;</span><div class="sport-name">NCAAM</div><div class="sport-soon">Coming Soon</div></div>
  <div class="sport"><span class="sport-emoji">&#129354;</span><div class="sport-name">UFC</div><div class="sport-soon">Coming Soon</div></div>
</div>
<section class="features">
  <h2>What You Get</h2>
  <div class="grid">
    <div class="card"><h3>AI Model Projections</h3><p>Dixon-Coles Poisson modeling + Monte Carlo simulation generates probability distributions for every game outcome.</p></div>
    <div class="card"><h3>No-Vig Fair Value</h3><p>Every line is stripped of the book's margin and converted to true probability, giving you an honest baseline for every market.</p></div>
    <div class="card"><h3>Sharp Money Indicators</h3><p>Betting splits, line movement, and reverse line movement signals surface where sharp money is flowing &mdash; updated in real time.</p></div>
    <div class="card"><h3>Book vs. Model Comparison</h3><p>Every game shows the book's implied probability alongside the model's projection so you can identify value at a glance.</p></div>
    <div class="card"><h3>Multi-Sport Coverage</h3><p>MLB live now. NFL, NBA, NHL, CFP, NCAAM, World Cup, and UFC coming soon. One dashboard for every sport you bet.</p></div>
    <div class="card"><h3>Invite-Only Access</h3><p>Access is restricted to a select group of serious bettors. Join the waitlist to reserve your spot before the public launch.</p></div>
  </div>
</section>
<section class="waitlist" id="waitlist">
  <div class="badge"><span class="dot"></span>Invite-Only Access</div>
  <h2>Be First to Access</h2>
  <p class="waitlist-sub">We are opening access to a select group before public launch. Reserve your spot now.</p>
  <div class="wcard">
    <label class="lbl">Full Name <span style="color:#39FF14">*</span></label>
    <input class="inp" type="text" placeholder="John Smith"/>
    <label class="lbl">Email Address <span style="color:#39FF14">*</span></label>
    <input class="inp" type="email" placeholder="you@example.com"/>
    <button class="sbtn">Reserve My Spot &rarr;</button>
  </div>
</section>
<section class="faq">
  <h2>Frequently Asked Questions</h2>
  <div class="faq-item"><div class="faq-q">What sports are covered?</div><div class="faq-a">MLB and World Cup 2026 are live now. NFL, NBA, NHL, CFP, NCAAM, and UFC are coming soon. All sports are modeled using the same AI-driven methodology.</div></div>
  <div class="faq-item"><div class="faq-q">How do the AI models work?</div><div class="faq-a">The platform uses Dixon-Coles Poisson modeling combined with large-scale Monte Carlo simulations to generate probability distributions for every game outcome. No heuristics. No gut picks. Pure math.</div></div>
  <div class="faq-item"><div class="faq-q">How do I get access?</div><div class="faq-a">Access is currently invite-only. Join the waitlist above and we will notify you when your access is ready. Providing additional information in Step 2 can move you up in the queue.</div></div>
  <div class="faq-item"><div class="faq-q">Is this a picks service?</div><div class="faq-a">No. This is a data and analytics platform. We provide probability distributions, model projections, and sharp money indicators. You make your own decisions.</div></div>
  <div class="faq-item"><div class="faq-q">Can I cancel at any time?</div><div class="faq-a">Yes. There are no long-term commitments. You can cancel your subscription at any time from your account settings.</div></div>
</section>
<footer class="footer">
  <p class="disclaimer">AI Sports Betting Models is a data analytics platform. All projections, probabilities, and indicators are generated by mathematical models and are provided for informational purposes only. Sports betting involves financial risk. Past model performance does not guarantee future results. Please bet responsibly and within your means. This platform does not constitute financial or legal advice.</p>
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
