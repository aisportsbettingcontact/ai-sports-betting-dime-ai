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

vi.mock("discord.js", () => ({
  TextChannel: FakeTextChannel,
  EmbedBuilder: class {
    setColor() {
      return this;
    }
    setTitle() {
      return this;
    }
    setDescription() {
      return this;
    }
    addFields() {
      return this;
    }
    setTimestamp() {
      return this;
    }
    setFooter() {
      return this;
    }
  },
}));

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
    expect(lines.some(l => l.includes("Failed to send embed"))).toBe(true);
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
