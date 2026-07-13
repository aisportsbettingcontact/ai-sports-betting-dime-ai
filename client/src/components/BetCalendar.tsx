/**
 * BetCalendar.tsx — Bloomberg Terminal × DraftKings Sportsbook calendar recap
 *
 * Design language:
 *   - #000000 base, #000000 cards, #000000 hover
 *   - #45E0A8 neon green for wins/positives
 *   - #FF3B3B loss red for negatives
 *   - JetBrains Mono for all numbers (monospace = quant feel)
 *   - Barlow Condensed for section headers
 *   - Sharp corners (max 6px radius)
 *   - 150ms transitions
 *
 * Features:
 *   - Monthly summary header bar (record, win%, P/L, ROI, current streak)
 *   - Magnitude-scaled color intensity (opacity/saturation scales with |units|)
 *   - Day tiles: date number (top-left), P/L units (bold center), bet count (bottom-right)
 *   - Best day crown badge, worst day skull badge
 *   - Today tile: neon green border pulse animation
 *   - Future dates: invisible (dim number only, no tile)
 *   - Equity sparkline behind the calendar grid
 *   - Month navigation (prev/next)
 *
 * Logging convention:
 *   [BetCalendar][INPUT]  — raw props received
 *   [BetCalendar][STEP]   — rendering operation
 *   [BetCalendar][STATE]  — computed values
 *   [BetCalendar][OUTPUT] — final render
 */

import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { trpc } from "@/lib/trpc";

const IS_DEV = process.env.NODE_ENV === "development";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BetCalendarProps {
  targetUserId?: number;
  unitSize?: number;
  handicapperName?: string;
  initialYearMonth?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE",
  "JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER",
];
const DAY_HEADERS = ["S","M","T","W","T","F","S"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayPt(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}
function currentMonthPt(): string {
  return todayPt().slice(0, 7);
}
function parseYearMonth(ym: string): { year: number; month: number } {
  const [y, m] = ym.split("-").map(Number);
  return { year: y, month: m };
}
function shiftMonth(ym: string, direction: -1 | 1): string {
  const { year, month } = parseYearMonth(ym);
  const nm = month + direction;
  if (nm < 1) return `${year - 1}-12`;
  if (nm > 12) return `${year + 1}-01`;
  return `${year}-${String(nm).padStart(2, "0")}`;
}
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}
function firstDayOfWeek(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}
function fmtUnits(n: number): string {
  const abs = Math.abs(n).toFixed(2);
  return n >= 0 ? `+${abs}u` : `-${abs}u`;
}
function fmtUnitsShort(n: number): string {
  const abs = Math.abs(n);
  // For large values, use 1 decimal; otherwise 2 decimals
  const str = abs >= 10 ? abs.toFixed(1) : abs.toFixed(2);
  return n >= 0 ? `+${str}u` : `-${str}u`;
}
function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

/**
 * Compute inline style for a day tile based on unit magnitude.
 * Uses actual CSS color values (not Tailwind classes) for precise opacity scaling.
 *
 * @param units - net units for the day
 * @param maxMagnitude - largest |units| in the month (for normalization)
 * @returns { bg, textColor, borderColor } as CSS color strings
 */
function getCellColors(units: number, maxMagnitude: number): {
  bg: string;
  textColor: string;
  borderColor: string;
} {
  if (units === 0) {
    return {
      bg: "var(--bt-cell-empty, rgba(39,39,42,0.5))",
      textColor: "var(--bt-text-muted, #71717a)",
      borderColor: "var(--bt-cell-empty-border, rgba(63,63,70,0.4))",
    };
  }

  // Normalize intensity: 0.1 → 1.0 (never fully transparent)
  const raw = maxMagnitude > 0 ? Math.min(Math.abs(units) / maxMagnitude, 1.0) : 0.5;
  // Apply square root to spread out the lower range (small wins still visible)
  const intensity = 0.15 + Math.sqrt(raw) * 0.85;

  // Token-aware heat scale: base color is a --bt-* var (legacy literal
  // fallback on desktop). Mixing toward black reproduces the old channel
  // scaling; mixing toward transparent reproduces the old alpha.
  const base = units > 0
    ? "var(--bt-green, rgb(57,255,20))"
    : "var(--bt-red, rgb(255,59,59))";
  const scaled = `color-mix(in srgb, ${base} ${Math.round(intensity * 100)}%, black)`;
  const pct = (a: number) => `${Math.round(a * 100)}%`;
  return {
    bg:          `color-mix(in srgb, ${scaled} ${pct(0.12 + intensity * 0.25)}, transparent)`,
    textColor:   intensity > 0.6 ? scaled : `color-mix(in srgb, ${scaled} 90%, transparent)`,
    borderColor: `color-mix(in srgb, ${scaled} ${pct(0.15 + intensity * 0.35)}, transparent)`,
  };
}

/**
 * Build an SVG sparkline path from equity curve data points.
 * Returns a polyline points string for an SVG viewBox of width × height.
 */
function buildSparklinePath(
  equityCurve: { date: string; cumUnits: number }[],
  width: number,
  height: number
): string {
  if (equityCurve.length < 2) return "";
  const values = equityCurve.map(p => p.cumUnits);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range  = maxVal - minVal || 1;
  const pad    = height * 0.1;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = pad + ((maxVal - v) / range) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return points.join(" ");
}

// ─── BetCalendar ─────────────────────────────────────────────────────────────

export function BetCalendar({
  targetUserId,
  unitSize = 100,
  handicapperName = "PREZ",
  initialYearMonth,
}: BetCalendarProps) {
  const [yearMonth, setYearMonth] = useState<string>(
    initialYearMonth ?? currentMonthPt()
  );

  const { year, month } = parseYearMonth(yearMonth);

  if (IS_DEV) {
    console.log(`[BetCalendar][INPUT] yearMonth=${yearMonth} targetUserId=${targetUserId} unitSize=${unitSize} handicapperName=${handicapperName}`);
  }

  // ── Server query ─────────────────────────────────────────────────────────
  const calendarQuery = trpc.betTracker.getCalendarData.useQuery(
    { yearMonth, targetUserId, unitSize },
    {
      staleTime: yearMonth < currentMonthPt() ? Infinity : 60_000,
      gcTime:    yearMonth < currentMonthPt() ? 30 * 60_000 : 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    }
  );

  // ── Build day map ─────────────────────────────────────────────────────────
  const dayMap = useMemo(() => {
    const map = new Map<string, {
      units: number; wins: number; losses: number;
      pushes: number; pending: number; betCount: number;
    }>();
    if (!calendarQuery.data) return map;
    for (const d of calendarQuery.data.days) {
      map.set(d.date, d);
    }
    if (IS_DEV) console.log(`[BetCalendar][STATE] dayMap: ${map.size} active days`);
    return map;
  }, [calendarQuery.data]);

  // ── Max magnitude for intensity scaling ──────────────────────────────────
  const maxMagnitude = useMemo(() => {
    if (!calendarQuery.data) return 1;
    let max = 0;
    for (const d of calendarQuery.data.days) {
      if (Math.abs(d.units) > max) max = Math.abs(d.units);
    }
    return max || 1;
  }, [calendarQuery.data]);

  // ── Calendar grid cells ───────────────────────────────────────────────────
  const totalDays = daysInMonth(year, month);
  const startDow  = firstDayOfWeek(year, month);
  const todayStr  = todayPt();

  const cells: (number | null)[] = [
    ...Array(startDow).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const monthRecord = calendarQuery.data?.monthRecord;
  const equityCurve = calendarQuery.data?.equityCurve ?? [];
  const netUnits    = monthRecord?.netUnits ?? 0;

  if (IS_DEV) {
    console.log(`[BetCalendar][STATE] grid: ${cells.length} cells startDow=${startDow} maxMagnitude=${maxMagnitude.toFixed(2)}`);
    console.log(`[BetCalendar][STATE] monthRecord=${JSON.stringify(monthRecord)} equityCurve=${equityCurve.length} pts`);
  }

  // ── Navigation ────────────────────────────────────────────────────────────
  const canGoNext = yearMonth < currentMonthPt();

  function handlePrev() {
    const prev = shiftMonth(yearMonth, -1);
    if (IS_DEV) console.log(`[BetCalendar][STEP] Navigate prev: ${yearMonth} → ${prev}`);
    setYearMonth(prev);
  }
  function handleNext() {
    if (!canGoNext) return;
    const next = shiftMonth(yearMonth, 1);
    if (IS_DEV) console.log(`[BetCalendar][STEP] Navigate next: ${yearMonth} → ${next}`);
    setYearMonth(next);
  }

  if (IS_DEV) {
    console.log(`[BetCalendar][OUTPUT] Rendering ${yearMonth} netUnits=${netUnits} bestDay=${monthRecord?.bestDay} worstDay=${monthRecord?.worstDay}`);
  }

  // ── Sparkline dimensions (responsive via CSS, fixed SVG viewBox) ──────────
  const SPARK_W = 700;
  const SPARK_H = 80;
  const sparkPoints = buildSparklinePath(equityCurve, SPARK_W, SPARK_H);

  return (
    <div
      style={{
        background: "var(--bt-base, #000000)",
        border: "1px solid #1e231e",
        borderRadius: "6px",
        overflow: "hidden",
        userSelect: "none",
        fontFamily: "var(--bt-sans, 'Familjen Grotesk', system-ui, -apple-system, sans-serif)",
      }}
    >
      {/* ── HEADER: Month + Year + Navigation ── */}
      <div style={{ padding: "16px 18px 12px", borderBottom: "1px solid #1e231e" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
          {/* Left: Month name + year + handicapper */}
          <div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
              <span style={{
                fontSize: "28px",
                fontWeight: 900,
                color: "var(--bt-strong, #f0f0f0)",
                letterSpacing: "-0.5px",
                lineHeight: 1,
                fontFamily: "var(--bt-sans, 'Familjen Grotesk', system-ui, -apple-system, sans-serif)",
              }}>
                {MONTH_NAMES[month - 1]}
              </span>
              <span style={{
                fontSize: "16px",
                fontWeight: 600,
                color: "var(--bt-label, #4a5a4a)",
                fontFamily: "var(--bt-mono, 'Familjen Grotesk', system-ui, -apple-system, sans-serif)",
              }}>
                {year}
              </span>
            </div>
            <div style={{
              fontSize: "11px",
              color: "var(--bt-green, #45E0A8)",
              fontFamily: "var(--bt-mono, 'Familjen Grotesk', system-ui, -apple-system, sans-serif)",
              letterSpacing: "2px",
              marginTop: "3px",
              opacity: 0.8,
            }}>
              {handicapperName}
            </div>
          </div>

          {/* Right: Navigation */}
          <div style={{ display: "flex", gap: "4px" }}>
            <button
              type="button"
              onClick={handlePrev}
              aria-label="Previous month"
              style={{
                width: "32px", height: "32px",
                background: "var(--bt-card, #000000)",
                border: "1px solid #2a2a2a",
                borderRadius: "4px",
                color: "var(--bt-text-muted, #888)",
                cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 150ms ease",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--bt-hover, #000000)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--bt-strong, #f0f0f0)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--bt-card, #000000)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--bt-text-muted, #888)"; }}
            >
              <ChevronLeft size={13} />
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={!canGoNext}
              aria-label="Next month"
              style={{
                width: "32px", height: "32px",
                background: canGoNext ? "var(--bt-card, #000000)" : "var(--bt-base, #000000)",
                border: "1px solid #2a2a2a",
                borderRadius: "4px",
                color: canGoNext ? "var(--bt-text-muted, #888)" : "var(--bt-border2, #2a2a2a)",
                cursor: canGoNext ? "pointer" : "not-allowed",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 150ms ease",
              }}
              onMouseEnter={e => { if (canGoNext) { (e.currentTarget as HTMLButtonElement).style.background = "var(--bt-hover, #000000)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--bt-strong, #f0f0f0)"; } }}
              onMouseLeave={e => { if (canGoNext) { (e.currentTarget as HTMLButtonElement).style.background = "var(--bt-card, #000000)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--bt-text-muted, #888)"; } }}
            >
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* ── MONTHLY SUMMARY BAR ── */}
      {!calendarQuery.isLoading && monthRecord && (monthRecord.wins + monthRecord.losses) > 0 && (
        <div style={{
          background: "var(--bt-card, #000000)",
          borderBottom: "1px solid #1e231e",
          padding: "10px 18px",
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: "4px",
        }}>
          {/* Record */}
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "9px", color: "var(--bt-label, #4a5a4a)", letterSpacing: "1.5px", fontFamily: "var(--bt-mono, 'Familjen Grotesk', system-ui, -apple-system, sans-serif)", marginBottom: "2px" }}>RECORD</div>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--bt-text, #d0d0d0)", fontFamily: "var(--bt-mono, 'Familjen Grotesk', system-ui, -apple-system, sans-serif)" }}>
              {monthRecord.wins}W–{monthRecord.losses}L
              {monthRecord.pushes > 0 && <span style={{ color: "var(--bt-text-muted, #888)" }}>–{monthRecord.pushes}P</span>}
            </div>
          </div>
          {/* Win% */}
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "9px", color: "var(--bt-label, #4a5a4a)", letterSpacing: "1.5px", fontFamily: "var(--bt-mono, 'Familjen Grotesk', system-ui, -apple-system, sans-serif)", marginBottom: "2px" }}>WIN%</div>
            <div style={{
              fontSize: "13px", fontWeight: 700,
              color: monthRecord.winPct >= 55 ? "var(--bt-green, #45E0A8)" : monthRecord.winPct >= 50 ? "var(--bt-grade-b, #a3e635)" : "var(--bt-red, #FF3B3B)",
              fontFamily: "var(--bt-mono, 'Familjen Grotesk', system-ui, -apple-system, sans-serif)",
            }}>
              {monthRecord.winPct.toFixed(1)}%
            </div>
          </div>
          {/* Net Units */}
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "9px", color: "var(--bt-label, #4a5a4a)", letterSpacing: "1.5px", fontFamily: "var(--bt-mono, 'Familjen Grotesk', system-ui, -apple-system, sans-serif)", marginBottom: "2px" }}>NET UNITS</div>
            <div style={{
              fontSize: "13px", fontWeight: 700,
              color: netUnits >= 0 ? "var(--bt-green, #45E0A8)" : "var(--bt-red, #FF3B3B)",
              fontFamily: "var(--bt-mono, 'Familjen Grotesk', system-ui, -apple-system, sans-serif)",
            }}>
              {fmtUnits(netUnits)}
            </div>
          </div>
          {/* ROI */}
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "9px", color: "var(--bt-label, #4a5a4a)", letterSpacing: "1.5px", fontFamily: "var(--bt-mono, 'Familjen Grotesk', system-ui, -apple-system, sans-serif)", marginBottom: "2px" }}>ROI</div>
            <div style={{
              fontSize: "13px", fontWeight: 700,
              color: monthRecord.roi >= 0 ? "var(--bt-green, #45E0A8)" : "var(--bt-red, #FF3B3B)",
              fontFamily: "var(--bt-mono, 'Familjen Grotesk', system-ui, -apple-system, sans-serif)",
            }}>
              {fmtPct(monthRecord.roi)}
            </div>
          </div>
          {/* Current Streak */}
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "9px", color: "var(--bt-label, #4a5a4a)", letterSpacing: "1.5px", fontFamily: "var(--bt-mono, 'Familjen Grotesk', system-ui, -apple-system, sans-serif)", marginBottom: "2px" }}>STREAK</div>
            <div style={{
              fontSize: "13px", fontWeight: 700,
              color: monthRecord.currentStreak?.startsWith("W") ? "var(--bt-green, #45E0A8)" : "var(--bt-red, #FF3B3B)",
              fontFamily: "var(--bt-mono, 'Familjen Grotesk', system-ui, -apple-system, sans-serif)",
            }}>
              {monthRecord.currentStreak ?? "—"}
            </div>
          </div>
        </div>
      )}

      {/* ── CALENDAR GRID ── */}
      <div style={{ padding: "14px 14px 0", position: "relative" }}>
        {/* Ghost equity sparkline behind the grid */}
        {sparkPoints && (
          <svg
            viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
            preserveAspectRatio="none"
            style={{
              position: "absolute",
              top: "36px",
              left: "14px",
              right: "14px",
              width: "calc(100% - 28px)",
              height: "60%",
              opacity: 0.07,
              pointerEvents: "none",
              zIndex: 0,
            }}
          >
            <polyline
              points={sparkPoints}
              fill="none"
              style={{ stroke: netUnits >= 0 ? "var(--bt-green, #45E0A8)" : "var(--bt-red, #FF3B3B)" }}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}

        {/* Day-of-week headers */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          marginBottom: "8px",
          position: "relative",
          zIndex: 1,
        }}>
          {DAY_HEADERS.map((d, i) => (
            <div key={i} style={{
              textAlign: "center",
              fontSize: "10px",
              fontWeight: 700,
              color: "var(--bt-dim, #3a4a3a)",
              letterSpacing: "2px",
              padding: "4px 0",
              fontFamily: "var(--bt-sans, 'Familjen Grotesk', system-ui, -apple-system, sans-serif)",
            }}>
              {d}
            </div>
          ))}
        </div>

        {/* Loading skeleton */}
        {calendarQuery.isLoading && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "4px", marginBottom: "14px" }}>
            {Array.from({ length: 35 }).map((_, i) => (
              <div key={i} style={{
                aspectRatio: "1",
                borderRadius: "4px",
                background: "var(--bt-cell-empty, rgba(39,39,42,0.4))",
                animation: "pulse 1.5s ease-in-out infinite",
              }} />
            ))}
          </div>
        )}

        {/* Calendar cells */}
        {!calendarQuery.isLoading && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: "4px",
            marginBottom: "14px",
            position: "relative",
            zIndex: 1,
          }}>
            {cells.map((dayNum, idx) => {
              if (dayNum === null) {
                return <div key={`empty-${idx}`} style={{ aspectRatio: "1" }} />;
              }

              const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
              const dayData = dayMap.get(dateStr);
              const isToday  = dateStr === todayStr;
              const isFuture = dateStr > todayStr;
              const isBestDay  = monthRecord?.bestDay  === dateStr;
              const isWorstDay = monthRecord?.worstDay === dateStr;

              const hasGradedBets = dayData && (dayData.wins > 0 || dayData.losses > 0);

              if (!hasGradedBets) {
                // No graded bets — show dim number only (future: invisible, past: very dim)
                return (
                  <div
                    key={dateStr}
                    style={{
                      aspectRatio: "1",
                      borderRadius: "4px",
                      border: isToday ? "1px solid color-mix(in srgb, var(--bt-green, rgb(57,255,20)) 40%, transparent)" : "1px solid transparent",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      background: isToday ? "color-mix(in srgb, var(--bt-green, rgb(57,255,20)) 4%, transparent)" : "transparent",
                      animation: isToday ? "todayPulse 2s ease-in-out infinite" : undefined,
                    }}
                  >
                    <span style={{
                      fontSize: "11px",
                      fontFamily: "var(--bt-mono, 'Familjen Grotesk', system-ui, -apple-system, sans-serif)",
                      color: isFuture ? "var(--bt-border, #1e261e)" : "var(--bt-dimmer, #2a3a2a)",
                    }}>
                      {dayNum}
                    </span>
                    {dayData?.pending && dayData.pending > 0 && (
                      <span style={{
                        width: "4px", height: "4px",
                        borderRadius: "50%",
                        background: "var(--bt-grade-c, #f59e0b)",
                        marginTop: "2px",
                      }} />
                    )}
                  </div>
                );
              }

              // Day has graded bets — render full tile
              const { bg, textColor, borderColor } = getCellColors(dayData.units, maxMagnitude);
              const betCountLabel = dayData.betCount > 0 ? `${dayData.betCount}b` : "";

              return (
                <div
                  key={dateStr}
                  title={`${dateStr}: ${fmtUnits(dayData.units)} (${dayData.wins}W-${dayData.losses}L${dayData.pushes > 0 ? `-${dayData.pushes}P` : ""}${dayData.pending > 0 ? ` +${dayData.pending} pend` : ""}) — ${dayData.betCount} bet${dayData.betCount !== 1 ? "s" : ""}`}
                  style={{
                    aspectRatio: "1",
                    borderRadius: "4px",
                    border: isToday
                      ? "1px solid color-mix(in srgb, var(--bt-green, rgb(57,255,20)) 70%, transparent)"
                      : `1px solid ${borderColor}`,
                    background: bg,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    position: "relative",
                    cursor: "default",
                    transition: "all 150ms ease",
                    animation: isToday ? "todayPulse 2s ease-in-out infinite" : undefined,
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLDivElement).style.transform = "scale(1.08)";
                    (e.currentTarget as HTMLDivElement).style.zIndex = "10";
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLDivElement).style.transform = "scale(1)";
                    (e.currentTarget as HTMLDivElement).style.zIndex = "1";
                  }}
                >
                  {/* Date number — top left */}
                  <span style={{
                    position: "absolute",
                    top: "3px",
                    left: "4px",
                    fontSize: "9px",
                    fontFamily: "var(--bt-mono, 'Familjen Grotesk', system-ui, -apple-system, sans-serif)",
                    color: textColor,
                    opacity: 0.65,
                    lineHeight: 1,
                  }}>
                    {dayNum}
                  </span>

                  {/* P/L units — bold center */}
                  <span style={{
                    fontSize: "clamp(8px, 1.8vw, 11px)",
                    fontWeight: 900,
                    fontFamily: "var(--bt-mono, 'Familjen Grotesk', system-ui, -apple-system, sans-serif)",
                    color: textColor,
                    lineHeight: 1,
                    letterSpacing: "-0.5px",
                    textAlign: "center",
                    padding: "0 2px",
                  }}>
                    {fmtUnitsShort(dayData.units)}
                  </span>

                  {/* Bet count — bottom right */}
                  {betCountLabel && (
                    <span style={{
                      position: "absolute",
                      bottom: "2px",
                      right: "3px",
                      fontSize: "8px",
                      fontFamily: "var(--bt-mono, 'Familjen Grotesk', system-ui, -apple-system, sans-serif)",
                      color: textColor,
                      opacity: 0.5,
                      lineHeight: 1,
                    }}>
                      {betCountLabel}
                    </span>
                  )}

                  {/* Best day crown badge */}
                  {isBestDay && (
                    <span
                      title="Best day of the month"
                      style={{
                        position: "absolute",
                        top: "2px",
                        right: "3px",
                        fontSize: "9px",
                        lineHeight: 1,
                      }}
                    >
                      👑
                    </span>
                  )}

                  {/* Worst day skull badge */}
                  {isWorstDay && !isBestDay && (
                    <span
                      title="Worst day of the month"
                      style={{
                        position: "absolute",
                        top: "2px",
                        right: "3px",
                        fontSize: "9px",
                        lineHeight: 1,
                      }}
                    >
                      💀
                    </span>
                  )}

                  {/* Pending dot */}
                  {dayData.pending > 0 && (
                    <span style={{
                      position: "absolute",
                      bottom: "2px",
                      left: "3px",
                      width: "4px",
                      height: "4px",
                      borderRadius: "50%",
                      background: "var(--bt-grade-c, #f59e0b)",
                    }} title={`${dayData.pending} pending`} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── STREAK FOOTER ── */}
      {!calendarQuery.isLoading && monthRecord && (monthRecord.wins + monthRecord.losses) > 0 && (
        <div style={{
          borderTop: "1px solid #1e231e",
          padding: "10px 18px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "var(--bt-base, #000000)",
        }}>
          <div style={{ display: "flex", gap: "16px" }}>
            <div>
              <span style={{ fontSize: "9px", color: "var(--bt-dim, #3a4a3a)", letterSpacing: "1.5px", fontFamily: "var(--bt-mono, 'Familjen Grotesk', system-ui, -apple-system, sans-serif)" }}>BEST STREAK </span>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--bt-green, #45E0A8)", fontFamily: "var(--bt-mono, 'Familjen Grotesk', system-ui, -apple-system, sans-serif)" }}>W{monthRecord.longestWinStreak}</span>
            </div>
            <div>
              <span style={{ fontSize: "9px", color: "var(--bt-dim, #3a4a3a)", letterSpacing: "1.5px", fontFamily: "var(--bt-mono, 'Familjen Grotesk', system-ui, -apple-system, sans-serif)" }}>WORST STREAK </span>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--bt-red, #FF3B3B)", fontFamily: "var(--bt-mono, 'Familjen Grotesk', system-ui, -apple-system, sans-serif)" }}>L{monthRecord.longestLossStreak}</span>
            </div>
          </div>
          {monthRecord.bestDayUnits !== null && (
            <div style={{ textAlign: "right" }}>
              <span style={{ fontSize: "9px", color: "var(--bt-dim, #3a4a3a)", letterSpacing: "1.5px", fontFamily: "var(--bt-mono, 'Familjen Grotesk', system-ui, -apple-system, sans-serif)" }}>BEST DAY </span>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--bt-green, #45E0A8)", fontFamily: "var(--bt-mono, 'Familjen Grotesk', system-ui, -apple-system, sans-serif)" }}>
                {fmtUnits(monthRecord.bestDayUnits)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── EMPTY STATE ── */}
      {!calendarQuery.isLoading && (!monthRecord || (monthRecord.wins + monthRecord.losses) === 0) && (
        <div style={{ padding: "20px 18px", textAlign: "center" }}>
          <span style={{ fontSize: "11px", color: "var(--bt-dim, #3a4a3a)", fontFamily: "var(--bt-mono, 'Familjen Grotesk', system-ui, -apple-system, sans-serif)" }}>
            NO GRADED BETS FOR THIS MONTH
          </span>
        </div>
      )}

      {/* ── CSS animations ── */}
      <style>{`
        @keyframes todayPulse {
          0%, 100% { box-shadow: 0 0 0 0 transparent; }
          50%       { box-shadow: 0 0 0 3px color-mix(in srgb, var(--bt-green, rgb(57,255,20)) 25%, transparent); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50%       { opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}

export default BetCalendar;
