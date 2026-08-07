/**
 * weeklySecurityDigest.test.ts
 *
 * Unit tests for the weekly security digest module. weeklySecurityDigest.ts
 * shares its A1/A2/A3/B1 implementation with securityDigest.ts (imports
 * classifyIp/splitEventsByAllowlist/topIpsByCount/escalateDeliveryFailure/
 * filterDigestMarkers from it — see that file's test suite for the deep
 * per-mechanism coverage of those pieces). This file focuses on what's
 * unique to the weekly scheduler: its own restart-safe fire window/marker
 * (B2), that the shared allowlist exclusion actually reaches the weekly
 * threat level and day-bucket trend, and that a notifyOwner failure here
 * also escalates.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./db", () => ({
  getSecurityEventCountsByBucket: vi.fn(),
  getSecurityEvents: vi.fn(),
  pruneSecurityEvents: vi.fn(),
  insertSecurityEvent: vi.fn(),
  DIGEST_MARKER_DAILY_EVENT_TYPE: "DIGEST_MARKER_DAILY",
  DIGEST_MARKER_WEEKLY_EVENT_TYPE: "DIGEST_MARKER_WEEKLY",
}));

vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn(),
}));

vi.mock("./discord/bot", () => ({
  getDiscordClient: vi.fn(),
}));

vi.mock("discord.js", () => {
  class MockEmbedBuilder {
    data: { title?: string; description?: string } = {};
    setColor() { return this; }
    setTitle(v: string) { this.data.title = v; return this; }
    setDescription(v: string) { this.data.description = v; return this; }
    addFields() { return this; }
    setFooter() { return this; }
    setTimestamp() { return this; }
  }
  class MockTextChannel {
    name = "security-events";
    guild = { name: "Test Guild" };
    send = vi.fn().mockResolvedValue(undefined);
  }
  return { EmbedBuilder: MockEmbedBuilder, TextChannel: MockTextChannel };
});

import * as db from "./db";
import * as notification from "./_core/notification";
import * as discordBot from "./discord/bot";
import { TextChannel } from "discord.js";
import { startWeeklySecurityDigestScheduler } from "./weeklySecurityDigest";

const mockGetCountsByBucket = db.getSecurityEventCountsByBucket as ReturnType<typeof vi.fn>;
const mockGetEvents = db.getSecurityEvents as ReturnType<typeof vi.fn>;
const mockPrune = db.pruneSecurityEvents as ReturnType<typeof vi.fn>;
const mockInsertEvent = db.insertSecurityEvent as ReturnType<typeof vi.fn>;
const mockNotify = notification.notifyOwner as ReturnType<typeof vi.fn>;
const mockGetDiscordClient = discordBot.getDiscordClient as ReturnType<typeof vi.fn>;

const DIGEST_MARKER_WEEKLY_EVENT_TYPE = "DIGEST_MARKER_WEEKLY";

interface RawEvent {
  id: number;
  eventType: string;
  ip: string | null;
  blockedOrigin: string | null;
  trpcPath: string | null;
  httpMethod: string | null;
  userAgent: string | null;
  context: string | null;
  occurredAt: number;
}

function makeEvent(
  ip: string | null,
  eventType: string,
  context: string | null,
  occurredAt: number
): RawEvent {
  return {
    id: Math.floor(Math.random() * 1_000_000),
    eventType,
    ip,
    blockedOrigin: null,
    trpcPath: "/api/trpc/test",
    httpMethod: "POST",
    userAgent: null,
    context,
    occurredAt,
  };
}

function makeBucket(eventType: string, context: string | null, count: number) {
  return { eventType, context, count };
}

function setRawEvents(events: RawEvent[], markerRows: RawEvent[] = []) {
  mockGetEvents.mockImplementation((opts: { eventType?: string }) => {
    if (opts?.eventType === DIGEST_MARKER_WEEKLY_EVENT_TYPE) {
      return Promise.resolve(markerRows);
    }
    return Promise.resolve(events);
  });
}

function setBucketCounts(buckets: Array<{ eventType: string; context: string | null; count: number }>) {
  mockGetCountsByBucket.mockResolvedValue(buckets);
}

/** Mocks Date to a fixed Sunday UTC datetime (day=0). */
function mockDateAtSundayUTC(isoSundayDate: string, hour = 13, minute = 0): Date {
  const mockNow = new Date(
    `${isoSundayDate}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`
  );
  if (mockNow.getUTCDay() !== 0) {
    throw new Error(`Test setup error: ${isoSundayDate} is not a Sunday (UTC day=${mockNow.getUTCDay()})`);
  }
  const RealDate = globalThis.Date;
  vi.spyOn(globalThis, "Date").mockImplementation(function (...args: unknown[]) {
    if (args.length === 0) return mockNow;
    // @ts-expect-error — allow Date constructor with args
    return new RealDate(...args);
  });
  (globalThis.Date as unknown as { now: () => number }).now = () => mockNow.getTime();
  return mockNow;
}

async function fireWeeklyDigestAndWait(): Promise<void> {
  startWeeklySecurityDigestScheduler();
  await new Promise(resolve => setTimeout(resolve, 150));
}

beforeEach(() => {
  vi.resetAllMocks();
  mockGetCountsByBucket.mockResolvedValue([]);
  setRawEvents([]);
  mockPrune.mockResolvedValue(0);
  mockInsertEvent.mockResolvedValue(undefined);
  mockNotify.mockResolvedValue(true);
  mockGetDiscordClient.mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("weeklySecurityDigest", () => {
  // 2025-09-07, 2025-09-14, 2025-09-21, 2025-09-28, 2025-10-05, 2025-10-12 are Sundays.

  describe("A2 — allowlist reaches the weekly threat level and day-bucket trend", () => {
    it("weekly threat level reflects only the genuine attacker across the 7-day window", async () => {
      console.log("\n[INPUT] 7-day window: 25 attacker events + 60 seeded-CI events + 15 Cloudflare events");
      const attackerIp = "203.0.113.60";
      const ciIp = "48.217.34.226"; // seeded known-automation IP
      const cfIp = "162.158.0.10"; // inside CF_IPV4_CIDRS 162.158.0.0/15
      const now = Date.parse("2025-09-07T13:00:00.000Z");

      const events = [
        ...Array(25).fill(null).map(() => makeEvent(attackerIp, "RATE_LIMIT", "public_feed", now - 1000)),
        ...Array(60).fill(null).map(() => makeEvent(ciIp, "RATE_LIMIT", "edge_origin_ingress_anomaly", now - 2000)),
        ...Array(15).fill(null).map(() => makeEvent(cfIp, "RATE_LIMIT", "public_feed", now - 3000)),
      ];
      setBucketCounts([
        makeBucket("RATE_LIMIT", "public_feed", 40), // 25 attacker + 15 CF
        makeBucket("RATE_LIMIT", "edge_origin_ingress_anomaly", 60),
      ]);
      setRawEvents(events);

      mockDateAtSundayUTC("2025-09-07");
      await fireWeeklyDigestAndWait();

      const notifyCalls = [...mockNotify.mock.calls];
      vi.restoreAllMocks();

      expect(notifyCalls).toHaveLength(1);
      const { title, content } = notifyCalls[0][0] as { title: string; content: string };
      console.log(`[STATE] title: "${title}"`);

      // 100 total - 75 allowlisted (60 CI + 15 CF) = 25 attacker-only -> LOW (weekly scale: <50)
      expect(title).toContain("[LOW]");
      expect(title).toContain("25 unclassified event");
      expect(content).toContain(attackerIp);
      expect(content).not.toContain(ciIp);
      expect(content).not.toContain(cfIp);
      console.log("[VERIFY] PASS — weekly threat level LOW(25) reflects only the attacker");
    });
  });

  describe("A1 — weekly Rate Limit Triggers broken out by context", () => {
    it("includes a per-context breakdown line in the weekly notifyOwner content", async () => {
      const attackerIp = "203.0.113.61";
      const now = Date.parse("2025-09-14T13:00:00.000Z");
      const events = [
        ...Array(9).fill(null).map(() => makeEvent(attackerIp, "RATE_LIMIT", "trpc_auth", now - 1000)),
      ];
      setBucketCounts([makeBucket("RATE_LIMIT", "trpc_auth", 9)]);
      setRawEvents(events);

      mockDateAtSundayUTC("2025-09-14");
      await fireWeeklyDigestAndWait();

      const notifyCalls = [...mockNotify.mock.calls];
      vi.restoreAllMocks();

      expect(notifyCalls).toHaveLength(1);
      const { content } = notifyCalls[0][0] as { content: string };
      expect(content).toContain("trpc_auth: 9");
      console.log("[VERIFY] PASS — weekly digest breaks Rate Limit Triggers out by context");
    });
  });

  describe("A3 — weekly counts labeled as a deduped sample", () => {
    it("notifyOwner content states the counts are a deduped sample", async () => {
      setBucketCounts([makeBucket("AUTH_FAIL", null, 3)]);
      const now = Date.parse("2025-09-21T13:00:00.000Z");
      setRawEvents([makeEvent("203.0.113.62", "AUTH_FAIL", null, now - 1000)]);

      mockDateAtSundayUTC("2025-09-21");
      await fireWeeklyDigestAndWait();

      const notifyCalls = [...mockNotify.mock.calls];
      vi.restoreAllMocks();

      expect(notifyCalls).toHaveLength(1);
      const { content } = notifyCalls[0][0] as { content: string };
      expect(content).toMatch(/deduped sample/i);
      console.log("[VERIFY] PASS — weekly digest content labels counts as a deduped sample");
    });
  });

  describe("B1 — notifyOwner failure escalates to Discord (weekly)", () => {
    it("posts an escalation embed when notifyOwner returns false", async () => {
      const fakeChannel = new TextChannel() as unknown as { send: ReturnType<typeof vi.fn> };
      const fakeClient = {
        isReady: () => true,
        channels: { fetch: vi.fn().mockResolvedValue(fakeChannel) },
      };
      mockGetDiscordClient.mockReturnValue(fakeClient);
      mockNotify.mockResolvedValue(false);
      setBucketCounts([]);
      setRawEvents([]);

      mockDateAtSundayUTC("2025-09-28");
      await fireWeeklyDigestAndWait();

      const sendCalls = [...fakeChannel.send.mock.calls];
      vi.restoreAllMocks();

      console.log(`[STATE] channel.send call count: ${sendCalls.length}`);
      expect(sendCalls.length).toBe(2);
      const titles = sendCalls.map(c => {
        const embed = (c[0] as { embeds: Array<{ data: { title?: string } }> }).embeds[0];
        return embed.data.title ?? "";
      });
      expect(titles.some(t => t.includes("In-App Notification Failed"))).toBe(true);
      expect(titles.some(t => t.includes("Weekly Security Threat Report"))).toBe(true);
      console.log("[VERIFY] PASS — weekly digest escalates a notifyOwner failure to Discord");
    });
  });

  describe("B2 — widened fire window and restart-safe persistence (weekly)", () => {
    it("fires at UTC minute=5 on Sunday (inside the widened window)", async () => {
      setBucketCounts([]);
      setRawEvents([]);

      mockDateAtSundayUTC("2025-10-05", 13, 5);
      await fireWeeklyDigestAndWait();

      const notifyCalls = [...mockNotify.mock.calls];
      vi.restoreAllMocks();

      expect(notifyCalls).toHaveLength(1);
      console.log("[VERIFY] PASS — weekly digest fired at minute=5");
    });

    it("a persisted marker for this Sunday prevents a duplicate fire", async () => {
      const today = "2025-10-12";
      setRawEvents([], [makeEvent("system", DIGEST_MARKER_WEEKLY_EVENT_TYPE, today, Date.parse(`${today}T13:00:00.000Z`))]);
      setBucketCounts([]);

      mockDateAtSundayUTC(today, 13, 3);
      await fireWeeklyDigestAndWait();

      const notifyCalls = [...mockNotify.mock.calls];
      vi.restoreAllMocks();

      expect(notifyCalls).toHaveLength(0);
      console.log("[VERIFY] PASS — persisted weekly marker blocked a duplicate fire");
    });

    it("persists a DIGEST_MARKER_WEEKLY row via insertSecurityEvent after a successful fire", async () => {
      setBucketCounts([]);
      setRawEvents([]);

      mockDateAtSundayUTC("2025-11-02");
      await fireWeeklyDigestAndWait();

      const insertCalls = [...mockInsertEvent.mock.calls];
      vi.restoreAllMocks();

      const markerCalls = insertCalls.filter(
        c => (c[0] as { eventType: string }).eventType === DIGEST_MARKER_WEEKLY_EVENT_TYPE
      );
      expect(markerCalls).toHaveLength(1);
      expect((markerCalls[0][0] as { context: string }).context).toBe("2025-11-02");
      console.log("[VERIFY] PASS — weekly digest marker persisted with today's date");
    });
  });

  describe("does not fire on a non-Sunday", () => {
    it("does not fire at 13:00 UTC on a Monday", async () => {
      setBucketCounts([]);
      setRawEvents([]);
      // 2025-09-08 is a Monday.
      const mockNow = new Date("2025-09-08T13:00:00.000Z");
      const RealDate = globalThis.Date;
      vi.spyOn(globalThis, "Date").mockImplementation(function (...args: unknown[]) {
        if (args.length === 0) return mockNow;
        // @ts-expect-error allow constructor passthrough
        return new RealDate(...args);
      });
      (globalThis.Date as unknown as { now: () => number }).now = () => mockNow.getTime();

      await fireWeeklyDigestAndWait();

      const notifyCalls = [...mockNotify.mock.calls];
      vi.restoreAllMocks();

      expect(notifyCalls).toHaveLength(0);
      console.log("[VERIFY] PASS — weekly digest does not fire on a Monday");
    });
  });

  describe("error resilience", () => {
    it("does not throw when getSecurityEventCountsByBucket rejects", async () => {
      mockGetCountsByBucket.mockRejectedValue(new Error("DB connection lost"));
      setRawEvents([]);

      mockDateAtSundayUTC("2025-11-09");
      await expect(fireWeeklyDigestAndWait()).resolves.toBeUndefined();

      const notifyCalls = [...mockNotify.mock.calls];
      vi.restoreAllMocks();

      expect(notifyCalls).toHaveLength(0);
      console.log("[VERIFY] PASS — DB error caught, no crash");
    });
  });
});
