#!/usr/bin/env node
/**
 * Post-deploy smoke test — run against any deployed origin:
 *
 *   node scripts/smoke-deploy.mjs https://ai-sports-betting-dime-ai-production.up.railway.app
 *   node scripts/smoke-deploy.mjs https://<app>.vercel.app
 *
 * Checks (no credentials needed — auth gates are asserted, not bypassed):
 *   1. /health            → 200
 *   2. /                  → 200 HTML (SPA shell)
 *   3. hashed asset       → 200 + immutable cache header
 *   4. /api/trpc/<bogus>  → JSON error from tRPC (API layer mounted, not SPA fallback)
 *   5. POST /api/dime/chat (unauthenticated) → 401 JSON (SSE route mounted + auth gate)
 *
 * Exit 0 = all pass. Non-zero = failures listed. Use it after every
 * Railway deploy and against the Vercel domain to validate the /api proxy.
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

await check("bot UA on / → v2 landing prerender (SEO snapshot)", async () => {
  const res = await fetch(`${base}/`, { headers: { "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" } });
  expect(res.status === 200, `status ${res.status}`);
  expect(res.headers.get("x-prerender") === "1", "X-Prerender header missing — prerender is being shadowed (check middleware order vs express.static)");
  const html = await res.text();
  expect(html.includes("See where price and probability"), "v2 hero copy missing from bot snapshot");
  expect(!/39FF14/i.test(html), "forbidden neon #39FF14 present in bot snapshot (brand law)");
});

await check("vendored /manus-storage asset → 200 image (no Manus dependency)", async () => {
  const res = await fetch(`${base}/manus-storage/logo-aisportsbetting_429c188f.jpg`, { redirect: "follow" });
  expect(res.status === 200, `status ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  expect(type.startsWith("image/"), `content-type ${type} — storage proxy failed instead of serving the vendored file`);
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
