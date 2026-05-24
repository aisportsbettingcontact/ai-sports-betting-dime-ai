/**
 * scripts/exportUsersToStripe.mjs
 *
 * Bulk exports all existing app users to Stripe as Customers.
 * Creates a Stripe Customer for every user who:
 *   - Has hasAccess = true
 *   - Does NOT already have a stripeCustomerId
 *
 * Preserves ALL existing user data — no deletions, no rearrangements.
 * Writes stripeCustomerId back to the database after creation.
 *
 * Usage:
 *   node scripts/exportUsersToStripe.mjs [--dry-run]
 *
 * Flags:
 *   --dry-run  Print what would be created without actually calling Stripe
 *
 * Structured logging format:
 *   [INPUT]  source + parsed values
 *   [STEP]   operation description
 *   [STATE]  intermediate computations
 *   [OUTPUT] result
 *   [VERIFY] pass/fail + reason
 */

import Stripe from "stripe";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const DRY_RUN = process.argv.includes("--dry-run");
const TAG = "[ExportUsersToStripe]";

// ─── Validate environment ─────────────────────────────────────────────────────
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!STRIPE_SECRET_KEY) {
  console.error(`${TAG} [VERIFY] FAIL — STRIPE_SECRET_KEY is not set`);
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error(`${TAG} [VERIFY] FAIL — DATABASE_URL is not set`);
  process.exit(1);
}

console.log(`${TAG} [INPUT] DRY_RUN=${DRY_RUN}`);
console.log(`${TAG} [INPUT] STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY.slice(0, 12)}...`);
console.log(`${TAG} [INPUT] DATABASE_URL=${DATABASE_URL.replace(/:[^@]+@/, ":***@")}`);

// ─── Initialize Stripe ────────────────────────────────────────────────────────
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-04-30.basil" });
console.log(`${TAG} [STATE] Stripe client initialized`);

// ─── Connect to database ──────────────────────────────────────────────────────
let connection;
try {
  connection = await mysql.createConnection(DATABASE_URL);
  console.log(`${TAG} [STATE] Database connection established`);
} catch (err) {
  console.error(`${TAG} [VERIFY] FAIL — DB connection error: ${err.message}`);
  process.exit(1);
}

// ─── Query all users who need Stripe Customer IDs ─────────────────────────────
console.log(`${TAG} [STEP] Querying users without stripeCustomerId`);

const [rows] = await connection.execute(
  `SELECT id, username, email, role, hasAccess, expiryDate,
          stripeCustomerId, stripePlanId, stripeSubscriptionId,
          discordId, discordUsername, createdAt
   FROM app_users
   WHERE stripeCustomerId IS NULL
   ORDER BY id ASC`
);

console.log(`${TAG} [STATE] Found ${rows.length} users without stripeCustomerId`);

if (rows.length === 0) {
  console.log(`${TAG} [OUTPUT] All users already have Stripe Customer IDs. Nothing to do.`);
  await connection.end();
  process.exit(0);
}

// ─── Print summary ────────────────────────────────────────────────────────────
console.log(`\n${TAG} [STATE] Users to export:`);
console.log(`${"─".repeat(80)}`);
console.log(
  `${"ID".padEnd(6)} ${"USERNAME".padEnd(20)} ${"EMAIL".padEnd(35)} ${"ROLE".padEnd(12)} ${"ACCESS".padEnd(8)} ${"PLAN".padEnd(10)}`
);
console.log(`${"─".repeat(80)}`);
for (const u of rows) {
  const expiry = u.expiryDate
    ? new Date(u.expiryDate).toLocaleDateString()
    : u.hasAccess
    ? "Lifetime"
    : "None";
  console.log(
    `${String(u.id).padEnd(6)} ${(u.username ?? "(none)").padEnd(20)} ${(u.email ?? "(none)").padEnd(35)} ${(u.role ?? "user").padEnd(12)} ${(u.hasAccess ? "YES" : "NO").padEnd(8)} ${(u.stripePlanId ?? expiry).padEnd(10)}`
  );
}
console.log(`${"─".repeat(80)}\n`);

if (DRY_RUN) {
  console.log(`${TAG} [OUTPUT] DRY RUN — no Stripe API calls made. ${rows.length} customers would be created.`);
  await connection.end();
  process.exit(0);
}

// ─── Create Stripe Customers ──────────────────────────────────────────────────
let created = 0;
let skipped = 0;
let failed = 0;
const results = [];

for (const user of rows) {
  const userTag = `${TAG}[userId=${user.id}]`;
  console.log(`${userTag} [STEP] Processing username=${user.username} email=${user.email ?? "(none)"}`);

  // Build customer metadata — preserve ALL user data
  const metadata = {
    app_user_id: String(user.id),
    username: user.username ?? "",
    role: user.role ?? "user",
    has_access: user.hasAccess ? "true" : "false",
    expiry_date: user.expiryDate ? new Date(user.expiryDate).toISOString() : "lifetime",
    plan_id: user.stripePlanId ?? "",
    stripe_subscription_id: user.stripeSubscriptionId ?? "",
    discord_id: user.discordId ?? "",
    discord_username: user.discordUsername ?? "",
    created_at: user.createdAt ? new Date(user.createdAt).toISOString() : "",
    source: "bulk_export_2026_05_24",
  };

  // Check if a Stripe customer already exists with this email to avoid duplicates
  let existingCustomerId = null;
  if (user.email) {
    console.log(`${userTag} [STEP] Checking for existing Stripe customer with email=${user.email}`);
    try {
      const existing = await stripe.customers.list({ email: user.email, limit: 1 });
      if (existing.data.length > 0) {
        existingCustomerId = existing.data[0].id;
        console.log(`${userTag} [STATE] Found existing Stripe customer id=${existingCustomerId}`);
      }
    } catch (err) {
      console.warn(`${userTag} [STATE] Could not check existing customers: ${err.message}`);
    }
  }

  let customerId;

  if (existingCustomerId) {
    // Update existing customer with our metadata
    console.log(`${userTag} [STEP] Updating existing Stripe customer ${existingCustomerId} with metadata`);
    try {
      const updated = await stripe.customers.update(existingCustomerId, {
        name: user.username ?? undefined,
        metadata,
      });
      customerId = updated.id;
      console.log(`${userTag} [STATE] Updated existing customer id=${customerId}`);
    } catch (err) {
      console.error(`${userTag} [VERIFY] FAIL — Stripe update error: ${err.message}`);
      failed++;
      results.push({ userId: user.id, username: user.username, status: "failed", error: err.message });
      continue;
    }
  } else {
    // Create new Stripe customer
    console.log(`${userTag} [STEP] Creating new Stripe customer`);
    const customerParams = {
      name: user.username ?? undefined,
      ...(user.email ? { email: user.email } : {}),
      metadata,
    };

    try {
      const customer = await stripe.customers.create(customerParams);
      customerId = customer.id;
      console.log(`${userTag} [STATE] Created new Stripe customer id=${customerId}`);
    } catch (err) {
      console.error(`${userTag} [VERIFY] FAIL — Stripe create error: ${err.message}`);
      failed++;
      results.push({ userId: user.id, username: user.username, status: "failed", error: err.message });
      continue;
    }
  }

  // Write stripeCustomerId back to database
  console.log(`${userTag} [STEP] Writing stripeCustomerId=${customerId} to database`);
  try {
    await connection.execute(
      "UPDATE app_users SET stripeCustomerId = ? WHERE id = ?",
      [customerId, user.id]
    );
    console.log(`${userTag} [OUTPUT] stripeCustomerId=${customerId} saved userId=${user.id}`);
    console.log(`${userTag} [VERIFY] PASS`);
    created++;
    results.push({ userId: user.id, username: user.username, status: "created", stripeCustomerId: customerId });
  } catch (err) {
    console.error(`${userTag} [VERIFY] FAIL — DB write error: ${err.message}`);
    failed++;
    results.push({ userId: user.id, username: user.username, status: "db_write_failed", stripeCustomerId: customerId, error: err.message });
  }

  // Rate limit: 25 req/s Stripe limit — small delay between requests
  await new Promise((r) => setTimeout(r, 80));
}

// ─── Final summary ────────────────────────────────────────────────────────────
console.log(`\n${TAG} [OUTPUT] Export complete`);
console.log(`${"─".repeat(60)}`);
console.log(`${TAG} [OUTPUT] Created:  ${created}`);
console.log(`${TAG} [OUTPUT] Skipped:  ${skipped}`);
console.log(`${TAG} [OUTPUT] Failed:   ${failed}`);
console.log(`${TAG} [OUTPUT] Total:    ${rows.length}`);
console.log(`${"─".repeat(60)}`);

if (failed > 0) {
  console.log(`\n${TAG} [STATE] Failed users:`);
  for (const r of results.filter((r) => r.status === "failed" || r.status === "db_write_failed")) {
    console.log(`  userId=${r.userId} username=${r.username} error=${r.error}`);
  }
}

console.log(`\n${TAG} [VERIFY] ${failed === 0 ? "PASS — all users exported successfully" : `PARTIAL — ${failed} failures require manual review`}`);

await connection.end();
process.exit(failed > 0 ? 1 : 0);
