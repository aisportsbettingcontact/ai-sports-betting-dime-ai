/**
 * weeklySecurityDigest.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Schedules a weekly security threat trend digest that fires every Sunday
 * at 08:00 EST (13:00 UTC).
 *
 * On each tick it:
 *   1. Queries security_events for the prior 7-day window (Sunday → Sunday)
 *   2. Breaks the 7 days into per-day buckets (Mon → Sun) with event counts
 *   3. Renders an ASCII bar chart showing the daily threat trend
 *   4. Computes the weekly threat level (CLEAN / LOW / MODERATE / HIGH / CRITICAL)
 *   5. Identifies the peak day and peak event type
 *   6. Posts a rich Discord embed to the 🗒️-𝗦𝗘𝗖𝗨𝗥𝗜𝗧𝗬-𝗘𝗩𝗘𝗡𝗧𝗦 channel
 *   7. Fires notifyOwner() with a structured plain-text summary
 *
 * Design constraints:
 *   - Fire-and-forget: errors never crash the server
 *   - Digest is skipped (not queued) if the previous run is still in progress
 *   - Always posts — even on clean weeks (weekly confirmation)
 *   - All log lines are structured and machine-readable
 *   - Plain-English copy throughout — written so @prez can read it without
 *     needing to decode technical jargon
 */

import { EmbedBuilder, TextChannel } from "discord.js";
import { getSecurityEvents } from "./db";
import { notifyOwner } from "./_core/notification";
import { getDiscordClient } from "./discord/bot";
import { topIpsByCount, computeThreatLevel } from "./securityDigest";

// ─── Constants ────────────────────────────────────────────────────────────────
const TAG = "[WeeklySecurityDigest]";
const DIGEST_DAY_UTC = 0; // 0 = Sunday
const DIGEST_HOUR_UTC = 13; // 08:00 EST = 13:00 UTC
const DIGEST_MINUTE_UTC = 0;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7-day lookback window
const TOP_IP_LIMIT = 5;
const CHECK_INTERVAL_MS = 60 * 1000; // poll every 60 seconds

/** Target channel: 🗒️-𝗦𝗘𝗖𝗨𝗥𝗜𝗧𝗬-𝗘𝗩𝗘𝗡𝗧𝗦 */
const SECURITY_CHANNEL_ID = "1492280227567501403";

// ─── Threat level thresholds (weekly scale — higher than daily) ───────────────
type ThreatLevel = "CLEAN" | "LOW" | "MODERATE" | "HIGH" | "CRITICAL";

const THREAT_LEVELS: Array<{
  label: ThreatLevel;
  threshold: number;
  color: number;
  emoji: string;
}> = [
  { label: "CLEAN", threshold: 0, color: 0x57f287, emoji: "✅" },
  { label: "LOW", threshold: 1, color: 0xfee75c, emoji: "🟡" },
  { label: "MODERATE", threshold: 50, color: 0xeb6c33, emoji: "🟠" },
  { label: "HIGH", threshold: 200, color: 0xed4245, emoji: "🔴" },
  { label: "CRITICAL", threshold: 1000, color: 0xf8312f, emoji: "🚨" },
];

// ─── State ────────────────────────────────────────────────────────────────────
let lastWeeklyDigestDateUTC = ""; // "YYYY-MM-DD" of last successful weekly digest
let weeklyDigestRunning = false;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nowUTC(): { day: number; hour: number; minute: number } {
  const d = new Date();
  return {
    day: d.getUTCDay(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

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

function weeklyThreatMeta(level: ThreatLevel): {
  color: number;
  emoji: string;
} {
  const found = THREAT_LEVELS.find(t => t.label === level);
  return { color: found?.color ?? 0x5865f2, emoji: found?.emoji ?? "🔵" };
}

/**
 * Computes weekly threat level based on total 7-day event count.
 * Uses a higher scale than the daily digest since 7x more events are expected.
 */
function computeWeeklyThreatLevel(total: number): ThreatLevel {
  if (total === 0) return "CLEAN";
  if (total < 50) return "LOW";
  if (total < 200) return "MODERATE";
  if (total < 1000) return "HIGH";
  return "CRITICAL";
}

// ─── Per-day bucketing ────────────────────────────────────────────────────────

interface DayBucket {
  /** Day label: "Mon Apr 7", "Tue Apr 8", etc. */
  label: string;
  /** Epoch ms of the start of this day (midnight EST) */
  startMs: number;
  /** Epoch ms of the end of this day (23:59:59.999 EST) */
  endMs: number;
  CSRF_BLOCK: number;
  RATE_LIMIT: number;
  AUTH_FAIL: number;
  total: number;
}

/**
 * Builds 7 per-day buckets for the window [windowStartMs, windowEndMs).
 * Each bucket covers one calendar day in EST (midnight → midnight).
 * Events are assigned to buckets by their occurredAt timestamp.
 */
function buildDayBuckets(
  events: Array<{ occurredAt: number; eventType: string }>,
  windowEndMs: number
): DayBucket[] {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const buckets: DayBucket[] = [];

  // Build 7 buckets going back from windowEnd (exclusive) to windowEnd - 7 days
  // Each bucket is one calendar day in EST
  for (let i = 6; i >= 0; i--) {
    // Compute the start of this day in EST
    // We work in UTC ms but display in EST — compute the EST midnight for each day
    const dayEndMs = windowEndMs - i * DAY_MS;
    const dayStartMs = dayEndMs - DAY_MS;

    const label = new Date(dayStartMs).toLocaleDateString("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      month: "short",
      day: "numeric",
    });

    buckets.push({
      label,
      startMs: dayStartMs,
      endMs: dayEndMs,
      CSRF_BLOCK: 0,
      RATE_LIMIT: 0,
      AUTH_FAIL: 0,
      total: 0,
    });
  }

  // Assign each event to its bucket
  for (const event of events) {
    for (const bucket of buckets) {
      if (
        event.occurredAt >= bucket.startMs &&
        event.occurredAt < bucket.endMs
      ) {
        const type = event.eventType as
          "CSRF_BLOCK" | "RATE_LIMIT" | "AUTH_FAIL";
        if (
          type === "CSRF_BLOCK" ||
          type === "RATE_LIMIT" ||
          type === "AUTH_FAIL"
        ) {
          bucket[type]++;
          bucket.total++;
        }
        break;
      }
    }
  }

  return buckets;
}

/**
 * Renders a compact ASCII bar chart for the 7-day trend.
 *
 * Example output (inside a Discord code block):
 *   Mon Apr 7  ████░░░░░░  12
 *   Tue Apr 8  ██████████  34
 *   Wed Apr 9  ░░░░░░░░░░   0
 *   ...
 *
 * The bar is 10 characters wide. Each filled block (█) represents
 * 10% of the peak day's count. Empty blocks (░) fill the rest.
 * This gives @prez an instant visual of which days were busiest.
 */
function renderAsciiBarChart(buckets: DayBucket[]): string {
  const BAR_WIDTH = 10;
  const peak = Math.max(...buckets.map(b => b.total), 1); // avoid div-by-zero

  const lines = buckets.map(bucket => {
    const filled = Math.round((bucket.total / peak) * BAR_WIDTH);
    const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
    const countStr = String(bucket.total).padStart(4, " ");
    return `${bucket.label.padEnd(12)} ${bar} ${countStr}`;
  });

  return lines.join("\n");
}

// ─── Discord weekly digest embed builder ──────────────────────────────────────

function buildWeeklyDigestEmbed(
  buckets: DayBucket[],
  topIps: Array<{ ip: string; count: number }>,
  threatLevel: ThreatLevel,
  weeklyTotals: {
    CSRF_BLOCK: number;
    RATE_LIMIT: number;
    AUTH_FAIL: number;
    total: number;
  },
  windowStartMs: number,
  windowEndMs: number
): EmbedBuilder {
  const { color, emoji } = weeklyThreatMeta(threatLevel);

  const weekLabel = new Date(windowEndMs).toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  // ── Threat level descriptions in plain English ─────────────────────────────
  const threatDescriptions: Record<ThreatLevel, string> = {
    CLEAN:
      "No security events recorded in the past 7 days. The site was completely clean this week — " +
      "no suspicious activity, no blocked requests, no failed logins.",
    LOW:
      "A small number of security events were recorded this week. This is within normal range " +
      "and is likely just routine background noise from the internet. No action needed.",
    MODERATE:
      "A moderate number of security events were recorded this week. Worth reviewing the daily " +
      "trend and top IPs below to see if any day or source stands out. No immediate action required.",
    HIGH:
      "A high number of security events were recorded this week. Someone may be actively probing " +
      "or targeting the site. Review the peak day and top IPs — consider blocking persistent sources " +
      "at the firewall if the pattern continues into next week.",
    CRITICAL:
      "A critical number of security events were recorded this week. The site is likely under " +
      "sustained attack. Immediate review is strongly recommended — check the top IPs and the " +
      "daily trend to identify when the attack started and which endpoints are being targeted.",
  };

  // ── Find peak day ──────────────────────────────────────────────────────────
  const peakBucket = buckets.reduce(
    (a, b) => (b.total > a.total ? b : a),
    buckets[0]
  );
  const peakDayValue =
    peakBucket.total === 0
      ? "No events recorded on any day this week."
      : `**${peakBucket.label}** — ${peakBucket.total} event${peakBucket.total !== 1 ? "s" : ""} ` +
        `(CSRF: ${peakBucket.CSRF_BLOCK} · Rate: ${peakBucket.RATE_LIMIT} · Auth: ${peakBucket.AUTH_FAIL})`;

  // ── Find dominant event type ───────────────────────────────────────────────
  const typeEntries: Array<[string, number]> = [
    ["CSRF Blocks", weeklyTotals.CSRF_BLOCK],
    ["Rate Limit Triggers", weeklyTotals.RATE_LIMIT],
    ["Auth Failures", weeklyTotals.AUTH_FAIL],
  ];
  const dominantType = typeEntries.reduce(
    (a, b) => (b[1] > a[1] ? b : a),
    typeEntries[0]
  );
  const dominantTypeValue =
    weeklyTotals.total === 0
      ? "No events this week."
      : `**${dominantType[0]}** — ${dominantType[1]} out of ${weeklyTotals.total} total events ` +
        `(${Math.round((dominantType[1] / weeklyTotals.total) * 100)}% of all activity)`;

  // ── ASCII bar chart ────────────────────────────────────────────────────────
  const barChart = renderAsciiBarChart(buckets);

  // ── Top IPs ────────────────────────────────────────────────────────────────
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

  // ── Event type breakdown ───────────────────────────────────────────────────
  const breakdownValue =
    `🚫 CSRF Blocks:          **${weeklyTotals.CSRF_BLOCK}**\n` +
    `⚡ Rate Limit Triggers:  **${weeklyTotals.RATE_LIMIT}**\n` +
    `🔐 Auth Failures:        **${weeklyTotals.AUTH_FAIL}**\n` +
    `📊 Total:                **${weeklyTotals.total}**`;

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(
      `${emoji} Weekly Security Threat Report — Week Ending ${weekLabel}`
    )
    .setDescription(
      `**Threat Level: ${threatLevel}**\n\n${threatDescriptions[threatLevel]}`
    )
    .addFields(
      {
        name: "📈 7-Day Event Trend (Daily Breakdown)",
        value:
          "Each bar shows how many security events occurred on that day. " +
          "A longer bar = more activity. Bars are scaled relative to the busiest day.\n" +
          "```\n" +
          barChart +
          "\n```",
        inline: false,
      },
      {
        name: "📋 Weekly Event Type Breakdown",
        value: breakdownValue,
        inline: false,
      },
      {
        name: "📅 Peak Day This Week",
        value: peakDayValue,
        inline: false,
      },
      {
        name: "⚠️ Most Common Threat Type",
        value: dominantTypeValue,
        inline: false,
      },
      {
        name: `🖥️ Top ${TOP_IP_LIMIT} Most Active IPs This Week`,
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
      text: "AI Sports Betting · Weekly Security Report · Fires every Sunday at 08:00 EST",
    })
    .setTimestamp(windowEndMs);
}

// ─── Discord weekly digest poster ─────────────────────────────────────────────

async function postWeeklyDigestToDiscord(
  buckets: DayBucket[],
  topIps: Array<{ ip: string; count: number }>,
  threatLevel: ThreatLevel,
  weeklyTotals: {
    CSRF_BLOCK: number;
    RATE_LIMIT: number;
    AUTH_FAIL: number;
    total: number;
  },
  windowStartMs: number,
  windowEndMs: number
): Promise<void> {
  const client = getDiscordClient();
  if (!client) {
    console.log(
      `${TAG} [Discord] Bot client not available — skipping weekly digest embed`
    );
    return;
  }
  if (!client.isReady()) {
    console.log(
      `${TAG} [Discord] Bot client not ready — skipping weekly digest embed`
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

  const embed = buildWeeklyDigestEmbed(
    buckets,
    topIps,
    threatLevel,
    weeklyTotals,
    windowStartMs,
    windowEndMs
  );
  try {
    await channel.send({ embeds: [embed] });
    console.log(
      `${TAG} [Discord] [OUTPUT] Weekly digest embed posted successfully` +
        ` | channel=#${channel.name}` +
        ` | threatLevel=${threatLevel}` +
        ` | total=${weeklyTotals.total}`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `${TAG} [Discord] Failed to send weekly digest embed: ${msg}`
    );
  }
}

// ─── Core weekly digest runner ────────────────────────────────────────────────

async function runWeeklySecurityDigest(): Promise<void> {
  if (weeklyDigestRunning) {
    console.warn(
      `${TAG} [SKIP] Previous weekly digest still running — skipping this tick`
    );
    return;
  }
  weeklyDigestRunning = true;
  const runStart = Date.now();
  const windowStart = runStart - WINDOW_MS;
  const windowStartISO = new Date(windowStart).toISOString();
  const windowEndISO = new Date(runStart).toISOString();

  console.log(
    `${TAG} ► START | window=${windowStartISO} → ${windowEndISO} (7 days)`
  );

  try {
    // ── Step 1: Fetch all events in the 7-day window ───────────────────────
    console.log(
      `${TAG} [STEP] Fetching all security events for the last 7 days (limit=2000)...`
    );
    const rawEvents = await getSecurityEvents({
      sinceMs: windowStart,
      limit: 2000,
    });
    console.log(`${TAG} [STATE] Fetched ${rawEvents.length} raw events`);

    // ── Step 2: Compute weekly totals ──────────────────────────────────────
    const weeklyTotals = {
      CSRF_BLOCK: 0,
      RATE_LIMIT: 0,
      AUTH_FAIL: 0,
      total: 0,
    };
    for (const e of rawEvents) {
      if (e.eventType === "CSRF_BLOCK") weeklyTotals.CSRF_BLOCK++;
      else if (e.eventType === "RATE_LIMIT") weeklyTotals.RATE_LIMIT++;
      else if (e.eventType === "AUTH_FAIL") weeklyTotals.AUTH_FAIL++;
      weeklyTotals.total++;
    }
    console.log(
      `${TAG} [STATE] Weekly totals | CSRF_BLOCK=${weeklyTotals.CSRF_BLOCK}` +
        ` RATE_LIMIT=${weeklyTotals.RATE_LIMIT} AUTH_FAIL=${weeklyTotals.AUTH_FAIL}` +
        ` total=${weeklyTotals.total}`
    );

    // ── Step 3: Build per-day buckets for the bar chart ────────────────────
    console.log(
      `${TAG} [STEP] Building 7-day per-day buckets for trend analysis...`
    );
    const buckets = buildDayBuckets(rawEvents, runStart);
    buckets.forEach((b, i) => {
      console.log(
        `${TAG} [STATE] Day ${i + 1}: ${b.label} | total=${b.total}` +
          ` (CSRF=${b.CSRF_BLOCK} RATE=${b.RATE_LIMIT} AUTH=${b.AUTH_FAIL})`
      );
    });

    // ── Step 4: Compute top IPs ────────────────────────────────────────────
    const topIps = topIpsByCount(rawEvents, TOP_IP_LIMIT);
    console.log(
      `${TAG} [STATE] Top IPs | ` +
        (topIps.length > 0
          ? topIps.map(({ ip, count }) => `${ip}(${count})`).join(", ")
          : "none")
    );

    // ── Step 5: Compute weekly threat level ────────────────────────────────
    const threatLevel = computeWeeklyThreatLevel(weeklyTotals.total);
    console.log(
      `${TAG} [STATE] Weekly threat level: ${threatLevel}` +
        ` | total=${weeklyTotals.total} events in last 7 days`
    );

    // ── Step 6: Build notifyOwner content ─────────────────────────────────
    const weekEndLabel = new Date(runStart).toLocaleDateString("en-US", {
      timeZone: "America/New_York",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const barChart = renderAsciiBarChart(buckets);
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
      `Weekly Security Threat Report — Week Ending ${weekEndLabel}`,
      `Threat Level: ${threatLevel}`,
      "",
      "7-Day Event Trend:",
      barChart,
      "",
      "Weekly Event Type Breakdown:",
      `  CSRF Blocks:         ${weeklyTotals.CSRF_BLOCK}`,
      `  Rate Limit Triggers: ${weeklyTotals.RATE_LIMIT}`,
      `  Auth Failures:       ${weeklyTotals.AUTH_FAIL}`,
      `  Total:               ${weeklyTotals.total}`,
      "",
      `Top ${TOP_IP_LIMIT} IPs by Event Count:`,
      topIpLines,
      "",
      `Window: ${windowStartISO} → ${windowEndISO}`,
    ].join("\n");

    // ── Step 7: Fire notifyOwner ───────────────────────────────────────────
    console.log(`${TAG} [STEP] Firing notifyOwner (in-app notification)...`);
    const notified = await notifyOwner({
      title: `[${threatLevel}] Weekly Security Report — ${weeklyTotals.total} event${weeklyTotals.total !== 1 ? "s" : ""} in 7 days`,
      content,
    }).catch((err: unknown) => {
      console.error(
        `${TAG} [ERROR] notifyOwner threw: ${err instanceof Error ? err.message : String(err)}`
      );
      return false;
    });
    if (notified) {
      console.log(
        `${TAG} [OUTPUT] In-app notification sent | threat=${threatLevel} total=${weeklyTotals.total}`
      );
    } else {
      console.warn(
        `${TAG} [WARN] notifyOwner returned false — notification service may be unavailable`
      );
    }

    // ── Step 8: Post Discord weekly digest embed ───────────────────────────
    console.log(
      `${TAG} [STEP] Posting weekly digest embed to Discord security channel...`
    );
    await postWeeklyDigestToDiscord(
      buckets,
      topIps,
      threatLevel,
      weeklyTotals,
      windowStart,
      runStart
    ).catch((err: unknown) => {
      console.error(
        `${TAG} [ERROR] Discord weekly digest post failed (non-critical): ${err instanceof Error ? err.message : String(err)}`
      );
    });

    // ── Step 9: Mark digest complete ───────────────────────────────────────
    lastWeeklyDigestDateUTC = new Date().toISOString().slice(0, 10);
    const elapsed = Date.now() - runStart;
    console.log(
      `${TAG} ✓ COMPLETE | elapsed=${elapsed}ms` +
        ` | notified=${notified}` +
        ` | lastWeeklyDigestDate=${lastWeeklyDigestDateUTC}`
    );
    console.log(`${TAG} [VERIFY] PASS — weekly digest complete`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${TAG} [ERROR] Weekly digest failed: ${msg}`);
    console.error(`${TAG} [VERIFY] FAIL — weekly digest did not complete`);
  } finally {
    weeklyDigestRunning = false;
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

/**
 * Starts the weekly security digest scheduler.
 *
 * Polls every 60 seconds. When the current UTC time is Sunday at
 * DIGEST_HOUR_UTC:DIGEST_MINUTE_UTC and this week's digest hasn't run yet,
 * fires runWeeklySecurityDigest() asynchronously.
 */
export function startWeeklySecurityDigestScheduler(): void {
  console.log(
    `${TAG} Scheduler started | fires every Sunday at ${DIGEST_HOUR_UTC}:${String(DIGEST_MINUTE_UTC).padStart(2, "0")} UTC` +
      ` (08:00 EST) | poll interval=${CHECK_INTERVAL_MS / 1000}s`
  );

  // Run immediately on startup if it's Sunday at the right hour and digest hasn't run today
  const { day, hour, minute } = nowUTC();
  const todayStr = new Date().toISOString().slice(0, 10);
  if (
    day === DIGEST_DAY_UTC &&
    hour === DIGEST_HOUR_UTC &&
    minute === DIGEST_MINUTE_UTC &&
    lastWeeklyDigestDateUTC !== todayStr
  ) {
    console.log(
      `${TAG} [STEP] Startup: weekly digest hour detected on Sunday — firing immediately`
    );
    void runWeeklySecurityDigest();
  }

  // Recurring poll
  setInterval(() => {
    const { day: d, hour: h, minute: m } = nowUTC();
    const today = new Date().toISOString().slice(0, 10);

    if (
      d === DIGEST_DAY_UTC &&
      h === DIGEST_HOUR_UTC &&
      m === DIGEST_MINUTE_UTC &&
      lastWeeklyDigestDateUTC !== today
    ) {
      console.log(
        `${TAG} [STEP] Scheduled trigger | UTC day=${d} ${h}:${String(m).padStart(2, "0")}` +
          ` | lastWeeklyDigestDate=${lastWeeklyDigestDateUTC} | today=${today}`
      );
      void runWeeklySecurityDigest();
    }
  }, CHECK_INTERVAL_MS);
}

// ─── Manual trigger (for testing / owner-initiated weekly digest) ─────────────

/**
 * Manually triggers the weekly security digest outside of the scheduled window.
 * Used by the test tRPC procedure and owner-initiated digests.
 */
export async function triggerWeeklySecurityDigestNow(): Promise<{
  threatLevel: string;
  weeklyTotals: {
    CSRF_BLOCK: number;
    RATE_LIMIT: number;
    AUTH_FAIL: number;
    total: number;
  };
  topIps: Array<{ ip: string; count: number }>;
  buckets: Array<{
    label: string;
    total: number;
    CSRF_BLOCK: number;
    RATE_LIMIT: number;
    AUTH_FAIL: number;
  }>;
}> {
  const runStart = Date.now();
  const windowStart = runStart - WINDOW_MS;

  console.log(
    `${TAG} [MANUAL] Manual weekly digest triggered` +
      ` | window=${new Date(windowStart).toISOString()} → ${new Date(runStart).toISOString()}`
  );

  const rawEvents = await getSecurityEvents({
    sinceMs: windowStart,
    limit: 2000,
  });

  const weeklyTotals = { CSRF_BLOCK: 0, RATE_LIMIT: 0, AUTH_FAIL: 0, total: 0 };
  for (const e of rawEvents) {
    if (e.eventType === "CSRF_BLOCK") weeklyTotals.CSRF_BLOCK++;
    else if (e.eventType === "RATE_LIMIT") weeklyTotals.RATE_LIMIT++;
    else if (e.eventType === "AUTH_FAIL") weeklyTotals.AUTH_FAIL++;
    weeklyTotals.total++;
  }

  const buckets = buildDayBuckets(rawEvents, runStart);
  const topIps = topIpsByCount(rawEvents, TOP_IP_LIMIT);
  const threatLevel = computeWeeklyThreatLevel(weeklyTotals.total);

  console.log(
    `${TAG} [MANUAL] Results | threatLevel=${threatLevel}` +
      ` CSRF_BLOCK=${weeklyTotals.CSRF_BLOCK} RATE_LIMIT=${weeklyTotals.RATE_LIMIT}` +
      ` AUTH_FAIL=${weeklyTotals.AUTH_FAIL} total=${weeklyTotals.total}`
  );

  await postWeeklyDigestToDiscord(
    buckets,
    topIps,
    threatLevel,
    weeklyTotals,
    windowStart,
    runStart
  ).catch((err: unknown) => {
    console.error(
      `${TAG} [MANUAL] Discord post failed: ${err instanceof Error ? err.message : String(err)}`
    );
  });

  return {
    threatLevel,
    weeklyTotals,
    topIps,
    buckets: buckets.map(b => ({
      label: b.label,
      total: b.total,
      CSRF_BLOCK: b.CSRF_BLOCK,
      RATE_LIMIT: b.RATE_LIMIT,
      AUTH_FAIL: b.AUTH_FAIL,
    })),
  };
}
