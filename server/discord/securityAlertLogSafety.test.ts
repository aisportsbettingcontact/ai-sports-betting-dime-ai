import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  // FakeTextChannel.send() is a no-op that ignores its argument — it exists
  // only to satisfy the `instanceof TextChannel` check and the send()/name/
  // guild surface the earlier tests drive. To assert on the exact composed
  // `content` string passed to send(), this subclass records every call.
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
