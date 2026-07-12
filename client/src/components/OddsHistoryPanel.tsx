/**
 * OddsHistoryPanel — v4
 *
 * Collapsible full-width panel rendered BELOW every game card (outside all
 * overflow:hidden containers). Displays a chronological timeline of every
 * odds snapshot for the game, with timestamps, lines, and VSIN betting splits.
 *
 * ── Design decisions ──────────────────────────────────────────────────────────
 *
 * Layout per active market:
 *   SPREAD / ML:
 *     TIME (EST) | [Logo + TeamName] Line  🎟️  💰 | [Logo + TeamName] Line  🎟️  💰
 *     (no AWAY/HOME group header — logos + names already identify each side)
 *
 *   TOTAL:
 *     TIME (EST) | OVER [o6.5 (-120)]  🎟️  💰 | UNDER [u6.5 (+100)]  🎟️  💰
 *     ("OVER" and "UNDER" replace the "LINE" label — no separate group header)
 *
 * Timestamp format: MM/DD HH:MMam/pm  (e.g., "04/10 12:59AM")
 *   - Timezone is implied by the TIME (EST) column header — not repeated per row
 *   - Uses America/New_York for correct EDT/EST conversion
 *
 * Deduplication: consecutive rows with identical values for the active market are hidden —
 * only the first occurrence of each unique state is shown.
 * Duplicate count is logged server-side only — not shown in the UI.
 * The snapshot count badge is NOT shown in the toggle header.
 *
 * Responsive scaling:
 *   - font-size via CSS clamp() — scales smoothly from 9px (narrow) to 11px (wide)
 *   - column widths use min-content + fr units so they compress gracefully
 *   - horizontal scroll only as last resort (overflow-x: auto on the table wrapper)
 *   - no fixed pixel widths on any column
 *
 * Emoji key:
 *   🎟️ = Tickets % (number of bets on that side)
 *   💰 = Money %  (dollar handle on that side)
 *
 * 0/0 guard: splits where both tickets AND money are 0 or null are treated
 * as "market not yet open" and displayed as "—" to avoid misleading zeros.
 *
 * Home/Under splits are computed as 100 − away/over (inverse).
 *
 * Logging format:
 *   [OddsHistoryPanel] [INPUT]  ...
 *   [OddsHistoryPanel] [STATE]  ...
 *   [OddsHistoryPanel] [OUTPUT] ...
 *   [OddsHistoryPanel] [VERIFY] PASS/FAIL — reason
 *   [OddsHistoryPanel] [ERROR]  ...
 */

import { useState } from "react";
import { ChevronDown, ChevronUp, Clock, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";

export type ActiveMarket = "spread" | "total" | "ml";

interface OddsHistoryPanelProps {
  gameId: number;
  awayTeam: string;
  homeTeam: string;
  /** Mirrors the SPREAD/TOTAL/MONEYLINE toggle from BettingSplitsPanel */
  activeMarket: ActiveMarket;
  /** IntersectionObserver gate — only fetch data when card is in viewport */
  enabled?: boolean;
}

// ── Logging ────────────────────────────────────────────────────────────────────

function log(tag: "INPUT" | "STATE" | "OUTPUT" | "VERIFY" | "ERROR" | "TOGGLE" | "RENDER", msg: string) {
  console.log(`[OddsHistoryPanel] [${tag}]  ${msg}`);
}

// ── Timestamp formatter ────────────────────────────────────────────────────────

/**
 * Format a UTC epoch ms timestamp as: MM/DD HH:MMam/pm
 * Example: 04/10 12:59AM
 * Timezone is America/New_York (handles EDT/EST automatically).
 * The timezone label is NOT appended — it is implied by the column header.
 */
function fmtTimestamp(epochMs: number): string {
  const d = new Date(epochMs);

  // Extract parts in America/New_York
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "??";

  const month  = get("month");
  const day    = get("day");
  const hour   = get("hour");
  const minute = get("minute");
  const dayPeriod = get("dayPeriod").toLowerCase(); // "am" or "pm"

  // Result: "04/10 12:59AM"
  return `${month}/${day} ${hour}:${minute}${dayPeriod.toUpperCase()}`;
}

// ── Line formatters ────────────────────────────────────────────────────────────

/** "+1.5 (-175)" or "—" */
function fmtSpread(value: string | null | undefined, odds: string | null | undefined): string {
  if (!value) return "—";
  const v = parseFloat(value);
  if (isNaN(v)) return value;
  const sign = v > 0 ? "+" : "";
  const line = `${sign}${v}`;
  return odds ? `${line} (${odds})` : line;
}

/** "o8.5 (-115)" or "—" */
function fmtOver(total: string | null | undefined, odds: string | null | undefined): string {
  if (!total) return "—";
  const t = parseFloat(total);
  if (isNaN(t)) return total;
  return odds ? `o${t} (${odds})` : `o${t}`;
}

/** "u8.5 (-105)" or "—" */
function fmtUnder(total: string | null | undefined, odds: string | null | undefined): string {
  if (!total) return "—";
  const t = parseFloat(total);
  if (isNaN(t)) return total;
  return odds ? `u${t} (${odds})` : `u${t}`;
}

/** "-149" or "+123" or "—" */
function fmtML(val: string | null | undefined): string {
  if (!val) return "—";
  return val;
}

/** "##%" integer, or "—" if null */
function fmtPct(val: number | null | undefined): string {
  if (val == null) return "—";
  return `${Math.round(val)}%`;
}

// ── Row type ───────────────────────────────────────────────────────────────────

type HistoryRow = {
  id: number;
  scrapedAt: number;
  source: string | null;
  lineSource: string | null;
  awaySpread: string | null;
  homeSpread: string | null;
  awaySpreadOdds: string | null;
  homeSpreadOdds: string | null;
  total: string | null;
  overOdds: string | null;
  underOdds: string | null;
  awayML: string | null;
  homeML: string | null;
  spreadAwayBetsPct: number | null;
  spreadAwayMoneyPct: number | null;
  totalOverBetsPct: number | null;
  totalOverMoneyPct: number | null;
  mlAwayBetsPct: number | null;
  mlAwayMoneyPct: number | null;
};

// ── Deduplication ──────────────────────────────────────────────────────────────

function dedupKey(row: HistoryRow, market: ActiveMarket): string {
  if (market === "spread") {
    return [
      row.awaySpread, row.awaySpreadOdds,
      row.homeSpread, row.homeSpreadOdds,
      row.spreadAwayBetsPct, row.spreadAwayMoneyPct,
    ].join("|");
  }
  if (market === "total") {
    return [
      row.total, row.overOdds, row.underOdds,
      row.totalOverBetsPct, row.totalOverMoneyPct,
    ].join("|");
  }
  return [
    row.awayML, row.homeML,
    row.mlAwayBetsPct, row.mlAwayMoneyPct,
  ].join("|");
}

function deduplicateRows(rows: HistoryRow[], market: ActiveMarket): HistoryRow[] {
  const out: HistoryRow[] = [];
  let lastKey: string | null = null;
  for (const row of rows) {
    const key = dedupKey(row, market);
    if (key !== lastKey) {
      out.push(row);
      lastKey = key;
    }
  }
  return out;
}

// ── Source badge ─────────────────────────────────────────────────────────────

/**
 * Renders the odds line source indicator:
 *   'dk'   → DraftKings logo image (official DK OSB logo)
 *   'open' → Plain "OPEN" text label (amber)
 *
 * Never null, never partial. Every game always has either DK or Open.
 * Applied to MLB and NHL only (F5/NRFI/K-Props/HR Props have no source column).
 */
const DK_LOGO_URL = "https://www.draftkings.com/v2/landingpages-assets/blt02fb52e5e7a6fbb9/blta03e790d330c9bf1/65821604c3fb27b9ef19b9e4/OSB.png";

function SourceBadge({ lineSource }: { lineSource: string | null }) {
  if (!lineSource) {
    // Should never happen — every game has either 'dk' or 'open'
    return <span style={{ color: "var(--dime-text-faint, rgba(255,255,255,0.25))", fontFamily: "var(--dime-font-mono, monospace)", fontSize: "inherit" }}>—</span>;
  }

  if (lineSource.toLowerCase() === 'dk') {
    return (
      <img
        src={DK_LOGO_URL}
        alt="DraftKings"
        title="DraftKings NJ — live market odds"
        style={{
          height: 14,
          width: "auto",
          objectFit: "contain",
          display: "inline-block",
          verticalAlign: "middle",
          filter: "brightness(1.1) saturate(1.2)",
        }}
        onError={(e) => {
          // Fallback to text if image fails to load
          const el = e.currentTarget as HTMLImageElement;
          el.style.display = "none";
          const span = document.createElement("span");
          span.textContent = "DK";
          span.style.cssText = "color:var(--dime-mint-text, #39FF14);font-family:var(--dime-font-mono, monospace);font-weight:700;font-size:inherit;";
          el.parentNode?.insertBefore(span, el.nextSibling);
        }}
      />
    );
  }

  // 'open' — AN Opening line fallback
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 5px",
        borderRadius: 3,
        background: "var(--dime-surface-raised, rgba(255,255,255,0.08))",
        color: "var(--dime-text-secondary, #FFC850)",
        border: "1px solid var(--dime-border-strong, rgba(255,255,255,0.2))",
        fontFamily: "var(--dime-font-mono, monospace)",
        fontWeight: 700,
        fontSize: "inherit",
        letterSpacing: "0.05em",
        whiteSpace: "nowrap",
      }}
      title="Opening line (DK NJ not yet fully posted)"
    >
      OPEN
    </span>
  );
}

// ── Market color map ───────────────────────────────────────────────────────────

const MARKET_COLOR: Record<ActiveMarket, string> = {
  spread: "var(--dime-text-body, rgba(255,255,255,0.9))",
  total:  "var(--dime-text-secondary, rgba(255,255,255,0.7))",
  ml:     "var(--dime-text-muted, rgba(255,255,255,0.55))",
};

const MARKET_LABEL: Record<ActiveMarket, string> = {
  spread: "SPREAD",
  total:  "TOTAL",
  ml:     "ML",
};

// ── Team logo + name component ─────────────────────────────────────────────────

function TeamHeader({
  logoUrl,
  abbrev,
  name,
  size = 16,
}: {
  logoUrl?: string | null;
  abbrev?: string | null;
  name?: string | null;
  size?: number;
}) {
  const displayName = name ?? abbrev ?? "?";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        flexWrap: "nowrap",
        overflow: "hidden",
      }}
    >
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={displayName}
          width={size}
          height={size}
          style={{
            width: size,
            height: size,
            objectFit: "contain",
            flexShrink: 0,
          }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      ) : null}
      <span
        style={{
          fontWeight: 700,
          color: "var(--dime-text-body, rgba(255,255,255,0.85))",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: "6em",
        }}
      >
        {displayName}
      </span>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export function OddsHistoryPanel({
  gameId,
  awayTeam,
  homeTeam,
  activeMarket,
  enabled = true,
}: OddsHistoryPanelProps) {
  const [open, setOpen] = useState(false);

  // ── Data fetch (lazy — only when panel is expanded) ────────────────────────
  const { data, isLoading, error } = trpc.oddsHistory.listForGame.useQuery(
    { gameId },
    {
      enabled: (enabled ?? true) && open,
      staleTime: 30_000,
      refetchInterval: 30_000, // auto-poll every 30s when panel is open — keeps odds history current
    }
  );

  // ── Team colors + logos (try MLB → NHL → NBA) ──────────────────────────────
  const { data: colorsMlb } = trpc.teamColors.getForGame.useQuery(
    { awayTeam, homeTeam, sport: "MLB" },
    { staleTime: 3_600_000, enabled: open }
  );
  const { data: colorsNhl } = trpc.teamColors.getForGame.useQuery(
    { awayTeam, homeTeam, sport: "NHL" },
    { staleTime: 3_600_000, enabled: open && !colorsMlb?.away?.logoUrl }
  );
  const { data: colorsNba } = trpc.teamColors.getForGame.useQuery(
    { awayTeam, homeTeam, sport: "NBA" },
    { staleTime: 3_600_000, enabled: open && !colorsMlb?.away?.logoUrl && !colorsNhl?.away?.logoUrl }
  );

  const colors = colorsMlb?.away?.logoUrl ? colorsMlb
    : colorsNhl?.away?.logoUrl ? colorsNhl
    : colorsNba?.away?.logoUrl ? colorsNba
    : colorsMlb;

  const awayLogo   = colors?.away?.logoUrl;
  const homeLogo   = colors?.home?.logoUrl;
  const awayAbbrev = colors?.away?.abbrev ?? awayTeam;
  const homeAbbrev = colors?.home?.abbrev ?? homeTeam;

  // ── Row processing ─────────────────────────────────────────────────────────
  const rawRows = (data?.history ?? []) as HistoryRow[];

  // ── OPEN line pinning ────────────────────────────────────────────────────────
  // Find the first OPEN row that has at least one non-null market value.
  // OPEN rows are the oldest (at the end of the DESC-ordered array).
  function hasMarketValue(row: HistoryRow, market: ActiveMarket): boolean {
    if (market === 'spread') return !!(row.awaySpread || row.homeSpread || row.awaySpreadOdds || row.homeSpreadOdds);
    if (market === 'total')  return !!(row.total || row.overOdds || row.underOdds);
    return !!(row.awayML || row.homeML);
  }

  // Separate OPEN rows from DK rows
  const openRows = rawRows.filter(r => r.lineSource === 'open');
  const dkRows   = rawRows.filter(r => r.lineSource !== 'open');

  // Pin: first OPEN row with non-null market values (oldest = last in DESC array)
  const pinnedOpenRow = openRows.find(r => hasMarketValue(r, activeMarket)) ?? null;

  // Filter null-value rows from DK dedup display
  const dkRowsFiltered = dkRows.filter(r => hasMarketValue(r, activeMarket));
  const rows    = deduplicateRows(dkRowsFiltered, activeMarket);
  const hiddenCount = rawRows.length - rows.length - (pinnedOpenRow ? 1 : 0);

  // ── Logging ────────────────────────────────────────────────────────────────
  if (open && !isLoading && !error && rawRows.length > 0) {
    log("OUTPUT",
      `gameId=${gameId} market=${activeMarket} | ` +
      `raw=${rawRows.length} openRows=${openRows.length} dkRows=${dkRows.length} ` +
      `pinnedOpen=${pinnedOpenRow ? fmtTimestamp(pinnedOpenRow.scrapedAt) : 'none'} ` +
      `deduped=${rows.length} hidden=${hiddenCount} | ` +
      `latest=${fmtTimestamp(rawRows[0]?.scrapedAt ?? 0)} ` +
      `oldest=${fmtTimestamp(rawRows[rawRows.length - 1]?.scrapedAt ?? 0)}`
    );
    log("VERIFY", (rows.length > 0 || pinnedOpenRow) ? "PASS — rows populated" : "WARN — 0 rows after processing");
  }
  if (open && error) {
    log("ERROR", `gameId=${gameId} | ${error.message}`);
  }

  const handleToggle = () => {
    const next = !open;
    log("TOGGLE", `gameId=${gameId} market=${activeMarket} | ${next ? "OPEN" : "CLOSE"}`);
    setOpen(next);
  };

  const marketColor = MARKET_COLOR[activeMarket];

  // ── Responsive font size via CSS custom property ───────────────────────────
  // clamp(9px, 2vw, 11px) — scales smoothly on all screen widths
  const responsiveFontSize = "clamp(9px, 2vw, 11px)";
  const responsiveMonoFont = `clamp(8px, 1.8vw, 10.5px)`;

  // ── Shared cell styles ─────────────────────────────────────────────────────
  const TH: React.CSSProperties = {
    color: "var(--dime-text-muted, rgba(255,255,255,0.5))",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    whiteSpace: "nowrap",
    borderBottom: "1px solid rgba(57,255,20,0.14)",
    padding: "clamp(4px, 1vw, 7px) clamp(4px, 1.5vw, 10px)",
    fontSize: responsiveFontSize,
  } as React.CSSProperties;

  const TD: React.CSSProperties = {
    padding: "clamp(4px, 1vw, 6px) clamp(4px, 1.5vw, 10px)",
    fontFamily: "var(--dime-font-mono, monospace)",
    fontSize: responsiveMonoFont,
    whiteSpace: "nowrap",
    color: "var(--dime-text-body, rgba(255,255,255,0.88))",
  };

  const BORDER_L: React.CSSProperties = { borderLeft: "1px solid rgba(57,255,20,0.12)" };

  return (
    <div className="border-t" style={{ borderColor: "rgba(57,255,20,0.15)" }}>

      {/* ── Toggle header ─────────────────────────────────────────────────── */}
      <button type="button" onClick={handleToggle}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <Clock size={13} style={{ color: "var(--dime-mint-text, #39FF14)" }} />
          <span
            className="text-[11px] font-black uppercase tracking-[0.18em]"
            style={{ color: "var(--dime-mint-text, #39FF14)" }}
          >
            Odds &amp; Splits History
          </span>
          {/* Active market badge */}
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider"
            style={{
              background: `${marketColor}22`,
              color: marketColor,
              border: `1px solid ${marketColor}55`,
            }}
          >
            {MARKET_LABEL[activeMarket]}
          </span>
        </div>
        {open
          ? <ChevronUp size={14} style={{ color: "var(--dime-mint-text, #39FF14)" }} />
          : <ChevronDown size={14} style={{ color: "rgba(57,255,20,0.6)" }} />
        }
      </button>

      {/* ── Expanded panel ────────────────────────────────────────────────── */}
      {open && (
        <div className="px-2 pb-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-6 gap-2" style={{ color: "var(--dime-text-muted, rgba(255,255,255,0.4))" }}>
              <RefreshCw size={13} className="animate-spin" />
              <span className="text-xs">Loading history…</span>
            </div>
          ) : error ? (
            <p className="text-xs text-center py-4" style={{ color: "var(--dime-text-secondary, #ff4444)" }}>
              Failed to load odds &amp; splits history.
            </p>
          ) : rows.length === 0 && !pinnedOpenRow ? (
            <p className="text-xs text-center py-4" style={{ color: "var(--dime-text-muted, rgba(255,255,255,0.35))" }}>
              No snapshots yet — history populates after the next 10-min refresh cycle.
            </p>
          ) : (
            <div
              style={{
                overflowX: "auto",
                WebkitOverflowScrolling: "touch",
                border: "1px solid rgba(57,255,20,0.12)",
                borderRadius: 6,
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  tableLayout: "auto",
                  fontSize: responsiveFontSize,
                }}
              >
                <thead>
                  <tr style={{ background: "rgba(57,255,20,0.07)" }}>

                    {/* TIME (EST) */}
                    <th style={{ ...TH, textAlign: "left" }}>
                      Time&nbsp;(EST)
                    </th>

                    {/* SOURCE */}
                    <th
                      style={{ ...TH, textAlign: "center" }}
                      title="Odds line source: DK NJ logo = live DraftKings NJ market | OPEN = AN Opening line (DK not yet fully posted)"
                    >
                      SRC
                    </th>

                    {/* ── SPREAD: [AwayLogo AwayName] Line 🎟️ 💰 | [HomeLogo HomeName] Line 🎟️ 💰 ── */}
                    {activeMarket === "spread" && (
                      <>
                        <th style={{ ...TH, ...BORDER_L, color: marketColor, textAlign: "center" }}>
                          <TeamHeader logoUrl={awayLogo} abbrev={awayAbbrev} name={awayAbbrev} />
                        </th>
                        <th style={{ ...TH, textAlign: "center" }} title="Away spread tickets %">🎟️</th>
                        <th style={{ ...TH, textAlign: "center" }} title="Away spread money %">💰</th>
                        <th style={{ ...TH, ...BORDER_L, color: marketColor, textAlign: "center" }}>
                          <TeamHeader logoUrl={homeLogo} abbrev={homeAbbrev} name={homeAbbrev} />
                        </th>
                        <th style={{ ...TH, textAlign: "center" }} title="Home spread tickets %">🎟️</th>
                        <th style={{ ...TH, textAlign: "center" }} title="Home spread money %">💰</th>
                      </>
                    )}

                    {/* ── TOTAL: OVER [line] 🎟️ 💰 | UNDER [line] 🎟️ 💰 ── */}
                    {activeMarket === "total" && (
                      <>
                        <th style={{ ...TH, ...BORDER_L, color: marketColor, textAlign: "center" }}>
                          OVER
                        </th>
                        <th style={{ ...TH, textAlign: "center" }} title="Over tickets %">🎟️</th>
                        <th style={{ ...TH, textAlign: "center" }} title="Over money %">💰</th>
                        <th style={{ ...TH, ...BORDER_L, color: marketColor, textAlign: "center" }}>
                          UNDER
                        </th>
                        <th style={{ ...TH, textAlign: "center" }} title="Under tickets %">🎟️</th>
                        <th style={{ ...TH, textAlign: "center" }} title="Under money %">💰</th>
                      </>
                    )}

                    {/* ── ML: [AwayLogo AwayName] ML 🎟️ 💰 | [HomeLogo HomeName] ML 🎟️ 💰 ── */}
                    {activeMarket === "ml" && (
                      <>
                        <th style={{ ...TH, ...BORDER_L, color: marketColor, textAlign: "center" }}>
                          <TeamHeader logoUrl={awayLogo} abbrev={awayAbbrev} name={awayAbbrev} />
                        </th>
                        <th style={{ ...TH, textAlign: "center" }} title="Away ML tickets %">🎟️</th>
                        <th style={{ ...TH, textAlign: "center" }} title="Away ML money %">💰</th>
                        <th style={{ ...TH, ...BORDER_L, color: marketColor, textAlign: "center" }}>
                          <TeamHeader logoUrl={homeLogo} abbrev={homeAbbrev} name={homeAbbrev} />
                        </th>
                        <th style={{ ...TH, textAlign: "center" }} title="Home ML tickets %">🎟️</th>
                        <th style={{ ...TH, textAlign: "center" }} title="Home ML money %">💰</th>
                      </>
                    )}
                  </tr>
                </thead>

                <tbody>
                  {/* ── PINNED OPENING LINE ── */}
                  {pinnedOpenRow && (() => {
                    const row = pinnedOpenRow;
                    const spreadPending =
                      (row.spreadAwayBetsPct == null || row.spreadAwayBetsPct === 0) &&
                      (row.spreadAwayMoneyPct == null || row.spreadAwayMoneyPct === 0);
                    const totalPending =
                      (row.totalOverBetsPct == null || row.totalOverBetsPct === 0) &&
                      (row.totalOverMoneyPct == null || row.totalOverMoneyPct === 0);
                    const mlPending =
                      (row.mlAwayBetsPct == null || row.mlAwayBetsPct === 0) &&
                      (row.mlAwayMoneyPct == null || row.mlAwayMoneyPct === 0);
                    const spreadHomeBets  = spreadPending || row.spreadAwayBetsPct  == null ? null : 100 - row.spreadAwayBetsPct;
                    const spreadHomeMoney = spreadPending || row.spreadAwayMoneyPct == null ? null : 100 - row.spreadAwayMoneyPct;
                    const totalUnderBets  = totalPending  || row.totalOverBetsPct   == null ? null : 100 - row.totalOverBetsPct;
                    const totalUnderMoney = totalPending  || row.totalOverMoneyPct  == null ? null : 100 - row.totalOverMoneyPct;
                    const mlHomeBets      = mlPending     || row.mlAwayBetsPct      == null ? null : 100 - row.mlAwayBetsPct;
                    const mlHomeMoney     = mlPending     || row.mlAwayMoneyPct     == null ? null : 100 - row.mlAwayMoneyPct;
                    const dimColor = "var(--dime-text-faint, rgba(255,255,255,0.28))";
                    const colSpan = activeMarket === 'spread' ? 8 : activeMarket === 'total' ? 8 : 8;
                    return (
                      <>
                        {/* Separator row */}
                        <tr>
                          <td
                            colSpan={colSpan}
                            style={{
                              padding: "3px 8px",
                              background: "var(--dime-row-hover, rgba(255,255,255,0.05))",
                              borderTop: "1px solid var(--dime-border-strong, rgba(255,255,255,0.2))",
                              borderBottom: "1px solid var(--dime-border-strong, rgba(255,255,255,0.2))",
                              textAlign: "center",
                              fontSize: "clamp(8px, 1.6vw, 9.5px)",
                              fontWeight: 700,
                              letterSpacing: "0.12em",
                              color: "var(--dime-text-secondary, #FFC850)",
                              textTransform: "uppercase",
                              fontFamily: "var(--dime-font-mono, monospace)",
                            }}
                          >
                            &#9660; OPENING LINE
                          </td>
                        </tr>
                        {/* Pinned OPEN row */}
                        <tr
                          style={{
                            background: "var(--dime-row-hover, rgba(255,255,255,0.03))",
                            borderBottom: "1px solid var(--dime-border, rgba(255,255,255,0.12))",
                          }}
                        >
                          <td style={{ ...TD, textAlign: "left", color: "var(--dime-text-secondary, rgba(255,255,255,0.7))" }}>
                            {fmtTimestamp(row.scrapedAt)}
                          </td>
                          <td style={{ ...TD, textAlign: "center" }}>
                            <SourceBadge lineSource={row.lineSource} />
                          </td>
                          {activeMarket === "spread" && (
                            <>
                              <td style={{ ...TD, ...BORDER_L, color: marketColor, textAlign: "center" }}>
                                {fmtSpread(row.awaySpread, row.awaySpreadOdds)}
                              </td>
                              <td style={{ ...TD, textAlign: "center", color: spreadPending ? dimColor : "var(--dime-text-body, rgba(255,255,255,0.88))" }}>
                                {spreadPending ? "\u2014" : fmtPct(row.spreadAwayBetsPct)}
                              </td>
                              <td style={{ ...TD, textAlign: "center", color: spreadPending ? dimColor : "var(--dime-text-body, rgba(255,255,255,0.88))" }}>
                                {spreadPending ? "\u2014" : fmtPct(row.spreadAwayMoneyPct)}
                              </td>
                              <td style={{ ...TD, ...BORDER_L, color: marketColor, textAlign: "center" }}>
                                {fmtSpread(row.homeSpread, row.homeSpreadOdds)}
                              </td>
                              <td style={{ ...TD, textAlign: "center", color: spreadPending ? dimColor : "var(--dime-text-body, rgba(255,255,255,0.88))" }}>
                                {spreadPending ? "\u2014" : fmtPct(spreadHomeBets)}
                              </td>
                              <td style={{ ...TD, textAlign: "center", color: spreadPending ? dimColor : "var(--dime-text-body, rgba(255,255,255,0.88))" }}>
                                {spreadPending ? "\u2014" : fmtPct(spreadHomeMoney)}
                              </td>
                            </>
                          )}
                          {activeMarket === "total" && (
                            <>
                              <td style={{ ...TD, ...BORDER_L, color: marketColor, textAlign: "center" }}>
                                {fmtOver(row.total, row.overOdds)}
                              </td>
                              <td style={{ ...TD, textAlign: "center", color: totalPending ? dimColor : "var(--dime-text-body, rgba(255,255,255,0.88))" }}>
                                {totalPending ? "\u2014" : fmtPct(row.totalOverBetsPct)}
                              </td>
                              <td style={{ ...TD, textAlign: "center", color: totalPending ? dimColor : "var(--dime-text-body, rgba(255,255,255,0.88))" }}>
                                {totalPending ? "\u2014" : fmtPct(row.totalOverMoneyPct)}
                              </td>
                              <td style={{ ...TD, ...BORDER_L, color: marketColor, textAlign: "center" }}>
                                {fmtUnder(row.total, row.underOdds)}
                              </td>
                              <td style={{ ...TD, textAlign: "center", color: totalPending ? dimColor : "var(--dime-text-body, rgba(255,255,255,0.88))" }}>
                                {totalPending ? "\u2014" : fmtPct(totalUnderBets)}
                              </td>
                              <td style={{ ...TD, textAlign: "center", color: totalPending ? dimColor : "var(--dime-text-body, rgba(255,255,255,0.88))" }}>
                                {totalPending ? "\u2014" : fmtPct(totalUnderMoney)}
                              </td>
                            </>
                          )}
                          {activeMarket === "ml" && (
                            <>
                              <td style={{ ...TD, ...BORDER_L, color: marketColor, textAlign: "center" }}>
                                {fmtML(row.awayML)}
                              </td>
                              <td style={{ ...TD, textAlign: "center", color: mlPending ? dimColor : "var(--dime-text-body, rgba(255,255,255,0.88))" }}>
                                {mlPending ? "\u2014" : fmtPct(row.mlAwayBetsPct)}
                              </td>
                              <td style={{ ...TD, textAlign: "center", color: mlPending ? dimColor : "var(--dime-text-body, rgba(255,255,255,0.88))" }}>
                                {mlPending ? "\u2014" : fmtPct(row.mlAwayMoneyPct)}
                              </td>
                              <td style={{ ...TD, ...BORDER_L, color: marketColor, textAlign: "center" }}>
                                {fmtML(row.homeML)}
                              </td>
                              <td style={{ ...TD, textAlign: "center", color: mlPending ? dimColor : "var(--dime-text-body, rgba(255,255,255,0.88))" }}>
                                {mlPending ? "\u2014" : fmtPct(mlHomeBets)}
                              </td>
                              <td style={{ ...TD, textAlign: "center", color: mlPending ? dimColor : "var(--dime-text-body, rgba(255,255,255,0.88))" }}>
                                {mlPending ? "\u2014" : fmtPct(mlHomeMoney)}
                              </td>
                            </>
                          )}
                        </tr>
                        {/* Separator between OPEN and DK rows */}
                        {rows.length > 0 && (
                          <tr>
                            <td
                              colSpan={colSpan}
                              style={{
                                padding: "3px 8px",
                                background: "rgba(57,255,20,0.05)",
                                borderTop: "1px solid rgba(57,255,20,0.15)",
                                borderBottom: "1px solid rgba(57,255,20,0.15)",
                                textAlign: "center",
                                fontSize: "clamp(8px, 1.6vw, 9.5px)",
                                fontWeight: 700,
                                letterSpacing: "0.12em",
                                color: "rgba(57,255,20,0.7)",
                                textTransform: "uppercase",
                                fontFamily: "var(--dime-font-mono, monospace)",
                              }}
                            >
                              &#9660; LIVE MARKET MOVEMENT
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })()}

                  {rows.map((row, idx) => {
                    const isEven = idx % 2 === 0;

                    // 0/0 guard per market
                    const spreadPending =
                      (row.spreadAwayBetsPct == null || row.spreadAwayBetsPct === 0) &&
                      (row.spreadAwayMoneyPct == null || row.spreadAwayMoneyPct === 0);
                    const totalPending =
                      (row.totalOverBetsPct == null || row.totalOverBetsPct === 0) &&
                      (row.totalOverMoneyPct == null || row.totalOverMoneyPct === 0);
                    const mlPending =
                      (row.mlAwayBetsPct == null || row.mlAwayBetsPct === 0) &&
                      (row.mlAwayMoneyPct == null || row.mlAwayMoneyPct === 0);

                    // Inverse splits
                    const spreadHomeBets  = spreadPending || row.spreadAwayBetsPct  == null ? null : 100 - row.spreadAwayBetsPct;
                    const spreadHomeMoney = spreadPending || row.spreadAwayMoneyPct == null ? null : 100 - row.spreadAwayMoneyPct;
                    const totalUnderBets  = totalPending  || row.totalOverBetsPct   == null ? null : 100 - row.totalOverBetsPct;
                    const totalUnderMoney = totalPending  || row.totalOverMoneyPct  == null ? null : 100 - row.totalOverMoneyPct;
                    const mlHomeBets      = mlPending     || row.mlAwayBetsPct      == null ? null : 100 - row.mlAwayBetsPct;
                    const mlHomeMoney     = mlPending     || row.mlAwayMoneyPct     == null ? null : 100 - row.mlAwayMoneyPct;

                    const dimColor = "var(--dime-text-faint, rgba(255,255,255,0.28))";

                    return (
                      <tr
                        key={row.id}
                        style={{
                          background: isEven ? "rgba(255,255,255,0.025)" : "transparent",
                          borderBottom: idx < rows.length - 1
                            ? "1px solid rgba(255,255,255,0.04)"
                            : "none",
                        }}
                      >
                        {/* Timestamp */}
                        <td style={{ ...TD, textAlign: "left", color: "var(--dime-text-secondary, rgba(255,255,255,0.7))" }}>
                          {fmtTimestamp(row.scrapedAt)}
                        </td>

                        {/* SOURCE badge */}
                        <td style={{ ...TD, textAlign: "center" }}>
                          <SourceBadge lineSource={row.lineSource} />
                        </td>

                        {/* ── SPREAD cells ── */}
                        {activeMarket === "spread" && (
                          <>
                            <td style={{ ...TD, ...BORDER_L, color: marketColor, textAlign: "center" }}>
                              {fmtSpread(row.awaySpread, row.awaySpreadOdds)}
                            </td>
                            <td style={{ ...TD, textAlign: "center", color: spreadPending ? dimColor : "var(--dime-text-body, rgba(255,255,255,0.88))" }}>
                              {spreadPending ? "—" : fmtPct(row.spreadAwayBetsPct)}
                            </td>
                            <td style={{ ...TD, textAlign: "center", color: spreadPending ? dimColor : "var(--dime-text-body, rgba(255,255,255,0.88))" }}>
                              {spreadPending ? "—" : fmtPct(row.spreadAwayMoneyPct)}
                            </td>
                            <td style={{ ...TD, ...BORDER_L, color: marketColor, textAlign: "center" }}>
                              {fmtSpread(row.homeSpread, row.homeSpreadOdds)}
                            </td>
                            <td style={{ ...TD, textAlign: "center", color: spreadPending ? dimColor : "var(--dime-text-body, rgba(255,255,255,0.88))" }}>
                              {spreadPending ? "—" : fmtPct(spreadHomeBets)}
                            </td>
                            <td style={{ ...TD, textAlign: "center", color: spreadPending ? dimColor : "var(--dime-text-body, rgba(255,255,255,0.88))" }}>
                              {spreadPending ? "—" : fmtPct(spreadHomeMoney)}
                            </td>
                          </>
                        )}

                        {/* ── TOTAL cells ── */}
                        {activeMarket === "total" && (
                          <>
                            <td style={{ ...TD, ...BORDER_L, color: marketColor, textAlign: "center" }}>
                              {fmtOver(row.total, row.overOdds)}
                            </td>
                            <td style={{ ...TD, textAlign: "center", color: totalPending ? dimColor : "var(--dime-text-body, rgba(255,255,255,0.88))" }}>
                              {totalPending ? "—" : fmtPct(row.totalOverBetsPct)}
                            </td>
                            <td style={{ ...TD, textAlign: "center", color: totalPending ? dimColor : "var(--dime-text-body, rgba(255,255,255,0.88))" }}>
                              {totalPending ? "—" : fmtPct(row.totalOverMoneyPct)}
                            </td>
                            <td style={{ ...TD, ...BORDER_L, color: marketColor, textAlign: "center" }}>
                              {fmtUnder(row.total, row.underOdds)}
                            </td>
                            <td style={{ ...TD, textAlign: "center", color: totalPending ? dimColor : "var(--dime-text-body, rgba(255,255,255,0.88))" }}>
                              {totalPending ? "—" : fmtPct(totalUnderBets)}
                            </td>
                            <td style={{ ...TD, textAlign: "center", color: totalPending ? dimColor : "var(--dime-text-body, rgba(255,255,255,0.88))" }}>
                              {totalPending ? "—" : fmtPct(totalUnderMoney)}
                            </td>
                          </>
                        )}

                        {/* ── ML cells ── */}
                        {activeMarket === "ml" && (
                          <>
                            <td style={{ ...TD, ...BORDER_L, color: marketColor, textAlign: "center" }}>
                              {fmtML(row.awayML)}
                            </td>
                            <td style={{ ...TD, textAlign: "center", color: mlPending ? dimColor : "var(--dime-text-body, rgba(255,255,255,0.88))" }}>
                              {mlPending ? "—" : fmtPct(row.mlAwayBetsPct)}
                            </td>
                            <td style={{ ...TD, textAlign: "center", color: mlPending ? dimColor : "var(--dime-text-body, rgba(255,255,255,0.88))" }}>
                              {mlPending ? "—" : fmtPct(row.mlAwayMoneyPct)}
                            </td>
                            <td style={{ ...TD, ...BORDER_L, color: marketColor, textAlign: "center" }}>
                              {fmtML(row.homeML)}
                            </td>
                            <td style={{ ...TD, textAlign: "center", color: mlPending ? dimColor : "var(--dime-text-body, rgba(255,255,255,0.88))" }}>
                              {mlPending ? "—" : fmtPct(mlHomeBets)}
                            </td>
                            <td style={{ ...TD, textAlign: "center", color: mlPending ? dimColor : "var(--dime-text-body, rgba(255,255,255,0.88))" }}>
                              {mlPending ? "—" : fmtPct(mlHomeMoney)}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Duplicate suppression count is logged server-side only — no UI noise */}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
