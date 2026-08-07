import { eq, inArray } from "drizzle-orm";
import { mlbCalibrationConstants } from "../drizzle/schema";
import { getDb } from "./db";

/**
 * MLB per-market publication gate — the SOURCE. No nulling logic lives here;
 * the field policy is in feedGating.ts and the wiring is in routers.ts.
 *
 * WHY THIS EXISTS. The 2026 season model audit (docs/audits/mlb-model-audit-2026/)
 * ruled all nine gate markets BACKTEST-ONLY (GATE-TABLE.json) and wrote nine
 * `publish_*` verdict rows into `mlb_calibration_constants`. Nothing read them:
 * mlbModelRunner.ts hardcodes publishedToFeed/publishedModel = true on every
 * write, and the only reader of those flags scopes itself to NCAAM
 * (db.ts, `if (row.sport !== 'NCAAM') return row`). The verdict was therefore
 * unenforceable. This module makes it enforceable — without enforcing it.
 *
 * DESIGN LAW (mirrors edgeProxy.ts, the proven Phase 4 precedent):
 *
 *  1. Nothing here changes behavior until `MLB_MARKET_GATE_MODE` is set to
 *     "log" or "on". Unset/"off" returns ALL_PUBLISHED without touching the
 *     database, so importing this module is inert and merging it is byte-
 *     identical to today. Env is read at CALL time, never at import time.
 *     This is the #370 deploy-order lesson: never ship a latent behavior flip.
 *
 *  2. The default MUST be "off" because all nine rows are currently 0. A
 *     boolean flag defaulting to enabled would blank every MLB model number on
 *     the paid feed the instant a container restarted.
 *
 *  3. "log" is the load-bearing middle rung: it performs the real database read
 *     and logs which markets WOULD be nulled, while changing no bytes of
 *     output. The loader gets validated against real production rows before a
 *     single subscriber sees a change.
 *
 *  4. FAIL-OPEN, always. This gate is an editorial/compliance signal about
 *     backtest confidence, NOT an access-control boundary. The security
 *     boundary is stripGameModelFields() in feedGating.ts, which is pure and
 *     in-memory and cannot be affected by a database fault — so a gate failure
 *     can never leak model IP to an anonymous caller. Failing closed would turn
 *     a transient TiDB blip into a total product outage for paying subscribers
 *     at precisely the moment db.ts's _lastGoodCache is serving stale rows to
 *     keep the feed alive. Fail-open degrades to exactly today's behavior.
 *
 * Rollback from a bad enforcement is a Railway variable edit ("on" → "off"),
 * no deploy and no cache purge, effective within one snapshot TTL.
 */

/**
 * The nine gate markets, matching the `publish_*` paramNames written by
 * docs/audits/mlb-model-audit-2026/tools/gate-eval.mjs. Note the audit's
 * internal market ids `k_prop`/`hr_prop` are SINGULAR while the persisted
 * paramNames are `publish_k_props`/`publish_hr_props` (plural) — these keys
 * follow the persisted paramNames, which is what we actually read.
 */
export const MLB_MARKET_KEYS = [
  "fg_ml",
  "fg_rl",
  "fg_total",
  "f5_ml",
  "f5_rl",
  "f5_total",
  "nrfi_yrfi",
  "k_props",
  "hr_props",
] as const;

export type MlbMarketKey = (typeof MLB_MARKET_KEYS)[number];

/** true = this market may publish. false = gated (its fields get nulled). */
export type MlbMarketGates = Record<MlbMarketKey, boolean>;

export type MlbMarketGateMode = "off" | "log" | "on";

const PARAM_PREFIX = "publish_";

/** paramName in mlb_calibration_constants for a market key. */
export function paramNameFor(key: MlbMarketKey): string {
  return `${PARAM_PREFIX}${key}`;
}

const ALL_PARAM_NAMES = MLB_MARKET_KEYS.map(paramNameFor);

/** The identity snapshot: every market publishes. Also the fail-open value. */
export function allPublished(): MlbMarketGates {
  return Object.fromEntries(
    MLB_MARKET_KEYS.map(k => [k, true])
  ) as MlbMarketGates;
}

/** Current gate mode, read from env at call time. Unset/unknown → "off". */
export function mlbMarketGateMode(): MlbMarketGateMode {
  const v = (process.env.MLB_MARKET_GATE_MODE ?? "").trim().toLowerCase();
  return v === "on" || v === "log" ? v : "off";
}

/** Does this snapshot gate anything? Lets callers skip work entirely. */
export function anyMarketGated(gates: MlbMarketGates): boolean {
  return MLB_MARKET_KEYS.some(k => gates[k] === false);
}

/**
 * Parse one `currentValue` into a publish decision, FAIL-OPEN on anything we
 * do not positively understand.
 *
 * The column is decimal(12,8) NOT NULL and drizzle hands it back as a string
 * ("0.00000000" / "1.00000000"). Only a finite number decides; null, undefined,
 * empty, whitespace, and non-numeric text all mean "we cannot read a verdict
 * here", which must never be silently rendered as a blackout.
 *
 * IMPORTANT: this must not be written as `Number.isFinite(Number(raw)) ? ... : true`.
 * Number(null) === 0 and Number("") === 0 — both finite and both below the
 * threshold — so that shape inverts the fail-open contract and gates the market
 * on exactly the malformed input it claims to tolerate.
 */
export function parsePublished(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  const s = String(raw).trim();
  if (s === "") return true;
  const n = Number(s);
  if (!Number.isFinite(n)) return true;
  // >= 0.5 rather than !== 0 so the decimal representation and any future
  // fractional value read sensibly without treating 0.0000001 as "publish".
  return n >= 0.5;
}

// ─── Snapshot cache ────────────────────────────────────────────────────────────

const SNAPSHOT_TTL_MS = 30_000;
const GATE_LOAD_TIMEOUT_MS = 1_000;

type SnapshotSource = "off" | "fresh" | "cached" | "stale" | "fail-open";

let _snapshot: MlbMarketGates | null = null;
let _loadedAt = 0;
let _inFlight: Promise<MlbMarketGates> | null = null;
let _lastError: string | null = null;
let _lastSource: SnapshotSource = "off";
let _missingParams: string[] = [];

/** Observability for the runbook — never throws, never hits the DB. */
export function getMlbMarketGateHealth(): {
  mode: MlbMarketGateMode;
  source: SnapshotSource;
  loadedAt: number | null;
  ageMs: number | null;
  lastError: string | null;
  missingParams: string[];
  gates: MlbMarketGates | null;
} {
  return {
    mode: mlbMarketGateMode(),
    source: _lastSource,
    loadedAt: _loadedAt || null,
    ageMs: _loadedAt ? Date.now() - _loadedAt : null,
    lastError: _lastError,
    missingParams: [..._missingParams],
    gates: _snapshot ? { ..._snapshot } : null,
  };
}

/** Test-only: drop cached state so each case starts clean. */
export function __resetMlbMarketGatesForTest(): void {
  _snapshot = null;
  _loadedAt = 0;
  _inFlight = null;
  _lastError = null;
  _lastSource = "off";
  _missingParams = [];
}

/**
 * Read the nine rows. Absent rows are simply not returned, so the caller's
 * merge leaves them published (fail-open when absent — the documented intent).
 */
async function loadFromDb(): Promise<Partial<MlbMarketGates>> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const rows = await db
    .select({
      paramName: mlbCalibrationConstants.paramName,
      currentValue: mlbCalibrationConstants.currentValue,
    })
    .from(mlbCalibrationConstants)
    .where(
      ALL_PARAM_NAMES.length === 1
        ? eq(mlbCalibrationConstants.paramName, ALL_PARAM_NAMES[0])
        : inArray(mlbCalibrationConstants.paramName, ALL_PARAM_NAMES)
    )
    .orderBy(mlbCalibrationConstants.paramName);

  const found: Partial<MlbMarketGates> = {};
  for (const row of rows) {
    const key = MLB_MARKET_KEYS.find(k => paramNameFor(k) === row.paramName);
    if (!key) continue;
    found[key] = parsePublished(row.currentValue);
  }
  return found;
}

function mergeOntoAllPublished(found: Partial<MlbMarketGates>): MlbMarketGates {
  const merged = allPublished();
  for (const key of MLB_MARKET_KEYS) {
    const v = found[key];
    if (typeof v === "boolean") merged[key] = v;
  }
  return merged;
}

/**
 * The snapshot every caller uses. NEVER throws, never rejects, never blocks
 * longer than GATE_LOAD_TIMEOUT_MS.
 *
 *  mode "off"  → ALL_PUBLISHED, zero database work.
 *  fresh cache → served directly.
 *  load fails  → last SUCCESSFUL snapshot at ANY age; if none has ever loaded
 *                in this process, ALL_PUBLISHED. The stale fallback is
 *                deliberately unbounded: an hours-old snapshot still reflects
 *                the owner's last intent better than reverting to all-published,
 *                and an expiry would make a long outage silently un-gate.
 */
export async function getMlbMarketGateSnapshot(): Promise<MlbMarketGates> {
  if (mlbMarketGateMode() === "off") {
    _lastSource = "off";
    return allPublished();
  }

  const now = Date.now();
  if (_snapshot && now - _loadedAt < SNAPSHOT_TTL_MS) {
    _lastSource = "cached";
    return _snapshot;
  }

  if (!_inFlight) {
    _inFlight = (async () => {
      const found = await loadFromDb();
      const merged = mergeOntoAllPublished(found);
      _snapshot = merged;
      _loadedAt = Date.now();
      _lastError = null;
      _missingParams = MLB_MARKET_KEYS.filter(
        k => typeof found[k] !== "boolean"
      ).map(paramNameFor);
      _lastSource = "fresh";
      const gatedList = MLB_MARKET_KEYS.filter(k => merged[k] === false);
      console.log(
        `[MlbMarketGates] mode=${mlbMarketGateMode()} source=fresh ` +
          `gated=[${gatedList.join(",")}] missing=[${_missingParams.join(",")}]`
      );
      return merged;
    })();
    // Detach terminal handling so a rejection here can never surface as an
    // unhandled rejection; the awaiting caller still sees it via Promise.race.
    _inFlight
      .catch(() => {})
      .finally(() => {
        _inFlight = null;
      });
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("gate load timeout")),
      GATE_LOAD_TIMEOUT_MS
    );
  });

  try {
    return await Promise.race([_inFlight, timeout]);
  } catch (err) {
    _lastError = err instanceof Error ? err.message : String(err);
    if (_snapshot) {
      _lastSource = "stale";
      console.error(
        `[MlbMarketGates][CRITICAL] load failed (${_lastError}); serving stale ` +
          `snapshot age=${Date.now() - _loadedAt}ms`
      );
      return _snapshot;
    }
    _lastSource = "fail-open";
    console.error(
      `[MlbMarketGates][CRITICAL] load failed (${_lastError}); no snapshot ever ` +
        `loaded — failing OPEN (all markets publish)`
    );
    return allPublished();
  } finally {
    if (timer) clearTimeout(timer);
  }
}
