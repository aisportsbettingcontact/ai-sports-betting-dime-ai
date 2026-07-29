/**
 * SituationalResultsPanel.tsx  —  "TRENDS"
 *
 * Situational records (Moneyline / Run Line / Total) for both teams in a
 * matchup, rendered as comparative record bars. Law-v2 styling:
 *   - Quiet #262626 hairlines (border-border); white keylines are rationed
 *     elsewhere, never used as row dividers here.
 *   - Mint is signal only: the side with the better win% in each row. The
 *     trailing side drops to a tonal grey tier (fixes the white-on-white
 *     comparative-bar artifact recorded in THREE-COLOR-LAW.md).
 *   - Active tab = raised surface per MASTER.md tab-pill spec, not a mint
 *     flood; text tiers come from --text-secondary / --text-muted.
 *
 * Data source: DraftKings NJ via Action Network API (book_id=68)
 *   MLB  → trpc.mlbSchedule.getSituationalStats
 *
 * Logging: [TRENDS][STEP] fully traceable
 */

import { useState } from "react";
import type { KeyboardEvent } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp } from "lucide-react";
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
  /** When false, the panel renders permanently expanded with a static
   *  (non-interactive) header — no chevron, no toggle. Default true keeps
   *  the existing accordion behavior for the splits surface. */
  collapsible?: boolean;
  /** IntersectionObserver gate — only fetch data when card is in viewport */
  enabled?: boolean;
  /** "standalone" (default) draws its own left rail + bottom border for the
   *  splits surface. "embedded" renders frameless inside a host card
   *  (Trends page) — the card owns the chrome. */
  variant?: "standalone" | "embedded";
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

/** Baseball-style ".549" percentage; empty string when no data. */
function fmtPct(pct: number): string {
  if (pct < 0) return "";
  if (pct >= 0.9995) return "1.000";
  return "." + Math.round(pct * 1000).toString().padStart(3, "0");
}

type BarTone = "lead" | "trail" | "even" | "empty";

/**
 * Comparative tones. leftPct and rightPct are win percentages (-1 = no data).
 * The better win% side is the mint signal; the trailing side is a tonal grey
 * tier (never red — negative states are grey per brand law).
 */
function comparativeTones(leftPct: number, rightPct: number): [BarTone, BarTone] {
  const noLeft = leftPct < 0;
  const noRight = rightPct < 0;

  if (noLeft && noRight) return ["empty", "empty"];
  if (noLeft) return ["empty", "lead"];
  if (noRight) return ["lead", "empty"];

  const EPSILON = 0.001;
  if (Math.abs(leftPct - rightPct) < EPSILON) return ["even", "even"];
  return leftPct > rightPct ? ["lead", "trail"] : ["trail", "lead"];
}

const BAR_TONE_CLASS: Record<BarTone, string> = {
  lead: "bg-[#45E0A8] text-black",
  trail: "bg-[var(--surface-raised)] text-[var(--text-secondary)]",
  even: "bg-[var(--surface-raised)] text-foreground",
  empty: "border border-border text-[var(--text-muted)]",
};

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

function RecordBar({
  rec,
  tone,
  teamName,
  label,
}: {
  rec: SituationalRecord | undefined;
  tone: BarTone;
  teamName: string;
  label: string;
}) {
  const pct = winPct(rec);
  const pctStr = fmtPct(pct);
  return (
    <div
      role="img"
      aria-label={`${teamName} ${label}: ${fmtRecord(rec)}`}
      className={cn(
        "flex-1 flex items-baseline justify-center gap-1.5 py-1.5 rounded-lg",
        "text-[12px] font-bold font-mono tabular-nums",
        BAR_TONE_CLASS[tone]
      )}
    >
      <span>{fmtRecord(rec)}</span>
      {pctStr && (
        <span className="text-[9px] font-medium leading-none">{pctStr}</span>
      )}
    </div>
  );
}

function RecordRow({
  label,
  awayRec,
  homeRec,
  awayName,
  homeName,
}: {
  label: string;
  awayRec: SituationalRecord | undefined;
  homeRec: SituationalRecord | undefined;
  awayName: string;
  homeName: string;
}) {
  const [awayTone, homeTone] = comparativeTones(winPct(awayRec), winPct(homeRec));

  return (
    <div className="mb-2.5 last:mb-0">
      <div className="mb-1 text-center text-[9px] font-mono font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
        {label}
      </div>
      <div className="flex gap-1.5">
        <RecordBar rec={awayRec} tone={awayTone} teamName={awayName} label={label} />
        <RecordBar rec={homeRec} tone={homeTone} teamName={homeName} label={label} />
      </div>
    </div>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function StatsSkeleton() {
  return (
    <div className="px-3 py-3" aria-hidden="true">
      <div className="flex items-center justify-between mb-4">
        <div className="h-4 w-28 rounded bg-[var(--surface-raised)] animate-pulse" />
        <div className="h-4 w-28 rounded bg-[var(--surface-raised)] animate-pulse" />
      </div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="mb-2.5">
          <div className="mx-auto mb-1 h-2 w-16 rounded bg-[var(--surface-raised)] animate-pulse" />
          <div className="flex gap-1.5">
            <div className="flex-1 h-7 rounded-lg bg-[var(--surface-raised)] animate-pulse" />
            <div className="flex-1 h-7 rounded-lg bg-[var(--surface-raised)] animate-pulse" />
          </div>
        </div>
      ))}
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
    return <StatsSkeleton />;
  }

  if (error) {
    return (
      <div className="px-4 py-5 text-center">
        <p className="text-[11px] font-semibold text-foreground">
          Couldn't load trends
        </p>
        <p className="mt-1 text-[10px] text-[var(--text-muted)]">{error.message}</p>
      </div>
    );
  }

  // Select the correct sub-object based on active tab
  const awayData = awayStats?.[tab];
  const homeData = homeStats?.[tab];

  return (
    <div className="px-3 py-3">
      {/* ── Team header row — full names ─────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 mb-3.5">
        {/* Away team */}
        <div className="flex items-center gap-2 min-w-0">
          {awayLogo && (
            <img
              src={awayLogo}
              alt=""
              loading="lazy"
              className="w-6 h-6 object-contain flex-shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}
          <span className="text-[11px] font-bold text-foreground uppercase tracking-wide truncate">
            {awayName}
          </span>
        </div>
        {/* Home team */}
        <div className="flex items-center gap-2 flex-row-reverse min-w-0">
          {homeLogo && (
            <img
              src={homeLogo}
              alt=""
              loading="lazy"
              className="w-6 h-6 object-contain flex-shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}
          <span className="text-[11px] font-bold text-foreground uppercase tracking-wide truncate text-right">
            {homeName}
          </span>
        </div>
      </div>

      {/* ── Record rows ─────────────────────────────────────────────────── */}
      <RecordRow
        label="Overall Record"
        awayRec={awayData?.overall}
        homeRec={homeData?.overall}
        awayName={awayName}
        homeName={homeName}
      />
      <RecordRow
        label="Last 10"
        awayRec={awayData?.last10}
        homeRec={homeData?.last10}
        awayName={awayName}
        homeName={homeName}
      />
      <RecordRow
        label={tab === "total" ? "Home O/U" : "Home"}
        awayRec={awayData?.home}
        homeRec={homeData?.home}
        awayName={awayName}
        homeName={homeName}
      />
      <RecordRow
        label={tab === "total" ? "Away O/U" : "Away"}
        awayRec={awayData?.away}
        homeRec={homeData?.away}
        awayName={awayName}
        homeName={homeName}
      />
      {tab !== "total" && (
        <>
          <RecordRow
            label="Underdog"
            awayRec={awayData?.underdog}
            homeRec={homeData?.underdog}
            awayName={awayName}
            homeName={homeName}
          />
          <RecordRow
            label="Favorite"
            awayRec={awayData?.favorite}
            homeRec={homeData?.favorite}
            awayName={awayName}
            homeName={homeName}
          />
        </>
      )}
      {tab === "total" && (
        <>
          <RecordRow
            label="Fav O/U"
            awayRec={awayData?.favorite}
            homeRec={homeData?.favorite}
            awayName={awayName}
            homeName={homeName}
          />
          <RecordRow
            label="Dog O/U"
            awayRec={awayData?.underdog}
            homeRec={homeData?.underdog}
            awayName={awayName}
            homeName={homeName}
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
  collapsible = true,
  enabled = true,
  variant = "standalone",
}: SituationalResultsPanelProps) {
  const [tab, setTab] = useState<SitTab>("ml");
  const [expandedState, setIsExpanded] = useState(!defaultCollapsed);
  const isExpanded = collapsible ? expandedState : true;

  const sLabel = spreadTabLabel(sport);

  const tabs: { key: SitTab; label: string }[] = [
    { key: "ml",     label: "Moneyline" },
    { key: "total",  label: "Total"     },
    { key: "spread", label: sLabel      },
  ];

  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = tabs.findIndex(t => t.key === tab);
    const next = e.key === "ArrowRight"
      ? tabs[(i + 1) % tabs.length]
      : tabs[(i - 1 + tabs.length) % tabs.length];
    setTab(next.key);
  };

  // Suppress unused-variable warnings for abbr props (kept in interface for
  // backward compat with GameCard which passes them)
  void awayAbbr; void homeAbbr;

  return (
    <div
      className="w-full h-full flex flex-col"
      style={
        variant === "standalone"
          ? {
              background: "hsl(var(--card))",
              borderLeft: `3px solid ${borderColor}`,
              borderBottom: "1px solid hsl(var(--border))",
            }
          : undefined
      }
    >
      {/* ── Collapsible Header ─────────────────────────────────────────────── */}
      {collapsible ? (
        <button type="button" onClick={() => setIsExpanded((v) => !v)}
          aria-expanded={isExpanded}
          className={cn(
            "w-full box-border flex items-center justify-between px-3 py-2 cursor-pointer",
            "transition-colors duration-[160ms] ease-[cubic-bezier(0.16,1,0.3,1)]",
            "hover:bg-[var(--row-hover)]"
          )}
        >
          <span className="text-[10px] font-bold font-mono tracking-widest uppercase text-[var(--text-secondary)]">
            Trends
          </span>
          <div className="flex items-center gap-1">
            {isExpanded
              ? <ChevronUp className="w-3.5 h-3.5 text-[var(--text-muted)]" />
              : <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            }
          </div>
        </button>
      ) : (
        <div className="w-full box-border flex items-center justify-between px-3 py-2">
          <span className="text-[10px] font-bold font-mono tracking-widest uppercase text-[var(--text-secondary)]">
            Trends
          </span>
          {/* empty spacer keeps the collapsible header's justify-between geometry */}
          <div className="flex items-center gap-1" />
        </div>
      )}

      {/* ── Collapsible Body ───────────────────────────────────────────────── */}
      {isExpanded && (
        <div className="border-t border-border flex-1 flex flex-col">
          {/* ── Tab selector ─────────────────────────────────────────────── */}
          <div
            role="tablist"
            aria-label="Trend market"
            className="flex items-center gap-1 px-3 py-2 border-b border-border"
          >
            {tabs.map((t) => (
              <button type="button" key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                onKeyDown={onTabKeyDown}
                className={cn(
                  "flex-1 py-1.5 rounded-full text-[10px] font-bold cursor-pointer",
                  "transition-[background-color,color,transform] duration-[160ms] ease-[cubic-bezier(0.16,1,0.3,1)]",
                  "active:scale-[0.97] motion-reduce:transform-none",
                  tab === t.key
                    ? "bg-[var(--surface-raised)] text-foreground"
                    : "text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--row-hover)]"
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
