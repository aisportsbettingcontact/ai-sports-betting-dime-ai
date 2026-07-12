/**
 * OddsHistoryPanel — v5
 *
 * Collapsible full-width panel rendered BELOW every game card (outside all
 * overflow:hidden containers). Displays a chronological timeline of every
 * odds snapshot for the game, with timestamps, lines, and VSIN betting splits.
 *
 * ── Design decisions ──────────────────────────────────────────────────────────
 *
 * Tablet + desktop (≥768px): ALL THREE markets (Spread / Total / Moneyline)
 * render together as stacked sections — no market selector. One fetch serves
 * all three; each section dedupes independently so every line move is real.
 *
 * Mobile (<768px): single market driven by the SPREAD/TOTAL/MONEYLINE toggle
 * in BettingSplitsPanel (activeMarket prop), with a small market badge in the
 * toggle header.
 *
 * Layout per market:
 *   SPREAD / MONEYLINE:
 *     TIME (EST) | SRC | [Logo Team] Line | TICKETS | HANDLE | [Logo Team] Line | TICKETS | HANDLE
 *   TOTAL:
 *     TIME (EST) | SRC | OVER | TICKETS | HANDLE | UNDER | TICKETS | HANDLE
 *
 * Timestamp format: MM/DD HH:MMam/pm  (e.g., "04/10 12:59AM")
 *   - Timezone is implied by the TIME (EST) column header — not repeated per row
 *   - Uses America/New_York for correct EDT/EST conversion
 *
 * Deduplication: consecutive rows with identical values for a market are hidden —
 * only the first occurrence of each unique state is shown (per market section).
 *
 * Column labels are text ("TICKETS" / "HANDLE") — brand law bans emoji icons.
 * All colors come from the --dime-* token layer (design-system/dime-ai/MASTER.md);
 * mint appears only on the live-movement separator (live = signal).
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
import { useIsMdUp } from "@/hooks/useIsMdUp";

export type ActiveMarket = "spread" | "total" | "ml";

interface OddsHistoryPanelProps {
  gameId: number;
  awayTeam: string;
  homeTeam: string;
  /** Mirrors the SPREAD/TOTAL/MONEYLINE toggle from BettingSplitsPanel (mobile only) */
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
  const dayPeriod = get("dayPeriod").toLowerCase();

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

/** True when the row carries any value for the market (null-row filter). */
function hasMarketValue(row: HistoryRow, market: ActiveMarket): boolean {
  if (market === "spread") return !!(row.awaySpread || row.homeSpread || row.awaySpreadOdds || row.homeSpreadOdds);
  if (market === "total")  return !!(row.total || row.overOdds || row.underOdds);
  return !!(row.awayML || row.homeML);
}

// ── Per-market cell extraction ─────────────────────────────────────────────────
// One shape for all three markets so the table renders from a single path:
// side A = away/over, side B = home/under. `pending` = 0/0 not-yet-open guard.

type MarketCells = {
  pending: boolean;
  lineA: string;
  lineB: string;
  betsA: number | null;
  moneyA: number | null;
  betsB: number | null;
  moneyB: number | null;
};

function marketCells(row: HistoryRow, market: ActiveMarket): MarketCells {
  const inv = (pending: boolean, v: number | null) => (pending || v == null ? null : 100 - v);
  if (market === "spread") {
    const pending =
      (row.spreadAwayBetsPct == null || row.spreadAwayBetsPct === 0) &&
      (row.spreadAwayMoneyPct == null || row.spreadAwayMoneyPct === 0);
    return {
      pending,
      lineA: fmtSpread(row.awaySpread, row.awaySpreadOdds),
      lineB: fmtSpread(row.homeSpread, row.homeSpreadOdds),
      betsA: row.spreadAwayBetsPct,
      moneyA: row.spreadAwayMoneyPct,
      betsB: inv(pending, row.spreadAwayBetsPct),
      moneyB: inv(pending, row.spreadAwayMoneyPct),
    };
  }
  if (market === "total") {
    const pending =
      (row.totalOverBetsPct == null || row.totalOverBetsPct === 0) &&
      (row.totalOverMoneyPct == null || row.totalOverMoneyPct === 0);
    return {
      pending,
      lineA: fmtOver(row.total, row.overOdds),
      lineB: fmtUnder(row.total, row.underOdds),
      betsA: row.totalOverBetsPct,
      moneyA: row.totalOverMoneyPct,
      betsB: inv(pending, row.totalOverBetsPct),
      moneyB: inv(pending, row.totalOverMoneyPct),
    };
  }
  const pending =
    (row.mlAwayBetsPct == null || row.mlAwayBetsPct === 0) &&
    (row.mlAwayMoneyPct == null || row.mlAwayMoneyPct === 0);
  return {
    pending,
    lineA: fmtML(row.awayML),
    lineB: fmtML(row.homeML),
    betsA: row.mlAwayBetsPct,
    moneyA: row.mlAwayMoneyPct,
    betsB: inv(pending, row.mlAwayBetsPct),
    moneyB: inv(pending, row.mlAwayMoneyPct),
  };
}

// Source column (DK logo / OPEN badge) intentionally removed — the pinned
// "OPENING LINE" separator already distinguishes the open row, and everything
// under "LIVE MARKET MOVEMENT" is the live book. `lineSource` still drives
// the row classification below.

const MARKET_LABEL: Record<ActiveMarket, string> = {
  spread: "SPREAD",
  total:  "TOTAL",
  ml:     "MONEYLINE",
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
          color: "var(--dime-text-body)",
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

// ── Shared cell styles ─────────────────────────────────────────────────────────
// Readability law: every character on this table must clear 4.5:1 contrast at
// a comfortable size. Labels = IBM Plex Mono micro-labels in --dime-text-secondary
// (never muted/faint); values = Familjen Grotesk 600–700 (MASTER.md: "mono is
// for labels, not values").

const FONT_TH = "clamp(10px, 0.85vw, 11.5px)";
const FONT_TD = "clamp(12.5px, 1vw, 14px)";

const TH: React.CSSProperties = {
  color: "var(--dime-text-body)",
  fontFamily: "var(--dime-font-mono)",
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  whiteSpace: "nowrap",
  borderBottom: "1px solid var(--dime-border-strong)",
  padding: "clamp(6px, 0.9vw, 8px) clamp(8px, 1.1vw, 12px)",
  fontSize: FONT_TH,
};

const TD: React.CSSProperties = {
  padding: "clamp(6px, 0.9vw, 8px) clamp(8px, 1.1vw, 12px)",
  fontFamily: "var(--dime-font-sans)",
  fontWeight: 600,
  fontSize: FONT_TD,
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
  color: "var(--dime-text-body)",
};

/** Line/odds cells — the payload of the table reads loudest. */
const TD_LINE: React.CSSProperties = { fontWeight: 700, color: "var(--dime-text-primary)" };

/** Timestamp cells — technical metadata, mono for column alignment. */
const TD_TIME: React.CSSProperties = {
  fontFamily: "var(--dime-font-mono)",
  fontWeight: 500,
  fontSize: "clamp(11.5px, 0.9vw, 12.5px)",
  color: "var(--dime-text-secondary)",
};

const BORDER_L: React.CSSProperties = { borderLeft: "1px solid var(--dime-border)" };

const DIM_COLOR = "var(--dime-text-secondary)";

// ── Per-market history table ───────────────────────────────────────────────────

function MarketHistoryTable({
  market,
  rawRows,
  awayLogo,
  homeLogo,
  awayAbbrev,
  homeAbbrev,
}: {
  market: ActiveMarket;
  rawRows: HistoryRow[];
  awayLogo?: string | null;
  homeLogo?: string | null;
  awayAbbrev: string;
  homeAbbrev: string;
}) {
  // OPEN pinning: first OPEN row with values for THIS market (oldest = last in
  // the DESC-ordered array); DK rows dedupe per market so every move is real.
  const openRows = rawRows.filter(r => r.lineSource === 'open');
  const dkRows   = rawRows.filter(r => r.lineSource !== 'open');
  const pinnedOpenRow = openRows.find(r => hasMarketValue(r, market)) ?? null;
  const rows = deduplicateRows(dkRows.filter(r => hasMarketValue(r, market)), market);

  if (rows.length === 0 && !pinnedOpenRow) {
    return (
      <p className="text-xs py-3 text-center" style={{ color: "var(--dime-text-secondary)" }}>
        No snapshots yet — history populates after the next 10-min refresh cycle.
      </p>
    );
  }

  const pctColor = (pending: boolean) => (pending ? DIM_COLOR : "var(--dime-text-body)");

  const renderDataRow = (row: HistoryRow, opts: { pinned?: boolean; zebra?: boolean; lastRow?: boolean }) => {
    const cells = marketCells(row, market);
    return (
      <tr
        key={`${market}-${row.id}${opts.pinned ? "-open" : ""}`}
        style={{
          background: opts.pinned || opts.zebra ? "var(--dime-row-hover)" : "transparent",
          borderBottom: opts.lastRow ? "none" : "1px solid var(--dime-border)",
        }}
      >
        <td style={{ ...TD, ...TD_TIME, textAlign: "left" }}>
          {fmtTimestamp(row.scrapedAt)}
        </td>
        <td style={{ ...TD, ...TD_LINE, ...BORDER_L, textAlign: "center" }}>{cells.lineA}</td>
        <td style={{ ...TD, textAlign: "center", color: pctColor(cells.pending) }}>
          {cells.pending ? "—" : fmtPct(cells.betsA)}
        </td>
        <td style={{ ...TD, textAlign: "center", color: pctColor(cells.pending) }}>
          {cells.pending ? "—" : fmtPct(cells.moneyA)}
        </td>
        <td style={{ ...TD, ...TD_LINE, ...BORDER_L, textAlign: "center" }}>{cells.lineB}</td>
        <td style={{ ...TD, textAlign: "center", color: pctColor(cells.pending) }}>
          {cells.pending ? "—" : fmtPct(cells.betsB)}
        </td>
        <td style={{ ...TD, textAlign: "center", color: pctColor(cells.pending) }}>
          {cells.pending ? "—" : fmtPct(cells.moneyB)}
        </td>
      </tr>
    );
  };

  const separatorRow = (key: string, label: string, live: boolean) => (
    <tr key={key}>
      <td
        colSpan={7}
        style={{
          padding: "3px 8px",
          background: live ? "var(--dime-mint-dim)" : "var(--dime-surface-raised)",
          borderTop: `1px solid ${live ? "var(--dime-mint-border)" : "var(--dime-border-strong)"}`,
          borderBottom: `1px solid ${live ? "var(--dime-mint-border)" : "var(--dime-border-strong)"}`,
          textAlign: "center",
          fontSize: "clamp(10px, 0.85vw, 11px)",
          fontWeight: 500,
          letterSpacing: "0.12em",
          color: live ? "var(--dime-mint-text)" : "var(--dime-text-secondary)",
          textTransform: "uppercase",
          fontFamily: "var(--dime-font-mono)",
        }}
      >
        &#9660; {label}
      </td>
    </tr>
  );

  return (
    <div
      style={{
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        border: "1px solid var(--dime-border)",
        borderRadius: 8,
      }}
    >
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          tableLayout: "auto",
          fontSize: FONT_TD,
        }}
      >
        <thead>
          <tr>
            <th style={{ ...TH, textAlign: "left" }}>Time&nbsp;(EST)</th>
            {market === "total" ? (
              <th style={{ ...TH, ...BORDER_L, textAlign: "center" }}>OVER</th>
            ) : (
              <th style={{ ...TH, ...BORDER_L, textAlign: "center" }}>
                <TeamHeader logoUrl={awayLogo} abbrev={awayAbbrev} name={awayAbbrev} />
              </th>
            )}
            <th style={{ ...TH, textAlign: "center" }} title={market === "total" ? "Over tickets %" : "Away tickets %"}>Tickets</th>
            <th style={{ ...TH, textAlign: "center" }} title={market === "total" ? "Over money %" : "Away money %"}>Handle</th>
            {market === "total" ? (
              <th style={{ ...TH, ...BORDER_L, textAlign: "center" }}>UNDER</th>
            ) : (
              <th style={{ ...TH, ...BORDER_L, textAlign: "center" }}>
                <TeamHeader logoUrl={homeLogo} abbrev={homeAbbrev} name={homeAbbrev} />
              </th>
            )}
            <th style={{ ...TH, textAlign: "center" }} title={market === "total" ? "Under tickets %" : "Home tickets %"}>Tickets</th>
            <th style={{ ...TH, textAlign: "center" }} title={market === "total" ? "Under money %" : "Home money %"}>Handle</th>
          </tr>
        </thead>
        <tbody>
          {pinnedOpenRow && (
            <>
              {separatorRow(`${market}-sep-open`, "OPENING LINE", false)}
              {renderDataRow(pinnedOpenRow, { pinned: true, lastRow: rows.length === 0 })}
              {rows.length > 0 && separatorRow(`${market}-sep-live`, "LIVE MARKET MOVEMENT", true)}
            </>
          )}
          {rows.map((row, idx) =>
            renderDataRow(row, { zebra: idx % 2 === 0, lastRow: idx === rows.length - 1 })
          )}
        </tbody>
      </table>
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

  // Tablet + desktop show every market together; mobile follows the toggle.
  const isMdUp = useIsMdUp();
  const markets: ActiveMarket[] = isMdUp ? ["spread", "total", "ml"] : [activeMarket];

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

  const rawRows = (data?.history ?? []) as HistoryRow[];

  // ── Logging ────────────────────────────────────────────────────────────────
  if (open && !isLoading && !error && rawRows.length > 0) {
    log("OUTPUT",
      `gameId=${gameId} markets=${markets.join(",")} | raw=${rawRows.length} | ` +
      `latest=${fmtTimestamp(rawRows[0]?.scrapedAt ?? 0)} ` +
      `oldest=${fmtTimestamp(rawRows[rawRows.length - 1]?.scrapedAt ?? 0)}`
    );
  }
  if (open && error) {
    log("ERROR", `gameId=${gameId} | ${error.message}`);
  }

  const handleToggle = () => {
    const next = !open;
    log("TOGGLE", `gameId=${gameId} markets=${markets.join(",")} | ${next ? "OPEN" : "CLOSE"}`);
    setOpen(next);
  };

  return (
    <div className="border-t" style={{ borderColor: "var(--dime-border)" }}>

      {/* ── Toggle header ─────────────────────────────────────────────────── */}
      <button type="button" onClick={handleToggle}
        className="w-full flex items-center justify-between px-4 py-2.5 cursor-pointer transition-colors"
        style={{ background: "transparent" }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--dime-row-hover)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <Clock size={14} style={{ color: "var(--dime-text-secondary)" }} />
          <span
            style={{
              fontFamily: "var(--dime-font-mono)",
              fontSize: 11.5,
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              color: "var(--dime-text-body)",
            }}
          >
            Odds &amp; Splits History
          </span>
          {/* Mobile-only market badge — desktop/tablet show all markets, no selector */}
          {!isMdUp && (
            <span
              style={{
                fontFamily: "var(--dime-font-mono)",
                fontSize: 9,
                fontWeight: 500,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                padding: "2px 7px",
                borderRadius: 999,
                background: "var(--dime-surface-raised)",
                border: "1px solid var(--dime-border-strong)",
                color: "var(--dime-text-primary)",
              }}
            >
              {MARKET_LABEL[activeMarket]}
            </span>
          )}
        </div>
        {open
          ? <ChevronUp size={15} style={{ color: "var(--dime-text-secondary)" }} />
          : <ChevronDown size={15} style={{ color: "var(--dime-text-secondary)" }} />
        }
      </button>

      {/* ── Expanded panel ────────────────────────────────────────────────── */}
      {open && (
        <div className="px-2 pb-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-6 gap-2" style={{ color: "var(--dime-text-secondary)" }}>
              <RefreshCw size={13} className="animate-spin" />
              <span className="text-xs">Loading history…</span>
            </div>
          ) : error ? (
            <p className="text-xs text-center py-4" style={{ color: "var(--dime-text-secondary)" }}>
              Failed to load odds &amp; splits history.
            </p>
          ) : rawRows.length === 0 ? (
            <p className="text-xs text-center py-4" style={{ color: "var(--dime-text-secondary)" }}>
              No snapshots yet — history populates after the next 10-min refresh cycle.
            </p>
          ) : (
            <div className="flex flex-col" style={{ gap: 14 }}>
              {markets.map((market) => (
                <div key={market} className="flex flex-col" style={{ gap: 6 }}>
                  {/* Section label — only needed when several markets stack */}
                  {isMdUp && (
                    <span
                      style={{
                        fontFamily: "var(--dime-font-mono)",
                        fontSize: 11,
                        fontWeight: 500,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: "var(--dime-text-secondary)",
                        paddingLeft: 2,
                      }}
                    >
                      {MARKET_LABEL[market]}
                    </span>
                  )}
                  <MarketHistoryTable
                    market={market}
                    rawRows={rawRows}
                    awayLogo={awayLogo}
                    homeLogo={homeLogo}
                    awayAbbrev={awayAbbrev}
                    homeAbbrev={homeAbbrev}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
