/**
 * betGradingHealth.delivery.test.ts — the alarm actually delivers.
 *
 * STUCK_BETS, GRADING_ERRORS and NO_MATCH had never fired in production,
 * because nothing had ever been stuck. An alarm nobody has watched deliver is
 * an alarm you cannot rely on the day it matters — and this one is the only
 * thing standing between a silently broken score feed and a user asking why
 * their ticket is still open.
 *
 * So this drives the real `gradingAlert()` against a local HTTP listener and
 * asserts the exact payload Discord would receive. No production webhook, no
 * third-party service, no network.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import {
  gradingAlert,
  describeStuckBets,
  describeGradingErrors,
  describeNoMatch,
  __resetGradingAlertRateLimit,
  STUCK_THRESHOLD_HOURS,
} from "./betGradingHealth";

const PORT = 3952;
let server: Server;
let received: Array<{ method?: string; contentType?: string; body: any }> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", c => (raw += c));
    req.on("end", () => {
      received.push({
        method: req.method,
        contentType: req.headers["content-type"] as string,
        body: JSON.parse(raw),
      });
      res.writeHead(204).end();
    });
  });
  await new Promise<void>(r => server.listen(PORT, r));
  process.env.BILLING_ALERT_DISCORD_WEBHOOK_URL = `http://127.0.0.1:${PORT}/hook`;
});

afterAll(() => { server?.close(); });

const stuckMessage = () =>
  describeStuckBets([
    { id: 4242, userId: 1, sport: "MLB", gameDate: "2026-08-01",
      awayTeam: "NYY", homeTeam: "BOS", hoursPending: 61 },
  ]);

describe("a stuck bet is described in terms an operator can act on", () => {
  it("names the bet and the threshold it breached", () => {
    const msg = stuckMessage();
    expect(msg).toBeTruthy();
    expect(msg).toContain("#4242");
    expect(msg).toContain(String(STUCK_THRESHOLD_HOURS));
  });

  it("stays quiet below the threshold", () => {
    expect(describeStuckBets([
      { id: 1, userId: 1, sport: "MLB", gameDate: "2026-08-04",
        awayTeam: "A", homeTeam: "B", hoursPending: 2 },
    ])).toBeNull();
  });
});

describe("gradingAlert delivers over the webhook", () => {
  it("REGRESSION: one alarm produces exactly one POST with a Discord embed", async () => {
    received = [];
    __resetGradingAlertRateLimit();
    await gradingAlert("STUCK_BETS", stuckMessage()!);

    expect(received).toHaveLength(1);
    const r = received[0];
    expect(r.method).toBe("POST");
    expect(r.contentType).toContain("application/json");
    expect(Array.isArray(r.body.embeds)).toBe(true);

    const e = r.body.embeds[0];
    expect(e.title).toContain("STUCK_BETS");
    expect(e.description).toContain("#4242");
    expect(e.color).toBe(0xed4245);            // the red token, not an arbitrary hue
    expect(e.footer?.text).toContain("Dime AI");
    expect(e.timestamp).toBeTruthy();
  });

  it("REGRESSION: repeats inside the window are suppressed", async () => {
    // A broken feed must not become 500 messages; that is how an alarm channel
    // gets muted, which is worse than having no alarm.
    received = [];
    __resetGradingAlertRateLimit();
    await gradingAlert("STUCK_BETS", "first");
    await gradingAlert("STUCK_BETS", "second");
    await gradingAlert("STUCK_BETS", "third");
    expect(received).toHaveLength(1);
  });

  it("but a different alarm kind is never suppressed by another", async () => {
    received = [];
    __resetGradingAlertRateLimit();
    await gradingAlert("STUCK_BETS", "stuck");
    await gradingAlert("GRADING_ERRORS", "errors");
    expect(received).toHaveLength(2);
  });

  it("REGRESSION: a dead webhook cannot break the thing it is watching", async () => {
    __resetGradingAlertRateLimit();
    const good = process.env.BILLING_ALERT_DISCORD_WEBHOOK_URL;
    process.env.BILLING_ALERT_DISCORD_WEBHOOK_URL = "http://127.0.0.1:1/dead";
    await expect(gradingAlert("NO_MATCH", "probe")).resolves.toBeUndefined();
    process.env.BILLING_ALERT_DISCORD_WEBHOOK_URL = good;
  });
});

describe("the other two alarm kinds", () => {
  it("grading errors fire, and silence means clean", () => {
    expect(describeGradingErrors({
      date: "2026-08-04", total: 10, graded: 7, errors: 3,
      details: [{ betId: 1, result: "ERROR", reason: "feed timeout" }],
    })).toContain("3 of 10");
    expect(describeGradingErrors({ date: "d", total: 5, graded: 5, errors: 0 })).toBeNull();
  });

  it("no-match fires at the drift threshold, not on a single postponement", () => {
    // One unresolved game is noise; a cluster is the score feed's vocabulary
    // drifting, which is how stuck bets begin.
    const three = [
      { betId: 1, result: "PENDING", reason: "not found in MLB scores" },
      { betId: 2, result: "PENDING", reason: "not found in MLB scores" },
      { betId: 3, result: "PENDING", reason: "AMBIGUOUS prefix match" },
    ];
    expect(describeNoMatch(three)).toContain("3 bet(s)");
    expect(describeNoMatch(three.slice(0, 1))).toBeNull();
  });
});
