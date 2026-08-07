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
 * The fix is scoped by ROLE, not by drift shape, and [SG-6]/[SG-7] are the
 * reason: "table missing entirely" must STAY fatal on the service that owns the
 * tables, because that exact shape is the ledger miss REQUIRED_COLUMNS was
 * extended to catch. Relaxing the shape would have been the smaller diff and the
 * wrong fix.
 *
 * [SG-7]..[SG-9] exist because an adversarial review of this PR found that
 * [SG-6] alone did not back that claim. SG-6 pins compareSchema, a pure function
 * this change does not touch — so the wrong fix, written one layer up as
 *   const drift = (await detectSchemaDrift()).filter(d => !d.tableMissing)
 * passed all 27 tests AND tsc. assertSchemaCurrent's entire drift-REPORTING
 * branch had no coverage anywhere in the repo; every test reached it with getDb
 * mocked to null, so drift was always empty and the FAIL path never ran.
 * SG-7 kills that mutation. A claim in a comment is not a test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// A configurable stub, not a constant null. Tests that only care about role
// resolution leave it null (detectSchemaDrift short-circuits, and asserting on
// whether getDb was REACHED is the only honest way to tell "skipped" from "ran
// and found nothing"). Tests that need the drift-reporting branch install a
// stub that returns real information_schema rows.
type DbStub = { execute: (q: unknown) => Promise<unknown> } | null;
let dbStub: DbStub = null;
const getDb = vi.fn(async () => dbStub);
vi.mock("../db", () => ({ getDb: () => getDb() }));

import {
  assertSchemaCurrent,
  compareSchema,
  REQUIRED_COLUMNS,
} from "./schemaGuard";

/** Every required column of every required table, minus the tables named. */
const schemaRowsOmitting = (omitTables: string[]) =>
  Object.entries(REQUIRED_COLUMNS).flatMap(([t, cols]) =>
    omitTables.includes(t) ? [] : cols.map(c => ({ t, c }))
  );

const dbReturning = (rows: Array<{ t: string; c: string }>): DbStub => ({
  execute: async () => rows,
});

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
  dbStub = null;
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

/**
 * The branch that actually fires the alarm. Before these, nothing in the repo
 * ever called assertSchemaCurrent with non-empty drift, so the [VERIFY] FAIL
 * log, the SCHEMA_GUARD_FATAL exit, and `ok: false` were all unexecuted code.
 */
describe("SchemaGuard drift reporting — the alarm itself", () => {
  it("[SG-7] a missing ledger table makes the guard FAIL, not pass", async () => {
    // This is the mutation killer. Filtering tableMissing out of the drift
    // inside assertSchemaCurrent — the "smaller diff and wrong fix" this change
    // explicitly disclaims — used to pass every test in the repo.
    const errors: string[] = [];
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation((...a: unknown[]) => void errors.push(String(a[0])));
    dbStub = dbReturning(schemaRowsOmitting(["payment_events"]));

    const result = await assertSchemaCurrent();
    spy.mockRestore();

    expect(result.ok).toBe(false);
    expect(result.skipped).toBeUndefined();
    expect(result.drift).toContainEqual(
      expect.objectContaining({ table: "payment_events", tableMissing: true })
    );
    // And it has to SAY so — a silent false is not an alarm.
    expect(errors.join("\n")).toContain("[VERIFY] FAIL");
    expect(errors.join("\n")).toContain("payment_events");
  });

  it("[SG-8] a missing COLUMN also fails — the 2026-07-31 outage shape", async () => {
    // app_users.planPriceId existed in code but not in the database, and every
    // query against app_users died with ER_BAD_FIELD_ERROR.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbStub = dbReturning(
      schemaRowsOmitting([]).filter(r => r.c !== "planPriceId")
    );

    const result = await assertSchemaCurrent();
    spy.mockRestore();

    expect(result.ok).toBe(false);
    expect(result.drift).toContainEqual(
      expect.objectContaining({
        table: "app_users",
        tableMissing: false,
        missingColumns: ["planPriceId"],
      })
    );
  });

  it("[SG-9] a complete schema passes, and says PASS rather than N/A", async () => {
    const logs: string[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((...a: unknown[]) => void logs.push(String(a[0])));
    dbStub = dbReturning(schemaRowsOmitting([]));

    const result = await assertSchemaCurrent();
    spy.mockRestore();

    expect(result.ok).toBe(true);
    expect(result.drift).toEqual([]);
    expect(result.skipped).toBeUndefined();
    // "we looked and it is fine" must not be worded like "we did not look".
    expect(logs.join("\n")).toContain("[VERIFY] PASS");
    expect(logs.join("\n")).not.toContain("N/A");
  });
});
