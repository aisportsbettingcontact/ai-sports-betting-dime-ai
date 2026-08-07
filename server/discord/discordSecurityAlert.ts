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
import { logSafe } from "../_core/logSafe";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Target channel: 🗒️-𝗦𝗘𝗖𝗨𝗥𝗜𝗧𝗬-𝗘𝗩𝗘𝗡𝗧𝗦
 * Exported (Task 4.8) so server/_core/index.ts's out-of-band edge_no_secret
 * alert — which posts to this same channel outside the SecurityEventType /
 * postSecurityAlert path — can import it instead of duplicating the literal
 * channel ID.
 */
export const SECURITY_CHANNEL_ID = "1492280227567501403";

/**
 * In-memory cooldown: at most 1 Discord post per (eventType, ip, path,
 * context) per window.
 *
 * Was keyed on `${eventType}:${ip}` alone — so two DIFFERENT limiters firing
 * for the same IP inside the window silently dropped the second, even
 * though the DB-side dedup in server/_core/index.ts's fireRateLimitEvent()
 * keys on `${ip}:${path}:${limitType}` and posted it anyway. A real
 * trpc_auth brute-force could be suppressed here by an unrelated
 * public_feed alert for the same IP (2026-08-07 review, Task 4.5).
 * isDeduplicated() below folds path/context (limitType) into the key so the
 * two sinks agree on what happened; eventType stays in the key too since a
 * CSRF_BLOCK, RATE_LIMIT and AUTH_FAIL sharing (ip, path) are still
 * distinct events.
 */
const DISCORD_ALERT_DEDUP_MS = 30_000; // 30 seconds
const alertLastPosted = new Map<string, number>(); // key → timestamp

/** Hard cap on the dedup map's size; oldest keys are evicted first (FIFO). */
const ALERT_DEDUP_MAP_MAX_SIZE = 2000;

/**
 * Time-based prune bookkeeping (Task 4.6). The old design re-ran
 * `Array.from(alertLastPosted.entries()).forEach(...)` on EVERY call once
 * the map exceeded its size threshold — under a flood every entry is fresh
 * (nothing stale to prune), so it degraded to an O(n) full-map scan plus an
 * array allocation on every single alert, on the hot alert path itself.
 * Gating the sweep to at most once per dedup window turns the common case
 * into an O(1) amortized check.
 */
let alertDedupLastPruneAt = 0;
let alertDedupPruneRunCountForTest = 0; // test-only instrumentation

function pruneAlertDedupMap(now: number): void {
  if (now - alertDedupLastPruneAt < DISCORD_ALERT_DEDUP_MS) return;
  alertDedupLastPruneAt = now;
  alertDedupPruneRunCountForTest++;

  const cutoff = now - DISCORD_ALERT_DEDUP_MS;
  Array.from(alertLastPosted.entries()).forEach(([k, ts]) => {
    if (ts < cutoff) alertLastPosted.delete(k);
  });

  // FIFO eviction: Map iteration order is insertion order, so the oldest
  // keys are the first `overflow` entries of Array.from(...keys()) — deleted
  // first if the cap is still exceeded after the time-based sweep above
  // (e.g. a sustained flood of unique keys inside a single window, none of
  // them stale yet).
  if (alertLastPosted.size > ALERT_DEDUP_MAP_MAX_SIZE) {
    const overflow = alertLastPosted.size - ALERT_DEDUP_MAP_MAX_SIZE;
    Array.from(alertLastPosted.keys())
      .slice(0, overflow)
      .forEach(k => alertLastPosted.delete(k));
  }
}

// ─── Global alert budget (Task 4.6) ──────────────────────────────────────────
/**
 * Per-key dedup above has no CEILING — a distributed source (many unique
 * IPs), or the edge-canary paths (xff_canary / edge_origin_ingress_anomaly),
 * can each mint their own dedup key and produce one embed per unique key
 * per 30s, unbounded. This is a global token bucket shared by every embed
 * this module sends — both the per-event path (postSecurityAlert) and the
 * brute-force escalation (postBruteForceAlert) — because the Discord
 * channel itself has no per-key concept to protect; only a global one does.
 */
const GLOBAL_ALERT_BUDGET_MAX = 20; // embeds per window, globally
const GLOBAL_ALERT_BUDGET_WINDOW_MS = 60_000; // 1 minute

let budgetWindowStart = 0;
let budgetUsedInWindow = 0;
let budgetSummaryPostedInWindow = false;

/**
 * Consumes one token from the global budget if available. Returns
 * `justExhausted: true` exactly once per window — on the request that first
 * hits the ceiling — so the caller can post ONE summary line instead of
 * silently dropping every alert past the cap.
 */
function tryConsumeGlobalAlertBudget(now: number): {
  allowed: boolean;
  justExhausted: boolean;
} {
  if (now - budgetWindowStart >= GLOBAL_ALERT_BUDGET_WINDOW_MS) {
    budgetWindowStart = now;
    budgetUsedInWindow = 0;
    budgetSummaryPostedInWindow = false;
  }
  if (budgetUsedInWindow < GLOBAL_ALERT_BUDGET_MAX) {
    budgetUsedInWindow++;
    return { allowed: true, justExhausted: false };
  }
  if (!budgetSummaryPostedInWindow) {
    budgetSummaryPostedInWindow = true;
    return { allowed: false, justExhausted: true };
  }
  return { allowed: false, justExhausted: false };
}

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
  /** User-Agent string (shown in full, clamped only at Discord's field limit) */
  userAgent?: string | null;
  /** Contextual label: limiter type for RATE_LIMIT, failure reason for AUTH_FAIL */
  context?: string | null;
  /**
   * RATE_LIMIT only — explicit per-call-site indicator of whether the event
   * that fired THIS alert actually blocked the request, or merely observed
   * it (2026-08-07 review, Criticals 2 / Importants 1&2). Six of the eight
   * `limitType` slugs are unconditionally one or the other (the six real
   * rate limiters always block; `xff_canary` never blocks) — but
   * `edge_origin_ingress_anomaly` is fired from TWO call sites with OPPOSITE
   * truth (server/_core/index.ts's origin-lock `edge_deny` case is a genuine
   * 403; the independent `/api/trpc` ingress-anomaly canary never blocks),
   * and the payload previously carried no field able to tell them apart —
   * so the RATE_LIMIT embed asserted a 403 that had not necessarily
   * happened (confirmed live: production runs EDGE_MODE=log, where 100% of
   * currently-firing edge_origin_ingress_anomaly alerts come from the
   * always-observe-only canary, not a real 403). `undefined` means the
   * caller did not thread a value — buildRateLimitEmbed() must render
   * something NON-COMMITTAL in that case, never assert a specific code.
   */
  limiterOutcome?: "blocked" | "observed";
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
 * Returns true if an alert for this (eventType, ip, path, context) was
 * already posted within the cooldown window. Also prunes stale/overflowing
 * entries — see pruneAlertDedupMap() above.
 */
function isDeduplicated(payload: SecurityAlertPayload): boolean {
  const now = Date.now();
  const key = `${payload.eventType}:${payload.ip}:${payload.path}:${payload.context ?? "-"}`;

  pruneAlertDedupMap(now);

  const lastSent = alertLastPosted.get(key) ?? 0;
  if (now - lastSent < DISCORD_ALERT_DEDUP_MS) {
    const remaining = Math.ceil((DISCORD_ALERT_DEDUP_MS - (now - lastSent)) / 1000);
    console.log(
      `[DiscordSecurity][DEDUP] Skipping ${logSafe(payload.eventType)} alert for IP=${logSafe(payload.ip)}` +
      ` path=${logSafe(payload.path)} context=${logSafe(payload.context ?? "-")}` +
      ` — cooldown active (${remaining}s remaining)`
    );
    return true;
  }

  alertLastPosted.set(key, now);
  return false;
}

/**
 * Test-only: resets ALL module-level mutable state (dedup map + prune
 * bookkeeping, global alert budget, brute-force tracking maps). This
 * module's state is intentionally process-lifetime in production; without
 * an explicit reset, tests that share the same imported module instance
 * across `it()` blocks (this file never calls vi.resetModules()) would leak
 * state — an earlier test's dedup entry, or an exhausted alert budget,
 * could silently suppress a LATER test's alert. Not used by production
 * paths.
 */
export function resetSecurityAlertStateForTest(): void {
  alertLastPosted.clear();
  alertDedupLastPruneAt = 0;
  alertDedupPruneRunCountForTest = 0;
  budgetWindowStart = 0;
  budgetUsedInWindow = 0;
  budgetSummaryPostedInWindow = false;
  authFailTimestamps.clear();
  bruteForceLastAlerted.clear();
}

/** Test-only: number of times pruneAlertDedupMap() actually ran its sweep. */
export function getAlertDedupPruneRunCountForTest(): number {
  return alertDedupPruneRunCountForTest;
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
    `${tag} AUTH_FAIL recorded | IP=${logSafe(ip)}` +
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
      `${tag} Threshold crossed but escalation cooldown active for IP=${logSafe(ip)}` +
      ` | cooldown=${cooldownRemaining} min remaining` +
      ` | count=${count}`
    );
    return { escalate: false };
  }

  // Mark escalation timestamp
  bruteForceLastAlerted.set(ip, now);
  console.log(
    `${tag} 🚨 ESCALATING | IP=${logSafe(ip)}` +
    ` | ${count} AUTH_FAIL events in last ${windowSecs} min` +
    ` | posting @here alert to security channel`
  );

  return { escalate: true, count, windowMs: BRUTE_FORCE_WINDOW_MS };
}

// ─── Timestamp formatter ──────────────────────────────────────────────────────
/**
 * Formats an epoch-ms timestamp as a human-readable America/New_York string
 * with the REAL zone abbreviation, plus the UTC ISO instant in parentheses.
 *
 * Was hardcoding " EST" regardless of actual DST — verified live:
 * `20:48:23Z` rendered "Aug 6, 2026, 16:48:23 EST" when the value was
 * actually EDT, mislabelling every alert by an hour for ~8 months a year
 * and corrupting forensic timeline reconstruction (2026-08-07 review, Task
 * 4.7). `Intl.DateTimeFormat`'s `timeZoneName: "short"` resolves the
 * correct EST/EDT abbreviation for the actual instant. The UTC instant is
 * appended because that's what every log line and the Railway API use — an
 * operator should never have to convert by hand.
 *
 * Example: "Aug 6, 2026, 16:48:23 EDT (2026-08-06T20:48:23.000Z)"
 */
function formatTimestamp(epochMs: number): string {
  const date = new Date(epochMs);
  const local = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(date);
  return `${local} (${date.toISOString()})`;
}

/**
 * Discord hard-caps an embed field value at 1024 chars and THROWS
 * (CombinedPropertyError) above it. `path` and `blockedOrigin` are
 * attacker-controlled, so an over-long value used to throw inside
 * buildEmbed() — which is called OUTSIDE the try — killing the alert
 * entirely (2026-08-06 audit).
 *
 * 1000 not 1024: leaves room for the backtick wrapping most call sites add
 * around the raw value. This is a readability pre-truncation only — the hard
 * guarantee against Discord's 1024 cap is `clampFieldValue()` below, applied
 * to the FULLY COMPOSED value (wrapper backticks/text included) at every
 * call site. Two call sites budgeted their own wrapper margin here and got
 * it wrong (buildAuthFailEmbed's "Account Targeted" field, buildBruteForceEmbed's
 * "Recommended Immediate Action" field) — both threw in production-shaped
 * input (2026-08-06 review, Critical 1).
 */
// NOTE (2026-08-06 review, Minor): field() no longer truncates. clampFieldValue()
// below is the hard guarantee, and it clamps the FULLY COMPOSED value. Truncating
// in both places produced a garbled double-cut — `…[tru…[truncated]` — plus a
// dangling unclosed backtick, because clampFieldValue's cut landed part-way
// through field()'s own marker. field() now only resolves the fallback.
function field(value: string | null | undefined, fallback: string): string {
  return value === null || value === undefined || value === "" ? fallback : value;
}

/** Discord's hard cap on an embed field value. */
const DISCORD_FIELD_LIMIT = 1024;

/**
 * Clamp a FULLY COMPOSED field value — after any backticks, suffixes or
 * explanatory text have been added around it. The previous design clamped the
 * inner value to a fixed budget and trusted each call site to leave room for
 * its own wrapper; two call sites did not, and the resulting embed threw
 * (2026-08-06 review). Clamping the finished string cannot be got wrong by a
 * caller.
 */
function clampFieldValue(composed: string): string {
  if (composed.length <= DISCORD_FIELD_LIMIT) return composed;
  return `${composed.substring(0, DISCORD_FIELD_LIMIT - 12)}…[truncated]`;
}

/** Discord's hard cap on an embed description. */
const DISCORD_DESCRIPTION_LIMIT = 4096;

/**
 * Clamp a fully composed embed description to Discord's 4096-char cap.
 * `buildBruteForceEmbed`'s description interpolates the attacker-controlled
 * `ip` twice with no bound (2026-08-06 review, Critical 2) — same
 * composed-string approach as `clampFieldValue`, sized for the description
 * limit instead of the field limit.
 */
function clampDescription(composed: string): string {
  if (composed.length <= DISCORD_DESCRIPTION_LIMIT) return composed;
  return `${composed.substring(0, DISCORD_DESCRIPTION_LIMIT - 12)}…[truncated]`;
}

/** Discord's hard cap on a message `content` string. */
const DISCORD_CONTENT_LIMIT = 2000;

/**
 * Clamp a fully composed message `content` string to Discord's 2000-char cap.
 * The brute-force `@here` alert's `content` interpolates the
 * attacker-controlled `ip` unbounded (2026-08-06 review, Critical 2).
 */
function clampContent(composed: string): string {
  if (composed.length <= DISCORD_CONTENT_LIMIT) return composed;
  return `${composed.substring(0, DISCORD_CONTENT_LIMIT - 12)}…[truncated]`;
}

/**
 * Strips characters with special meaning in Discord message CONTENT
 * specifically — backticks (breaks out of an inline-code span into raw
 * Markdown) and `@` (role/user/@everyone/@here mention pings) — from an
 * attacker-controlled value before it is interpolated into `content`.
 *
 * This is NOT a substitute for logSafe(): logSafe neutralizes control
 * characters/log-injection and is applied everywhere (fields and content
 * alike); this handles the two hazards specific to Discord's message
 * `content` parser. Embed FIELD values do not need this — Discord does not
 * resolve @mentions from embed field text, only from message `content`
 * (2026-08-07 review, Task 4.8).
 */
function stripContentHazards(value: string): string {
  return value.replace(/[`@]/g, "");
}

/**
 * Neutralises Discord Markdown in an attacker-controlled value BEFORE it is
 * interpolated into an embed field/description (2026-08-07 review, Critical
 * 1). Every call site wraps its value in a single-backtick inline code span
 * (`` `${value}` ``) — the ONLY thing that made these fields look safe. They
 * were not: `logSafe()` strips control characters, not Markdown, so a
 * payload containing its OWN backtick closes that span early and exposes
 * whatever text follows to Discord's real Markdown parser. Two payloads
 * verified live through the real EmbedBuilder:
 *
 *   path          = "x`**PWNED-BOLD**`[phish](https://evil.example)y"
 *   blockedOrigin = "https://evil.example`\|\|spoiler-hide-this\|\|`"
 *
 * rendered live **bold**, a clickable masked link to an attacker-controlled
 * URL, and a spoiler tag inside what was meant to be inert diagnostic text
 * in an alert the security team reads and trusts.
 *
 * Two different neutralisation strategies for two different reasons:
 *
 *   1. Backtick is replaced with U+02CB MODIFIER LETTER GRAVE ACCENT (ˋ), a
 *      visually near-identical but functionally inert lookalike — NOT
 *      backslash-escaped. CommonMark's code-span algorithm scans forward for
 *      the next backtick run of matching length to find a span's closer and
 *      does not consult backslash-escaping while doing so (backslash escapes
 *      are explicitly documented as not working inside/around code-span
 *      delimiters) — so `` \` `` still closes an already-open span exactly
 *      like a bare backtick would. Replacing the character outright is the
 *      only reliable way to stop it from ever being recognised as a
 *      delimiter, which is why this file's own review explicitly allows
 *      "replacing backticks with an inert lookalike" as a valid approach.
 *      With every real backtick gone, the value can never prematurely close
 *      the wrapper's own code span.
 *   2. The remaining active characters (* _ ~ | > and the [ ] ( ) that form
 *      the `[text](url)` link syntax) ARE backslash-escaped. CommonMark DOES
 *      honour backslash-escaping for these outside a code span. This layer
 *      is already redundant with every current call site wrapping the value
 *      in real backticks — once no real backtick survives inside it, the
 *      whole value is one literal code span, and code-span content is never
 *      re-parsed for bold/italic/spoiler/links regardless of what characters
 *      it contains. It exists as defense in depth: a future call site that
 *      inserts a payload value into a field or description WITHOUT that
 *      backtick wrapper does not silently reopen this exact vulnerability.
 *
 * Deleting the characters outright (a third option this review explicitly
 * calls out as less defensible) was rejected: these fields are forensic
 * evidence — the attacker's IP, path, user-agent, targeted origin — that an
 * investigator reads to reconstruct what happened. Silently dropping bytes
 * from that record is its own defect. Every original character survives
 * here, either as an inert lookalike or backslash-escaped, so the rendered
 * value stays a faithful (if de-fanged) transcript of exactly what the
 * attacker sent.
 *
 * Composition order (must stay sanitise → then clamp): every call site
 * applies this BEFORE the value is wrapped in template-literal backticks,
 * and clampFieldValue()/clampDescription()/clampContent() wrap the FULLY
 * COMPOSED string (wrapper backticks included) afterward. Escaping first
 * means truncation can never reopen an escape — there are zero raw
 * backticks left in the interior content by the time clamping's
 * `substring()` runs, so a cut cannot manufacture a new one, and the only
 * real backticks in the final string are the wrapper's own.
 */
function escapeDiscordMarkdown(value: string): string {
  return value
    .replace(/`/g, "ˋ")
    .replace(/[*_~|>[\]()]/g, match => `\\${match}`);
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
        value: clampFieldValue(`\`${escapeDiscordMarkdown(field(logSafe(p.blockedOrigin), "none — Origin header was missing entirely"))}\``),
        inline: false,
      },
      { name: "🔗 tRPC Procedure Targeted", value: clampFieldValue(`\`${escapeDiscordMarkdown(field(logSafe(p.path), "unknown"))}\``),   inline: true  },
      { name: "📡 HTTP Method",             value: clampFieldValue(`\`${escapeDiscordMarkdown(field(logSafe(p.method), "unknown"))}\``), inline: true  },
      { name: "🖥️ Attacker IP Address",     value: clampFieldValue(`\`${escapeDiscordMarkdown(field(logSafe(p.ip), "unknown"))}\``),     inline: true  },
      { name: "🕐 Time of Event",     value: clampFieldValue(formatTimestamp(p.occurredAt)), inline: true  },
      {
        name: "🔍 Browser / Client Signature (User-Agent)",
        value: clampFieldValue(`\`${escapeDiscordMarkdown(field(logSafe(p.userAgent), "none — no user-agent header provided"))}\``),
        inline: false,
      },
      {
        name: "✅ Allowed Origins (for reference)",
        value: clampFieldValue(
          "Only requests from the official site domain are allowed. " +
          "If a legitimate origin is being blocked, add it to `PUBLIC_ORIGIN` in the server config."
        ),
        inline: false,
      }
    )
    .setFooter({ text: "AI Sports Betting · Security Monitor · CSRF_BLOCK" })
    .setTimestamp(p.occurredAt);
}

// ─── Rate-limit / edge-defense metadata (Task 4.4) ───────────────────────────
/**
 * `limitType` (the RATE_LIMIT event's `context`) has EIGHT possible slugs —
 * verify against the union in server/_core/index.ts's fireRateLimitEvent().
 * The old label map covered 3 of them; the other five fell through to a raw
 * slug plus hardcoded copy asserting a 429 and a temporary block. That copy
 * is TRUE for six of the eight slugs and FALSE for two:
 *
 *   - edge_origin_ingress_anomaly is fired from TWO call sites that share
 *     this one label: server/_core/index.ts's origin-lock onEvent (only its
 *     "edge_deny" case fires it — that call is a genuine 403, the request
 *     never reached application code) AND a second, independent /api/trpc
 *     ingress-anomaly canary that NEVER blocks (it always calls next()
 *     after firing). LIMITER_META alone cannot carry a single correct
 *     default for this one slug — the two call sites disagree, and
 *     production runs EDGE_MODE=log right now, where 100% of currently
 *     firing alerts for this slug come from the always-observe-only canary
 *     (verified live: a probe returned HTTP 200 AND fired the anomaly
 *     event). Hardcoding "403 blocked at the edge" here shipped an alert
 *     that asserted a 403 that had not happened (2026-08-07 review,
 *     Critical 2) — the exact "alert lies about what happened" defect this
 *     whole mechanism exists to remove. Fixed by threading an explicit
 *     blocked/observed indicator through fireRateLimitEvent() from each of
 *     its eight call sites (SecurityAlertPayload.limiterOutcome) —
 *     buildRateLimitEmbed() below overrides this slug's rendered action
 *     from that per-alert value instead of ever trusting a static default
 *     for it. This entry's own `action` is deliberately non-committal (see
 *     its own comment) — it is only reached as a last-resort fallback when
 *     a caller failed to thread the indicator.
 *   - xff_canary is observe-only by construction (see index.ts) — it is
 *     never anything but "request was served".
 *
 * action is a closed enum so the RATE_LIMIT embed can render "what the
 * server did" and its title FROM metadata instead of a hardcoded literal —
 * that hardcoding is exactly what let the false 429/blocked claims ship.
 */
export type LimiterAction =
  | "429 rate-limited"
  | "403 blocked at the edge"
  | "observed only — request was served"
  | "outcome unknown for this alert — check server logs";

interface LimiterMeta {
  label: string;
  /** What the server ACTUALLY did. */
  action: LimiterAction;
  explanation: string;
  guidance: string;
}

/**
 * Shared remediation text for the six REAL rate limiters (Task 4.4 item 2 /
 * self-DoS fix). The old copy — "consider permanently blocking it at the
 * firewall" — is aimed at IPs that are frequently T-Mobile CGNAT, Meta's
 * crawler, GitHub Actions runners, Cloudflare PoPs, or Railway's own edge.
 * Blocking a Cloudflare PoP or Railway edge node at the firewall can take
 * the site down for everyone behind it, not just the attacker.
 */
const SHARED_INFRA_GUIDANCE =
  "A one-off is normal, no action needed. Before blocking anything for " +
  "repeat triggers, confirm this is not shared infrastructure — Cloudflare " +
  "PoPs, Railway edge nodes, carrier CGNAT ranges (e.g. T-Mobile " +
  "172.32.0.0/11), GitHub Actions runners, and verified crawlers can all " +
  "appear here as a single address representing many users. Blocking one " +
  "can take the site down for everyone behind it. Prefer an account-level " +
  "lock over an IP block.";

export const LIMITER_META: Record<string, LimiterMeta> = {
  global: {
    label: "Global API Limiter — 200 requests per minute per IP",
    action: "429 rate-limited",
    explanation:
      "This IP sent more than 200 requests in a single minute across /api. " +
      "This is almost always automated — a bot, scraper, or flooding tool. " +
      "Normal users never hit this limit.",
    guidance: SHARED_INFRA_GUIDANCE,
  },
  auth: {
    label: "Auth Route Limiter — 5 attempts per 15 minutes per IP",
    action: "429 rate-limited",
    explanation:
      "This IP made more than 5 Discord OAuth attempts in 15 minutes. " +
      "This suggests someone is trying to brute-force access to an account.",
    guidance: SHARED_INFRA_GUIDANCE,
  },
  trpc_auth: {
    label: "Login Procedure Limiter — 5 login attempts per 15 minutes per IP",
    action: "429 rate-limited",
    explanation:
      "This IP attempted the login procedure more than 5 times in 15 minutes. " +
      "This is a strong signal of a credential-stuffing or password-guessing attack.",
    guidance: SHARED_INFRA_GUIDANCE,
  },
  stripe_checkout: {
    label: "Stripe Checkout Limiter — 10 attempts per 15 minutes per IP",
    action: "429 rate-limited",
    explanation:
      "This IP attempted to create a Stripe checkout session more than 10 " +
      "times in 15 minutes. A real user clicks once — this matches an " +
      "automated probe (confirmed live: rotating *.run.app / Google Cloud " +
      "Run probes targeting this exact endpoint).",
    guidance: SHARED_INFRA_GUIDANCE,
  },
  waitlist_submit: {
    label: "Waitlist Submit Limiter — 5 submissions per 15 minutes per IP",
    action: "429 rate-limited",
    explanation:
      "This IP submitted the waitlist form more than 5 times in 15 minutes. " +
      "Likely automated spam or enumeration against the public form.",
    guidance: SHARED_INFRA_GUIDANCE,
  },
  public_feed: {
    label: "Public Feed Limiter — ~60 requests per minute per IP (FEED_RATE_LIMIT_MAX)",
    action: "429 rate-limited",
    explanation:
      "This IP exceeded the feed read budget. A real logged-in user sends " +
      "roughly 1-3 requests per minute (httpBatchLink coalesces a whole " +
      "page into one request); this pattern matches a scraper.",
    guidance: SHARED_INFRA_GUIDANCE,
  },
  xff_canary: {
    label: "XFF Sanitization Canary — NOT a rate limiter",
    action: "observed only — request was served",
    explanation:
      "A /api/trpc request resolved to a private/reserved client address, " +
      "meaning the X-Forwarded-For hop structure changed from what the " +
      "limiter keying assumes. Nothing was blocked or rate-limited — this " +
      "request went through normally.",
    guidance:
      "Do NOT block this IP — it is very likely internal/reserved, not a " +
      "real attacker address. Re-verify the limiter-keying assumption in " +
      "server/_core/clientIdentity.ts; this canary exists specifically so " +
      "that assumption can never fail silently.",
  },
  edge_origin_ingress_anomaly: {
    label: "Cloudflare Origin-Lock Anomaly — NOT a conventional rate limiter",
    // NON-COMMITTAL BY DESIGN (2026-08-07 review, Critical 2): this slug is
    // fired from two call sites with OPPOSITE truth (edge_deny = a genuine
    // 403; the /api/trpc canary = always observe-only, request served) — a
    // single static default here CANNOT be correct for both, and hardcoding
    // "403 blocked at the edge" shipped an alert that asserted a 403 that
    // had not happened for the (currently 100% of firing) observe-only
    // case. buildRateLimitEmbed() below overrides the RENDERED action from
    // the real per-alert SecurityAlertPayload.limiterOutcome value instead
    // of ever reading this field for this one slug — this default is only
    // reached if a future caller fires this slug without threading that
    // value, and it must stay non-committal (never assert 429 OR 403) if
    // that ever happens.
    action: "outcome unknown for this alert — check server logs",
    explanation:
      "A request reached the Railway origin without a verified Cloudflare " +
      "hop. This label is fired from two different places: the origin " +
      "lock's real 403 enforcement (edge_deny, under EDGE_MODE=on) and a " +
      "second, independent /api/trpc ingress-anomaly canary that NEVER " +
      "blocks — expected during an EDGE_MODE=log soak. This alert's title " +
      "and \"what the server did\" line above reflect which one actually " +
      "fired THIS event. If they say the outcome is unknown, check the " +
      "Railway logs at this timestamp for \"[edge][origin-lock]\" to " +
      "confirm which occurred.",
    guidance:
      "Do NOT block this IP at the firewall — these are frequently real " +
      "users on carrier networks with a short-lived resolver cache, or " +
      "verified crawlers. See docs/runbooks/edge-defense-cloudflare.md.",
  },
};

/** Per-action embed title — retitles from the metadata instead of one hardcoded string. */
const RATE_LIMIT_TITLE: Record<LimiterAction, string> = {
  "429 rate-limited": "⚡ RATE LIMIT — IP Temporarily Blocked for Sending Too Many Requests",
  "403 blocked at the edge": "🚫 ORIGIN LOCK — Request Blocked at the Cloudflare Edge (403)",
  "observed only — request was served": "🔍 SECURITY OBSERVATION — Anomaly Detected, Request Was Served",
  "outcome unknown for this alert — check server logs": "⚠️ SECURITY EVENT — Outcome Unknown (Check Server Logs)",
};

/** Per-action "what the server did" line — the only place a response code is asserted. */
const RATE_LIMIT_SERVER_ACTION: Record<LimiterAction, string> = {
  "429 rate-limited":
    "The IP received a `429 Too Many Requests` response and was temporarily blocked from this endpoint. No data was accessed.",
  "403 blocked at the edge":
    "The request was refused with `403 Forbidden` at the Cloudflare edge / origin lock — it never reached application code. No data was accessed.",
  "observed only — request was served":
    "**Nothing was blocked.** The request was served normally; this is a detection-only signal, not an enforcement action.",
  "outcome unknown for this alert — check server logs":
    "**Whether this request was blocked cannot be determined from this alert's payload.** Check the Railway logs at this timestamp for \"[edge][origin-lock]\" or \"[RateLimit]\" before assuming either outcome.",
};

/**
 * edge_origin_ingress_anomaly is the one limitType slug fired from two call
 * sites with opposite truth (see LIMITER_META's own comment on it) — every
 * OTHER slug's static LIMITER_META.action is already unconditionally
 * correct for every call site able to fire it, so only this one slug needs
 * a per-alert override sourced from the real SecurityAlertPayload value
 * (2026-08-07 review, Critical 2 / Importants 1&2).
 */
function resolveRateLimitAction(
  rawContext: string,
  meta: LimiterMeta,
  outcome: SecurityAlertPayload["limiterOutcome"]
): LimiterAction {
  if (rawContext !== "edge_origin_ingress_anomaly") return meta.action;
  if (outcome === "blocked") return "403 blocked at the edge";
  if (outcome === "observed") return "observed only — request was served";
  // Caller didn't thread limiterOutcome — fall back to the non-committal
  // static default rather than guessing.
  return meta.action;
}

function buildRateLimitEmbed(p: SecurityAlertPayload): EmbedBuilder {
  const rawContext = p.context ?? "";
  const meta: LimiterMeta = LIMITER_META[rawContext] ?? {
    label: rawContext
      ? `Unrecognised limiter/detector: ${logSafe(rawContext)}`
      : "unknown limiter",
    action: "429 rate-limited",
    explanation:
      "This event was recorded by the rate-limit / edge-defense pipeline " +
      "under a context this file has no registered metadata for — treat " +
      "the action below as UNVERIFIED.",
    guidance:
      "Check server/_core/index.ts's limitType union against this file's " +
      "LIMITER_META for a slug that was added on one side and not the other.",
  };
  const action = resolveRateLimitAction(rawContext, meta, p.limiterOutcome);

  return new EmbedBuilder()
    .setColor(EMBED_COLORS.RATE_LIMIT)
    .setTitle(RATE_LIMIT_TITLE[action])
    .setDescription(
      `**What happened:** ${meta.explanation}\n\n` +
      `**What the server did:** ${RATE_LIMIT_SERVER_ACTION[action]}\n\n` +
      `**What you should do:** ${meta.guidance}`
    )
    .addFields(
      {
        name: "🛡️ Which Limiter / Detector Was Triggered",
        value: clampFieldValue(`\`${escapeDiscordMarkdown(field(logSafe(meta.label), "unknown limiter"))}\``),
        inline: false,
      },
      { name: "🔗 Route / Endpoint Hit",   value: clampFieldValue(`\`${escapeDiscordMarkdown(field(logSafe(p.path), "unknown"))}\``),   inline: true  },
      { name: "📡 HTTP Method",            value: clampFieldValue(`\`${escapeDiscordMarkdown(field(logSafe(p.method), "unknown"))}\``), inline: true  },
      { name: "🖥️ IP Address",             value: clampFieldValue(`\`${escapeDiscordMarkdown(field(logSafe(p.ip), "unknown"))}\``),     inline: true  },
      { name: "🕐 Time of Event",    value: clampFieldValue(formatTimestamp(p.occurredAt)), inline: true  },
      {
        name: "🔍 Browser / Client Signature (User-Agent)",
        value: clampFieldValue(`\`${escapeDiscordMarkdown(field(logSafe(p.userAgent), "none — no user-agent header provided"))}\``),
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
  const reasonDisplay = reasonLabel[p.context ?? ""] ?? logSafe(p.context ?? "unknown reason");

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
        value: clampFieldValue(`\`${escapeDiscordMarkdown(field(reasonDisplay, "unknown reason"))}\``),
        inline: false,
      },
      {
        // targetIdentifier: the sanitized login credential that was used in this attempt.
        // Shows WHAT account was targeted (e.g. "ais***@gmail.com" or "pre***") so @prez
        // can immediately see which account is under attack without exposing the full credential.
        // The whole composed value (backticks + trailing explainer sentence) is clamped —
        // budgeting the inner field() call alone left ~104 chars of wrapper unaccounted
        // for and threw on a long targetIdentifier (2026-08-06 review, Critical 1).
        // targetIdentifier is directly attacker-controlled: sanitizeLoginIdentifier()
        // (server/routers/appUsers.ts) keeps the raw domain/username characters
        // verbatim after the first 3 chars + "***" — a backtick there closes this
        // field's code span exactly like the reviewer's `path`/`blockedOrigin`
        // payloads (2026-08-07 review, Critical 1), hence escapeDiscordMarkdown().
        name: "🎯 Account Targeted (Sanitized — First 3 Chars Only)",
        value: clampFieldValue(
          p.targetIdentifier
            ? `\`${escapeDiscordMarkdown(field(logSafe(p.targetIdentifier), "unknown — identifier not captured"))}\`\n*The first 3 characters of the login credential used in this attempt. Full credential is never logged.*`
            : "`unknown — identifier not captured`"
        ),
        inline: false,
      },
      { name: "🔗 Login Procedure",       value: clampFieldValue(`\`${escapeDiscordMarkdown(field(logSafe(p.path), "unknown"))}\``),   inline: true  },
      { name: "📡 HTTP Method",           value: clampFieldValue(`\`${escapeDiscordMarkdown(field(logSafe(p.method), "unknown"))}\``), inline: true  },
      { name: "🖥️ Attacker IP Address",   value: clampFieldValue(`\`${escapeDiscordMarkdown(field(logSafe(p.ip), "unknown"))}\``),     inline: true  },
      { name: "🕐 Time of Event",   value: clampFieldValue(formatTimestamp(p.occurredAt)), inline: true  },
      {
        name: "🔍 Browser / Client Signature (User-Agent)",
        value: clampFieldValue(`\`${escapeDiscordMarkdown(field(logSafe(p.userAgent), "none — no user-agent header provided"))}\``),
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
      // The whole composed description is clamped — `ip` is attacker-controlled
      // and unbounded, interpolated twice here with no per-value bound
      // (2026-08-06 review, Critical 2).
      clampDescription(
        `**@here — Immediate attention recommended.**\n\n` +
        `**What happened:** The IP address \`${escapeDiscordMarkdown(logSafe(ip))}\` has failed to log in **${count} times** ` +
        `within the last **${windowMins} minutes**. This is a strong signal that someone is ` +
        `running an automated password-guessing attack (also called a brute-force or credential-stuffing attack).\n\n` +
        "**What the server did:** Every login attempt was individually blocked. " +
        "No account was compromised. The IP is also subject to the auth rate limiter (5 attempts/15 min), " +
        "which means it will start receiving 429 errors if it hasn't already.\n\n" +
        "**What you should do:**\n" +
        // Was "Block `${ip}` at the firewall/CDN level — this is the most
        // effective action" — a self-DoS instruction. The IPs appearing in
        // these alerts are frequently T-Mobile CGNAT, Meta's crawler,
        // GitHub Actions runners, Cloudflare PoPs, or Railway's own edge;
        // blocking a Cloudflare PoP or the Railway edge at the firewall
        // takes the site down for everyone behind it, not just the
        // attacker (2026-08-07 review, Task 4.4 item 2).
        "1. **Before blocking anything, confirm this is not shared infrastructure.** " +
        "Cloudflare PoPs, Railway edge nodes, carrier CGNAT ranges (e.g. T-Mobile " +
        "172.32.0.0/11), GitHub Actions runners and verified crawlers all appear " +
        "here as single addresses representing many users. Blocking one can take " +
        "the site down for everyone behind it. Prefer an account-level lock.\n" +
        "2. Check if any of your users' accounts are being targeted (look at the AUTH_FAIL events above this one) and lock those accounts.\n" +
        "3. If the attack is ongoing and clearly NOT shared infrastructure, consider a scoped IP block or temporarily enabling CAPTCHA on the login page.\n" +
        "4. No action is required if the IP stops after this alert — the rate limiter will handle it."
      )
    )
    .addFields(
      { name: "🖥️ Attacker IP Address",        value: clampFieldValue(`\`${escapeDiscordMarkdown(field(logSafe(ip), "unknown"))}\``),         inline: true  },
      { name: "🔢 Failed Login Count",          value: clampFieldValue(`**${count}** failures in ${windowMins} min`),   inline: true  },
      { name: "⏱️ Detection Window",            value: clampFieldValue(`Last **${windowMins} minutes** (sliding)`),     inline: true  },
      { name: "🕐 Escalation Time",       value: clampFieldValue(formatTimestamp(occurredAt)),                    inline: true  },
      { name: "🛡️ Threshold",                   value: clampFieldValue(`\`${BRUTE_FORCE_THRESHOLD}+ failures / ${windowMins} min\``), inline: true },
      {
        name: "🔍 Browser / Client Signature (User-Agent)",
        value: clampFieldValue(`\`${escapeDiscordMarkdown(field(logSafe(userAgent), "none — no user-agent header provided"))}\``),
        inline: false,
      },
      {
        // "Recommended Immediate Action" — the composed value wraps field(ip)
        // in backticks AND appends static explainer text after it; budgeting
        // field()'s inner clamp alone left this ~104 chars over Discord's 1024
        // cap once `ip` was long (2026-08-06 review, Critical 1).
        name: "🔒 Recommended Immediate Action",
        value: clampFieldValue(
          `Before blocking \`${escapeDiscordMarkdown(field(logSafe(ip), "unknown"))}\` at the firewall/CDN, confirm it isn't ` +
          "shared infrastructure (Cloudflare PoP, Railway edge, carrier CGNAT, CI runner, " +
          "verified crawler). Prefer locking the targeted account over blocking the IP."
        ),
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
    default: {
      // Exhaustiveness guard (Task 4.4, A13): if SecurityEventType is ever
      // widened without a matching case above, this assignment fails to
      // COMPILE (p.eventType would no longer be assignable to `never`). At
      // runtime it protects against a value that bypassed the type system
      // (an un-typed caller, a stale build) being silently forced into the
      // wrong embed instead of failing loudly.
      const exhaustive: never = p.eventType;
      throw new Error(`buildEmbed: unrecognised SecurityEventType: ${String(exhaustive)}`);
    }
  }
}

/** Test-only surface for the embed builder. Not used by production paths. */
export function buildEmbedForTest(payload: SecurityAlertPayload) {
  return buildEmbed(payload);
}

/**
 * Test-only surface for the brute-force embed builder, mirroring
 * buildEmbedForTest. buildEmbed()'s dispatcher only reaches
 * CSRF_BLOCK | RATE_LIMIT | AUTH_FAIL, so nothing else in this file exercises
 * buildBruteForceEmbed directly — that gap is why Critical 2 (2026-08-06
 * review) shipped with zero test coverage. Not used by production paths.
 */
export function buildBruteForceEmbedForTest(
  ip: string,
  count: number,
  windowMs: number,
  userAgent: string | null | undefined,
  occurredAt: number,
) {
  return buildBruteForceEmbed(ip, count, windowMs, userAgent, occurredAt);
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
    console.log(
      `${tag} Channel resolved: #${logSafe(rawChannel.name)} in ${logSafe(rawChannel.guild?.name ?? "unknown")}`
    );
    return rawChannel;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `${tag} Failed to fetch channel ${SECURITY_CHANNEL_ID}: ${logSafe(msg)}`
    );
    return null;
  }
}

// ─── Global alert budget summary poster (Task 4.6) ───────────────────────────
/**
 * Posts ONE plain-text notice the moment the global alert budget is
 * exhausted for the current window, instead of every alert past the ceiling
 * silently vanishing. Fire-and-forget — never throws. Callers must only
 * invoke this when tryConsumeGlobalAlertBudget() returned `justExhausted:
 * true`, which already guarantees at most one call per window.
 */
async function postAlertBudgetExhaustedSummary(tag: string): Promise<void> {
  const channel = await fetchSecurityChannel(tag);
  if (!channel) return;
  try {
    await channel.send({
      content: clampContent(
        `⚠️ **Security alert budget reached** (${GLOBAL_ALERT_BUDGET_MAX} embeds in the last minute). ` +
        "Further alerts in this window are being suppressed here to protect Discord from a flood — " +
        "nothing is lost, every event is still recorded in `security_events`."
      ),
    });
    console.log(`${tag} [OUTPUT] Global alert budget summary posted`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} Failed to post alert-budget summary: ${logSafe(msg)}`);
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
    ` | IP=${logSafe(ip)} count=${count} window=${Math.round(windowMs / 1000 / 60)}min`
  );

  // Global alert budget (Task 4.6) — this embed shares the SAME bucket as
  // postSecurityAlert()'s per-event embeds; the Discord channel has no
  // per-key concept to protect, only a global one.
  const budget = tryConsumeGlobalAlertBudget(Date.now());
  if (!budget.allowed) {
    if (budget.justExhausted) {
      postAlertBudgetExhaustedSummary(tag).catch((err: unknown) => {
        console.error(`${tag} Budget-summary post failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
    console.log(`${tag} Global alert budget exhausted — suppressing brute-force embed | IP=${logSafe(ip)}`);
    return;
  }

  const channel = await fetchSecurityChannel(tag);
  if (!channel) return;

  // buildBruteForceEmbed() MUST be inside the try, matching the fix already
  // applied to buildEmbed() (commit 45c5457ab): discord.js throws on an
  // over-long field value, and building the embed OUTSIDE the try let that
  // throw escape and kill the @here alert silently — for BRUTE_FORCE
  // specifically, that means the attacker's own request suppresses the alarm
  // meant to catch them (2026-08-06 review, Critical 2).
  try {
    const embed = buildBruteForceEmbed(ip, count, windowMs, userAgent, occurredAt);
    // @here mention in the message content + embed for maximum visibility.
    // content is clamped as a fully composed string — `ip` is
    // attacker-controlled and unbounded. Beyond logSafe (log-injection),
    // stripContentHazards() removes backticks/`@` from `ip` specifically —
    // content (unlike embed fields) resolves @mentions, so an unstripped ip
    // could ping @everyone/@here/a role from attacker-controlled input
    // (2026-08-07 review, Task 4.8).
    const safeIp = stripContentHazards(logSafe(ip));
    await channel.send({
      content: clampContent(
        `@here 🚨 **BRUTE FORCE ALERT** — IP \`${safeIp}\` has made **${count} failed login attempts** in the last ${Math.round(windowMs / 1000 / 60)} minutes. Immediate review recommended.`
      ),
      embeds: [embed],
    });
    console.log(
      `${tag} [OUTPUT] Brute-force escalation posted successfully` +
      ` | IP=${logSafe(ip)} count=${count} channel=#${logSafe(channel.name)}`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${tag} Failed to build or send brute-force embed: ${logSafe(msg)} | IP=${logSafe(ip)}`);
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
    console.log(`${tag} Bot client not available — skipping Discord alert | IP=${logSafe(payload.ip)}`);
    return;
  }
  if (!client.isReady()) {
    console.log(`${tag} Bot client not ready — skipping Discord alert | IP=${logSafe(payload.ip)}`);
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
  // Keyed on (eventType, ip, path, context) — see isDeduplicated()'s own
  // doc comment for why eventType/ip alone was wrong (Task 4.5).
  if (isDeduplicated(payload)) return;

  // ── Step 3.5: Global alert budget (Task 4.6) ───────────────────────────────
  // Per-key dedup above has no CEILING — a distributed source (many unique
  // IPs) can each mint a fresh key and post unbounded. Checked AFTER dedup
  // so a true duplicate never consumes a token.
  const budget = tryConsumeGlobalAlertBudget(Date.now());
  if (!budget.allowed) {
    if (budget.justExhausted) {
      postAlertBudgetExhaustedSummary(tag).catch((err: unknown) => {
        console.error(`${tag} Budget-summary post failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
    console.log(`${tag} Global alert budget exhausted — suppressing embed | IP=${logSafe(payload.ip)}`);
    return;
  }

  // ── Step 4: Log the alert attempt ─────────────────────────────────────────
  console.log(
    `${tag} Posting security alert to channel ${SECURITY_CHANNEL_ID}` +
    ` | IP=${logSafe(payload.ip)}` +
    ` path="${logSafe(payload.path)}"` +
    ` method=${logSafe(payload.method)}` +
    (payload.blockedOrigin ? ` blockedOrigin="${logSafe(payload.blockedOrigin)}"` : "") +
    (payload.context ? ` context="${logSafe(payload.context)}"` : "") +
    ` occurredAt=${formatTimestamp(payload.occurredAt)}`
  );

  // ── Step 5: Fetch the target channel ──────────────────────────────────────
  const channel = await fetchSecurityChannel(tag);
  if (!channel) return;

  // ── Step 6: Build and send the embed ──────────────────────────────────────
  // buildEmbed MUST be inside the try: discord.js throws on an over-long field
  // value, and an escape here kills the alert silently at the call site's
  // .catch() — the erasure primitive found in the 2026-08-06 audit.
  try {
    const embed = buildEmbed(payload);
    await channel.send({ embeds: [embed] });
    console.log(
      `${tag} [OUTPUT] Alert posted successfully` +
      ` | IP=${logSafe(payload.ip)}` +
      ` channel=#${logSafe(channel.name)}` +
      ` eventType=${payload.eventType}`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `${tag} Failed to build or send embed to channel ${SECURITY_CHANNEL_ID}: ${logSafe(msg)}` +
      ` | IP=${logSafe(payload.ip)} eventType=${payload.eventType}`
    );
  }
}
