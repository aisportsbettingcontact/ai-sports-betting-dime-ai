/**
 * TrendsPage — desktop/tablet shell pane for per-game research panels.
 *
 * Hosts LAST 5 GAMES (RecentSchedulePanel) and TRENDS
 * (SituationalResultsPanel) — the two accordions that used to render under
 * every Betting Splits card at ≥768px. Mobile (<768px) keeps those accordions
 * on the splits surface; App.tsx redirects /trends to /betting-splits below
 * the shell boundary.
 *
 * MLB only: the NBA/NHL schedule DBs are not backfilled. The sport filter
 * lives in the games.list query args (sport: "MLB"); the anSlug mapping gate
 * — the same one GameCard applies — is enforced both in the page-level
 * sortedGames memo and again row-level in TrendsGameSection as a safety net.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { CalendarPicker, todayUTC } from "@/components/CalendarPicker";
import RecentSchedulePanel from "@/components/RecentSchedulePanel";
import SituationalResultsPanel from "@/components/SituationalResultsPanel";
import { useVisibility } from "@/hooks/useVisibility";
import { trpc } from "@/lib/trpc";
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
    <div ref={rowRef} style={{ borderBottom: "1px solid hsl(var(--border))" }}>
      {/* Matchup header row */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-1">
        <span
          className="font-bold uppercase"
          style={{ fontSize: 13, color: "#FFFFFF", letterSpacing: "0.08em" }}
        >
          {awayMlb.name} @ {homeMlb.name}
        </span>
        <span
          style={{
            fontSize: 11,
            color: "#FFFFFF",
            fontFamily: "var(--dime-font-mono)",
            letterSpacing: "0.08em",
          }}
        >
          {formatGameTime(game.startTimeEst)}
        </span>
      </div>
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
        borderColor="hsl(var(--border))"
        defaultCollapsed={true}
      />
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
        borderColor="hsl(var(--border))"
        defaultCollapsed={true}
      />
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
  const { data: games, isLoading, isError } = trpc.games.list.useQuery(
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
    <div className="bg-background">
      <header className="sticky top-0 z-40 bg-background">
        <div className="flex items-center gap-2 px-3 pt-2 pb-1">
          <CalendarPicker
            selectedDate={selectedDate}
            onSelect={date => {
              userSelectedDateRef.current = true;
              setSelectedDate(date);
            }}
            availableDates={new Set(availableDatesData?.dates ?? [])}
          />
        </div>
        <div className="flex items-center justify-center px-4 py-1 border-b border-border">
          <span
            className="font-bold tracking-widest uppercase"
            style={{ fontSize: "clamp(11px, 1.2vw, 19px)", color: "#FFFFFF" }}
          >
            {formatDateHeader(selectedDate)}
            {" · MLB TRENDS"}
          </span>
        </div>
      </header>
      <main className="w-full pb-4">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Loader2
              className="w-8 h-8 animate-spin"
              style={{ color: "#45E0A8" }}
            />
            <p className="text-sm text-muted-foreground">Loading trends…</p>
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
            <p className="text-sm font-semibold text-foreground mb-1">
              Couldn't load games
            </p>
            <p className="text-xs text-muted-foreground">
              Something went wrong fetching the slate. Try again in a moment.
            </p>
          </div>
        ) : sortedGames.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
            <p className="text-sm font-semibold text-foreground mb-1">
              No MLB games found
            </p>
            <p className="text-xs text-muted-foreground">
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
