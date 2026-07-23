/**
 * eventIngestion.test.ts — unit tests for the analytics ingestion seam.
 *
 * NO REAL DB. These tests exercise:
 *   1. PURE validation (`parseTrackInput`):
 *        [VAL-1] unknown event name is rejected
 *        [VAL-2] missing schemaVersion is rejected
 *        [VAL-3] forged identity / sensitive fields are stripped/ignored
 *        [VAL-4] a valid payload parses to the sanitized shape
 *        [VAL-5] non-allowlisted prop keys are dropped
 *   2. The idempotency contract (`insertAnalyticsEvent`) via a FAKE db stub:
 *        [IDEM-1] first insert writes exactly one row
 *        [IDEM-2] a duplicate eventId does NOT double-insert (deduped:true)
 *        [IDEM-3] receivedAtUtc is stamped server-side, client cannot set it
 *
 * The store's real DB is loaded lazily, so importing eventStore.ts here never
 * touches server/db.ts — the fake db is injected directly.
 */
import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
import {
  parseTrackInput,
  insertAnalyticsEvent,
  isDuplicateKeyError,
  type AnalyticsDbLike,
  type InsertAnalyticsEventInput,
  type SanitizedTrackEvent,
} from "./eventStore";

// ── A fake db that models the analytics_events UNIQUE(eventId) constraint ─────
// insert().values(row) throws an ER_DUP_ENTRY-shaped error when eventId already
// exists — exactly like MySQL — so we can prove no double-insert occurs.
function makeFakeDb() {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const db: AnalyticsDbLike = {
    insert: () => ({
      values: async (row) => {
        const key = String((row as { eventId: string }).eventId);
        if (seen.has(key)) {
          const err = Object.assign(new Error("Duplicate entry"), {
            code: "ER_DUP_ENTRY",
            errno: 1062,
          });
          throw err;
        }
        seen.add(key);
        rows.push(row as Record<string, unknown>);
        return { affectedRows: 1 };
      },
    }),
  };
  return { db, rows };
}

function validRaw(overrides: Record<string, unknown> = {}) {
  return {
    eventId: "evt_abc12345",
    eventName: "feed_viewed",
    schemaVersion: 1,
    occurredAtUtc: 1_784_000_000_000,
    ...overrides,
  };
}

describe("parseTrackInput — pure validation", () => {
  it("[VAL-1] rejects an unknown (non-allowlisted) event name", () => {
    expect(() =>
      parseTrackInput(validRaw({ eventName: "totally_made_up_event" })),
    ).toThrow(ZodError);
  });

  it("[VAL-2] rejects a payload missing schemaVersion", () => {
    const raw = validRaw();
    delete (raw as Record<string, unknown>).schemaVersion;
    expect(() => parseTrackInput(raw)).toThrow(ZodError);
  });

  it("[VAL-2b] rejects a non-integer / non-positive schemaVersion", () => {
    expect(() => parseTrackInput(validRaw({ schemaVersion: 0 }))).toThrow(ZodError);
    expect(() => parseTrackInput(validRaw({ schemaVersion: 1.5 }))).toThrow(ZodError);
  });

  it("[VAL-3] strips/ignores forged identity and sensitive fields", () => {
    const out = parseTrackInput(
      validRaw({
        subjectId: 999999, // forged pseudonymous id
        userId: 42, // forged identity
        role: "owner", // forged privilege
        entitlement: "lifetime", // forged entitlement
        consent: true, // forged consent state
        payment: { amount: 5000 }, // forged payment/PII
        wagerAmount: 250, // sensitive — must never survive
        email: "attacker@example.com", // PII — must never survive
      }),
    );
    const keys = Object.keys(out) as (keyof SanitizedTrackEvent)[];
    for (const forbidden of [
      "subjectId",
      "userId",
      "role",
      "entitlement",
      "consent",
      "payment",
      "wagerAmount",
      "email",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
    // sanity: the sanitized event carries only server-trusted, non-identity fields
    expect(out.eventName).toBe("feed_viewed");
    expect(out.schemaVersion).toBe(1);
  });

  it("[VAL-4] parses a valid payload into the sanitized shape (source defaults to web)", () => {
    const out = parseTrackInput(validRaw({ sessionId: "sess_1" }));
    expect(out).toMatchObject({
      eventId: "evt_abc12345",
      eventName: "feed_viewed",
      schemaVersion: 1,
      occurredAtUtc: 1_784_000_000_000,
      sessionId: "sess_1",
      source: "web",
      outcome: null,
      dataState: null,
      props: null,
    });
  });

  it("[VAL-5] keeps allowlisted props and drops everything else", () => {
    const out = parseTrackInput(
      validRaw({
        props: {
          sport: "MLB", // allowlisted → kept
          durationMs: 1200, // allowlisted → kept
          balance: 999, // NOT allowlisted → dropped
          ssn: "123-45-6789", // NOT allowlisted (and PII) → dropped
        },
      }),
    );
    expect(out.props).toEqual({ sport: "MLB", durationMs: 1200 });
  });
});

describe("isDuplicateKeyError", () => {
  it("recognizes ER_DUP_ENTRY / errno 1062 and nothing else", () => {
    expect(isDuplicateKeyError({ code: "ER_DUP_ENTRY" })).toBe(true);
    expect(isDuplicateKeyError({ errno: 1062 })).toBe(true);
    expect(isDuplicateKeyError({ code: "ER_NO_SUCH_TABLE" })).toBe(false);
    expect(isDuplicateKeyError(new Error("boom"))).toBe(false);
    expect(isDuplicateKeyError(null)).toBe(false);
  });
});

describe("insertAnalyticsEvent — idempotency contract (fake db)", () => {
  const baseInput = (): InsertAnalyticsEventInput => ({
    ...parseTrackInput(validRaw({ eventId: "evt_idem_0001" })),
    subjectId: 7, // server-derived
    environment: "test", // server-derived
  });

  it("[IDEM-1] first insert writes exactly one row", async () => {
    const { db, rows } = makeFakeDb();
    const res = await insertAnalyticsEvent(baseInput(), db);
    expect(res).toEqual({ ok: true, deduped: false });
    expect(rows).toHaveLength(1);
  });

  it("[IDEM-2] a duplicate eventId does NOT double-insert", async () => {
    const { db, rows } = makeFakeDb();
    const first = await insertAnalyticsEvent(baseInput(), db);
    const second = await insertAnalyticsEvent(baseInput(), db);
    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    // The unique eventId was inserted once and only once.
    expect(rows).toHaveLength(1);
  });

  it("[IDEM-3] receivedAtUtc is stamped server-side and the client can't set it", async () => {
    const { db, rows } = makeFakeDb();
    const before = Date.now();
    // Even if a client tried to smuggle receivedAtUtc, parseTrackInput strips it;
    // here we pass a fully sanitized input, so the store is the only writer of it.
    await insertAnalyticsEvent(baseInput(), db);
    const after = Date.now();
    const stored = rows[0] as { receivedAtUtc: number; subjectId: number };
    expect(stored.receivedAtUtc).toBeGreaterThanOrEqual(before);
    expect(stored.receivedAtUtc).toBeLessThanOrEqual(after);
    // subjectId is the server-derived value, not anything from the client payload.
    expect(stored.subjectId).toBe(7);
  });

  it("[IDEM-4] a non-duplicate DB error propagates (not swallowed as dedupe)", async () => {
    const failingDb: AnalyticsDbLike = {
      insert: () => ({
        values: async () => {
          throw Object.assign(new Error("connection lost"), { code: "PROTOCOL_CONNECTION_LOST" });
        },
      }),
    };
    await expect(insertAnalyticsEvent(baseInput(), failingDb)).rejects.toThrow("connection lost");
  });
});
