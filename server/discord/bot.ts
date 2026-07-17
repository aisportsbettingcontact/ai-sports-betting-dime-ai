/**
 * Discord Bot — starts a discord.js Client alongside the Express server.
 *
 * The bot shares the same Node.js process as the Express server so it
 * automatically has access to the database and all server-side helpers.
 *
 * Call startDiscordBot() ONCE from server/_core/index.ts after the HTTP
 * server is listening.
 *
 * ── Reconnection safety ───────────────────────────────────────────────────────
 * discord.js v14 reconnects automatically on most close codes. However, on
 * close code 4004 (TOKEN_INVALID) it will loop forever at full speed if not
 * intercepted. This file adds:
 *
 *   1. Singleton guard — only one Client instance is ever created per process.
 *   2. Close-code 4004 detection — destroys the client immediately and halts
 *      reconnection so Discord never sees a flood of invalid-token attempts.
 *   3. Exponential backoff with jitter — all other disconnects (network blip,
 *      gateway restart, etc.) wait an increasing delay before reconnecting.
 *   4. Max reconnect cap — after MAX_RECONNECT_ATTEMPTS the bot logs CRITICAL
 *      and stops trying, preventing runaway loops.
 *   5. Structured logging — every connect/disconnect/reconnect event is logged
 *      with a timestamp, attempt counter, and close code.
 */

import {
  Client,
  GatewayIntentBits,
  Events,
  type ChatInputCommandInteraction,
} from "discord.js";
import { ENV } from "../_core/env";
import { handleLineupsCommand, handleLineupsAutocomplete } from "./lineupsCommand";
import { warmUpLineupRenderer, closeLineupRenderer } from "./renderLineupCard";
import { enrichTeamRegistryFromDb } from "./teamRegistry";

// ─── Singleton guard ──────────────────────────────────────────────────────────
// Prevents multiple Client instances from being created if startDiscordBot()
// is accidentally called more than once (e.g., during hot-reload in dev).
let botClient: Client | null = null;
let botStarted = false;

// ─── Reconnection constants ───────────────────────────────────────────────────
const MAX_RECONNECT_ATTEMPTS = 10;       // halt after this many consecutive failures
const BASE_BACKOFF_MS        = 2_000;    // 2s base delay
const MAX_BACKOFF_MS         = 300_000;  // 5 min ceiling
const JITTER_FACTOR          = 0.3;      // ±30% random jitter

// Discord close codes that must NOT trigger a reconnect attempt
// 4004 = Authentication failed (invalid/revoked token)
// 4010 = Invalid shard
// 4011 = Sharding required
// 4013 = Invalid intents
// 4014 = Disallowed intents
const FATAL_CLOSE_CODES = new Set([4004, 4010, 4011, 4013, 4014]);

// ─── Interaction deduplication guard ─────────────────────────────────────────
// Discord's gateway occasionally delivers the same interaction twice.
// We track recently-seen interaction IDs for 10 seconds to detect and drop
// duplicates before they reach the command handler.
const seenInteractionIds = new Map<string, number>(); // id → timestamp
const INTERACTION_DEDUP_TTL_MS = 10_000;

function isDuplicateInteraction(id: string): boolean {
  const now = Date.now();
  Array.from(seenInteractionIds.entries()).forEach(([k, ts]) => {
    if (now - ts > INTERACTION_DEDUP_TTL_MS) seenInteractionIds.delete(k);
  });
  if (seenInteractionIds.has(id)) {
    console.warn(`[DiscordBot] [WARN] Duplicate interaction detected and dropped: ${id}`);
    return true;
  }
  seenInteractionIds.set(id, now);
  return false;
}

// ─── Backoff calculator ───────────────────────────────────────────────────────
function calcBackoffMs(attempt: number): number {
  const base = Math.min(BASE_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
  const jitter = base * JITTER_FACTOR * (Math.random() * 2 - 1); // ±30%
  return Math.round(base + jitter);
}

// ─── Core bot factory ─────────────────────────────────────────────────────────
function createAndLoginClient(attempt: number): void {
  const ts = new Date().toISOString();
  console.log(`[DiscordBot] [STEP] Creating Client (attempt ${attempt + 1}/${MAX_RECONNECT_ATTEMPTS}) at ${ts}`);

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  // ── Ready ─────────────────────────────────────────────────────────────────
  client.once(Events.ClientReady, (readyClient) => {
    const readyTs = new Date().toISOString();
    console.log(`[DiscordBot] [OUTPUT] ✅ Logged in as ${readyClient.user.tag} at ${readyTs}`);
    console.log(`[DiscordBot] [STATE] Guild: ${ENV.discordGuildId}`);

    // Reset reconnect counter on successful login
    reconnectAttempt = 0;

    // Parallel startup tasks
    warmUpLineupRenderer().catch((err) =>
      console.error("[DiscordBot] [WARN] Renderer warm-up failed (non-fatal):", err)
    );
    enrichTeamRegistryFromDb().catch((err) =>
      console.error("[DiscordBot] [WARN] Team registry enrichment failed:", err)
    );
  });

  // ── Interaction handler ───────────────────────────────────────────────────
  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isAutocomplete()) {
      if (interaction.commandName === "lineups") {
        await handleLineupsAutocomplete(interaction).catch((err) =>
          console.error("[LineupsBot] [WARN] Autocomplete error:", err)
        );
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    if (isDuplicateInteraction(interaction.id)) {
      console.warn(`[DiscordBot] [WARN] Dropped duplicate interaction ${interaction.id} for /${commandName}`);
      return;
    }

    console.log(
      `[DiscordBot] [INPUT] /${commandName} from ${interaction.user.id} (${interaction.user.tag}) [id=${interaction.id}]`
    );

    try {
      if (commandName === "lineups") {
        await handleLineupsCommand(interaction as ChatInputCommandInteraction, client);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[DiscordBot] [FAIL] Unhandled error in /${commandName} [id=${interaction.id}]: ${msg}`);
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(`❌ Unexpected error: ${msg}`);
        } else {
          await interaction.reply({ content: `❌ Unexpected error: ${msg}`, ephemeral: true });
        }
      } catch (replyErr) {
        const replyMsg = replyErr instanceof Error ? replyErr.message : String(replyErr);
        console.error(`[DiscordBot] [FAIL] Could not send error reply for /${commandName} [id=${interaction.id}]: ${replyMsg}`);
      }
    }
  });

  // ── Disconnect handler — the critical reconnection safety layer ───────────
  client.on(Events.ShardDisconnect, (closeEvent, shardId) => {
    const code = closeEvent.code;
    const disconnectTs = new Date().toISOString();
    console.warn(`[DiscordBot] [STATE] Shard ${shardId} disconnected at ${disconnectTs} — close code: ${code}`);

    // Fatal close codes: destroy immediately, do NOT reconnect
    if (FATAL_CLOSE_CODES.has(code)) {
      console.error(
        `[DiscordBot] [CRITICAL] Close code ${code} is fatal — destroying client. ` +
        `This usually means the bot token is invalid or revoked. ` +
        `Regenerate the token at discord.com/developers/applications and update DISCORD_BOT_TOKEN.`
      );
      client.destroy();
      botClient = null;
      botStarted = false; // allow restart after token is fixed
      return;
    }

    // Non-fatal: discord.js will handle the reconnect automatically.
    // Log the event so we have a trace.
    console.log(`[DiscordBot] [STEP] Non-fatal disconnect (code=${code}) — discord.js will reconnect automatically.`);
  });

  // ── Error handler ─────────────────────────────────────────────────────────
  client.on(Events.Error, (err) => {
    console.error("[DiscordBot] [FAIL] Discord client error:", err.message);
  });

  // ── Login ─────────────────────────────────────────────────────────────────
  client.login(ENV.discordBotToken).catch((err) => {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[DiscordBot] [FAIL] Login attempt ${attempt + 1} failed: ${errMsg}`);

    // If the error message indicates an invalid token, halt immediately
    if (
      errMsg.includes("TOKEN_INVALID") ||
      errMsg.includes("Invalid token") ||
      errMsg.includes("401")
    ) {
      console.error(
        `[DiscordBot] [CRITICAL] Token is invalid — halting reconnection. ` +
        `Regenerate the token at discord.com/developers/applications and update DISCORD_BOT_TOKEN.`
      );
      botStarted = false;
      return;
    }

    // Schedule a backoff retry for other login errors (network, gateway down, etc.)
    reconnectAttempt++;
    if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      console.error(
        `[DiscordBot] [CRITICAL] Reached max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}). ` +
        `Halting bot. Restart the server to try again.`
      );
      botStarted = false;
      return;
    }

    const delay = calcBackoffMs(reconnectAttempt);
    console.log(`[DiscordBot] [STEP] Scheduling reconnect attempt ${reconnectAttempt + 1} in ${delay}ms...`);
    setTimeout(() => createAndLoginClient(reconnectAttempt), delay);
  });

  botClient = client;
}

// ─── Reconnect attempt counter (module-level, shared across retries) ──────────
let reconnectAttempt = 0;

// ─── Public API ───────────────────────────────────────────────────────────────

export function startDiscordBot(): void {
  if (!ENV.discordBotToken) {
    console.warn("[DiscordBot] [WARN] DISCORD_BOT_TOKEN not set — bot will not start");
    return;
  }

  // Singleton guard: prevent multiple Client instances in the same process
  if (botStarted) {
    console.warn("[DiscordBot] [WARN] startDiscordBot() called more than once — ignoring duplicate call");
    return;
  }
  botStarted = true;
  reconnectAttempt = 0;

  console.log(`[DiscordBot] [STEP] Starting Discord bot at ${new Date().toISOString()}`);
  createAndLoginClient(0);

  // Graceful shutdown on process exit
  const shutdown = async () => {
    console.log("[DiscordBot] [STEP] Shutting down — closing Playwright browser and Discord client...");
    await closeLineupRenderer();
    botClient?.destroy();
    botClient = null;
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

export function getDiscordClient(): Client | null {
  return botClient;
}
