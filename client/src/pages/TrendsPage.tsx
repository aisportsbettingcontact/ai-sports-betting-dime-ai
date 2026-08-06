/**
 * TrendsPage — desktop/tablet shell pane for per-game research panels.
 *
 * v2 layout (readability-first):
 *   - The slate is a container-query grid: two game cards per row when the
 *     pane is wide enough (@[52rem] of the PANE, not the viewport — the
 *     shell sidebar eats 264px, so viewport breakpoints lie here), one
 *     stacked column otherwise.
 *   - Each card hosts ONE panel at a time behind a Last 5 Games / Trends
 *     segmented toggle, so cards stay narrow enough for two-up without
 *     shrinking type.
 *   - Below the shell boundary (<768px) each card is an accordion,
 *     collapsed by default; useIsMdUp gates it. (App.tsx currently
 *     redirects /trends to the splits surface below 768px — the accordion
 *     behavior keeps this pane correct wherever it renders narrow.)
 *   - Type floor: no visible text below 11px; data rows 13px.
 *
 * MLB only: the NBA/NHL schedule DBs are not backfilled. The sport filter
 * lives in the games.list query args (sport: "MLB"); the anSlug mapping gate
 * — the same one GameCard applies — is enforced both in the page-level
 * sortedGames memo and again row-level in TrendsGameSection as a safety net.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { CalendarX2, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { CalendarPicker, todayUTC } from "@/components/CalendarPicker";
import RecentSchedulePanel from "@/components/RecentSchedulePanel";
import SituationalResultsPanel from "@/components/SituationalResultsPanel";
import { useVisibility } from "@/hooks/useVisibility";
import { useIsMdUp } from "@/hooks/useIsMdUp";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  formatGameTime,
  timeToMinutes,
  formatDateHeader,
} from "@/lib/gameUtils";
import { MLB_BY_ABBREV } from "@shared/mlbTeams";

/** Minimal structural slice of a games.list row this page reads. */
interface TrendsGameRow {
  id: number;
  awayTeam: string;
  homeTeam: string;
  startTimeEst: string | null;
}

type PanelView = "last5" | "trends";

const PANEL_VIEWS: { key: PanelView; label: string }[] = [
  { key: "last5", label: "Last 5 Games" },
  { key: "trends", label: "Trends" },
];

function TrendsGameSection({ game }: { game: TrendsGameRow }) {
  const [rowRef, isVisible] = useVisibility({ rootMargin: "200px" });
  const isMdUp = useIsMdUp();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<PanelView>("last5");

  const awayMlb = MLB_BY_ABBREV.get(game.awayTeam) ?? null;
  const homeMlb = MLB_BY_ABBREV.get(game.homeTeam) ?? null;
  if (!awayMlb?.anSlug || !homeMlb?.anSlug) return null;

  // ≥md the card is always open; below md it's an accordion (collapsed by
  // default so the slate scans as a compact list).
  const expanded = isMdUp || mobileOpen;

  const onToggleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    setActivePanel(prev => (prev === "last5" ? "trends" : "last5"));
  };

  const headerInner = (
    <>
      <div className="flex items-center gap-2.5 min-w-0">
        {awayMlb.logoUrl && (
          <img
            src={awayMlb.logoUrl}
            alt=""
            loading="lazy"
            className="w-7 h-7 object-contain flex-shrink-0"
          />
        )}
        <h2 className="text-[15px] md:text-[16px] font-bold tracking-tight text-foreground truncate">
          {awayMlb.name}
          <span className="mx-1.5 font-medium text-[var(--text-muted)]">@</span>
          {homeMlb.name}
        </h2>
        {homeMlb.logoUrl && (
          <img
            src={homeMlb.logoUrl}
            alt=""
            loading="lazy"
            className="w-7 h-7 object-contain flex-shrink-0"
          />
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-[11px] font-mono uppercase tracking-[0.08em] tabular-nums text-[var(--text-secondary)] whitespace-nowrap">
          {formatGameTime(game.startTimeEst)}
        </span>
        {!isMdUp &&
          (expanded ? (
            <ChevronUp
              className="w-4 h-4 text-[var(--text-muted)]"
              aria-hidden="true"
            />
          ) : (
            <ChevronDown
              className="w-4 h-4 text-[var(--text-muted)]"
              aria-hidden="true"
            />
          ))}
      </div>
    </>
  );

  return (
    <section
      ref={rowRef}
      aria-label={`${awayMlb.name} at ${homeMlb.name}`}
      className="rounded-2xl border border-border bg-card overflow-hidden flex flex-col min-w-0"
    >
      {/* Matchup header — static ≥md, accordion trigger below md */}
      {isMdUp ? (
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
          {headerInner}
        </div>
      ) : (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setMobileOpen(v => !v)}
          className={cn(
            "w-full flex items-center justify-between gap-3 px-4 py-3 text-left cursor-pointer",
            expanded && "border-b border-border",
            "transition-colors duration-[160ms] ease-[cubic-bezier(0.16,1,0.3,1)]",
            "hover:bg-[var(--row-hover)]"
          )}
        >
          {headerInner}
        </button>
      )}

      {expanded && (
        <>
          {/* Last 5 Games / Trends segmented toggle — one panel at a time
              keeps the card compact enough for two-up rows. */}
          <div
            role="tablist"
            aria-label="Research panel"
            className="flex items-center gap-1.5 px-3 py-2.5 border-b border-border"
          >
            {PANEL_VIEWS.map(v => (
              <button
                type="button"
                key={v.key}
                role="tab"
                aria-selected={activePanel === v.key}
                onClick={() => setActivePanel(v.key)}
                onKeyDown={onToggleKeyDown}
                className={cn(
                  "flex-1 h-9 rounded-full text-[13px] font-semibold cursor-pointer",
                  "transition-[background-color,color,transform] duration-[160ms] ease-[cubic-bezier(0.16,1,0.3,1)]",
                  "active:scale-[0.97] motion-reduce:transform-none",
                  activePanel === v.key
                    ? "bg-[var(--surface-raised)] text-foreground"
                    : "text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--row-hover)]"
                )}
              >
                {v.label}
              </button>
            ))}
          </div>

          <div className="min-w-0 flex-1 flex flex-col">
            {activePanel === "last5" ? (
              <RecentSchedulePanel
                sport="MLB"
                enabled={isVisible}
                awaySlug={awayMlb.anSlug}
                homeSlug={homeMlb.anSlug}
                awayAbbr={awayMlb.abbrev}
                homeAbbr={homeMlb.abbrev}
                awayName={awayMlb.name}
                homeName={homeMlb.name}
                awayLogoUrl={awayMlb.logoUrl}
                homeLogoUrl={homeMlb.logoUrl}
                variant="embedded"
                hideHeader
                defaultCollapsed={false}
                collapsible={false}
              />
            ) : (
              <SituationalResultsPanel
                sport="MLB"
                enabled={isVisible}
                awaySlug={awayMlb.anSlug}
                homeSlug={homeMlb.anSlug}
                awayAbbr={awayMlb.abbrev}
                homeAbbr={homeMlb.abbrev}
                awayName={awayMlb.name}
                homeName={homeMlb.name}
                awayLogoUrl={awayMlb.logoUrl}
                homeLogoUrl={homeMlb.logoUrl}
                variant="embedded"
                hideHeader
                defaultCollapsed={false}
                collapsible={false}
              />
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** Skeleton game card shown while the slate loads — mirrors the real card
 *  geometry so content doesn't jump when data lands. */
function GameCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="rounded-2xl border border-border bg-card overflow-hidden"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="h-5 w-64 max-w-[60%] rounded bg-[var(--surface-raised)] animate-pulse" />
        <div className="h-4 w-16 rounded bg-[var(--surface-raised)] animate-pulse" />
      </div>
      <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-border">
        <div className="h-9 flex-1 rounded-full bg-[var(--surface-raised)] animate-pulse" />
        <div className="h-9 flex-1 rounded-full bg-[var(--surface-raised)] animate-pulse" />
      </div>
      <div className="px-4 py-4 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-8 rounded bg-[var(--surface-raised)] animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}

export default function TrendsPage() {
  const [selectedDate, setSelectedDate] = useState<string>(todayUTC());
  const userSelectedDateRef = useRef(false);

  const { data: serverDateData } = trpc.games.getCurrentDate.useQuery(
    undefined,
    { refetchInterval: 60 * 1000, staleTime: 30 * 1000 }
  );

  // Server-authoritative date sync — mirrors BettingSplits' DateSync fix (see
  // BettingSplits.tsx:459-487). Without it, a pane left open across the daily
  // rollover keeps yesterday's todayUTC() and shows an empty slate while the
  // sibling splits pane advances. Never overrides an explicit user pick.
  useEffect(() => {
    if (!serverDateData?.effectiveDate) return;
    if (userSelectedDateRef.current) return;
    if (serverDateData.effectiveDate !== selectedDate) {
      setSelectedDate(serverDateData.effectiveDate);
    }
  }, [serverDateData, selectedDate]);
  const { data: availableDatesData } = trpc.games.getAvailableDates.useQuery(
    { sport: "MLB" },
    { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false }
  );
  const {
    data: games,
    isLoading,
    isError,
    refetch,
  } = trpc.games.list.useQuery(
    { sport: "MLB", gameDate: selectedDate },
    { refetchOnWindowFocus: false, staleTime: 60 * 1000 }
  );

  const sortedGames = useMemo(
    () =>
      [...(games ?? [])]
        .filter((g): g is NonNullable<typeof g> => g != null)
        .filter(g => {
          const a = MLB_BY_ABBREV.get(g.awayTeam);
          const h = MLB_BY_ABBREV.get(g.homeTeam);
          return Boolean(a?.anSlug && h?.anSlug);
        })
        .sort(
          (a, b) =>
            timeToMinutes(a.startTimeEst) - timeToMinutes(b.startTimeEst)
        ),
    [games]
  );

  return (
    <div className="bg-background min-h-full">
      {/* Solid sticky chrome (Law v2 bans alpha scrims/blur) with a quiet
          hairline as the scroll edge. */}
      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center justify-between gap-2 px-3 md:px-4 py-2">
          <CalendarPicker
            selectedDate={selectedDate}
            onSelect={date => {
              userSelectedDateRef.current = true;
              setSelectedDate(date);
            }}
            availableDates={new Set(availableDatesData?.dates ?? [])}
          />
          <div className="min-w-0 text-center">
            <h1 className="text-[15px] md:text-[17px] font-bold tracking-tight text-foreground leading-tight">
              MLB Trends
            </h1>
            <p className="text-[11px] font-mono uppercase tracking-[0.08em] text-[var(--text-muted)] leading-tight truncate">
              {formatDateHeader(selectedDate)}
            </p>
          </div>
          <span
            className="text-[12px] font-mono uppercase tracking-[0.08em] tabular-nums text-[var(--text-muted)] whitespace-nowrap"
            aria-live="polite"
          >
            {isLoading ? "—" : `${sortedGames.length} games`}
          </span>
        </div>
      </header>

      {/* @container: the games grid answers to the PANE width, not the
          viewport — two cards per row only when they genuinely fit. */}
      <main className="w-full py-3 md:py-4 pb-8 @container">
        {isLoading ? (
          <div
            data-trends-grid
            className="grid grid-cols-1 @[52rem]:grid-cols-2 gap-3 md:gap-4 px-3 md:px-4"
          >
            <GameCardSkeleton />
            <GameCardSkeleton />
            <GameCardSkeleton />
            <GameCardSkeleton />
          </div>
        ) : isError ? (
          <div className="mx-3 md:mx-4 rounded-2xl border border-border bg-card flex flex-col items-center justify-center py-20 px-4 text-center">
            <p className="text-[15px] font-semibold text-foreground mb-1">
              Couldn't load games
            </p>
            <p className="text-[13px] text-[var(--text-muted)] mb-4">
              Something went wrong fetching the slate. Try again in a moment.
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              className={cn(
                "flex items-center gap-1.5 px-4 h-9 rounded-full border border-border",
                "text-[13px] font-semibold text-[var(--text-secondary)] cursor-pointer",
                "transition-colors duration-[160ms] ease-[cubic-bezier(0.16,1,0.3,1)]",
                "hover:text-foreground hover:bg-[var(--row-hover)]",
                "active:scale-[0.97] motion-reduce:transform-none"
              )}
            >
              <RefreshCw className="w-4 h-4" />
              Retry
            </button>
          </div>
        ) : sortedGames.length === 0 ? (
          <div className="mx-3 md:mx-4 rounded-2xl border border-border bg-card flex flex-col items-center justify-center py-20 px-4 text-center">
            <CalendarX2
              className="w-7 h-7 text-[var(--text-muted)] mb-3"
              aria-hidden="true"
            />
            <p className="text-[15px] font-semibold text-foreground mb-1">
              No MLB games on this date
            </p>
            <p className="text-[13px] text-[var(--text-muted)]">
              Last 5 Games and Trends cover MLB matchups. Pick another date.
            </p>
          </div>
        ) : (
          <div
            data-trends-grid
            className="grid grid-cols-1 @[52rem]:grid-cols-2 gap-3 md:gap-4 px-3 md:px-4 items-start"
          >
            {sortedGames.map(g => (
              <TrendsGameSection key={g.id} game={g} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
