#!/usr/bin/env node
/**
 * scripts/stripe-e2e.mjs — the Stripe money path, end to end, re-runnably.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every part of billing has unit tests and none of them proved the money path.
 * `server/stripeWebhook.ts` hard-returned on `livemode:false` BEFORE the
 * idempotency claim, so the sequence that actually matters — signature verify →
 * exactly-once claim → grant → replay is a no-op → revoke → refund — had never
 * executed against a real database, in any environment, ever. This script is
 * that proof, and it is scripted so it can be re-run on demand and nightly in
 * CI instead of being a thing someone once did by hand.
 *
 * WHAT IT BUILDS (all disposable, all local)
 *   1. a throwaway MySQL 8 container on a non-default port
 *   2. the FULL migration chain replayed onto it (not drizzle-kit push — the
 *      same reconciled replay CI and production use), asserted against the
 *      newest journal tag
 *   3. a minimum plan/price/subscriber fixture
 *   4. `stripe listen` forwarding real Stripe test-mode events to
 *   5. a real server process booted from source with the test-mode fulfilment
 *      gate (server/_core/testModeFulfillment.ts) satisfied
 *
 * HOW IT PROVES THINGS — three layers, labelled honestly in the summary
 * --------------------------------------------------------------------
 *   [PLUMBING]  Real `stripe trigger` events travelling Stripe → CLI → our
 *               endpoint. Proves delivery, signature verification and the
 *               exactly-once claim against events we did not author. Their
 *               canned fixtures carry none of our metadata, so they CANNOT be
 *               mapped to the seeded subscriber; those checks assert only what
 *               is provable and are marked PARTIAL, never dressed up as more.
 *
 *   [FULFILMENT] Synthetic events signed with the SAME `whsec_` the CLI handed
 *               us, POSTed to the same endpoint. The HMAC, the handler, the
 *               database writes and the entitlement audit trail are all real;
 *               only the origin is us rather than Stripe's servers. This is the
 *               only way to bind an event to OUR seeded user (client_reference_id
 *               + metadata.price_id), which is what makes grant / exactly-once /
 *               revoke / refund assertable as DATABASE STATE rather than as log
 *               text. Marked [synthetic] in the summary.
 *
 *   [NEGATIVE]  Forged and missing signatures, asserted to 400 AND to leave the
 *               idempotency ledger untouched.
 *
 * WHAT IT CANNOT PROVE — see docs/stripe-e2e.md. Short version: it does not
 * exercise Stripe-hosted Checkout in a browser, it does not prove production
 * config, and the [FULFILMENT] layer does not prove Stripe's own delivery
 * (that is what the [PLUMBING] layer is for).
 *
 * SAFETY — this cannot touch production, structurally
 *   - it refuses to start unless the resolved Stripe key matches /^(sk|rk)_test_/
 *   - DATABASE_URL is always 127.0.0.1 on a container this process created
 *   - the server's own gate independently re-checks all three conditions
 *   - no key or signing secret is ever printed; every child-process stream is
 *     passed through redact() before it can reach the console
 *
 * USAGE
 *   node scripts/stripe-e2e.mjs [--port 3999] [--mysql-port 33399] [--keep]
 */

import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ─── Arguments ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { port: 3999, mysqlPort: 33399, keep: false, testClock: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const take = () => {
      const inline = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : null;
      return inline ?? argv[++i];
    };
    if (arg === "--keep") args.keep = true;
    else if (arg === "--test-clock") args.testClock = true;
    else if (arg.startsWith("--port")) args.port = Number(take());
    else if (arg.startsWith("--mysql-port")) args.mysqlPort = Number(take());
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "usage: node scripts/stripe-e2e.mjs [--port N] [--mysql-port N] [--keep] [--test-clock]"
      );
      process.exit(0);
    } else {
      console.error(`::error::unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  if (!Number.isInteger(args.port) || args.port < 1024 || args.port > 65535) {
    console.error("::error::--port must be an integer between 1024 and 65535");
    process.exit(2);
  }
  if (
    !Number.isInteger(args.mysqlPort) ||
    args.mysqlPort < 1024 ||
    args.mysqlPort > 65535
  ) {
    console.error("::error::--mysql-port must be an integer 1024–65535");
    process.exit(2);
  }
  return args;
}

const ARGS = parseArgs(process.argv.slice(2));

const DB_NAME = "dime_stripe_e2e";
const CONTAINER = `dime-stripe-e2e-${ARGS.mysqlPort}`;
const DATABASE_URL = `mysql://root@127.0.0.1:${ARGS.mysqlPort}/${DB_NAME}`;
const WEBHOOK_URL = `http://localhost:${ARGS.port}/api/stripe/webhook`;
const HEALTH_URL = `http://127.0.0.1:${ARGS.port}/health`;
const PLAN_SLUG = "e2e-harness";
const RUN_ID = randomBytes(4).toString("hex");
/** Redacted server output, kept on disk so a failing check can be explained. */
const SERVER_LOG_PATH = resolve(tmpdir(), `stripe-e2e-server-${RUN_ID}.log`);

// ─── Secret-safe logging ──────────────────────────────────────────────────────
//
// Everything printed by this script goes through redact(). Child-process output
// is never forwarded raw: `stripe listen` prints the signing secret on its first
// line and `stripe config --list` prints the API key outright.

const SENSITIVE = new Set();

function remember(secret) {
  if (typeof secret === "string" && secret.length >= 8) SENSITIVE.add(secret);
}

function redact(value) {
  let text = typeof value === "string" ? value : String(value);
  for (const secret of SENSITIVE) {
    text = text.split(secret).join(`${secret.slice(0, 8)}…redacted`);
  }
  // Belt and braces: mask any key/secret shape we were never told about.
  return text
    .replace(/\b((?:sk|rk)_(?:test|live)_)[A-Za-z0-9]{6,}/g, "$1…redacted")
    .replace(/\bwhsec_[A-Za-z0-9]{6,}/g, "whsec_…redacted");
}

function log(...parts) {
  console.log(redact(parts.join(" ")));
}

function fail(message) {
  console.error(redact(`::error::${message}`));
}

/** Safe to print: identifies a key without revealing it. */
function keyFingerprint(key) {
  return `${key.slice(0, 8)}…(${key.length} chars)`;
}

// ─── Check ledger ─────────────────────────────────────────────────────────────

const CHECKS = [];

function record(name, status, detail, coverage) {
  CHECKS.push({ name, status, detail, coverage: coverage ?? "" });
  const icon =
    status === "PASS" ? "PASS" : status === "PARTIAL" ? "PART" : "FAIL";
  log(`  [${icon}] ${name} — ${detail}`);
}

function assertThat(name, condition, detail, coverage) {
  record(name, condition ? "PASS" : "FAIL", detail, coverage);
  return Boolean(condition);
}

// ─── Process helpers ──────────────────────────────────────────────────────────

function run(command, args, options = {}) {
  const {
    cwd = REPO_ROOT,
    env = process.env,
    timeoutMs = 180_000,
    stream = false,
  } = options;
  return new Promise(done => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      done({ code: -1, stdout: "", stderr: String(error?.message ?? error) });
      return;
    }
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      stderr += `\n[timeout after ${timeoutMs}ms]`;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", chunk => {
      stdout += chunk;
      if (stream) process.stdout.write(redact(String(chunk)));
    });
    child.stderr.on("data", chunk => {
      stderr += chunk;
      if (stream) process.stderr.write(redact(String(chunk)));
    });
    child.on("error", error => {
      clearTimeout(timer);
      done({ code: -1, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", code => {
      clearTimeout(timer);
      done({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** A long-lived child we own. Spawned detached so teardown can kill its group. */
function spawnTracked(command, args, env) {
  const child = spawn(command, args, {
    cwd: REPO_ROOT,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.unref();
  return child;
}

function signalTracked(child, signal) {
  if (!child) return;
  try {
    // Negative pid = the whole process group. `npx tsx` and `stripe listen`
    // both fork, so signalling only the direct child orphans the real listener
    // and leaves the port bound for the next run.
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  }
}

const sleep = ms => new Promise(done => setTimeout(done, ms));

async function killTracked(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  signalTracked(child, "SIGTERM");
  for (let i = 0; i < 20; i += 1) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await sleep(250);
  }
  signalTracked(child, "SIGKILL");
}

async function waitFor(
  description,
  predicate,
  { timeoutMs = 60_000, intervalMs = 500 } = {}
) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = String(error?.message ?? error);
    }
    await sleep(intervalMs);
  }
  throw new Error(
    `timed out after ${timeoutMs}ms waiting for ${description}${lastError ? ` (last error: ${lastError})` : ""}`
  );
}

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

function stripAnsi(text) {
  return String(text).replace(ANSI, "");
}

// ─── Stripe CLI ───────────────────────────────────────────────────────────────

let STRIPE_KEY = "";

/**
 * Resolve the TEST-mode key without ever printing it.
 *   1. STRIPE_TEST_SECRET_KEY in env — the CI path (the runner never logs in)
 *   2. `stripe config --list`
 *   3. ~/.config/stripe/config.toml
 * Every stripe invocation then carries `--api-key`, so the CLI and the server
 * are provably talking to the same Stripe account.
 */
async function resolveStripeTestKey() {
  const fromEnv = (process.env.STRIPE_TEST_SECRET_KEY ?? "").trim();
  if (fromEnv)
    return { key: fromEnv, source: "STRIPE_TEST_SECRET_KEY env var" };

  const listed = await run("stripe", ["config", "--list"], {
    timeoutMs: 20_000,
  });
  const fromConfig = stripAnsi(listed.stdout).match(
    /test_mode_api_key\s*=\s*['"]?((?:sk|rk)_[A-Za-z0-9_]+)['"]?/
  );
  if (fromConfig) return { key: fromConfig[1], source: "stripe config --list" };

  const tomlPath = resolve(homedir(), ".config/stripe/config.toml");
  if (existsSync(tomlPath)) {
    const fromToml = readFileSync(tomlPath, "utf8").match(
      /test_mode_api_key\s*=\s*['"]?((?:sk|rk)_[A-Za-z0-9_]+)['"]?/
    );
    if (fromToml) return { key: fromToml[1], source: tomlPath };
  }
  return { key: "", source: "" };
}

async function stripe(args, options = {}) {
  return run("stripe", [...args, "--api-key", STRIPE_KEY], {
    timeoutMs: 60_000,
    ...options,
  });
}

async function stripeJson(args) {
  const result = await stripe(args);
  if (result.code !== 0) {
    throw new Error(
      `stripe ${args.join(" ")} exited ${result.code}: ${stripAnsi(result.stderr).trim().slice(0, 400)}`
    );
  }
  const text = stripAnsi(result.stdout);
  const start = text.indexOf("{");
  if (start < 0) throw new Error(`stripe ${args.join(" ")} returned no JSON`);
  return JSON.parse(text.slice(start));
}

// ─── `stripe listen` output parsing ───────────────────────────────────────────
//
// The listener is the ground truth for BOTH halves of a real delivery:
//   --> checkout.session.completed [evt_1Abc…]
//   <--  [200] POST http://localhost:3999/api/stripe/webhook [evt_1Abc…]
// Asserting on the response CODE here is how "the handler did not error" is
// established without reading log prose.

const DELIVERIES = [];
const RESPONSES = new Map();

function consumeListenOutput(chunk, state) {
  state.buffer += stripAnsi(String(chunk));
  const lines = state.buffer.split("\n");
  state.buffer = lines.pop() ?? "";
  for (const line of lines) {
    const secret = line.match(/whsec_[A-Za-z0-9]+/);
    if (secret) {
      state.whsec = secret[0];
      remember(state.whsec);
    }
    if (/\bReady!/i.test(line)) state.ready = true;
    const delivered = line.match(
      /-->\s+([a-zA-Z0-9_.]+)\s+\[(evt_[A-Za-z0-9]+)\]/
    );
    if (delivered)
      DELIVERIES.push({ type: delivered[1], eventId: delivered[2] });
    const answered = line.match(
      /\[(\d{3})\]\s+POST\s+\S+\s+\[(evt_[A-Za-z0-9]+)\]/
    );
    if (answered) {
      const list = RESPONSES.get(answered[2]) ?? [];
      list.push(Number(answered[1]));
      RESPONSES.set(answered[2], list);
    }
    state.tail.push(line);
    if (state.tail.length > 200) state.tail.shift();
  }
}

function deliveriesOf(type, fromIndex) {
  return DELIVERIES.slice(fromIndex).filter(entry => entry.type === type);
}

// ─── Signed HTTP delivery ─────────────────────────────────────────────────────

function signPayload(payload, secret, timestampSeconds) {
  const mac = createHmac("sha256", secret)
    .update(`${timestampSeconds}.${payload}`, "utf8")
    .digest("hex");
  return `t=${timestampSeconds},v1=${mac}`;
}

async function postWebhook(payload, signatureHeader) {
  const headers = { "content-type": "application/json" };
  if (signatureHeader !== null) headers["stripe-signature"] = signatureHeader;
  const response = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers,
    body: payload,
  });
  return { status: response.status, body: await response.text() };
}

/** A synthetic-but-genuinely-signed delivery. See the header: layer 2. */
async function deliverSigned(eventObject, whsec) {
  const payload = JSON.stringify(eventObject);
  const timestamp = Math.floor(Date.now() / 1000);
  return postWebhook(payload, signPayload(payload, whsec, timestamp));
}

function syntheticEvent(type, dataObject, overrides = {}) {
  return {
    id: `evt_e2e_${RUN_ID}_${randomBytes(6).toString("hex")}`,
    object: "event",
    api_version: "2024-06-20",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type,
    data: { object: dataObject },
    ...overrides,
  };
}

// ─── Database helpers ─────────────────────────────────────────────────────────

let db = null;
let containerCreated = false;

async function query(sql, params = []) {
  const [rows] = await db.query(sql, params);
  return rows;
}

async function scalar(sql, params = []) {
  const rows = await query(sql, params);
  return rows.length > 0 ? Object.values(rows[0])[0] : null;
}

async function ledgerRowsFor(eventId) {
  return query(
    "SELECT stripeEventId, eventType, livemode, status FROM stripe_webhook_events WHERE stripeEventId = ?",
    [eventId]
  );
}

async function ledgerTotal() {
  return Number(await scalar("SELECT COUNT(*) FROM stripe_webhook_events"));
}

/**
 * Every stripeEventId that was claimed more than once — i.e. every place the
 * exactly-once guarantee leaked. Expected to be empty at all times; the UNIQUE
 * index should make it impossible, and this proves the index is actually there
 * and actually enforced rather than assumed.
 */
async function duplicateLedgerEventIds() {
  const rows = await query(
    "SELECT stripeEventId, COUNT(*) c FROM stripe_webhook_events GROUP BY stripeEventId HAVING COUNT(*) > 1"
  );
  return rows.map(row => ({
    stripeEventId: row.stripeEventId,
    c: Number(row.c),
  }));
}

async function entitlementRowsFor(eventId) {
  return query(
    "SELECT userId, eventType, reason, beforeHasAccess, afterHasAccess FROM entitlement_events WHERE stripeEventId = ?",
    [eventId]
  );
}

let SEED_USER_ID = 0;
let SEED_PRICE_ID = 0;
const SEED_CUSTOMER = `cus_e2e_${RUN_ID}`;
const SEED_SUBSCRIPTION = `sub_e2e_${RUN_ID}`;
const SEED_STRIPE_PRICE = `price_e2e_${RUN_ID}`;

async function seededUser() {
  const rows = await query(
    "SELECT id, hasAccess, expiryDate, stripeCustomerId, stripeSubscriptionId, stripePlanId, planPriceId, lastStripeEventAt FROM app_users WHERE id = ?",
    [SEED_USER_ID]
  );
  return rows[0] ?? null;
}

// ─── Stage 1: preflight ───────────────────────────────────────────────────────

async function preflight() {
  log("[1/6] Preflight");

  const docker = await run(
    "docker",
    ["version", "--format", "{{.Server.Version}}"],
    {
      timeoutMs: 30_000,
    }
  );
  if (docker.code !== 0) {
    throw new Error(
      "docker is unavailable (`docker version` failed). This harness creates its own throwaway " +
        "MySQL 8 container; start Docker Desktop / the docker daemon and re-run."
    );
  }
  log(`      docker server ${docker.stdout.trim()}`);

  const cli = await run("stripe", ["version"], { timeoutMs: 30_000 });
  if (cli.code !== 0) {
    throw new Error(
      "the `stripe` CLI is not installed or not on PATH. Install it " +
        "(https://stripe.com/docs/stripe-cli) and re-run — the harness needs `stripe listen`, " +
        "`stripe trigger` and `stripe events resend`."
    );
  }
  log(`      stripe cli ${stripAnsi(cli.stdout).split("\n")[0].trim()}`);

  const { key, source } = await resolveStripeTestKey();
  if (!key) {
    throw new Error(
      "no Stripe TEST key found. Either run `stripe login` (writes ~/.config/stripe/config.toml) " +
        "or set STRIPE_TEST_SECRET_KEY. The harness never reads a live key."
    );
  }
  remember(key);
  if (/^(sk|rk)_live_/.test(key)) {
    throw new Error(
      `refusing to run: the resolved Stripe key is a LIVE key (${keyFingerprint(key)}). ` +
        "This harness fulfils real entitlements against a real database and must only ever " +
        "hold test credentials."
    );
  }
  if (!/^(sk|rk)_test_/.test(key)) {
    throw new Error(
      `refusing to run: the resolved Stripe key (${keyFingerprint(key)}) is neither sk_test_ nor ` +
        "rk_test_. server/_core/testModeFulfillment.ts would refuse it anyway."
    );
  }
  STRIPE_KEY = key;
  log(`      stripe key ${keyFingerprint(key)} from ${source}`);

  // Authentication is a live property, not a config-file property: a stale or
  // revoked key parses fine and fails on first use, halfway through a run.
  const probe = await stripe(["get", "/v1/events", "-d", "limit=1"]);
  if (probe.code !== 0) {
    throw new Error(
      "the Stripe CLI is not authenticated (a test API call was rejected). Run `stripe login`, " +
        `or supply a valid STRIPE_TEST_SECRET_KEY. Stripe said: ${stripAnsi(probe.stderr).trim().slice(0, 300)}`
    );
  }
  log("      stripe authentication verified (GET /v1/events)");
}

// ─── Stage 2: database ────────────────────────────────────────────────────────

async function startDatabase() {
  log("[2/6] Throwaway MySQL 8 container");
  await run("docker", ["rm", "-f", CONTAINER], { timeoutMs: 60_000 });
  const created = await run(
    "docker",
    [
      "run",
      "--detach",
      "--name",
      CONTAINER,
      "--publish",
      `127.0.0.1:${ARGS.mysqlPort}:3306`,
      "--env",
      "MYSQL_ALLOW_EMPTY_PASSWORD=1",
      "--env",
      `MYSQL_DATABASE=${DB_NAME}`,
      "mysql:8",
    ],
    { timeoutMs: 300_000 }
  );
  if (created.code !== 0) {
    throw new Error(
      `docker run failed: ${stripAnsi(created.stderr).trim().slice(0, 400)}`
    );
  }
  containerCreated = true;
  log(`      container ${CONTAINER} on 127.0.0.1:${ARGS.mysqlPort}`);

  await waitFor(
    "mysqladmin ping",
    async () => {
      const ping = await run(
        "docker",
        [
          "exec",
          CONTAINER,
          "mysqladmin",
          "ping",
          "-h",
          "127.0.0.1",
          "--silent",
        ],
        { timeoutMs: 15_000 }
      );
      return ping.code === 0;
    },
    { timeoutMs: 180_000, intervalMs: 2_000 }
  );

  db = await waitFor(
    "a MySQL connection from the host",
    async () =>
      mysql.createConnection({ uri: DATABASE_URL, multipleStatements: false }),
    { timeoutMs: 120_000, intervalMs: 2_000 }
  );
  log("      mysqladmin ping OK; host connection established");
}

async function replayMigrations() {
  log("[3/6] Replaying the full migration chain");
  const migrate = await run("node", ["scripts/reconciled-migrate.mjs"], {
    env: {
      ...process.env,
      MODE: "apply",
      CONFIRM: "RECONCILE",
      DATABASE_URL,
    },
    timeoutMs: 600_000,
  });
  if (migrate.code !== 0) {
    throw new Error(
      `reconciled-migrate failed (exit ${migrate.code}):\n${redact(stripAnsi(migrate.stdout).slice(-2000))}\n${redact(stripAnsi(migrate.stderr).slice(-2000))}`
    );
  }

  // Assert against the DATABASE, not the migrator's own success message.
  const journal = JSON.parse(
    readFileSync(resolve(REPO_ROOT, "drizzle/meta/_journal.json"), "utf8")
  );
  const newest = journal.entries[journal.entries.length - 1];
  const applied = Number(
    await scalar("SELECT COUNT(*) FROM `__drizzle_migrations`")
  );
  const newestApplied = Number(
    await scalar("SELECT MAX(created_at) FROM `__drizzle_migrations`")
  );
  if (
    applied !== journal.entries.length ||
    newestApplied !== Number(newest.when)
  ) {
    throw new Error(
      `migration chain did not reach the newest journal tag: applied=${applied} ` +
        `expected=${journal.entries.length}; newest_created_at=${newestApplied} ` +
        `expected=${newest.when} (${newest.tag})`
    );
  }
  log(`      ${applied} migrations applied; journal head = ${newest.tag}`);
}

async function seedFixture() {
  log("      seeding fixture (plan + recurring price + existing subscriber)");
  await query(
    "INSERT INTO subscription_plans (slug, name, description, planType, active, livemode, sortOrder) " +
      "VALUES (?, ?, ?, 'recurring', 1, 0, 0)",
    [PLAN_SLUG, "Stripe E2E Harness Plan", "Created by scripts/stripe-e2e.mjs"]
  );
  const planId = Number(
    await scalar("SELECT id FROM subscription_plans WHERE slug = ?", [
      PLAN_SLUG,
    ])
  );

  await query(
    "INSERT INTO plan_prices (planId, stripePriceId, label, amountCents, currency, billingInterval, " +
      "intervalCount, active, isDefault, hidden, livemode, sortOrder) " +
      "VALUES (?, ?, 'Monthly', 4900, 'usd', 'month', 1, 1, 1, 0, 0, 0)",
    [planId, SEED_STRIPE_PRICE]
  );
  SEED_PRICE_ID = Number(
    await scalar("SELECT id FROM plan_prices WHERE stripePriceId = ?", [
      SEED_STRIPE_PRICE,
    ])
  );

  // An EXISTING subscriber: hasAccess=0 so a grant is an observable transition,
  // and no stripeCustomerId yet so the grant is what binds it.
  await query(
    "INSERT INTO app_users (email, username, passwordHash, role, hasAccess, termsAccepted, tokenVersion, " +
      "cancelAtPeriodEnd, pendingSetup) VALUES (?, ?, ?, 'user', 0, 1, 1, 0, 0)",
    [
      `stripe-e2e+${RUN_ID}@example.invalid`,
      `stripe_e2e_${RUN_ID}`,
      "$2b$10$e2eharnessplaceholderhashvaluenotusableforlogin000000000",
    ]
  );
  SEED_USER_ID = Number(
    await scalar("SELECT id FROM app_users WHERE username = ?", [
      `stripe_e2e_${RUN_ID}`,
    ])
  );
  log(
    `      plan=${PLAN_SLUG}(id=${planId}) price=${SEED_PRICE_ID} subscriber=app_users.id=${SEED_USER_ID}`
  );
}

// ─── Stage 4: stripe listen + server ──────────────────────────────────────────

const listenState = { buffer: "", whsec: "", ready: false, tail: [] };
let listenChild = null;
let serverChild = null;
const serverTail = [];

async function startListener() {
  log("[4/6] Starting `stripe listen`");
  listenChild = spawnTracked(
    "stripe",
    ["listen", "--api-key", STRIPE_KEY, "--forward-to", WEBHOOK_URL],
    process.env
  );
  listenChild.stdout.on("data", chunk =>
    consumeListenOutput(chunk, listenState)
  );
  listenChild.stderr.on("data", chunk =>
    consumeListenOutput(chunk, listenState)
  );
  listenChild.on("close", code => {
    if (code !== 0 && code !== null)
      log(`      [stripe listen exited ${code}]`);
  });

  await waitFor(
    "`stripe listen` to report Ready and hand over a signing secret",
    async () => listenState.ready && listenState.whsec,
    { timeoutMs: 90_000, intervalMs: 500 }
  );
  // Printed as a shape, never as a value.
  log(
    `      listener ready; signing secret acquired (whsec_… ${listenState.whsec.length} chars)`
  );
}

async function startServer() {
  log("[5/6] Booting the server from source");
  serverChild = spawnTracked("npx", ["tsx", "server/_core/index.ts"], {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(ARGS.port),
    DATABASE_URL,
    STRIPE_SECRET_KEY: STRIPE_KEY,
    STRIPE_WEBHOOK_SECRET: listenState.whsec,
    // The three conditions of server/_core/testModeFulfillment.ts. All three
    // are satisfied here and cannot be satisfied by a production process.
    ALLOW_TEST_MODE_FULFILLMENT: "1",
    DISABLE_BACKGROUND_JOBS: "1",
    APP_SESSION_SECRET: `e2e-harness-${RUN_ID}-not-a-real-secret`,
    // Nothing outbound should fire; make the absence explicit rather than
    // inheriting whatever happens to be in the caller's shell.
    DISCORD_BOT_TOKEN: "",
    PUBLIC_ORIGIN: `http://localhost:${ARGS.port}`,
  });
  // Persisted as well as buffered. A check that fails mid-run needs the
  // server's own account of why, and a 400-line ring buffer that is only
  // printed on boot failure hides exactly that. Redacted on the way out, so
  // the file is safe to upload as a CI artifact.
  log(`      server output → ${SERVER_LOG_PATH}`);
  const collect = chunk => {
    const text = redact(stripAnsi(String(chunk)));
    try {
      appendFileSync(SERVER_LOG_PATH, text);
    } catch {
      /* logging must never break the run */
    }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      serverTail.push(line);
      if (serverTail.length > 400) serverTail.shift();
    }
  };
  serverChild.stdout.on("data", collect);
  serverChild.stderr.on("data", collect);

  // Deliberately NOT waitFor(): a crashed boot must fail in seconds with the
  // server's own output, not sit out a three-minute timeout.
  const deadline = Date.now() + 180_000;
  let healthy = false;
  while (Date.now() < deadline) {
    if (serverChild.exitCode !== null || serverChild.signalCode !== null) {
      throw new Error(
        `the server process exited (code=${serverChild.exitCode} signal=${serverChild.signalCode}) ` +
          `before ${HEALTH_URL} answered. Last output:\n` +
          redact(serverTail.slice(-40).join("\n"))
      );
    }
    try {
      const response = await fetch(HEALTH_URL);
      if (response.status === 200) {
        healthy = true;
        break;
      }
    } catch {
      /* not listening yet */
    }
    await sleep(1_000);
  }
  if (!healthy) {
    throw new Error(
      `${HEALTH_URL} never answered 200 within 180s. Last output:\n` +
        redact(serverTail.slice(-40).join("\n"))
    );
  }
  log(
    `      server healthy on :${ARGS.port} (test-mode fulfilment gate satisfied)`
  );
}

// ─── Stage 6: the battery ─────────────────────────────────────────────────────

const PLUMBING = "[plumbing] real Stripe delivery via `stripe listen`";
const SYNTHETIC =
  "[synthetic] locally signed with the listener's whsec — real HMAC, real handler, " +
  "real DB writes; origin is this script, not Stripe";
const NEGATIVE = "[negative] hostile request against the live endpoint";

/** Wait for a delivered event of `type` that appeared after `fromIndex`. */
async function awaitDelivery(type, fromIndex, timeoutMs = 90_000) {
  const found = await waitFor(
    `a delivered ${type} event`,
    async () => deliveriesOf(type, fromIndex)[0] ?? null,
    { timeoutMs, intervalMs: 500 }
  );
  return found.eventId;
}

/** Wait for the ledger to show the event, i.e. for the handler to have claimed it. */
async function awaitClaim(eventId, timeoutMs = 60_000) {
  return waitFor(
    `stripe_webhook_events to contain ${eventId}`,
    async () => {
      const rows = await ledgerRowsFor(eventId);
      return rows.length > 0 ? rows : null;
    },
    { timeoutMs, intervalMs: 500 }
  );
}

async function checkForgedSignature() {
  const before = await ledgerTotal();
  const event = syntheticEvent("checkout.session.completed", {
    id: `cs_forged_${RUN_ID}`,
    object: "checkout.session",
    payment_status: "paid",
    customer: SEED_CUSTOMER,
    client_reference_id: String(SEED_USER_ID),
    metadata: { price_id: SEED_STRIPE_PRICE },
  });
  const payload = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  // Structurally valid header, wrong HMAC — this tests signature verification,
  // not header parsing.
  const forged = `t=${timestamp},v1=${"0".repeat(64)}`;
  const response = await postWebhook(payload, forged);
  const after = await ledgerTotal();

  assertThat(
    "forged signature is rejected",
    response.status === 400,
    `HTTP ${response.status} (expected 400)`,
    NEGATIVE
  );
  assertThat(
    "forged signature writes no idempotency-ledger row",
    after === before,
    `stripe_webhook_events ${before} → ${after}`,
    NEGATIVE
  );
  assertThat(
    "forged signature grants nothing",
    Number((await seededUser())?.hasAccess) === 0,
    "app_users.hasAccess still 0",
    NEGATIVE
  );
}

async function checkMissingSignature() {
  const before = await ledgerTotal();
  const response = await postWebhook(
    JSON.stringify(
      syntheticEvent("checkout.session.completed", { id: "cs_nosig" })
    ),
    null
  );
  assertThat(
    "missing Stripe-Signature header is rejected",
    response.status === 400,
    `HTTP ${response.status} (expected 400)`,
    NEGATIVE
  );
  assertThat(
    "missing signature writes no idempotency-ledger row",
    (await ledgerTotal()) === before,
    `stripe_webhook_events unchanged at ${before}`,
    NEGATIVE
  );
}

/**
 * A REAL Stripe event, end to end. The canned fixture carries none of our
 * metadata (no client_reference_id, no plan/price we know), so it can never map
 * to the seeded subscriber — this check therefore asserts exactly what it can
 * prove and is reported PARTIAL. The entitlement transitions are proven by the
 * synthetic layer below.
 */
async function checkRealTrigger(eventType) {
  const fromIndex = DELIVERIES.length;
  const triggered = await stripe(["trigger", eventType], {
    timeoutMs: 120_000,
  });
  if (triggered.code !== 0) {
    record(
      `real \`stripe trigger ${eventType}\``,
      "FAIL",
      `the CLI failed: ${stripAnsi(triggered.stderr).trim().slice(0, 200)}`,
      PLUMBING
    );
    return null;
  }

  let eventId;
  try {
    eventId = await awaitDelivery(eventType, fromIndex);
  } catch (error) {
    record(
      `real \`stripe trigger ${eventType}\``,
      "FAIL",
      `no ${eventType} reached the endpoint: ${error.message}`,
      PLUMBING
    );
    return null;
  }

  let rows;
  try {
    rows = await awaitClaim(eventId);
  } catch (error) {
    record(
      `real \`stripe trigger ${eventType}\``,
      "FAIL",
      `${eventId} never appeared in stripe_webhook_events: ${error.message}`,
      PLUMBING
    );
    return null;
  }

  await sleep(1_500);
  rows = await ledgerRowsFor(eventId);
  const statuses = RESPONSES.get(eventId) ?? [];
  const ok =
    rows.length === 1 &&
    rows[0].status === "processed" &&
    Number(rows[0].livemode) === 0 &&
    statuses.length > 0 &&
    statuses.every(code => code === 200);

  record(
    `real \`stripe trigger ${eventType}\``,
    ok ? "PARTIAL" : "FAIL",
    ok
      ? `${eventId} claimed exactly once (status=processed, livemode=0) and answered ${statuses.join("/")} — ` +
          "Stripe's canned fixture carries no metadata mapping it to the seeded subscriber, so entitlement " +
          "state is NOT asserted here"
      : `${eventId}: ledgerRows=${rows.length} status=${rows[0]?.status} livemode=${rows[0]?.livemode} http=[${statuses.join(",")}]`,
    PLUMBING
  );
  return ok ? eventId : null;
}

/**
 * Replay of a REAL event. `stripe events resend` is attempted first (the thing
 * Stripe itself does on retry); a locally re-signed POST of the same event body
 * follows so the assertion is deterministic even if the CLI declines to
 * redeliver into an ephemeral listener.
 */
async function checkResendExactlyOnce(eventId) {
  if (!eventId) {
    record(
      "replay of a real event is a no-op",
      "FAIL",
      "skipped — the checkout.session.completed trigger did not produce an event to replay",
      PLUMBING
    );
    return;
  }
  const ledgerBefore = await ledgerTotal();
  const rowsBefore = await ledgerRowsFor(eventId);
  const entitlementsBefore = await entitlementRowsFor(eventId);
  const userBefore = JSON.stringify(await seededUser());

  const resend = await stripe(["events", "resend", eventId], {
    timeoutMs: 90_000,
  });
  const resentByCli = resend.code === 0;

  let replayStatus = null;
  try {
    const event = await stripeJson(["get", `/v1/events/${eventId}`]);
    const replay = await deliverSigned(event, listenState.whsec);
    replayStatus = replay.status;
  } catch (error) {
    record(
      "replay of a real event is a no-op",
      "FAIL",
      `could not re-deliver ${eventId}: ${error.message}`,
      PLUMBING
    );
    return;
  }
  await sleep(2_500);

  const rowsAfter = await ledgerRowsFor(eventId);
  const entitlementsAfter = await entitlementRowsFor(eventId);
  const userAfter = JSON.stringify(await seededUser());
  const ledgerAfter = await ledgerTotal();

  // THE exactly-once assertion for a Stripe-originated event.
  assertThat(
    "replayed real event stays claimed exactly once",
    rowsBefore.length === 1 && rowsAfter.length === 1,
    `stripe_webhook_events rows for ${eventId}: ${rowsBefore.length} → ${rowsAfter.length} ` +
      `(resend accepted by CLI: ${resentByCli}; local re-signed replay answered HTTP ${replayStatus})`,
    PLUMBING
  );
  assertThat(
    "replayed real event acknowledged, not errored",
    replayStatus === 200,
    `HTTP ${replayStatus} (expected 200 — a duplicate must be acked, never retried forever)`,
    PLUMBING
  );
  assertThat(
    "replayed real event produced no new side effects",
    entitlementsAfter.length === entitlementsBefore.length &&
      userAfter === userBefore,
    `entitlement_events ${entitlementsBefore.length} → ${entitlementsAfter.length}; ` +
      `app_users row ${userAfter === userBefore ? "unchanged" : "MUTATED"}`,
    PLUMBING
  );

  // The global ledger total is deliberately NOT asserted to be unchanged here.
  // One `stripe trigger checkout.session.completed` emits a whole cascade —
  // product.created, price.created, payment_intent.created, charge.succeeded,
  // charge.updated, payment_intent.succeeded — and `stripe listen` forwards all
  // of them asynchronously, so siblings legitimately land mid-replay. Asserting
  // the total made this check fail for a reason unrelated to idempotency.
  //
  // The invariant that actually matters is stronger and timing-independent: no
  // stripeEventId may EVER appear twice in the ledger, cascade or not.
  const dupes = await duplicateLedgerEventIds();
  assertThat(
    "no event id appears twice anywhere in the ledger",
    dupes.length === 0,
    dupes.length === 0
      ? `every stripeEventId across all ${ledgerAfter} claimed events is unique ` +
          `(total moved ${ledgerBefore} → ${ledgerAfter} during the replay window — ` +
          `unrelated cascade siblings from \`stripe trigger\`, not redeliveries)`
      : `DUPLICATED: ${dupes.map(d => `${d.stripeEventId}×${d.c}`).join(", ")}`,
    PLUMBING
  );
}

/**
 * The grant. Bound to the seeded subscriber via client_reference_id, and to the
 * seeded plan_prices row via metadata.price_id — the exact pairing a real
 * checkout produces, and the only way a canned fixture cannot express.
 */
async function checkSyntheticGrant() {
  const event = syntheticEvent("checkout.session.completed", {
    id: `cs_e2e_${RUN_ID}`,
    object: "checkout.session",
    mode: "subscription",
    payment_status: "paid",
    status: "complete",
    customer: SEED_CUSTOMER,
    subscription: SEED_SUBSCRIPTION,
    client_reference_id: String(SEED_USER_ID),
    customer_details: { email: `stripe-e2e+${RUN_ID}@example.invalid` },
    metadata: { price_id: SEED_STRIPE_PRICE, plan_id: PLAN_SLUG },
    custom_fields: [],
  });

  const response = await deliverSigned(event, listenState.whsec);
  await awaitClaim(event.id);
  const user = await waitFor(
    "app_users to show the granted entitlement",
    async () => {
      const row = await seededUser();
      return row && Number(row.hasAccess) === 1 ? row : null;
    },
    { timeoutMs: 30_000, intervalMs: 500 }
  );
  // The audit row is written after the entitlement update; give it a moment so
  // this asserts an absent row, not a slow one.
  await sleep(1_500);
  const entitlements = await entitlementRowsFor(event.id);

  assertThat(
    "checkout.session.completed is acknowledged 200",
    response.status === 200,
    `HTTP ${response.status}`,
    SYNTHETIC
  );
  assertThat(
    "checkout.session.completed GRANTS access to the seeded subscriber",
    Number(user.hasAccess) === 1 &&
      user.stripeCustomerId === SEED_CUSTOMER &&
      user.stripeSubscriptionId === SEED_SUBSCRIPTION &&
      user.stripePlanId === PLAN_SLUG &&
      Number(user.planPriceId) === SEED_PRICE_ID &&
      Number(user.expiryDate) > Date.now(),
    `app_users.id=${SEED_USER_ID}: hasAccess=${user.hasAccess} plan=${user.stripePlanId} ` +
      `planPriceId=${user.planPriceId} customer=${user.stripeCustomerId} ` +
      `expiry=${new Date(Number(user.expiryDate)).toISOString()}`,
    SYNTHETIC
  );
  assertThat(
    "the grant is written to the entitlement audit trail",
    entitlements.length === 1 &&
      entitlements[0].reason === "GRANT" &&
      Number(entitlements[0].afterHasAccess) === 1,
    `entitlement_events rows for ${event.id}: ${entitlements.length} ` +
      `(reason=${entitlements[0]?.reason} after=${entitlements[0]?.afterHasAccess})`,
    SYNTHETIC
  );
  return { event, user };
}

/**
 * THE assertion this whole file exists for. Stripe delivers at least once, this
 * handler answers 5xx on failure to invite redelivery, and the entire money path
 * therefore depends on the second delivery of an identical event changing
 * nothing at all — not the ledger, not the audit trail, and above all not the
 * expiry date, which a naive re-apply would extend by another month for free.
 */
async function checkSyntheticExactlyOnce(grant) {
  const before = await seededUser();
  const ledgerBefore = await ledgerTotal();
  const entitlementsBefore = await entitlementRowsFor(grant.event.id);

  const response = await deliverSigned(grant.event, listenState.whsec);
  await sleep(2_500);

  const after = await seededUser();
  const rows = await ledgerRowsFor(grant.event.id);
  const entitlementsAfter = await entitlementRowsFor(grant.event.id);
  const ledgerAfter = await ledgerTotal();

  assertThat(
    "identical redelivery is acknowledged 200, not retried",
    response.status === 200,
    `HTTP ${response.status}`,
    SYNTHETIC
  );
  assertThat(
    "EXACTLY-ONCE: identical redelivery adds no ledger row",
    rows.length === 1 && ledgerAfter === ledgerBefore,
    `rows for ${grant.event.id}: ${rows.length}; ledger total ${ledgerBefore} → ${ledgerAfter}`,
    SYNTHETIC
  );
  assertThat(
    "EXACTLY-ONCE: identical redelivery does not re-extend the expiry date",
    Number(before.expiryDate) === Number(after.expiryDate),
    `expiryDate ${before.expiryDate} → ${after.expiryDate}`,
    SYNTHETIC
  );
  assertThat(
    "EXACTLY-ONCE: identical redelivery writes no second audit row",
    entitlementsAfter.length === entitlementsBefore.length,
    `entitlement_events for ${grant.event.id}: ${entitlementsBefore.length} → ${entitlementsAfter.length}`,
    SYNTHETIC
  );
}

/** Revoke. Keyed on stripeCustomerId, which the grant above just bound. */
async function checkSyntheticRevoke() {
  const event = syntheticEvent("customer.subscription.deleted", {
    id: SEED_SUBSCRIPTION,
    object: "subscription",
    status: "canceled",
    customer: SEED_CUSTOMER,
  });
  const response = await deliverSigned(event, listenState.whsec);
  await awaitClaim(event.id);
  const user = await waitFor(
    "app_users to show access revoked",
    async () => {
      const row = await seededUser();
      return row && Number(row.hasAccess) === 0 ? row : null;
    },
    { timeoutMs: 30_000, intervalMs: 500 }
  );
  await sleep(1_500);
  const entitlements = await entitlementRowsFor(event.id);

  assertThat(
    "customer.subscription.deleted REVOKES access",
    response.status === 200 &&
      Number(user.hasAccess) === 0 &&
      user.stripeSubscriptionId === null &&
      user.stripePlanId === null,
    `HTTP ${response.status}; app_users.id=${SEED_USER_ID} hasAccess=${user.hasAccess} ` +
      `stripeSubscriptionId=${user.stripeSubscriptionId} stripePlanId=${user.stripePlanId}`,
    SYNTHETIC
  );
  assertThat(
    "the revoke is written to the entitlement audit trail",
    entitlements.length === 1 &&
      entitlements[0].reason === "SUBSCRIPTION_DELETED" &&
      Number(entitlements[0].beforeHasAccess) === 1 &&
      Number(entitlements[0].afterHasAccess) === 0,
    `entitlement_events rows for ${event.id}: ${entitlements.length} ` +
      `(reason=${entitlements[0]?.reason} ${entitlements[0]?.beforeHasAccess}→${entitlements[0]?.afterHasAccess})`,
    SYNTHETIC
  );
  const subRows = await subscriptionRowsFor(event.id);
  assertThat(
    "the deletion lands in subscription_events as deleted/revoked",
    subRows.length === 1 &&
      subRows[0].kind === "deleted" &&
      subRows[0].outcome === "revoked",
    `subscription_events rows for ${event.id}: ${subRows.length} ` +
      `(kind=${subRows[0]?.kind} outcome=${subRows[0]?.outcome})`,
    SYNTHETIC
  );
}

/**
 * Subscription lifecycle ledger (avenues #3/#4/#8). Proves the transitions that
 * previously left no local trace: a Customer Portal plan switch (which never
 * touches our API — only customer.subscription.updated with
 * previous_attributes.items betrays it), a scheduled cancellation, and a
 * renewal. Each asserts DATABASE STATE in subscription_events, including the
 * exactly-once guarantee on redelivery.
 */
async function subscriptionRowsFor(eventId) {
  return query(
    "SELECT kind, outcome, outcomeReason, fromPriceId, toPriceId, cancelAtPeriodEnd, periodEnd, actor FROM subscription_events WHERE stripeEventId = ?",
    [eventId]
  );
}

async function checkSubscriptionLifecycleLedger() {
  // ── 1. Portal-style plan change ────────────────────────────────────────────
  const NEW_PRICE = `price_e2e_new_${RUN_ID}`;
  const planChange = syntheticEvent(
    "customer.subscription.updated",
    {
      id: SEED_SUBSCRIPTION,
      object: "subscription",
      status: "active",
      customer: SEED_CUSTOMER,
      cancel_at_period_end: false,
      items: {
        data: [{ price: { id: NEW_PRICE, recurring: { interval: "year" } } }],
      },
      metadata: {},
    },
    // previous_attributes rides on event.data next to object — exactly how the
    // Portal's plan switch arrives, and the ONLY evidence of the old price.
    {}
  );
  planChange.data.previous_attributes = {
    items: {
      data: [
        { price: { id: SEED_STRIPE_PRICE, recurring: { interval: "month" } } },
      ],
    },
  };

  let response = await deliverSigned(planChange, listenState.whsec);
  await awaitClaim(planChange.id);
  await sleep(1_500);
  let rows = await subscriptionRowsFor(planChange.id);

  assertThat(
    "a Portal-style plan change lands in subscription_events as plan_changed with both price ids",
    response.status === 200 &&
      rows.length === 1 &&
      rows[0].kind === "plan_changed" &&
      rows[0].fromPriceId === SEED_STRIPE_PRICE &&
      rows[0].toPriceId === NEW_PRICE,
    `HTTP ${response.status}; rows=${rows.length} kind=${rows[0]?.kind} ` +
      `${rows[0]?.fromPriceId}→${rows[0]?.toPriceId}`,
    SYNTHETIC
  );

  // Redelivery through the endpoint: absorbed by the stripe_webhook_events
  // claim BEFORE the ledger is reached — the first line of defence.
  await deliverSigned(planChange, listenState.whsec);
  await sleep(1_500);
  rows = await subscriptionRowsFor(planChange.id);
  assertThat(
    "EXACTLY-ONCE: redelivered plan change adds no second subscription_events row (claim guard)",
    rows.length === 1,
    `rows for ${planChange.id}: ${rows.length}`,
    SYNTHETIC
  );

  // The ledger's OWN unique key, proven at the database — the claim guard
  // filters endpoint redeliveries, so the (stripeEventId, kind) constraint is
  // belt-and-braces that an HTTP test can never reach. Assert both halves of
  // its semantics: a same-key insert is refused, and NULL-eventId rows
  // (app-initiated actions) are exempt so repeated member actions all record.
  let dupRefused = false;
  try {
    await query(
      "INSERT INTO subscription_events (stripeEventId, eventType, livemode, stripeSubscriptionId, kind, outcome, actor, occurredAt, recordedAt) VALUES (?, 'customer.subscription.updated', 0, ?, 'plan_changed', 'recorded', 'webhook', ?, ?)",
      [planChange.id, SEED_SUBSCRIPTION, Date.now(), Date.now()]
    );
  } catch (err) {
    dupRefused = err?.errno === 1062;
  }
  assertThat(
    "EXACTLY-ONCE: the (stripeEventId, kind) unique key itself refuses a duplicate (ER_DUP_ENTRY)",
    dupRefused,
    dupRefused
      ? "duplicate INSERT refused with errno 1062"
      : "duplicate INSERT was ACCEPTED — unique key missing or wrong",
    SYNTHETIC
  );
  const nullRowsBefore = Number(
    await scalar(
      "SELECT COUNT(*) FROM subscription_events WHERE stripeEventId IS NULL"
    )
  );
  await query(
    "INSERT INTO subscription_events (stripeEventId, eventType, livemode, stripeSubscriptionId, kind, outcome, actor, occurredAt, recordedAt) VALUES (NULL, 'app.cancel_requested', 0, ?, 'cancel_scheduled', 'recorded', 'user', ?, ?)",
    [SEED_SUBSCRIPTION, Date.now(), Date.now()]
  );
  await query(
    "INSERT INTO subscription_events (stripeEventId, eventType, livemode, stripeSubscriptionId, kind, outcome, actor, occurredAt, recordedAt) VALUES (NULL, 'app.cancel_requested', 0, ?, 'cancel_scheduled', 'recorded', 'user', ?, ?)",
    [SEED_SUBSCRIPTION, Date.now(), Date.now()]
  );
  const nullRowsAfter = Number(
    await scalar(
      "SELECT COUNT(*) FROM subscription_events WHERE stripeEventId IS NULL"
    )
  );
  assertThat(
    "app-initiated rows (NULL stripeEventId) are exempt from the unique key — repeated member actions all record",
    nullRowsAfter === nullRowsBefore + 2,
    `NULL-eventId rows ${nullRowsBefore} → ${nullRowsAfter} (expected +2)`,
    SYNTHETIC
  );

  // ── 2. Scheduled cancellation (the webhook mirror of the in-app mutation) ──
  const cancelSched = syntheticEvent("customer.subscription.updated", {
    id: SEED_SUBSCRIPTION,
    object: "subscription",
    status: "active",
    customer: SEED_CUSTOMER,
    cancel_at_period_end: true,
    cancel_at: Math.floor(Date.now() / 1000) + 14 * 86400,
    items: {
      data: [{ price: { id: NEW_PRICE, recurring: { interval: "year" } } }],
    },
    metadata: {},
  });
  cancelSched.data.previous_attributes = { cancel_at_period_end: false };

  response = await deliverSigned(cancelSched, listenState.whsec);
  await awaitClaim(cancelSched.id);
  await sleep(1_500);
  rows = await subscriptionRowsFor(cancelSched.id);
  assertThat(
    "a scheduled cancellation lands as cancel_scheduled with the period end it dies at",
    response.status === 200 &&
      rows.length === 1 &&
      rows[0].kind === "cancel_scheduled" &&
      Number(rows[0].cancelAtPeriodEnd) === 1 &&
      Number(rows[0].periodEnd) > Date.now(),
    `HTTP ${response.status}; rows=${rows.length} kind=${rows[0]?.kind} ` +
      `capE=${rows[0]?.cancelAtPeriodEnd} periodEnd=${rows[0]?.periodEnd}`,
    SYNTHETIC
  );

  // ── 3. Renewal (invoice.paid, billing_reason=subscription_cycle) ───────────
  const periodEndSec = Math.floor(Date.now() / 1000) + 30 * 86400;
  const renewal = syntheticEvent("invoice.paid", {
    id: `in_e2e_${RUN_ID}`,
    object: "invoice",
    customer: SEED_CUSTOMER,
    billing_reason: "subscription_cycle",
    amount_paid: 4900,
    amount_due: 4900,
    currency: "usd",
    customer_email: `stripe-e2e+${RUN_ID}@example.invalid`,
    lines: {
      data: [
        { period: { end: periodEndSec }, price: { id: SEED_STRIPE_PRICE } },
      ],
    },
    parent: { subscription_details: { subscription: SEED_SUBSCRIPTION } },
  });

  response = await deliverSigned(renewal, listenState.whsec);
  await awaitClaim(renewal.id);
  await sleep(1_500);
  rows = await subscriptionRowsFor(renewal.id);
  const renewedUser = await seededUser();
  assertThat(
    "a renewal lands as renewed/granted and the row names the period it bought",
    response.status === 200 &&
      rows.length === 1 &&
      rows[0].kind === "renewed" &&
      rows[0].outcome === "granted" &&
      Number(rows[0].periodEnd) === periodEndSec * 1000,
    `HTTP ${response.status}; rows=${rows.length} kind=${rows[0]?.kind} outcome=${rows[0]?.outcome} ` +
      `periodEnd=${rows[0]?.periodEnd} (billed to ${periodEndSec * 1000})`,
    SYNTHETIC
  );
  assertThat(
    "NO-GRACE: the renewal expiry is Stripe's billed period end EXACTLY — zero buffer",
    Number(renewedUser.expiryDate) === periodEndSec * 1000,
    `expiryDate=${renewedUser.expiryDate} vs billed period end ${periodEndSec * 1000} ` +
      `(delta ${Number(renewedUser.expiryDate) - periodEndSec * 1000}ms — must be 0)`,
    SYNTHETIC
  );
}

/**
 * The avenue-#12 handlers that are DORMANT in production until the owner
 * subscribes their events on the live endpoint. Proving them here means the
 * day they are subscribed, they are already known-good — not hoped-good.
 * None of these change entitlement; each must record its row and leave
 * app_users untouched.
 */
async function checkDormantEventHandlers() {
  const accessBefore = (await seededUser()).hasAccess;

  // trial_will_end → subscription_events kind=trial_ending, access unchanged.
  const trial = syntheticEvent("customer.subscription.trial_will_end", {
    id: SEED_SUBSCRIPTION,
    object: "subscription",
    status: "trialing",
    customer: SEED_CUSTOMER,
    cancel_at_period_end: false,
    trial_end: Math.floor(Date.now() / 1000) + 3 * 86400,
    items: {
      data: [
        { price: { id: SEED_STRIPE_PRICE, recurring: { interval: "month" } } },
      ],
    },
  });
  let response = await deliverSigned(trial, listenState.whsec);
  await awaitClaim(trial.id);
  await sleep(1_500);
  let rows = await subscriptionRowsFor(trial.id);
  assertThat(
    "trial_will_end records trial_ending/noop with the trial's end date",
    response.status === 200 &&
      rows.length === 1 &&
      rows[0].kind === "trial_ending" &&
      rows[0].outcome === "noop" &&
      Number(rows[0].periodEnd) > Date.now(),
    `HTTP ${response.status}; rows=${rows.length} kind=${rows[0]?.kind} outcome=${rows[0]?.outcome} periodEnd=${rows[0]?.periodEnd}`,
    SYNTHETIC
  );

  // invoice.upcoming → renewal_upcoming. A PREVIEW: the invoice has no id.
  const upcoming = syntheticEvent("invoice.upcoming", {
    id: null,
    object: "invoice",
    customer: SEED_CUSTOMER,
    amount_due: 4900,
    currency: "usd",
    period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
    parent: { subscription_details: { subscription: SEED_SUBSCRIPTION } },
  });
  response = await deliverSigned(upcoming, listenState.whsec);
  await awaitClaim(upcoming.id);
  await sleep(1_500);
  rows = await subscriptionRowsFor(upcoming.id);
  assertThat(
    "invoice.upcoming records renewal_upcoming/noop despite the preview having no invoice id",
    response.status === 200 &&
      rows.length === 1 &&
      rows[0].kind === "renewal_upcoming" &&
      rows[0].outcome === "noop",
    `HTTP ${response.status}; rows=${rows.length} kind=${rows[0]?.kind} outcome=${rows[0]?.outcome}`,
    SYNTHETIC
  );

  // charge.dispute.closed (won) → payment_events row; access deliberately NOT
  // auto-restored. The charge lookup against Stripe will fail for this fake
  // ch_ id — the handler must degrade to an unresolved customer, not an error.
  const dispute = syntheticEvent("charge.dispute.closed", {
    id: `dp_e2e_${RUN_ID}`,
    object: "dispute",
    status: "won",
    charge: `ch_e2e_nonexistent_${RUN_ID}`,
    amount: 4900,
    currency: "usd",
    reason: "fraudulent",
  });
  response = await deliverSigned(dispute, listenState.whsec);
  await awaitClaim(dispute.id);
  await sleep(1_500);
  const payRows = await query(
    "SELECT kind, outcome, outcomeReason FROM payment_events WHERE stripeEventId = ?",
    [dispute.id]
  );
  const accessAfter = (await seededUser()).hasAccess;
  assertThat(
    "dispute.closed(won) records disputed/noop and does NOT auto-restore access",
    response.status === 200 &&
      payRows.length === 1 &&
      payRows[0].kind === "disputed" &&
      payRows[0].outcome === "noop" &&
      /WON/.test(payRows[0].outcomeReason ?? "") &&
      Number(accessAfter) === Number(accessBefore),
    `HTTP ${response.status}; rows=${payRows.length} kind=${payRows[0]?.kind} outcome=${payRows[0]?.outcome} ` +
      `hasAccess ${accessBefore}→${accessAfter}`,
    SYNTHETIC
  );
}

/** Refund. Money went back, so entitlement must follow it (WBHK-004). */
async function checkSyntheticRefund() {
  // Re-grant first so the revoke is an observable 1 → 0 transition rather than
  // a no-op against an already-revoked row.
  await query(
    "UPDATE app_users SET hasAccess = 1, stripePlanId = ?, stripeSubscriptionId = ?, lastStripeEventAt = NULL WHERE id = ?",
    [PLAN_SLUG, SEED_SUBSCRIPTION, SEED_USER_ID]
  );

  const event = syntheticEvent("charge.refunded", {
    id: `ch_e2e_${RUN_ID}`,
    object: "charge",
    customer: SEED_CUSTOMER,
    amount: 4900,
    amount_refunded: 4900,
    refunded: true,
    currency: "usd",
  });
  const response = await deliverSigned(event, listenState.whsec);
  await awaitClaim(event.id);
  const user = await waitFor(
    "app_users to show access revoked after the refund",
    async () => {
      const row = await seededUser();
      return row && Number(row.hasAccess) === 0 ? row : null;
    },
    { timeoutMs: 30_000, intervalMs: 500 }
  );
  await sleep(1_500);
  const entitlements = await entitlementRowsFor(event.id);

  assertThat(
    "fully refunded charge REVOKES access",
    response.status === 200 && Number(user.hasAccess) === 0,
    `HTTP ${response.status}; app_users.id=${SEED_USER_ID} hasAccess=${user.hasAccess}`,
    SYNTHETIC
  );
  assertThat(
    "the refund revoke is written to the entitlement audit trail",
    entitlements.length === 1 && entitlements[0].reason === "CHARGE_REFUNDED",
    `entitlement_events rows for ${event.id}: ${entitlements.length} ` +
      `(reason=${entitlements[0]?.reason})`,
    SYNTHETIC
  );
}

/**
 * NO-GRACE POLICY (owner directive, 2026-08-01): a declined subscription
 * payment ends the membership at the moment of failure — no Smart-Retry
 * window, no expiry-buffer ride-out. Two triggers, both proven here:
 * invoice.payment_failed (the decline itself) and a past_due status move
 * (the same fact arriving as a subscription update). The Stripe-side
 * subscriptions.cancel targets a fake sub id and FAILS — asserting the local
 * revoke stands regardless is the resilience property that matters.
 */
async function checkNoGraceDecline() {
  // Re-arm: grant + bind the subscription (the refund scenario left 0).
  await query(
    "UPDATE app_users SET hasAccess = 1, stripePlanId = ?, stripeSubscriptionId = ?, stripeCustomerId = ?, lastStripeEventAt = NULL WHERE id = ?",
    [PLAN_SLUG, SEED_SUBSCRIPTION, SEED_CUSTOMER, SEED_USER_ID]
  );

  const declined = syntheticEvent("invoice.payment_failed", {
    id: `in_e2e_fail_${RUN_ID}`,
    object: "invoice",
    customer: SEED_CUSTOMER,
    billing_reason: "subscription_cycle",
    amount_due: 4900,
    currency: "usd",
    attempt_count: 1,
    customer_email: `stripe-e2e+${RUN_ID}@example.invalid`,
    parent: { subscription_details: { subscription: SEED_SUBSCRIPTION } },
  });
  let response = await deliverSigned(declined, listenState.whsec);
  await awaitClaim(declined.id);
  const declinedUser = await waitFor(
    "app_users to show access revoked at the decline",
    async () => {
      const row = await seededUser();
      return row && Number(row.hasAccess) === 0 ? row : null;
    },
    { timeoutMs: 30_000, intervalMs: 500 }
  );
  await sleep(1_500);
  const payRows = await query(
    "SELECT kind, outcome, outcomeReason FROM payment_events WHERE stripeEventId = ?",
    [declined.id]
  );
  const subRows = await subscriptionRowsFor(declined.id);
  const audit = await entitlementRowsFor(declined.id);

  assertThat(
    "NO-GRACE: a declined renewal REVOKES access at the moment of failure",
    response.status === 200 && Number(declinedUser.hasAccess) === 0,
    `HTTP ${response.status}; app_users.id=${SEED_USER_ID} hasAccess=${declinedUser.hasAccess}`,
    SYNTHETIC
  );
  assertThat(
    "NO-GRACE: the decline is a revoked money fact AND a payment_failed lifecycle fact",
    payRows.length === 1 &&
      payRows[0].kind === "failed" &&
      payRows[0].outcome === "revoked" &&
      subRows.length === 1 &&
      subRows[0].kind === "payment_failed" &&
      subRows[0].outcome === "revoked",
    `payment_events: ${payRows.length} (${payRows[0]?.kind}/${payRows[0]?.outcome}); ` +
      `subscription_events: ${subRows.length} (${subRows[0]?.kind}/${subRows[0]?.outcome})`,
    SYNTHETIC
  );
  assertThat(
    "NO-GRACE: the revoke survives a failed Stripe-side cancel (fake sub id) and is audited",
    audit.length === 1 &&
      audit[0].reason === "PAYMENT_FAILED_NO_GRACE" &&
      Number(audit[0].beforeHasAccess) === 1 &&
      Number(audit[0].afterHasAccess) === 0,
    `entitlement_events for ${declined.id}: ${audit.length} ` +
      `(reason=${audit[0]?.reason} ${audit[0]?.beforeHasAccess}→${audit[0]?.afterHasAccess})`,
    SYNTHETIC
  );

  // ── The same fact arriving as a status move ────────────────────────────────
  await query(
    "UPDATE app_users SET hasAccess = 1, stripePlanId = ?, stripeSubscriptionId = ?, lastStripeEventAt = NULL WHERE id = ?",
    [PLAN_SLUG, SEED_SUBSCRIPTION, SEED_USER_ID]
  );
  const pastDue = syntheticEvent("customer.subscription.updated", {
    id: SEED_SUBSCRIPTION,
    object: "subscription",
    status: "past_due",
    customer: SEED_CUSTOMER,
    cancel_at_period_end: false,
    items: {
      data: [
        { price: { id: SEED_STRIPE_PRICE, recurring: { interval: "month" } } },
      ],
    },
    metadata: {},
  });
  pastDue.data.previous_attributes = { status: "active" };
  response = await deliverSigned(pastDue, listenState.whsec);
  await awaitClaim(pastDue.id);
  const pastDueUser = await waitFor(
    "app_users to show access revoked on past_due",
    async () => {
      const row = await seededUser();
      return row && Number(row.hasAccess) === 0 ? row : null;
    },
    { timeoutMs: 30_000, intervalMs: 500 }
  );
  await sleep(1_500);
  const pdRows = await subscriptionRowsFor(pastDue.id);
  assertThat(
    "NO-GRACE: past_due status move REVOKES and records status_changed/revoked",
    response.status === 200 &&
      Number(pastDueUser.hasAccess) === 0 &&
      pdRows.length === 1 &&
      pdRows[0].kind === "status_changed" &&
      pdRows[0].outcome === "revoked",
    `HTTP ${response.status}; hasAccess=${pastDueUser.hasAccess}; ` +
      `subscription_events: ${pdRows.length} (${pdRows[0]?.kind}/${pdRows[0]?.outcome})`,
    SYNTHETIC
  );
}

async function runBattery() {
  log("[6/6] Battery");

  log("    · negative cases");
  await checkForgedSignature();
  await checkMissingSignature();

  log("    · real Stripe deliveries");
  const checkoutEventId = await checkRealTrigger("checkout.session.completed");
  await checkResendExactlyOnce(checkoutEventId);
  await checkRealTrigger("customer.subscription.deleted");
  await checkRealTrigger("charge.refunded");

  log("    · fulfilment against the seeded subscriber");
  const grant = await checkSyntheticGrant();
  await checkSyntheticExactlyOnce(grant);
  log("    · subscription lifecycle ledger");
  await checkSubscriptionLifecycleLedger();
  await checkSyntheticRevoke();
  await checkSyntheticRefund();
  log("    · dormant avenue-12 handlers");
  await checkDormantEventHandlers();
  log("    · no-grace decline policy");
  await checkNoGraceDecline();
}

// ─── Teardown ─────────────────────────────────────────────────────────────────

let tornDown = false;

async function teardown() {
  if (tornDown) return;
  tornDown = true;

  if (ARGS.keep) {
    log("");
    log("--keep: leaving everything running.");
    log(
      `  server pid       ${serverChild?.pid ?? "(not started)"} on :${ARGS.port}`
    );
    log(`  stripe listen pid ${listenChild?.pid ?? "(not started)"}`);
    log(`  database         ${DATABASE_URL}`);
    log(
      `  stop it all      kill ${[serverChild?.pid, listenChild?.pid].filter(Boolean).join(" ")}; docker rm -f ${CONTAINER}`
    );
    return;
  }

  log("");
  log("[teardown]");
  await killTracked(serverChild);
  await killTracked(listenChild);
  try {
    if (db) await db.end();
  } catch {
    /* connection already dead */
  }
  if (!containerCreated) {
    log("      no container was created — nothing to remove");
    return;
  }
  const removed = await run("docker", ["rm", "-f", CONTAINER], {
    timeoutMs: 120_000,
  });
  log(
    removed.code === 0
      ? `      removed container ${CONTAINER}`
      : `      WARNING: could not remove ${CONTAINER} — remove it by hand: docker rm -f ${CONTAINER}`
  );
}

// ─── Summary ──────────────────────────────────────────────────────────────────

function printSummary() {
  const failed = CHECKS.filter(check => check.status === "FAIL");
  const partial = CHECKS.filter(check => check.status === "PARTIAL");
  const passed = CHECKS.filter(check => check.status === "PASS");

  log("");
  log("═".repeat(78));
  log(" STRIPE END-TO-END HARNESS — RESULTS");
  log("═".repeat(78));
  for (const check of CHECKS) {
    log(` ${check.status.padEnd(7)} ${check.name}`);
    log(`         ${check.detail}`);
    if (check.coverage) log(`         coverage: ${check.coverage}`);
  }
  log("─".repeat(78));
  log(
    ` ${passed.length} passed · ${partial.length} partial · ${failed.length} failed ` +
      `· ${CHECKS.length} total`
  );
  if (partial.length > 0) {
    log("");
    log(
      " PARTIAL means the check proved delivery + exactly-once claiming but could NOT"
    );
    log(
      " assert entitlement state, because Stripe's canned trigger fixtures carry none"
    );
    log(
      " of this application's metadata. Those transitions are proven separately by the"
    );
    log(
      " [synthetic] checks above — read the coverage line on each row, not the count."
    );
  }
  if (failed.length > 0) {
    // A failing check is only actionable with the server's own account of what
    // happened. Surface the lines that explain a 5xx rather than making the
    // reader re-run with --keep to find them.
    log("");
    log(" SERVER OUTPUT (error lines) — full log: " + SERVER_LOG_PATH);
    const interesting = serverTail.filter(line =>
      /FAILED|Error|error|5xx|Duplicate|stack|at\s+\w+\s+\(/.test(line)
    );
    const shown = (interesting.length > 0 ? interesting : serverTail).slice(
      -25
    );
    for (const line of shown) log("   " + line);
  }
  log("═".repeat(78));
  return failed.length;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

// ─── Test-clock lifecycle (--test-clock) ──────────────────────────────────────
/**
 * The strongest simulation that exists without live money: STRIPE'S OWN
 * BILLING ENGINE generates the entire life of a subscription on a frozen,
 * advanceable clock — trial start, automatic conversion charge, a full
 * renewal, then a failing card and the no-grace death. Nothing here is a
 * synthetic payload: every event is authored, signed, and delivered by
 * Stripe, so this also proves the handler against the payload SHAPES the
 * pinned API version really produces (parent.subscription_details,
 * lines[].period.end, item-level current_period_end — the fields synthetic
 * fixtures can silently get wrong).
 *
 * Runs against the same booted production-source server as the battery, with
 * the testModeFulfillment gate legitimately satisfied (test key, local DB,
 * explicit flag).
 */
const CLOCK_COVERAGE =
  "[test-clock] Stripe-authored lifecycle via a frozen billing clock — real engine, real payload shapes, real deliveries";

async function stripePost(path, params) {
  const args = [
    "curl",
    "-sS",
    "-u",
    `${STRIPE_KEY}:`,
    "-X",
    "POST",
    `https://api.stripe.com/v1/${path}`,
  ];
  for (const [k, v] of params) args.push("-d", `${k}=${v}`);
  const out = await run(args[0], args.slice(1), { timeoutMs: 30_000 });
  const parsed = JSON.parse(out.stdout);
  if (parsed.error) throw new Error(`${path}: ${parsed.error.message}`);
  return parsed;
}
async function stripeGet(path) {
  const out = await run(
    "curl",
    ["-sS", "-u", `${STRIPE_KEY}:`, `https://api.stripe.com/v1/${path}`],
    { timeoutMs: 30_000 }
  );
  const parsed = JSON.parse(out.stdout);
  if (parsed.error) throw new Error(`${path}: ${parsed.error.message}`);
  return parsed;
}
/** Advance the clock and wait until Stripe finishes settling it. */
async function advanceClock(clockId, toSec) {
  await stripePost(`test_helpers/test_clocks/${clockId}/advance`, [
    ["frozen_time", String(toSec)],
  ]);
  await waitFor(
    `test clock to settle at ${new Date(toSec * 1000).toISOString()}`,
    async () => {
      const c = await stripeGet(`test_helpers/test_clocks/${clockId}`);
      return c.status === "ready" ? c : null;
    },
    { timeoutMs: 180_000, intervalMs: 3_000 }
  );
}

async function runTestClockLifecycle() {
  log("[6/6] Test-clock lifecycle (Stripe-authored events)");

  // [1] Real test-mode catalog objects, mapped into the DB so plan/price
  // resolution exercises the same joins production uses.
  const product = await stripePost("products", [
    ["name", `E2E Clock Plan ${RUN_ID}`],
  ]);
  const price = await stripePost("prices", [
    ["product", product.id],
    ["currency", "usd"],
    ["unit_amount", "4900"],
    ["recurring[interval]", "month"],
  ]);
  await query(
    "INSERT INTO plan_prices (planId, stripePriceId, label, amountCents, currency, billingInterval, intervalCount, active, isDefault, hidden, livemode, sortOrder) " +
      "SELECT id, ?, 'Clock Monthly', 4900, 'usd', 'month', 1, 1, 0, 0, 0, 1 FROM subscription_plans WHERE slug = ?",
    [price.id, PLAN_SLUG]
  );
  log(
    `      product=${product.id} price=${price.id} (mapped into plan_prices)`
  );

  // [2] Frozen clock; customer ON the clock with a good card.
  const nowSec = Math.floor(Date.now() / 1000);
  const clock = await stripePost("test_helpers/test_clocks", [
    ["frozen_time", String(nowSec)],
    ["name", `e2e-${RUN_ID}`],
  ]);
  const customer = await stripePost("customers", [
    ["test_clock", clock.id],
    // %2B: a literal '+' in a form body decodes as a space and corrupts the address.
    ["email", `stripe-e2e%2B${RUN_ID}@example.invalid`],
    ["payment_method", "pm_card_visa"],
    ["invoice_settings[default_payment_method]", "pm_card_visa"],
  ]);
  log(`      clock=${clock.id} customer=${customer.id}`);

  // [3] Subscribe WITH A TRIAL, bound to the seeded member via metadata — the
  // exact shape checkout's subscription_data produces. Trial ends in 1 day.
  const trialEnd = nowSec + 86_400;
  let deliveriesMark = DELIVERIES.length;
  const sub = await stripePost("subscriptions", [
    ["customer", customer.id],
    ["items[0][price]", price.id],
    ["trial_end", String(trialEnd)],
    ["metadata[user_id]", String(SEED_USER_ID)],
    ["metadata[plan_id]", PLAN_SLUG],
  ]);
  await awaitDelivery("customer.subscription.created", deliveriesMark);
  const trialUser = await waitFor(
    "the trial to GRANT access (trials carry access; conversion charges later)",
    async () => {
      const row = await seededUser();
      return row && Number(row.hasAccess) === 1 ? row : null;
    },
    { timeoutMs: 60_000, intervalMs: 1_000 }
  );
  await sleep(1_500);
  const createdRows = await query(
    "SELECT kind, outcome FROM subscription_events WHERE stripeSubscriptionId = ? AND kind='created'",
    [sub.id]
  );
  assertThat(
    "CLOCK: a real trialing subscription grants access and records created/granted",
    sub.status === "trialing" &&
      Number(trialUser.hasAccess) === 1 &&
      createdRows.length === 1 &&
      createdRows[0].outcome === "granted",
    `sub.status=${sub.status} hasAccess=${trialUser.hasAccess} created rows=${createdRows.length}/${createdRows[0]?.outcome}`,
    CLOCK_COVERAGE
  );

  // [4] TRIAL CONVERSION — advance past trial end PLUS the ~1h draft window:
  // Stripe creates the cycle invoice as a draft at period end and finalizes +
  // charges it about an hour later IN CLOCK TIME, so a small advance strands
  // it in draft and invoice.paid never fires (learned from run 1).
  deliveriesMark = DELIVERIES.length;
  await advanceClock(clock.id, trialEnd + 2 * 3_600);
  await awaitDelivery("invoice.paid", deliveriesMark, 180_000);
  const subAfterConvert = await waitFor(
    "the conversion to re-anchor expiry to Stripe's billed period end",
    async () => {
      const s = await stripeGet(`subscriptions/${sub.id}`);
      const row = await seededUser();
      const periodEnd =
        (s.items?.data?.[0]?.current_period_end ?? s.current_period_end) * 1000;
      return row && Number(row.expiryDate) === periodEnd
        ? { s, row, periodEnd }
        : null;
    },
    { timeoutMs: 120_000, intervalMs: 2_000 }
  );
  assertThat(
    "CLOCK: trial auto-converts, charges, and expiry equals Stripe's period end EXACTLY (0ms delta, Stripe-authored numbers)",
    subAfterConvert.s.status === "active" &&
      Number(subAfterConvert.row.expiryDate) === subAfterConvert.periodEnd,
    `status=${subAfterConvert.s.status} expiry=${subAfterConvert.row.expiryDate} stripe_period_end=${subAfterConvert.periodEnd} ` +
      `delta=${Number(subAfterConvert.row.expiryDate) - subAfterConvert.periodEnd}ms`,
    CLOCK_COVERAGE
  );
  await sleep(1_500);
  const convertPay = await query(
    "SELECT kind, outcome, amountCents FROM payment_events WHERE stripeSubscriptionId = ? AND kind='succeeded' AND outcome='granted'",
    [sub.id]
  );
  assertThat(
    "CLOCK: the conversion charge is a granted money fact ($49.00)",
    convertPay.length >= 1 && Number(convertPay[0].amountCents) === 4900,
    `payment_events granted rows=${convertPay.length} amount=${convertPay[0]?.amountCents}`,
    CLOCK_COVERAGE
  );

  // [5] NO-GRACE DEATH — swap to a card that will decline, advance one full
  // cycle. Stripe authors invoice.payment_failed; the handler must revoke at
  // that instant AND cancel the REAL subscription at Stripe.
  const failPm = await stripePost("payment_methods", [
    ["type", "card"],
    ["card[token]", "tok_chargeCustomerFail"],
  ]);
  await stripePost(`payment_methods/${failPm.id}/attach`, [
    ["customer", customer.id],
  ]);
  await stripePost(`customers/${customer.id}`, [
    ["invoice_settings[default_payment_method]", failPm.id],
  ]);
  deliveriesMark = DELIVERIES.length;
  const nextPeriodEnd = subAfterConvert.periodEnd / 1000;
  // Same draft-window allowance as the conversion advance.
  await advanceClock(clock.id, Math.floor(nextPeriodEnd) + 2 * 3_600);
  await awaitDelivery("invoice.payment_failed", deliveriesMark, 240_000);
  const deadUser = await waitFor(
    "the decline to revoke access at the failure event",
    async () => {
      const row = await seededUser();
      return row && Number(row.hasAccess) === 0 ? row : null;
    },
    { timeoutMs: 120_000, intervalMs: 2_000 }
  );
  await sleep(2_000);
  const failRows = await query(
    "SELECT kind, outcome, outcomeReason FROM subscription_events WHERE stripeSubscriptionId = ? AND kind='payment_failed'",
    [sub.id]
  );
  const audit = await query(
    "SELECT reason FROM entitlement_events WHERE userId = ? AND reason='PAYMENT_FAILED_NO_GRACE'",
    [SEED_USER_ID]
  );
  assertThat(
    "CLOCK NO-GRACE: a real declined renewal revokes access at the failure event, audited",
    Number(deadUser.hasAccess) === 0 &&
      audit.length >= 1 &&
      failRows.length === 1 &&
      failRows[0].outcome === "revoked",
    `hasAccess=${deadUser.hasAccess} audit=${audit.length} ` +
      `lifecycle=[${failRows.map(r => `${r.kind}/${r.outcome}`).join(", ")}]`,
    CLOCK_COVERAGE
  );

  // The handler's in-flight Stripe-side cancel is REFUSED while a test clock
  // is advancing ("Test clock advancement underway — cannot perform
  // modifications") — a lock that exists ONLY on clocked objects, so this
  // failure mode cannot occur in production. The contract under a failed
  // cancel is: the revoke STANDS and the discrepancy is recorded. Assert that
  // degraded contract explicitly rather than pretending the lock is a bug.
  const subNow = await stripeGet(`subscriptions/${sub.id}`);
  const cancelDegraded =
    subNow.status !== "canceled" &&
    /cancel FAILED: Test clock/i.test(failRows[0]?.outcomeReason ?? "");
  assertThat(
    "CLOCK NO-GRACE: Stripe-side cancel either landed or degraded correctly (revoke stands, discrepancy recorded)",
    subNow.status === "canceled" || cancelDegraded,
    `stripe.status=${subNow.status} reason="${failRows[0]?.outcomeReason ?? ""}"`,
    CLOCK_COVERAGE
  );

  // Complete the lifecycle: cancel post-settle (what the handler's retry — the
  // next failure event — would do in production) and prove the deletion flows
  // back as customer.subscription.deleted → deleted/revoked.
  if (subNow.status !== "canceled") {
    deliveriesMark = DELIVERIES.length;
    await run(
      "curl",
      [
        "-sS",
        "-u",
        `${STRIPE_KEY}:`,
        "-X",
        "DELETE",
        `https://api.stripe.com/v1/subscriptions/${sub.id}`,
      ],
      { timeoutMs: 30_000 }
    );
    await awaitDelivery(
      "customer.subscription.deleted",
      deliveriesMark,
      120_000
    );
    await sleep(2_000);
  }
  const deletedRows = await query(
    "SELECT kind, outcome FROM subscription_events WHERE stripeSubscriptionId = ? AND kind='deleted'",
    [sub.id]
  );
  const finalUser = await seededUser();
  assertThat(
    "CLOCK NO-GRACE: the subscription's death arrives as deleted/revoked and access stays off",
    deletedRows.length === 1 && Number(finalUser.hasAccess) === 0,
    `deleted rows=${deletedRows.length}/${deletedRows[0]?.outcome} hasAccess=${finalUser.hasAccess}`,
    CLOCK_COVERAGE
  );

  // [6] Teardown of Stripe-side objects (clock deletion cascades customer+sub).
  await run(
    "curl",
    [
      "-sS",
      "-u",
      `${STRIPE_KEY}:`,
      "-X",
      "DELETE",
      `https://api.stripe.com/v1/test_helpers/test_clocks/${clock.id}`,
    ],
    { timeoutMs: 30_000 }
  );
  await stripePost(`products/${product.id}`, [["active", "false"]]);
  log(`      clock deleted; product deactivated`);
}

async function main() {
  log(`Stripe end-to-end harness — run ${RUN_ID}`);
  log(
    `  app port ${ARGS.port} · mysql port ${ARGS.mysqlPort} · keep=${ARGS.keep} · testClock=${ARGS.testClock}`
  );
  log("");
  await preflight();
  await startDatabase();
  await replayMigrations();
  await seedFixture();
  await startListener();
  await startServer();
  if (ARGS.testClock) {
    await runTestClockLifecycle();
  } else {
    await runBattery();
  }
}

let exitCode = 0;
try {
  await main();
} catch (error) {
  fail(error?.message ?? String(error));
  record(
    "harness completed",
    "FAIL",
    `aborted: ${error?.message ?? error}`,
    ""
  );
  if (serverTail.length > 0) {
    log("");
    log("last server output:");
    log(serverTail.slice(-40).join("\n"));
  }
  if (listenState.tail.length > 0) {
    log("");
    log("last `stripe listen` output:");
    log(listenState.tail.slice(-20).join("\n"));
  }
  exitCode = 1;
} finally {
  await teardown();
}

const failures = printSummary();
process.exit(exitCode || (failures > 0 ? 1 : 0));
