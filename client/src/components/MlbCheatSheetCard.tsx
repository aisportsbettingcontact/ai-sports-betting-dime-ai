/**
 * MlbCheatSheetCard — CHEAT SHEETS tab
 *
 * Layout per game:
 *
 *  ┌─────────────────────────────────────────────────────────────┐
 *  │  MATCHUP HEADER: away logo + name @ home logo + name + time │
 *  ├─────────────────────────────────────────────────────────────┤
 *  │  F5 · ACTION NETWORK                                        │
 *  │    [I1][I2][I3][I4][I5]  ← square score boxes per inning   │
 *  │    ML:  AN away | model % + model odds | AN home            │
 *  │    RL:  AN away ±0.5 | model % + model odds | AN home       │
 *  │    TOT: AN O line | model scores + model odds | AN U line   │
 *  ├─────────────────────────────────────────────────────────────┤
 *  │  NRFI / YRFI · ACTION NETWORK                               │
 *  │    [I1 box: away EXP + P(≥1)] [P(NRFI)] [I1 box: home]     │
 *  │    NRFI: AN odds | model NRFI% + model odds | edge/EV       │
 *  │    YRFI: AN odds | model YRFI% + model odds | edge/EV       │
 *  └─────────────────────────────────────────────────────────────┘
 *
 * Data sources:
 *   F5 book odds / NRFI book odds → Action Network (FanDuel NJ)
 *   Model projections             → MLBAIModel.py 400K Monte Carlo + 3yr Bayesian priors
 *   Inning distributions          → MLBAIModel.py inning_home_exp / inning_away_exp (I1–I9)
 *
 * CRITICAL BUG FIX (2026-04-14):
 *   modelPNrfi is stored as raw decimal (0.48 = 48%) in DB.
 *   Must multiply by 100 before display: modelPNrfi * 100 → 48.0%
 *   Previous code passed 0.48 directly → displayed as "0.5%" (WRONG)
 */

import { useMemo } from "react";
import { MLB_BY_ABBREV } from "@shared/mlbTeams";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface CheatSheetGame {
  id: number;
  awayTeam: string;
  homeTeam: string;
  startTimeEst: string | null;
  sport: string;
  // F5 book odds (Action Network / FanDuel NJ)
  f5AwayML: string | null;
  f5HomeML: string | null;
  f5AwayRunLine: string | null;
  f5HomeRunLine: string | null;
  f5AwayRunLineOdds: string | null;
  f5HomeRunLineOdds: string | null;
  f5Total: string | null;
  f5OverOdds: string | null;
  f5UnderOdds: string | null;
  // F5 model projections (from MLBAIModel.py)
  modelF5AwayScore: string | null;
  modelF5HomeScore: string | null;
  modelF5Total: string | null;
  modelF5OverRate: string | null;
  modelF5UnderRate: string | null;
  modelF5AwayWinPct: string | null;
  modelF5HomeWinPct: string | null;
  modelF5AwayRLCoverPct: string | null;
  modelF5HomeRLCoverPct: string | null;
  modelF5AwayML: string | null;
  modelF5HomeML: string | null;
  modelF5AwayRlOdds: string | null;
  modelF5HomeRlOdds: string | null;
  modelF5OverOdds: string | null;
  modelF5UnderOdds: string | null;
  modelF5PushPct: string | null;     // THREE-WAY: Bayesian-blended P(F5 push/tie) 0-1
  modelF5PushRaw: string | null;     // raw simulation push rate (diagnostic)
  // NRFI/YRFI book odds (Action Network / FanDuel NJ)
  nrfiOverOdds: string | null;
  yrfiUnderOdds: string | null;
  // NRFI/YRFI model (from MLBAIModel.py) — stored as raw decimal 0–1
  modelPNrfi: string | null;
  modelNrfiOdds: string | null;
  modelYrfiOdds: string | null;
  // Inning distributions (JSON arrays from MLBAIModel.py, I1..I9)
  modelInningHomeExp: string | null;
  modelInningAwayExp: string | null;
  modelInningPNeitherScores: string | null;
  modelInningPHomeScores: string | null;
  modelInningPAwayScores: string | null;
  // NRFI filter signals
  nrfiCombinedSignal: number | null;
  nrfiFilterPass: number | null;
  // Full-game (FG) book odds — for FG Total and FG ML edge display
  total: string | null;           // book O/U total line (e.g. "8.5")
  overOdds: string | null;        // book over odds (e.g. "-110")
  underOdds: string | null;       // book under odds (e.g. "-110")
  awayML: string | null;          // book full-game away ML
  homeML: string | null;          // book full-game home ML
  // Full-game model projections
  modelTotal: string | null;      // model projected total
  modelOverRate: string | null;   // model over% (0-100 scale)
  modelUnderRate: string | null;  // model under% (0-100 scale)
  modelAwayWinPct: string | null; // model away win% (0-100 scale)
  modelHomeWinPct: string | null; // model home win% (0-100 scale)
  modelOverOdds: string | null;   // model over odds
  modelUnderOdds: string | null;  // model under odds
  modelAwayML: string | null;     // model full-game away ML
  modelHomeML: string | null;     // model full-game home ML
  // Full-game model projection (raw engine output, distinct from modelTotal which is book-anchored)
  modelProjTotal: string | null;  // raw model projection before line selection (e.g. '8.73')
  modelWeatherAdj: string | null; // weather run-factor applied by engine (1.0=neutral, >1.0=run-boosting)
}

interface MlbCheatSheetCardProps {
  game: CheatSheetGame;
}

// ─── Parse helpers ─────────────────────────────────────────────────────────────

function parseJsonArr(val: string | null | undefined): number[] | null {
  if (!val) return null;
  try {
    const arr = JSON.parse(val);
    if (Array.isArray(arr) && arr.length >= 5) return arr.map(Number);
    return null;
  } catch { return null; }
}

function parseNum(val: string | number | null | undefined): number | null {
  if (val == null) return null;
  const n = typeof val === 'number' ? val : parseFloat(String(val));
  return isNaN(n) ? null : n;
}

// ─── Display helpers ───────────────────────────────────────────────────────────

function fmtOdds(val: string | number | null | undefined): string {
  if (val == null || val === '') return "—";
  const n = typeof val === 'number' ? val : parseFloat(String(val));
  if (isNaN(n)) return String(val);
  return n > 0 ? `+${Math.round(n)}` : `${Math.round(n)}`;
}

/** val is already on 0–100 scale */
function fmtPct(val: number | null | undefined, decimals = 1): string {
  if (val == null) return "—";
  return `${val.toFixed(decimals)}%`;
}

function fmtLine(val: string | null | undefined): string {
  if (!val) return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return val;
  return n > 0 ? `+${n}` : `${n}`;
}

function formatTime(t: string | null | undefined): string {
  if (!t) return "";
  const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return t;
  let h = parseInt(m[1]!, 10);
  const min = m[2]!;
  const suffix = m[3] ?? (h >= 12 ? 'PM' : 'AM');
  if (!m[3]) {
    if (h === 0) h = 12;
    else if (h > 12) h -= 12;
  }
  return `${h}:${min} ${suffix.toUpperCase()} ET`;
}

// ─── Edge/EV computation ───────────────────────────────────────────────────────
// modelPct is on 0–100 scale (e.g., 48.0 for 48%)

function americanToDecimal(odds: number): number {
  return odds > 0 ? 1 + odds / 100 : 1 - 100 / odds;
}

function computeEdgeEV(
  modelPct: number | null,   // 0–100 scale
  bookOddsStr: string | null | undefined
): { edge: number; ev: number; isEdge: boolean } | null {
  if (modelPct == null || !bookOddsStr) return null;
  const bookOdds = parseFloat(bookOddsStr);
  if (isNaN(bookOdds)) return null;
  const impliedProb = bookOdds > 0 ? 100 / (bookOdds + 100) : -bookOdds / (-bookOdds + 100);
  const modelProb = modelPct / 100;  // convert back to 0–1 for math
  const edge = modelProb - impliedProb;
  const decimalOdds = americanToDecimal(bookOdds);
  const ev = modelProb * (decimalOdds - 1) - (1 - modelProb);
  return { edge, ev, isEdge: Math.abs(edge) >= 0.03 };
}

function edgeColor(edge: number): string {
  return edge >= 0.03 ? "#45E0A8" : "#FFFFFF";
}

function fmtEdge(edge: number): string {
  return `${edge >= 0 ? '+' : ''}${(edge * 100).toFixed(1)}%`;
}

function fmtEV(ev: number): string {
  const dollars = ev * 100;
  return `${dollars >= 0 ? '+' : ''}$${Math.abs(dollars).toFixed(1)}`;
}

// ─── Square Inning Box Grid (F5: I1–I5) ────────────────────────────────────────

interface InningBoxGridProps {
  awayAbbrev: string;
  homeAbbrev: string;
  awayExp: number[];
  homeExp: number[];
  count: 5 | 9;
  awayColor: string;
  homeColor: string;
}

function InningBoxGrid({
  awayAbbrev, homeAbbrev,
  awayExp, homeExp,
  count,
  awayColor, homeColor,
}: InningBoxGridProps) {
  const innings = Array.from({ length: count }, (_, i) => i);

  return (
    <div style={{ padding: "8px 10px 6px", borderBottom: "1px solid #FFFFFF" }}>
      {/* Team legend */}
      <div style={{ display: "flex", gap: 14, marginBottom: 6, alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: awayColor }} />
          <span style={{ fontSize: 9, color: "#FFFFFF", fontWeight: 700, letterSpacing: "0.07em" }}>
            {awayAbbrev}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: homeColor }} />
          <span style={{ fontSize: 9, color: "#FFFFFF", fontWeight: 700, letterSpacing: "0.07em" }}>
            {homeAbbrev}
          </span>
        </div>
        <span style={{ fontSize: 9, color: "#FFFFFF", marginLeft: "auto", letterSpacing: "0.05em" }}>
          EXP RUNS / INNING
        </span>
      </div>

      {/* Square boxes */}
      <div style={{ display: "flex", gap: 4 }}>
        {innings.map((i) => {
          const aVal = awayExp[i] ?? 0;
          const hVal = homeExp[i] ?? 0;
          return (
            <div key={i} style={{
              flex: 1,
              background: "#000000",
              border: "1px solid #FFFFFF",
              borderRadius: 5,
              padding: "5px 2px 4px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
              minWidth: 0,
            }}>
              {/* Inning label */}
              <span style={{
                fontSize: 8, fontWeight: 800, letterSpacing: "0.08em",
                color: "#FFFFFF", textTransform: "uppercase",
              }}>
                I{i + 1}
              </span>
              {/* Away expected runs */}
              <span style={{
                fontSize: 12, fontWeight: 800,
                color: awayColor,
                fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
                lineHeight: 1,
              }}>
                {aVal.toFixed(2)}
              </span>
              {/* Divider */}
              <div style={{ width: "60%", height: 1, background: "#FFFFFF" }} />
              {/* Home expected runs */}
              <span style={{
                fontSize: 12, fontWeight: 800,
                color: homeColor,
                fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
                lineHeight: 1,
              }}>
                {hVal.toFixed(2)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Market Row (3-column: AWAY | MODEL | HOME) ────────────────────────────────

interface MarketRowProps {
  label: string;
  awayTop: string;
  awayBot?: string;
  modelTop: string;
  modelBot?: string;
  homeTop: string;
  homeBot?: string;
  awayEdge?: { edge: number; ev: number; isEdge: boolean } | null;
  homeEdge?: { edge: number; ev: number; isEdge: boolean } | null;
}

function MarketRow({
  label, awayTop, awayBot, modelTop, modelBot, homeTop, homeBot,
  awayEdge, homeEdge,
}: MarketRowProps) {
  const awayHasEdge = awayEdge?.isEdge ?? false;
  const homeHasEdge = homeEdge?.isEdge ?? false;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "36px 1fr 96px 1fr",
      alignItems: "center",
      padding: "7px 10px",
      borderBottom: "1px solid #FFFFFF",
      gap: 4,
    }}>
      {/* Label */}
      <span style={{
        fontSize: 10, fontWeight: 800, letterSpacing: "0.06em",
        color: "#FFFFFF", textTransform: "uppercase",
      }}>
        {label}
      </span>

      {/* Away */}
      <div style={{ textAlign: "center" }}>
        <span style={{
          fontSize: 14, fontWeight: 700,
          color: awayHasEdge ? edgeColor(awayEdge!.edge) : "#FFFFFF",
          fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
          display: "block",
        }}>
          {awayTop}
        </span>
        {awayBot && (
          <span style={{ fontSize: 10, color: awayHasEdge ? edgeColor(awayEdge!.edge) : "#FFFFFF", display: "block", marginTop: 1 }}>
            {awayBot}
          </span>
        )}
        {awayHasEdge && awayEdge && (
          <span style={{ fontSize: 9, color: edgeColor(awayEdge.edge), display: "block", marginTop: 1 }}>
            {fmtEdge(awayEdge.edge)} · {fmtEV(awayEdge.ev)}
          </span>
        )}
      </div>

      {/* Model center */}
      <div style={{
        textAlign: "center",
        background: "#000000",
        borderRadius: 5,
        padding: "5px 4px",
        border: "1px solid #FFFFFF",
      }}>
        <span style={{
          fontSize: 13, fontWeight: 800,
          color: "#45E0A8",
          fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
          display: "block",
          lineHeight: 1.1,
        }}>
          {modelTop}
        </span>
        {modelBot && (
          <span style={{ fontSize: 10, color: "#FFFFFF", display: "block", marginTop: 2 }}>
            {modelBot}
          </span>
        )}
      </div>

      {/* Home */}
      <div style={{ textAlign: "center" }}>
        <span style={{
          fontSize: 14, fontWeight: 700,
          color: homeHasEdge ? edgeColor(homeEdge!.edge) : "#FFFFFF",
          fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
          display: "block",
        }}>
          {homeTop}
        </span>
        {homeBot && (
          <span style={{ fontSize: 10, color: homeHasEdge ? edgeColor(homeEdge!.edge) : "#FFFFFF", display: "block", marginTop: 1 }}>
            {homeBot}
          </span>
        )}
        {homeHasEdge && homeEdge && (
          <span style={{ fontSize: 9, color: edgeColor(homeEdge.edge), display: "block", marginTop: 1 }}>
            {fmtEdge(homeEdge.edge)} · {fmtEV(homeEdge.ev)}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Total Row ─────────────────────────────────────────────────────────────────

interface TotalRowProps {
  bookLine: string | null;
  bookOverOdds: string | null;
  bookUnderOdds: string | null;
  modelExpAway: number | null;
  modelExpHome: number | null;
  modelExpTotal: number | null;
  modelProjTotal?: number | null;   // raw engine projection (distinct from modelExpTotal which is book-anchored)
  modelWeatherAdj?: number | null;  // weather run-factor (1.0 = neutral)
  modelOverOdds: string | null;
  modelUnderOdds: string | null;
  modelOverRate: number | null;   // 0–100 scale
  modelUnderRate: number | null;  // 0–100 scale
}

function TotalRow({
  bookLine, bookOverOdds, bookUnderOdds,
  modelExpAway, modelExpHome, modelExpTotal,
  modelProjTotal, modelWeatherAdj,
  modelOverOdds, modelUnderOdds,
  modelOverRate, modelUnderRate,
}: TotalRowProps) {
  const overEdge = computeEdgeEV(modelOverRate, bookOverOdds);
  const underEdge = computeEdgeEV(modelUnderRate, bookUnderOdds);
  const overHasEdge = overEdge?.isEdge ?? false;
  const underHasEdge = underEdge?.isEdge ?? false;

  const modelScoreStr = (modelExpAway != null && modelExpHome != null)
    ? `${modelExpAway.toFixed(2)} – ${modelExpHome.toFixed(2)}`
    : "—";
  const modelTotStr = modelExpTotal != null ? `TOT ${modelExpTotal.toFixed(1)}` : "—";
  const projTotStr = modelProjTotal != null ? `PROJ ${modelProjTotal.toFixed(2)}` : null;
  const weatherDelta = modelWeatherAdj != null ? modelWeatherAdj - 1.0 : null;
  const showWeather = weatherDelta != null && Math.abs(weatherDelta) >= 0.005;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "36px 1fr 96px 1fr",
      alignItems: "center",
      padding: "7px 10px",
      borderBottom: "1px solid #FFFFFF",
      gap: 4,
    }}>
      {/* Label */}
      <span style={{
        fontSize: 10, fontWeight: 800, letterSpacing: "0.06em",
        color: "#FFFFFF", textTransform: "uppercase",
      }}>
        TOT
      </span>

      {/* Over (away side) */}
      <div style={{ textAlign: "center" }}>
        <span style={{ fontSize: 10, color: "#FFFFFF", display: "block", marginBottom: 1 }}>
          O {bookLine ?? "—"}
        </span>
        <span style={{
          fontSize: 14, fontWeight: 700,
          color: overHasEdge ? edgeColor(overEdge!.edge) : "#FFFFFF",
          fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
          display: "block",
        }}>
          {fmtOdds(bookOverOdds)}
        </span>
        {overHasEdge && overEdge && (
          <span style={{ fontSize: 9, color: edgeColor(overEdge.edge), display: "block", marginTop: 1 }}>
            {fmtEdge(overEdge.edge)} · {fmtEV(overEdge.ev)}
          </span>
        )}
      </div>

      {/* Model center */}
      <div style={{
        textAlign: "center",
        background: "#000000",
        borderRadius: 5,
        padding: "5px 4px",
        border: "1px solid #FFFFFF",
      }}>
        <span style={{
          fontSize: 10, fontWeight: 700,
          color: "#45E0A8",
          fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
          display: "block",
          lineHeight: 1.2,
        }}>
          {modelScoreStr}
        </span>
        <span style={{
          fontSize: 12, fontWeight: 800,
          color: "#45E0A8",
          fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
          display: "block",
          lineHeight: 1.2,
        }}>
          {modelTotStr}
        </span>
        {projTotStr && (
          <span style={{
            fontSize: 9, fontWeight: 700,
            color: "#45E0A8",
            fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
            display: "block",
            lineHeight: 1.2,
            marginTop: 1,
          }}>
            {projTotStr}
          </span>
        )}
        {showWeather && weatherDelta != null && (
          <span style={{
            fontSize: 8,
            color: weatherDelta > 0 ? "#FFFFFF" : "#FFFFFF",
            display: "block",
            marginTop: 1,
            letterSpacing: "0.04em",
          }}>
            {weatherDelta > 0 ? "▲" : "▼"} WX {(Math.abs(weatherDelta) * 100).toFixed(1)}%
          </span>
        )}
        {(modelOverOdds || modelUnderOdds) && (
          <span style={{ fontSize: 9, color: "#FFFFFF", display: "block", marginTop: 2 }}>
            O {fmtOdds(modelOverOdds)} / U {fmtOdds(modelUnderOdds)}
          </span>
        )}
      </div>

      {/* Under (home side) */}
      <div style={{ textAlign: "center" }}>
        <span style={{ fontSize: 10, color: "#FFFFFF", display: "block", marginBottom: 1 }}>
          U {bookLine ?? "—"}
        </span>
        <span style={{
          fontSize: 14, fontWeight: 700,
          color: underHasEdge ? edgeColor(underEdge!.edge) : "#FFFFFF",
          fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
          display: "block",
        }}>
          {fmtOdds(bookUnderOdds)}
        </span>
        {underHasEdge && underEdge && (
          <span style={{ fontSize: 9, color: edgeColor(underEdge.edge), display: "block", marginTop: 1 }}>
            {fmtEdge(underEdge.edge)} · {fmtEV(underEdge.ev)}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── I1 Distribution Boxes (NRFI section) ─────────────────────────────────────

interface I1BoxRowProps {
  awayAbbrev: string;
  homeAbbrev: string;
  awayI1Exp: number | null;
  homeI1Exp: number | null;
  awayI1PScores: number | null;   // raw 0–1 probability
  homeI1PScores: number | null;   // raw 0–1 probability
  pNeitherI1: number | null;      // raw 0–1 probability
  awayColor: string;
  homeColor: string;
}

function I1BoxRow({
  awayAbbrev, homeAbbrev,
  awayI1Exp, homeI1Exp,
  awayI1PScores, homeI1PScores,
  pNeitherI1,
  awayColor, homeColor,
}: I1BoxRowProps) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 80px 1fr",
      gap: 6,
      padding: "8px 10px",
      borderBottom: "1px solid #FFFFFF",
      alignItems: "stretch",
    }}>
      {/* Away I1 box */}
      <div style={{
        background: "#000000",
        border: "1px solid #FFFFFF",
        borderRadius: 5,
        padding: "6px 6px",
        textAlign: "center",
      }}>
        <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.08em", color: awayColor, display: "block", marginBottom: 4 }}>
          {awayAbbrev} · I1
        </span>
        <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
          <div>
            <span style={{ fontSize: 8, color: "#FFFFFF", display: "block" }}>EXP</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: awayColor, fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif" }}>
              {awayI1Exp != null ? awayI1Exp.toFixed(3) : "—"}
            </span>
          </div>
          <div>
            <span style={{ fontSize: 8, color: "#FFFFFF", display: "block" }}>P(≥1)</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: awayColor, fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif" }}>
              {awayI1PScores != null ? fmtPct(awayI1PScores * 100) : "—"}
            </span>
          </div>
        </div>
      </div>

      {/* Center: P(NRFI) */}
      <div style={{
        background: "transparent",
        border: "1px solid #45E0A8",
        borderRadius: 5,
        padding: "6px 4px",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
      }}>
        <span style={{ fontSize: 8, color: "#FFFFFF", display: "block", marginBottom: 2 }}>P(NRFI)</span>
        <span style={{ fontSize: 16, fontWeight: 900, color: "#45E0A8", fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif" }}>
          {pNeitherI1 != null ? fmtPct(pNeitherI1 * 100) : "—"}
        </span>
      </div>

      {/* Home I1 box */}
      <div style={{
        background: "#000000",
        border: "1px solid #FFFFFF",
        borderRadius: 5,
        padding: "6px 6px",
        textAlign: "center",
      }}>
        <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.08em", color: homeColor, display: "block", marginBottom: 4 }}>
          {homeAbbrev} · I1
        </span>
        <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
          <div>
            <span style={{ fontSize: 8, color: "#FFFFFF", display: "block" }}>EXP</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: homeColor, fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif" }}>
              {homeI1Exp != null ? homeI1Exp.toFixed(3) : "—"}
            </span>
          </div>
          <div>
            <span style={{ fontSize: 8, color: "#FFFFFF", display: "block" }}>P(≥1)</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: homeColor, fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif" }}>
              {homeI1PScores != null ? fmtPct(homeI1PScores * 100) : "—"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── NRFI / YRFI Row ───────────────────────────────────────────────────────────

interface NrfiYrfiRowProps {
  label: "NRFI" | "YRFI";
  bookOdds: string | null;
  modelPct: number | null;   // 0–100 scale (e.g., 48.0 for 48%)
  modelOdds: string | null;
}

function NrfiYrfiRow({ label, bookOdds, modelPct, modelOdds }: NrfiYrfiRowProps) {
  // computeEdgeEV expects 0–100 scale — correct
  const edgeEV = computeEdgeEV(modelPct, bookOdds);
  const hasEdge = edgeEV?.isEdge ?? false;
  const isNrfi = label === "NRFI";

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "36px 1fr 1fr 1fr",
      alignItems: "center",
      padding: "8px 10px",
      borderBottom: "1px solid #FFFFFF",
      gap: 4,
    }}>
      {/* Label */}
      <span style={{
        fontSize: 10, fontWeight: 900, letterSpacing: "0.06em",
        color: isNrfi ? "#45E0A8" : "#FFFFFF",
        textTransform: "uppercase",
      }}>
        {label}
      </span>

      {/* AN Odds */}
      <div style={{ textAlign: "center" }}>
        <span style={{ fontSize: 9, color: "#FFFFFF", display: "block", marginBottom: 2 }}>AN ODDS</span>
        <span style={{
          fontSize: 14, fontWeight: 700,
          color: "#FFFFFF",
          fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
        }}>
          {fmtOdds(bookOdds)}
        </span>
      </div>

      {/* Model % + Model Odds */}
      <div style={{
        textAlign: "center",
        background: "#000000",
        borderRadius: 5,
        padding: "5px 4px",
        border: "1px solid #FFFFFF",
      }}>
        <span style={{ fontSize: 9, color: "#FFFFFF", display: "block", marginBottom: 1 }}>MODEL %</span>
        <span style={{
          fontSize: 15, fontWeight: 900,
          color: isNrfi ? "#45E0A8" : "#FFFFFF",
          fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
          display: "block",
          lineHeight: 1.1,
        }}>
          {/* modelPct is on 0–100 scale — display directly */}
          {modelPct != null ? fmtPct(modelPct) : "—"}
        </span>
        {modelOdds && (
          <span style={{ fontSize: 10, color: "#FFFFFF", display: "block", marginTop: 2 }}>
            {fmtOdds(modelOdds)}
          </span>
        )}
      </div>

      {/* Edge / EV */}
      <div style={{ textAlign: "center" }}>
        <span style={{ fontSize: 9, color: "#FFFFFF", display: "block", marginBottom: 2 }}>EDGE · EV</span>
        {edgeEV ? (
          <>
            <span style={{
              fontSize: 13, fontWeight: 700,
              color: hasEdge ? edgeColor(edgeEV.edge) : "#FFFFFF",
              fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
              display: "block",
            }}>
              {fmtEdge(edgeEV.edge)}
            </span>
            <span style={{
              fontSize: 10,
              color: hasEdge ? edgeColor(edgeEV.edge) : "#FFFFFF",
              display: "block", marginTop: 1,
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

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function MlbCheatSheetCard({ game }: MlbCheatSheetCardProps) {
  const awayInfo = MLB_BY_ABBREV.get(game.awayTeam);
  const homeInfo = MLB_BY_ABBREV.get(game.homeTeam);
  const awayName = awayInfo?.city ?? game.awayTeam;
  const homeName = homeInfo?.city ?? game.homeTeam;
  const awayLogo = awayInfo?.logoUrl ?? null;
  const homeLogo = homeInfo?.logoUrl ?? null;
  const awayColor = awayInfo?.primaryColor ?? '#4A90D9';
  const homeColor = homeInfo?.primaryColor ?? '#E8A838';

  // Parse inning distributions
  const awayInnExp = useMemo(() => parseJsonArr(game.modelInningAwayExp), [game.modelInningAwayExp]);
  const homeInnExp = useMemo(() => parseJsonArr(game.modelInningHomeExp), [game.modelInningHomeExp]);
  const pNeitherArr = useMemo(() => parseJsonArr(game.modelInningPNeitherScores), [game.modelInningPNeitherScores]);
  const pHomeScoresArr = useMemo(() => parseJsonArr(game.modelInningPHomeScores), [game.modelInningPHomeScores]);
  const pAwayScoresArr = useMemo(() => parseJsonArr(game.modelInningPAwayScores), [game.modelInningPAwayScores]);

  // Parse model values — F5 win/RL pcts are stored as 0–100 scale already
  const modelF5AwayScore = parseNum(game.modelF5AwayScore);
  const modelF5HomeScore = parseNum(game.modelF5HomeScore);
  const modelF5Total = parseNum(game.modelF5Total);
  const modelF5OverRate = parseNum(game.modelF5OverRate);     // 0–100 scale
  const modelF5UnderRate = parseNum(game.modelF5UnderRate);   // 0–100 scale
  const modelF5AwayWinPct = parseNum(game.modelF5AwayWinPct); // 0–100 scale
  const modelF5HomeWinPct = parseNum(game.modelF5HomeWinPct); // 0–100 scale
  const modelF5AwayRLCoverPct = parseNum(game.modelF5AwayRLCoverPct); // 0–100 scale
  const modelF5HomeRLCoverPct = parseNum(game.modelF5HomeRLCoverPct); // 0–100 scale
  // F5 push: stored as raw decimal 0-1 (e.g. 0.1507 = 15.07%)
  const modelF5PushPct = parseNum(game.modelF5PushPct);  // raw 0-1
  const modelF5PushRaw = parseNum(game.modelF5PushRaw);  // raw 0-1 (diagnostic)

  // CRITICAL: modelPNrfi is stored as raw decimal (0.48 = 48%) — multiply by 100
  const modelPNrfiRaw = parseNum(game.modelPNrfi);
  const modelPNrfi = modelPNrfiRaw != null ? modelPNrfiRaw * 100 : null;  // now 0–100 scale
  const modelPYrfi = modelPNrfi != null ? 100 - modelPNrfi : null;

  // I1 values from inning arrays
  const awayI1Exp = awayInnExp ? awayInnExp[0] ?? null : null;
  const homeI1Exp = homeInnExp ? homeInnExp[0] ?? null : null;
  const pNeitherI1 = pNeitherArr ? pNeitherArr[0] ?? null : null;
  const awayI1PScores = pAwayScoresArr ? pAwayScoresArr[0] ?? null : null;
  const homeI1PScores = pHomeScoresArr ? pHomeScoresArr[0] ?? null : null;

  // Edge/EV for F5 ML and RL
  const awayF5MlEdge = computeEdgeEV(modelF5AwayWinPct, game.f5AwayML);
  const homeF5MlEdge = computeEdgeEV(modelF5HomeWinPct, game.f5HomeML);
  const awayF5RlEdge = computeEdgeEV(modelF5AwayRLCoverPct, game.f5AwayRunLineOdds);
  const homeF5RlEdge = computeEdgeEV(modelF5HomeRLCoverPct, game.f5HomeRunLineOdds);

  // Data availability gates
  const hasF5Data = !!(game.f5AwayML || game.f5Total || game.f5OverOdds);
  const hasNrfiData = !!(game.nrfiOverOdds || game.yrfiUnderOdds || game.modelPNrfi);
  const hasInnDist = !!(awayInnExp && homeInnExp && awayInnExp.length >= 5 && homeInnExp.length >= 5);

  // NRFI filter signal badge
  const nrfiPass = game.nrfiFilterPass === 1;
  const nrfiSignal = game.nrfiCombinedSignal;

  // Quiet 1px keyline (chrome — carries no signal, so no mint)
  const keylineStyle = {
    background: "var(--dime-border)",
    height: 1,
    width: "100%",
  };

  return (
    <div style={{
      background: "#000000",
      border: "1px solid #FFFFFF",
      borderRadius: 10,
      marginBottom: 10,
      overflow: "hidden",
      fontFamily: "'Familjen Grotesk', 'Familjen Grotesk', system-ui, -apple-system, sans-serif",
    }}>
      {/* Keyline (chrome) */}
      <div style={keylineStyle} />

      {/* ── HEADER ── */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "8px 10px 7px",
        borderBottom: "1px solid #FFFFFF",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {awayLogo && <img src={awayLogo} alt={game.awayTeam} style={{ width: 24, height: 24, objectFit: "contain" }} />}
          <span style={{ fontSize: 15, fontWeight: 800, color: "#FFFFFF", letterSpacing: "0.03em" }}>
            {awayName}
          </span>
          <span style={{ fontSize: 12, color: "#FFFFFF", margin: "0 2px" }}>@</span>
          {homeLogo && <img src={homeLogo} alt={game.homeTeam} style={{ width: 24, height: 24, objectFit: "contain" }} />}
          <span style={{ fontSize: 15, fontWeight: 800, color: "#FFFFFF", letterSpacing: "0.03em" }}>
            {homeName}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {nrfiPass && (
            <span style={{
              fontSize: 8, fontWeight: 900, letterSpacing: "0.08em",
              background: "transparent", color: "#45E0A8",
              border: "1px solid #45E0A8",
              borderRadius: 3, padding: "2px 5px",
            }}>
              NRFI {nrfiSignal != null ? `${(nrfiSignal * 100).toFixed(1)}%` : "✓"}
            </span>
          )}
          <span style={{ fontSize: 11, color: "#FFFFFF", fontWeight: 600 }}>
            {formatTime(game.startTimeEst)}
          </span>
        </div>
      </div>

      {/* ── F5 SECTION HEADER ── */}
      <div style={{
        padding: "5px 10px 4px",
        borderBottom: "1px solid #FFFFFF",
        background: "transparent",
      }}>
        <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.14em", color: "#45E0A8", textTransform: "uppercase" }}>
          F5 · ACTION NETWORK
        </span>
      </div>

      {/* F5 Inning Distribution: square boxes I1–I5 */}
      {hasInnDist ? (
        <InningBoxGrid
          awayAbbrev={game.awayTeam}
          homeAbbrev={game.homeTeam}
          awayExp={awayInnExp!.slice(0, 5)}
          homeExp={homeInnExp!.slice(0, 5)}
          count={5}
          awayColor={awayColor}
          homeColor={homeColor}
        />
      ) : (
        <div style={{ padding: "8px 10px", borderBottom: "1px solid #FFFFFF" }}>
          <span style={{ fontSize: 10, color: "#FFFFFF", fontStyle: "italic" }}>
            Inning distribution pending model run
          </span>
        </div>
      )}

      {/* F5 ML / RL / Total */}
      {hasF5Data ? (
        <>
          {/* Column headers */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "36px 1fr 96px 1fr",
            padding: "3px 10px 2px",
            gap: 4,
          }}>
            <span />
            <span style={{ fontSize: 9, color: "#FFFFFF", textAlign: "center", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {game.awayTeam}
            </span>
            <span style={{ fontSize: 9, color: "#FFFFFF", textAlign: "center", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              MODEL
            </span>
            <span style={{ fontSize: 9, color: "#FFFFFF", textAlign: "center", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {game.homeTeam}
            </span>
          </div>

          <MarketRow
            label="ML"
            awayTop={fmtOdds(game.f5AwayML)}
            modelTop={modelF5AwayWinPct != null ? fmtPct(modelF5AwayWinPct) : "—"}
            modelBot={game.modelF5AwayML ? fmtOdds(game.modelF5AwayML) : undefined}
            homeTop={fmtOdds(game.f5HomeML)}
            awayEdge={awayF5MlEdge}
            homeEdge={homeF5MlEdge}
          />

          {/* F5 Push — three-way pricing (v2.1) */}
          {modelF5PushPct != null && (
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "4px 10px",
              borderBottom: "1px solid #FFFFFF",
              background: "transparent",
            }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#FFFFFF", letterSpacing: "0.08em", minWidth: 36 }}>PUSH</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, justifyContent: "center" }}>
                <span style={{ fontSize: 10, color: "#FFFFFF", letterSpacing: "0.04em" }}>P(TIE)</span>
                <span style={{
                  fontSize: 13,
                  fontWeight: 800,
                  color: "#FFFFFF",
                  fontVariantNumeric: "tabular-nums",
                }}>
                  {(modelF5PushPct * 100).toFixed(1)}%
                </span>
                {modelF5PushRaw != null && (
                  <span style={{ fontSize: 9, color: "#FFFFFF", marginLeft: 2 }}>
                    (sim: {(modelF5PushRaw * 100).toFixed(1)}%)
                  </span>
                )}
              </div>
              <span style={{ fontSize: 9, color: "#FFFFFF", letterSpacing: "0.06em" }}>3-WAY</span>
            </div>
          )}

          <MarketRow
            label="RL"
            awayTop={fmtLine(game.f5AwayRunLine)}
            awayBot={fmtOdds(game.f5AwayRunLineOdds)}
            modelTop={modelF5AwayRLCoverPct != null ? fmtPct(modelF5AwayRLCoverPct) : "—"}
            modelBot={game.modelF5AwayRlOdds ? fmtOdds(game.modelF5AwayRlOdds) : undefined}
            homeTop={fmtLine(game.f5HomeRunLine)}
            homeBot={fmtOdds(game.f5HomeRunLineOdds)}
            awayEdge={awayF5RlEdge}
            homeEdge={homeF5RlEdge}
          />

          <TotalRow
            bookLine={game.f5Total}
            bookOverOdds={game.f5OverOdds}
            bookUnderOdds={game.f5UnderOdds}
            modelExpAway={modelF5AwayScore}
            modelExpHome={modelF5HomeScore}
            modelExpTotal={modelF5Total}
            modelProjTotal={game.modelProjTotal != null ? parseNum(game.modelProjTotal) : null}
            modelWeatherAdj={game.modelWeatherAdj != null ? parseNum(game.modelWeatherAdj) : null}
            modelOverOdds={game.modelF5OverOdds}
            modelUnderOdds={game.modelF5UnderOdds}
            modelOverRate={modelF5OverRate}
            modelUnderRate={modelF5UnderRate}
          />
        </>
      ) : (
        <div style={{ padding: "10px", textAlign: "center", borderBottom: "1px solid #FFFFFF" }}>
          <span style={{ fontSize: 11, color: "#FFFFFF" }}>F5 odds not yet posted</span>
        </div>
      )}

      {/* ── NRFI / YRFI SECTION HEADER ── */}
      <div style={{
        padding: "5px 10px 4px",
        borderBottom: "1px solid #FFFFFF",
        borderTop: "1px solid #FFFFFF",
        background: "transparent",
      }}>
        <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.14em", color: "#FFFFFF", textTransform: "uppercase" }}>
          NRFI / YRFI · ACTION NETWORK
        </span>
      </div>

      {/* I1 Distribution boxes */}
      {(awayI1Exp != null || homeI1Exp != null) && (
        <I1BoxRow
          awayAbbrev={game.awayTeam}
          homeAbbrev={game.homeTeam}
          awayI1Exp={awayI1Exp}
          homeI1Exp={homeI1Exp}
          awayI1PScores={awayI1PScores}
          homeI1PScores={homeI1PScores}
          pNeitherI1={pNeitherI1}
          awayColor={awayColor}
          homeColor={homeColor}
        />
      )}

      {/* NRFI/YRFI rows */}
      {hasNrfiData ? (
        <>
          {/* Column headers */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "36px 1fr 1fr 1fr",
            padding: "3px 10px 2px",
            gap: 4,
          }}>
            <span />
            <span style={{ fontSize: 9, color: "#FFFFFF", textAlign: "center", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              AN ODDS
            </span>
            <span style={{ fontSize: 9, color: "#FFFFFF", textAlign: "center", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              MODEL
            </span>
            <span style={{ fontSize: 9, color: "#FFFFFF", textAlign: "center", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              EDGE · EV
            </span>
          </div>

          <NrfiYrfiRow
            label="NRFI"
            bookOdds={game.nrfiOverOdds}
            modelPct={modelPNrfi}
            modelOdds={game.modelNrfiOdds}
          />
          <NrfiYrfiRow
            label="YRFI"
            bookOdds={game.yrfiUnderOdds}
            modelPct={modelPYrfi}
            modelOdds={game.modelYrfiOdds}
          />
        </>
      ) : (
        <div style={{ padding: "10px", textAlign: "center" }}>
          <span style={{ fontSize: 11, color: "#FFFFFF" }}>NRFI/YRFI odds not yet posted</span>
        </div>
      )}

      {/* Footer */}
      <div style={{ padding: "4px 10px", borderTop: "1px solid #FFFFFF" }}>
        <span style={{ fontSize: 9, color: "#FFFFFF", letterSpacing: "0.04em" }}>
          F5 + NRFI/YRFI: Action Network · Model: 400K Monte Carlo + 3yr Bayesian priors · Edge ≥±3%
        </span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CheatSheetView — v3.0 HTML SPEC MIRROR
// Two-view layout: NRFI/YRFI table + First 5 card view with internal tab switcher
// Renders all games for a single date group in one block.
// ═══════════════════════════════════════════════════════════════════════════════
import { useState } from "react";

// ─── Lineup type for pitcher data ─────────────────────────────────────────────
export interface CheatSheetLineup {
  awayPitcherName?: string | null;
  awayPitcherEra?: string | null;
  awayPitcherConfirmed?: boolean | null;
  homePitcherName?: string | null;
  homePitcherEra?: string | null;
  homePitcherConfirmed?: boolean | null;
}

// ─── Edge computation (v3) ────────────────────────────────────────────────────
function americanToImplied(odds: number): number {
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}
function americanToDecimalV3(odds: number): number {
  return odds > 0 ? 1 + odds / 100 : 1 - 100 / odds;
}
interface EdgeV3 {
  edge: number;
  ev: number;
  roiPct: number;
  barWidth: number;
  isPositive: boolean;
  hasEdge: boolean;
}
function computeEdgeV3(modelPct: number | null, bookOddsStr: string | null | undefined): EdgeV3 | null {
  if (modelPct == null || !bookOddsStr) return null;
  const bookOdds = parseFloat(bookOddsStr);
  if (isNaN(bookOdds)) return null;
  const impliedProb = americanToImplied(bookOdds);
  const modelProb = modelPct / 100;
  const edge = modelProb - impliedProb;
  const decOdds = americanToDecimalV3(bookOdds);
  const ev = modelProb * (decOdds - 1) - (1 - modelProb);
  const roiPct = edge * 100;
  const barWidth = Math.min(Math.abs(edge) * 1000, 100);
  return { edge, ev, roiPct, barWidth, isPositive: edge >= 0, hasEdge: Math.abs(edge) >= 0.03 };
}
function edgeColorV3(e: EdgeV3 | null): string {
  if (!e || !e.hasEdge) return '#FFFFFF';
  return e.isPositive ? '#45E0A8' : '#FFFFFF';
}

// ─── Color helpers (v3) ───────────────────────────────────────────────────────
function projColorV3(exp: number): string {
  if (exp <= 0.35) return '#45E0A8';
  if (exp <= 0.45) return '#FFFFFF';
  return '#FFFFFF';
}
function scoreColorV3(score: number): string {
  if (score <= 2.5) return '#45E0A8';
  if (score <= 4.5) return '#FFFFFF';
  return '#FFFFFF';
}
function inningBoxStyleV3(exp: number): { bg: string; border: string; color: string } {
  const r = Math.round(exp);
  if (r === 0) return { bg: '#000000', border: '#FFFFFF', color: '#FFFFFF' };
  if (r === 1) return { bg: 'transparent', border: '#45E0A8', color: '#45E0A8' };
  return { bg: 'transparent', border: '#FFFFFF', color: '#FFFFFF' };
}
function totalBadgeStyleV3(total: number): { bg: string; border: string; color: string } {
  if (total <= 2) return { bg: 'transparent', border: '#45E0A8', color: '#45E0A8' };
  if (total <= 4) return { bg: '#000000', border: '#FFFFFF', color: '#FFFFFF' };
  return { bg: 'transparent', border: '#FFFFFF', color: '#FFFFFF' };
}

// ─── NRFI badge ───────────────────────────────────────────────────────────────
type NrfiBadgeV3 = 'NRFI' | 'YRFI' | 'Skip';
function getNrfiBadgeV3(modelPNrfiRaw: string | null): NrfiBadgeV3 {
  const raw = parseFloat(modelPNrfiRaw ?? '');
  if (isNaN(raw)) return 'Skip';
  const pct = raw * 100;
  if (pct >= 52) return 'NRFI';
  if (pct <= 46) return 'YRFI';
  return 'Skip';
}

// ─── Format helpers (v3) ──────────────────────────────────────────────────────
function fmtOddsV3(val: string | number | null | undefined): string {
  if (val == null || val === '') return "—";
  const n = typeof val === 'number' ? val : parseFloat(String(val));
  if (isNaN(n)) return String(val);
  return n > 0 ? `+${Math.round(n)}` : `${Math.round(n)}`;
}
function fmtLineV3(val: string | null | undefined): string {
  if (!val) return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return val;
  return n > 0 ? `+${n}` : `${n}`;
}
function formatTimeV3(t: string | null | undefined): string {
  if (!t) return "";
  const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return t;
  let h = parseInt(m[1]!, 10);
  const min = m[2]!;
  const suffix = m[3] ?? (h >= 12 ? 'PM' : 'AM');
  if (!m[3]) {
    if (h === 0) h = 12;
    else if (h > 12) h -= 12;
  }
  return `${h}:${min} ${suffix.toUpperCase()} ET`;
}
function parseNumV3(val: string | number | null | undefined): number | null {
  if (val == null) return null;
  const n = typeof val === 'number' ? val : parseFloat(String(val));
  return isNaN(n) ? null : n;
}
function parseJsonArrV3(val: string | null | undefined): number[] | null {
  if (!val) return null;
  try {
    const arr = JSON.parse(val);
    if (Array.isArray(arr) && arr.length >= 5) return arr.map(Number);
    return null;
  } catch { return null; }
}

// ─── NRFI Table Row ───────────────────────────────────────────────────────────
function NrfiTableRowV3({ game, lineup }: { game: CheatSheetGame; lineup?: CheatSheetLineup | null }) {
  const [expanded, setExpanded] = useState(false);
  const awayPitcherName = lineup?.awayPitcherName || (game as CheatSheetGame & { awayStartingPitcher?: string | null }).awayStartingPitcher || "TBD";
  const homePitcherName = lineup?.homePitcherName || (game as CheatSheetGame & { homeStartingPitcher?: string | null }).homeStartingPitcher || "TBD";
  const awayPitcherEra = lineup?.awayPitcherEra ?? null;
  const homePitcherEra = lineup?.homePitcherEra ?? null;

  const awayInnExp = parseJsonArrV3(game.modelInningAwayExp);
  const homeInnExp = parseJsonArrV3(game.modelInningHomeExp);
  const awayI1 = awayInnExp?.[0] ?? null;
  const homeI1 = homeInnExp?.[0] ?? null;

  const modelPNrfiRaw = parseNumV3(game.modelPNrfi);
  const modelPNrfiPct = modelPNrfiRaw != null ? modelPNrfiRaw * 100 : null;
  const badge = getNrfiBadgeV3(game.modelPNrfi);

  const nrfiEdge = badge === 'NRFI'
    ? computeEdgeV3(modelPNrfiPct, game.nrfiOverOdds)
    : badge === 'YRFI'
    ? computeEdgeV3(modelPNrfiPct != null ? 100 - modelPNrfiPct : null, game.yrfiUnderOdds)
    : null;

  const bookOdds = badge === 'NRFI' ? game.nrfiOverOdds : badge === 'YRFI' ? game.yrfiUnderOdds : (game.nrfiOverOdds ?? game.yrfiUnderOdds);
  const modelOdds = badge === 'NRFI' ? game.modelNrfiOdds : badge === 'YRFI' ? game.modelYrfiOdds : (game.modelNrfiOdds ?? game.modelYrfiOdds);

  // Per-inning linescore: show I1-I9 mini grid when expanded
  const hasInnData = awayInnExp != null && homeInnExp != null && awayInnExp.length >= 9;
  // NRFI% with hundredths precision
  const nrfiPctDisplay = modelPNrfiPct != null ? modelPNrfiPct.toFixed(2) : null;
  const yrfiPctDisplay = modelPNrfiPct != null ? (100 - modelPNrfiPct).toFixed(2) : null;

  const td: React.CSSProperties = {
    padding: '10px 10px',
    borderBottom: expanded ? 'none' : '0.5px solid #FFFFFF',
    verticalAlign: 'middle',
    color: '#FFFFFF',
  };
  const tdExpanded: React.CSSProperties = {
    padding: '0 10px 10px',
    borderBottom: '0.5px solid #FFFFFF',
    verticalAlign: 'top',
    color: '#FFFFFF',
  };

  return (
    <>
    <tr
      onClick={() => hasInnData && setExpanded(e => !e)}
      style={{ cursor: hasInnData ? 'pointer' : 'default' }}
      onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = 'transparent'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = 'transparent'; }}
    >
      {/* Matchup */}
      <td style={td}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#FFFFFF', whiteSpace: 'nowrap' }}>
              {game.awayTeam} @ {game.homeTeam}
            </div>
            <div style={{ fontSize: 10, color: '#FFFFFF', marginTop: 2 }}>
              {formatTimeV3(game.startTimeEst)}
              {(game as CheatSheetGame & { venue?: string | null }).venue ? ` · ${(game as CheatSheetGame & { venue?: string | null }).venue}` : ''}
            </div>
          </div>
          {hasInnData && (
            <span style={{ fontSize: 9, color: '#FFFFFF', marginLeft: 4, flexShrink: 0 }}>
              {expanded ? '\u25b2' : '\u25bc'}
            </span>
          )}
        </div>
      </td>
      {/* Away Starter */}
      <td style={td}>
        <div style={{ fontSize: 12, color: '#FFFFFF', whiteSpace: 'nowrap' }}>{awayPitcherName}</div>
        <div style={{ fontSize: 10, color: '#FFFFFF', marginTop: 1 }}>{awayPitcherEra ? `ERA ${awayPitcherEra}` : '\u2014'}</div>
      </td>
      {/* Home Starter */}
      <td style={td}>
        <div style={{ fontSize: 12, color: '#FFFFFF', whiteSpace: 'nowrap' }}>{homePitcherName}</div>
        <div style={{ fontSize: 10, color: '#FFFFFF', marginTop: 1 }}>{homePitcherEra ? `ERA ${homePitcherEra}` : '\u2014'}</div>
      </td>
      {/* Away I1 Proj - hundredths precision */}
      <td style={{ ...td, textAlign: 'center' }}>
        {awayI1 != null
          ? (
            <div>
              <span style={{ fontSize: 15, fontWeight: 700, color: projColorV3(awayI1), fontVariantNumeric: 'tabular-nums' }}>{awayI1.toFixed(2)}</span>
              <div style={{ fontSize: 8, color: '#FFFFFF', marginTop: 1, letterSpacing: '.04em' }}>AWAY I1</div>
            </div>
          )
          : <span style={{ color: '#FFFFFF' }}>\u2014</span>}
      </td>
      {/* Home I1 Proj - hundredths precision */}
      <td style={{ ...td, textAlign: 'center' }}>
        {homeI1 != null
          ? (
            <div>
              <span style={{ fontSize: 15, fontWeight: 700, color: projColorV3(homeI1), fontVariantNumeric: 'tabular-nums' }}>{homeI1.toFixed(2)}</span>
              <div style={{ fontSize: 8, color: '#FFFFFF', marginTop: 1, letterSpacing: '.04em' }}>HOME I1</div>
            </div>
          )
          : <span style={{ color: '#FFFFFF' }}>\u2014</span>}
      </td>
      {/* Badge + NRFI% hundredths */}
      <td style={{ ...td, textAlign: 'center' }}>
        {badge === 'NRFI' && (
          <div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 500, padding: '4px 9px', borderRadius: 4, whiteSpace: 'nowrap', background: 'transparent', color: '#45E0A8', border: '1px solid #45E0A8' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#45E0A8', flexShrink: 0, display: 'inline-block' }} />NRFI
            </span>
            {nrfiPctDisplay && (
              <div style={{ fontSize: 9, color: '#45E0A8', marginTop: 3, fontVariantNumeric: 'tabular-nums', opacity: 0.7 }}>{nrfiPctDisplay}%</div>
            )}
          </div>
        )}
        {badge === 'YRFI' && (
          <div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 500, padding: '4px 9px', borderRadius: 4, whiteSpace: 'nowrap', background: 'transparent', color: '#FFFFFF', border: '1px solid #FFFFFF' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#FFFFFF', flexShrink: 0, display: 'inline-block' }} />YRFI
            </span>
            {yrfiPctDisplay && (
              <div style={{ fontSize: 9, color: '#FFFFFF', marginTop: 3, fontVariantNumeric: 'tabular-nums', opacity: 0.7 }}>{yrfiPctDisplay}%</div>
            )}
          </div>
        )}
        {badge === 'Skip' && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 500, padding: '4px 9px', borderRadius: 4, whiteSpace: 'nowrap', background: '#000000', color: '#FFFFFF', border: '1px solid #FFFFFF' }}>Skip</span>
        )}
      </td>
      {/* Book / Model */}
      <td style={td}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, minWidth: 160 }}>
          <div style={{ background: '#000000', border: '1px solid #FFFFFF', borderRadius: 6, padding: '7px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: '#FFFFFF', marginBottom: 2 }}>Book</div>
            <div style={{ fontSize: 15, fontWeight: 500, color: '#FFFFFF' }}>{fmtOddsV3(bookOdds)}</div>
          </div>
          <div style={{ background: '#000000', border: '1px solid #FFFFFF', borderRadius: 6, padding: '7px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: '#FFFFFF', marginBottom: 2 }}>Model</div>
            <div style={{ fontSize: 15, fontWeight: 500, color: nrfiEdge?.hasEdge ? '#45E0A8' : '#FFFFFF' }}>{fmtOddsV3(modelOdds)}</div>
          </div>
        </div>
      </td>
      {/* Edge */}
      <td style={{ ...td, textAlign: 'center' }}>
        {nrfiEdge?.hasEdge ? (
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: nrfiEdge.isPositive ? '#45E0A8' : '#FFFFFF' }}>
              {nrfiEdge.isPositive ? '+' : ''}{nrfiEdge.roiPct.toFixed(1)}%
            </div>
            <div style={{ height: 2, background: '#000000', borderRadius: 1, marginTop: 4 }}>
              <div style={{ height: 2, borderRadius: 1, width: `${nrfiEdge.barWidth}%`, background: nrfiEdge.isPositive ? '#45E0A8' : '#FFFFFF' }} />
            </div>
          </div>
        ) : <div style={{ fontSize: 14, fontWeight: 500, color: '#FFFFFF' }}>\u2014</div>}
      </td>
    </tr>
    {/* Per-inning linescore expansion row */}
    {expanded && hasInnData && awayInnExp && homeInnExp && (
      <tr>
        <td colSpan={8} style={tdExpanded}>
          <div style={{
            background: '#000000',
            border: '1px solid #FFFFFF',
            borderRadius: 6,
            padding: '10px 12px',
            marginBottom: 2,
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 8, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase' as const, color: '#FFFFFF' }}>
                Per-Inning Projection (I1-I9)
              </span>
              <span style={{ fontSize: 8, color: '#FFFFFF' }}>
                NRFI%: {nrfiPctDisplay ?? '\u2014'} \u00b7 YRFI%: {yrfiPctDisplay ?? '\u2014'}
              </span>
            </div>
            {/* Inning grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: 4 }}>
              {Array.from({ length: 9 }, (_, i) => {
                const aVal = awayInnExp[i] ?? 0;
                const hVal = homeInnExp[i] ?? 0;
                const combined = aVal + hVal;
                const s = inningBoxStyleV3(combined);
                return (
                  <div key={i} style={{
                    background: s.bg,
                    border: `1px solid ${s.border}`,
                    borderRadius: 4,
                    padding: '5px 3px 4px',
                    textAlign: 'center',
                  }}>
                    <div style={{ fontSize: 7, fontWeight: 800, letterSpacing: '.08em', color: '#FFFFFF', marginBottom: 3, textTransform: 'uppercase' as const }}>
                      I{i + 1}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#FFFFFF', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                      {aVal.toFixed(2)}
                    </div>
                    <div style={{ width: '60%', height: 1, background: '#FFFFFF', margin: '3px auto' }} />
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#FFFFFF', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                      {hVal.toFixed(2)}
                    </div>
                    <div style={{ fontSize: 8, fontWeight: 600, color: s.color, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
                      {combined.toFixed(2)}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Totals row */}
            <div style={{ display: 'flex', gap: 16, marginTop: 8, paddingTop: 6, borderTop: '1px solid #FFFFFF' }}>
              <span style={{ fontSize: 9, color: '#FFFFFF' }}>
                Away total: <span style={{ color: '#FFFFFF', fontWeight: 700 }}>{awayInnExp.reduce((a, b) => a + b, 0).toFixed(2)}</span>
              </span>
              <span style={{ fontSize: 9, color: '#FFFFFF' }}>
                Home total: <span style={{ color: '#FFFFFF', fontWeight: 700 }}>{homeInnExp.reduce((a, b) => a + b, 0).toFixed(2)}</span>
              </span>
              <span style={{ fontSize: 9, color: '#FFFFFF' }}>
                Game total: <span style={{ color: '#FFFFFF', fontWeight: 700 }}>{(awayInnExp.reduce((a, b) => a + b, 0) + homeInnExp.reduce((a, b) => a + b, 0)).toFixed(2)}</span>
              </span>
            </div>
          </div>
        </td>
      </tr>
    )}
    </>
  );
}

// ─── F5 Game Card ─────────────────────────────────────────────────────────────
function F5GameCardV3({ game, lineup }: { game: CheatSheetGame; lineup?: CheatSheetLineup | null }) {
  const awayInfo = MLB_BY_ABBREV.get(game.awayTeam);
  const homeInfo = MLB_BY_ABBREV.get(game.homeTeam);

  const awayPitcherName = lineup?.awayPitcherName || (game as CheatSheetGame & { awayStartingPitcher?: string | null }).awayStartingPitcher || null;
  const homePitcherName = lineup?.homePitcherName || (game as CheatSheetGame & { homeStartingPitcher?: string | null }).homeStartingPitcher || null;

  const awayInnExp = parseJsonArrV3(game.modelInningAwayExp);
  const homeInnExp = parseJsonArrV3(game.modelInningHomeExp);
  const modelF5Away = parseNumV3(game.modelF5AwayScore);
  const modelF5Home = parseNumV3(game.modelF5HomeScore);
  const modelF5Total = parseNumV3(game.modelF5Total);
  const modelF5OverRate = parseNumV3(game.modelF5OverRate);
  const modelF5UnderRate = parseNumV3(game.modelF5UnderRate);
  const bookTotalNum = parseNumV3(game.f5Total);

  const awayF5Total = awayInnExp ? awayInnExp.slice(0, 5).reduce((a, b) => a + b, 0) : null;
  const homeF5Total = homeInnExp ? homeInnExp.slice(0, 5).reduce((a, b) => a + b, 0) : null;

  const rlEdge = computeEdgeV3(parseNumV3(game.modelF5AwayRLCoverPct), game.f5AwayRunLineOdds);
  const mlEdge = computeEdgeV3(parseNumV3(game.modelF5AwayWinPct), game.f5AwayML);

  // ── F5 Win Probability (three-way: Away Win | Push | Home Win) ──────────────
  // DB stores on 0–100 scale (e.g. "43.51" = 43.51%)
  const f5AwayWinPct = parseNumV3(game.modelF5AwayWinPct);  // 0–100
  const f5HomeWinPct = parseNumV3(game.modelF5HomeWinPct);  // 0–100
  // Push% — use DB-stored Bayesian-blended modelF5PushPct (same source as MlbCheatSheetCard).
  // [FIX Phase 9] Replaces the derived 100-away-home formula which could disagree with the
  // authoritative Bayesian-blended value stored by the Python model engine.
  // [VERIFY] game.modelF5PushPct is stored as 0-1 in DB (e.g. 0.1234 = 12.34%)
  const _modelF5PushPctRaw = parseNumV3(game.modelF5PushPct);
  const f5PushPctV3 = _modelF5PushPctRaw != null
    ? _modelF5PushPctRaw * 100  // convert 0-1 → 0-100 for display
    : (f5AwayWinPct != null && f5HomeWinPct != null)
      ? Math.max(0, 100 - f5AwayWinPct - f5HomeWinPct)  // fallback if DB value absent
      : null;

  // ── F5 ML No-Vig Edge Display ─────────────────────────────────────────────
  // Remove vig from both sides: noVig = rawSide / (rawAway + rawHome)
  // This gives the fair (vig-free) book probability to compare against the model.
  const _f5AwayMLNum = game.f5AwayML ? parseFloat(game.f5AwayML) : null;
  const _f5HomeMLNum = game.f5HomeML ? parseFloat(game.f5HomeML) : null;
  let noVigAwayImplied: number | null = null; // 0-100
  let noVigHomeImplied: number | null = null; // 0-100
  if (_f5AwayMLNum != null && !isNaN(_f5AwayMLNum) && _f5HomeMLNum != null && !isNaN(_f5HomeMLNum)) {
    const rawAway = americanToImplied(_f5AwayMLNum); // vig-inclusive 0-1
    const rawHome = americanToImplied(_f5HomeMLNum); // vig-inclusive 0-1
    const vigTotal = rawAway + rawHome;
    if (vigTotal > 0) {
      noVigAwayImplied = (rawAway / vigTotal) * 100;
      noVigHomeImplied = (rawHome / vigTotal) * 100;
    }
  }
  // Edge delta: model% - no-vig book% (positive = model favors this side vs book)
  const f5AwayMlEdgeDelta = (f5AwayWinPct != null && noVigAwayImplied != null)
    ? parseFloat((f5AwayWinPct - noVigAwayImplied).toFixed(2))
    : null;
  const f5HomeMlEdgeDelta = (f5HomeWinPct != null && noVigHomeImplied != null)
    ? parseFloat((f5HomeWinPct - noVigHomeImplied).toFixed(2))
    : null;
  const f5AwayHasEdge = f5AwayMlEdgeDelta != null && Math.abs(f5AwayMlEdgeDelta) >= 3.0;
  const f5HomeHasEdge = f5HomeMlEdgeDelta != null && Math.abs(f5HomeMlEdgeDelta) >= 3.0;
  const hasF5MlEdgeData = noVigAwayImplied != null && (f5AwayWinPct != null || f5HomeWinPct != null);

  let ouEdge: EdgeV3 | null = null;
  let ouLabel = '';
  if (modelF5Total != null && bookTotalNum != null) {
    if (modelF5Total > bookTotalNum) {
      ouEdge = computeEdgeV3(modelF5OverRate, game.f5OverOdds);
      ouLabel = 'O';
    } else {
      ouEdge = computeEdgeV3(modelF5UnderRate, game.f5UnderOdds);
      ouLabel = 'U';
    }
  }

  // ── FG Total Edge Display ─────────────────────────────────────────────────
  // modelTotal = book-anchored originated line (used for O/U edge computation)
  // modelProjTotal = raw engine projection before line selection (pure model output)
  // modelWeatherAdj = weather run-factor (1.0 = neutral dome/no data, >1.0 = run-boosting)
  const fgModelTotal = parseNumV3(game.modelTotal);
  const fgProjTotal = parseNumV3(game.modelProjTotal);       // raw engine projection
  const fgWeatherAdj = parseNumV3(game.modelWeatherAdj);     // weather factor (1.0 = neutral)
  const fgBookTotal = parseNumV3(game.total);
  const fgModelOverRate = parseNumV3(game.modelOverRate);   // 0-100
  const fgModelUnderRate = parseNumV3(game.modelUnderRate); // 0-100
  let fgOuEdge: EdgeV3 | null = null;
  let fgOuLabel = '';
  let fgOuModelPct: number | null = null;
  let fgOuBookOdds: string | null = null;
  if (fgModelTotal != null && fgBookTotal != null) {
    if (fgModelTotal > fgBookTotal) {
      fgOuEdge = computeEdgeV3(fgModelOverRate, game.overOdds);
      fgOuLabel = 'O';
      fgOuModelPct = fgModelOverRate;
      fgOuBookOdds = game.overOdds;
    } else {
      fgOuEdge = computeEdgeV3(fgModelUnderRate, game.underOdds);
      fgOuLabel = 'U';
      fgOuModelPct = fgModelUnderRate;
      fgOuBookOdds = game.underOdds;
    }
  }
  const hasFgTotalData = fgModelTotal != null && fgBookTotal != null;
  // ── FG ML Edge Display ───────────────────────────────────────────────────────
  const fgAwayWinPct = parseNumV3(game.modelAwayWinPct);  // 0-100
  const fgHomeWinPct = parseNumV3(game.modelHomeWinPct);  // 0-100
  const _fgAwayMLNum = game.awayML ? parseFloat(game.awayML) : null;
  const _fgHomeMLNum = game.homeML ? parseFloat(game.homeML) : null;
  let fgNoVigAwayImplied: number | null = null; // 0-100
  let fgNoVigHomeImplied: number | null = null; // 0-100
  if (_fgAwayMLNum != null && !isNaN(_fgAwayMLNum) && _fgHomeMLNum != null && !isNaN(_fgHomeMLNum)) {
    const rawAway = americanToImplied(_fgAwayMLNum);
    const rawHome = americanToImplied(_fgHomeMLNum);
    const vigTotal = rawAway + rawHome;
    if (vigTotal > 0) {
      fgNoVigAwayImplied = (rawAway / vigTotal) * 100;
      fgNoVigHomeImplied = (rawHome / vigTotal) * 100;
    }
  }
  const fgAwayMlEdgeDelta = (fgAwayWinPct != null && fgNoVigAwayImplied != null)
    ? parseFloat((fgAwayWinPct - fgNoVigAwayImplied).toFixed(2))
    : null;
  const fgHomeMlEdgeDelta = (fgHomeWinPct != null && fgNoVigHomeImplied != null)
    ? parseFloat((fgHomeWinPct - fgNoVigHomeImplied).toFixed(2))
    : null;
  const fgAwayHasEdge = fgAwayMlEdgeDelta != null && Math.abs(fgAwayMlEdgeDelta) >= 3.0;
  const fgHomeHasEdge = fgHomeMlEdgeDelta != null && Math.abs(fgHomeMlEdgeDelta) >= 3.0;
  const hasFgMlEdgeData = fgNoVigAwayImplied != null && (fgAwayWinPct != null || fgHomeWinPct != null);

  const pitcherLine = [awayPitcherName, homePitcherName].filter(Boolean).join(' vs ');

  return (
    <div style={{ background: '#000000', border: '1px solid #FFFFFF', borderRadius: 8, marginBottom: 8, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '9px 14px', borderBottom: '1px solid #FFFFFF', gap: 10, flexWrap: 'wrap' as const }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: '#FFFFFF' }}>{game.awayTeam} @ {game.homeTeam}</span>
        <span style={{ fontSize: 10, color: '#FFFFFF' }}>
          {formatTimeV3(game.startTimeEst)}
          {(game as CheatSheetGame & { venue?: string | null }).venue ? ` · ${(game as CheatSheetGame & { venue?: string | null }).venue}` : ''}
          {pitcherLine ? ` · ${pitcherLine}` : ''}
        </span>
      </div>

      {/* 3-column body */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr' }}>

        {/* LEFT: Proj runs I1–I5 */}
        <div style={{ padding: '10px 14px 12px', borderRight: '1px solid #FFFFFF' }}>
          <div style={{ fontSize: 8, fontWeight: 500, letterSpacing: '.12em', textTransform: 'uppercase' as const, color: '#FFFFFF', marginBottom: 8 }}>
            Proj runs — innings 1–5
          </div>
          {/* Away */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
            <span style={{ fontSize: 11, fontWeight: 500, color: '#FFFFFF', width: 38, flexShrink: 0 }}>{game.awayTeam}</span>
            <div style={{ display: 'flex', gap: 3 }}>
              {(awayInnExp ?? Array(5).fill(null)).slice(0, 5).map((exp: number | null, i: number) => {
                const s = exp != null ? inningBoxStyleV3(exp) : { bg: '#000000', border: '#FFFFFF', color: '#FFFFFF' };
                return (
                  <div key={i} style={{ width: 22, height: 22, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 500, flexShrink: 0, background: s.bg, border: `1px solid ${s.border}`, color: s.color }}>
                    {exp != null ? Math.round(exp) : '—'}
                  </div>
                );
              })}
            </div>
            {awayF5Total != null && (() => {
              const t = Math.round(awayF5Total);
              const s = totalBadgeStyleV3(t);
              return <span style={{ fontSize: 11, fontWeight: 500, padding: '2px 7px', borderRadius: 3, marginLeft: 2, whiteSpace: 'nowrap' as const, background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>{t}</span>;
            })()}
          </div>
          {/* Home */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 500, color: '#FFFFFF', width: 38, flexShrink: 0 }}>{game.homeTeam}</span>
            <div style={{ display: 'flex', gap: 3 }}>
              {(homeInnExp ?? Array(5).fill(null)).slice(0, 5).map((exp: number | null, i: number) => {
                const s = exp != null ? inningBoxStyleV3(exp) : { bg: '#000000', border: '#FFFFFF', color: '#FFFFFF' };
                return (
                  <div key={i} style={{ width: 22, height: 22, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 500, flexShrink: 0, background: s.bg, border: `1px solid ${s.border}`, color: s.color }}>
                    {exp != null ? Math.round(exp) : '—'}
                  </div>
                );
              })}
            </div>
            {homeF5Total != null && (() => {
              const t = Math.round(homeF5Total);
              const s = totalBadgeStyleV3(t);
              return <span style={{ fontSize: 11, fontWeight: 500, padding: '2px 7px', borderRadius: 3, marginLeft: 2, whiteSpace: 'nowrap' as const, background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>{t}</span>;
            })()}
          </div>
        </div>

        {/* CENTER: F5 projection + Win Probability row */}
        <div style={{ padding: '10px 18px', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: 6, borderRight: '1px solid #FFFFFF', minWidth: 160 }}>
          <div style={{ fontSize: 8, fontWeight: 500, letterSpacing: '.12em', textTransform: 'uppercase' as const, color: '#FFFFFF' }}>F5 projection</div>

          {/* Score display row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: awayInfo?.primaryColor ? `${awayInfo.primaryColor}22` : '#000000', border: `1px solid ${awayInfo?.primaryColor ?? '#FFFFFF'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 500, color: awayInfo?.primaryColor ?? '#FFFFFF', flexShrink: 0 }}>
              {game.awayTeam}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 26, fontWeight: 500, lineHeight: 1, color: modelF5Away != null ? scoreColorV3(modelF5Away) : '#FFFFFF' }}>
                {modelF5Away != null ? modelF5Away.toFixed(1) : '—'}
              </span>
              <span style={{ fontSize: 14, color: '#FFFFFF' }}>–</span>
              <span style={{ fontSize: 26, fontWeight: 500, lineHeight: 1, color: modelF5Home != null ? scoreColorV3(modelF5Home) : '#FFFFFF' }}>
                {modelF5Home != null ? modelF5Home.toFixed(1) : '—'}
              </span>
            </div>
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: homeInfo?.primaryColor ? `${homeInfo.primaryColor}22` : '#000000', border: `1px solid ${homeInfo?.primaryColor ?? '#FFFFFF'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 500, color: homeInfo?.primaryColor ?? '#FFFFFF', flexShrink: 0 }}>
              {game.homeTeam}
            </div>
          </div>

          {/* F5 Win Probability row: Away Win% | Push% | Home Win% */}
          {/* Only rendered when at least one win pct is populated */}
          {(f5AwayWinPct != null || f5HomeWinPct != null) && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              background: '#000000',
              border: '1px solid #FFFFFF',
              borderRadius: 6,
              padding: '5px 8px',
              width: '100%',
              justifyContent: 'center',
            }}>
              {/* Away win% */}
              <div style={{ textAlign: 'center', minWidth: 46 }}>
                <div style={{ fontSize: 8, color: '#FFFFFF', letterSpacing: '.06em', textTransform: 'uppercase' as const, marginBottom: 2 }}>{game.awayTeam}</div>
                <div style={{
                  fontSize: 13, fontWeight: 600, lineHeight: 1,
                  color: f5AwayWinPct != null && f5HomeWinPct != null && f5AwayWinPct > f5HomeWinPct
                    ? '#45E0A8'
                    : '#FFFFFF',
                }}>
                  {f5AwayWinPct != null ? `${f5AwayWinPct.toFixed(1)}%` : '—'}
                </div>
              </div>

              {/* Divider */}
              <div style={{ width: 1, height: 24, background: '#FFFFFF', flexShrink: 0 }} />

              {/* Push% (three-way derived) */}
              {f5PushPctV3 != null && (
                <>
                  <div style={{ textAlign: 'center', minWidth: 36 }}>
                    <div style={{ fontSize: 8, color: '#FFFFFF', letterSpacing: '.06em', textTransform: 'uppercase' as const, marginBottom: 2 }}>Push</div>
                    <div style={{ fontSize: 11, fontWeight: 400, lineHeight: 1, color: '#FFFFFF' }}>
                      {f5PushPctV3.toFixed(1)}%
                    </div>
                  </div>
                  <div style={{ width: 1, height: 24, background: '#FFFFFF', flexShrink: 0 }} />
                </>
              )}

              {/* Home win% */}
              <div style={{ textAlign: 'center', minWidth: 46 }}>
                <div style={{ fontSize: 8, color: '#FFFFFF', letterSpacing: '.06em', textTransform: 'uppercase' as const, marginBottom: 2 }}>{game.homeTeam}</div>
                <div style={{
                  fontSize: 13, fontWeight: 600, lineHeight: 1,
                  color: f5HomeWinPct != null && f5AwayWinPct != null && f5HomeWinPct > f5AwayWinPct
                    ? '#45E0A8'
                    : '#FFFFFF',
                }}>
                  {f5HomeWinPct != null ? `${f5HomeWinPct.toFixed(1)}%` : '—'}
                </div>
              </div>
            </div>
          )}

          {/* F5 ML Edge Row: Model% vs No-Vig Book% → delta */}
          {/* Shown when both F5 ML odds and at least one model win pct are available */}
          {hasF5MlEdgeData && (
            <div style={{
              width: '100%',
              background: '#000000',
              border: '1px solid #FFFFFF',
              borderRadius: 6,
              padding: '6px 8px',
              display: 'flex',
              flexDirection: 'column' as const,
              gap: 4,
            }}>
              <div style={{ fontSize: 7, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase' as const, color: '#FFFFFF', textAlign: 'center', marginBottom: 2 }}>F5 ML Edge</div>
              {/* Away row */}
              {f5AwayWinPct != null && noVigAwayImplied != null && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                  <span style={{ fontSize: 9, fontWeight: 500, color: '#FFFFFF', minWidth: 28 }}>{game.awayTeam}</span>
                  <span style={{ fontSize: 9, color: '#FFFFFF' }}>
                    Model {f5AwayWinPct.toFixed(1)}% vs Book {noVigAwayImplied.toFixed(1)}%
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, lineHeight: 1,
                    color: f5AwayHasEdge
                      ? (f5AwayMlEdgeDelta! > 0 ? '#45E0A8' : '#FFFFFF')
                      : '#FFFFFF',
                    minWidth: 36, textAlign: 'right',
                  }}>
                    {f5AwayMlEdgeDelta != null
                      ? `${f5AwayMlEdgeDelta > 0 ? '+' : ''}${f5AwayMlEdgeDelta.toFixed(1)}%`
                      : '—'}
                  </span>
                </div>
              )}
              {/* Home row */}
              {f5HomeWinPct != null && noVigHomeImplied != null && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                  <span style={{ fontSize: 9, fontWeight: 500, color: '#FFFFFF', minWidth: 28 }}>{game.homeTeam}</span>
                  <span style={{ fontSize: 9, color: '#FFFFFF' }}>
                    Model {f5HomeWinPct.toFixed(1)}% vs Book {noVigHomeImplied.toFixed(1)}%
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, lineHeight: 1,
                    color: f5HomeHasEdge
                      ? (f5HomeMlEdgeDelta! > 0 ? '#45E0A8' : '#FFFFFF')
                      : '#FFFFFF',
                    minWidth: 36, textAlign: 'right',
                  }}>
                    {f5HomeMlEdgeDelta != null
                      ? `${f5HomeMlEdgeDelta > 0 ? '+' : ''}${f5HomeMlEdgeDelta.toFixed(1)}%`
                      : '—'}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* FG Total Edge Row: Model projection vs Originated Line vs Book total */}
          {hasFgTotalData && (
            <div style={{
              marginTop: 6,
              padding: '7px 10px',
              background: '#000000',
              border: '1px solid #FFFFFF',
              borderRadius: 5,
            }}>
              {/* Header row */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                <div style={{ fontSize: 7, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase' as const, color: '#FFFFFF' }}>FG Total Edge</div>
                <span style={{
                  fontSize: 10, fontWeight: 700,
                  color: fgOuEdge?.hasEdge ? '#45E0A8' : '#FFFFFF',
                }}>
                  {fgOuLabel && fgOuEdge ? `${fgOuLabel} ${fgOuEdge.isPositive ? '+' : ''}${fgOuEdge.roiPct.toFixed(1)}%` : '—'}
                </span>
              </div>
              {/* Three-value comparison: Model Proj | Originated Line | Book */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                {/* Model Projection (raw engine output) */}
                <div style={{ background: '#000000', border: '1px solid #FFFFFF', borderRadius: 4, padding: '4px 6px', textAlign: 'center' }}>
                  <div style={{ fontSize: 7, color: '#FFFFFF', marginBottom: 2, letterSpacing: '.08em', textTransform: 'uppercase' as const }}>Proj</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: fgProjTotal != null ? '#45E0A8' : '#FFFFFF', fontVariantNumeric: 'tabular-nums' }}>
                    {fgProjTotal != null ? fgProjTotal.toFixed(2) : '—'}
                  </div>
                  {fgWeatherAdj != null && Math.abs(fgWeatherAdj - 1.0) >= 0.005 && (
                    <div style={{ fontSize: 7, color: fgWeatherAdj > 1.0 ? '#FFFFFF' : '#FFFFFF', marginTop: 1, letterSpacing: '.04em' }}>
                      {fgWeatherAdj > 1.0 ? '▲' : '▼'} {((fgWeatherAdj - 1.0) * 100).toFixed(1)}%
                    </div>
                  )}
                </div>
                {/* Originated Line (book-anchored model line) */}
                <div style={{ background: '#000000', border: '1px solid #FFFFFF', borderRadius: 4, padding: '4px 6px', textAlign: 'center' }}>
                  <div style={{ fontSize: 7, color: '#FFFFFF', marginBottom: 2, letterSpacing: '.08em', textTransform: 'uppercase' as const }}>Line</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: fgOuEdge?.hasEdge ? '#45E0A8' : '#FFFFFF', fontVariantNumeric: 'tabular-nums' }}>
                    {fgModelTotal!.toFixed(1)}
                  </div>
                  {fgOuModelPct != null && (
                    <div style={{ fontSize: 7, color: '#FFFFFF', marginTop: 1 }}>{fgOuModelPct.toFixed(1)}%</div>
                  )}
                </div>
                {/* Book Total */}
                <div style={{ background: '#000000', border: '1px solid #FFFFFF', borderRadius: 4, padding: '4px 6px', textAlign: 'center' }}>
                  <div style={{ fontSize: 7, color: '#FFFFFF', marginBottom: 2, letterSpacing: '.08em', textTransform: 'uppercase' as const }}>Book</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#FFFFFF', fontVariantNumeric: 'tabular-nums' }}>
                    {fgBookTotal!.toFixed(1)}
                  </div>
                  {fgOuBookOdds && (
                    <div style={{ fontSize: 7, color: '#FFFFFF', marginTop: 1 }}>{fmtOddsV3(fgOuBookOdds)}</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* FG ML Edge Row: Model win% vs No-Vig Book% → delta */}
          {hasFgMlEdgeData && (
            <div style={{
              marginTop: 6,
              padding: '6px 8px',
              background: '#000000',
              border: '1px solid #FFFFFF',
              borderRadius: 5,
            }}>
              <div style={{ fontSize: 7, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase' as const, color: '#FFFFFF', textAlign: 'center', marginBottom: 4 }}>FG ML Edge</div>
              {fgAwayWinPct != null && fgNoVigAwayImplied != null && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                  <span style={{ fontSize: 9, fontWeight: 500, color: '#FFFFFF', minWidth: 28 }}>{game.awayTeam}</span>
                  <span style={{ fontSize: 9, color: '#FFFFFF' }}>
                    Model {fgAwayWinPct.toFixed(1)}% vs Book {fgNoVigAwayImplied.toFixed(1)}%
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, lineHeight: 1,
                    color: fgAwayHasEdge
                      ? (fgAwayMlEdgeDelta! > 0 ? '#45E0A8' : '#FFFFFF')
                      : '#FFFFFF',
                    minWidth: 36, textAlign: 'right',
                  }}>
                    {fgAwayMlEdgeDelta != null
                      ? `${fgAwayMlEdgeDelta > 0 ? '+' : ''}${fgAwayMlEdgeDelta.toFixed(1)}%`
                      : '—'}
                  </span>
                </div>
              )}
              {fgHomeWinPct != null && fgNoVigHomeImplied != null && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginTop: 2 }}>
                  <span style={{ fontSize: 9, fontWeight: 500, color: '#FFFFFF', minWidth: 28 }}>{game.homeTeam}</span>
                  <span style={{ fontSize: 9, color: '#FFFFFF' }}>
                    Model {fgHomeWinPct.toFixed(1)}% vs Book {fgNoVigHomeImplied.toFixed(1)}%
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, lineHeight: 1,
                    color: fgHomeHasEdge
                      ? (fgHomeMlEdgeDelta! > 0 ? '#45E0A8' : '#FFFFFF')
                      : '#FFFFFF',
                    minWidth: 36, textAlign: 'right',
                  }}>
                    {fgHomeMlEdgeDelta != null
                      ? `${fgHomeMlEdgeDelta > 0 ? '+' : ''}${fgHomeMlEdgeDelta.toFixed(1)}%`
                      : '—'}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT: Book vs model — RL / ML / O/U */}
        <div style={{ padding: '10px 14px 12px' }}>
          <div style={{ fontSize: 8, fontWeight: 500, letterSpacing: '.12em', textTransform: 'uppercase' as const, color: '#FFFFFF', marginBottom: 8 }}>Book vs model</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {/* RL */}
            <div>
              <div style={{ fontSize: 8, fontWeight: 500, letterSpacing: '.1em', textTransform: 'uppercase' as const, color: '#FFFFFF', marginBottom: 4, textAlign: 'center' }}>RL</div>
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 4 }}>
                <div style={{ background: '#000000', border: '1px solid #FFFFFF', borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
                  <div style={{ fontSize: 9, color: '#FFFFFF', marginBottom: 2 }}>{fmtLineV3(game.f5AwayRunLine)} Book</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#FFFFFF' }}>{fmtOddsV3(game.f5AwayRunLineOdds)}</div>
                </div>
                <div style={{ background: '#000000', border: '1px solid #FFFFFF', borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
                  <div style={{ fontSize: 9, color: '#FFFFFF', marginBottom: 2 }}>{fmtLineV3(game.f5AwayRunLine)} Model</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: rlEdge?.hasEdge ? '#45E0A8' : '#FFFFFF' }}>{fmtOddsV3(game.modelF5AwayRlOdds)}</div>
                </div>
              </div>
              <div style={{ fontSize: 10, fontWeight: 500, marginTop: 4, textAlign: 'center', color: edgeColorV3(rlEdge) }}>
                {rlEdge?.hasEdge ? `${rlEdge.isPositive ? '+' : ''}${rlEdge.roiPct.toFixed(1)}%` : '—'}
              </div>
            </div>
            {/* ML */}
            <div>
              <div style={{ fontSize: 8, fontWeight: 500, letterSpacing: '.1em', textTransform: 'uppercase' as const, color: '#FFFFFF', marginBottom: 4, textAlign: 'center' }}>ML</div>
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 4 }}>
                <div style={{ background: '#000000', border: '1px solid #FFFFFF', borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
                  <div style={{ fontSize: 9, color: '#FFFFFF', marginBottom: 2 }}>Book</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#FFFFFF' }}>{fmtOddsV3(game.f5AwayML)}</div>
                </div>
                <div style={{ background: '#000000', border: '1px solid #FFFFFF', borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
                  <div style={{ fontSize: 9, color: '#FFFFFF', marginBottom: 2 }}>Model</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: mlEdge?.hasEdge ? '#45E0A8' : '#FFFFFF' }}>{fmtOddsV3(game.modelF5AwayML)}</div>
                </div>
              </div>
              <div style={{ fontSize: 10, fontWeight: 500, marginTop: 4, textAlign: 'center', color: edgeColorV3(mlEdge) }}>
                {mlEdge?.hasEdge ? `${mlEdge.isPositive ? '+' : ''}${mlEdge.roiPct.toFixed(1)}%` : '—'}
              </div>
            </div>
            {/* O/U */}
            <div>
              <div style={{ fontSize: 8, fontWeight: 500, letterSpacing: '.1em', textTransform: 'uppercase' as const, color: '#FFFFFF', marginBottom: 4, textAlign: 'center' }}>O/U</div>
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 4 }}>
                <div style={{ background: '#000000', border: '1px solid #FFFFFF', borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
                  <div style={{ fontSize: 9, color: '#FFFFFF', marginBottom: 2 }}>Book</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#FFFFFF' }}>{game.f5Total ?? '—'}</div>
                </div>
                <div style={{ background: '#000000', border: '1px solid #FFFFFF', borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
                  <div style={{ fontSize: 9, color: '#FFFFFF', marginBottom: 2 }}>Model</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: ouEdge?.hasEdge ? '#45E0A8' : '#FFFFFF' }}>
                    {modelF5Total != null ? modelF5Total.toFixed(1) : '—'}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 10, fontWeight: 500, marginTop: 4, textAlign: 'center', color: edgeColorV3(ouEdge) }}>
                {ouEdge?.hasEdge && ouLabel ? `${ouLabel} ${ouEdge.isPositive ? '+' : ''}${ouEdge.roiPct.toFixed(1)}%` : '—'}
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

// ─── CheatSheetView — main export ─────────────────────────────────────────────
export interface CheatSheetViewProps {
  games: CheatSheetGame[];
  lineupsMap?: Map<number, CheatSheetLineup>;
  dateLabel?: string;
}

export function CheatSheetView({ games, lineupsMap, dateLabel }: CheatSheetViewProps) {
  const [activeTab, setActiveTab] = useState<'nrfi' | 'f5'>('nrfi');

  const modeledGames = games.filter(g => g.modelPNrfi != null || g.modelF5AwayScore != null);
  if (modeledGames.length === 0) return null;

  return (
    <div style={{ fontFamily: "'Familjen Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", marginBottom: 24 }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap' as const, gap: 10 }}>
        {dateLabel && (
          <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: '.14em', textTransform: 'uppercase' as const, color: '#FFFFFF' }}>
            {dateLabel}
          </span>
        )}
        {/* Tab switcher */}
        <div style={{ display: 'flex', background: '#000000', border: '1px solid #FFFFFF', borderRadius: 6, padding: 3, gap: 2 }}>
          {(['nrfi', 'f5'] as const).map(tab => (
            <button type="button" key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                fontSize: 11, fontWeight: 500, letterSpacing: '.07em', textTransform: 'uppercase' as const,
                padding: '5px 16px', borderRadius: 4, cursor: 'pointer', transition: 'all .15s',
                border: activeTab === tab ? '1px solid #45E0A8' : '1px solid transparent',
                background: activeTab === tab ? 'transparent' : 'transparent',
                color: activeTab === tab ? '#45E0A8' : '#FFFFFF',
              }}
            >
              {tab === 'nrfi' ? 'NRFI / YRFI' : 'First 5'}
            </button>
          ))}
        </div>
        {/* Legend */}
        {activeTab === 'nrfi' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {[{ color: '#45E0A8', label: 'NRFI' }, { color: '#FFFFFF', label: 'YRFI' }, { color: '#FFFFFF', label: 'Skip' }].map(({ color, label }) => (
              <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 500, letterSpacing: '.06em', textTransform: 'uppercase' as const, color: '#FFFFFF' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />{label}
              </span>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {[{ color: '#45E0A8', label: 'Run' }, { color: '#FFFFFF', label: 'Multi-run' }, { color: '#FFFFFF', label: 'Zero' }].map(({ color, label }) => (
              <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 500, letterSpacing: '.06em', textTransform: 'uppercase' as const, color: '#FFFFFF' }}>
                <span style={{ width: 7, height: 7, borderRadius: 2, background: color, flexShrink: 0, display: 'inline-block' }} />{label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── NRFI TABLE ── */}
      {activeTab === 'nrfi' && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #FFFFFF' }}>
                {['Matchup', 'Away starter', 'Home starter', 'Away proj', 'Home proj', 'NRFI / YRFI', 'Book / Model', 'Edge (ROI%)'].map((h, i) => (
                  <th key={h} style={{ fontSize: '8.5px', fontWeight: 500, letterSpacing: '.11em', textTransform: 'uppercase' as const, color: '#FFFFFF', padding: '6px 10px', textAlign: i >= 3 ? 'center' : 'left', whiteSpace: 'nowrap' as const }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modeledGames.map(game => (
                <NrfiTableRowV3 key={game.id} game={game} lineup={lineupsMap?.get(game.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── F5 CARDS ── */}
      {activeTab === 'f5' && (
        <div>
          {modeledGames.map(game => (
            <F5GameCardV3 key={game.id} game={game} lineup={lineupsMap?.get(game.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
