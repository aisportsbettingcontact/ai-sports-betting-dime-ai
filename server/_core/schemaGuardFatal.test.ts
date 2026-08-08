/**
 * SCHEMA_GUARD_FATAL — the branch that decides whether a bad deploy serves.
 *
 * WHY THIS EXISTS. SchemaGuard is warn-only by default. Turning on
 * SCHEMA_GUARD_FATAL=1 converts a degraded boot into a refused one, which is the
 * whole point — it would have turned the 2026-08-05 deploy-order incident (#370,
 * 40 minutes of auth down) into a failed deploy that never took traffic. But
 * `process.exit(1)` fires from `onListening`, AFTER the server is already
 * accepting requests, and until now no test drove it at all. A switch nobody has
 * ever tested is not a switch you flip on production.
 *
 * THE HAZARD IT GUARDS. Probed 2026-08-07 before any of this was written: a db
 * stub returning `[]` makes compareSchema report all 9 required tables as
 * `tableMissing`, `ok: false`. Under FATAL that is `process.exit(1)` — so one
 * transient empty read (wrong DATABASE() context, driver row-shape change, lost
 * information_schema access) crash-loops a service whose schema was fine. That
 * is a self-inflicted outage in the name of preventing one.
 *
 * A migration adds or alters; it does not drop the entire product schema. So
 * all-tables-missing is treated as a failed READ, reported loudly, never fatal.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type DbStub = { execute: (q: unknown) => Promise<unknown> } | null;
let dbStub: DbStub = null;
const getDb = vi.fn(async () => dbStub);
vi.mock("../db", () => ({ getDb: () => getDb() }));

import { assertSchemaCurrent, REQUIRED_COLUMNS } from "./schemaGuard";

const allRows = () =>
  Object.entries(REQUIRED_COLUMNS).flatMap(([t, cols]) =>
    cols.map(c => ({ t, c }))
  );
const dbReturning = (rows: Array<{ t: string; c: string }>): DbStub => ({
  execute: async () => rows,
});

let savedFatal: string | undefined;
let exitSpy: ReturnType<typeof vi.spyOn>;
let errors: string[];

beforeEach(() => {
  savedFatal = process.env.SCHEMA_GUARD_FATAL;
  delete process.env.SCHEMA_GUARD_FATAL;
  delete process.env.ANALYTICS_ROLE;
  dbStub = null;
  getDb.mockClear();
  errors = [];
  vi.spyOn(console, "error").mockImplementation(
    (...a: unknown[]) => void errors.push(String(a[0]))
  );
  // Record instead of exiting. A throwing stub would model reality better —
  // process.exit never returns — but it cannot be used here: the exit call sits
  // INSIDE assertSchemaCurrent's try, whose catch swallows everything and
  // returns { ok: true, drift: [] }. A thrown stub is therefore caught and the
  // test sees a clean pass, which is the opposite of what happened. (Harmless in
  // production, where process.exit genuinely does not return — but a trap for
  // anyone testing this branch, so: assert on the spy, not on a rejection.)
  exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  if (savedFatal === undefined) delete process.env.SCHEMA_GUARD_FATAL;
  else process.env.SCHEMA_GUARD_FATAL = savedFatal;
});

describe("SCHEMA_GUARD_FATAL", () => {
  it("[SG-10] with FATAL=1 and REAL drift, it refuses to serve", async () => {
    process.env.SCHEMA_GUARD_FATAL = "1";
    // One table gone — the shape a skipped migration actually produces.
    dbStub = dbReturning(allRows().filter(r => r.t !== "payment_events"));

    await assertSchemaCurrent();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errors.join("\n")).toContain(
      "refusing to serve with a stale schema"
    );
  });

  it("[SG-11] without FATAL, the same drift reports and keeps serving", async () => {
    dbStub = dbReturning(allRows().filter(r => r.t !== "payment_events"));

    const result = await assertSchemaCurrent();

    expect(result.ok).toBe(false);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(errors.join("\n")).toContain("[VERIFY] FAIL");
  });

  it("[SG-12] an EMPTY read is never fatal, even with FATAL=1", async () => {
    // The crash-loop guard. Without it this is 9/9 tableMissing -> exit(1).
    process.env.SCHEMA_GUARD_FATAL = "1";
    dbStub = dbReturning([]);

    const result = await assertSchemaCurrent();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(result.inconclusive).toBe(true);
    expect(result.ok).toBe(false);
    expect(errors.join("\n")).toContain("[VERIFY] INCONCLUSIVE");
    // It must not be silent either — "we don't know" is worth saying.
    expect(errors.join("\n")).toContain("schema READ failed");
  });

  it("[SG-13] all-missing is judged on ALL tables, not a lucky count", async () => {
    // Every table present but stripped to zero columns: 9 drift entries, none
    // tableMissing. That is real column drift and must stay fatal — the
    // inconclusive branch must key on tableMissing, not on drift.length alone.
    process.env.SCHEMA_GUARD_FATAL = "1";
    dbStub = dbReturning(
      Object.keys(REQUIRED_COLUMNS).map(t => ({ t, c: "id" }))
    );

    await assertSchemaCurrent();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("[SG-14] the analytics store never exits, whatever FATAL says", async () => {
    // The store legitimately has none of these tables. If the role skip ever
    // regressed, FATAL would crash-loop the back office on every boot.
    process.env.SCHEMA_GUARD_FATAL = "1";
    process.env.ANALYTICS_ROLE = "store";
    dbStub = dbReturning([]);

    const result = await assertSchemaCurrent();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(result.skipped).toBe("analytics-store");
    expect(getDb).not.toHaveBeenCalled();
  });
});
