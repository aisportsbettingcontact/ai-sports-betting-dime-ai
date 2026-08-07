/**
 * originLockAlertRouting.test.ts
 *
 * Task 4.3 (2026-08-07 audit): the origin-lock `onEvent` handler in
 * server/_core/index.ts called `fireRateLimitEvent(...)` UNCONDITIONALLY,
 * before the `kind` switch — so all five `OriginLockEvent` kinds, only ONE
 * of which (`edge_deny`) actually blocks a request, posted the identical
 * "⚡ RATE LIMIT — IP Blocked for Sending Too Many Requests" Discord embed
 * (body asserts a 429 and a temporary block; remediation advice says to
 * permanently block the IP at the firewall). Verified live in production
 * under EDGE_MODE=log: a 200-served request logged "BLOCKED" and posted a
 * security alert. `edge_breaker_recovered` (good news — enforcement
 * resumed) fired the SAME attack alert against a cryptographically verified
 * Cloudflare request.
 *
 * The fix routes by `kind`: only `edge_deny` alerts. The other four log at
 * an appropriate severity and post nothing. `edge_no_secret` additionally
 * gets a once-per-minute escalation guard, because it fires on every request
 * while the site is unprotected and an unguarded CRITICAL would itself
 * flood.
 *
 * index.ts self-executes `startServer()` at import time (binds a port,
 * connects to the DB, starts the Discord bot, background schedulers…), so —
 * per the established precedent in server/_core/clientIdentityCallSites.test.ts,
 * server/_core/ledgerGuardAndAlerts.test.ts, and server/stripeWebhook.test.ts
 * — it is read as source text rather than imported. A behavioral test that
 * actually executes the handler is not possible without either (a) gating
 * `startServer()` behind an import guard, or (b) extracting the switch into
 * a separately-importable module — both out of this task's scope ("ONLY the
 * onEvent handler wiring in server/_core/index.ts"). Every assertion below
 * therefore also asserts the OLD pattern is ABSENT (not merely that the new
 * pattern is present), and is scoped to the specific `case` body it covers,
 * so a regression in any ONE kind fails only that kind's test — the same
 * discipline clientIdentityCallSites.test.ts uses for its six call sites.
 *
 * Known gap of this technique: it cannot catch a missing `break;` that lets
 * control flow fall through from one case into another at runtime (the
 * source text for each case still looks correct in isolation). Each case
 * below is therefore also asserted to contain its own `break;`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const INDEX_SRC = readFileSync(
  path.join(import.meta.dirname, "index.ts"),
  "utf8"
);

/** The full origin-lock mount, from its section comment to the next section. */
const ORIGIN_LOCK_BLOCK = (() => {
  const start = INDEX_SRC.indexOf("Origin lock (Phase 4 edge defense)");
  const end = INDEX_SRC.indexOf("Security headers (helmet)");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      "origin-lock section markers not found in index.ts — has it been restructured? " +
        `(start=${start}, end=${end})`
    );
  }
  return INDEX_SRC.slice(start, end);
})();

/** Slice a single `case "kind":` body up to the next `case`/`default`. */
function caseBody(kind: string): string {
  const marker = `case "${kind}":`;
  const start = ORIGIN_LOCK_BLOCK.indexOf(marker);
  expect(
    start,
    `case "${kind}" not found in the origin-lock onEvent switch — has the routing been reverted or restructured?`
  ).toBeGreaterThan(-1);
  const rest = ORIGIN_LOCK_BLOCK.slice(start + marker.length);
  const nextCaseOffset = rest.search(/\n\s*(case "|default:)/);
  return nextCaseOffset === -1 ? rest : rest.slice(0, nextCaseOffset);
}

describe("origin-lock onEvent handler routes by kind, not unconditionally (Task 4.3, 2026-08-07)", () => {
  it("a switch (kind) exists, and EVERY fireRateLimitEvent call is textually inside it — the old unconditional pre-switch alert is gone", () => {
    const switchIdx = ORIGIN_LOCK_BLOCK.indexOf("switch (kind)");
    expect(
      switchIdx,
      "switch (kind) not found — the per-kind routing was reverted"
    ).toBeGreaterThan(-1);

    const fireCallIdxs = [
      ...ORIGIN_LOCK_BLOCK.matchAll(/fireRateLimitEvent\(/g),
    ].map(m => m.index);
    expect(fireCallIdxs.length).toBeGreaterThan(0);
    for (const idx of fireCallIdxs) {
      expect(
        idx,
        "fireRateLimitEvent is called before switch (kind) — the old unconditional-alert bug is back"
      ).toBeGreaterThan(switchIdx);
    }
  });

  it("exactly one kind — edge_deny, the only kind that actually 403s — calls fireRateLimitEvent", () => {
    const occurrences = ORIGIN_LOCK_BLOCK.match(/fireRateLimitEvent\(/g) ?? [];
    expect(
      occurrences.length,
      "fireRateLimitEvent must be called from exactly one case (edge_deny); a count > 1 means a non-blocking kind alerts too"
    ).toBe(1);

    const denyBody = caseBody("edge_deny");
    expect(denyBody).toMatch(/fireRateLimitEvent\(/);
    expect(denyBody).toMatch(/break;/);
  });

  const nonBlockingKinds = [
    "edge_would_deny",
    "edge_no_secret",
    "edge_breaker_tripped",
    "edge_breaker_recovered",
  ] as const;

  it.each(nonBlockingKinds)(
    "%s does NOT call fireRateLimitEvent (it never blocked the request — no security alert)",
    kind => {
      const body = caseBody(kind);
      expect(body).not.toMatch(/fireRateLimitEvent\(/);
      expect(body).toMatch(/break;/);
    }
  );

  it("edge_would_deny logs observe-only at console.warn (request was served, not blocked)", () => {
    const body = caseBody("edge_would_deny");
    expect(body).toMatch(/console\.warn\(/);
    expect(body).not.toMatch(/console\.error\(/);
  });

  it("edge_breaker_tripped logs at console.error (enforcement suspended)", () => {
    const body = caseBody("edge_breaker_tripped");
    expect(body).toMatch(/console\.error\(/);
  });

  it("edge_breaker_recovered logs at console.log — NOT warn/error — so recovery (good news) cannot read as an attack", () => {
    const body = caseBody("edge_breaker_recovered");
    expect(body).toMatch(/console\.log\(/);
    // OLD pattern: this case previously used console.warn in addition to the
    // unconditional alert.
    expect(body).not.toMatch(/console\.warn\(/);
    expect(body).not.toMatch(/console\.error\(/);
  });

  it("has a default: branch that logs an unrecognised kind loudly, rather than silently dropping it", () => {
    const defaultIdx = ORIGIN_LOCK_BLOCK.indexOf("default:");
    expect(
      defaultIdx,
      "no default: branch — an unrecognised OriginLockEvent kind would be silently dropped"
    ).toBeGreaterThan(-1);
    const defaultBody = ORIGIN_LOCK_BLOCK.slice(defaultIdx, defaultIdx + 400);
    expect(defaultBody).toMatch(/console\.(error|warn)\(/);
    // Include the offending value, not a generic "unknown event" string.
    expect(defaultBody).toMatch(/kind/);
    expect(defaultBody).not.toMatch(/fireRateLimitEvent\(/);
  });
});

describe("edge_no_secret CRITICAL escalation is rate-limited to once per minute, not once per request (Task 4.3)", () => {
  it("declares a module-level timestamp guard (before startServer(), so it persists across requests for the process lifetime)", () => {
    const startServerIdx = INDEX_SRC.indexOf("async function startServer()");
    expect(startServerIdx).toBeGreaterThan(-1);

    const guardDeclIdx = INDEX_SRC.indexOf("let edgeNoSecretLastEscalatedAt");
    expect(
      guardDeclIdx,
      "module-level escalation timestamp not found"
    ).toBeGreaterThan(-1);
    expect(
      guardDeclIdx,
      "the guard must be declared at module scope, before startServer(), or it won't persist across requests"
    ).toBeLessThan(startServerIdx);

    expect(INDEX_SRC).toMatch(
      /const EDGE_NO_SECRET_ESCALATION_MS\s*=\s*60_?000/
    );
  });

  it("the edge_no_secret case gates its CRITICAL console.error behind the once-per-minute comparison, and records the timestamp only on the path that fires", () => {
    const body = caseBody("edge_no_secret");
    expect(body).toMatch(/edgeNoSecretLastEscalatedAt/);
    expect(body).toMatch(/EDGE_NO_SECRET_ESCALATION_MS/);
    expect(body).toMatch(/console\.error\(/);
    expect(body).toMatch(/break;/);

    // OLD pattern: an unconditional console.error with no guard at all — the
    // CRITICAL fired on every single request while unprotected. Assert the
    // log call is nested INSIDE an `if` guard, not a sibling statement.
    const ifIdx = body.indexOf("if (");
    const logIdx = body.indexOf("console.error(");
    const assignIdx = body.indexOf("edgeNoSecretLastEscalatedAt =");
    expect(
      ifIdx,
      "escalation must be gated by an if — an unguarded CRITICAL floods on every request"
    ).toBeGreaterThan(-1);
    expect(
      logIdx,
      "console.error must be textually after the if( guard, i.e. nested inside it"
    ).toBeGreaterThan(ifIdx);
    // The timestamp is recorded only on the firing path, before logging —
    // matching this file's own existing dedup convention (rateLimitLastPersisted
    // / trpc.ts's csrfAlertLastSent both record state only when NOT suppressed).
    expect(
      assignIdx,
      "the timestamp must be reassigned only inside the guarded branch, or the throttle self-defeats under continuous traffic"
    ).toBeGreaterThan(ifIdx);
    expect(assignIdx).toBeLessThan(logIdx);
  });
});
