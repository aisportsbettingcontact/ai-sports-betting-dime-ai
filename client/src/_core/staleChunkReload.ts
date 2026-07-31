/**
 * staleChunkReload.ts — recover from a stale code-split chunk after a deploy.
 *
 * WHY (2026-07-31 production incident): Vite content-hashes every route chunk,
 * and a deploy replaces those filenames wholesale. A browser that loaded the app
 * BEFORE the deploy still holds the OLD names, so its next lazy route import
 * requests a chunk that no longer exists and throws "Failed to fetch dynamically
 * imported module". Nothing is broken — the client is one version behind, and
 * index.html is served no-store, so a reload always picks up the new names.
 *
 * The danger is a reload LOOP: if the chunk is missing for a real reason (bad
 * deploy, CDN hole), reloading forever would hide the fault. So recovery is
 * attempted at most once per window; a second failure falls through to the error
 * boundary and is shown honestly.
 *
 * Kept deliberately small — this ships in the critical-path bundle, which is
 * budget-gated by scripts/check-bundle-budget.mjs.
 */

const KEY = "dime:staleChunkReloadAt";
const WINDOW_MS = 30_000;

/**
 * Message shapes browsers use when a dynamic import cannot be fetched or parsed.
 * The MIME variants matter most: they are what a chunk request answered with the
 * SPA shell (HTML) produces, which is exactly this incident.
 */
const STALE =
  /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|mime type of ["']?text\/html|not a valid javascript mime type|strict mime type checking|unexpected token '</i;

function store(): Storage | undefined {
  // Safari private mode throws on access.
  try { return typeof window !== "undefined" ? window.sessionStorage : undefined; } catch { return undefined; }
}

export function isStaleChunkError(error: unknown): boolean {
  const m =
    error instanceof Error ? error.message
    : typeof error === "string" ? error
    : error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message)
    : "";
  return m ? STALE.test(m) : false;
}

/** True when a recovery reload already happened inside the guard window. */
export function reloadAlreadyAttempted(now: number = Date.now(), s: Storage | undefined = store()): boolean {
  const at = Number(s?.getItem(KEY));
  return Number.isFinite(at) && at > 0 && now - at < WINDOW_MS;
}

/** Reload once to pick up the new build. False = suppressed, so surface the error. */
export function attemptStaleChunkReload(now: number = Date.now()): boolean {
  if (reloadAlreadyAttempted(now)) {
    console.error("[StaleChunk] already reloaded — surfacing error");
    return false;
  }
  try { store()?.setItem(KEY, String(now)); } catch { /* storage unavailable; still reload once */ }
  console.warn("[StaleChunk] stale build chunk — reloading");
  if (typeof window !== "undefined") window.location.reload();
  return true;
}

/** Vite fires `vite:preloadError` for failed chunk preloads; rejections catch the import itself. */
export function installStaleChunkRecovery(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", (e) => { if (attemptStaleChunkReload()) e.preventDefault(); });
  window.addEventListener("unhandledrejection", (e) => { if (isStaleChunkError(e.reason)) attemptStaleChunkReload(); });
}
