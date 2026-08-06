import { TrendingUp } from "lucide-react";
import type { MarketInsight } from "@/lib/gameInsight";
import "./EdgeIndicator.css";

/**
 * EdgeIndicator — the projections card's dominant model signal (Law v3).
 *
 * Renders the single strongest opportunity from `primaryInsight()` as an
 * accessible mint CELL: tinted surface + mint border + high-contrast foreground,
 * with an icon AND a text label so the meaning never depends on color alone
 * (WCAG 1.4.1). Every value is derived from the decision engine — nothing here
 * invents confidence or styling-based labels. One badge, one glyph: an
 * actionable edge renders identically regardless of the engine's BET/WATCH
 * classification (owner ruling 2026-07-31 — the split presentation is gone).
 */

/** Format a probability edge (percentage points) as a signed, 1-decimal string. */
export function formatEdge(edgePP: number): string {
  if (!Number.isFinite(edgePP)) return "—";
  const sign = edgePP >= 0 ? "+" : "−"; // real minus, not hyphen
  return `${sign}${Math.abs(edgePP).toFixed(1)}%`;
}

/** Canonical no-vig ROI, already expressed in percentage points. */
export function formatRoi(roiPct: number | null): string {
  if (roiPct == null || !Number.isFinite(roiPct)) return "—";
  const sign = roiPct >= 0 ? "+" : "−";
  return `${sign}${Math.abs(roiPct).toFixed(1)}%`;
}

export interface EdgeIndicatorProps {
  insight: MarketInsight | null;
  className?: string;
}

export function EdgeIndicator({ insight, className }: EdgeIndicatorProps) {
  // With no scorable market there is no ROI to visualize; the summary's
  // unavailable-data sentence already explains that state.
  if (!insight) return null;

  // No actionable edge → ROI only, quiet, flat, and neutral. The accessible
  // name retains the status without repeating "No edge" in the visual badge.
  if (insight.recommendation === "NO_EDGE") {
    const roi = formatRoi(insight.roiPct);
    return (
      <div
        className={`edge-indicator--none${className ? ` ${className}` : ""}`}
        role="group"
        aria-label={`No actionable edge: ${insight.sideLabel}; no-vig ROI ${roi}`}
      >
        <strong className="edge-indicator__roi">ROI {roi}</strong>
      </div>
    );
  }

  const edge = formatEdge(insight.edgePP);

  return (
    <div
      className={`edge-indicator${className ? ` ${className}` : ""}`}
      role="group"
      aria-label={`Edge: ${insight.sideLabel}, ${edge}, best price ${insight.bookPrice}`}
    >
      <TrendingUp size={14} aria-hidden="true" />{/* color owned by EdgeIndicator.css — no inline style, so PASS neutralization needs no !important */}
      <span className="edge-indicator__label">Edge</span>
      <strong className="edge-indicator__value">{edge}</strong>
    </div>
  );
}
