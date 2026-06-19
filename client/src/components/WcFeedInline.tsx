/**
 * WcFeedInline.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * World Cup 2026 feed rendered INLINE on the ModelProjections page.
 * This is NOT a standalone page — it is mounted directly inside the feed
 * when selectedSport === "WC", exactly like MLB and NHL game cards.
 *
 * Sub-tabs: PROJECTIONS | SPLITS | LINEUPS | STANDINGS | FUTURES
 *
 * PROJECTIONS layout — exact GameCard (DesktopMergedPanel) structure:
 *   Left score panel: flag + country name + kickoff time
 *   Right merged panel: 3 SectionCol columns
 *     HOME ML  | BOOK | MODEL
 *     DRAW     | BOOK | MODEL
 *     AWAY ML  | BOOK | MODEL
 *     ─────────────────────────
 *     O {line} | BOOK | MODEL
 *     U {line} | BOOK | MODEL
 *
 * LINEUPS layout — exact MlbLineupCard structure:
 *   background: #090E14, borderRadius: 12, border: 1px solid #182433
 *   3px gradient top bar: linear-gradient(90deg, awayColor 48%, homeColor 52%)
 *   Matchup header: gridTemplateColumns: "1fr auto 1fr"
 *   Lineup columns: gridTemplateColumns: "1fr 1px 1fr"
 *   BattingOrderHeader-equivalent: "Starting XI" header with confirmed/expected dot
 *   LineupRows-equivalent: jersey number + position pill + player name (Barlow Condensed)
 *
 * Data source: DK NJ (book_id=68) via Action Network API
 *   → wc2026.todayWithOdds  (today's fixtures)
 *   → wc2026.fixturesByDate (non-today dates)
 *   → wc2026.lineupsByDate  (lineups tab)
 */

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarDays, MapPin, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { CalendarPicker, todayUTC } from "@/components/CalendarPicker";
import { formatDateHeader } from "@/lib/gameUtils";
import { calculateEdge, calculateRoi, formatRoi, getEdgeColor, EDGE_THRESHOLD_PP, calculate3WayResult } from "@/lib/edgeUtils";
import type { ThreeWayOdds } from "@/lib/edgeUtils";
import { BetCell } from "@/components/BetCell";
import type { BetCellSide } from "@/components/BetCell";

// ─── Constants ────────────────────────────────────────────────────────────────

// Full World Cup 2026 schedule: Group Stage (Jun 11–Jul 2) + Knockouts (Jul 4–Jul 19)
export const WC_DATE_RANGE: string[] = (() => {
  const dates: string[] = [];
  // Group Stage: Jun 11 – Jul 2
  const start = new Date(Date.UTC(2026, 5, 11)); // Jun 11
  const end   = new Date(Date.UTC(2026, 6, 19)); // Jul 19 (Final)
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
})();

// WC_DATE_LABELS: dynamically computed from WC_DATE_RANGE
const WC_DATE_LABELS: Record<string, string> = Object.fromEntries(
  WC_DATE_RANGE.map((d) => {
    const dt = new Date(d + "T12:00:00Z");
    return [
      d,
      dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }),
    ];
  })
);

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

// WC team colors — curated per FIFA country code
const WC_TEAM_COLORS: Record<string, { primary: string; secondary: string }> = {
  MEX: { primary: "#006847", secondary: "#CE1126" },
  RSA: { primary: "#007A4D", secondary: "#FFB612" },
  CAN: { primary: "#FF0000", secondary: "#FFFFFF" },
  NZL: { primary: "#00247D", secondary: "#CC0000" },
  ARG: { primary: "#74ACDF", secondary: "#FFFFFF" },
  MAR: { primary: "#C1272D", secondary: "#006233" },
  ESP: { primary: "#AA151B", secondary: "#F1BF00" },
  POR: { primary: "#006600", secondary: "#FF0000" },
  FRA: { primary: "#002395", secondary: "#ED2939" },
  GER: { primary: "#000000", secondary: "#DD0000" },
  BRA: { primary: "#009C3B", secondary: "#FFDF00" },
  USA: { primary: "#002868", secondary: "#BF0A30" },
  ENG: { primary: "#FFFFFF", secondary: "#CF081F" },
  NED: { primary: "#FF6600", secondary: "#FFFFFF" },
  BEL: { primary: "#000000", secondary: "#EF3340" },
  URU: { primary: "#5AAAA8", secondary: "#FFFFFF" },
  COL: { primary: "#FCD116", secondary: "#003087" },
  ECU: { primary: "#FFD100", secondary: "#0072CE" },
  CHI: { primary: "#D52B1E", secondary: "#003087" },
  PER: { primary: "#D91023", secondary: "#FFFFFF" },
  SEN: { primary: "#00853F", secondary: "#FDEF42" },
  NGA: { primary: "#008751", secondary: "#FFFFFF" },
  CMR: { primary: "#007A5E", secondary: "#CE1126" },
  GHA: { primary: "#006B3F", secondary: "#FCD116" },
  CIV: { primary: "#F77F00", secondary: "#009A44" },
  TUN: { primary: "#E70013", secondary: "#FFFFFF" },
  EGY: { primary: "#CE1126", secondary: "#FFFFFF" },
  ALG: { primary: "#006233", secondary: "#FFFFFF" },
  JPN: { primary: "#003087", secondary: "#BC002D" },
  KOR: { primary: "#003087", secondary: "#CD2E3A" },
  AUS: { primary: "#00843D", secondary: "#FFD700" },
  IRN: { primary: "#239F40", secondary: "#DA0000" },
  SAU: { primary: "#006C35", secondary: "#FFFFFF" },
  QAT: { primary: "#8D1B3D", secondary: "#FFFFFF" },
  UZB: { primary: "#1EB53A", secondary: "#0099B5" },
  SUI: { primary: "#FF0000", secondary: "#FFFFFF" },
  AUT: { primary: "#ED2939", secondary: "#FFFFFF" },
  CRO: { primary: "#FF0000", secondary: "#171796" },
  SRB: { primary: "#C6363C", secondary: "#0C4076" },
  POL: { primary: "#DC143C", secondary: "#FFFFFF" },
  UKR: { primary: "#005BBB", secondary: "#FFD500" },
  CZE: { primary: "#D7141A", secondary: "#11457E" },
  HUN: { primary: "#CE2939", secondary: "#477050" },
  DEN: { primary: "#C60C30", secondary: "#FFFFFF" },
  SWE: { primary: "#006AA7", secondary: "#FECC02" },
  NOR: { primary: "#EF2B2D", secondary: "#003087" },
  FIN: { primary: "#003580", secondary: "#FFFFFF" },
  SCO: { primary: "#003087", secondary: "#FFFFFF" },
  WAL: { primary: "#C8102E", secondary: "#FFFFFF" },
  IRL: { primary: "#169B62", secondary: "#FF883E" },
  ISL: { primary: "#003897", secondary: "#DC1E35" },
  GRE: { primary: "#0D5EAF", secondary: "#FFFFFF" },
  TUR: { primary: "#E30A17", secondary: "#FFFFFF" },
  RUS: { primary: "#D52B1E", secondary: "#003087" },
  SLO: { primary: "#003DA5", secondary: "#EF3340" },
  SVK: { primary: "#0B4EA2", secondary: "#EE1C25" },
  ROM: { primary: "#002B7F", secondary: "#FCD116" },
  BUL: { primary: "#00966E", secondary: "#D62612" },
  PAN: { primary: "#DA121A", secondary: "#003087" },
  CRC: { primary: "#002B7F", secondary: "#CE1126" },
  HON: { primary: "#0073CF", secondary: "#FFFFFF" },
  GTM: { primary: "#4997D0", secondary: "#FFFFFF" },
  SLV: { primary: "#0F47AF", secondary: "#FFFFFF" },
  JAM: { primary: "#000000", secondary: "#FED100" },
  HAI: { primary: "#00209F", secondary: "#D21034" },
  TRI: { primary: "#CE1126", secondary: "#000000" },
  BOL: { primary: "#D52B1E", secondary: "#F4E400" },
  PAR: { primary: "#D52B1E", secondary: "#FFFFFF" },
  VEN: { primary: "#CF142B", secondary: "#003087" },
  CHN: { primary: "#DE2910", secondary: "#FFDE00" },
  IND: { primary: "#FF9933", secondary: "#138808" },
  THA: { primary: "#A51931", secondary: "#2D2A4A" },
  VIE: { primary: "#DA251D", secondary: "#FFCD00" },
  IDN: { primary: "#CE1126", secondary: "#FFFFFF" },
  MYS: { primary: "#CC0001", secondary: "#003087" },
  PHI: { primary: "#0038A8", secondary: "#CE1126" },
  IRQ: { primary: "#007A3D", secondary: "#CE1126" },
  SYR: { primary: "#007A3D", secondary: "#CE1126" },
  JOR: { primary: "#007A3D", secondary: "#CE1126" },
  LBN: { primary: "#FFFFFF", secondary: "#EE161F" },
  OMN: { primary: "#DB161B", secondary: "#FFFFFF" },
  BHR: { primary: "#CE1126", secondary: "#FFFFFF" },
  KWT: { primary: "#007A3D", secondary: "#000000" },
  UAE: { primary: "#00732F", secondary: "#FF0000" },
  YEM: { primary: "#CE1126", secondary: "#000000" },
  LBY: { primary: "#000000", secondary: "#239E46" },
  SDN: { primary: "#D21034", secondary: "#000000" },
  ETH: { primary: "#078930", secondary: "#FCDD09" },
  KEN: { primary: "#006600", secondary: "#BB0000" },
  TAN: { primary: "#1EB53A", secondary: "#FCD116" },
  UGA: { primary: "#000000", secondary: "#FCDC04" },
  ZIM: { primary: "#006400", secondary: "#FFD200" },
  ZAM: { primary: "#198A00", secondary: "#EF7D00" },
  MOZ: { primary: "#009A44", secondary: "#FCDD09" },
  MWI: { primary: "#000000", secondary: "#CE1126" },
  BOT: { primary: "#75AADB", secondary: "#000000" },
  NAM: { primary: "#003580", secondary: "#009A44" },
  ANG: { primary: "#CC0000", secondary: "#000000" },
  COD: { primary: "#007FFF", secondary: "#F7D618" },
  COG: { primary: "#009543", secondary: "#DC241F" },
  GAB: { primary: "#009E60", secondary: "#FCD116" },
  CMR2: { primary: "#007A5E", secondary: "#CE1126" },
  BEN: { primary: "#008751", secondary: "#FCD116" },
  NER: { primary: "#E05206", secondary: "#009A00" },
  MLI: { primary: "#14B53A", secondary: "#FCD116" },
  BFA: { primary: "#EF2B2D", secondary: "#009A44" },
  GIN: { primary: "#CE1126", secondary: "#009460" },
  SLE: { primary: "#1EB53A", secondary: "#0072C6" },
  LBR: { primary: "#BF0A30", secondary: "#003087" },
  GNB: { primary: "#CE1126", secondary: "#009A44" },
  CPV: { primary: "#003893", secondary: "#CF2027" },
  GMB: { primary: "#3A7728", secondary: "#CE1126" },
  MRT: { primary: "#006233", secondary: "#FFD700" },
  SOM: { primary: "#4189DD", secondary: "#FFFFFF" },
  DJI: { primary: "#6AB2E7", secondary: "#12AD2B" },
  ERI: { primary: "#4189DD", secondary: "#009A44" },
  RWA: { primary: "#20603D", secondary: "#FAD201" },
  BDI: { primary: "#CE1126", secondary: "#1EB53A" },
  COM: { primary: "#3A75C4", secondary: "#3A75C4" },
  MDG: { primary: "#FC3D32", secondary: "#007E3A" },
  MUS: { primary: "#EA2839", secondary: "#1A206D" },
  SEY: { primary: "#003F87", secondary: "#FCD856" },
  STP: { primary: "#12AD2B", secondary: "#FFCE00" },
  GEQ: { primary: "#3E9A00", secondary: "#E32118" },
  LSO: { primary: "#009543", secondary: "#FFFFFF" },
  SWZ: { primary: "#3E5EB9", secondary: "#FFD900" },
};

function getWcTeamColors(fifaCode: string): { primary: string; secondary: string } {
  return WC_TEAM_COLORS[fifaCode?.toUpperCase()] ?? { primary: "#1a4a8a", secondary: "#c84b0c" };
}

// ─── Typography scale — exact GameCard constants ──────────────────────────────
const HDR_FS  = 'clamp(15px,1.25vw,20px)';
const VAL_FS  = 'clamp(12px,1.0vw,16px)';
const ABBR_FS = 'clamp(11px,0.9vw,14px)';
const TITLE_FS = 'clamp(17px,1.45vw,22px)';

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

/**
 * todayStr — returns the effective feed date using the same 11:00 UTC cutoff
 * gate as CalendarPicker.todayUTC().  This ensures late-night UTC matches
 * (e.g. kickoff at 01:00 UTC = 9 PM EDT) remain on the correct local date
 * and do not disappear from the feed after midnight UTC.
 *
 * [FIX] Previously used raw `new Date().toISOString().split('T')[0]` which
 * returned the UTC calendar date with no cutoff awareness, causing matches
 * with kickoff_utc crossing midnight UTC to vanish from todayWithOdds.
 */
function todayStr(): string {
  return todayUTC();
}

export function getDefaultWcDate(): string {
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
  modelOdds?: DkOdds;
};

type WcFixtureWithLineups = WcFixtureWithOdds & {
  lineups: WcLineupPlayer[];
};

// ─── OddsCell — exact GameCard OddsCell ──────────────────────────────────────

function OddsCell({
  mainValue,
  isBook = true,
  isEdge = false,
  size = 'md',
  wrapperStyle,
}: {
  mainValue: string;
  isBook?: boolean;
  isEdge?: boolean;
  size?: 'sm' | 'md';
  wrapperStyle?: React.CSSProperties;
}) {
  const mainFs = size === 'sm'
    ? 'clamp(10.5px, 2.6vw, 12.5px)'
    : 'clamp(13px, 1.1vw, 17px)';
  const pillPadding = size === 'sm' ? '3px 5px' : '4px 8px';
  const borderRadius = size === 'sm' ? '8px' : '10px';

  const pillBg = isBook
    ? (isEdge ? 'rgba(57,255,20,0.10)' : 'rgba(255,255,255,0.07)')
    : 'transparent';
  const pillBorder = isBook
    ? (isEdge ? '1px solid rgba(57,255,20,0.45)' : '1px solid rgba(255,255,255,0.13)')
    : (isEdge ? '1px solid rgba(57,255,20,0.30)' : '1px solid transparent');
  const mainColor = isEdge ? '#39FF14' : '#FFFFFF';
  const mainWeight = isEdge ? 800 : 700;

  return (
    <div
      className="flex flex-col items-center justify-center"
      style={{ gap: 1, ...wrapperStyle }}
    >
      <div
        style={{
          display: 'inline-flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: pillPadding,
          borderRadius,
          background: pillBg,
          border: pillBorder,
          minWidth: size === 'sm' ? 42 : 48,
          gap: 1,
          transition: 'background 200ms, border 200ms',
        }}
      >
        <span
          className="tabular-nums"
          style={{
            fontSize: mainFs,
            fontWeight: mainWeight,
            color: mainColor,
            letterSpacing: '0.01em',
            lineHeight: 1.1,
            whiteSpace: 'nowrap',
          }}
        >
          {mainValue}
        </span>
      </div>
    </div>
  );
}

// ─── MergedSplitBar — exact GameCard MergedSplitBar ──────────────────────────

const MERGED_LABEL_STROKE = '-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000,0 0 6px rgba(0,0,0,0.9)';

function MergedSplitBar({
  awayPct, homePct, awayColor, homeColor, rowLabel, awayLabel, homeLabel,
}: {
  awayPct: number | null;
  homePct: number | null;
  awayColor: string;
  homeColor: string;
  rowLabel: string;
  awayLabel?: string;
  homeLabel?: string;
}) {
  const hasData = awayPct != null && homePct != null;
  const headerLabelStyle: React.CSSProperties = {
    fontSize: 'clamp(10px, 0.85vw, 13px)',
    color: '#FFFFFF',
    fontWeight: 800,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  };
  const teamLabelStyle: React.CSSProperties = {
    fontSize: 'clamp(9px, 0.78vw, 12px)',
    color: 'rgba(255,255,255,0.80)',
    fontWeight: 600,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '38%',
  };
  return (
    <div className="flex flex-col w-full" style={{ gap: 2 }}>
      <div className="flex items-center justify-between" style={{ gap: 4 }}>
        <span style={teamLabelStyle}>{awayLabel ?? ''}</span>
        <span style={headerLabelStyle}>{rowLabel}</span>
        <span style={{ ...teamLabelStyle, textAlign: 'right' }}>{homeLabel ?? ''}</span>
      </div>
      {hasData ? (() => {
        const away = awayPct!;
        const home = homePct!;
        const isAwayFull = away >= 100;
        const isHomeFull = home >= 100;
        const segLabel: React.CSSProperties = {
          fontSize: 'clamp(10px, 0.85vw, 13px)',
          color: '#fff',
          fontWeight: 800,
          whiteSpace: 'nowrap',
          textShadow: MERGED_LABEL_STROKE,
          lineHeight: 1,
          letterSpacing: '0em',
        };
        return (
          <div style={{
            height: 'clamp(22px, 2.2vw, 32px)',
            display: 'flex',
            borderRadius: '9999px',
            border: '1px solid rgba(255,255,255,0.12)',
            overflow: 'hidden',
            width: '100%',
          }}>
            {away > 0 && !isAwayFull && !isHomeFull && (
              <div style={{
                flexGrow: away, flexShrink: 1, flexBasis: 0,
                minWidth: away < 10 ? 36 : 30,
                background: awayColor,
                display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
                paddingLeft: 'clamp(4px,0.4vw,8px)', paddingRight: 'clamp(4px,0.4vw,8px)',
                borderRadius: '9999px 0 0 9999px',
              }} className="transition-all duration-700">
                <span style={{ ...segLabel, textAlign: 'left' }}>{away} %</span>
              </div>
            )}
            {!isAwayFull && !isHomeFull && away > 0 && home > 0 && (
              <div style={{ width: 1, background: 'rgba(255,255,255,0.25)', flexShrink: 0 }} />
            )}
            {home > 0 && !isHomeFull && !isAwayFull && (
              <div style={{
                flexGrow: home, flexShrink: 1, flexBasis: 0,
                minWidth: home < 10 ? 36 : 30,
                background: homeColor,
                display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                paddingLeft: 'clamp(4px,0.4vw,8px)', paddingRight: 'clamp(4px,0.4vw,8px)',
                borderRadius: '0 9999px 9999px 0',
              }} className="transition-all duration-700">
                <span style={{ ...segLabel, textAlign: 'right' }}>{home} %</span>
              </div>
            )}
            {isAwayFull && !isHomeFull && (
              <div style={{ flex: 1, background: awayColor, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '9999px' }}>
                <span style={{ ...segLabel, textAlign: 'center' }}>100 %</span>
              </div>
            )}
            {isHomeFull && !isAwayFull && (
              <div style={{ flex: 1, background: homeColor, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '9999px' }}>
                <span style={{ ...segLabel, textAlign: 'center' }}>100 %</span>
              </div>
            )}
            {isAwayFull && isHomeFull && (
              <>
                <div style={{ flex: 1, background: awayColor, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '9999px 0 0 9999px' }}>
                  <span style={{ ...segLabel, textAlign: 'center' }}>100 %</span>
                </div>
                <div style={{ flex: 1, background: homeColor, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '0 9999px 9999px 0' }}>
                  <span style={{ ...segLabel, textAlign: 'center' }}>100 %</span>
                </div>
              </>
            )}
          </div>
        );
      })() : (
        <div style={{ height: 'clamp(22px,2.2vw,32px)', background: 'rgba(255,255,255,0.05)', borderRadius: '9999px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', opacity: 0.80 }}>—</span>
        </div>
      )}
    </div>
  );
}

// ─── WC Splits types + helper ─────────────────────────────────────────────────

type WcSplitRow = {
  id: number;
  fixtureId: string;
  snapshotTs: Date | null;
  teamId: string;
  market: string;
  ticketsPct: number | null;
  moneyPct: number | null;
};

type WcFixtureSplits = {
  fixtureId: string;
  homeTeamId: string;
  awayTeamId: string;
  splits: WcSplitRow[];
};

/**
 * Extract split percentages for a given fixture and market.
 * DB stores fractions (0.0–1.0) — multiply by 100 to get integers for MergedSplitBar.
 */
function extractWcSplits(
  splits: WcFixtureSplits | undefined,
  market: 'ML' | 'TOTAL',
  awayTeamId: string,
  homeTeamId: string,
): { awayTickets: number | null; homeTickets: number | null; awayMoney: number | null; homeMoney: number | null } {
  if (!splits || splits.splits.length === 0) {
    return { awayTickets: null, homeTickets: null, awayMoney: null, homeMoney: null };
  }
  const rows = splits.splits.filter((r) => r.market === market);
  const awayRow = rows.find((r) => r.teamId === awayTeamId);
  const homeRow = rows.find((r) => r.teamId === homeTeamId);
  const awayTickets = awayRow?.ticketsPct != null ? Math.round(awayRow.ticketsPct * 100) : null;
  const homeTickets = homeRow?.ticketsPct != null ? Math.round(homeRow.ticketsPct * 100) : null;
  const awayMoney   = awayRow?.moneyPct  != null ? Math.round(awayRow.moneyPct  * 100) : null;
  const homeMoney   = homeRow?.moneyPct  != null ? Math.round(homeRow.moneyPct  * 100) : null;
  return { awayTickets, homeTickets, awayMoney, homeMoney };
}

// ─── WcMktCol — MLB-style BOOK/MODEL column with edge detection banner ────────
//
// Renders one market column (MONEYLINE | TOTAL | DRAW) matching the exact
// visual language of the MLB GameCard:
//   • BOOK / MODEL sub-column headers
//   • Away row (top) + Home row (bottom) — or single row for DRAW
//   • Edge detection banner: "TEAM ML +X.XX% ROI" or "NO EDGE"
//
// EDGE RULE: edge exists when americanToImplied(model) > americanToImplied(book)
//   edgePP = (mdlImpl - bkImpl) * 100  (percentage points)
//   ROI    = (mdlImpl - bkImpl) / bkImpl * 100  (expected value)
//
function americanToImplied(odds: number | null | undefined): number {
  if (odds == null || isNaN(odds)) return 0;
  return odds < 0 ? Math.abs(odds) / (Math.abs(odds) + 100) : 100 / (odds + 100);
}

function calcEdge(bookOdds: number | null | undefined, modelOdds: number | null | undefined): number {
  // Returns ROI in percentage points (positive = edge)
  const bkImpl  = americanToImplied(bookOdds);
  const mdlImpl = americanToImplied(modelOdds);
  if (bkImpl <= 0) return 0;
  return ((mdlImpl - bkImpl) / bkImpl) * 100;
}

// [STEP] formatTotalLine: strips trailing zero — 2.00→"2", 2.50→"2.5", 3.00→"3"
// [VERIFY] Only whole and .5 values are used (no .25/.75 asian handicap)
function formatTotalLine(n: number): string {
  if (n % 1 === 0) return String(Math.round(n));
  return parseFloat(n.toFixed(1)).toString();
}

function WcMktCol({
  title,
  awayLabel,
  homeLabel,
  awayBookNum,
  homeBookNum,
  awayModelNum,
  homeModelNum,
  singleRow = false,
  awayTickets = null,
  homeTickets = null,
  awayMoney = null,
  homeMoney = null,
  awayColor = '#1a4a8a',
  homeColor = '#c84b0c',
  compact = false,
  threeWayBook = null,
  threeWayModel = null,
}: {
  title: string;
  awayLabel: string;
  homeLabel: string;
  awayBookNum: number | null | undefined;
  homeBookNum: number | null | undefined;
  awayModelNum: number | null | undefined;
  homeModelNum: number | null | undefined;
  singleRow?: boolean;
  awayTickets?: number | null;
  homeTickets?: number | null;
  awayMoney?: number | null;
  homeMoney?: number | null;
  awayColor?: string;
  homeColor?: string;
  compact?: boolean;
  // Full 3-way odds context for soccer ML and DRAW markets
  // When provided, ROI is computed via calculate3WayResult (all 3 outcomes in denominator)
  threeWayBook?: ThreeWayOdds | null;
  threeWayModel?: ThreeWayOdds | null;
}) {
  const awayBook  = fmtAmerican(awayBookNum);
  const homeBook  = fmtAmerican(homeBookNum);
  const awayModel = fmtAmerican(awayModelNum);
  const homeModel = fmtAmerican(homeModelNum);

  // ── Edge detection — canonical EDGE_THRESHOLD_PP=1.5 from edgeUtils ─────────
  // FORMULA: edgePP = (modelImplied - bookImplied) * 100  [percentage points]
  // THRESHOLD: 1.5pp minimum (matches MLB GameCard exactly)
  // ROI: 3-way EV when threeWayBook/threeWayModel provided; 2-way for TOTAL
  //
  // [LOG] WcMktCol: 3-way path used for ML + DRAW (all H/D/A in denominator)
  // [LOG] WcMktCol: 2-way path used for TOTAL (no draw in O/U market)
  //
  // STEP 1: Compute 3-way calc first (when available) — single source of truth
  let awayRoiPct: number = NaN;
  let homeRoiPct: number = NaN;
  let drawRoiPct: number = NaN;
  let awayEdgePP: number = NaN;
  let homeEdgePP: number = NaN;
  if (threeWayBook && threeWayModel) {
    // Full 3-way EV: normalize model + book probs across all 3 outcomes (H/D/A)
    const calc3 = calculate3WayResult(threeWayBook, threeWayModel);
    // [STATE] Edge pp from 3-way fair probs -- used for threshold gate AND label
    awayEdgePP = calc3.away.edgePP;
    homeEdgePP = singleRow ? NaN : calc3.home.edgePP;
    awayRoiPct = calc3.away.roiPct;
    homeRoiPct = calc3.home.roiPct;
    drawRoiPct = calc3.draw.roiPct;
    console.log(
      `[WcMktCol:3WayCalc] title=${title}` +
      ` | [STATE] bookFair: H=${(calc3.home.bookFairProb*100).toFixed(2)}% D=${(calc3.draw.bookFairProb*100).toFixed(2)}% A=${(calc3.away.bookFairProb*100).toFixed(2)}%` +
      ` | [STATE] modelFair: H=${(calc3.home.modelFairProb*100).toFixed(2)}% D=${(calc3.draw.modelFairProb*100).toFixed(2)}% A=${(calc3.away.modelFairProb*100).toFixed(2)}%` +
      ` | [OUTPUT] edgePP: H=${isNaN(homeEdgePP)?'NaN':homeEdgePP.toFixed(2)}pp D=${calc3.draw.edgePP.toFixed(2)}pp A=${awayEdgePP.toFixed(2)}pp` +
      ` | [OUTPUT] roi: H=${homeRoiPct.toFixed(2)}% D=${drawRoiPct.toFixed(2)}% A=${awayRoiPct.toFixed(2)}%`
    );
  } else {
    // 2-way path for TOTAL (over/under -- no draw outcome)
    awayEdgePP = (awayBookNum != null && awayModelNum != null)
      ? calculateEdge(awayBookNum, awayModelNum) : NaN;
    homeEdgePP = (!singleRow && homeBookNum != null && homeModelNum != null)
      ? calculateEdge(homeBookNum, homeModelNum) : NaN;
  }
  const awayHasEdge = !isNaN(awayEdgePP) && awayEdgePP >= EDGE_THRESHOLD_PP;
  const homeHasEdge = !singleRow && !isNaN(homeEdgePP) && homeEdgePP >= EDGE_THRESHOLD_PP;
  // STEP 2: 2-way ROI for TOTAL (when threeWayBook not provided)
  if (!threeWayBook || !threeWayModel) {
    if (awayHasEdge && homeBookNum != null && awayBookNum != null && awayModelNum != null) {
      awayRoiPct = calculateRoi(awayModelNum, awayBookNum, homeBookNum);
    }
    if (homeHasEdge && awayBookNum != null && homeBookNum != null && homeModelNum != null) {
      homeRoiPct = calculateRoi(homeModelNum, homeBookNum, awayBookNum);
    }
  }
  // For DRAW singleRow: use drawRoiPct if 3-way available, else awayRoiPct (draw odds in away slot)
  const effectiveAwayRoi = singleRow && !isNaN(drawRoiPct) ? drawRoiPct : awayRoiPct;

  let edgeLabel: string | null = null;
  let edgeDisplayPP = NaN; // pp value used for color tier
  let edgeDisplayRoi = NaN; // ROI % used for label
  if (awayHasEdge && homeHasEdge) {
    // Both sides have edge — show the stronger one (by pp)
    if (awayEdgePP >= homeEdgePP) {
      edgeLabel = awayLabel; edgeDisplayPP = awayEdgePP; edgeDisplayRoi = effectiveAwayRoi;
    } else {
      edgeLabel = homeLabel; edgeDisplayPP = homeEdgePP; edgeDisplayRoi = homeRoiPct;
    }
  } else if (awayHasEdge) {
    edgeLabel = awayLabel; edgeDisplayPP = awayEdgePP; edgeDisplayRoi = effectiveAwayRoi;
  } else if (homeHasEdge) {
    edgeLabel = homeLabel; edgeDisplayPP = homeEdgePP; edgeDisplayRoi = homeRoiPct;
  }

  const hasEdge = edgeLabel !== null;
  const edgeColor = getEdgeColor(edgeDisplayPP);

  console.log(
    `[WcMktCol:EdgeDetect] title=${title}` +
    ` | [INPUT] awayBook=${awayBookNum} awayModel=${awayModelNum} homeBook=${homeBookNum} homeModel=${homeModelNum}` +
    ` | [STATE] awayEdgePP=${isNaN(awayEdgePP) ? 'NaN' : awayEdgePP.toFixed(2)}pp homeEdgePP=${isNaN(homeEdgePP) ? 'NaN' : homeEdgePP.toFixed(2)}pp threshold=${EDGE_THRESHOLD_PP}pp` +
    ` | [OUTPUT] edgeLabel=${edgeLabel ?? 'NO EDGE'} edgeDisplayPP=${isNaN(edgeDisplayPP) ? 'NaN' : edgeDisplayPP.toFixed(2)}pp edgeRoi=${isNaN(edgeDisplayRoi) ? 'NaN' : edgeDisplayRoi.toFixed(2)}%` +
    ` | [VERIFY] hasEdge=${hasEdge} edgeColor=${edgeColor}`
  );

  // ── Styles ──────────────────────────────────────────────────────────────────
  const pad = compact ? '6px 6px 8px' : '8px 10px 10px';
  const colHdrFs: React.CSSProperties = {
    fontSize: compact ? 'clamp(8px,1.8vw,10px)' : 'clamp(9px,0.8vw,11px)',
    fontWeight: 700,
    letterSpacing: '0.10em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  };
  const titleFs: React.CSSProperties = {
    fontSize: compact ? 'clamp(9px,2.0vw,11px)' : 'clamp(10px,0.9vw,13px)',
    fontWeight: 850,
    color: '#fff',
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  };

  // [LOG] WcMktCol render state — superseded by WcMktCol:EdgeDetect above

  // ── MLB-identical SubCol: line (dim) + juice (bold) stacked ──────────────────────────────
  const SubCol = ({ line, juice, isBook: isBookCol, hasEdge: subEdge }: { line: string; juice: string; isBook: boolean; hasEdge: boolean }) => {
    const juiceColor = isBookCol
      ? 'rgba(255,255,255,0.90)'
      : subEdge ? '#39FF14' : 'rgba(255,255,255,0.90)';
    const isMLCol = !line;
    // [FIX] Dynamic font scaling: if any value is 5+ chars (e.g. +1000), shrink juice font
    const isLongOdds = juice.length >= 5;
    const juiceFontSize = isLongOdds ? 'clamp(9px,2.8vw,11px)' : 'clamp(11px,3.5vw,14px)';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, minWidth: 0, flex: 1 }}>
        {isMLCol
          ? <span style={{ fontSize: 'clamp(9px,2.8vw,11px)', lineHeight: 1, visibility: 'hidden' }}>&nbsp;</span>
          : <span style={{ fontSize: 'clamp(9px,2.8vw,11px)', fontWeight: 400, color: 'rgba(255,255,255,0.55)', lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{line}</span>
        }
        <span style={{ fontSize: juiceFontSize, fontWeight: 700, color: juiceColor, lineHeight: 1.15, whiteSpace: 'nowrap', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{juice}</span>
      </div>
    );
  };
  const TeamRow = ({ bookLine, bookJuice, modelLine, modelJuice, modelHasEdge }: { bookLine: string; bookJuice: string; modelLine: string; modelJuice: string; modelHasEdge: boolean }) => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, padding: '4px 3px' }}>
      <SubCol line={bookLine}  juice={bookJuice}  isBook={true}  hasEdge={false} />
      <SubCol line={modelLine} juice={modelJuice} isBook={false} hasEdge={modelHasEdge} />
    </div>
  );
  const roiStr = hasEdge
    ? (!isNaN(edgeDisplayRoi) ? formatRoi(edgeDisplayRoi) : `+${edgeDisplayPP.toFixed(2)}pp`)
    : 'NO EDGE';
  const roiColor = hasEdge ? edgeColor! : 'rgba(200,200,200,0.45)';

  return (
    <div className="flex flex-col" style={{ flex: '1 1 0%', minWidth: 0, width: 0, padding: pad }}>
      {/* Section title — centered with flanking rules */}
      <div className="flex items-center gap-1" style={{ marginBottom: compact ? 3 : 4 }}>
        <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }} />
        <span style={titleFs}>{title}</span>
        <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }} />
      </div>

      {/* ── MLB-identical cell container ── */}
      {/* [FIX] justifyContent:'space-between' + footer marginTop:'auto' pins footer to bottom uniformly */}
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#2a2a2e', borderRadius: 10, overflow: 'hidden', flex: '1 1 0', minWidth: 0, marginBottom: compact ? 4 : 6 }}>
        {/* BOOK / MODEL header — both muted white, matching MLB exactly */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '0.5px solid rgba(255,255,255,0.08)', padding: '3px 4px 2px' }}>
          <span style={{ fontSize: 6.5, fontWeight: 700, color: 'rgba(255,255,255,0.75)', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.05em' }}>BOOK</span>
          <span style={{ fontSize: 6.5, fontWeight: 700, color: 'rgba(255,255,255,0.70)', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.05em' }}>MODEL</span>
        </div>

        {/* Away / Over / Draw row (top) */}
        <TeamRow
          bookLine={title === 'TOTAL' ? awayLabel : ''}
          bookJuice={awayBook}
          modelLine={title === 'TOTAL' ? awayLabel : ''}
          modelJuice={awayModel}
          modelHasEdge={awayHasEdge}
        />

        {/* Divider — hidden for singleRow (DRAW) */}
        {!singleRow && <div style={{ height: 0.5, background: 'rgba(255,255,255,0.07)', margin: '0 4px' }} />}

        {/* Home / Under row (bottom) — hidden for singleRow (DRAW) */}
        {!singleRow && (
          <TeamRow
            bookLine={title === 'TOTAL' ? homeLabel : ''}
            bookJuice={homeBook}
            modelLine={title === 'TOTAL' ? homeLabel : ''}
            modelJuice={homeModel}
            modelHasEdge={homeHasEdge}
          />
        )}

        {/* ROI footer — pinned to bottom via marginTop:auto + justifyContent:space-between on parent */}
        <div style={{ marginTop: 'auto', borderTop: '0.5px solid rgba(255,255,255,0.07)', padding: '3px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, background: hasEdge ? 'rgba(57,255,20,0.04)' : 'transparent' }}>
          {hasEdge && edgeLabel && (
            <span style={{ fontSize: 7, fontWeight: 700, color: roiColor, textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', textAlign: 'center' }}>
              {edgeLabel}
            </span>
          )}
          <span style={{ fontSize: 7.5, fontWeight: hasEdge ? 800 : 400, color: roiColor, letterSpacing: '0.03em', lineHeight: 1, whiteSpace: 'nowrap', textAlign: 'center' }}>
            {roiStr}
          </span>
        </div>
      </div>

      {/* Splits bars — shown only on desktop (not compact) */}
      {!compact && (
        <>
          <div style={{ marginTop: 5 }}>
            <MergedSplitBar
              awayPct={awayTickets}
              homePct={homeTickets}
              awayColor={awayColor}
              homeColor={homeColor}
              rowLabel="TICKETS"
              awayLabel={awayLabel}
              homeLabel={singleRow ? '' : homeLabel}
            />
          </div>
          <div style={{ marginTop: 4 }}>
            <MergedSplitBar
              awayPct={awayMoney}
              homePct={homeMoney}
              awayColor={awayColor}
              homeColor={homeColor}
              rowLabel="MONEY"
              awayLabel={awayLabel}
              homeLabel={singleRow ? '' : homeLabel}
            />
          </div>
        </>
      )}
    </div>
  );
}

// ─── WC Score Panel — exact GameCard ScorePanel structure ─────────────────────

function WcScorePanel({ fixture }: { fixture: WcFixtureWithOdds }) {
  const { homeTeam, awayTeam } = fixture;
  const isLive = fixture.status === "LIVE";
  const isFinal = fixture.status === "FT";
  const hasScores = fixture.homeScore != null && fixture.awayScore != null;

  const awayFifaCode = awayTeam?.fifaCode ?? fixture.awayTeamId.toUpperCase();
  const homeFifaCode = homeTeam?.fifaCode ?? fixture.homeTeamId.toUpperCase();
  const awayColors = getWcTeamColors(awayFifaCode);
  const homeColors = getWcTeamColors(homeFifaCode);

  const NAME_FONT_SIZE = 'clamp(12px, 1.0vw, 17px)';
  const NICK_FONT_SIZE = 'clamp(10px, 0.8vw, 14px)';
  const TIME_FONT_SIZE = 'clamp(12px, 1.01vw, 15px)';
  const LIVE_FONT_SIZE = 'clamp(13.3px, 1.05vw, 17.1px)';
  const FINAL_FONT_SIZE = 'clamp(15.2px, 1.28vw, 19px)';

  return (
    <div className="flex flex-col pl-2 pr-2 pt-0 pb-0" style={{ minHeight: '100%', justifyContent: 'center' }}>
      {/* Status row */}
      <div className="flex items-center gap-1.5 mb-0.5">
        {isLive ? (
          <div className="flex flex-col items-center gap-0.5">
            <span
              className="px-2 py-1 font-black tracking-widest flex-shrink-0 flex items-center"
              style={{
                fontSize: LIVE_FONT_SIZE,
                background: "rgba(57,255,20,0.12)",
                color: "#39FF14",
                border: "1px solid rgba(57,255,20,0.4)",
                letterSpacing: "0.10em",
                borderRadius: '14px',
                gap: '8px',
                lineHeight: 1,
              }}
            >
              <span className="rounded-full animate-pulse inline-block flex-shrink-0" style={{ width: '9px', height: '9px', background: "#39FF14" }} />
              LIVE
            </span>
          </div>
        ) : isFinal ? (
          <span
            className="px-1.5 py-0.5 font-black tracking-widest"
            style={{
              fontSize: FINAL_FONT_SIZE,
              background: "rgba(57,255,20,0.12)",
              color: "#39FF14",
              border: "1px solid rgba(57,255,20,0.4)",
              borderRadius: '12px',
              lineHeight: 1,
            }}
          >
            FINAL
          </span>
        ) : (
          <span className="font-bold" style={{ fontSize: TIME_FONT_SIZE, color: "hsl(var(--foreground))" }}>
            {fmtKickoff(fixture.kickoffUtc)}
          </span>
        )}
      </div>

      {/* Team group */}
      <div className="flex flex-1 flex-col" style={{ gap: 0, justifyContent: 'center' }}>
        {/* Home team row — TOP (matches DK convention: home listed first/top) */}
        <div className="flex items-center justify-between gap-2 py-1 w-full">
          <div className="flex items-center gap-2">
            {/* Flag circle */}
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: `radial-gradient(circle at 30% 30%, ${homeColors.primary}cc, ${homeColors.secondary}88)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)',
            }}>
              <img
                src={homeTeam?.flagUrl ?? fifaFlagUrl(homeFifaCode)}
                alt={homeFifaCode}
                style={{ width: 20, height: 14, objectFit: 'cover', borderRadius: 2 }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </div>
            <div className="flex flex-col">
              {/* All screen sizes: full country name (never abbreviated FIFA code) */}
              <span className="font-bold leading-tight" style={{ fontSize: 11, color: "hsl(var(--foreground))", fontWeight: 700, whiteSpace: 'nowrap', lineHeight: 1.2 }}>
                {homeTeam?.name ?? homeFifaCode}
              </span>
              <span className="leading-none" style={{ fontSize: 9, color: "hsl(var(--muted-foreground))", whiteSpace: 'nowrap' }}>
                {fixture.matchday ? `Matchday ${fixture.matchday}` : "\u00A0"}
              </span>
            </div>
          </div>
          {(isLive || isFinal) && hasScores && (
            <span className="tabular-nums flex-shrink-0" style={{ fontSize: 'clamp(11px, 3.2vw, 13px)', lineHeight: 1, fontWeight: 700, color: "hsl(var(--foreground))" }}>
              {fixture.homeScore}
            </span>
          )}
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: "hsl(var(--border) / 0.4)" }} />

        {/* Away team row — BOTTOM (matches DK convention: away listed second/bottom) */}
        <div className="flex items-center justify-between gap-2 py-1 w-full">
          <div className="flex items-center gap-2">
            {/* Flag circle */}
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: `radial-gradient(circle at 30% 30%, ${awayColors.primary}cc, ${awayColors.secondary}88)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)',
            }}>
              <img
                src={awayTeam?.flagUrl ?? fifaFlagUrl(awayFifaCode)}
                alt={awayFifaCode}
                style={{ width: 20, height: 14, objectFit: 'cover', borderRadius: 2 }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </div>
            <div className="flex flex-col">
              {/* All screen sizes: full country name (never abbreviated FIFA code) */}
              <span className="font-bold leading-tight" style={{ fontSize: 11, color: "hsl(var(--foreground))", fontWeight: 700, whiteSpace: 'nowrap', lineHeight: 1.2 }}>
                {awayTeam?.name ?? awayFifaCode}
              </span>
              <span className="leading-none" style={{ fontSize: 9, color: "hsl(var(--muted-foreground))", whiteSpace: 'nowrap' }}>
                {fixture.groupLetter ? `Group ${fixture.groupLetter}` : "\u00A0"}
              </span>
            </div>
          </div>
          {(isLive || isFinal) && hasScores && (
            <span className="tabular-nums flex-shrink-0" style={{ fontSize: 'clamp(11px, 3.2vw, 13px)', lineHeight: 1, fontWeight: 700, color: "hsl(var(--foreground))" }}>
              {fixture.awayScore}
            </span>
          )}
        </div>
      </div>

      {/* Venue footer */}
      {fixture.venue && (
        <div className="flex items-center gap-1 mt-1" style={{ fontSize: 'clamp(9px,0.75vw,11px)', color: 'hsl(var(--muted-foreground))' }}>
          <MapPin style={{ width: 10, height: 10, flexShrink: 0 }} />
          <span className="truncate">{fixture.venue.city}</span>
          {fixture.venue.elevationM > 500 && (
            <span style={{ color: '#F59E0B', marginLeft: 2 }}>⚠ {fixture.venue.elevationM}m</span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── WC Desktop Merged Panel — MLB-style 3-column layout ─────────────────────
//
// 3 columns matching MLB GameCard exactly:
//   Col 1: MONEYLINE — AWAY (top row) + HOME (bottom row), BOOK/MODEL
//   Col 2: TOTAL     — OVER (top row) + UNDER (bottom row), BOOK/MODEL
//   Col 3: DRAW      — single row, BOOK/MODEL
//
// [LOG] WcDesktopMergedPanel: renders MLB-style 3-col layout for WC fixtures

function WcDesktopMergedPanel({
  fixture,
  splits,
}: {
  fixture: WcFixtureWithOdds;
  splits?: WcFixtureSplits;
}) {
  const { dkOdds, modelOdds } = fixture;
  const totalLine = dkOdds?.overLine ?? 2.5;

  const homeFifaCode = fixture.homeTeam?.fifaCode ?? fixture.homeTeamId.toUpperCase();
  const awayFifaCode = fixture.awayTeam?.fifaCode ?? fixture.awayTeamId.toUpperCase();
  const homeColors   = getWcTeamColors(homeFifaCode);
  const awayColors   = getWcTeamColors(awayFifaCode);

  const mlSplits    = extractWcSplits(splits, 'ML',    fixture.awayTeamId, fixture.homeTeamId);
  const totalSplits = extractWcSplits(splits, 'TOTAL', fixture.awayTeamId, fixture.homeTeamId);

  console.log(
    `[WcDesktopMergedPanel] fixture=${fixture.fixtureId}` +
    ` away=${awayFifaCode} home=${homeFifaCode}` +
    ` | [INPUT] dkOdds=${JSON.stringify(dkOdds)} modelOdds=${JSON.stringify(modelOdds)}` +
    ` | [STATE] totalLine=${totalLine}` +
    ` | [VERIFY] hasOdds=${dkOdds != null} hasModel=${modelOdds != null}`
  );

  return (
    <div className="flex items-stretch w-full" style={{ minHeight: '100%' }}>

      {/* ── Col 1: MONEYLINE — HOME top row, AWAY bottom row (matches DK convention) ─── */}
      {/* [LOG] ML column: 3-way ROI via threeWayBook/threeWayModel — all H/D/A in denominator */}
      {/* [NOTE] WcMktCol renders 'away' prop as top row, 'home' prop as bottom row.             */}
      {/* [NOTE] DK shows home on top, away on bottom — so home odds go into awayBookNum (top).  */}
      <WcMktCol
        title="MONEYLINE"
        awayLabel={homeFifaCode}
        homeLabel={awayFifaCode}
        awayBookNum={dkOdds?.home}
        homeBookNum={dkOdds?.away}
        awayModelNum={modelOdds?.home}
        homeModelNum={modelOdds?.away}
        singleRow={false}
        awayTickets={mlSplits.homeTickets}
        homeTickets={mlSplits.awayTickets}
        awayMoney={mlSplits.homeMoney}
        homeMoney={mlSplits.awayMoney}
        awayColor={homeColors.primary}
        homeColor={awayColors.primary}
        threeWayBook={(dkOdds?.home != null && dkOdds?.draw != null && dkOdds?.away != null)
          ? { home: dkOdds.home, draw: dkOdds.draw, away: dkOdds.away } : null}
        threeWayModel={(modelOdds?.home != null && modelOdds?.draw != null && modelOdds?.away != null)
          ? { home: modelOdds.home, draw: modelOdds.draw, away: modelOdds.away } : null}
      />

      <div style={{ width: 1, background: 'rgba(255,255,255,0.07)', flexShrink: 0, alignSelf: 'stretch', margin: '8px 0' }} />

      {/* ── Col 2: DRAW — single row, narrow, centered between ML and TOTAL ────────────────────── */}
      {/* [FIX] DRAW is single-row only — narrow fixed width, no flex growth */}
      {/* [LOG] DRAW column: awayBookNum=draw odds, threeWayBook provides full H/D/A context for ROI */}
      <div style={{ flex: '0 0 auto', width: 'clamp(90px,12vw,120px)' }}>
        <WcMktCol
          title="DRAW"
          awayLabel="DRAW"
          homeLabel=""
          awayBookNum={dkOdds?.draw}
          homeBookNum={null}
          awayModelNum={modelOdds?.draw}
          homeModelNum={null}
          singleRow={true}
          compact={true}
          awayColor="#888888"
          homeColor="#888888"
          threeWayBook={(dkOdds?.home != null && dkOdds?.draw != null && dkOdds?.away != null)
            ? { home: dkOdds.home, draw: dkOdds.draw, away: dkOdds.away } : null}
          threeWayModel={(modelOdds?.home != null && modelOdds?.draw != null && modelOdds?.away != null)
            ? { home: modelOdds.home, draw: modelOdds.draw, away: modelOdds.away } : null}
        />
      </div>

      <div style={{ width: 1, background: 'rgba(255,255,255,0.07)', flexShrink: 0, alignSelf: 'stretch', margin: '8px 0' }} />

      {/* ── Col 3: TOTAL — OVER top row, UNDER bottom row ─────────────────────────────────────────── */}
      <WcMktCol
        title="TOTAL"
        awayLabel={`O ${formatTotalLine(totalLine)}`}
        homeLabel={`U ${formatTotalLine(totalLine)}`}
        awayBookNum={dkOdds?.overOdds}
        homeBookNum={dkOdds?.underOdds}
        awayModelNum={modelOdds?.overOdds}
        homeModelNum={modelOdds?.underOdds}
        singleRow={false}
        awayTickets={totalSplits.awayTickets}
        homeTickets={totalSplits.homeTickets}
        awayMoney={totalSplits.awayMoney}
        homeMoney={totalSplits.homeMoney}
        awayColor="#39FF14"
        homeColor="#FF6B35"
      />

    </div>
  );
}

// ─── Fixture Card (Projections) — exact GameCard outer shell ──────────────────

function WcFixtureCard({
  fixture,
  splits,
}: {
  fixture: WcFixtureWithOdds;
  splits?: WcFixtureSplits;
}) {
  const isLive = fixture.status === "LIVE";
  const awayFifaCode = fixture.awayTeam?.fifaCode ?? fixture.awayTeamId.toUpperCase();
  const awayColors = getWcTeamColors(awayFifaCode);
  const borderColor = awayColors.primary;

  return (
    <div
      className="w-full relative"
      style={{
        background: "hsl(var(--card))",
        borderTop: "1px solid hsl(var(--border))",
        borderBottom: "1px solid hsl(var(--border))",
        borderLeft: `3px solid ${borderColor}`,
        overflowX: "clip",
      }}
    >
      {/* ── Desktop layout (≥ md) ── */}
      <div className="hidden md:flex items-stretch w-full" style={{ minHeight: 'clamp(160px,14vw,220px)' }}>
        {/* Col 1: Score panel */}
        <div style={{ flex: "0 0 clamp(170px,22vw,260px)", width: 'clamp(170px,22vw,260px)', borderRight: "1px solid hsl(var(--border) / 0.5)" }}>
          <WcScorePanel fixture={fixture} />
        </div>
        {/* Col 2+3: Merged panel */}
        <div className="flex-1 min-w-0" style={{ borderLeft: "1px solid hsl(var(--border) / 0.5)" }}>
          <WcDesktopMergedPanel fixture={fixture} splits={splits} />
        </div>
      </div>

      {/* ── Mobile layout (< md) ── */}
      <div className="md:hidden w-full">
        <div style={{ display: "grid", gridTemplateColumns: "clamp(120px, 32%, 150px) 1fr", width: "100%" }}>
          {/* Fixed score panel */}
          <div style={{ borderRight: "1px solid hsl(var(--border) / 0.5)" }}>
            <WcScorePanel fixture={fixture} />
          </div>
          {/* Scrollable odds panel */}
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
            <WcMobileOddsPanel fixture={fixture} />
          </div>
        </div>
      </div>

      {/* Live pulse indicator */}
      {isLive && (
        <div style={{ position: 'absolute', top: 0, right: 0, width: 6, height: '100%', background: 'rgba(57,255,20,0.15)' }} />
      )}
    </div>
  );
}

// ─── WC Mobile Odds Panel ─────────────────────────────────────────────────────
//
// Uses canonical BetCell (same boxed #2a2a2e dark-card structure as MLB mobile).
// Full country names in ML column labels — never FIFA codes.
// Edge detection: EDGE_THRESHOLD_PP=1.5 via calculateEdge from edgeUtils.
// [LOG] WcMobileOddsPanel: renders BetCell-based 3-col layout matching MLB exactly

function WcMobileOddsPanel({ fixture }: { fixture: WcFixtureWithOdds }) {
  const { dkOdds, modelOdds } = fixture;
  const totalLine = dkOdds?.overLine ?? 2.5;

  const homeFifaCode = fixture.homeTeam?.fifaCode ?? fixture.homeTeamId.toUpperCase();
  const awayFifaCode = fixture.awayTeam?.fifaCode ?? fixture.awayTeamId.toUpperCase();

  // [INPUT] Full country names for labels — never FIFA codes
  const awayName = fixture.awayTeam?.name ?? awayFifaCode;
  const homeName = fixture.homeTeam?.name ?? homeFifaCode;

  // ── 3-way calc: SINGLE SOURCE OF TRUTH for ML + DRAW edge pp AND ROI ──────────
  // [LOG] All ML and DRAW edge detection uses 3-way no-vig fair probs.
  // [LOG] Raw calculateEdge() is NOT used for ML/DRAW — it ignores the draw outcome.
  // [LOG] TOTAL uses 2-way calculateEdge (over/under — no draw in that market).
  const has3WayOdds = dkOdds?.home != null && dkOdds?.draw != null && dkOdds?.away != null
    && modelOdds?.home != null && modelOdds?.draw != null && modelOdds?.away != null;
  // [STATE] All ML/DRAW edge pp and ROI computed from calc3 (3-way no-vig fair probs)
  let awayMlEdgePP = NaN;
  let homeMlEdgePP = NaN;
  let drawEdgePP   = NaN;
  let mlAwayRoiPct = NaN;
  let mlHomeRoiPct = NaN;
  let drawRoiPct   = NaN;
  let mlBestRoiPct = NaN;
  if (has3WayOdds) {
    const threeWayBook:  ThreeWayOdds = { home: dkOdds!.home!, draw: dkOdds!.draw!, away: dkOdds!.away! };
    const threeWayModel: ThreeWayOdds = { home: modelOdds!.home!, draw: modelOdds!.draw!, away: modelOdds!.away! };
    const calc3 = calculate3WayResult(threeWayBook, threeWayModel);
    // [STATE] 3-way fair prob edge pp — used for threshold gate AND ROI label
    awayMlEdgePP = calc3.away.edgePP;
    homeMlEdgePP = calc3.home.edgePP;
    drawEdgePP   = calc3.draw.edgePP;
    mlAwayRoiPct = calc3.away.roiPct;
    mlHomeRoiPct = calc3.home.roiPct;
    drawRoiPct   = calc3.draw.roiPct;
    // [STATE] Best ML ROI = ROI of the side with the higher 3-way edge pp (HOME vs AWAY only)
    mlBestRoiPct = awayMlEdgePP >= homeMlEdgePP ? mlAwayRoiPct : mlHomeRoiPct;
    console.log(
      `[WcMobileOddsPanel:3WayCalc] fixture=${fixture.fixtureId}` +
      ` | [STATE] bookFair: H=${(calc3.home.bookFairProb*100).toFixed(2)}% D=${(calc3.draw.bookFairProb*100).toFixed(2)}% A=${(calc3.away.bookFairProb*100).toFixed(2)}%` +
      ` | [STATE] modelFair: H=${(calc3.home.modelFairProb*100).toFixed(2)}% D=${(calc3.draw.modelFairProb*100).toFixed(2)}% A=${(calc3.away.modelFairProb*100).toFixed(2)}%` +
      ` | [OUTPUT] edgePP: H=${homeMlEdgePP.toFixed(2)}pp D=${drawEdgePP.toFixed(2)}pp A=${awayMlEdgePP.toFixed(2)}pp` +
      ` | [OUTPUT] roi: H=${mlHomeRoiPct.toFixed(2)}% D=${drawRoiPct.toFixed(2)}% A=${mlAwayRoiPct.toFixed(2)}%` +
      ` | [VERIFY] mlBestRoi=${mlBestRoiPct.toFixed(2)}%`
    );
  }
  // ── ML edge label (HOME vs AWAY only — DRAW is in its own column) ─────────────
  const mlBestEdgePP = Math.max(
    isNaN(awayMlEdgePP) ? -Infinity : awayMlEdgePP,
    isNaN(homeMlEdgePP) ? -Infinity : homeMlEdgePP,
  );
  const mlBestEdgePPFinal = mlBestEdgePP === -Infinity ? NaN : mlBestEdgePP;
  const mlEdgeLabel = (mlBestEdgePPFinal >= EDGE_THRESHOLD_PP)
    ? (awayMlEdgePP >= homeMlEdgePP ? `${awayName} ML` : `${homeName} ML`)
    : undefined;
  // ── TOTAL edge detection (2-way — no draw in over/under market) ──────────────
  const overEdgePP = (dkOdds?.overOdds != null && modelOdds?.overOdds != null)
    ? calculateEdge(dkOdds.overOdds, modelOdds.overOdds) : NaN;
  const underEdgePP = (dkOdds?.underOdds != null && modelOdds?.underOdds != null)
    ? calculateEdge(dkOdds.underOdds, modelOdds.underOdds) : NaN;
  const totalBestEdgePP = Math.max(
    isNaN(overEdgePP) ? -Infinity : overEdgePP,
    isNaN(underEdgePP) ? -Infinity : underEdgePP,
  );
  const totalBestEdgePPFinal = totalBestEdgePP === -Infinity ? NaN : totalBestEdgePP;
  const totalEdgeLabel = (totalBestEdgePPFinal >= EDGE_THRESHOLD_PP)
    ? (overEdgePP >= underEdgePP ? `O${totalLine}` : `U${totalLine}`)
    : undefined;
  // ── DRAW edge label (from 3-way edgePP computed above) ────────────────────────
  const drawEdgeLabel = (!isNaN(drawEdgePP) && drawEdgePP >= EDGE_THRESHOLD_PP) ? 'DRAW' : undefined;
  // ── 2-way ROI for TOTAL ───────────────────────────────────────────────────────
  const totalBestRoiPct = (totalBestEdgePPFinal >= EDGE_THRESHOLD_PP && dkOdds?.overOdds != null && dkOdds?.underOdds != null && modelOdds?.overOdds != null && modelOdds?.underOdds != null)
    ? (overEdgePP >= underEdgePP
        ? calculateRoi(modelOdds.overOdds, dkOdds.overOdds, dkOdds.underOdds)
        : calculateRoi(modelOdds.underOdds, dkOdds.underOdds, dkOdds.overOdds))
    : NaN;
  // ── BetCellSide builders ─────────────────────────────────────────────────────
  // [DISPLAY] DK convention: HOME on top, AWAY on bottom.
  // BetCell renders 'away' prop as top row and 'home' prop as bottom row.
  // So we pass home odds → away prop (top) and away odds → home prop (bottom).
  const mlAway: BetCellSide = {
    bookLine: '', bookJuice: fmtAmerican(dkOdds?.home) ?? '—',
    modelLine: '', modelJuice: fmtAmerican(modelOdds?.home) ?? '—',
    edgePP: homeMlEdgePP,
  };
  const mlHome: BetCellSide = {
    bookLine: '', bookJuice: fmtAmerican(dkOdds?.away) ?? '—',
    modelLine: '', modelJuice: fmtAmerican(modelOdds?.away) ?? '—',
    edgePP: awayMlEdgePP,
  };
  // [FIX] formatTotalLine: O2.5 not O2.50, O2 not O2.00
  const fmtTL = formatTotalLine(totalLine);
  const totalOver: BetCellSide = {
    bookLine: `O${fmtTL}`, bookJuice: fmtAmerican(dkOdds?.overOdds) ?? '—',
    modelLine: `O${fmtTL}`, modelJuice: fmtAmerican(modelOdds?.overOdds) ?? '—',
    edgePP: overEdgePP,
  };
  const totalUnder: BetCellSide = {
    bookLine: `U${fmtTL}`, bookJuice: fmtAmerican(dkOdds?.underOdds) ?? '—',
    modelLine: `U${fmtTL}`, modelJuice: fmtAmerican(modelOdds?.underOdds) ?? '—',
    edgePP: underEdgePP,
  };
  const drawAway: BetCellSide = {
    bookLine: '', bookJuice: fmtAmerican(dkOdds?.draw) ?? '—',
    modelLine: '', modelJuice: fmtAmerican(modelOdds?.draw) ?? '—',
    edgePP: drawEdgePP,
  };
  // Draw has no home side — singleRow=true suppresses the home row in BetCell
  const drawHome: BetCellSide = {
    bookLine: '', bookJuice: '', modelLine: '', modelJuice: '', edgePP: NaN,
  };

  console.log(
    `[WcMobileOddsPanel] fixture=${fixture.fixtureId}` +
    ` | [INPUT] away=${awayName} home=${homeName}` +
    ` | [STATE] mlBestEdge=${isNaN(mlBestEdgePPFinal) ? 'NaN' : mlBestEdgePPFinal.toFixed(2)}pp` +
    ` totalBestEdge=${isNaN(totalBestEdgePPFinal) ? 'NaN' : totalBestEdgePPFinal.toFixed(2)}pp` +
    ` drawEdge=${isNaN(drawEdgePP) ? 'NaN' : drawEdgePP.toFixed(2)}pp` +
    ` | [OUTPUT] mlEdgeLabel=${mlEdgeLabel ?? 'NO EDGE'} totalEdgeLabel=${totalEdgeLabel ?? 'NO EDGE'} drawEdgeLabel=${drawEdgeLabel ?? 'NO EDGE'}` +
    ` | [OUTPUT] mlBestRoi=${isNaN(mlBestRoiPct) ? 'NaN' : mlBestRoiPct.toFixed(2)}% totalBestRoi=${isNaN(totalBestRoiPct) ? 'NaN' : totalBestRoiPct.toFixed(2)}% drawRoi=${isNaN(drawRoiPct) ? 'NaN' : drawRoiPct.toFixed(2)}%` +
    ` | [VERIFY] hasOdds=${dkOdds != null} hasModel=${modelOdds != null} has3WayOdds=${has3WayOdds}`
  );

  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 4, padding: '6px 6px', width: '100%' }}>

      {/* Col 1: MONEYLINE — 3-way ROI via calculate3WayResult */}
      {/* [NOTE] Per-card ML/TOTAL/DRAW title spans removed — sticky column header provides these labels once at the top */}
      <BetCell
        title="ML"
        away={mlAway}
        home={mlHome}
        edgeLabel={mlEdgeLabel}
        bestEdgePP={mlBestEdgePPFinal}
        roiPct={mlBestRoiPct}
        size="sm"
      />

      {/* Col 2: DRAW — singleRow=true (no home row), 3-way ROI — narrow cell, centered between ML and TOTAL */}
      {/* [FIX] DRAW is single-row only — narrow fixed width, no flex growth */}
      <div style={{ flex: '0 0 auto', width: 'clamp(72px,22vw,88px)' }}>
        <BetCell
          title="DRAW"
          away={drawAway}
          home={drawHome}
          edgeLabel={drawEdgeLabel}
          bestEdgePP={drawEdgePP}
          roiPct={drawRoiPct}
          size="sm"
          singleRow={true}
        />
      </div>

      {/* Col 3: TOTAL — 2-way ROI (over/under, no draw) */}
      <BetCell
        title="TOTAL"
        away={totalOver}
        home={totalUnder}
        edgeLabel={totalEdgeLabel}
        bestEdgePP={totalBestEdgePPFinal}
        roiPct={totalBestRoiPct}
        size="sm"
      />

    </div>
  );
}

// ─── Fixture Card Skeleton ────────────────────────────────────────────────────

function WcFixtureCardSkeleton() {
  return (
    <div
      className="w-full"
      style={{
        background: "hsl(var(--card))",
        borderTop: "1px solid hsl(var(--border))",
        borderBottom: "1px solid hsl(var(--border))",
        borderLeft: "3px solid rgba(255,255,255,0.1)",
        minHeight: 'clamp(160px,14vw,220px)',
      }}
    >
      <div className="hidden md:flex items-stretch w-full h-full" style={{ minHeight: 'clamp(160px,14vw,220px)' }}>
        <div style={{ flex: "0 0 clamp(170px,22vw,260px)", borderRight: "1px solid hsl(var(--border) / 0.5)", padding: 12 }}>
          <Skeleton className="h-4 w-24 bg-zinc-800 mb-3" />
          <div className="flex items-center gap-2 mb-2">
            <Skeleton className="h-9 w-9 rounded-full bg-zinc-800" />
            <Skeleton className="h-4 w-28 bg-zinc-800" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-9 rounded-full bg-zinc-800" />
            <Skeleton className="h-4 w-28 bg-zinc-800" />
          </div>
        </div>
        <div className="flex-1 flex items-stretch">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex-1 p-3 space-y-2">
              <Skeleton className="h-4 w-16 bg-zinc-800 mx-auto" />
              <div className="grid grid-cols-2 gap-2">
                <Skeleton className="h-8 bg-zinc-800 rounded-lg" />
                <Skeleton className="h-8 bg-zinc-800 rounded-lg" />
                <Skeleton className="h-8 bg-zinc-800 rounded-lg" />
                <Skeleton className="h-8 bg-zinc-800 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Lineup Card — exact MlbLineupCard structure ──────────────────────────────

function StartingXiHeader({ confirmed, isMobile }: { confirmed: boolean; isMobile: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: isMobile ? "5px 8px 3px" : "7px 12px 4px",
        borderBottom: "1px solid rgba(24,36,51,0.6)",
      }}
    >
      <span
        style={{
          fontSize: isMobile ? 7 : 8,
          fontWeight: 700,
          letterSpacing: "1.5px",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.5)",
        }}
      >
        Starting XI
      </span>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 3,
          fontSize: isMobile ? 7 : 8,
          fontWeight: 600,
          letterSpacing: "0.5px",
          textTransform: "uppercase",
          color: confirmed ? "#39FF14" : "#FFFF33",
        }}
      >
        <span
          style={{
            width: isMobile ? 4 : 5,
            height: isMobile ? 4 : 5,
            borderRadius: "50%",
            background: confirmed ? "#39FF14" : "#FFFF33",
            display: "inline-block",
          }}
        />
        {confirmed ? "Confirmed" : "Expected"}
      </span>
    </div>
  );
}

function PlayerRows({ players, isMobile, fifaCode }: { players: WcLineupPlayer[]; isMobile: boolean; fifaCode: string }) {
  if (players.length === 0) {
    return (
      <div style={{ padding: "10px 8px", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 60 }}>
        <span style={{ fontSize: 9, color: "#FFFFFF", fontWeight: 600, letterSpacing: "1px", textTransform: "uppercase" }}>
          Lineup Pending
        </span>
      </div>
    );
  }

  if (isMobile) {
    return (
      <div style={{ padding: "4px 6px" }}>
        {players.map((p, i) => {
          const isInjured = p.injuryStatus && p.injuryStatus !== "null";
          const injuryColor = p.injuryStatus === "OUT" ? "#EF4444" : p.injuryStatus === "QUES" ? "#F59E0B" : "#F97316";
          return (
            <div
              key={p.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 3,
                padding: "5px 0",
                borderBottom: i < players.length - 1 ? "1px solid rgba(24,36,51,0.5)" : "none",
              }}
            >
              {/* Jersey number */}
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 10, fontWeight: 700, color: "#FFFFFF", width: 14, flexShrink: 0, textAlign: "right" }}>
                {p.jerseyNumber ?? ""}
              </span>
              {/* Flag circle */}
              <div style={{ width: 28, height: 28, borderRadius: "50%", overflow: "hidden", flexShrink: 0, border: "1px solid rgba(255,255,255,0.1)" }}>
                <img src={fifaFlagUrl(fifaCode)} alt={fifaCode} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              </div>
              {/* Name + position */}
              <div style={{ flex: 1, minWidth: 0, marginLeft: 4 }}>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, fontWeight: 800, color: "#FFFFFF", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.2 }}>
                  {p.playerName}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
                  {p.position && (
                    <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", color: "#7EB8D4", background: "rgba(30,60,90,0.6)", padding: "1px 4px", borderRadius: 3, border: "1px solid rgba(30,80,120,0.4)", lineHeight: 1.4 }}>
                      {p.position}
                    </span>
                  )}
                  {isInjured && (
                    <span style={{ fontSize: 9, fontWeight: 700, color: injuryColor, letterSpacing: "0.5px", textTransform: "uppercase" }}>
                      {p.injuryStatus}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Desktop
  return (
    <div style={{ padding: "8px 14px" }}>
      {players.map((p, i) => {
        const isInjured = p.injuryStatus && p.injuryStatus !== "null";
        const injuryColor = p.injuryStatus === "OUT" ? "#EF4444" : p.injuryStatus === "QUES" ? "#F59E0B" : "#F97316";
        return (
          <div
            key={p.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              padding: "6px 0",
              borderBottom: i < players.length - 1 ? "1px solid rgba(24,36,51,0.6)" : "none",
            }}
          >
            {/* Jersey number */}
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)", width: 16, flexShrink: 0, textAlign: "right" }}>
              {p.jerseyNumber ?? ""}
            </span>
            {/* Flag circle */}
            <div style={{ width: 32, height: 32, borderRadius: "50%", overflow: "hidden", flexShrink: 0, border: "1px solid rgba(255,255,255,0.1)" }}>
              <img src={fifaFlagUrl(fifaCode)} alt={fifaCode} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            </div>
            {/* Name + position + injury */}
            <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 14, fontWeight: 800, color: "#FFFFFF", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>
                {p.playerName}
              </span>
              {p.position && (
                <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", color: "#7EB8D4", background: "rgba(30,60,90,0.6)", padding: "1px 6px", borderRadius: 3, border: "1px solid rgba(30,80,120,0.4)", lineHeight: 1.5, flexShrink: 0 }}>
                  {p.position}
                </span>
              )}
              {isInjured && (
                <span style={{ fontSize: 10, fontWeight: 700, color: injuryColor, letterSpacing: "0.5px", textTransform: "uppercase", flexShrink: 0 }}>
                  {p.injuryStatus}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WcLineupCard({ fixture }: { fixture: WcFixtureWithLineups }) {
  const { homeTeam, awayTeam, venue, lineups } = fixture;
  const isMobile = typeof window !== "undefined" && window.innerWidth < 640;

  const homeFifaCode = homeTeam?.fifaCode ?? fixture.homeTeamId.toUpperCase();
  const awayFifaCode = awayTeam?.fifaCode ?? fixture.awayTeamId.toUpperCase();
  const awayColors = getWcTeamColors(awayFifaCode);
  const homeColors = getWcTeamColors(homeFifaCode);

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
  const anyConfirmed = lineups.some((p) => p.isConfirmed);

  const startTime = fmtKickoff(fixture.kickoffUtc);

  return (
    <div
      style={{
        background: "#090E14",
        borderRadius: 12,
        border: "1px solid #182433",
        overflow: "hidden",
        marginBottom: 10,
        marginLeft: 12,
        marginRight: 12,
      }}
    >
      {/* Color top bar — exact MlbLineupCard gradient */}
      <div
        style={{
          height: 3,
          background: `linear-gradient(90deg, ${awayColors.primary} 48%, ${homeColors.primary} 52%)`,
        }}
      />

      {/* ── Matchup header — gridTemplateColumns: "1fr auto 1fr" ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          padding: isMobile ? "8px 10px 6px" : "14px 18px 12px",
          borderBottom: "1px solid #182433",
          gap: isMobile ? 6 : 10,
        }}
      >
        {/* Away team — left-aligned */}
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 7 : 12 }}>
          <div
            style={{
              width: isMobile ? 28 : 42,
              height: isMobile ? 28 : 42,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: `radial-gradient(circle at 30% 30%, ${awayColors.primary}cc, ${awayColors.secondary}88)`,
              flexShrink: 0,
              overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <img
              src={awayTeam?.flagUrl ?? fifaFlagUrl(awayFifaCode)}
              alt={awayFifaCode}
              style={{ width: isMobile ? 18 : 28, height: isMobile ? 12 : 18, objectFit: "cover", borderRadius: 2 }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          </div>
          <div>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: isMobile ? 11 : 13, fontWeight: 900, letterSpacing: "0.5px", textTransform: "uppercase", color: "#FFFFFF", lineHeight: 1.1 }}>
              {awayTeam?.name ?? awayFifaCode}
            </div>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: isMobile ? 9 : 11, fontWeight: 400, color: "rgba(255,255,255,0.5)", letterSpacing: "0.5px", marginTop: 1 }}>
              {awayFifaCode}
            </div>
            <div style={{ fontSize: isMobile ? 7 : 8, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", padding: isMobile ? "1px 4px" : "1px 6px", borderRadius: 3, marginTop: isMobile ? 2 : 4, display: "inline-block", background: `${awayColors.primary}22`, color: "#FFFFFF", border: `1px solid ${awayColors.primary}44` }}>
              Away
            </div>
          </div>
        </div>

        {/* Center: time + @ */}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: isMobile ? 10 : 12, fontWeight: 700, color: "#FFFFFF", letterSpacing: "1px", whiteSpace: "nowrap" }}>
            {startTime}
          </div>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: isMobile ? 9 : 10, color: "#FFFFFF", letterSpacing: "3px", marginTop: 3 }}>
            @
          </div>
        </div>

        {/* Home team — right-aligned */}
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 7 : 12, justifyContent: "flex-end" }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: isMobile ? 11 : 13, fontWeight: 900, letterSpacing: "0.5px", textTransform: "uppercase", color: "#FFFFFF", lineHeight: 1.1 }}>
              {homeTeam?.name ?? homeFifaCode}
            </div>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: isMobile ? 9 : 11, fontWeight: 400, color: "rgba(255,255,255,0.5)", letterSpacing: "0.5px", marginTop: 1 }}>
              {homeFifaCode}
            </div>
            <div style={{ fontSize: isMobile ? 7 : 8, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", padding: isMobile ? "1px 4px" : "1px 6px", borderRadius: 3, marginTop: isMobile ? 2 : 4, display: "inline-block", background: `${homeColors.primary}22`, color: "#FFFFFF", border: `1px solid ${homeColors.primary}44` }}>
              Home
            </div>
          </div>
          <div
            style={{
              width: isMobile ? 28 : 42,
              height: isMobile ? 28 : 42,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: `radial-gradient(circle at 30% 30%, ${homeColors.primary}cc, ${homeColors.secondary}88)`,
              flexShrink: 0,
              overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <img
              src={homeTeam?.flagUrl ?? fifaFlagUrl(homeFifaCode)}
              alt={homeFifaCode}
              style={{ width: isMobile ? 18 : 28, height: isMobile ? 12 : 18, objectFit: "cover", borderRadius: 2 }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          </div>
        </div>
      </div>

      {!hasLineups ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 16px", gap: 8, color: "rgba(255,255,255,0.3)", fontSize: 12, borderTop: "1px solid #182433" }}>
          <Users style={{ width: 16, height: 16 }} />
          <span>Lineups not yet available</span>
        </div>
      ) : (
        <div>
          {/* ── Two-column lineup grid — gridTemplateColumns: "1fr 1px 1fr" ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1px 1fr", borderBottom: "1px solid #182433" }}>
            {/* Away team column */}
            <div>
              <StartingXiHeader confirmed={anyConfirmed} isMobile={isMobile} />
              <PlayerRows players={awayStarters} isMobile={isMobile} fifaCode={awayFifaCode} />
              {awayBench.length > 0 && (
                <>
                  <div style={{ padding: isMobile ? "4px 8px 2px" : "5px 14px 3px", borderTop: "1px solid rgba(24,36,51,0.5)", borderBottom: "1px solid rgba(24,36,51,0.5)" }}>
                    <span style={{ fontSize: isMobile ? 7 : 8, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.35)" }}>
                      Bench
                    </span>
                  </div>
                  <PlayerRows players={awayBench} isMobile={isMobile} fifaCode={awayFifaCode} />
                </>
              )}
            </div>

            {/* Divider */}
            <div style={{ background: "#182433" }} />

            {/* Home team column */}
            <div>
              <StartingXiHeader confirmed={anyConfirmed} isMobile={isMobile} />
              <PlayerRows players={homeStarters} isMobile={isMobile} fifaCode={homeFifaCode} />
              {homeBench.length > 0 && (
                <>
                  <div style={{ padding: isMobile ? "4px 8px 2px" : "5px 14px 3px", borderTop: "1px solid rgba(24,36,51,0.5)", borderBottom: "1px solid rgba(24,36,51,0.5)" }}>
                    <span style={{ fontSize: isMobile ? 7 : 8, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.35)" }}>
                      Bench
                    </span>
                  </div>
                  <PlayerRows players={homeBench} isMobile={isMobile} fifaCode={homeFifaCode} />
                </>
              )}
            </div>
          </div>

          {/* Venue footer */}
          {venue && (
            <div style={{ padding: "6px 14px", display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
              <MapPin style={{ width: 10, height: 10, flexShrink: 0 }} />
              <span>{venue.stadium}, {venue.city}</span>
              {venue.elevationM > 500 && (
                <span style={{ color: "#F59E0B", marginLeft: 4 }}>⚠ {venue.elevationM}m alt</span>
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
  // [FIX] Use todayStr() which wraps todayUTC() — cutoff-aware effective feed date.
  // This prevents late-night UTC matches (e.g. MEX vs KOR at 01:00 UTC = June 18 EDT)
  // from being missed after midnight UTC when raw ISO date would return June 19.
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

  // Splits query — MUST be called unconditionally before any early return (Rules of Hooks)
  const { data: splitsData } = trpc.wc2026.splitsByDate.useQuery(
    { date },
    {
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
    }
  );

  const { data: fixtures, isLoading } = isTodayDate ? todayQuery : dateQuery;

  // Build a map: fixtureId → WcFixtureSplits for O(1) lookup
  const splitsMap = (splitsData as WcFixtureSplits[] | undefined)?.reduce<Record<string, WcFixtureSplits>>(
    (acc, s) => { acc[s.fixtureId] = s; return acc; },
    {}
  ) ?? {};

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
    <div>
      {(fixtures as WcFixtureWithOdds[]).map((f) => (
        <WcFixtureCard
          key={f.fixtureId}
          fixture={f}
          splits={splitsMap[f.fixtureId]}
        />
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
          <div key={i} style={{ background: "#090E14", borderRadius: 12, border: "1px solid #182433", marginBottom: 10, marginLeft: 12, marginRight: 12, padding: 16 }}>
            <div className="flex justify-between mb-4">
              <Skeleton className="h-4 w-24 bg-zinc-800" />
              <Skeleton className="h-4 w-16 bg-zinc-800" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                {[1,2,3,4].map(j => <Skeleton key={j} className="h-10 w-full bg-zinc-800 rounded" />)}
              </div>
              <div className="space-y-2">
                {[1,2,3,4].map(j => <Skeleton key={j} className="h-10 w-full bg-zinc-800 rounded" />)}
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

// ─── Splits Feed ─────────────────────────────────────────────────────────────

function WcSplitsFeed({ date }: { date: string }) {
  const { data: splitsData, isLoading } = trpc.wc2026.splitsByDate.useQuery(
    { date },
    {
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
    }
  );

  if (isLoading) {
    return (
      <div className="pt-4 px-3 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} style={{ background: 'hsl(var(--card))', borderRadius: 8, padding: 16 }}>
            <Skeleton className="h-4 w-32 bg-zinc-800 mb-3" />
            <div className="space-y-2">
              <Skeleton className="h-8 w-full bg-zinc-800 rounded-full" />
              <Skeleton className="h-8 w-full bg-zinc-800 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const splits = splitsData as WcFixtureSplits[] | undefined;

  if (!splits || splits.length === 0 || splits.every((s) => s.splits.length === 0)) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center px-4">
        <CalendarDays className="w-10 h-10 text-zinc-600" />
        <div>
          <p className="text-sm font-semibold text-zinc-400 mb-1">
            No betting splits available for {WC_DATE_LABELS[date] ?? date}
          </p>
          <p className="text-xs text-zinc-600">Splits sourced from DraftKings Network · Updated every 5 min</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-3 pb-4">
      {splits.filter((s) => s.splits.length > 0).map((s) => {
        const homeFifaCode = s.homeTeamId.toUpperCase();
        const awayFifaCode = s.awayTeamId.toUpperCase();
        const homeColors = getWcTeamColors(homeFifaCode);
        const awayColors = getWcTeamColors(awayFifaCode);

        const mlSplits    = extractWcSplits(s, 'ML',    s.awayTeamId, s.homeTeamId);
        const totalSplits = extractWcSplits(s, 'TOTAL', s.awayTeamId, s.homeTeamId);

        const hasMl    = mlSplits.awayTickets    != null || mlSplits.homeTickets    != null;
        const hasTotal = totalSplits.awayTickets != null || totalSplits.homeTickets != null;

        if (!hasMl && !hasTotal) return null;

        return (
          <div
            key={s.fixtureId}
            style={{
              background: 'hsl(var(--card))',
              borderTop: '1px solid hsl(var(--border))',
              borderBottom: '1px solid hsl(var(--border))',
              borderLeft: `3px solid ${awayColors.primary}`,
              padding: '12px 16px 14px',
              marginBottom: 0,
            }}
          >
            {/* Fixture header */}
            <div className="flex items-center gap-2 mb-3">
              <div className="flex items-center gap-1.5">
                <div style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: `radial-gradient(circle at 30% 30%, ${awayColors.primary}cc, ${awayColors.secondary}88)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', flexShrink: 0,
                }}>
                  <img
                    src={fifaFlagUrl(awayFifaCode)}
                    alt={awayFifaCode}
                    style={{ width: 14, height: 10, objectFit: 'cover', borderRadius: 1 }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', letterSpacing: '0.06em' }}>{awayFifaCode}</span>
              </div>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>vs</span>
              <div className="flex items-center gap-1.5">
                <div style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: `radial-gradient(circle at 30% 30%, ${homeColors.primary}cc, ${homeColors.secondary}88)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', flexShrink: 0,
                }}>
                  <img
                    src={fifaFlagUrl(homeFifaCode)}
                    alt={homeFifaCode}
                    style={{ width: 14, height: 10, objectFit: 'cover', borderRadius: 1 }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', letterSpacing: '0.06em' }}>{homeFifaCode}</span>
              </div>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginLeft: 'auto', textTransform: 'uppercase', letterSpacing: '0.08em' }}>DraftKings</span>
            </div>

            {/* ML splits */}
            {hasMl && (
              <div className="mb-3">
                <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>MONEYLINE</div>
                <div className="space-y-2">
                  <MergedSplitBar
                    awayPct={mlSplits.awayTickets}
                    homePct={mlSplits.homeTickets}
                    awayColor={awayColors.primary}
                    homeColor={homeColors.primary}
                    rowLabel="TICKETS"
                    awayLabel={awayFifaCode}
                    homeLabel={homeFifaCode}
                  />
                  <MergedSplitBar
                    awayPct={mlSplits.awayMoney}
                    homePct={mlSplits.homeMoney}
                    awayColor={awayColors.primary}
                    homeColor={homeColors.primary}
                    rowLabel="MONEY"
                    awayLabel={awayFifaCode}
                    homeLabel={homeFifaCode}
                  />
                </div>
              </div>
            )}

            {/* Total splits */}
            {hasTotal && (
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>TOTAL</div>
                <div className="space-y-2">
                  <MergedSplitBar
                    awayPct={totalSplits.awayTickets}
                    homePct={totalSplits.homeTickets}
                    awayColor="#39FF14"
                    homeColor="#FF6B35"
                    rowLabel="TICKETS"
                    awayLabel="OVER"
                    homeLabel="UNDER"
                  />
                  <MergedSplitBar
                    awayPct={totalSplits.awayMoney}
                    homePct={totalSplits.homeMoney}
                    awayColor="#39FF14"
                    homeColor="#FF6B35"
                    rowLabel="MONEY"
                    awayLabel="OVER"
                    homeLabel="UNDER"
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
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

// ─── Main Inline Feed Component ───────────────────────────────────────────────

/**
 * WcFeedInline — renders the full WC 2026 feed inside ModelProjections.
 *
 * Props:
 *   selectedDate   — controlled date string (YYYY-MM-DD) from ModelProjections
 *   onDateChange   — callback to update date in ModelProjections (lifts date state up)
 *
 * [ARCHITECTURE NOTE]
 * Date state is OWNED by ModelProjections so the CalendarPicker renders in the
 * same header row as MLB (not below the WC title). WcFeedInline only owns the
 * active sub-tab state (PROJECTIONS | SPLITS | LINEUPS | STANDINGS | FUTURES).
 */
export function WcFeedInline({
  selectedDate,
  onDateChange,
}: {
  selectedDate: string;
  onDateChange: (date: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<WcSubTab>("PROJECTIONS");

  console.log(`[WcFeedInline] [STATE] activeTab=${activeTab} selectedDate=${selectedDate}`);

  return (
    <div className="w-full">
      { /* ── WC Sub-header (sticky below main feed header) ── */}
      { /* [LOG] WcSubHeader: ResizeObserver measures height into --wc-subheader-h for column header top */}
      <div
        ref={(el) => {
          if (!el) return;
          // [STEP] Measure WC sub-header height -> --wc-subheader-h CSS var
          const prev = (el as HTMLElement & { _wcSubRO?: ResizeObserver })._wcSubRO;
          if (prev) prev.disconnect();
          const ro = new ResizeObserver(() => {
            const h = Math.ceil(el.getBoundingClientRect().height);
            document.documentElement.style.setProperty('--wc-subheader-h', `${h}px`);
            console.log(`[WcSubHeader] [STATE] h=${h}px -> --wc-subheader-h`);
          });
          ro.observe(el);
          (el as HTMLElement & { _wcSubRO?: ResizeObserver })._wcSubRO = ro;
          const h = Math.ceil(el.getBoundingClientRect().height);
          document.documentElement.style.setProperty('--wc-subheader-h', `${h}px`);
          console.log(`[WcSubHeader] [OUTPUT] initial --wc-subheader-h=${h}px`);
        }}
        className="sticky z-[38] border-b border-white/8"
        style={{
          top: "var(--prez-header-h, 220px)",
          background: "#0f0f0f", /* [FIX] solid opaque — no transparency bleed */
        }}
      >
        { /* Title row */}
        <div className="flex items-center gap-3 px-3 sm:px-4 pt-3 pb-2">
          <img
            src="https://digitalhub.fifa.com/transform/de1fd0e5-c091-49ac-a115-00faec1217b1/FIFA-World-Cup-26-Official-Brand-unveiled-in-Los-Angeles?&io=transform:fill,width:768&quality=75"
            alt="FIFA World Cup 2026"
            className="h-8 w-auto object-contain flex-shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-white tracking-wide">FIFA World Cup 2026</div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-widest">
              Group Stage · USA / CAN / MEX
            </div>
          </div>
          {/* Formatted date — same style as MLB: TUESDAY, JUNE 17, 2026 */}
          {/* [OUTPUT] formatDateHeader(selectedDate) rendered right-aligned next to FIFA logo block */}
          <div className="flex-shrink-0 text-right" style={{ maxWidth: '45%' }}>
            <span
              className="font-bold tracking-widest uppercase"
              style={{
                fontSize: 'clamp(8px, 2.4vw, 14px)',
                color: '#ffffff',
                whiteSpace: 'nowrap',
                display: 'block',
                lineHeight: 1.2,
              }}
            >
              {formatDateHeader(selectedDate)}
            </span>
          </div>
        </div>

        { /* Sub-tab nav */}
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

      {/* ── WC Column Header: MATCHUP | ML | TOTAL | DRAW ── */}
      {/* [LOG] WcColHeader: normal flow child of sticky sub-header — zero gap guaranteed */}
      {/* [FIX] Moved inside sticky sub-header div. No position:sticky needed. */}
      {/* [VERIFY] background: #0f0f0f matches sub-header — no bleed, no gap */}
      {activeTab === 'PROJECTIONS' && (
        <div
          className="grid lg:hidden"
          style={{
            gridTemplateColumns: 'clamp(120px, 32%, 150px) 1fr',
            width: '100%',
            background: '#0f0f0f',
            borderBottom: '1px solid rgba(255,255,255,0.12)',
            boxShadow: '0 2px 12px rgba(0,0,0,0.85)',
            touchAction: 'none',
          }}
        >
          {/* Left: MATCHUP */}
          <div style={{
            padding: '5px 4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRight: '1px solid rgba(255,255,255,0.10)',
          }}>
            <span style={{
              fontSize: 'clamp(9px, 2.5vw, 11px)',
              fontWeight: 700,
              color: 'rgba(255,255,255,0.60)',
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
              whiteSpace: 'nowrap',
            }}>MATCHUP</span>
          </div>
          {/* Right: ML | TOTAL | DRAW */}
          <div style={{
            padding: '5px 6px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}>
            {(['ML', 'DRAW', 'TOTAL'] as const).map((lbl) => (
              <div key={lbl} style={{
                flex: lbl === 'DRAW' ? '0 0 auto' : '1 1 0',
                width: lbl === 'DRAW' ? 'clamp(72px,22vw,88px)' : undefined,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 0,
              }}>
                <span style={{
                  fontSize: 'clamp(9px, 2.5vw, 11px)',
                  fontWeight: 700,
                  color: 'rgba(255,255,255,0.80)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.07em',
                  whiteSpace: 'nowrap',
                  textAlign: 'center',
                }}>{lbl}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      </div>


      {/* ── Content ── */}
      {activeTab === "PROJECTIONS" && <WcProjectionsFeed date={selectedDate} />}
      {activeTab === "SPLITS" && <WcSplitsFeed date={selectedDate} />}
      {activeTab === "LINEUPS" && <WcLineupsFeed date={selectedDate} />}
      {activeTab === "STANDINGS" && <WcComingSoon label="Group Standings" />}
      {activeTab === "FUTURES" && <WcComingSoon label="Futures & Outrights" />}
    </div>
  );
}
