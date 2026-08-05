#!/usr/bin/env node
/**
 * Post-deploy smoke test — run against any deployed origin:
 *
 *   node scripts/smoke-deploy.mjs https://ai-sports-betting-dime-ai-production.up.railway.app
 *   node scripts/smoke-deploy.mjs https://aisportsbettingmodels.com
 *
 * Checks (no credentials needed — auth gates are asserted, not bypassed):
 *   1. /health            → 200
 *   2. /                  → 200 HTML (SPA shell)
 *   3. hashed asset       → 200 + immutable cache header
 *   4. /api/trpc/<bogus>  → JSON error from tRPC (API layer mounted, not SPA fallback)
 *   5. POST /api/dime/chat (unauthenticated) → 401 JSON (SSE route mounted + auth gate)
 *
 * Exit 0 = all pass. Non-zero = failures listed. Use it after every
 * Railway deploy and against the custom domain to validate the /api proxy.
 */

const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!/^https?:\/\//.test(base)) {
  console.error("Usage: node scripts/smoke-deploy.mjs <https://deployed-origin>");
  process.exit(2);
}

const results = [];

async function check(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - started, detail });
    console.log(`  ✅ ${name} (${Date.now() - started}ms) ${detail ?? ""}`);
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - started, detail: err.message });
    console.log(`  ❌ ${name} (${Date.now() - started}ms) — ${err.message}`);
  }
}

function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}

console.log(`Smoke-testing ${base}\n`);

await check("GET /health → 200", async () => {
  const res = await fetch(`${base}/health`, { redirect: "manual" });
  expect(res.status === 200, `status ${res.status}`);
  return (await res.text()).slice(0, 60);
});

let indexHtml = "";
await check("GET / → 200 HTML shell", async () => {
  const res = await fetch(`${base}/`);
  expect(res.status === 200, `status ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  expect(type.includes("text/html"), `content-type ${type}`);
  indexHtml = await res.text();
  expect(indexHtml.includes("<div id=\"root\""), "no #root div — not the SPA shell");
});

await check("hashed asset → 200 + long-lived cache", async () => {
  const m = indexHtml.match(/\/assets\/[\w./-]+\.js/);
  expect(m, "no /assets/*.js reference found in index.html");
  const res = await fetch(`${base}${m[0]}`);
  expect(res.status === 200, `status ${res.status}`);
  const cache = res.headers.get("cache-control") ?? "";
  expect(/max-age=\d{5,}/.test(cache), `weak cache-control: "${cache}"`);
  return m[0];
});

await check("GET /api/trpc/<bogus> → tRPC JSON error (API mounted)", async () => {
  const res = await fetch(`${base}/api/trpc/smokeTest.doesNotExist`);
  const type = res.headers.get("content-type") ?? "";
  expect(type.includes("application/json"), `content-type ${type} — SPA fallback answered; /api proxy or mount is broken`);
  expect(res.status < 500, `status ${res.status} — upstream/gateway error, not a tRPC response`);
  const body = await res.json();
  const isTrpcShape = Array.isArray(body) ? body[0]?.error : body?.error;
  expect(isTrpcShape, `not a tRPC error envelope: ${JSON.stringify(body).slice(0, 80)}`);
  return `status ${res.status}`;
});

await check("POST /api/dime/chat unauthenticated → 401 JSON (auth gate)", async () => {
  const res = await fetch(`${base}/api/dime/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "smoke" }] }),
  });
  expect(res.status === 401, `status ${res.status} — expected the pre-stream auth gate`);
  const body = await res.json();
  expect(body?.error, "401 without JSON error body");
});

await check("bot UA on / → v2 SEO content (prerender or shell block)", async () => {
  const res = await fetch(`${base}/`, { headers: { "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" } });
  expect(res.status === 200, `status ${res.status}`);
  const html = await res.text();
  // Express origins (Railway) serve the full prerender snapshot (X-Prerender: 1).
  // If a static host ever serves index.html directly, bots get the SPA shell
  // whose noscript SEO block must carry the v2 copy. Either way: v2 positioning
  // present, no forbidden neon.
  const surface = res.headers.get("x-prerender") === "1" ? "prerender snapshot" : "SPA shell SEO block";
  expect(html.includes("See where price and probability"), `v2 copy missing from bot-served HTML (${surface})`);
  expect(!/39FF14/i.test(html), `forbidden neon #39FF14 present (${surface}, brand law)`);
  return surface;
});

await check("vendored /dime-storage asset → 200 image (no external storage dependency)", async () => {
  const res = await fetch(`${base}/dime-storage/mlb-logo_50fd8568.png`, { redirect: "follow" });
  expect(res.status === 200, `status ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  expect(type.startsWith("image/"), `content-type ${type} — storage proxy failed instead of serving the vendored file`);
});

await check("checkout CSP allows Stripe Embedded (script-src js.stripe.com + frame-src checkout.stripe.com)", async () => {
  const res = await fetch(`${base}/checkout?plan=monthly`, { headers: { "user-agent": "Mozilla/5.0 Chrome/126" } });
  const csp = res.headers.get("content-security-policy") ?? "";
  // Railway (Express + helmet) always sets a CSP header. A missing header means
  // the origin isn't serving through helmet — a real regression, not a lenient
  // pass: without Stripe allowances embedded checkout breaks with "Failed to
  // load Stripe.js" (live incident 2026-07-10).
  expect(csp, "no CSP header — helmet not applied on the checkout route");
  const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src")) ?? "";
  const frameSrc = csp.split(";").find((d) => d.trim().startsWith("frame-src")) ?? "";
  expect(scriptSrc.includes("js.stripe.com"), `script-src blocks Stripe.js: "${scriptSrc.trim()}"`);
  expect(frameSrc.includes("checkout.stripe.com"), `frame-src blocks the checkout iframe: "${frameSrc.trim()}"`);
  return "CSP allows Stripe";
});

await check("rate-limit keying resists X-Forwarded-For spoofing (Railway sanitizes)", async () => {
  // Security invariant: limiter keys are the TRUE client, so a spoofed leftmost
  // X-Forwarded-For must NOT mint a fresh budget. We hit the feed limiter twice
  // from this one machine — once plain, once with a spoofed XFF — and assert the
  // RateLimit `remaining` counter keeps DECREASING (one shared key) instead of
  // resetting to the max (which would mean Railway stopped sanitizing XFF and
  // the client can pick its own limiter identity). This converts the one-time
  // manual XFF check into a permanent per-deploy gate.
  //
  // The invariant only holds BEHIND the sanitizing edge. Against a direct
  // localhost target there is no proxy to strip the injected header, so the app
  // (correctly) trusts the leftmost XFF and the check would be meaningless — we
  // mark it N/A there with a concrete reason rather than assert a false result.
  const behindEdge = base.startsWith("https://") && !/(localhost|127\.0\.0\.1|\[::1\])/.test(base);
  if (!behindEdge) {
    return "N/A — direct/localhost target has no sanitizing edge; invariant holds only behind Railway's proxy";
  }
  const url = `${base}/api/trpc/games.list?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%22sport%22%3A%22MLB%22%7D%7D%7D`;
  const remainingOf = (res) => {
    const h = res.headers.get("ratelimit") ?? res.headers.get("RateLimit") ?? "";
    const m = h.match(/remaining=(\d+)/i);
    return m ? Number(m[1]) : null;
  };
  const first = await fetch(url);
  const r1 = remainingOf(first);
  expect(r1 !== null, "no RateLimit header on games.list — feed limiter not mounted");
  const spoofed = await fetch(url, { headers: { "x-forwarded-for": "203.0.113.250" } });
  const r2 = remainingOf(spoofed);
  expect(r2 !== null, "no RateLimit header on the spoofed request");
  // Shared key → r2 continues the same budget (strictly below the fresh max).
  // If spoofing minted a new key, r2 would jump back to (max-1) = 59.
  expect(
    r2 <= r1 - 1 || r2 < 59,
    `spoofed XFF got a fresh budget (r1=${r1}, r2=${r2}) — Railway XFF sanitization may have changed; limiter keying is now spoofable`
  );
  return `plain remaining=${r1} → spoofed remaining=${r2} (shared key)`;
});

// ─── Phase 4 edge-defense checks (opt-in via SMOKE_EDGE=cloudflare) ──────────
// Only run when explicitly enabled so the default (pre-Cloudflare) gate is
// unchanged. Verifies the origin lock + that the WAF does not edge-block the
// free-text API surface. `base` should be the CF-fronted hostname; the direct
// Railway origin (for the lock check) comes from SMOKE_ORIGIN_URL.
if (process.env.SMOKE_EDGE === "cloudflare") {
  const originUrl = (process.env.SMOKE_ORIGIN_URL ?? "").replace(/\/$/, "");

  await check("origin lock: direct origin without secret → 403", async () => {
    if (!/^https?:\/\//.test(originUrl)) {
      return "N/A — set SMOKE_ORIGIN_URL to the direct *.up.railway.app origin to assert the lock";
    }
    const res = await fetch(
      `${originUrl}/api/trpc/games.list?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%22sport%22%3A%22MLB%22%7D%7D%7D`,
      { redirect: "manual" }
    );
    expect(
      res.status === 403,
      `expected 403 on a secret-less direct-origin hit, got ${res.status} — origin lock not enforcing (EDGE_MODE=on?)`
    );
    return "direct origin 403s without the edge secret";
  });

  await check("origin lock: /health reachable on the direct origin (Railway probe)", async () => {
    if (!/^https?:\/\//.test(originUrl)) return "N/A — no SMOKE_ORIGIN_URL";
    const res = await fetch(`${originUrl}/health`, { redirect: "manual" });
    expect(res.status === 200, `/health returned ${res.status} on the direct origin — probe would fail`);
    return "/health stays 200 direct (healthcheck survives edge outage)";
  });

  await check("WAF does not edge-block free-text API (Dime Chat betting jargon)", async () => {
    // A legit chat message full of WAF-triggering tokens must REACH the origin
    // (auth gate → 401/400), never a Cloudflare 403/1010 edge block. Proves the
    // WAF SKIP for /api/dime/* is in place (collateral-damage fix).
    const res = await fetch(`${base}/api/dime/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "user", content: "should I select the over or under 8.5, or is 1=1 a lock? <test>" },
        ],
      }),
      redirect: "manual",
    });
    expect(
      res.status !== 403,
      `Dime Chat POST got ${res.status} — the WAF is edge-blocking legit free-text; add a SKIP for /api/dime/*`
    );
    return `reached origin (status ${res.status}, not a WAF 403)`;
  });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
