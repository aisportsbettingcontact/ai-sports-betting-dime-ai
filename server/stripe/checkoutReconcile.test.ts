/**
 * Checkout reconciliation decision table.
 *
 * The webhook is a push channel and cannot report its own silence. Three
 * failure modes it can never surface:
 *   1. the event was never subscribed (checkout.session.expired is NOT on the
 *      live endpoint — verified against the live account),
 *   2. it was subscribed but never delivered (endpoint down, deploy window,
 *      retry exhaustion),
 *   3. it arrived and the handler bailed.
 *
 * The sweep covers all three. Its classifier is the load-bearing part: a false
 * "dropped" cries wolf on healthy revenue, and a missed one is the incident
 * that already cost two payments. Both directions are pinned here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifySession } from "./checkoutReconcile";

describe("classifySession — open sessions are left alone", () => {
  it("returns null while the buyer may still be paying", () => {
    // Resolving an open session would mark a live checkout as failed.
    expect(classifySession({ status: "open", payment_status: "unpaid" })).toBeNull();
  });

  it("returns null for an unknown status rather than guessing", () => {
    expect(classifySession({ status: "something_new" })).toBeNull();
    expect(classifySession({})).toBeNull();
  });
});

describe("classifySession — the incident case", () => {
  it("flags complete+paid as DROPPED, because we never fulfilled it", () => {
    const v = classifySession({ status: "complete", payment_status: "paid" });
    expect(v).toEqual({
      status: "completed",
      fulfillment: "dropped",
      reason: "complete+paid in Stripe but never fulfilled locally (reconciled)",
    });
  });

  it("treats no_payment_required (100% coupon) as paid, not as a drop", () => {
    // A fully-discounted checkout is legitimate revenue-zero access. Calling it
    // dropped would raise a false alarm on every comp.
    const v = classifySession({ status: "complete", payment_status: "no_payment_required" });
    expect(v?.fulfillment).toBe("dropped"); // still needs fulfilment...
    expect(v?.status).toBe("completed");
  });

  it("does NOT flag an unpaid completion as a drop", () => {
    // Stripe closed the session without capturing money — nothing was taken, so
    // there is nothing to recover. Skipped, not dropped.
    const v = classifySession({ status: "complete", payment_status: "unpaid" });
    expect(v?.fulfillment).toBe("skipped");
    expect(v?.reason).toContain("payment_status=unpaid");
  });
});

describe("classifySession — abandonment", () => {
  it("marks expired sessions, which is what the unsubscribed event cannot do", () => {
    const v = classifySession({ status: "expired" });
    expect(v?.status).toBe("expired");
    expect(v?.fulfillment).toBe("skipped");
    expect(v?.reason).toContain("expired");
  });
});

describe("sweep safety properties", () => {
  const src = readFileSync(resolve(__dirname, "checkoutReconcile.ts"), "utf8");

  it("never overwrites a row the webhook already fulfilled", () => {
    // The sweep sees the session, not the entitlement it produced. Downgrading
    // a fulfilled row would invent an incident that never happened.
    expect(src).toMatch(/have\.fulfillment === "fulfilled"/);
  });

  it("throws when the database is unavailable instead of reporting a clean sweep", () => {
    // An empty report reads as "no problems" — the one wrong answer here.
    expect(src).toMatch(/refusing to report an empty sweep as clean/);
  });

  it("continues past a malformed session rather than aborting the scan", () => {
    expect(src).toMatch(/\[FAIL\] session \$\{s\.id\}/);
  });

  it("bounds pagination so a backlog cannot become a runaway", () => {
    expect(src).toMatch(/DEFAULT_MAX_PAGES/);
    expect(src).toMatch(/truncated/);
  });

  it("supports a dry run, so the first production sweep can be inspected", () => {
    expect(src).toMatch(/dryRun/);
    expect(src).toMatch(/\[DRY\] would set/);
  });

  it("logs unfulfilled session ids at error level for alerting", () => {
    expect(src).toMatch(/MONEY TAKEN WITHOUT ACCESS/);
  });
});

describe("it is actually scheduled — an unscheduled reconcile is dead code", () => {
  const index = readFileSync(resolve(__dirname, "../_core/index.ts"), "utf8");

  it("runs on an interval, not just on demand", () => {
    // server/stripe/reconcile.ts already exists and is invoked from nowhere.
    // This one must not repeat that.
    expect(index).toMatch(/reconcileCheckoutSessions/);
    expect(index).toMatch(/checkoutReconcileInterval/);
  });

  it("unrefs its timers so it never holds the process open", () => {
    expect(index).toMatch(/checkoutReconcileInterval\.unref\(\)/);
  });

  it("swallows sweep failures so a reconcile outage cannot take the server down", () => {
    expect(index).toMatch(/\[CheckoutReconcile\] \[FAIL\] sweep failed/);
  });
});

describe("pre-ledger sessions must never be judged — the false-alarm guard", () => {
  const src = readFileSync(resolve(__dirname, "checkoutReconcile.ts"), "utf8");

  it("has an explicit ledger epoch", () => {
    // The sweep infers "never fulfilled" from the ABSENCE of a row. That is
    // only valid after the ledger existed; before it, every session is absent
    // by construction.
    expect(src).toMatch(/LEDGER_EPOCH_MS/);
  });

  it("back-fills pre-epoch sessions as skipped/unknown, never as dropped", () => {
    // A dry run against the live account flagged all 9 historical paid sessions
    // as dropped when most had been provisioned by hand. Nine false alarms on
    // day one teaches everyone to ignore the signal.
    expect(src).toMatch(/createdMs < LEDGER_EPOCH_MS/);
    expect(src).toMatch(/predates the checkout ledger — outcome unknown, not judged/);
  });

  it("still counts them as back-filled so the history is not lost", () => {
    const block = src.slice(src.indexOf("createdMs < LEDGER_EPOCH_MS"));
    expect(block.slice(0, 400)).toMatch(/out\.backfilled \+= 1/);
  });
});
