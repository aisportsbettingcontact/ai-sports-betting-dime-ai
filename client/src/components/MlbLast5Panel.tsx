/**
 * MlbLast5Panel.tsx
 *
 * Displays the Last 5 completed games for each team in an MLB matchup.
 * Rendered below the OddsHistoryPanel for MLB games.
 *
 * For each game row shows:
 *   - Date
 *   - Opponent (with logo)
 *   - H/A indicator
 *   - Final score
 *   - W/L
 *   - Run Line (DK NJ) + covered/not
 *   - Total (DK NJ) + O/U result
 *   - Moneyline (DK NJ)
 *
 * Clicking a team logo navigates to /mlb/team/:slug (full schedule page).
 *
 * Data source: mlb_schedule_history table via trpc.mlbSchedule.getLast5ForMatchup
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { MLB_BY_AN_SLUG } from "@shared/mlbTeams";
import { ChevronDown, ChevronUp, RefreshCw, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScheduleGame {
  id: number;
  anGameId: number;
  gameDate: string;
  startTimeUtc: string;
  gameStatus: string;
  awaySlug: string;
  awayAbbr: string;
  awayName: string;
  awayTeamId: number;
  awayScore: number | null;
  homeSlug: string;
  homeAbbr: string;
  homeName: string;
  homeTeamId: number;
  homeScore: number | null;
  dkAwayRunLine: string | null;
  dkAwayRunLineOdds: string | null;
  dkHomeRunLine: string | null;
  dkHomeRunLineOdds: string | null;
  dkTotal: string | null;
  dkOverOdds: string | null;
  dkUnderOdds: string | null;
  dkAwayML: string | null;
  dkHomeML: string | null;
  awayRunLineCovered: boolean | null;
  homeRunLineCovered: boolean | null;
  totalResult: string | null;
  awayWon: boolean | null;
}

interface MlbLast5PanelProps {
  /** AN url_slug for the away team, e.g. "arizona-diamondbacks" */
  awaySlug: string;
  /** AN url_slug for the home team, e.g. "philadelphia-phillies" */
  homeSlug: string;
  /** Display name for the away team (city name) */
  awayName: string;
  /** Display name for the home team (city name) */
  homeName: string;
  /** Logo URL for the away team */
  awayLogoUrl?: string;
  /** Logo URL for the home team */
  homeLogoUrl?: string;
  /** Accent border color inherited from the parent GameCard */
  borderColor?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
}

function fmtRunLine(value: string | null, odds: string | null): string {
  if (!value) return "—";
  const v = parseFloat(value);
  const sign = v >= 0 ? "+" : "";
  return odds ? `${sign}${v} (${odds})` : `${sign}${v}`;
}

function fmtTotal(total: string | null): string {
  if (!total) return "—";
  return String(parseFloat(total));
}

function fmtML(ml: string | null): string {
  return ml ?? "—";
}

function mlColor(ml: string | null): string {
  if (!ml) return "text-white";
  const n = parseInt(ml.replace("+", ""));
  if (n > 0) return "text-[#45E0A8]";
  if (n < -150) return "text-white";
  return "text-white";
}

// ─── Result Chip ──────────────────────────────────────────────────────────────

function Chip({
  label,
  variant,
}: {
  label: string;
  variant: "win" | "loss" | "push" | "neutral";
}) {
  const cls = {
    win:     "bg-black text-[#45E0A8] border-[#45E0A8]",
    loss:    "bg-black text-white border-white",
    push:    "bg-black text-white border-white",
    neutral: "bg-black text-white border-white",
  }[variant];
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center px-1.5 py-0.5 rounded text-xs font-bold border font-mono tracking-wide leading-none",
        cls
      )}
    >
      {label}
    </span>
  );
}

// ─── Single Game Row ──────────────────────────────────────────────────────────

function GameRow({
  game,
  teamSlug,
}: {
  game: ScheduleGame;
  teamSlug: string;
}) {
  const isAway = game.awaySlug === teamSlug;

  // Opponent
  const oppSlug    = isAway ? game.homeSlug  : game.awaySlug;
  const oppAbbr    = isAway ? game.homeAbbr  : game.awayAbbr;
  const oppTeamId  = isAway ? game.homeTeamId : game.awayTeamId;
  const oppTeam    = MLB_BY_AN_SLUG.get(oppSlug);
  const oppLogo    = oppTeam?.logoUrl ?? `https://www.mlbstatic.com/team-logos/${oppTeamId}.svg`;

  // Scores
  const myScore  = isAway ? game.awayScore  : game.homeScore;
  const oppScore = isAway ? game.homeScore  : game.awayScore;

  // Odds (this team's perspective)
  const myRunLine     = isAway ? game.dkAwayRunLine     : game.dkHomeRunLine;
  const myRunLineOdds = isAway ? game.dkAwayRunLineOdds : game.dkHomeRunLineOdds;
  const myML          = isAway ? game.dkAwayML          : game.dkHomeML;
  const myCovered     = isAway ? game.awayRunLineCovered : game.homeRunLineCovered;

  // W/L
  const myWon = game.awayWon != null
    ? (isAway ? game.awayWon : !game.awayWon)
    : null;

  // Chips
  const wlVariant: "win" | "loss" | "neutral" =
    myWon === true ? "win" : myWon === false ? "loss" : "neutral";
  const covVariant: "win" | "loss" | "neutral" =
    myCovered === true ? "win" : myCovered === false ? "loss" : "neutral";
  const ouVariant: "win" | "loss" | "push" | "neutral" =
    game.totalResult === "OVER" ? "win"
    : game.totalResult === "UNDER" ? "loss"
    : game.totalResult === "PUSH" ? "push"
    : "neutral";

  const scoreStr =
    myScore != null && oppScore != null
      ? `${myScore}-${oppScore}`
      : "—";

  return (
    <tr className="border-b border-white transition-colors">
      {/* Date */}
      <td className="px-2 py-1.5 text-sm text-white font-mono whitespace-nowrap">
        {fmtDate(game.gameDate)}
      </td>

      {/* H/A */}
      <td className="px-1 py-1.5 text-center">
        <span
          className={cn(
            "text-[8px] font-bold font-mono px-1 py-0.5 rounded",
            isAway
              ? "bg-black text-white"
              : "bg-black text-white"
          )}
        >
          {isAway ? "A" : "H"}
        </span>
      </td>

      {/* Opponent logo + abbr */}
      <td className="px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <img
            src={oppLogo}
            alt={oppAbbr}
            className="w-5 h-5 object-contain flex-shrink-0"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
          <span className="text-sm font-mono text-white font-semibold">
            {oppAbbr}
          </span>
        </div>
      </td>

      {/* Score */}
      <td className="px-2 py-1.5 text-center">
        <span
          className={cn(
            "text-sm font-mono font-bold",
            myWon === true
              ? "text-[#45E0A8]"
              : myWon === false
              ? "text-white"
              : "text-white"
          )}
        >
          {scoreStr}
        </span>
      </td>

      {/* W/L */}
      <td className="px-1 py-1.5 text-center">
        <Chip
          label={myWon === true ? "W" : myWon === false ? "L" : "—"}
          variant={wlVariant}
        />
      </td>

      {/* Run Line */}
      <td className="px-2 py-1.5">
        <span className="text-xs font-mono text-white whitespace-nowrap">
          {fmtRunLine(myRunLine, myRunLineOdds)}
        </span>
      </td>

      {/* RL Cover */}
      <td className="px-1 py-1.5 text-center">
        <Chip
          label={myCovered === true ? "COV" : myCovered === false ? "NO" : "—"}
          variant={covVariant}
        />
      </td>

      {/* Total */}
      <td className="px-2 py-1.5 text-center">
        <span className="text-xs font-mono text-white">
          {fmtTotal(game.dkTotal)}
        </span>
      </td>

      {/* O/U */}
      <td className="px-1 py-1.5 text-center">
        <Chip
          label={game.totalResult ?? "—"}
          variant={ouVariant}
        />
      </td>

      {/* Moneyline */}
      <td className="px-2 py-1.5 text-center">
        <span className={cn("text-sm font-mono font-bold", mlColor(myML))}>
          {fmtML(myML)}
        </span>
      </td>
    </tr>
  );
}

// ─── Team Section ─────────────────────────────────────────────────────────────

function TeamSection({
  teamSlug,
  teamName,
  logoUrl,
  games,
  onLogoClick,
}: {
  teamSlug: string;
  teamName: string;
  logoUrl?: string;
  games: ScheduleGame[];
  onLogoClick: () => void;
}) {
  const teamInfo = MLB_BY_AN_SLUG.get(teamSlug);
  const resolvedLogo = logoUrl ?? teamInfo?.logoUrl;

  return (
    <div className="flex-1 min-w-0">
      {/* Team header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white">
        <button type="button" onClick={onLogoClick}
          className="flex-shrink-0 group relative"
          title={`View ${teamName} full schedule`}
        >
          {resolvedLogo && (
            <img
              src={resolvedLogo}
              alt={teamName}
              className="w-7 h-7 object-contain transition-transform group-hover:scale-110"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          )}
          <ExternalLink className="w-2.5 h-2.5 text-white absolute -top-0.5 -right-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>
        <div className="min-w-0">
          <span className="text-sm font-bold text-white font-mono tracking-wide truncate block">
            {teamName.toUpperCase()}
          </span>
          <span className="text-xs text-white font-mono">LAST 5 GAMES</span>
        </div>
      </div>

      {/* Table */}
      {games.length === 0 ? (
        <div className="px-3 py-4 text-center">
          <p className="text-sm text-white font-mono">No completed games found.</p>
          <p className="text-sm text-white font-mono mt-0.5">Run a schedule backfill to populate data.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px]">
            <thead>
              <tr className="border-b border-white">
                <th className="px-2 py-1 text-[8px] font-bold text-white font-mono tracking-widest text-left">DATE</th>
                <th className="px-1 py-1 text-[8px] font-bold text-white font-mono tracking-widest text-center">H/A</th>
                <th className="px-2 py-1 text-[8px] font-bold text-white font-mono tracking-widest text-left">OPP</th>
                <th className="px-2 py-1 text-[8px] font-bold text-white font-mono tracking-widest text-center">SCORE</th>
                <th className="px-1 py-1 text-[8px] font-bold text-white font-mono tracking-widest text-center">W/L</th>
                <th className="px-2 py-1 text-[8px] font-bold text-white font-mono tracking-widest text-left">RUN LINE</th>
                <th className="px-1 py-1 text-[8px] font-bold text-white font-mono tracking-widest text-center">COV</th>
                <th className="px-2 py-1 text-[8px] font-bold text-white font-mono tracking-widest text-center">TOTAL</th>
                <th className="px-1 py-1 text-[8px] font-bold text-white font-mono tracking-widest text-center">O/U</th>
                <th className="px-2 py-1 text-[8px] font-bold text-white font-mono tracking-widest text-center">ML</th>
              </tr>
            </thead>
            <tbody>
              {games.map((g) => (
                <GameRow key={g.anGameId} game={g} teamSlug={teamSlug} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function MlbLast5Panel({
  awaySlug,
  homeSlug,
  awayName,
  homeName,
  awayLogoUrl,
  homeLogoUrl,
  borderColor = "hsl(var(--border))",
}: MlbLast5PanelProps) {
  const [, navigate] = useLocation();
  const [isExpanded, setIsExpanded] = useState(true);

  // Only query when both slugs are valid AN slugs
  const enabled = !!awaySlug && !!homeSlug;

  const { data, isLoading, error, refetch, isFetching } =
    trpc.mlbSchedule.getLast5ForMatchup.useQuery(
      { awaySlug, homeSlug },
      {
        enabled,
        staleTime: 4 * 60 * 1000,       // 4 min — matches refresh interval
        refetchInterval: 4 * 60 * 1000, // auto-poll every 4 min (keeps pace with schedule history scheduler)
        retry: 1,
      }
    );

  const awayLast5 = (data?.awayLast5 ?? []) as ScheduleGame[];
  const homeLast5 = (data?.homeLast5 ?? []) as ScheduleGame[];

  const handleAwayLogoClick = () => navigate(`/mlb/team/${awaySlug}`);
  const handleHomeLogoClick = () => navigate(`/mlb/team/${homeSlug}`);

  return (
    <div
      className="w-full"
      style={{
        background: "hsl(var(--card))",
        borderLeft: `3px solid ${borderColor}`,
        borderBottom: "1px solid hsl(var(--border))",
      }}
    >
      {/* ── Collapsible Header ────────────────────────────────────────────── */}
      <button type="button" onClick={() => setIsExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-white font-mono tracking-widest uppercase">
            Last 5 Games
          </span>
          <span className="text-xs text-white font-mono">
            DK NJ · Run Line · Total · ML
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isFetching && (
            <RefreshCw className="w-3 h-3 text-white animate-spin" />
          )}
          {isExpanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-white" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-white" />
          )}
        </div>
      </button>

      {/* ── Collapsible Body ──────────────────────────────────────────────── */}
      {isExpanded && (
        <div className="border-t border-white">
          {/* Loading */}
          {isLoading && (
            <div className="flex items-center justify-center py-6">
              <RefreshCw className="w-4 h-4 text-white animate-spin mr-2" />
              <span className="text-sm text-white font-mono">
                Loading last 5 games...
              </span>
            </div>
          )}

          {/* Error */}
          {error && !isLoading && (
            <div className="px-3 py-3">
              <p className="text-sm text-white font-mono">
                Error: {error.message}
              </p>
              <button type="button" onClick={() => refetch()}
                className="text-xs text-white font-mono mt-1 hover:underline"
              >
                Retry
              </button>
            </div>
          )}

          {/* Data */}
          {!isLoading && !error && (
            <div className="flex flex-col lg:flex-row divide-y lg:divide-y-0 lg:divide-x divide-white">
              {/* Away team */}
              <TeamSection
                teamSlug={awaySlug}
                teamName={awayName}
                logoUrl={awayLogoUrl}
                games={awayLast5}
                onLogoClick={handleAwayLogoClick}
              />
              {/* Home team */}
              <TeamSection
                teamSlug={homeSlug}
                teamName={homeName}
                logoUrl={homeLogoUrl}
                games={homeLast5}
                onLogoClick={handleHomeLogoClick}
              />
            </div>
          )}


        </div>
      )}
    </div>
  );
}
