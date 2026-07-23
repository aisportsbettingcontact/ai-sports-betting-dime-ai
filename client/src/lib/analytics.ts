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
import { buildClientDeviceContext, type ClientDeviceContext } from "@/lib/deviceContext";
import { toRoutePattern } from "@/lib/routePattern";

export type QualifyingEventName =
  | "projection_evaluation_viewed"
  | "chat_response_completed"
  | "tracker_entry_saved";

/**
 * Curated action allowlist — MUST mirror ACTION_ALLOWLIST in server/analytics/events.ts.
 * The server rejects any action_name outside this set, so keep the two in sync.
 */
export type ActionName =
  | "chat_message_sent"
  | "chat_started"
  | "chat_starred"
  | "chat_deleted"
  | "projection_opened"
  | "projection_favorited"
  | "feed_filtered"
  | "feed_sport_switched"
  | "feed_date_navigated"
  | "splits_sorted"
  | "splits_filtered"
  | "splits_date_navigated"
  | "splits_sport_switched"
  | "bet_edited"
  | "bet_deleted"
  | "pane_switched"
  | "search_performed";
export type FeatureEventName = "feature_opened" | "feature_completed" | "feature_failed";
export type AnalyticsEventName =
  | QualifyingEventName
  | "session_started"
  | "screen_viewed"
  | "action_performed"
  | FeatureEventName;

export interface TrackOptions {
  sessionId?: string | null;
  featureId?: string;
  outcome?: string;
  props?: Record<string, string | number | boolean>;
  occurredAt?: number;
  route?: string;
  /** Curated action name — only meaningful for the `action_performed` event. */
  actionName?: ActionName;
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

export interface ClientEnvelope extends ClientDeviceContext {
  eventId: string;
  eventName: AnalyticsEventName;
  schemaVersion: number;
  occurredAtUtc: number;
  tabId: string;
  sessionId?: string | null;
  featureId?: string;
  outcome?: string;
  actionName?: ActionName;
  surface: string;
  route: string;
  props?: Record<string, string | number | boolean>;
}

/** Pure: build the non-authoritative client envelope (server overrides identity). */
export function buildClientEnvelope(eventName: AnalyticsEventName, opts: TrackOptions = {}): ClientEnvelope {
  const device = buildClientDeviceContext();
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  return {
    ...device,
    eventId: newEventId(),
    eventName,
    schemaVersion: 1,
    occurredAtUtc: opts.occurredAt ?? Date.now(),
    tabId: getTabId(),
    sessionId: opts.sessionId ?? null,
    surface: "web",
    route: opts.route ?? toRoutePattern(pathname),
    ...(opts.featureId ? { featureId: opts.featureId } : {}),
    ...(opts.outcome ? { outcome: opts.outcome } : {}),
    ...(opts.actionName ? { actionName: opts.actionName } : {}),
    ...(opts.props ? { props: opts.props } : {}),
  };
}

/**
 * Returns a stable `track(eventName, opts)` for value events. Fire-and-forget;
 * never throws; server-gated (inert until the pipeline is enabled).
 */
export function useAnalytics(): (eventName: AnalyticsEventName, opts?: TrackOptions) => void {
  const mutation = trpc.analytics.track.useMutation({ retry: false, onError: () => { /* swallow — analytics never breaks the product */ } });
  // Depend on the stable `mutate` (not the whole mutation object, which is a new
  // ref each render) so `track` keeps a stable identity and consumer effects
  // don't re-run on every render.
  const mutate = mutation.mutate;
  return useCallback(
    (eventName: AnalyticsEventName, opts: TrackOptions = {}) => {
      try {
        mutate(buildClientEnvelope(eventName, opts));
      } catch {
        /* fire-and-forget */
      }
    },
    [mutate],
  );
}

/**
 * Returns a stable `trackAction(actionName, opts)` — a thin wrapper over
 * `useAnalytics` that emits the curated `action_performed` event. Fire-and-forget;
 * server-gated (inert until the pipeline is enabled). Use at real user-action
 * points on LAZY surfaces (feed/splits/tracker); critical-path chat uses the
 * bridge's `emitAction` instead so this module stays out of the chat chunk.
 */
export function useTrackAction(): (actionName: ActionName, opts?: Omit<TrackOptions, "actionName">) => void {
  const track = useAnalytics();
  return useCallback(
    (actionName: ActionName, opts: Omit<TrackOptions, "actionName"> = {}) => {
      track("action_performed", { ...opts, actionName });
    },
    [track],
  );
}
