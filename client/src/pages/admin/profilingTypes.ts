/**
 * profilingTypes.ts — client-side mirror of the server analytics profiling shapes
 * (server/analytics/read.ts) plus shared labels/helpers for the Customer
 * Profiling Cockpit panels. The tRPC `analytics.overview` output is structurally
 * identical, so panels type their props/rows against these.
 */
import type { CSSProperties } from "react";

export interface SegmentSlice {
  key: string;
  label: string;
  users: number;
}

export interface FunnelStage {
  key: string;
  label: string;
  users: number;
}

export interface FeatureScore {
  surface: string;
  adoption: number;
  engagement: number;
  stickiness: number | null;
  valueLinkage: number;
  composite: number;
  verdict: "keep" | "invest" | "fix" | "cut";
}

export interface RetentionCohort {
  cohortWeek: string;
  size: number;
  retention: Array<number | null>;
}

export interface UserProfileRow {
  sourceUserId: number;
  score: number;
  tier: string;
  segment: string;
  valueEvents: number;
  actionEvents: number;
  activeDays: number;
  distinctSurfaces: number;
  sessions: number;
  lastActive: number;
  username: string | null;
  discordUsername: string | null;
  role: string | null;
}

export const TIER_LABEL: Record<string, string> = {
  power: "Power",
  core: "Core",
  casual: "Casual",
  at_risk: "At-Risk",
  dormant: "Dormant",
};

/** Mint for the engaged tiers, foreground/muted as engagement cools. */
export const TIER_CLASS: Record<string, string> = {
  power: "text-primary",
  core: "text-primary",
  casual: "text-foreground",
  at_risk: "text-muted-foreground",
  dormant: "text-muted-foreground",
};

export const SEGMENT_LABEL: Record<string, string> = {
  whale: "Whale / Power",
  model_truster: "Model-Truster",
  chat_native: "Chat-Native",
  tracker_diligent: "Tracker-Diligent",
  splits_scanner: "Splits-Scanner",
  casual: "Casual Dabbler",
  lurker_at_risk: "Lurker / At-Risk",
};

export const SURFACE_LABEL: Record<string, string> = {
  feed: "Feed",
  chat: "Chat",
  splits: "Splits",
  tracker: "Tracker",
};

export const VERDICT_LABEL: Record<string, string> = {
  keep: "KEEP",
  invest: "INVEST",
  fix: "FIX",
  cut: "CUT",
};

/** Display name for a profiling row (Discord handle → username → pseudonymous id). */
export function displayName(u: UserProfileRow): string {
  return u.discordUsername || u.username || `user #${u.sourceUserId}`;
}

/** Compact relative age from a ms timestamp. */
export function fmtAgo(ts: number): string {
  if (!ts) return "—";
  const s = Math.max(0, Date.now() - ts) / 1000;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/**
 * Quantized mint-opacity heat (Dime: single-hue ramp, never rainbow). Returns an
 * inline style + whether the numeral should flip dark for contrast on high steps.
 * value is 0–100 (or null = not measured).
 */
export function heatStyle(value: number | null): { style: CSSProperties; darkText: boolean; measured: boolean } {
  if (value == null) return { style: { background: "transparent" }, darkText: false, measured: false };
  const v = Math.max(0, Math.min(100, value));
  let alpha = 0;
  if (v <= 20) alpha = 0;
  else if (v <= 40) alpha = 0.14;
  else if (v <= 60) alpha = 0.28;
  else if (v <= 80) alpha = 0.46;
  else alpha = 0.7;
  return {
    style: { background: alpha === 0 ? "transparent" : `rgba(69,224,168,${alpha})` },
    darkText: alpha >= 0.46,
    measured: true,
  };
}
