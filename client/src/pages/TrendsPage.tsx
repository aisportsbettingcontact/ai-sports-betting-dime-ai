/**
 * TrendsPage — desktop/tablet shell pane for per-game research panels.
 *
 * Hosts LAST 5 GAMES (RecentSchedulePanel) and TRENDS
 * (SituationalResultsPanel) — the two accordions that used to render under
 * every Betting Splits card at ≥768px. Mobile (<768px) keeps those accordions
 * on the splits surface; App.tsx redirects /trends to /betting-splits below
 * the shell boundary.
 *
 * Layout: each game is a Law-v2 card (tier-1 surface, quiet hairline, 16px
 * radius). Inside, the two panels sit side by side at ≥1280px (xl) and stack
 * on narrower panes — the old forced 2-col at 768px cramped tablets. Panels
 * render variant="embedded" so the card owns the chrome; h-full flex columns
 * keep both halves visually filled (no dead whitespace under the shorter
 * panel).
 *
 * MLB only: the NBA/NHL schedule DBs are not backfilled. The sport filter
 * lives in the games.list query args (sport: "MLB"); the anSlug mapping gate
 * — the same one GameCard applies — is enforced both in the page-level
 * sortedGames memo and again row-level in TrendsGameSection as a safety net.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarX2, RefreshCw } from "lucide-react";
import { CalendarPicker, todayUTC } from "@/components/CalendarPicker";
import RecentSchedulePanel from "@/components/RecentSchedulePanel";
import SituationalResultsPanel from "@/components/SituationalResultsPanel";
import { useVisibility } from "@/hooks/useVisibility";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { formatGameTime, timeToMinutes, formatDateHeader } from "@/lib/gameUtils";
import { MLB_BY_ABBREV } from "@shared/mlbTeams";

/** Minimal structural slice of a games.list row this page reads. */
interface TrendsGameRow {
  id: number;
  awayTeam: string;
  homeTeam: string;
  startTimeEst: string | null;
}

function TrendsGameSection({ game }: { game: TrendsGameRow }) {
  const [rowRef, isVisible] = useVisibility({ rootMargin: "200px" });
  const awayMlb = MLB_BY_ABBREV.get(game.awayTeam) ?? null;
  const homeMlb = MLB_BY_ABBREV.get(game.homeTeam) ?? null;
  if (!awayMlb?.anSlug || !homeMlb?.anSlug) return null;
  return (
    <section
      ref={rowRef}
      aria-label={`${awayMlb.name} at ${homeMlb.name}`}
      className="mx-3 md:mx-4 rounded-2xl border border-border bg-card overflow-hidden"
    >
      {/* Matchup header row */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2.5 min-w-0">
          {awayMlb.logoUrl && (
            <img
              src={awayMlb.logoUrl}
              alt=""
              loading="lazy"
              className="w-6 h-6 object-contain flex-shrink-0"
            />
          )}
          <h2 className="text-[13px] md:text-[15px] font-bold tracking-tight text-foreground truncate">
            {awayMlb.name}
            <span className="mx-1.5 font-medium text-[var(--text-muted)]">@</span>
            {homeMlb.name}
          </h2>
          {homeMlb.logoUrl && (
            <img
              src={homeMlb.logoUrl}
              alt=""
              loading="lazy"
              className="w-6 h-6 object-contain flex-shrink-0"
            />
          )}
        </div>
        <span className="text-[10px] font-mono uppercase tracking-[0.08em] tabular-nums text-[var(--text-secondary)] whitespace-nowrap">
          {formatGameTime(game.startTimeEst)}
        </span>
      </div>
      {/* One row per game: Last 5 Games | Trends. Side by side at xl+, stacked
          below. min-w-0 columns so the panels' internal tables shrink instead
          of forcing horizontal overflow; h-full flex panels fill the row so
          the shorter half never leaves dead whitespace. */}
      <div
        data-trends-game-row
        className="grid grid-cols-1 xl:grid-cols-2 divide-y xl:divide-y-0 xl:divide-x divide-border items-stretch"
      >
        <div className="min-w-0">
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
            defaultCollapsed={false}
            collapsible={false}
          />
        </div>
        <div className="min-w-0">
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
            defaultCollapsed={false}
            collapsible={false}
          />
        </div>
      </div>
    </section>
  );
}

/** Skeleton game card shown while the slate loads — mirrors the real card
 *  geometry so content doesn't jump when data lands. */
function GameCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="mx-3 md:mx-4 rounded-2xl border border-border bg-card overflow-hidden"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="h-4 w-64 max-w-[60%] rounded bg-[var(--surface-raised)] animate-pulse" />
        <div className="h-3 w-16 rounded bg-[var(--surface-raised)] animate-pulse" />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 divide-y xl:divide-y-0 xl:divide-x divide-border">
        {[0, 1].map(col => (
          <div key={col} className="px-4 py-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-6 rounded bg-[var(--surface-raised)] animate-pulse" />
            ))}
          </div>
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
  const { data: games, isLoading, isError, refetch } = trpc.games.list.useQuery(
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
            <h1 className="text-[13px] md:text-[15px] font-bold tracking-tight text-foreground leading-tight">
              MLB Trends
            </h1>
            <p className="text-[9px] md:text-[10px] font-mono uppercase tracking-[0.08em] text-[var(--text-muted)] leading-tight truncate">
              {formatDateHeader(selectedDate)}
            </p>
          </div>
          <span
            className="text-[10px] font-mono uppercase tracking-[0.08em] tabular-nums text-[var(--text-muted)] whitespace-nowrap"
            aria-live="polite"
          >
            {isLoading ? "—" : `${sortedGames.length} games`}
          </span>
        </div>
      </header>

      <main className="w-full py-3 md:py-4 space-y-3 md:space-y-4 pb-8">
        {isLoading ? (
          <>
            <GameCardSkeleton />
            <GameCardSkeleton />
            <GameCardSkeleton />
          </>
        ) : isError ? (
          <div className="mx-3 md:mx-4 rounded-2xl border border-border bg-card flex flex-col items-center justify-center py-20 px-4 text-center">
            <p className="text-sm font-semibold text-foreground mb-1">
              Couldn't load games
            </p>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              Something went wrong fetching the slate. Try again in a moment.
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              className={cn(
                "flex items-center gap-1.5 px-4 h-9 rounded-full border border-border",
                "text-[12px] font-semibold text-[var(--text-secondary)] cursor-pointer",
                "transition-colors duration-[160ms] ease-[cubic-bezier(0.16,1,0.3,1)]",
                "hover:text-foreground hover:bg-[var(--row-hover)]",
                "active:scale-[0.97] motion-reduce:transform-none"
              )}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry
            </button>
          </div>
        ) : sortedGames.length === 0 ? (
          <div className="mx-3 md:mx-4 rounded-2xl border border-border bg-card flex flex-col items-center justify-center py-20 px-4 text-center">
            <CalendarX2 className="w-6 h-6 text-[var(--text-muted)] mb-3" aria-hidden="true" />
            <p className="text-sm font-semibold text-foreground mb-1">
              No MLB games on this date
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              Last 5 Games and Trends cover MLB matchups. Pick another date.
            </p>
          </div>
        ) : (
          sortedGames.map(g => <TrendsGameSection key={g.id} game={g} />)
        )}
      </main>
    </div>
  );
}
