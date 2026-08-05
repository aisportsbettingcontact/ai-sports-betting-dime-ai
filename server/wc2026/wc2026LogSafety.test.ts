import express from "express";
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CRON_SECRET = "test-cron-secret-for-log-safety";

function selfPost(port: number, path: string): Promise<void> {
  // NOTE: global fetch is stubbed in this suite, so calling our own test server
  // through fetch would hit the mock and never execute the route. Use the raw
  // http client. The routes are POST and gated by requireCronSecret, so the
  // secret header is required to get past the auth guard into the log paths.
  return new Promise(resolve => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: { "x-cron-secret": CRON_SECRET },
      },
      res => {
        res.resume();
        res.on("end", () => resolve());
      }
    );
    req.on("error", () => resolve());
    req.setTimeout(15000, () => {
      req.destroy();
      resolve();
    });
    req.end();
  });
}

/**
 * Log-safety coverage for the WC2026 ingestion surfaces.
 *
 * These handlers log values taken straight from request query strings and from
 * third-party API responses (ESPN/FIFA), so both an end user and an upstream
 * provider can influence what lands in the log stream. `fetch` is mocked so no
 * network is touched; the assertion is only that nothing emitted can start a
 * new log line.
 */

const FORGERY = 'x\n[CRITICAL][FORGED] owned\r\ntail="line"';

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
  for (const line of lines) {
    expect(line).not.toMatch(/[\r\n]/);
  }
}

describe("wc2026 surfaces — hostile input cannot forge log lines", () => {
  let lines: string[];

  beforeEach(() => {
    lines = captureConsole();
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ events: [] }),
        text: async () => "{}",
      }))
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("ESPN ingestion sanitizes a hostile date parameter", async () => {
    const { ingestWc2026EspnResults } = await import("./wc2026Ingester");
    await ingestWc2026EspnResults({ dateStr: FORGERY }).catch(() => undefined);
    assertNoForgedLines(lines);
    expect(lines.length).toBeGreaterThan(0);
  }, 20_000);

  it("heartbeat routes sanitize hostile query input", async () => {
    const { registerWc2026Heartbeats } = await import("./wc2026Heartbeat");
    const app = express();
    registerWc2026Heartbeats(app);
    const server = app.listen(0);
    try {
      const port = (server.address() as { port: number }).port;
      const q = encodeURIComponent(FORGERY);
      await selfPost(port, `/api/scheduled/wc2026-espn-results?date=${q}`);
      await selfPost(port, "/api/scheduled/wc2026-live-scores");
      await selfPost(port, "/api/scheduled/wc2026-live-sync");
      assertNoForgedLines(lines);
      expect(lines.length).toBeGreaterThan(0);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 30_000);

  it("FIFA live-sync handler sanitizes what it logs", async () => {
    const { wc2026LiveSyncHandler } = await import("./fifaLiveScraper");
    const req = { query: { date: FORGERY }, get: () => undefined } as never;
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
    } as never;
    await wc2026LiveSyncHandler(req, res).catch(() => undefined);
    assertNoForgedLines(lines);
  }, 30_000);
});
