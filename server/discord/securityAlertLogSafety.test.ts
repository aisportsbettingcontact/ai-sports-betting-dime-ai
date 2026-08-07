import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Log-safety coverage for the Discord security-alert pipeline.
 *
 * This module is the highest-value log-injection target in the repo: it is the
 * component that TURNS LOG LINES INTO ALERTS, so a forged `[CRITICAL]` line
 * here is a forged security alert. The Discord client is mocked so the posting
 * branches (embed send, success, failure) execute without a live bot.
 */

class FakeTextChannel {
  name: string;
  guild = { name: "guild" };
  sendImpl: () => Promise<unknown>;
  constructor(name: string, sendImpl: () => Promise<unknown>) {
    this.name = name;
    this.sendImpl = sendImpl;
  }
  isTextBased() {
    return true;
  }
  send() {
    return this.sendImpl();
  }
}

// discord.js's REAL EmbedBuilder is used here (not a stub). The tests in the
// "embed field width clamping" and "try/catch placement" blocks below exist
// specifically to exercise its real CombinedPropertyError throw on an
// over-long field value (2026-08-06 audit) — a stub with a no-op addFields()
// would hide the exact bug this file exists to catch, and would make those
// tests pass whether or not the production fix is present.
// TextChannel stays faked; it's only used for an `instanceof` check plus the
// send()/name/guild surface the existing tests below drive directly.
vi.mock("discord.js", async () => {
  const actual = await vi.importActual<typeof import("discord.js")>("discord.js");
  return {
    ...actual,
    TextChannel: FakeTextChannel,
  };
});

const clientState: { value: unknown } = { value: null };
vi.mock("./bot", () => ({
  getDiscordClient: () => clientState.value,
}));

function clientWithChannel(name: string, sendImpl: () => Promise<unknown>) {
  const channel = new FakeTextChannel(name, sendImpl);
  return {
    isReady: () => true,
    channels: { fetch: async () => channel },
  };
}

// FakeTextChannel.send() is a no-op that ignores its argument — it exists
// only to satisfy the `instanceof TextChannel` check and the send()/name/
// guild surface the earlier tests drive. To assert on the exact composed
// `content`/`embeds` arguments passed to send(), this subclass records every
// call. Module-scoped (not describe-local) so every describe block below can
// use it, not just "composed-value clamp + brute-force escalation".
class CapturingTextChannel extends FakeTextChannel {
  sentArgs: unknown[] = [];
  send(arg: unknown) {
    this.sentArgs.push(arg);
    return this.sendImpl();
  }
}

function clientWithCapturingChannel(name: string, sendImpl: () => Promise<unknown>) {
  const channel = new CapturingTextChannel(name, sendImpl);
  return {
    client: { isReady: () => true, channels: { fetch: async () => channel } },
    channel,
  };
}

const FORGERY = 'x\n[CRITICAL][FORGED] owned\r\nsecond="line"';

function captureConsole() {
  const lines: string[] = [];
  const sink = (...args: unknown[]) =>
    lines.push(args.map(a => String(a)).join(" "));
  vi.spyOn(console, "log").mockImplementation(sink);
  vi.spyOn(console, "warn").mockImplementation(sink);
  vi.spyOn(console, "error").mockImplementation(sink);
  return lines;
}

function assertNoForgedLines(lines: string[]) {
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    expect(line).not.toMatch(/[\r\n]/);
  }
}

function payload(
  ip: string,
  eventType: "CSRF_BLOCK" | "RATE_LIMIT" | "AUTH_FAIL" = "CSRF_BLOCK"
) {
  return {
    eventType,
    ip,
    blockedOrigin: FORGERY,
    trpcPath: FORGERY,
    httpMethod: "POST",
    userAgent: FORGERY,
    occurredAt: new Date(),
  };
}

// Module-level state (dedup map, global alert budget, brute-force tracking)
// is intentionally process-lifetime in production, and this file never calls
// vi.resetModules() — every `it()` below imports the SAME cached module
// instance. Without a reset, an earlier test's dedup entry or an exhausted
// alert budget (deliberately exercised by the Task 4.6 flood test) would
// leak into a LATER test and silently suppress its alert. This file-scoped
// beforeEach runs before every test in every describe block below.
beforeEach(async () => {
  const mod = await import("./discordSecurityAlert");
  mod.resetSecurityAlertStateForTest();
});

describe("discord security alerts — hostile input cannot forge log lines", () => {
  let lines: string[];

  beforeEach(() => {
    lines = captureConsole();
    clientState.value = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips cleanly when the bot client is absent", async () => {
    const { postSecurityAlert } = await import("./discordSecurityAlert");
    clientState.value = null;
    await postSecurityAlert(payload(`na-${FORGERY}`));
    assertNoForgedLines(lines);
    expect(lines.some(l => l.includes("not available"))).toBe(true);
  });

  it("skips cleanly when the bot client is not ready", async () => {
    const { postSecurityAlert } = await import("./discordSecurityAlert");
    clientState.value = { isReady: () => false };
    await postSecurityAlert(payload(`nr-${FORGERY}`));
    assertNoForgedLines(lines);
    expect(lines.some(l => l.includes("not ready"))).toBe(true);
  });

  it("sanitizes through the posting path and its failure branch", async () => {
    const { postSecurityAlert } = await import("./discordSecurityAlert");
    // A channel whose send() throws exercises the error branch, whose message
    // is itself attacker-influenced.
    clientState.value = clientWithChannel(FORGERY, async () => {
      throw new Error(FORGERY);
    });
    await postSecurityAlert(payload(`fail-${FORGERY}`, "RATE_LIMIT"));
    assertNoForgedLines(lines);
    // Message text updated by the 2026-08-06 fix: buildEmbed() now runs
    // inside the same try as the send, so this catch covers build failures
    // too, not just send failures — "Failed to build or send" reflects that.
    expect(lines.some(l => l.includes("Failed to build or send embed"))).toBe(true);
  });

  it("sanitizes on the successful post path", async () => {
    const { postSecurityAlert } = await import("./discordSecurityAlert");
    clientState.value = clientWithChannel(FORGERY, async () => ({ id: "1" }));
    await postSecurityAlert(payload(`ok-${FORGERY}`, "AUTH_FAIL"));
    assertNoForgedLines(lines);
    expect(lines.some(l => l.includes("posted successfully"))).toBe(true);
  });

  it("dedup branch sanitizes the repeated hostile identifier", async () => {
    const { postSecurityAlert } = await import("./discordSecurityAlert");
    clientState.value = clientWithChannel("ok", async () => ({ id: "1" }));
    const ip = `dedup-${FORGERY}`;
    await postSecurityAlert(payload(ip));
    await postSecurityAlert(payload(ip)); // second within cooldown → DEDUP
    assertNoForgedLines(lines);
  });

  it("brute-force escalation path sanitizes the hostile IP", async () => {
    const mod = await import("./discordSecurityAlert");
    clientState.value = clientWithChannel(FORGERY, async () => ({ id: "1" }));
    const ip = `brute-${FORGERY}`;
    const now = Date.now();
    for (let i = 0; i < 4; i++) {
      mod.trackAuthFailForBruteForce(ip, now + i * 100);
    }
    // Give any async escalation post a turn to run.
    await new Promise(r => setTimeout(r, 20));
    assertNoForgedLines(lines);
  }, 20_000);
});

describe("embed field width clamping (2026-08-06 audit)", () => {
  const DISCORD_FIELD_MAX = 1024;

  it("does not throw on a 2000-char path", async () => {
    const { buildEmbedForTest } = await import("./discordSecurityAlert");
    expect(() =>
      buildEmbedForTest({
        eventType: "RATE_LIMIT",
        ip: "1.2.3.4",
        path: "/" + "a".repeat(1999),
        method: "GET",
        userAgent: "test",
        context: "public_feed",
        occurredAt: 1_754_500_000_000,
      })
    ).not.toThrow();
  });

  it("does not throw on a 2000-char blockedOrigin", async () => {
    const { buildEmbedForTest } = await import("./discordSecurityAlert");
    expect(() =>
      buildEmbedForTest({
        eventType: "CSRF_BLOCK",
        ip: "1.2.3.4",
        blockedOrigin: "https://" + "a".repeat(1992),
        path: "appUsers.login",
        method: "POST",
        occurredAt: 1_754_500_000_000,
      })
    ).not.toThrow();
  });

  it("clamps every field value to Discord's 1024 limit", async () => {
    const { buildEmbedForTest } = await import("./discordSecurityAlert");
    const embed = buildEmbedForTest({
      eventType: "RATE_LIMIT",
      ip: "9".repeat(2000),
      path: "/" + "a".repeat(1999),
      method: "GET",
      userAgent: "u".repeat(2000),
      context: "public_feed",
      occurredAt: 1_754_500_000_000,
    });
    for (const field of embed.data.fields ?? []) {
      expect(field.value.length).toBeLessThanOrEqual(DISCORD_FIELD_MAX);
    }
  });

  it("does not throw on a 2000-char user-agent for CSRF_BLOCK", async () => {
    const { buildEmbedForTest } = await import("./discordSecurityAlert");
    expect(() =>
      buildEmbedForTest({
        eventType: "CSRF_BLOCK",
        ip: "1.2.3.4",
        blockedOrigin: "https://evil.example",
        path: "appUsers.login",
        method: "POST",
        userAgent: "u".repeat(2000),
        occurredAt: 1_754_500_000_000,
      })
    ).not.toThrow();
  });

  it("does not throw on a 2000-char user-agent for AUTH_FAIL", async () => {
    const { buildEmbedForTest } = await import("./discordSecurityAlert");
    expect(() =>
      buildEmbedForTest({
        eventType: "AUTH_FAIL",
        ip: "1.2.3.4",
        path: "appUsers.login",
        method: "POST",
        userAgent: "u".repeat(2000),
        context: "invalid_password",
        targetIdentifier: "pre***@example.com",
        occurredAt: 1_754_500_000_000,
      })
    ).not.toThrow();
  });

  it("shows the full user-agent instead of the old 120-char cut", async () => {
    const { buildEmbedForTest } = await import("./discordSecurityAlert");
    // The 120-char substring() cut used to render this UA as "…Safari/601.2.4 fac",
    // hiding the client's real identity (2026-08-06 incident). The fix must show
    // it in full, clamped only at Discord's 1024-char field limit.
    const fullUa = "facebookexternalhit/1.1 Facebot Twitterbot/1.0";
    const embed = buildEmbedForTest({
      eventType: "RATE_LIMIT",
      ip: "1.2.3.4",
      path: "appUsers.login",
      method: "GET",
      userAgent: fullUa,
      context: "public_feed",
      occurredAt: 1_754_500_000_000,
    });
    const uaField = (embed.data.fields ?? []).find(f => f.name.includes("User-Agent"));
    expect(uaField?.value).toContain(fullUa);
  });
});

describe("composed-value clamp + brute-force escalation (2026-08-06 review, Criticals 1 & 2)", () => {
  const DISCORD_FIELD_MAX = 1024;
  const DISCORD_DESCRIPTION_MAX = 4096;
  const DISCORD_CONTENT_MAX = 2000;

  it("Critical 1: buildAuthFailEmbed does not throw on a 1500-char targetIdentifier; every field <= 1024", async () => {
    const { buildEmbedForTest } = await import("./discordSecurityAlert");
    let embed: ReturnType<typeof buildEmbedForTest> | undefined;
    expect(() => {
      embed = buildEmbedForTest({
        eventType: "AUTH_FAIL",
        ip: "1.2.3.4",
        path: "appUsers.login",
        method: "POST",
        userAgent: "test-ua",
        context: "invalid_password",
        targetIdentifier: "z".repeat(1500),
        occurredAt: 1_754_500_000_000,
      });
    }).not.toThrow();
    for (const f of embed!.data.fields ?? []) {
      expect(f.value.length).toBeLessThanOrEqual(DISCORD_FIELD_MAX);
    }
  });

  it("Critical 1: buildBruteForceEmbed does not throw on a 1500-char ip; every field <= 1024; description <= 4096", async () => {
    const { buildBruteForceEmbedForTest } = await import("./discordSecurityAlert");
    const longIp = "9".repeat(1500);
    let embed: ReturnType<typeof buildBruteForceEmbedForTest> | undefined;
    expect(() => {
      embed = buildBruteForceEmbedForTest(longIp, 4, 10 * 60 * 1000, "test-ua", 1_754_500_000_000);
    }).not.toThrow();
    for (const f of embed!.data.fields ?? []) {
      expect(f.value.length).toBeLessThanOrEqual(DISCORD_FIELD_MAX);
    }
    expect((embed!.data.description ?? "").length).toBeLessThanOrEqual(DISCORD_DESCRIPTION_MAX);
  });

  it("Critical 2: postSecurityAlert's brute-force escalation actually posts for a 1500-char ip, with content <= 2000", async () => {
    const { postSecurityAlert } = await import("./discordSecurityAlert");
    const { client, channel } = clientWithCapturingChannel("sec-events", async () => ({ id: "1" }));
    clientState.value = client;

    const longIp = "8".repeat(1500);
    const now = Date.now();
    // Fire 4 AUTH_FAIL events from the same (long) IP to cross the
    // brute-force threshold (3+) through the real dispatch path — the same
    // path a live attacker drives, per the reviewer's live-verified repro.
    for (let i = 0; i < 4; i++) {
      await postSecurityAlert({
        eventType: "AUTH_FAIL",
        ip: longIp,
        path: "appUsers.login",
        method: "POST",
        userAgent: "test-ua",
        context: "invalid_password",
        targetIdentifier: "abc***@example.com",
        occurredAt: now + i * 100,
      });
    }
    // The brute-force escalation is posted fire-and-forget; give it a turn.
    await new Promise(r => setTimeout(r, 20));

    // Two distinct sends land on this channel: the first (non-deduped)
    // per-event AUTH_FAIL embed ({ embeds }) and the brute-force escalation
    // ({ content, embeds }). Only the latter has `content` — find it directly
    // rather than trusting the fake to have validated it (it doesn't).
    const bruteForceSend = channel.sentArgs.find(
      (a): a is { content: string; embeds: unknown[] } =>
        typeof a === "object" && a !== null && "content" in a
    );
    expect(bruteForceSend).toBeDefined();
    expect(typeof bruteForceSend!.content).toBe("string");
    expect(bruteForceSend!.content.length).toBeLessThanOrEqual(DISCORD_CONTENT_MAX);
  });

  it("Critical 2 (isolated): postBruteForceAlert still posts when ip is long enough to overflow the RAW description/content", async () => {
    // At a 1500-char ip (the reviewer's exact repro), the composed
    // description (~3907 chars) and content (~1629 chars) both stay under
    // Discord's 4096/2000 caps even with NO description/content clamp —
    // only the field-value clamp (Critical 1) is exercised at that length.
    // This test uses a 2500-char ip specifically so the RAW description
    // (~5907 chars) and RAW content (~2629 chars) both exceed their caps,
    // which isolates and proves the Critical-2-specific fix (build inside
    // try + clampDescription/clampContent) independent of Critical 1.
    const { postSecurityAlert } = await import("./discordSecurityAlert");
    const { client, channel } = clientWithCapturingChannel("sec-events-2", async () => ({ id: "1" }));
    clientState.value = client;

    const longIp = "7".repeat(2500);
    const now = Date.now();
    for (let i = 0; i < 4; i++) {
      await postSecurityAlert({
        eventType: "AUTH_FAIL",
        ip: longIp,
        path: "appUsers.login",
        method: "POST",
        userAgent: "test-ua",
        context: "invalid_password",
        targetIdentifier: "def***@example.com",
        occurredAt: now + i * 100,
      });
    }
    await new Promise(r => setTimeout(r, 20));

    const bruteForceSend = channel.sentArgs.find(
      (a): a is { content: string; embeds: unknown[] } =>
        typeof a === "object" && a !== null && "content" in a
    );
    expect(bruteForceSend).toBeDefined();
    expect(bruteForceSend!.content.length).toBeLessThanOrEqual(DISCORD_CONTENT_MAX);
  });

  it("Critical 1b: sanitizeLoginIdentifier caps a 2000-char input at SANITIZED_IDENTIFIER_MAX", async () => {
    const { sanitizeLoginIdentifier, SANITIZED_IDENTIFIER_MAX } = await import("../routers/appUsers");
    const hostileEmail = "a@" + "x".repeat(2000);
    const sanitized = sanitizeLoginIdentifier(hostileEmail);
    expect(sanitized.length).toBeLessThanOrEqual(SANITIZED_IDENTIFIER_MAX);
    // Format is preserved: first 3 chars of local part + *** + @domain (truncated).
    expect(sanitized.startsWith("a***@")).toBe(true);

    const hostileUsername = "u".repeat(2000);
    const sanitizedUsername = sanitizeLoginIdentifier(hostileUsername);
    expect(sanitizedUsername.length).toBeLessThanOrEqual(SANITIZED_IDENTIFIER_MAX);
    expect(sanitizedUsername).toBe("uuu***");
  });
});

describe("postSecurityAlert try/catch placement (2026-08-06 audit)", () => {
  // This block is deliberately independent of field-value length: it forces
  // the embed builder to throw for ANY reason, to prove that postSecurityAlert
  // survives the throw because buildEmbed() runs INSIDE the try — not because
  // field() happens to have prevented the throw. If buildEmbed() is ever moved
  // back outside the try, this test must fail (see task-2.3-report.md for the
  // before/after discrimination-proof run).
  it("does not let a throwing embed builder escape postSecurityAlert", async () => {
    const { postSecurityAlert } = await import("./discordSecurityAlert");
    const { EmbedBuilder } = await import("discord.js");
    const spy = vi
      .spyOn(EmbedBuilder.prototype, "addFields")
      .mockImplementation(() => {
        throw new Error("forced embed failure — isolates try/catch placement from field clamping");
      });
    try {
      clientState.value = clientWithChannel("ok", async () => ({ id: "1" }));
      await expect(
        postSecurityAlert({
          eventType: "RATE_LIMIT",
          ip: "9.9.9.9",
          path: "trpc.test",
          method: "GET",
          userAgent: "ua",
          context: "public_feed",
          occurredAt: Date.now(),
        })
      ).resolves.toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("LIMITER_META covers every limitType slug (2026-08-07 review, Task 4.4)", () => {
  // Verified against the union in server/_core/index.ts's fireRateLimitEvent().
  const ALL_LIMIT_TYPES = [
    "global",
    "auth",
    "trpc_auth",
    "stripe_checkout",
    "waitlist_submit",
    "public_feed",
    "xff_canary",
    "edge_origin_ingress_anomaly",
  ] as const;

  it("has metadata for every limitType in the union", async () => {
    const { LIMITER_META } = await import("./discordSecurityAlert");
    for (const slug of ALL_LIMIT_TYPES) {
      expect(LIMITER_META[slug], `missing LIMITER_META entry for "${slug}"`).toBeDefined();
    }
  });

  it("never claims 429 for the origin lock", async () => {
    const { LIMITER_META } = await import("./discordSecurityAlert");
    expect(LIMITER_META.edge_origin_ingress_anomaly.action).not.toContain("429");
  });

  it("the xff canary is always observe-only — never a block, never a 429", async () => {
    const { LIMITER_META } = await import("./discordSecurityAlert");
    expect(LIMITER_META.xff_canary.action).toBe("observed only — request was served");
  });

  it("all six real limiters render the 429/blocked copy in the embed", async () => {
    const { buildEmbedForTest } = await import("./discordSecurityAlert");
    const realLimiters = [
      "global",
      "auth",
      "trpc_auth",
      "stripe_checkout",
      "waitlist_submit",
      "public_feed",
    ] as const;
    for (const context of realLimiters) {
      const embed = buildEmbedForTest({
        eventType: "RATE_LIMIT",
        ip: "1.2.3.4",
        path: "/api/test",
        method: "GET",
        userAgent: "ua",
        context,
        occurredAt: 1_754_500_000_000,
      });
      expect(
        embed.data.description,
        `context="${context}" should still assert a 429/blocked outcome`
      ).toContain("429 Too Many Requests");
    }
  });

  // 2026-08-07 review, Critical 2: edge_origin_ingress_anomaly is fired from
  // TWO call sites with OPPOSITE truth (edge_deny = a genuine 403;
  // the /api/trpc canary = always observe-only). A single static default
  // for this slug cannot be correct for both — the OLD version of this test
  // asserted an unconditional 403 with no limiterOutcome supplied at all,
  // which is exactly the bug: production runs EDGE_MODE=log, where 100% of
  // currently-firing alerts for this slug come from the observe-only
  // canary, so that assertion was live-false for every alert actually
  // firing right now. The three tests below cover all three states the
  // fixed embed can render for this slug.
  it("edge_origin_ingress_anomaly with limiterOutcome=\"blocked\" (the edge_deny call site) renders a 403 title/body — NOT the 429/blocked copy", async () => {
    const { buildEmbedForTest } = await import("./discordSecurityAlert");
    const embed = buildEmbedForTest({
      eventType: "RATE_LIMIT",
      ip: "1.2.3.4",
      path: "/api/trpc/games.list",
      method: "GET",
      userAgent: "ua",
      context: "edge_origin_ingress_anomaly",
      limiterOutcome: "blocked",
      occurredAt: 1_754_500_000_000,
    });
    expect(embed.data.title).toContain("403");
    expect(embed.data.description).toContain("403 Forbidden");
    expect(embed.data.description).not.toContain("429 Too Many Requests");
    expect(embed.data.description).not.toMatch(/temporarily blocked\./);
  });

  it("edge_origin_ingress_anomaly with limiterOutcome=\"observed\" (the /api/trpc canary call site) renders observe-only — NOT 403, NOT 429 (the live-production case: EDGE_MODE=log, 2026-08-07)", async () => {
    const { buildEmbedForTest } = await import("./discordSecurityAlert");
    const embed = buildEmbedForTest({
      eventType: "RATE_LIMIT",
      ip: "1.2.3.4",
      path: "/api/trpc/games.list",
      method: "GET",
      userAgent: "ua",
      context: "edge_origin_ingress_anomaly",
      limiterOutcome: "observed",
      occurredAt: 1_754_500_000_000,
    });
    expect(embed.data.title).not.toMatch(/403/);
    expect(embed.data.title).not.toMatch(/Blocked/);
    expect(embed.data.description).not.toContain("403 Forbidden");
    expect(embed.data.description).not.toContain("429 Too Many Requests");
    expect(embed.data.description).toMatch(/Nothing was blocked/);
  });

  it("edge_origin_ingress_anomaly with NO limiterOutcome supplied is non-committal — asserts neither 403 nor 429 (2026-08-07 review, Critical 2: the alert must never assert a status code it cannot prove)", async () => {
    const { buildEmbedForTest, LIMITER_META } = await import("./discordSecurityAlert");
    const embed = buildEmbedForTest({
      eventType: "RATE_LIMIT",
      ip: "1.2.3.4",
      path: "/api/trpc/games.list",
      method: "GET",
      userAgent: "ua",
      context: "edge_origin_ingress_anomaly",
      // limiterOutcome deliberately omitted.
      occurredAt: 1_754_500_000_000,
    });
    expect(embed.data.title).not.toMatch(/403/);
    expect(embed.data.title).not.toMatch(/429/);
    expect(embed.data.description).not.toContain("403 Forbidden");
    expect(embed.data.description).not.toContain("429 Too Many Requests");
    // The static LIMITER_META default itself must not assert a code either —
    // this is what buildEmbedForTest fell back to above.
    expect(LIMITER_META.edge_origin_ingress_anomaly.action).not.toContain("403");
    expect(LIMITER_META.edge_origin_ingress_anomaly.action).not.toContain("429");
  });

  it("xff_canary renders an observe-only title/body — nothing was blocked, no 429", async () => {
    const { buildEmbedForTest } = await import("./discordSecurityAlert");
    const embed = buildEmbedForTest({
      eventType: "RATE_LIMIT",
      ip: "10.0.0.5",
      path: "/api/trpc/games.list",
      method: "GET",
      userAgent: "ua",
      context: "xff_canary",
      occurredAt: 1_754_500_000_000,
    });
    expect(embed.data.title).not.toMatch(/Blocked/);
    expect(embed.data.description).toMatch(/Nothing was blocked/);
    expect(embed.data.description).not.toContain("429 Too Many Requests");
  });

  it("buildEmbed fails loudly (throws) on an unrecognised SecurityEventType instead of silently mis-rendering (A13)", async () => {
    const { buildEmbedForTest } = await import("./discordSecurityAlert");
    expect(() =>
      buildEmbedForTest({
        // Cast past the type system to simulate a value that bypassed it (an
        // un-typed caller, a stale build) — exactly the scenario the
        // default: exhaustiveness guard exists to catch.
        eventType: "SOMETHING_NEW" as unknown as "CSRF_BLOCK",
        ip: "1.2.3.4",
        path: "/x",
        method: "GET",
        occurredAt: 1_754_500_000_000,
      })
    ).toThrow(/unrecognised SecurityEventType/i);
  });
});

describe("RATE_LIMIT / BRUTE_FORCE remediation is not a self-DoS instruction (2026-08-07 review, Task 4.4 item 2)", () => {
  it("RATE_LIMIT guidance no longer tells the operator to permanently block the IP at the firewall", async () => {
    const { buildEmbedForTest } = await import("./discordSecurityAlert");
    const embed = buildEmbedForTest({
      eventType: "RATE_LIMIT",
      ip: "1.2.3.4",
      path: "/api/test",
      method: "GET",
      userAgent: "ua",
      context: "global",
      occurredAt: 1_754_500_000_000,
    });
    expect(embed.data.description).not.toMatch(/consider permanently blocking it at the firewall/i);
    expect(embed.data.description).toMatch(/shared infrastructure/i);
  });

  it("BRUTE_FORCE description no longer instructs blocking the IP as 'the most effective action'", async () => {
    const { buildBruteForceEmbedForTest } = await import("./discordSecurityAlert");
    const embed = buildBruteForceEmbedForTest("1.2.3.4", 4, 10 * 60 * 1000, "ua", 1_754_500_000_000);
    expect(embed.data.description).not.toMatch(/most effective action/i);
    expect(embed.data.description).toMatch(/shared infrastructure/i);
    expect(embed.data.description).toMatch(/Cloudflare/i);
  });

  it("BRUTE_FORCE's 'Recommended Immediate Action' field prefers an account lock over an IP block", async () => {
    const { buildBruteForceEmbedForTest } = await import("./discordSecurityAlert");
    const embed = buildBruteForceEmbedForTest("1.2.3.4", 4, 10 * 60 * 1000, "ua", 1_754_500_000_000);
    const actionField = (embed.data.fields ?? []).find(f => f.name.includes("Recommended Immediate Action"));
    expect(actionField?.value).toMatch(/confirm it isn't.*shared infrastructure/i);
    expect(actionField?.value).not.toMatch(
      /^Block `1\.2\.3\.4` at the firewall\/CDN level — IP Access Rules\./
    );
  });
});

describe("dedup key includes path + context, not just (eventType, ip) (2026-08-07 review, Task 4.5)", () => {
  it("two DIFFERENT limiters (context values) firing for the SAME IP within the cooldown BOTH post", async () => {
    const { postSecurityAlert } = await import("./discordSecurityAlert");
    const { client, channel } = clientWithCapturingChannel("sec-events-dedup", async () => ({ id: "1" }));
    clientState.value = client;

    const ip = "203.0.113.9";
    const now = Date.now();

    await postSecurityAlert({
      eventType: "RATE_LIMIT",
      ip,
      path: "/api/trpc/appUsers.login",
      method: "POST",
      userAgent: "ua",
      context: "trpc_auth",
      occurredAt: now,
    });
    // Same IP, DIFFERENT limiter — the OLD `${eventType}:${ip}` key would
    // have deduped this second alert away, silently dropping a real
    // trpc_auth brute-force signal underneath an unrelated public_feed one.
    await postSecurityAlert({
      eventType: "RATE_LIMIT",
      ip,
      path: "/api/trpc/games.list",
      method: "GET",
      userAgent: "ua",
      context: "public_feed",
      occurredAt: now + 10,
    });

    const embedSends = channel.sentArgs.filter(
      (a): a is { embeds: unknown[] } => typeof a === "object" && a !== null && "embeds" in a
    );
    expect(embedSends.length).toBe(2);
  });

  it("the SAME (eventType, ip, path, context) posted twice within the cooldown IS still deduped", async () => {
    const { postSecurityAlert } = await import("./discordSecurityAlert");
    const { client, channel } = clientWithCapturingChannel("sec-events-dedup-2", async () => ({ id: "1" }));
    clientState.value = client;

    const ip = "203.0.113.10";
    const now = Date.now();
    const one = {
      eventType: "RATE_LIMIT" as const,
      ip,
      path: "/api/trpc/games.list",
      method: "GET",
      userAgent: "ua",
      context: "public_feed",
      occurredAt: now,
    };
    await postSecurityAlert(one);
    await postSecurityAlert({ ...one, occurredAt: now + 10 });

    const embedSends = channel.sentArgs.filter(
      (a): a is { embeds: unknown[] } => typeof a === "object" && a !== null && "embeds" in a
    );
    expect(embedSends.length).toBe(1);
  });
});

describe("global alert budget + time-based prune (2026-08-07 review, Task 4.6)", () => {
  it("1000 events from 1000 distinct IPs in under a minute yields <= 21 embeds, and the dedup prune runs <= 1 time", async () => {
    const mod = await import("./discordSecurityAlert");
    const { postSecurityAlert, getAlertDedupPruneRunCountForTest } = mod;
    const { client, channel } = clientWithCapturingChannel("sec-events-flood", async () => ({ id: "1" }));
    clientState.value = client;

    const now = Date.now();
    for (let i = 0; i < 1000; i++) {
      await postSecurityAlert({
        eventType: "RATE_LIMIT",
        ip: `198.51.100.${i}`, // 1000 distinct synthetic IPs (string-unique; format need not be a real IPv4)
        path: "/api/trpc/games.list",
        method: "GET",
        userAgent: "ua",
        context: "public_feed",
        occurredAt: now + i, // all comfortably inside one minute
      });
    }

    // The budget-exhausted summary is posted fire-and-forget (not awaited by
    // postSecurityAlert); give it a turn to land before asserting.
    await new Promise(r => setTimeout(r, 20));

    // <=20 real alert embeds + <=1 budget-exhausted summary (content-only, no
    // embeds key) = <=21 total sends.
    expect(channel.sentArgs.length).toBeLessThanOrEqual(21);

    const embedSends = channel.sentArgs.filter(
      (a): a is { embeds: unknown[] } => typeof a === "object" && a !== null && "embeds" in a
    );
    expect(embedSends.length).toBeLessThanOrEqual(20);

    // The time-based prune sweep runs at most once per DISCORD_ALERT_DEDUP_MS
    // (30s) — 1000 events fired in a tight synchronous loop take nowhere
    // near 30s of wall-clock time, so it must fire at most once, never once
    // per event (the old size-triggered re-scan-on-every-call bug).
    expect(getAlertDedupPruneRunCountForTest()).toBeLessThanOrEqual(1);
  }, 20_000);

  it("posts exactly ONE budget-exhausted summary line, not one per suppressed alert", async () => {
    const { postSecurityAlert } = await import("./discordSecurityAlert");
    const { client, channel } = clientWithCapturingChannel("sec-events-flood-summary", async () => ({ id: "1" }));
    clientState.value = client;

    const now = Date.now();
    for (let i = 0; i < 30; i++) {
      await postSecurityAlert({
        eventType: "RATE_LIMIT",
        ip: `198.51.100.${i}`,
        path: "/api/trpc/games.list",
        method: "GET",
        userAgent: "ua",
        context: "public_feed",
        occurredAt: now + i,
      });
    }
    // The budget-exhausted summary is posted fire-and-forget (not awaited by
    // postSecurityAlert); give it a turn to land before asserting.
    await new Promise(r => setTimeout(r, 20));

    const contentOnlySends = channel.sentArgs.filter(
      (a): a is { content: string } =>
        typeof a === "object" && a !== null && "content" in a && !("embeds" in a)
    );
    expect(contentOnlySends.length).toBe(1);
    expect(contentOnlySends[0]!.content).toMatch(/alert budget reached/i);
  });
});

describe("formatTimestamp emits the real zone abbreviation + UTC instant, not a hardcoded EST (2026-08-07 review, Task 4.7)", () => {
  it("an August instant (EDT) is labelled EDT, not EST — the exact bug repro from the finding", async () => {
    const { buildEmbedForTest } = await import("./discordSecurityAlert");
    // 20:48:23Z is 16:48:23 EDT — verified live to previously render "EST".
    const augustUtc = Date.UTC(2026, 7, 6, 20, 48, 23);
    const embed = buildEmbedForTest({
      eventType: "CSRF_BLOCK",
      ip: "1.2.3.4",
      blockedOrigin: "https://evil.example",
      path: "appUsers.login",
      method: "POST",
      occurredAt: augustUtc,
    });
    const timeField = (embed.data.fields ?? []).find(f => f.name.includes("Time of Event"));
    expect(timeField?.value).toContain("EDT");
    expect(timeField?.value).not.toContain("EST");
    expect(timeField?.value).toContain(new Date(augustUtc).toISOString());
  });

  it("a January instant (EST) is labelled EST", async () => {
    const { buildEmbedForTest } = await import("./discordSecurityAlert");
    const januaryUtc = Date.UTC(2026, 0, 15, 12, 0, 0);
    const embed = buildEmbedForTest({
      eventType: "CSRF_BLOCK",
      ip: "1.2.3.4",
      blockedOrigin: "https://evil.example",
      path: "appUsers.login",
      method: "POST",
      occurredAt: januaryUtc,
    });
    const timeField = (embed.data.fields ?? []).find(f => f.name.includes("Time of Event"));
    expect(timeField?.value).toContain("EST");
    expect(timeField?.value).not.toContain("EDT");
    expect(timeField?.value).toContain(new Date(januaryUtc).toISOString());
  });
});

describe("logSafe reaches embed values and content, and content additionally strips backtick/@ (2026-08-07 review, Task 4.8)", () => {
  const HOSTILE_PATH = "/api/trpc/games.list`@everyone\nx=1";

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a path containing a backtick, @everyone and a newline cannot forge a log line when it reaches an embed field", async () => {
    const { buildEmbedForTest } = await import("./discordSecurityAlert");
    // buildEmbedForTest doesn't itself log, but proves the embed build
    // survives hostile input and that the raw newline never appears intact
    // in the composed field value (logSafe converts it to the literal `\n`).
    const embed = buildEmbedForTest({
      eventType: "RATE_LIMIT",
      ip: "1.2.3.4",
      path: HOSTILE_PATH,
      method: "GET",
      userAgent: "ua",
      context: "public_feed",
      occurredAt: 1_754_500_000_000,
    });
    const pathField = (embed.data.fields ?? []).find(f => f.name.includes("Route / Endpoint Hit"));
    expect(pathField?.value).toBeDefined();
    // logSafe escapes real newlines to the two-character sequence `\n` — a
    // raw newline must never survive into the field value.
    expect(pathField!.value).not.toMatch(/[\r\n]/);
    expect(pathField!.value).toContain("\\n");
  });

  it("postSecurityAlert with a hostile path never forges a console log line (full pipeline)", async () => {
    const { postSecurityAlert } = await import("./discordSecurityAlert");
    const lines = captureConsole();
    clientState.value = clientWithChannel("ok", async () => ({ id: "1" }));
    await postSecurityAlert({
      eventType: "RATE_LIMIT",
      ip: "1.2.3.5",
      path: HOSTILE_PATH,
      method: "GET",
      userAgent: "ua",
      context: "public_feed",
      occurredAt: Date.now(),
    });
    assertNoForgedLines(lines);
  });

  it("the BRUTE_FORCE @here content strips backticks and @ from the ip — no forged mention, no code-span breakout", async () => {
    const { postSecurityAlert } = await import("./discordSecurityAlert");
    const { client, channel } = clientWithCapturingChannel("sec-events-hostile-ip", async () => ({ id: "1" }));
    clientState.value = client;

    const hostileIp = "1.2.3.4`@everyone\nforged";
    const now = Date.now();
    for (let i = 0; i < 4; i++) {
      await postSecurityAlert({
        eventType: "AUTH_FAIL",
        ip: hostileIp,
        path: "appUsers.login",
        method: "POST",
        userAgent: "ua",
        context: "invalid_password",
        targetIdentifier: "abc***@example.com",
        occurredAt: now + i * 100,
      });
    }
    await new Promise(r => setTimeout(r, 20));

    const bruteForceSend = channel.sentArgs.find(
      (a): a is { content: string; embeds: unknown[] } =>
        typeof a === "object" && a !== null && "content" in a
    );
    expect(bruteForceSend).toBeDefined();
    expect(bruteForceSend!.content).not.toContain("`@everyone");
    expect(bruteForceSend!.content).not.toMatch(/@everyone/);
    expect(bruteForceSend!.content).not.toMatch(/[\r\n]/);
  });

  it("SECURITY_CHANNEL_ID is exported so server/_core/index.ts can import it instead of duplicating the literal", async () => {
    const { SECURITY_CHANNEL_ID } = await import("./discordSecurityAlert");
    expect(SECURITY_CHANNEL_ID).toBe("1492280227567501403");
  });
});

describe("Discord Markdown cannot break out of an embed field (2026-08-07 review, Critical 1)", () => {
  // The reviewer's EXACT two payloads, verified working live through the
  // real EmbedBuilder before this fix: every field() call site wrapped its
  // value in a single-backtick code span and logSafe() never touched
  // backticks or Markdown, so an embedded backtick closed the span early
  // and exposed live Markdown to Discord's real parser.
  const PAYLOAD_PATH = "x`**PWNED-BOLD**`[phish](https://evil.example)y";
  const PAYLOAD_ORIGIN = "https://evil.example`||spoiler-hide-this||`";

  /**
   * Every field() call site wraps its (escaped) value in exactly TWO real
   * template-literal backticks of its own (the code-span wrapper) — those
   * are expected and are not the vulnerability; the vulnerability was a
   * THIRD-or-more backtick sneaking in from attacker-controlled content and
   * closing that wrapper early. So the correct post-fix invariant is "the
   * field value contains EXACTLY as many real backticks as its own static
   * wrapper contributes", not "zero backticks" — asserting the count
   * catches an attacker-supplied backtick surviving while still allowing
   * the code's own wrapper.
   */
  function countBackticks(value: string): number {
    return (value.match(/`/g) ?? []).length;
  }

  it("CSRF_BLOCK: the reviewer's exact path + blockedOrigin payloads render with no live bold, no live link, no live spoiler, and no attacker-controlled backtick", async () => {
    const { buildEmbedForTest } = await import("./discordSecurityAlert");
    const embed = buildEmbedForTest({
      eventType: "CSRF_BLOCK",
      ip: "1.2.3.4",
      blockedOrigin: PAYLOAD_ORIGIN,
      path: PAYLOAD_PATH,
      method: "POST",
      occurredAt: 1_754_500_000_000,
    });
    const fields = embed.data.fields ?? [];
    const pathField = fields.find(f => f.name.includes("tRPC Procedure Targeted"));
    const originField = fields.find(f => f.name.includes("Blocked Origin"));
    expect(pathField).toBeDefined();
    expect(originField).toBeDefined();

    // Exactly 2 real backticks survive in each field — the code's OWN
    // wrapper (`` `${value}` ``) — even though PAYLOAD_PATH contains 2 of
    // its own and PAYLOAD_ORIGIN contains 2 of its own. Every
    // attacker-supplied backtick was neutralised; this is what makes the
    // breakout impossible (an attacker who could add a 3rd/4th real
    // backtick could still close the wrapper early).
    expect(countBackticks(pathField!.value)).toBe(2);
    expect(countBackticks(originField!.value)).toBe(2);

    // The bold marker must be de-fanged (escaped), never live.
    expect(pathField!.value).not.toMatch(/(?<!\\)\*\*PWNED-BOLD(?<!\\)\*\*/);
    expect(pathField!.value).toContain("\\*\\*PWNED-BOLD\\*\\*");

    // The masked-link syntax must be de-fanged, never a live clickable link.
    expect(pathField!.value).not.toContain("[phish](https://evil.example)");
    expect(pathField!.value).toContain("\\[phish\\]\\(https://evil.example\\)");

    // The spoiler-tag pipes must be de-fanged, never a live spoiler.
    expect(originField!.value).not.toContain("||spoiler-hide-this||");
    expect(originField!.value).toContain("\\|\\|spoiler-hide-this\\|\\|");

    // Forensic preservation: every original character is still legible in
    // the rendered value (as an inert lookalike or backslash-escaped) — this
    // is not a silent-deletion fix.
    expect(pathField!.value).toContain("PWNED-BOLD");
    expect(pathField!.value).toContain("phish");
    expect(pathField!.value).toContain("evil.example");
    expect(originField!.value).toContain("spoiler-hide-this");
  });

  it("RATE_LIMIT: the same path payload cannot break out of the Route/Endpoint field", async () => {
    const { buildEmbedForTest } = await import("./discordSecurityAlert");
    const embed = buildEmbedForTest({
      eventType: "RATE_LIMIT",
      ip: "1.2.3.4",
      path: PAYLOAD_PATH,
      method: "GET",
      userAgent: "ua",
      context: "public_feed",
      occurredAt: 1_754_500_000_000,
    });
    const pathField = (embed.data.fields ?? []).find(f => f.name.includes("Route / Endpoint Hit"));
    expect(pathField).toBeDefined();
    expect(countBackticks(pathField!.value)).toBe(2);
    expect(pathField!.value).not.toMatch(/(?<!\\)\*\*PWNED-BOLD(?<!\\)\*\*/);
    expect(pathField!.value).not.toContain("[phish](https://evil.example)");
  });

  it("AUTH_FAIL: the payload cannot break out of the targetIdentifier field (the directly attacker-controlled sanitizeLoginIdentifier() output) or the ip field", async () => {
    const { buildEmbedForTest } = await import("./discordSecurityAlert");
    const embed = buildEmbedForTest({
      eventType: "AUTH_FAIL",
      ip: PAYLOAD_ORIGIN,
      path: "appUsers.login",
      method: "POST",
      userAgent: "ua",
      context: "invalid_password",
      targetIdentifier: PAYLOAD_PATH,
      occurredAt: 1_754_500_000_000,
    });
    const fields = embed.data.fields ?? [];
    const targetField = fields.find(f => f.name.includes("Account Targeted"));
    const ipField = fields.find(f => f.name.includes("Attacker IP Address"));
    expect(targetField).toBeDefined();
    expect(ipField).toBeDefined();
    // targetField's value is `` `${escaped}` `` followed by static italic
    // explainer text (no further backticks in that suffix) — still exactly 2.
    expect(countBackticks(targetField!.value)).toBe(2);
    expect(targetField!.value).not.toMatch(/(?<!\\)\*\*PWNED-BOLD(?<!\\)\*\*/);
    expect(targetField!.value).not.toContain("[phish](https://evil.example)");
    expect(countBackticks(ipField!.value)).toBe(2);
    expect(ipField!.value).not.toContain("||spoiler-hide-this||");
  });

  it("BRUTE_FORCE: the payload cannot break out of the description, the ip field, or the Recommended Immediate Action field", async () => {
    const { buildBruteForceEmbedForTest } = await import("./discordSecurityAlert");
    const embed = buildBruteForceEmbedForTest(PAYLOAD_ORIGIN, 4, 10 * 60 * 1000, "ua", 1_754_500_000_000);
    const fields = embed.data.fields ?? [];
    const ipField = fields.find(f => f.name.includes("Attacker IP Address"));
    const actionField = fields.find(f => f.name.includes("Recommended Immediate Action"));
    expect(ipField).toBeDefined();
    expect(actionField).toBeDefined();

    // Description interpolates `ip` once, wrapped in its own backtick pair.
    expect(countBackticks(embed.data.description ?? "")).toBe(2);
    expect(embed.data.description ?? "").not.toContain("||spoiler-hide-this||");
    expect(countBackticks(ipField!.value)).toBe(2);
    expect(ipField!.value).not.toContain("||spoiler-hide-this||");
    expect(countBackticks(actionField!.value)).toBe(2);
    expect(actionField!.value).not.toContain("||spoiler-hide-this||");
  });

  it("sanitise-then-clamp order: a value that is nothing but backticks never leaves more than the wrapper's own 2 backticks in the clamped field (a truncation can never reopen an escape)", async () => {
    const { buildEmbedForTest } = await import("./discordSecurityAlert");
    // logSafe() caps its input at 300 chars by default before this ever
    // reaches escapeDiscordMarkdown()/clampFieldValue() — this value is long
    // enough to exercise that cap and prove escaping happens on the FULL
    // (pre-clamp) sanitised value, not something clamped-then-escaped that
    // could reintroduce a raw delimiter at the cut boundary.
    const hostilePath = "`".repeat(2000);
    const embed = buildEmbedForTest({
      eventType: "RATE_LIMIT",
      ip: "1.2.3.4",
      path: hostilePath,
      method: "GET",
      userAgent: "ua",
      context: "public_feed",
      occurredAt: 1_754_500_000_000,
    });
    const pathField = (embed.data.fields ?? []).find(f => f.name.includes("Route / Endpoint Hit"));
    expect(pathField).toBeDefined();
    expect(pathField!.value.length).toBeLessThanOrEqual(1024);
    // At most the wrapper's own 2 real backticks can survive — every one of
    // the 2000 attacker-supplied backticks (or the 300 that make it past
    // logSafe's own cap) is neutralised, no matter where any subsequent
    // truncation lands.
    expect(countBackticks(pathField!.value)).toBeLessThanOrEqual(2);
  });
});

describe("fireRateLimitEvent threads an explicit blocked/observed indicator per call site (2026-08-07 review, Importants 1&2)", () => {
  // index.ts self-executes startServer() at import time, so — per the
  // established precedent in originLockAlertRouting.test.ts and
  // clientIdentityCallSites.test.ts — it is read as source text rather than
  // imported.
  const INDEX_SRC = readFileSync(
    path.join(import.meta.dirname, "../_core/index.ts"),
    "utf8"
  );

  it("fireRateLimitEvent's signature gains an `outcome` parameter defaulting to \"blocked\" (so the six real-limiter call sites, asserted verbatim by clientIdentityCallSites.test.ts, stay textually unchanged and still get the correct value)", () => {
    expect(INDEX_SRC).toMatch(
      /outcome:\s*"blocked"\s*\|\s*"observed"\s*=\s*"blocked"/
    );
  });

  it("the console.warn tag reflects the real outcome — \"BLOCKED\" vs \"OBSERVED (not blocked)\" — not a hardcoded \"BLOCKED\" for all eight call sites (confirmed live 2026-08-07: BLOCKED logged for a request the HTTP log recorded as httpStatus:200)", () => {
    expect(INDEX_SRC).toMatch(
      /outcome === "blocked" \? "BLOCKED" : "OBSERVED \(not blocked\)"/
    );
    // The OLD unconditional literal must be gone from the log line itself
    // (it still legitimately appears in this file's comments/doc-strings,
    // so this checks the specific template-literal usage, not the whole file).
    expect(INDEX_SRC).not.toMatch(/`\$\{tag\} BLOCKED \| IP=/);
  });

  it("the edge_deny call site (origin lock) passes outcome=\"blocked\" — the only OriginLockEvent kind that actually 403s", () => {
    const start = INDEX_SRC.indexOf("Origin lock (Phase 4 edge defense)");
    const end = INDEX_SRC.indexOf("Security headers (helmet)");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const originLockBlock = INDEX_SRC.slice(start, end);
    expect(originLockBlock).toMatch(
      /fireRateLimitEvent\(\s*ip,\s*req\.path,\s*req\.method,\s*"edge_origin_ingress_anomaly",\s*ua,\s*"blocked"\s*\)/
    );
  });

  it("the xff_canary call site passes outcome=\"observed\" — it is observe-only by construction and never blocks", () => {
    const start = INDEX_SRC.indexOf("XFF-sanitization canary");
    const mid = INDEX_SRC.indexOf("Edge-aware anomaly (Phase 4)");
    expect(start).toBeGreaterThan(-1);
    expect(mid).toBeGreaterThan(start);
    const xffCanaryBlock = INDEX_SRC.slice(start, mid);
    expect(xffCanaryBlock).toMatch(
      /fireRateLimitEvent\(\s*ip,\s*req\.path,\s*req\.method,\s*"xff_canary",\s*\(req\.headers\["user-agent"\][^;]*?,\s*"observed"\s*\)/
    );
  });

  it("the /api/trpc edge_origin_ingress_anomaly canary call site passes outcome=\"observed\" — it always calls next() and never blocks, even though it shares its limitType slug with the genuinely-blocking edge_deny case (this is the live production case: EDGE_MODE=log)", () => {
    const start = INDEX_SRC.indexOf("Edge-aware anomaly (Phase 4)");
    const end = INDEX_SRC.indexOf("Global API rate limiter");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const anomalyCanaryBlock = INDEX_SRC.slice(start, end);
    expect(anomalyCanaryBlock).toMatch(
      /fireRateLimitEvent\(\s*upstream \|\| ip,\s*req\.path,\s*req\.method,\s*"edge_origin_ingress_anomaly",\s*\(req\.headers\["user-agent"\][^;]*?,\s*"observed"\s*\)/
    );
  });

  it("the six real rate-limiter call sites remain textually unchanged (no explicit outcome argument) — they rely on the default, which is correct because express-rate-limit only ever invokes their handler once a request has already been rejected with 429", () => {
    const realLimiterMarkers = [
      'fireRateLimitEvent(ip, req.path, req.method, "global", ua);',
      'fireRateLimitEvent(ip, req.path, req.method, "auth", ua);',
      'fireRateLimitEvent(ip, req.path, req.method, "trpc_auth", ua);',
      'fireRateLimitEvent(ip, req.path, req.method, "stripe_checkout", ua);',
      'fireRateLimitEvent(ip, req.path, req.method, "waitlist_submit", ua);',
      'fireRateLimitEvent(ip, req.path, req.method, "public_feed", ua);',
    ];
    for (const marker of realLimiterMarkers) {
      expect(INDEX_SRC, `marker not found verbatim: ${marker}`).toContain(marker);
    }
  });

  it("SecurityAlertPayload carries the outcome through to the embed: fireRateLimitEvent forwards it as limiterOutcome, not just to insertSecurityEvent's untyped context", () => {
    const fnStart = INDEX_SRC.indexOf("function fireRateLimitEvent(");
    const fnEnd = INDEX_SRC.indexOf("\n}", INDEX_SRC.indexOf("postSecurityAlert({", fnStart));
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const fnBody = INDEX_SRC.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/postSecurityAlert\(\{[\s\S]*?limiterOutcome:\s*outcome,/);
  });
});
