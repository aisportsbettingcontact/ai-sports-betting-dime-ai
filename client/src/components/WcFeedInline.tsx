/**
 * WcFeedInline.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * World Cup 2026 feed rendered INLINE on the ModelProjections page.
 * This is NOT a standalone page — it is mounted directly inside the feed
 * when selectedSport === "WC", exactly like MLB and NHL game cards.
 *
 * Sub-tabs: PROJECTIONS | SPLITS | LINEUPS | STANDINGS | FUTURES
 *
 * PROJECTIONS layout (3-way market):
 *   HOME ML  | BOOK | MODEL
 *   DRAW     | BOOK | MODEL
 *   AWAY ML  | BOOK | MODEL
 *   ─────────────────────────
 *   O {line} | BOOK | MODEL
 *   U {line} | BOOK | MODEL
 *
 * Data source: DK NJ (book_id=68) via Action Network API
 *   → wc2026.todayWithOdds  (today's fixtures)
 *   → wc2026.fixturesByDate (non-today dates)
 *   → wc2026.lineupsByDate  (lineups tab)
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarDays, MapPin, Clock, Users } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Constants ────────────────────────────────────────────────────────────────

const WC_DATE_RANGE = [
  "2026-06-11",
  "2026-06-12",
  "2026-06-13",
  "2026-06-14",
  "2026-06-15",
  "2026-06-16",
  "2026-06-17",
];

const WC_DATE_LABELS: Record<string, string> = {
  "2026-06-11": "Thu Jun 11",
  "2026-06-12": "Fri Jun 12",
  "2026-06-13": "Sat Jun 13",
  "2026-06-14": "Sun Jun 14",
  "2026-06-15": "Mon Jun 15",
  "2026-06-16": "Tue Jun 16",
  "2026-06-17": "Wed Jun 17",
};

const WC_SUB_TABS = ["PROJECTIONS", "SPLITS", "LINEUPS", "STANDINGS", "FUTURES"] as const;
type WcSubTab = (typeof WC_SUB_TABS)[number];

// Position display order for soccer lineups
const POSITION_ORDER: Record<string, number> = {
  GK: 0,
  DC: 1, DL: 2, DR: 3, DM: 4,
  DMC: 5, DML: 6, DMR: 7,
  MC: 8, ML: 9, MR: 10,
  AMC: 11, AML: 12, AMR: 13,
  FW: 14, CF: 15, SS: 16,
};

function posOrder(pos: string | null): number {
  if (!pos) return 99;
  return POSITION_ORDER[pos.toUpperCase()] ?? 50;
}

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

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

function getDefaultWcDate(): string {
  const today = todayStr();
  if (WC_DATE_RANGE.includes(today)) return today;
  return "2026-06-11";
}

// FIFA API flag URL — uses uppercase FIFA code
function fifaFlagUrl(fifaCode: string): string {
  return `https://api.fifa.com/api/v3/picture/flags-sq-4/${fifaCode.toUpperCase()}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type DkOdds = {
  home?: number;
  away?: number;
  draw?: number;
  overLine?: number;
  overOdds?: number;
  underOdds?: number;
} | null;

type WcTeamInfo = {
  teamId: string;
  name: string;
  fifaCode: string;
  flagUrl: string;
  groupLetter: string;
};

type WcVenueInfo = {
  venueId: string;
  city: string;
  country: string;
  stadium: string;
  timezone: string;
  elevationM: number;
};

type WcLineupPlayer = {
  id: number;
  fixtureId: string;
  teamId: string;
  playerName: string;
  position: string | null;
  isStarter: boolean;
  injuryStatus: string | null;
  jerseyNumber: number | null;
  scrapedAt: Date | string;
  isConfirmed: boolean;
};

type WcFixtureWithOdds = {
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
  homeTeam: WcTeamInfo | null;
  awayTeam: WcTeamInfo | null;
  venue: WcVenueInfo | null;
  dkOdds?: DkOdds;
};

type WcFixtureWithLineups = WcFixtureWithOdds & {
  lineups: WcLineupPlayer[];
};

// ─── Odds Row ─────────────────────────────────────────────────────────────────

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
        <span
          className={cn(
            "text-xs font-bold tabular-nums w-[44px] text-right",
            bookStr === "—" ? "text-zinc-600" : "text-zinc-100"
          )}
        >
          {bookStr}
        </span>
        <span className="text-xs tabular-nums w-[44px] text-right text-zinc-600">
          {modelOdds != null ? fmtAmerican(modelOdds) : "—"}
        </span>
      </div>
    </div>
  );
}

// ─── Fixture Card (Projections) ───────────────────────────────────────────────

function WcFixtureCard({ fixture }: { fixture: WcFixtureWithOdds }) {
  const { homeTeam, awayTeam, venue, dkOdds, status } = fixture;
  const isLive = status === "LIVE";
  const isFinal = status === "FT";
  const hasOdds =
    dkOdds != null &&
    (dkOdds.home != null || dkOdds.away != null || dkOdds.draw != null);
  const totalLine = dkOdds?.overLine ?? 2.5;

  return (
    <div
      className={cn(
        "rounded-xl border transition-all duration-150 mx-3 mb-3",
        "bg-[#0f0f0f] border-white/8",
        isLive && "border-emerald-500/40 shadow-[0_0_12px_rgba(34,197,94,0.08)]"
      )}
    >
      {/* ── Card header: group + kickoff ── */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <div className="flex items-center gap-2">
          {fixture.groupLetter && (
            <span className="text-[9px] text-zinc-500 uppercase tracking-widest font-bold border border-zinc-700 rounded px-1.5 py-0.5">
              GROUP {fixture.groupLetter} · MD{fixture.matchday}
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
          <span>{fmtKickoff(fixture.kickoffUtc)}</span>
        </div>
      </div>

      {/* ── Teams row ── */}
      <div className="flex items-center gap-2 px-3 pb-3">
        {/* Away team */}
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <img
            src={awayTeam?.flagUrl ?? fifaFlagUrl(awayTeam?.fifaCode ?? "XX")}
            alt={awayTeam?.fifaCode ?? ""}
            className="w-7 h-5 object-cover rounded-sm flex-shrink-0 border border-white/10"
            onError={(e) => {
              const img = e.target as HTMLImageElement;
              if (!img.src.includes("flagcdn")) {
                img.src = `https://flagcdn.com/w40/${awayTeam?.teamId ?? "xx"}.png`;
              }
            }}
          />
          <div className="min-w-0">
            <div className="text-xs font-bold text-zinc-100 truncate">
              {awayTeam?.name ?? fixture.awayTeamId}
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
              {fixture.awayScore ?? 0} – {fixture.homeScore ?? 0}
            </div>
          ) : (
            <div className="text-xs text-zinc-600 font-bold">VS</div>
          )}
        </div>

        {/* Home team */}
        <div className="flex-1 flex items-center gap-2 min-w-0 flex-row-reverse">
          <img
            src={homeTeam?.flagUrl ?? fifaFlagUrl(homeTeam?.fifaCode ?? "XX")}
            alt={homeTeam?.fifaCode ?? ""}
            className="w-7 h-5 object-cover rounded-sm flex-shrink-0 border border-white/10"
            onError={(e) => {
              const img = e.target as HTMLImageElement;
              if (!img.src.includes("flagcdn")) {
                img.src = `https://flagcdn.com/w40/${homeTeam?.teamId ?? "xx"}.png`;
              }
            }}
          />
          <div className="min-w-0 text-right">
            <div className="text-xs font-bold text-zinc-100 truncate">
              {homeTeam?.name ?? fixture.homeTeamId}
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
            <span className="text-[9px] text-zinc-600 uppercase tracking-widest w-[44px] text-right">
              MODEL
            </span>
          </div>
        </div>

        {/* 1X2 rows */}
        <OddsRow label="HOME ML" bookOdds={hasOdds ? dkOdds?.home : null} />
        <OddsRow label="DRAW" bookOdds={hasOdds ? dkOdds?.draw : null} />
        <OddsRow label="AWAY ML" bookOdds={hasOdds ? dkOdds?.away : null} />

        {/* Divider */}
        <div className="border-t border-white/4 my-1.5" />

        {/* Total rows */}
        <OddsRow label={`O ${totalLine}`} bookOdds={hasOdds ? (dkOdds?.overOdds ?? null) : null} />
        <OddsRow label={`U ${totalLine}`} bookOdds={hasOdds ? (dkOdds?.underOdds ?? null) : null} />
      </div>

      {/* ── Venue ── */}
      {venue && (
        <div className="border-t border-white/6 px-3 py-2 flex items-center gap-1 text-[10px] text-zinc-600">
          <MapPin className="w-3 h-3 flex-shrink-0" />
          <span>{venue.stadium}, {venue.city}</span>
          {venue.elevationM > 500 && (
            <span className="ml-1 text-amber-500/70">⚠ {venue.elevationM}m alt</span>
          )}
        </div>
      )}
    </div>
  );
}

function WcFixtureCardSkeleton() {
  return (
    <div className="rounded-xl border border-white/8 bg-[#0f0f0f] p-4 space-y-3 mx-3 mb-3">
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

// ─── Player Badge Card ─────────────────────────────────────────────────────────

function PlayerBadgeCard({ player, fifaCode }: { player: WcLineupPlayer; fifaCode: string }) {
  const isInjured = player.injuryStatus && player.injuryStatus !== "null";
  const injuryColor =
    player.injuryStatus === "OUT"
      ? "text-red-400 border-red-500/30 bg-red-500/10"
      : player.injuryStatus === "QUES"
      ? "text-amber-400 border-amber-500/30 bg-amber-500/10"
      : player.injuryStatus === "DTDT"
      ? "text-orange-400 border-orange-500/30 bg-orange-500/10"
      : "";

  return (
    <div
      className={cn(
        "relative flex flex-col items-center gap-1.5 p-2 rounded-lg border transition-all",
        "bg-[#111] border-white/6 hover:border-white/12",
        !player.isStarter && "opacity-60"
      )}
    >
      {/* FIFA flag badge */}
      <div className="relative">
        <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-white/15 bg-zinc-800 flex items-center justify-center">
          <img
            src={fifaFlagUrl(fifaCode)}
            alt={fifaCode}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
        {/* Position badge */}
        {player.position && (
          <div className="absolute -bottom-1 -right-1 bg-zinc-700 border border-zinc-600 rounded text-[8px] font-bold text-zinc-300 px-1 leading-4">
            {player.position}
          </div>
        )}
      </div>

      {/* Jersey number */}
      {player.jerseyNumber != null && (
        <div className="text-[9px] text-zinc-600 font-bold tabular-nums">
          #{player.jerseyNumber}
        </div>
      )}

      {/* Player name */}
      <div className="text-[10px] font-semibold text-zinc-200 text-center leading-tight line-clamp-2 max-w-[72px]">
        {player.playerName}
      </div>

      {/* Injury status */}
      {isInjured && (
        <div
          className={cn(
            "text-[8px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wide",
            injuryColor
          )}
        >
          {player.injuryStatus}
        </div>
      )}

      {/* Bench indicator */}
      {!player.isStarter && (
        <div className="text-[8px] text-zinc-600 uppercase tracking-widest">SUB</div>
      )}
    </div>
  );
}

// ─── Lineup Card per Fixture ──────────────────────────────────────────────────

function WcLineupCard({ fixture }: { fixture: WcFixtureWithLineups }) {
  const { homeTeam, awayTeam, venue, lineups } = fixture;

  const homePlayers = lineups
    .filter((p) => p.teamId === fixture.homeTeamId)
    .sort((a, b) => {
      if (a.isStarter !== b.isStarter) return a.isStarter ? -1 : 1;
      return posOrder(a.position) - posOrder(b.position);
    });

  const awayPlayers = lineups
    .filter((p) => p.teamId === fixture.awayTeamId)
    .sort((a, b) => {
      if (a.isStarter !== b.isStarter) return a.isStarter ? -1 : 1;
      return posOrder(a.position) - posOrder(b.position);
    });

  const homeStarters = homePlayers.filter((p) => p.isStarter);
  const homeBench = homePlayers.filter((p) => !p.isStarter);
  const awayStarters = awayPlayers.filter((p) => p.isStarter);
  const awayBench = awayPlayers.filter((p) => !p.isStarter);

  const hasLineups = lineups.length > 0;

  return (
    <div className="rounded-xl border border-white/8 bg-[#0f0f0f] mx-3 mb-4 overflow-hidden">
      {/* ── Match header ── */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2 border-b border-white/6">
        <div className="flex items-center gap-2">
          {fixture.groupLetter && (
            <span className="text-[9px] text-zinc-500 uppercase tracking-widest font-bold border border-zinc-700 rounded px-1.5 py-0.5">
              GROUP {fixture.groupLetter} · MD{fixture.matchday}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 text-[10px] text-zinc-500">
          <Clock className="w-3 h-3" />
          <span>{fmtKickoff(fixture.kickoffUtc)}</span>
        </div>
      </div>

      {/* ── Match title ── */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <img
            src={awayTeam?.flagUrl ?? fifaFlagUrl(awayTeam?.fifaCode ?? "XX")}
            alt={awayTeam?.fifaCode ?? ""}
            className="w-8 h-6 object-cover rounded-sm border border-white/10 flex-shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <div className="min-w-0">
            <div className="text-sm font-bold text-zinc-100 truncate">{awayTeam?.name ?? fixture.awayTeamId}</div>
            <div className="text-[9px] text-zinc-500 uppercase">{awayTeam?.fifaCode}</div>
          </div>
        </div>
        <div className="text-xs text-zinc-600 font-bold px-3 flex-shrink-0">VS</div>
        <div className="flex items-center gap-2 flex-1 min-w-0 flex-row-reverse">
          <img
            src={homeTeam?.flagUrl ?? fifaFlagUrl(homeTeam?.fifaCode ?? "XX")}
            alt={homeTeam?.fifaCode ?? ""}
            className="w-8 h-6 object-cover rounded-sm border border-white/10 flex-shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <div className="min-w-0 text-right">
            <div className="text-sm font-bold text-zinc-100 truncate">{homeTeam?.name ?? fixture.homeTeamId}</div>
            <div className="text-[9px] text-zinc-500 uppercase">{homeTeam?.fifaCode}</div>
          </div>
        </div>
      </div>

      {!hasLineups ? (
        <div className="flex items-center justify-center py-10 gap-2 text-zinc-600 text-xs border-t border-white/6">
          <Users className="w-4 h-4" />
          <span>Lineups not yet available</span>
        </div>
      ) : (
        <div className="border-t border-white/6">
          {/* ── Two-column lineup grid ── */}
          <div className="grid grid-cols-2 divide-x divide-white/6">
            {/* Away team */}
            <div className="p-3">
              <div className="flex items-center gap-1.5 mb-3">
                <img
                  src={awayTeam?.flagUrl ?? fifaFlagUrl(awayTeam?.fifaCode ?? "XX")}
                  alt=""
                  className="w-5 h-3.5 object-cover rounded-sm border border-white/10"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
                <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest">
                  {awayTeam?.fifaCode ?? fixture.awayTeamId}
                </span>
                <span className="text-[9px] text-zinc-600 ml-auto">AWAY</span>
              </div>

              {/* Starters */}
              <div className="text-[9px] text-zinc-600 uppercase tracking-widest mb-2 font-bold">
                Starting XI
              </div>
              <div className="grid grid-cols-3 gap-1.5 mb-3">
                {awayStarters.map((p) => (
                  <PlayerBadgeCard
                    key={p.id}
                    player={p}
                    fifaCode={awayTeam?.fifaCode ?? "XX"}
                  />
                ))}
              </div>

              {/* Bench */}
              {awayBench.length > 0 && (
                <>
                  <div className="text-[9px] text-zinc-600 uppercase tracking-widest mb-2 font-bold border-t border-white/6 pt-2">
                    Bench
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {awayBench.map((p) => (
                      <PlayerBadgeCard
                        key={p.id}
                        player={p}
                        fifaCode={awayTeam?.fifaCode ?? "XX"}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Home team */}
            <div className="p-3">
              <div className="flex items-center gap-1.5 mb-3">
                <img
                  src={homeTeam?.flagUrl ?? fifaFlagUrl(homeTeam?.fifaCode ?? "XX")}
                  alt=""
                  className="w-5 h-3.5 object-cover rounded-sm border border-white/10"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
                <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest">
                  {homeTeam?.fifaCode ?? fixture.homeTeamId}
                </span>
                <span className="text-[9px] text-zinc-600 ml-auto">HOME</span>
              </div>

              {/* Starters */}
              <div className="text-[9px] text-zinc-600 uppercase tracking-widest mb-2 font-bold">
                Starting XI
              </div>
              <div className="grid grid-cols-3 gap-1.5 mb-3">
                {homeStarters.map((p) => (
                  <PlayerBadgeCard
                    key={p.id}
                    player={p}
                    fifaCode={homeTeam?.fifaCode ?? "XX"}
                  />
                ))}
              </div>

              {/* Bench */}
              {homeBench.length > 0 && (
                <>
                  <div className="text-[9px] text-zinc-600 uppercase tracking-widest mb-2 font-bold border-t border-white/6 pt-2">
                    Bench
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {homeBench.map((p) => (
                      <PlayerBadgeCard
                        key={p.id}
                        player={p}
                        fifaCode={homeTeam?.fifaCode ?? "XX"}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ── Venue footer ── */}
          {venue && (
            <div className="border-t border-white/6 px-3 py-2 flex items-center gap-1 text-[10px] text-zinc-600">
              <MapPin className="w-3 h-3 flex-shrink-0" />
              <span>{venue.stadium}, {venue.city}</span>
              {venue.elevationM > 500 && (
                <span className="ml-1 text-amber-500/70">⚠ {venue.elevationM}m alt</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Projections Feed ─────────────────────────────────────────────────────────

function WcProjectionsFeed({ date }: { date: string }) {
  const today = todayStr();
  const isTodayDate = date === today;

  const todayQuery = trpc.wc2026.todayWithOdds.useQuery(undefined, {
    enabled: isTodayDate,
    refetchOnWindowFocus: false,
    refetchInterval: 60 * 1000,
    staleTime: 60 * 1000,
  });
  const dateQuery = trpc.wc2026.fixturesByDate.useQuery(
    { date },
    {
      enabled: !isTodayDate,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
    }
  );

  const { data: fixtures, isLoading } = isTodayDate ? todayQuery : dateQuery;

  if (isLoading) {
    return (
      <div className="pt-2">
        {[1, 2, 3].map((i) => <WcFixtureCardSkeleton key={i} />)}
      </div>
    );
  }

  if (!fixtures || fixtures.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center px-4">
        <CalendarDays className="w-10 h-10 text-zinc-600" />
        <div>
          <p className="text-sm font-semibold text-zinc-400 mb-1">
            No World Cup fixtures on {WC_DATE_LABELS[date] ?? date}
          </p>
          <p className="text-xs text-zinc-600">Group stage runs June 11 – July 2, 2026</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-2">
      {(fixtures as WcFixtureWithOdds[]).map((f) => (
        <WcFixtureCard key={f.fixtureId} fixture={f} />
      ))}
    </div>
  );
}

// ─── Lineups Feed ─────────────────────────────────────────────────────────────

function WcLineupsFeed({ date }: { date: string }) {
  const { data: fixtures, isLoading } = trpc.wc2026.lineupsByDate.useQuery(
    { date },
    {
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
    }
  );

  if (isLoading) {
    return (
      <div className="pt-2">
        {[1, 2].map((i) => (
          <div key={i} className="rounded-xl border border-white/8 bg-[#0f0f0f] mx-3 mb-4 p-4 space-y-3">
            <div className="flex justify-between">
              <Skeleton className="h-4 w-24 bg-zinc-800" />
              <Skeleton className="h-4 w-16 bg-zinc-800" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                {[1,2,3,4].map(j => <Skeleton key={j} className="h-16 w-full bg-zinc-800 rounded-lg" />)}
              </div>
              <div className="space-y-2">
                {[1,2,3,4].map(j => <Skeleton key={j} className="h-16 w-full bg-zinc-800 rounded-lg" />)}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!fixtures || fixtures.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center px-4">
        <Users className="w-10 h-10 text-zinc-600" />
        <div>
          <p className="text-sm font-semibold text-zinc-400 mb-1">
            No lineups available for {WC_DATE_LABELS[date] ?? date}
          </p>
          <p className="text-xs text-zinc-600">Lineups are sourced from RotoWire</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-2">
      {(fixtures as WcFixtureWithLineups[]).map((f) => (
        <WcLineupCard key={f.fixtureId} fixture={f} />
      ))}
    </div>
  );
}

// ─── Coming Soon Stub ─────────────────────────────────────────────────────────

function WcComingSoon({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-3">
      <div className="text-zinc-600 text-sm font-semibold uppercase tracking-widest">{label}</div>
      <div className="text-zinc-700 text-xs">Coming soon</div>
    </div>
  );
}

// ─── Date Selector ────────────────────────────────────────────────────────────

function WcDateSelector({
  selectedDate,
  onSelect,
}: {
  selectedDate: string;
  onSelect: (d: string) => void;
}) {
  return (
    <div
      className="flex items-center gap-1.5 px-3 sm:px-4 pt-3 pb-2 overflow-x-auto"
      style={{ scrollbarWidth: "none" } as React.CSSProperties}
    >
      {WC_DATE_RANGE.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => onSelect(d)}
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
  );
}

// ─── Main Inline Feed Component ───────────────────────────────────────────────

/**
 * WcFeedInline — renders the full WC 2026 feed inside ModelProjections.
 *
 * Includes:
 *   • Sub-tab nav (PROJECTIONS | SPLITS | LINEUPS | STANDINGS | FUTURES)
 *   • Date selector (Jun 11–17)
 *   • Fixture cards with 3-way market layout (PROJECTIONS)
 *   • Player badge cards with FIFA flags (LINEUPS)
 *
 * [ARCHITECTURE NOTE]
 * This component is mounted directly in the ModelProjections main feed area
 * when selectedSport === "WC". It replaces the normal GameCard feed entirely.
 * The column header, date row, and feed tabs are suppressed in ModelProjections
 * when WC is active.
 */
export function WcFeedInline() {
  const [activeTab, setActiveTab] = useState<WcSubTab>("PROJECTIONS");
  const [selectedDate, setSelectedDate] = useState<string>(getDefaultWcDate);

  const showDateSelector = activeTab === "PROJECTIONS" || activeTab === "LINEUPS";

  return (
    <div className="w-full">
      {/* ── WC Sub-header (sticky below main feed header) ── */}
      <div
        className="sticky z-[38] border-b border-white/8"
        style={{
          top: "var(--prez-header-h, 220px)",
          background: "hsl(var(--background))",
        }}
      >
        {/* Title row */}
        <div className="flex items-center gap-3 px-3 sm:px-4 pt-3 pb-2">
          <img
            src="https://digitalhub.fifa.com/transform/de1fd0e5-c091-49ac-a115-00faec1217b1/FIFA-World-Cup-26-Official-Brand-unveiled-in-Los-Angeles?&io=transform:fill,width:768&quality=75"
            alt="FIFA World Cup 2026"
            className="h-8 w-auto object-contain flex-shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <div>
            <div className="text-sm font-bold text-zinc-100 leading-tight">FIFA World Cup 2026</div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-widest">
              Group Stage · USA / CAN / MEX
            </div>
          </div>
        </div>

        {/* Sub-tab nav */}
        <div
          className="flex items-center px-3 sm:px-4 pb-0 overflow-x-auto"
          style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" } as React.CSSProperties}
        >
          {WC_SUB_TABS.map((tab) => (
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

        {/* Date selector (shown for PROJECTIONS and LINEUPS) */}
        {showDateSelector && (
          <WcDateSelector selectedDate={selectedDate} onSelect={setSelectedDate} />
        )}
      </div>

      {/* ── Content ── */}
      {activeTab === "PROJECTIONS" && <WcProjectionsFeed date={selectedDate} />}
      {activeTab === "SPLITS" && <WcComingSoon label="Betting Splits" />}
      {activeTab === "LINEUPS" && <WcLineupsFeed date={selectedDate} />}
      {activeTab === "STANDINGS" && <WcComingSoon label="Group Standings" />}
      {activeTab === "FUTURES" && <WcComingSoon label="Futures & Outrights" />}
    </div>
  );
}
