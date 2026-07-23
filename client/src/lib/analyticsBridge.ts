/**
 * analyticsBridge.ts — a zero-runtime-dependency shim so bundle-critical-path
 * surfaces (DimeChatPage is direct-imported) can emit analytics WITHOUT pulling
 * the analytics/device/tRPC machinery into their chunk.
 *
 * The heavy emitter (useAnalytics, which imports deviceContext + routePattern +
 * trpc) lives only in LAZY chunks. A lazy island (SessionTracker) registers its
 * `track` here on mount; critical-path code imports ONLY `emitEvent` from this
 * file. The two type imports below are `import type` — fully erased at build —
 * so this module adds no runtime deps to whoever imports it.
 *
 * Best-effort by design: if nothing has registered yet (lazy chunk still
 * loading), `emitEvent` is a silent no-op — analytics never blocks or throws.
 * Server-side device derivation still tags every accepted event, so an event
 * that does flow through carries device_type regardless of this client block.
 */
import type { ActionName, AnalyticsEventName, TrackOptions } from "./analytics";

type EmitFn = (eventName: AnalyticsEventName, opts?: TrackOptions) => void;

let emitImpl: EmitFn | null = null;

/** A lazy analytics-capable island registers its emitter here (idempotent). */
export function registerAnalyticsEmit(fn: EmitFn): void {
  emitImpl = fn;
}

/** Clear the registration if it still points at this fn (unmount-safe). */
export function unregisterAnalyticsEmit(fn: EmitFn): void {
  if (emitImpl === fn) emitImpl = null;
}

/** Emit from critical-path code. No-op until an emitter is registered; never throws. */
export function emitEvent(eventName: AnalyticsEventName, opts?: TrackOptions): void {
  try {
    emitImpl?.(eventName, opts);
  } catch {
    /* analytics must never break the product */
  }
}

/**
 * Emit a curated `action_performed` from critical-path code (chat). Mirrors
 * `emitEvent`; no-op until an emitter is registered; never throws.
 */
export function emitAction(actionName: ActionName, opts?: Omit<TrackOptions, "actionName">): void {
  try {
    emitImpl?.("action_performed", { ...opts, actionName });
  } catch {
    /* analytics must never break the product */
  }
}
