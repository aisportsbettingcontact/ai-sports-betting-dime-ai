#!/usr/bin/env node
/**
 * Post-deploy smoke test — run against the public, Cloudflare-fronted origin:
 *
 *   EDGE_AGENT_BYPASS_KEY=<key> node scripts/smoke-deploy.mjs https://aisportsbettingmodels.com
 *
 * No credentials are needed for the assertions themselves — auth gates are
 * asserted, not bypassed. The bypass key is for the EDGE, not the app: the
 * Cloudflare WAF 403s automated clients on document routes, so without it the
 * `/`, `/assets`, and `/checkout` checks fail as bot-blocks rather than defects.
 * Do NOT point this at the raw *.up.railway.app origin — the Phase-4 origin lock
 * 403s secret-less requests there, which is what produced four straight red
 * deploys with misleading messages.
 *
 * The check list is deliberately NOT enumerated here. It grows, and every stale
 * count or ordinal in a doc has to be chased down separately (the 2026-08-07
 * federation review found four such drifts). Read the `check("...")` calls below,
 * and cite checks BY NAME. Three extra edge-defense checks are opt-in behind
 * SMOKE_EDGE=cloudflare, so the total is conditional as well.
 *
 * Exit 0 = all pass. Non-zero = failures listed.
 */

const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!/^https?:\/\//.test(base)) {
  console.error("Usage: node scripts/smoke-deploy.mjs <https://deployed-origin>");
  process.exit(2);
}

// ── Trusted-agent edge bypass ────────────────────────────────────────────────
// This smoke test is automated traffic, which the production Cloudflare edge
// (Super Bot Fight Mode "definitely automated → Block") 403s on document routes
// (/, /assets, /checkout). When EDGE_AGENT_BYPASS_KEY is set we present it as the
// `x-dime-agent` request header, matched by the "Trusted agent bypass" Cloudflare
// WAF Skip rule, so this trusted tool is waved through WITHOUT weakening the
// public anti-scraping posture (no key → still blocked). The header is scoped to
// the smoke target host(s) ONLY, so the secret can never leak to a third party.
// No-op when the env var is unset (direct/localhost/non-edge targets unaffected).
const AGENT_KEY = (process.env.EDGE_AGENT_BYPASS_KEY ?? "").trim();
const AGENT_TARGETS = new Set();
for (const u of [base, (process.env.SMOKE_ORIGIN_URL ?? "").replace(/\/$/, "")]) {
  try {
    if (u) AGENT_TARGETS.add(new URL(u).origin);
  } catch {
    /* ignore unparseable target */
  }
}
function sfetch(url, opts = {}) {
  if (!AGENT_KEY) return fetch(url, opts);
  let sameTarget = false;
  try {
    sameTarget = AGENT_TARGETS.has(new URL(url, base).origin);
  } catch {
    /* ignore */
  }
  if (!sameTarget) return fetch(url, opts);
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers ?? {}), "x-dime-agent": AGENT_KEY },
  });
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
  const res = await sfetch(`${base}/health`, { redirect: "manual" });
  expect(res.status === 200, `status ${res.status}`);
  return (await res.text()).slice(0, 60);
});

await check("schema/code agreement — live app_users schema is not behind the code", async () => {
  // Phase 1½: a code-ahead-of-migration deploy reports schema=schema_mismatch and
  // /health 503, so Railway keeps the previous deploy. If this smoke ever runs
  // against such an origin, fail loudly with the exact remediation. `unknown`
  // (transient/DB-unavailable) is not a failure — the DB gate covers that.
  const res = await sfetch(`${base}/health`, { redirect: "manual" });
  let body = {};
  try {
    body = await res.json();
  } catch {
    return "N/A — /health did not return JSON";
  }
  expect(
    body.schema !== "schema_mismatch" && res.status !== 503,
    `schema=${body.schema} status=${res.status} — app_users schema is BEHIND the code (code deployed ahead of its migration). Run db-push.yml, then redeploy.`
  );
  return `schema=${body.schema ?? "n/a"}`;
});

let indexHtml = "";
await check("GET / → 200 HTML shell", async () => {
  const res = await sfetch(`${base}/`);
  expect(res.status === 200, `status ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  expect(type.includes("text/html"), `content-type ${type}`);
  indexHtml = await res.text();
  expect(indexHtml.includes("<div id=\"root\""), "no #root div — not the SPA shell");
});

await check("hashed asset → 200 + long-lived cache", async () => {
  const m = indexHtml.match(/\/assets\/[\w./-]+\.js/);
  expect(m, "no /assets/*.js reference found in index.html");
  const res = await sfetch(`${base}${m[0]}`);
  expect(res.status === 200, `status ${res.status}`);
  const cache = res.headers.get("cache-control") ?? "";
  expect(/max-age=\d{5,}/.test(cache), `weak cache-control: "${cache}"`);
  return m[0];
});

await check("GET /api/trpc/<bogus> → tRPC JSON error (API mounted)", async () => {
  const res = await sfetch(`${base}/api/trpc/smokeTest.doesNotExist`);
  const type = res.headers.get("content-type") ?? "";
  expect(type.includes("application/json"), `content-type ${type} — SPA fallback answered; /api proxy or mount is broken`);
  expect(res.status < 500, `status ${res.status} — upstream/gateway error, not a tRPC response`);
  const body = await res.json();
  const isTrpcShape = Array.isArray(body) ? body[0]?.error : body?.error;
  expect(isTrpcShape, `not a tRPC error envelope: ${JSON.stringify(body).slice(0, 80)}`);
  return `status ${res.status}`;
});

await check("POST /api/dime/chat unauthenticated → 401 JSON (auth gate)", async () => {
  const res = await sfetch(`${base}/api/dime/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "smoke" }] }),
  });
  expect(res.status === 401, `status ${res.status} — expected the pre-stream auth gate`);
  const body = await res.json();
  expect(body?.error, "401 without JSON error body");
});

await check("bot UA on / → v2 SEO content (prerender or shell block)", async () => {
  const res = await sfetch(`${base}/`, { headers: { "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" } });
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
  const res = await sfetch(`${base}/dime-storage/mlb-logo_50fd8568.png`, { redirect: "follow" });
  expect(res.status === 200, `status ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  expect(type.startsWith("image/"), `content-type ${type} — storage proxy failed instead of serving the vendored file`);
});

await check("checkout CSP allows Stripe Embedded (script-src js.stripe.com + frame-src checkout.stripe.com)", async () => {
  const res = await sfetch(`${base}/checkout?plan=monthly`, { headers: { "user-agent": "Mozilla/5.0 Chrome/126" } });
  const csp = res.headers.get("content-security-policy") ?? "";
  // Railway (Express + helmet) always sets a CSP header. A missing header means
  // the origin isn't serving through helmet — a real regression, not a lenient
  // pass: without Stripe allowances embedded checkout breaks with "Failed to
  // load Stripe.js" (live incident 2026-07-10).
  expect(csp, "no CSP header — helmet not applied on the checkout route");
  const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src")) ?? "";
  const frameSrc = csp.split(";").find((d) => d.trim().startsWith("frame-src")) ?? "";
  // Exact source-token match, not substring: "js.stripe.com" also matches a
  // hostile "js.stripe.com.evil.test", so the substring form could pass on a
  // CSP that does NOT actually allow Stripe.
  const sourceTokens = (directive) => directive.trim().split(/\s+/).slice(1);
  const allowsExactSource = (directive, origin) =>
    sourceTokens(directive).some((token) => token === origin);
  expect(
    allowsExactSource(scriptSrc, "https://js.stripe.com"),
    `script-src blocks Stripe.js: "${scriptSrc.trim()}"`
  );
  expect(
    allowsExactSource(frameSrc, "https://checkout.stripe.com"),
    `frame-src blocks the checkout iframe: "${frameSrc.trim()}"`
  );
  return "CSP allows Stripe";
});

await check("rate-limit keying resists client-supplied identity headers", async () => {
  // Security invariant: limiter keys are the TRUE client, so NO header a client
  // can set may mint a fresh budget. We hit the feed limiter twice from this one
  // machine — once plain, once with spoofed identity headers — and assert the
  // RateLimit `remaining` counter keeps DECREASING (one shared key) instead of
  // resetting to the max (which would mean the client can pick its own identity).
  //
  // 2026-08-07: this check USED to inject only `x-forwarded-for`, which made it
  // vacuous once the Cloudflare edge was armed. `resolveClientIdentity` resolves
  // in tiers: with the edge armed and the request cryptographically proven to
  // have come through it, tier 1 answers from `cf-connecting-ip` and the XFF is
  // never consulted — so the assertion passed whether or not XFF sanitization
  // still held, proving nothing about the header that actually decides identity.
  // A live 2026-08-07 production run showed exactly that (59 → 58, green).
  //
  // Both headers are now spoofed together, so the assertion covers whichever
  // tier is live: `cf-connecting-ip` (Cloudflare must overwrite an inbound one)
  // AND `x-forwarded-for` (Railway must sanitize it). A regression in EITHER
  // upstream mints a fresh budget and fails this check.
  //
  // Known limit, stated rather than papered over: this exercises the path
  // through the public edge only. The tier-2 (direct-to-origin) path cannot be
  // asserted from CI because the origin lock 403s a secret-less request to the
  // raw origin — that is what the SMOKE_EDGE=cloudflare origin-lock check
  // covers instead.
  const behindEdge = base.startsWith("https://") && !/(localhost|127\.0\.0\.1|\[::1\])/.test(base);
  if (!behindEdge) {
    return "N/A — direct/localhost target has no sanitizing edge; invariant holds only behind the proxy chain";
  }
  const url = `${base}/api/trpc/games.list?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%22sport%22%3A%22MLB%22%7D%7D%7D`;
  const remainingOf = (res) => {
    const h = res.headers.get("ratelimit") ?? res.headers.get("RateLimit") ?? "";
    const m = h.match(/remaining=(\d+)/i);
    return m ? Number(m[1]) : null;
  };
  const first = await sfetch(url);
  const r1 = remainingOf(first);
  expect(r1 !== null, "no RateLimit header on games.list — feed limiter not mounted");
  const spoofed = await sfetch(url, {
    headers: {
      "x-forwarded-for": "203.0.113.250",
      "cf-connecting-ip": "203.0.113.251",
    },
  });
  const r2 = remainingOf(spoofed);
  expect(r2 !== null, "no RateLimit header on the spoofed request");
  // Shared key → r2 continues the same budget (strictly below the fresh max).
  // If spoofing minted a new key, r2 would jump back to (max-1) = 59.
  expect(
    r2 <= r1 - 1 || r2 < 59,
    `spoofed identity headers got a fresh budget (r1=${r1}, r2=${r2}) — either Cloudflare stopped overwriting cf-connecting-ip or Railway stopped sanitizing X-Forwarded-For; limiter keying is now client-controllable`
  );
  return `plain remaining=${r1} → spoofed (xff + cf-connecting-ip) remaining=${r2} (shared key)`;
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
    const res = await sfetch(
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
    const res = await sfetch(`${originUrl}/health`, { redirect: "manual" });
    expect(res.status === 200, `/health returned ${res.status} on the direct origin — probe would fail`);
    return "/health stays 200 direct (healthcheck survives edge outage)";
  });

  await check("WAF does not edge-block free-text API (Dime Chat betting jargon)", async () => {
    // A legit chat message full of WAF-triggering tokens must REACH the origin
    // (auth gate → 401/400), never a Cloudflare 403/1010 edge block. Proves the
    // WAF SKIP for /api/dime/* is in place (collateral-damage fix).
    const res = await sfetch(`${base}/api/dime/chat`, {
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
