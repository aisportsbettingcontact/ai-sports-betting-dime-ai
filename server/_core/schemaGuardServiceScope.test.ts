/**
 * SchemaGuard is scoped to the service that actually owns the tables.
 *
 * THE BUG THIS LOCKS DOWN (observed live 2026-08-07, at the #440 deploy 13:19:08
 * and again at #446 13:40:35): both Railway services run the same build, but
 * ai-sports-betting-backend points DATABASE_URL at the analytics store, which by
 * design holds analytics_events and NONE of the product/billing tables. So on
 * every single boot it logged
 *
 *   [SchemaGuard] [VERIFY] FAIL — the running code expects schema objects that do not exist:
 *     table "app_users" is MISSING entirely (18 expected columns)
 *     ... nine more ...
 *   [SchemaGuard] This means code deployed AHEAD of its migration ... login, checkout,
 *   fulfilment will break.
 *
 * None of which was true there. The product service was healthy throughout
 * (/health schema:"ok", Stripe webhook [VERIFY] PASS).
 *
 * Why that matters enough to test: this guard exists so that ONE failure — code
 * deployed ahead of its migration, which took platform-wide login down on
 * 2026-07-31 — cannot be missed in the logs. A guard that cries wolf on every
 * boot of one service is how the real alarm gets scrolled past.
 *
 * The fix is scoped by ROLE, not by drift shape, and [SG-5] is the reason:
 * "table missing entirely" must STAY fatal on the service that owns the tables,
 * because that exact shape is the ledger miss REQUIRED_COLUMNS was extended to
 * catch. Relaxing the shape would have been the smaller diff and the wrong fix.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Return null (no database) rather than throwing, so a role that SHOULD run the
// guard still completes — that lets each test assert on whether getDb was
// reached, which is the only honest way to tell "skipped" from "ran and found
// nothing".
const getDb = vi.fn(async () => null);
vi.mock("../db", () => ({ getDb: () => getDb() }));

import { assertSchemaCurrent, compareSchema } from "./schemaGuard";

const ROLE_KEYS = [
  "ANALYTICS_ROLE",
  "USER_ACTIVITY_BACKEND_URL",
  "SCHEMA_GUARD_FATAL",
] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(ROLE_KEYS.map(k => [k, process.env[k]]));
  for (const k of ROLE_KEYS) delete process.env[k];
  getDb.mockClear();
});
afterEach(() => {
  for (const k of ROLE_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
});

describe("SchemaGuard service scoping", () => {
  it("[SG-1] on the analytics store it reports N/A and never touches the database", async () => {
    process.env.ANALYTICS_ROLE = "store";

    const result = await assertSchemaCurrent();

    expect(result.skipped).toBe("analytics-store");
    expect(result.drift).toEqual([]);
    // Reaching the DB at all would mean the early return did not happen.
    expect(getDb).not.toHaveBeenCalled();
  });

  it("[SG-2] ok:true carries a skipped reason, so 'not checked' can never be read as 'verified clean'", async () => {
    process.env.ANALYTICS_ROLE = "store";
    const skippedRun = await assertSchemaCurrent();

    delete process.env.ANALYTICS_ROLE;
    const realRun = await assertSchemaCurrent();

    // Both are ok:true and they mean completely different things. `skipped` is
    // the only thing that separates "we did not look" from "we looked, it's fine".
    expect(skippedRun.ok).toBe(true);
    expect(skippedRun.skipped).toBe("analytics-store");
    expect(realRun.ok).toBe(true);
    expect(realRun.skipped).toBeUndefined();
  });

  it("[SG-3] the FORWARDER — the real production app — is still fully guarded", async () => {
    process.env.USER_ACTIVITY_BACKEND_URL =
      "http://backend.railway.internal:8080";

    const result = await assertSchemaCurrent();

    expect(result.skipped).toBeUndefined();
    expect(getDb).toHaveBeenCalled();
  });

  it("[SG-4] the 'disabled' default is still guarded — only an EXPLICIT store opts out", async () => {
    // No ANALYTICS_ROLE, no backend URL: role resolves to "disabled". A service
    // that has not declared itself is not a licence to stop checking.
    const result = await assertSchemaCurrent();

    expect(result.skipped).toBeUndefined();
    expect(getDb).toHaveBeenCalled();
  });

  it("[SG-5] a lookalike role value does NOT open the escape hatch", async () => {
    process.env.ANALYTICS_ROLE = "storefront";

    const result = await assertSchemaCurrent();

    expect(result.skipped).toBeUndefined();
    expect(getDb).toHaveBeenCalled();
  });

  it("[SG-6] REGRESSION GUARD: a missing TABLE is still drift — the ledger miss stays loud", () => {
    // The tempting smaller fix was "treat tableMissing as benign everywhere".
    // That would have silently re-opened the ledger gap: checkout_sessions and
    // payment_events were MISSING ENTIRELY when their migrations were skipped,
    // and swallow their own errors, so nothing else would have said a word.
    const drift = compareSchema([], {
      checkout_sessions: ["id", "fulfillment"],
    });

    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({
      table: "checkout_sessions",
      tableMissing: true,
    });
  });
});
