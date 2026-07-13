/**
 * SituationalResultsPanel.tsx  —  "TRENDS"
 *
 * Renamed to TRENDS per product spec.
 * Changes from previous version:
 *   - Title: "TRENDS" (was "Situational Results")
 *   - Subtitle "ML · Run Line · Total" removed
 *   - Team header uses full awayName / homeName (not abbreviations)
 *   - fmtRecord shows pushes when non-zero: "W-L-P"
 *   - barColor is COMPARATIVE: the team with the better win% in each row
 *     gets emerald-600 (green), the worse team gets red-700 (red).
 *     Equal win% → both get a neutral gray bar.
 *
 * Data source: DraftKings NJ via Action Network API (book_id=68)
 *   MLB  → trpc.mlbSchedule.getSituationalStats
 *
 * Logging: [TRENDS][STEP] fully traceable
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { MLB_BY_AN_SLUG } from "@shared/mlbTeams";
import { NBA_BY_AN_SLUG } from "@shared/nbaTeams";
import { NHL_BY_AN_SLUG } from "@shared/nhlTeams";

// ─── Types ────────────────────────────────────────────────────────────────────

type Sport = "MLB" | "NBA" | "NHL";
type SitTab = "ml" | "spread" | "total";

interface SituationalRecord {
  wins: number;
  losses: number;
  pushes?: number;
}

interface SituationalStats {
  ml: {
    overall: SituationalRecord;
    last10: SituationalRecord;
    home: SituationalRecord;
    away: SituationalRecord;
    favorite: SituationalRecord;
    underdog: SituationalRecord;
  };
  spread: {
    overall: SituationalRecord;
    last10: SituationalRecord;
    home: SituationalRecord;
    away: SituationalRecord;
    favorite: SituationalRecord;
    underdog: SituationalRecord;
  };
  total: {
    overall: SituationalRecord;
    last10: SituationalRecord;
    home: SituationalRecord;
    away: SituationalRecord;
    favorite: SituationalRecord;
    underdog: SituationalRecord;
  };
  gamesAnalyzed: number;
}

export interface SituationalResultsPanelProps {
  sport: Sport;
  awaySlug: string;
  homeSlug: string;
  awayAbbr: string;
  homeAbbr: string;
  awayName: string;
  homeName: string;
  awayLogoUrl?: string;
  homeLogoUrl?: string;
  borderColor?: string;
  /** When true, the panel starts collapsed. Defaults to false (expanded). */
  defaultCollapsed?: boolean;
  /** IntersectionObserver gate — only fetch data when card is in viewport */
  enabled?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format a record as "W-L" or "W-L-P" when pushes > 0.
 * Returns "—" when no games played.
 */
function fmtRecord(rec: SituationalRecord | undefined): string {
  if (!rec) return "—";
  const total = rec.wins + rec.losses + (rec.pushes ?? 0);
  if (total === 0) return "—";
  if (rec.pushes && rec.pushes > 0) return `${rec.wins}-${rec.losses}-${rec.pushes}`;
  return `${rec.wins}-${rec.losses}`;
}

/**
 * Win percentage for a record (pushes excluded from denominator).
 * Returns -1 when no games played (used to detect "no data").
 */
function winPct(rec: SituationalRecord | undefined): number {
  if (!rec) return -1;
  const denom = rec.wins + rec.losses;
  if (denom === 0) return -1;
  return rec.wins / denom;
}

/**
 * Comparative bar colors.
 * leftPct and rightPct are win percentages (-1 = no data).
 * Returns [leftClass, rightClass].
 *
 * Rules:
 *   - If both have no data → both neutral gray
 *   - If only one has data → that one gets green, other neutral
 *   - If equal win% → both neutral gray
 *   - Otherwise → higher win% gets emerald-600 (green), lower gets red-700 (red)
 */
function comparativeColors(
  leftPct: number,
  rightPct: number
): [string, string] {
  const noLeft  = leftPct  < 0;
  const noRight = rightPct < 0;

  if (noLeft && noRight) return ["bg-black", "bg-black"];
  if (noLeft)  return ["bg-black", "bg-[#45E0A8]"];
  if (noRight) return ["bg-[#45E0A8]", "bg-black"];

  const EPSILON = 0.001;
  if (Math.abs(leftPct - rightPct) < EPSILON) return ["bg-black", "bg-black"];

  if (leftPct > rightPct) return ["bg-[#45E0A8]", "bg-white"];
  return ["bg-white", "bg-[#45E0A8]"];
}

function resolveLogoUrl(slug: string, sport: Sport): string | undefined {
  if (sport === "MLB") return MLB_BY_AN_SLUG.get(slug)?.logoUrl;
  if (sport === "NBA") return NBA_BY_AN_SLUG.get(slug)?.logoUrl;
  if (sport === "NHL") return NHL_BY_AN_SLUG.get(slug)?.logoUrl;
  return undefined;
}

function spreadTabLabel(sport: Sport): string {
  if (sport === "MLB") return "Run Line";
  if (sport === "NHL") return "Puck Line";
  return "Spread";
}

// ─── Record Bar Row ───────────────────────────────────────────────────────────

function RecordRow({
  label,
  awayRec,
  homeRec,
}: {
  label: string;
  awayRec: SituationalRecord | undefined;
  homeRec: SituationalRecord | undefined;
}) {
  const awayPct = winPct(awayRec);
  const homePct = winPct(homeRec);
  const [awayColor, homeColor] = comparativeColors(awayPct, homePct);

  return (
    <div className="mb-3">
      {/* Label row */}
      <div className="flex items-center justify-between mb-1 px-1">
        <span className="text-[9px] text-white font-mono">{label}</span>
        <span className="text-[9px] text-white font-mono text-right">{label}</span>
      </div>
      {/* Bar row */}
      <div className="flex gap-2">
        {/* Away (left) bar */}
        <div
          className={cn(
            "flex-1 flex items-center justify-center py-1.5 rounded text-[11px] font-bold text-white font-mono",
            awayColor
          )}
        >
          {fmtRecord(awayRec)}
        </div>
        {/* Home (right) bar */}
        <div
          className={cn(
            "flex-1 flex items-center justify-center py-1.5 rounded text-[11px] font-bold text-white font-mono",
            homeColor
          )}
        >
          {fmtRecord(homeRec)}
        </div>
      </div>
    </div>
  );
}

// ─── Stats Section (one tab's worth of data) ─────────────────────────────────

function StatsSection({
  sport,
  awaySlug,
  homeSlug,
  awayName,
  homeName,
  awayLogoUrl,
  homeLogoUrl,
  tab,
  enabled = true,
}: {
  sport: Sport;
  awaySlug: string;
  homeSlug: string;
  awayName: string;
  homeName: string;
  awayLogoUrl?: string;
  homeLogoUrl?: string;
  tab: SitTab;
  enabled?: boolean;
}) {
  // ── MLB query ────────────────────────────────────────────────────────────
  const mlbAwayQuery = trpc.mlbSchedule.getSituationalStats.useQuery(
    { teamSlug: awaySlug },
    {
      enabled: (enabled ?? true) && sport === "MLB",
      staleTime: 4 * 60 * 1000,       // 4 min — matches schedule history refresh cadence
      refetchInterval: 4 * 60 * 1000, // auto-poll every 4 min for real-time record updates
      retry: 1,
    }
  );
  const mlbHomeQuery = trpc.mlbSchedule.getSituationalStats.useQuery(
    { teamSlug: homeSlug },
    {
      enabled: (enabled ?? true) && sport === "MLB",
      staleTime: 4 * 60 * 1000,
      refetchInterval: 4 * 60 * 1000,
      retry: 1,
    }
  );

  // ── NBA query ────────────────────────────────────────────────────────────
  const nbaAwayQuery = trpc.nbaSchedule.getSituationalStats.useQuery(
    { teamSlug: awaySlug },
    { enabled: (enabled ?? true) && sport === "NBA", staleTime: 5 * 60 * 1000, retry: 1 }
  );
  const nbaHomeQuery = trpc.nbaSchedule.getSituationalStats.useQuery(
    { teamSlug: homeSlug },
    { enabled: (enabled ?? true) && sport === "NBA", staleTime: 5 * 60 * 1000, retry: 1 }
  );
  // ── NHL query ───────────────────────────────────────────────────────────────────────────
  // SECURITY: include enabled prop to respect parent auth gate
  const nhlAwayQuery = trpc.nhlSchedule.getSituationalStats.useQuery(
    { teamSlug: awaySlug },
    { enabled: (enabled ?? true) && sport === "NHL", staleTime: 5 * 60 * 1000, retry: 1 }
  );
  const nhlHomeQuery = trpc.nhlSchedule.getSituationalStats.useQuery(
    { teamSlug: homeSlug },
    { enabled: (enabled ?? true) && sport === "NHL", staleTime: 5 * 60 * 1000, retry: 1 }
  );

  const awayQuery =
    sport === "MLB" ? mlbAwayQuery
    : sport === "NBA" ? nbaAwayQuery
    : nhlAwayQuery;

  const homeQuery =
    sport === "MLB" ? mlbHomeQuery
    : sport === "NBA" ? nbaHomeQuery
    : nhlHomeQuery;

  const isLoading = awayQuery.isLoading || homeQuery.isLoading;
  const error = awayQuery.error ?? homeQuery.error;

  const awayStats = awayQuery.data as SituationalStats | undefined;
  const homeStats = homeQuery.data as SituationalStats | undefined;

  const awayLogo = awayLogoUrl ?? resolveLogoUrl(awaySlug, sport);
  const homeLogo = homeLogoUrl ?? resolveLogoUrl(homeSlug, sport);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <RefreshCw className="w-4 h-4 text-white animate-spin mr-2" />
        <span className="text-[10px] text-white font-mono">Loading trends...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-4">
        <p className="text-[10px] text-white font-mono">
          [TRENDS][ERROR] {error.message}
        </p>
      </div>
    );
  }

  // Select the correct sub-object based on active tab
  const awayData = awayStats?.[tab];
  const homeData = homeStats?.[tab];

  return (
    <div className="px-3 py-3">
      {/* ── Team header row — full names ─────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        {/* Away team */}
        <div className="flex items-center gap-2 min-w-0">
          {awayLogo && (
            <img
              src={awayLogo}
              alt={awayName}
              className="w-6 h-6 object-contain flex-shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}
          <span className="text-[11px] font-bold text-white font-mono uppercase truncate">
            {awayName}
          </span>
        </div>
        {/* Home team */}
        <div className="flex items-center gap-2 flex-row-reverse min-w-0">
          {homeLogo && (
            <img
              src={homeLogo}
              alt={homeName}
              className="w-6 h-6 object-contain flex-shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}
          <span className="text-[11px] font-bold text-white font-mono uppercase truncate">
            {homeName}
          </span>
        </div>
      </div>

      {/* ── Record rows ─────────────────────────────────────────────────── */}
      <RecordRow
        label="Overall Record"
        awayRec={awayData?.overall}
        homeRec={homeData?.overall}
      />
      <RecordRow
        label="Last 10"
        awayRec={awayData?.last10}
        homeRec={homeData?.last10}
      />
      <RecordRow
        label={tab === "total" ? "Home O/U" : "Home"}
        awayRec={awayData?.home}
        homeRec={homeData?.home}
      />
      <RecordRow
        label={tab === "total" ? "Away O/U" : "Away"}
        awayRec={awayData?.away}
        homeRec={homeData?.away}
      />
      {tab !== "total" && (
        <>
          <RecordRow
            label="Underdog"
            awayRec={awayData?.underdog}
            homeRec={homeData?.underdog}
          />
          <RecordRow
            label="Favorite"
            awayRec={awayData?.favorite}
            homeRec={homeData?.favorite}
          />
        </>
      )}
      {tab === "total" && (
        <>
          <RecordRow
            label="Fav O/U"
            awayRec={awayData?.favorite}
            homeRec={homeData?.favorite}
          />
          <RecordRow
            label="Dog O/U"
            awayRec={awayData?.underdog}
            homeRec={homeData?.underdog}
          />
        </>
      )}
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function SituationalResultsPanel({
  sport,
  awaySlug,
  homeSlug,
  awayAbbr,
  homeAbbr,
  awayName,
  homeName,
  awayLogoUrl,
  homeLogoUrl,
  borderColor = "hsl(var(--border))",
  defaultCollapsed = false,
  enabled = true,
}: SituationalResultsPanelProps) {
  const [tab, setTab] = useState<SitTab>("ml");
  const [isExpanded, setIsExpanded] = useState(!defaultCollapsed);

  const sLabel = spreadTabLabel(sport);

  const tabs: { key: SitTab; label: string }[] = [
    { key: "ml",     label: "Moneyline" },
    { key: "total",  label: "Total"     },
    { key: "spread", label: sLabel      },
  ];

  // Suppress unused-variable warnings for abbr props (kept in interface for
  // backward compat with GameCard which passes them)
  void awayAbbr; void homeAbbr;

  return (
    <div
      className="w-full"
      style={{
        background: "hsl(var(--card))",
        borderLeft: `3px solid ${borderColor}`,
        borderBottom: "1px solid hsl(var(--border))",
      }}
    >
      {/* ── Collapsible Header ─────────────────────────────────────────────── */}
      <button type="button" onClick={() => setIsExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 transition-colors"
      >
        <span className="text-[10px] font-bold text-white font-mono tracking-widest uppercase">
          Trends
        </span>
        <div className="flex items-center gap-1">
          {isExpanded
            ? <ChevronUp className="w-3.5 h-3.5 text-white" />
            : <ChevronDown className="w-3.5 h-3.5 text-white" />
          }
        </div>
      </button>

      {/* ── Collapsible Body ───────────────────────────────────────────────── */}
      {isExpanded && (
        <div className="border-t border-white">
          {/* ── Tab selector ─────────────────────────────────────────────── */}
          <div className="flex items-center gap-1 px-3 py-2 border-b border-white">
            {tabs.map((t) => (
              <button type="button" key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "flex-1 py-1.5 rounded-full text-[10px] font-bold font-mono transition-all",
                  tab === t.key
                    ? "bg-[#45E0A8] text-black"
                    : "text-white hover:text-white"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Stats content ─────────────────────────────────────────────── */}
          <StatsSection
            sport={sport}
            awaySlug={awaySlug}
            homeSlug={homeSlug}
            awayName={awayName}
            homeName={homeName}
            awayLogoUrl={awayLogoUrl}
            homeLogoUrl={homeLogoUrl}
            tab={tab}
            enabled={enabled}
          />
        </div>
      )}
    </div>
  );
}
