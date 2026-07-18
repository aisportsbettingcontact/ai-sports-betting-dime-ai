import { TrendingUp, Eye, Minus } from "lucide-react";
import type { MarketInsight, Recommendation } from "@/lib/gameInsight";
import "./EdgeIndicator.css";

/**
 * EdgeIndicator — the projections card's dominant model signal (Law v3).
 *
 * Renders the single strongest opportunity from `primaryInsight()` as an
 * accessible mint CELL: tinted surface + mint border + high-contrast foreground,
 * with an icon AND a text label so the meaning never depends on color alone
 * (WCAG 1.4.1). Every value is derived from the decision engine — nothing here
 * invents confidence or styling-based labels.
 */

const REC_META: Record<
  Exclude<Recommendation, "NO_EDGE">,
  { label: string; Icon: typeof TrendingUp }
> = {
  BET: { label: "Bet", Icon: TrendingUp },
  WATCH: { label: "Watch", Icon: Eye },
};

/** Format a probability edge (percentage points) as a signed, 1-decimal string. */
export function formatEdge(edgePP: number): string {
  if (!Number.isFinite(edgePP)) return "—";
  const sign = edgePP >= 0 ? "+" : "−"; // real minus, not hyphen
  return `${sign}${Math.abs(edgePP).toFixed(1)}%`;
}

export interface EdgeIndicatorProps {
  insight: MarketInsight | null;
  className?: string;
}

export function EdgeIndicator({ insight, className }: EdgeIndicatorProps) {
  // No actionable edge → quiet, flat, non-mint (mint is reserved for signal).
  if (!insight || insight.recommendation === "NO_EDGE") {
    return (
      <div
        className={`edge-indicator--none${className ? ` ${className}` : ""}`}
        role="group"
        aria-label="No edge on this game"
      >
        <Minus size={14} aria-hidden="true" />
        <span>No edge</span>
      </div>
    );
  }

  const { label, Icon } = REC_META[insight.recommendation];
  const edge = formatEdge(insight.edgePP);

  return (
    <div
      className={`edge-indicator${className ? ` ${className}` : ""}`}
      data-rec={insight.recommendation}
      role="group"
      aria-label={`${label}: ${insight.sideLabel}, edge ${edge}, best price ${insight.bookPrice}`}
    >
      <Icon size={14} aria-hidden="true" style={{ color: "var(--brand-mint-foreground)" }} />
      <span className="edge-indicator__label">Edge</span>
      <strong className="edge-indicator__value">{edge}</strong>
    </div>
  );
}
