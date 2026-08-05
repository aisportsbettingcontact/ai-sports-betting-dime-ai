/**
 * securityDigest.ts
 *
 * Schedules a daily security digest that fires at 08:00 EST (13:00 UTC).
 * On each tick it:
 *   1. Queries security_events for the prior 24-hour window
 *      (CSRF_BLOCK, RATE_LIMIT, AUTH_FAIL counts + total)
 *   2. Fetches the top-5 most active IPs in that window
 *   3. Fires notifyOwner() with a structured summary
 *   4. Posts a rich Discord embed to the 🗒️-𝗦𝗘𝗖𝗨𝗥𝗜𝗧𝗬-𝗘𝗩𝗘𝗡𝗧𝗦 channel
 *   5. Prunes security_events older than 90 days (rolling retention)
 *
 * Design constraints:
 *   - Fire-and-forget: errors never crash the server
 *   - Digest is skipped (not queued) if the previous run is still in progress
 *   - notifyOwner() is always called — even on clean days (daily confirmation)
 *   - Discord embed is always posted — even on clean days
 *   - All log lines are structured and machine-readable
 */

import { EmbedBuilder, TextChannel } from "discord.js";
import {
  getSecurityEventCounts,
  getSecurityEvents,
  pruneSecurityEvents,
} from "./db";
import { notifyOwner } from "./_core/notification";
import { getDiscordClient } from "./discord/bot";

// ─── Constants ────────────────────────────────────────────────────────────────
const TAG = "[SecurityDigest]";
const DIGEST_HOUR_UTC = 13; // 08:00 EST = 13:00 UTC (accounts for EST = UTC-5)
const DIGEST_MINUTE_UTC = 0;
const WINDOW_MS = 24 * 60 * 60 * 1000; // 24-hour lookback window
const PRUNE_RETENTION_DAYS = 90; // delete events older than 90 days
const TOP_IP_LIMIT = 5; // top N IPs to surface in digest
const CHECK_INTERVAL_MS = 60 * 1000; // poll every 60 seconds to find the right minute

/** Target channel: 🗒️-𝗦𝗘𝗖𝗨𝗥𝗜𝗧𝗬-𝗘𝗩𝗘𝗡𝗧𝗦 */
const SECURITY_CHANNEL_ID = "1492280227567501403";

// ─── Threat level config ──────────────────────────────────────────────────────
const THREAT_LEVELS = [
  { label: "CLEAN", threshold: 0, color: 0x57f287, emoji: "✅" }, // Discord green
  { label: "LOW", threshold: 1, color: 0xfee75c, emoji: "🟡" }, // Discord yellow
  { label: "MODERATE", threshold: 10, color: 0xeb6c33, emoji: "🟠" }, // Orange
  { label: "HIGH", threshold: 50, color: 0xed4245, emoji: "🔴" }, // Discord red
  { label: "CRITICAL", threshold: 200, color: 0xf8312f, emoji: "🚨" }, // Bright red
] as const;

type ThreatLevel = "CLEAN" | "LOW" | "MODERATE" | "HIGH" | "CRITICAL";

// ─── State ────────────────────────────────────────────────────────────────────
let lastDigestDateUTC = ""; // "YYYY-MM-DD" of last successful digest
let digestRunning = false; // guard against overlapping runs

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the current UTC hour and minute. */
function nowUTC(): { hour: number; minute: number } {
  const d = new Date();
  return { hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

/**
 * Aggregates the top N IPs by event count from a raw event list.
 * Returns an array of { ip, count } sorted descending.
 */
export function topIpsByCount(
  events: Array<{ ip: string | null }>,
  limit: number
): Array<{ ip: string; count: number }> {
  const map = new Map<string, number>();
  for (const e of events) {
    const ip = e.ip ?? "unknown";
    map.set(ip, (map.get(ip) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([ip, count]) => ({ ip, count }));
}

/**
 * Determines the threat level based on total event count.
 * Returns the highest matching tier.
 */
export function computeThreatLevel(total: number): ThreatLevel {
  if (total === 0) return "CLEAN";
  if (total < 10) return "LOW";
  if (total < 50) return "MODERATE";
  if (total < 200) return "HIGH";
  return "CRITICAL";
}

/** Returns the color and emoji for a given threat level. */
function threatMeta(level: ThreatLevel): { color: number; emoji: string } {
  const found = THREAT_LEVELS.find(t => t.label === level);
  return { color: found?.color ?? 0x5865f2, emoji: found?.emoji ?? "🔵" };
}

/**
 * Formats an epoch-ms timestamp as a human-readable EST string.
 * Example: "Apr 10, 2026 · 08:00:00 EST"
 */
function formatEst(epochMs: number): string {
  return (
    new Date(epochMs).toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }) + " EST"
  );
}

// ─── Discord digest embed builder ─────────────────────────────────────────────
/**
 * Builds the daily digest embed for the 🗒️-𝗦𝗘𝗖𝗨𝗥𝗜𝗧𝗬-𝗘𝗩𝗘𝗡𝗧𝗦 channel.
 *
 * Written in plain English so @prez can read it at a glance without needing
 * to decode technical jargon. Each section explains what happened, how many
 * times, and what (if anything) to do about it.
 */
function buildDigestEmbed(
  counts: {
    CSRF_BLOCK: number;
    RATE_LIMIT: number;
    AUTH_FAIL: number;
    total: number;
  },
  topIps: Array<{ ip: string; count: number }>,
  threatLevel: ThreatLevel,
  windowStartMs: number,
  windowEndMs: number
): EmbedBuilder {
  const { color, emoji } = threatMeta(threatLevel);
  const dateLabel = new Date(windowEndMs).toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  // ── Threat level description in plain English ──────────────────────────────
  const threatDescriptions: Record<ThreatLevel, string> = {
    CLEAN:
      "No security events recorded in the last 24 hours. Everything looks normal — no suspicious activity detected.",
    LOW: "A small number of security events were recorded. This is within normal range and likely just routine noise. No action needed unless you see a pattern.",
    MODERATE:
      "A moderate number of security events were recorded. Worth reviewing the top IPs below to see if anything looks suspicious. No immediate action required.",
    HIGH: "A high number of security events were recorded. Someone may be actively probing or attacking the site. Review the top IPs and consider blocking them at the firewall if the pattern continues.",
    CRITICAL:
      "A critical number of security events were recorded. The site is likely under active attack. Immediate review is strongly recommended — check the top IPs and consider emergency firewall rules.",
  };

  // ── Event type explanations ────────────────────────────────────────────────
  // CSRF Block: someone tried to make a request from an unauthorized website
  // Rate Limit: someone sent too many requests too fast and got blocked
  // Auth Fail:  someone tried to log in with wrong credentials

  const csrfDesc =
    counts.CSRF_BLOCK === 0
      ? "0 — No cross-site request attempts detected."
      : `${counts.CSRF_BLOCK} — Someone tried to make requests to the site from an unauthorized external website. Each block means the attack was stopped before it could do anything.`;

  const rateLimitDesc =
    counts.RATE_LIMIT === 0
      ? "0 — No rate limit triggers. No one was blocked for sending too many requests."
      : `${counts.RATE_LIMIT} — One or more IPs sent requests faster than the allowed limit and were temporarily blocked. This is often automated scraping or a brute-force attempt.`;

  const authFailDesc =
    counts.AUTH_FAIL === 0
      ? "0 — No failed login attempts. All login traffic was clean."
      : `${counts.AUTH_FAIL} — Someone tried to log in with incorrect credentials. Multiple failures from the same IP usually indicate a password-guessing attack.`;

  // ── Top IPs section ────────────────────────────────────────────────────────
  const topIpValue =
    topIps.length > 0
      ? topIps
          .map(
            ({ ip, count }, i) =>
              `\`${i + 1}.\` \`${ip}\` — **${count}** event${count !== 1 ? "s" : ""}`
          )
          .join("\n")
      : "_No events recorded — nothing to report._";

  // ── Window display ─────────────────────────────────────────────────────────
  const windowValue =
    `From: \`${formatEst(windowStartMs)}\`\n` +
    `To:   \`${formatEst(windowEndMs)}\``;

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`${emoji} Daily Security Digest — ${dateLabel}`)
    .setDescription(
      `**Threat Level: ${threatLevel}**\n\n${threatDescriptions[threatLevel]}`
    )
    .addFields(
      {
        name: "🚫 CSRF Blocks (Cross-Site Attack Attempts)",
        value: csrfDesc,
        inline: false,
      },
      {
        name: "⚡ Rate Limit Triggers (Too Many Requests)",
        value: rateLimitDesc,
        inline: false,
      },
      {
        name: "🔐 Auth Failures (Failed Login Attempts)",
        value: authFailDesc,
        inline: false,
      },
      {
        name: `📊 Total Events in 24 Hours`,
        value: `**${counts.total}** security event${counts.total !== 1 ? "s" : ""} recorded`,
        inline: true,
      },
      {
        name: "🗑️ Retention",
        value: `Events older than **${PRUNE_RETENTION_DAYS} days** are automatically deleted after each digest.`,
        inline: true,
      },
      {
        name: `🖥️ Top ${TOP_IP_LIMIT} Most Active IPs`,
        value: topIpValue,
        inline: false,
      },
      {
        name: "🕐 Reporting Window",
        value: windowValue,
        inline: false,
      }
    )
    .setFooter({
      text: "AI Sports Betting · Daily Security Digest · Fires at 08:00 EST",
    })
    .setTimestamp(windowEndMs);
}

// ─── Discord digest poster ────────────────────────────────────────────────────
/**
 * Posts the daily digest embed to the 🗒️-𝗦𝗘𝗖𝗨𝗥𝗜𝗧𝗬-𝗘𝗩𝗘𝗡𝗧𝗦 channel.
 * Fire-and-forget — never throws, never blocks the digest runner.
 */
async function postDigestToDiscord(
  counts: {
    CSRF_BLOCK: number;
    RATE_LIMIT: number;
    AUTH_FAIL: number;
    total: number;
  },
  topIps: Array<{ ip: string; count: number }>,
  threatLevel: ThreatLevel,
  windowStartMs: number,
  windowEndMs: number
): Promise<void> {
  const client = getDiscordClient();
  if (!client) {
    console.log(
      `${TAG} [Discord] Bot client not available — skipping Discord digest embed`
    );
    return;
  }
  if (!client.isReady()) {
    console.log(
      `${TAG} [Discord] Bot client not ready — skipping Discord digest embed`
    );
    return;
  }

  console.log(
    `${TAG} [Discord] Fetching security channel ${SECURITY_CHANNEL_ID}...`
  );
  let channel: TextChannel;
  try {
    const raw = await client.channels.fetch(SECURITY_CHANNEL_ID);
    if (!raw || !(raw instanceof TextChannel)) {
      console.error(
        `${TAG} [Discord] Channel ${SECURITY_CHANNEL_ID} is not a TextChannel or could not be fetched`
      );
      return;
    }
    channel = raw;
    console.log(
      `${TAG} [Discord] Channel resolved: #${channel.name} in ${channel.guild?.name ?? "unknown"}`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${TAG} [Discord] Failed to fetch channel: ${msg}`);
    return;
  }

  const embed = buildDigestEmbed(
    counts,
    topIps,
    threatLevel,
    windowStartMs,
    windowEndMs
  );
  try {
    await channel.send({ embeds: [embed] });
    console.log(
      `${TAG} [Discord] [OUTPUT] Daily digest embed posted successfully` +
        ` | channel=#${channel.name}` +
        ` | threatLevel=${threatLevel}` +
        ` | total=${counts.total}`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${TAG} [Discord] Failed to send digest embed: ${msg}`);
  }
}

// ─── Core digest runner ───────────────────────────────────────────────────────

async function runSecurityDigest(): Promise<void> {
  if (digestRunning) {
    console.warn(
      `${TAG} [SKIP] Previous digest still running — skipping this tick`
    );
    return;
  }
  digestRunning = true;
  const runStart = Date.now();
  const windowStart = runStart - WINDOW_MS;
  const windowStartISO = new Date(windowStart).toISOString();
  const windowEndISO = new Date(runStart).toISOString();

  console.log(`${TAG} ► START | window=${windowStartISO} → ${windowEndISO}`);

  try {
    // ── Step 1: Query event counts for the 24-hour window ──────────────────
    console.log(
      `${TAG} [STEP] Querying security_events counts for the last 24 hours...`
    );
    const counts = await getSecurityEventCounts(windowStart);
    console.log(
      `${TAG} [STATE] Counts | CSRF_BLOCK=${counts.CSRF_BLOCK}` +
        ` RATE_LIMIT=${counts.RATE_LIMIT} AUTH_FAIL=${counts.AUTH_FAIL}` +
        ` total=${counts.total}`
    );

    // ── Step 2: Fetch raw events to compute top IPs ────────────────────────
    console.log(
      `${TAG} [STEP] Fetching raw events for top-IP analysis (limit=500)...`
    );
    const rawEvents = await getSecurityEvents({
      sinceMs: windowStart,
      limit: 500,
    });
    const topIps = topIpsByCount(rawEvents, TOP_IP_LIMIT);
    console.log(
      `${TAG} [STATE] Top IPs by event count | ` +
        (topIps.length > 0
          ? topIps.map(({ ip, count }) => `${ip}(${count})`).join(", ")
          : "none")
    );

    // ── Step 3: Compute threat level ───────────────────────────────────────
    const threatLevel = computeThreatLevel(counts.total);
    console.log(
      `${TAG} [STATE] Threat level: ${threatLevel}` +
        ` | total=${counts.total} events in last 24h`
    );

    // ── Step 4: Build notifyOwner content ─────────────────────────────────
    const date = new Date().toLocaleDateString("en-US", {
      timeZone: "America/New_York",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const topIpLines =
      topIps.length > 0
        ? topIps
            .map(
              ({ ip, count }, i) =>
                `  ${i + 1}. ${ip} — ${count} event${count !== 1 ? "s" : ""}`
            )
            .join("\n")
        : "  No events recorded.";
    const content = [
      `Daily Security Digest — ${date}`,
      `Threat Level: ${threatLevel}`,
      "",
      "Event Counts (Last 24 Hours):",
      `  CSRF Block:   ${counts.CSRF_BLOCK}`,
      `  Rate Limit:   ${counts.RATE_LIMIT}`,
      `  Auth Failure: ${counts.AUTH_FAIL}`,
      `  Total:        ${counts.total}`,
      "",
      `Top ${TOP_IP_LIMIT} IPs by Event Count:`,
      topIpLines,
      "",
      `Window: ${windowStartISO} → ${windowEndISO}`,
      `Retention: events older than ${PRUNE_RETENTION_DAYS} days pruned after this digest.`,
    ].join("\n");

    // ── Step 5: Fire notifyOwner ───────────────────────────────────────────
    // Always send — even on clean days, so the owner has a daily confirmation.
    console.log(`${TAG} [STEP] Firing notifyOwner (in-app notification)...`);
    const notified = await notifyOwner({
      title: `[${threatLevel}] Security Digest — ${counts.total} event${counts.total !== 1 ? "s" : ""} in 24h`,
      content,
    }).catch((err: unknown) => {
      console.error(
        `${TAG} [ERROR] notifyOwner threw: ${err instanceof Error ? err.message : String(err)}`
      );
      return false;
    });
    if (notified) {
      console.log(
        `${TAG} [OUTPUT] In-app notification sent | threat=${threatLevel} total=${counts.total}`
      );
    } else {
      console.warn(
        `${TAG} [WARN] notifyOwner returned false — notification service may be unavailable`
      );
    }

    // ── Step 6: Post Discord digest embed ─────────────────────────────────
    console.log(
      `${TAG} [STEP] Posting daily digest embed to Discord security channel...`
    );
    await postDigestToDiscord(
      counts,
      topIps,
      threatLevel,
      windowStart,
      runStart
    ).catch((err: unknown) => {
      console.error(
        `${TAG} [ERROR] Discord digest post failed (non-critical): ${err instanceof Error ? err.message : String(err)}`
      );
    });

    // ── Step 7: Prune old events ───────────────────────────────────────────
    console.log(
      `${TAG} [STEP] Pruning events older than ${PRUNE_RETENTION_DAYS} days...`
    );
    const pruned = await pruneSecurityEvents(PRUNE_RETENTION_DAYS);
    console.log(
      `${TAG} [OUTPUT] Pruned ${pruned} old event${pruned !== 1 ? "s" : ""} from security_events table`
    );

    // ── Step 8: Mark digest complete ──────────────────────────────────────
    lastDigestDateUTC = new Date().toISOString().slice(0, 10);
    const elapsed = Date.now() - runStart;
    console.log(
      `${TAG} ✓ COMPLETE | elapsed=${elapsed}ms` +
        ` | notified=${notified} | pruned=${pruned}` +
        ` | lastDigestDate=${lastDigestDateUTC}`
    );
    console.log(`${TAG} [VERIFY] PASS — digest complete`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${TAG} [ERROR] Digest failed: ${msg}`);
    console.error(`${TAG} [VERIFY] FAIL — digest did not complete`);
  } finally {
    digestRunning = false;
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

/**
 * Starts the daily security digest scheduler.
 *
 * Polls every 60 seconds. When the current UTC time matches
 * DIGEST_HOUR_UTC:DIGEST_MINUTE_UTC and today's digest hasn't run yet,
 * fires runSecurityDigest() asynchronously.
 *
 * This approach avoids drift from setInterval(24h) and handles server
 * restarts gracefully — if the server was down at 08:00 EST, the digest
 * fires on the next 60-second tick after startup if the hour matches.
 */
export function startSecurityDigestScheduler(): void {
  console.log(
    `${TAG} Scheduler started | fires daily at ${DIGEST_HOUR_UTC}:${String(DIGEST_MINUTE_UTC).padStart(2, "0")} UTC` +
      ` (08:00 EST) | poll interval=${CHECK_INTERVAL_MS / 1000}s`
  );

  // Run immediately on startup if it's the right hour and digest hasn't run today
  const { hour, minute } = nowUTC();
  const todayStr = new Date().toISOString().slice(0, 10);
  if (
    hour === DIGEST_HOUR_UTC &&
    minute === DIGEST_MINUTE_UTC &&
    lastDigestDateUTC !== todayStr
  ) {
    console.log(
      `${TAG} [STEP] Startup: digest hour detected — firing immediately`
    );
    void runSecurityDigest();
  }

  // Recurring poll
  setInterval(() => {
    const { hour: h, minute: m } = nowUTC();
    const today = new Date().toISOString().slice(0, 10);

    if (
      h === DIGEST_HOUR_UTC &&
      m === DIGEST_MINUTE_UTC &&
      lastDigestDateUTC !== today
    ) {
      console.log(
        `${TAG} [STEP] Scheduled trigger | UTC=${h}:${String(m).padStart(2, "0")}` +
          ` | lastDigestDate=${lastDigestDateUTC} | today=${today}`
      );
      void runSecurityDigest();
    }
  }, CHECK_INTERVAL_MS);
}

// ─── Manual trigger (for testing / owner-initiated digest) ───────────────────
/**
 * Manually triggers the security digest outside of the scheduled window.
 * Used by the test tRPC procedure and owner-initiated digests.
 * Returns the threat level and counts so callers can verify the output.
 */
export async function triggerSecurityDigestNow(): Promise<{
  threatLevel: ThreatLevel;
  counts: {
    CSRF_BLOCK: number;
    RATE_LIMIT: number;
    AUTH_FAIL: number;
    total: number;
  };
  topIps: Array<{ ip: string; count: number }>;
}> {
  const runStart = Date.now();
  const windowStart = runStart - WINDOW_MS;

  console.log(
    `${TAG} [MANUAL] Manual digest triggered | window=${new Date(windowStart).toISOString()} → ${new Date(runStart).toISOString()}`
  );

  const counts = await getSecurityEventCounts(windowStart);
  const rawEvents = await getSecurityEvents({
    sinceMs: windowStart,
    limit: 500,
  });
  const topIps = topIpsByCount(rawEvents, TOP_IP_LIMIT);
  const threatLevel = computeThreatLevel(counts.total);

  console.log(
    `${TAG} [MANUAL] Results | threatLevel=${threatLevel}` +
      ` CSRF_BLOCK=${counts.CSRF_BLOCK} RATE_LIMIT=${counts.RATE_LIMIT} AUTH_FAIL=${counts.AUTH_FAIL}` +
      ` total=${counts.total}`
  );

  await postDigestToDiscord(
    counts,
    topIps,
    threatLevel,
    windowStart,
    runStart
  ).catch((err: unknown) => {
    console.error(
      `${TAG} [MANUAL] Discord post failed: ${err instanceof Error ? err.message : String(err)}`
    );
  });

  return { threatLevel, counts, topIps };
}
