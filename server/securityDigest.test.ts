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
    setColor() {
      return this;
    }
    setTitle(v: string) {
      this.data.title = v;
      return this;
    }
    setDescription(v: string) {
      this.data.description = v;
      return this;
    }
    addFields() {
      return this;
    }
    setFooter() {
      return this;
    }
    setTimestamp() {
      return this;
    }
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
import {
  startSecurityDigestScheduler,
  computeThreatLevel,
} from "./securityDigest";

// ─── Typed mock accessors ─────────────────────────────────────────────────────
const mockGetCountsByBucket = db.getSecurityEventCountsByBucket as ReturnType<
  typeof vi.fn
>;
const mockGetEvents = db.getSecurityEvents as ReturnType<typeof vi.fn>;
const mockPrune = db.pruneSecurityEvents as ReturnType<typeof vi.fn>;
const mockInsertEvent = db.insertSecurityEvent as ReturnType<typeof vi.fn>;
const mockNotify = notification.notifyOwner as ReturnType<typeof vi.fn>;
const mockGetDiscordClient = discordBot.getDiscordClient as ReturnType<
  typeof vi.fn
>;

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

function setBucketCounts(
  buckets: Array<{ eventType: string; context: string | null; count: number }>
) {
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

  vi.spyOn(globalThis, "Date").mockImplementation(function (
    ...args: unknown[]
  ) {
    if (args.length === 0) return mockNow;
    // @ts-expect-error — allow Date constructor with args
    return new RealDate(...args);
  });
  (globalThis.Date as unknown as { now: () => number }).now = () =>
    mockNow.getTime();

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
  describe("A2 — allowlist excludes CI/owner from the threat level; Cloudflare-range IPs no longer get a free pass", () => {
    it("threat level reflects the attacker AND a Cloudflare-range IP — CI + owner excluded, Cloudflare is NOT", async () => {
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
        ...Array(30)
          .fill(null)
          .map(() => makeEvent(attackerIp, "RATE_LIMIT", "public_feed")),
        ...Array(50)
          .fill(null)
          .map(() =>
            makeEvent(ciIp, "RATE_LIMIT", "edge_origin_ingress_anomaly")
          ),
        ...Array(20)
          .fill(null)
          .map(() => makeEvent(ownerIp, "RATE_LIMIT", "global")),
        ...Array(11)
          .fill(null)
          .map(() => makeEvent(cfIp, "RATE_LIMIT", "public_feed")),
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
      const { title, content } = notifyCalls[0][0] as {
        title: string;
        content: string;
      };
      console.log(`[STATE] title: "${title}"`);

      // 111 total - 70 allowlisted (50 CI + 20 owner ONLY — CF is no longer
      // trusted on its own, CF_RANGE_ALLOWLIST_ENABLED=false) = 41.
      console.log(
        "[STATE] expected threatTotal=41 (30 attacker + 11 CF) -> MODERATE (10<=41<50)"
      );
      expect(title).toContain("[MODERATE]");
      expect(title).toContain("41 unclassified event");

      expect(content).toContain(attackerIp);
      expect(content).toContain(cfIp); // Cloudflare-range IP now counts — Critical 1 fix
      expect(content).not.toContain(ciIp);
      expect(content).not.toContain(ownerIp);

      console.log(
        "[VERIFY] PASS — threat level MODERATE(41) reflects the attacker AND the Cloudflare-range IP; " +
          "only CI/owner (exact-IP known automation) are excluded"
      );
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Important 2 (2026-08-07 review) — filterDigestMarkers() was UNTESTED.
    // Review neutralised it to a no-op passthrough and all 33 tests still
    // passed, so its correctness was unproven. The digest persists its
    // "already fired today" marker AS a security_events row, so without this
    // filter the digest's own bookkeeping would be counted as a security
    // event and could surface in Top IPs — self-inflicted noise of exactly
    // the kind this whole task exists to remove. This test drives the real
    // digest path with a marker row present and fails if the filter is
    // neutralised.
    // ═══════════════════════════════════════════════════════════════════════
    it("Important 2 — a persisted digest marker row is never counted or listed as a security event", async () => {
      console.log(
        "\n[INPUT] 12 genuine attacker events + 5 DIGEST_MARKER_DAILY bookkeeping rows"
      );

      const attackerIp = "203.0.113.77";
      const markerIp = "198.51.100.42"; // distinctive: must NOT appear anywhere in the digest
      const events = [
        ...Array(12)
          .fill(null)
          .map(() => makeEvent(attackerIp, "CSRF_BLOCK", null)),
        ...Array(5)
          .fill(null)
          .map(() =>
            makeEvent(markerIp, db.DIGEST_MARKER_DAILY_EVENT_TYPE, null)
          ),
      ];
      setBucketCounts([makeBucket("CSRF_BLOCK", null, 12)]);
      setRawEvents(events);

      mockDateAtUTC("2025-09-21");
      await fireDigestAndWait();

      const notifyCalls = [...mockNotify.mock.calls];
      vi.restoreAllMocks();

      expect(notifyCalls).toHaveLength(1);
      const { title, content } = notifyCalls[0][0] as {
        title: string;
        content: string;
      };
      console.log(`[STATE] title: "${title}"`);

      // 12 attacker events only — the 5 marker rows must not inflate the total.
      expect(title).toContain("12 unclassified event");
      expect(content).toContain(attackerIp);
      // The marker's IP must appear nowhere: not in Top IPs, not in the
      // allowlist split, not in any count.
      expect(content).not.toContain(markerIp);
      expect(content).not.toContain(db.DIGEST_MARKER_DAILY_EVENT_TYPE);

      console.log(
        "[VERIFY] PASS — marker rows excluded from the count, Top IPs and the allowlist split"
      );
    });

    it("a digest with ONLY seeded known-automation traffic (non-Cloudflare) reports CLEAN", async () => {
      console.log(
        "\n[INPUT] 60 events, ALL from a seeded automation IP (exact-IP match, not Cloudflare-range), 0 genuine attacker events"
      );

      const ciIp = "172.182.201.162"; // seeded known-automation IP (2026-08-06 incident), NOT a CF-range address

      const events = Array(60)
        .fill(null)
        .map(() =>
          makeEvent(ciIp, "RATE_LIMIT", "edge_origin_ingress_anomaly")
        );
      setBucketCounts([
        makeBucket("RATE_LIMIT", "edge_origin_ingress_anomaly", 60),
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
      console.log(
        "[VERIFY] PASS — 60 raw events, all matched by exact-IP known automation, threat level is CLEAN"
      );
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Critical 1 (2026-08-07 review) — the self-allowlisting bypass. Traced
    // by review: edge_deny records the RAW, un-vetted immediate-hop IP
    // (immediateUpstreamIp(), not resolveClientIdentity()) under context
    // "edge_origin_ingress_anomaly". An attacker who proxies through their
    // OWN free Cloudflare zone arrives from a genuine CF PoP IP, gets
    // correctly 403'd, and — before this fix — that confirmed-malicious
    // blocked event was excluded from the threat total via classifyIp()'s
    // unconditional cloudflare_edge branch. These two tests construct that
    // EXACT shape (a real CF CIDR IP on this exact context) and prove it now
    // counts. The old A2 tests above never constructed this combination —
    // CF IPs only ever appeared on non-edge contexts — which is why the bug
    // shipped and 33/33 tests still passed.
    // ═══════════════════════════════════════════════════════════════════════
    it("Critical 1 — a Cloudflare-range IP on edge_origin_ingress_anomaly (the edge_deny attack shape) counts toward the threat total", async () => {
      console.log(
        "\n[INPUT] the attacker's exact shape: a RATE_LIMIT/edge_origin_ingress_anomaly event " +
          "whose ip is inside a real Cloudflare CIDR (their own free CF zone, our secret not needed)"
      );
      const cfAttackerIp = "104.16.5.9"; // inside CF_IPV4_CIDRS 104.16.0.0/13 — a genuine CF PoP IP
      const events = Array(15)
        .fill(null)
        .map(() =>
          makeEvent(cfAttackerIp, "RATE_LIMIT", "edge_origin_ingress_anomaly")
        );
      setBucketCounts([
        makeBucket("RATE_LIMIT", "edge_origin_ingress_anomaly", 15),
      ]);
      setRawEvents(events);

      mockDateAtUTC("2025-08-30");
      await fireDigestAndWait();

      const notifyCalls = [...mockNotify.mock.calls];
      vi.restoreAllMocks();

      expect(notifyCalls).toHaveLength(1);
      const { title, content } = notifyCalls[0][0] as {
        title: string;
        content: string;
      };
      console.log(`[STATE] title: "${title}"`);
      // Before the fix: threatTotal=0 (CLEAN), the blocked attack filed under
      // "Expected Automation" and invisible in the threat total.
      expect(title).toContain("[MODERATE]"); // 10 <= 15 < 50
      expect(title).toContain("15 unclassified event");
      expect(content).toContain(cfAttackerIp);
      console.log(
        "[VERIFY] PASS — the edge_deny self-allowlisting bypass is closed: a CF-range IP on " +
          "edge_origin_ingress_anomaly is no longer excluded from the threat total"
      );
    });

    it("Critical 1 (corrected scope) — a Cloudflare-range IP on a NON-edge context (public_feed) ALSO counts, because production runs EDGE_MODE=log", async () => {
      console.log(
        "\n[INPUT] a Cloudflare-range IP on 'public_feed' — NOT the edge_origin_ingress_anomaly context. " +
          "Under EDGE_MODE=log (the verified live production mode as of this task), originLock does not " +
          "block a secret-less request, so it reaches resolveClientIdentity(), which falls back to the raw " +
          "leftmost XFF token when the secret doesn't validate — a genuine CF PoP IP for an attacker routing " +
          "through their own free Cloudflare zone. A per-context carve-out would have missed this."
      );
      const cfAttackerIp = "162.158.1.1"; // inside CF_IPV4_CIDRS 162.158.0.0/15
      const events = Array(12)
        .fill(null)
        .map(() => makeEvent(cfAttackerIp, "RATE_LIMIT", "public_feed"));
      setBucketCounts([makeBucket("RATE_LIMIT", "public_feed", 12)]);
      setRawEvents(events);

      mockDateAtUTC("2025-08-31");
      await fireDigestAndWait();

      const notifyCalls = [...mockNotify.mock.calls];
      vi.restoreAllMocks();

      expect(notifyCalls).toHaveLength(1);
      const { title, content } = notifyCalls[0][0] as {
        title: string;
        content: string;
      };
      console.log(`[STATE] title: "${title}"`);
      expect(title).toContain("[MODERATE]"); // 10 <= 12 < 50
      expect(title).toContain("12 unclassified event");
      expect(content).toContain(cfAttackerIp);
      console.log(
        "[VERIFY] PASS — a Cloudflare-range IP on a non-edge context also counts toward the threat total; " +
          "the fix is a global rule (CF_RANGE_ALLOWLIST_ENABLED=false), not a single-context special case"
      );
    });

    it("owner-configured allowlist (SECURITY_DIGEST_ALLOWLIST_IPS) excludes an extra IP", async () => {
      console.log(
        "\n[INPUT] one event from an IP set via SECURITY_DIGEST_ALLOWLIST_IPS env var"
      );
      const extraIp = "198.51.100.7"; // TEST-NET-2, not seeded by default
      process.env.SECURITY_DIGEST_ALLOWLIST_IPS = extraIp;

      try {
        const events = Array(5)
          .fill(null)
          .map(() => makeEvent(extraIp, "RATE_LIMIT", "global"));
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
        console.log(
          "[VERIFY] PASS — SECURITY_DIGEST_ALLOWLIST_IPS entry excluded from threat level"
        );
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
      console.log(
        "\n[INPUT] RATE_LIMIT events across 3 different limitType contexts, all from a single attacker"
      );
      const attackerIp = "203.0.113.99";
      const events = [
        ...Array(12)
          .fill(null)
          .map(() => makeEvent(attackerIp, "RATE_LIMIT", "public_feed")),
        ...Array(7)
          .fill(null)
          .map(() => makeEvent(attackerIp, "RATE_LIMIT", "auth")),
        ...Array(3)
          .fill(null)
          .map(() => makeEvent(attackerIp, "RATE_LIMIT", "waitlist_submit")),
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
      console.log(
        "[STATE] content (excerpt):\n" +
          content
            .split("\n")
            .filter(l => /public_feed|auth|waitlist_submit/.test(l))
            .join("\n")
      );

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
      console.log(
        "[VERIFY] PASS — Rate Limit Triggers broken out per limitType context, in addition to the accurate total"
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // A3 — counts labeled as a deduped sample, dedup window stated
  // ═══════════════════════════════════════════════════════════════════════════
  describe("A3 — counts labeled as a deduped sample", () => {
    it("notifyOwner content states the dedup window and labels counts as a sample", async () => {
      console.log(
        "\n[INPUT] a normal digest run — checking the honesty labeling in the body"
      );
      setBucketCounts([makeBucket("AUTH_FAIL", null, 4)]);
      setRawEvents(
        Array(4)
          .fill(null)
          .map(() => makeEvent("203.0.113.10", "AUTH_FAIL", null))
      );

      mockDateAtUTC("2025-09-05");
      await fireDigestAndWait();

      const notifyCalls = [...mockNotify.mock.calls];
      vi.restoreAllMocks();

      expect(notifyCalls).toHaveLength(1);
      const { content } = notifyCalls[0][0] as { content: string };
      console.log(
        "[STATE] content window/labeling lines:\n" +
          content
            .split("\n")
            .filter(l => /deduped|60s/i.test(l))
            .join("\n")
      );

      expect(content).toMatch(/deduped sample/i);
      expect(content).toContain("60s"); // dedup window, matches RATE_LIMIT_DEDUP_WINDOW_SEC
      console.log(
        "[VERIFY] PASS — content labels counts as a deduped sample and states the 60s window"
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // B1 — notifyOwner's `false` must NEVER escalate (2026-08-07 review, Crit 2)
  //
  // These assertions were INVERTED, not deleted. The original pair asserted
  // that a `false` from notifyOwner posts an escalation embed. But
  // notifyOwner() is a documented PERMANENT no-op that always returns false
  // (server/_core/notification.ts), so that behaviour fired a CRITICAL
  // Discord alert on every single scheduled run, forever — a guaranteed
  // false alarm, which is the exact defect class this digest work exists to
  // remove. Deleting the tests would have left the new contract untested,
  // so they now assert the opposite: exactly ONE embed (the digest itself),
  // never an escalation, whichever value notifyOwner returns.
  // ═══════════════════════════════════════════════════════════════════════════
  describe("B1 — notifyOwner's false is never escalated", () => {
    it("posts ONLY the digest embed when notifyOwner returns false", async () => {
      console.log(
        "\n[INPUT] notifyOwner returns false (its permanent, by-design state)"
      );
      const fakeChannel = new TextChannel() as unknown as {
        send: ReturnType<typeof vi.fn>;
      };
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
      const titles = sendCalls.map(c => {
        const embed = (c[0] as { embeds: Array<{ data: { title?: string } }> })
          .embeds[0];
        return embed.data.title ?? "";
      });
      console.log(`[STATE] embed titles sent: ${JSON.stringify(titles)}`);
      // Exactly one embed: the digest. A second embed here would mean the
      // escalation is back, i.e. a CRITICAL alert on every scheduled run.
      expect(sendCalls.length).toBe(1);
      expect(titles.some(t => t.includes("Daily Security Digest"))).toBe(true);
      expect(titles.some(t => t.includes("In-App Notification Failed"))).toBe(
        false
      );
      console.log(
        "[VERIFY] PASS — notifyOwner's false produced no escalation; only the digest embed was sent"
      );
    });

    it("does NOT escalate when notifyOwner succeeds", async () => {
      console.log("\n[INPUT] notifyOwner returns true (normal delivery)");
      const fakeChannel = new TextChannel() as unknown as {
        send: ReturnType<typeof vi.fn>;
      };
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
      const embed = (
        sendCalls[0][0] as { embeds: Array<{ data: { title?: string } }> }
      ).embeds[0];
      expect(embed.data.title).toContain("Daily Security Digest");
      console.log(
        "[VERIFY] PASS — no escalation embed sent when notifyOwner succeeds"
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // B2 — widened fire window + restart-safe persisted marker
  // ═══════════════════════════════════════════════════════════════════════════
  describe("B2 — widened fire window and restart-safe persistence", () => {
    it("fires at UTC minute=5 (inside the widened 10-minute window, not just minute=0)", async () => {
      console.log(
        "\n[INPUT] digest tick at 13:05 UTC (not 13:00) — should still fire"
      );
      setBucketCounts([]);
      setRawEvents([]); // marker check also returns [] via default markerRows

      mockDateAtUTC("2025-09-08", 13, 5);
      await fireDigestAndWait();

      const notifyCalls = [...mockNotify.mock.calls];
      vi.restoreAllMocks();

      console.log(
        `[STATE] notifyOwner call count at minute=5: ${notifyCalls.length}`
      );
      expect(notifyCalls).toHaveLength(1);
      console.log(
        "[VERIFY] PASS — digest fired at minute=5, proving the window was widened past minute=0"
      );
    });

    it("does NOT fire at UTC minute=10 (just outside the widened window)", async () => {
      console.log(
        "\n[INPUT] digest tick at 13:10 UTC — outside [13:00, 13:10)"
      );
      setBucketCounts([]);
      setRawEvents([]);

      mockDateAtUTC("2025-09-09", 13, 10);
      await fireDigestAndWait();

      const notifyCalls = [...mockNotify.mock.calls];
      vi.restoreAllMocks();

      console.log(
        `[STATE] notifyOwner call count at minute=10: ${notifyCalls.length}`
      );
      expect(notifyCalls).toHaveLength(0);
      console.log(
        "[VERIFY] PASS — digest did not fire at minute=10, window's upper bound is exclusive"
      );
    });

    it("a persisted marker for today prevents a duplicate fire (simulated restart mid-window)", async () => {
      console.log(
        "\n[INPUT] simulated restart: in-memory lastDigestDateUTC is fresh (new test date), but a " +
          "persisted DIGEST_MARKER_DAILY row for TODAY already exists — the digest must NOT fire again"
      );
      const today = "2025-09-10";
      // Marker check call returns a row whose context === today's date.
      setRawEvents(
        [],
        [makeEvent("system", DIGEST_MARKER_DAILY_EVENT_TYPE, today)]
      );
      setBucketCounts([]);

      mockDateAtUTC(today, 13, 4); // inside the window, restart-like mid-window tick

      await fireDigestAndWait();

      const notifyCalls = [...mockNotify.mock.calls];
      const pruneCalls = [...mockPrune.mock.calls];
      vi.restoreAllMocks();

      console.log(
        `[STATE] notifyOwner calls: ${notifyCalls.length} | pruneSecurityEvents calls: ${pruneCalls.length}`
      );
      expect(notifyCalls).toHaveLength(0);
      expect(pruneCalls).toHaveLength(0); // proves runSecurityDigest() never even started
      console.log(
        "[VERIFY] PASS — persisted marker blocked a duplicate fire after a simulated restart"
      );
    });

    it("persists a marker row via insertSecurityEvent after a successful fire", async () => {
      console.log(
        "\n[INPUT] a normal digest run — should persist a DIGEST_MARKER_DAILY row on completion"
      );
      setBucketCounts([]);
      setRawEvents([]);

      mockDateAtUTC("2025-09-11");
      await fireDigestAndWait();

      const insertCalls = [...mockInsertEvent.mock.calls];
      vi.restoreAllMocks();

      const markerCalls = insertCalls.filter(
        c =>
          (c[0] as { eventType: string }).eventType ===
          DIGEST_MARKER_DAILY_EVENT_TYPE
      );
      console.log(
        `[STATE] insertSecurityEvent(DIGEST_MARKER_DAILY) calls: ${markerCalls.length}`
      );
      expect(markerCalls).toHaveLength(1);
      expect((markerCalls[0][0] as { context: string }).context).toBe(
        "2025-09-11"
      );
      console.log(
        "[VERIFY] PASS — digest marker persisted with today's date after a successful fire"
      );
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
      console.log(
        "\n[INPUT] getSecurityEventCountsByBucket rejects with Error('DB connection lost')"
      );
      mockGetCountsByBucket.mockRejectedValue(new Error("DB connection lost"));
      setRawEvents([]);

      mockDateAtUTC("2025-10-01");
      await expect(fireDigestAndWait()).resolves.toBeUndefined();

      const notifyCalls = [...mockNotify.mock.calls];
      vi.restoreAllMocks();

      expect(notifyCalls).toHaveLength(0);
      console.log(
        "[VERIFY] PASS — DB error caught, notifyOwner not called, no crash"
      );
    });

    it("does not throw when notifyOwner rejects, and prune still runs", async () => {
      console.log(
        "\n[INPUT] notifyOwner rejects with Error('notification service down')"
      );
      setBucketCounts([makeBucket("AUTH_FAIL", null, 2)]);
      setRawEvents([makeEvent("203.0.113.12", "AUTH_FAIL", null)]);
      mockNotify.mockRejectedValue(new Error("notification service down"));

      mockDateAtUTC("2025-10-02");
      await expect(fireDigestAndWait()).resolves.toBeUndefined();

      const pruneCalls = [...mockPrune.mock.calls];
      vi.restoreAllMocks();

      expect(pruneCalls).toHaveLength(1);
      console.log(
        "[VERIFY] PASS — notifyOwner rejection caught, prune still executed, no crash"
      );
    });

    it("does not throw when getSecurityEvents rejects", async () => {
      console.log(
        "\n[INPUT] getSecurityEvents rejects with Error('query timeout')"
      );
      setBucketCounts([makeBucket("CSRF_BLOCK", null, 1)]);
      mockGetEvents.mockRejectedValue(new Error("query timeout"));

      mockDateAtUTC("2025-10-03");
      await expect(fireDigestAndWait()).resolves.toBeUndefined();
      vi.restoreAllMocks();

      console.log(
        "[VERIFY] PASS — getSecurityEvents rejection caught, no crash"
      );
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
      console.log(
        "[VERIFY] PASS — pruneSecurityEvents(90) called exactly once"
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // C1 — log injection via the Discord send-failure reason
  //
  // The reason string is built from the thrown Error's message, which is
  // attacker-reachable: Discord's API echoes request content back in error
  // text. An unsanitized CR/LF in that message forges whole lines in the
  // `[TAG] [LEVEL]` stream the ops runbooks parse — and the same string is
  // persisted into the digest marker and replayed on the next digest. The
  // choke point is logSafe() where lastErrMsg is computed.
  // ═══════════════════════════════════════════════════════════════════════════
  describe("C1 — a CRLF-bearing send error cannot forge log lines", () => {
    it("escapes newlines in the failure reason persisted to the digest marker", async () => {
      // A real newline plus a convincing forged CRITICAL line.
      const forged =
        "upstream rejected\n[SecurityDigest] [CRITICAL] [DIGEST_DELIVERY_FAILED] forged-by-attacker";
      console.log(
        "\n[INPUT] channel.send() rejects with an Error carrying a raw newline + a fake CRITICAL line"
      );

      const fakeChannel = new TextChannel() as unknown as {
        send: ReturnType<typeof vi.fn>;
      };
      fakeChannel.send.mockRejectedValue(new Error(forged));
      const fakeClient = {
        isReady: () => true,
        channels: { fetch: vi.fn().mockResolvedValue(fakeChannel) },
      };
      mockGetDiscordClient.mockReturnValue(fakeClient);
      setBucketCounts([makeBucket("CSRF_BLOCK", null, 1)]);
      setRawEvents([makeEvent("203.0.113.77", "CSRF_BLOCK", null)]);

      mockDateAtUTC("2025-11-02");
      await fireDigestAndWait();

      const insertCalls = [...mockInsertEvent.mock.calls];
      vi.restoreAllMocks();

      // The marker row carries the failure reason in its context field.
      const markerContexts = insertCalls
        .map(c => c[0] as { eventType?: string; context?: string })
        .filter(a => a?.eventType === DIGEST_MARKER_DAILY_EVENT_TYPE)
        .map(a => a.context ?? "");
      console.log(`[STATE] marker rows persisted: ${markerContexts.length}`);

      const withReason = markerContexts.find(c =>
        c.includes("forged-by-attacker")
      );
      expect(withReason).toBeDefined();
      console.log(
        `[STATE] persisted reason contains a raw newline: ${/[\r\n]/.test(withReason!)}`
      );

      // The whole point: the payload survived as DATA, escaped, on one line.
      expect(withReason).not.toMatch(/[\r\n]/);
      expect(withReason).toContain("\\n");
      expect(withReason).toContain("forged-by-attacker");
      console.log(
        "[VERIFY] PASS — newline escaped to \\n; the forged CRITICAL line cannot stand alone"
      );
    });
  });
});
