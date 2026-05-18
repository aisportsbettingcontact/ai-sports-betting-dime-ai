/**
 * BetCalendar.tsx — Pikkit-style calendar recap component
 *
 * Displays a monthly calendar grid showing +/- units per day for a given handicapper.
 * - Green cells: net positive units on that day
 * - Red cells: net negative units on that day
 * - Intensity scales with magnitude (light/medium/dark)
 * - Month navigation: prev/next arrows
 * - Month summary: W-L-P record + net units
 * - Responsive: works on mobile and desktop
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
  /** The user ID to show calendar for */
  targetUserId?: number;
  /** Unit size in dollars (for display) */
  unitSize?: number;
  /** Handicapper display name */
  handicapperName?: string;
  /** Initial year-month to show (YYYY-MM). Defaults to current month. */
  initialYearMonth?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Today in Pacific Time as YYYY-MM-DD */
function todayPt(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

/** Current month in Pacific Time as YYYY-MM */
function currentMonthPt(): string {
  return todayPt().slice(0, 7);
}

/** Parse YYYY-MM into { year, month } (1-indexed month) */
function parseYearMonth(ym: string): { year: number; month: number } {
  const [y, m] = ym.split("-").map(Number);
  return { year: y, month: m };
}

/** Navigate month: direction = -1 (prev) or +1 (next) */
function shiftMonth(ym: string, direction: -1 | 1): string {
  const { year, month } = parseYearMonth(ym);
  const newMonth = month + direction;
  if (newMonth < 1) return `${year - 1}-12`;
  if (newMonth > 12) return `${year + 1}-01`;
  return `${year}-${String(newMonth).padStart(2, "0")}`;
}

/** Get the number of days in a given year-month */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate(); // month is 1-indexed; day=0 = last day of prev month
}

/** Get the day-of-week (0=Sun) of the 1st of the month */
function firstDayOfWeek(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}

/** Format YYYY-MM-DD → "MM/DD" */
function fmtShortDate(d: string): string {
  const [, m, day] = d.split("-");
  return `${m}/${day}`;
}

/** Format units with sign: +12.50u or -3.20u */
function fmtUnits(n: number): string {
  const abs = Math.abs(n).toFixed(2);
  return n >= 0 ? `+${abs}u` : `-${abs}u`;
}

/** Format units short: +12.5u or -3.2u (1 decimal for small cells) */
function fmtUnitsShort(n: number): string {
  const abs = Math.abs(n);
  const str = abs >= 10 ? abs.toFixed(1) : abs.toFixed(2);
  return n >= 0 ? `+${str}u` : `-${str}u`;
}

/** Month name from 1-indexed month number */
const MONTH_NAMES = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

/** Day-of-week headers */
const DAY_HEADERS = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * Compute cell color based on unit value and magnitude.
 * Mirrors Pikkit's green/red intensity scale.
 */
function getCellStyle(units: number, maxMagnitude: number): {
  bg: string;
  text: string;
  border: string;
} {
  if (units === 0) return { bg: "bg-zinc-800/60", text: "text-zinc-400", border: "border-zinc-700/50" };

  // Normalize intensity: 0.0 → 1.0
  const intensity = maxMagnitude > 0 ? Math.min(Math.abs(units) / maxMagnitude, 1.0) : 0.5;

  if (units > 0) {
    // Green scale: light (low) → dark (high)
    if (intensity < 0.25) return { bg: "bg-emerald-900/40",  text: "text-emerald-400", border: "border-emerald-800/40" };
    if (intensity < 0.50) return { bg: "bg-emerald-800/60",  text: "text-emerald-300", border: "border-emerald-700/50" };
    if (intensity < 0.75) return { bg: "bg-emerald-700/80",  text: "text-emerald-100", border: "border-emerald-600/60" };
    return                       { bg: "bg-emerald-600",      text: "text-white",       border: "border-emerald-500" };
  } else {
    // Red scale: light (low) → dark (high)
    if (intensity < 0.25) return { bg: "bg-red-900/40",  text: "text-red-400",  border: "border-red-800/40" };
    if (intensity < 0.50) return { bg: "bg-red-800/60",  text: "text-red-300",  border: "border-red-700/50" };
    if (intensity < 0.75) return { bg: "bg-red-700/80",  text: "text-red-100",  border: "border-red-600/60" };
    return                       { bg: "bg-red-600",      text: "text-white",    border: "border-red-500" };
  }
}

// ─── BetCalendar ─────────────────────────────────────────────────────────────

export function BetCalendar({
  targetUserId,
  unitSize = 100,
  handicapperName = "PREZ BETS",
  initialYearMonth,
}: BetCalendarProps) {
  const [yearMonth, setYearMonth] = useState<string>(
    initialYearMonth ?? currentMonthPt()
  );

  const { year, month } = parseYearMonth(yearMonth);

  if (IS_DEV) console.log(`[BetCalendar][INPUT] yearMonth=${yearMonth} targetUserId=${targetUserId} unitSize=${unitSize}`);

  // ── Server query ─────────────────────────────────────────────────────────
  const calendarQuery = trpc.betTracker.getCalendarData.useQuery(
    {
      yearMonth,
      targetUserId,
      unitSize,
    },
    {
      staleTime: yearMonth < currentMonthPt() ? Infinity : 60_000,
      gcTime:    yearMonth < currentMonthPt() ? 30 * 60_000 : 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    }
  );

  // ── Build day map ─────────────────────────────────────────────────────────
  const dayMap = useMemo(() => {
    const map = new Map<string, { units: number; wins: number; losses: number; pushes: number; pending: number }>();
    if (!calendarQuery.data) return map;
    for (const d of calendarQuery.data.days) {
      map.set(d.date, d);
    }
    if (IS_DEV) console.log(`[BetCalendar][STATE] dayMap built: ${map.size} active days`);
    return map;
  }, [calendarQuery.data]);

  // ── Compute max magnitude for intensity scaling ───────────────────────────
  const maxMagnitude = useMemo(() => {
    if (!calendarQuery.data) return 1;
    let max = 0;
    for (const d of calendarQuery.data.days) {
      if (Math.abs(d.units) > max) max = Math.abs(d.units);
    }
    return max || 1;
  }, [calendarQuery.data]);

  // ── Build calendar grid ───────────────────────────────────────────────────
  const totalDays = daysInMonth(year, month);
  const startDow  = firstDayOfWeek(year, month); // 0=Sun
  const todayStr  = todayPt();

  // Build cells: null = empty padding, number = day of month
  const cells: (number | null)[] = [
    ...Array(startDow).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];
  // Pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null);

  const monthRecord = calendarQuery.data?.monthRecord;
  const netUnits    = monthRecord?.netUnits ?? 0;

  if (IS_DEV) console.log(`[BetCalendar][STATE] grid: ${cells.length} cells totalDays=${totalDays} startDow=${startDow}`);

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

  if (IS_DEV) console.log(`[BetCalendar][OUTPUT] Rendering calendar for ${yearMonth} maxMagnitude=${maxMagnitude.toFixed(2)} monthRecord=${JSON.stringify(monthRecord)}`);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden select-none">
      {/* ── Header ── */}
      <div className="px-5 pt-5 pb-4 border-b border-zinc-800">
        <div className="flex items-start justify-between gap-3">
          {/* Month + Year */}
          <div>
            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-black text-white tracking-tight">
                {MONTH_NAMES[month - 1]}
              </span>
              <span className="text-sm font-mono text-zinc-400">{year}</span>
            </div>
            <p className="text-xs text-zinc-500 mt-0.5 font-mono tracking-wider uppercase">
              {handicapperName}
            </p>
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handlePrev}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors"
              aria-label="Previous month"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={!canGoNext}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Next month"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Calendar Grid ── */}
      <div className="px-4 pt-4 pb-2">
        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 mb-2">
          {DAY_HEADERS.map((d, i) => (
            <div
              key={i}
              className="text-center text-xs font-bold text-zinc-500 tracking-widest py-1"
            >
              {d}
            </div>
          ))}
        </div>

        {/* Loading skeleton */}
        {calendarQuery.isLoading && (
          <div className="grid grid-cols-7 gap-1.5 mb-4">
            {Array.from({ length: 35 }).map((_, i) => (
              <div key={i} className="aspect-square rounded-xl bg-zinc-800/50 animate-pulse" />
            ))}
          </div>
        )}

        {/* Calendar cells */}
        {!calendarQuery.isLoading && (
          <div className="grid grid-cols-7 gap-1.5 mb-4">
            {cells.map((dayNum, idx) => {
              if (dayNum === null) {
                return <div key={`empty-${idx}`} className="aspect-square" />;
              }

              const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
              const dayData = dayMap.get(dateStr);
              const isToday = dateStr === todayStr;
              const isFuture = dateStr > todayStr;

              if (!dayData || (dayData.wins === 0 && dayData.losses === 0 && dayData.pushes === 0 && dayData.pending === 0)) {
                // No bets on this day
                return (
                  <div
                    key={dateStr}
                    className={`aspect-square rounded-xl flex flex-col items-center justify-center transition-colors ${
                      isFuture
                        ? "bg-transparent"
                        : "bg-zinc-800/30"
                    } ${isToday ? "ring-1 ring-emerald-500/60" : ""}`}
                  >
                    <span className={`text-xs font-mono ${isFuture ? "text-zinc-700" : "text-zinc-600"}`}>
                      {dayNum}
                    </span>
                  </div>
                );
              }

              // Day has bets
              const { bg, text, border } = getCellStyle(dayData.units, maxMagnitude);
              const hasPending = dayData.pending > 0;

              return (
                <div
                  key={dateStr}
                  title={`${fmtShortDate(dateStr)}: ${fmtUnits(dayData.units)} (${dayData.wins}W-${dayData.losses}L${dayData.pushes > 0 ? `-${dayData.pushes}P` : ""}${hasPending ? ` +${dayData.pending} pending` : ""})`}
                  className={`aspect-square rounded-xl border flex flex-col items-center justify-center gap-0.5 cursor-default transition-all hover:scale-105 hover:z-10 relative ${bg} ${border} ${isToday ? "ring-2 ring-white/30" : ""}`}
                >
                  <span className={`text-[10px] font-mono font-bold leading-none ${text} opacity-70`}>
                    {dayNum}
                  </span>
                  <span className={`text-[9px] xs:text-[10px] font-black leading-none ${text} tracking-tight`}>
                    {fmtUnitsShort(dayData.units)}
                  </span>
                  {hasPending && (
                    <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-yellow-400" title="Pending bets" />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Month Summary ── */}
      <div className="px-5 pb-5 border-t border-zinc-800 pt-4">
        {calendarQuery.isLoading ? (
          <div className="flex gap-4">
            <div className="h-8 w-24 bg-zinc-800 rounded-lg animate-pulse" />
            <div className="h-8 w-24 bg-zinc-800 rounded-lg animate-pulse" />
          </div>
        ) : monthRecord ? (
          <div className="flex items-center justify-between gap-4">
            {/* Record */}
            <div>
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold mb-0.5">Record</p>
              <p className="text-base font-black text-zinc-200 font-mono">
                {monthRecord.wins}W–{monthRecord.losses}L
                {monthRecord.pushes > 0 && <span className="text-yellow-400">–{monthRecord.pushes}P</span>}
              </p>
            </div>

            {/* Net Units */}
            <div className="text-right">
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold mb-0.5">Net Units</p>
              <p className={`text-base font-black font-mono ${netUnits >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {fmtUnits(netUnits)}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-zinc-500 font-mono">No bets recorded for this month.</p>
        )}
      </div>
    </div>
  );
}

export default BetCalendar;
