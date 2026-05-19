/**
 * BetTrackerAnalytics.tsx — Bloomberg Terminal × DraftKings quant analytics
 *
 * Design language:
 *   - #0d0f0e base, #141614 cards, #1a1f1a hover
 *   - #39FF14 neon green for wins/positives
 *   - #FF3B3B loss red for negatives
 *   - JetBrains Mono for all numbers
 *   - Barlow Condensed for section headers
 *   - Sharp corners (max 6px radius)
 *   - 150ms transitions
 *
 * Components:
 *   EquityChart         — Canvas-based cumulative P/L curve with hover tooltip
 *   BreakdownPanel      — Single breakdown dimension with dual-sided bars
 *   BreakdownGrid       — All breakdown panels in a responsive grid
 *   HandicapperSelector — Owner/Admin dropdown to switch between handicappers
 */

import { useEffect, useRef, useState, useCallback, memo } from "react";
import { BarChart2, Activity, Users, ChevronDown } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type EquityPoint = {
  date: string;
  cumPL: number;
  betId: number;
  /** pick string — human-readable pick label e.g. "NYY ML" */
  label: string;
  /** Legacy alias — same as label, kept for backward compat */
  pick?: string;
  result: string;
  pl: number;
  odds?: number;
  units?: number;
  isSpecial?: boolean;
};

export type BreakdownEntry = {
  key: string;
  wins: number;
  losses: number;
  pushes: number;
  totalRisk: number;
  netProfit: number;
  roi: number;
  dollarNetProfit?: number;
};

export type StatsData = {
  totalBets: number;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  voids?: number;
  gradedBets?: number;
  totalRisk: number;
  totalWon?: number;
  totalLost?: number;
  netProfit: number;
  roi: number;
  bestWin?: number;
  worstLoss?: number;
  biggestDayDate?: string;
  biggestDayUnits?: number;
  longestWinStreak?: number;
  byType: BreakdownEntry[];
  bySize: BreakdownEntry[];
  byMonth: BreakdownEntry[];
  bySport: BreakdownEntry[];
  byResult?: BreakdownEntry[];
  byTimeframe: BreakdownEntry[];
  equityCurve: EquityPoint[];
  dollarNetProfit?: number;
  // Winning ticket stats
  maxDrawdown?: number;
  currentRunUnits?: number;
  currentRunSince?: string;
  ath?: number;
  worstDayDate?: string;
  worstDayUnits?: number;
};

// ─── Design tokens ────────────────────────────────────────────────────────────

const T = {
  base:      "#0d0f0e",
  card:      "#141614",
  hover:     "#1a1f1a",
  border:    "#1e231e",
  border2:   "#2a2a2a",
  green:     "#39FF14",
  red:       "#FF3B3B",
  dim:       "#3a4a3a",
  dimmer:    "#2a3a2a",
  text:      "#d0d0d0",
  textMuted: "#888",
  mono:      "'JetBrains Mono', 'Courier New', monospace",
  sans:      "'Barlow Condensed', sans-serif",
} as const;

// ─── EquityChart ──────────────────────────────────────────────────────────────

function EquityChartInner({ points, stats }: { points: EquityPoint[]; stats?: StatsData }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [tooltip, setTooltip] = useState<{
    x: number;
    dotY: number;
    point: EquityPoint;
    flipLeft: boolean;
  } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = entry.contentRect.width;
      const ratio = w < 400 ? 0.70 : w < 900 ? 0.40 : 0.30;
      const h = Math.round(Math.min(380, Math.max(200, w * ratio)));
      setDims({ w, h });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dims.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = dims.w * dpr;
    canvas.height = dims.h * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const W = dims.w, H = dims.h;
    // PAD_LEFT=64 for emotional y-axis labels, PAD_BOTTOM=44 for x-axis dates
    const PAD_LEFT = 64, PAD_RIGHT = 20, PAD_TOP = 24, PAD_BOTTOM = 44;
    const chartW = W - PAD_LEFT - PAD_RIGHT;
    const chartH = H - PAD_TOP - PAD_BOTTOM;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0d0f0e";
    ctx.fillRect(0, 0, W, H);

    if (points.length === 0) return;

    const values = points.map(p => p.cumPL);
    const minV = Math.min(0, ...values);
    const maxV = Math.max(0, ...values);
    const range = maxV - minV || 1;

    const toX = (i: number) => PAD_LEFT + (i / Math.max(1, points.length - 1)) * chartW;
    const toY = (v: number) => PAD_TOP + chartH - ((v - minV) / range) * chartH;
    const zeroY = toY(0);

    // ── Emotional Y-axis: milestone labels instead of raw numbers ─────────────────
    // Milestones: START (0), +25U, +50U, +100U, TODAY +{finalPL}U
    // Plus any negative milestones if minV < 0
    const finalPL = points[points.length - 1]?.cumPL ?? 0;
    const isPos = finalPL >= 0;

    // Build milestone set: always include 0, standard milestones, and the final value
    const rawMilestones = [0];
    const posMilestones = [25, 50, 100, 150, 200, 250, 300];
    for (const m of posMilestones) {
      if (m < maxV) rawMilestones.push(m);
    }
    rawMilestones.push(maxV); // ATH / final
    if (minV < 0) {
      const negMilestones = [-10, -25, -50];
      for (const m of negMilestones) {
        if (m > minV) rawMilestones.push(m);
      }
      rawMilestones.push(minV);
    }
    // Deduplicate and sort
    const milestones = Array.from(new Set(rawMilestones)).sort((a, b) => a - b);

    // Draw grid lines at each milestone
    ctx.strokeStyle = "#1e231e";
    ctx.lineWidth = 1;
    milestones.forEach(v => {
      const y = toY(v);
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, y);
      ctx.lineTo(PAD_LEFT + chartW, y);
      ctx.stroke();
    });

    // Draw emotional y-axis labels
    ctx.font = `normal 10px ${T.mono}`;
    ctx.textAlign = "right";
    milestones.forEach(v => {
      const y = toY(v);
      let label: string;
      if (v === 0) {
        label = "START";
        ctx.fillStyle = "#888888";
      } else if (v === maxV && v === finalPL) {
        // Current final value = TODAY label
        label = `TODAY`;
        ctx.fillStyle = isPos ? "#39FF14" : "#FF073A";
      } else if (v === maxV) {
        // ATH badge
        label = `ATH`;
        ctx.fillStyle = "#FFD700";
      } else if (v < 0) {
        label = `${v.toFixed(0)}U`;
        ctx.fillStyle = "#FF073A";
      } else {
        label = `+${v.toFixed(0)}U`;
        ctx.fillStyle = "#FFFFFF";
      }
      ctx.fillText(label, PAD_LEFT - 5, y + 3.5);
    });

    // Zero line (dashed)
    ctx.strokeStyle = "#2a3a2a";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(PAD_LEFT, zeroY);
    ctx.lineTo(PAD_LEFT + chartW, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Gradient fill — #39FF14 green (positive) or red (negative)
    const grad = ctx.createLinearGradient(0, PAD_TOP, 0, PAD_TOP + chartH);
    if (isPos) {
      grad.addColorStop(0, "rgba(57,255,20,0.22)");
      grad.addColorStop(1, "rgba(57,255,20,0.01)");
    } else {
      grad.addColorStop(0, "rgba(255,7,58,0.01)");
      grad.addColorStop(1, "rgba(255,7,58,0.22)");
    }
    ctx.beginPath();
    ctx.moveTo(toX(0), zeroY);
    points.forEach((p, i) => ctx.lineTo(toX(i), toY(p.cumPL)));
    ctx.lineTo(toX(points.length - 1), zeroY);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Main line — #39FF14 when positive, #FF073A when negative
    ctx.beginPath();
    ctx.strokeStyle = isPos ? "#39FF14" : "#FF073A";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(toX(i), toY(p.cumPL));
      else ctx.lineTo(toX(i), toY(p.cumPL));
    });
    ctx.stroke();

    // ── Milestone badges on the line ─────────────────────────────────────────────
    // Find the first point that crosses each milestone threshold
    const badgeMilestones = [25, 50, 100, 150, 200, 250, 300].filter(m => m <= maxV * 0.98);
    // Also add ATH badge at the highest point
    const athPL = stats?.ath ?? maxV;
    const athIdx = points.reduce((best, p, i) => p.cumPL >= (points[best]?.cumPL ?? -Infinity) ? i : best, 0);

    // Draw milestone crossing badges
    badgeMilestones.forEach(milestone => {
      // Find first index where cumPL crosses the milestone
      let crossIdx = -1;
      for (let i = 1; i < points.length; i++) {
        if (points[i - 1].cumPL < milestone && points[i].cumPL >= milestone) {
          crossIdx = i;
          break;
        }
      }
      if (crossIdx < 0) return;
      const bx = toX(crossIdx);
      const by = toY(milestone);
      // Badge pill background
      const label = `+${milestone}U`;
      ctx.font = `bold 9px ${T.mono}`;
      const tw = ctx.measureText(label).width;
      const bw = tw + 10, bh = 16;
      const bLeft = Math.min(bx - bw / 2, PAD_LEFT + chartW - bw - 2);
      const bTop = by - bh - 6;
      ctx.fillStyle = "rgba(57,255,20,0.18)";
      ctx.strokeStyle = "#39FF14";
      ctx.lineWidth = 1;
      // Rounded rect
      const r = 3;
      ctx.beginPath();
      ctx.moveTo(bLeft + r, bTop);
      ctx.lineTo(bLeft + bw - r, bTop);
      ctx.quadraticCurveTo(bLeft + bw, bTop, bLeft + bw, bTop + r);
      ctx.lineTo(bLeft + bw, bTop + bh - r);
      ctx.quadraticCurveTo(bLeft + bw, bTop + bh, bLeft + bw - r, bTop + bh);
      ctx.lineTo(bLeft + r, bTop + bh);
      ctx.quadraticCurveTo(bLeft, bTop + bh, bLeft, bTop + bh - r);
      ctx.lineTo(bLeft, bTop + r);
      ctx.quadraticCurveTo(bLeft, bTop, bLeft + r, bTop);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#39FF14";
      ctx.textAlign = "center";
      ctx.fillText(label, bLeft + bw / 2, bTop + bh / 2 + 3.5);
      // Vertical tick from badge to line
      ctx.strokeStyle = "rgba(57,255,20,0.4)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(bx, bTop + bh);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // ATH badge (gold) at the highest point
    {
      const bx = toX(athIdx);
      const by = toY(points[athIdx]?.cumPL ?? maxV);
      const label = `ATH +${athPL.toFixed(1)}U`;
      ctx.font = `bold 9px ${T.mono}`;
      const tw = ctx.measureText(label).width;
      const bw = tw + 10, bh = 16;
      const bLeft = Math.min(bx - bw / 2, PAD_LEFT + chartW - bw - 2);
      const bTop = Math.max(PAD_TOP + 2, by - bh - 6);
      ctx.fillStyle = "rgba(255,215,0,0.18)";
      ctx.strokeStyle = "#FFD700";
      ctx.lineWidth = 1.5;
      const r = 3;
      ctx.beginPath();
      ctx.moveTo(bLeft + r, bTop);
      ctx.lineTo(bLeft + bw - r, bTop);
      ctx.quadraticCurveTo(bLeft + bw, bTop, bLeft + bw, bTop + r);
      ctx.lineTo(bLeft + bw, bTop + bh - r);
      ctx.quadraticCurveTo(bLeft + bw, bTop + bh, bLeft + bw - r, bTop + bh);
      ctx.lineTo(bLeft + r, bTop + bh);
      ctx.quadraticCurveTo(bLeft, bTop + bh, bLeft, bTop + bh - r);
      ctx.lineTo(bLeft, bTop + r);
      ctx.quadraticCurveTo(bLeft, bTop, bLeft + r, bTop);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#FFD700";
      ctx.textAlign = "center";
      ctx.fillText(label, bLeft + bw / 2, bTop + bh / 2 + 3.5);
    }

    // ── Selective red dots: ONLY worst day + max drawdown point ───────────────────
    // All other losses = no dot (clean green line)
    const specialBetIds = new Set<number>();
    // Mark worst day bets and max drawdown bets (server sets isSpecial on these)
    points.forEach(p => { if (p.isSpecial && p.result === "LOSS") specialBetIds.add(p.betId); });

    points.forEach((p, i) => {
      if (specialBetIds.has(p.betId)) {
        const dx = toX(i);
        const dy = toY(p.cumPL);
        // Outer glow
        ctx.beginPath();
        ctx.arc(dx, dy, 7, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,7,58,0.15)";
        ctx.fill();
        // Inner dot
        ctx.beginPath();
        ctx.arc(dx, dy, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#FF073A";
        ctx.fill();
        // Ring
        ctx.beginPath();
        ctx.arc(dx, dy, 5.5, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,7,58,0.5)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    });

    // ── X-axis date labels (evenly distributed, white non-bold) ───────────────────────
    const dateFirstIdx = new Map<string, number>();
    points.forEach((p, i) => {
      if (!dateFirstIdx.has(p.date)) dateFirstIdx.set(p.date, i);
    });
    const uniqueDates = Array.from(dateFirstIdx.entries());

    const maxTicks = Math.max(2, Math.floor(chartW / 52));
    const step = uniqueDates.length <= maxTicks
      ? 1
      : Math.ceil(uniqueDates.length / maxTicks);

    const tickIndices: number[] = [];
    for (let t = 0; t < uniqueDates.length; t += step) tickIndices.push(t);
    if (tickIndices[tickIndices.length - 1] !== uniqueDates.length - 1) tickIndices.push(uniqueDates.length - 1);

    ctx.fillStyle = "#FFFFFF";
    ctx.font = `normal 9px ${T.mono}`;
    ctx.textAlign = "center";
    const xAxisY = PAD_TOP + chartH + 16;
    ctx.strokeStyle = "#2a3a2a";
    ctx.lineWidth = 1;

    tickIndices.forEach(t => {
      const [dateStr, firstIdx] = uniqueDates[t];
      const px = toX(firstIdx);
      ctx.beginPath();
      ctx.moveTo(px, PAD_TOP + chartH);
      ctx.lineTo(px, PAD_TOP + chartH + 5);
      ctx.stroke();
      const parts = dateStr.split("-");
      const label = parts.length === 3 ? `${parts[1]}/${parts[2]}` : dateStr;
      ctx.fillStyle = "#FFFFFF";
      ctx.fillText(label, px, xAxisY + 4);
    });
  }, [points, dims, stats]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (points.length === 0 || dims.w === 0) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;

      const PAD_LEFT = 64, PAD_RIGHT = 20, PAD_TOP = 24, PAD_BOTTOM = 44;
      const chartW = dims.w - PAD_LEFT - PAD_RIGHT;
      const chartH = dims.h - PAD_TOP - PAD_BOTTOM;
      const values = points.map(p => p.cumPL);
      const minV = Math.min(0, ...values);
      const maxV = Math.max(0, ...values);
      const range = maxV - minV || 1;

      const clamped = Math.max(0, Math.min(points.length - 1,
        Math.round(((mx - PAD_LEFT) / chartW) * (points.length - 1))
      ));
      const point = points[clamped];
      if (!point) return;

      const toX = (i: number) => PAD_LEFT + (i / Math.max(1, points.length - 1)) * chartW;
      const toY = (v: number) => PAD_TOP + chartH - ((v - minV) / range) * chartH;
      const dotX = toX(clamped);
      const dotY = toY(point.cumPL);
      const flipLeft = dotX + 14 + 180 > dims.w;
      setTooltip({ x: dotX, dotY, point, flipLeft });
    },
    [points, dims]
  );

  if (points.length === 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "160px", color: T.dim, fontSize: "11px", fontFamily: T.mono }}>
        NO SETTLED BETS — EQUITY CURVE APPEARS AFTER FIRST GRADED BET
      </div>
    );
  }

  const finalPL = points[points.length - 1]?.cumPL ?? 0;

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%" }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: dims.h || 200, display: "block", borderRadius: "4px", cursor: "crosshair" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
      />
      {tooltip && (
        <div style={{
          position: "absolute",
          zIndex: 10,
          pointerEvents: "none",
          background: "#141614",
          border: `1px solid ${T.border2}`,
          borderRadius: "4px",
          padding: "8px 12px",
          fontSize: "11px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.6)",
          minWidth: "160px",
          left: tooltip.flipLeft ? Math.max(0, tooltip.x - 174) : Math.min(tooltip.x + 14, dims.w - 180),
          top: Math.max(4, tooltip.dotY - 82),
          fontFamily: T.mono,
        }}>
          <div style={{ fontWeight: 700, color: T.text, marginBottom: "4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tooltip.point.label ?? tooltip.point.pick}</div>
          <div style={{ color: tooltip.point.result === "WIN" ? T.green : T.red, fontWeight: 700 }}>
            {tooltip.point.result} {tooltip.point.pl >= 0 ? "+" : ""}{tooltip.point.pl.toFixed(2)}u
          </div>
          <div style={{ color: T.textMuted, marginTop: "2px" }}>
            CUM: <span style={{ color: finalPL >= 0 ? T.green : T.red }}>
              {tooltip.point.cumPL >= 0 ? "+" : ""}{tooltip.point.cumPL.toFixed(2)}u
            </span>
          </div>
          <div style={{ color: T.dim, marginTop: "2px" }}>{tooltip.point.date}</div>
        </div>
      )}
    </div>
  );
}

export const EquityChart = memo(function EquityChartWrapper({ points, stats }: { points: EquityPoint[]; stats?: StatsData }) {
  return <EquityChartInner points={points} stats={stats} />;
});

// ─── Dual-sided bar ───────────────────────────────────────────────────────────

/**
 * DualBar — center-zero bar showing win/loss balance.
 * Green extends RIGHT proportional to wins, red extends LEFT proportional to losses.
 */
function DualBar({ wins, losses, maxTotal }: { wins: number; losses: number; maxTotal: number }) {
  const total = wins + losses;
  if (total === 0 || maxTotal === 0) return null;

  const winPct  = maxTotal > 0 ? (wins  / maxTotal) * 50 : 0; // max 50% of bar width
  const lossPct = maxTotal > 0 ? (losses / maxTotal) * 50 : 0;

  return (
    <div style={{
      display: "flex",
      height: "3px",
      background: T.border,
      borderRadius: "2px",
      overflow: "hidden",
      marginTop: "5px",
    }}>
      {/* Loss bar — left side, grows from center leftward */}
      <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
        <div style={{
          width: `${Math.min(100, lossPct * 2)}%`,
          background: T.red,
          borderRadius: "2px 0 0 2px",
          transition: "width 300ms ease",
        }} />
      </div>
      {/* Center divider */}
      <div style={{ width: "1px", background: T.border2, flexShrink: 0 }} />
      {/* Win bar — right side, grows from center rightward */}
      <div style={{ flex: 1, display: "flex", justifyContent: "flex-start" }}>
        <div style={{
          width: `${Math.min(100, winPct * 2)}%`,
          background: T.green,
          borderRadius: "0 2px 2px 0",
          transition: "width 300ms ease",
        }} />
      </div>
    </div>
  );
}

// ─── Kelly Grade ──────────────────────────────────────────────────────────────

/**
 * Compute Kelly Grade for a unit size tier.
 * Based on win rate and ROI:
 *   A+ : winPct >= 65% AND roi >= 30%
 *   A  : winPct >= 60% OR  roi >= 20%
 *   B  : winPct >= 52% OR  roi >= 8%
 *   C  : winPct >= 45%
 *   D  : below C
 */
function kellyGrade(wins: number, losses: number, roi: number): { grade: string; color: string } {
  const total = wins + losses;
  if (total < 5) return { grade: "—", color: T.dim };
  const wp = total > 0 ? (wins / total) * 100 : 0;
  if (wp >= 65 && roi >= 30) return { grade: "A+", color: T.green };
  if (wp >= 60 || roi >= 20)  return { grade: "A",  color: T.green };
  if (wp >= 52 || roi >= 8)   return { grade: "B",  color: "#a3e635" };
  if (wp >= 45)               return { grade: "C",  color: "#f59e0b" };
  return                             { grade: "D",  color: T.red };
}

// ─── BreakdownPanel ───────────────────────────────────────────────────────────

function BreakdownPanelInner({
  title,
  icon,
  entries,
  showDollar = false,
  dimension,
}: {
  title: string;
  icon: React.ReactNode;
  entries: BreakdownEntry[];
  showDollar?: boolean;
  dimension?: "type" | "size" | "month" | "sport" | "timeframe";
}) {
  if (entries.length === 0) return null;

  // Sort by ROI descending for rank indicators
  const sorted = [...entries].sort((a, b) => b.roi - a.roi);
  const rankMap = new Map(sorted.map((e, i) => [e.key, i + 1]));

  // Max total bets for dual-bar scaling
  const maxTotal = Math.max(...entries.map(e => e.wins + e.losses), 1);

  // By-month: render as mini bar chart
  if (dimension === "month") {
    return <MonthBarChart entries={entries} showDollar={showDollar} />;
  }

  // Kelly callout for unit size dimension
  const showKellyCallout = dimension === "size";
  const topTiers  = entries.filter(e => { const g = kellyGrade(e.wins, e.losses, e.roi); return g.grade === "A+" || g.grade === "A"; });
  const weakTiers = entries.filter(e => { const g = kellyGrade(e.wins, e.losses, e.roi); return g.grade === "C" || g.grade === "D"; });

  return (
    <div style={{
      background: T.card,
      border: `1px solid ${T.border}`,
      borderRadius: "4px",
      padding: "12px 14px",
    }}>
      {/* Panel header */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "10px" }}>
        <span style={{ color: T.green, opacity: 0.7 }}>{icon}</span>
        <span style={{
          fontSize: "11px",
          fontWeight: 700,
          letterSpacing: "2px",
          color: T.text,
          fontFamily: T.sans,
        }}>
          {title}
        </span>
      </div>

      {/* Kelly callout for unit size */}
      {showKellyCallout && topTiers.length > 0 && (
        <div style={{
          background: "rgba(57,255,20,0.04)",
          border: "1px solid rgba(57,255,20,0.15)",
          borderRadius: "4px",
          padding: "8px 10px",
          marginBottom: "10px",
          fontSize: "10px",
          fontFamily: T.mono,
          color: T.green,
          lineHeight: 1.5,
        }}>
          <span style={{ opacity: 0.6 }}>EDGE: </span>
          {topTiers.map(e => e.key).join(", ")} bets
          {` (${topTiers.map(e => {
            const total = e.wins + e.losses;
            return total > 0 ? `${((e.wins / total) * 100).toFixed(0)}%` : "—";
          }).join("/")} win rate)`}
          {weakTiers.length > 0 && (
            <span style={{ color: T.red, display: "block", marginTop: "2px" }}>
              <span style={{ opacity: 0.6 }}>REDUCE: </span>
              {weakTiers.map(e => e.key).join(", ")} volume
            </span>
          )}
        </div>
      )}

      {/* Rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {entries.map((e) => {
          const settled = e.wins + e.losses;
          const winPct  = settled > 0 ? (e.wins / settled) * 100 : 0;
          const isPos   = e.netProfit >= 0;
          const rank    = rankMap.get(e.key);
          const hasDollar = showDollar && e.dollarNetProfit !== undefined;
          const kg = dimension === "size" ? kellyGrade(e.wins, e.losses, e.roi) : null;

          return (
            <div key={e.key}>
              {/* Row: label + rank + stats */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px", flexWrap: "wrap" }}>
                {/* Left: label + rank + Kelly grade */}
                <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
                  {/* Rank badge */}
                  {rank !== undefined && rank <= 3 && (
                    <span style={{
                      fontSize: "9px",
                      fontFamily: T.mono,
                      color: rank === 1 ? T.green : rank === 2 ? "#a3e635" : T.textMuted,
                      fontWeight: 700,
                      minWidth: "18px",
                    }}>
                      #{rank}
                    </span>
                  )}
                  <span style={{
                    fontSize: "12px",
                    fontWeight: 700,
                    color: "#f0f0f0",
                    fontFamily: T.sans,
                    letterSpacing: "0.5px",
                    whiteSpace: "nowrap",
                  }}>
                    {e.key}
                  </span>
                  {/* Kelly grade badge */}
                  {kg && kg.grade !== "—" && (
                    <span style={{
                      fontSize: "9px",
                      fontFamily: T.mono,
                      fontWeight: 700,
                      color: kg.color,
                      background: `${kg.color}18`,
                      border: `1px solid ${kg.color}30`,
                      borderRadius: "3px",
                      padding: "1px 4px",
                    }}>
                      {kg.grade}
                    </span>
                  )}
                </div>

                {/* Right: stats cluster */}
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {/* W-L (WP%) */}
                  <span style={{ fontSize: "11px", fontFamily: T.mono, color: T.textMuted, whiteSpace: "nowrap" }}>
                    {e.wins}W–{e.losses}L
                    {e.pushes > 0 ? `–${e.pushes}P` : ""}
                    {" "}
                    <span style={{ color: winPct >= 55 ? T.green : winPct >= 50 ? "#a3e635" : T.red }}>
                      ({winPct.toFixed(0)}%)
                    </span>
                  </span>

                  {/* Net P/L units */}
                  <span style={{
                    fontSize: "12px",
                    fontWeight: 700,
                    fontFamily: T.mono,
                    color: isPos ? T.green : T.red,
                    whiteSpace: "nowrap",
                  }}>
                    {e.netProfit >= 0 ? "+" : ""}{e.netProfit.toFixed(2)}u
                  </span>

                  {/* Dollar P&L */}
                  {hasDollar && (
                    <span style={{
                      fontSize: "10px",
                      fontFamily: T.mono,
                      color: isPos ? T.green : T.red,
                      background: isPos ? "rgba(57,255,20,0.07)" : "rgba(255,59,59,0.07)",
                      border: `1px solid ${isPos ? "rgba(57,255,20,0.15)" : "rgba(255,59,59,0.15)"}`,
                      borderRadius: "3px",
                      padding: "1px 5px",
                      whiteSpace: "nowrap",
                    }}>
                      {(e.dollarNetProfit ?? 0) >= 0 ? "+" : ""}${Math.abs(e.dollarNetProfit ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                    </span>
                  )}

                  {/* ROI */}
                  <span style={{
                    fontSize: "11px",
                    fontFamily: T.mono,
                    color: isPos ? "rgba(57,255,20,0.65)" : "rgba(255,59,59,0.65)",
                    whiteSpace: "nowrap",
                  }}>
                    {e.roi >= 0 ? "+" : ""}{e.roi.toFixed(1)}%
                  </span>
                </div>
              </div>

              {/* Dual-sided bar */}
              <DualBar wins={e.wins} losses={e.losses} maxTotal={maxTotal} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── MonthBarChart ────────────────────────────────────────────────────────────

/**
 * MonthBarChart — replaces the flat list for "By Month" with a mini bar chart.
 * One bar per month, height proportional to |netProfit|, color green/red.
 * Shows month-over-month trend arrow.
 */
function MonthBarChart({ entries, showDollar }: { entries: BreakdownEntry[]; showDollar: boolean }) {
  if (entries.length === 0) return null;

  const maxAbs = Math.max(...entries.map(e => Math.abs(e.netProfit)), 1);
  const BAR_MAX_H = 56; // px

  return (
    <div style={{
      background: T.card,
      border: `1px solid ${T.border}`,
      borderRadius: "4px",
      padding: "12px 14px",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "12px" }}>
        <span style={{ color: T.green, opacity: 0.7 }}><Activity size={12} /></span>
        <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "2px", color: T.text, fontFamily: T.sans }}>
          BY MONTH
        </span>
      </div>

      {/* Bar chart */}
      <div style={{
        display: "flex",
        alignItems: "flex-end",
        gap: "6px",
        height: `${BAR_MAX_H + 32}px`,
        paddingBottom: "24px",
        position: "relative",
      }}>
        {/* Zero baseline */}
        <div style={{
          position: "absolute",
          bottom: "24px",
          left: 0,
          right: 0,
          height: "1px",
          background: T.border2,
        }} />

        {entries.map((e, i) => {
          const isPos = e.netProfit >= 0;
          const barH  = Math.max(3, (Math.abs(e.netProfit) / maxAbs) * BAR_MAX_H);
          const prev  = entries[i - 1];
          const trendUp = prev ? e.netProfit > prev.netProfit : null;

          // Short month label from key like "APRIL 2026" → "APR"
          const shortLabel = e.key.split(" ")[0]?.slice(0, 3) ?? e.key.slice(0, 3);

          return (
            <div key={e.key} style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "3px",
              position: "relative",
            }}>
              {/* Trend arrow */}
              {trendUp !== null && (
                <span style={{
                  fontSize: "9px",
                  color: trendUp ? T.green : T.red,
                  fontFamily: T.mono,
                  position: "absolute",
                  top: "-16px",
                }}>
                  {trendUp ? "↑" : "↓"}
                </span>
              )}

              {/* Bar */}
              <div
                title={`${e.key}: ${e.netProfit >= 0 ? "+" : ""}${e.netProfit.toFixed(2)}u (${e.wins}W–${e.losses}L, ROI ${e.roi >= 0 ? "+" : ""}${e.roi.toFixed(1)}%)`}
                style={{
                  width: "100%",
                  height: `${barH}px`,
                  background: isPos ? T.green : T.red,
                  borderRadius: isPos ? "3px 3px 0 0" : "0 0 3px 3px",
                  opacity: 0.85,
                  alignSelf: isPos ? "flex-end" : "flex-start",
                  transition: "opacity 150ms ease",
                  cursor: "default",
                }}
                onMouseEnter={e2 => { (e2.currentTarget as HTMLDivElement).style.opacity = "1"; }}
                onMouseLeave={e2 => { (e2.currentTarget as HTMLDivElement).style.opacity = "0.85"; }}
              />

              {/* Month label */}
              <span style={{
                position: "absolute",
                bottom: "0",
                fontSize: "9px",
                fontFamily: T.mono,
                color: T.dim,
                letterSpacing: "0.5px",
                whiteSpace: "nowrap",
              }}>
                {shortLabel}
              </span>
            </div>
          );
        })}
      </div>

      {/* Month list below chart */}
      <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
        {entries.map((e) => {
          const settled = e.wins + e.losses;
          const winPct  = settled > 0 ? (e.wins / settled) * 100 : 0;
          const isPos   = e.netProfit >= 0;
          const hasDollar = showDollar && e.dollarNetProfit !== undefined;

          return (
            <div key={e.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#f0f0f0", fontFamily: T.sans, letterSpacing: "0.5px" }}>
                {e.key}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "10px", fontFamily: T.mono, color: T.textMuted }}>
                  {e.wins}W–{e.losses}L ({winPct.toFixed(0)}%)
                </span>
                <span style={{ fontSize: "11px", fontWeight: 700, fontFamily: T.mono, color: isPos ? T.green : T.red }}>
                  {e.netProfit >= 0 ? "+" : ""}{e.netProfit.toFixed(2)}u
                </span>
                {hasDollar && (
                  <span style={{
                    fontSize: "10px", fontFamily: T.mono,
                    color: isPos ? T.green : T.red,
                    background: isPos ? "rgba(57,255,20,0.07)" : "rgba(255,59,59,0.07)",
                    border: `1px solid ${isPos ? "rgba(57,255,20,0.15)" : "rgba(255,59,59,0.15)"}`,
                    borderRadius: "3px", padding: "1px 5px",
                  }}>
                    {(e.dollarNetProfit ?? 0) >= 0 ? "+" : ""}${Math.abs(e.dollarNetProfit ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </span>
                )}
                <span style={{ fontSize: "10px", fontFamily: T.mono, color: isPos ? "rgba(57,255,20,0.6)" : "rgba(255,59,59,0.6)" }}>
                  {e.roi >= 0 ? "+" : ""}{e.roi.toFixed(1)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── BreakdownGrid ────────────────────────────────────────────────────────────

export const BreakdownPanel = memo(BreakdownPanelInner);

function remapKey(
  dimension: "type" | "size" | "month" | "sport" | "timeframe",
  key: string
): string {
  if (dimension === "type") {
    if (key === "ML") return "MONEY LINE";
    if (key === "RL") return "RUN LINE";
    if (key === "TOTAL") return "OVER/UNDER";
    return key;
  }
  if (dimension === "month") {
    const MONTHS = ["","JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
    const m = key.match(/^(\d{4})-(\d{2})$/);
    if (m) {
      const month = parseInt(m[2], 10);
      return `${MONTHS[month] ?? key} ${m[1]}`;
    }
    return key;
  }
  if (dimension === "timeframe") {
    if (key === "FULL_GAME")    return "Full Game";
    if (key === "FIRST_5")      return "First 5";
    if (key === "FIRST_HALF")   return "First Half";
    if (key === "FIRST_PERIOD") return "First Period";
    if (key === "FIRST_QUARTER") return "First Quarter";
    return key;
  }
  return key;
}

function remapEntries(
  dimension: "type" | "size" | "month" | "sport" | "timeframe",
  entries: BreakdownEntry[]
): BreakdownEntry[] {
  return entries.map((e) => ({ ...e, key: remapKey(dimension, e.key) }));
}

function BreakdownGridInner({
  stats,
  vertical = false,
  showDollar = false,
}: {
  stats: StatsData;
  vertical?: boolean;
  showDollar?: boolean;
}) {
  const gradedBets = stats.wins + stats.losses;
  const winPct = gradedBets > 0 ? ((stats.wins / gradedBets) * 100).toFixed(1) : "—";
  const roiStr = stats.roi >= 0 ? `+${stats.roi.toFixed(1)}%` : `${stats.roi.toFixed(1)}%`;
  const netStr = stats.netProfit >= 0 ? `+${stats.netProfit.toFixed(2)}u` : `${stats.netProfit.toFixed(2)}u`;
  const longestWin = stats.longestWinStreak ?? 0;

  // Top summary card
  const summaryCard = (
    <div key="summary" style={{
      background: T.card,
      border: `1px solid ${T.border}`,
      borderRadius: "4px",
      padding: "12px 14px",
      marginBottom: vertical ? "0" : undefined,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "10px" }}>
        <span style={{ color: T.green, opacity: 0.7 }}><BarChart2 size={12} /></span>
        <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "2px", color: T.text, fontFamily: T.sans }}>
          OVERALL SUMMARY
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
        {[
          { label: "RECORD",   value: `${stats.wins}W–${stats.losses}L`, color: T.text },
          { label: "WIN%",     value: `${winPct}%`,                      color: parseFloat(winPct as string) >= 55 ? T.green : T.red },
          { label: "NET UNITS", value: netStr,                            color: stats.netProfit >= 0 ? T.green : T.red },
          { label: "ROI",      value: roiStr,                            color: stats.roi >= 0 ? T.green : T.red },
        ].map(item => (
          <div key={item.label} style={{ textAlign: "center" }}>
            <div style={{ fontSize: "8px", color: T.dim, letterSpacing: "1.5px", fontFamily: T.mono, marginBottom: "3px" }}>{item.label}</div>
            <div style={{ fontSize: "13px", fontWeight: 700, fontFamily: T.mono, color: item.color }}>{item.value}</div>
          </div>
        ))}
      </div>
      {longestWin > 0 && (
        <div style={{
          marginTop: "8px",
          paddingTop: "8px",
          borderTop: `1px solid ${T.border}`,
          display: "flex",
          gap: "16px",
          fontSize: "10px",
          fontFamily: T.mono,
          color: T.dim,
        }}>
          <span>BEST STREAK: <span style={{ color: T.green }}>W{longestWin}</span></span>
          {stats.biggestDayUnits !== undefined && stats.biggestDayUnits > 0 && (
            <span>BEST DAY: <span style={{ color: T.green }}>+{stats.biggestDayUnits.toFixed(2)}u</span></span>
          )}
        </div>
      )}
    </div>
  );

  const panels = [
    summaryCard,
    <BreakdownPanel key="type"      title="BY BET TYPE"   icon={<BarChart2 size={12} />} entries={remapEntries("type",      stats.byType)}      showDollar={showDollar} dimension="type"      />,
    <BreakdownPanel key="size"      title="BY UNIT SIZE"  icon={<Activity  size={12} />} entries={remapEntries("size",      stats.bySize)}      showDollar={showDollar} dimension="size"      />,
    <BreakdownPanel key="month"     title="BY MONTH"      icon={<Activity  size={12} />} entries={remapEntries("month",     stats.byMonth)}     showDollar={showDollar} dimension="month"     />,
    <BreakdownPanel key="sport"     title="BY SPORT"      icon={<Activity  size={12} />} entries={remapEntries("sport",     stats.bySport)}     showDollar={showDollar} dimension="sport"     />,
    <BreakdownPanel key="timeframe" title="BY TIMEFRAME"  icon={<Activity  size={12} />} entries={remapEntries("timeframe", stats.byTimeframe)} showDollar={showDollar} dimension="timeframe" />,
  ];

  if (vertical) {
    return <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>{panels}</div>;
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "10px", alignItems: "start" }}>
      {panels}
    </div>
  );
}

export const BreakdownGrid = memo(BreakdownGridInner);

// ─── HandicapperSelector ──────────────────────────────────────────────────────

function HandicapperSelectorInner({
  handicappers,
  selectedId,
  onSelect,
  currentUserId,
}: {
  handicappers: Array<{ id: number; username: string; role: string }>;
  selectedId: number | undefined;
  onSelect: (id: number) => void;
  currentUserId: number | undefined;
}) {
  const [open, setOpen] = useState(false);
  const selected = handicappers.find((h) => h.id === selectedId);

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex", alignItems: "center", gap: "6px",
          padding: "6px 12px",
          background: T.card,
          border: `1px solid ${T.border2}`,
          borderRadius: "4px",
          color: T.text,
          fontSize: "11px",
          fontFamily: T.mono,
          cursor: "pointer",
          transition: "all 150ms ease",
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = T.hover; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = T.card; }}
      >
        <Users size={11} />
        <span>{selected?.username ?? "SELECT HANDICAPPER"}</span>
        <ChevronDown size={11} />
      </button>
      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 4px)",
          left: 0,
          zIndex: 20,
          background: "#141614",
          border: `1px solid ${T.border2}`,
          borderRadius: "4px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
          minWidth: "180px",
          padding: "4px 0",
        }}>
          {handicappers.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => { onSelect(h.id); setOpen(false); }}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "8px 12px",
                fontSize: "11px",
                fontFamily: T.mono,
                color: h.id === selectedId ? T.green : T.text,
                fontWeight: h.id === selectedId ? 700 : 400,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                transition: "background 150ms ease",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = T.hover; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
            >
              {h.username}
              {h.id === currentUserId && (
                <span style={{ color: T.dim, marginLeft: "6px" }}>(you)</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const HandicapperSelector = memo(HandicapperSelectorInner);
