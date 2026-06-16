/**
 * landingPrerender.ts
 *
 * Server-side prerender middleware for the landing page.
 *
 * PROBLEM: The React SPA sends a bare <div id="root"></div> shell to all
 * clients. Crawlers, fetch tools (curl, Claude, Googlebot, etc.) that do not
 * execute JavaScript see only a loading spinner.
 *
 * SOLUTION: When a GET "/" request arrives and the User-Agent matches a known
 * bot/crawler/fetch pattern, the server returns a fully expanded, styled HTML
 * page with all landing page content inline.  Real browsers continue to
 * receive the normal SPA shell.
 *
 * LOGGING:
 *   [Prerender][INPUT]  - UA + path
 *   [Prerender][STEP]   - detection result
 *   [Prerender][OUTPUT] - bytes sent
 *   [Prerender][VERIFY] - PASS/SKIP
 */

import { Request, Response, NextFunction } from "express";

// Bot / crawler UA patterns
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

export function landingPrerenderMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (req.method !== "GET" || req.path !== "/") {
    return next();
  }

  const ua = (req.headers["user-agent"] ?? "").toLowerCase();

  console.log(`[Prerender][INPUT] path=${req.path} ua="${ua.slice(0, 120)}"`);

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
