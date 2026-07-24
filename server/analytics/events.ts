/**
 * events.ts — the allowlist of qualifying value events + the validated client
 * input contract. Only these past-tense events count; unknown names are rejected
 * (owner directive §6/§7). The client supplies non-authoritative fields only;
 * the server overrides identity / received_at / environment / is_test.
 */
import { z } from "zod";

/** Value-bearing events that qualify a user as "active". */
export const QUALIFYING_EVENTS = [
  "projection_evaluation_viewed",
  "chat_response_completed",
  "tracker_entry_saved",
] as const;
export type QualifyingEvent = (typeof QUALIFYING_EVENTS)[number];

/** Engagement/diagnostic events — NEVER qualify a user as active (P0 set). */
export const ENGAGEMENT_EVENTS = ["session_started", "screen_viewed", "login"] as const;
export type EngagementEvent = (typeof ENGAGEMENT_EVENTS)[number];

/**
 * Curated action allowlist (D3 / §4 of EVENT-CATALOG). Only these named actions
 * are accepted on `action_performed`; any other action_name is rejected. Fixed
 * enum — no free text, no wager amounts, no PII. Diagnostic only (never active).
 */
export const ACTION_ALLOWLIST = [
  "chat_message_sent",
  "chat_started",
  "chat_starred",
  "chat_deleted",
  "projection_opened",
  "projection_favorited",
  "feed_filtered",
  "feed_sport_switched",
  "feed_date_navigated",
  "splits_sorted",
  "splits_filtered",
  "splits_date_navigated",
  "splits_sport_switched",
  "bet_edited",
  "bet_deleted",
  "pane_switched",
  "search_performed",
  // D3.1 (profiling P0): model-trust + referral signals.
  "results_viewed",
  "referral_landed",
] as const;
export type ActionName = (typeof ACTION_ALLOWLIST)[number];

/** Feature-lifecycle events (D3) — diagnostic, never qualify a user as active. */
export const FEATURE_EVENTS = ["feature_opened", "feature_completed", "feature_failed"] as const;
export type FeatureEvent = (typeof FEATURE_EVENTS)[number];

/** D3 event names: the generic action carrier + the feature lifecycle. Non-qualifying. */
export const ACTION_EVENTS = ["action_performed", ...FEATURE_EVENTS] as const;
export type ActionEvent = (typeof ACTION_EVENTS)[number];

/** Every accepted event name. */
export const ALL_EVENTS = [...QUALIFYING_EVENTS, ...ENGAGEMENT_EVENTS, ...ACTION_EVENTS] as const;
export type AnalyticsEventName = (typeof ALL_EVENTS)[number];

const QUALIFYING_SET: ReadonlySet<string> = new Set(QUALIFYING_EVENTS);
/** Server-authoritative: does this event count toward the value-based active metric? */
export function qualifiesActive(name: string): boolean {
  return QUALIFYING_SET.has(name);
}

/** Client-supplied envelope (non-authoritative). Server adds/overrides the rest. */
export const trackInputSchema = z.object({
  eventId: z.string().min(8).max(64),
  eventName: z.enum(ALL_EVENTS),
  schemaVersion: z.number().int().min(1).max(1000),
  occurredAtUtc: z.number().int().positive(),
  sessionId: z.string().max(64).nullish(),
  tabId: z.string().max(64).nullish(),
  featureId: z.string().max(64).nullish(),
  surface: z.string().max(32).default("web"),
  outcome: z.string().max(32).nullish(),
  // Low-cardinality route PATTERN only — never a concrete URL with ids.
  route: z.string().max(96).nullish(),
  // Curated action name — required (and only meaningful) for `action_performed`.
  actionName: z.enum(ACTION_ALLOWLIST).nullish(),
  // Coarse client device block (server derives the authoritative device_type).
  viewportClass: z.enum(["xs", "sm", "md", "lg", "xl"]).nullish(),
  orientation: z.enum(["portrait", "landscape"]).nullish(),
  isTouch: z.boolean().nullish(),
  pointerType: z.enum(["fine", "coarse", "none"]).nullish(),
  isStandalone: z.boolean().nullish(),
  connectionClass: z.enum(["slow-2g", "2g", "3g", "4g", "unknown"]).nullish(),
  appSurface: z.enum(["web-desktop-shell", "web-mobile-shell", "web-responsive"]).nullish(),
  props: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).nullish(),
}).refine(
  // `action_performed` carries no meaning without a curated action_name.
  (v) => v.eventName !== "action_performed" || v.actionName != null,
  { message: "actionName is required when eventName is 'action_performed'", path: ["actionName"] },
);
export type TrackInput = z.infer<typeof trackInputSchema>;

const MAX_PROPS = 20;
const MAX_PROP_LEN = 256;

/**
 * Bound the props object: cap count + string length, keep scalars only.
 * Never stores raw text/PII — callers must only pass allowlisted scalar props.
 */
export function sanitizeProps(
  props: TrackInput["props"],
): Record<string, string | number | boolean> | null {
  if (!props) return null;
  const out: Record<string, string | number | boolean> = {};
  let n = 0;
  for (const [k, v] of Object.entries(props)) {
    if (n >= MAX_PROPS) break;
    if (typeof v === "string") out[k] = v.slice(0, MAX_PROP_LEN);
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else continue;
    n++;
  }
  return Object.keys(out).length ? out : null;
}
