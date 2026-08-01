/**
 * server/_core/billingAlerts.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Money-path alerting. Every failure on the Stripe → entitlement path (signature
 * rejection, webhook processing crash, failed grant/revoke, reconciliation drift,
 * refunds, disputes, customer-link conflicts) funnels through `billingAlert()`.
 *
 * ─── Design principles (mirrors server/discord/discordSecurityAlert.ts) ──────
 *   1. FIRE-AND-FORGET — never awaited at call sites; never blocks the HTTP
 *      response and never rejects. Money paths must not fail because alerting did.
 *   2. ZERO NOISE — a storm of identical alerts collapses to one post per kind
 *      per RATE_LIMIT_MS; suppressed events are counted and summarised on the
 *      next emission instead of being silently dropped.
 *   3. STRUCTURED LOGGING — every alert emits a `[BillingAlert][<KIND>]` console
 *      line whether or not a transport is configured, so Railway logs remain
 *      independently interpretable with Discord down or unconfigured.
 *   4. GRACEFUL FAILURE — all errors are caught and logged; never propagate.
 *   5. PII-SAFE — raw email addresses and Stripe secrets never reach a log line
 *      or a Discord payload. Redaction happens before anything is serialised.
 *
 * ─── Why a webhook and not `postSecurityAlert()` ─────────────────────────────
 * `postSecurityAlert()` is typed to `SecurityEventType`
 * ("CSRF_BLOCK" | "RATE_LIMIT" | "AUTH_FAIL"), hardcodes the security channel,
 * and depends on a *ready* discord.js gateway client (`getDiscordClient()`).
 * Billing alerts must survive a bot that never logged in, and this module is
 * intentionally dependency-light (global fetch only) so it can be imported from
 * the raw-body webhook handler without dragging discord.js into that path.
 * The env-gating, dedup, console-first and never-throw contracts are identical.
 *
 * ─── Configuration ───────────────────────────────────────────────────────────
 *   BILLING_ALERT_DISCORD_WEBHOOK_URL  (preferred)
 *   DISCORD_BILLING_WEBHOOK_URL        (alias)
 * Unset → console-only mode. This is a supported configuration, not an error.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Alert kinds ──────────────────────────────────────────────────────────────

export type BillingAlertKind =
  | "WEBHOOK_SIGNATURE_FAILURE"
  | "WEBHOOK_PROCESSING_FAILURE"
  | "REVOKE_FAILURE"
  | "GRANT_FAILURE"
  | "RECONCILE_DRIFT"
  | "REFUND_RECEIVED"
  | "DISPUTE_OPENED"
  | "CUSTOMER_LINK_CONFLICT"
  | "PAYMENT_FAILED"
  | "TRIAL_WILL_END"
  | "DISPUTE_CLOSED";

/**
 * Severity per kind. Drives console.error vs console.warn and the embed colour.
 * "error" = money was (or may have been) lost / entitlement is wrong right now.
 * "warn"  = expected-but-notable business event, or a detector observation.
 */
const SEVERITY: Record<BillingAlertKind, "error" | "warn"> = {
  WEBHOOK_SIGNATURE_FAILURE: "error",
  WEBHOOK_PROCESSING_FAILURE: "error",
  REVOKE_FAILURE: "error",
  GRANT_FAILURE: "error",
  RECONCILE_DRIFT: "warn",
  REFUND_RECEIVED: "warn",
  DISPUTE_OPENED: "error",
  // A failed renewal is not an outage — Stripe Smart Retries own recovery and
  // access is deliberately retained. It is "warn" so it does not sit at the
  // same level as a lost grant, but it must still reach a human: under a
  // recurring model this is the earliest signal that a member is churning.
  CUSTOMER_LINK_CONFLICT: "error",
  PAYMENT_FAILED: "warn",
  // Pre-churn signal: a trial converting (or lapsing) in ~3 days. Routine
  // business, but the only alert that arrives BEFORE money moves.
  TRIAL_WILL_END: "warn",
  // The dispute verdict. Money already moved at dispute.created; this is the
  // resolution, and a WON dispute needs a human to decide on reinstatement.
  DISPUTE_CLOSED: "warn",
};

/** Discord embed colours — same palette family as discordSecurityAlert.ts. */
const EMBED_COLORS: Record<BillingAlertKind, number> = {
  WEBHOOK_SIGNATURE_FAILURE: 0xed4245, // danger red
  WEBHOOK_PROCESSING_FAILURE: 0xed4245, // danger red
  REVOKE_FAILURE: 0xf8312f, // bright red — entitlement stuck ON after cancel
  GRANT_FAILURE: 0xf8312f, // bright red — paid customer with no access
  RECONCILE_DRIFT: 0xfee75c, // warning yellow
  REFUND_RECEIVED: 0xeb6c33, // orange
  DISPUTE_OPENED: 0xf8312f, // bright red — chargeback clock is running
  CUSTOMER_LINK_CONFLICT: 0xeb6c33, // orange
  PAYMENT_FAILED: 0xfee75c, // warning yellow — recoverable, but the clock is running
  TRIAL_WILL_END: 0xfee75c, // warning yellow — decision window, not a failure
  DISPUTE_CLOSED: 0xeb6c33, // orange — verdict in; may need manual reinstatement
};

// ─── Constants ────────────────────────────────────────────────────────────────

const TAG = "[BillingAlert]";

/** At most one emitted alert per kind per window; the rest are counted. */
const RATE_LIMIT_MS = 60_000;

/** Hard ceiling on the rate-limit map. Bounded by design (one entry per kind). */
const MAX_BUCKETS = 64;

/** Network budget for the webhook POST. Never allowed to hold a hot path open. */
const WEBHOOK_TIMEOUT_MS = 5_000;

/** Recursion / size guards so a pathological `detail` cannot blow up a log line. */
const MAX_REDACT_DEPTH = 4;
const MAX_REDACT_KEYS = 40;
const MAX_STRING_LEN = 500;

/** Discord rejects embed descriptions over 4096 chars. */
const MAX_DESCRIPTION_LEN = 3800;

// ─── Rate-limit state ─────────────────────────────────────────────────────────

interface AlertBucket {
  /** Epoch ms of the last alert that was actually emitted for this kind. */
  lastEmittedMs: number;
  /** Alerts suppressed since `lastEmittedMs`. Reported on the next emission. */
  suppressed: number;
  /** Last suppressed detail, so the summary is not purely a count. */
  lastSuppressedSummary: string | null;
}

const buckets = new Map<string, AlertBucket>();

/**
 * Returns the emission decision for `kind`.
 *   { emit: true,  suppressedSinceLast }  → post it, report the backlog
 *   { emit: false }                       → inside the cooldown, counted only
 *
 * Also prunes stale buckets so the map can never grow without bound (it is
 * already bounded by the kind union, but a defensive prune keeps that true if
 * the key ever gains a dimension).
 */
function shouldEmit(
  kind: BillingAlertKind,
  summary: string,
): { emit: boolean; suppressedSinceLast: number; lastSuppressedSummary: string | null } {
  const now = Date.now();

  if (buckets.size > MAX_BUCKETS) {
    const cutoff = now - RATE_LIMIT_MS;
    for (const [k, b] of Array.from(buckets.entries())) {
      if (b.lastEmittedMs < cutoff && b.suppressed === 0) buckets.delete(k);
    }
  }

  const bucket = buckets.get(kind);

  if (!bucket) {
    buckets.set(kind, { lastEmittedMs: now, suppressed: 0, lastSuppressedSummary: null });
    return { emit: true, suppressedSinceLast: 0, lastSuppressedSummary: null };
  }

  if (now - bucket.lastEmittedMs < RATE_LIMIT_MS) {
    bucket.suppressed += 1;
    bucket.lastSuppressedSummary = summary;
    return { emit: false, suppressedSinceLast: bucket.suppressed, lastSuppressedSummary: summary };
  }

  const suppressedSinceLast = bucket.suppressed;
  const lastSuppressedSummary = bucket.lastSuppressedSummary;
  bucket.lastEmittedMs = now;
  bucket.suppressed = 0;
  bucket.lastSuppressedSummary = null;
  return { emit: true, suppressedSinceLast, lastSuppressedSummary };
}

/** Test/ops helper — clears the in-process rate-limit state. */
export function __resetBillingAlertRateLimit(): void {
  buckets.clear();
}

// ─── Redaction ────────────────────────────────────────────────────────────────

/** Keys whose *value* is treated as an email regardless of its shape. */
const EMAIL_KEY_RE = /email/i;

/** Any Stripe secret-ish credential. Never leaves this process. */
const SECRET_PREFIX_RE = /^(sk_|rk_|whsec_)/;
const SECRET_EMBEDDED_RE = /\b(?:sk|rk|whsec)_[A-Za-z0-9_-]{4,}/g;

/** Loose email matcher used to scrub addresses out of free-text values. */
const EMAIL_RE = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

/**
 * Masks an email as `d***@domain.tld`.
 * Non-email input is returned masked defensively rather than passed through.
 */
export function maskEmail(raw: string): string {
  const at = raw.lastIndexOf("@");
  if (at <= 0 || at === raw.length - 1) {
    // Not a parseable address — never echo an unknown identity verbatim.
    return raw.length > 0 ? `${raw[0]}***` : "***";
  }
  const local = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  return `${local[0]}***@${domain}`;
}

/** Scrubs secrets and inline email addresses out of any string value. */
function scrubString(value: string): string {
  if (SECRET_PREFIX_RE.test(value)) return "[REDACTED]";
  let out = value.replace(SECRET_EMBEDDED_RE, "[REDACTED]");
  out = out.replace(EMAIL_RE, (_m, first: string, domain: string) => `${first}***@${domain}`);
  if (out.length > MAX_STRING_LEN) out = `${out.slice(0, MAX_STRING_LEN)}…[truncated]`;
  return out;
}

/**
 * Recursively redacts a value:
 *   • any key matching /email/i        → masked as d***@domain.tld
 *   • any value matching /^(sk_|rk_|whsec_)/ → "[REDACTED]"
 *   • inline emails / secrets in free text   → scrubbed
 *   • Errors                            → { name, message } (message scrubbed)
 * Depth- and key-bounded so a hostile or huge payload cannot blow up a log line.
 */
function redactValue(value: unknown, depth: number, keyHint?: string): unknown {
  if (value === null || value === undefined) return value ?? null;

  if (typeof value === "string") {
    if (keyHint && EMAIL_KEY_RE.test(keyHint)) {
      return SECRET_PREFIX_RE.test(value) ? "[REDACTED]" : maskEmail(value);
    }
    return scrubString(value);
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return typeof value === "bigint" ? value.toString() : value;
  }

  if (value instanceof Error) {
    return { name: value.name, message: scrubString(value.message) };
  }

  if (depth >= MAX_REDACT_DEPTH) return "[depth-limit]";

  if (Array.isArray(value)) {
    return value.slice(0, MAX_REDACT_KEYS).map((v) => redactValue(v, depth + 1, keyHint));
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (n >= MAX_REDACT_KEYS) {
        out["…"] = "[key-limit]";
        break;
      }
      out[k] = redactValue(v, depth + 1, k);
      n += 1;
    }
    return out;
  }

  // functions, symbols — never serialise
  return `[${typeof value}]`;
}

/**
 * Public redaction entry point. Exported so callers (and tests) can assert that
 * a payload is safe before it is handed to any other sink.
 */
export function redactBillingDetail(detail: Record<string, unknown>): Record<string, unknown> {
  try {
    const redacted = redactValue(detail, 0);
    if (redacted && typeof redacted === "object" && !Array.isArray(redacted)) {
      return redacted as Record<string, unknown>;
    }
    return { detail: redacted };
  } catch {
    return { redactionError: true };
  }
}

// ─── Serialisation helpers ────────────────────────────────────────────────────

function safeStringify(value: unknown): string {
  try {
    const seen = new WeakSet<object>();
    return (
      JSON.stringify(value, (_k, v: unknown) => {
        if (typeof v === "object" && v !== null) {
          if (seen.has(v as object)) return "[circular]";
          seen.add(v as object);
        }
        return v;
      }) ?? "null"
    );
  } catch {
    return '"[unserialisable]"';
  }
}

/** One-line human summary used for dedup context and the console tail. */
function summarise(redacted: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(redacted)) {
    if (parts.length >= 6) break;
    if (v === null || typeof v === "object") continue;
    parts.push(`${k}=${String(v)}`);
  }
  return parts.length > 0 ? parts.join(" ") : "(no scalar fields)";
}

// ─── Transport ────────────────────────────────────────────────────────────────

function getWebhookUrl(): string | null {
  const url =
    process.env.BILLING_ALERT_DISCORD_WEBHOOK_URL ??
    process.env.DISCORD_BILLING_WEBHOOK_URL ??
    "";
  return url.trim().length > 0 ? url.trim() : null;
}

function formatTimestamp(epochMs: number): string {
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

function buildWebhookBody(
  kind: BillingAlertKind,
  redacted: Record<string, unknown>,
  suppressedSinceLast: number,
  occurredAt: number,
): unknown {
  const severity = SEVERITY[kind];
  const lines: string[] = [];

  lines.push(`**Severity:** \`${severity.toUpperCase()}\``);
  if (suppressedSinceLast > 0) {
    lines.push(
      `**Collapsed:** ${suppressedSinceLast} additional \`${kind}\` alert(s) were suppressed ` +
        `in the last ${RATE_LIMIT_MS / 1000}s and are represented by this message.`,
    );
  }
  lines.push("");
  lines.push("```json");
  lines.push(safeStringify(redacted));
  lines.push("```");

  let description = lines.join("\n");
  if (description.length > MAX_DESCRIPTION_LEN) {
    description = `${description.slice(0, MAX_DESCRIPTION_LEN)}\n…[truncated]`;
  }

  return {
    // No @here — billing alerts are high-signal but the security channel owns
    // escalation mentions. Escalate deliberately at the call site if needed.
    embeds: [
      {
        title: `💳 BILLING ALERT — ${kind}`,
        description,
        color: EMBED_COLORS[kind],
        footer: { text: `Dime AI · Billing Monitor · ${kind}` },
        timestamp: new Date(occurredAt).toISOString(),
        fields: [{ name: "🕐 Time (EST)", value: formatTimestamp(occurredAt), inline: true }],
      },
    ],
  };
}

/** POSTs the embed. Swallows every failure — the console line already landed. */
async function postToDiscord(url: string, body: unknown, kind: BillingAlertKind): Promise<void> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: safeStringify(body),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(
        `${TAG}[${kind}] [TRANSPORT] Discord webhook returned ${res.status} ${res.statusText}`,
      );
      return;
    }
    console.log(`${TAG}[${kind}] [TRANSPORT] Discord webhook delivered ✓`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`${TAG}[${kind}] [TRANSPORT] Discord webhook POST failed: ${msg}`);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Raise a billing alert.
 *
 * Contract:
 *   • NEVER throws and NEVER rejects — safe to call unawaited on a hot path:
 *       billingAlert("REVOKE_FAILURE", { userId, stripeSubscriptionId });
 *   • ALWAYS emits a `[BillingAlert][<KIND>]` console line, even with no
 *     transport configured, so Railway logs capture the event unconditionally.
 *   • Redacts emails and Stripe secrets before anything is written or sent.
 *   • Rate-limited to one emission per kind per 60s; suppressed events are
 *     counted and summarised on the next emission for that kind.
 *
 * @param kind   the money-path failure class
 * @param detail arbitrary structured context (ids, statuses, error messages)
 */
/**
 * Announce the alert transport once, at boot.
 *
 * Previously the "no webhook configured" notice only appeared the first time an
 * alert actually fired — i.e. at the moment something had already gone wrong,
 * buried in the same log stream the alert was meant to escape. Saying it at
 * startup means the gap is visible before it costs anything.
 */
export function reportBillingAlertTransport(): void {
  const url =
    process.env.BILLING_ALERT_DISCORD_WEBHOOK_URL ??
    process.env.DISCORD_BILLING_WEBHOOK_URL ??
    "";
  if (url) {
    console.log(`${TAG} [VERIFY] PASS — billing alerts will be delivered to Discord`);
    return;
  }
  console.warn(
    `${TAG} [WARN] BILLING_ALERT_DISCORD_WEBHOOK_URL is NOT set — billing alerts are CONSOLE-ONLY. ` +
      `Failed renewals, refunds, disputes and webhook failures will be logged but will reach nobody. ` +
      `Set it in Railway to receive them.`
  );
}

export async function billingAlert(
  kind: BillingAlertKind,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    const occurredAt = Date.now();
    const redacted = redactBillingDetail(detail ?? {});
    const summary = summarise(redacted);
    const decision = shouldEmit(kind, summary);

    if (!decision.emit) {
      // Storm collapse: no console spam, no network. The count surfaces on the
      // next emission for this kind so nothing is lost, only deferred.
      return;
    }

    const severity = SEVERITY[kind];
    const suppressedNote =
      decision.suppressedSinceLast > 0
        ? ` collapsed=${decision.suppressedSinceLast}` +
          (decision.lastSuppressedSummary ? ` lastCollapsed="${decision.lastSuppressedSummary}"` : "")
        : "";

    const line =
      `${TAG}[${kind}] severity=${severity}` +
      ` at=${formatTimestamp(occurredAt)}` +
      suppressedNote +
      ` detail=${safeStringify(redacted)}`;

    if (severity === "error") console.error(line);
    else console.warn(line);

    const url = getWebhookUrl();
    if (!url) {
      console.warn(
        `${TAG}[${kind}] [TRANSPORT] No BILLING_ALERT_DISCORD_WEBHOOK_URL configured — console-only mode`,
      );
      return;
    }

    await postToDiscord(
      url,
      buildWebhookBody(kind, redacted, decision.suppressedSinceLast, occurredAt),
      kind,
    );
  } catch (err: unknown) {
    // Last-resort guard. billingAlert() must never surface an error to a caller
    // that is in the middle of processing money.
    try {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${TAG}[${kind}] [FATAL] billingAlert itself failed: ${msg}`);
    } catch {
      /* nothing left to do */
    }
  }
}
