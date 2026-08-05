import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requireCronSecret } from "../cron/cronAuth";
import { trackAuthFailForBruteForce } from "../discord/discordSecurityAlert";
import { registerStorageProxy } from "./storageProxy";

/**
 * Boundary proof for the log-injection fix.
 *
 * logSafe.test.ts proves the sanitizer in isolation. This suite proves it is
 * actually WIRED at the call sites that take attacker-controlled input, by
 * driving the real functions with CRLF-laced payloads and asserting that
 * nothing they emit can forge a log line.
 *
 * The assertion is deliberately about the emitted string, not about which
 * function was called: a future refactor that changes the message but keeps
 * the value sanitized still passes, while dropping the logSafe() wrapper
 * fails immediately.
 */

// A payload that would forge a CRITICAL alert line in the structured log
// stream the Discord security pipeline parses.
const FORGERY = 'x\n[CRITICAL][FORGED] attacker-owned line\r\nsecond: "line"';

function captureConsole() {
  const lines: string[] = [];
  const sink = (...args: unknown[]) => {
    lines.push(args.map(a => String(a)).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(sink);
  vi.spyOn(console, "warn").mockImplementation(sink);
  vi.spyOn(console, "error").mockImplementation(sink);
  return lines;
}

function assertNoForgedLines(lines: string[]) {
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    // A raw CR or LF anywhere in an emitted record means the payload could
    // start its own line in the log stream.
    expect(line).not.toMatch(/[\r\n]/);
    expect(line).not.toMatch(/^\[CRITICAL\]\[FORGED\]/m);
  }
}

describe("log-injection boundary — sanitizer is wired at real call sites", () => {
  let lines: string[];

  beforeEach(() => {
    lines = captureConsole();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("brute-force tracker cannot be made to forge lines via a hostile IP", () => {
    const now = Date.now();
    // Threshold is 3 in a 10-minute window — cross it so the DEDUP,
    // recorded, threshold and ESCALATING branches all emit.
    for (let i = 0; i < 5; i++) {
      trackAuthFailForBruteForce(FORGERY, now + i * 1000);
    }
    assertNoForgedLines(lines);
    expect(lines.some(l => l.includes("\\n"))).toBe(true);
  });

  it("cron auth rejection cannot be made to forge lines via a hostile UA", () => {
    const req = {
      headers: { "user-agent": FORGERY },
      get(name: string) {
        return (this.headers as Record<string, string>)[name.toLowerCase()];
      },
      ip: "203.0.113.9",
    } as unknown as Parameters<typeof requireCronSecret>[0];
    const res = {
      status() {
        return this;
      },
      json() {
        return this;
      },
      send() {
        return this;
      },
    } as unknown as Parameters<typeof requireCronSecret>[1];

    const allowed = requireCronSecret(req, res, "boundary-test");
    expect(allowed).toBe(false); // no valid secret supplied
    assertNoForgedLines(lines);
  });

  it("storage proxy 404 cannot be made to forge lines via a hostile key", async () => {
    const app = express();
    registerStorageProxy(app);
    const server = app.listen(0);
    try {
      const port = (server.address() as { port: number }).port;
      const hostileKey = encodeURIComponent(FORGERY);
      await fetch(`http://127.0.0.1:${port}/dime-storage/${hostileKey}`).catch(
        () => undefined
      );
      assertNoForgedLines(lines);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 20_000);
});
