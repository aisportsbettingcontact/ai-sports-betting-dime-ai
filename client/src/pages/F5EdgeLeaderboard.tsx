/**
 * F5EdgeLeaderboard.tsx
 *
 * Owner-only admin page showing the F5 ML Edge Leaderboard.
 * Displays all historical games sorted by absolute model edge (model win% − no-vig book implied%).
 *
 * Filters: minEdge (pp), side (away/home/both), withOutcome (only games with results)
 * Columns: Date | Matchup | Side | Model Win% | Book Implied% | Edge | ML | F5 Score | Result | Brier
 */

import { useState, useMemo } from "react";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Label,
} from "recharts";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { ArrowLeft, TrendingUp, TrendingDown, Minus, RefreshCw, Filter } from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function edgeColor(edge: number): string {
  if (edge >= 5) return "#45E0A8";
  if (edge >= 3) return "#45E0A8";
  if (edge >= 1) return "#45E0A8";
  if (edge <= -5) return "#FFFFFF";
  if (edge <= -3) return "#FFFFFF";
  if (edge <= -1) return "#FFFFFF";
  return "#FFFFFF";
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

function resultBadge(result: string | null, correct: number | null) {
  if (!result) return <span style={{ color: "#FFFFFF", fontSize: 10 }}>PENDING</span>;
  if (result === "push") return <span style={{ color: "#FFFFFF", fontSize: 10, fontWeight: 700 }}>PUSH</span>;
  if (correct === 1) return <span style={{ color: "#45E0A8", fontSize: 10, fontWeight: 700 }}>WIN</span>;
  if (correct === 0) return <span style={{ color: "#FFFFFF", fontSize: 10, fontWeight: 700 }}>LOSS</span>;
  return <span style={{ color: "#FFFFFF", fontSize: 10 }}>{result}</span>;
}

function brierColor(b: string | null): string {
  if (!b) return "#FFFFFF";
  const v = parseFloat(b);
  if (isNaN(v)) return "#FFFFFF";
  if (v <= 0.15) return "#45E0A8";
  if (v <= 0.22) return "#FFFFFF";
  return "#FFFFFF";
}

function formatTeam(slug: string): string {
  return slug.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function F5EdgeLeaderboard() {
  const [, setLocation] = useLocation();
  const { isOwner } = useAppAuth();

  const [minEdge, setMinEdge] = useState(0);
  const [side, setSide] = useState<"away" | "home" | "both">("both");
  const [withOutcome, setWithOutcome] = useState(false);
  const [limit, setLimit] = useState(200);
  const [sortBy, setSortBy] = useState<"edge" | "date" | "brier">("edge");
  const [pageTab, setPageTab] = useState<"table" | "scatter">("table");

  const { data, isLoading, refetch, isFetching } = trpc.mlbSchedule.getF5EdgeLeaderboard.useQuery(
    { minEdge, side, withOutcome, limit },
    { enabled: isOwner }
  );

  if (!isOwner) {
    return (
      <div style={{ minHeight: "100vh", background: "#000000", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "#FFFFFF", fontSize: 14 }}>Owner access required.</p>
      </div>
    );
  }

  const rows = data?.rows ?? [];
  const summary = data?.summary;

  // ── Scatter plot data: only games with outcomes ──────────────────────────────
  const scatterData = useMemo(() => {
    const allRows = data?.rows ?? [];
    return allRows
      .filter(r => r.f5MlCorrect != null)
      .map(r => ({
        x: parseFloat(r.edgePct.toFixed(2)),
        y: r.f5MlCorrect as number,
        label: `${r.awayTeam}@${r.homeTeam} (${r.gameDate})`,
        result: r.f5MlResult,
        side: r.side,
      }));
  }, [data]);

  // Linear regression for trend line
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

  // Client-side sort
  const sorted = [...rows].sort((a, b) => {
    if (sortBy === "edge") return Math.abs(b.edgePct) - Math.abs(a.edgePct);
    if (sortBy === "date") return (b.gameDate ?? "").localeCompare(a.gameDate ?? "");
    if (sortBy === "brier") {
      const bA = a.brierF5Ml != null ? parseFloat(a.brierF5Ml) : 999;
      const bB = b.brierF5Ml != null ? parseFloat(b.brierF5Ml) : 999;
      return bA - bB;
    }
    return 0;
  });

  return (
    <div style={{ minHeight: "100vh", background: "#000000", color: "#FFFFFF", fontFamily: "Familjen Grotesk, system-ui, sans-serif" }}>
      {/* ─── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ borderBottom: "1px solid #FFFFFF", padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, background: "#000000" }}>
        <button type="button" onClick={() => setLocation("/admin/model-results")}
          style={{ background: "none", border: "none", cursor: "pointer", color: "#FFFFFF", display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}
        >
          <ArrowLeft style={{ width: 14, height: 14 }} /> BACK
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#45E0A8", letterSpacing: 2 }}>
            F5 ML EDGE LEADERBOARD
          </h1>
          <p style={{ margin: "2px 0 0", fontSize: 10, color: "#FFFFFF" }}>
            Model Win% vs No-Vig Book Implied% — Historical 2026 Season
          </p>
        </div>
        <button type="button" onClick={() => refetch()}
          disabled={isFetching}
          style={{ background: "none", border: "1px solid #FFFFFF", borderRadius: 4, cursor: "pointer", color: "#FFFFFF", padding: "4px 8px", display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}
        >
          <RefreshCw style={{ width: 12, height: 12, animation: isFetching ? "spin 1s linear infinite" : "none" }} />
          REFRESH
        </button>
      </div>

      {/* ─── Tab Toggle ─────────────────────────────────────────────────────────── */}
      <div style={{ padding: "8px 16px", display: "flex", gap: 6, borderBottom: "1px solid #FFFFFF", background: "#000000" }}>
        {([["table", "📋 TABLE"], ["scatter", "📊 SCATTER"]] as const).map(([tab, label]) => (
          <button type="button" key={tab}
            onClick={() => setPageTab(tab)}
            style={{
              background: pageTab === tab ? "#45E0A8" : "#000000",
              border: "1px solid #FFFFFF",
              borderRadius: 4,
              cursor: "pointer",
              color: pageTab === tab ? "#000000" : "#FFFFFF",
              padding: "4px 12px",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 1,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ─── Summary Cards ───────────────────────────────────────────────────── */}
      {summary && (
        <div style={{ padding: "12px 16px", display: "flex", gap: 8, flexWrap: "wrap", borderBottom: "1px solid #FFFFFF" }}>
          {[
            { label: "TOTAL GAMES", value: summary.totalGames, color: "#FFFFFF" },
            { label: "EDGE ROWS", value: summary.edgeRows, color: "#FFFFFF" },
            { label: "POSITIVE EDGE", value: summary.positiveEdge, color: "#45E0A8" },
            { label: "NEGATIVE EDGE", value: summary.negativeEdge, color: "#FFFFFF" },
            { label: "AVG +EDGE", value: `+${summary.avgPositiveEdge.toFixed(2)}pp`, color: "#45E0A8" },
            { label: "AVG -EDGE", value: `${summary.avgNegativeEdge.toFixed(2)}pp`, color: "#FFFFFF" },
            { label: "WINS (POS EDGE)", value: summary.winsOnPositiveEdge, color: "#45E0A8" },
            { label: "LOSSES (POS EDGE)", value: summary.lossesOnPositiveEdge, color: "#FFFFFF" },
            { label: "WIN RATE (POS EDGE)", value: summary.winRateOnPositiveEdge != null ? `${summary.winRateOnPositiveEdge}%` : "PENDING", color: summary.winRateOnPositiveEdge != null && summary.winRateOnPositiveEdge >= 55 ? "#45E0A8" : "#FFFFFF" },
          ].map(card => (
            <div key={card.label} style={{ background: "#000000", border: "1px solid #FFFFFF", borderRadius: 6, padding: "8px 12px", minWidth: 100 }}>
              <div style={{ fontSize: 9, color: "#FFFFFF", letterSpacing: 1, marginBottom: 2 }}>{card.label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: card.color }}>{card.value}</div>
            </div>
          ))}
        </div>
      )}

      {pageTab === "table" && (<>
      {/* ─── Filters ─────────────────────────────────────────────────────────── */}
      <div style={{ padding: "10px 16px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", borderBottom: "1px solid #FFFFFF", background: "#000000" }}>
        <Filter style={{ width: 12, height: 12, color: "#FFFFFF" }} />

        {/* Min Edge */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, color: "#FFFFFF" }}>MIN EDGE</span>
          {[0, 1, 2, 3, 5].map(v => (
            <button type="button" key={v}
              onClick={() => setMinEdge(v)}
              style={{
                background: minEdge === v ? "#45E0A8" : "#000000",
                border: "1px solid #FFFFFF",
                borderRadius: 3,
                cursor: "pointer",
                color: minEdge === v ? "#000000" : "#FFFFFF",
                padding: "2px 7px",
                fontSize: 10,
                fontWeight: 700,
              }}
            >
              {v === 0 ? "ALL" : `≥${v}pp`}
            </button>
          ))}
        </div>

        {/* Side */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, color: "#FFFFFF" }}>SIDE</span>
          {(["both", "away", "home"] as const).map(s => (
            <button type="button" key={s}
              onClick={() => setSide(s)}
              style={{
                background: side === s ? "#45E0A8" : "#000000",
                border: "1px solid #FFFFFF",
                borderRadius: 3,
                cursor: "pointer",
                color: side === s ? "#000000" : "#FFFFFF",
                padding: "2px 7px",
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
              }}
            >
              {s}
            </button>
          ))}
        </div>

        {/* With Outcome */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, color: "#FFFFFF" }}>FILTER</span>
          <button type="button" onClick={() => setWithOutcome(!withOutcome)}
            style={{
              background: withOutcome ? "#45E0A8" : "#000000",
              border: "1px solid #FFFFFF",
              borderRadius: 3,
              cursor: "pointer",
              color: withOutcome ? "#000000" : "#FFFFFF",
              padding: "2px 7px",
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            WITH OUTCOME ONLY
          </button>
        </div>

        {/* Sort */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
          <span style={{ fontSize: 10, color: "#FFFFFF" }}>SORT</span>
          {(["edge", "date", "brier"] as const).map(s => (
            <button type="button" key={s}
              onClick={() => setSortBy(s)}
              style={{
                background: sortBy === s ? "#45E0A8" : "#000000",
                border: "1px solid #FFFFFF",
                borderRadius: 3,
                cursor: "pointer",
                color: sortBy === s ? "#000000" : "#FFFFFF",
                padding: "2px 7px",
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Table ───────────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div style={{ padding: 32, textAlign: "center", color: "#FFFFFF", fontSize: 12 }}>Loading edge data...</div>
      ) : sorted.length === 0 ? (
        <div style={{ padding: 32, textAlign: "center", color: "#FFFFFF", fontSize: 12 }}>No games match current filters.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #FFFFFF", background: "#000000" }}>
                {["DATE", "MATCHUP", "SIDE", "MODEL WIN%", "BOOK IMPLIED%", "EDGE", "F5 ML", "F5 SCORE", "RESULT", "BRIER"].map(h => (
                  <th key={h} style={{ padding: "6px 10px", textAlign: "left", color: "#FFFFFF", fontSize: 9, letterSpacing: 1, fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => {
                const isAway = row.side === "away";
                const ml = isAway ? row.f5AwayML : row.f5HomeML;
                const team = isAway ? row.awayTeam : row.homeTeam;
                const opponent = isAway ? row.homeTeam : row.awayTeam;
                const awayScore = row.actualF5AwayScore;
                const homeScore = row.actualF5HomeScore;
                const scoreStr = awayScore != null && homeScore != null
                  ? `${awayScore}–${homeScore}`
                  : "—";

                return (
                  <tr
                    key={`${row.id}-${row.side}`}
                    style={{
                      borderBottom: "1px solid #FFFFFF",
                      background: i % 2 === 0 ? edgeBg(row.edgePct) : "transparent",
                    }}
                  >
                    <td style={{ padding: "5px 10px", color: "#FFFFFF", whiteSpace: "nowrap" }}>{row.gameDate}</td>
                    <td style={{ padding: "5px 10px", whiteSpace: "nowrap" }}>
                      <span style={{ color: "#FFFFFF" }}>{formatTeam(row.awayTeam)}</span>
                      <span style={{ color: "#FFFFFF", margin: "0 4px" }}>@</span>
                      <span style={{ color: "#FFFFFF" }}>{formatTeam(row.homeTeam)}</span>
                    </td>
                    <td style={{ padding: "5px 10px" }}>
                      <span style={{
                        background: "transparent",
                        color: "#FFFFFF",
                        borderRadius: 3,
                        padding: "1px 5px",
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: 1,
                      }}>
                        {isAway ? "AWAY" : "HOME"}
                      </span>
                    </td>
                    <td style={{ padding: "5px 10px", color: "#FFFFFF", fontWeight: 700 }}>{row.modelWinPct.toFixed(1)}%</td>
                    <td style={{ padding: "5px 10px", color: "#FFFFFF" }}>{row.bookImpliedPct.toFixed(1)}%</td>
                    <td style={{ padding: "5px 10px", fontWeight: 700 }}>
                      <span style={{ color: edgeColor(row.edgePct) }}>
                        {row.edgePct > 0 ? "+" : ""}{row.edgePct.toFixed(2)}pp
                      </span>
                    </td>
                    <td style={{ padding: "5px 10px", color: "#FFFFFF" }}>{ml ?? "—"}</td>
                    <td style={{ padding: "5px 10px", color: "#FFFFFF" }}>{scoreStr}</td>
                    <td style={{ padding: "5px 10px" }}>
                      {resultBadge(row.f5MlResult, row.f5MlCorrect)}
                    </td>
                    <td style={{ padding: "5px 10px", color: brierColor(row.brierF5Ml), fontWeight: 700 }}>
                      {row.brierF5Ml != null ? parseFloat(row.brierF5Ml).toFixed(4) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      </>)}

      {/* ─── Scatter Plot ─────────────────────────────────────────────────────── */}
      {pageTab === "scatter" && (
        <div style={{ padding: "20px 16px" }}>
          {scatterData.length === 0 ? (
            <div style={{ textAlign: "center", color: "#FFFFFF", fontSize: 12, padding: 32 }}>
              No games with outcomes yet. Results will appear after games are ingested.
            </div>
          ) : (
            <>
              {/* Stats row */}
              <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                {[
                  { label: "GAMES W/ OUTCOME", value: scatterData.length, color: "#FFFFFF" },
                  { label: "WINS", value: scatterData.filter(d => d.y === 1).length, color: "#45E0A8" },
                  { label: "LOSSES", value: scatterData.filter(d => d.y === 0).length, color: "#FFFFFF" },
                  { label: "WIN RATE", value: `${(scatterData.filter(d => d.y === 1).length / scatterData.length * 100).toFixed(1)}%`, color: "#FFFFFF" },
                  { label: "REGRESSION SLOPE", value: regression ? `${regression.slope > 0 ? "+" : ""}${regression.slope.toFixed(4)}` : "—", color: regression && regression.slope > 0 ? "#45E0A8" : "#FFFFFF" },
                ].map(card => (
                  <div key={card.label} style={{ background: "#000000", border: "1px solid #FFFFFF", borderRadius: 6, padding: "8px 12px", minWidth: 120 }}>
                    <div style={{ fontSize: 9, color: "#FFFFFF", letterSpacing: 1, marginBottom: 2 }}>{card.label}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: card.color }}>{card.value}</div>
                  </div>
                ))}
              </div>

              {/* Scatter chart */}
              <div style={{ background: "#000000", border: "1px solid #FFFFFF", borderRadius: 8, padding: "16px 8px 8px" }}>
                <div style={{ fontSize: 10, color: "#FFFFFF", letterSpacing: 2, marginBottom: 12, paddingLeft: 8 }}>
                  F5 ML EDGE (pp) vs OUTCOME — Positive slope = model alpha confirmed
                </div>
                <ResponsiveContainer width="100%" height={360}>
                  <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#FFFFFF" />
                    <XAxis
                      type="number"
                      dataKey="x"
                      domain={["auto", "auto"]}
                      tick={{ fill: "#FFFFFF", fontSize: 9 }}
                      tickLine={false}
                    >
                      <Label value="Edge (pp)" position="insideBottom" offset={-10} fill="#FFFFFF" fontSize={9} />
                    </XAxis>
                    <YAxis
                      type="number"
                      dataKey="y"
                      domain={[-0.1, 1.1]}
                      ticks={[0, 1]}
                      tickFormatter={(v) => v === 1 ? "WIN" : v === 0 ? "LOSS" : ""}
                      tick={{ fill: "#FFFFFF", fontSize: 9 }}
                      tickLine={false}
                      width={40}
                    />
                    <Tooltip
                      cursor={{ strokeDasharray: "3 3", stroke: "#FFFFFF" }}
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
                      }}
                    />
                    {/* Zero reference line */}
                    <ReferenceLine x={0} stroke="#FFFFFF" strokeDasharray="4 4" />
                    <ReferenceLine y={0.5} stroke="#FFFFFF" strokeDasharray="2 2" />
                    {/* Wins */}
                    <Scatter
                      data={scatterData.filter(d => d.y === 1)}
                      fill="#45E0A8"
                      fillOpacity={0.7}
                      r={4}
                    />
                    {/* Losses */}
                    <Scatter
                      data={scatterData.filter(d => d.y === 0)}
                      fill="#FFFFFF"
                      fillOpacity={0.7}
                      r={4}
                    />
                    {/* Regression trend line */}
                    {regression && (
                      <ReferenceLine
                        segment={[
                          { x: regression.xMin, y: regression.slope * regression.xMin + regression.intercept },
                          { x: regression.xMax, y: regression.slope * regression.xMax + regression.intercept },
                        ]}
                        stroke={regression.slope > 0 ? "#45E0A8" : "#FFFFFF"}
                        strokeWidth={2}
                        strokeDasharray="6 3"
                        label={{ value: `slope: ${regression.slope > 0 ? "+" : ""}${regression.slope.toFixed(4)}`, position: "insideTopRight", fill: regression.slope > 0 ? "#45E0A8" : "#FFFFFF", fontSize: 9 }}
                      />
                    )}
                  </ScatterChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 8 }}>
                  <span style={{ fontSize: 9, color: "#45E0A8" }}>● WIN</span>
                  <span style={{ fontSize: 9, color: "#FFFFFF" }}>● LOSS</span>
                  <span style={{ fontSize: 9, color: "#FFFFFF" }}>--- REGRESSION TREND</span>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── Footer ──────────────────────────────────────────────────────────── */}
      <div style={{ padding: "12px 16px", borderTop: "1px solid #FFFFFF", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "#FFFFFF" }}>
          Showing {sorted.length} rows · Edge = Model Win% − No-Vig Book Implied%
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          {[100, 200, 500].map(v => (
            <button type="button" key={v}
              onClick={() => setLimit(v)}
              style={{
                background: limit === v ? "#45E0A8" : "#000000",
                border: "1px solid #FFFFFF",
                borderRadius: 3,
                cursor: "pointer",
                color: limit === v ? "#000000" : "#FFFFFF",
                padding: "2px 7px",
                fontSize: 10,
              }}
            >
              TOP {v}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
