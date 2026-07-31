/**
 * server/_core/testModeFulfillment.ts
 *
 * May a `livemode:false` Stripe event be allowed to run REAL fulfilment?
 *
 * WHY THIS EXISTS
 * ---------------
 * `server/stripeWebhook.ts` used to hard-return on every test-mode event, before
 * the idempotency claim and before any fulfilment ran. That guard is correct for
 * production — a Stripe test card must never mint a real subscriber — but it was
 * unconditional, so the entire money path (exactly-once claim → grant → renewal →
 * refund → revoke) was unreachable ANYWHERE: not in a sandbox, not against a
 * throwaway database, not in CI. Verified 2026-07-31 by firing a real
 * `stripe trigger` at a local server: the signature verified, the handler logged
 * "production fulfillment intentionally skipped", and the ledger stayed empty.
 * That is precisely why fulfilment has shipped unverified.
 *
 * This module is the narrowest possible escape hatch. It is designed so that
 * enabling it against production is not merely discouraged but STRUCTURALLY
 * IMPOSSIBLE, because it cannot be satisfied by a process that is configured to
 * talk to production.
 *
 * THE THREE CONDITIONS — every one of them fails closed
 * ----------------------------------------------------
 * (a) ALLOW_TEST_MODE_FULFILLMENT === "1"
 *     Explicit, deliberate opt-in. Absent, empty, "true", "yes" and "0" all mean
 *     OFF. Nothing infers this flag from NODE_ENV, CI, or a hostname — an
 *     inferred switch is one deploy-config mistake away from being on in prod.
 *
 * (b) STRIPE_SECRET_KEY matches /^(sk|rk)_test_/
 *     THE LOAD-BEARING GUARD. With a test-mode API key the handler physically
 *     cannot read or mutate a live Stripe object: live and test objects live in
 *     disjoint namespaces and a test key returns 404/permission errors for live
 *     ids. A live key, a MISSING key, or any unrecognised prefix refuses. Note
 *     this is a property of the RUNNING PROCESS, not of the incoming event —
 *     a forged `livemode:false` payload delivered to a production process (which
 *     necessarily holds a live key) still cannot unlock fulfilment.
 *
 * (c) DATABASE_URL does not point at a managed/production host
 *     Belt and braces for the blast radius that (b) does not cover: fulfilment
 *     writes to OUR database (app_users, entitlement_events,
 *     stripe_webhook_events), which Stripe key mode says nothing about. Someone
 *     could hold a test Stripe key and still be pointed at the live TiDB Cloud
 *     DSN — the exact shape of the accident vitest.globalSetup.ts was written to
 *     stop. The classification here deliberately mirrors that file
 *     (LOCAL_HOST_PATTERN / MANAGED_HOST_PATTERN) so the two guards cannot drift
 *     into disagreeing about what "local" means. Unrecognised remote hosts and
 *     unparseable DSNs both refuse: an unknown host is not evidence of safety.
 *
 * REMOVING ANY ONE OF THESE RE-OPENS THE PRODUCTION HAZARD.
 *   - drop (a) and any sandbox-shaped environment silently starts fulfilling;
 *   - drop (b) and a live-key process fulfils on attacker- or Stripe-supplied
 *     test-mode events, minting real subscribers;
 *   - drop (c) and a test-key process happily writes grants and revokes into the
 *     production users table.
 * They are independent failure domains. Do not "simplify" them into one flag.
 *
 * This module is pure: it reads only the env object it is handed, performs no
 * I/O, and has no import-time side effects, so it is unit-testable without a
 * database or a Stripe account.
 */

/** Hosts that are always safe: loopback and in-container service names. */
export const LOCAL_HOST_PATTERN = /^(localhost|127\.0\.0\.1|::1|0\.0\.0\.0|host\.docker\.internal|mysql|db)$/i;

/** Managed-database hostnames that are never a fulfilment-test target. */
export const MANAGED_HOST_PATTERN = /(tidbcloud\.com|rds\.amazonaws\.com|\.render\.com|\.railway\.app|planetscale|\bprod\b|\.prod\.)/i;

/** A Stripe TEST secret/restricted key. Live keys use `sk_live_` / `rk_live_`. */
export const TEST_STRIPE_KEY_PATTERN = /^(sk|rk)_test_/;

export interface HostVerdict {
  allowed: boolean;
  /** Parsed hostname, or null when the DSN was absent or unparseable. */
  host: string | null;
  reason: string;
}

/**
 * Is this DATABASE_URL a database we are willing to let test-mode fulfilment
 * write to? Exported so the classification can be unit-tested directly.
 *
 * Fails closed in every ambiguous case, including one where
 * vitest.globalSetup.ts deliberately does NOT: an ABSENT DATABASE_URL is
 * refused here. There, "unset" means the DB suites skip; here it would mean
 * fulfilment runs against whatever default connection the process later
 * resolves — an unknown target, which is not something to guess about.
 */
export function assessFulfillmentDatabaseUrl(raw: string | undefined): HostVerdict {
  if (!raw || raw.trim() === "") {
    return { allowed: false, host: null, reason: "DATABASE_URL is not set — refusing to fulfil against an unknown database" };
  }
  let host: string | null = null;
  try {
    // WHATWG URL returns an IPv6 host in brackets ("[::1]"); strip them so the
    // loopback literal the pattern already lists actually matches. Every other
    // host is compared verbatim.
    host = (new URL(raw).hostname || "").replace(/^\[(.*)\]$/, "$1") || null;
  } catch {
    // An unparseable DSN is not something to guess about.
    return { allowed: false, host: null, reason: "DATABASE_URL is not a parseable URL" };
  }
  if (!host) {
    return { allowed: false, host: null, reason: "DATABASE_URL has no hostname" };
  }
  if (LOCAL_HOST_PATTERN.test(host)) {
    return { allowed: true, host, reason: `local database host "${host}"` };
  }
  if (MANAGED_HOST_PATTERN.test(host)) {
    return { allowed: false, host, reason: `DATABASE_URL host "${host}" is a managed/production database host` };
  }
  return { allowed: false, host, reason: `DATABASE_URL host "${host}" is a non-local database host` };
}

export interface TestModeFulfillmentVerdict {
  allowed: boolean;
  /** Names the SPECIFIC condition that decided the verdict. Safe to log. */
  reason: string;
}

/**
 * The gate consulted by the webhook handler before letting a `livemode:false`
 * event fall through into real fulfilment.
 *
 * Default answer is `false`. Every branch below is a refusal except the last.
 */
export function isTestModeFulfillmentAllowed(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): TestModeFulfillmentVerdict {
  // (a) Explicit opt-in. Anything other than exactly "1" is off.
  const flag = env.ALLOW_TEST_MODE_FULFILLMENT;
  if (flag !== "1") {
    const seen = flag === undefined ? "unset" : `"${flag}"`;
    return {
      allowed: false,
      reason: `ALLOW_TEST_MODE_FULFILLMENT is ${seen}, not "1" — test-mode fulfilment is off by default`,
    };
  }

  // (b) Stripe key mode. This is the guard that makes the hatch unreachable
  //     from a production process; never relax it.
  const key = (env.STRIPE_SECRET_KEY ?? "").trim();
  if (!key) {
    return {
      allowed: false,
      reason: "STRIPE_SECRET_KEY is not set — cannot prove this process is in Stripe TEST mode",
    };
  }
  if (!TEST_STRIPE_KEY_PATTERN.test(key)) {
    // Report the PREFIX only — never the key material itself.
    const prefix = key.slice(0, 8);
    const live = /^(sk|rk)_live_/.test(key);
    return {
      allowed: false,
      reason: live
        ? `STRIPE_SECRET_KEY is a LIVE key (prefix "${prefix}") — test-mode fulfilment is forbidden against live Stripe credentials`
        : `STRIPE_SECRET_KEY has an unrecognised prefix ("${prefix}") — expected sk_test_ or rk_test_`,
    };
  }

  // (c) Database blast radius.
  const db = assessFulfillmentDatabaseUrl(env.DATABASE_URL);
  if (!db.allowed) {
    return { allowed: false, reason: `${db.reason} — test-mode fulfilment refuses to write there` };
  }

  return {
    allowed: true,
    reason: `ALLOW_TEST_MODE_FULFILLMENT=1, Stripe TEST key, ${db.reason}`,
  };
}
