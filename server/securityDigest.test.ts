/**
 * securityDigest.test.ts
 *
 * Unit tests for the security digest module (securityDigest.ts), covering
 * Task 4.9 (A1 bucketing, A2 allowlist, A3 dedup-sample labeling) and
 * Task 4.10 (B1 delivery-failure escalation, B2 restart-safe window).
 *
 * ── Architecture ──────────────────────────────────────────────────────────────
 * All external dependencies (db helpers, notifyOwner, discord bot client,
 * discord.js itself) are vi.mock'd. Tests drive the REAL digest-building
 * code (startSecurityDigestScheduler → maybeFireDigest → runSecurityDigest
 * → computeDigestData → buildNotifyOwnerContent/buildDigestEmbed) with
 * fixture data, then assert on what notifyOwner (and, for B1, the Discord
 * escalation channel) actually received — not on a helper called in
 * isolation. The flagship A2 test in particular constructs a fixture with
 * CI IPs, a Cloudflare PoP IP, and one genuine attacker, and asserts the
 * reported threat level reflects ONLY the attacker.
 *
 * ── Test strategy notes (carried over from the pre-4.9/4.10 test suite) ───────
 * - Each test MUST use a UNIQUE ISO date (mockDateAtUTC's isoDate arg) —
 *   `lastDigestDateUTC` is module-level state that persists across tests in
 *   the same module instance (vitest caches modules between tests in the
 *   same file).
 * - ALWAYS capture mock.calls BEFORE vi.restoreAllMocks() (restoring wipes
 *   call history).
 * - getSecurityEvents() is called TWICE per digest run as of Task 4.10 / B2:
 *   once by maybeFireDigest()'s persisted-marker check (opts.eventType ===
 *   DIGEST_MARKER_DAILY_EVENT_TYPE) and once by runSecurityDigest() for the
 *   real raw-event window fetch (no eventType filter). setRawEvents()
 *   below installs a mockImplementation that discriminates between the two
 *   by opts.eventType so a test's fixture events only answer the SECOND
 *   call, never get mistaken for a persisted marker.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock external dependencies (vi.mock is hoisted before any import) ────────
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

// discord.js's real EmbedBuilder/TextChannel are heavy Discord API-client
// classes. A minimal fake keeps `instanceof TextChannel` (used by
// securityDigest.ts's postDigestToDiscord/escalateDeliveryFailure) working
// while giving tests a plain, inspectable `send` mock.
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

// ─── Import mocked modules and the module under test ─────────────────────────
import * as db from "./db";
import * as notification from "./_core/notification";
import * as discordBot from "./discord/bot";
import { TextChannel } from "discord.js";
import { startSecurityDigestScheduler, computeThreatLevel } from "./securityDigest";

// ─── Typed mock accessors ─────────────────────────────────────────────────────
const mockGetCountsByBucket = db.getSecurityEventCountsByBucket as ReturnType<typeof vi.fn>;
const mockGetEvents = db.getSecurityEvents as ReturnType<typeof vi.fn>;
const mockPrune = db.pruneSecurityEvents as ReturnType<typeof vi.fn>;
const mockInsertEvent = db.insertSecurityEvent as ReturnType<typeof vi.fn>;
const mockNotify = notification.notifyOwner as ReturnType<typeof vi.fn>;
const mockGetDiscordClient = discordBot.getDiscordClient as ReturnType<typeof vi.fn>;

const DIGEST_MARKER_DAILY_EVENT_TYPE = "DIGEST_MARKER_DAILY";

// ─── Test helpers ─────────────────────────────────────────────────────────────

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

/** Build a minimal raw-event row. */
function makeEvent(
  ip: string | null,
  eventType: string = "CSRF_BLOCK",
  context: string | null = null
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
    occurredAt: Date.now(),
  };
}

/** Build a bucket-count row as getSecurityEventCountsByBucket() would return. */
function makeBucket(eventType: string, context: string | null, count: number) {
  return { eventType, context, count };
}

/**
 * Installs a getSecurityEvents() mock that discriminates between the B2
 * persisted-marker check (opts.eventType === DIGEST_MARKER_DAILY_EVENT_TYPE
 * → resolves to `markerRows`, default []) and the real raw-event window
 * fetch (no eventType filter → resolves to `events`).
 */
function setRawEvents(events: RawEvent[], markerRows: RawEvent[] = []) {
  mockGetEvents.mockImplementation((opts: { eventType?: string }) => {
    if (opts?.eventType === DIGEST_MARKER_DAILY_EVENT_TYPE) {
      return Promise.resolve(markerRows);
    }
    return Promise.resolve(events);
  });
}

function setBucketCounts(buckets: Array<{ eventType: string; context: string | null; count: number }>) {
  mockGetCountsByBucket.mockResolvedValue(buckets);
}

/**
 * Mock globalThis.Date to return a fixed UTC datetime on the given ISO date
 * at the given hour:minute. Also mocks Date.now(). Returns the mocked Date.
 *
 * CRITICAL: Call vi.restoreAllMocks() AFTER reading mock.calls to undo this spy.
 *
 * @param isoDate  "YYYY-MM-DD" — MUST be unique per test to avoid lastDigestDateUTC dedup
 */
function mockDateAtUTC(isoDate: string, hour = 13, minute = 0): Date {
  const mockNow = new Date(
    `${isoDate}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`
  );
  const RealDate = globalThis.Date;

  vi.spyOn(globalThis, "Date").mockImplementation(function (...args: unknown[]) {
    if (args.length === 0) return mockNow;
    // @ts-expect-error — allow Date constructor with args
    return new RealDate(...args);
  });
  (globalThis.Date as unknown as { now: () => number }).now = () => mockNow.getTime();

  return mockNow;
}

/** Fire the scheduler and wait for the async digest to complete. */
async function fireDigestAndWait(): Promise<void> {
  startSecurityDigestScheduler();
  await new Promise(resolve => setTimeout(resolve, 150));
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.resetAllMocks();
  mockGetCountsByBucket.mockResolvedValue([]);
  setRawEvents([]);
  mockPrune.mockResolvedValue(0);
  mockInsertEvent.mockResolvedValue(undefined);
  mockNotify.mockResolvedValue(true);
  mockGetDiscordClient.mockReturnValue(null); // no-op Discord posting by default
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Test suite ───────────────────────────────────────────────────────────────
describe("securityDigest", () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // A2 — known-source allowlist excludes CI/Cloudflare/owner from threat level
  // ═══════════════════════════════════════════════════════════════════════════
  describe("A2 — allowlist excludes CI/Cloudflare/owner from the threat level", () => {
    it("threat level reflects ONLY the genuine attacker — CI + Cloudflare + owner excluded", async () => {
      console.log(
        "\n[INPUT] 111 events total (matching the real 2026-08-06 incident's total): " +
          "30 from a genuine attacker, 50 from a seeded CI IP, 20 from the seeded owner IP, " +
          "11 from a Cloudflare PoP IP"
      );

      const attackerIp = "203.0.113.50"; // TEST-NET-3 — not CF, not seeded automation
      const ciIp = "40.81.6.244"; // seeded known-automation IP (2026-08-06 incident)
      const ownerIp = "47.152.160.175"; // seeded known-automation IP (owner ISP)
      const cfIp = "173.245.48.1"; // inside CF_IPV4_CIDRS[0] = 173.245.48.0/20

      const events = [
        ...Array(30).fill(null).map(() => makeEvent(attackerIp, "RATE_LIMIT", "public_feed")),
        ...Array(50).fill(null).map(() => makeEvent(ciIp, "RATE_LIMIT", "edge_origin_ingress_anomaly")),
        ...Array(20).fill(null).map(() => makeEvent(ownerIp, "RATE_LIMIT", "global")),
        ...Array(11).fill(null).map(() => makeEvent(cfIp, "RATE_LIMIT", "public_feed")),
      ];

      setBucketCounts([
        makeBucket("RATE_LIMIT", "public_feed", 41), // 30 attacker + 11 CF
        makeBucket("RATE_LIMIT", "edge_origin_ingress_anomaly", 50),
        makeBucket("RATE_LIMIT", "global", 20),
      ]);
      setRawEvents(events);

      mockDateAtUTC("2025-09-01");
      await fireDigestAndWait();

      const notifyCalls = [...mockNotify.mock.calls];
      vi.restoreAllMocks();

      expect(notifyCalls).toHaveLength(1);
      const { title, content } = notifyCalls[0][0] as { title: string; content: string };
      console.log(`[STATE] title: "${title}"`);

      // 111 total - 81 allowlisted (50 CI + 20 owner + 11 CF) = 30 attacker-only.
      console.log("[STATE] expected threatTotal=30 -> MODERATE (10<=30<50)");
      expect(title).toContain("[MODERATE]");
      expect(title).toContain("30 unclassified event");

      expect(content).toContain(attackerIp);
      expect(content).not.toContain(ciIp);
      expect(content).not.toContain(ownerIp);
      expect(content).not.toContain(cfIp);

      console.log(
        "[VERIFY] PASS — threat level MODERATE(30) reflects only the attacker; " +
          "CI/owner/Cloudflare IPs never appear in the digest content"
      );
    });

    it("a digest with ONLY CI/Cloudflare/owner traffic reports CLEAN, not HIGH", async () => {
      console.log("\n[INPUT] 90 events, ALL from seeded automation/Cloudflare IPs, 0 genuine attacker events");

      const ciIp = "172.182.201.162";
      const cfIp = "104.16.0.5"; // inside CF_IPV4_CIDRS 104.16.0.0/13

      const events = [
        ...Array(60).fill(null).map(() => makeEvent(ciIp, "RATE_LIMIT", "edge_origin_ingress_anomaly")),
        ...Array(30).fill(null).map(() => makeEvent(cfIp, "RATE_LIMIT", "public_feed")),
      ];
      setBucketCounts([
        makeBucket("RATE_LIMIT", "edge_origin_ingress_anomaly", 60),
        makeBucket("RATE_LIMIT", "public_feed", 30),
      ]);
      setRawEvents(events);

      mockDateAtUTC("2025-09-02");
      await fireDigestAndWait();

      const notifyCalls = [...mockNotify.mock.calls];
      vi.restoreAllMocks();

      expect(notifyCalls).toHaveLength(1);
      const { title } = notifyCalls[0][0] as { title: string };
      console.log(`[STATE] title: "${title}"`);
      expect(title).toContain("[CLEAN]");
      expect(title).toContain("0 unclassified event");
      console.log("[VERIFY] PASS — 90 raw events, all allowlisted, threat level is CLEAN");
    });

    it("owner-configured allowlist (SECURITY_DIGEST_ALLOWLIST_IPS) excludes an extra IP", async () => {
      console.log("\n[INPUT] one event from an IP set via SECURITY_DIGEST_ALLOWLIST_IPS env var");
      const extraIp = "198.51.100.7"; // TEST-NET-2, not seeded by default
      process.env.SECURITY_DIGEST_ALLOWLIST_IPS = extraIp;

      try {
        const events = Array(5).fill(null).map(() => makeEvent(extraIp, "RATE_LIMIT", "global"));
        setBucketCounts([makeBucket("RATE_LIMIT", "global", 5)]);
        setRawEvents(events);

        mockDateAtUTC("2025-09-03");
        await fireDigestAndWait();

        const notifyCalls = [...mockNotify.mock.calls];
        vi.restoreAllMocks();

        expect(notifyCalls).toHaveLength(1);
        const { title } = notifyCalls[0][0] as { title: string };
        console.log(`[STATE] title: "${title}"`);
        expect(title).toContain("[CLEAN]");
        console.log("[VERIFY] PASS — SECURITY_DIGEST_ALLOWLIST_IPS entry excluded from threat level");
      } finally {
        delete process.env.SECURITY_DIGEST_ALLOWLIST_IPS;
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // A1 — bucket by (eventType, context), not just eventType
  // ═══════════════════════════════════════════════════════════════════════════
  describe("A1 — (eventType, context) bucket breakdown", () => {
    it("Rate Limit Triggers are broken out by limitType (context), not collapsed into one number", async () => {
      console.log("\n[INPUT] RATE_LIMIT events across 3 different limitType contexts, all from a single attacker");
      const attackerIp = "203.0.113.99";
      const events = [
        ...Array(12).fill(null).map(() => makeEvent(attackerIp, "RATE_LIMIT", "public_feed")),
        ...Array(7).fill(null).map(() => makeEvent(attackerIp, "RATE_LIMIT", "auth")),
        ...Array(3).fill(null).map(() => makeEvent(attackerIp, "RATE_LIMIT", "waitlist_submit")),
      ];
      setBucketCounts([
        makeBucket("RATE_LIMIT", "public_feed", 12),
        makeBucket("RATE_LIMIT", "auth", 7),
        makeBucket("RATE_LIMIT", "waitlist_submit", 3),
      ]);
      setRawEvents(events);

      mockDateAtUTC("2025-09-04");
      await fireDigestAndWait();

      const notifyCalls = [...mockNotify.mock.calls];
      vi.restoreAllMocks();

      expect(notifyCalls).toHaveLength(1);
      const { content } = notifyCalls[0][0] as { content: string };
      console.log("[STATE] content (excerpt):\n" + content.split("\n").filter(l => /public_feed|auth|waitlist_submit/.test(l)).join("\n"));

      // The accurate summary total (12+7+3=22) is expected to still appear —
      // A1 ADDS the per-context breakdown, it doesn't remove the total.
      expect(content).toContain("Rate Limit:   22");
      // What A1 actually fixes: the per-context breakdown lines exist at all.
      // Before this fix, "auth" and "waitlist_submit" never appeared anywhere
      // in the digest body — every RATE_LIMIT context collapsed into the one
      // number above with no way to tell them apart.
      expect(content).toContain("public_feed: 12");
      expect(content).toContain("auth: 7");
      expect(content).toContain("waitlist_submit: 3");
      console.log("[VERIFY] PASS — Rate Limit Triggers broken out per limitType context, in addition to the accurate total");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // A3 — counts labeled as a deduped sample, dedup window stated
  // ═══════════════════════════════════════════════════════════════════════════
  describe("A3 — counts labeled as a deduped sample", () => {
    it("notifyOwner content states the dedup window and labels counts as a sample", async () => {
      console.log("\n[INPUT] a normal digest run — checking the honesty labeling in the body");
      setBucketCounts([makeBucket("AUTH_FAIL", null, 4)]);
      setRawEvents(Array(4).fill(null).map(() => makeEvent("203.0.113.10", "AUTH_FAIL", null)));

      mockDateAtUTC("2025-09-05");
      await fireDigestAndWait();

      const notifyCalls = [...mockNotify.mock.calls];
      vi.restoreAllMocks();

      expect(notifyCalls).toHaveLength(1);
      const { content } = notifyCalls[0][0] as { content: string };
      console.log("[STATE] content window/labeling lines:\n" + content.split("\n").filter(l => /deduped|60s/i.test(l)).join("\n"));

      expect(content).toMatch(/deduped sample/i);
      expect(content).toContain("60s"); // dedup window, matches RATE_LIMIT_DEDUP_WINDOW_SEC
      console.log("[VERIFY] PASS — content labels counts as a deduped sample and states the 60s window");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // B1 — notifyOwner failure is escalated to the Discord security channel
  // ═══════════════════════════════════════════════════════════════════════════
  describe("B1 — notifyOwner failure escalates to Discord", () => {
    it("posts an escalation embed to the security channel when notifyOwner returns false", async () => {
      console.log("\n[INPUT] notifyOwner returns false (service unavailable)");
      const fakeChannel = new TextChannel() as unknown as { send: ReturnType<typeof vi.fn> };
      const fakeClient = {
        isReady: () => true,
        channels: { fetch: vi.fn().mockResolvedValue(fakeChannel) },
      };
      mockGetDiscordClient.mockReturnValue(fakeClient);
      mockNotify.mockResolvedValue(false);
      setBucketCounts([makeBucket("CSRF_BLOCK", null, 1)]);
      setRawEvents([makeEvent("203.0.113.11", "CSRF_BLOCK", null)]);

      mockDateAtUTC("2025-09-06");
      await fireDigestAndWait();

      const sendCalls = [...fakeChannel.send.mock.calls];
      vi.restoreAllMocks();

      console.log(`[STATE] channel.send call count: ${sendCalls.length}`);
      // runSecurityDigest() escalates (Step 4) BEFORE posting the normal
      // digest embed (Step 5), so call 1 is the escalation, call 2 is the
      // regular daily digest embed. Assert on embed titles directly rather
      // than relying on call order, so this test survives a future
      // reordering of those two steps.
      expect(sendCalls.length).toBe(2);
      const titles = sendCalls.map(c => {
        const embed = (c[0] as { embeds: Array<{ data: { title?: string } }> }).embeds[0];
        return embed.data.title ?? "";
      });
      console.log(`[STATE] embed titles sent: ${JSON.stringify(titles)}`);
      expect(titles.some(t => t.includes("In-App Notification Failed"))).toBe(true);
      expect(titles.some(t => t.includes("Daily Security Digest"))).toBe(true);
      console.log("[VERIFY] PASS — both the escalation embed and the normal digest embed were sent when notifyOwner failed");
    });

    it("does NOT escalate when notifyOwner succeeds", async () => {
      console.log("\n[INPUT] notifyOwner returns true (normal delivery)");
      const fakeChannel = new TextChannel() as unknown as { send: ReturnType<typeof vi.fn> };
      const fakeClient = {
        isReady: () => true,
        channels: { fetch: vi.fn().mockResolvedValue(fakeChannel) },
      };
      mockGetDiscordClient.mockReturnValue(fakeClient);
      mockNotify.mockResolvedValue(true);
      setBucketCounts([]);
      setRawEvents([]);

      mockDateAtUTC("2025-09-07");
      await fireDigestAndWait();

      const sendCalls = [...fakeChannel.send.mock.calls];
      vi.restoreAllMocks();

      console.log(`[STATE] channel.send call count: ${sendCalls.length}`);
      // Only the normal daily digest embed — no escalation.
      expect(sendCalls.length).toBe(1);
      const embed = (sendCalls[0][0] as { embeds: Array<{ data: { title?: string } }> }).embeds[0];
      expect(embed.data.title).toContain("Daily Security Digest");
      console.log("[VERIFY] PASS — no escalation embed sent when notifyOwner succeeds");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // B2 — widened fire window + restart-safe persisted marker
  // ═══════════════════════════════════════════════════════════════════════════
  describe("B2 — widened fire window and restart-safe persistence", () => {
    it("fires at UTC minute=5 (inside the widened 10-minute window, not just minute=0)", async () => {
      console.log("\n[INPUT] digest tick at 13:05 UTC (not 13:00) — should still fire");
      setBucketCounts([]);
      setRawEvents([]); // marker check also returns [] via default markerRows

      mockDateAtUTC("2025-09-08", 13, 5);
      await fireDigestAndWait();

      const notifyCalls = [...mockNotify.mock.calls];
      vi.restoreAllMocks();

      console.log(`[STATE] notifyOwner call count at minute=5: ${notifyCalls.length}`);
      expect(notifyCalls).toHaveLength(1);
      console.log("[VERIFY] PASS — digest fired at minute=5, proving the window was widened past minute=0");
    });

    it("does NOT fire at UTC minute=10 (just outside the widened window)", async () => {
      console.log("\n[INPUT] digest tick at 13:10 UTC — outside [13:00, 13:10)");
      setBucketCounts([]);
      setRawEvents([]);

      mockDateAtUTC("2025-09-09", 13, 10);
      await fireDigestAndWait();

      const notifyCalls = [...mockNotify.mock.calls];
      vi.restoreAllMocks();

      console.log(`[STATE] notifyOwner call count at minute=10: ${notifyCalls.length}`);
      expect(notifyCalls).toHaveLength(0);
      console.log("[VERIFY] PASS — digest did not fire at minute=10, window's upper bound is exclusive");
    });

    it("a persisted marker for today prevents a duplicate fire (simulated restart mid-window)", async () => {
      console.log(
        "\n[INPUT] simulated restart: in-memory lastDigestDateUTC is fresh (new test date), but a " +
          "persisted DIGEST_MARKER_DAILY row for TODAY already exists — the digest must NOT fire again"
      );
      const today = "2025-09-10";
      // Marker check call returns a row whose context === today's date.
      setRawEvents([], [makeEvent("system", DIGEST_MARKER_DAILY_EVENT_TYPE, today)]);
      setBucketCounts([]);

      mockDateAtUTC(today, 13, 4); // inside the window, restart-like mid-window tick

      await fireDigestAndWait();

      const notifyCalls = [...mockNotify.mock.calls];
      const pruneCalls = [...mockPrune.mock.calls];
      vi.restoreAllMocks();

      console.log(`[STATE] notifyOwner calls: ${notifyCalls.length} | pruneSecurityEvents calls: ${pruneCalls.length}`);
      expect(notifyCalls).toHaveLength(0);
      expect(pruneCalls).toHaveLength(0); // proves runSecurityDigest() never even started
      console.log("[VERIFY] PASS — persisted marker blocked a duplicate fire after a simulated restart");
    });

    it("persists a marker row via insertSecurityEvent after a successful fire", async () => {
      console.log("\n[INPUT] a normal digest run — should persist a DIGEST_MARKER_DAILY row on completion");
      setBucketCounts([]);
      setRawEvents([]);

      mockDateAtUTC("2025-09-11");
      await fireDigestAndWait();

      const insertCalls = [...mockInsertEvent.mock.calls];
      vi.restoreAllMocks();

      const markerCalls = insertCalls.filter(
        c => (c[0] as { eventType: string }).eventType === DIGEST_MARKER_DAILY_EVENT_TYPE
      );
      console.log(`[STATE] insertSecurityEvent(DIGEST_MARKER_DAILY) calls: ${markerCalls.length}`);
      expect(markerCalls).toHaveLength(1);
      expect((markerCalls[0][0] as { context: string }).context).toBe("2025-09-11");
      console.log("[VERIFY] PASS — digest marker persisted with today's date after a successful fire");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // computeThreatLevel — boundary conditions (pure function, unchanged thresholds)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("computeThreatLevel — boundary conditions", () => {
    it.each([
      [0, "CLEAN"],
      [1, "LOW"],
      [9, "LOW"],
      [10, "MODERATE"],
      [49, "MODERATE"],
      [50, "HIGH"],
      [199, "HIGH"],
      [200, "CRITICAL"],
      [999, "CRITICAL"],
    ])("total=%i -> %s", (total, expected) => {
      expect(computeThreatLevel(total)).toBe(expected);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Error resilience — all failures are caught, server never crashes
  // ═══════════════════════════════════════════════════════════════════════════
  describe("error resilience — all failures are caught", () => {
    it("does not throw when getSecurityEventCountsByBucket rejects", async () => {
      console.log("\n[INPUT] getSecurityEventCountsByBucket rejects with Error('DB connection lost')");
      mockGetCountsByBucket.mockRejectedValue(new Error("DB connection lost"));
      setRawEvents([]);

      mockDateAtUTC("2025-10-01");
      await expect(fireDigestAndWait()).resolves.toBeUndefined();

      const notifyCalls = [...mockNotify.mock.calls];
      vi.restoreAllMocks();

      expect(notifyCalls).toHaveLength(0);
      console.log("[VERIFY] PASS — DB error caught, notifyOwner not called, no crash");
    });

    it("does not throw when notifyOwner rejects, and prune still runs", async () => {
      console.log("\n[INPUT] notifyOwner rejects with Error('notification service down')");
      setBucketCounts([makeBucket("AUTH_FAIL", null, 2)]);
      setRawEvents([makeEvent("203.0.113.12", "AUTH_FAIL", null)]);
      mockNotify.mockRejectedValue(new Error("notification service down"));

      mockDateAtUTC("2025-10-02");
      await expect(fireDigestAndWait()).resolves.toBeUndefined();

      const pruneCalls = [...mockPrune.mock.calls];
      vi.restoreAllMocks();

      expect(pruneCalls).toHaveLength(1);
      console.log("[VERIFY] PASS — notifyOwner rejection caught, prune still executed, no crash");
    });

    it("does not throw when getSecurityEvents rejects", async () => {
      console.log("\n[INPUT] getSecurityEvents rejects with Error('query timeout')");
      setBucketCounts([makeBucket("CSRF_BLOCK", null, 1)]);
      mockGetEvents.mockRejectedValue(new Error("query timeout"));

      mockDateAtUTC("2025-10-03");
      await expect(fireDigestAndWait()).resolves.toBeUndefined();
      vi.restoreAllMocks();

      console.log("[VERIFY] PASS — getSecurityEvents rejection caught, no crash");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // pruneSecurityEvents — retention policy (unchanged behavior)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("pruneSecurityEvents — retention policy", () => {
    it("calls pruneSecurityEvents(90) on every digest run", async () => {
      setBucketCounts([makeBucket("AUTH_FAIL", null, 1)]);
      setRawEvents([makeEvent("203.0.113.13", "AUTH_FAIL", null)]);
      mockPrune.mockResolvedValue(42);

      mockDateAtUTC("2025-10-04");
      await fireDigestAndWait();

      const pruneCalls = [...mockPrune.mock.calls];
      vi.restoreAllMocks();

      expect(pruneCalls).toHaveLength(1);
      expect(pruneCalls[0][0]).toBe(90);
      console.log("[VERIFY] PASS — pruneSecurityEvents(90) called exactly once");
    });
  });
});
