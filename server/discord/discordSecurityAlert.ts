/**
 * discordSecurityAlert.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Posts structured Discord embeds to the 🗒️-𝗦𝗘𝗖𝗨𝗥𝗜𝗧𝗬-𝗘𝗩𝗘𝗡𝗧𝗦 channel
 * (ID: 1492280227567501403) from the bot (ID: 1483226227056574590).
 *
 * Three real-time event types are supported:
 *   • CSRF_BLOCK  — Origin header mismatch on a tRPC mutation (red embed)
 *   • RATE_LIMIT  — Express rate limiter triggered (yellow embed)
 *   • AUTH_FAIL   — Login attempt rejected (orange embed)
 *
 * Plus one escalation alert:
 *   • BRUTE_FORCE — IP triggers 3+ AUTH_FAIL events within 10 minutes (bright red + @here)
 *
 * ─── Design principles ───────────────────────────────────────────────────────
 *   1. FIRE-AND-FORGET — never awaited at call sites; never blocks the HTTP response.
 *   2. ZERO NOISE — only posts when the bot client is ready; silently skips otherwise.
 *   3. STRUCTURED LOGGING — every step emits a labeled console line so the server
 *      log is independently interpretable without opening Discord.
 *   4. DEDUP GUARD — in-memory cooldown per (eventType + IP) to prevent embed floods
 *      when a single attacker hammers an endpoint. Default: 30 s per event type per IP.
 *   5. GRACEFUL FAILURE — all errors are caught and logged; never propagate.
 *   6. BRUTE-FORCE DETECTION — sliding 10-minute window per IP; escalates to @here
 *      when 3+ AUTH_FAIL events are detected from the same source.
 *
 * ─── Embed color palette ─────────────────────────────────────────────────────
 *   CSRF_BLOCK   → 0xED4245  (Discord danger red)
 *   RATE_LIMIT   → 0xFEE75C  (Discord warning yellow)
 *   AUTH_FAIL    → 0xEB6C33  (Discord orange)
 *   BRUTE_FORCE  → 0xF8312F  (Bright red — escalation)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { EmbedBuilder, TextChannel } from "discord.js";
import { getDiscordClient } from "./bot";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Target channel: 🗒️-𝗦𝗘𝗖𝗨𝗥𝗜𝗧𝗬-𝗘𝗩𝗘𝗡𝗧𝗦 */
const SECURITY_CHANNEL_ID = "1492280227567501403";

/** In-memory cooldown: at most 1 Discord post per (eventType + IP) per window */
const DISCORD_ALERT_DEDUP_MS = 30_000; // 30 seconds
const alertLastPosted = new Map<string, number>(); // key → timestamp

// ─── Brute-force detection constants ─────────────────────────────────────────
/**
 * Sliding window brute-force detection:
 *   - Track AUTH_FAIL timestamps per IP in a rolling 10-minute window
 *   - If 3 or more AUTH_FAIL events occur from the same IP within 10 minutes → escalate
 *   - Escalation posts a bright-red @here embed to the security channel
 *   - Escalation cooldown: 10 minutes per IP (one @here per IP per window)
 */
const BRUTE_FORCE_WINDOW_MS   = 10 * 60 * 1000; // 10-minute sliding window
const BRUTE_FORCE_THRESHOLD   = 3;               // 3+ AUTH_FAILs in window = brute-force
const BRUTE_FORCE_COOLDOWN_MS = 10 * 60 * 1000; // 10-minute cooldown between @here alerts per IP

/** Per-IP sliding window: IP → list of AUTH_FAIL epoch timestamps */
const authFailTimestamps = new Map<string, number[]>();

/** Per-IP escalation cooldown: IP → last escalation epoch timestamp */
const bruteForceLastAlerted = new Map<string, number>();

// ─── Embed color palette ──────────────────────────────────────────────────────
const EMBED_COLORS = {
  CSRF_BLOCK:  0xed4245,  // Discord danger red
  RATE_LIMIT:  0xfee75c,  // Discord warning yellow
  AUTH_FAIL:   0xeb6c33,  // Discord orange
  BRUTE_FORCE: 0xf8312f,  // Bright red — escalation
} as const;

// ─── Event type union ─────────────────────────────────────────────────────────
export type SecurityEventType = "CSRF_BLOCK" | "RATE_LIMIT" | "AUTH_FAIL";

// ─── Payload interface ────────────────────────────────────────────────────────
export interface SecurityAlertPayload {
  /** One of the three tracked event types */
  eventType: SecurityEventType;
  /** Client IP (may be "unknown") */
  ip: string;
  /** Origin header value (CSRF_BLOCK only; null for others) */
  blockedOrigin?: string | null;
  /** tRPC procedure path or Express route path */
  path: string;
  /** HTTP method (GET / POST / etc.) */
  method: string;
  /** User-Agent string (truncated to 120 chars for display) */
  userAgent?: string | null;
  /** Contextual label: limiter type for RATE_LIMIT, failure reason for AUTH_FAIL */
  context?: string | null;
  /**
   * AUTH_FAIL only — the sanitized login credential that was targeted.
   * Format: first 3 chars of local email part + *** + @domain (e.g. "ais***@gmail.com")
   * or first 3 chars of username + *** (e.g. "pre***").
   * Never contains the full credential — safe to log and display.
   */
  targetIdentifier?: string | null;
  /** Epoch ms when the event occurred */
  occurredAt: number;
}

// ─── Dedup helper ─────────────────────────────────────────────────────────────
/**
 * Returns true if an alert for this (eventType, ip) was already posted within
 * the cooldown window. Also prunes stale entries to prevent unbounded growth.
 */
function isDeduplicated(eventType: SecurityEventType, ip: string): boolean {
  const now = Date.now();
  const key = `${eventType}:${ip}`;

  // Prune stale entries (max 2000 entries before forced prune)
  if (alertLastPosted.size > 2000) {
    const cutoff = now - DISCORD_ALERT_DEDUP_MS;
    Array.from(alertLastPosted.entries()).forEach(([k, ts]) => {
      if (ts < cutoff) alertLastPosted.delete(k);
    });
  }

  const lastSent = alertLastPosted.get(key) ?? 0;
  if (now - lastSent < DISCORD_ALERT_DEDUP_MS) {
    const remaining = Math.ceil((DISCORD_ALERT_DEDUP_MS - (now - lastSent)) / 1000);
    console.log(
      `[DiscordSecurity][DEDUP] Skipping ${eventType} alert for IP=${ip}` +
      ` — cooldown active (${remaining}s remaining)`
    );
    return true;
  }

  alertLastPosted.set(key, now);
  return false;
}

// ─── Brute-force tracker ──────────────────────────────────────────────────────
/**
 * Records an AUTH_FAIL event for the given IP and checks whether the brute-force
 * threshold has been crossed in the sliding window.
 *
 * Returns:
 *   - { escalate: true, count, windowMs }  → threshold crossed, post @here alert
 *   - { escalate: false }                  → below threshold or in cooldown
 *
 * Side effects:
 *   - Prunes timestamps outside the sliding window for the IP
 *   - Prunes the authFailTimestamps map when it grows beyond 5000 entries
 */
export function trackAuthFailForBruteForce(ip: string, occurredAt: number): {
  escalate: boolean;
  count?: number;
  windowMs?: number;
} {
  const tag = "[DiscordSecurity][BruteForce]";
  const now = occurredAt;
  const cutoff = now - BRUTE_FORCE_WINDOW_MS;

  // Prune stale IPs from the map to prevent unbounded growth
  if (authFailTimestamps.size > 5000) {
    console.log(`${tag} Pruning stale IP entries from brute-force tracker (size=${authFailTimestamps.size})`);
    for (const [k, timestamps] of Array.from(authFailTimestamps.entries())) {
      const fresh = timestamps.filter(t => t > cutoff);
      if (fresh.length === 0) {
        authFailTimestamps.delete(k);
      } else {
        authFailTimestamps.set(k, fresh);
      }
    }
  }

  // Get or initialize timestamps for this IP
  const existing = authFailTimestamps.get(ip) ?? [];

  // Prune timestamps outside the sliding window
  const fresh = existing.filter(t => t > cutoff);

  // Add the new event
  fresh.push(now);
  authFailTimestamps.set(ip, fresh);

  const count = fresh.length;
  const windowSecs = Math.round(BRUTE_FORCE_WINDOW_MS / 1000 / 60);

  console.log(
    `${tag} AUTH_FAIL recorded | IP=${ip}` +
    ` | count=${count} in last ${windowSecs} min` +
    ` | threshold=${BRUTE_FORCE_THRESHOLD}` +
    (count >= BRUTE_FORCE_THRESHOLD ? " | ⚠️ THRESHOLD CROSSED" : "")
  );

  // Check if threshold is crossed
  if (count < BRUTE_FORCE_THRESHOLD) {
    return { escalate: false };
  }

  // Check escalation cooldown — only fire @here once per IP per cooldown window
  const lastEscalated = bruteForceLastAlerted.get(ip) ?? 0;
  if (now - lastEscalated < BRUTE_FORCE_COOLDOWN_MS) {
    const cooldownRemaining = Math.ceil((BRUTE_FORCE_COOLDOWN_MS - (now - lastEscalated)) / 1000 / 60);
    console.log(
      `${tag} Threshold crossed but escalation cooldown active for IP=${ip}` +
      ` | cooldown=${cooldownRemaining} min remaining` +
      ` | count=${count}`
    );
    return { escalate: false };
  }

  // Mark escalation timestamp
  bruteForceLastAlerted.set(ip, now);
  console.log(
    `${tag} 🚨 ESCALATING | IP=${ip}` +
    ` | ${count} AUTH_FAIL events in last ${windowSecs} min` +
    ` | posting @here alert to security channel`
  );

  return { escalate: true, count, windowMs: BRUTE_FORCE_WINDOW_MS };
}

// ─── Timestamp formatter ──────────────────────────────────────────────────────
/**
 * Formats an epoch-ms timestamp as a human-readable EST string.
 * Example: "Apr 10, 2026 · 14:32:07 EST"
 */
function formatTimestamp(epochMs: number): string {
  return new Date(epochMs).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }) + " EST";
}

// ─── Embed builders ───────────────────────────────────────────────────────────

/**
 * Classify the attack origin to provide actionable context in the embed.
 * Returns a label and recommended action based on the blocked origin pattern.
 */
function classifyCsrfOrigin(origin: string | null | undefined, path: string): {
  label: string;
  classification: string;
  recommendation: string;
} {
  const o = origin ?? "";

  // Google Cloud Run — confirmed attack vector (3 probes on 2026-05-24)
  if (o.includes(".run.app")) {
    const isStripeTarget = path.includes("stripe") || path.includes("Checkout");
    return {
      label: "🤖 AUTOMATED PROBE — Google Cloud Run (AS15169)",
      classification:
        `This is an **automated server-side probe** from Google Cloud Run infrastructure.` +
        (isStripeTarget
          ? " The attacker is specifically targeting the **Stripe checkout endpoint** — " +
            "likely attempting to create fraudulent checkout sessions or enumerate pricing."
          : " The attacker is probing API endpoints from a serverless function."),
      recommendation:
        "This is a known attack pattern. The CSRF block is working correctly. " +
        "No action required — the rate limiter on this endpoint will throttle repeated probes. " +
        "If volume increases, consider blocking `*.run.app` at the firewall/CDN level.",
    };
  }

  // Netlify / other serverless free-hosting platforms
  if (o.includes(".netlify.app")) {
    return {
      label: "🤖 AUTOMATED PROBE — Serverless Platform",
      classification: "Request originated from a serverless deployment platform. Likely an automated probe or misconfigured integration.",
      recommendation: "Monitor for repeat attempts from the same origin. If this is a legitimate integration, add its origin to the allowlist.",
    };
  }

  // No origin header at all
  if (!o) {
    return {
      label: "❓ MISSING ORIGIN — Direct API Call",
      classification: "No Origin header was sent. This is typical of server-side HTTP clients (curl, Postman, automated scripts) that do not set Origin.",
      recommendation: "Likely a direct API probe or misconfigured client. Monitor for repeat attempts.",
    };
  }

  // Generic unknown origin
  return {
    label: "⚠️ UNKNOWN ORIGIN — Cross-Site Request",
    classification: "Request came from an origin not on the approved list. Could be a misconfigured client or a CSRF attempt.",
    recommendation: "If this is a one-off, no action needed. If you see many from the same origin, investigate or block at the CDN level.",
  };
}

function buildCsrfBlockEmbed(p: SecurityAlertPayload): EmbedBuilder {
  const { label, classification, recommendation } = classifyCsrfOrigin(p.blockedOrigin, p.path);

  return new EmbedBuilder()
    .setColor(EMBED_COLORS.CSRF_BLOCK)
    .setTitle("🚫 CSRF BLOCK — Cross-Site Attack Attempt Stopped")
    .setDescription(
      `**Classification:** ${label}\n\n` +
      `${classification}\n\n` +
      "**What the server did:** The request was automatically blocked before it could do anything. " +
      "No data was accessed or changed. No Stripe session was created.\n\n" +
      `**Recommended action:** ${recommendation}`
    )
    .addFields(
      {
        name: "🌐 Blocked Origin (Where the Request Came From)",
        value: `\`${p.blockedOrigin ?? "none — Origin header was missing entirely"}\``,
        inline: false,
      },
      { name: "🔗 tRPC Procedure Targeted", value: `\`${p.path}\``,   inline: true  },
      { name: "📡 HTTP Method",             value: `\`${p.method}\``, inline: true  },
      { name: "🖥️ Attacker IP Address",     value: `\`${p.ip}\``,     inline: true  },
      { name: "🕐 Time of Event (EST)",     value: formatTimestamp(p.occurredAt), inline: true  },
      {
        name: "🔍 Browser / Client Signature (User-Agent)",
        value: `\`${(p.userAgent ?? "none — no user-agent header provided").substring(0, 120)}\``,
        inline: false,
      },
      {
        name: "✅ Allowed Origins (for reference)",
        value:
          "Only requests from the official site domain are allowed. " +
          "If a legitimate origin is being blocked, add it to `PUBLIC_ORIGIN` in the server config.",
        inline: false,
      }
    )
    .setFooter({ text: "AI Sports Betting · Security Monitor · CSRF_BLOCK" })
    .setTimestamp(p.occurredAt);
}

function buildRateLimitEmbed(p: SecurityAlertPayload): EmbedBuilder {
  const limiterLabel: Record<string, string> = {
    global:    "Global API Limiter — 200 requests per minute per IP",
    auth:      "Auth Route Limiter — 5 attempts per 15 minutes per IP",
    trpc_auth: "Login Procedure Limiter — 5 login attempts per 15 minutes per IP",
  };
  const limiterDisplay = limiterLabel[p.context ?? ""] ?? (p.context ?? "unknown limiter");

  const limiterExplanation: Record<string, string> = {
    global:
      "This IP sent more than 200 requests in a single minute. " +
      "This is almost always automated — a bot, scraper, or flooding tool. " +
      "Normal users never hit this limit.",
    auth:
      "This IP made more than 5 login or OAuth attempts in 15 minutes. " +
      "This suggests someone is trying to brute-force access to an account. " +
      "They have been temporarily blocked.",
    trpc_auth:
      "This IP attempted the login procedure more than 5 times in 15 minutes. " +
      "This is a strong signal of a credential-stuffing or password-guessing attack. " +
      "The IP is temporarily blocked from making further login attempts.",
  };
  const explanation = limiterExplanation[p.context ?? ""] ??
    "An IP exceeded the allowed request rate and was temporarily blocked with a 429 response.";

  return new EmbedBuilder()
    .setColor(EMBED_COLORS.RATE_LIMIT)
    .setTitle("⚡ RATE LIMIT — IP Blocked for Sending Too Many Requests")
    .setDescription(
      `**What happened:** ${explanation}\n\n` +
      "**What the server did:** The IP received a `429 Too Many Requests` response and was " +
      "temporarily blocked. No data was accessed.\n\n" +
      "**What you should do:** If this is a one-off, no action needed. If the same IP keeps " +
      "triggering this alert, consider permanently blocking it at the firewall."
    )
    .addFields(
      {
        name: "🛡️ Which Rate Limiter Was Triggered",
        value: `\`${limiterDisplay}\``,
        inline: false,
      },
      { name: "🔗 Route / Endpoint Hit",   value: `\`${p.path}\``,   inline: true  },
      { name: "📡 HTTP Method",            value: `\`${p.method}\``, inline: true  },
      { name: "🖥️ Blocked IP Address",     value: `\`${p.ip}\``,     inline: true  },
      { name: "🕐 Time of Event (EST)",    value: formatTimestamp(p.occurredAt), inline: true  },
      {
        name: "🔍 Browser / Client Signature (User-Agent)",
        value: `\`${(p.userAgent ?? "none — no user-agent header provided").substring(0, 120)}\``,
        inline: false,
      }
    )
    .setFooter({ text: "AI Sports Betting · Security Monitor · RATE_LIMIT" })
    .setTimestamp(p.occurredAt);
}

function buildAuthFailEmbed(p: SecurityAlertPayload): EmbedBuilder {
  const reasonLabel: Record<string, string> = {
    user_not_found:          "User Not Found — No account exists with that email or username",
    account_access_disabled: "Access Disabled — The account exists but has been manually locked by the owner",
    account_expired:         "Account Expired — The account's access period has ended",
    invalid_password:        "Wrong Password — The email/username was correct but the password did not match",
  };
  const reasonDisplay = reasonLabel[p.context ?? ""] ?? (p.context ?? "unknown reason");

  const reasonExplanation: Record<string, string> = {
    user_not_found:
      "Someone tried to log in with an email or username that doesn't exist in the system. " +
      "This could be a typo, or someone probing for valid account names.",
    account_access_disabled:
      "Someone tried to log in to an account that has been manually disabled. " +
      "The account exists but access was revoked by the owner.",
    account_expired:
      "Someone tried to log in to an account whose subscription or access period has expired. " +
      "The account exists but is no longer authorized.",
    invalid_password:
      "Someone entered the correct email or username but the wrong password. " +
      "Multiple failures from the same IP are a strong signal of a password-guessing attack.",
  };
  const explanation = reasonExplanation[p.context ?? ""] ??
    "A login attempt was rejected by the authentication system.";

  return new EmbedBuilder()
    .setColor(EMBED_COLORS.AUTH_FAIL)
    .setTitle("🔐 AUTH FAIL — Login Attempt Rejected")
    .setDescription(
      `**What happened:** ${explanation}\n\n` +
      "**What the server did:** The login was blocked and no session was created. " +
      "The user was shown a generic 'Invalid credentials' message (we never reveal which part was wrong).\n\n" +
      "**What you should do:** A single failure is normal. If you see repeated failures from " +
      "the same IP, watch for a BRUTE FORCE escalation alert — that means the threshold has been crossed."
    )
    .addFields(
      { name: "❌ Why the Login Failed",
        value: `\`${reasonDisplay}\``,
        inline: false,
      },
      {
        // targetIdentifier: the sanitized login credential that was used in this attempt.
        // Shows WHAT account was targeted (e.g. "ais***@gmail.com" or "pre***") so @prez
        // can immediately see which account is under attack without exposing the full credential.
        name: "🎯 Account Targeted (Sanitized — First 3 Chars Only)",
        value: p.targetIdentifier
          ? `\`${p.targetIdentifier}\`\n*The first 3 characters of the login credential used in this attempt. Full credential is never logged.*`
          : "`unknown — identifier not captured`",
        inline: false,
      },
      { name: "🔗 Login Procedure",       value: `\`${p.path}\``,   inline: true  },
      { name: "📡 HTTP Method",           value: `\`${p.method}\``, inline: true  },
      { name: "🖥️ Attacker IP Address",   value: `\`${p.ip}\``,     inline: true  },
      { name: "🕐 Time of Event (EST)",   value: formatTimestamp(p.occurredAt), inline: true  },
      {
        name: "🔍 Browser / Client Signature (User-Agent)",
        value: `\`${(p.userAgent ?? "none — no user-agent header provided").substring(0, 120)}\``,
        inline: false,
      }
    )
    .setFooter({ text: "AI Sports Betting · Security Monitor · AUTH_FAIL" })
    .setTimestamp(p.occurredAt);
}

function buildBruteForceEmbed(
  ip: string,
  count: number,
  windowMs: number,
  userAgent: string | null | undefined,
  occurredAt: number,
): EmbedBuilder {
  const windowMins = Math.round(windowMs / 1000 / 60);

  return new EmbedBuilder()
    .setColor(EMBED_COLORS.BRUTE_FORCE)
    .setTitle(`🚨 BRUTE FORCE DETECTED — ${count} Failed Logins in ${windowMins} Minutes`)
    .setDescription(
      `**@here — Immediate attention recommended.**\n\n` +
      `**What happened:** The IP address \`${ip}\` has failed to log in **${count} times** ` +
      `within the last **${windowMins} minutes**. This is a strong signal that someone is ` +
      `running an automated password-guessing attack (also called a brute-force or credential-stuffing attack).\n\n` +
      "**What the server did:** Every login attempt was individually blocked. " +
      "No account was compromised. The IP is also subject to the auth rate limiter (5 attempts/15 min), " +
      "which means it will start receiving 429 errors if it hasn't already.\n\n" +
      "**What you should do:**\n" +
      `1. **Block \`${ip}\` at the firewall/CDN level** — this is the most effective action.\n` +
      "2. Check if any of your users' accounts are being targeted (look at the AUTH_FAIL events above this one).\n" +
      "3. If the attack is ongoing, consider temporarily enabling CAPTCHA on the login page.\n" +
      "4. No action is required if the IP stops after this alert — the rate limiter will handle it."
    )
    .addFields(
      { name: "🖥️ Attacker IP Address",        value: `\`${ip}\``,                                     inline: true  },
      { name: "🔢 Failed Login Count",          value: `**${count}** failures in ${windowMins} min`,   inline: true  },
      { name: "⏱️ Detection Window",            value: `Last **${windowMins} minutes** (sliding)`,     inline: true  },
      { name: "🕐 Escalation Time (EST)",       value: formatTimestamp(occurredAt),                    inline: true  },
      { name: "🛡️ Threshold",                   value: `\`${BRUTE_FORCE_THRESHOLD}+ failures / ${windowMins} min\``, inline: true },
      {
        name: "🔍 Browser / Client Signature (User-Agent)",
        value: `\`${(userAgent ?? "none — no user-agent header provided").substring(0, 120)}\``,
        inline: false,
      },
      {
        name: "🔒 Recommended Immediate Action",
        value:
          `Block \`${ip}\` at the firewall/CDN level — IP Access Rules.\n` +
          "Set rule: **Block** | **IP Address** | value: the IP above.",
        inline: false,
      }
    )
    .setFooter({ text: "AI Sports Betting · Security Monitor · BRUTE_FORCE_ESCALATION" })
    .setTimestamp(occurredAt);
}

// ─── Embed dispatcher ─────────────────────────────────────────────────────────
function buildEmbed(p: SecurityAlertPayload): EmbedBuilder {
  switch (p.eventType) {
    case "CSRF_BLOCK":  return buildCsrfBlockEmbed(p);
    case "RATE_LIMIT":  return buildRateLimitEmbed(p);
    case "AUTH_FAIL":   return buildAuthFailEmbed(p);
  }
}

// ─── Channel fetch helper ─────────────────────────────────────────────────────
async function fetchSecurityChannel(tag: string): Promise<TextChannel | null> {
  const client = getDiscordClient();
  if (!client) {
    console.log(`${tag} Bot client not available — skipping Discord alert`);
    return null;
  }
  if (!client.isReady()) {
    console.log(`${tag} Bot client not ready — skipping Discord alert`);
    return null;
  }

  try {
    const rawChannel = await client.channels.fetch(SECURITY_CHANNEL_ID);
    if (!rawChannel || !(rawChannel instanceof TextChannel)) {
      console.error(`${tag} Channel ${SECURITY_CHANNEL_ID} is not a TextChannel or could not be fetched`);
      return null;
    }
    console.log(`${tag} Channel resolved: #${rawChannel.name} in ${rawChannel.guild?.name ?? "unknown"}`);
    return rawChannel;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} Failed to fetch channel ${SECURITY_CHANNEL_ID}: ${msg}`);
    return null;
  }
}

// ─── Brute-force escalation poster ───────────────────────────────────────────
/**
 * Posts a bright-red @here brute-force escalation embed to the security channel.
 * Called automatically by postSecurityAlert when AUTH_FAIL threshold is crossed.
 * Fire-and-forget — never throws.
 */
async function postBruteForceAlert(
  ip: string,
  count: number,
  windowMs: number,
  userAgent: string | null | undefined,
  occurredAt: number,
): Promise<void> {
  const tag = "[DiscordSecurity][BRUTE_FORCE]";

  console.log(
    `${tag} 🚨 Posting brute-force escalation alert` +
    ` | IP=${ip} count=${count} window=${Math.round(windowMs / 1000 / 60)}min`
  );

  const channel = await fetchSecurityChannel(tag);
  if (!channel) return;

  const embed = buildBruteForceEmbed(ip, count, windowMs, userAgent, occurredAt);

  try {
    // @here mention in the message content + embed for maximum visibility
    await channel.send({
      content: `@here 🚨 **BRUTE FORCE ALERT** — IP \`${ip}\` has made **${count} failed login attempts** in the last ${Math.round(windowMs / 1000 / 60)} minutes. Immediate review recommended.`,
      embeds: [embed],
    });
    console.log(
      `${tag} [OUTPUT] Brute-force escalation posted successfully` +
      ` | IP=${ip} count=${count} channel=#${channel.name}`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} Failed to send brute-force embed: ${msg} | IP=${ip}`);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────
/**
 * Posts a structured security embed to the 🗒️-𝗦𝗘𝗖𝗨𝗥𝗜𝗧𝗬-𝗘𝗩𝗘𝗡𝗧𝗦 channel.
 *
 * For AUTH_FAIL events, also runs brute-force detection and escalates with
 * an @here alert if the threshold is crossed.
 *
 * MUST be called as fire-and-forget:
 *   postSecurityAlert({ ... }).catch(() => {});
 *
 * Never awaited at call sites — the HTTP response is always sent first.
 */
export async function postSecurityAlert(payload: SecurityAlertPayload): Promise<void> {
  const tag = `[DiscordSecurity][${payload.eventType}]`;

  // ── Step 1: Validate bot client is available ───────────────────────────────
  const client = getDiscordClient();
  if (!client) {
    console.log(`${tag} Bot client not available — skipping Discord alert | IP=${payload.ip}`);
    return;
  }
  if (!client.isReady()) {
    console.log(`${tag} Bot client not ready — skipping Discord alert | IP=${payload.ip}`);
    return;
  }

  // ── Step 2: Brute-force detection for AUTH_FAIL events ────────────────────
  // Run BEFORE dedup check so every AUTH_FAIL is counted in the sliding window,
  // even if the per-event embed is deduplicated.
  if (payload.eventType === "AUTH_FAIL") {
    const result = trackAuthFailForBruteForce(payload.ip, payload.occurredAt);
    if (result.escalate && result.count !== undefined && result.windowMs !== undefined) {
      // Post brute-force @here alert (fire-and-forget)
      postBruteForceAlert(
        payload.ip,
        result.count,
        result.windowMs,
        payload.userAgent,
        payload.occurredAt,
      ).catch((err: unknown) => {
        console.error(
          `${tag} Brute-force escalation post failed: ${err instanceof Error ? err.message : String(err)}`
        );
      });
    }
  }

  // ── Step 3: Deduplication check for the per-event embed ───────────────────
  if (isDeduplicated(payload.eventType, payload.ip)) return;

  // ── Step 4: Log the alert attempt ─────────────────────────────────────────
  console.log(
    `${tag} Posting security alert to channel ${SECURITY_CHANNEL_ID}` +
    ` | IP=${payload.ip}` +
    ` path="${payload.path}"` +
    ` method=${payload.method}` +
    (payload.blockedOrigin ? ` blockedOrigin="${payload.blockedOrigin}"` : "") +
    (payload.context ? ` context="${payload.context}"` : "") +
    ` occurredAt=${formatTimestamp(payload.occurredAt)}`
  );

  // ── Step 5: Fetch the target channel ──────────────────────────────────────
  const channel = await fetchSecurityChannel(tag);
  if (!channel) return;

  // ── Step 6: Build and send the embed ──────────────────────────────────────
  const embed = buildEmbed(payload);
  try {
    await channel.send({ embeds: [embed] });
    console.log(
      `${tag} [OUTPUT] Alert posted successfully` +
      ` | IP=${payload.ip}` +
      ` channel=#${channel.name}` +
      ` eventType=${payload.eventType}`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `${tag} Failed to send embed to channel ${SECURITY_CHANNEL_ID}: ${msg}` +
      ` | IP=${payload.ip}`
    );
  }
}
