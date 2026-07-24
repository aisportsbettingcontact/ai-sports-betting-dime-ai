/**
 * powerScore.ts — the pure, DB-free power-user scoring function (profiling P0).
 *
 * A user scores high only by earning EVERY signal — recency AND frequency AND
 * breadth AND value AND consistency AND depth — so one loud day can't fake it.
 * Kept pure (no DB, no I/O) so the scoring logic is unit-testable without a
 * database, mirroring metricDefinitions.ts. read.ts feeds it raw per-user
 * aggregates; the router ranks the results.
 *
 * P0 note: the Streak component (S) needs a gaps-and-islands SQL pass that lands
 * in P1. Until then `longestStreak` defaults to 0, so S contributes nothing and
 * scores run slightly conservative (out of ~90 rather than 100). The formula and
 * weights stay stable — P1 simply supplies a real streak.
 */

export interface PowerScoreInput {
  /** Whole days since the user's most recent event (0 = active today). */
  daysSinceLastActive: number;
  /** Distinct active days in the 30-day window. */
  activeDays: number;
  /** Distinct product surfaces touched (feed/chat/splits/tracker), 0–4. */
  distinctSurfaces: number;
  /** Value events (projection_evaluation_viewed / chat_response_completed / tracker_entry_saved). */
  valueEvents: number;
  /** action_performed events in the window. */
  actionEvents: number;
  /** Distinct sessions in the window (min 1 when any activity). */
  sessions: number;
  /** Longest consecutive active-day run (P1; defaults 0 in P0). */
  longestStreak?: number;
}

export type PowerTier = "power" | "core" | "casual" | "at_risk" | "dormant";

export interface PowerScore {
  score: number; // 0–100 (≤ ~90 in P0 until streak lands)
  tier: PowerTier;
}

/** ln(2)/7 — exponential decay giving Recency a 7-day half-life. */
const RECENCY_DECAY = Math.log(2) / 7;

/** Component weights (sum = 1.0). Documented in the profiling master plan §3.2. */
export const POWER_WEIGHTS = { R: 0.25, F: 0.2, B: 0.15, V: 0.2, S: 0.1, D: 0.1 } as const;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Map a raw score to a tier, with recency gates that OVERRIDE the score:
 * no activity in 14 days caps a user at At-Risk; 30 days is Dormant. A user
 * can't be "Power" on stale behavior no matter how loud the prior 30 days were.
 */
export function deriveTier(score: number, daysSinceLastActive: number): PowerTier {
  if (daysSinceLastActive > 30) return "dormant";
  if (daysSinceLastActive > 14) return score >= 15 ? "at_risk" : "dormant";
  if (score >= 70) return "power";
  if (score >= 50) return "core";
  if (score >= 30) return "casual";
  if (score >= 15) return "at_risk";
  return "dormant";
}

/** Compute the 0–100 power score + tier from raw per-user aggregates. Pure. */
export function computePowerScore(i: PowerScoreInput): PowerScore {
  const days = Math.max(0, i.daysSinceLastActive);
  const R = Math.exp(-RECENCY_DECAY * days);
  const F = clamp01(i.activeDays / 30);
  const B = clamp01(i.distinctSurfaces / 4);
  const V = clamp01(Math.log1p(Math.max(0, i.valueEvents)) / Math.log(61)); // log-damped, cap ≈ 60
  const S = clamp01((i.longestStreak ?? 0) / 14);
  const D = clamp01(i.actionEvents / Math.max(1, i.sessions) / 12);

  const raw =
    100 *
    (POWER_WEIGHTS.R * R +
      POWER_WEIGHTS.F * F +
      POWER_WEIGHTS.B * B +
      POWER_WEIGHTS.V * V +
      POWER_WEIGHTS.S * S +
      POWER_WEIGHTS.D * D);

  const score = Math.round(raw);
  return { score, tier: deriveTier(score, days) };
}
