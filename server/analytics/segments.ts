/**
 * segments.ts — pure, DB-free classification of a user into a behavioral segment
 * (profiling P1). read.ts feeds it per-user facts; the router/UI count and render.
 *
 * Thresholds are STARTER values tuned for the 30-day aggregation window and are
 * meant to be adjusted against the real distribution — the classifier's job is
 * the mechanism (priority-ordered rules over observable signals), not final
 * calibration. Every rule reads only from events we already record.
 */

export interface UserFacts {
  /** Whole days since the user's most recent event. */
  daysSinceLastActive: number;
  /** Distinct active days in the 30-day window. */
  activeDays: number;
  /** Distinct surfaces touched (feed/chat/splits/tracker), 0–4. */
  distinctSurfaces: number;
  /** Value events in the window. */
  valueEvents: number;
  /** action_performed events in the window. */
  actionEvents: number;
  /** Distinct sessions in the window. */
  sessions: number;
  /** Feed-surface actions (projection_* / feed_*). */
  feedActions: number;
  /** Chat-surface actions (chat_*). */
  chatActions: number;
  /** Splits-surface actions (splits_*). */
  splitsActions: number;
  /** tracker_entry_saved count. */
  trackerValue: number;
}

export type SegmentKey =
  | "whale"
  | "model_truster"
  | "chat_native"
  | "tracker_diligent"
  | "splits_scanner"
  | "casual"
  | "lurker_at_risk";

export const SEGMENT_LABELS: Record<SegmentKey, string> = {
  whale: "Whale / Power",
  model_truster: "Model-Truster",
  chat_native: "Chat-Native",
  tracker_diligent: "Tracker-Diligent",
  splits_scanner: "Splits-Scanner",
  casual: "Casual Dabbler",
  lurker_at_risk: "Lurker / At-Risk",
};

/** Stable display order (strongest → weakest engagement). */
export const SEGMENT_ORDER: SegmentKey[] = [
  "whale",
  "model_truster",
  "chat_native",
  "tracker_diligent",
  "splits_scanner",
  "casual",
  "lurker_at_risk",
];

/**
 * Assign a single segment by priority-ordered rules. First match wins, so the
 * order encodes precedence (a lapsed whale reads as At-Risk, a committed logger
 * as Tracker-Diligent before Casual, etc.).
 */
export function classifySegment(f: UserFacts): SegmentKey {
  // Lapsed or empty first — a stale/no-value account is never a "power" anything.
  if (f.daysSinceLastActive > 14) return "lurker_at_risk";
  if (f.valueEvents === 0 && f.actionEvents <= 1 && f.sessions > 0) return "lurker_at_risk";

  // Power: broad + valuable + frequent.
  if (f.distinctSurfaces >= 3 && f.valueEvents >= 8 && f.activeDays >= 6) return "whale";

  // Splits consumer who never commits.
  if (f.splitsActions >= 6 && f.valueEvents === 0) return "splits_scanner";

  // Diligent logger.
  if (f.trackerValue >= 3) return "tracker_diligent";

  // Pane-dominant archetypes.
  if (f.chatActions >= 10 && f.feedActions < 3) return "chat_native";
  if (f.feedActions >= 8 && f.chatActions < 3) return "model_truster";

  // Any real value but no dominant pattern.
  if (f.valueEvents >= 1) return "casual";

  // Activity without value.
  return "lurker_at_risk";
}
