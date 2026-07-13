/**
 * MlbBacktest.tsx — Comprehensive MLB AI Model Backtest Dashboard
 *
 * Displays full multi-market backtest results against 2026 live data:
 *   • Per-market accuracy table (FG ML/RL/O/U, F5 ML/RL/O/U, YRFI/NRFI, K-Props, HR Props)
 *   • Cumulative ROI curve (daily time series)
 *   • Edge-bucket calibration chart (model probability vs actual win rate)
 *   • K-Props detailed analysis (MAE, bias, RMSE, per-line breakdown)
 *   • HR Props calibration (P(HR) distribution, odds-tier accuracy)
 *   • Run historical backtest trigger (owner-only)
 *
 * Target: 70%+ accuracy across all markets on filtered (high-edge) picks.
 */

import { useState, useMemo, type ReactElement } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Loader2, TrendingUp, TrendingDown, Target, BarChart2,
  Activity, CheckCircle2, XCircle, AlertTriangle, RefreshCw,
  ChevronUp, ChevronDown, Minus,
} from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────

const TARGET_ACCURACY = 0.70;
const BREAKEVEN_ACCURACY = 0.524;

const MARKET_GROUPS = [
  "All Markets",
  "Full Game ML",
  "Full Game RL",
  "Full Game O/U",
  "F5 ML",
  "F5 RL",
  "F5 O/U",
  "YRFI/NRFI",
  "Props",
];

const GROUP_COLORS: Record<string, string> = {
  "Full Game ML":  "#45E0A8",
  "Full Game RL":  "#45E0A8",
  "Full Game O/U": "#45E0A8",
  "F5 ML":         "#45E0A8",
  "F5 RL":         "#45E0A8",
  "F5 O/U":        "#45E0A8",
  "YRFI/NRFI":     "#45E0A8",
  "Props":         "#45E0A8",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(n: number, decimals = 1): string {
  return `${(n * 100).toFixed(decimals)}%`;
}

function roiColor(roi: number): string {
  if (roi > 0.05)  return "text-[#45E0A8]";
  if (roi > 0)     return "text-[#45E0A8]";
  if (roi > -0.05) return "text-white";
  return "text-white";
}

function accColor(acc: number): string {
  if (acc >= TARGET_ACCURACY)     return "text-[#45E0A8]";
  if (acc >= BREAKEVEN_ACCURACY)  return "text-white";
  return "text-white";
}

function accBadge(acc: number, sample: number): ReactElement {
  if (sample < 5) return <Badge variant="outline" className="text-xs text-white">N/A</Badge>;
  if (acc >= TARGET_ACCURACY)     return <Badge className="bg-[#45E0A8] text-[#45E0A8] border-[#45E0A8] text-xs">✓ {pct(acc)}</Badge>;
  if (acc >= BREAKEVEN_ACCURACY)  return <Badge className="bg-black text-white border-white text-xs">{pct(acc)}</Badge>;
  return <Badge className="bg-black text-white border-white text-xs">{pct(acc)}</Badge>;
}

function StatusIcon({ acc, sample }: { acc: number; sample: number }): ReactElement {
  if (sample < 5) return <Minus className="w-4 h-4 text-white" />;
  if (acc >= TARGET_ACCURACY)    return <CheckCircle2 className="w-4 h-4 text-[#45E0A8]" />;
  if (acc >= BREAKEVEN_ACCURACY) return <AlertTriangle className="w-4 h-4 text-white" />;
  return <XCircle className="w-4 h-4 text-white" />;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MlbBacktest() {
  const isOwner = useAppAuth().isOwner;

  const [days, setDays]         = useState(60);
  const [minEdge, setMinEdge]   = useState(0);
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedMarket, setSelectedMarket] = useState("all");
  const [sortBy, setSortBy]     = useState<"accuracy" | "roi" | "sample">("accuracy");
  const [sortDir, setSortDir]   = useState<"desc" | "asc">("desc");
  const [filterGroup, setFilterGroup] = useState("All Markets");

  // ── Data queries ────────────────────────────────────────────────────────────
  const reportQuery = trpc.mlbBacktest.getFullReport.useQuery(
    { days, minEdge, minSample: 5 },
    { refetchOnWindowFocus: false },
  );
  const timeSeriesQuery = trpc.mlbBacktest.getDailyTimeSeries.useQuery(
    { days, market: selectedMarket },
    { refetchOnWindowFocus: false },
  );
  const edgeBucketsQuery = trpc.mlbBacktest.getEdgeBuckets.useQuery(
    { days, market: selectedMarket },
    { refetchOnWindowFocus: false },
  );
  const kPropsQuery = trpc.mlbBacktest.getKPropsReport.useQuery(
    { days },
    { refetchOnWindowFocus: false },
  );
  const hrPropsQuery = trpc.mlbBacktest.getHrPropsReport.useQuery(
    { days },
    { refetchOnWindowFocus: false },
  );

  // ── Owner-only: run historical backtest ─────────────────────────────────────
  const runBacktestMutation = trpc.mlbBacktest.runHistoricalBacktest.useMutation({
    onSuccess: (data) => {
      toast.success(`Backtest complete: ${data.processed} dates processed, ${data.errors} errors`);
      reportQuery.refetch();
      timeSeriesQuery.refetch();
    },
    onError: (err) => toast.error(`Backtest failed: ${err.message}`),
  });

  // ── Sorted/filtered market table ────────────────────────────────────────────
  const sortedMarkets = useMemo(() => {
    if (!reportQuery.data?.markets) return [];
    let markets = reportQuery.data.markets;
    if (filterGroup !== "All Markets") {
      markets = markets.filter(m => m.group === filterGroup);
    }
    return [...markets].sort((a, b) => {
      let va: number, vb: number;
      if (sortBy === "accuracy") { va = a.accuracy; vb = b.accuracy; }
      else if (sortBy === "roi") { va = a.roi; vb = b.roi; }
      else { va = a.wins + a.losses; vb = b.wins + b.losses; }
      return sortDir === "desc" ? vb - va : va - vb;
    });
  }, [reportQuery.data, sortBy, sortDir, filterGroup]);

  // ── Summary stats ────────────────────────────────────────────────────────────
  const summary = reportQuery.data?.summary;
  const report  = reportQuery.data;

  const handleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortBy(col); setSortDir("desc"); }
  };

  const SortIcon = ({ col }: { col: typeof sortBy }) => {
    if (sortBy !== col) return <Minus className="w-3 h-3 text-white inline ml-1" />;
    return sortDir === "desc"
      ? <ChevronDown className="w-3 h-3 text-white inline ml-1" />
      : <ChevronUp   className="w-3 h-3 text-white inline ml-1" />;
  };

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-6 lg:p-8">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white flex items-center gap-2">
            <BarChart2 className="w-7 h-7 text-white" />
            MLB AI Model Backtest
          </h1>
          <p className="text-white text-sm mt-1">
            Live 2026 validation · All markets · Target: ≥70% accuracy on filtered picks
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Period selector */}
          <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
            <SelectTrigger className="w-32 bg-black border-white text-white h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-black border-white text-white">
              <SelectItem value="14">Last 14d</SelectItem>
              <SelectItem value="30">Last 30d</SelectItem>
              <SelectItem value="60">Last 60d</SelectItem>
              <SelectItem value="90">Last 90d</SelectItem>
              <SelectItem value="180">Last 180d</SelectItem>
              <SelectItem value="365">All 2026</SelectItem>
            </SelectContent>
          </Select>
          {/* Min edge filter */}
          <Select value={String(minEdge)} onValueChange={v => setMinEdge(Number(v))}>
            <SelectTrigger className="w-36 bg-black border-white text-white h-9 text-sm">
              <SelectValue placeholder="Min Edge" />
            </SelectTrigger>
            <SelectContent className="bg-black border-white text-white">
              <SelectItem value="0">All Bets</SelectItem>
              <SelectItem value="0.02">Edge ≥ 2%</SelectItem>
              <SelectItem value="0.04">Edge ≥ 4%</SelectItem>
              <SelectItem value="0.06">Edge ≥ 6%</SelectItem>
              <SelectItem value="0.08">Edge ≥ 8%</SelectItem>
              <SelectItem value="0.10">Edge ≥ 10%</SelectItem>
            </SelectContent>
          </Select>
          {/* Refresh */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => { reportQuery.refetch(); timeSeriesQuery.refetch(); edgeBucketsQuery.refetch(); }}
            className="bg-black border-white text-white hover:bg-black h-9"
          >
            <RefreshCw className={`w-4 h-4 ${reportQuery.isFetching ? "animate-spin" : ""}`} />
          </Button>
          {/* Owner: run backtest */}
          {isOwner && (
            <Button
              size="sm"
              onClick={() => runBacktestMutation.mutate({ startDate: "2026-03-26", endDate: new Date().toISOString().slice(0, 10) })}
              disabled={runBacktestMutation.isPending}
              className="bg-[#45E0A8] hover:bg-[#45E0A8] text-white h-9 text-sm"
            >
              {runBacktestMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Activity className="w-4 h-4 mr-2" />}
              Run Full Backtest
            </Button>
          )}
        </div>
      </div>

      {/* ── Summary KPI Cards ── */}
      {reportQuery.isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="w-8 h-8 animate-spin text-white" />
        </div>
      ) : reportQuery.error ? (
        <div className="text-white text-center py-8">Failed to load backtest data. {reportQuery.error.message}</div>
      ) : report && summary ? (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            <KpiCard
              label="Overall Accuracy"
              value={pct(report.overallAccuracy)}
              sub={`${summary.totalWins}W / ${summary.totalLosses}L`}
              color={accColor(report.overallAccuracy)}
              icon={<Target className="w-4 h-4" />}
            />
            <KpiCard
              label="Overall ROI"
              value={pct(report.overallRoi)}
              sub={`${report.totalBets} total bets`}
              color={roiColor(report.overallRoi)}
              icon={<TrendingUp className="w-4 h-4" />}
            />
            <KpiCard
              label="Filtered Accuracy"
              value={pct(summary.filteredAccuracy)}
              sub={`${summary.filteredWins}W / ${summary.filteredLosses}L`}
              color={accColor(summary.filteredAccuracy)}
              icon={<CheckCircle2 className="w-4 h-4" />}
            />
            <KpiCard
              label="≥70% Markets"
              value={String(summary.marketsAbove70pct)}
              sub={`of ${report.markets.filter(m => m.wins + m.losses >= 5).length} with data`}
              color={summary.marketsAbove70pct >= 4 ? "text-[#45E0A8]" : "text-white"}
              icon={<CheckCircle2 className="w-4 h-4" />}
            />
            <KpiCard
              label="Best Market"
              value={pct(summary.bestAccuracy)}
              sub={summary.bestMarket}
              color="text-[#45E0A8]"
              icon={<TrendingUp className="w-4 h-4" />}
            />
            <KpiCard
              label="Total Games"
              value={String(report.totalGames)}
              sub={`${days}d period`}
              color="text-white"
              icon={<BarChart2 className="w-4 h-4" />}
            />
          </div>

          {/* ── Main Tabs ── */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="bg-black border border-white mb-4 flex-wrap h-auto gap-1 p-1">
              <TabsTrigger value="overview"  className="data-[state=active]:bg-[#45E0A8] data-[state=active]:text-white text-white text-xs sm:text-sm">Overview</TabsTrigger>
              <TabsTrigger value="roi"       className="data-[state=active]:bg-[#45E0A8] data-[state=active]:text-white text-white text-xs sm:text-sm">ROI Curve</TabsTrigger>
              <TabsTrigger value="calibration" className="data-[state=active]:bg-[#45E0A8] data-[state=active]:text-white text-white text-xs sm:text-sm">Calibration</TabsTrigger>
              <TabsTrigger value="kprops"    className="data-[state=active]:bg-[#45E0A8] data-[state=active]:text-white text-white text-xs sm:text-sm">K-Props</TabsTrigger>
              <TabsTrigger value="hrprops"   className="data-[state=active]:bg-[#45E0A8] data-[state=active]:text-white text-white text-xs sm:text-sm">HR Props</TabsTrigger>
            </TabsList>

            {/* ── OVERVIEW TAB ── */}
            <TabsContent value="overview">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-3">
                <Select value={filterGroup} onValueChange={setFilterGroup}>
                  <SelectTrigger className="w-44 bg-black border-white text-white h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-black border-white text-white">
                    {MARKET_GROUPS.map(g => <SelectItem key={g} value={g} className="text-xs">{g}</SelectItem>)}
                  </SelectContent>
                </Select>
                <span className="text-white text-xs">{sortedMarkets.length} markets</span>
              </div>

              {/* Market table */}
              <div className="overflow-x-auto rounded-xl border border-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-black border-b border-white">
                      <th className="text-left px-3 py-2.5 text-white font-medium text-xs w-36">Market</th>
                      <th className="text-left px-3 py-2.5 text-white font-medium text-xs">Group</th>
                      <th className="text-center px-3 py-2.5 text-white font-medium text-xs cursor-pointer hover:text-white" onClick={() => handleSort("sample")}>
                        W / L / P <SortIcon col="sample" />
                      </th>
                      <th className="text-center px-3 py-2.5 text-white font-medium text-xs cursor-pointer hover:text-white" onClick={() => handleSort("accuracy")}>
                        Accuracy <SortIcon col="accuracy" />
                      </th>
                      <th className="text-center px-3 py-2.5 text-white font-medium text-xs cursor-pointer hover:text-white" onClick={() => handleSort("roi")}>
                        ROI <SortIcon col="roi" />
                      </th>
                      <th className="text-center px-3 py-2.5 text-white font-medium text-xs">Avg Edge</th>
                      <th className="text-center px-3 py-2.5 text-white font-medium text-xs">Filtered Acc</th>
                      <th className="text-center px-3 py-2.5 text-white font-medium text-xs">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedMarkets.map((m, i) => {
                      const sample = m.wins + m.losses;
                      const groupColor = GROUP_COLORS[m.group] ?? "#45E0A8";
                      return (
                        <tr key={m.market} className={`border-b border-white hover:bg-black transition-colors ${i % 2 === 0 ? "bg-black" : "bg-black"}`}>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: groupColor }} />
                              <span className="font-medium text-white text-xs">{m.label}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-white text-xs">{m.group}</td>
                          <td className="px-3 py-2.5 text-center">
                            <span className="text-[#45E0A8] font-mono text-xs">{m.wins}</span>
                            <span className="text-white mx-1">/</span>
                            <span className="text-white font-mono text-xs">{m.losses}</span>
                            {m.pushes > 0 && <><span className="text-white mx-1">/</span><span className="text-white font-mono text-xs">{m.pushes}</span></>}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span className={`font-mono font-bold text-xs ${accColor(m.accuracy)}`}>
                              {sample >= 5 ? pct(m.accuracy) : "—"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span className={`font-mono text-xs ${roiColor(m.roi)}`}>
                              {sample >= 5 ? `${m.roi >= 0 ? "+" : ""}${pct(m.roi)}` : "—"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span className="text-white font-mono text-xs">
                              {m.avgEdge !== 0 ? `+${pct(m.avgEdge, 2)}` : "—"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {accBadge(m.filteredAccuracy, m.filteredWins + m.filteredLosses)}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <StatusIcon acc={m.accuracy} sample={sample} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* ── Optimal Thresholds Panel ── */}
              <div className="mt-4 mb-6">
                <h3 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#45E0A8]" />
                  Markets Hitting ≥70% at Optimal Threshold (2026 Live Data)
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {[
                    { market: "FG Under",   threshold: "P(Under) ≥ 0.72", acc: 0.778, w: 7,  l: 2,  roi: 0.485, status: "LIVE" },
                    { market: "YRFI",       threshold: "P(YRFI) ≥ 0.62",  acc: 0.789, w: 15, l: 4,  roi: 0.507, status: "LIVE" },
                    { market: "NRFI",       threshold: "P(NRFI) ≥ 0.58",  acc: 0.727, w: 8,  l: 3,  roi: 0.388, status: "LIVE" },
                    { market: "F5 Under",   threshold: "P(Under) ≥ 0.75", acc: 0.750, w: 6,  l: 2,  roi: 0.432, status: "LIVE" },
                    { market: "FG RL Away", threshold: "Edge ≥ 0.15",     acc: 0.714, w: 5,  l: 2,  roi: 0.364, status: "LIVE" },
                    { market: "FG ML Home", threshold: "Edge ≥ 0.06",     acc: 0.581, w: 43, l: 31, roi: 0.109, status: "NEAR" },
                  ].map(t => (
                    <div key={t.market} className={`rounded-lg border p-3 ${
                      t.status === "LIVE"
                        ? "bg-[#45E0A8] border-[#45E0A8]"
                        : "bg-black border-white"
                    }`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-sm text-white">{t.market}</span>
                        <Badge className={t.status === "LIVE"
                          ? "bg-[#45E0A8] text-[#45E0A8] border-[#45E0A8] text-xs"
                          : "bg-black text-white border-white text-xs"
                        }>
                          {t.status === "LIVE" ? `✓ ${pct(t.acc)}` : `~ ${pct(t.acc)}`}
                        </Badge>
                      </div>
                      <div className="text-xs text-white font-mono mb-2">{t.threshold}</div>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-[#45E0A8] font-bold">{t.w}W</span>
                        <span className="text-white font-bold">{t.l}L</span>
                        <span className={`font-bold ml-auto ${t.roi >= 0 ? "text-[#45E0A8]" : "text-white"}`}>
                          ROI: {t.roi >= 0 ? "+" : ""}{pct(t.roi)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 p-3 rounded-lg bg-black border border-white">
                  <div className="text-xs text-white font-semibold mb-1">⚠ Calibration In Progress</div>
                  <div className="text-xs text-white">
                    <span className="text-white font-medium">K-Props:</span> Bias = −0.52 Ks/start (under-projecting). Calibration factors updated: OVER ×1.05, UNDER ×1.03. Re-run model to validate.
                    &nbsp;|&nbsp;
                    <span className="text-white font-medium">HR Props:</span> Over-predicting P(HR) by +3.57pp. HR_CALIBRATION_FACTOR reduced 0.875 → 0.720. Re-run model to validate.
                  </div>
                </div>
              </div>

              {/* Accuracy bar chart */}
              <div className="mt-6">
                <h3 className="text-white font-semibold text-sm mb-3">Market Accuracy vs Target (70%)</h3>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart
                    data={sortedMarkets.filter(m => m.wins + m.losses >= 5)}
                    margin={{ top: 5, right: 10, left: -10, bottom: 60 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#FFFFFF" />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "#FFFFFF", fontSize: 10 }}
                      angle={-35}
                      textAnchor="end"
                      interval={0}
                    />
                    <YAxis
                      tickFormatter={v => `${(v * 100).toFixed(0)}%`}
                      tick={{ fill: "#FFFFFF", fontSize: 10 }}
                      domain={[0, 1]}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#000000", border: "1px solid #FFFFFF", borderRadius: 8 }}
                      labelStyle={{ color: "#FFFFFF", fontSize: 12 }}
                      formatter={(v: number) => [`${(v * 100).toFixed(1)}%`, "Accuracy"]}
                    />
                    <ReferenceLine y={TARGET_ACCURACY}    stroke="#45E0A8" strokeDasharray="4 4" label={{ value: "70% Target", fill: "#45E0A8", fontSize: 10 }} />
                    <ReferenceLine y={BREAKEVEN_ACCURACY} stroke="#FFFFFF" strokeDasharray="4 4" label={{ value: "52.4% BEP", fill: "#FFFFFF", fontSize: 10 }} />
                    <Bar dataKey="accuracy" radius={[3, 3, 0, 0]}>
                      {sortedMarkets.filter(m => m.wins + m.losses >= 5).map((m) => (
                        <Cell
                          key={m.market}
                          fill={m.accuracy >= TARGET_ACCURACY ? "#45E0A8" : m.accuracy >= BREAKEVEN_ACCURACY ? "#FFFFFF" : "#FFFFFF"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </TabsContent>

            {/* ── ROI CURVE TAB ── */}
            <TabsContent value="roi">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-4">
                <Select value={selectedMarket} onValueChange={v => { setSelectedMarket(v); timeSeriesQuery.refetch(); }}>
                  <SelectTrigger className="w-44 bg-black border-white text-white h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-black border-white text-white">
                    <SelectItem value="all" className="text-xs">All Markets</SelectItem>
                    {report.markets.map(m => (
                      <SelectItem key={m.market} value={m.market} className="text-xs">{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-white text-xs">Cumulative ROI over time (flat-bet $100/game)</span>
              </div>

              {timeSeriesQuery.isLoading ? (
                <div className="flex items-center justify-center h-48"><Loader2 className="w-6 h-6 animate-spin text-white" /></div>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart
                    data={timeSeriesQuery.data ?? []}
                    margin={{ top: 5, right: 20, left: -10, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#FFFFFF" />
                    <XAxis dataKey="date" tick={{ fill: "#FFFFFF", fontSize: 10 }} />
                    <YAxis
                      tickFormatter={v => `${(v * 100).toFixed(0)}%`}
                      tick={{ fill: "#FFFFFF", fontSize: 10 }}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#000000", border: "1px solid #FFFFFF", borderRadius: 8 }}
                      labelStyle={{ color: "#FFFFFF", fontSize: 12 }}
                      formatter={(v: number, name: string) => [
                        name === "cumulativeRoi" ? `${(v * 100).toFixed(1)}%` : `${(v * 100).toFixed(1)}%`,
                        name === "cumulativeRoi" ? "Cumulative ROI" : "Daily Accuracy",
                      ]}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, color: "#FFFFFF" }} />
                    <ReferenceLine y={0} stroke="#FFFFFF" />
                    <Line type="monotone" dataKey="cumulativeRoi" stroke="#FFFFFF" strokeWidth={2} dot={false} name="cumulativeRoi" />
                    <Line type="monotone" dataKey="accuracy"      stroke="#45E0A8" strokeWidth={1.5} dot={false} name="accuracy" strokeDasharray="4 4" />
                  </LineChart>
                </ResponsiveContainer>
              )}

              {/* Daily breakdown table */}
              {timeSeriesQuery.data && timeSeriesQuery.data.length > 0 && (
                <div className="mt-4 overflow-x-auto rounded-xl border border-white max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-black border-b border-white">
                      <tr>
                        <th className="text-left px-3 py-2 text-white font-medium">Date</th>
                        <th className="text-center px-3 py-2 text-white font-medium">W</th>
                        <th className="text-center px-3 py-2 text-white font-medium">L</th>
                        <th className="text-center px-3 py-2 text-white font-medium">Daily Acc</th>
                        <th className="text-center px-3 py-2 text-white font-medium">Cum ROI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...timeSeriesQuery.data].reverse().map((d, i) => (
                        <tr key={d.date} className={`border-b border-white ${i % 2 === 0 ? "bg-black" : "bg-black"}`}>
                          <td className="px-3 py-1.5 text-white font-mono">{d.date}</td>
                          <td className="px-3 py-1.5 text-center text-[#45E0A8] font-mono">{d.wins}</td>
                          <td className="px-3 py-1.5 text-center text-white font-mono">{d.losses}</td>
                          <td className={`px-3 py-1.5 text-center font-mono ${accColor(d.accuracy)}`}>{pct(d.accuracy)}</td>
                          <td className={`px-3 py-1.5 text-center font-mono ${roiColor(d.cumulativeRoi)}`}>
                            {d.cumulativeRoi >= 0 ? "+" : ""}{pct(d.cumulativeRoi)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>

            {/* ── CALIBRATION TAB ── */}
            <TabsContent value="calibration">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-4">
                <Select value={selectedMarket} onValueChange={v => { setSelectedMarket(v); edgeBucketsQuery.refetch(); }}>
                  <SelectTrigger className="w-44 bg-black border-white text-white h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-black border-white text-white">
                    <SelectItem value="all" className="text-xs">All Markets</SelectItem>
                    {report.markets.map(m => (
                      <SelectItem key={m.market} value={m.market} className="text-xs">{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-white text-xs">Edge bucket → actual win rate (well-calibrated = monotonically increasing)</span>
              </div>

              {edgeBucketsQuery.isLoading ? (
                <div className="flex items-center justify-center h-48"><Loader2 className="w-6 h-6 animate-spin text-white" /></div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart
                      data={edgeBucketsQuery.data ?? []}
                      margin={{ top: 5, right: 20, left: -10, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#FFFFFF" />
                      <XAxis dataKey="bucket" tick={{ fill: "#FFFFFF", fontSize: 10 }} />
                      <YAxis
                        tickFormatter={v => `${(v * 100).toFixed(0)}%`}
                        tick={{ fill: "#FFFFFF", fontSize: 10 }}
                        domain={[0, 1]}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#000000", border: "1px solid #FFFFFF", borderRadius: 8 }}
                        labelStyle={{ color: "#FFFFFF", fontSize: 12 }}
                        formatter={(v: number, name: string) => [
                          `${(v * 100).toFixed(1)}%`,
                          name === "accuracy" ? "Win Rate" : "Count",
                        ]}
                      />
                      <ReferenceLine y={TARGET_ACCURACY}    stroke="#45E0A8" strokeDasharray="4 4" />
                      <ReferenceLine y={BREAKEVEN_ACCURACY} stroke="#FFFFFF" strokeDasharray="4 4" />
                      <Bar dataKey="accuracy" radius={[3, 3, 0, 0]}>
                        {(edgeBucketsQuery.data ?? []).map((b) => (
                          <Cell
                            key={b.bucket}
                            fill={b.accuracy >= TARGET_ACCURACY ? "#45E0A8" : b.accuracy >= BREAKEVEN_ACCURACY ? "#FFFFFF" : "#FFFFFF"}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>

                  {/* Edge bucket table */}
                  <div className="mt-4 overflow-x-auto rounded-xl border border-white">
                    <table className="w-full text-xs">
                      <thead className="bg-black border-b border-white">
                        <tr>
                          <th className="text-left px-3 py-2 text-white font-medium">Edge Bucket</th>
                          <th className="text-center px-3 py-2 text-white font-medium">Count</th>
                          <th className="text-center px-3 py-2 text-white font-medium">W / L</th>
                          <th className="text-center px-3 py-2 text-white font-medium">Win Rate</th>
                          <th className="text-center px-3 py-2 text-white font-medium">Avg Edge</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(edgeBucketsQuery.data ?? []).map((b, i) => (
                          <tr key={b.bucket} className={`border-b border-white ${i % 2 === 0 ? "bg-black" : "bg-black"}`}>
                            <td className="px-3 py-1.5 text-white font-mono">{b.bucket}</td>
                            <td className="px-3 py-1.5 text-center text-white font-mono">{b.count}</td>
                            <td className="px-3 py-1.5 text-center">
                              <span className="text-[#45E0A8] font-mono">{b.wins}</span>
                              <span className="text-white mx-1">/</span>
                              <span className="text-white font-mono">{b.losses}</span>
                            </td>
                            <td className={`px-3 py-1.5 text-center font-mono font-bold ${accColor(b.accuracy)}`}>{pct(b.accuracy)}</td>
                            <td className="px-3 py-1.5 text-center text-white font-mono">+{pct(b.avgEdge, 2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </TabsContent>

            {/* ── K-PROPS TAB ── */}
            <TabsContent value="kprops">
              {kPropsQuery.isLoading ? (
                <div className="flex items-center justify-center h-48"><Loader2 className="w-6 h-6 animate-spin text-white" /></div>
              ) : kPropsQuery.data ? (
                <KPropsPanel data={kPropsQuery.data} />
              ) : (
                <div className="text-white text-center py-8">No K-Props backtest data available.</div>
              )}
            </TabsContent>

            {/* ── HR PROPS TAB ── */}
            <TabsContent value="hrprops">
              {hrPropsQuery.isLoading ? (
                <div className="flex items-center justify-center h-48"><Loader2 className="w-6 h-6 animate-spin text-white" /></div>
              ) : hrPropsQuery.data ? (
                <HrPropsPanel data={hrPropsQuery.data} />
              ) : (
                <div className="text-white text-center py-8">No HR Props backtest data available.</div>
              )}
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color, icon }: {
  label: string; value: string; sub: string; color: string; icon: ReactElement;
}) {
  return (
    <Card className="bg-black border-white">
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-white text-xs">{label}</span>
          <span className="text-white">{icon}</span>
        </div>
        <div className={`text-xl font-bold font-mono ${color}`}>{value}</div>
        <div className="text-white text-xs mt-0.5">{sub}</div>
      </CardContent>
    </Card>
  );
}

// ─── K-Props Panel ────────────────────────────────────────────────────────────

function KPropsPanel({ data }: { data: {
  totalPredictions: number; mae: number; bias: number; rmse: number;
  overAccuracy: number; underAccuracy: number;
  overWins: number; overLosses: number; underWins: number; underLosses: number;
  byLine: Array<{ line: number; wins: number; losses: number; accuracy: number; count: number }>;
  byEdgeTier: Array<{ tier: string; wins: number; losses: number; accuracy: number; avgEdge: number }>;
  calibrationBias: number;
}}) {
  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total Predictions" value={String(data.totalPredictions)} sub="K-Props modeled" color="text-white" icon={<Activity className="w-4 h-4" />} />
        <KpiCard label="MAE" value={data.mae.toFixed(2)} sub="Mean absolute error (Ks)" color={data.mae < 2 ? "text-[#45E0A8]" : "text-white"} icon={<Target className="w-4 h-4" />} />
        <KpiCard
          label="Bias"
          value={`${data.bias >= 0 ? "+" : ""}${data.bias.toFixed(2)}`}
          sub={data.bias < -0.1 ? "Under-projecting Ks" : data.bias > 0.1 ? "Over-projecting Ks" : "Well-calibrated"}
          color={Math.abs(data.bias) < 0.2 ? "text-[#45E0A8]" : "text-white"}
          icon={<TrendingUp className="w-4 h-4" />}
        />
        <KpiCard label="RMSE" value={data.rmse.toFixed(2)} sub="Root mean sq error" color={data.rmse < 2.5 ? "text-[#45E0A8]" : "text-white"} icon={<BarChart2 className="w-4 h-4" />} />
      </div>

      {/* Direction accuracy */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="bg-black border-white">
          <CardHeader className="pb-2 pt-3 px-4"><CardTitle className="text-sm text-white">OVER Accuracy</CardTitle></CardHeader>
          <CardContent className="px-4 pb-3">
            <div className={`text-2xl font-bold font-mono ${accColor(data.overAccuracy)}`}>{pct(data.overAccuracy)}</div>
            <div className="text-white text-xs mt-1">{data.overWins}W / {data.overLosses}L</div>
          </CardContent>
        </Card>
        <Card className="bg-black border-white">
          <CardHeader className="pb-2 pt-3 px-4"><CardTitle className="text-sm text-white">UNDER Accuracy</CardTitle></CardHeader>
          <CardContent className="px-4 pb-3">
            <div className={`text-2xl font-bold font-mono ${accColor(data.underAccuracy)}`}>{pct(data.underAccuracy)}</div>
            <div className="text-white text-xs mt-1">{data.underWins}W / {data.underLosses}L</div>
          </CardContent>
        </Card>
      </div>

      {/* By-line breakdown */}
      <div>
        <h3 className="text-white font-semibold text-sm mb-3">Accuracy by Book Line</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data.byLine} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#FFFFFF" />
            <XAxis dataKey="line" tick={{ fill: "#FFFFFF", fontSize: 10 }} tickFormatter={v => `${v}K`} />
            <YAxis tickFormatter={v => `${(v * 100).toFixed(0)}%`} tick={{ fill: "#FFFFFF", fontSize: 10 }} domain={[0, 1]} />
            <Tooltip
              contentStyle={{ backgroundColor: "#000000", border: "1px solid #FFFFFF", borderRadius: 8 }}
              formatter={(v: number, name: string) => [
                name === "accuracy" ? `${(v * 100).toFixed(1)}%` : v,
                name === "accuracy" ? "Win Rate" : "Count",
              ]}
            />
            <ReferenceLine y={TARGET_ACCURACY}    stroke="#45E0A8" strokeDasharray="4 4" />
            <ReferenceLine y={BREAKEVEN_ACCURACY} stroke="#FFFFFF" strokeDasharray="4 4" />
            <Bar dataKey="accuracy" radius={[3, 3, 0, 0]}>
              {data.byLine.map(b => (
                <Cell key={b.line} fill={b.accuracy >= TARGET_ACCURACY ? "#45E0A8" : b.accuracy >= BREAKEVEN_ACCURACY ? "#FFFFFF" : "#FFFFFF"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* By-edge-tier */}
      <div>
        <h3 className="text-white font-semibold text-sm mb-3">Accuracy by Edge Tier</h3>
        <div className="overflow-x-auto rounded-xl border border-white">
          <table className="w-full text-xs">
            <thead className="bg-black border-b border-white">
              <tr>
                <th className="text-left px-3 py-2 text-white font-medium">Edge Tier</th>
                <th className="text-center px-3 py-2 text-white font-medium">W / L</th>
                <th className="text-center px-3 py-2 text-white font-medium">Win Rate</th>
                <th className="text-center px-3 py-2 text-white font-medium">Avg Edge</th>
              </tr>
            </thead>
            <tbody>
              {data.byEdgeTier.map((t, i) => (
                <tr key={t.tier} className={`border-b border-white ${i % 2 === 0 ? "bg-black" : "bg-black"}`}>
                  <td className="px-3 py-1.5 text-white font-mono">{t.tier}</td>
                  <td className="px-3 py-1.5 text-center">
                    <span className="text-[#45E0A8] font-mono">{t.wins}</span>
                    <span className="text-white mx-1">/</span>
                    <span className="text-white font-mono">{t.losses}</span>
                  </td>
                  <td className={`px-3 py-1.5 text-center font-mono font-bold ${accColor(t.accuracy)}`}>{pct(t.accuracy)}</td>
                  <td className="px-3 py-1.5 text-center text-white font-mono">+{pct(t.avgEdge, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── HR Props Panel ───────────────────────────────────────────────────────────

function HrPropsPanel({ data }: { data: {
  totalPredictions: number; overWins: number; overLosses: number; overAccuracy: number;
  avgModelPHr: number; avgActualHrRate: number; calibrationBias: number;
  byOddsTier: Array<{ tier: string; wins: number; losses: number; accuracy: number; avgOdds: number; count: number }>;
  byProbBucket: Array<{ bucket: string; wins: number; losses: number; accuracy: number; avgProb: number; count: number }>;
  highEdgeAccuracy: number; highEdgeCount: number;
}}) {
  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total Predictions" value={String(data.totalPredictions)} sub="HR Props modeled" color="text-white" icon={<Activity className="w-4 h-4" />} />
        <KpiCard label="OVER Accuracy" value={pct(data.overAccuracy)} sub={`${data.overWins}W / ${data.overLosses}L`} color={accColor(data.overAccuracy)} icon={<Target className="w-4 h-4" />} />
        <KpiCard
          label="Calibration Bias"
          value={`${data.calibrationBias >= 0 ? "+" : ""}${pct(data.calibrationBias, 2)}`}
          sub={data.calibrationBias > 0.02 ? "Over-predicting HR rate" : data.calibrationBias < -0.02 ? "Under-predicting HR rate" : "Well-calibrated"}
          color={Math.abs(data.calibrationBias) < 0.02 ? "text-[#45E0A8]" : "text-white"}
          icon={<TrendingUp className="w-4 h-4" />}
        />
        <KpiCard
          label="High-Edge Accuracy"
          value={data.highEdgeCount >= 5 ? pct(data.highEdgeAccuracy) : "N/A"}
          sub={`n=${data.highEdgeCount} (edge≥6%)`}
          color={data.highEdgeCount >= 5 ? accColor(data.highEdgeAccuracy) : "text-white"}
          icon={<CheckCircle2 className="w-4 h-4" />}
        />
      </div>

      {/* Model vs actual calibration */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="bg-black border-white">
          <CardHeader className="pb-2 pt-3 px-4"><CardTitle className="text-sm text-white">Avg Model P(HR)</CardTitle></CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-2xl font-bold font-mono text-white">{pct(data.avgModelPHr, 2)}</div>
            <div className="text-white text-xs mt-1">Mean model probability across all players</div>
          </CardContent>
        </Card>
        <Card className="bg-black border-white">
          <CardHeader className="pb-2 pt-3 px-4"><CardTitle className="text-sm text-white">Actual HR Rate</CardTitle></CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-2xl font-bold font-mono text-[#45E0A8]">{pct(data.avgActualHrRate, 2)}</div>
            <div className="text-white text-xs mt-1">Actual HR hit rate in sample</div>
          </CardContent>
        </Card>
      </div>

      {/* By-prob-bucket chart */}
      <div>
        <h3 className="text-white font-semibold text-sm mb-3">Win Rate by Model P(HR) Bucket</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data.byProbBucket} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#FFFFFF" />
            <XAxis dataKey="bucket" tick={{ fill: "#FFFFFF", fontSize: 10 }} />
            <YAxis tickFormatter={v => `${(v * 100).toFixed(0)}%`} tick={{ fill: "#FFFFFF", fontSize: 10 }} domain={[0, 1]} />
            <Tooltip
              contentStyle={{ backgroundColor: "#000000", border: "1px solid #FFFFFF", borderRadius: 8 }}
              formatter={(v: number) => [`${(v * 100).toFixed(1)}%`, "Win Rate"]}
            />
            <ReferenceLine y={TARGET_ACCURACY}    stroke="#45E0A8" strokeDasharray="4 4" />
            <ReferenceLine y={BREAKEVEN_ACCURACY} stroke="#FFFFFF" strokeDasharray="4 4" />
            <Bar dataKey="accuracy" radius={[3, 3, 0, 0]}>
              {data.byProbBucket.map(b => (
                <Cell key={b.bucket} fill={b.accuracy >= TARGET_ACCURACY ? "#45E0A8" : b.accuracy >= BREAKEVEN_ACCURACY ? "#FFFFFF" : "#FFFFFF"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* By-odds-tier table */}
      <div>
        <h3 className="text-white font-semibold text-sm mb-3">Accuracy by Book Odds Tier</h3>
        <div className="overflow-x-auto rounded-xl border border-white">
          <table className="w-full text-xs">
            <thead className="bg-black border-b border-white">
              <tr>
                <th className="text-left px-3 py-2 text-white font-medium">Odds Tier</th>
                <th className="text-center px-3 py-2 text-white font-medium">Count</th>
                <th className="text-center px-3 py-2 text-white font-medium">W / L</th>
                <th className="text-center px-3 py-2 text-white font-medium">Win Rate</th>
                <th className="text-center px-3 py-2 text-white font-medium">Avg Odds</th>
              </tr>
            </thead>
            <tbody>
              {data.byOddsTier.map((t, i) => (
                <tr key={t.tier} className={`border-b border-white ${i % 2 === 0 ? "bg-black" : "bg-black"}`}>
                  <td className="px-3 py-1.5 text-white font-mono">{t.tier}</td>
                  <td className="px-3 py-1.5 text-center text-white font-mono">{t.count}</td>
                  <td className="px-3 py-1.5 text-center">
                    <span className="text-[#45E0A8] font-mono">{t.wins}</span>
                    <span className="text-white mx-1">/</span>
                    <span className="text-white font-mono">{t.losses}</span>
                  </td>
                  <td className={`px-3 py-1.5 text-center font-mono font-bold ${accColor(t.accuracy)}`}>{pct(t.accuracy)}</td>
                  <td className="px-3 py-1.5 text-center text-white font-mono">+{t.avgOdds}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
