/**
 * staleChunkReload.ts — recover from a stale code-split chunk after a deploy.
 *
 * WHY (2026-07-31 production incident):
 * Vite content-hashes every route chunk, and a deploy replaces those filenames
 * wholesale. Any browser that loaded the app BEFORE the deploy still holds the
 * OLD names, so the next lazy route import requests a chunk that no longer
 * exists and fails with:
 *
 *   TypeError: Failed to fetch dynamically imported module: /assets/Home-<hash>.js
 *
 * Nothing was broken in the app — the client is simply a version behind. The
 * correct recovery is to reload: index.html is served `no-store`, so a reload
 * always fetches the new document and therefore the new chunk names.
 *
 * The danger is a reload LOOP. If the chunk is missing for any other reason
 * (a bad deploy, a CDN hole, an actually-removed file), reloading would spin
 * forever and the user would never see an error. So the reload is attempted at
 * most once per short window, recorded in sessionStorage: the first failure
 * self-heals silently, a second failure inside the window falls through to the
 * error boundary and is shown honestly.
 */

const RELOAD_KEY = "dime:staleChunkReloadAt";
/** A genuine post-deploy recovery happens immediately; anything later is a real fault. */
const RELOAD_WINDOW_MS = 30_000;

/** Message shapes browsers use when a dynamic import cannot be fetched or parsed. */
const STALE_CHUNK_PATTERNS: readonly RegExp[] = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,          // Safari
  // The asset fell through to the SPA shell and came back as HTML. Chrome and
  // Firefox word this differently, and this is the single most likely message
  // for the exact bug this guards, so match both shapes.
  /mime type of ["']?text\/html/i,
  /is not a valid javascript mime type/i,
  /strict mime type checking/i,
  /unexpected token '<'/i,                      // HTML parsed as JS
];

export function isStaleChunkError(error: unknown): boolean {
  const message =
    error instanceof Error ? `${error.message}` :
    typeof error === "string" ? error :
    error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) :
    "";
  if (!message) return false;
  return STALE_CHUNK_PATTERNS.some((re) => re.test(message));
}

/** True when a recovery reload already happened inside the guard window. */
export function reloadAlreadyAttempted(now: number = Date.now(), storage: Storage | undefined = safeSessionStorage()): boolean {
  if (!storage) return false;
  const raw = storage.getItem(RELOAD_KEY);
  if (!raw) return false;
  const at = Number(raw);
  if (!Number.isFinite(at)) return false;
  return now - at < RELOAD_WINDOW_MS;
}

function safeSessionStorage(): Storage | undefined {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : undefined;
  } catch {
    // Safari private mode throws on access.
    return undefined;
  }
}

/**
 * Reload once to pick up the new build. Returns true when a reload was issued,
 * false when the guard suppressed it (so the caller should surface the error).
 */
export function attemptStaleChunkReload(now: number = Date.now()): boolean {
  const storage = safeSessionStorage();
  if (reloadAlreadyAttempted(now, storage)) {
    console.error("[StaleChunk] reload already attempted — surfacing the error instead of looping");
    return false;
  }
  try {
    storage?.setItem(RELOAD_KEY, String(now));
  } catch {
    /* storage unavailable — still reload once; the window guard just won't persist */
  }
  console.warn("[StaleChunk] stale build chunk detected — reloading to pick up the current deploy");
  if (typeof window !== "undefined") window.location.reload();
  return true;
}

/**
 * Install global listeners. Vite fires `vite:preloadError` for failed chunk
 * preloads; unhandled rejections catch the dynamic import itself.
 */
export function installStaleChunkRecovery(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("vite:preloadError", (event) => {
    const payload = (event as unknown as { payload?: unknown }).payload;
    if (attemptStaleChunkReload()) event.preventDefault();
    else console.error("[StaleChunk] vite:preloadError not recovered", payload);
  });

  window.addEventListener("unhandledrejection", (event) => {
    if (isStaleChunkError(event.reason)) attemptStaleChunkReload();
  });
}
