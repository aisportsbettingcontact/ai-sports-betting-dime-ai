/**
 * Discord Bot — a supervised discord.js Client alongside the Express server.
 *
 * The bot registers NO slash commands. Its only job is to keep a gateway
 * client connected for the site's Discord integrations:
 *   - password-reset DM fallback (server/routers/appUsers.ts via getDiscordClient)
 *   - security alerts and digests (discordSecurityAlert.ts, securityDigest.ts,
 *     weeklySecurityDigest.ts — channel sends via getDiscordClient)
 * Membership role grants/revokes go through the Discord REST API directly
 * (server/discord/discordRoleSync.ts) and do not use this client.
 *
 * Call startDiscordBot() ONCE from server/_core/index.ts after the HTTP
 * server is listening.
 *
 * ── Availability model (read this before changing the retry logic) ────────────
 *
 * A gateway connection CANNOT be made to "never disconnect". Discord itself
 * sends OP 7 RECONNECT for load rebalancing, invalidates sessions, and requires
 * heartbeats over a socket any network blip can drop; deploys restart the
 * process outright. Reconnection is not a failure mode — it is the documented
 * mechanism by which a gateway client stays available.
 *
 * So the guarantee here is the achievable one: the bot NEVER STAYS DOWN. Every
 * failure path leads back to a connected client with no human intervention.
 *
 *   1. NO TERMINAL STATE. The previous implementation halted permanently after
 *      10 consecutive failures ("Restart the server to try again") — exactly
 *      how it died in production: an unrelated dependency fault made every
 *      login throw, the counter hit 10, and the bot stayed dead until redeploy.
 *      Retries are now unbounded.
 *   2. AUTH FAULTS RETRY SLOWLY INSTEAD OF HALTING, so rotating the token in
 *      Railway self-heals without a redeploy, on an interval long enough that
 *      Discord never sees a flood of invalid-credential attempts.
 *   3. NO CLIENT LEAKS. Each attempt destroys the prior Client first. The old
 *      code abandoned the previous instance on every retry, leaking its
 *      sockets, timers and listeners.
 *   4. WATCHDOG for states that raise no event at all — a destroyed client, a
 *      socket wedged half-open, a login promise that never settles.
 *   5. OBSERVABLE via getDiscordBotHealth(), so "bot is down" can be surfaced
 *      rather than inferred from stored data that looks healthy.
 */

import { Client, GatewayIntentBits, Events, Status } from "discord.js";
import { ENV } from "../_core/env";

// ─── Tunables ─────────────────────────────────────────────────────────────────

const BASE_BACKOFF_MS = 2_000; //   2s — first transient retry
const MAX_BACKOFF_MS = 300_000; //  5m — ceiling for transient failures
/**
 * Auth faults retry on their own, much slower clock. Retrying an invalid token
 * at transient speed would hammer Discord with bad credentials; never retrying
 * means a token rotation cannot heal without a redeploy. 15 minutes does both.
 */
const AUTH_RETRY_MS = 900_000; // 15m
const JITTER_FACTOR = 0.3; // ±30%, so instances never retry in lockstep
const WATCHDOG_INTERVAL_MS = 60_000; // 1m — probe cadence, NOT the teardown threshold
/**
 * How long a client may sit un-ready before the watchdog tears it down.
 *
 * MUST be comfortably longer than a real gateway handshake. The first version
 * used the 60s probe interval as the threshold and destroyed the client on the
 * FIRST un-ready probe, which livelocked in production: a handshake that had
 * not finished within 60s was killed and restarted, each rebuild issuing a
 * fresh IDENTIFY, so it could never complete and the bot never came up. The
 * watchdog was supposed to be the backstop for permanent death, and instead it
 * became the cause.
 */
const WATCHDOG_GRACE_MS = 300_000; // 5m

/**
 * Statuses that mean "a handshake is in flight — leave it alone".
 * Tearing down mid-handshake is what produced the identify storm.
 */
const TRANSITIONAL_STATUSES = new Set<number>([
  Status.Connecting,
  Status.Reconnecting,
  Status.Identifying,
  Status.Resuming,
  Status.Nearly,
  Status.WaitingForGuilds,
]);

/**
 * Close codes meaning "this configuration cannot work as-is". NOT terminal —
 * they back off to AUTH_RETRY_MS so fixing config in Railway recovers on its own.
 *   4004 auth failed · 4010 invalid shard · 4011 sharding required
 *   4013 invalid intents · 4014 disallowed intents
 */
const CONFIG_FAULT_CLOSE_CODES = new Set([4004, 4010, 4011, 4013, 4014]);

// ─── Supervisor state ─────────────────────────────────────────────────────────

let botClient: Client | null = null;
let supervising = false;
let consecutiveFailures = 0;
let totalConnects = 0;
let totalReconnects = 0;
let lastReadyAt: number | null = null;
let lastFailureAt: number | null = null;
let lastFailureReason: string | null = null;
let retryTimer: NodeJS.Timeout | null = null;
let watchdogTimer: NodeJS.Timeout | null = null;
let shuttingDown = false;
/** When the gateway first went un-ready. NULL while healthy. Drives the grace window. */
let unreadySince: number | null = null;

/** Exponential backoff with jitter, capped. */
export function calcBackoffMs(failures: number): number {
  const base = Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, failures - 1), MAX_BACKOFF_MS);
  const jitter = base * JITTER_FACTOR * (Math.random() * 2 - 1);
  return Math.max(1_000, Math.round(base + jitter));
}

/** True when the client exists and its gateway is actually usable. */
function isConnected(): boolean {
  const c = botClient;
  if (!c) return false;
  // isReady() covers the normal case; the ws status check also catches a client
  // that fired ready once and has since gone Disconnected without emitting a
  // login rejection we could hook.
  return c.isReady() && c.ws.status === Status.Ready;
}

/**
 * Schedule the next attempt. Idempotent by design: several signals (login
 * rejection, shard disconnect, watchdog) can all conclude "reconnect" for the
 * same outage, and they must collapse into ONE pending timer rather than
 * multiplying into parallel reconnect storms.
 */
function scheduleReconnect(delayMs: number, why: string): void {
  if (shuttingDown || !supervising) return;
  if (retryTimer) return; // an attempt is already queued
  console.log(
    `[DiscordBot] [STEP] Reconnect queued in ${Math.round(delayMs / 1000)}s ` +
      `(consecutiveFailures=${consecutiveFailures}, why=${why})`
  );
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void connect();
  }, delayMs);
  retryTimer.unref?.();
}

/** Tear down the current client completely. Safe when there is none. */
function teardownClient(reason: string): void {
  const c = botClient;
  botClient = null;
  if (!c) return;
  try {
    c.removeAllListeners();
    void c.destroy();
    console.log(`[DiscordBot] [STEP] Destroyed previous client (${reason})`);
  } catch (err) {
    // Destroying a half-dead client can throw; that must not abort the rebuild.
    console.warn(`[DiscordBot] [WARN] Error destroying client (${reason}): ${(err as Error)?.message ?? err}`);
  }
}

/** Build a client, wire its events, and log in. Never throws. */
async function connect(): Promise<void> {
  if (shuttingDown || !supervising) return;
  if (isConnected()) return;

  // Always start from a clean instance — reusing a failed client is what leaked
  // sockets and listeners on every previous retry.
  teardownClient("rebuilding");

  const attemptNo = consecutiveFailures + 1;
  console.log(`[DiscordBot] [STEP] Connecting (attempt ${attemptNo}, unbounded) at ${new Date().toISOString()}`);

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  botClient = client;

  client.on(Events.ClientReady, (ready) => {
    consecutiveFailures = 0;
    unreadySince = null;
    totalConnects += 1;
    if (totalConnects > 1) totalReconnects += 1;
    lastReadyAt = Date.now();
    console.log(
      `[DiscordBot] [OUTPUT] ✅ Connected as ${ready.user.tag} at ${new Date(lastReadyAt).toISOString()} ` +
        `(guild=${ENV.discordGuildId}, connects=${totalConnects}, reconnects=${totalReconnects})`
    );
  });

  client.on(Events.ShardDisconnect, (closeEvent, shardId) => {
    const code = closeEvent.code;
    lastFailureAt = Date.now();
    lastFailureReason = `shard ${shardId} closed with code ${code}`;
    console.warn(`[DiscordBot] [STATE] Shard ${shardId} disconnected — close code ${code}`);

    if (CONFIG_FAULT_CLOSE_CODES.has(code)) {
      consecutiveFailures += 1;
      console.error(
        `[DiscordBot] [CRITICAL] Close code ${code} indicates a CONFIGURATION fault ` +
          `(usually an invalid/revoked DISCORD_BOT_TOKEN or disallowed intents). ` +
          `Retrying every ${AUTH_RETRY_MS / 60_000}m so fixing it in Railway recovers without a redeploy.`
      );
      teardownClient(`config fault ${code}`);
      scheduleReconnect(AUTH_RETRY_MS, `close_${code}`);
      return;
    }

    // Transient close: discord.js drives its own resume. Nothing is scheduled
    // here — doing so would race discord.js's own reconnect. The watchdog is
    // the backstop if that resume never completes.
    console.log(`[DiscordBot] [STEP] Transient close (${code}) — discord.js will resume; watchdog is the backstop.`);
  });

  client.on(Events.Error, (err) => {
    lastFailureAt = Date.now();
    lastFailureReason = err.message;
    console.error(`[DiscordBot] [FAIL] Client error: ${err.message}`);
  });

  try {
    await client.login(ENV.discordBotToken);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    consecutiveFailures += 1;
    lastFailureAt = Date.now();
    lastFailureReason = msg;
    console.error(`[DiscordBot] [FAIL] Login attempt ${attemptNo} failed: ${msg}`);

    const isAuth = /TOKEN_INVALID|invalid token|401|unauthorized/i.test(msg);
    teardownClient("login failed");
    scheduleReconnect(isAuth ? AUTH_RETRY_MS : calcBackoffMs(consecutiveFailures), isAuth ? "auth" : "login_error");
  }
}

/**
 * The backstop. Events are not guaranteed: a client can end up destroyed, or
 * wedged mid-handshake, without emitting anything we hook. This probe asks the
 * only question that matters — "is the gateway usable right now?" — and
 * rebuilds if not.
 */
function startWatchdog(): void {
  if (watchdogTimer) return;
  watchdogTimer = setInterval(() => {
    if (shuttingDown || !supervising) return;
    if (retryTimer) return; // recovery already queued

    if (isConnected()) {
      unreadySince = null; // healthy — reset the grace clock
      return;
    }

    // discord.js drives its own reconnect and resume. Interrupting a handshake
    // in progress is strictly harmful: it burns an IDENTIFY and restarts the
    // clock, which is precisely how this livelocked.
    const status = botClient?.ws.status;
    if (status != null && TRANSITIONAL_STATUSES.has(status)) {
      console.log(`[DiscordBot] [WATCHDOG] handshake in progress (status=${status}) — not interfering`);
      return;
    }

    // Un-ready and idle. Start (or continue) the grace clock rather than
    // tearing down on a single probe.
    const now = Date.now();
    unreadySince ??= now;
    const stalledFor = now - unreadySince;
    if (stalledFor < WATCHDOG_GRACE_MS) {
      console.log(
        `[DiscordBot] [WATCHDOG] not ready (status=${status ?? "no client"}) for ${Math.round(stalledFor / 1000)}s ` +
          `— waiting up to ${WATCHDOG_GRACE_MS / 1000}s before forcing a rebuild`
      );
      return;
    }

    console.warn(
      `[DiscordBot] [WATCHDOG] stalled ${Math.round(stalledFor / 1000)}s at status=${status ?? "no client"} — forcing reconnect`
    );
    unreadySince = null;
    consecutiveFailures += 1;
    scheduleReconnect(calcBackoffMs(consecutiveFailures), "watchdog");
  }, WATCHDOG_INTERVAL_MS);
  watchdogTimer.unref?.();
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function startDiscordBot(): void {
  if (!ENV.discordBotToken) {
    console.warn("[DiscordBot] [WARN] DISCORD_BOT_TOKEN not set — bot will not start");
    return;
  }
  if (supervising) {
    console.warn("[DiscordBot] [WARN] startDiscordBot() called more than once — ignoring duplicate call");
    return;
  }
  supervising = true;
  shuttingDown = false;
  consecutiveFailures = 0;

  console.log(`[DiscordBot] [STEP] Supervisor starting at ${new Date().toISOString()}`);
  void connect();
  startWatchdog();

  const shutdown = () => {
    shuttingDown = true;
    supervising = false;
    if (retryTimer) clearTimeout(retryTimer);
    if (watchdogTimer) clearInterval(watchdogTimer);
    retryTimer = null;
    watchdogTimer = null;
    console.log("[DiscordBot] [STEP] Shutting down — destroying Discord client...");
    teardownClient("process shutdown");
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

export function getDiscordClient(): Client | null {
  // Callers use this to send messages; handing back a client whose gateway is
  // down produces confusing downstream errors, so gate on real readiness.
  return isConnected() ? botClient : null;
}

/** Real connection state, for health endpoints and admin surfaces. */
export function getDiscordBotHealth() {
  return {
    supervising,
    connected: isConnected(),
    consecutiveFailures,
    totalConnects,
    totalReconnects,
    lastReadyAt,
    lastFailureAt,
    lastFailureReason,
    retryQueued: retryTimer != null,
  };
}
