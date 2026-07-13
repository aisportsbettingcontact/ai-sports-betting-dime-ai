/**
 * MlbF5NrfiCard
 *
 * Displays First Five Innings (F5) and NRFI/YRFI market projections for a single MLB game.
 *
 * Data sources:
 *   F5 ML / RL / Total odds → FanDuel NJ (Action Network book_id=69)
 *   NRFI / YRFI odds        → FanDuel NJ (Action Network book_id=69)
 *   Model projections       → MLBAIModel.py (400K Monte Carlo simulations)
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  TEAM GRADIENT BAR (away ← → home)                     │
 *   │  MATCHUP HEADER: away @ home + start time              │
 *   ├─────────────────────────────────────────────────────────┤
 *   │  F5 SECTION                                             │
 *   │    ML:  away odds | model pct | home odds               │
 *   │    RL:  away line+odds | model pct | home line+odds     │
 *   │    TOT: over odds | model total | under odds            │
 *   ├─────────────────────────────────────────────────────────┤
 *   │  NRFI / YRFI SECTION                                    │
 *   │    NRFI: FD odds | model pct | edge% | EV               │
 *   │    YRFI: FD odds | model pct | edge% | EV               │
 *   └─────────────────────────────────────────────────────────┘
 */
import { useMemo } from "react";
import { MLB_BY_ABBREV } from "@shared/mlbTeams";
import { teamLogoGradient } from "@/lib/teamLogoCircle";

// ─── Types ─────────────────────────────────────────────────────────────────────
export interface F5NrfiGame {
  id: number;
  awayTeam: string;
  homeTeam: string;
  startTimeEst: string | null;
  sport: string;
  // F5 book odds (FanDuel NJ)
  f5AwayML: string | null;
  f5HomeML: string | null;
  f5AwayRunLine: string | null;
  f5HomeRunLine: string | null;
  f5AwayRunLineOdds: string | null;
  f5HomeRunLineOdds: string | null;
  f5Total: string | null;
  f5OverOdds: string | null;
  f5UnderOdds: string | null;
  // F5 model projections
  modelF5AwayScore: string | null;
  modelF5HomeScore: string | null;
  modelF5Total: string | null;
  modelF5OverRate: string | null;
  modelF5UnderRate: string | null;
  modelF5AwayWinPct: string | null;
  modelF5HomeWinPct: string | null;
  modelF5AwayRLCoverPct: string | null;
  modelF5HomeRLCoverPct: string | null;
  modelF5OverOdds: string | null;
  modelF5UnderOdds: string | null;
  modelF5PushPct: string | null;     // THREE-WAY: Bayesian-blended P(F5 push/tie) 0-1
  modelF5PushRaw: string | null;     // raw simulation push rate (diagnostic)
  // NRFI/YRFI book odds (FanDuel NJ)
  nrfiOverOdds: string | null;
  yrfiUnderOdds: string | null;
  // NRFI/YRFI model
  modelPNrfi: string | null;
  modelNrfiOdds: string | null;
  modelYrfiOdds: string | null;
}

interface MlbF5NrfiCardProps {
  game: F5NrfiGame;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function fmtOdds(val: string | null | undefined): string {
  if (!val) return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return val;
  return n > 0 ? `+${Math.round(n)}` : `${Math.round(n)}`;
}

function fmtPct(val: string | null | undefined): string {
  if (!val) return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return "—";
  return `${n.toFixed(1)}%`;
}

function fmtScore(val: string | null | undefined): string {
  if (!val) return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return "—";
  return n.toFixed(2);
}

function fmtLine(val: string | null | undefined): string {
  if (!val) return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return val;
  return n > 0 ? `+${n}` : `${n}`;
}

function fmtTotal(val: string | null | undefined): string {
  if (!val) return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return "—";
  return n.toFixed(1);
}

function formatTime(t: string | null | undefined): string {
  if (!t) return "TBD";
  const [h, m] = t.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return t;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/**
 * Convert American odds to implied probability (no-vig not applied — raw book implied).
 */
function americanToImplied(odds: number): number {
  return odds < 0 ? (-odds) / (-odds + 100) : 100 / (odds + 100);
}

/**
 * Compute edge and EV between model probability and book implied probability.
 * modelPct: percentage string (e.g. "62.5" for 62.5%)
 * bookOdds: American odds string (e.g. "-110" or "+130")
 * Returns: { edge (decimal), ev (per $100), isEdge (|edge| >= 3%) }
 */
function computeEdgeEV(
  modelPct: string | null | undefined,
  bookOdds: string | null | undefined
): { edge: number; ev: number; isEdge: boolean } | null {
  if (!modelPct || !bookOdds) return null;
  const modelProb = parseFloat(modelPct) / 100;
  const odds = parseFloat(bookOdds);
  if (isNaN(modelProb) || isNaN(odds)) return null;

  const implied = americanToImplied(odds);
  const edge = modelProb - implied;

  // EV per $100 bet: edge × (payout per unit)
  // Payout per unit = odds > 0 ? odds/100 : 100/(-odds)
  const payoutPerUnit = odds > 0 ? odds / 100 : 100 / (-odds);
  const ev = edge * payoutPerUnit * 100;

  return { edge, ev, isEdge: Math.abs(edge) >= 0.03 };
}

/** Format edge as "+3.2%" or "-1.8%" */
function fmtEdge(edge: number): string {
  const pct = (edge * 100).toFixed(1);
  return edge >= 0 ? `+${pct}%` : `${pct}%`;
}

/** Format EV as "+$4.20" or "-$2.10" */
function fmtEV(ev: number): string {
  const abs = Math.abs(ev).toFixed(1);
  return ev >= 0 ? `+$${abs}` : `-$${abs}`;
}

/** Edge color: neon green if positive edge, red if negative, muted if neutral */
function edgeColor(edge: number | null | undefined, isEdge: boolean): string {
  if (edge == null) return "#FFFFFF";
  if (isEdge && edge >= 0.03) return "#45E0A8";
  if (isEdge && edge <= -0.03) return "#FFFFFF";
  return "#FFFFFF";
}

// ─── Sub-components ────────────────────────────────────────────────────────────

interface MarketRowProps {
  label: string;
  awayVal: string;
  awayOdds?: string;
  modelVal: string;
  modelLabel?: string;
  homeVal: string;
  homeOdds?: string;
  awayEdgeEV?: { edge: number; ev: number; isEdge: boolean } | null;
  homeEdgeEV?: { edge: number; ev: number; isEdge: boolean } | null;
}

function MarketRow({ label, awayVal, awayOdds, modelVal, modelLabel, homeVal, homeOdds, awayEdgeEV, homeEdgeEV }: MarketRowProps) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "48px 1fr 80px 1fr",
      alignItems: "center",
      padding: "5px 10px",
      borderBottom: "1px solid #FFFFFF",
      gap: 4,
    }}>
      {/* Label */}
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "#FFFFFF", textTransform: "uppercase" }}>
        {label}
      </span>
      {/* Away */}
      <div style={{ textAlign: "center" }}>
        <span style={{
          fontSize: 13, fontWeight: 700,
          color: awayEdgeEV?.isEdge ? edgeColor(awayEdgeEV.edge, awayEdgeEV.isEdge) : "#FFFFFF",
          fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif"
        }}>
          {awayVal}
        </span>
        {awayOdds && (
          <span style={{ display: "block", fontSize: 10, color: "#FFFFFF", marginTop: 1 }}>
            {awayOdds}
          </span>
        )}
        {awayEdgeEV && awayEdgeEV.isEdge && (
          <span style={{ display: "block", fontSize: 9, color: edgeColor(awayEdgeEV.edge, awayEdgeEV.isEdge), marginTop: 1, fontWeight: 700 }}>
            {fmtEdge(awayEdgeEV.edge)} · {fmtEV(awayEdgeEV.ev)}
          </span>
        )}
      </div>
      {/* Model center */}
      <div style={{ textAlign: "center", background: "transparent", borderRadius: 4, padding: "3px 4px" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#45E0A8", fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif" }}>
          {modelVal}
        </span>
        {modelLabel && (
          <span style={{ display: "block", fontSize: 9, color: "#FFFFFF", marginTop: 1 }}>
            {modelLabel}
          </span>
        )}
      </div>
      {/* Home */}
      <div style={{ textAlign: "center" }}>
        <span style={{
          fontSize: 13, fontWeight: 700,
          color: homeEdgeEV?.isEdge ? edgeColor(homeEdgeEV.edge, homeEdgeEV.isEdge) : "#FFFFFF",
          fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif"
        }}>
          {homeVal}
        </span>
        {homeOdds && (
          <span style={{ display: "block", fontSize: 10, color: "#FFFFFF", marginTop: 1 }}>
            {homeOdds}
          </span>
        )}
        {homeEdgeEV && homeEdgeEV.isEdge && (
          <span style={{ display: "block", fontSize: 9, color: edgeColor(homeEdgeEV.edge, homeEdgeEV.isEdge), marginTop: 1, fontWeight: 700 }}>
            {fmtEdge(homeEdgeEV.edge)} · {fmtEV(homeEdgeEV.ev)}
          </span>
        )}
      </div>
    </div>
  );
}

interface NrfiRowProps {
  label: string;
  bookOdds: string | null | undefined;
  modelPct: string | null | undefined;
  modelOdds: string | null | undefined;
  isNrfi: boolean;
}

function NrfiRow({ label, bookOdds, modelPct, modelOdds, isNrfi }: NrfiRowProps) {
  const modelPctNum = modelPct ? parseFloat(modelPct) : null;

  // For NRFI: use modelPNrfi directly
  // For YRFI: use 100 - modelPNrfi (complement)
  const effectivePct = modelPctNum != null
    ? isNrfi ? String(modelPctNum) : String(100 - modelPctNum)
    : null;

  const edgeEV = computeEdgeEV(effectivePct, bookOdds);
  const hasEdge = edgeEV?.isEdge ?? false;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "60px 1fr 1fr 1fr",
      alignItems: "center",
      padding: "6px 10px",
      borderBottom: "1px solid #FFFFFF",
      gap: 4,
    }}>
      {/* Label */}
      <span style={{
        fontSize: 11, fontWeight: 800, letterSpacing: "0.06em",
        color: isNrfi ? "#45E0A8" : "#FFFFFF",
        textTransform: "uppercase",
        fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
      }}>
        {label}
      </span>
      {/* FD Book odds */}
      <div style={{ textAlign: "center" }}>
        <span style={{ fontSize: 9, color: "#FFFFFF", display: "block", marginBottom: 1 }}>FD ODDS</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#FFFFFF", fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif" }}>
          {fmtOdds(bookOdds)}
        </span>
      </div>
      {/* Model probability */}
      <div style={{ textAlign: "center" }}>
        <span style={{ fontSize: 9, color: "#FFFFFF", display: "block", marginBottom: 1 }}>MODEL %</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#45E0A8", fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif" }}>
          {effectivePct != null ? `${parseFloat(effectivePct).toFixed(1)}%` : "—"}
        </span>
        {/* Model fair-value odds */}
        <span style={{ display: "block", fontSize: 10, color: "#FFFFFF", marginTop: 1 }}>
          {fmtOdds(modelOdds)}
        </span>
      </div>
      {/* Edge + EV */}
      <div style={{ textAlign: "center" }}>
        <span style={{ fontSize: 9, color: "#FFFFFF", display: "block", marginBottom: 1 }}>EDGE · EV</span>
        {edgeEV ? (
          <>
            <span style={{
              fontSize: 12, fontWeight: 800,
              color: hasEdge ? edgeColor(edgeEV.edge, edgeEV.isEdge) : "#FFFFFF",
              fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
            }}>
              {fmtEdge(edgeEV.edge)}
            </span>
            <span style={{
              display: "block", fontSize: 10, fontWeight: 700,
              color: hasEdge ? edgeColor(edgeEV.edge, edgeEV.isEdge) : "#FFFFFF",
              marginTop: 1,
            }}>
              {fmtEV(edgeEV.ev)}
            </span>
          </>
        ) : (
          <span style={{ fontSize: 11, color: "#FFFFFF" }}>—</span>
        )}
      </div>
    </div>
  );
}

// ─── F5 Total row with edge/EV ─────────────────────────────────────────────────

interface F5TotalRowProps {
  f5Total: string | null;
  f5OverOdds: string | null;
  f5UnderOdds: string | null;
  modelF5AwayScore: string | null;
  modelF5HomeScore: string | null;
  modelF5Total: string | null;
  modelF5OverRate: string | null;
  modelF5UnderRate: string | null;
}

function F5TotalRow({ f5Total, f5OverOdds, f5UnderOdds, modelF5AwayScore, modelF5HomeScore, modelF5Total, modelF5OverRate, modelF5UnderRate }: F5TotalRowProps) {
  const overEdgeEV = useMemo(() => computeEdgeEV(modelF5OverRate, f5OverOdds), [modelF5OverRate, f5OverOdds]);
  const underEdgeEV = useMemo(() => computeEdgeEV(modelF5UnderRate, f5UnderOdds), [modelF5UnderRate, f5UnderOdds]);

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "48px 1fr 80px 1fr",
      alignItems: "center",
      padding: "5px 10px",
      borderBottom: "1px solid #FFFFFF",
      gap: 4,
    }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "#FFFFFF", textTransform: "uppercase" }}>
        TOT
      </span>
      {/* Over */}
      <div style={{ textAlign: "center" }}>
        <span style={{ fontSize: 10, color: "#FFFFFF", display: "block", marginBottom: 1 }}>O {fmtTotal(f5Total)}</span>
        <span style={{
          fontSize: 13, fontWeight: 700,
          color: overEdgeEV?.isEdge ? edgeColor(overEdgeEV.edge, overEdgeEV.isEdge) : "#FFFFFF",
          fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif"
        }}>
          {fmtOdds(f5OverOdds)}
        </span>
        {overEdgeEV && overEdgeEV.isEdge && (
          <span style={{ display: "block", fontSize: 9, color: edgeColor(overEdgeEV.edge, overEdgeEV.isEdge), marginTop: 1, fontWeight: 700 }}>
            {fmtEdge(overEdgeEV.edge)} · {fmtEV(overEdgeEV.ev)}
          </span>
        )}
      </div>
      {/* Model total */}
      <div style={{ textAlign: "center", background: "transparent", borderRadius: 4, padding: "3px 4px" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#45E0A8", fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif" }}>
          {fmtScore(modelF5AwayScore)} – {fmtScore(modelF5HomeScore)}
        </span>
        <span style={{ display: "block", fontSize: 9, color: "#FFFFFF", marginTop: 1 }}>
          TOT {fmtTotal(modelF5Total)}
        </span>
      </div>
      {/* Under */}
      <div style={{ textAlign: "center" }}>
        <span style={{ fontSize: 10, color: "#FFFFFF", display: "block", marginBottom: 1 }}>U {fmtTotal(f5Total)}</span>
        <span style={{
          fontSize: 13, fontWeight: 700,
          color: underEdgeEV?.isEdge ? edgeColor(underEdgeEV.edge, underEdgeEV.isEdge) : "#FFFFFF",
          fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif"
        }}>
          {fmtOdds(f5UnderOdds)}
        </span>
        {underEdgeEV && underEdgeEV.isEdge && (
          <span style={{ display: "block", fontSize: 9, color: edgeColor(underEdgeEV.edge, underEdgeEV.isEdge), marginTop: 1, fontWeight: 700 }}>
            {fmtEdge(underEdgeEV.edge)} · {fmtEV(underEdgeEV.ev)}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function MlbF5NrfiCard({ game }: MlbF5NrfiCardProps) {
  const awayInfo = MLB_BY_ABBREV.get(game.awayTeam);
  const homeInfo = MLB_BY_ABBREV.get(game.homeTeam);
  const awayName = awayInfo?.city ?? game.awayTeam;
  const homeName = homeInfo?.city ?? game.homeTeam;
  const awayColor = awayInfo?.primaryColor ?? "#666";
  const homeColor = homeInfo?.primaryColor ?? "#888";
  const awayLogo = awayInfo ? teamLogoGradient(game.awayTeam) : null;
  const homeLogo = homeInfo ? teamLogoGradient(game.homeTeam) : null;

  // F5 ML edge computation
  const awayF5MlEdgeEV = useMemo(() => computeEdgeEV(game.modelF5AwayWinPct, game.f5AwayML), [game.modelF5AwayWinPct, game.f5AwayML]);
  const homeF5MlEdgeEV = useMemo(() => computeEdgeEV(game.modelF5HomeWinPct, game.f5HomeML), [game.modelF5HomeWinPct, game.f5HomeML]);

  // F5 RL edge computation
  const awayF5RlEdgeEV = useMemo(() => computeEdgeEV(game.modelF5AwayRLCoverPct, game.f5AwayRunLineOdds), [game.modelF5AwayRLCoverPct, game.f5AwayRunLineOdds]);
  const homeF5RlEdgeEV = useMemo(() => computeEdgeEV(game.modelF5HomeRLCoverPct, game.f5HomeRunLineOdds), [game.modelF5HomeRLCoverPct, game.f5HomeRunLineOdds]);

  const hasF5Data = game.f5AwayML || game.f5Total || game.modelF5AwayScore;
  const hasNrfiData = game.nrfiOverOdds || game.modelPNrfi;

  return (
    <div style={{
      background: "#000000",
      border: "1px solid #FFFFFF",
      borderRadius: 10,
      marginBottom: 10,
      overflow: "hidden",
      fontFamily: "'Familjen Grotesk', 'Familjen Grotesk', system-ui, -apple-system, sans-serif",
    }}>
      {/* Team gradient bar */}
      <div style={{
        height: 4,
        background: "#45E0A8",  /* Three-Color Law: solid mint rail (no gradients) */
      }} />

      {/* Matchup header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 12px 6px",
        borderBottom: "1px solid #FFFFFF",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {awayLogo && <img src={awayLogo} alt={game.awayTeam} style={{ width: 22, height: 22, objectFit: "contain" }} />}
          <span style={{ fontSize: 14, fontWeight: 800, color: "#FFFFFF", letterSpacing: "0.04em" }}>
            {awayName}
          </span>
          <span style={{ fontSize: 11, color: "#FFFFFF", margin: "0 2px" }}>@</span>
          {homeLogo && <img src={homeLogo} alt={game.homeTeam} style={{ width: 22, height: 22, objectFit: "contain" }} />}
          <span style={{ fontSize: 14, fontWeight: 800, color: "#FFFFFF", letterSpacing: "0.04em" }}>
            {homeName}
          </span>
        </div>
        <span style={{ fontSize: 11, color: "#FFFFFF", fontWeight: 600 }}>
          {formatTime(game.startTimeEst)}
        </span>
      </div>

      {/* Column headers */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "48px 1fr 80px 1fr",
        padding: "4px 10px",
        borderBottom: "1px solid #FFFFFF",
        gap: 4,
      }}>
        <span style={{ fontSize: 9, color: "#FFFFFF", textTransform: "uppercase" }}></span>
        <span style={{ fontSize: 9, color: "#FFFFFF", textTransform: "uppercase", textAlign: "center" }}>
          {game.awayTeam}
        </span>
        <span style={{ fontSize: 9, color: "#FFFFFF", textTransform: "uppercase", textAlign: "center" }}>
          MODEL
        </span>
        <span style={{ fontSize: 9, color: "#FFFFFF", textTransform: "uppercase", textAlign: "center" }}>
          {game.homeTeam}
        </span>
      </div>

      {/* F5 Section */}
      {hasF5Data ? (
        <>
          <div style={{ padding: "4px 10px 2px", borderBottom: "1px solid #FFFFFF" }}>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", color: "#45E0A8", textTransform: "uppercase" }}>
              F5 · FANDUEL NJ
            </span>
          </div>

          {/* F5 ML */}
          <MarketRow
            label="ML"
            awayVal={fmtOdds(game.f5AwayML)}
            modelVal={fmtPct(game.modelF5AwayWinPct)}
            modelLabel="AWAY WIN"
            homeVal={fmtOdds(game.f5HomeML)}
            awayEdgeEV={awayF5MlEdgeEV}
            homeEdgeEV={homeF5MlEdgeEV}
          />

          {/* F5 Push (three-way pricing — v2.1) */}
          {game.modelF5PushPct != null && (
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "4px 10px",
              borderBottom: "1px solid #FFFFFF",
              background: "transparent",
            }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#FFFFFF", letterSpacing: "0.08em", minWidth: 32 }}>PUSH</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 10, color: "#FFFFFF", letterSpacing: "0.04em" }}>P(TIE)</span>
                <span style={{
                  fontSize: 12,
                  fontWeight: 800,
                  color: "#FFFFFF",
                  fontVariantNumeric: "tabular-nums",
                }}>
                  {(parseFloat(game.modelF5PushPct) * 100).toFixed(1)}%
                </span>
                {game.modelF5PushRaw != null && (
                  <span style={{ fontSize: 9, color: "#FFFFFF", marginLeft: 2 }}>
                    (sim: {(parseFloat(game.modelF5PushRaw) * 100).toFixed(1)}%)
                  </span>
                )}
              </div>
              <span style={{ fontSize: 9, color: "#FFFFFF", letterSpacing: "0.06em" }}>3-WAY</span>
            </div>
          )}

          {/* F5 RL */}
          <MarketRow
            label="RL"
            awayVal={fmtLine(game.f5AwayRunLine)}
            awayOdds={fmtOdds(game.f5AwayRunLineOdds)}
            modelVal={fmtPct(game.modelF5AwayRLCoverPct)}
            modelLabel="AWAY CVR"
            homeVal={fmtLine(game.f5HomeRunLine)}
            homeOdds={fmtOdds(game.f5HomeRunLineOdds)}
            awayEdgeEV={awayF5RlEdgeEV}
            homeEdgeEV={homeF5RlEdgeEV}
          />

          {/* F5 Total */}
          <F5TotalRow
            f5Total={game.f5Total}
            f5OverOdds={game.f5OverOdds}
            f5UnderOdds={game.f5UnderOdds}
            modelF5AwayScore={game.modelF5AwayScore}
            modelF5HomeScore={game.modelF5HomeScore}
            modelF5Total={game.modelF5Total}
            modelF5OverRate={game.modelF5OverRate}
            modelF5UnderRate={game.modelF5UnderRate}
          />
        </>
      ) : (
        <div style={{ padding: "12px 10px", textAlign: "center" }}>
          <span style={{ fontSize: 11, color: "#FFFFFF" }}>F5 odds not yet available</span>
        </div>
      )}

      {/* NRFI / YRFI Section */}
      {hasNrfiData ? (
        <>
          <div style={{ padding: "4px 10px 2px", borderBottom: "1px solid #FFFFFF" }}>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", color: "#FFFFFF", textTransform: "uppercase" }}>
              NRFI / YRFI · FANDUEL NJ
            </span>
          </div>

          {/* NRFI row */}
          <NrfiRow
            label="NRFI"
            bookOdds={game.nrfiOverOdds}
            modelPct={game.modelPNrfi}
            modelOdds={game.modelNrfiOdds}
            isNrfi={true}
          />

          {/* YRFI row */}
          <NrfiRow
            label="YRFI"
            bookOdds={game.yrfiUnderOdds}
            modelPct={game.modelPNrfi}
            modelOdds={game.modelYrfiOdds}
            isNrfi={false}
          />
        </>
      ) : (
        <div style={{ padding: "12px 10px", textAlign: "center" }}>
          <span style={{ fontSize: 11, color: "#FFFFFF" }}>NRFI/YRFI odds not yet available</span>
        </div>
      )}

      {/* Source footer */}
      <div style={{ padding: "4px 10px", borderTop: "1px solid #FFFFFF" }}>
        <span style={{ fontSize: 9, color: "#FFFFFF", letterSpacing: "0.04em" }}>
          F5 + NRFI/YRFI odds: FanDuel NJ · Model: 400K Monte Carlo · Edge threshold: ±3%
        </span>
      </div>
    </div>
  );
}
