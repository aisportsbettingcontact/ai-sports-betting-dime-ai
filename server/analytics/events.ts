/**
 * events.ts — the allowlist of qualifying value events + the validated client
 * input contract. Only these past-tense events count; unknown names are rejected
 * (owner directive §6/§7). The client supplies non-authoritative fields only;
 * the server overrides identity / received_at / environment / is_test.
 */
import { z } from "zod";

/** Value-bearing events that qualify a user as "active". Verify vs product before freezing. */
export const QUALIFYING_EVENTS = [
  "projection_evaluation_viewed",
  "chat_response_completed",
  "tracker_entry_saved",
] as const;
export type QualifyingEvent = (typeof QUALIFYING_EVENTS)[number];

/** Client-supplied envelope (non-authoritative). Server adds/overrides the rest. */
export const trackInputSchema = z.object({
  eventId: z.string().min(8).max(64),
  eventName: z.enum(QUALIFYING_EVENTS),
  schemaVersion: z.number().int().min(1).max(1000),
  occurredAtUtc: z.number().int().positive(),
  sessionId: z.string().max(64).nullish(),
  tabId: z.string().max(64).nullish(),
  featureId: z.string().max(64).nullish(),
  surface: z.string().max(32).default("web"),
  outcome: z.string().max(32).nullish(),
  props: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).nullish(),
});
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
