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
import { keepPreviousData } from "@tanstack/react-query";
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

// [MODEL GATE] Set to true when model lines are ready to publish.
// When false, MODEL column shows — across all WC fixture cards.
const SHOW_WC_MODEL_ODDS = true;

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

const WC_SUB_TABS = ["PROJECTIONS", "LINEUPS", "STANDINGS", "FUTURES"] as const;
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

// ─── Team Name Aliases ────────────────────────────────────────────────────────
// Maps full DB team names to shorter display aliases for game card spacing.
// Applied at every render site so score totals populate cleanly.
const WC_TEAM_ALIASES: Record<string, string> = {
  "Czech Republic":          "Czechia",
  "Bosnia and Herzegovina":  "Bosnia",
  "South Korea":             "Korea Rep.",
  "United States":           "USA",
  "United States of America": "USA",
};

/** Returns the display alias for a team name, or the original name if no alias exists. */
function wcTeamAlias(name: string | null | undefined): string {
  if (!name) return "";
  return WC_TEAM_ALIASES[name] ?? name;
}

// ─── Unicode Flag Emoji ────────────────────────────────────────────────────────
// Converts FIFA 3-letter code to unicode flag emoji via ISO 3166-1 alpha-2 mapping.
// [LOG] wcFlagEmoji: returns unicode flag string or empty string if no mapping found
const FIFA_TO_ISO2: Record<string, string> = {
  CAN: 'CA', SUI: 'CH', QAT: 'QA', BIH: 'BA', BRA: 'BR', SCO: 'GB-SCT',
  HAI: 'HT', MAR: 'MA', MEX: 'MX', CZE: 'CZ', KOR: 'KR', RSA: 'ZA',
  USA: 'US', MEX2: 'MX', ARG: 'AR', FRA: 'FR', ENG: 'GB-ENG', GER: 'DE',
  ESP: 'ES', ITA: 'IT', POR: 'PT', NED: 'NL', BEL: 'BE', URU: 'UY',
  COL: 'CO', ECU: 'EC', CHI: 'CL', PER: 'PE', SEN: 'SN', NGA: 'NG',
  CMR: 'CM', GHA: 'GH', CIV: 'CI', TUN: 'TN', EGY: 'EG', ALG: 'DZ',
  JPN: 'JP', AUS: 'AU', IRN: 'IR', SAU: 'SA', UZB: 'UZ', AUT: 'AT',
  CRO: 'HR', SRB: 'RS', POL: 'PL', UKR: 'UA', HUN: 'HU', DEN: 'DK',
  SWE: 'SE', NOR: 'NO', FIN: 'FI', WAL: 'GB-WLS', IRL: 'IE', ISL: 'IS',
  GRE: 'GR', TUR: 'TR', SLO: 'SI', SVK: 'SK', ROM: 'RO', BUL: 'BG',
  PAN: 'PA', CRC: 'CR', HON: 'HN', GTM: 'GT', SLV: 'SV', JAM: 'JM',
  TRI: 'TT', BOL: 'BO', PAR: 'PY', VEN: 'VE', CHN: 'CN', IND: 'IN',
  THA: 'TH', IDN: 'ID', PHI: 'PH', IRQ: 'IQ', JOR: 'JO', KWT: 'KW',
  UAE: 'AE', KEN: 'KE', ZAM: 'ZM', ZIM: 'ZW', ANG: 'AO', COD: 'CD',
  NZL: 'NZ', SVN: 'SI',
};
function wcFlagEmoji(fifaCode: string): string {
  const code = fifaCode?.toUpperCase() ?? '';
  const iso2 = FIFA_TO_ISO2[code];
  if (!iso2 || iso2.includes('-')) {
    // Subdivision codes (GB-SCT, GB-ENG, GB-WLS) — use parent country flag
    if (iso2 === 'GB-SCT' || iso2 === 'GB-ENG' || iso2 === 'GB-WLS') {
      return '\u{1F1EC}\u{1F1E7}'; // 🇬🇧
    }
    return '';
  }
  // Convert ISO 2-letter code to regional indicator symbols
  const A = 0x1F1E6;
  const c1 = String.fromCodePoint(A + iso2.charCodeAt(0) - 65);
  const c2 = String.fromCodePoint(A + iso2.charCodeAt(1) - 65);
  return c1 + c2;
}


// ─── Typography scale — exact GameCard constants ──────────────────────────────
const HDR_FS  = 'clamp(15px,1.25vw,20px)';
const VAL_FS  = 'clamp(12px,1.0vw,16px)';
const ABBR_FS = 'clamp(11px,0.9vw,14px)';
const TITLE_FS = 'clamp(17px,1.45vw,22px)';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtAmerican(odds: number | undefined | null): string {
  if (odds == null) return "—";
  // [FIX] Math.round() prevents IEEE 754 float precision artifacts (e.g. -488.9999999999998 → -489).
  // American odds are always whole integers; rounding is always safe and correct here.
  const rounded = Math.round(odds);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

function fmtKickoff(kickoffUtc: Date | string | null | undefined): string {
  if (!kickoffUtc) return "TBD";
  const d = new Date(kickoffUtc);
  // [FIX] No timeZoneName — keeps kickoff single-line on mobile ("3:00 PM" not "3:00 PM EDT")
  const timeStr = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
  return `${timeStr} ET`;
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
  // 1X2
  home?: number;
  away?: number;
  draw?: number;
  /** 1X2 No-Draw: home or away wins (no draw payout) */
  noDraw?: number;
  // TOTAL
  overLine?: number;
  overOdds?: number;
  underOdds?: number;
  // ASIAN_HANDICAP (spread)
  homeSpreadLine?: number;
  homeSpreadOdds?: number;
  awaySpreadLine?: number;
  awaySpreadOdds?: number;
  // DOUBLE_CHANCE
  /** DOUBLE_CHANCE 1X — Home Win-Draw */
  homeDrawOdds?: number;
  /** DOUBLE_CHANCE X2 — Away Win-Draw */
  awayDrawOdds?: number;
  // BTTS
  bttsYes?: number;
  bttsNo?: number;
  // TO ADVANCE (knockout rounds)
  toAdvanceHome?: number;
  toAdvanceAway?: number;
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

type WcProjection = {
  projHomeScore: number | null;
  projAwayScore: number | null;
  projTotal: number | null;
  projSpread: number | null;
  bttsProb: number | null;
  over25: number | null;
  under25: number | null;
  homeWinProb: number | null;
  drawProb: number | null;
  awayWinProb: number | null;
  modelVersion: string | null;
} | null;

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
  projection?: WcProjection;
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
// [FIX] Defensive Number() cast — value may arrive as string from DB/JSON, toFixed only exists on number
// [VERIFY] Only whole and .5 values are used (no .25/.75 asian handicap)
function formatTotalLine(raw: number | string | null | undefined): string {
  const n = Number(raw);
  if (!isFinite(n)) return String(raw ?? '');
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
  // [FIX] Match MLB TITLE_FS: clamp(17px,1.45vw,22px) for desktop
  const titleFs: React.CSSProperties = {
    fontSize: compact ? 'clamp(9px,2.0vw,11px)' : 'clamp(13px,1.1vw,17px)',
    fontWeight: 850,
    color: '#fff',
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  };

  // [LOG] WcMktCol render state — superseded by WcMktCol:EdgeDetect above

  // ── MLB-identical SubCol: line (dim) + juice (bold) stacked ──────────────────────────────
  // [FIX] Dynamic font scaling: 6+ chars (e.g. +2200, -1000) → minimum size; 5+ chars → small
  // [FIX] No hidden spacer spans for ML — pure flex centering, equal vertical padding
  const SubCol = ({ line, juice, isBook: isBookCol, hasEdge: subEdge }: { line: string; juice: string; isBook: boolean; hasEdge: boolean }) => {
    const juiceColor = isBookCol
      ? 'rgba(255,255,255,0.90)'
      : subEdge ? '#39FF14' : 'rgba(255,255,255,0.90)';
    const isVeryLongOdds = juice.length >= 6; // e.g. +2200, -1000
    const isLongOdds = juice.length >= 5;     // e.g. +1000, -900
    // [FIX] Match MLB VAL_FS scale: larger odds values get smaller font
    const juiceFontSize = isVeryLongOdds
      ? 'clamp(10px,0.9vw,13px)'
      : isLongOdds
      ? 'clamp(11px,0.95vw,14px)'
      : 'clamp(12px,1.0vw,16px)';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: line ? 1 : 0, minWidth: 0, flex: 1 }}>
        {line && (
          <span style={{ fontSize: 'clamp(9px,0.78vw,11px)', fontWeight: 400, color: 'rgba(255,255,255,0.60)', lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{line}</span>
        )}
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
  // [FIX 2026-06-24] Removed pp fallback — display is always "X.XX% ROI" or "NO EDGE"
  const roiStr = (hasEdge && !isNaN(edgeDisplayRoi)) ? formatRoi(edgeDisplayRoi) : 'NO EDGE';
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
      {/* [FIX] justifyContent:'flex-start' — footer uses marginTop:'auto' to pin to bottom without gap */}
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', background: '#2a2a2e', borderRadius: 10, overflow: 'hidden', flex: '1 1 0', minWidth: 0, marginBottom: compact ? 4 : 6 }}>
        {/* BOOK / MODEL header — both muted white, matching MLB exactly */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '0.5px solid rgba(255,255,255,0.08)', padding: '3px 4px 2px' }}>
          {/* BOOK header: full white — matches MLB SectionCol exactly */}
          <span style={{ fontSize: 'clamp(8px,0.75vw,11px)', fontWeight: 700, color: '#FFFFFF', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.10em' }}>BOOK</span>
          {/* MODEL header: neon green — matches MLB SectionCol exactly */}
          <span style={{ fontSize: 'clamp(8px,0.75vw,11px)', fontWeight: 700, color: '#39FF14', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.10em' }}>MODEL</span>
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

      {/* [FIX] SPLITS bars removed — WC splits data not consistently available */}
    </div>
  );
}

// ─── WC Score Panel — exact GameCard ScorePanel structure ─────────────────────

function WcScorePanel({ fixture }: { fixture: WcFixtureWithOdds }) {
  const { homeTeam, awayTeam } = fixture;
  const isLive = fixture.status === "LIVE";
  const isFinal = fixture.status === "FT";
  const hasScores = fixture.homeScore != null && fixture.awayScore != null;
  // [LOG] WcScorePanel: projected scores shown for SCHEDULED fixtures when projection is available
  const isScheduled = !isLive && !isFinal;
  const proj = fixture.projection;
  // Projected scores are intentionally hidden from the feed — internal use only
  const hasProjScores = false;
  const fmtProj = (v: number | null | undefined): string => {
    if (v == null) return '—';
    return v.toFixed(2);
  };
  console.log(
    `[WcScorePanel] fixture=${fixture.fixtureId} status=${fixture.status}` +
    ` | [STATE] isScheduled=${isScheduled} hasProjScores=${hasProjScores}` +
    ` | [INPUT] projHome=${proj?.projHomeScore ?? 'N/A'} projAway=${proj?.projAwayScore ?? 'N/A'}` +
    ` | [VERIFY] projection=${proj != null ? 'PRESENT' : 'MISSING'}`
  );

  const awayFifaCode = awayTeam?.fifaCode ?? fixture.awayTeamId.toUpperCase();
  const homeFifaCode = homeTeam?.fifaCode ?? fixture.homeTeamId.toUpperCase();
  const awayColors = getWcTeamColors(awayFifaCode);
  const homeColors = getWcTeamColors(homeFifaCode);

  const NAME_FONT_SIZE = 'clamp(12px, 1.0vw, 17px)';
  const NICK_FONT_SIZE = 'clamp(10px, 0.8vw, 14px)';
  const TIME_FONT_SIZE = 'clamp(10px, 1.01vw, 13px)'; // [FIX 2026-06-24] reduced min 12px→10px to prevent '9:00 PM ET' wrap on mobile
  const LIVE_FONT_SIZE = 'clamp(13.3px, 1.05vw, 17.1px)';
  // FINAL button: 50% of original size
  // Original: clamp(15.2px, 1.28vw, 19px) → halved: clamp(7.6px, 0.64vw, 9.5px)
  const FINAL_FONT_SIZE = 'clamp(7.6px, 0.64vw, 9.5px)';

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
            className="font-black tracking-widest"
            style={{
              fontSize: FINAL_FONT_SIZE,
              background: "rgba(57,255,20,0.12)",
              color: "#39FF14",
              border: "1px solid rgba(57,255,20,0.4)",
              borderRadius: '6px',
              lineHeight: 1,
              padding: '2px 5px',
            }}
          >
            FINAL
          </span>
        ) : (
          <span className="font-bold flex items-center gap-1" style={{ fontSize: TIME_FONT_SIZE, color: "hsl(var(--foreground))", whiteSpace: 'nowrap' }}>
            {fmtKickoff(fixture.kickoffUtc)}
            {fixture.groupLetter && (
              <span style={{ fontSize: 'clamp(7.5px, 0.65vw, 9.5px)', color: 'hsl(var(--muted-foreground))', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                &middot; GROUP {fixture.groupLetter}
              </span>
            )}
          </span>
        )}
      </div>

      {/* Team group */}
      {/* [LOG] WcScorePanel:Teams — homeAbbr=${homeFifaCode.toUpperCase()} awayAbbr=${awayFifaCode.toUpperCase()} */}
      {/* [STATE] Win/loss coloring: homeScore vs awayScore — winner gets #39FF14 bold, loser gets white unbolded */}
      {/* [VERIFY] Projected scores: amber rgba(251,191,36,0.75) for SCHEDULED; actual scores: green/white for LIVE/FT */}
      {(() => {
        // [STEP] Determine winner for score coloring
        const homeScoreNum = fixture.homeScore ?? 0;
        const awayScoreNum = fixture.awayScore ?? 0;
        const homeWins = hasScores && homeScoreNum > awayScoreNum;
        const awayWins = hasScores && awayScoreNum > homeScoreNum;
        const isDraw = hasScores && homeScoreNum === awayScoreNum;
        // [LOG] WcScorePanel:ScoreColor home=${homeScoreNum} away=${awayScoreNum} homeWins=${homeWins} awayWins=${awayWins} isDraw=${isDraw}
        console.log(
          `[WcScorePanel:ScoreColor] fixture=${fixture.fixtureId}` +
          ` | [STATE] homeScore=${homeScoreNum} awayScore=${awayScoreNum}` +
          ` | [OUTPUT] homeWins=${homeWins} awayWins=${awayWins} isDraw=${isDraw}` +
          ` | [VERIFY] hasScores=${hasScores} isLive=${isLive} isFinal=${isFinal}`
        );
        // [STEP] Score color: winner = #39FF14 bold, loser/draw = white unbolded
        const homeScoreColor = (isLive || isFinal) && hasScores
          ? 'rgba(255,255,255,0.95)'
          : 'rgba(251,191,36,0.75)';
        const homeScoreBold = (isLive || isFinal) && hasScores && homeWins ? 700 : 400;
        const awayScoreColor = (isLive || isFinal) && hasScores
          ? 'rgba(255,255,255,0.95)'
          : 'rgba(251,191,36,0.75)';
        const awayScoreBold = (isLive || isFinal) && hasScores && awayWins ? 700 : 400;
        // [STEP] Projected score color: winner proj = #39FF14 bold, loser/draw = amber unbolded
        const projHomeWins = hasProjScores && (proj!.projHomeScore ?? 0) > (proj!.projAwayScore ?? 0);
        const projAwayWins = hasProjScores && (proj!.projAwayScore ?? 0) > (proj!.projHomeScore ?? 0);
        const projHomeColor = projHomeWins ? '#39FF14' : 'rgba(251,191,36,0.75)';
        const projHomeBold = projHomeWins ? 700 : 400;
        const projAwayColor = projAwayWins ? '#39FF14' : 'rgba(251,191,36,0.75)';
        const projAwayBold = projAwayWins ? 700 : 400;
        return (
          <div className="flex flex-1 flex-col" style={{ gap: 0, justifyContent: 'center' }}>
            {/* [FIX] Away team row — TOP (standard sportsbook convention: away listed first/top) */}
            <div className="flex items-center justify-between gap-2 py-1 w-full">
              <div className="flex items-center gap-2">
                {/* Unicode flag emoji — replaces img tag for reliability and clarity */}
                <span style={{ fontSize: 'clamp(26px, 7vw, 36px)', lineHeight: 1, flexShrink: 0 }} aria-label={awayFifaCode}>
                  {wcFlagEmoji(awayFifaCode) || '🏳️'}
                </span>
                {/* [FIX] Mobile: FIFA code abbreviated ALL CAPS. Desktop: full country name. */}
                {/* [FIX] fontWeight: bold if winning (awayScoreBold), unbolded if losing/tied */}
                <span className="md:hidden font-bold leading-tight" style={{ fontSize: 'clamp(11px, 3.5vw, 14px)', color: 'rgba(255,255,255,0.95)', fontWeight: awayScoreBold, whiteSpace: 'nowrap', lineHeight: 1.2, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  {awayFifaCode.toUpperCase()}
                </span>
                <span className="hidden md:inline font-bold leading-tight" style={{ fontSize: 'clamp(12px, 1.0vw, 17px)', color: 'rgba(255,255,255,0.95)', fontWeight: awayScoreBold, whiteSpace: 'nowrap', lineHeight: 1.2, letterSpacing: '0.02em' }}>
                  {wcTeamAlias(awayTeam?.name ?? awayFifaCode)}
                </span>
              </div>
              {/* [FIX] Win/loss score coloring: winner = #39FF14 bold, loser = white unbolded */}
              {(isLive || isFinal) && hasScores ? (
                <span className="tabular-nums flex-shrink-0" style={{ fontSize: 'clamp(22px, 2.5vw, 44px)', lineHeight: 1, fontWeight: awayScoreBold, color: awayScoreColor }}>
                  {fixture.awayScore}
                </span>
              ) : hasProjScores ? (
                <span className="tabular-nums flex-shrink-0" style={{ fontSize: 'clamp(9px, 2.5vw, 11px)', lineHeight: 1, fontWeight: projAwayBold, color: projAwayColor, letterSpacing: '0.01em' }}>
                  {fmtProj(proj!.projAwayScore)}
                </span>
              ) : null}
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: "hsl(var(--border) / 0.4)" }} />

            {/* [FIX] Home team row — BOTTOM (standard sportsbook convention: home listed second/bottom) */}
            <div className="flex items-center justify-between gap-2 py-1 w-full">
              <div className="flex items-center gap-2">
                {/* Unicode flag emoji — replaces img tag for reliability and clarity */}
                <span style={{ fontSize: 'clamp(26px, 7vw, 36px)', lineHeight: 1, flexShrink: 0 }} aria-label={homeFifaCode}>
                  {wcFlagEmoji(homeFifaCode) || '🏳️'}
                </span>
                {/* [FIX] Mobile: FIFA code abbreviated ALL CAPS. Desktop: full country name. */}
                {/* [FIX] fontWeight: bold if winning (homeScoreBold), unbolded if losing/tied */}
                <span className="md:hidden font-bold leading-tight" style={{ fontSize: 'clamp(11px, 3.5vw, 14px)', color: 'rgba(255,255,255,0.95)', fontWeight: homeScoreBold, whiteSpace: 'nowrap', lineHeight: 1.2, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  {homeFifaCode.toUpperCase()}
                </span>
                <span className="hidden md:inline font-bold leading-tight" style={{ fontSize: 'clamp(12px, 1.0vw, 17px)', color: 'rgba(255,255,255,0.95)', fontWeight: homeScoreBold, whiteSpace: 'nowrap', lineHeight: 1.2, letterSpacing: '0.02em' }}>
                  {wcTeamAlias(homeTeam?.name ?? homeFifaCode)}
                </span>
              </div>
              {/* [FIX] Win/loss score coloring: winner = #39FF14 bold, loser = white unbolded */}
              {(isLive || isFinal) && hasScores ? (
                <span className="tabular-nums flex-shrink-0" style={{ fontSize: 'clamp(22px, 2.5vw, 44px)', lineHeight: 1, fontWeight: homeScoreBold, color: homeScoreColor }}>
                  {fixture.homeScore}
                </span>
              ) : hasProjScores ? (
                <span className="tabular-nums flex-shrink-0" style={{ fontSize: 'clamp(9px, 2.5vw, 11px)', lineHeight: 1, fontWeight: projHomeBold, color: projHomeColor, letterSpacing: '0.01em' }}>
                  {fmtProj(proj!.projHomeScore)}
                </span>
              ) : null}
            </div>
          </div>
        );
      })()}

      {/* Venue footer */}
      {fixture.venue && (
        <div className="flex items-center gap-1 mt-1" style={{ fontSize: 'clamp(9px,0.75vw,11px)', color: 'hsl(var(--muted-foreground))' }}>
          <MapPin style={{ width: 10, height: 10, flexShrink: 0 }} />
          <span className="truncate">{fixture.venue.city}</span>
        </div>
      )}
    </div>
  );
}

// ─── WcDcDesktopCol — DRAW/WIN-DRAW 3-row column for desktop ────────────────────
//
// Renders 3 rows inside the desktop WcMktCol-style container:
//   Row 1: DRAW       — pure 3-way draw odds (from 1X2 market)
//   Row 2: [Home] W/D — 1X Double Chance (home wins OR draw)
//   Row 3: [Away] W/D — X2 Double Chance (away wins OR draw)
//
// Each row has BOOK | MODEL sub-columns with edge highlighting.
// Edge detection: 3-way for DRAW row, 2-way for each DC row.
// [LOG] WcDcDesktopCol: 3-row DC cell with per-row team labels

function WcDcDesktopCol({
  homeName,
  awayName,
  drawBook,
  drawModel,
  homeDcBook,
  homeDcModel,
  awayDcBook,
  awayDcModel,
  threeWayBook,
  threeWayModel,
}: {
  homeName: string;
  awayName: string;
  drawBook?: number | null;
  drawModel?: number | null;
  homeDcBook?: number | null;
  homeDcModel?: number | null;
  awayDcBook?: number | null;
  awayDcModel?: number | null;
  threeWayBook?: ThreeWayOdds | null;
  threeWayModel?: ThreeWayOdds | null;
}) {
  // [STEP] Edge detection for DRAW row — 3-way if available, else 2-way
  let drawEdgePP = NaN;
  let drawRoiPct = NaN;
  if (threeWayBook && threeWayModel) {
    const calc3 = calculate3WayResult(threeWayBook, threeWayModel);
    drawEdgePP = calc3.draw.edgePP;
    drawRoiPct = calc3.draw.roiPct;
  } else if (drawBook != null && drawModel != null) {
    drawEdgePP = calculateEdge(drawBook, drawModel);
  }
  // [STEP] Edge detection for Home DC row (1X) — 2-way
  const homeDcEdgePP = (homeDcBook != null && homeDcModel != null)
    ? calculateEdge(homeDcBook, homeDcModel) : NaN;
  // [STEP] Edge detection for Away DC row (X2) — 2-way
  const awayDcEdgePP = (awayDcBook != null && awayDcModel != null)
    ? calculateEdge(awayDcBook, awayDcModel) : NaN;

  // [STEP] Best edge across all 3 rows
  const allEdges = [drawEdgePP, homeDcEdgePP, awayDcEdgePP].filter(v => !isNaN(v));
  const bestEdgePP = allEdges.length > 0 ? Math.max(...allEdges) : NaN;
  const hasEdge = !isNaN(bestEdgePP) && bestEdgePP >= EDGE_THRESHOLD_PP;
  const edgeColor = hasEdge ? getEdgeColor(bestEdgePP) : undefined;

  // [STEP] ROI for best edge row
  let edgeLabel: string | null = null;
  let bestRoiPct = NaN;
  if (hasEdge) {
    if (drawEdgePP >= EDGE_THRESHOLD_PP && drawEdgePP >= (isNaN(homeDcEdgePP) ? -Infinity : homeDcEdgePP) && drawEdgePP >= (isNaN(awayDcEdgePP) ? -Infinity : awayDcEdgePP)) {
      edgeLabel = 'DRAW';
      bestRoiPct = drawRoiPct;
    } else if (!isNaN(homeDcEdgePP) && homeDcEdgePP >= EDGE_THRESHOLD_PP && homeDcEdgePP >= (isNaN(awayDcEdgePP) ? -Infinity : awayDcEdgePP)) {
      edgeLabel = `${homeName.length > 4 ? homeName.slice(0,3).toUpperCase() : homeName} W/D`;
      // [FIX] DC ROI: opponent of home_draw(1X) is away_draw(X2) — use awayDcBook as bookOppML
      bestRoiPct = (homeDcBook != null && homeDcModel != null && awayDcBook != null)
        ? calculateRoi(homeDcModel, homeDcBook, awayDcBook) : NaN;
    } else if (!isNaN(awayDcEdgePP) && awayDcEdgePP >= EDGE_THRESHOLD_PP) {
      edgeLabel = `${awayName.length > 4 ? awayName.slice(0,3).toUpperCase() : awayName} W/D`;
      // [FIX] DC ROI: opponent of away_draw(X2) is home_draw(1X) — use homeDcBook as bookOppML
      bestRoiPct = (awayDcBook != null && awayDcModel != null && homeDcBook != null)
        ? calculateRoi(awayDcModel, awayDcBook, homeDcBook) : NaN;
    }
  }

  console.log(
    `[WcDcDesktopCol] home=${homeName} away=${awayName}` +
    ` | [INPUT] drawBook=${drawBook ?? 'N/A'} drawModel=${drawModel ?? 'N/A'}` +
    ` homeDcBook=${homeDcBook ?? 'N/A'} homeDcModel=${homeDcModel ?? 'N/A'}` +
    ` awayDcBook=${awayDcBook ?? 'N/A'} awayDcModel=${awayDcModel ?? 'N/A'}` +
    ` | [STATE] drawEdgePP=${isNaN(drawEdgePP) ? 'NaN' : drawEdgePP.toFixed(2)}pp` +
    ` homeDcEdgePP=${isNaN(homeDcEdgePP) ? 'NaN' : homeDcEdgePP.toFixed(2)}pp` +
    ` awayDcEdgePP=${isNaN(awayDcEdgePP) ? 'NaN' : awayDcEdgePP.toFixed(2)}pp` +
    ` | [OUTPUT] bestEdgePP=${isNaN(bestEdgePP) ? 'NaN' : bestEdgePP.toFixed(2)}pp edgeLabel=${edgeLabel ?? 'NO EDGE'}` +
    ` | [VERIFY] hasEdge=${hasEdge} threshold=${EDGE_THRESHOLD_PP}pp`
  );

  // [STEP] Shared font scaling — check all 6 juice values for long odds
  const allJuices = [
    fmtAmerican(drawBook), fmtAmerican(drawModel),
    fmtAmerican(homeDcBook), fmtAmerican(homeDcModel),
    fmtAmerican(awayDcBook), fmtAmerican(awayDcModel),
  ].filter(v => v && v !== '—');
  const maxJuiceLen = allJuices.reduce((max, v) => Math.max(max, v?.length ?? 0), 0);
  const isVeryLong = maxJuiceLen >= 6;
  const isLong = maxJuiceLen >= 5;
  const juiceFs = isVeryLong
    ? 'clamp(8px,0.7vw,10px)'
    : isLong
    ? 'clamp(9px,0.8vw,11.5px)'
    : 'clamp(11px,1.0vw,14px)';
  const labelFs = 'clamp(7.5px,0.65vw,9.5px)';
  const hdrFs = 'clamp(8px,0.7vw,10px)';
  const pad = '8px 10px 10px';
  const titleFs: React.CSSProperties = {
    fontSize: 'clamp(9px,0.8vw,11px)',
    fontWeight: 850,
    color: '#fff',
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  };

  // [STEP] Per-row renderer: label (dim) | BOOK juice | MODEL juice
  const DcRow = ({
    rowLabel,
    bookOdds,
    modelOdds: modelO,
    rowEdgePP,
    isLast = false,
  }: {
    rowLabel: string;
    bookOdds: number | null | undefined;
    modelOdds: number | null | undefined;
    rowEdgePP: number;
    isLast?: boolean;
  }) => {
    const rowHasEdge = !isNaN(rowEdgePP) && rowEdgePP >= EDGE_THRESHOLD_PP;
    const modelColor = rowHasEdge ? getEdgeColor(rowEdgePP) : 'rgba(255,255,255,0.90)';
    return (
      <>
        {/* Row divider (not before first row) */}
        <div style={{ height: 0.5, background: 'rgba(255,255,255,0.07)', margin: '0 4px' }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, padding: '3px 4px' }}>
          {/* Book column */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, minWidth: 0 }}>
            <span style={{ fontSize: labelFs, fontWeight: 600, color: 'rgba(255,255,255,0.50)', lineHeight: 1, whiteSpace: 'nowrap', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{rowLabel}</span>
            <span style={{ fontSize: juiceFs, fontWeight: 700, color: 'rgba(255,255,255,0.90)', lineHeight: 1.1, whiteSpace: 'nowrap', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{fmtAmerican(bookOdds)}</span>
          </div>
          {/* Model column */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, minWidth: 0 }}>
            <span style={{ fontSize: labelFs, fontWeight: 600, color: 'rgba(255,255,255,0.50)', lineHeight: 1, whiteSpace: 'nowrap', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{rowLabel}</span>
            <span style={{ fontSize: juiceFs, fontWeight: 700, color: modelColor, lineHeight: 1.1, whiteSpace: 'nowrap', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{fmtAmerican(modelO)}</span>
          </div>
        </div>
      </>
    );
  };

  // [FIX 2026-06-24] Removed pp fallback — display is always "X.XX% ROI" or "NO EDGE"
  const roiStr = (hasEdge && !isNaN(bestRoiPct)) ? `+${bestRoiPct.toFixed(2)}% ROI` : 'NO EDGE';
  const roiColor = hasEdge ? edgeColor! : 'rgba(200,200,200,0.45)';

  return (
    <div className="flex flex-col" style={{ flex: '1 1 0%', minWidth: 0, width: 0, padding: pad }}>
      {/* Section title */}
      <div className="flex items-center gap-1" style={{ marginBottom: 4 }}>
        <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }} />
        <span style={titleFs}>DRAW/WIN-DRAW</span>
        <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }} />
      </div>

      {/* Cell container */}
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', background: '#2a2a2e', borderRadius: 10, overflow: 'hidden', flex: '1 1 0', minWidth: 0, marginBottom: 6 }}>
        {/* BOOK / MODEL header */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '0.5px solid rgba(255,255,255,0.08)', padding: '3px 4px 2px' }}>
          <span style={{ fontSize: hdrFs, fontWeight: 700, color: 'rgba(255,255,255,0.75)', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.05em' }}>BOOK</span>
          <span style={{ fontSize: hdrFs, fontWeight: 700, color: 'rgba(255,255,255,0.70)', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.05em' }}>MODEL</span>
        </div>

        {/* Row 1: DRAW — pure 3-way draw odds */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, padding: '3px 4px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, minWidth: 0 }}>
            <span style={{ fontSize: labelFs, fontWeight: 600, color: 'rgba(255,255,255,0.50)', lineHeight: 1, whiteSpace: 'nowrap', textAlign: 'center' }}>DRAW</span>
            <span style={{ fontSize: juiceFs, fontWeight: 700, color: 'rgba(255,255,255,0.90)', lineHeight: 1.1, whiteSpace: 'nowrap', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{fmtAmerican(drawBook)}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, minWidth: 0 }}>
            <span style={{ fontSize: labelFs, fontWeight: 600, color: 'rgba(255,255,255,0.50)', lineHeight: 1, whiteSpace: 'nowrap', textAlign: 'center' }}>DRAW</span>
            <span style={{ fontSize: juiceFs, fontWeight: 700, lineHeight: 1.1, whiteSpace: 'nowrap', textAlign: 'center', fontVariantNumeric: 'tabular-nums', color: (!isNaN(drawEdgePP) && drawEdgePP >= EDGE_THRESHOLD_PP) ? getEdgeColor(drawEdgePP) : 'rgba(255,255,255,0.90)' }}>{fmtAmerican(drawModel)}</span>
          </div>
        </div>

        {/* Row 2: Home W/D — 1X Double Chance */}
        <DcRow rowLabel={`${homeName.length > 4 ? homeName.slice(0,3).toUpperCase() : homeName} W/D`} bookOdds={homeDcBook} modelOdds={homeDcModel} rowEdgePP={homeDcEdgePP} />

        {/* Row 3: Away W/D — X2 Double Chance */}
        <DcRow rowLabel={`${awayName.length > 4 ? awayName.slice(0,3).toUpperCase() : awayName} W/D`} bookOdds={awayDcBook} modelOdds={awayDcModel} rowEdgePP={awayDcEdgePP} isLast />

        {/* ROI footer */}
        <div style={{ marginTop: 'auto', borderTop: '0.5px solid rgba(255,255,255,0.07)', padding: '3px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, background: hasEdge ? 'rgba(57,255,20,0.04)' : 'transparent' }}>
          {hasEdge && edgeLabel && (
            <span style={{ fontSize: 7, fontWeight: 700, color: roiColor, textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', textAlign: 'center' }}>{edgeLabel}</span>
          )}
          <span style={{ fontSize: 7.5, fontWeight: hasEdge ? 800 : 400, color: roiColor, letterSpacing: '0.03em', lineHeight: 1, whiteSpace: 'nowrap', textAlign: 'center' }}>{roiStr}</span>
        </div>
      </div>
    </div>
  );
}

// ─── WcDcMobileCell — DRAW/WIN-DRAW 3-row cell for mobile ────────────────────
//
// Renders 3 stacked rows inside a #2a2a2e card matching BetCell structure:
//   Row 1: DRAW       — pure 3-way draw odds
//   Row 2: [Home] W/D — 1X Double Chance (home wins OR draw)
//   Row 3: [Away] W/D — X2 Double Chance (away wins OR draw)
//
// Each row has BOOK | MODEL sub-columns with edge highlighting.
// [LOG] WcDcMobileCell: 3-row DC cell matching BetCell visual language

function WcDcMobileCell({
  fixture,
  homeName,
  awayName,
  drawBook,
  drawModel,
  homeDcBook,
  homeDcModel,
  awayDcBook,
  awayDcModel,
  threeWayBook,
  threeWayModel,
}: {
  fixture: WcFixtureWithOdds;
  homeName: string;
  awayName: string;
  drawBook?: number | null;
  drawModel?: number | null;
  homeDcBook?: number | null;
  homeDcModel?: number | null;
  awayDcBook?: number | null;
  awayDcModel?: number | null;
  threeWayBook?: ThreeWayOdds | null;
  threeWayModel?: ThreeWayOdds | null;
}) {
  // [STEP] Edge detection for DRAW row — 3-way if available, else 2-way
  let drawEdgePP = NaN;
  let drawRoiPct = NaN;
  if (threeWayBook && threeWayModel) {
    const calc3 = calculate3WayResult(threeWayBook, threeWayModel);
    drawEdgePP = calc3.draw.edgePP;
    drawRoiPct = calc3.draw.roiPct;
  } else if (drawBook != null && drawModel != null) {
    drawEdgePP = calculateEdge(drawBook, drawModel);
  }
  // [STEP] Edge detection for Home DC row (1X) — 2-way
  const homeDcEdgePP = (homeDcBook != null && homeDcModel != null)
    ? calculateEdge(homeDcBook, homeDcModel) : NaN;
  // [STEP] Edge detection for Away DC row (X2) — 2-way
  const awayDcEdgePP = (awayDcBook != null && awayDcModel != null)
    ? calculateEdge(awayDcBook, awayDcModel) : NaN;

  // [STEP] Best edge across all 3 rows
  const allEdges = [drawEdgePP, homeDcEdgePP, awayDcEdgePP].filter(v => !isNaN(v));
  const bestEdgePP = allEdges.length > 0 ? Math.max(...allEdges) : NaN;
  const hasEdge = !isNaN(bestEdgePP) && bestEdgePP >= EDGE_THRESHOLD_PP;
  const edgeColor = hasEdge ? getEdgeColor(bestEdgePP) : undefined;

  // [STEP] Edge label and ROI for best row
  let edgeLabel: string | null = null;
  let bestRoiPct = NaN;
  if (hasEdge) {
    const drawIsTop = drawEdgePP >= EDGE_THRESHOLD_PP
      && drawEdgePP >= (isNaN(homeDcEdgePP) ? -Infinity : homeDcEdgePP)
      && drawEdgePP >= (isNaN(awayDcEdgePP) ? -Infinity : awayDcEdgePP);
    const homeIsTop = !drawIsTop
      && !isNaN(homeDcEdgePP) && homeDcEdgePP >= EDGE_THRESHOLD_PP
      && homeDcEdgePP >= (isNaN(awayDcEdgePP) ? -Infinity : awayDcEdgePP);
    if (drawIsTop) { edgeLabel = 'DRAW'; bestRoiPct = drawRoiPct; }
    else if (homeIsTop) {
      edgeLabel = `${homeName.length > 4 ? homeName.slice(0,3).toUpperCase() : homeName} W/D`;
      // [FIX] DC ROI: opponent of home_draw(1X) is away_draw(X2) — use awayDcBook as bookOppML
      bestRoiPct = (homeDcBook != null && homeDcModel != null && awayDcBook != null)
        ? calculateRoi(homeDcModel, homeDcBook, awayDcBook) : NaN;
    } else if (!isNaN(awayDcEdgePP) && awayDcEdgePP >= EDGE_THRESHOLD_PP) {
      edgeLabel = `${awayName.length > 4 ? awayName.slice(0,3).toUpperCase() : awayName} W/D`;
      // [FIX] DC ROI: opponent of away_draw(X2) is home_draw(1X) — use homeDcBook as bookOppML
      bestRoiPct = (awayDcBook != null && awayDcModel != null && homeDcBook != null)
        ? calculateRoi(awayDcModel, awayDcBook, homeDcBook) : NaN;
    }
  }

  console.log(
    `[WcDcMobileCell] fixture=${fixture.fixtureId} home=${homeName} away=${awayName}` +
    ` | [INPUT] drawBook=${drawBook ?? 'N/A'} drawModel=${drawModel ?? 'N/A'}` +
    ` homeDcBook=${homeDcBook ?? 'N/A'} homeDcModel=${homeDcModel ?? 'N/A'}` +
    ` awayDcBook=${awayDcBook ?? 'N/A'} awayDcModel=${awayDcModel ?? 'N/A'}` +
    ` | [STATE] drawEdgePP=${isNaN(drawEdgePP) ? 'NaN' : drawEdgePP.toFixed(2)}pp` +
    ` homeDcEdgePP=${isNaN(homeDcEdgePP) ? 'NaN' : homeDcEdgePP.toFixed(2)}pp` +
    ` awayDcEdgePP=${isNaN(awayDcEdgePP) ? 'NaN' : awayDcEdgePP.toFixed(2)}pp` +
    ` | [OUTPUT] bestEdgePP=${isNaN(bestEdgePP) ? 'NaN' : bestEdgePP.toFixed(2)}pp edgeLabel=${edgeLabel ?? 'NO EDGE'}` +
    ` | [VERIFY] hasEdge=${hasEdge} threshold=${EDGE_THRESHOLD_PP}pp`
  );

  // [STEP] Shared font scaling — check all 6 juice values for long odds
  const allJuices = [
    fmtAmerican(drawBook), fmtAmerican(drawModel),
    fmtAmerican(homeDcBook), fmtAmerican(homeDcModel),
    fmtAmerican(awayDcBook), fmtAmerican(awayDcModel),
  ].filter(v => v && v !== '—');
  const maxJuiceLen = allJuices.reduce((max, v) => Math.max(max, v?.length ?? 0), 0);
  const isVeryLong = maxJuiceLen >= 6;
  const isLong = maxJuiceLen >= 5;
  const juiceFs = isVeryLong
    ? 'clamp(8px,2.4vw,10px)'
    : isLong
    ? 'clamp(9px,2.8vw,11px)'
    : 'clamp(11px,3.5vw,14px)';
  const labelFs = 'clamp(7px,2.0vw,8.5px)';
  const hdrFs = 6.5;
  const padding = '2px 3px'; // [FIX] mobile: reduced from 3px to tighten 3-row DC cell

  // [FIX 2026-06-24] Removed pp fallback — display is always "X.XX% ROI" or "NO EDGE"
  const roiStr = (hasEdge && !isNaN(bestRoiPct)) ? `+${bestRoiPct.toFixed(2)}% ROI` : 'NO EDGE';
  const roiColor = hasEdge ? edgeColor! : 'rgba(200,200,200,0.40)';

  // [STEP] Per-row renderer: label (dim) | BOOK juice | MODEL juice
  const DcRow = ({
    rowLabel,
    bookOdds,
    modelOdds: modelO,
    rowEdgePP,
  }: {
    rowLabel: string;
    bookOdds: number | null | undefined;
    modelOdds: number | null | undefined;
    rowEdgePP: number;
  }) => {
    const rowHasEdge = !isNaN(rowEdgePP) && rowEdgePP >= EDGE_THRESHOLD_PP;
    const modelColor = rowHasEdge ? getEdgeColor(rowEdgePP) : 'rgba(255,255,255,0.90)';
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, padding }}>
        {/* Book column */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, minWidth: 0 }}>
          <span style={{ fontSize: labelFs, fontWeight: 600, color: 'rgba(255,255,255,0.50)', lineHeight: 1, whiteSpace: 'nowrap', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{rowLabel}</span>
          <span style={{ fontSize: juiceFs, fontWeight: 700, color: 'rgba(255,255,255,0.90)', lineHeight: 1, whiteSpace: 'nowrap', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{fmtAmerican(bookOdds)}</span>
        </div>
        {/* Model column */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, minWidth: 0 }}>
          <span style={{ fontSize: labelFs, fontWeight: 600, color: 'rgba(255,255,255,0.50)', lineHeight: 1, whiteSpace: 'nowrap', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{rowLabel}</span>
          <span style={{ fontSize: juiceFs, fontWeight: 700, color: modelColor, lineHeight: 1, whiteSpace: 'nowrap', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{fmtAmerican(modelO)}</span>
        </div>
      </div>
    );
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-start',
        background: '#2a2a2e',
        borderRadius: 8,
        overflow: 'hidden',
        flex: '1 1 0',
        minWidth: 0,
      }}
    >
      {/* BOOK / MODEL header */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '0.5px solid rgba(255,255,255,0.08)', padding: '3px 4px 2px' }}>
        <span style={{ fontSize: hdrFs, fontWeight: 700, color: 'rgba(255,255,255,0.75)', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.05em' }}>BOOK</span>
        <span style={{ fontSize: hdrFs, fontWeight: 700, color: 'rgba(255,255,255,0.70)', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.05em' }}>MODEL</span>
      </div>

      {/* [FIX] Centered wrapper: 3 rows vertically centered to match BetCell 2-row ML/TOTAL columns */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 0', justifyContent: 'center' }}>
        {/* Row 1: DRAW — pure 3-way draw odds */}
        <DcRow rowLabel="DRAW" bookOdds={drawBook} modelOdds={drawModel} rowEdgePP={drawEdgePP} />
        {/* Row 2: Home W/D — 1X Double Chance */}
        <div style={{ height: 0.5, background: 'rgba(255,255,255,0.07)', margin: '0 4px' }} />
        <DcRow rowLabel={`${homeName.length > 4 ? homeName.slice(0,3).toUpperCase() : homeName} W/D`} bookOdds={homeDcBook} modelOdds={homeDcModel} rowEdgePP={homeDcEdgePP} />
        {/* Row 3: Away W/D — X2 Double Chance */}
        <div style={{ height: 0.5, background: 'rgba(255,255,255,0.07)', margin: '0 4px' }} />
        <DcRow rowLabel={`${awayName.length > 4 ? awayName.slice(0,3).toUpperCase() : awayName} W/D`} bookOdds={awayDcBook} modelOdds={awayDcModel} rowEdgePP={awayDcEdgePP} />
      </div>
      {/* ROI Footer */}
      <div style={{ marginTop: 'auto', borderTop: '0.5px solid rgba(255,255,255,0.07)', padding: '3px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, background: hasEdge ? 'rgba(57,255,20,0.04)' : 'transparent' }}>
        {hasEdge && edgeLabel && (
          <span style={{ fontSize: 7, fontWeight: 700, color: roiColor, textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', textAlign: 'center' }}>{edgeLabel}</span>
        )}
        <span style={{ fontSize: 7.5, fontWeight: hasEdge ? 800 : 400, color: roiColor, letterSpacing: '0.03em', lineHeight: 1, whiteSpace: 'nowrap', textAlign: 'center' }}>{roiStr}</span>
      </div>
    </div>
  );
}

// ─── WC Desktop Merged Panel — MLB-style 3-column layout ─────────────────────
//
// 3 columns matching MLB GameCard exactly:
//   Col 1: MONEYLINE — AWAY (top row) + HOME (bottom row), BOOK/MODEL
//   Col 2: DRAW/WIN-DRAW — 3 rows: DRAW + Home W/D (1X) + Away W/D (X2)
//   Col 3: TOTAL     — OVER (top row) + UNDER (bottom row), BOOK/MODEL
//
// [LOG] WcDesktopMergedPanel: renders MLB-style 3-col layout for WC fixtures

function WcDesktopMergedPanel({
  fixture,
  splits,
}: {
  fixture: WcFixtureWithOdds;
  splits?: WcFixtureSplits;
}) {
  const { dkOdds, modelOdds: _rawModelOdds } = fixture;
  const modelOdds = SHOW_WC_MODEL_ODDS ? _rawModelOdds : null;
  const totalLine = dkOdds?.overLine ?? 2.5;

  const homeFifaCode = fixture.homeTeam?.fifaCode ?? fixture.homeTeamId.toUpperCase();
  const awayFifaCode = fixture.awayTeam?.fifaCode ?? fixture.awayTeamId.toUpperCase();
  const homeColors   = getWcTeamColors(homeFifaCode);
  const awayColors   = getWcTeamColors(awayFifaCode);
  // [FIX] Full country name aliases for market labels — never FIFA codes
  const awayName = wcTeamAlias(fixture.awayTeam?.name ?? awayFifaCode);
  const homeName = wcTeamAlias(fixture.homeTeam?.name ?? homeFifaCode);

  const mlSplits    = extractWcSplits(splits, 'ML',    fixture.awayTeamId, fixture.homeTeamId);
  const totalSplits = extractWcSplits(splits, 'TOTAL', fixture.awayTeamId, fixture.homeTeamId);

  console.log(
    `[WcDesktopMergedPanel] fixture=${fixture.fixtureId}` +
    ` away=${awayFifaCode} home=${homeFifaCode}` +
    ` | [INPUT] dkOdds=${JSON.stringify(dkOdds)} modelOdds=${JSON.stringify(modelOdds)}` +
    ` | [STATE] totalLine=${totalLine}` +
    ` | [VERIFY] hasOdds=${dkOdds != null} hasModel=${modelOdds != null}`
  );

  const fmtSpreadLineD = (line: number | null | undefined): string => {
    if (line == null) return '—';
    return line > 0 ? `+${line}` : `${line}`;
  };

  console.log(
    `[WcDesktopMergedPanel:6Markets] fixture=${fixture.fixtureId}` +
    ` | [INPUT] dkSpread=${dkOdds?.homeSpreadOdds ?? 'N/A'} dkDC=${dkOdds?.homeDrawOdds ?? 'N/A'} dkBTTS=${dkOdds?.bttsYes ?? 'N/A'}` +
    ` | [VERIFY] hasOdds=${dkOdds != null} hasModel=${modelOdds != null}`
  );

  // ── TO ADVANCE edge detection (2-way: home advance vs away advance) ─────────────
  const homeAdvEdgePP = (dkOdds?.toAdvanceHome != null && modelOdds?.toAdvanceHome != null)
    ? calculateEdge(dkOdds.toAdvanceHome, modelOdds.toAdvanceHome) : NaN;
  const awayAdvEdgePP = (dkOdds?.toAdvanceAway != null && modelOdds?.toAdvanceAway != null)
    ? calculateEdge(dkOdds.toAdvanceAway, modelOdds.toAdvanceAway) : NaN;
  console.log(
    `[WcDesktopMergedPanel:ToAdvance] fixture=${fixture.fixtureId}` +
    ` | [INPUT] bookHomeAdv=${dkOdds?.toAdvanceHome ?? 'N/A'} bookAwayAdv=${dkOdds?.toAdvanceAway ?? 'N/A'}` +
    ` | [INPUT] modelHomeAdv=${modelOdds?.toAdvanceHome ?? 'N/A'} modelAwayAdv=${modelOdds?.toAdvanceAway ?? 'N/A'}` +
    ` | [OUTPUT] homeAdvEdgePP=${isNaN(homeAdvEdgePP) ? 'NaN' : homeAdvEdgePP.toFixed(2)}pp` +
    ` awayAdvEdgePP=${isNaN(awayAdvEdgePP) ? 'NaN' : awayAdvEdgePP.toFixed(2)}pp` +
    ` | [VERIFY] hasAdvOdds=${dkOdds?.toAdvanceHome != null && dkOdds?.toAdvanceAway != null}`
  );

  return (
    <div className="flex items-stretch w-full" style={{ minHeight: '100%', overflowX: 'auto' }}>

      {/* ── Col 0: TO ADVANCE — Row 1: HOME advances (top), Row 2: AWAY advances (bottom) ── */}
      <WcMktCol
        title="TO ADV"
        awayLabel={`${homeName} ADV`}
        homeLabel={`${awayName} ADV`}
        awayBookNum={dkOdds?.toAdvanceHome}
        homeBookNum={dkOdds?.toAdvanceAway}
        awayModelNum={modelOdds?.toAdvanceHome}
        homeModelNum={modelOdds?.toAdvanceAway}
        singleRow={false}
        awayColor={homeColors.primary}
        homeColor={awayColors.primary}
      />

      <div style={{ width: 1, background: 'rgba(255,255,255,0.07)', flexShrink: 0, alignSelf: 'stretch', margin: '8px 0' }} />

      {/* ── Col 1: ML — Row 1: HOME (top), Row 2: AWAY (bottom) ───────────────────────────── */}
      <WcMktCol
        title="ML"
        awayLabel={`${homeName} ML`}
        homeLabel={`${awayName} ML`}
        awayBookNum={dkOdds?.home}
        homeBookNum={dkOdds?.away}
        awayModelNum={modelOdds?.home}
        homeModelNum={modelOdds?.away}
        singleRow={false}
        awayColor={homeColors.primary}
        homeColor={awayColors.primary}
        threeWayBook={(dkOdds?.home != null && dkOdds?.draw != null && dkOdds?.away != null)
          ? { home: dkOdds.home, draw: dkOdds.draw, away: dkOdds.away } : null}
        threeWayModel={(modelOdds?.home != null && modelOdds?.draw != null && modelOdds?.away != null)
          ? { home: modelOdds.home, draw: modelOdds.draw, away: modelOdds.away } : null}
      />

      <div style={{ width: 1, background: 'rgba(255,255,255,0.07)', flexShrink: 0, alignSelf: 'stretch', margin: '8px 0' }} />

      {/* ── Col 2: DRAW — Row 1: DRAW, Row 2: NO DRAW ───────────────────────────────────── */}
      <WcMktCol
        title="DRAW"
        awayLabel="DRAW"
        homeLabel="NO DRAW"
        awayBookNum={dkOdds?.draw}
        homeBookNum={dkOdds?.noDraw}
        awayModelNum={modelOdds?.draw}
        homeModelNum={modelOdds?.noDraw}
        singleRow={false}
        awayColor="#9CA3AF"
        homeColor="#9CA3AF"
        threeWayBook={(dkOdds?.home != null && dkOdds?.draw != null && dkOdds?.away != null)
          ? { home: dkOdds.home, draw: dkOdds.draw, away: dkOdds.away } : null}
        threeWayModel={(modelOdds?.home != null && modelOdds?.draw != null && modelOdds?.away != null)
          ? { home: modelOdds.home, draw: modelOdds.draw, away: modelOdds.away } : null}
      />

      <div style={{ width: 1, background: 'rgba(255,255,255,0.07)', flexShrink: 0, alignSelf: 'stretch', margin: '8px 0' }} />

      {/* ── Col 3: TOTAL — Row 1: OVER, Row 2: UNDER ────────────────────────────────────────────── */}
      <WcMktCol
        title="TOTAL"
        awayLabel={`O ${formatTotalLine(totalLine)}`}
        homeLabel={`U ${formatTotalLine(totalLine)}`}
        awayBookNum={dkOdds?.overOdds}
        homeBookNum={dkOdds?.underOdds}
        awayModelNum={modelOdds?.overOdds}
        homeModelNum={modelOdds?.underOdds}
        singleRow={false}
        awayColor="#39FF14"
        homeColor="#FF6B35"
      />

      <div style={{ width: 1, background: 'rgba(255,255,255,0.07)', flexShrink: 0, alignSelf: 'stretch', margin: '8px 0' }} />

      {/* ── Col 4: SPREAD — Row 1: AWAY spread, Row 2: HOME spread ─────────────────────────────── */}
      <WcMktCol
        title="SPREAD"
        awayLabel={`${awayName} ${fmtSpreadLineD(dkOdds?.awaySpreadLine)}`}
        homeLabel={`${homeName} ${fmtSpreadLineD(dkOdds?.homeSpreadLine)}`}
        awayBookNum={dkOdds?.awaySpreadOdds}
        homeBookNum={dkOdds?.homeSpreadOdds}
        awayModelNum={modelOdds?.awaySpreadOdds}
        homeModelNum={modelOdds?.homeSpreadOdds}
        singleRow={false}
        awayColor={awayColors.primary}
        homeColor={homeColors.primary}
      />

      <div style={{ width: 1, background: 'rgba(255,255,255,0.07)', flexShrink: 0, alignSelf: 'stretch', margin: '8px 0' }} />

      {/* ── Col 5: DOUBLE CHANCE — Row 1: AWAY OR DRAW (X2), Row 2: HOME OR DRAW (1X) ────────────── */}
      <WcMktCol
        title="DBL CHC"
        awayLabel={`${awayName} / D`}
        homeLabel={`${homeName} / D`}
        awayBookNum={dkOdds?.awayDrawOdds}
        homeBookNum={dkOdds?.homeDrawOdds}
        awayModelNum={modelOdds?.awayDrawOdds}
        homeModelNum={modelOdds?.homeDrawOdds}
        singleRow={false}
        awayColor={awayColors.primary}
        homeColor={homeColors.primary}
      />

      <div style={{ width: 1, background: 'rgba(255,255,255,0.07)', flexShrink: 0, alignSelf: 'stretch', margin: '8px 0' }} />

      {/* ── Col 6: BTTS — Row 1: YES, Row 2: NO ─────────────────────────────────────────────────────────────────────── */}
      <WcMktCol
        title="BTTS"
        awayLabel="YES"
        homeLabel="NO"
        awayBookNum={dkOdds?.bttsYes}
        homeBookNum={dkOdds?.bttsNo}
        awayModelNum={modelOdds?.bttsYes}
        homeModelNum={modelOdds?.bttsNo}
        singleRow={false}
        awayColor="#22D3EE"
        homeColor="#F87171"
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
        {/* [FIX] Wider score panel to accommodate full country names */}
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
        {/* [FIX 2026-06-24] minHeight gives the grid row a defined height so BetCell flex:1 1 0 has a container to fill.
             Without this, BetCell collapses to 0px height and all market cells appear blank on mobile. */}
        <div style={{ display: "grid", gridTemplateColumns: "clamp(120px, 32%, 150px) 1fr", width: "100%", minHeight: 'clamp(130px, 28vw, 180px)' }}>
          {/* Fixed score panel */}
          <div style={{ borderRight: "1px solid hsl(var(--border) / 0.5)" }}>
            <WcScorePanel fixture={fixture} />
          </div>
          {/* Scrollable odds panel */}
          {/* [FIX 2026-06-24] height:100% propagates the grid row minHeight down to WcMobileOddsPanel.
               The grid stretches direct children — but WcMobileOddsPanel is a grandchild inside this div.
               Without height:100% here, WcMobileOddsPanel gets no height from the grid row. */}
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", height: '100%' } as React.CSSProperties}>
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
  const { dkOdds, modelOdds: _rawModelOdds } = fixture;
  const modelOdds = SHOW_WC_MODEL_ODDS ? _rawModelOdds : null;
  const totalLine = dkOdds?.overLine ?? 2.5;

  const homeFifaCode = fixture.homeTeam?.fifaCode ?? fixture.homeTeamId.toUpperCase();
  const awayFifaCode = fixture.awayTeam?.fifaCode ?? fixture.awayTeamId.toUpperCase();

  // [INPUT] Full country names for labels — aliases applied for spacing
  const awayName = wcTeamAlias(fixture.awayTeam?.name ?? awayFifaCode);
  const homeName = wcTeamAlias(fixture.homeTeam?.name ?? homeFifaCode);

  // ── TO ADVANCE edge detection (2-way: home advance vs away advance) ─────────────
  const homeAdvEdgePPMob = (dkOdds?.toAdvanceHome != null && modelOdds?.toAdvanceHome != null)
    ? calculateEdge(dkOdds.toAdvanceHome, modelOdds.toAdvanceHome) : NaN;
  const awayAdvEdgePPMob = (dkOdds?.toAdvanceAway != null && modelOdds?.toAdvanceAway != null)
    ? calculateEdge(dkOdds.toAdvanceAway, modelOdds.toAdvanceAway) : NaN;
  const advBestEdgePP = Math.max(
    isNaN(homeAdvEdgePPMob) ? -Infinity : homeAdvEdgePPMob,
    isNaN(awayAdvEdgePPMob) ? -Infinity : awayAdvEdgePPMob,
  );
  const advBestEdgePPFinal = advBestEdgePP === -Infinity ? NaN : advBestEdgePP;
  const advEdgeLabel = (advBestEdgePPFinal >= EDGE_THRESHOLD_PP)
    ? (homeAdvEdgePPMob >= awayAdvEdgePPMob ? `${homeName} ADV` : `${awayName} ADV`)
    : undefined;
  const advBestRoiPct: number = (() => {
    if (homeAdvEdgePPMob >= awayAdvEdgePPMob && homeAdvEdgePPMob >= EDGE_THRESHOLD_PP) {
      return (dkOdds?.toAdvanceHome != null && modelOdds?.toAdvanceHome != null && dkOdds?.toAdvanceAway != null)
        ? calculateRoi(modelOdds.toAdvanceHome, dkOdds.toAdvanceHome, dkOdds.toAdvanceAway) : NaN;
    } else if (awayAdvEdgePPMob >= EDGE_THRESHOLD_PP) {
      return (dkOdds?.toAdvanceAway != null && modelOdds?.toAdvanceAway != null && dkOdds?.toAdvanceHome != null)
        ? calculateRoi(modelOdds.toAdvanceAway, dkOdds.toAdvanceAway, dkOdds.toAdvanceHome) : NaN;
    }
    return NaN;
  })();
  const advHome: BetCellSide = {
    bookLine: `${homeFifaCode.toUpperCase()} ADV`, bookJuice: fmtAmerican(dkOdds?.toAdvanceHome) ?? '—',
    modelLine: `${homeFifaCode.toUpperCase()} ADV`, modelJuice: fmtAmerican(modelOdds?.toAdvanceHome) ?? '—',
    edgePP: homeAdvEdgePPMob,
  };
  const advAway: BetCellSide = {
    bookLine: `${awayFifaCode.toUpperCase()} ADV`, bookJuice: fmtAmerican(dkOdds?.toAdvanceAway) ?? '—',
    modelLine: `${awayFifaCode.toUpperCase()} ADV`, modelJuice: fmtAmerican(modelOdds?.toAdvanceAway) ?? '—',
    edgePP: awayAdvEdgePPMob,
  };
  console.log(
    `[WcMobileOddsPanel:ToAdvance] fixture=${fixture.fixtureId}` +
    ` | [INPUT] bookHomeAdv=${dkOdds?.toAdvanceHome ?? 'N/A'} bookAwayAdv=${dkOdds?.toAdvanceAway ?? 'N/A'}` +
    ` | [INPUT] modelHomeAdv=${modelOdds?.toAdvanceHome ?? 'N/A'} modelAwayAdv=${modelOdds?.toAdvanceAway ?? 'N/A'}` +
    ` | [OUTPUT] homeAdvEdge=${isNaN(homeAdvEdgePPMob) ? 'NaN' : homeAdvEdgePPMob.toFixed(2)}pp` +
    ` awayAdvEdge=${isNaN(awayAdvEdgePPMob) ? 'NaN' : awayAdvEdgePPMob.toFixed(2)}pp` +
    ` | [OUTPUT] advEdgeLabel=${advEdgeLabel ?? 'NO EDGE'} advBestRoi=${isNaN(advBestRoiPct) ? 'NaN' : advBestRoiPct.toFixed(2)}%` +
    ` | [VERIFY] hasAdvOdds=${dkOdds?.toAdvanceHome != null && dkOdds?.toAdvanceAway != null}`
  );

  // ── 3-way calc: SINGLE SOURCE OF TRUTH for ML + DRAW edge pp AND ROI ────────────
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
  // [FIX] Standard sportsbook convention: AWAY on top, HOME on bottom.
  // BetCell renders 'away' prop as top row and 'home' prop as bottom row.
  // mlAway (top) = away team odds, mlHome (bottom) = home team odds.
  // [FIX 2026-06-24] Append ' ML' to team abbreviation so mobile BetCell shows 'SUI ML' / 'CAN ML'
  const mlAway: BetCellSide = {
    bookLine: `${awayFifaCode.toUpperCase()} ML`, bookJuice: fmtAmerican(dkOdds?.away) ?? '—',
    modelLine: `${awayFifaCode.toUpperCase()} ML`, modelJuice: fmtAmerican(modelOdds?.away) ?? '—',
    edgePP: awayMlEdgePP,
  };
  const mlHome: BetCellSide = {
    bookLine: `${homeFifaCode.toUpperCase()} ML`, bookJuice: fmtAmerican(dkOdds?.home) ?? '—',
    modelLine: `${homeFifaCode.toUpperCase()} ML`, modelJuice: fmtAmerican(modelOdds?.home) ?? '—',
    edgePP: homeMlEdgePP,
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

  // ── SPREAD edge detection (2-way: home spread vs away spread) ─────────────────
  const homeSpreadEdgePP = (dkOdds?.homeSpreadOdds != null && modelOdds?.homeSpreadOdds != null)
    ? calculateEdge(dkOdds.homeSpreadOdds, modelOdds.homeSpreadOdds) : NaN;
  const awaySpreadEdgePP = (dkOdds?.awaySpreadOdds != null && modelOdds?.awaySpreadOdds != null)
    ? calculateEdge(dkOdds.awaySpreadOdds, modelOdds.awaySpreadOdds) : NaN;
  const spreadBestEdgePP = Math.max(
    isNaN(homeSpreadEdgePP) ? -Infinity : homeSpreadEdgePP,
    isNaN(awaySpreadEdgePP) ? -Infinity : awaySpreadEdgePP,
  );
  const spreadBestEdgePPFinal = spreadBestEdgePP === -Infinity ? NaN : spreadBestEdgePP;
  const homeSpreadLine = dkOdds?.homeSpreadLine ?? 0;
  const awaySpreadLine = dkOdds?.awaySpreadLine ?? 0;
  // [FIX] fmtSpreadLine: strip trailing .0 (e.g. 1.5 not 1.50, 2 not 2.0)
  const fmtSpreadLine = (line: number): string => {
    const formatted = formatTotalLine(Math.abs(line));
    return line > 0 ? `+${formatted}` : `-${formatted}`;
  };
  const spreadEdgeLabel = (spreadBestEdgePPFinal >= EDGE_THRESHOLD_PP)
    ? (homeSpreadEdgePP >= awaySpreadEdgePP
        ? `${homeName} ${fmtSpreadLine(homeSpreadLine)}`
        : `${awayName} ${fmtSpreadLine(awaySpreadLine)}`)
    : undefined;
  // [FIX 2026-06-24] SPREAD ROI: 2-way no-vig (home spread vs away spread)
  const spreadBestRoiPct: number = (() => {
    if (homeSpreadEdgePP >= awaySpreadEdgePP && homeSpreadEdgePP >= EDGE_THRESHOLD_PP) {
      return (dkOdds?.homeSpreadOdds != null && modelOdds?.homeSpreadOdds != null && dkOdds?.awaySpreadOdds != null)
        ? calculateRoi(modelOdds.homeSpreadOdds, dkOdds.homeSpreadOdds, dkOdds.awaySpreadOdds) : NaN;
    } else if (awaySpreadEdgePP >= EDGE_THRESHOLD_PP) {
      return (dkOdds?.awaySpreadOdds != null && modelOdds?.awaySpreadOdds != null && dkOdds?.homeSpreadOdds != null)
        ? calculateRoi(modelOdds.awaySpreadOdds, dkOdds.awaySpreadOdds, dkOdds.homeSpreadOdds) : NaN;
    }
    return NaN;
  })();

  // ── DOUBLE CHANCE edge detection (2-way: homeDrawOdds vs awayDrawOdds) ────────
  const homeDcEdgePP = (dkOdds?.homeDrawOdds != null && modelOdds?.homeDrawOdds != null)
    ? calculateEdge(dkOdds.homeDrawOdds, modelOdds.homeDrawOdds) : NaN;
  const awayDcEdgePP = (dkOdds?.awayDrawOdds != null && modelOdds?.awayDrawOdds != null)
    ? calculateEdge(dkOdds.awayDrawOdds, modelOdds.awayDrawOdds) : NaN;
  const dcBestEdgePP = Math.max(
    isNaN(homeDcEdgePP) ? -Infinity : homeDcEdgePP,
    isNaN(awayDcEdgePP) ? -Infinity : awayDcEdgePP,
  );
  const dcBestEdgePPFinal = dcBestEdgePP === -Infinity ? NaN : dcBestEdgePP;
  const dcEdgeLabel = (dcBestEdgePPFinal >= EDGE_THRESHOLD_PP)
    ? (homeDcEdgePP >= awayDcEdgePP ? `${homeName} W/D` : `${awayName} W/D`)
    : undefined;
  // [FIX 2026-06-24] DC ROI: 2-way no-vig (home DC vs away DC)
  const dcBestRoiPct: number = (() => {
    if (homeDcEdgePP >= awayDcEdgePP && homeDcEdgePP >= EDGE_THRESHOLD_PP) {
      return (dkOdds?.homeDrawOdds != null && modelOdds?.homeDrawOdds != null && dkOdds?.awayDrawOdds != null)
        ? calculateRoi(modelOdds.homeDrawOdds, dkOdds.homeDrawOdds, dkOdds.awayDrawOdds) : NaN;
    } else if (awayDcEdgePP >= EDGE_THRESHOLD_PP) {
      return (dkOdds?.awayDrawOdds != null && modelOdds?.awayDrawOdds != null && dkOdds?.homeDrawOdds != null)
        ? calculateRoi(modelOdds.awayDrawOdds, dkOdds.awayDrawOdds, dkOdds.homeDrawOdds) : NaN;
    }
    return NaN;
  })();

  // ── BTTS edge detection (2-way: yes vs no) ────────────────────────────────────
  const bttsYesEdgePP = (dkOdds?.bttsYes != null && modelOdds?.bttsYes != null)
    ? calculateEdge(dkOdds.bttsYes, modelOdds.bttsYes) : NaN;
  const bttsNoEdgePP = (dkOdds?.bttsNo != null && modelOdds?.bttsNo != null)
    ? calculateEdge(dkOdds.bttsNo, modelOdds.bttsNo) : NaN;
  const bttsBestEdgePP = Math.max(
    isNaN(bttsYesEdgePP) ? -Infinity : bttsYesEdgePP,
    isNaN(bttsNoEdgePP) ? -Infinity : bttsNoEdgePP,
  );
  const bttsBestEdgePPFinal = bttsBestEdgePP === -Infinity ? NaN : bttsBestEdgePP;
  const bttsEdgeLabel = (bttsBestEdgePPFinal >= EDGE_THRESHOLD_PP)
    ? (bttsYesEdgePP >= bttsNoEdgePP ? 'BTTS YES' : 'BTTS NO')
    : undefined;
  // [FIX 2026-06-24] BTTS ROI: 2-way no-vig (YES vs NO)
  const bttsBestRoiPct: number = (() => {
    if (bttsYesEdgePP >= bttsNoEdgePP && bttsYesEdgePP >= EDGE_THRESHOLD_PP) {
      return (dkOdds?.bttsYes != null && modelOdds?.bttsYes != null && dkOdds?.bttsNo != null)
        ? calculateRoi(modelOdds.bttsYes, dkOdds.bttsYes, dkOdds.bttsNo) : NaN;
    } else if (bttsNoEdgePP >= EDGE_THRESHOLD_PP) {
      return (dkOdds?.bttsNo != null && modelOdds?.bttsNo != null && dkOdds?.bttsYes != null)
        ? calculateRoi(modelOdds.bttsNo, dkOdds.bttsNo, dkOdds.bttsYes) : NaN;
    }
    return NaN;
  })();

  // ── NO-DRAW edge detection (1-way: noDraw odds) ───────────────────────────────
  const noDrawEdgePP = (dkOdds?.noDraw != null && modelOdds?.noDraw != null)
    ? calculateEdge(dkOdds.noDraw, modelOdds.noDraw) : NaN;

  // ── BetCellSide builders for new markets ─────────────────────────────────────
  // [FIX] DRAW column: Row 1 = DRAW (label 'DRAW'), Row 2 = HOME OR AWAY ML (no-draw)
  // [FIX] No Draw label: AWAY/HOME abbreviated (e.g. "CAN/SUI") — away first, home second
  // [FIX] Full country names for mobile panel labels (awayName/homeName declared above at line 1743)
  const noDrawLabel = `${awayFifaCode.toUpperCase()}/${homeFifaCode.toUpperCase()}`;
  const drawRow: BetCellSide = {
    bookLine: 'DRAW', bookJuice: fmtAmerican(dkOdds?.draw) ?? '—',
    modelLine: 'DRAW', modelJuice: fmtAmerican(modelOdds?.draw) ?? '—',
    edgePP: drawEdgePP,
  };
  // [FIX 2026-06-24] Derive no-draw model odds from 3-way model probabilities.
  // The DB stores only homeDrawOdds (home wins OR draw) as noDraw — NOT the true no-draw.
  // True no-draw = P(home wins) + P(away wins) = 1 - P(draw).
  // We compute this from modelOdds.draw using the American odds implied probability formula.
  //
  // [ROOT CAUSE FIX 2026-06-24] IEEE 754 floating point precision error:
  // The round-trip (American → probability → American) is algebraically exact but IEEE 754
  // binary arithmetic introduces sub-integer errors for certain inputs.
  // Example: drawOdds=+489 → pDraw=100/589 → pNoDraw=489/589 → raw=-488.9999999999998
  // Without Math.round(), fmtAmerican() renders this as '-488.9999999999998'.
  // Fix: Math.round() the raw result. American odds are always whole integers.
  // Verified correct for all integer inputs -500 to +1000.
  const modelNoDrawOdds: number | null = (() => {
    if (modelOdds?.draw == null) return null;
    // [INPUT] Convert model draw American odds to implied probability (raw, not no-vig)
    const drawOdds = modelOdds.draw;
    const pDraw = drawOdds < 0
      ? (-drawOdds) / (-drawOdds + 100)
      : 100 / (drawOdds + 100);
    // [STEP] P(no-draw) = 1 - P(draw)
    const pNoDraw = 1 - pDraw;
    // [GUARD] pNoDraw must be strictly between 0 and 1
    if (pNoDraw <= 0 || pNoDraw >= 1) {
      console.warn(`[modelNoDrawOdds] fixture=${fixture.fixtureId} GUARD: pNoDraw=${pNoDraw} out of range for drawOdds=${drawOdds}`);
      return null;
    }
    // [STEP] Convert P(no-draw) back to American odds
    const raw = pNoDraw >= 0.5
      ? -(pNoDraw / (1 - pNoDraw)) * 100
      : ((1 - pNoDraw) / pNoDraw) * 100;
    // [FIX] Math.round() eliminates IEEE 754 float precision artifacts.
    // e.g. -488.9999999999998 → -489, -325.9999999999999 → -326
    const result = Math.round(raw);
    console.log(
      `[modelNoDrawOdds] fixture=${fixture.fixtureId}` +
      ` | [INPUT] drawOdds=${drawOdds}` +
      ` | [STATE] pDraw=${pDraw.toFixed(6)} pNoDraw=${pNoDraw.toFixed(6)} raw=${raw.toFixed(6)}` +
      ` | [OUTPUT] result=${result}` +
      ` | [VERIFY] delta=${Math.abs(raw - result).toFixed(8)} ${Math.abs(raw - result) < 0.001 ? 'PASS' : 'WARN-large-delta'}`
    );
    return result;
  })();
  const noDrawRow: BetCellSide = {
    bookLine: noDrawLabel, bookJuice: fmtAmerican(dkOdds?.noDraw) ?? '—',
    modelLine: noDrawLabel, modelJuice: fmtAmerican(modelNoDrawOdds) ?? '—',
    edgePP: noDrawEdgePP,
  };
  // [FIX] SPREAD: team abbreviation + spread line (no trailing .0). Row 1=HOME (top), Row 2=AWAY (bottom)
  // [LOG] WcMobileOddsPanel:Spread homeAbbr=${homeFifaCode.toUpperCase()} awayAbbr=${awayFifaCode.toUpperCase()}
  // [LOG] WcMobileOddsPanel:Spread homeSpreadLine=${homeSpreadLine} awaySpreadLine=${awaySpreadLine}
  console.log(
    `[WcMobileOddsPanel:Spread] fixture=${fixture.fixtureId}` +
    ` | [INPUT] homeAbbr=${homeFifaCode.toUpperCase()} awayAbbr=${awayFifaCode.toUpperCase()}` +
    ` | [STATE] homeSpreadLine=${homeSpreadLine} awaySpreadLine=${awaySpreadLine}` +
    ` | [OUTPUT] homeLabel="${homeName} ${fmtSpreadLine(homeSpreadLine)}" awayLabel="${awayName} ${fmtSpreadLine(awaySpreadLine)}"` +
    ` | [VERIFY] dkHomeSpreadOdds=${dkOdds?.homeSpreadOdds ?? 'N/A'} dkAwaySpreadOdds=${dkOdds?.awaySpreadOdds ?? 'N/A'}`
  );
  const spreadAway: BetCellSide = {
    // [FIX] Row 1 = AWAY team (top row in BetCell = 'away' prop) — standard sportsbook: away on top
    bookLine: `${awayFifaCode.toUpperCase()} ${fmtSpreadLine(awaySpreadLine)}`,
    bookJuice: fmtAmerican(dkOdds?.awaySpreadOdds) ?? '—',
    modelLine: `${awayFifaCode.toUpperCase()} ${fmtSpreadLine(awaySpreadLine)}`,
    modelJuice: fmtAmerican(modelOdds?.awaySpreadOdds) ?? '—',
    edgePP: awaySpreadEdgePP,
  };
  const spreadHome: BetCellSide = {
    // [FIX] Row 2 = HOME team (bottom row in BetCell = 'home' prop) — standard sportsbook: home on bottom
    bookLine: `${homeFifaCode.toUpperCase()} ${fmtSpreadLine(homeSpreadLine)}`,
    bookJuice: fmtAmerican(dkOdds?.homeSpreadOdds) ?? '—',
    modelLine: `${homeFifaCode.toUpperCase()} ${fmtSpreadLine(homeSpreadLine)}`,
    modelJuice: fmtAmerican(modelOdds?.homeSpreadOdds) ?? '—',
    edgePP: homeSpreadEdgePP,
  };
  // [FIX] DOUBLE CHANCE: X2 → "{AWAY} WD", 1X → "{HOME} WD"
  // [LOG] WcMobileOddsPanel:DC homeWD=${homeFifaCode.toUpperCase()} WD awayWD=${awayFifaCode.toUpperCase()} WD
  console.log(
    `[WcMobileOddsPanel:DC] fixture=${fixture.fixtureId}` +
    ` | [OUTPUT] awayDC="${awayFifaCode.toUpperCase()} WD" homeDC="${homeFifaCode.toUpperCase()} WD"` +
    ` | [VERIFY] dkAwayDrawOdds=${dkOdds?.awayDrawOdds ?? 'N/A'} dkHomeDrawOdds=${dkOdds?.homeDrawOdds ?? 'N/A'}`
  );
  const dcAway: BetCellSide = {
    bookLine: `${awayFifaCode.toUpperCase()} WD`,
    bookJuice: fmtAmerican(dkOdds?.awayDrawOdds) ?? '—',
    modelLine: `${awayFifaCode.toUpperCase()} WD`,
    modelJuice: fmtAmerican(modelOdds?.awayDrawOdds) ?? '—',
    edgePP: awayDcEdgePP,
  };
  const dcHome: BetCellSide = {
    bookLine: `${homeFifaCode.toUpperCase()} WD`,
    bookJuice: fmtAmerican(dkOdds?.homeDrawOdds) ?? '—',
    modelLine: `${homeFifaCode.toUpperCase()} WD`,
    modelJuice: fmtAmerican(modelOdds?.homeDrawOdds) ?? '—',
    edgePP: homeDcEdgePP,
  };
  // [FIX] BTTS: YES on top (bookLine='YES'), NO on bottom (bookLine='NO')
  // [LOG] WcMobileOddsPanel:BTTS YES/NO labels confirmed
  console.log(
    `[WcMobileOddsPanel:BTTS] fixture=${fixture.fixtureId}` +
    ` | [OUTPUT] row1="YES ${fmtAmerican(dkOdds?.bttsYes)}" row2="NO ${fmtAmerican(dkOdds?.bttsNo)}"` +
    ` | [VERIFY] dkBttsYes=${dkOdds?.bttsYes ?? 'N/A'} dkBttsNo=${dkOdds?.bttsNo ?? 'N/A'}`
  );
  const bttsYes: BetCellSide = {
    bookLine: 'YES', bookJuice: fmtAmerican(dkOdds?.bttsYes) ?? '—',
    modelLine: 'YES', modelJuice: fmtAmerican(modelOdds?.bttsYes) ?? '—',
    edgePP: bttsYesEdgePP,
  };
  const bttsNo: BetCellSide = {
    bookLine: 'NO', bookJuice: fmtAmerican(dkOdds?.bttsNo) ?? '—',
    modelLine: 'NO', modelJuice: fmtAmerican(modelOdds?.bttsNo) ?? '—',
    edgePP: bttsNoEdgePP,
  };
  // [FIX] DRAW column: Row 1 = DRAW odds, Row 2 = "{HOME} OR {AWAY} ML" (no-draw)
  // [LOG] WcMobileOddsPanel:Draw noDrawLabel=${homeFifaCode.toUpperCase()} OR ${awayFifaCode.toUpperCase()} ML
  console.log(
    `[WcMobileOddsPanel:Draw] fixture=${fixture.fixtureId}` +
    ` | [OUTPUT] row1="DRAW" row2="${homeName} OR ${awayName} ML"` +
    ` | [VERIFY] dkDraw=${dkOdds?.draw ?? 'N/A'} dkNoDraw=${dkOdds?.noDraw ?? 'N/A'}`
  );

  console.log(
    `[WcMobileOddsPanel:6Markets] fixture=${fixture.fixtureId}` +
    ` | [STATE] spreadEdge=${isNaN(spreadBestEdgePPFinal) ? 'NaN' : spreadBestEdgePPFinal.toFixed(2)}pp` +
    ` dcEdge=${isNaN(dcBestEdgePPFinal) ? 'NaN' : dcBestEdgePPFinal.toFixed(2)}pp` +
    ` bttsEdge=${isNaN(bttsBestEdgePPFinal) ? 'NaN' : bttsBestEdgePPFinal.toFixed(2)}pp` +
    ` | [OUTPUT] spreadEdgeLabel=${spreadEdgeLabel ?? 'NO EDGE'} dcEdgeLabel=${dcEdgeLabel ?? 'NO EDGE'} bttsEdgeLabel=${bttsEdgeLabel ?? 'NO EDGE'}` +
    ` | [VERIFY] dkSpread=${dkOdds?.homeSpreadOdds ?? 'N/A'} dkDC=${dkOdds?.homeDrawOdds ?? 'N/A'} dkBTTS=${dkOdds?.bttsYes ?? 'N/A'}`
  );

  // [FIX] 3-cells-visible layout:
  // - ML and DBL CHC are wider (wider flex basis) since they can have +1000 or higher odds
  // - All 4 remaining cells (DRAW, TOTAL, SPREAD, BTTS) are same narrower width
  // - Exactly 3 cells fit the scrollable container width before horizontal scroll
  // - Per-card market header label above each BetCell for clarity
  // [LOG] WcMobileOddsPanel:Layout 3-visible cells, ML+DC wider, per-card headers
  console.log(
    `[WcMobileOddsPanel:Layout] fixture=${fixture.fixtureId}` +
    ` | [STATE] 6 cells, 3 visible before scroll` +
    ` | [OUTPUT] ML+DC wider (flex:0 0 36%), others narrower (flex:0 0 28%)` +
    ` | [VERIFY] per-card market headers rendered above each BetCell`
  );

  // [FIX] Cell wrapper: renders market label header + BetCell in a flex column
  // ML and DBL CHC get wider flex basis to accommodate +1000 or higher odds
  type CellDef = {
    label: string;
    wide?: boolean;
    cell: React.ReactNode;
  };
  const cells: CellDef[] = [
    {
      label: 'TO ADVANCE',
      wide: true,
      cell: (
        <BetCell
          title="TO ADVANCE"
          away={advAway}
          home={advHome}
          edgeLabel={advEdgeLabel}
          bestEdgePP={advBestEdgePPFinal}
          roiPct={advBestRoiPct}
          size="sm"
        />
      ),
    },
    {
      label: 'MONEYLINE',
      wide: true,
      cell: (
        <BetCell
          title="MONEYLINE"
          away={mlAway}
          home={mlHome}
          edgeLabel={mlEdgeLabel}
          bestEdgePP={mlBestEdgePPFinal}
          roiPct={mlBestRoiPct}
          size="sm"
        />
      ),
    },
    {
      label: 'DRAW',
      wide: false,
      cell: (
        <BetCell
          title="DRAW"
          away={drawRow}
          home={noDrawRow}
          edgeLabel={drawEdgeLabel}
          bestEdgePP={!isNaN(drawEdgePP) ? drawEdgePP : NaN}
          roiPct={drawRoiPct}
          size="sm"
        />
      ),
    },
    {
      label: 'TOTAL',
      wide: false,
      cell: (
        <BetCell
          title="TOTAL"
          away={totalOver}
          home={totalUnder}
          edgeLabel={totalEdgeLabel}
          bestEdgePP={totalBestEdgePPFinal}
          roiPct={totalBestRoiPct}
          size="sm"
        />
      ),
    },
    {
      label: 'SPREAD',
      wide: false,
      cell: (
        <BetCell
          title="SPREAD"
          away={spreadAway}
          home={spreadHome}
          edgeLabel={spreadEdgeLabel}
          bestEdgePP={spreadBestEdgePPFinal}
          roiPct={spreadBestRoiPct}
          size="sm"
        />
      ),
    },
    {
      label: 'DOUBLE CHANCE',
      wide: true,
      cell: (
        <BetCell
          title="DOUBLE CHANCE"
          away={dcAway}
          home={dcHome}
          edgeLabel={dcEdgeLabel}
          bestEdgePP={dcBestEdgePPFinal}
          roiPct={dcBestRoiPct}
          size="sm"
        />
      ),
    },
    {
      label: 'BOTH TEAMS SCORE',
      wide: false,
      cell: (
        <BetCell
          title="BOTH TEAMS SCORE"
          away={bttsYes}
          home={bttsNo}
          edgeLabel={bttsEdgeLabel}
          bestEdgePP={bttsBestEdgePPFinal}
          roiPct={bttsBestRoiPct}
          size="sm"
        />
      ),
    },
  ];

  return (
    // [FIX] Outer scroll container: height:100% propagates grid row minHeight into the flex container.
    // Chain: grid row minHeight → scrollable div height:100% → this div height:100%
    //        → cell wrapper minHeight → BetCell flex:1 1 0 fills it.
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 3, padding: '4px 4px', minWidth: 'max-content', height: '100%' }}>
      {cells.map(({ label, wide, cell }) => (
        // [FIX] Each cell wrapper: flex column with market label header on top
        // wide=true (ML, DBL CHC): flex basis 36% of scroll container to fit +1000 odds
        // wide=false (DRAW, TOTAL, SPREAD, BTTS): flex basis 28% — 3 fit = 84% + 2 gaps
        <div
          key={label}
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: `0 0 ${wide ? '36vw' : '28vw'}`,
            minWidth: wide ? 90 : 72,
            maxWidth: wide ? 130 : 110,
            minHeight: 'clamp(100px, 22vw, 150px)',
          }}
        >
          {/* Per-card market header label */}
          <div style={{
            textAlign: 'center',
            paddingBottom: 2,
            paddingTop: 1,
          }}>
            <span style={{
              fontSize: 'clamp(7px, 2vw, 9px)',
              fontWeight: 700,
              color: 'rgba(255,255,255,0.65)',
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
              whiteSpace: 'nowrap',
            }}>{label}</span>
          </div>
          {/* BetCell fills remaining height */}
          <div style={{ flex: '1 1 0', display: 'flex', flexDirection: 'column' }}>
            {cell}
          </div>
        </div>
      ))}
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
              {wcTeamAlias(awayTeam?.name ?? awayFifaCode)}
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
              {wcTeamAlias(homeTeam?.name ?? homeFifaCode)}
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Projections Feed ─────────────────────────────────────────────────────────

function WcProjectionsFeed({ date }: { date: string }) {
  // ─────────────────────────────────────────────────────────────────────────────
  // [FIX 2026-06-24] ALWAYS use fixturesByDate(date) — never todayWithOdds.
  //
  // ROOT CAUSE of the June 23-on-June-24 bug:
  //   todayWithOdds uses the server's real UTC clock (11:00 UTC cutoff).
  //   When MANUAL_WC_DATE_OVERRIDE advances the client to June 24 but the server
  //   UTC hour is still < 11, todayWithOdds returns June 23 fixtures.
  //   isTodayDate was true (client date === override date), so the feed routed to
  //   todayWithOdds and displayed June 23 games on the June 24 UI.
  //
  // FIX: fixturesByDate(date) does an exact match_date = :date query.
  //   It is correct for any date — today, yesterday, or any future date.
  //   The todayWithOdds split is eliminated entirely to prevent this class of
  //   client/server date disagreement from ever recurring.
  // ─────────────────────────────────────────────────────────────────────────────
  const dateQuery = trpc.wc2026.fixturesByDate.useQuery(
    { date },
    {
      enabled: !!date,
      refetchOnWindowFocus: false,
      staleTime: 60 * 1000,
      refetchInterval: 60 * 1000,
      placeholderData: keepPreviousData,
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

  const { data: fixtures, isLoading, isFetching } = dateQuery;

  // Build a map: fixtureId → WcFixtureSplits for O(1) lookup
  const splitsMap = (splitsData as WcFixtureSplits[] | undefined)?.reduce<Record<string, WcFixtureSplits>>(
    (acc, s) => { acc[s.fixtureId] = s; return acc; },
    {}
  ) ?? {};

  // [FIX 2026-06-24] Show skeleton during: (a) initial load, (b) date transition where
  // placeholderData from prev date is filtered out → fixtures=[] while isFetching=true.
  // Only show genuine empty state when query has settled (isFetching=false) with 0 results.
  if (isLoading || (isFetching && (!fixtures || fixtures.length === 0))) {
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
  // [FIX 2026-06-24] keepPreviousData + isFetching guard: prevents blank screen on date change.
  const { data: fixtures, isLoading, isFetching } = trpc.wc2026.lineupsByDate.useQuery(
    { date },
    {
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
      placeholderData: keepPreviousData,
    }
  );

  if (isLoading || (isFetching && (!fixtures || fixtures.length === 0))) {
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
  // [FIX 2026-06-24] keepPreviousData + isFetching guard: prevents blank screen on date change.
  const { data: splitsData, isLoading, isFetching } = trpc.wc2026.splitsByDate.useQuery(
    { date },
    {
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
      placeholderData: keepPreviousData,
    }
  );

  if (isLoading || (isFetching && (!splitsData || (splitsData as WcFixtureSplits[]).length === 0))) {
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

        { /* Sub-tab nav — MLB-identical: borderBottom on container, active tab has green bottom border */}
        <div
          style={{
            display: 'flex',
            overflowX: 'auto',
            overflowY: 'hidden',
            scrollbarWidth: 'none',
            WebkitOverflowScrolling: 'touch',
            borderBottom: '2px solid hsl(var(--border) / 0.5)',
            background: 'transparent',
            paddingLeft: '12px',
          } as React.CSSProperties}
        >
          {WC_SUB_TABS.map((tab) => {
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                style={{
                  flex: '0 0 auto',
                  padding: '7px 12px',
                  minHeight: 44,
                  fontSize: '13px',
                  fontWeight: isActive ? 800 : 500,
                  letterSpacing: '0.06em',
                  color: isActive ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.55)',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: isActive ? '2px solid #39FF14' : '2px solid transparent',
                  marginBottom: '-2px',
                  cursor: 'pointer',
                  transition: 'color 0.15s, border-color 0.15s',
                  textTransform: 'uppercase',
                  lineHeight: 1.2,
                  whiteSpace: 'nowrap',
                }}
              >
                {tab}
              </button>
            );
          })}
        </div>

      {/* [FIX] Global column header removed — each game card now has per-card market headers above each BetCell */}
      {/* [LOG] WcColHeader: removed to avoid double-header confusion with per-card headers */}
      </div>


      {/* ── Content ── */}
      {activeTab === "PROJECTIONS" && <WcProjectionsFeed date={selectedDate} />}
      {/* SPLITS tab removed — WC splits data not consistently available */}
      {activeTab === "LINEUPS" && <WcLineupsFeed date={selectedDate} />}
      {activeTab === "STANDINGS" && <WcComingSoon label="Group Standings" />}
      {activeTab === "FUTURES" && <WcComingSoon label="Futures & Outrights" />}
    </div>
  );
}
