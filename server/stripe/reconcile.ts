/**
 * server/stripe/reconcile.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * READ-ONLY Stripe ↔ database drift detector.
 *
 * Webhooks are the primary entitlement mechanism, and webhooks can be missed:
 * a signature rejection, a 500 during processing, a Railway redeploy mid-POST,
 * or a Stripe retry budget exhausted. When that happens the database silently
 * disagrees with Stripe — and the two directions have very different costs:
 *
 *   • Stripe active  / DB no access  → a paying customer is locked out.
 *   • Stripe canceled / DB has access → we are giving away the product. This is
 *     the "lost revoke" fingerprint and is the reason this module exists.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ THIS MODULE IS STRICTLY READ-ONLY.                                        │
 * │ It contains NO insert, update, delete, upsert, or any other mutation — of │
 * │ the database or of Stripe. It observes and reports. Remediation is a      │
 * │ separate, deliberately human-gated action. Any future edit that adds a    │
 * │ write to this file is a contract violation, not a feature.                │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Logging follows the repo convention: [TAG] [STEP] / [STATE] / [OUTPUT] / [VERIFY].
 *
 * Typical wiring (done by the caller, not here — this module stays decoupled):
 *   const report = await reconcileStripeSubscriptions();
 *   if (report.drift.length > 0) {
 *     void billingAlert("RECONCILE_DRIFT", { summary: formatReconcileReport(report) });
 *   }
 */

import { isNotNull } from "drizzle-orm";
import type Stripe from "stripe";
import { appUsers } from "../../drizzle/schema";
import { getDb } from "../db";
import { getStripe } from "./client";

const TAG = "[Stripe][Reconcile]";

/** Stripe page size ceiling. */
const PAGE_SIZE = 100;

/** Default page bound. 10 × 100 = 1,000 subscriptions per run. */
const DEFAULT_MAX_PAGES = 10;

/** Cap on how many drift rows a single formatted summary enumerates. */
const FORMAT_ROW_LIMIT = 25;

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ReconcileDriftRow {
  kind: string;
  userId: number | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  detail: string;
}

export interface ReconcileReport {
  checkedStripeSubscriptions: number;
  checkedDbUsers: number;
  drift: ReconcileDriftRow[];
  ranAtMs: number;
  truncated: boolean;
}

// ─── Internal types ───────────────────────────────────────────────────────────

/** The only fields of a Stripe subscription this detector needs. */
interface SubLite {
  id: string;
  status: Stripe.Subscription.Status;
  customerId: string | null;
}

/** The only columns of app_users this detector reads. */
interface UserLite {
  id: number;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePlanId: string | null;
  hasAccess: boolean;
  expiryDate: number | null;
}

/** Stripe statuses that mean "this customer should have access right now". */
const LIVE_STATUSES: ReadonlySet<string> = new Set(["active", "trialing"]);

/** Stripe statuses that mean "this customer should NOT have access". */
const DEAD_STATUSES: ReadonlySet<string> = new Set(["canceled", "incomplete_expired"]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** `sub.customer` is `string | Customer | DeletedCustomer` depending on expansion. */
function customerIdOf(sub: Stripe.Subscription): string | null {
  const c: unknown = sub.customer;
  if (typeof c === "string") return c.length > 0 ? c : null;
  if (c && typeof c === "object" && typeof (c as { id?: unknown }).id === "string") {
    return (c as { id: string }).id;
  }
  return null;
}

/**
 * NULL expiryDate means lifetime access (see drizzle/schema.ts app_users).
 * Only a non-null timestamp strictly in the past counts as expired.
 */
function isExpired(expiryDate: number | null, nowMs: number): boolean {
  return expiryDate !== null && expiryDate < nowMs;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─── Stripe read: paged subscription scan ─────────────────────────────────────

/**
 * Pages `subscriptions.list({ limit: 100, status: "all" })` with explicit
 * `starting_after` cursors so the page bound is observable and enforceable.
 * Returns `truncated: true` when Stripe still had more pages at the bound —
 * this is logged loudly and propagated into the report; it is never a silent cap.
 */
async function listAllSubscriptions(
  maxPages: number,
): Promise<{ subs: SubLite[]; truncated: boolean; pagesFetched: number }> {
  const stripe = getStripe();
  const subs: SubLite[] = [];
  let startingAfter: string | undefined = undefined;
  let pagesFetched = 0;
  let truncated = false;

  for (let page = 0; page < maxPages; page += 1) {
    const params: Stripe.SubscriptionListParams = { limit: PAGE_SIZE, status: "all" };
    if (startingAfter) params.starting_after = startingAfter;

    const res: Stripe.ApiList<Stripe.Subscription> = await stripe.subscriptions.list(params);
    pagesFetched += 1;

    for (const sub of res.data) {
      subs.push({ id: sub.id, status: sub.status, customerId: customerIdOf(sub) });
    }

    console.log(
      `${TAG} [STEP] Fetched Stripe page ${pagesFetched}/${maxPages}` +
        ` rows=${res.data.length} running_total=${subs.length} has_more=${res.has_more}`,
    );

    if (!res.has_more) break;

    const last = res.data[res.data.length - 1];
    if (!last) break;
    startingAfter = last.id;

    if (page === maxPages - 1) {
      truncated = true;
    }
  }

  if (truncated) {
    console.warn(
      `${TAG} [STATE] TRUNCATED — Stripe reported has_more=true after the page bound` +
        ` (maxPages=${maxPages}, fetched=${subs.length} subscriptions).` +
        ` Absence-based checks (DB_SUB_NOT_IN_STRIPE, SUBSCRIPTION_ID_MISMATCH) are SKIPPED` +
        ` for this run because unseen pages would produce false positives.` +
        ` Raise maxPages to scan the full account.`,
    );
  }

  return { subs, truncated, pagesFetched };
}

// ─── DB read: app_users with a Stripe customer ────────────────────────────────

/**
 * READ-ONLY select of the six columns the detector needs. No other column is
 * fetched — in particular, email is never read, so it can never be logged.
 */
async function loadStripeLinkedUsers(): Promise<UserLite[]> {
  const db = await getDb();
  if (!db) {
    console.error(`${TAG} [STATE] Database not available — cannot reconcile`);
    throw new Error("Database not available");
  }

  const rows: unknown = await db
    .select({
      id: appUsers.id,
      stripeCustomerId: appUsers.stripeCustomerId,
      stripeSubscriptionId: appUsers.stripeSubscriptionId,
      stripePlanId: appUsers.stripePlanId,
      hasAccess: appUsers.hasAccess,
      expiryDate: appUsers.expiryDate,
    })
    .from(appUsers)
    .where(isNotNull(appUsers.stripeCustomerId));

  const list = Array.isArray(rows) ? (rows as UserLite[]) : [];
  console.log(`${TAG} [STEP] Loaded app_users with stripeCustomerId: rows=${list.length}`);
  return list;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compare every Stripe subscription against the app_users entitlement columns
 * and report the disagreements.
 *
 * READ-ONLY: no write of any kind is performed against Stripe or the database.
 *
 * Never throws on a single-row problem — a malformed subscription or an
 * unexpected shape is recorded as a drift row (or skipped with a log line) and
 * the scan continues. It DOES throw if the whole run is impossible (no Stripe
 * key, no database), because a silently empty report reads as "no drift" and
 * that is the one wrong answer this module must never give.
 */
export async function reconcileStripeSubscriptions(
  opts?: { maxPages?: number },
): Promise<ReconcileReport> {
  const ranAtMs = Date.now();
  const maxPages = Math.max(1, opts?.maxPages ?? DEFAULT_MAX_PAGES);
  const drift: ReconcileDriftRow[] = [];

  console.log(`${TAG} [STEP] Starting READ-ONLY reconcile | maxPages=${maxPages}`);

  // ── Step 1: read both sides ────────────────────────────────────────────────
  const { subs, truncated, pagesFetched } = await listAllSubscriptions(maxPages);
  const users = await loadStripeLinkedUsers();

  console.log(
    `${TAG} [STATE] Inputs loaded | stripeSubscriptions=${subs.length}` +
      ` pages=${pagesFetched} dbUsers=${users.length} truncated=${truncated}`,
  );

  // ── Step 2: index both sides ───────────────────────────────────────────────
  const subsByCustomer = new Map<string, SubLite[]>();
  const allSubIds = new Set<string>();
  for (const sub of subs) {
    allSubIds.add(sub.id);
    if (!sub.customerId) {
      drift.push({
        kind: "STRIPE_CUSTOMER_NO_USER",
        userId: null,
        stripeCustomerId: null,
        stripeSubscriptionId: sub.id,
        detail: `Stripe subscription has no resolvable customer id (status=${sub.status})`,
      });
      continue;
    }
    const bucket = subsByCustomer.get(sub.customerId);
    if (bucket) bucket.push(sub);
    else subsByCustomer.set(sub.customerId, [sub]);
  }

  const usersByCustomer = new Map<string, UserLite>();
  for (const u of users) {
    const cus = u.stripeCustomerId;
    if (!cus) continue;
    const existing = usersByCustomer.get(cus);
    if (existing) {
      // Two app_users rows share one Stripe customer — ambiguous ownership.
      drift.push({
        kind: "CUSTOMER_LINK_CONFLICT",
        userId: u.id,
        stripeCustomerId: cus,
        stripeSubscriptionId: u.stripeSubscriptionId,
        detail:
          `stripeCustomerId is linked to more than one app_users row` +
          ` (also userId=${existing.id}); using userId=${existing.id} for this scan`,
      });
      continue;
    }
    usersByCustomer.set(cus, u);
  }

  // ── Step 3: Stripe-driven checks (presence-based — valid even if truncated) ─
  for (const [customerId, custSubs] of Array.from(subsByCustomer.entries())) {
    try {
      if (usersByCustomer.has(customerId)) continue;
      for (const sub of custSubs) {
        drift.push({
          kind: "STRIPE_CUSTOMER_NO_USER",
          userId: null,
          stripeCustomerId: customerId,
          stripeSubscriptionId: sub.id,
          detail:
            `Stripe subscription status=${sub.status} but no app_users row has this` +
            ` stripeCustomerId (orphaned customer — payment with no account link)`,
        });
      }
    } catch (err: unknown) {
      console.error(
        `${TAG} [STATE] Skipping customer=${customerId} — check failed: ${errMsg(err)}`,
      );
    }
  }

  // ── Step 4: DB-driven checks ───────────────────────────────────────────────
  for (const user of users) {
    try {
      const customerId = user.stripeCustomerId;
      if (!customerId) continue;

      // Only evaluate the row that owns this customer link (see Step 2 conflict).
      if (usersByCustomer.get(customerId)?.id !== user.id) continue;

      const custSubs = subsByCustomer.get(customerId) ?? [];
      const live = custSubs.filter((s) => LIVE_STATUSES.has(s.status));
      const dead = custSubs.filter((s) => DEAD_STATUSES.has(s.status));
      const expired = isExpired(user.expiryDate, ranAtMs);

      // 4a. Paying customer locked out.
      if (live.length > 0 && (!user.hasAccess || expired)) {
        drift.push({
          kind: "STRIPE_ACTIVE_DB_NO_ACCESS",
          userId: user.id,
          stripeCustomerId: customerId,
          stripeSubscriptionId: live[0]?.id ?? user.stripeSubscriptionId,
          detail:
            `Stripe status=${live.map((s) => s.status).join(",")} but DB` +
            ` hasAccess=${user.hasAccess}` +
            ` expiryDate=${user.expiryDate === null ? "lifetime" : new Date(user.expiryDate).toISOString()}` +
            `${expired ? " (EXPIRED)" : ""}` +
            ` plan=${user.stripePlanId ?? "none"} — paying customer has no access`,
        });
      }

      // 4b. Lost revoke — the expensive direction. Reported even when truncated,
      //     but annotated, because a missed page could hide a live subscription.
      if (live.length === 0 && dead.length > 0 && user.hasAccess && !expired) {
        drift.push({
          kind: "STRIPE_CANCELED_DB_HAS_ACCESS",
          userId: user.id,
          stripeCustomerId: customerId,
          stripeSubscriptionId: dead[0]?.id ?? user.stripeSubscriptionId,
          detail:
            `Stripe status=${dead.map((s) => s.status).join(",")} with no active/trialing` +
            ` subscription, but DB hasAccess=true` +
            ` expiryDate=${user.expiryDate === null ? "lifetime" : new Date(user.expiryDate).toISOString()}` +
            ` plan=${user.stripePlanId ?? "none"} — LOST REVOKE (access given away)` +
            `${truncated ? " [partial scan — confirm before acting]" : ""}`,
        });
      }

      // 4c/4d are absence-based: a truncated scan cannot distinguish "not in
      // Stripe" from "on a page we never fetched". Skip them rather than emit
      // false positives.
      if (truncated) continue;

      const dbSubId = user.stripeSubscriptionId;

      if (dbSubId) {
        if (!allSubIds.has(dbSubId)) {
          drift.push({
            kind: "DB_SUB_NOT_IN_STRIPE",
            userId: user.id,
            stripeCustomerId: customerId,
            stripeSubscriptionId: dbSubId,
            detail:
              `DB holds stripeSubscriptionId that Stripe did not return in any status` +
              ` (hasAccess=${user.hasAccess}, plan=${user.stripePlanId ?? "none"}) —` +
              ` stale or deleted subscription reference`,
          });
        } else if (!custSubs.some((s) => s.id === dbSubId)) {
          drift.push({
            kind: "SUBSCRIPTION_ID_MISMATCH",
            userId: user.id,
            stripeCustomerId: customerId,
            stripeSubscriptionId: dbSubId,
            detail:
              `DB stripeSubscriptionId exists in Stripe but belongs to a different customer;` +
              ` this customer's subscriptions are [${custSubs.map((s) => `${s.id}:${s.status}`).join(", ") || "none"}]`,
          });
        } else if (live.length > 0 && !live.some((s) => s.id === dbSubId)) {
          drift.push({
            kind: "SUBSCRIPTION_ID_MISMATCH",
            userId: user.id,
            stripeCustomerId: customerId,
            stripeSubscriptionId: dbSubId,
            detail:
              `DB points at a non-live subscription while the customer has a live one;` +
              ` db=${dbSubId} live=[${live.map((s) => `${s.id}:${s.status}`).join(", ")}]`,
          });
        }
      } else if (live.length > 0) {
        drift.push({
          kind: "SUBSCRIPTION_ID_MISMATCH",
          userId: user.id,
          stripeCustomerId: customerId,
          stripeSubscriptionId: null,
          detail:
            `DB stripeSubscriptionId is NULL but the customer has a live subscription in Stripe:` +
            ` [${live.map((s) => `${s.id}:${s.status}`).join(", ")}]`,
        });
      }
    } catch (err: unknown) {
      // Never let one bad row abort the scan.
      console.error(`${TAG} [STATE] Skipping userId=${user.id} — check failed: ${errMsg(err)}`);
    }
  }

  const report: ReconcileReport = {
    checkedStripeSubscriptions: subs.length,
    checkedDbUsers: users.length,
    drift,
    ranAtMs,
    truncated,
  };

  // ── Step 5: report ─────────────────────────────────────────────────────────
  const byKind = new Map<string, number>();
  for (const row of drift) byKind.set(row.kind, (byKind.get(row.kind) ?? 0) + 1);
  const kindSummary =
    Array.from(byKind.entries())
      .map(([k, n]) => `${k}=${n}`)
      .join(" ") || "none";

  console.log(
    `${TAG} [OUTPUT] Reconcile complete | stripeSubs=${report.checkedStripeSubscriptions}` +
      ` dbUsers=${report.checkedDbUsers} drift=${drift.length} truncated=${truncated}` +
      ` durationMs=${Date.now() - ranAtMs}`,
  );
  console.log(`${TAG} [OUTPUT] Drift by kind: ${kindSummary}`);

  if (drift.length === 0) {
    console.log(`${TAG} [VERIFY] ✓ Stripe and database agree across all scanned rows`);
  } else {
    console.warn(`${TAG} [VERIFY] ✗ ${drift.length} drift row(s) detected — see summary below`);
    console.warn(formatReconcileReport(report));
  }

  return report;
}

/**
 * Compact human-readable summary of a report — safe for logs, a Discord alert
 * body, or an ops email. Contains only ids and statuses; no email addresses are
 * ever read from the database, so none can appear here.
 */
export function formatReconcileReport(r: ReconcileReport): string {
  const lines: string[] = [];
  const byKind = new Map<string, ReconcileDriftRow[]>();
  for (const row of r.drift) {
    const bucket = byKind.get(row.kind);
    if (bucket) bucket.push(row);
    else byKind.set(row.kind, [row]);
  }

  lines.push(
    `Stripe reconcile @ ${new Date(r.ranAtMs).toISOString()}` +
      ` | stripeSubs=${r.checkedStripeSubscriptions}` +
      ` dbUsers=${r.checkedDbUsers}` +
      ` drift=${r.drift.length}` +
      (r.truncated ? " | TRUNCATED (page bound hit — absence checks skipped)" : ""),
  );

  if (r.drift.length === 0) {
    lines.push("  ✓ no drift detected");
    return lines.join("\n");
  }

  for (const [kind, rows] of Array.from(byKind.entries())) {
    lines.push(`  ${kind} × ${rows.length}`);
  }

  lines.push("  ---");
  let shown = 0;
  for (const row of r.drift) {
    if (shown >= FORMAT_ROW_LIMIT) {
      lines.push(`  … and ${r.drift.length - shown} more row(s) omitted`);
      break;
    }
    lines.push(
      `  [${row.kind}]` +
        ` user=${row.userId ?? "-"}` +
        ` cus=${row.stripeCustomerId ?? "-"}` +
        ` sub=${row.stripeSubscriptionId ?? "-"}` +
        ` :: ${row.detail}`,
    );
    shown += 1;
  }

  return lines.join("\n");
}
