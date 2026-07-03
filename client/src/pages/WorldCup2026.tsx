/**
 * WorldCup2026.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * FIFA World Cup 2026 — Multi-tab page
 *
 * Sub-tabs: PROJECTIONS | SPLITS | LINEUPS | STANDINGS | FUTURES
 *
 * PROJECTIONS tab:
 *   • Date selector (June 11–17)
 *   • Per-match cards: 3-way market layout
 *     - HOME ML (Book | Model)
 *     - DRAW    (Book | Model)
 *     - AWAY ML (Book | Model)
 *     - OVER    (Book | Model)
 *     - UNDER   (Book | Model)
 *   • Primary book: DK NJ (book_id=68) from Action Network
 *
 * Data sources:
 *   trpc.wc2026.todayWithOdds     → today's matchs + DK 1X2 + TOTAL odds
 *   trpc.wc2026.matchesByDate    → matchs for a specific date + DK odds
 */

import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarDays, MapPin, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { todayUTC } from "@/components/CalendarPicker";

// ─── Constants ────────────────────────────────────────────────────────────────

const WC_DATE_RANGE = [
  "2026-06-11",
  "2026-06-12",
  "2026-06-13",
  "2026-06-14",
  "2026-06-15",
  "2026-06-16",
  "2026-06-17",
  "2026-06-18",
  "2026-06-19",
  "2026-06-20",
  "2026-06-21",
  "2026-06-22",
  "2026-06-23",
  "2026-06-24",
  "2026-06-25",
  "2026-06-26",
  "2026-06-27",
  "2026-06-28",
  "2026-06-29",
  "2026-06-30",
  "2026-07-01",
  "2026-07-02",
  "2026-07-03",
  "2026-07-04",
  "2026-07-05",
  "2026-07-06",
  "2026-07-07",
  "2026-07-08",
  "2026-07-09",
  "2026-07-10",
  "2026-07-11",
  "2026-07-12",
  "2026-07-13",
  "2026-07-14",
  "2026-07-15",
  "2026-07-16",
  "2026-07-17",
  "2026-07-18",
  "2026-07-19",
];

const WC_DATE_LABELS: Record<string, string> = {
  "2026-06-11": "Thu Jun 11",
  "2026-06-12": "Fri Jun 12",
  "2026-06-13": "Sat Jun 13",
  "2026-06-14": "Sun Jun 14",
  "2026-06-15": "Mon Jun 15",
  "2026-06-16": "Tue Jun 16",
  "2026-06-17": "Wed Jun 17",
  "2026-06-18": "Thu Jun 18",
  "2026-06-19": "Fri Jun 19",
  "2026-06-20": "Sat Jun 20",
  "2026-06-21": "Sun Jun 21",
  "2026-06-22": "Mon Jun 22",
  "2026-06-23": "Tue Jun 23",
  "2026-06-24": "Wed Jun 24",
  "2026-06-25": "Thu Jun 25",
  "2026-06-26": "Fri Jun 26",
  "2026-06-27": "Sat Jun 27",
  "2026-06-28": "Sun Jun 28",
  "2026-06-29": "Mon Jun 29",
  "2026-06-30": "Tue Jun 30",
  "2026-07-01": "Wed Jul 1",
  "2026-07-02": "Thu Jul 2",
  "2026-07-03": "Fri Jul 3",
  "2026-07-04": "Sat Jul 4",
  "2026-07-05": "Sun Jul 5",
  "2026-07-06": "Mon Jul 6",
  "2026-07-07": "Tue Jul 7",
  "2026-07-08": "Wed Jul 8",
  "2026-07-09": "Thu Jul 9",
  "2026-07-10": "Fri Jul 10",
  "2026-07-11": "Sat Jul 11",
  "2026-07-12": "Sun Jul 12",
  "2026-07-13": "Mon Jul 13",
  "2026-07-14": "Tue Jul 14",
  "2026-07-15": "Wed Jul 15",
  "2026-07-16": "Thu Jul 16",
  "2026-07-17": "Fri Jul 17",
  "2026-07-18": "Sat Jul 18",
  "2026-07-19": "Sun Jul 19",
};

const SUB_TABS = ["PROJECTIONS", "SPLITS", "LINEUPS", "STANDINGS", "FUTURES"] as const;
type SubTab = (typeof SUB_TABS)[number];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtAmerican(odds: number | undefined | null): string {
  if (odds == null) return "—";
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function fmtKickoff(kickoffUtc: Date | string | null | undefined): string {
  if (!kickoffUtc) return "TBD";
  const d = new Date(kickoffUtc);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: "America/New_York",
  });
}

function getDefaultDate(): string {
  // [FIX 2026-06-24] Use todayUTC() which respects MANUAL_WC_DATE_OVERRIDE.
  const today = todayUTC();
  if (WC_DATE_RANGE.includes(today)) return today;
  return "2026-06-11";
}

// ─── Type definitions ─────────────────────────────────────────────────────────

type DkOdds = {
  home?: number;
  away?: number;
  draw?: number;
  overLine?: number;
  overOdds?: number;
  underOdds?: number;
} | null;

type MatchWithTeams = {
  matchId: string;
  matchDate: string | Date;
  kickoffUtc: Date | string | null;
  groupLetter: string | null;
  matchday: number | null;
  homeTeamId: string;
  awayTeamId: string;
  venueId: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  isHostHome: boolean;
  homeTeam: {
    teamId: string;
    name: string;
    fifaCode: string;
    flagUrl: string;
    groupLetter: string;
  } | null;
  awayTeam: {
    teamId: string;
    name: string;
    fifaCode: string;
    flagUrl: string;
    groupLetter: string;
  } | null;
  venue: {
    venueId: string;
    city: string;
    country: string;
    stadium: string;
    timezone: string;
    elevationM: number;
  } | null;
  dkOdds?: DkOdds;
  modelOdds?: DkOdds;
};

// ─── Odds Row Component ───────────────────────────────────────────────────────

function OddsRow({
  label,
  bookOdds,
  modelOdds,
}: {
  label: string;
  bookOdds: number | undefined | null;
  modelOdds?: number | undefined | null;
}) {
  const bookStr = fmtAmerican(bookOdds);

  return (
    <div className="flex items-center justify-between gap-1 py-[3px]">
      <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-medium w-[56px] flex-shrink-0">
        {label}
      </span>
      <div className="flex items-center gap-3 flex-1 justify-end">
        {/* Book odds */}
        <span
          className={cn(
            "text-xs font-bold tabular-nums w-[44px] text-right",
            bookStr === "—" ? "text-zinc-600" : "text-zinc-100"
          )}
        >
          {bookStr}
        </span>
        {/* Model odds */}
        <span
          className="text-xs tabular-nums w-[44px] text-right font-bold"
          style={{ color: modelOdds != null ? '#39FF14' : undefined }}
        >
          {modelOdds != null ? fmtAmerican(modelOdds) : <span className="text-zinc-600">—</span>}
        </span>
      </div>
    </div>
  );
}

// ─── Match Card ─────────────────────────────────────────────────────────────

function MatchCard({ match }: { match: MatchWithTeams }) {
  const { homeTeam, awayTeam, venue, dkOdds, modelOdds, status } = match;
  const isLive = status === "LIVE";
  const isFinal = status === "FT";
  const hasOdds =
    dkOdds != null &&
    (dkOdds.home != null || dkOdds.away != null || dkOdds.draw != null);
  const hasModel =
    modelOdds != null &&
    (modelOdds.home != null || modelOdds.away != null || modelOdds.draw != null);
  const totalLine = dkOdds?.overLine ?? 2.5;

  return (
    <div
      className={cn(
        "rounded-xl border transition-all duration-150",
        "bg-[#0f0f0f] border-white/8",
        isLive && "border-emerald-500/40 shadow-[0_0_12px_rgba(34,197,94,0.08)]"
      )}
    >
      {/* ── Card header: group + kickoff ── */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <div className="flex items-center gap-2">
          {match.groupLetter && (
            <span className="text-[9px] text-zinc-500 uppercase tracking-widest font-bold border border-zinc-700 rounded px-1.5 py-0.5">
              GROUP {match.groupLetter} · MD{match.matchday}
            </span>
          )}
          {isLive && (
            <span className="text-[9px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold rounded animate-pulse">
              LIVE
            </span>
          )}
          {isFinal && (
            <span className="text-[9px] px-1.5 py-0.5 border border-zinc-700 text-zinc-500 font-bold rounded">
              FT
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 text-[10px] text-zinc-500">
          <Clock className="w-3 h-3" />
          <span>{fmtKickoff(match.kickoffUtc)}</span>
        </div>
      </div>

      {/* ── Teams row ── */}
      <div className="flex items-center gap-2 px-3 pb-3">
        {/* Away team */}
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <img
            src={
              awayTeam?.flagUrl ??
              `https://flagcdn.com/w40/${awayTeam?.teamId ?? "xx"}.png`
            }
            alt={awayTeam?.fifaCode ?? ""}
            className="w-7 h-5 object-cover rounded-sm flex-shrink-0 border border-white/10"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
          <div className="min-w-0">
            <div className="text-xs font-bold text-zinc-100 truncate">
              {awayTeam?.name ?? match.awayTeamId}
            </div>
            <div className="text-[9px] text-zinc-500 uppercase tracking-widest">
              {awayTeam?.fifaCode ?? ""}
            </div>
          </div>
        </div>

        {/* Score or VS */}
        <div className="flex flex-col items-center gap-0.5 flex-shrink-0 w-10">
          {isFinal || isLive ? (
            <div className="text-sm font-bold text-zinc-100 tabular-nums">
              {match.awayScore ?? 0} – {match.homeScore ?? 0}
            </div>
          ) : (
            <div className="text-xs text-zinc-600 font-bold">VS</div>
          )}
        </div>

        {/* Home team */}
        <div className="flex-1 flex items-center gap-2 min-w-0 flex-row-reverse">
          <img
            src={
              homeTeam?.flagUrl ??
              `https://flagcdn.com/w40/${homeTeam?.teamId ?? "xx"}.png`
            }
            alt={homeTeam?.fifaCode ?? ""}
            className="w-7 h-5 object-cover rounded-sm flex-shrink-0 border border-white/10"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
          <div className="min-w-0 text-right">
            <div className="text-xs font-bold text-zinc-100 truncate">
              {homeTeam?.name ?? match.homeTeamId}
            </div>
            <div className="text-[9px] text-zinc-500 uppercase tracking-widest">
              {homeTeam?.fifaCode ?? ""}
            </div>
          </div>
        </div>
      </div>

      {/* ── Odds grid ── */}
      <div className="border-t border-white/6 px-3 pt-2 pb-3">
        {/* Column headers */}
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[9px] text-zinc-600 uppercase tracking-widest w-[56px]">
            {hasOdds ? "DK NJ" : "Odds pending"}
          </span>
          <div className="flex items-center gap-3 flex-1 justify-end">
            <span className="text-[9px] text-zinc-400 uppercase tracking-widest font-bold w-[44px] text-right">
              BOOK
            </span>
            <span className="text-[9px] uppercase tracking-widest font-bold w-[44px] text-right" style={{ color: '#39FF14' }}>
              MODEL
            </span>
          </div>
        </div>

        {/* 1X2 rows */}
        <OddsRow label="HOME ML" bookOdds={hasOdds ? dkOdds?.home : null} modelOdds={hasModel ? modelOdds?.home : null} />
        <OddsRow label="DRAW" bookOdds={hasOdds ? dkOdds?.draw : null} modelOdds={hasModel ? modelOdds?.draw : null} />
        <OddsRow label="AWAY ML" bookOdds={hasOdds ? dkOdds?.away : null} modelOdds={hasModel ? modelOdds?.away : null} />

        {/* Divider */}
        <div className="border-t border-white/4 my-1.5" />

        {/* Total rows */}
        <OddsRow
          label={`O ${totalLine}`}
          bookOdds={hasOdds ? (dkOdds?.overOdds ?? null) : null}
          modelOdds={hasModel ? (modelOdds?.overOdds ?? null) : null}
        />
        <OddsRow
          label={`U ${totalLine}`}
          bookOdds={hasOdds ? (dkOdds?.underOdds ?? null) : null}
          modelOdds={hasModel ? (modelOdds?.underOdds ?? null) : null}
        />
      </div>

      {/* ── Venue ── */}
      {venue && (
        <div className="border-t border-white/6 px-3 py-2 flex items-center gap-1 text-[10px] text-zinc-600">
          <MapPin className="w-3 h-3 flex-shrink-0" />
          <span>
            {venue.stadium}, {venue.city}
          </span>
          {venue.elevationM > 500 && (
            <span className="ml-1 text-amber-500/70">
              ⚠ {venue.elevationM}m alt
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function MatchCardSkeleton() {
  return (
    <div className="rounded-xl border border-white/8 bg-[#0f0f0f] p-4 space-y-3">
      <div className="flex justify-between">
        <Skeleton className="h-4 w-24 bg-zinc-800" />
        <Skeleton className="h-4 w-16 bg-zinc-800" />
      </div>
      <div className="flex items-center gap-3">
        <Skeleton className="h-5 w-7 bg-zinc-800 rounded-sm" />
        <Skeleton className="h-4 w-24 bg-zinc-800" />
        <Skeleton className="h-4 w-8 bg-zinc-800 mx-auto" />
        <Skeleton className="h-4 w-24 bg-zinc-800" />
        <Skeleton className="h-5 w-7 bg-zinc-800 rounded-sm" />
      </div>
      <div className="pt-2 border-t border-white/6 space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex justify-between">
            <Skeleton className="h-3 w-16 bg-zinc-800" />
            <Skeleton className="h-3 w-12 bg-zinc-800" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Projections Date Feed ────────────────────────────────────────────────────

function ProjectionsFeed({ date }: { date: string }) {
  // [FIX 2026-06-24] Always use matchesByDate(date) — never todayWithOdds.
  // todayWithOdds uses the server's real UTC clock which can disagree with
  // MANUAL_WC_DATE_OVERRIDE, causing wrong matchs to load.
  const dateQuery = trpc.wc2026.matchesByDate.useQuery(
    { date },
    {
      enabled: !!date,
      staleTime: 60 * 1000,
      refetchInterval: 60 * 1000,
    }
  );

  const { data: matchs, isLoading } = dateQuery;

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <MatchCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (!matchs || matchs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <CalendarDays className="w-8 h-8 text-zinc-600" />
        <div className="text-zinc-500 text-sm">
          No World Cup matchs on {WC_DATE_LABELS[date] ?? date}
        </div>
        <div className="text-zinc-600 text-xs">
          Group stage runs June 11 – July 2, 2026
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {(matchs as MatchWithTeams[]).map((f) => (
        <MatchCard key={f.matchId} match={f} />
      ))}
    </div>
  );
}

// ─── Stub Tabs ────────────────────────────────────────────────────────────────

function ComingSoonTab({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <div className="text-zinc-600 text-sm font-semibold uppercase tracking-widest">
        {label}
      </div>
      <div className="text-zinc-700 text-xs">Coming soon</div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function WorldCup2026() {
  const [activeTab, setActiveTab] = useState<SubTab>("PROJECTIONS");
  const [selectedDate, setSelectedDate] = useState<string>(getDefaultDate);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100">
      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-sm border-b border-white/8">
        <div className="max-w-2xl mx-auto px-3 sm:px-4">
          {/* Title row */}
          <div className="flex items-center gap-3 pt-3 pb-2">
            <img
              src="https://digitalhub.fifa.com/transform/de1fd0e5-c091-49ac-a115-00faec1217b1/FIFA-World-Cup-26-Official-Brand-unveiled-in-Los-Angeles?&io=transform:fill,width:768&quality=75"
              alt="FIFA World Cup 2026"
              className="h-8 w-auto object-contain flex-shrink-0"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
            <div>
              <div className="text-sm font-bold text-zinc-100 leading-tight">
                FIFA World Cup 2026
              </div>
              <div className="text-[10px] text-zinc-500 uppercase tracking-widest">
                {/* [2026-06-29] Dynamic stage label: KO Round of 32 started Jun 28 */}
                {selectedDate >= '2026-06-28'
                  ? 'Knockout Stage · Round of 32'
                  : 'Group Stage · USA / CAN / MEX'
                }
              </div>
            </div>
          </div>

          {/* Sub-tab nav */}
          <div className="flex items-center gap-0 overflow-x-auto no-scrollbar -mx-3 px-3 pb-0">
            {SUB_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "px-3 py-2.5 text-[11px] font-bold tracking-widest uppercase whitespace-nowrap transition-all border-b-2 flex-shrink-0",
                  activeTab === tab
                    ? "text-white border-white"
                    : "text-zinc-500 border-transparent hover:text-zinc-300"
                )}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="max-w-2xl mx-auto px-3 sm:px-4 py-4">
        {activeTab === "PROJECTIONS" && (
          <>
            {/* Date selector */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-3 px-3 mb-4 pb-1">
              {WC_DATE_RANGE.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setSelectedDate(d)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-[11px] font-semibold tracking-wide transition-all whitespace-nowrap flex-shrink-0",
                    selectedDate === d
                      ? "bg-transparent text-white border border-white/60"
                      : "bg-[#1a1a1a] text-zinc-400 border border-white/8 hover:text-zinc-200"
                  )}
                >
                  {WC_DATE_LABELS[d]}
                </button>
              ))}
            </div>

            {/* Match cards */}
            <ProjectionsFeed date={selectedDate} />
          </>
        )}

        {activeTab === "SPLITS" && <ComingSoonTab label="Betting Splits" />}
        {activeTab === "LINEUPS" && <ComingSoonTab label="Lineups" />}
        {activeTab === "STANDINGS" && <ComingSoonTab label="Group Standings" />}
        {activeTab === "FUTURES" && <ComingSoonTab label="Futures & Outrights" />}
      </div>
    </div>
  );
}
