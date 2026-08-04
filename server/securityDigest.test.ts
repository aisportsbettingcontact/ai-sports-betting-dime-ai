/**
 * securityDigest.test.ts
 *
 * Unit tests for the security digest module (securityDigest.ts).
 *
 * ── Architecture ──────────────────────────────────────────────────────────────
 * securityDigest.ts has three layers:
 *   1. topIpsByCount()  — pure aggregation helper (private, tested indirectly)
 *   2. runSecurityDigest() — async orchestrator (private, tested via scheduler)
 *   3. startSecurityDigestScheduler() — exported, fires runSecurityDigest() when
 *      UTC time matches 13:00 and today's digest hasn't run yet.
 *
 * ── Test strategy ─────────────────────────────────────────────────────────────
 * All external dependencies (db helpers, notifyOwner) are vi.mock'd.
 * Each test:
 *   1. Sets up mock return values
 *   2. Mocks Date to return 13:00 UTC on a UNIQUE calendar date per test
 *      (unique date prevents lastDigestDateUTC dedup across tests in the same
 *      module instance — Vitest caches modules between tests in the same file)
 *   3. Calls startSecurityDigestScheduler() — triggers immediate fire
 *   4. Awaits 100ms for async digest to complete
 *   5. Captures mock.calls into a local variable BEFORE vi.restoreAllMocks()
 *      (restoring wipes call history — this is the critical ordering rule)
 *   6. Asserts on captured calls
 *   7. Calls vi.restoreAllMocks() to undo the Date spy
 *
 * ── Critical invariants ───────────────────────────────────────────────────────
 * - ALWAYS capture mock.calls BEFORE vi.restoreAllMocks()
 * - Each test MUST use a unique ISO date to avoid lastDigestDateUTC dedup
 * - vi.resetAllMocks() in beforeEach resets call counts but NOT module-level
 *   state (lastDigestDateUTC persists across tests in the same module instance)
 *
 * All log lines follow [INPUT]/[STEP]/[STATE]/[OUTPUT]/[VERIFY] format.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock external dependencies (vi.mock is hoisted before any import) ────────
vi.mock("./db", () => ({
  getSecurityEventCounts: vi.fn(),
  getSecurityEvents: vi.fn(),
  pruneSecurityEvents: vi.fn(),
}));

vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn(),
}));

// ─── Import mocked modules and the module under test ─────────────────────────
import * as db from "./db";
import * as notification from "./_core/notification";
import { startSecurityDigestScheduler } from "./securityDigest";

// ─── Typed mock accessors ─────────────────────────────────────────────────────
const mockGetCounts = db.getSecurityEventCounts as ReturnType<typeof vi.fn>;
const mockGetEvents = db.getSecurityEvents as ReturnType<typeof vi.fn>;
const mockPrune = db.pruneSecurityEvents as ReturnType<typeof vi.fn>;
const mockNotify = notification.notifyOwner as ReturnType<typeof vi.fn>;

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Build a minimal event-like object with the given IP. */
function makeEvent(ip: string | null) {
  return {
    id: Math.floor(Math.random() * 1_000_000),
    eventType: "CSRF_BLOCK" as const,
    ip,
    blockedOrigin: null,
    trpcPath: "/api/trpc/test",
    httpMethod: "POST",
    userAgent: null,
    context: null,
    occurredAt: Date.now(),
  };
}

/** Build a counts object from individual event type counts. */
function makeCounts(csrf = 0, rate = 0, auth = 0) {
  return { CSRF_BLOCK: csrf, RATE_LIMIT: rate, AUTH_FAIL: auth, total: csrf + rate + auth };
}

/**
 * Mock globalThis.Date to return a fixed 13:00 UTC datetime on the given ISO date.
 * Also mocks Date.now() to return the same fixed timestamp.
 *
 * Returns the mocked Date instance so tests can reference the exact timestamp.
 *
 * CRITICAL: Call vi.restoreAllMocks() AFTER reading mock.calls to undo this spy.
 *
 * @param isoDate  "YYYY-MM-DD" — MUST be unique per test to avoid lastDigestDateUTC dedup
 */
function mockDateAt1300UTC(isoDate: string): Date {
  const mockNow = new Date(`${isoDate}T13:00:00.000Z`);
  const RealDate = globalThis.Date;

  // vitest 4: `new Date()` through the spy requires a constructable
  // implementation — arrows lost `new` support. `function` + explicit return
  // preserves both call and construct paths.
  vi.spyOn(globalThis, "Date").mockImplementation(function (...args: unknown[]) {
    if (args.length === 0) return mockNow;
    // @ts-expect-error — allow Date constructor with args
    return new RealDate(...args);
  });
  // Mock Date.now() used in WINDOW_MS calculation
  (globalThis.Date as unknown as { now: () => number }).now = () => mockNow.getTime();

  return mockNow;
}

/**
 * Fire the scheduler and wait for the async digest to complete.
 * The scheduler fires immediately when hour=13, minute=0, and today's digest
 * hasn't run yet. We await 100ms for runSecurityDigest() to finish.
 */
async function fireDigestAndWait(): Promise<void> {
  startSecurityDigestScheduler();
  await new Promise(resolve => setTimeout(resolve, 100));
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.resetAllMocks();
  // Default implementations — individual tests override as needed
  mockGetCounts.mockResolvedValue(makeCounts(0, 0, 0));
  mockGetEvents.mockResolvedValue([]);
  mockPrune.mockResolvedValue(0);
  mockNotify.mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Test suite ───────────────────────────────────────────────────────────────
describe("securityDigest", () => {

  // ───────────────────────────────────────────────────────────────────────────
  // GROUP 1: topIpsByCount — IP aggregation and ranking
  // ───────────────────────────────────────────────────────────────────────────
  describe("topIpsByCount — IP aggregation and ranking", () => {

    it("ranks IPs by descending event count", async () => {
      console.log("\n[INPUT] 10 events: 4×1.1.1.1, 3×2.2.2.2, 2×3.3.3.3, 1×4.4.4.4");
      console.log("[INPUT] Expected: IPs appear in content in descending order");

      const events = [
        ...Array(4).fill(null).map(() => makeEvent("1.1.1.1")),
        ...Array(3).fill(null).map(() => makeEvent("2.2.2.2")),
        ...Array(2).fill(null).map(() => makeEvent("3.3.3.3")),
        ...Array(1).fill(null).map(() => makeEvent("4.4.4.4")),
      ];

      mockGetCounts.mockResolvedValue(makeCounts(4, 3, 3));
      mockGetEvents.mockResolvedValue(events);
      mockPrune.mockResolvedValue(0);
      mockNotify.mockResolvedValue(true);

      mockDateAt1300UTC("2025-01-15");
      await fireDigestAndWait();

      // Capture BEFORE restoreAllMocks
      const notifyCalls = [...mockNotify.mock.calls];
      vi.restoreAllMocks();

      console.log("[STATE] notifyOwner call count:", notifyCalls.length);
      expect(notifyCalls).toHaveLength(1);

      const content: string = notifyCalls[0][0].content;
      console.log("[STATE] Content IP section:\n" + content.split("\n").filter(l => /\d+\.\d+\.\d+\.\d+/.test(l)).join("\n"));

      // All 4 IPs present (limit=5, only 4 unique IPs)
      expect(content).toContain("1.1.1.1");
      expect(content).toContain("2.2.2.2");
      expect(content).toContain("3.3.3.3");
      expect(content).toContain("4.4.4.4");

      // Ordering: 1.1.1.1 before 2.2.2.2 before 3.3.3.3
      const pos1 = content.indexOf("1.1.1.1");
      const pos2 = content.indexOf("2.2.2.2");
      const pos3 = content.indexOf("3.3.3.3");
      expect(pos1).toBeLessThan(pos2);
      expect(pos2).toBeLessThan(pos3);

      console.log("[VERIFY] PASS — IPs ranked: 1.1.1.1(4) > 2.2.2.2(3) > 3.3.3.3(2) > 4.4.4.4(1)");
    });

    it("maps null IPs to 'unknown'", async () => {
      console.log("\n[INPUT] 3 events with null IP, 1 event with '5.5.5.5'");
      console.log("[INPUT] Expected: content contains 'unknown'");

      const events = [
        ...Array(3).fill(null).map(() => makeEvent(null)),
        makeEvent("5.5.5.5"),
      ];

      mockGetCounts.mockResolvedValue(makeCounts(2, 1, 1));
      mockGetEvents.mockResolvedValue(events);

      mockDateAt1300UTC("2025-01-16");
      await fireDigestAndWait();

      const notifyCalls = [...mockNotify.mock.calls];
      vi.restoreAllMocks();

      console.log("[STATE] notifyOwner call count:", notifyCalls.length);
      expect(notifyCalls).toHaveLength(1);

      const content: string = notifyCalls[0][0].content;
      expect(content).toContain("unknown");
      console.log("[STATE] 'unknown' in content:", content.includes("unknown"));
      console.log("[VERIFY] PASS — null IPs correctly mapped to 'unknown'");
    });

    it("shows 'No events recorded.' when event list is empty", async () => {
      console.log("\n[INPUT] 0 events, all counts zero");
      console.log("[INPUT] Expected: content contains 'No events recorded.'");

      mockGetCounts.mockResolvedValue(makeCounts(0, 0, 0));
      mockGetEvents.mockResolvedValue([]);

      mockDateAt1300UTC("2025-01-17");
      await fireDigestAndWait();

      const notifyCalls = [...mockNotify.mock.calls];
      vi.restoreAllMocks();

      expect(notifyCalls).toHaveLength(1);
      const content: string = notifyCalls[0][0].content;
      expect(content).toContain("No events recorded.");
      console.log("[VERIFY] PASS — empty event list produces 'No events recorded.'");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GROUP 2: Threat level — all boundary conditions
  // ───────────────────────────────────────────────────────────────────────────
  describe("threat level — boundary conditions", () => {
    const THREAT_CASES: Array<{ total: number; expected: string; isoDate: string }> = [
      { total: 0,   expected: "CLEAN",    isoDate: "2025-02-01" },
      { total: 1,   expected: "LOW",      isoDate: "2025-02-02" },
      { total: 9,   expected: "LOW",      isoDate: "2025-02-03" },
      { total: 10,  expected: "MODERATE", isoDate: "2025-02-04" },
      { total: 49,  expected: "MODERATE", isoDate: "2025-02-05" },
      { total: 50,  expected: "HIGH",     isoDate: "2025-02-06" },
      { total: 199, expected: "HIGH",     isoDate: "2025-02-07" },
      { total: 200, expected: "CRITICAL", isoDate: "2025-02-08" },
      { total: 999, expected: "CRITICAL", isoDate: "2025-02-09" },
    ];

    for (const { total, expected, isoDate } of THREAT_CASES) {
      it(`total=${total} → [${expected}]`, async () => {
        console.log(`\n[INPUT] total=${total} | isoDate=${isoDate} | expected=[${expected}]`);

        const csrf = Math.floor(total / 3);
        const rate = Math.floor(total / 3);
        const auth = total - csrf - rate;

        mockGetCounts.mockResolvedValue({ CSRF_BLOCK: csrf, RATE_LIMIT: rate, AUTH_FAIL: auth, total });
        mockGetEvents.mockResolvedValue([]);
        mockPrune.mockResolvedValue(0);
        mockNotify.mockResolvedValue(true);

        mockDateAt1300UTC(isoDate);
        await fireDigestAndWait();

        const notifyCalls = [...mockNotify.mock.calls];
        vi.restoreAllMocks();

        console.log("[STATE] notifyOwner call count:", notifyCalls.length);
        expect(notifyCalls).toHaveLength(1);

        const title: string = notifyCalls[0][0].title;
        console.log(`[STATE] title: "${title}"`);
        expect(title).toContain(`[${expected}]`);
        console.log(`[VERIFY] PASS — title contains "[${expected}]" for total=${total}`);
      });
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GROUP 3: Notification title — pluralization
  // ───────────────────────────────────────────────────────────────────────────
  describe("notification title — pluralization", () => {

    it("uses singular 'event' for total=1", async () => {
      console.log("\n[INPUT] total=1 → expect '1 event in 24h' (singular)");

      mockGetCounts.mockResolvedValue(makeCounts(1, 0, 0));
      mockGetEvents.mockResolvedValue([makeEvent("9.9.9.9")]);

      mockDateAt1300UTC("2025-03-01");
      await fireDigestAndWait();

      const notifyCalls = [...mockNotify.mock.calls];
      vi.restoreAllMocks();

      expect(notifyCalls).toHaveLength(1);
      const title: string = notifyCalls[0][0].title;
      console.log(`[STATE] title: "${title}"`);
      expect(title).toContain("1 event in 24h");
      expect(title).not.toContain("1 events");
      console.log("[VERIFY] PASS — singular 'event' used for total=1");
    });

    it("uses plural 'events' for total=5", async () => {
      console.log("\n[INPUT] total=5 → expect '5 events in 24h' (plural)");

      mockGetCounts.mockResolvedValue(makeCounts(2, 2, 1));
      mockGetEvents.mockResolvedValue(Array(5).fill(null).map(() => makeEvent("8.8.8.8")));

      mockDateAt1300UTC("2025-03-02");
      await fireDigestAndWait();

      const notifyCalls = [...mockNotify.mock.calls];
      vi.restoreAllMocks();

      expect(notifyCalls).toHaveLength(1);
      const title: string = notifyCalls[0][0].title;
      console.log(`[STATE] title: "${title}"`);
      expect(title).toContain("5 events in 24h");
      console.log("[VERIFY] PASS — plural 'events' used for total=5");
    });

    it("uses plural 'events' for total=0", async () => {
      console.log("\n[INPUT] total=0 → expect '0 events in 24h' (plural, 0 is not 1)");

      mockGetCounts.mockResolvedValue(makeCounts(0, 0, 0));
      mockGetEvents.mockResolvedValue([]);

      mockDateAt1300UTC("2025-03-03");
      await fireDigestAndWait();

      const notifyCalls = [...mockNotify.mock.calls];
      vi.restoreAllMocks();

      expect(notifyCalls).toHaveLength(1);
      const title: string = notifyCalls[0][0].title;
      console.log(`[STATE] title: "${title}"`);
      expect(title).toContain("0 events in 24h");
      console.log("[VERIFY] PASS — plural 'events' used for total=0");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GROUP 4: pruneSecurityEvents — retention policy
  // ───────────────────────────────────────────────────────────────────────────
  describe("pruneSecurityEvents — retention policy", () => {

    it("calls pruneSecurityEvents(90) on every digest run", async () => {
      console.log("\n[INPUT] Normal digest run");
      console.log("[INPUT] Expected: pruneSecurityEvents called exactly once with arg=90");

      mockGetCounts.mockResolvedValue(makeCounts(1, 1, 1));
      mockGetEvents.mockResolvedValue([makeEvent("7.7.7.7")]);
      mockPrune.mockResolvedValue(42);

      mockDateAt1300UTC("2025-04-01");
      await fireDigestAndWait();

      const pruneCalls = [...mockPrune.mock.calls];
      vi.restoreAllMocks();

      console.log("[STATE] pruneSecurityEvents call args:", JSON.stringify(pruneCalls));
      expect(pruneCalls).toHaveLength(1);
      expect(pruneCalls[0][0]).toBe(90);
      console.log("[VERIFY] PASS — pruneSecurityEvents(90) called exactly once");
    });

    it("prune is called even when notifyOwner returns false", async () => {
      console.log("\n[INPUT] notifyOwner returns false (service unavailable, not throwing)");
      console.log("[INPUT] Expected: pruneSecurityEvents still called with 90");

      mockGetCounts.mockResolvedValue(makeCounts(2, 1, 0));
      mockGetEvents.mockResolvedValue([makeEvent("6.6.6.6")]);
      mockPrune.mockResolvedValue(5);
      mockNotify.mockResolvedValue(false);

      mockDateAt1300UTC("2025-04-02");
      await fireDigestAndWait();

      const pruneCalls = [...mockPrune.mock.calls];
      vi.restoreAllMocks();

      console.log("[STATE] pruneSecurityEvents call count:", pruneCalls.length);
      expect(pruneCalls).toHaveLength(1);
      expect(pruneCalls[0][0]).toBe(90);
      console.log("[VERIFY] PASS — prune called even when notifyOwner returns false");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GROUP 5: Error resilience — all failures are caught, server never crashes
  // ───────────────────────────────────────────────────────────────────────────
  describe("error resilience — all failures are caught", () => {

    it("does not throw when getSecurityEventCounts rejects", async () => {
      console.log("\n[INPUT] getSecurityEventCounts rejects with Error('DB connection lost')");
      console.log("[INPUT] Expected: no unhandled rejection, notifyOwner NOT called");

      mockGetCounts.mockRejectedValue(new Error("DB connection lost"));
      mockGetEvents.mockResolvedValue([]);

      mockDateAt1300UTC("2025-05-01");
      await expect(fireDigestAndWait()).resolves.toBeUndefined();

      const notifyCalls = [...mockNotify.mock.calls];
      vi.restoreAllMocks();

      console.log("[STATE] notifyOwner call count:", notifyCalls.length);
      expect(notifyCalls).toHaveLength(0);
      console.log("[VERIFY] PASS — DB error caught, notifyOwner not called, no crash");
    });

    it("does not throw when notifyOwner rejects", async () => {
      console.log("\n[INPUT] notifyOwner rejects with Error('notification service down')");
      console.log("[INPUT] Expected: no crash, pruneSecurityEvents still called");

      mockGetCounts.mockResolvedValue(makeCounts(5, 3, 2));
      mockGetEvents.mockResolvedValue([makeEvent("6.6.6.6")]);
      mockPrune.mockResolvedValue(0);
      mockNotify.mockRejectedValue(new Error("notification service down"));

      mockDateAt1300UTC("2025-05-02");
      await expect(fireDigestAndWait()).resolves.toBeUndefined();

      const pruneCalls = [...mockPrune.mock.calls];
      vi.restoreAllMocks();

      console.log("[STATE] pruneSecurityEvents call count:", pruneCalls.length);
      expect(pruneCalls).toHaveLength(1);
      console.log("[VERIFY] PASS — notifyOwner rejection caught, prune still executed, no crash");
    });

    it("does not throw when getSecurityEvents rejects", async () => {
      console.log("\n[INPUT] getSecurityEvents rejects with Error('query timeout')");
      console.log("[INPUT] Expected: no crash — error propagates to outer catch");

      mockGetCounts.mockResolvedValue(makeCounts(3, 2, 1));
      mockGetEvents.mockRejectedValue(new Error("query timeout"));

      mockDateAt1300UTC("2025-05-03");
      await expect(fireDigestAndWait()).resolves.toBeUndefined();
      vi.restoreAllMocks();

      console.log("[VERIFY] PASS — getSecurityEvents rejection caught, no crash");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GROUP 6: Notification content — all required sections present
  // ───────────────────────────────────────────────────────────────────────────
  describe("notification content — required sections", () => {

    it("content includes all required sections with correct values", async () => {
      console.log("\n[INPUT] counts: CSRF=5, RATE=3, AUTH=2 (total=10)");
      console.log("[INPUT] Expected: all content sections present with correct values");

      mockGetCounts.mockResolvedValue(makeCounts(5, 3, 2));
      mockGetEvents.mockResolvedValue([
        ...Array(5).fill(null).map(() => makeEvent("10.0.0.1")),
        ...Array(3).fill(null).map(() => makeEvent("10.0.0.2")),
        ...Array(2).fill(null).map(() => makeEvent("10.0.0.3")),
      ]);
      mockPrune.mockResolvedValue(7);
      mockNotify.mockResolvedValue(true);

      mockDateAt1300UTC("2025-06-01");
      await fireDigestAndWait();

      const notifyCalls = [...mockNotify.mock.calls];
      vi.restoreAllMocks();

      expect(notifyCalls).toHaveLength(1);
      const { title, content } = notifyCalls[0][0] as { title: string; content: string };

      console.log(`[STATE] title: "${title}"`);
      console.log("[STATE] content (first 400 chars):\n" + content.slice(0, 400));

      // Title assertions
      expect(title).toContain("[MODERATE]");       // total=10 → MODERATE
      expect(title).toContain("10 events in 24h");

      // Content section assertions
      expect(content).toContain("Daily Security Digest");
      expect(content).toContain("Threat Level: MODERATE");
      expect(content).toContain("Event Counts (Last 24 Hours):");
      expect(content).toContain("CSRF Block:   5");
      expect(content).toContain("Rate Limit:   3");
      expect(content).toContain("Auth Failure: 2");
      expect(content).toContain("Total:        10");
      expect(content).toContain("Top 5 IPs by Event Count:");
      expect(content).toContain("10.0.0.1");
      expect(content).toContain("Window:");
      expect(content).toContain("Retention: events older than 90 days pruned");

      console.log("[VERIFY] PASS — title: [MODERATE] + '10 events in 24h'");
      console.log("[VERIFY] PASS — content: all 9 required sections present");
      console.log("[VERIFY] PASS — event counts: CSRF=5 RATE=3 AUTH=2 total=10");
    });

    it("Window line contains ISO-format timestamps", async () => {
      console.log("\n[INPUT] Digest run at 2025-07-01T13:00:00Z");
      console.log("[INPUT] Expected: Window line contains ISO timestamps (YYYY-MM-DDTHH:MM:SS)");

      mockGetCounts.mockResolvedValue(makeCounts(1, 0, 0));
      mockGetEvents.mockResolvedValue([makeEvent("1.2.3.4")]);

      mockDateAt1300UTC("2025-07-01");
      await fireDigestAndWait();

      const notifyCalls = [...mockNotify.mock.calls];
      vi.restoreAllMocks();

      expect(notifyCalls).toHaveLength(1);
      const content: string = notifyCalls[0][0].content;
      const windowLine = content.split("\n").find(l => l.startsWith("Window:"));
      console.log(`[STATE] Window line: "${windowLine}"`);
      expect(windowLine).toBeDefined();
      expect(windowLine).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      console.log("[VERIFY] PASS — Window line contains ISO timestamp format");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GROUP 7: getSecurityEvents called with correct 24h window
  // ───────────────────────────────────────────────────────────────────────────
  describe("getSecurityEvents — correct window and limit", () => {

    it("passes sinceMs = now - 24h and limit=500", async () => {
      console.log("\n[INPUT] Digest run at 2025-08-01T13:00:00Z");
      console.log("[INPUT] Expected: getSecurityEvents({ sinceMs: now-86400000, limit: 500 })");

      mockGetCounts.mockResolvedValue(makeCounts(0, 0, 0));
      mockGetEvents.mockResolvedValue([]);

      const mockNow = mockDateAt1300UTC("2025-08-01");
      await fireDigestAndWait();

      const eventCalls = [...mockGetEvents.mock.calls];
      vi.restoreAllMocks();

      console.log("[STATE] getSecurityEvents call args:", JSON.stringify(eventCalls));
      expect(eventCalls).toHaveLength(1);

      const { sinceMs, limit } = eventCalls[0][0] as { sinceMs: number; limit: number };
      const expectedSince = mockNow.getTime() - 24 * 60 * 60 * 1000;

      console.log(`[STATE] sinceMs=${sinceMs} | expected=${expectedSince} | diff=${sinceMs - expectedSince}ms`);
      // Allow ±10ms tolerance for execution overhead
      expect(Math.abs(sinceMs - expectedSince)).toBeLessThan(10);
      expect(limit).toBe(500);
      console.log("[VERIFY] PASS — sinceMs within 10ms of now-86400000, limit=500");
    });
  });
});
