/**
 * mlbModelIdentity.ts — model-version attribution for MLB projections (gap G1).
 *
 * The production engine (server/MLBAIModel.py) has no version constant, and the
 * drift detector recalibrates by patching that file's constants in place. That
 * makes the FILE CONTENT the true parameter identity: any recalibration changes
 * the bytes, so a sha-256 of the engine source is a faithful, zero-maintenance
 * params fingerprint. Pair it with a human-legible MLB_MODEL_VERSION that is
 * bumped only on structural engine changes (new markets, new simulation core).
 *
 * Every projection write (mlbModelRunner) and every grading row
 * (mlbMultiMarketBacktest) stamps both, so "did the last recalibration help?"
 * becomes a GROUP BY, not archaeology.
 *
 * Pure hashing is exported separately from the file-reading wrapper so tests
 * never depend on the real engine file.
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const TAG = "[ModelIdentity]";

/** Bump ONLY on structural engine changes; recalibrations are captured by the hash. */
export const MLB_MODEL_VERSION = "mlb-mc-v1";

/** Emission-format version for the integrity fields written by the grader. */
export const BACKTEST_INTEGRITY_VERSION = "integrity-v1";

export const UNKNOWN_PARAMS_HASH = "unknown";

/** Pure: fingerprint an engine source text. 16 hex chars — enough to key runs, short enough for logs. */
export function hashEngineSource(source: string): string {
  return createHash("sha256").update(source, "utf8").digest("hex").slice(0, 16);
}

const ENGINE_PATH = path.join(import.meta.dirname, "MLBAIModel.py");

interface HashCache {
  mtimeMs: number;
  hash: string;
}
let cache: HashCache | null = null;
let warnedUnreadable = false;

/**
 * Current params fingerprint of the deployed engine file, cached by mtime so a
 * drift-detector patch (which rewrites the file) is picked up on the next call.
 * Unreadable engine → "unknown" (logged once): attribution degrades loudly,
 * never blocks grading.
 */
export function currentModelParamsHash(enginePath: string = ENGINE_PATH): string {
  try {
    const { mtimeMs } = statSync(enginePath);
    if (cache && cache.mtimeMs === mtimeMs) return cache.hash;
    const hash = hashEngineSource(readFileSync(enginePath, "utf8"));
    if (cache && cache.hash !== hash) {
      console.log(
        `${TAG} [STATE] engine params changed: ${cache.hash} → ${hash} (mtime ${new Date(mtimeMs).toISOString()}) — recalibration or deploy detected`,
      );
    }
    cache = { mtimeMs, hash };
    return hash;
  } catch (err) {
    if (!warnedUnreadable) {
      warnedUnreadable = true;
      console.warn(
        `${TAG} [WARN] cannot read engine at ${enginePath}: ${err instanceof Error ? err.message : err} — paramsHash='${UNKNOWN_PARAMS_HASH}' until resolved`,
      );
    }
    return UNKNOWN_PARAMS_HASH;
  }
}

export interface ModelIdentity {
  modelVersion: string;
  modelParamsHash: string;
}

export function currentModelIdentity(enginePath?: string): ModelIdentity {
  return {
    modelVersion: MLB_MODEL_VERSION,
    modelParamsHash: currentModelParamsHash(enginePath),
  };
}

/** Test hook. */
export function clearModelIdentityCache(): void {
  cache = null;
  warnedUnreadable = false;
}
