/**
 * edge-soak-report.mjs — the EDGE_MODE arming gate, as a machine-readable
 * verdict instead of prose a human eyeballs.
 *
 * ── Why this file exists ──────────────────────────────────────────────────────
 * On 2026-08-06 the origin lock was armed (`EDGE_MODE=on`) while the runbook's
 * own stop condition was being violated. docs/runbooks/edge-defense-cloudflare.md
 * §3 step 12 says:
 *
 *     "Soak in `log`: ... Watch 15-30 min of real traffic:
 *      - No `edge_would_deny` on legitimate traffic ...
 *      - `edge_origin_ingress_anomaly` events should be ~zero ...
 *      - **If legit traffic warns, STOP and fix CF injection before enforcing.**"
 *
 * Anomalies were non-zero throughout the soak (CI + operator traffic), and the
 * as-built record cited **18 requests through Cloudflare + 5 direct** as arming
 * proof. That is 23 requests over a few minutes, presented as satisfying a
 * "15-30 minutes of real traffic" bar. Real users were 403'd for ~7 hours
 * afterwards before anyone noticed.
 *
 * The gate did not fail because the operator was careless. It failed because it
 * was a paragraph. A paragraph cannot count requests, cannot measure a window,
 * and cannot tell an Azure CI runner apart from a paying customer. This script
 * can, and it prints a verdict you have to paste.
 *
 * ── The gate (Task 5.5 Step 1 — every condition is NON-WAIVABLE) ──────────────
 *   1. EDGE_MODE during the soak was `log`            (not `on`, not `off`)
 *   2. >= 60 minutes of production traffic
 *   3. >= 500 REAL requests (non-CI, non-operator — synthetic probes may
 *      SUPPLEMENT the soak, never SUBSTITUTE for it)
 *   4. would-deny count from NON-CI, NON-OPERATOR sources is EXACTLY 0
 *   5. every observed source is classifiable
 *   6. zero data errors (query failures, malformed rows, unstated verdicts)
 *   7. >= 25 DISTINCT real sources    (a request COUNT is not a traffic SHAPE)
 *   8. no single real source contributes more than 25% of the real requests
 *
 * 7 and 8 exist because condition 3 alone counts rows, and rows are the one
 * thing a single box can manufacture. 500 hits from one IP is not "real traffic
 * from real users" by any reading of the runbook, yet it satisfied condition 3
 * exactly. See MIN_DISTINCT_REAL_SOURCES for the full argument.
 *
 * There is deliberately no `--force`, no threshold override, and no way for a
 * caller to relax a threshold: `evaluateSoak()` takes only data and a source
 * allowlist, never a limit. The exported constants are read, never written.
 * `main()`'s third argument (`deps`) is a TEST seam for the filesystem and the
 * database only — it carries no threshold and no verdict, and `main()` still
 * calls `evaluateSoak()` with data alone. A test pins that.
 *
 * ── FAIL-CLOSED ──────────────────────────────────────────────────────────────
 * Every ambiguity resolves to FAIL:
 *   - a query error, a missing file, malformed JSON            -> FAIL
 *   - a row whose timestamp or edge verdict cannot be read     -> FAIL
 *   - a source with no usable IP identity                      -> FAIL, and it is
 *     NEVER folded into the CI bucket. "Unidentifiable" is not "ours". Silently
 *     classing an unknown source as CI is precisely how a real-user 403 hides
 *     inside a green gate.
 *   - no data at all                                           -> FAIL
 * PASS is only ever reached by every condition passing on its own evidence.
 *
 * ── Source classification: reuses server/securityDigest.ts's scheme ───────────
 * server/securityDigest.ts already answers "is this IP a known automation
 * source?" via getOwnerConfiguredAllowlist() + classifyIp(). This script reuses
 * that scheme rather than inventing a second one:
 *
 *   - the same witnessed IPs (its DEFAULT_KNOWN_AUTOMATION_IPS),
 *   - the same env var, SECURITY_DIGEST_ALLOWLIST_IPS, with the same
 *     comma-separated exact-IP / IPv4-CIDR grammar and the same read-at-call-time
 *     (never cached at module load) behavior,
 *   - the same matching semantics, including "an IPv6 address never matches a
 *     `/`-bearing pattern" (fails safe rather than matching the wrong address),
 *   - the same refusal to treat Cloudflare-range membership as trust. See that
 *     file's CF_RANGE_ALLOWLIST_ENABLED comment: any party can route the origin
 *     through their OWN free Cloudflare zone and arrive from a genuine CF PoP
 *     IP. A CF-range IP is a normal, un-trusted source here too.
 *
 * scripts/edge-soak-report.test.ts pins that reuse behaviorally by driving BOTH
 * this module and the real classifyIp() over the same inputs.
 *
 * It cannot `import` securityDigest.ts directly — this is a plain `.mjs` run by
 * `node` with no TypeScript loader, and that module pulls in discord.js and the
 * DB layer at import time. The parity test is what keeps the two honest.
 *
 * TWO DIVERGENCES, both deliberate and both in the safe direction:
 *   a. This script needs CI vs OPERATOR, which securityDigest.ts's flat
 *      "known_automation" class cannot express, so the default entries carry an
 *      explicit `class`.
 *   b. An IP known ONLY via SECURITY_DIGEST_ALLOWLIST_IPS is recognized and
 *      labelled, but is NOT granted the CI/operator exclusion — that env var
 *      states "known automation" without saying whose, and guessing "CI" is the
 *      exact silent-CI failure above. Class such IPs explicitly with
 *      EDGE_SOAK_CI_IPS / EDGE_SOAK_OPERATOR_IPS to exclude them.
 *
 * ── Input ────────────────────────────────────────────────────────────────────
 * A JSON evidence bundle (see SOAK_INPUT_SHAPE below). Each row must STATE its
 * edge verdict — there is no default, because defaulting an unlabelled row to
 * "allow" would let an unexamined stream pass the gate.
 *
 *   {
 *     "edgeMode": "log",
 *     "windowStartMs": 1754400000000,
 *     "windowEndMs":   1754403600000,
 *     "requests": [
 *       { "ip": "203.0.113.9", "occurredAt": 1754400001000, "edgeVerdict": "allow" },
 *       { "ip": "40.81.6.244", "occurredAt": 1754400002000, "edgeVerdict": "would_deny" },
 *       { "ip": "198.51.100.4", "occurredAt": 1754400003000,
 *         "eventType": "RATE_LIMIT", "context": "edge_origin_ingress_anomaly" }
 *     ]
 *   }
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *   node scripts/edge-soak-report.mjs --input=soak.json
 *   node scripts/edge-soak-report.mjs --input=soak.json --json
 *   node scripts/edge-soak-report.mjs --input=soak.json --db --since=<ms|ISO>
 *
 * `--db` SUPPLEMENTS the bundle with persisted
 * RATE_LIMIT/edge_origin_ingress_anomaly rows from security_events. It cannot
 * replace it: security_events holds anomalies, not the total request stream, so
 * a `--db`-only run has ~0 real requests and FAILS condition 3 by construction.
 *
 * Exit codes: 0 = PASS, 1 = FAIL (including every fail-closed path), 2 = usage error.
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// ─── Non-waivable thresholds (Task 5.5 Step 1) ───────────────────────────────

/** Minimum soak duration, in minutes, of production traffic in `log` mode. */
export const MIN_SOAK_MINUTES = 60;

/**
 * Minimum REAL requests. "Real" excludes CI and operator sources on purpose:
 * the plan's own wording is "Synthetic probes may supplement but never
 * substitute for the real-traffic soak", so 500 CI probes must not clear this
 * bar. CI/operator requests are still counted and reported under `totals`.
 */
export const MIN_REAL_REQUESTS = 500;

/**
 * Minimum DISTINCT real (non-CI, non-operator) source IPs.
 *
 * Why this exists at all: MIN_REAL_REQUESTS counts ROWS, and rows are the one
 * quantity a single machine can manufacture at will. Without this floor, 500
 * requests from ONE unlisted IP satisfied ">= 500 real requests" and the gate
 * returned PASS — the very substitution the file header forbids ("synthetic
 * probes may SUPPLEMENT the soak, never SUBSTITUTE for it"). That is not a
 * hypothetical: DEFAULT_KNOWN_SOURCES is explicitly "a snapshot that WILL go
 * stale as GitHub Actions runner infrastructure rotates", so a rotated runner
 * is classified UNKNOWN and its probes are counted as real user traffic. This
 * is the 2026-08-06 failure mode reachable with no malice and no tampering.
 *
 * Why 25:
 *   - It is far above any single-actor probe fleet. One box is 1 source; a
 *     GitHub Actions matrix egresses from a handful of NAT addresses, and this
 *     repo's witnessed CI set (DEFAULT_KNOWN_SOURCES) is 4 IPs. Clearing 25
 *     distinct sources cannot be done by accident with a probe script, which is
 *     the exact accident this gate is here to catch.
 *   - It is cheap for genuine traffic. 500 requests over >= 60 minutes spread
 *     across >= 25 clients is ~20 requests per client per hour — a shape any
 *     real user population produces trivially.
 *   - It is a FLOOR, not a calibration. It is deliberately NOT derived from a
 *     measured production source cardinality, because no such measurement is in
 *     evidence here and inventing one would be the same sin as the prose gate.
 *     If a real soak fails this floor, that failure is itself the finding: the
 *     traffic captured is not representative of real users, and re-soaking is
 *     the correct response. There is no override.
 */
export const MIN_DISTINCT_REAL_SOURCES = 25;

/**
 * Maximum share of the REAL request count any ONE real source may contribute.
 *
 * The distinct-source floor alone is still gameable: 476 requests from one box
 * plus 24 incidental clients clears a floor of 25 while remaining, in substance,
 * one machine's synthetic traffic. This caps concentration so the request volume
 * has to come from the population, not from one member of it.
 *
 * 25% is deliberately generous — a large NAT or corporate proxy can legitimately
 * be the busiest client — while still being an order of magnitude below the
 * "one source IS the soak" shape (100%) that motivated it. Evaluated as
 * floor(share x realRequests) with a minimum of 1 so that tiny samples (which
 * fail MIN_REAL_REQUESTS anyway) can never fail this condition for arithmetic
 * reasons, and so a zero-request bundle produces 0 <= 1 instead of NaN.
 */
export const MAX_REAL_SHARE_PER_SOURCE = 0.25;

/** The only EDGE_MODE a soak may be conducted in. */
export const REQUIRED_EDGE_MODE = "log";

/** Documented input shape, exported so the runbook and tests share one source. */
export const SOAK_INPUT_SHAPE = Object.freeze({
  edgeMode: "log",
  windowStartMs: "epoch ms (optional; narrows the window, never widens it)",
  windowEndMs: "epoch ms (optional)",
  requests:
    "array of { ip, occurredAt, edgeVerdict | (eventType+context) | originLockKind }",
  errors: "array of strings (optional; any entry forces FAIL)",
});

// ─── Source classes ──────────────────────────────────────────────────────────

export const SOURCE_CLASS = Object.freeze({
  CI: "CI",
  OPERATOR: "OPERATOR",
  UNKNOWN: "UNKNOWN",
  UNCLASSIFIABLE: "UNCLASSIFIABLE",
});

/** The two classes excluded from the would-deny pass condition. Nothing else. */
const EXCLUDED_CLASSES = Object.freeze([
  SOURCE_CLASS.CI,
  SOURCE_CLASS.OPERATOR,
]);

/**
 * Witnessed CI/operator IPs from the 2026-08-06 production incident — the same
 * addresses as server/securityDigest.ts's DEFAULT_KNOWN_AUTOMATION_IPS, split
 * into the CI/OPERATOR classes its flat "known_automation" class cannot express.
 * Exact IPs, not ranges: these are a snapshot that WILL go stale as GitHub
 * Actions runner infrastructure rotates. Extend without a code change via
 * EDGE_SOAK_CI_IPS / EDGE_SOAK_OPERATOR_IPS.
 */
export const DEFAULT_KNOWN_SOURCES = Object.freeze([
  {
    value: "47.152.160.175",
    sourceClass: SOURCE_CLASS.OPERATOR,
    label: "owner ISP IP (ua=curl/8.7.1, dime-ci-probe — 2026-08-06 incident)",
  },
  {
    value: "40.81.6.244",
    sourceClass: SOURCE_CLASS.CI,
    label:
      "Azure/GitHub Actions runner, witnessed 2026-08-06 — exact IP, not a range",
  },
  {
    value: "172.182.201.162",
    sourceClass: SOURCE_CLASS.CI,
    label:
      "Azure/GitHub Actions runner, witnessed 2026-08-06 — exact IP, not a range",
  },
  {
    value: "48.217.34.226",
    sourceClass: SOURCE_CLASS.CI,
    label:
      "Azure/GitHub Actions runner, witnessed 2026-08-06 — exact IP, not a range",
  },
  {
    value: "20.49.13.182",
    sourceClass: SOURCE_CLASS.CI,
    label:
      "Azure/GitHub Actions runner, witnessed 2026-08-06 — exact IP, not a range",
  },
]);

// ─── Edge verdicts ───────────────────────────────────────────────────────────

/** Verdicts a row may state. Anything else is a data error, never a default. */
const RECOGNIZED_EDGE_VERDICTS = new Set(["allow", "would_deny", "deny"]);

/** The verdicts that count against the pass condition. */
const DENYING_EDGE_VERDICTS = new Set(["would_deny", "deny"]);

/**
 * originLock's own event kinds (server/_core/originLock.ts). Only the two that
 * describe a per-request refusal map to a verdict; the breaker/anti-lockout
 * kinds are process-level state changes, not request outcomes, so they are NOT
 * silently mapped to "allow".
 */
const ORIGIN_LOCK_KIND_TO_VERDICT = Object.freeze({
  edge_deny: "deny",
  edge_would_deny: "would_deny",
  edge_ok: "allow",
});

/**
 * The persisted security_events shape for an origin-lock refusal. Note that the
 * row does NOT record whether the request was actually blocked (see
 * fireRateLimitEvent()'s comment in server/_core/index.ts — `outcome` is logged,
 * never persisted). In a `log`-mode soak every such row IS a would-deny, which
 * is also the conservative reading if the mode were ever mislabelled.
 */
const ANOMALY_EVENT_TYPE = "RATE_LIMIT";
const ANOMALY_CONTEXT = "edge_origin_ingress_anomaly";

// ─── IP helpers (same semantics as server/securityDigest.ts) ─────────────────

function ipv4ToInt(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const o = Number(p);
    if (o > 255) return null;
    n = n * 256 + o;
  }
  return n >>> 0;
}

function ipv4InCidr(ip, cidr) {
  const [net, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const ipN = ipv4ToInt(ip);
  const netN = ipv4ToInt(net);
  if (
    ipN === null ||
    netN === null ||
    Number.isNaN(bits) ||
    bits < 0 ||
    bits > 32
  ) {
    return false;
  }
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
  return (ipN & mask) >>> 0 === (netN & mask) >>> 0;
}

/**
 * Exact match, or IPv4-CIDR containment. IPv4 CIDR only — an IPv6 address never
 * matches a `/`-bearing pattern, it falls through to "not allowlisted". Same
 * rule, and same reason, as securityDigest.ts's matchesIpOrCidr().
 */
export function matchesIpOrCidr(ip, pattern) {
  if (typeof ip !== "string" || typeof pattern !== "string") return false;
  if (pattern.includes("/")) {
    if (ip.includes(":")) return false;
    return ipv4InCidr(ip, pattern);
  }
  return ip === pattern;
}

/**
 * Placeholder tokens that proxies, log exporters and this repo's own digest
 * markers write where a real client address belongs. Each looks like a value
 * and identifies nobody, so each is UNCLASSIFIABLE rather than UNKNOWN.
 */
const NON_IDENTITY_TOKENS = new Set([
  "",
  "-",
  "unknown",
  "null",
  "undefined",
  "system",
  "n/a",
  "none",
]);

/** Loose but non-empty IP-literal check: enough to reject junk, not a parser. */
function looksLikeIpLiteral(value) {
  if (value.includes(":"))
    return /^[0-9a-fA-F:.]+$/.test(value) && value.length <= 45;
  return ipv4ToInt(value) !== null;
}

/**
 * Whether a raw `ip` field identifies a source well enough to reason about.
 * Returns null when usable, or a human reason string when not.
 */
export function sourceIdentityProblem(ip) {
  if (ip === null || ip === undefined) return "row has no ip field";
  if (typeof ip !== "string") return `ip is not a string (got ${typeof ip})`;
  const trimmed = ip.trim();
  if (NON_IDENTITY_TOKENS.has(trimmed.toLowerCase())) {
    return `ip is the placeholder token "${sanitizeForOutput(trimmed)}", which identifies no source`;
  }
  if (!looksLikeIpLiteral(trimmed)) {
    return `ip "${sanitizeForOutput(trimmed)}" is not a valid IPv4/IPv6 literal`;
  }
  return null;
}

/**
 * Strips everything that is not plausibly part of an IP/label before it reaches
 * a log line or a pasted report. Report text is quoted into PR bodies and
 * Discord; an attacker controls the `ip` and `userAgent` fields on the rows this
 * script reads.
 */
export function sanitizeForOutput(value, maxLength = 64) {
  return String(value ?? "")
    .replace(/[^\w.:/@ -]/g, "?")
    .slice(0, maxLength);
}

// ─── Known-source allowlist ──────────────────────────────────────────────────

function parseIpList(raw, sourceClass, label) {
  const value = (raw ?? "").trim();
  if (!value) return [];
  return value
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .map(v => ({ value: v, sourceClass, label }));
}

/**
 * Builds the known-source list, read at CALL time (never cached at module load)
 * so an env change takes effect on the next run — same contract as
 * securityDigest.ts's getOwnerConfiguredAllowlist().
 *
 * Precedence is first-match-wins, so an explicit CI/OPERATOR classification
 * always beats the unclassed SECURITY_DIGEST_ALLOWLIST_IPS entry for the same IP.
 */
export function buildKnownSources(env = process.env) {
  return [
    ...DEFAULT_KNOWN_SOURCES,
    ...parseIpList(
      env.EDGE_SOAK_CI_IPS,
      SOURCE_CLASS.CI,
      "owner-configured CI (EDGE_SOAK_CI_IPS)"
    ),
    ...parseIpList(
      env.EDGE_SOAK_OPERATOR_IPS,
      SOURCE_CLASS.OPERATOR,
      "owner-configured operator (EDGE_SOAK_OPERATOR_IPS)"
    ),
    // Recognized and labelled, but NOT excluded — see the divergence note (b)
    // in this file's header. SECURITY_DIGEST_ALLOWLIST_IPS says "known
    // automation" without saying whose, and guessing "CI" is the failure mode
    // this whole script exists to prevent.
    ...parseIpList(
      env.SECURITY_DIGEST_ALLOWLIST_IPS,
      SOURCE_CLASS.UNKNOWN,
      "known automation, class unstated (SECURITY_DIGEST_ALLOWLIST_IPS) — NOT excluded; classify it with EDGE_SOAK_CI_IPS/EDGE_SOAK_OPERATOR_IPS"
    ),
  ];
}

/**
 * Classifies one source IP. Cloudflare-range membership is deliberately NOT a
 * class: see the header note and securityDigest.ts's CF_RANGE_ALLOWLIST_ENABLED.
 */
export function classifySource(ip, knownSources) {
  const problem = sourceIdentityProblem(ip);
  if (problem) {
    return { sourceClass: SOURCE_CLASS.UNCLASSIFIABLE, label: problem };
  }
  const trimmed = ip.trim();
  for (const entry of knownSources) {
    if (matchesIpOrCidr(trimmed, entry.value)) {
      return { sourceClass: entry.sourceClass, label: entry.label };
    }
  }
  return {
    sourceClass: SOURCE_CLASS.UNKNOWN,
    label: "not a known CI/operator source",
  };
}

// ─── Row reading ─────────────────────────────────────────────────────────────

/**
 * Reads a row's edge verdict. Returns { verdict } or { problem }. There is NO
 * default: a row that does not state its outcome is a data error, because
 * assuming "allow" would let an unexamined stream clear the gate.
 */
export function readEdgeVerdict(row) {
  if (typeof row.edgeVerdict === "string") {
    const v = row.edgeVerdict.trim().toLowerCase();
    if (RECOGNIZED_EDGE_VERDICTS.has(v)) return { verdict: v };
    return {
      problem: `unrecognized edgeVerdict "${sanitizeForOutput(row.edgeVerdict)}"`,
    };
  }
  if (typeof row.originLockKind === "string") {
    const mapped = ORIGIN_LOCK_KIND_TO_VERDICT[row.originLockKind.trim()];
    if (mapped) return { verdict: mapped };
    return {
      problem: `unmappable originLockKind "${sanitizeForOutput(row.originLockKind)}"`,
    };
  }
  if (row.eventType === ANOMALY_EVENT_TYPE && row.context === ANOMALY_CONTEXT) {
    return { verdict: "would_deny" };
  }
  return {
    problem:
      "row states no edge verdict (needs edgeVerdict, originLockKind, or eventType+context)",
  };
}

// ─── The gate ────────────────────────────────────────────────────────────────

function emptyClassBucket() {
  return { requests: 0, wouldDeny: 0, sources: new Set() };
}

function minutes(ms) {
  return Math.round((ms / 60000) * 100) / 100;
}

/**
 * THE verdict function. Pure: same input, same output, no clock, no filesystem,
 * no network. `opts.knownSources` / `opts.env` are the only injection points —
 * there is intentionally no way for a caller to move a threshold.
 */
export function evaluateSoak(input, opts = {}) {
  const knownSources =
    opts.knownSources ?? buildKnownSources(opts.env ?? process.env);

  /** Data errors. A non-empty list can only ever produce FAIL. */
  const dataErrors = [];
  for (const e of Array.isArray(input?.errors) ? input.errors : []) {
    dataErrors.push(String(e));
  }
  if (input && input.errors !== undefined && !Array.isArray(input.errors)) {
    dataErrors.push("input.errors is present but is not an array");
  }

  const rawRequests = input?.requests;
  if (!Array.isArray(rawRequests)) {
    dataErrors.push("input.requests is missing or is not an array");
  }
  const requests = Array.isArray(rawRequests) ? rawRequests : [];

  const edgeMode =
    typeof input?.edgeMode === "string"
      ? input.edgeMode.trim().toLowerCase()
      : null;

  const byClass = {
    [SOURCE_CLASS.CI]: emptyClassBucket(),
    [SOURCE_CLASS.OPERATOR]: emptyClassBucket(),
    [SOURCE_CLASS.UNKNOWN]: emptyClassBucket(),
    [SOURCE_CLASS.UNCLASSIFIABLE]: emptyClassBucket(),
  };
  const distinctSources = new Set();
  /** Per-source row counts for REAL (UNKNOWN-class) sources only — the input to
   * the distinct-source floor and the per-source concentration cap. CI/operator
   * sources are excluded here for the same reason they are excluded from
   * `realRequests`: their volume is never evidence of real traffic. */
  const realSourceCounts = new Map();
  const unclassifiableReasons = new Map();
  const offendingSources = new Map();

  let earliest = null;
  let latest = null;
  let malformedRows = 0;
  let outsideDeclaredWindow = 0;

  const declaredStart = Number.isFinite(input?.windowStartMs)
    ? input.windowStartMs
    : null;
  const declaredEnd = Number.isFinite(input?.windowEndMs)
    ? input.windowEndMs
    : null;
  const hasDeclaredWindow =
    declaredStart !== null &&
    declaredEnd !== null &&
    declaredEnd > declaredStart;
  if (
    (declaredStart !== null || declaredEnd !== null) &&
    !hasDeclaredWindow &&
    !(declaredStart === null && declaredEnd === null)
  ) {
    dataErrors.push(
      "declared window is incomplete or non-positive (needs both windowStartMs and windowEndMs, with end > start)"
    );
  }

  for (let i = 0; i < requests.length; i++) {
    const row = requests[i];
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      malformedRows++;
      dataErrors.push(`requests[${i}] is not an object`);
      continue;
    }

    const { verdict, problem } = readEdgeVerdict(row);
    if (problem) {
      malformedRows++;
      dataErrors.push(`requests[${i}]: ${problem}`);
      continue;
    }

    if (!Number.isFinite(row.occurredAt)) {
      malformedRows++;
      dataErrors.push(
        `requests[${i}]: occurredAt is missing or not a finite number — the soak window cannot be measured from this row`
      );
      continue;
    }
    if (earliest === null || row.occurredAt < earliest)
      earliest = row.occurredAt;
    if (latest === null || row.occurredAt > latest) latest = row.occurredAt;
    if (
      hasDeclaredWindow &&
      (row.occurredAt < declaredStart || row.occurredAt > declaredEnd)
    ) {
      outsideDeclaredWindow++;
    }

    const { sourceClass, label } = classifySource(row.ip, knownSources);
    const bucket = byClass[sourceClass];
    bucket.requests++;

    // Derived without assuming `row.ip` is a usable string. classifySource()
    // only returns a non-UNCLASSIFIABLE class for a valid IP literal, so
    // `String(row.ip).trim()` would be safe here today — but a future edit to
    // classifySource() would then crash this loop with a TypeError instead of
    // producing the clean FAIL report the gate promises, and a gate that
    // throws is a gate whose output nobody can paste.
    const sourceKey =
      sourceClass === SOURCE_CLASS.UNCLASSIFIABLE
        ? `<unclassifiable: ${label}>`
        : String(row.ip ?? "").trim();

    if (sourceClass === SOURCE_CLASS.UNCLASSIFIABLE) {
      bucket.sources.add(`requests[${i}]`);
      unclassifiableReasons.set(
        label,
        (unclassifiableReasons.get(label) ?? 0) + 1
      );
    } else {
      bucket.sources.add(sourceKey);
      distinctSources.add(sourceKey);
      if (sourceClass === SOURCE_CLASS.UNKNOWN) {
        realSourceCounts.set(
          sourceKey,
          (realSourceCounts.get(sourceKey) ?? 0) + 1
        );
      }
    }

    if (DENYING_EDGE_VERDICTS.has(verdict)) {
      bucket.wouldDeny++;
      if (!EXCLUDED_CLASSES.includes(sourceClass)) {
        const key = sanitizeForOutput(sourceKey, 96);
        offendingSources.set(key, (offendingSources.get(key) ?? 0) + 1);
      }
    }
  }

  if (outsideDeclaredWindow > 0) {
    dataErrors.push(
      `${outsideDeclaredWindow} request row(s) fall outside the declared window — the evidence and the stated window disagree`
    );
  }

  // Window: the SMALLER of what was declared and what the data actually spans.
  // A declared hour with two minutes of rows in it is two minutes of evidence.
  const observedSpanMs =
    earliest !== null && latest !== null ? latest - earliest : 0;
  const declaredSpanMs = hasDeclaredWindow ? declaredEnd - declaredStart : null;
  const effectiveWindowMs =
    declaredSpanMs === null
      ? observedSpanMs
      : Math.min(declaredSpanMs, observedSpanMs);

  const totalRequests = requests.length;
  const countedRequests = Object.values(byClass).reduce(
    (s, b) => s + b.requests,
    0
  );
  const realRequests = byClass[SOURCE_CLASS.UNKNOWN].requests;
  const wouldDenyTotal = Object.values(byClass).reduce(
    (s, b) => s + b.wouldDeny,
    0
  );
  const wouldDenyExcluded =
    byClass[SOURCE_CLASS.CI].wouldDeny +
    byClass[SOURCE_CLASS.OPERATOR].wouldDeny;
  const wouldDenyFromRealSources =
    byClass[SOURCE_CLASS.UNKNOWN].wouldDeny +
    byClass[SOURCE_CLASS.UNCLASSIFIABLE].wouldDeny;
  const unclassifiableRows = byClass[SOURCE_CLASS.UNCLASSIFIABLE].requests;

  // Traffic SHAPE, not just volume. `realRequests` is a row count and a row
  // count is manufacturable by one machine; these two describe how that count
  // is spread across the source population.
  const distinctRealSources = realSourceCounts.size;
  let topRealSourceRequests = 0;
  for (const count of realSourceCounts.values()) {
    if (count > topRealSourceRequests) topRealSourceRequests = count;
  }
  const maxRequestsPerRealSource = Math.max(
    1,
    Math.floor(MAX_REAL_SHARE_PER_SOURCE * realRequests)
  );

  const conditions = [
    {
      id: "edge_mode_log",
      description: `EDGE_MODE during the soak is "${REQUIRED_EDGE_MODE}"`,
      required: REQUIRED_EDGE_MODE,
      actual: edgeMode ?? "<not stated>",
      pass: edgeMode === REQUIRED_EDGE_MODE,
    },
    {
      id: "soak_window_minutes",
      description: `>= ${MIN_SOAK_MINUTES} minutes of production traffic`,
      required: MIN_SOAK_MINUTES,
      actual: minutes(effectiveWindowMs),
      pass: effectiveWindowMs >= MIN_SOAK_MINUTES * 60000,
    },
    {
      id: "real_requests",
      description: `>= ${MIN_REAL_REQUESTS} real requests (CI/operator requests do not count)`,
      required: MIN_REAL_REQUESTS,
      actual: realRequests,
      pass: realRequests >= MIN_REAL_REQUESTS,
    },
    {
      id: "distinct_real_sources",
      description:
        `>= ${MIN_DISTINCT_REAL_SOURCES} DISTINCT real sources ` +
        `(a request count is not a traffic shape — one box can manufacture rows)`,
      required: MIN_DISTINCT_REAL_SOURCES,
      actual: distinctRealSources,
      pass: distinctRealSources >= MIN_DISTINCT_REAL_SOURCES,
    },
    {
      id: "real_source_concentration",
      description:
        `no single real source contributes more than ` +
        `${Math.round(MAX_REAL_SHARE_PER_SOURCE * 100)}% of the real requests`,
      required: maxRequestsPerRealSource,
      actual: topRealSourceRequests,
      pass: topRealSourceRequests <= maxRequestsPerRealSource,
    },
    {
      id: "would_deny_from_real_sources_zero",
      description:
        "would-deny count from NON-CI, NON-OPERATOR sources is exactly 0",
      required: 0,
      actual: wouldDenyFromRealSources,
      pass: wouldDenyFromRealSources === 0,
    },
    {
      id: "all_sources_classifiable",
      description:
        "every observed source is classifiable (an unknown source is never assumed CI)",
      required: 0,
      actual: unclassifiableRows,
      pass: unclassifiableRows === 0,
    },
    {
      id: "no_data_errors",
      description: "no query errors, malformed rows, or unstated edge verdicts",
      required: 0,
      actual: dataErrors.length,
      pass: dataErrors.length === 0,
    },
  ];

  const failedConditions = conditions.filter(c => !c.pass).map(c => c.id);
  const verdict = failedConditions.length === 0 ? "PASS" : "FAIL";

  const exclusionStatement =
    `CI/operator sources were EXCLUDED from the would-deny pass condition: ` +
    `${byClass[SOURCE_CLASS.CI].sources.size} CI source(s) contributing ` +
    `${byClass[SOURCE_CLASS.CI].wouldDeny} would-deny event(s) and ` +
    `${byClass[SOURCE_CLASS.OPERATOR].sources.size} operator source(s) contributing ` +
    `${byClass[SOURCE_CLASS.OPERATOR].wouldDeny} would-deny event(s) were not counted. ` +
    `Every other source counted: ${wouldDenyFromRealSources} would-deny event(s) from ` +
    `non-CI, non-operator sources.`;

  return {
    verdict,
    gate: "edge-arming-soak",
    label:
      typeof input?.label === "string"
        ? sanitizeForOutput(input.label, 120)
        : null,
    edgeMode: edgeMode ?? null,
    window: {
      declaredStartMs: declaredStart,
      declaredEndMs: declaredEnd,
      declaredMinutes: declaredSpanMs === null ? null : minutes(declaredSpanMs),
      observedMinutes: minutes(observedSpanMs),
      effectiveMinutes: minutes(effectiveWindowMs),
      requiredMinutes: MIN_SOAK_MINUTES,
    },
    totals: {
      requests: totalRequests,
      classifiedRequests: countedRequests,
      malformedRows,
      realRequests,
      distinctSources: distinctSources.size,
      distinctRealSources,
      requiredDistinctRealSources: MIN_DISTINCT_REAL_SOURCES,
      topRealSourceRequests,
      maxRequestsPerRealSource,
      wouldDenyTotal,
      wouldDenyExcluded,
      wouldDenyFromRealSources,
    },
    byClass: Object.fromEntries(
      Object.entries(byClass).map(([k, v]) => [
        k,
        {
          requests: v.requests,
          wouldDeny: v.wouldDeny,
          distinctSources: v.sources.size,
        },
      ])
    ),
    exclusionStatement,
    unclassifiableReasons: [...unclassifiableReasons.entries()].map(
      ([reason, count]) => ({
        reason,
        count,
      })
    ),
    offendingSources: [...offendingSources.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([ip, count]) => ({ ip, wouldDeny: count })),
    conditions,
    failedConditions,
    dataErrors: dataErrors.slice(0, 50),
    dataErrorCount: dataErrors.length,
  };
}

// ─── Rendering ───────────────────────────────────────────────────────────────

export function renderHumanSummary(report) {
  const lines = [];
  const bar = "─".repeat(72);
  lines.push(bar);
  lines.push(`EDGE ARMING SOAK GATE — VERDICT: ${report.verdict}`);
  if (report.label) lines.push(`soak: ${report.label}`);
  lines.push(bar);
  lines.push(
    `EDGE_MODE during soak      : ${report.edgeMode ?? "<not stated>"}`
  );
  lines.push(
    `Soak window (effective)    : ${report.window.effectiveMinutes} min ` +
      `(declared ${report.window.declaredMinutes ?? "n/a"} min, observed ${report.window.observedMinutes} min)`
  );
  lines.push(`Total requests observed    : ${report.totals.requests}`);
  lines.push(`Real requests (non-CI/op)  : ${report.totals.realRequests}`);
  lines.push(`Distinct sources           : ${report.totals.distinctSources}`);
  lines.push(
    `Distinct REAL sources      : ${report.totals.distinctRealSources} ` +
      `(floor ${report.totals.requiredDistinctRealSources})`
  );
  lines.push(
    `Busiest real source        : ${report.totals.topRealSourceRequests} request(s) ` +
      `(cap ${report.totals.maxRequestsPerRealSource})`
  );
  lines.push("");
  lines.push("Per-class breakdown:");
  for (const cls of [
    SOURCE_CLASS.CI,
    SOURCE_CLASS.OPERATOR,
    SOURCE_CLASS.UNKNOWN,
    SOURCE_CLASS.UNCLASSIFIABLE,
  ]) {
    const b = report.byClass[cls];
    lines.push(
      `  ${cls.padEnd(15)} requests=${String(b.requests).padStart(6)}  ` +
        `would-deny=${String(b.wouldDeny).padStart(5)}  distinct-sources=${b.distinctSources}`
    );
  }
  lines.push("");
  lines.push(`would-deny total           : ${report.totals.wouldDenyTotal}`);
  lines.push(`  excluded (CI + operator) : ${report.totals.wouldDenyExcluded}`);
  lines.push(
    `  COUNTED (real sources)   : ${report.totals.wouldDenyFromRealSources}`
  );
  lines.push("");
  lines.push(report.exclusionStatement);

  if (report.unclassifiableReasons.length > 0) {
    lines.push("");
    lines.push(
      "UNCLASSIFIABLE sources (never assumed CI — each one fails the gate):"
    );
    for (const u of report.unclassifiableReasons) {
      lines.push(`  x${u.count}  ${u.reason}`);
    }
  }
  if (report.offendingSources.length > 0) {
    lines.push("");
    lines.push("would-deny from non-CI, non-operator sources:");
    for (const o of report.offendingSources) {
      lines.push(`  ${o.ip}  x${o.wouldDeny}`);
    }
  }

  lines.push("");
  lines.push("Conditions (all non-waivable):");
  for (const c of report.conditions) {
    lines.push(
      `  [${c.pass ? "PASS" : "FAIL"}] ${c.id} — ${c.description} (required ${c.required}, actual ${c.actual})`
    );
  }

  if (report.dataErrorCount > 0) {
    lines.push("");
    lines.push(
      `Data errors (${report.dataErrorCount}; showing up to ${report.dataErrors.length}):`
    );
    for (const e of report.dataErrors)
      lines.push(`  - ${sanitizeForOutput(e, 200)}`);
  }

  lines.push(bar);
  lines.push(
    report.verdict === "PASS"
      ? "PASS — arming is permitted. Paste this whole block into the arming evidence."
      : "FAIL — DO NOT set EDGE_MODE=on. Fix the failed conditions and re-soak."
  );
  lines.push(bar);
  return lines.join("\n");
}

// ─── Loaders ─────────────────────────────────────────────────────────────────

/** Reads the evidence bundle. Every failure becomes a data error, not a throw. */
export function loadSoakInputFromFile(path, readFile = readFileSync) {
  try {
    const parsed = JSON.parse(readFile(path, "utf8"));
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return {
        requests: [],
        errors: [`input file ${path} is not a JSON object`],
      };
    }
    return parsed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      requests: [],
      errors: [`could not read input file ${path}: ${msg}`],
    };
  }
}

/**
 * SUPPLEMENTS a bundle with persisted RATE_LIMIT/edge_origin_ingress_anomaly
 * rows. Never replaces it — security_events holds anomalies, not the total
 * request stream, so a --db-only run has ~0 real requests and fails by
 * construction. A query error is returned, never thrown, and forces FAIL.
 */
export async function loadWouldDenyEventsFromDb({
  sinceMs,
  untilMs,
  databaseUrl,
} = {}) {
  const url = databaseUrl ?? process.env.DATABASE_URL;
  if (!url) {
    return {
      requests: [],
      errors: ["--db requested but DATABASE_URL is not set"],
    };
  }
  let connection = null;
  try {
    const mysql = await import("mysql2/promise");
    connection = await mysql.createConnection(url);
    const [rows] = await connection.execute(
      "SELECT ip, occurredAt, eventType, context, userAgent FROM security_events " +
        "WHERE occurredAt >= ? AND occurredAt <= ? AND eventType = ? AND context = ? " +
        "ORDER BY occurredAt ASC",
      [sinceMs, untilMs, ANOMALY_EVENT_TYPE, ANOMALY_CONTEXT]
    );
    return {
      requests: rows.map(r => ({
        ip: r.ip,
        occurredAt: Number(r.occurredAt),
        eventType: r.eventType,
        context: r.context,
        userAgent: r.userAgent ?? null,
      })),
      errors: [],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { requests: [], errors: [`security_events query failed: ${msg}`] };
  } finally {
    if (connection) {
      try {
        await connection.end();
      } catch {
        /* closing a already-broken connection must not mask the query error */
      }
    }
  }
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const args = {
    input: null,
    json: false,
    db: false,
    since: null,
    until: null,
    help: false,
  };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--input=")) args.input = arg.slice("--input=".length);
    else if (arg === "--json") args.json = true;
    else if (arg === "--db") args.db = true;
    else if (arg.startsWith("--since="))
      args.since = arg.slice("--since=".length);
    else if (arg.startsWith("--until="))
      args.until = arg.slice("--until=".length);
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function toMs(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (/^\d+$/.test(value)) return Number(value);
  const t = Date.parse(value);
  return Number.isNaN(t) ? fallback : t;
}

const USAGE = `edge-soak-report — the EDGE_MODE arming gate

  node scripts/edge-soak-report.mjs --input=soak.json [--json] [--db] [--since=<ms|ISO>] [--until=<ms|ISO>]

  --input=<path>  JSON evidence bundle: ${JSON.stringify(SOAK_INPUT_SHAPE)}
  --json          emit the machine-readable report only
  --db            supplement the bundle with security_events anomaly rows
  --since/--until window bounds for --db (default: last ${MIN_SOAK_MINUTES} minutes)

Exit: 0 PASS, 1 FAIL, 2 usage error.`;

/** Names a value's runtime type for a data-error message. */
function typeName(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Renders an arbitrary value as text for a data-error message. A plain
 * `String(obj)` would flatten a collector's `{ fatal: "...query failed..." }`
 * into "[object Object]" and throw away the one sentence the operator needs.
 */
function describeValue(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * The CLI entry point — the code path an operator actually runs.
 *
 * `deps` exists ONLY so tests can drive this function without a filesystem or a
 * database. It carries no thresholds and no verdict: `evaluateSoak` is still
 * called with data alone, so there is no more seam to relax the gate here than
 * there is inside it.
 */
export async function main(argv = process.argv, out = console, deps = {}) {
  const readFile = deps.readFile ?? readFileSync;
  const loadDbEvents = deps.loadDbEvents ?? loadWouldDenyEventsFromDb;
  const now = deps.now ?? Date.now;

  const args = parseArgs(argv);
  if (args.help) {
    out.log(USAGE);
    return 2;
  }
  if (!args.input && !args.db) {
    out.error("edge-soak-report: --input=<path> is required (or --db).\n");
    out.error(USAGE);
    return 2;
  }

  const bundle = args.input
    ? loadSoakInputFromFile(args.input, readFile)
    : { requests: [], errors: [] };

  // ── Shape problems are DATA ERRORS. They are never normalized away. ────────
  // This block used to read:
  //     if (!Array.isArray(input.requests)) input.requests = [];
  //     if (!Array.isArray(input.errors)) input.errors = [];
  // which made the CLI FAIL-OPEN. It pre-empted evaluateSoak's own guards, so a
  // bundle whose collector wrote `"errors": "security_events query failed: ..."`
  // as a STRING had that failure silently deleted here and came back
  // VERDICT: PASS, exit 0. The pure function failed closed; the wrapper
  // operators actually run failed open — and a gate that returns PASS when it
  // should not is worse than no gate, because it launders an unverified claim
  // into an approved one. That is exactly what happened on 2026-08-06.
  const shapeErrors = [];
  if (!Array.isArray(bundle.requests)) {
    shapeErrors.push(
      `input.requests is missing or is not an array (got ${typeName(bundle.requests)}) — ` +
        `the request stream cannot be read`
    );
  }
  if (bundle.errors !== undefined && !Array.isArray(bundle.errors)) {
    // Quote the raw value: a malformed `errors` field is usually a collector
    // reporting a failure in the wrong shape, and that text is the single most
    // useful thing that can appear on the operator's screen.
    shapeErrors.push(
      `input.errors is present but is not an array (got ${typeName(bundle.errors)}) — ` +
        `its content, which may itself report a collector failure, is: ` +
        `${sanitizeForOutput(describeValue(bundle.errors), 200)}`
    );
  }

  const requests = Array.isArray(bundle.requests) ? [...bundle.requests] : [];
  const errors = Array.isArray(bundle.errors) ? bundle.errors.map(String) : [];
  errors.push(...shapeErrors);

  if (args.db) {
    const untilMs = toMs(args.until, now());
    const sinceMs = toMs(args.since, untilMs - MIN_SOAK_MINUTES * 60000);
    const dbResult = await loadDbEvents({ sinceMs, untilMs });
    // The loader's own contract is "returns, never throws", but a shape it did
    // not promise must not silently contribute zero rows and zero errors.
    if (Array.isArray(dbResult?.requests)) requests.push(...dbResult.requests);
    else errors.push("--db loader returned no usable requests array");
    if (Array.isArray(dbResult?.errors)) errors.push(...dbResult.errors);
    else errors.push("--db loader returned no usable errors array");
  }

  const report = evaluateSoak({ ...bundle, requests, errors });
  out.log(
    args.json ? JSON.stringify(report, null, 2) : renderHumanSummary(report)
  );
  return report.verdict === "PASS" ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  main().then(code => {
    process.exitCode = code;
  });
}
