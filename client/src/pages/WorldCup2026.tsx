/**
 * WorldCup2026.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * FIFA World Cup 2026 — Group Stage Fixture Feed
 *
 * Layout:
 *   • Date selector (today / tomorrow / full schedule by group)
 *   • Per-fixture cards: teams, venue, kickoff time, DK 1X2 odds,
 *     VSIN betting splits, Rotowire lineup status
 *   • Group standings view (all 12 groups A–L)
 *
 * Data sources:
 *   trpc.wc2026.todayWithOdds     → today's fixtures + DK 1X2 odds
 *   trpc.wc2026.fixturesByDate    → fixtures for a specific date
 *   trpc.wc2026.fixturesByGroup   → all fixtures for a group
 *   trpc.wc2026.latestSplits      → VSIN DK splits per fixture
 *   trpc.wc2026.latestLineups     → Rotowire lineups per fixture
 */

import { trpc } from "@/lib/trpc";
import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarDays, MapPin, Clock, Users, TrendingUp, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtAmerican(odds: number | undefined | null): string {
  if (odds == null) return "—";
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function fmtPct(val: number | undefined | null): string {
  if (val == null) return "—";
  return `${Math.round(val)}%`;
}

function fmtKickoff(kickoffUtc: Date | string | null | undefined, timezone?: string): string {
  if (!kickoffUtc) return "TBD";
  const d = new Date(kickoffUtc);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: "America/New_York",
  });
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

function tomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

function fmtDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

type FixtureWithTeams = {
  fixtureId: string;
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
  homeTeam: { teamId: string; name: string; fifaCode: string; flagUrl: string; groupLetter: string } | null;
  awayTeam: { teamId: string; name: string; fifaCode: string; flagUrl: string; groupLetter: string } | null;
  venue: { venueId: string; city: string; country: string; stadium: string; timezone: string; elevationM: number } | null;
  dkOdds?: { home?: number; away?: number; draw?: number } | null;
};

function OddsCell({ label, odds, highlight }: { label: string; odds: number | undefined | null; highlight?: boolean }) {
  const formatted = fmtAmerican(odds);
  const isPlus = odds != null && odds > 0;
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[52px]">
      <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-medium">{label}</span>
      <span className={cn(
        "text-sm font-bold tabular-nums",
        highlight && isPlus ? "text-emerald-400" : "text-zinc-100",
        formatted === "—" && "text-zinc-600"
      )}>
        {formatted}
      </span>
    </div>
  );
}

function SplitsRow({ fixtureId, homeTeamId, awayTeamId }: { fixtureId: string; homeTeamId: string; awayTeamId: string }) {
  const { data: splits } = trpc.wc2026.latestSplits.useQuery({ fixtureId });

  const mlHome = splits?.find((s: { teamId: string; market: string; ticketsPct: number | null; moneyPct: number | null }) => s.teamId === homeTeamId && s.market === "ML");
  const mlAway = splits?.find((s: { teamId: string; market: string; ticketsPct: number | null; moneyPct: number | null }) => s.teamId === awayTeamId && s.market === "ML");

  if (!splits || splits.length === 0) {
    return (
      <div className="flex items-center gap-1 text-[10px] text-zinc-600 mt-1">
        <TrendingUp className="w-3 h-3" />
        <span>Splits: pending</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 mt-1.5 text-[10px]">
      <TrendingUp className="w-3 h-3 text-zinc-500 flex-shrink-0" />
      <div className="flex items-center gap-1 text-zinc-400">
        <span className="text-zinc-300 font-semibold">{mlAway?.ticketsPct != null ? fmtPct(mlAway.ticketsPct) : "—"}</span>
        <span className="text-zinc-600">tkts</span>
        <span className="text-zinc-600 mx-0.5">|</span>
        <span className="text-zinc-300 font-semibold">{mlAway?.moneyPct != null ? fmtPct(mlAway.moneyPct) : "—"}</span>
        <span className="text-zinc-600">$</span>
        <span className="text-zinc-600 mx-1">AWAY</span>
      </div>
      <div className="flex items-center gap-1 text-zinc-400">
        <span className="text-zinc-300 font-semibold">{mlHome?.ticketsPct != null ? fmtPct(mlHome.ticketsPct) : "—"}</span>
        <span className="text-zinc-600">tkts</span>
        <span className="text-zinc-600 mx-0.5">|</span>
        <span className="text-zinc-300 font-semibold">{mlHome?.moneyPct != null ? fmtPct(mlHome.moneyPct) : "—"}</span>
        <span className="text-zinc-600">$</span>
        <span className="text-zinc-600 mx-1">HOME</span>
      </div>
    </div>
  );
}

function LineupStatus({ fixtureId, homeTeamId, awayTeamId }: { fixtureId: string; homeTeamId: string; awayTeamId: string }) {
  const { data: lineups } = trpc.wc2026.latestLineups.useQuery({ fixtureId });
  const [expanded, setExpanded] = useState(false);

  if (!lineups || lineups.length === 0) {
    return (
      <div className="flex items-center gap-1 text-[10px] text-zinc-600 mt-1">
        <Users className="w-3 h-3" />
        <span>Lineups: not yet available</span>
      </div>
    );
  }

  const homeStarters = lineups.filter((l: { teamId: string; isStarter: boolean; isConfirmed: boolean; position: string; playerName: string; injuryStatus: string | null }) => l.teamId === homeTeamId && l.isStarter);
  const awayStarters = lineups.filter((l: { teamId: string; isStarter: boolean; isConfirmed: boolean; position: string; playerName: string; injuryStatus: string | null }) => l.teamId === awayTeamId && l.isStarter);
  const isConfirmed = lineups.some((l: { isConfirmed: boolean }) => l.isConfirmed);
  const statusLabel = isConfirmed ? "Confirmed" : "Predicted";

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-1.5 text-[10px] text-zinc-400 hover:text-zinc-200 transition-colors"
      >
        <Users className="w-3 h-3" />
        <span className={cn("font-semibold", isConfirmed ? "text-emerald-400" : "text-amber-400")}>
          {statusLabel} Lineup
        </span>
        <span className="text-zinc-600">
          ({homeStarters.length} + {awayStarters.length} starters)
        </span>
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {expanded && (
        <div className="mt-2 grid grid-cols-2 gap-3">
          {[{ teamId: awayTeamId, starters: awayStarters, label: "Away" }, { teamId: homeTeamId, starters: homeStarters, label: "Home" }].map(({ teamId, starters, label }) => (
            <div key={teamId} className="space-y-0.5">
              <div className="text-[9px] text-zinc-500 uppercase tracking-widest mb-1">{label}</div>
              {starters.slice(0, 11).map((p: { position: string; playerName: string; injuryStatus: string | null }, i: number) => (
                <div key={i} className="flex items-center gap-1.5 text-[10px]">
                  <span className="text-zinc-600 w-6 text-right">{p.position}</span>
                  <span className="text-zinc-300">{p.playerName}</span>
                  {p.injuryStatus && (
                    <span className={cn(
                      "text-[9px] font-bold px-1 rounded",
                      p.injuryStatus === "OUT" ? "text-red-400" : "text-amber-400"
                    )}>
                      {p.injuryStatus}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FixtureCard({ fixture }: { fixture: FixtureWithTeams }) {
  const { homeTeam, awayTeam, venue, dkOdds, status } = fixture;
  const isLive = status === "LIVE";
  const isFinal = status === "FT";

  return (
    <div className={cn(
      "rounded-xl border p-3 sm:p-4 transition-all duration-150",
      "bg-[#0f0f0f] border-white/8",
      isLive && "border-emerald-500/40 shadow-[0_0_12px_rgba(34,197,94,0.08)]"
    )}>
      {/* Header: group + matchday + venue + kickoff */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {fixture.groupLetter && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-zinc-700 text-zinc-400 font-bold tracking-widest">
              GROUP {fixture.groupLetter} · MD{fixture.matchday}
            </Badge>
          )}
          {isLive && (
            <Badge className="text-[9px] px-1.5 py-0 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold animate-pulse">
              LIVE
            </Badge>
          )}
          {isFinal && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-zinc-700 text-zinc-500">
              FT
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1 text-[10px] text-zinc-500">
          <Clock className="w-3 h-3" />
          <span>{fmtKickoff(fixture.kickoffUtc)}</span>
        </div>
      </div>

      {/* Teams + Odds */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Away team */}
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <img
            src={awayTeam?.flagUrl ?? `https://flagcdn.com/w40/${awayTeam?.teamId ?? "xx"}.png`}
            alt={awayTeam?.fifaCode ?? ""}
            className="w-7 h-5 object-cover rounded-sm flex-shrink-0 border border-white/10"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <div className="min-w-0">
            <div className="text-xs font-bold text-zinc-100 truncate">{awayTeam?.name ?? fixture.awayTeamId}</div>
            <div className="text-[9px] text-zinc-500 uppercase tracking-widest">{awayTeam?.fifaCode ?? ""}</div>
          </div>
        </div>

        {/* Score or VS */}
        <div className="flex flex-col items-center gap-0.5 flex-shrink-0 w-10">
          {isFinal || isLive ? (
            <div className="text-sm font-bold text-zinc-100 tabular-nums">
              {fixture.awayScore ?? 0} – {fixture.homeScore ?? 0}
            </div>
          ) : (
            <div className="text-xs text-zinc-600 font-bold">VS</div>
          )}
        </div>

        {/* Home team */}
        <div className="flex-1 flex items-center gap-2 min-w-0 flex-row-reverse">
          <img
            src={homeTeam?.flagUrl ?? `https://flagcdn.com/w40/${homeTeam?.teamId ?? "xx"}.png`}
            alt={homeTeam?.fifaCode ?? ""}
            className="w-7 h-5 object-cover rounded-sm flex-shrink-0 border border-white/10"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <div className="min-w-0 text-right">
            <div className="text-xs font-bold text-zinc-100 truncate">{homeTeam?.name ?? fixture.homeTeamId}</div>
            <div className="text-[9px] text-zinc-500 uppercase tracking-widest">{homeTeam?.fifaCode ?? ""}</div>
          </div>
        </div>
      </div>

      {/* DK 1X2 Odds */}
      {dkOdds && (dkOdds.home != null || dkOdds.away != null || dkOdds.draw != null) ? (
        <div className="mt-3 pt-2.5 border-t border-white/6 flex items-center justify-between">
          <div className="flex items-center gap-1 text-[9px] text-zinc-600 uppercase tracking-widest">
            <span>DK</span>
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
            <OddsCell label="Away" odds={dkOdds.away} highlight />
            <OddsCell label="Draw" odds={dkOdds.draw} />
            <OddsCell label="Home" odds={dkOdds.home} highlight />
          </div>
        </div>
      ) : (
        <div className="mt-3 pt-2.5 border-t border-white/6 text-[10px] text-zinc-600 text-center">
          Odds: pending
        </div>
      )}

      {/* Venue */}
      {venue && (
        <div className="mt-2 flex items-center gap-1 text-[10px] text-zinc-600">
          <MapPin className="w-3 h-3 flex-shrink-0" />
          <span>{venue.stadium}, {venue.city}</span>
          {venue.elevationM > 500 && (
            <span className="ml-1 text-amber-500/70">⚠ {venue.elevationM}m alt</span>
          )}
        </div>
      )}

      {/* VSIN Splits */}
      <SplitsRow fixtureId={fixture.fixtureId} homeTeamId={fixture.homeTeamId} awayTeamId={fixture.awayTeamId} />

      {/* Rotowire Lineups */}
      <LineupStatus fixtureId={fixture.fixtureId} homeTeamId={fixture.homeTeamId} awayTeamId={fixture.awayTeamId} />
    </div>
  );
}

function FixtureCardSkeleton() {
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
      <div className="flex justify-between pt-2 border-t border-white/6">
        <Skeleton className="h-8 w-16 bg-zinc-800" />
        <Skeleton className="h-8 w-16 bg-zinc-800" />
        <Skeleton className="h-8 w-16 bg-zinc-800" />
      </div>
    </div>
  );
}

// ─── Group Schedule View ──────────────────────────────────────────────────────

function GroupScheduleView({ group }: { group: string }) {
  const { data: fixtures, isLoading } = trpc.wc2026.fixturesByGroup.useQuery({ group });

  if (isLoading) return (
    <div className="space-y-3">
      {[1, 2, 3].map(i => <FixtureCardSkeleton key={i} />)}
    </div>
  );

  if (!fixtures || fixtures.length === 0) {
    return <div className="text-center text-zinc-600 py-8">No fixtures found for Group {group}</div>;
  }

  const byMatchday: Record<number, typeof fixtures> = {};
  for (const f of fixtures) {
    const md = f.matchday ?? 0;
    if (!byMatchday[md]) byMatchday[md] = [];
    byMatchday[md].push(f as FixtureWithTeams);
  }

  return (
    <div className="space-y-6">
      {Object.entries(byMatchday).sort(([a], [b]) => Number(a) - Number(b)).map(([md, games]) => (
        <div key={md}>
          <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-2 font-semibold">Matchday {md}</div>
          <div className="space-y-3">
            {(games as FixtureWithTeams[]).map((f: FixtureWithTeams) => <FixtureCard key={f.fixtureId} fixture={f} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Date Feed View ───────────────────────────────────────────────────────────

function DateFeedView({ date }: { date: string }) {
  const isTodayDate = date === todayStr();
  const { data: fixtures, isLoading } = isTodayDate
    ? trpc.wc2026.todayWithOdds.useQuery()
    : trpc.wc2026.fixturesByDate.useQuery({ date });

  if (isLoading) return (
    <div className="space-y-3">
      {[1, 2, 3].map(i => <FixtureCardSkeleton key={i} />)}
    </div>
  );

  if (!fixtures || fixtures.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <CalendarDays className="w-8 h-8 text-zinc-600" />
        <div className="text-zinc-500 text-sm">No World Cup fixtures on {fmtDateLabel(date)}</div>
        <div className="text-zinc-600 text-xs">Group stage runs June 12 – July 2, 2026</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {(fixtures as FixtureWithTeams[]).map((f: FixtureWithTeams) => <FixtureCard key={f.fixtureId} fixture={f} />)}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const GROUPS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];

export default function WorldCup2026() {
  const [viewMode, setViewMode] = useState<"today" | "tomorrow" | "group">("today");
  const [selectedGroup, setSelectedGroup] = useState<string>("A");
  const [customDate] = useState<string>(todayStr());

  const displayDate = viewMode === "today" ? todayStr() : viewMode === "tomorrow" ? tomorrowStr() : customDate;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-sm border-b border-white/8">
        <div className="max-w-2xl mx-auto px-3 sm:px-4 py-3">
          {/* Title row */}
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center gap-2">
              {/* FIFA World Cup trophy emoji as icon */}
              <span className="text-xl">🏆</span>
              <div>
                <div className="text-sm font-bold text-zinc-100 leading-tight">FIFA World Cup 2026</div>
                <div className="text-[10px] text-zinc-500 uppercase tracking-widest">Group Stage · USA / CAN / MEX</div>
              </div>
            </div>
          </div>

          {/* View mode tabs */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setViewMode("today")}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-semibold tracking-wide transition-all",
                viewMode === "today"
                  ? "bg-transparent text-white border border-white/60"
                  : "bg-[#1a1a1a] text-zinc-400 border border-white/8"
              )}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setViewMode("tomorrow")}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-semibold tracking-wide transition-all",
                viewMode === "tomorrow"
                  ? "bg-transparent text-white border border-white/60"
                  : "bg-[#1a1a1a] text-zinc-400 border border-white/8"
              )}
            >
              Tomorrow
            </button>
            <button
              type="button"
              onClick={() => setViewMode("group")}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-semibold tracking-wide transition-all",
                viewMode === "group"
                  ? "bg-transparent text-white border border-white/60"
                  : "bg-[#1a1a1a] text-zinc-400 border border-white/8"
              )}
            >
              By Group
            </button>
          </div>

          {/* Group selector — only shown in group mode */}
          {viewMode === "group" && (
            <div className="mt-2 flex items-center gap-1 flex-wrap">
              {GROUPS.map(g => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setSelectedGroup(g)}
                  className={cn(
                    "w-7 h-7 rounded-md text-xs font-bold transition-all",
                    selectedGroup === g
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                      : "bg-[#1a1a1a] text-zinc-500 border border-white/8 hover:text-zinc-300"
                  )}
                >
                  {g}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-3 sm:px-4 py-4">
        {/* Date label */}
        {viewMode !== "group" && (
          <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-3 font-semibold">
            {fmtDateLabel(displayDate)}
          </div>
        )}

        {viewMode === "group" ? (
          <GroupScheduleView group={selectedGroup} />
        ) : (
          <DateFeedView date={displayDate} />
        )}
      </div>
    </div>
  );
}
