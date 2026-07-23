/**
 * analytics.ts — client emitter for User Activity value events.
 *
 * `useAnalytics()` returns an imperative `track()` you call at the exact moment a
 * user gets value (a complete projection renders, a chat answer finishes, a
 * tracker entry saves). It is fire-and-forget and NEVER throws — analytics can't
 * break the product. It posts to the same-origin tRPC endpoint (`analytics.track`)
 * only — never to any private backend host (that hop happens server-side).
 *
 * SERVER-GATED (dormant by default): the server drops events unless the pipeline
 * is turned on (ANALYTICS_ROLE / USER_ACTIVITY_BACKEND_URL). So wiring these
 * emitters ships inert — nothing is stored until the Railway vars are set, and
 * enabling needs no client rebuild.
 */
import { useCallback } from "react";
import { trpc } from "@/lib/trpc";

export type QualifyingEventName =
  | "projection_evaluation_viewed"
  | "chat_response_completed"
  | "tracker_entry_saved";

export interface TrackOptions {
  sessionId?: string | null;
  featureId?: string;
  outcome?: string;
  props?: Record<string, string | number | boolean>;
  occurredAt?: number;
}

/** Collision-resistant idempotency key (crypto.randomUUID when available). */
export function newEventId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Stable per-tab id (sessionStorage-backed; ephemeral fallback). */
export function getTabId(): string {
  try {
    const s = (globalThis as { sessionStorage?: Storage }).sessionStorage;
    if (s) {
      const existing = s.getItem("dime_tab_id");
      if (existing) return existing;
      const id = newEventId();
      s.setItem("dime_tab_id", id);
      return id;
    }
  } catch {
    /* storage unavailable */
  }
  return newEventId();
}

export interface ClientEnvelope {
  eventId: string;
  eventName: QualifyingEventName;
  schemaVersion: number;
  occurredAtUtc: number;
  tabId: string;
  sessionId?: string | null;
  featureId?: string;
  outcome?: string;
  surface: string;
  props?: Record<string, string | number | boolean>;
}

/** Pure: build the non-authoritative client envelope (server overrides identity). */
export function buildClientEnvelope(eventName: QualifyingEventName, opts: TrackOptions = {}): ClientEnvelope {
  return {
    eventId: newEventId(),
    eventName,
    schemaVersion: 1,
    occurredAtUtc: opts.occurredAt ?? Date.now(),
    tabId: getTabId(),
    sessionId: opts.sessionId ?? null,
    surface: "web",
    ...(opts.featureId ? { featureId: opts.featureId } : {}),
    ...(opts.outcome ? { outcome: opts.outcome } : {}),
    ...(opts.props ? { props: opts.props } : {}),
  };
}

/**
 * Returns a stable `track(eventName, opts)` for value events. Fire-and-forget;
 * never throws; server-gated (inert until the pipeline is enabled).
 */
export function useAnalytics(): (eventName: QualifyingEventName, opts?: TrackOptions) => void {
  const mutation = trpc.analytics.track.useMutation({ retry: false, onError: () => { /* swallow — analytics never breaks the product */ } });
  return useCallback(
    (eventName: QualifyingEventName, opts: TrackOptions = {}) => {
      try {
        mutation.mutate(buildClientEnvelope(eventName, opts));
      } catch {
        /* fire-and-forget */
      }
    },
    [mutation],
  );
}
