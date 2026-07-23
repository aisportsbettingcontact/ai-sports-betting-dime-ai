/**
 * TheModelResults.tsx — Owner-only unified model results dashboard.
 *
 * Merges the former "THE MODEL" (ModelResults) and "F5 EDGE BOARD" (F5EdgeLeaderboard)
 * pages into a single, comprehensive analytics hub covering all 5 market categories:
 *
 *   FULL GAME    — FG ML + FG Total Brier trend/heatmap, FG ML edge leaderboard + scatter, drift, rolling accuracy
 *   FIRST 5      — F5 ML + F5 Total Brier trend, F5 ML edge leaderboard + scatter, rolling accuracy
 *   1ST INNING   — NRFI Brier trend, daily NRFI results by date, rolling accuracy
 *   K-PROPS      — Daily K-prop backtest (per-pitcher), last-7-day aggregate, calibration metrics
 *   HR PROPS     — Daily HR prop results (per-player), rolling accuracy
 *
 * Access: owner role only — non-owners are immediately redirected to /feed.
 * Backend: all procedures use ownerProcedure (server-side owner check enforced).
 */

import { useState, useEffect, useMemo, Component, type ReactNode } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
  ScatterChart, Scatter, Label,
} from "recharts";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { AdminShell } from "@/pages/admin/AdminShell";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Loader2, ChevronLeft, ChevronRight, RefreshCw,
  TrendingUp, CheckCircle2, XCircle, Calendar, CalendarDays,
  FlaskConical, Filter, BarChart3, Target, Activity,
} from "lucide-react";
import { MLB_BY_ABBREV } from "@shared/mlbTeams";

// ─── Section Error Boundary ──────────────────────────────────────────────────
class SectionErrorBoundary extends Component<
  { label: string; children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { label: string; children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error(`[SectionErrorBoundary:${this.props.label}] ERROR MESSAGE:`, error.message);
    console.error(`[SectionErrorBoundary:${this.props.label}] STACK:`, error.stack);
    console.error(`[SectionErrorBoundary:${this.props.label}] COMPONENT STACK:`, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 24, background: "transparent",
          border: "1px solid var(--border)", borderRadius: 8, margin: "16px 0",
        }}>
          <div style={{ color: "var(--foreground)", fontWeight: 700, fontSize: 13, fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', letterSpacing: 1, marginBottom: 8 }}>
            ⚠ SECTION CRASH — {this.props.label}
          </div>
          <div style={{ color: "var(--foreground)", fontSize: 14, fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif", fontWeight: 700, marginBottom: 12, wordBreak: 'break-all' }}>
            {this.state.error?.message ?? 'Unknown error'}
          </div>
          <pre style={{ color: "var(--foreground)", fontSize: 10, fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif", whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 200, overflow: 'auto', marginBottom: 12 }}>
            {this.state.error?.stack}
          </pre>
          <button type="button" onClick={() => this.setState({ hasError: false, error: null })}
            style={{ padding: "4px 14px", background: "var(--background)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--foreground)", cursor: "pointer", fontSize: 11, fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}
          >
            RETRY
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
function todayPst(): string {
  const now = new Date();
  const pst = now.toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "2-digit", day: "2-digit", year: "numeric",
  });
  const [mm, dd, yyyy] = pst.split("/");
  return `${yyyy}-${mm}-${dd}`;
}
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
function formatDateNav(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  } catch { return dateStr; }
}

// ─── Team helpers ─────────────────────────────────────────────────────────────
function teamPrimary(abbrev: string): string {
  return MLB_BY_ABBREV.get(abbrev?.toUpperCase())?.primaryColor ?? "#4A90D9";
}
function teamLogo(abbrev: string): string | null {
  return MLB_BY_ABBREV.get(abbrev?.toUpperCase())?.logoUrl ?? null;
}

// ─── Pitcher headshot ─────────────────────────────────────────────────────────
function mlbPhoto(id: number | null | undefined): string | null {
  if (!id) return null;
  return `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_360,q_auto:best,e_background_removal,f_png/v1/people/${id}/headshot/67/current`;
}

/** Initials avatar fallback when no MLB photo is available */
function InitialsAvatar({ name, color, size = 56 }: { name: string; color: string; size?: number }) {
  const initials = name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: 8, flexShrink: 0,
      background: `${color}22`, border: `1px solid ${color}44`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.32, fontWeight: 800, color: color,
      fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', letterSpacing: 1,
    }}>
      {initials}
    </div>
  );
}

// ─── Formatting helpers ───────────────────────────────────────────────────────
function fmtNum(val: string | number | null | undefined, decimals = 1): string {
  if (val === null || val === undefined || val === "") return "—";
  const n = typeof val === "number" ? val : parseFloat(val as string);
  if (isNaN(n)) return "—";
  return n.toFixed(decimals);
}
function fmtPct(val: number | null | undefined): string {
  if (val === null || val === undefined) return "—";
  return `${Math.round(val * 100)}%`;
}
function fmtOdds(val: string | null | undefined): string {
  if (!val) return "—";
  const n = parseInt(val, 10);
  if (isNaN(n)) return "—";
  return n > 0 ? `+${n}` : String(n);
}
function signedNum(val: number | null | undefined, decimals = 2): string {
  if (val === null || val === undefined) return "—";
  return val > 0 ? `+${val.toFixed(decimals)}` : val.toFixed(decimals);
}

// ─── Color helpers ────────────────────────────────────────────────────────────
function accuracyColor(acc: number | null): string {
  if (acc === null) return "var(--foreground)";
  if (acc >= 0.65) return "var(--primary)";
  if (acc >= 0.55) return "var(--primary)";
  if (acc >= 0.50) return "var(--foreground)";
  if (acc >= 0.45) return "var(--foreground)";
  return "var(--foreground)";
}
function brierColor(b: string | number | null | undefined): string {
  const v = typeof b === "number" ? b : b ? parseFloat(b) : null;
  if (v === null || v === undefined || isNaN(v as number)) return "var(--foreground)";
  if ((v as number) <= 0.15) return "var(--primary)";
  if ((v as number) <= 0.22) return "var(--foreground)";
  return "var(--foreground)";
}
function edgeColor(edge: number): string {
  if (edge >= 5) return "var(--primary)";
  if (edge >= 3) return "var(--primary)";
  if (edge >= 1) return "var(--primary)";
  if (edge <= -5) return "var(--foreground)";
  if (edge <= -3) return "var(--foreground)";
  if (edge <= -1) return "var(--foreground)";
  return "var(--foreground)";
}
function edgeBg(edge: number): string {
  if (edge >= 5) return "transparent";
  if (edge >= 3) return "transparent";
  if (edge >= 1) return "transparent";
  if (edge <= -5) return "transparent";
  if (edge <= -3) return "transparent";
  if (edge <= -1) return "transparent";
  return "transparent";
}

// ─── Shared sub-components ────────────────────────────────────────────────────

/** Responsive grid wrapper for StatCard rows — auto-fills columns, min 130px each */
function StatGrid({ children, minColWidth = 110 }: { children: React.ReactNode; minColWidth?: number }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(auto-fill, minmax(${minColWidth}px, 1fr))`,
      gap: 8,
      width: "100%",
    }}>
      {children}
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{
      background: "var(--background)", border: "1px solid var(--border)", borderRadius: 10,
      padding: "10px 12px", display: "flex", flexDirection: "column", gap: 4,
      minWidth: 0, overflow: "hidden",
    }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', lineHeight: 1.2, wordBreak: "break-word" }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color ?? "var(--foreground)", lineHeight: 1, fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 10, color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', lineHeight: 1.3 }}>{sub}</div>}
    </div>
  );
}

function MiniStatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ background: "var(--background)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 12px", minWidth: 0, overflow: "hidden" }}>
      <div style={{ fontSize: 9, color: "var(--foreground)", letterSpacing: 1, marginBottom: 2, fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', lineHeight: 1.2, wordBreak: "break-word" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: color ?? "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function ResultBadge({ result, correct }: { result: string | null; correct: number | null }) {
  if (!result || result === "PENDING" || result === "NO_LINE") {
    return (
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: "1px", padding: "3px 8px",
        borderRadius: 4, background: "transparent", color: "var(--foreground)",
        border: "1px solid var(--border)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif',
      }}>
        {result === "NO_LINE" ? "NO LINE" : "PENDING"}
      </span>
    );
  }
  const isCorrect = correct === 1;
  const isPush = result === "PUSH";
  const bg = isPush ? "transparent" : isCorrect ? "transparent" : "transparent";
  const border = isPush ? "var(--border)" : isCorrect ? "var(--primary)" : "var(--border)";
  const color = isPush ? "var(--foreground)" : isCorrect ? "var(--primary)" : "var(--foreground)";
  const icon = isPush ? null : isCorrect ? <CheckCircle2 size={10} style={{ flexShrink: 0 }} /> : <XCircle size={10} style={{ flexShrink: 0 }} />;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 10, fontWeight: 700, letterSpacing: "1px", padding: "3px 8px",
      borderRadius: 4, background: bg, color, border: `1px solid ${border}`,
      fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif',
    }}>
      {icon}{result}
    </span>
  );
}

function VerdictBadge({ verdict, bestSide, bestEdge, bestMlStr }: {
  verdict: string | null; bestSide: string | null; bestEdge: string | null; bestMlStr: string | null;
}) {
  if (!verdict || verdict === "PASS") {
    return <span style={{ fontSize: 10, color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>PASS</span>;
  }
  const edgePp = bestEdge ? parseFloat(bestEdge) * 100 : null;
  const isOver = bestSide === "OVER";
  const color = isOver ? "var(--primary)" : "var(--primary)";
  const bg = isOver ? "transparent" : "transparent";
  const border = isOver ? "var(--primary)" : "var(--primary)";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 10, fontWeight: 700, letterSpacing: "1px", padding: "3px 8px",
      borderRadius: 4, background: bg, color, border: `1px solid ${border}`,
      fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif',
    }}>
      ▶ {bestSide} {bestMlStr ?? ""}
      {edgePp !== null && <span style={{ color: "var(--foreground)", fontWeight: 500 }}>{edgePp > 0 ? "+" : ""}{edgePp.toFixed(1)}pp</span>}
    </span>
  );
}

// ─── Section label ─────────────────────────────────────────────────────────────
function SectionLabel({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>
        {children}
      </div>
      {sub && <div style={{ fontSize: 9, color: "var(--foreground)", marginTop: 2, fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>{sub}</div>}
    </div>
  );
}

// ─── Brier Trend Chart (reusable) ─────────────────────────────────────────────
interface BrierLine {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
}
function BrierTrendChart({ data, lines, windowSize, onWindowChange }: {
  data: Array<Record<string, unknown>>;
  lines: BrierLine[];
  windowSize: number;
  onWindowChange: (w: number) => void;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 9, color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', letterSpacing: ".08em", textTransform: "uppercase" }}>Window</span>
        {[10, 20, 30, 50].map(w => (
          <button type="button" key={w} onClick={() => onWindowChange(w)} style={{
            fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6,
            background: windowSize === w ? "transparent" : "transparent",
            color: windowSize === w ? "var(--primary)" : "var(--foreground)",
            border: `1px solid ${windowSize === w ? "var(--primary)" : "var(--border)"}`,
            cursor: "pointer", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif',
          }}>{w}G</button>
        ))}
      </div>
      <div style={{ background: "var(--background)", border: "1px solid var(--border)", borderRadius: 10, padding: "16px 8px 8px" }}>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
            <XAxis dataKey="gameIndex" tick={{ fill: "#FFFFFF", fontSize: 9 }} tickLine={false} />
            <YAxis domain={[0, 0.35]} tick={{ fill: "#FFFFFF", fontSize: 9 }} tickLine={false} width={36} />
            <Tooltip
              contentStyle={{ background: "#000000", border: "1px solid #FFFFFF", borderRadius: 6, fontSize: 10 }}
              labelStyle={{ color: "#FFFFFF" }}
            />
            <Legend wrapperStyle={{ fontSize: 9, color: "#FFFFFF" }} />
            <ReferenceLine y={0.25} stroke="#FFFFFF" strokeDasharray="4 4" label={{ value: "random", position: "insideTopRight", fill: "#FFFFFF", fontSize: 8 }} />
            <ReferenceLine y={0.22} stroke="#FFFFFF" strokeDasharray="2 2" />
            <ReferenceLine y={0.15} stroke="#45E0A8" strokeDasharray="2 2" />
            {lines.map(l => (
              <Line
                key={l.key}
                type="monotone"
                dataKey={l.key}
                name={l.label}
                stroke={l.color}
                strokeWidth={2}
                strokeDasharray={l.dashed ? "5 3" : undefined}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Edge Leaderboard Table (reusable) ────────────────────────────────────────
interface EdgeRow {
  id: number;
  gameDate: string | null;
  awayTeam: string;
  homeTeam: string;
  side: string;
  modelWinPct: number;
  bookImpliedPct: number;
  edgePct: number;
  f5AwayML?: string | null;
  f5HomeML?: string | null;
  awayML?: string | null;
  homeML?: string | null;
  actualF5AwayScore?: number | null;
  actualF5HomeScore?: number | null;
  actualAwayScore?: number | null;
  actualHomeScore?: number | null;
  f5MlResult?: string | null;
  f5MlCorrect?: number | null;
  fgMlResult?: string | null;
  fgMlCorrect?: number | null;
  brierF5Ml?: string | null;
  brierFgMl?: string | null;
}

function EdgeLeaderboardTable({
  rows, market, minEdge, setMinEdge, side, setSide, withOutcome, setWithOutcome, sortBy, setSortBy, limit, setLimit,
}: {
  rows: EdgeRow[];
  market: "f5" | "fg";
  minEdge: number; setMinEdge: (v: number) => void;
  side: "away" | "home" | "both"; setSide: (v: "away" | "home" | "both") => void;
  withOutcome: boolean; setWithOutcome: (v: boolean) => void;
  sortBy: "edge" | "date" | "brier"; setSortBy: (v: "edge" | "date" | "brier") => void;
  limit: number; setLimit: (v: number) => void;
}) {
  const sorted = [...rows].sort((a, b) => {
    if (sortBy === "edge") return Math.abs(b.edgePct) - Math.abs(a.edgePct);
    if (sortBy === "date") return (b.gameDate ?? "").localeCompare(a.gameDate ?? "");
    if (sortBy === "brier") {
      const bA = (market === "f5" ? a.brierF5Ml : a.brierFgMl) != null ? parseFloat((market === "f5" ? a.brierF5Ml : a.brierFgMl)!) : 999;
      const bB = (market === "f5" ? b.brierF5Ml : b.brierFgMl) != null ? parseFloat((market === "f5" ? b.brierF5Ml : b.brierFgMl)!) : 999;
      return bA - bB;
    }
    return 0;
  });

  return (
    <div>
      {/* Filters */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10, padding: "8px 0" }}>
        <Filter size={11} style={{ color: "var(--foreground)" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontSize: 10, color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>MIN EDGE</span>
          {[0, 1, 2, 3, 5].map(v => (
            <button type="button" key={v} onClick={() => setMinEdge(v)} style={{
              background: minEdge === v ? "var(--primary)" : "var(--background)", border: "1px solid var(--border)",
              borderRadius: 3, cursor: "pointer", color: minEdge === v ? "var(--primary-foreground)" : "var(--foreground)",
              padding: "2px 7px", fontSize: 10, fontWeight: 700, fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif',
            }}>{v === 0 ? "ALL" : `≥${v}pp`}</button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontSize: 10, color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>SIDE</span>
          {(["both", "away", "home"] as const).map(s => (
            <button type="button" key={s} onClick={() => setSide(s)} style={{
              background: side === s ? "var(--primary)" : "var(--background)", border: "1px solid var(--border)",
              borderRadius: 3, cursor: "pointer", color: side === s ? "var(--primary-foreground)" : "var(--foreground)",
              padding: "2px 7px", fontSize: 10, fontWeight: 700, textTransform: "uppercase",
              fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif',
            }}>{s}</button>
          ))}
        </div>
        <button type="button" onClick={() => setWithOutcome(!withOutcome)} style={{
          background: withOutcome ? "var(--primary)" : "var(--background)", border: "1px solid var(--border)",
          borderRadius: 3, cursor: "pointer", color: withOutcome ? "var(--primary-foreground)" : "var(--foreground)",
          padding: "2px 7px", fontSize: 10, fontWeight: 700, fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif',
        }}>WITH OUTCOME ONLY</button>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginLeft: "auto" }}>
          <span style={{ fontSize: 10, color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>SORT</span>
          {(["edge", "date", "brier"] as const).map(s => (
            <button type="button" key={s} onClick={() => setSortBy(s)} style={{
              background: sortBy === s ? "var(--primary)" : "var(--background)", border: "1px solid var(--border)",
              borderRadius: 3, cursor: "pointer", color: sortBy === s ? "var(--primary-foreground)" : "var(--foreground)",
              padding: "2px 7px", fontSize: 10, fontWeight: 700, textTransform: "uppercase",
              fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif',
            }}>{s}</button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--background)" }}>
              {["DATE", "MATCHUP", "SIDE", "MODEL WIN%", "BOOK IMPLIED%", "EDGE", "ML", "SCORE", "RESULT", "BRIER"].map(h => (
                <th key={h} style={{ padding: "6px 10px", textAlign: "left", color: "var(--foreground)", fontSize: 9, letterSpacing: 1, fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => {
              const isAway = row.side === "away";
              const ml = market === "f5"
                ? (isAway ? row.f5AwayML : row.f5HomeML)
                : (isAway ? row.awayML : row.homeML);
              const awayScore = market === "f5" ? row.actualF5AwayScore : row.actualAwayScore;
              const homeScore = market === "f5" ? row.actualF5HomeScore : row.actualHomeScore;
              const scoreStr = awayScore != null && homeScore != null ? `${awayScore}–${homeScore}` : "—";
              const result = market === "f5" ? row.f5MlResult : row.fgMlResult;
              const correct = market === "f5" ? row.f5MlCorrect : row.fgMlCorrect;
              const brier = market === "f5" ? row.brierF5Ml : row.brierFgMl;
              return (
                <tr key={`${row.id}-${row.side}`} style={{ borderBottom: "1px solid var(--border)", background: i % 2 === 0 ? edgeBg(row.edgePct) : "transparent" }}>
                  <td style={{ padding: "5px 10px", color: "var(--foreground)", whiteSpace: "nowrap" }}>{row.gameDate}</td>
                  <td style={{ padding: "5px 10px", whiteSpace: "nowrap" }}>
                    <span style={{ color: "var(--foreground)" }}>{row.awayTeam}</span>
                    <span style={{ color: "var(--foreground)", margin: "0 4px" }}>@</span>
                    <span style={{ color: "var(--foreground)" }}>{row.homeTeam}</span>
                  </td>
                  <td style={{ padding: "5px 10px" }}>
                    <span style={{
                      background: isAway ? "transparent" : "transparent",
                      color: isAway ? "var(--foreground)" : "var(--foreground)",
                      borderRadius: 3, padding: "1px 5px", fontSize: 9, fontWeight: 700, letterSpacing: 1,
                    }}>{isAway ? "AWAY" : "HOME"}</span>
                  </td>
                  <td style={{ padding: "5px 10px", color: "var(--foreground)", fontWeight: 700 }}>{row.modelWinPct.toFixed(1)}%</td>
                  <td style={{ padding: "5px 10px", color: "var(--foreground)" }}>{row.bookImpliedPct.toFixed(1)}%</td>
                  <td style={{ padding: "5px 10px", fontWeight: 700 }}>
                    <span style={{ color: edgeColor(row.edgePct) }}>{row.edgePct > 0 ? "+" : ""}{row.edgePct.toFixed(2)}pp</span>
                  </td>
                  <td style={{ padding: "5px 10px", color: "var(--foreground)" }}>{ml ?? "—"}</td>
                  <td style={{ padding: "5px 10px", color: "var(--foreground)" }}>{scoreStr}</td>
                  <td style={{ padding: "5px 10px" }}>
                    {result ? (correct === 1 ? <span style={{ color: "var(--primary)", fontWeight: 700 }}>WIN</span> : correct === 0 ? <span style={{ color: "var(--foreground)", fontWeight: 700 }}>LOSS</span> : <span style={{ color: "var(--foreground)" }}>{result}</span>) : <span style={{ color: "var(--foreground)" }}>PENDING</span>}
                  </td>
                  <td style={{ padding: "5px 10px", color: brierColor(brier), fontWeight: 700 }}>
                    {brier != null ? parseFloat(brier).toFixed(4) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
        <span style={{ fontSize: 10, color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>
          {sorted.length} rows · Edge = Model Win% − No-Vig Book Implied%
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          {[100, 200, 500].map(v => (
            <button type="button" key={v} onClick={() => setLimit(v)} style={{
              background: limit === v ? "var(--primary)" : "var(--background)", border: "1px solid var(--border)",
              borderRadius: 3, cursor: "pointer", color: limit === v ? "var(--primary-foreground)" : "var(--foreground)",
              padding: "2px 7px", fontSize: 10, fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif',
            }}>TOP {v}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Edge Scatter Plot (reusable) ─────────────────────────────────────────────
function EdgeScatterPlot({ rows, market }: { rows: EdgeRow[]; market: "f5" | "fg" }) {
  const scatterData = useMemo(() => {
    return rows
      .filter(r => (market === "f5" ? r.f5MlCorrect : r.fgMlCorrect) != null)
      .map(r => ({
        x: parseFloat(r.edgePct.toFixed(2)),
        y: (market === "f5" ? r.f5MlCorrect : r.fgMlCorrect) as number,
        label: `${r.awayTeam}@${r.homeTeam} (${r.gameDate})`,
        side: r.side,
      }));
  }, [rows, market]);

  const regression = useMemo(() => {
    if (scatterData.length < 2) return null;
    const n = scatterData.length;
    const sumX = scatterData.reduce((s, d) => s + d.x, 0);
    const sumY = scatterData.reduce((s, d) => s + d.y, 0);
    const sumXY = scatterData.reduce((s, d) => s + d.x * d.y, 0);
    const sumX2 = scatterData.reduce((s, d) => s + d.x * d.x, 0);
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    const xMin = Math.min(...scatterData.map(d => d.x));
    const xMax = Math.max(...scatterData.map(d => d.x));
    return { slope, intercept, xMin, xMax };
  }, [scatterData]);

  if (scatterData.length === 0) {
    return <div style={{ textAlign: "center", color: "var(--foreground)", fontSize: 12, padding: 32 }}>No games with outcomes yet. Results will appear after games are ingested.</div>;
  }

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {[
          { label: "GAMES W/ OUTCOME", value: scatterData.length, color: "var(--foreground)" },
          { label: "WINS", value: scatterData.filter(d => d.y === 1).length, color: "var(--primary)" },
          { label: "LOSSES", value: scatterData.filter(d => d.y === 0).length, color: "var(--foreground)" },
          { label: "WIN RATE", value: `${(scatterData.filter(d => d.y === 1).length / scatterData.length * 100).toFixed(1)}%`, color: "var(--foreground)" },
          { label: "REGRESSION SLOPE", value: regression ? `${regression.slope > 0 ? "+" : ""}${regression.slope.toFixed(4)}` : "—", color: regression && regression.slope > 0 ? "var(--primary)" : "var(--foreground)" },
        ].map(card => <MiniStatCard key={card.label} label={card.label} value={card.value} color={card.color} />)}
      </div>
      <div style={{ background: "var(--background)", border: "1px solid var(--border)", borderRadius: 10, padding: "16px 8px 8px" }}>
        <div style={{ fontSize: 10, color: "var(--foreground)", letterSpacing: 2, marginBottom: 12, paddingLeft: 8, fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>
          {market === "f5" ? "F5" : "FG"} ML EDGE (pp) vs OUTCOME — Positive slope = model alpha confirmed
        </div>
        <ResponsiveContainer width="100%" height={320}>
          <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
            <XAxis type="number" dataKey="x" domain={["auto", "auto"]} tick={{ fill: "#FFFFFF", fontSize: 9 }} tickLine={false}>
              <Label value="Edge (pp)" position="insideBottom" offset={-10} fill="#FFFFFF" fontSize={9} />
            </XAxis>
            <YAxis type="number" dataKey="y" domain={[-0.1, 1.1]} ticks={[0, 1]}
              tickFormatter={(v) => v === 1 ? "WIN" : v === 0 ? "LOSS" : ""}
              tick={{ fill: "#FFFFFF", fontSize: 9 }} tickLine={false} width={40} />
            <Tooltip cursor={{ strokeDasharray: "3 3", stroke: "#FFFFFF" }}
              content={({ payload }) => {
                if (!payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <div style={{ background: "#000000", border: "1px solid #FFFFFF", borderRadius: 4, padding: "6px 10px", fontSize: 10 }}>
                    <div style={{ color: "#FFFFFF" }}>{d.label}</div>
                    <div style={{ color: "#45E0A8" }}>Edge: {d.x > 0 ? "+" : ""}{d.x}pp</div>
                    <div style={{ color: d.y === 1 ? "#45E0A8" : "#FFFFFF" }}>{d.y === 1 ? "WIN" : "LOSS"} ({d.side})</div>
                  </div>
                );
              }} />
            <ReferenceLine x={0} stroke="#FFFFFF" strokeDasharray="4 4" />
            <ReferenceLine y={0.5} stroke="#FFFFFF" strokeDasharray="2 2" />
            <Scatter data={scatterData.filter(d => d.y === 1)} fill="#45E0A8" fillOpacity={0.7} r={4} />
            <Scatter data={scatterData.filter(d => d.y === 0)} fill="#FFFFFF" fillOpacity={0.7} r={4} />
            {regression && (
              <ReferenceLine
                segment={[
                  { x: regression.xMin, y: regression.slope * regression.xMin + regression.intercept },
                  { x: regression.xMax, y: regression.slope * regression.xMax + regression.intercept },
                ]}
                stroke={regression.slope > 0 ? "#45E0A8" : "#FFFFFF"}
                strokeWidth={2} strokeDasharray="6 3"
                label={{ value: `slope: ${regression.slope > 0 ? "+" : ""}${regression.slope.toFixed(4)}`, position: "insideTopRight", fill: regression.slope > 0 ? "#45E0A8" : "#FFFFFF", fontSize: 9 }}
              />
            )}
          </ScatterChart>
        </ResponsiveContainer>
        <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 8 }}>
          <span style={{ fontSize: 9, color: "var(--primary)" }}>● WIN</span>
          <span style={{ fontSize: 9, color: "var(--foreground)" }}>● LOSS</span>
          <span style={{ fontSize: 9, color: "var(--foreground)" }}>--- REGRESSION TREND</span>
        </div>
      </div>
    </>
  );
}

// ─── Brier Heatmap (reusable) ─────────────────────────────────────────────────
function BrierHeatmap({ heatmapData, selectedCell, setSelectedCell, drilldownData, drilldownLoading }: {
  heatmapData: { heatmap: Array<{ date: string; games: number; avgFgMl: number | null; avgF5Ml: number | null; avgNrfi: number | null; avgFgTotal: number | null; avgF5Total: number | null; nullFgMl: number; nullF5Ml: number; nullNrfi: number; nullFgTotal: number; nullF5Total: number }> };
  selectedCell: { date: string; market: "fgMl" | "f5Ml" | "nrfi" | "fgTotal" | "f5Total" } | null;
  setSelectedCell: (v: { date: string; market: "fgMl" | "f5Ml" | "nrfi" | "fgTotal" | "f5Total" } | null) => void;
  drilldownData: { games: Array<Record<string, unknown>> } | null | undefined;
  drilldownLoading: boolean;
}) {
  const cellBg = (v: number | null) =>
    v == null ? "transparent" : v <= 0.15 ? "transparent" : v <= 0.22 ? "transparent" : "transparent";
  const cellColor = (v: number | null) =>
    v == null ? "var(--foreground)" : v <= 0.15 ? "var(--primary)" : v <= 0.22 ? "var(--foreground)" : "var(--foreground)";

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', marginBottom: 10 }}>
          BRIER HEATMAP — {heatmapData.heatmap.length} DATES × 5 MARKETS
          <span style={{ marginLeft: 8, color: "var(--primary)", fontSize: 8 }}>(avg per date | 🟢 ≤0.15 | 🟡 ≤0.22 | 🔴 &gt;0.22 | — = no data)</span>
        </div>
        <table style={{ borderCollapse: "collapse", fontSize: 11, fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', minWidth: 520 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              {["DATE", "GAMES", "FG ML", "F5 ML", "NRFI", "FG TOT", "F5 TOT"].map(h => (
                <th key={h} style={{ padding: "4px 10px", textAlign: h === "DATE" ? "left" : "right", color: "var(--foreground)", fontWeight: 700, letterSpacing: ".08em", fontSize: 9 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...heatmapData.heatmap].reverse().map(row => (
              <tr key={row.date} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "5px 10px", color: "var(--foreground)", fontWeight: 600, whiteSpace: "nowrap" }}>{row.date}</td>
                <td style={{ padding: "5px 10px", textAlign: "right", color: "var(--foreground)", fontSize: 9 }}>{row.games}</td>
                {(["avgFgMl", "avgF5Ml", "avgNrfi", "avgFgTotal", "avgF5Total"] as const).map(field => {
                  const v = row[field];
                  const nullCount = row[field.replace("avg", "null") as keyof typeof row] as number;
                  const marketKey = (field === "avgFgMl" ? "fgMl" : field === "avgF5Ml" ? "f5Ml" : field === "avgNrfi" ? "nrfi" : field === "avgFgTotal" ? "fgTotal" : "f5Total") as "fgMl" | "f5Ml" | "nrfi" | "fgTotal" | "f5Total";
                  const isSelected = selectedCell?.date === row.date && selectedCell?.market === marketKey;
                  return (
                    <td key={field} onClick={() => setSelectedCell(isSelected ? null : { date: row.date, market: marketKey })} style={{
                      padding: "5px 10px", textAlign: "right",
                      background: isSelected ? "transparent" : cellBg(v),
                      color: isSelected ? "var(--primary)" : cellColor(v),
                      fontWeight: 700, cursor: "pointer",
                      outline: isSelected ? "1px solid var(--primary)" : "none",
                    }}>
                      {v != null ? v.toFixed(4) : <span style={{ color: "var(--foreground)" }}>—</span>}
                      {nullCount > 0 && <span style={{ fontSize: 7, color: "var(--foreground)", marginLeft: 3 }}>({nullCount}ø)</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Drill-down panel */}
      {selectedCell && (
        <div style={{ marginTop: 16, padding: "16px 20px", background: "transparent", border: "1px solid var(--primary)", borderRadius: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "2px", color: "var(--primary)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>
              DRILL-DOWN — {selectedCell.date} / {selectedCell.market.toUpperCase()}
            </div>
            <button type="button" onClick={() => setSelectedCell(null)} style={{ background: "none", border: "none", color: "var(--foreground)", cursor: "pointer", fontSize: 14 }}>×</button>
          </div>
          {drilldownLoading ? (
            <div style={{ fontSize: 11, color: "var(--foreground)", padding: "12px 0" }}>Loading games…</div>
          ) : !drilldownData || drilldownData.games.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--foreground)", padding: "8px 0" }}>No games found for this date.</div>
          ) : (
            <table style={{ borderCollapse: "collapse", fontSize: 10, fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', width: "100%" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["MATCHUP", "BRIER", "MODEL AWAY%", "MODEL HOME%", "BOOK ML", "SCORE", "RESULT"].map(h => (
                    <th key={h} style={{ padding: "4px 8px", textAlign: h === "MATCHUP" ? "left" : "right", color: "var(--foreground)", fontWeight: 700, letterSpacing: ".08em", fontSize: 9 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {drilldownData.games.map((g: Record<string, unknown>) => {
                  const brier = g.focusBrier as number | null;
                  const bc = brier == null ? "var(--foreground)" : brier <= 0.15 ? "var(--primary)" : brier <= 0.22 ? "var(--foreground)" : "var(--foreground)";
                  const mktKey = selectedCell.market;
                  const modelAway = (mktKey === "f5Ml" || mktKey === "f5Total") ? g.modelF5AwayWinPct : g.modelAwayWinPct;
                  const modelHome = (mktKey === "f5Ml" || mktKey === "f5Total") ? g.modelF5HomeWinPct : g.modelHomeWinPct;
                  const bookAway = (mktKey === "f5Ml" || mktKey === "f5Total") ? g.f5AwayML : g.awayML;
                  const bookHome = (mktKey === "f5Ml" || mktKey === "f5Total") ? g.f5HomeML : g.homeML;
                  const result = mktKey === "f5Ml" ? g.f5MlResult : mktKey === "fgMl" ? g.fgMlResult : null;
                  const correct = mktKey === "f5Ml" ? g.f5MlCorrect : mktKey === "fgMl" ? g.fgMlCorrect : mktKey === "nrfi" ? g.nrfiCorrect : null;
                  const scoreAway = (mktKey as string).startsWith("f5") ? g.actualF5AwayScore : g.actualAwayScore;
                  const scoreHome = (mktKey as string).startsWith("f5") ? g.actualF5HomeScore : g.actualHomeScore;
                  return (
                    <tr key={g.id as number} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "5px 8px", color: "var(--foreground)", fontWeight: 600, whiteSpace: "nowrap" }}>{g.awayTeam as string} @ {g.homeTeam as string}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right", color: bc, fontWeight: 700 }}>{brier != null ? brier.toFixed(4) : <span style={{ color: "var(--foreground)" }}>—</span>}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right", color: "var(--foreground)" }}>{modelAway != null ? (modelAway as number).toFixed(1) + "%" : "—"}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right", color: "var(--foreground)" }}>{modelHome != null ? (modelHome as number).toFixed(1) + "%" : "—"}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right", color: "var(--foreground)", fontSize: 9 }}>{bookAway as string ?? "—"} / {bookHome as string ?? "—"}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right", color: "var(--foreground)" }}>{scoreAway != null && scoreHome != null ? `${scoreAway}–${scoreHome}` : "—"}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 700, color: correct === 1 ? "var(--primary)" : correct === 0 ? "var(--foreground)" : "var(--foreground)" }}>
                        {correct === 1 ? "✓" : correct === 0 ? "✗" : result as string ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Rolling Accuracy Panel ────────────────────────────────────────────────────
function RollingAccuracyPanel({ days, appUser }: { days: number; appUser: { id: number } | null }) {
  const { data, isLoading } = trpc.mlbBacktest.getRollingAccuracy.useQuery(
    { days },
    { enabled: !!appUser, refetchOnWindowFocus: false, staleTime: 5 * 60 * 1000 }
  );
  if (isLoading) return <div style={{ fontSize: 11, color: "var(--foreground)", padding: "8px 0" }}>Loading rolling accuracy…</div>;
  if (!data || data.length === 0) return <div style={{ fontSize: 11, color: "var(--foreground)", padding: "8px 0" }}>No backtest data yet.</div>;
  return (
    <StatGrid>
      {data.map(row => (
        <div key={row.market} style={{ background: "var(--background)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", minWidth: 110 }}>
          <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', marginBottom: 4 }}>{row.market.replace(/_/g, " ")}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: accuracyColor(row.accuracy), fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', lineHeight: 1 }}>
            {row.sampleSize > 0 ? `${(row.accuracy * 100).toFixed(1)}%` : "—"}
          </div>
          <div style={{ fontSize: 9, color: "var(--foreground)", marginTop: 2, fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>{row.sampleSize} graded</div>
        </div>
      ))}
    </StatGrid>
  );
}
// ─── HR Props Roww ──────────────────────────────────────────────────────────────
interface HrPropRow {
  id: number;
  gameId: number;
  playerName: string;
  teamAbbrev: string | null;
  mlbamId: number | null;
  bookLine: string | null;
  fdOverOdds: string | null;
  fdUnderOdds: string | null;
  anNoVigOverPct: string | null;
  modelPHr: string | null;
  modelOverOdds: string | null;
  edgeOver: string | null;
  evOver: string | null;
  verdict: string | null;
  actualHr: number | null;
  backtestResult: string | null;
  modelCorrect: number | null;
}

function HrPropRow({ prop, awayTeam, homeTeam }: { prop: HrPropRow; awayTeam: string; homeTeam: string }) {
  const photo = mlbPhoto(prop.mlbamId);
  const team = prop.teamAbbrev ?? "";
  const primary = teamPrimary(team);
  const logo = teamLogo(team);
  const modelPHr = prop.modelPHr ? parseFloat(prop.modelPHr) : null;
  const anNoVig = prop.anNoVigOverPct ? parseFloat(prop.anNoVigOverPct) : null;
  const edgeOver = prop.edgeOver ? parseFloat(prop.edgeOver) : null;
  const hasEdge = edgeOver != null && Math.abs(edgeOver) >= 0.02;
  const isPending = !prop.backtestResult || prop.backtestResult === "PENDING";
  const isCorrect = prop.modelCorrect === 1;

  return (
    <div style={{ background: "var(--background)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", marginBottom: 8 }}>
      <div style={{ height: 3, background: primary }} />
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px" }}>
        {/* Photo */}
        {photo
          ? <div style={{ width: 56, height: 56, borderRadius: 8, overflow: "hidden", flexShrink: 0, background: "transparent", border: `1px solid ${primary}44` }}>
              <img src={photo} alt={prop.playerName} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top center" }} />
            </div>
          : <InitialsAvatar name={prop.playerName} color={primary} size={56} />
        }
        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
            {logo && <img src={logo} alt={team} style={{ width: 18, height: 18, objectFit: "contain" }} />}
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>{prop.playerName}</span>
            <span style={{ fontSize: 10, color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>{team}</span>
          </div>
          <div style={{ fontSize: 10, color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>{awayTeam} @ {homeTeam}</div>
        </div>
        {/* Model vs Book */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end", minWidth: 0 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 8, color: "var(--foreground)", letterSpacing: 1, fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>MODEL P(HR)</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>
              {modelPHr != null ? `${(modelPHr * 100).toFixed(1)}%` : "—"}
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 8, color: "var(--foreground)", letterSpacing: 1, fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>BOOK NO-VIG</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>
              {anNoVig != null ? `${(anNoVig * 100).toFixed(1)}%` : "—"}
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 8, color: "var(--foreground)", letterSpacing: 1, fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>EDGE OVER</div>
            <div style={{ fontSize: 18, fontWeight: 800, fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', color: hasEdge ? (edgeOver! > 0 ? "var(--primary)" : "var(--foreground)") : "var(--foreground)" }}>
              {edgeOver != null ? `${edgeOver > 0 ? "+" : ""}${(edgeOver * 100).toFixed(1)}pp` : "—"}
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 8, color: "var(--foreground)", letterSpacing: 1, fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>FD ODDS</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>
              {fmtOdds(prop.fdOverOdds)}
            </div>
          </div>
          {/* Result */}
          <div>
            {isPending
              ? <span style={{ fontSize: 10, color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>PENDING</span>
              : <ResultBadge result={prop.backtestResult} correct={prop.modelCorrect} />
            }
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Pitcher Result Row (K-Props) ─────────────────────────────────────────────
interface KPropRow {
  id: number;
  gameId: number;
  pitcherName: string;
  side: string;
  mlbamId: number | null;
  awayTeam: string;
  homeTeam: string;
  startTimeEst: string | null;
  bookLine: string | null;
  kProj: string | null;
  verdict: string | null;
  bestSide: string | null;
  bestEdge: string | null;
  bestMlStr: string | null;
  pOver: string | null;
  pUnder: string | null;
  bookOverOdds: string | null;
  bookUnderOdds: string | null;
  anNoVigOverPct: string | null;
  actualKs: number | null;
  backtestResult: string | null;
  modelCorrect: number | null;
  modelError: string | null;
  backtestRunAt: number | null;
}

function KPropPitcherRow({ prop }: { prop: KPropRow }) {
  const isAway = prop.side === "away";
  const pitcherTeam = isAway ? prop.awayTeam : prop.homeTeam;
  const primary = teamPrimary(pitcherTeam);
  const logo = teamLogo(pitcherTeam);
  const photo = mlbPhoto(prop.mlbamId);
  const kProj = prop.kProj ? parseFloat(prop.kProj) : null;
  const bookLine = prop.bookLine ? parseFloat(prop.bookLine) : null;
  const modelErr = prop.modelError ? parseFloat(prop.modelError) : null;
  const isPending = !prop.backtestResult || prop.backtestResult === "PENDING";

  return (
    <div style={{ background: "var(--background)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", marginBottom: 8 }}>
      <div style={{ height: 3, background: primary }} />
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px" }}>
        {photo
          ? <div style={{ width: 56, height: 56, borderRadius: 8, overflow: "hidden", flexShrink: 0, background: "transparent", border: `1px solid ${primary}44` }}>
              <img src={photo} alt={prop.pitcherName} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top center" }} />
            </div>
          : <InitialsAvatar name={prop.pitcherName} color={primary} size={56} />
        }
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
            {logo && <img src={logo} alt={pitcherTeam} style={{ width: 18, height: 18, objectFit: "contain" }} />}
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>{prop.pitcherName}</span>
            <span style={{ fontSize: 10, color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>vs {isAway ? prop.homeTeam : prop.awayTeam}</span>
          </div>
          <div style={{ fontSize: 10, color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>{prop.awayTeam} @ {prop.homeTeam}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ textAlign: "center", minWidth: 44 }}>
            <div style={{ fontSize: 8, color: "var(--foreground)", letterSpacing: 1, fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>PROJ Ks</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', lineHeight: 1 }}>{kProj != null ? kProj.toFixed(1) : "—"}</div>
          </div>
          <div style={{ textAlign: "center", minWidth: 52 }}>
            <div style={{ fontSize: 8, color: "var(--foreground)", letterSpacing: 1, fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>BOOK LINE</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', lineHeight: 1 }}>{bookLine != null ? bookLine.toFixed(1) : "—"}</div>
          </div>
          {prop.actualKs != null && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 8, color: "var(--foreground)", letterSpacing: 1, fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>ACTUAL</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "var(--primary)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', lineHeight: 1 }}>{prop.actualKs}</div>
            </div>
          )}
          {modelErr != null && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 8, color: "var(--foreground)", letterSpacing: 1, fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>ERROR</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: Math.abs(modelErr) <= 0.5 ? "var(--primary)" : Math.abs(modelErr) <= 1.5 ? "var(--foreground)" : "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', lineHeight: 1 }}>{signedNum(modelErr, 1)}</div>
            </div>
          )}
          <div>
            <VerdictBadge verdict={prop.verdict} bestSide={prop.bestSide} bestEdge={prop.bestEdge} bestMlStr={prop.bestMlStr} />
          </div>
          <div>
            {isPending
              ? <span style={{ fontSize: 10, color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>PENDING</span>
              : <ResultBadge result={prop.backtestResult} correct={prop.modelCorrect} />
            }
          </div>
        </div>
      </div>
      {/* O/U breakdown */}
      {(prop.pOver || prop.pUnder) && (
        <div style={{ display: "flex", gap: 8, padding: "0 14px 10px", marginTop: -4 }}>
          <div style={{ flex: 1, padding: "6px 10px", borderRadius: 6, background: "transparent", border: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>OVER {fmtNum(prop.bookLine, 1)}</span>
            <span style={{ fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 14, fontWeight: 800, color: "var(--foreground)" }}>{prop.pOver ? fmtPct(parseFloat(prop.pOver)) : "—"}</span>
            <span style={{ fontSize: 10, color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>{fmtOdds(prop.bookOverOdds)}</span>
          </div>
          <div style={{ flex: 1, padding: "6px 10px", borderRadius: 6, background: "transparent", border: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>UNDER {fmtNum(prop.bookLine, 1)}</span>
            <span style={{ fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 14, fontWeight: 800, color: "var(--foreground)" }}>{prop.pUnder ? fmtPct(parseFloat(prop.pUnder)) : "—"}</span>
            <span style={{ fontSize: 10, color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>{fmtOdds(prop.bookUnderOdds)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Market tab type ──────────────────────────────────────────────────────────
type MarketTab = "fullgame" | "first5" | "firstinning" | "kprops" | "hrprops";

// ─── Main Component ───────────────────────────────────────────────────────────
export default function TheModelResults() {
  const [, setLocation] = useLocation();
  const { appUser, isOwner, loading: authLoading } = useAppAuth();

  // ── Market tab ────────────────────────────────────────────────────────────
  const [marketTab, setMarketTab] = useState<MarketTab>("fullgame");

  // ── Date navigation (shared across K-Props, HR Props, 1st Inning daily views) ──
  const [gameDate, setGameDate] = useState(() => todayPst());

  // ── Brier window ──────────────────────────────────────────────────────────
  const [brierWindow, setBrierWindow] = useState(20);

  // ── Brier sub-tab (trend | heatmap) ──────────────────────────────────────
  const [brierSubTab, setBrierSubTab] = useState<"trend" | "heatmap">("trend");

  // ── Heatmap selected cell ─────────────────────────────────────────────────
  const [selectedCell, setSelectedCell] = useState<{ date: string; market: "fgMl" | "f5Ml" | "nrfi" | "fgTotal" | "f5Total" } | null>(null);

  // ── Edge leaderboard sub-tab (table | scatter) ────────────────────────────
  const [fgEdgeTab, setFgEdgeTab] = useState<"table" | "scatter">("table");
  const [f5EdgeTab, setF5EdgeTab] = useState<"table" | "scatter">("table");

  // ── Edge leaderboard filters (FG) ────────────────────────────────────────
  const [fgMinEdge, setFgMinEdge] = useState(0);
  const [fgSide, setFgSide] = useState<"away" | "home" | "both">("both");
  const [fgWithOutcome, setFgWithOutcome] = useState(false);
  const [fgSortBy, setFgSortBy] = useState<"edge" | "date" | "brier">("edge");
  const [fgLimit, setFgLimit] = useState(200);

  // ── Edge leaderboard filters (F5) ────────────────────────────────────────
  const [f5MinEdge, setF5MinEdge] = useState(0);
  const [f5Side, setF5Side] = useState<"away" | "home" | "both">("both");
  const [f5WithOutcome, setF5WithOutcome] = useState(false);
  const [f5SortBy, setF5SortBy] = useState<"edge" | "date" | "brier">("edge");
  const [f5Limit, setF5Limit] = useState(200);

  // ── K-Props view mode ─────────────────────────────────────────────────────
  const [kPropsView, setKPropsView] = useState<"daily" | "last7">("daily");

  // ── Refresh state ─────────────────────────────────────────────────────────
  const [isRefreshing, setIsRefreshing] = useState(false);

  // ── Re-ingest per date ────────────────────────────────────────────────────
  const [reingestingDate, setReingestingDate] = useState<string | null>(null);

  // ── Auth guard ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authLoading && (!appUser || !isOwner)) setLocation("/feed/model/mlb");
  }, [authLoading, appUser, isOwner, setLocation]);

  // ─── tRPC Queries ─────────────────────────────────────────────────────────

  // Brier Trend (all markets — used by FULL GAME and FIRST 5 tabs)
  const { data: brierData, isLoading: brierLoading, refetch: refetchBrier } = trpc.mlbSchedule.getBrierTrend.useQuery(
    { windowSize: brierWindow, sport: "MLB" },
    { enabled: !!appUser && isOwner, refetchOnWindowFocus: false, staleTime: 5 * 60 * 1000 }
  );

  // Brier Heatmap
  const { data: heatmapData, isLoading: heatmapLoading, refetch: refetchHeatmap } = trpc.mlbSchedule.getBrierHeatmap.useQuery(
    { sport: "MLB" },
    { enabled: !!appUser && isOwner && brierSubTab === "heatmap", refetchOnWindowFocus: false }
  );

  // Heatmap drill-down
  const { data: drilldownData, isLoading: drilldownLoading } = trpc.mlbSchedule.getBrierDrilldown.useQuery(
    selectedCell ?? { date: "2026-01-01", market: "fgMl" },
    { enabled: !!appUser && isOwner && selectedCell != null, refetchOnWindowFocus: false }
  );

  // Drift
  const { data: driftData } = trpc.mlbSchedule.checkDrift.useQuery(
    { triggerRecal: false },
    { enabled: !!appUser && isOwner, refetchOnWindowFocus: false, staleTime: 5 * 60 * 1000 }
  );

  // FG ML Edge Leaderboard — dedicated procedure with FG ML fields (awayML, homeML, fgMlResult, fgMlCorrect, brierFgMl)
  const { data: fgEdgeData, isLoading: fgEdgeLoading, refetch: refetchFgEdge } = trpc.mlbSchedule.getFgEdgeLeaderboard.useQuery(
    { minEdge: fgMinEdge, side: fgSide, withOutcome: fgWithOutcome, limit: fgLimit },
    { enabled: !!appUser && isOwner && marketTab === "fullgame", refetchOnWindowFocus: false }
  );

  // F5 ML Edge Leaderboard
  const { data: f5EdgeData, isLoading: f5EdgeLoading, refetch: refetchF5Edge } = trpc.mlbSchedule.getF5EdgeLeaderboard.useQuery(
    { minEdge: f5MinEdge, side: f5Side, withOutcome: f5WithOutcome, limit: f5Limit },
    { enabled: !!appUser && isOwner && marketTab === "first5", refetchOnWindowFocus: false }
  );

  // K-Props daily
  const { data: kDailyData, isLoading: kDailyLoading, refetch: refetchKDaily } = trpc.strikeoutProps.getRichDailyBacktest.useQuery(
    { gameDate },
    { enabled: !!appUser && isOwner && marketTab === "kprops" && kPropsView === "daily", refetchOnWindowFocus: false }
  );

  // K-Props last 7
  const { data: kLast7Data, isLoading: kLast7Loading, refetch: refetchKLast7 } = trpc.strikeoutProps.getLast7DaysBacktest.useQuery(
    { days: 7 },
    { enabled: !!appUser && isOwner && marketTab === "kprops" && kPropsView === "last7", refetchOnWindowFocus: false }
  );

  // K-Props calibration
  const { data: kCalibData, isLoading: kCalibLoading } = trpc.strikeoutProps.getCalibrationMetrics.useQuery(
    undefined,
    { enabled: !!appUser && isOwner && marketTab === "kprops", refetchOnWindowFocus: false }
  );

  // HR Props by date (uses hrProps.getByGames via listGamesByDate — we'll query games for the date then fetch props)
  // We use the mlbSchedule.listGames query to get game IDs for the selected date, then hrProps.getByGames
  const { data: hrGamesData } = trpc.games.list.useQuery(
    { gameDate: gameDate, sport: "MLB" },
    { enabled: !!appUser && isOwner && marketTab === "hrprops", refetchOnWindowFocus: false }
  );
  const hrGameIds = useMemo(() => (hrGamesData ?? []).map((g: { id: number }) => g.id), [hrGamesData]);
  const { data: hrPropsData, isLoading: hrPropsLoading } = trpc.hrProps.getByGames.useQuery(
    { gameIds: hrGameIds },
    { enabled: !!appUser && isOwner && marketTab === "hrprops" && hrGameIds.length > 0, refetchOnWindowFocus: false }
  );

  // K-Props mlbamId backfill mutation
  const [backfillStatus, setBackfillStatus] = useState<string | null>(null);
  const backfillMutation = trpc.mlbBacktest.backfillKPropsMlbamIds.useMutation({
    onSuccess: (data) => {
      const msg = `Backfill complete: ${data.resolved} resolved, ${data.alreadyHad} already had ID, ${data.unresolved} unresolved, ${data.errors} errors`;
      setBackfillStatus(msg);
      toast.success(msg);
      refetchKDaily();
    },
    onError: (err) => {
      toast.error(`Backfill failed: ${err.message}`);
      setBackfillStatus(`Error: ${err.message}`);
    },
  });

  // Re-ingest mutation
  const reingestMutation = trpc.mlbSchedule.triggerOutcomeIngestion.useMutation({
    onSuccess: (data, vars) => {
      toast.success(`Re-ingested ${vars.dateStr}: ${data.written} written, ${data.errors} errors`);
      setReingestingDate(null);
      refetchBrier();
    },
    onError: (err, vars) => {
      toast.error(`Re-ingest failed for ${vars.dateStr}: ${err.message}`);
      setReingestingDate(null);
    },
  });

  // Brier chart data (merged rolling + per-game)
  // ─── HR props flat list for selected date ─────────────────────────────────
  // MUST be above early returns — React Error #310 fix
  const hrPropsList = useMemo(() => {
    if (!hrPropsData?.propsByGame) return [];
    const games = hrGamesData ?? [];
    const list: Array<HrPropRow & { awayTeam: string; homeTeam: string }> = [];
    for (const [gameIdStr, props] of Object.entries(hrPropsData.propsByGame)) {
      const gameId = parseInt(gameIdStr, 10);
      const game = games.find((g: { id: number }) => g.id === gameId);
      for (const p of props as HrPropRow[]) {
        list.push({ ...p, awayTeam: game?.awayTeam ?? "?", homeTeam: game?.homeTeam ?? "?" });
      }
    }
    return list.sort((a, b) => {
      const edgeA = a.edgeOver ? parseFloat(a.edgeOver) : -999;
      const edgeB = b.edgeOver ? parseFloat(b.edgeOver) : -999;
      return edgeB - edgeA;
    });
  }, [hrPropsData, hrGamesData]);

  // ─── FG edge rows — MUST be above early returns — React Error #310 fix ────
  const fgRows: EdgeRow[] = useMemo(() => (fgEdgeData?.rows ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as number,
    gameDate: r.gameDate as string | null,
    awayTeam: r.awayTeam as string,
    homeTeam: r.homeTeam as string,
    side: r.side as string,
    modelWinPct: r.modelWinPct as number,
    bookImpliedPct: r.bookImpliedPct as number,
    edgePct: r.edgePct as number,
    awayML: r.awayML as string | null,
    homeML: r.homeML as string | null,
    actualAwayScore: r.actualAwayScore as number | null,
    actualHomeScore: r.actualHomeScore as number | null,
    fgMlResult: r.fgMlResult as string | null,
    fgMlCorrect: r.fgMlCorrect as number | null,
    brierFgMl: r.brierFgMl as string | null,
  })), [fgEdgeData]);

  // ─── F5 edge rows — MUST be above early returns — React Error #310 fix ────
  const f5Rows: EdgeRow[] = useMemo(() => (f5EdgeData?.rows ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as number,
    gameDate: r.gameDate as string | null,
    awayTeam: r.awayTeam as string,
    homeTeam: r.homeTeam as string,
    side: r.side as string,
    modelWinPct: r.modelWinPct as number,
    bookImpliedPct: r.bookImpliedPct as number,
    edgePct: r.edgePct as number,
    f5AwayML: r.f5AwayML as string | null,
    f5HomeML: r.f5HomeML as string | null,
    actualF5AwayScore: r.actualF5AwayScore as number | null,
    actualF5HomeScore: r.actualF5HomeScore as number | null,
    f5MlResult: r.f5MlResult as string | null,
    f5MlCorrect: r.f5MlCorrect as number | null,
    brierF5Ml: r.brierF5Ml as string | null,
  })), [f5EdgeData]);

  const brierChartData = useMemo(() => {
    if (!brierData) return [];
    const rollingMap = new Map(brierData.rolling.map((r: Record<string, unknown>) => [r.gameIndex, r]));
    return brierData.games.map((g: Record<string, unknown>) => ({ ...g, ...(rollingMap.get(g.gameIndex) ?? {}) }));
  }, [brierData]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([refetchBrier(), refetchFgEdge(), refetchF5Edge()]);
      if (marketTab === "kprops") {
        if (kPropsView === "daily") await refetchKDaily();
        else await refetchKLast7();
      }
      if (brierSubTab === "heatmap") await refetchHeatmap();
      toast.success("Refreshed");
    } catch { toast.error("Refresh failed"); }
    finally { setIsRefreshing(false); }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--background)" }}>
        <Loader2 className="animate-spin" style={{ color: "var(--primary)" }} />
      </div>
    );
  }
  if (!isOwner) return null;

  // ─── Market tab config ────────────────────────────────────────────────────
  const MARKET_TABS: { id: MarketTab; label: string; color: string }[] = [
    { id: "fullgame",    label: "FULL GAME",       color: "var(--primary)" },
    { id: "first5",      label: "FIRST 5 INNINGS", color: "var(--primary)" },
    { id: "firstinning", label: "1ST INNING",       color: "var(--primary)" },
    { id: "kprops",      label: "K-PROPS",          color: "var(--primary)" },
    { id: "hrprops",     label: "HR PROPS",         color: "var(--primary)" },
  ];
  const activeTab = MARKET_TABS.find(t => t.id === marketTab)!;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <AdminShell active="model-results">
    <div style={{ background: "var(--background)" }}>

      {/* ── Sticky header ──────────────────────────────────────────────────── */}
      {/* Back button removed — now owned by AdminShell's back-to-app affordance
          + registry-driven tab nav (includes direct links to Publish/Backtest). */}
      <header className="sticky top-14 z-40 bg-background backdrop-blur-sm border-b border-border">
        <div className="relative flex items-center px-4 py-2 max-w-6xl mx-auto">
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 pointer-events-none">
            <FlaskConical size={16} style={{ color: "var(--primary)" }} />
            <span className="font-black text-foreground whitespace-nowrap" style={{ fontSize: "clamp(13px, 3vw, 18px)", letterSpacing: "0.08em" }}>
              THE MODEL RESULTS
            </span>
            <span className="text-foreground" style={{ fontSize: "clamp(10px, 2vw, 14px)" }}>|</span>
            <span className="font-medium whitespace-nowrap" style={{ fontSize: "clamp(10px, 2vw, 13px)", letterSpacing: "0.1em", color: activeTab.color }}>
              {activeTab.label}
            </span>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setLocation("/admin/backtest")}
              className="gap-1.5 text-xs h-8 font-medium border-border text-foreground">
              <BarChart3 size={12} />
              Backtest
            </Button>
            <Button size="sm" onClick={handleRefresh} disabled={isRefreshing}
              className="gap-1.5 text-xs h-8 font-bold border"
              style={{ background: "transparent", color: "var(--primary)", borderColor: "var(--primary)" }}>
              {isRefreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Refresh
            </Button>
          </div>
        </div>

        {/* Market tabs */}
        <div className="px-4 pb-2 max-w-6xl mx-auto flex items-center gap-1.5 overflow-x-auto scrollbar-hide" style={{ WebkitOverflowScrolling: "touch" }}>
          {MARKET_TABS.map(tab => (
            <button type="button" key={tab.id} onClick={() => setMarketTab(tab.id)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-colors whitespace-nowrap flex-shrink-0"
              style={{
                background: "transparent",
                color: marketTab === tab.id ? tab.color : "var(--foreground)",
                border: `1px solid ${marketTab === tab.id ? tab.color : "var(--border)"}`,
                fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', letterSpacing: "0.08em",
              }}>
              {tab.label}
            </button>
          ))}

          {/* Date nav — K-Props, HR Props, 1st Inning daily views */}
          {(marketTab === "kprops" || marketTab === "hrprops" || marketTab === "firstinning") && (
            <>
              <div style={{ flex: 1 }} />
              <button type="button" onClick={() => setGameDate(d => addDays(d, -1))} className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors flex-shrink-0">
                <ChevronLeft size={14} style={{ color: "var(--foreground)" }} />
              </button>
              <span className="text-xs font-bold text-foreground tracking-wide whitespace-nowrap">{formatDateNav(gameDate)}</span>
              {gameDate === todayPst() && (
                <span className="text-sm font-semibold px-1.5 py-0.5 rounded" style={{ background: "transparent", color: "var(--primary)" }}>TODAY</span>
              )}
              <button type="button" onClick={() => setGameDate(d => addDays(d, 1))} className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors flex-shrink-0">
                <ChevronRight size={14} style={{ color: "var(--foreground)" }} />
              </button>
            </>
          )}

          {/* Brier sub-tabs — Full Game and First 5 */}
          {(marketTab === "fullgame" || marketTab === "first5") && (
            <>
              <div style={{ flex: 1 }} />
              {(["trend", "heatmap"] as const).map(st => (
                <button type="button" key={st} onClick={() => setBrierSubTab(st)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-colors"
                  style={{
                    background: brierSubTab === st ? "transparent" : "transparent",
                    color: brierSubTab === st ? "var(--primary)" : "var(--foreground)",
                    border: `1px solid ${brierSubTab === st ? "var(--primary)" : "var(--border)"}`,
                    fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', letterSpacing: ".08em",
                  }}>
                  {st === "trend" ? <TrendingUp size={10} /> : <BarChart3 size={10} />}
                  {st.toUpperCase()}
                </button>
              ))}
              {/* Brier window */}
              {brierSubTab === "trend" && (
                <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 4 }}>
                  {[10, 20, 30, 50].map(w => (
                    <button type="button" key={w} onClick={() => setBrierWindow(w)} style={{
                      fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 5,
                      background: brierWindow === w ? "transparent" : "transparent",
                      color: brierWindow === w ? "var(--primary)" : "var(--foreground)",
                      border: `1px solid ${brierWindow === w ? "var(--primary)" : "var(--border)"}`,
                      cursor: "pointer", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif',
                    }}>{w}G</button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </header>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <main className="max-w-6xl mx-auto px-4 py-4 pb-16">

        {/* ── DRIFT BANNER ─────────────────────────────────────────────────── */}
        {driftData && driftData.driftDetected && (
          <div style={{ marginBottom: 16, padding: "10px 16px", background: "transparent", border: "1px solid var(--border)", borderRadius: 8, display: "flex", alignItems: "center", gap: 10 }}>
            <Activity size={14} style={{ color: "var(--foreground)", flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--foreground)", letterSpacing: "1px", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>DRIFT DETECTED</span>
              <span style={{ fontSize: 10, color: "var(--foreground)", marginLeft: 8, fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>
                {driftData.message ?? "F5 share deviation exceeds threshold — recalibration recommended"}
              </span>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* FULL GAME TAB                                                     */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {marketTab === "fullgame" && (
          <SectionErrorBoundary label="FULL GAME">
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

            {/* Rolling Accuracy */}
            <div>
              <SectionLabel sub={`Last 30 days · mlb_game_backtest table`}>ROLLING ACCURACY — FULL GAME MARKETS</SectionLabel>
              <RollingAccuracyPanel days={30} appUser={appUser} />
            </div>

            {/* Brier Summary Cards */}
            {brierData && (
              <div>
                <SectionLabel>BRIER SCORE SUMMARY — FG ML + FG TOTAL</SectionLabel>
                <StatGrid>
                  <StatCard label="FG ML AVG BRIER" value={brierData.summary.avgFgMl != null ? brierData.summary.avgFgMl.toFixed(4) : "—"} color={brierData.summary.avgFgMl != null ? brierColor(brierData.summary.avgFgMl) : undefined} sub="lower = better · random = 0.25" />
                  <StatCard label="FG TOTAL AVG BRIER" value={brierData.summary.avgFgTotal != null ? brierData.summary.avgFgTotal.toFixed(4) : "—"} color={brierData.summary.avgFgTotal != null ? brierColor(brierData.summary.avgFgTotal) : undefined} sub="lower = better · random = 0.25" />
                  <StatCard label="GAMES SCORED" value={String(brierData.summary.totalGames)} sub="with outcomes ingested" />
                </StatGrid>
              </div>
            )}

            {/* Brier Trend / Heatmap */}
            {brierSubTab === "trend" && (
              <div>
                <SectionLabel>BRIER TREND — FG ML (solid) + FG TOTAL (dashed)</SectionLabel>
                {brierLoading ? (
                  <div className="flex items-center justify-center py-8 gap-3"><Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--primary)" }} /><span className="text-sm text-foreground">Loading…</span></div>
                ) : !brierData || brierData.summary.totalGames === 0 ? (
                  <div className="text-center py-12 text-foreground text-sm">No Brier data yet. Run outcome ingestion first.</div>
                ) : (
                  <BrierTrendChart
                    data={brierChartData}
                    lines={[
                      { key: "rollingFgMl", label: `FG ML (${brierWindow}G)`, color: "var(--primary)" },
                      { key: "rollingFgTotal", label: `FG Total (${brierWindow}G)`, color: "var(--primary)", dashed: true },
                    ]}
                    windowSize={brierWindow}
                    onWindowChange={setBrierWindow}
                  />
                )}
              </div>
            )}

            {brierSubTab === "heatmap" && (
              <div>
                <SectionLabel>BRIER HEATMAP — ALL MARKETS × ALL DATES</SectionLabel>
                {heatmapLoading ? (
                  <div className="flex items-center justify-center py-8 gap-3"><Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--primary)" }} /></div>
                ) : !heatmapData ? (
                  <div className="text-center py-12 text-foreground text-sm">No heatmap data yet.</div>
                ) : (
                  <BrierHeatmap
                    heatmapData={heatmapData}
                    selectedCell={selectedCell}
                    setSelectedCell={setSelectedCell}
                    drilldownData={drilldownData}
                    drilldownLoading={drilldownLoading}
                  />
                )}
              </div>
            )}

            {/* FG ML Edge Leaderboard */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <SectionLabel>FG ML EDGE LEADERBOARD — MODEL WIN% vs NO-VIG BOOK IMPLIED%</SectionLabel>
                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  {(["table", "scatter"] as const).map(t => (
                    <button type="button" key={t} onClick={() => setFgEdgeTab(t)} style={{
                      background: fgEdgeTab === t ? "var(--primary)" : "var(--background)", border: "1px solid var(--border)",
                      borderRadius: 4, cursor: "pointer", color: fgEdgeTab === t ? "var(--primary-foreground)" : "var(--foreground)",
                      padding: "3px 10px", fontSize: 10, fontWeight: 700,
                      fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', letterSpacing: 1,
                    }}>{t === "table" ? "📋 TABLE" : "📊 SCATTER"}</button>
                  ))}
                </div>
              </div>

              {/* FG edge summary */}
              {fgEdgeData?.summary && (
                <StatGrid minColWidth={120}>
                  {[
                    { label: "TOTAL GAMES", value: fgEdgeData.summary.totalGames, color: "var(--foreground)" },
                    { label: "POSITIVE EDGE", value: fgEdgeData.summary.positiveEdge, color: "var(--primary)" },
                    { label: "NEGATIVE EDGE", value: fgEdgeData.summary.negativeEdge, color: "var(--foreground)" },
                    { label: "AVG +EDGE", value: `+${fgEdgeData.summary.avgPositiveEdge.toFixed(2)}pp`, color: "var(--primary)" },
                    { label: "WIN RATE (POS EDGE)", value: fgEdgeData.summary.winRateOnPositiveEdge != null ? `${fgEdgeData.summary.winRateOnPositiveEdge}%` : "PENDING", color: "var(--foreground)" },
                  ].map(c => <MiniStatCard key={c.label} label={c.label} value={c.value} color={c.color} />)}
                </StatGrid>
              )}

              {fgEdgeLoading ? (
                <div className="flex items-center justify-center py-8 gap-3"><Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--primary)" }} /></div>
              ) : fgEdgeTab === "table" ? (
                <EdgeLeaderboardTable
                  rows={fgRows} market="fg"
                  minEdge={fgMinEdge} setMinEdge={setFgMinEdge}
                  side={fgSide} setSide={setFgSide}
                  withOutcome={fgWithOutcome} setWithOutcome={setFgWithOutcome}
                  sortBy={fgSortBy} setSortBy={setFgSortBy}
                  limit={fgLimit} setLimit={setFgLimit}
                />
              ) : (
                <EdgeScatterPlot rows={fgRows} market="fg" />
              )}
            </div>
          </div>
          </SectionErrorBoundary>
        )}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* FIRST 5 INNINGS TABB                                               */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {marketTab === "first5" && (
          <SectionErrorBoundary label="FIRST 5 INNINGS">
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

            {/* Rolling Accuracy */}
            <div>
              <SectionLabel sub="Last 30 days · mlb_game_backtest table">ROLLING ACCURACY — F5 MARKETS</SectionLabel>
              <RollingAccuracyPanel days={30} appUser={appUser} />
            </div>

            {/* Brier Summary */}
            {brierData && (
              <div>
                <SectionLabel>BRIER SCORE SUMMARY — F5 ML + F5 TOTAL</SectionLabel>
                <StatGrid>
                  <StatCard label="F5 ML AVG BRIER" value={brierData.summary.avgF5Ml != null ? brierData.summary.avgF5Ml.toFixed(4) : "—"} color={brierData.summary.avgF5Ml != null ? brierColor(brierData.summary.avgF5Ml) : undefined} sub="lower = better · random = 0.25" />
                  <StatCard label="F5 TOTAL AVG BRIER" value={brierData.summary.avgF5Total != null ? brierData.summary.avgF5Total.toFixed(4) : "—"} color={brierData.summary.avgF5Total != null ? brierColor(brierData.summary.avgF5Total) : undefined} sub="lower = better · random = 0.25" />
                  <StatCard label="GAMES SCORED" value={String(brierData.summary.totalGames)} sub="with outcomes ingested" />
                </StatGrid>
              </div>
            )}

            {/* Brier Trend / Heatmap */}
            {brierSubTab === "trend" && (
              <div>
                <SectionLabel>BRIER TREND — F5 ML (solid) + F5 TOTAL (dashed)</SectionLabel>
                {brierLoading ? (
                  <div className="flex items-center justify-center py-8 gap-3"><Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--primary)" }} /></div>
                ) : !brierData || brierData.summary.totalGames === 0 ? (
                  <div className="text-center py-12 text-foreground text-sm">No Brier data yet.</div>
                ) : (
                  <BrierTrendChart
                    data={brierChartData}
                    lines={[
                      { key: "rollingF5Ml", label: `F5 ML (${brierWindow}G)`, color: "var(--primary)" },
                      { key: "rollingF5Total", label: `F5 Total (${brierWindow}G)`, color: "var(--primary)", dashed: true },
                    ]}
                    windowSize={brierWindow}
                    onWindowChange={setBrierWindow}
                  />
                )}
              </div>
            )}

            {brierSubTab === "heatmap" && (
              <div>
                <SectionLabel>BRIER HEATMAP — ALL MARKETS × ALL DATES</SectionLabel>
                {heatmapLoading ? (
                  <div className="flex items-center justify-center py-8 gap-3"><Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--primary)" }} /></div>
                ) : !heatmapData ? (
                  <div className="text-center py-12 text-foreground text-sm">No heatmap data yet.</div>
                ) : (
                  <BrierHeatmap
                    heatmapData={heatmapData}
                    selectedCell={selectedCell}
                    setSelectedCell={setSelectedCell}
                    drilldownData={drilldownData}
                    drilldownLoading={drilldownLoading}
                  />
                )}
              </div>
            )}

            {/* F5 ML Edge Leaderboard */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <SectionLabel>F5 ML EDGE LEADERBOARD — MODEL WIN% vs NO-VIG BOOK IMPLIED%</SectionLabel>
                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  {(["table", "scatter"] as const).map(t => (
                    <button type="button" key={t} onClick={() => setF5EdgeTab(t)} style={{
                      background: f5EdgeTab === t ? "var(--primary)" : "var(--background)", border: "1px solid var(--border)",
                      borderRadius: 4, cursor: "pointer", color: f5EdgeTab === t ? "var(--primary-foreground)" : "var(--foreground)",
                      padding: "3px 10px", fontSize: 10, fontWeight: 700,
                      fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', letterSpacing: 1,
                    }}>{t === "table" ? "📋 TABLE" : "📊 SCATTER"}</button>
                  ))}
                </div>
              </div>

              {f5EdgeData?.summary && (
                <StatGrid minColWidth={120}>
                  {[
                    { label: "TOTAL GAMES", value: f5EdgeData.summary.totalGames, color: "var(--foreground)" },
                    { label: "POSITIVE EDGE", value: f5EdgeData.summary.positiveEdge, color: "var(--primary)" },
                    { label: "NEGATIVE EDGE", value: f5EdgeData.summary.negativeEdge, color: "var(--foreground)" },
                    { label: "AVG +EDGE", value: `+${f5EdgeData.summary.avgPositiveEdge.toFixed(2)}pp`, color: "var(--primary)" },
                    { label: "WIN RATE (POS EDGE)", value: f5EdgeData.summary.winRateOnPositiveEdge != null ? `${f5EdgeData.summary.winRateOnPositiveEdge}%` : "PENDING", color: "var(--foreground)" },
                  ].map(c => <MiniStatCard key={c.label} label={c.label} value={c.value} color={c.color} />)}
                </StatGrid>
              )}

              {f5EdgeLoading ? (
                <div className="flex items-center justify-center py-8 gap-3"><Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--primary)" }} /></div>
              ) : f5EdgeTab === "table" ? (
                <EdgeLeaderboardTable
                  rows={f5Rows} market="f5"
                  minEdge={f5MinEdge} setMinEdge={setF5MinEdge}
                  side={f5Side} setSide={setF5Side}
                  withOutcome={f5WithOutcome} setWithOutcome={setF5WithOutcome}
                  sortBy={f5SortBy} setSortBy={setF5SortBy}
                  limit={f5Limit} setLimit={setF5Limit}
                />
              ) : (
                <EdgeScatterPlot rows={f5Rows} market="f5" />
              )}
            </div>
          </div>
          </SectionErrorBoundary>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* 1ST INNING TAB                                                    */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {marketTab === "firstinning" && (
          <SectionErrorBoundary label="1ST INNING">
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

            {/* Rolling Accuracy */}
            <div>
              <SectionLabel sub="Last 30 days · mlb_game_backtest table">ROLLING ACCURACY — NRFI/YRFI</SectionLabel>
              <RollingAccuracyPanel days={30} appUser={appUser} />
            </div>

            {/* Brier Summary */}
            {brierData && (
              <div>
                <SectionLabel>BRIER SCORE SUMMARY — NRFI</SectionLabel>
                <StatGrid>
                  <StatCard label="NRFI AVG BRIER" value={brierData.summary.avgNrfi != null ? brierData.summary.avgNrfi.toFixed(4) : "—"} color={brierData.summary.avgNrfi != null ? brierColor(brierData.summary.avgNrfi) : undefined} sub="lower = better · random = 0.25" />
                  <StatCard label="GAMES SCORED" value={String(brierData.summary.totalGames)} sub="with outcomes ingested" />
                </StatGrid>
              </div>
            )}

            {/* NRFI Brier Trend */}
            <div>
              <SectionLabel>NRFI BRIER TREND</SectionLabel>
              {brierLoading ? (
                <div className="flex items-center justify-center py-8 gap-3"><Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--primary)" }} /></div>
              ) : !brierData || brierData.summary.totalGames === 0 ? (
                <div className="text-center py-12 text-foreground text-sm">No Brier data yet.</div>
              ) : (
                <BrierTrendChart
                  data={brierChartData}
                  lines={[{ key: "rollingNrfi", label: `NRFI (${brierWindow}G)`, color: "var(--primary)" }]}
                  windowSize={brierWindow}
                  onWindowChange={setBrierWindow}
                />
              )}
            </div>

            {/* NRFI Heatmap */}
            {brierSubTab === "heatmap" && heatmapData && (
              <div>
                <SectionLabel>BRIER HEATMAP — NRFI COLUMN</SectionLabel>
                <BrierHeatmap
                  heatmapData={heatmapData}
                  selectedCell={selectedCell}
                  setSelectedCell={setSelectedCell}
                  drilldownData={drilldownData}
                  drilldownLoading={drilldownLoading}
                />
              </div>
            )}

            {/* Daily NRFI results from heatmap drill-down */}
            <div>
              <SectionLabel sub={`Date: ${formatDateNav(gameDate)}`}>DAILY NRFI RESULTS</SectionLabel>
              <div style={{ fontSize: 11, color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', padding: "12px 0" }}>
                Use the Brier Heatmap above to drill into per-game NRFI results by clicking any NRFI cell.
                Date navigation (arrows above) selects the date for K-Props and HR Props daily views.
              </div>
            </div>
          </div>
          </SectionErrorBoundary>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* K-PROPS TAB                                                       */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {marketTab === "kprops" && (
          <SectionErrorBoundary label="K-PROPS">
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            {/* View toggle */}
            <div style={{ display: "flex", gap: 6 }}>
              {(["daily", "last7"] as const).map(v => (
                <button type="button" key={v} onClick={() => setKPropsView(v)}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-colors"
                  style={{
                    background: kPropsView === v ? "transparent" : "transparent",
                    color: kPropsView === v ? "var(--primary)" : "var(--foreground)",
                    border: `1px solid ${kPropsView === v ? "var(--primary)" : "var(--border)"}`,
                    fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', letterSpacing: "0.08em",
                  }}>
                  {v === "daily" ? <Calendar size={11} /> : <CalendarDays size={11} />}
                  {v === "daily" ? "DAILY" : "LAST 7 DAYS"}
                </button>
              ))}
            </div>

            {/* MLB Headshot Backfill Tool */}
            <div style={{ padding: "10px 14px", background: "transparent", border: "1px solid var(--border)", borderRadius: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', marginBottom: 2 }}>MLB HEADSHOT BACKFILL</div>
                <div style={{ fontSize: 10, color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>
                  {backfillStatus ?? "Resolves MLBAM IDs for all K-Props pitchers missing headshots. Calls MLB Stats API."}
                </div>
              </div>
              <Button size="sm" variant="outline"
                disabled={backfillMutation.isPending}
                onClick={() => { setBackfillStatus(null); backfillMutation.mutate(); }}
                style={{ borderColor: "var(--primary)", color: "var(--primary)", flexShrink: 0 }}
                className="gap-1.5 text-xs h-7">
                {backfillMutation.isPending ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                BACKFILL IDs
              </Button>
            </div>

            {/* Calibration metrics (always shown) */}
            {!kCalibLoading && kCalibData?.metrics && (
              <div>
                <SectionLabel>ROLLING CALIBRATION — ALL TIME ({kCalibData.metrics.completedProps} props)</SectionLabel>
                <StatGrid>
                  <StatCard label="MODEL ACCURACY" value={fmtPct(kCalibData.metrics.modelAccuracy)} sub={`${kCalibData.metrics.completedProps} completed`} color={accuracyColor(kCalibData.metrics.modelAccuracy)} />
                  <StatCard label="OVER ACCURACY" value={fmtPct(kCalibData.metrics.modelOverAccuracy)} sub={`${kCalibData.metrics.overCount} overs`} color={accuracyColor(kCalibData.metrics.modelOverAccuracy)} />
                  <StatCard label="UNDER ACCURACY" value={fmtPct(kCalibData.metrics.modelUnderAccuracy)} sub={`${kCalibData.metrics.underCount} unders`} color={accuracyColor(kCalibData.metrics.modelUnderAccuracy)} />
                  <StatCard label="ROLLING MAE" value={fmtNum(kCalibData.metrics.mae, 3)} sub="mean absolute error" color={kCalibData.metrics.mae <= 0.8 ? "var(--primary)" : kCalibData.metrics.mae <= 1.5 ? "var(--foreground)" : "var(--foreground)"} />
                  <StatCard label="MEAN BIAS" value={signedNum(kCalibData.metrics.meanBias, 3)} sub="avg (actual − proj)" color={Math.abs(kCalibData.metrics.meanBias) <= 0.2 ? "var(--primary)" : Math.abs(kCalibData.metrics.meanBias) <= 0.5 ? "var(--foreground)" : "var(--foreground)"} />
                  <StatCard label="CALIBRATION FACTOR" value={fmtNum(kCalibData.metrics.calibrationFactor, 4)} sub="multiply proj × factor" color={Math.abs(kCalibData.metrics.calibrationFactor - 1) <= 0.03 ? "var(--primary)" : "var(--foreground)"} />
                  <StatCard label="RMSE" value={fmtNum(kCalibData.metrics.rmse, 3)} sub="root mean squared error" />
                </StatGrid>
              </div>
            )}

            {/* Daily view */}
            {kPropsView === "daily" && (
              kDailyLoading ? (
                <div className="flex items-center justify-center py-12 gap-3"><Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--primary)" }} /></div>
              ) : !kDailyData?.results || kDailyData.results.total === 0 ? (
                <div className="text-center py-12 text-foreground text-sm">No K-Props data for {formatDateNav(gameDate)}.</div>
              ) : (
                <>
                  <div>
                    <SectionLabel>DAILY SUMMARY — {formatDateNav(gameDate)}</SectionLabel>
                    <StatGrid>
                      <StatCard label="ACCURACY" value={kDailyData.results.accuracy != null ? fmtPct(kDailyData.results.accuracy) : "—"} sub={`${kDailyData.results.correct}/${kDailyData.results.completed} correct`} color={accuracyColor(kDailyData.results.accuracy)} />
                      <StatCard label="OVER ACC" value={kDailyData.results.overTotal > 0 ? fmtPct(kDailyData.results.overCorrect / kDailyData.results.overTotal) : "—"} sub={`${kDailyData.results.overCorrect}/${kDailyData.results.overTotal} overs`} color={accuracyColor(kDailyData.results.overTotal > 0 ? kDailyData.results.overCorrect / kDailyData.results.overTotal : null)} />
                      <StatCard label="UNDER ACC" value={kDailyData.results.underTotal > 0 ? fmtPct(kDailyData.results.underCorrect / kDailyData.results.underTotal) : "—"} sub={`${kDailyData.results.underCorrect}/${kDailyData.results.underTotal} unders`} color={accuracyColor(kDailyData.results.underTotal > 0 ? kDailyData.results.underCorrect / kDailyData.results.underTotal : null)} />
                      <StatCard label="MEAN ERROR" value={kDailyData.results.meanError !== null ? signedNum(kDailyData.results.meanError, 2) : "—"} sub="avg (actual − proj)" color={kDailyData.results.meanError !== null ? Math.abs(kDailyData.results.meanError) <= 0.3 ? "var(--primary)" : Math.abs(kDailyData.results.meanError) <= 0.8 ? "var(--foreground)" : "var(--foreground)" : undefined} />
                      <StatCard label="MAE" value={kDailyData.results.mae !== null ? fmtNum(kDailyData.results.mae, 2) : "—"} sub="mean absolute error" color={kDailyData.results.mae !== null ? kDailyData.results.mae <= 0.8 ? "var(--primary)" : kDailyData.results.mae <= 1.5 ? "var(--foreground)" : "var(--foreground)" : undefined} />
                    </StatGrid>
                  </div>
                  <div>
                    <SectionLabel sub={`${kDailyData.results.total} pitchers · ${kDailyData.results.correct}/${kDailyData.results.completed} correct`}>PER-PITCHER RESULTS</SectionLabel>
                    {kDailyData.results.props.map((prop: KPropRow) => (
                      <KPropPitcherRow key={prop.id} prop={prop} />
                    ))}
                  </div>
                </>
              )
            )}

            {/* Last 7 days view */}
            {kPropsView === "last7" && (
              kLast7Loading ? (
                <div className="flex items-center justify-center py-12 gap-3"><Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--primary)" }} /></div>
              ) : !kLast7Data || kLast7Data.totalProps === 0 ? (
                <div className="text-center py-12 text-foreground text-sm">No K-Props data in the last 7 days.</div>
              ) : (
                <div>
                  <SectionLabel sub={`${kLast7Data.totalProps} props across ${kLast7Data.windowDays} days`}>LAST 7 DAYS AGGREGATE</SectionLabel>
                  <StatGrid>
                    <StatCard label="OVERALL ACCURACY" value={kLast7Data.accuracy != null ? fmtPct(kLast7Data.accuracy) : "—"} sub={`${kLast7Data.correctProps}/${kLast7Data.completedProps} correct`} color={accuracyColor(kLast7Data.accuracy)} />
                    <StatCard label="OVER ACCURACY" value={kLast7Data.overAccuracy != null ? fmtPct(kLast7Data.overAccuracy) : "—"} sub={`${kLast7Data.overCorrect}/${kLast7Data.overTotal}`} color={accuracyColor(kLast7Data.overAccuracy)} />
                    <StatCard label="UNDER ACCURACY" value={kLast7Data.underAccuracy != null ? fmtPct(kLast7Data.underAccuracy) : "—"} sub={`${kLast7Data.underCorrect}/${kLast7Data.underTotal}`} color={accuracyColor(kLast7Data.underAccuracy)} />
                    <StatCard label="ROLLING MAE" value={kLast7Data.mae != null ? fmtNum(kLast7Data.mae, 3) : "—"} sub="mean absolute error" color={kLast7Data.mae != null ? kLast7Data.mae <= 0.8 ? "var(--primary)" : kLast7Data.mae <= 1.5 ? "var(--foreground)" : "var(--foreground)" : undefined} />
                    <StatCard label="MEAN ERROR" value={kLast7Data.meanError != null ? signedNum(kLast7Data.meanError, 3) : "—"} sub="avg (actual − proj)" color={kLast7Data.meanError != null ? Math.abs(kLast7Data.meanError) <= 0.2 ? "var(--primary)" : "var(--foreground)" : undefined} />
                  </StatGrid>
                  {/* Per-date breakdown */}
                  {kLast7Data.dailyBreakdown && kLast7Data.dailyBreakdown.map((day: { date: string; correct: number; completed: number; accuracy: number | null; mae: number | null }) => (
                    <div key={day.date} style={{ marginBottom: 8, padding: "10px 14px", background: "var(--background)", border: "1px solid var(--border)", borderRadius: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>{day.date}</span>
                        <span style={{ fontSize: 11, color: accuracyColor(day.accuracy), fontWeight: 700, fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>{day.accuracy != null ? fmtPct(day.accuracy) : "—"}</span>
                        <span style={{ fontSize: 10, color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>{day.correct}/{day.completed} correct</span>
                        {day.mae != null && <span style={{ fontSize: 10, color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>MAE {fmtNum(day.mae, 2)}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
          </SectionErrorBoundary>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* HR PROPS TAB                                               */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {marketTab === "hrprops" && (
          <SectionErrorBoundary label="HR PROPS">
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            {/* Rolling Accuracy */}
            <div>
              <SectionLabel sub="Last 30 days · mlb_game_backtest table">ROLLING ACCURACY — HR PROPS</SectionLabel>
              <RollingAccuracyPanel days={30} appUser={appUser} />
            </div>

            {/* Daily HR Props */}
            <div>
              <SectionLabel sub={`Date: ${formatDateNav(gameDate)}`}>DAILY HR PROPS</SectionLabel>

              {hrPropsLoading ? (
                <div className="flex items-center justify-center py-12 gap-3">
                  <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--primary)" }} />
                </div>
              ) : hrPropsList.length === 0 ? (
                <div className="text-center py-12 text-foreground text-sm">
                  No HR Props data for {formatDateNav(gameDate)}.
                  {hrGameIds.length === 0 && " (No games found for this date.)"}
                </div>
              ) : (
                <>
                  {/* Summary */}
                  <StatGrid>
                    {(() => {
                      const graded = hrPropsList.filter(p => p.modelCorrect != null);
                      const correct = graded.filter(p => p.modelCorrect === 1).length;
                      const acc = graded.length > 0 ? correct / graded.length : null;
                      const withEdge = hrPropsList.filter(p => p.edgeOver != null && parseFloat(p.edgeOver) >= 0.02);
                      const edgeCorrect = withEdge.filter(p => p.modelCorrect === 1).length;
                      const edgeAcc = withEdge.length > 0 ? edgeCorrect / withEdge.length : null;
                      return (
                        <>
                          <StatCard label="TOTAL PROPS" value={String(hrPropsList.length)} sub="all players" />
                          <StatCard label="GRADED" value={String(graded.length)} sub={`${correct} correct`} color="var(--foreground)" />
                          <StatCard label="ACCURACY" value={acc != null ? fmtPct(acc) : "—"} sub="all graded" color={accuracyColor(acc)} />
                          <StatCard label="EDGE PLAYS" value={String(withEdge.length)} sub="≥2pp edge" color="var(--primary)" />
                          <StatCard label="EDGE ACCURACY" value={edgeAcc != null ? fmtPct(edgeAcc) : "—"} sub="≥2pp edge graded" color={accuracyColor(edgeAcc)} />
                        </>
                      );
                    })()}
                  </StatGrid>

                  {/* Per-player rows */}
                  {hrPropsList.map(p => (
                    <HrPropRow key={p.id} prop={p} awayTeam={p.awayTeam} homeTeam={p.homeTeam} />
                  ))}
                </>
              )}
            </div>
            {/* Re-ingest button */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
              <Target size={12} style={{ color: "var(--foreground)" }} />
              <span style={{ fontSize: 10, color: "var(--foreground)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>
                Re-ingest outcomes for {gameDate} to update HR prop results
              </span>
              <Button size="sm" variant="outline"
                disabled={reingestingDate === gameDate}
                onClick={() => {
                  setReingestingDate(gameDate);
                  reingestMutation.mutate({ dateStr: gameDate, force: false });
                }}
                className="ml-auto gap-1.5 text-xs h-7"
                style={{ borderColor: "var(--primary)", color: "var(--primary)" }}>
                {reingestingDate === gameDate ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                RE-INGEST
              </Button>
            </div>
          </div>
          </SectionErrorBoundary>
        )}

      </main>
    </div>
    </AdminShell>
  );
}
