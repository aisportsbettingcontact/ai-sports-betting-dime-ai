/**
 * CalendarPicker
 *
 * A compact date-picker button that opens a month-view calendar dropdown.
 *
 * ── "TODAY" label logic ───────────────────────────────────────────────────────
 * The button label shows "TODAY" when the selected date matches the "effective
 * feed date" for the current user.  The effective feed date is determined as:
 *
 *   1. Compute the user's local calendar date (YYYY-MM-DD) from their system
 *      clock.  This is timezone-aware — a user in PST at 9 PM sees March 9
 *      while a user in EST at midnight sees March 10.
 *
 *   2. Apply the 11:00 UTC gate: if the current UTC time is before 11:00 UTC,
 *      the effective feed date is (UTC calendar date − 1 day), regardless of
 *      the user's local date.  This keeps the feed on the previous night's
 *      slate until the morning refresh window.
 *
 *   3. If the user's local calendar date is AHEAD of the effective feed date
 *      (i.e. they are already in "tomorrow" locally but the 11:00 UTC gate
 *      has not fired yet), the calendar button shows the effective feed date
 *      formatted as "MONTH DAY" — NOT "TODAY" — because their local "today"
 *      is not yet the active feed date.
 *
 *   4. If the user's local calendar date MATCHES the effective feed date, the
 *      button shows "TODAY".
 *
 * ── Debug logging ─────────────────────────────────────────────────────────────
 * All timezone/date computations are logged to the browser console under the
 * [CalendarPicker:tz] group at component mount and whenever the clock ticks
 * past the 11:00 UTC boundary.  The log includes:
 *   - UTC wall-clock time
 *   - User local date (from Intl.DateTimeFormat)
 *   - Effective feed date
 *   - Whether the 11:00 UTC gate is open
 *   - Whether "TODAY" label is shown
 *   - Simulated results for HST, PST, MST, CST, EST at the current UTC instant
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────────────

/** UTC hour at which the feed rolls over to the new calendar day's slate */
const FEED_CUTOFF_UTC_HOUR = 11;

/** IANA timezone IDs used for the 5-timezone debug simulation */
const DEBUG_TIMEZONES = [
  { label: "HST", iana: "Pacific/Honolulu" },
  { label: "PST", iana: "America/Los_Angeles" },
  { label: "MST", iana: "America/Denver" },
  { label: "CST", iana: "America/Chicago" },
  { label: "EST", iana: "America/New_York" },
] as const;

// ── Date helpers ──────────────────────────────────────────────────────────────

/**
 * Returns the YYYY-MM-DD calendar date for a given IANA timezone at a given
 * UTC instant (defaults to now).
 */
function localDateInTz(ianaTimezone: string, atMs?: number): string {
  const ms = atMs ?? Date.now();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ianaTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const y = parts.find(p => p.type === "year")?.value ?? "0000";
  const m = parts.find(p => p.type === "month")?.value ?? "01";
  const d = parts.find(p => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

/**
 * Returns the user's local calendar date (YYYY-MM-DD) using the browser's
 * own timezone (Intl.DateTimeFormat resolvedOptions).
 */
function userLocalDate(atMs?: number): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return localDateInTz(tz, atMs);
}

/**
 * Returns the effective feed date as YYYY-MM-DD.
 *
 * Rule:
 *   - If UTC hour < 11 → effective date = (UTC calendar date − 1 day)
 *   - Otherwise        → effective date = UTC calendar date
 *
 * This is the same logic used by `todayUTC()` (exported for consumers that
 * need the raw effective date without the "TODAY" label decision).
 */

/**
 * MANUAL WC DATE OVERRIDE
 *
 * Set to a YYYY-MM-DD string to force the WC calendar to treat that date as
 * "today" regardless of the real UTC clock.  Set to null to revert to the
 * automatic 11:00 UTC cutoff logic.
 *
 * This is the ONLY place that needs to change for a manual date advance.
 * No other code should hardcode dates.
 */
export const MANUAL_WC_DATE_OVERRIDE: string | null = '2026-06-27';

export function todayUTC(atMs?: number): string {
  // [MANUAL OVERRIDE] Single authoritative override point.
  // Set MANUAL_WC_DATE_OVERRIDE above to null to restore automatic logic.
  if (MANUAL_WC_DATE_OVERRIDE !== null) {
    return MANUAL_WC_DATE_OVERRIDE;
  }
  const ms = atMs ?? Date.now();
  const now = new Date(ms);
  const isBeforeCutoff = now.getUTCHours() < FEED_CUTOFF_UTC_HOUR;
  const effectiveMs = isBeforeCutoff ? ms - 24 * 60 * 60 * 1000 : ms;
  const d = new Date(effectiveMs);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

/**
 * Decides whether to show "TODAY" for a given selectedDate.
 *
 * Returns true only when:
 *   - selectedDate === effectiveFeedDate, AND
 *   - user's local calendar date === effectiveFeedDate
 *     (i.e. the user has NOT rolled into "tomorrow" locally yet)
 *
 * If the user is locally ahead (e.g. EST midnight while UTC gate hasn't
 * fired), we show the formatted date instead of "TODAY".
 */
function shouldShowToday(selectedDate: string, atMs?: number): boolean {
  const ms = atMs ?? Date.now();
  const effectiveDate = todayUTC(ms);
  if (selectedDate !== effectiveDate) return false;
  const localDate = userLocalDate(ms);
  return localDate === effectiveDate;
}

/**
 * Emits a comprehensive timezone debug log to the browser console.
 * Simulates the effective feed date and "TODAY" decision for all 5 US
 * timezones at the given UTC instant.
 */
function emitTzDebugLog(atMs?: number): void {
  const ms = atMs ?? Date.now();
  const now = new Date(ms);
  const utcStr = now.toISOString();
  const effectiveDate = todayUTC(ms);
  const isBeforeCutoff = now.getUTCHours() < FEED_CUTOFF_UTC_HOUR;
  const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localDate = userLocalDate(ms);
  const showToday = shouldShowToday(effectiveDate, ms);

  console.groupCollapsed(
    `%c[CalendarPicker:tz] ${utcStr}`,
    "color:#39FF14;font-weight:700;font-size:11px"
  );
  console.log(`UTC wall clock  : ${utcStr}`);
  console.log(`UTC hour        : ${now.getUTCHours()} (cutoff=${FEED_CUTOFF_UTC_HOUR}, gate open=${!isBeforeCutoff})`);
  console.log(`Effective date  : ${effectiveDate}`);
  console.log(`User timezone   : ${userTz}`);
  console.log(`User local date : ${localDate}`);
  console.log(`Show "TODAY"    : ${showToday}`);
  console.log("── 5-timezone simulation ──────────────────────────────────────");
  DEBUG_TIMEZONES.forEach(({ label, iana }) => {
    const tzLocalDate = localDateInTz(iana, ms);
    const tzLocalTime = new Intl.DateTimeFormat("en-US", {
      timeZone: iana,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).format(new Date(ms));
    const tzShowToday = tzLocalDate === effectiveDate;
    const tzLabel = tzShowToday ? "TODAY" : `${tzLocalDate} (no TODAY)`;
    console.log(`  ${label.padEnd(4)} | local=${tzLocalDate} ${tzLocalTime} | feed=${effectiveDate} | label=${tzLabel}`);
  });
  console.groupEnd();
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatButtonLabel(dateStr: string, atMs?: number): string {
  if (shouldShowToday(dateStr, atMs)) return "TODAY";
  try {
    const d = new Date(dateStr + "T00:00:00Z");
    const month = d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }).toUpperCase();
    const day = d.getUTCDate();
    return `${month} ${day}`;
  } catch {
    return dateStr;
  }
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay(); // 0=Sun
}

function toDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Compare two YYYY-MM-DD strings. Returns negative if a < b, 0 if equal, positive if a > b */
function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface CalendarPickerProps {
  /** Currently selected date as YYYY-MM-DD */
  selectedDate: string;
  /** Called when user picks a date */
  onSelect: (date: string) => void;
  /** Set of YYYY-MM-DD strings that have games (shown with dot) */
  availableDates?: Set<string>;
  /** If true, past dates are also selectable (admin/owner bypass) */
  isAdmin?: boolean;
}

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

export function CalendarPicker({ selectedDate, onSelect, availableDates, isAdmin = false }: CalendarPickerProps) {
  // Reactive "now" — re-computed every minute so the label updates when the
  // 11:00 UTC gate fires without requiring a page reload.
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    // Emit initial debug log on mount
    emitTzDebugLog(nowMs);

    // Tick every 60 seconds; emit a new debug log each tick
    const id = setInterval(() => {
      const ms = Date.now();
      setNowMs(ms);
      // Only emit a full debug log when crossing the UTC cutoff boundary
      const prev = new Date(ms - 60_000);
      const curr = new Date(ms);
      const crossedCutoff =
        prev.getUTCHours() < FEED_CUTOFF_UTC_HOUR &&
        curr.getUTCHours() >= FEED_CUTOFF_UTC_HOUR;
      if (crossedCutoff) {
        console.log("%c[CalendarPicker:tz] 11:00 UTC gate FIRED — feed rolling to new date", "color:#39FF14;font-weight:700");
        emitTzDebugLog(ms);
      }
    }, 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const today = todayUTC(nowMs);

  // Calendar view state — default to the month of the selected date (or today)
  const displayBase = selectedDate ?? today;
  const [viewYear, setViewYear] = useState(() => parseInt(displayBase.slice(0, 4)));
  const [viewMonth, setViewMonth] = useState(() => parseInt(displayBase.slice(5, 7)) - 1);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Phase 10 — Fix viewport clipping on narrow screens (375px phones)
  // When the dropdown opens near the right edge, switch to right-aligned.
  useEffect(() => {
    if (!open || !dropdownRef.current) return;
    const rect = dropdownRef.current.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) {
      dropdownRef.current.style.left = 'auto';
      dropdownRef.current.style.right = '0';
    } else {
      dropdownRef.current.style.left = '0';
      dropdownRef.current.style.right = 'auto';
    }
  }, [open]);

  // When selectedDate changes externally, sync the calendar view to that month
  useEffect(() => {
    if (selectedDate) {
      setViewYear(parseInt(selectedDate.slice(0, 4)));
      setViewMonth(parseInt(selectedDate.slice(5, 7)) - 1);
    }
  }, [selectedDate]);

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfMonth(viewYear, viewMonth);

  function prevMonth() {
    if (!isAdmin) {
      const todayYear = parseInt(today.slice(0, 4));
      const todayMon = parseInt(today.slice(5, 7)) - 1;
      if (viewYear === todayYear && viewMonth === todayMon) return;
      if (viewYear < todayYear) return;
    }
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  }

  const handleDayClick = useCallback((day: number) => {
    const dateStr = toDateStr(viewYear, viewMonth, day);
    const isPast = compareDates(dateStr, today) < 0;
    if (isPast && !isAdmin) return;
    onSelect(dateStr);
    setOpen(false);
  }, [viewYear, viewMonth, today, isAdmin, onSelect]);

  const buttonLabel = formatButtonLabel(selectedDate ?? today, nowMs);

  const prevDisabled = !isAdmin && (() => {
    const todayYear = parseInt(today.slice(0, 4));
    const todayMon = parseInt(today.slice(5, 7)) - 1;
    return viewYear === todayYear && viewMonth === todayMon;
  })();

  return (
    <div ref={containerRef} className="relative flex-shrink-0">
      {/* Trigger button */}
      <button type="button" onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 sm:gap-1.5 md:gap-2 px-1.5 sm:px-2.5 md:px-3 py-1 sm:py-1.5 md:py-2 rounded-full text-sm sm:text-sm md:text-[13px] font-bold tracking-wide transition-all flex-shrink-0"
        style={{
          background: "hsl(var(--card))",
          color: "#ffffff",
          border: "1px solid rgba(255,255,255,0.35)",
        }}
      >
        <CalendarDays className="w-3 h-3 md:w-4 md:h-4 flex-shrink-0" style={{ color: "rgba(255,255,255,0.6)" }} />
        <span>{buttonLabel}</span>
      </button>

      {/* Dropdown calendar */}
      {open && (
        <div
          ref={dropdownRef}
          className="absolute left-0 top-full mt-1.5 z-50 rounded-xl border border-white/10 shadow-2xl overflow-hidden"
          style={{ background: "#0f0f0f", width: 220 }}
        >
          {/* Month navigation header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
            <button type="button" onClick={prevMonth}
              disabled={prevDisabled}
              className="w-6 h-6 flex items-center justify-center rounded-full transition-colors"
              style={{
                color: prevDisabled ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.6)",
                cursor: prevDisabled ? "not-allowed" : "pointer",
              }}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs font-bold text-white tracking-widest uppercase">
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <button type="button" onClick={nextMonth}
              className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
              style={{ color: "rgba(255,255,255,0.6)" }}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 px-2 pt-2 pb-1">
            {DAYS.map(d => (
              <div key={d} className="text-center text-xs font-bold tracking-widest" style={{ color: "rgba(255,255,255,0.3)" }}>
                {d}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 px-2 pb-2 gap-y-0.5">
            {Array.from({ length: firstDay }).map((_, i) => (
              <div key={`empty-${i}`} />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dateStr = toDateStr(viewYear, viewMonth, day);
              const isToday = dateStr === today;
              const isSelected = dateStr === selectedDate;
              const isPast = compareDates(dateStr, today) < 0;
              const isLocked = isPast && !isAdmin;
              const hasGames = (availableDates?.has(dateStr) ?? false) && (!isPast || isAdmin);

              const dayStyle: React.CSSProperties = (() => {
                if (isLocked)              return { color: "rgba(255,255,255,0.12)", cursor: "not-allowed" };
                if (isSelected && isToday) return { background: "#ffffff", color: "#000000", outline: "2px solid #39FF14", outlineOffset: "1px" };
                if (isSelected)            return { background: "#ffffff", color: "#000000" };
                if (isToday)               return { background: "rgba(57,255,20,0.12)", color: "#39FF14", outline: "1.5px solid #39FF14", outlineOffset: "-1px" };
                if (hasGames)              return { color: "#ffffff" };
                return { color: "rgba(255,255,255,0.3)" };
              })();

              return (
                <button type="button" key={day}
                  onClick={() => handleDayClick(day)}
                  disabled={isLocked}
                  className="relative flex flex-col items-center justify-center w-full aspect-square rounded-full text-sm font-bold transition-all"
                  style={dayStyle}
                >
                  {day}
                  {hasGames && !isSelected && (
                    <span
                      className="absolute bottom-0.5 left-1/2 -translate-x-1/2 rounded-full"
                      style={{ width: 3, height: 3, background: isToday ? "#39FF14" : "rgba(57,255,20,0.8)" }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
