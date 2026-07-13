/**
 * ModelResults — Owner-only page for reviewing K-Props model backtest results.
 *
 * Displays:
 *   - Daily accuracy summary (correct / total, over/under breakdown, MAE, mean bias)
 *   - Rolling calibration metrics (all-time accuracy, calibration factor, RMSE)
 *   - Per-pitcher result table with headshots, projections, actuals, verdict
 *
 * Access: owner role only — non-owners are immediately redirected to /feed.
 * Backend: all procedures use ownerProcedure (server-side owner check enforced).
 */
import { useState, useEffect, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  XCircle,
  Clock,
  BarChart3,
  Target,
  Calendar,
  CalendarDays,
} from "lucide-react";
import { MLB_BY_ABBREV } from "@shared/mlbTeams";

// ─── Date helpers (mirrors PublishProjections) ────────────────────────────────
function todayPst(): string {
  const now = new Date();
  const pst = now.toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
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
  } catch {
    return dateStr;
  }
}
function formatMilitaryTime(time: string | null | undefined): string {
  if (!time) return "TBD";
  const upper = time.toUpperCase();
  if (upper === "TBD" || upper === "TBA" || !time.includes(":")) return "TBD";
  const parts = time.split(":");
  let hours = parseInt(parts[0], 10);
  const minutes = parts[1]?.slice(0, 2) ?? "00";
  if (isNaN(hours)) return "TBD";
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${ampm} ET`;
}

// ─── Team helpers ─────────────────────────────────────────────────────────────
function teamPrimary(abbrev: string): string {
  return MLB_BY_ABBREV.get(abbrev?.toUpperCase())?.primaryColor ?? "#4A90D9";
}
function teamLogo(abbrev: string): string | null {
  return MLB_BY_ABBREV.get(abbrev?.toUpperCase())?.logoUrl ?? null;
}
function teamCity(abbrev: string): string {
  return MLB_BY_ABBREV.get(abbrev?.toUpperCase())?.city ?? abbrev;
}
function teamNickname(abbrev: string): string {
  return MLB_BY_ABBREV.get(abbrev?.toUpperCase())?.nickname ?? "";
}

// ─── Pitcher headshot ─────────────────────────────────────────────────────────
function mlbPhoto(id: number | null | undefined): string | null {
  if (!id) return null;
  return `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_360,q_auto:best,e_background_removal,f_png/v1/people/${id}/headshot/67/current`;
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

// ─── Accuracy color ───────────────────────────────────────────────────────────
function accuracyColor(acc: number | null): string {
  if (acc === null) return "#FFFFFF";
  if (acc >= 0.65) return "#45E0A8";
  if (acc >= 0.55) return "#45E0A8";
  if (acc >= 0.50) return "#FFFFFF";
  if (acc >= 0.45) return "#FFFFFF";
  return "#FFFFFF";
}

// ─── Backtest result badge ────────────────────────────────────────────────────
function ResultBadge({ result, correct }: { result: string | null; correct: number | null }) {
  if (!result || result === "PENDING" || result === "NO_LINE") {
    return (
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: "1px", padding: "3px 8px",
        borderRadius: 4, background: "transparent", color: "#FFFFFF",
        border: "1px solid #FFFFFF", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif',
      }}>
        {result === "NO_LINE" ? "NO LINE" : "PENDING"}
      </span>
    );
  }
  const isCorrect = correct === 1;
  const isOver = result === "OVER";
  const isPush = result === "PUSH";
  const bg = isPush
    ? "transparent"
    : isCorrect
      ? "transparent"
      : "transparent";
  const border = isPush
    ? "#FFFFFF"
    : isCorrect
      ? "#45E0A8"
      : "#FFFFFF";
  const color = isPush ? "#FFFFFF" : isCorrect ? "#45E0A8" : "#FFFFFF";
  const icon = isPush ? null : isCorrect
    ? <CheckCircle2 size={10} style={{ flexShrink: 0 }} />
    : <XCircle size={10} style={{ flexShrink: 0 }} />;

  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 10, fontWeight: 700, letterSpacing: "1px", padding: "3px 8px",
      borderRadius: 4, background: bg, color, border: `1px solid ${border}`,
      fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif',
    }}>
      {icon}
      {result}
    </span>
  );
}

// ─── Verdict badge ────────────────────────────────────────────────────────────
function VerdictBadge({ verdict, bestSide, bestEdge, bestMlStr }: {
  verdict: string | null;
  bestSide: string | null;
  bestEdge: string | null;
  bestMlStr: string | null;
}) {
  if (!verdict || verdict === "PASS") {
    return <span style={{ fontSize: 10, color: "#FFFFFF", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>PASS</span>;
  }
  const edgePp = bestEdge ? parseFloat(bestEdge) * 100 : null;
  const isOver = bestSide === "OVER";
  const color = isOver ? "#45E0A8" : "#45E0A8";
  const bg = isOver ? "transparent" : "transparent";
  const border = isOver ? "#45E0A8" : "#45E0A8";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 10, fontWeight: 700, letterSpacing: "1px", padding: "3px 8px",
      borderRadius: 4, background: bg, color, border: `1px solid ${border}`,
      fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif',
    }}>
      ▶ {bestSide} {bestMlStr ?? ""}
      {edgePp !== null && (
        <span style={{ color: "#FFFFFF", fontWeight: 500 }}>
          {edgePp > 0 ? "+" : ""}{edgePp.toFixed(1)}pp
        </span>
      )}
    </span>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color }: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div style={{
      background: "#000000", border: "1px solid #FFFFFF", borderRadius: 10,
      padding: "14px 16px", display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0,
    }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", color: "#FFFFFF", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: color ?? "#FFFFFF", lineHeight: 1, fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 10, color: "#FFFFFF", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>
          {sub}
        </div>
      )}
    </div>
  );
}

// ─── Pitcher row ─────────────────────────────────────────────────────────────
interface PropRow {
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

function PitcherResultRow({ prop }: { prop: PropRow }) {
  const isAway = prop.side === "away";
  const pitcherTeam = isAway ? prop.awayTeam : prop.homeTeam;
  const oppTeam = isAway ? prop.homeTeam : prop.awayTeam;
  const primary = teamPrimary(pitcherTeam);
  const logo = teamLogo(pitcherTeam);
  const photo = mlbPhoto(prop.mlbamId);

  const kProj = prop.kProj ? parseFloat(prop.kProj) : null;
  const bookLine = prop.bookLine ? parseFloat(prop.bookLine) : null;
  const modelErr = prop.modelError ? parseFloat(prop.modelError) : null;

  const isPending = !prop.backtestResult || prop.backtestResult === "PENDING";
  const isCorrect = prop.modelCorrect === 1;

  return (
    <div style={{
      background: "#000000",
      border: "1px solid #FFFFFF",
      borderRadius: 10,
      overflow: "hidden",
      marginBottom: 8,
    }}>
      {/* Color bar */}
      <div style={{ height: 3, background: primary }} />

      <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
        {/* Left: headshot + team */}
        <div style={{
          width: 80, flexShrink: 0, background: "transparent",
          borderRight: "1px solid #FFFFFF",
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", padding: "10px 8px", gap: 6,
        }}>
          {/* Headshot */}
          <div style={{ width: 52, height: 52, overflow: "hidden", borderRadius: "50%", background: "transparent", border: "1px solid #FFFFFF", flexShrink: 0 }}>
            {photo ? (
              <img src={photo} alt={prop.pitcherName} style={{ width: "100%", height: "100%", objectFit: "cover", mixBlendMode: "screen" }} onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0"; }} />
            ) : (
              <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 16, color: "#FFFFFF" }}>?</span>
              </div>
            )}
          </div>
          {/* Team logo */}
          {logo && (
            <img src={logo} alt={pitcherTeam} style={{ width: 22, height: 22, objectFit: "contain", mixBlendMode: "screen", opacity: 0.85 }} />
          )}
          {/* Matchup */}
          <div style={{ fontSize: 9, color: "#FFFFFF", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', textAlign: "center", letterSpacing: "0.5px" }}>
            {isAway ? `${prop.awayTeam} @` : `vs ${prop.awayTeam}`}
            <br />
            {isAway ? prop.homeTeam : ""}
          </div>
        </div>

        {/* Center: pitcher info + projections */}
        <div style={{ flex: 1, minWidth: 0, padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Name + time + verdict */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 18, fontWeight: 800, color: "#FFFFFF", lineHeight: 1.1 }}>
                {prop.pitcherName}
              </div>
              <div style={{ fontSize: 10, color: "#FFFFFF", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', marginTop: 2 }}>
                {formatMilitaryTime(prop.startTimeEst)} · {isAway ? "AWAY" : "HOME"}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
              <VerdictBadge verdict={prop.verdict} bestSide={prop.bestSide} bestEdge={prop.bestEdge} bestMlStr={prop.bestMlStr} />
              <ResultBadge result={prop.backtestResult} correct={prop.modelCorrect} />
            </div>
          </div>

          {/* Projection row */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            {/* K Proj */}
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", color: "#FFFFFF", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>MODEL PROJ</div>
              <div style={{ fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 22, fontWeight: 800, color: "#FFFFFF", lineHeight: 1 }}>
                {fmtNum(prop.kProj, 1)}
              </div>
            </div>
            {/* Book line */}
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", color: "#FFFFFF", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>BOOK LINE</div>
              <div style={{ fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 22, fontWeight: 800, color: "#FFFFFF", lineHeight: 1 }}>
                {fmtNum(prop.bookLine, 1)}
              </div>
            </div>
            {/* Actual Ks */}
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", color: "#FFFFFF", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>ACTUAL Ks</div>
              <div style={{
                fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 22, fontWeight: 800, lineHeight: 1,
                color: isPending ? "#FFFFFF" : isCorrect ? "#45E0A8" : "#FFFFFF",
              }}>
                {isPending ? "—" : (prop.actualKs ?? "—")}
              </div>
            </div>
            {/* Model error */}
            {!isPending && modelErr !== null && (
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", color: "#FFFFFF", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>MODEL ERR</div>
                <div style={{
                  fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 22, fontWeight: 800, lineHeight: 1,
                  color: Math.abs(modelErr) <= 0.5 ? "#45E0A8" : Math.abs(modelErr) <= 1.5 ? "#FFFFFF" : "#FFFFFF",
                }}>
                  {signedNum(modelErr, 2)}
                </div>
              </div>
            )}
            {/* AN No-Vig % */}
            {prop.anNoVigOverPct && (
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", color: "#FFFFFF", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>AN NO-VIG O%</div>
                <div style={{ fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 22, fontWeight: 800, color: "#FFFFFF", lineHeight: 1 }}>
                  {fmtPct(parseFloat(prop.anNoVigOverPct))}
                </div>
              </div>
            )}
          </div>

          {/* Over/Under probs */}
          {(prop.pOver || prop.pUnder) && (
            <div style={{ display: "flex", gap: 6 }}>
              <div style={{
                flex: 1, padding: "6px 10px", borderRadius: 6,
                background: "transparent", border: "1px solid #FFFFFF",
                display: "flex", alignItems: "center", gap: 6,
              }}>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "#FFFFFF", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>
                  OVER {fmtNum(prop.bookLine, 1)}
                </span>
                <span style={{ fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 14, fontWeight: 800, color: "#FFFFFF" }}>
                  {prop.pOver ? fmtPct(parseFloat(prop.pOver)) : "—"}
                </span>
                <span style={{ fontSize: 10, color: "#FFFFFF", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>
                  {fmtOdds(prop.bookOverOdds)}
                </span>
              </div>
              <div style={{
                flex: 1, padding: "6px 10px", borderRadius: 6,
                background: "transparent", border: "1px solid #FFFFFF",
                display: "flex", alignItems: "center", gap: 6,
              }}>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "#FFFFFF", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>
                  UNDER {fmtNum(prop.bookLine, 1)}
                </span>
                <span style={{ fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 14, fontWeight: 800, color: "#FFFFFF" }}>
                  {prop.pUnder ? fmtPct(parseFloat(prop.pUnder)) : "—"}
                </span>
                <span style={{ fontSize: 10, color: "#FFFFFF", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>
                  {fmtOdds(prop.bookUnderOdds)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function ModelResults() {
  const [, setLocation] = useLocation();
  const { appUser, isOwner, loading: authLoading } = useAppAuth();
  const [gameDate, setGameDate] = useState(() => todayPst());
  const [isRunningBacktest, setIsRunningBacktest] = useState(false);
  // 'daily' | 'last7' | 'brier'
  const [viewMode, setViewMode] = useState<'daily' | 'last7' | 'brier'>('daily');
  const [brierWindow, setBrierWindow] = useState<number>(20);
  // 'trend' | 'heatmap' — sub-tab within the BRIER view
  const [brierSubTab, setBrierSubTab] = useState<'trend' | 'heatmap'>('trend');
  // Heatmap drill-down: selected cell {date, market}
  const [selectedCell, setSelectedCell] = useState<{ date: string; market: 'fgMl' | 'f5Ml' | 'nrfi' | 'fgTotal' | 'f5Total' } | null>(null);

  // ── Strict owner-only guard ─────────────────────────────────────────────────
  useEffect(() => {
    if (!authLoading && (!appUser || !isOwner)) {
      setLocation("/feed/model/mlb");
    }
  }, [authLoading, appUser, isOwner, setLocation]);

  // ── Daily backtest results ──────────────────────────────────────────────────
  const {
    data: dailyData,
    isLoading: dailyLoading,
    refetch: refetchDaily,
  } = trpc.strikeoutProps.getRichDailyBacktest.useQuery(
    { gameDate },
    { enabled: !!appUser && isOwner && viewMode === 'daily', refetchOnWindowFocus: false }
  );

  // ── Rolling calibration metrics ─────────────────────────────────────────────
  const {
    data: calibrationData,
    isLoading: calibrationLoading,
    refetch: refetchCalibration,
  } = trpc.strikeoutProps.getCalibrationMetrics.useQuery(
    undefined,
    { enabled: !!appUser && isOwner && viewMode === 'daily', refetchOnWindowFocus: false }
  );

  // ── Last 7 Days aggregate ────────────────────────────────────────────
  const {
    data: last7Data,
    isLoading: last7Loading,
    refetch: refetchLast7,
  } = trpc.strikeoutProps.getLast7DaysBacktest.useQuery(
    { days: 7 },
    { enabled: !!appUser && isOwner && viewMode === 'last7', refetchOnWindowFocus: false }
  );
  // ── Brier Score Trend ──────────────────────────────────────────────────────
  const {
    data: brierData,
    isLoading: brierLoading,
    refetch: refetchBrier,
  } = trpc.mlbSchedule.getBrierTrend.useQuery(
    { windowSize: brierWindow, sport: 'MLB' },
    { enabled: !!appUser && isOwner && viewMode === 'brier', refetchOnWindowFocus: false }
  );

  // ── Brier Heatmap ──────────────────────────────────────────────────────
  const {
    data: heatmapData,
    isLoading: heatmapLoading,
    refetch: refetchHeatmap,
  } = trpc.mlbSchedule.getBrierHeatmap.useQuery(
    { sport: 'MLB' },
    { enabled: !!appUser && isOwner && viewMode === 'brier' && brierSubTab === 'heatmap', refetchOnWindowFocus: false }
  );

  // ── Drift detector status query ──────────────────────────────────────────────────
  const {
    data: driftData,
    isLoading: driftLoading,
    refetch: refetchDrift,
  } = trpc.mlbSchedule.checkDrift.useQuery(
    { triggerRecal: false },
    { enabled: !!appUser && isOwner && viewMode === 'brier', refetchOnWindowFocus: false, staleTime: 5 * 60 * 1000 }
  );

  // ── Brier Heatmap Drill-Down ─────────────────────────────────────────────────
  const {
    data: drilldownData,
    isLoading: drilldownLoading,
  } = trpc.mlbSchedule.getBrierDrilldown.useQuery(
    selectedCell ?? { date: '2026-01-01', market: 'fgMl' },
    { enabled: !!appUser && isOwner && selectedCell != null, refetchOnWindowFocus: false }
  );

  // ── Re-ingest mutation (force=true per date) ───────────────────────────────────
  const [reingestingDate, setReingestingDate] = useState<string | null>(null);
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

  const handleReingest = (dateStr: string) => {
    if (reingestingDate) return; // prevent concurrent re-ingests
    setReingestingDate(dateStr);
    reingestMutation.mutate({ dateStr, force: true });
  };

  // Merge per-game and rolling arrays for recharts (keyed by gameIndex)
  const brierChartData = useMemo(() => {
    if (!brierData) return [];
    const rollingMap = new Map(brierData.rolling.map(r => [r.gameIndex, r]));
    return brierData.games.map(g => ({
      ...g,
      ...(rollingMap.get(g.gameIndex) ?? {}),
    }));
  }, [brierData]);

  const handleRefresh = async () => {
    setIsRunningBacktest(true);
    try {
      if (viewMode === 'daily') {
        await Promise.all([refetchDaily(), refetchCalibration()]);
      } else if (viewMode === 'last7') {
        await refetchLast7();
      } else {
        await Promise.all([
          refetchBrier(),
          refetchDrift(),
          brierSubTab === 'heatmap' ? refetchHeatmap() : Promise.resolve(),
        ]);
      }
      toast.success("Results refreshed");
    } catch (err) {
      toast.error("Refresh failed");
    } finally {
      setIsRunningBacktest(false);
    }
  };

  const daily = dailyData?.results;
  const calibration = calibrationData?.metrics;

  // Show loading spinner while auth resolves
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "hsl(var(--background))" }}>
        <Loader2 className="animate-spin" style={{ color: "#45E0A8" }} />
      </div>
    );
  }
  if (!isOwner) return null;

  const accuracy = daily?.accuracy ?? null;
  const accColor = accuracyColor(accuracy);

  return (
    <div className="min-h-screen" style={{ background: "hsl(var(--background))" }}>
      {/* ── Sticky header ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border">
        {/* Top row */}
        <div className="relative flex items-center px-4 py-2 max-w-5xl mx-auto">
          <button type="button" onClick={() => setLocation("/admin/publish")}
            className="p-1.5 rounded-lg transition-colors mr-2 flex-shrink-0"
          >
            <ChevronLeft size={18} style={{ color: "hsl(var(--muted-foreground))" }} />
          </button>
          {/* Centered brand */}
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 pointer-events-none">
            <span className="font-black text-white whitespace-nowrap" style={{ fontSize: "clamp(13px, 3vw, 20px)", letterSpacing: "0.08em" }}>
              AI SPORTS BETTING
            </span>
            <span className="text-border" style={{ fontSize: "clamp(10px, 2vw, 14px)" }}>|</span>
            <span className="font-medium whitespace-nowrap" style={{ fontSize: "clamp(11px, 2.4vw, 16px)", letterSpacing: "0.1em", color: "#FFFFFF" }}>
              MODEL RESULTS
            </span>
          </div>
          {/* Right: refresh */}
          <div className="flex-1" />
          <Button
            size="sm"
            onClick={handleRefresh}
            disabled={isRunningBacktest || (viewMode === 'daily' ? dailyLoading : last7Loading)}
            className="gap-1.5 text-xs h-8 font-bold border"
            style={{ background: "transparent", color: "#45E0A8", borderColor: "#45E0A8" }}
          >
            {isRunningBacktest
              ? <Loader2 size={12} className="animate-spin" />
              : <RefreshCw size={12} />
            }
            Refresh
          </Button>
        </div>

        {/* View mode toggle + date nav */}
        <div className="px-4 pb-1.5 max-w-5xl mx-auto flex items-center gap-2">
          <button type="button" onClick={() => setViewMode('daily')}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-colors"
            style={{
              background: viewMode === 'daily' ? 'transparent' : 'transparent',
              color: viewMode === 'daily' ? '#45E0A8' : '#FFFFFF',
              border: `1px solid ${viewMode === 'daily' ? '#45E0A8' : '#FFFFFF'}`,
              fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif',
              letterSpacing: '0.08em',
            }}
          >
            <Calendar size={11} />
            DAILY
          </button>
          <button type="button" onClick={() => setViewMode('last7')}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-colors"
            style={{
              background: viewMode === 'last7' ? 'transparent' : 'transparent',
              color: viewMode === 'last7' ? '#45E0A8' : '#FFFFFF',
              border: `1px solid ${viewMode === 'last7' ? '#45E0A8' : '#FFFFFF'}`,
              fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif',
              letterSpacing: '0.08em',
            }}
          >
            <CalendarDays size={11} />
            LAST 7 DAYS
          </button>
          <button type="button" onClick={() => setViewMode('brier')}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-colors"
            style={{
              background: viewMode === 'brier' ? 'transparent' : 'transparent',
              color: viewMode === 'brier' ? '#45E0A8' : '#FFFFFF',
              border: `1px solid ${viewMode === 'brier' ? '#45E0A8' : '#FFFFFF'}`,
              fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif',
              letterSpacing: '0.08em',
            }}
          >
            <TrendingUp size={11} />
            BRIER TREND
          </button>
          {/* Brier window selector — only visible in brier mode */}
          {viewMode === 'brier' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
              <span style={{ fontSize: 10, color: '#FFFFFF', fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', letterSpacing: '.08em', textTransform: 'uppercase' }}>Window</span>
              {[10, 20, 30, 50].map(w => (
                <button type="button" key={w}
                  onClick={() => setBrierWindow(w)}
                  style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                    background: brierWindow === w ? 'transparent' : 'transparent',
                    color: brierWindow === w ? '#45E0A8' : '#FFFFFF',
                    border: `1px solid ${brierWindow === w ? '#45E0A8' : '#FFFFFF'}`,
                    cursor: 'pointer', fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', letterSpacing: '.06em',
                  }}
                >{w}G</button>
              ))}
            </div>
          )}

          {/* Date nav — only visible in daily mode */}
          {viewMode === 'daily' && (
            <>
              <div style={{ flex: 1 }} />
              <button type="button" onClick={() => setGameDate(d => addDays(d, -1))}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors flex-shrink-0"
              >
                <ChevronLeft size={14} style={{ color: 'hsl(var(--muted-foreground))' }} />
              </button>
              <span className="text-xs font-bold text-foreground tracking-wide whitespace-nowrap">
                {formatDateNav(gameDate)}
              </span>
              {gameDate === todayPst() && (
                <span className="text-sm font-semibold px-1.5 py-0.5 rounded" style={{ background: 'transparent', color: '#45E0A8' }}>
                  TODAY
                </span>
              )}
              <button type="button" onClick={() => setGameDate(d => addDays(d, 1))}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors flex-shrink-0"
              >
                <ChevronRight size={14} style={{ color: 'hsl(var(--muted-foreground))' }} />
              </button>
            </>
          )}
        </div>
      </header>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <main className="max-w-5xl mx-auto px-4 py-4 pb-16">

        {/* ── BRIER TREND VIEW ────────────────────────────────────────────────── */}
        {viewMode === 'brier' && (
          brierLoading ? (
            <div className="flex items-center justify-center py-12 gap-3">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#45E0A8' }} />
              <span className="text-sm text-muted-foreground">Loading Brier score trend…</span>
            </div>
          ) : !brierData || brierData.summary.totalGames === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
              <TrendingUp className="w-10 h-10 text-muted-foreground/30" />
              <div>
                <p className="text-sm font-semibold text-foreground mb-1">No Brier score data yet</p>
                <p className="text-xs text-muted-foreground">Outcome ingestion must run first to populate Brier scores.</p>
              </div>
            </div>
          ) : (
            <>
              {/* ── Drift Detector Banner ────────────────────────────────────────────────────────────────────────────── */}
              {driftLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 6, background: 'transparent', marginBottom: 12 }}>
                  <Loader2 style={{ width: 12, height: 12, color: '#45E0A8' }} className="animate-spin" />
                  <span style={{ fontSize: 10, color: '#FFFFFF', fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', letterSpacing: '1px' }}>CHECKING DRIFT...</span>
                </div>
              ) : driftData ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderRadius: 6, marginBottom: 12,
                  background: driftData.driftDetected ? 'transparent' : driftData.rollingF5Share !== null ? 'transparent' : 'transparent',
                  border: `1px solid ${driftData.driftDetected ? '#FFFFFF' : driftData.rollingF5Share !== null ? '#45E0A8' : '#FFFFFF'}`,
                }}>
                  <span style={{ fontSize: 13 }}>{driftData.driftDetected ? '⚠️' : driftData.rollingF5Share !== null ? '✅' : '⏳'}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: driftData.driftDetected ? '#FFFFFF' : driftData.rollingF5Share !== null ? '#45E0A8' : '#FFFFFF', fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', marginBottom: 2 }}>
                      {driftData.driftDetected ? 'DRIFT DETECTED — RECALIBRATION RECOMMENDED' : driftData.rollingF5Share !== null ? 'DRIFT DETECTOR — NOMINAL' : 'DRIFT DETECTOR — INSUFFICIENT DATA'}
                    </div>
                    <div style={{ fontSize: 9, color: '#FFFFFF', fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', letterSpacing: '0.5px' }}>
                      {driftData.rollingF5Share !== null
                        ? `Rolling F5 Share: ${(driftData.rollingF5Share * 100).toFixed(2)}% | Baseline: ${(driftData.baselineF5Share * 100).toFixed(2)}% | Delta: ${((driftData.delta ?? 0) * 100).toFixed(2)}pp | Window: ${driftData.windowSize} games${driftData.recalibrationTriggered ? ' | ✅ Recalibrated' : ''}`
                        : driftData.message
                      }
                    </div>
                  </div>
                  {driftData.driftDetected && !driftData.recalibrationTriggered && (
                    <span style={{ fontSize: 9, color: '#FFFFFF', fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', letterSpacing: '1px', fontWeight: 700 }}>NEEDS RECAL</span>
                  )}
                </div>
              ) : null}

              {/* ── Sub-tab toggle: TREND / HEATMAP ──────────────────────────────────────── */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
                {(['trend', 'heatmap'] as const).map(tab => (
                  <button type="button" key={tab}
                    onClick={() => setBrierSubTab(tab)}
                    style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase',
                      padding: '4px 12px', borderRadius: 4, border: 'none', cursor: 'pointer',
                      fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif',
                      background: brierSubTab === tab ? (tab === 'trend' ? 'transparent' : 'transparent') : 'transparent',
                      color: brierSubTab === tab ? (tab === 'trend' ? '#45E0A8' : '#45E0A8') : '#FFFFFF',
                      transition: 'all 0.15s',
                    }}
                  >
                    {tab === 'trend' ? '📈 TREND' : '🟥 HEATMAP'}
                  </button>
                ))}
              </div>

              {/* ── TREND sub-tab content ────────────────────────────────────────────────── */}
              {brierSubTab === 'trend' && <>
              {/* ── Summary stat cards ────────────────────────────────────────────────────── */}
              <div style={{ marginBottom: 20 }}>
                <div style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase',
                  color: '#FFFFFF', fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif',
                  marginBottom: 10,
                }}>
                  BRIER SCORE CALIBRATION — {brierData.summary.totalGames} INGESTED GAMES
                  <span style={{ marginLeft: 8, color: '#45E0A8', fontSize: 8 }}>
                    (lower = better | perfect = 0.000 | random = 0.250)
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {([
                    { label: 'FG ML', value: brierData.summary.avgFgMl, color: '#45E0A8' },
                    { label: 'F5 ML', value: brierData.summary.avgF5Ml, color: '#45E0A8' },
                    { label: 'NRFI', value: brierData.summary.avgNrfi, color: '#45E0A8' },
                    { label: 'FG TOT', value: (brierData.summary as Record<string, number | null>).avgFgTotal ?? null, color: '#45E0A8' },
                    { label: 'F5 TOT', value: (brierData.summary as Record<string, number | null>).avgF5Total ?? null, color: '#45E0A8' },
                  ] as Array<{ label: string; value: number | null; color: string }>).map(({ label, value, color }) => (
                    <StatCard
                      key={label}
                      label={`AVG BRIER — ${label}`}
                      value={value != null ? value.toFixed(4) : 'N/A'}
                      sub={`${brierWindow}-game rolling window`}
                      color={
                        value == null ? '#FFFFFF'
                          : value <= 0.15 ? '#45E0A8'
                          : value <= 0.22 ? '#FFFFFF'
                          : '#FFFFFF'
                      }
                    />
                  ))}
                  <StatCard
                    label="WINDOW SIZE"
                    value={`${brierWindow}G`}
                    sub={`${brierData.summary.totalGames} total ingested`}
                    color="#45E0A8"
                  />
                </div>
              </div>

              {/* ── Rolling Brier chart ────────────────────────────────────────────── */}
              <div style={{
                background: '#000000',
                border: '1px solid #FFFFFF',
                borderRadius: 10,
                padding: '16px 12px 12px',
                marginBottom: 20,
              }}>
                <div style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase',
                  color: '#FFFFFF', fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif',
                  marginBottom: 16,
                }}>
                  ROLLING {brierWindow}-GAME BRIER SCORE — FG ML / F5 ML / NRFI / FG TOT / F5 TOT
                </div>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={brierChartData} margin={{ top: 4, right: 16, left: -20, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#FFFFFF" />
                    <XAxis
                      dataKey="gameIndex"
                      tick={{ fontSize: 9, fill: '#FFFFFF', fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}
                      tickLine={false}
                      axisLine={{ stroke: '#FFFFFF' }}
                      label={{ value: 'Game #', position: 'insideBottomRight', offset: -4, fontSize: 9, fill: '#FFFFFF' }}
                    />
                    <YAxis
                      domain={[0, 0.35]}
                      tickCount={8}
                      tick={{ fontSize: 9, fill: '#FFFFFF', fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}
                      tickLine={false}
                      axisLine={{ stroke: '#FFFFFF' }}
                      tickFormatter={(v: number) => v.toFixed(2)}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#000000', border: '1px solid #FFFFFF',
                        borderRadius: 8, fontSize: 11, fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif',
                      }}
                      labelStyle={{ color: '#FFFFFF', marginBottom: 4 }}
                      formatter={(value: number, name: string) => [
                        value != null ? value.toFixed(4) : 'N/A',
                        name,
                      ]}
                      labelFormatter={(label: number) => {
                        const g = brierChartData.find(d => d.gameIndex === label);
                        return g ? `Game ${label}: ${g.matchup} (${g.gameDate})` : `Game ${label}`;
                      }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 10, fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', paddingTop: 8 }}
                    />
                    {/* Reference line at 0.25 (random baseline) */}
                    <ReferenceLine y={0.25} stroke="#FFFFFF" strokeDasharray="4 4"
                      label={{ value: 'Random (0.25)', position: 'right', fontSize: 8, fill: '#FFFFFF' }}
                    />
                    {/* Reference line at 0.20 (good calibration target) */}
                    <ReferenceLine y={0.20} stroke="#45E0A8" strokeDasharray="4 4"
                      label={{ value: 'Target (0.20)', position: 'right', fontSize: 8, fill: '#45E0A8' }}
                    />
                    <Line
                      type="monotone" dataKey="rollFgMl" name="FG ML"
                      stroke="#45E0A8" strokeWidth={2} dot={false}
                      connectNulls activeDot={{ r: 4, fill: '#45E0A8' }}
                    />
                    <Line
                      type="monotone" dataKey="rollF5Ml" name="F5 ML"
                      stroke="#45E0A8" strokeWidth={2} dot={false}
                      connectNulls activeDot={{ r: 4, fill: '#45E0A8' }}
                    />
                    <Line
                      type="monotone" dataKey="rollNrfi" name="NRFI"
                      stroke="#45E0A8" strokeWidth={2} dot={false}
                      connectNulls activeDot={{ r: 4, fill: '#45E0A8' }}
                    />
                    <Line
                      type="monotone" dataKey="rollFgTotal" name="FG TOT"
                      stroke="#45E0A8" strokeWidth={1.5} strokeDasharray="5 3" dot={false}
                      connectNulls activeDot={{ r: 4, fill: '#45E0A8' }}
                    />
                    <Line
                      type="monotone" dataKey="rollF5Total" name="F5 TOT"
                      stroke="#45E0A8" strokeWidth={1.5} strokeDasharray="5 3" dot={false}
                      connectNulls activeDot={{ r: 4, fill: '#45E0A8' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* ── Per-game Brier table ────────────────────────────────────────────── */}
              <div style={{ marginBottom: 20 }}>
                <div style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase',
                  color: '#FFFFFF', fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif',
                  marginBottom: 10,
                }}>
                  PER-GAME BRIER SCORES ({brierData.games.length} games, newest first)
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #FFFFFF' }}>
                        {['#', 'DATE', 'MATCHUP', 'FG ML', 'F5 ML', 'NRFI', 'FG TOT', 'F5 TOT', ''].map(h => (
                          <th key={h} style={{ padding: '4px 8px', textAlign: h === '#' || h === 'DATE' || h === 'MATCHUP' || h === '' ? 'left' : 'right', color: '#FFFFFF', fontWeight: 700, letterSpacing: '.08em', fontSize: 9 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...brierData.games].reverse().map(g => {
                        const brierColor = (v: number | null) =>
                          v == null ? '#FFFFFF'
                            : v <= 0.15 ? '#45E0A8'
                            : v <= 0.22 ? '#FFFFFF'
                            : '#FFFFFF';
                        const isReingestingThis = reingestingDate === g.gameDate;
                        const isAnyReingestActive = reingestingDate !== null;
                        return (
                          <tr key={g.gameIndex} style={{ borderBottom: '1px solid #FFFFFF' }}>
                            <td style={{ padding: '4px 8px', color: '#FFFFFF', fontSize: 9 }}>{g.gameIndex}</td>
                            <td style={{ padding: '4px 8px', color: '#FFFFFF', fontSize: 9 }}>{g.gameDate}</td>
                            <td style={{ padding: '4px 8px', color: '#FFFFFF', fontWeight: 500 }}>{g.matchup}</td>
                            {(['brierFgMl', 'brierF5Ml', 'brierNrfi', 'brierFgTotal', 'brierF5Total'] as const).map(field => (
                              <td key={field} style={{ padding: '4px 8px', textAlign: 'right', color: brierColor(g[field]), fontWeight: 600 }}>
                                {g[field] != null ? (g[field] as number).toFixed(4) : <span style={{ color: '#FFFFFF' }}>—</span>}
                              </td>
                            ))}
                            <td style={{ padding: '4px 8px' }}>
                              <button type="button" onClick={() => handleReingest(g.gameDate)}
                                disabled={isAnyReingestActive}
                                title={`Force re-ingest ${g.gameDate} (force=true, rewrites all Brier scores)`}
                                style={{
                                  fontSize: 8, fontWeight: 700, letterSpacing: '.08em',
                                  padding: '2px 6px', borderRadius: 3, border: 'none', cursor: isAnyReingestActive ? 'not-allowed' : 'pointer',
                                  background: isReingestingThis ? 'transparent' : 'transparent',
                                  color: isReingestingThis ? '#45E0A8' : '#FFFFFF',
                                  transition: 'all 0.15s',
                                  display: 'flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap',
                                }}
                              >
                                {isReingestingThis ? (
                                  <>⏳ INGESTING…</>
                                ) : (
                                  <>↺ RE-INGEST</>  
                                )}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              </> /* end brierSubTab === 'trend' */}

              {/* ── HEATMAP sub-tab content ────────────────────────────────────────────── */}
              {brierSubTab === 'heatmap' && (
                heatmapLoading ? (
                  <div className="flex items-center justify-center py-12 gap-3">
                    <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#45E0A8' }} />
                    <span className="text-sm text-muted-foreground">Loading Brier heatmap…</span>
                  </div>
                ) : !heatmapData || heatmapData.heatmap.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
                    <BarChart3 className="w-10 h-10 text-muted-foreground/30" />
                    <div>
                      <p className="text-sm font-semibold text-foreground mb-1">No heatmap data yet</p>
                      <p className="text-xs text-muted-foreground">Outcome ingestion must run first.</p>
                    </div>
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <div style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase',
                      color: '#FFFFFF', fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif',
                      marginBottom: 12,
                    }}>
                      BRIER HEATMAP — {heatmapData.heatmap.length} DATES × 5 MARKETS
                      <span style={{ marginLeft: 8, color: '#45E0A8', fontSize: 8 }}>
                        (avg per date | 🟢 ≤0.15 | 🟡 ≤0.22 | 🔴 &gt;0.22 | — = no data)
                      </span>
                    </div>
                    <table style={{ borderCollapse: 'collapse', fontSize: 11, fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', minWidth: 520 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #FFFFFF' }}>
                          {['DATE', 'GAMES', 'FG ML', 'F5 ML', 'NRFI', 'FG TOT', 'F5 TOT'].map(h => (
                            <th key={h} style={{
                              padding: '4px 10px',
                              textAlign: h === 'DATE' ? 'left' : 'right',
                              color: '#FFFFFF', fontWeight: 700, letterSpacing: '.08em', fontSize: 9,
                            }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[...heatmapData.heatmap].reverse().map(row => {
                          const cellBg = (v: number | null) =>
                            v == null ? 'transparent'
                              : v <= 0.15 ? 'transparent'
                              : v <= 0.22 ? 'transparent'
                              : 'transparent';
                          const cellColor = (v: number | null) =>
                            v == null ? '#FFFFFF'
                              : v <= 0.15 ? '#45E0A8'
                              : v <= 0.22 ? '#FFFFFF'
                              : '#FFFFFF';
                          return (
                            <tr key={row.date} style={{ borderBottom: '1px solid #FFFFFF' }}>
                              <td style={{ padding: '5px 10px', color: '#FFFFFF', fontWeight: 600, whiteSpace: 'nowrap' }}>{row.date}</td>
                              <td style={{ padding: '5px 10px', textAlign: 'right', color: '#FFFFFF', fontSize: 9 }}>{row.games}</td>
                              {(['avgFgMl', 'avgF5Ml', 'avgNrfi', 'avgFgTotal', 'avgF5Total'] as const).map(field => {
                                const v = row[field];
                                const nullCount = row[field.replace('avg', 'null') as keyof typeof row] as number;
                                // Map avg field to market key
                                const marketKey = (
                                  field === 'avgFgMl' ? 'fgMl' :
                                  field === 'avgF5Ml' ? 'f5Ml' :
                                  field === 'avgNrfi' ? 'nrfi' :
                                  field === 'avgFgTotal' ? 'fgTotal' : 'f5Total'
                                ) as 'fgMl' | 'f5Ml' | 'nrfi' | 'fgTotal' | 'f5Total';
                                const isSelected = selectedCell?.date === row.date && selectedCell?.market === marketKey;
                                return (
                                  <td key={field} onClick={() => setSelectedCell(isSelected ? null : { date: row.date, market: marketKey })} style={{
                                    padding: '5px 10px', textAlign: 'right',
                                    background: isSelected ? 'transparent' : cellBg(v),
                                    color: isSelected ? '#45E0A8' : cellColor(v),
                                    fontWeight: 700,
                                    position: 'relative',
                                    cursor: 'pointer',
                                    outline: isSelected ? '1px solid #45E0A8' : 'none',
                                  }}>
                                    {v != null ? v.toFixed(4) : <span style={{ color: '#FFFFFF' }}>—</span>}
                                    {nullCount > 0 && (
                                      <span style={{ fontSize: 7, color: '#FFFFFF', marginLeft: 3 }}>
                                        ({nullCount}ø)
                                      </span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              )}

              {/* ── HEATMAP DRILL-DOWN PANEL ─────────────────────────────────────────────────────────────────────────── */}
              {selectedCell && (
                <div style={{
                  marginTop: 20, padding: '16px 20px',
                  background: 'transparent',
                  border: '1px solid #45E0A8',
                  borderRadius: 8,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: '#45E0A8', fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>
                      DRILL-DOWN — {selectedCell.date} / {selectedCell.market.toUpperCase()}
                    </div>
                    <button type="button" onClick={() => setSelectedCell(null)} style={{ background: 'none', border: 'none', color: '#FFFFFF', cursor: 'pointer', fontSize: 14 }}>×</button>
                  </div>
                  {drilldownLoading ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0' }}>
                      <span style={{ fontSize: 11, color: '#FFFFFF' }}>Loading games…</span>
                    </div>
                  ) : !drilldownData || drilldownData.games.length === 0 ? (
                    <div style={{ fontSize: 11, color: '#FFFFFF', padding: '8px 0' }}>No games found for this date.</div>
                  ) : (
                    <table style={{ borderCollapse: 'collapse', fontSize: 10, fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', width: '100%' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #FFFFFF' }}>
                          {['MATCHUP', 'BRIER', 'MODEL AWAY%', 'MODEL HOME%', 'BOOK ML', 'SCORE', 'RESULT'].map(h => (
                            <th key={h} style={{ padding: '4px 8px', textAlign: h === 'MATCHUP' ? 'left' : 'right', color: '#FFFFFF', fontWeight: 700, letterSpacing: '.08em', fontSize: 9 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {drilldownData.games.map((g: typeof drilldownData.games[number]) => {
                          const brier = g.focusBrier;
                          const brierColor = brier == null ? '#FFFFFF' : brier <= 0.15 ? '#45E0A8' : brier <= 0.22 ? '#FFFFFF' : '#FFFFFF';
                          const mktKey = selectedCell.market;
                          const modelAway = (mktKey === 'f5Ml' || mktKey === 'f5Total') ? g.modelF5AwayWinPct : g.modelAwayWinPct;
                          const modelHome = (mktKey === 'f5Ml' || mktKey === 'f5Total') ? g.modelF5HomeWinPct : g.modelHomeWinPct;
                          const bookAway = (mktKey === 'f5Ml' || mktKey === 'f5Total') ? g.f5AwayML : g.awayML;
                          const bookHome = (mktKey === 'f5Ml' || mktKey === 'f5Total') ? g.f5HomeML : g.homeML;
                          const result = mktKey === 'f5Ml' ? g.f5MlResult : mktKey === 'fgMl' ? g.fgMlResult : null;
                          const correct = mktKey === 'f5Ml' ? g.f5MlCorrect : mktKey === 'fgMl' ? g.fgMlCorrect : mktKey === 'nrfi' ? g.nrfiCorrect : null;
                          const scoreAway = mktKey.startsWith('f5') ? g.actualF5AwayScore : g.actualAwayScore;
                          const scoreHome = mktKey.startsWith('f5') ? g.actualF5HomeScore : g.actualHomeScore;
                          return (
                            <tr key={g.id} style={{ borderBottom: '1px solid #FFFFFF' }}>
                              <td style={{ padding: '5px 8px', color: '#FFFFFF', fontWeight: 600, whiteSpace: 'nowrap' }}>{g.awayTeam} @ {g.homeTeam}</td>
                              <td style={{ padding: '5px 8px', textAlign: 'right', color: brierColor, fontWeight: 700 }}>{brier != null ? brier.toFixed(4) : <span style={{ color: '#FFFFFF' }}>—</span>}</td>
                              <td style={{ padding: '5px 8px', textAlign: 'right', color: '#FFFFFF' }}>{modelAway != null ? modelAway.toFixed(1) + '%' : '—'}</td>
                              <td style={{ padding: '5px 8px', textAlign: 'right', color: '#FFFFFF' }}>{modelHome != null ? modelHome.toFixed(1) + '%' : '—'}</td>
                              <td style={{ padding: '5px 8px', textAlign: 'right', color: '#FFFFFF', fontSize: 9 }}>{bookAway ?? '—'} / {bookHome ?? '—'}</td>
                              <td style={{ padding: '5px 8px', textAlign: 'right', color: '#FFFFFF' }}>{scoreAway != null && scoreHome != null ? `${scoreAway}–${scoreHome}` : '—'}</td>
                              <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 700, color: correct === 1 ? '#45E0A8' : correct === 0 ? '#FFFFFF' : '#FFFFFF' }}>
                                {correct === 1 ? '✓' : correct === 0 ? '✗' : result ?? '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </>
          )
        )}

        {/* ── LAST 7 DAYS VIEW ────────────────────────────────────────────────────── */}
        {viewMode === 'last7' && (
          last7Loading ? (
            <div className="flex items-center justify-center py-12 gap-3">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#45E0A8' }} />
              <span className="text-sm text-muted-foreground">Loading 7-day window…</span>
            </div>
          ) : !last7Data || last7Data.totalProps === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
              <CalendarDays className="w-10 h-10 text-muted-foreground/30" />
              <div>
                <p className="text-sm font-semibold text-foreground mb-1">No K-Props data in the last 7 days</p>
                <p className="text-xs text-muted-foreground">Run the model for MLB games first.</p>
              </div>
            </div>
          ) : (
            <>
              {/* Aggregate summary */}
              <div style={{ marginBottom: 20 }}>
                <div style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase',
                  color: '#FFFFFF', fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif',
                  marginBottom: 10,
                }}>
                  7-DAY AGGREGATE — {last7Data.completedProps} COMPLETED PROPS
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <StatCard
                    label="7-DAY ACCURACY"
                    value={last7Data.completedProps > 0 ? fmtPct(last7Data.accuracy) : '—'}
                    sub={`${last7Data.correctProps}/${last7Data.completedProps} correct`}
                    color={accuracyColor(last7Data.accuracy)}
                  />
                  <StatCard
                    label="TOTAL PROPS"
                    value={String(last7Data.totalProps)}
                    sub={`${last7Data.completedProps} completed · ${last7Data.totalProps - last7Data.completedProps} pending`}
                  />
                  <StatCard
                    label="OVER ACCURACY"
                    value={last7Data.overTotal > 0 ? fmtPct(last7Data.overAccuracy) : '—'}
                    sub={`${last7Data.overCorrect}/${last7Data.overTotal} overs correct`}
                    color={accuracyColor(last7Data.overAccuracy)}
                  />
                  <StatCard
                    label="UNDER ACCURACY"
                    value={last7Data.underTotal > 0 ? fmtPct(last7Data.underAccuracy) : '—'}
                    sub={`${last7Data.underCorrect}/${last7Data.underTotal} unders correct`}
                    color={accuracyColor(last7Data.underAccuracy)}
                  />
                  <StatCard
                    label="OVER BIAS"
                    value={last7Data.overBiasPct !== null ? fmtPct(last7Data.overBiasPct) : '—'}
                    sub={`${last7Data.overTotal}O / ${last7Data.underTotal}U / ${last7Data.pushTotal}P`}
                    color={last7Data.overBiasPct !== null
                      ? Math.abs(last7Data.overBiasPct - 0.5) <= 0.05 ? '#45E0A8'
                      : Math.abs(last7Data.overBiasPct - 0.5) <= 0.15 ? '#FFFFFF'
                      : '#FFFFFF'
                      : undefined}
                  />
                  <StatCard
                    label="7-DAY MAE"
                    value={last7Data.mae !== null ? fmtNum(last7Data.mae, 3) : '—'}
                    sub="mean absolute error"
                    color={last7Data.mae !== null
                      ? last7Data.mae <= 0.8 ? '#45E0A8'
                      : last7Data.mae <= 1.5 ? '#FFFFFF'
                      : '#FFFFFF'
                      : undefined}
                  />
                  <StatCard
                    label="MEAN BIAS"
                    value={last7Data.meanError !== null ? signedNum(last7Data.meanError, 3) : '—'}
                    sub="avg (actual − proj)"
                    color={last7Data.meanError !== null
                      ? Math.abs(last7Data.meanError) <= 0.2 ? '#45E0A8'
                      : Math.abs(last7Data.meanError) <= 0.5 ? '#FFFFFF'
                      : '#FFFFFF'
                      : undefined}
                  />
                </div>
              </div>

              {/* Per-day breakdown table */}
              {last7Data.dailyBreakdown.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase',
                    color: '#FFFFFF', fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif',
                    marginBottom: 10,
                  }}>
                    PER-DAY BREAKDOWN
                  </div>
                  <div style={{
                    background: '#000000', border: '1px solid #FFFFFF', borderRadius: 10, overflow: 'hidden',
                  }}>
                    {/* Header row */}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 60px 60px 60px 80px 60px 60px 80px',
                      padding: '8px 14px',
                      borderBottom: '1px solid #FFFFFF',
                      gap: 8,
                    }}>
                      {['DATE', 'PROPS', 'DONE', 'CORRECT', 'ACCURACY', 'OVER', 'UNDER', 'MAE'].map(h => (
                        <div key={h} style={{
                          fontSize: 8, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase',
                          color: '#FFFFFF', fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif',
                          textAlign: h === 'DATE' ? 'left' : 'center',
                        }}>{h}</div>
                      ))}
                    </div>
                    {/* Data rows */}
                    {[...last7Data.dailyBreakdown].reverse().map((day, idx) => {
                      const accColor7 = accuracyColor(day.accuracy);
                      return (
                        <div
                          key={day.date}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 60px 60px 60px 80px 60px 60px 80px',
                            padding: '9px 14px',
                            gap: 8,
                            borderBottom: idx < last7Data.dailyBreakdown.length - 1 ? '1px solid #FFFFFF' : 'none',
                            background: idx % 2 === 0 ? 'transparent' : 'transparent',
                          }}
                        >
                          <div style={{ fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 13, fontWeight: 700, color: '#FFFFFF' }}>
                            {formatDateNav(day.date)}
                          </div>
                          <div style={{ textAlign: 'center', fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 13, color: '#FFFFFF' }}>{day.total}</div>
                          <div style={{ textAlign: 'center', fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 13, color: '#FFFFFF' }}>{day.completed}</div>
                          <div style={{ textAlign: 'center', fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 13, color: day.completed > 0 ? accColor7 : '#FFFFFF' }}>{day.correct}</div>
                          <div style={{ textAlign: 'center', fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 14, fontWeight: 800, color: accColor7 }}>
                            {day.completed > 0 ? fmtPct(day.accuracy) : '—'}
                          </div>
                          <div style={{ textAlign: 'center', fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 13, color: '#45E0A8' }}>{day.overTotal}</div>
                          <div style={{ textAlign: 'center', fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 13, color: '#FFFFFF' }}>{day.underTotal}</div>
                          <div style={{ textAlign: 'center', fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 13, color: day.mae !== null ? (day.mae <= 0.8 ? '#45E0A8' : day.mae <= 1.5 ? '#FFFFFF' : '#FFFFFF') : '#FFFFFF' }}>
                            {day.mae !== null ? fmtNum(day.mae, 2) : '—'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )
        )}

        {/* ── DAILY VIEW ────────────────────────────────────────────────────── */}
        {viewMode === 'daily' && (
          dailyLoading ? (
            <div className="flex items-center justify-center py-12 gap-3">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#45E0A8" }} />
              <span className="text-sm text-muted-foreground">Loading results…</span>
            </div>
          ) : !daily || daily.total === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
              <BarChart3 className="w-10 h-10 text-muted-foreground/30" />
              <div>
                <p className="text-sm font-semibold text-foreground mb-1">No K-Props data for {formatDateNav(gameDate)}</p>
                <p className="text-xs text-muted-foreground">Run the model for MLB games on this date first.</p>
              </div>
            </div>
          ) : (
            <>
              {/* ── Section: Daily Accuracy ──────────────────────────────── */}
              <div style={{ marginBottom: 20 }}>
                <div style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase",
                  color: "#FFFFFF", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif',
                  marginBottom: 10,
                }}>
                  DAILY ACCURACY — {formatDateNav(gameDate).toUpperCase()}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <StatCard
                    label="ACCURACY"
                    value={daily.completed > 0 ? fmtPct(accuracy) : "—"}
                    sub={`${daily.correct}/${daily.completed} correct`}
                    color={accColor}
                  />
                  <StatCard
                    label="TOTAL PROPS"
                    value={String(daily.total)}
                    sub={`${daily.completed} completed · ${daily.total - daily.completed} pending`}
                  />
                  <StatCard
                    label="OVER ACCURACY"
                    value={daily.overTotal > 0 ? fmtPct(daily.overCorrect / daily.overTotal) : "—"}
                    sub={`${daily.overCorrect}/${daily.overTotal} overs correct`}
                    color={daily.overTotal > 0 ? accuracyColor(daily.overCorrect / daily.overTotal) : undefined}
                  />
                  <StatCard
                    label="UNDER ACCURACY"
                    value={daily.underTotal > 0 ? fmtPct(daily.underCorrect / daily.underTotal) : "—"}
                    sub={`${daily.underCorrect}/${daily.underTotal} unders correct`}
                    color={daily.underTotal > 0 ? accuracyColor(daily.underCorrect / daily.underTotal) : undefined}
                  />
                  <StatCard
                    label="MEAN ERROR"
                    value={daily.meanError !== null ? signedNum(daily.meanError, 2) : "—"}
                    sub="avg (actual − proj)"
                    color={daily.meanError !== null
                      ? Math.abs(daily.meanError) <= 0.3 ? "#45E0A8"
                      : Math.abs(daily.meanError) <= 0.8 ? "#FFFFFF"
                      : "#FFFFFF"
                      : undefined}
                  />
                  <StatCard
                    label="MAE"
                    value={daily.mae !== null ? fmtNum(daily.mae, 2) : "—"}
                    sub="mean absolute error"
                    color={daily.mae !== null
                      ? daily.mae <= 0.8 ? "#45E0A8"
                      : daily.mae <= 1.5 ? "#FFFFFF"
                      : "#FFFFFF"
                      : undefined}
                  />
                </div>
              </div>

              {/* ── Section: Rolling Calibration ────────────────────────── */}
              {!calibrationLoading && calibration && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase",
                    color: "#FFFFFF", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif',
                    marginBottom: 10,
                  }}>
                    ROLLING CALIBRATION — ALL TIME ({calibration.completedProps} props)
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <StatCard
                      label="MODEL ACCURACY"
                      value={fmtPct(calibration.modelAccuracy)}
                      sub={`${calibration.completedProps} completed props`}
                      color={accuracyColor(calibration.modelAccuracy)}
                    />
                    <StatCard
                      label="OVER ACCURACY"
                      value={fmtPct(calibration.modelOverAccuracy)}
                      sub={`${calibration.overCount} overs`}
                      color={accuracyColor(calibration.modelOverAccuracy)}
                    />
                    <StatCard
                      label="UNDER ACCURACY"
                      value={fmtPct(calibration.modelUnderAccuracy)}
                      sub={`${calibration.underCount} unders`}
                      color={accuracyColor(calibration.modelUnderAccuracy)}
                    />
                    <StatCard
                      label="ROLLING MAE"
                      value={fmtNum(calibration.mae, 3)}
                      sub="mean absolute error"
                      color={calibration.mae <= 0.8 ? "#45E0A8" : calibration.mae <= 1.5 ? "#FFFFFF" : "#FFFFFF"}
                    />
                    <StatCard
                      label="MEAN BIAS"
                      value={signedNum(calibration.meanBias, 3)}
                      sub="avg (actual − proj)"
                      color={Math.abs(calibration.meanBias) <= 0.2 ? "#45E0A8" : Math.abs(calibration.meanBias) <= 0.5 ? "#FFFFFF" : "#FFFFFF"}
                    />
                    <StatCard
                      label="CALIBRATION FACTOR"
                      value={fmtNum(calibration.calibrationFactor, 4)}
                      sub="multiply proj × factor"
                      color={Math.abs(calibration.calibrationFactor - 1) <= 0.03 ? "#45E0A8" : "#FFFFFF"}
                    />
                    <StatCard
                      label="RMSE"
                      value={fmtNum(calibration.rmse, 3)}
                      sub="root mean squared error"
                    />
                  </div>
                </div>
              )}

              {/* ── Section: Per-pitcher results ─────────────────────────── */}
              <div>
                <div style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase",
                  color: "#FFFFFF", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif',
                  marginBottom: 10, display: "flex", alignItems: "center", gap: 8,
                }}>
                  <span>PER-PITCHER RESULTS</span>
                  <span style={{ color: "#FFFFFF" }}>·</span>
                  <span style={{ color: "#FFFFFF" }}>{daily.total} pitchers</span>
                  {daily.completed > 0 && (
                    <>
                      <span style={{ color: "#FFFFFF" }}>·</span>
                      <span style={{ color: accColor }}>{daily.correct}/{daily.completed} correct</span>
                    </>
                  )}
                </div>
                {daily.props.map((prop) => (
                  <PitcherResultRow key={prop.id} prop={prop as PropRow} />
                ))}
              </div>
            </>
          )
        )}
      </main>
    </div>
  );
}
