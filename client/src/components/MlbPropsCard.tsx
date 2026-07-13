/**
 * MlbPropsCard
 *
 * Displays MLB pitcher strikeout prop projections for a single game.
 * Styled to exactly match the Lineups rendered-image card:
 *   - #090E14 card background, #182433 borders
 *   - Team color gradient top bar
 *   - Barlow Condensed typography
 *   - MLB headshots with background removal
 *   - LHP/RHP hand badges, CONFIRMED/EXPECTED status pills
 *   - Two-column pitcher layout (away left, home right)
 *   - Per-pitcher: K proj, consensus line, over/under probs, edge verdict
 *   - Matchup table (batting order vs pitcher)
 */

import { useMemo } from "react";
import { MLB_BY_ABBREV } from "@shared/mlbTeams";
import { teamLogoGradient } from "@/lib/teamLogoCircle";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface StrikeoutPropRow {
  id: number;
  gameId: number;
  side: string;
  pitcherName: string;
  pitcherHand: string | null;
  retrosheetId: string | null;
  mlbamId: number | null;
  kProj: string | null;
  kLine: string | null;
  kPer9: string | null;
  kMedian: string | null;
  kP5: string | null;
  kP95: string | null;
  bookLine: string | null;
  bookOverOdds: string | null;
  bookUnderOdds: string | null;
  pOver: string | null;
  pUnder: string | null;
  modelOverOdds: string | null;
  modelUnderOdds: string | null;
  edgeOver: string | null;
  edgeUnder: string | null;
  verdict: string | null;
  bestEdge: string | null;
  bestSide: string | null;
  bestMlStr: string | null;
  signalBreakdown: string | null;
  matchupRows: string | null;
  distribution: string | null;
  inningBreakdown: string | null;
  modelRunAt: number | null;
  createdAt: Date;
  updatedAt: Date;
}

interface LineupConfirmedFlags {
  awayPitcherConfirmed?: boolean | null;
  homePitcherConfirmed?: boolean | null;
}

interface MlbPropsCardProps {
  awayTeam: string;
  homeTeam: string;
  startTime: string;
  gameDate?: string;
  props: StrikeoutPropRow[] | null | undefined;
  lineup?: LineupConfirmedFlags | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const mlbPhoto = (id: number | null | undefined): string | null => {
  if (!id) return null;
  return `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_360,q_auto:best,e_background_removal,f_png/v1/people/${id}/headshot/67/current`;
};

function fmtNum(val: string | null | undefined, decimals = 1): string {
  if (!val) return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return "—";
  return n.toFixed(decimals);
}

function fmtPct(val: string | null | undefined): string {
  if (!val) return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function fmtOdds(val: string | null | undefined): string {
  if (!val) return "—";
  const n = parseInt(val, 10);
  if (isNaN(n)) return "—";
  return n > 0 ? `+${n}` : String(n);
}

/** Convert decimal probability (0–1) to American odds string. */
function probToAmerican(p: number): string {
  if (p <= 0 || p >= 1) return "—";
  if (p >= 0.5) return String(Math.round(-100 * p / (1 - p)));
  return `+${Math.round(100 * (1 - p) / p)}`;
}

/** Edge in percentage points → color tier matching GameCard. */
function edgeColor(edgePp: number): string {
  if (edgePp >= 8)   return "#39FF14";
  if (edgePp >= 5)   return "#7FFF00";
  if (edgePp >= 2.5) return "#ADFF2F";
  if (edgePp >= 0.5) return "rgba(255,255,255,0.70)";
  if (edgePp >= -1)  return "rgba(255,255,255,0.35)";
  return "#FF2244";
}

function teamPrimary(abbrev: string): string {
  return MLB_BY_ABBREV.get(abbrev.toUpperCase())?.primaryColor ?? "#4A90D9";
}
function teamSecondary(abbrev: string): string {
  return MLB_BY_ABBREV.get(abbrev.toUpperCase())?.secondaryColor ?? "#1A3A5C";
}
function teamLogo(abbrev: string): string | null {
  return MLB_BY_ABBREV.get(abbrev.toUpperCase())?.logoUrl ?? null;
}
function teamCity(abbrev: string): string {
  return MLB_BY_ABBREV.get(abbrev.toUpperCase())?.city ?? abbrev;
}
function teamNickname(abbrev: string): string {
  return MLB_BY_ABBREV.get(abbrev.toUpperCase())?.nickname ?? "";
}

// ─── Sub-components ────────────────────────────────────────────────────────────

/** Pill badge — matches lineup card pill() helper */
function Pill({ label, bg, color, border }: { label: string; bg: string; color: string; border: string }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, letterSpacing: "1.2px",
      textTransform: "uppercase", color, background: bg,
      border: `1px solid ${border}`, borderRadius: 3,
      padding: "2px 6px", display: "inline-flex", alignItems: "center", gap: 4,
      fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif',
    }}>
      {label}
    </span>
  );
}

/** CONFIRMED / EXPECTED status pill */
function StatusPill({ confirmed }: { confirmed: boolean }) {
  const color = confirmed ? "#39FF14" : "#FFFF33";
  const bg    = confirmed ? "rgba(57,255,20,0.12)"  : "rgba(255,255,51,0.12)";
  const bdr   = confirmed ? "rgba(57,255,20,0.35)"  : "rgba(255,255,51,0.35)";
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, letterSpacing: "1.2px",
      textTransform: "uppercase", color, background: bg,
      border: `1px solid ${bdr}`, borderRadius: 3,
      padding: "2px 6px", display: "inline-flex", alignItems: "center", gap: 4,
      fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif',
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: color, display: "inline-block", flexShrink: 0 }} />
      {confirmed ? "CONFIRMED" : "EXPECTED"}
    </span>
  );
}

/**
 * Circular team logo — exact match to Discord /lineups image rendering.
 * Uses pickLogoBg() + darkShade() contrast algorithm (ported from lineup_card.html)
 * to select the highest-contrast background color for maximum logo readability.
 */
function LogoCircle({ abbrev, size = 48 }: { abbrev: string; size?: number }) {
  const team      = MLB_BY_ABBREV.get(abbrev.toUpperCase());
  const logo      = team?.logoUrl ?? null;
  const primary   = team?.primaryColor   ?? "#003087";
  const secondary = team?.secondaryColor ?? null;
  const tertiary  = (team as any)?.tertiaryColor ?? null;

  // [VERIFY] Log logo resolution for debugging (dev only — gated to prevent production noise)
  if (process.env.NODE_ENV === 'development' && typeof window !== "undefined") {
    if (logo) {
      console.log(`[LogoCircle] ${abbrev} → mlbId=${(team as any)?.mlbId ?? 'N/A'} url=${logo} bg=${teamLogoGradient(primary, secondary, tertiary).slice(0,40)}...`);
    } else {
      console.warn(`[LogoCircle] ${abbrev} → NO LOGO in MLB_BY_ABBREV (key: "${abbrev.toUpperCase()}")`);
    }
  }

  // Use exact same gradient algorithm as Discord /lineups bot
  const gradient = teamLogoGradient(primary, secondary, tertiary);

  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: gradient,
      display: "flex", alignItems: "center", justifyContent: "center",
      overflow: "hidden",
    }}>
      {logo ? (
        <img
          src={logo}
          alt={abbrev}
          style={{ width: size * 0.65, height: size * 0.65, objectFit: "contain" }}
          onError={(e) => {
            console.error(`[LogoCircle] LOAD FAILED for ${abbrev}: ${logo}`);
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <span style={{ fontSize: size * 0.3, fontWeight: 800, color: "#fff", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif' }}>
          {abbrev}
        </span>
      )}
    </div>
  );
}

/** MLB headshot with background removal */
function Headshot({ mlbamId, size = 72 }: { mlbamId: number | null | undefined; size?: number }) {
  const src = mlbPhoto(mlbamId);
  return (
    <div style={{
      width: size, height: size, flexShrink: 0, overflow: "hidden",
      background: "transparent", display: "flex", alignItems: "flex-end", justifyContent: "center",
    }}>
      {src ? (
        <img
          src={src}
          alt="pitcher"
          style={{ width: size, height: size, objectFit: "contain" }}
          onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0"; }}
        />
      ) : (
        <div style={{
          width: size * 0.6, height: size * 0.6, borderRadius: "50%",
          background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)",
        }} />
      )}
    </div>
  );
}

// ─── Pitcher Panel ─────────────────────────────────────────────────────────────

interface PitcherPanelProps {
  prop: StrikeoutPropRow | undefined;
  teamAbbrev: string;
  side: "away" | "home";
  isRight?: boolean;
  pitcherConfirmed?: boolean | null;
}

function PitcherPanel({ prop, teamAbbrev, side, isRight = false, pitcherConfirmed }: PitcherPanelProps) {
  const primary = teamPrimary(teamAbbrev);

  // Parse JSON fields
  const matchupRows: Array<{
    spot: number; name: string; bats: string; kRate: number; adj: number; expK: number;
  }> = useMemo(() => {
    if (!prop?.matchupRows) return [];
    try { return JSON.parse(prop.matchupRows); } catch { return []; }
  }, [prop?.matchupRows]);

  const signals: Record<string, number> = useMemo(() => {
    if (!prop?.signalBreakdown) return {};
    try { return JSON.parse(prop.signalBreakdown); } catch { return {}; }
  }, [prop?.signalBreakdown]);

  // Edge calculations
  const bestEdgePp = prop?.bestEdge ? parseFloat(prop.bestEdge) * 100 : null;
  const verdict = prop?.verdict ?? null;
  const bestSide = prop?.bestSide ?? null;

  const overProb  = prop?.pOver  ? parseFloat(prop.pOver)  : null;
  const underProb = prop?.pUnder ? parseFloat(prop.pUnder) : null;

  const edgeOverPp  = prop?.edgeOver  ? parseFloat(prop.edgeOver)  * 100 : null;
  const edgeUnderPp = prop?.edgeUnder ? parseFloat(prop.edgeUnder) * 100 : null;

  const bookLine = prop?.bookLine ? parseFloat(prop.bookLine) : null;
  const kProj    = prop?.kProj    ? parseFloat(prop.kProj)    : null;

  // Determine which side has the edge (verdict can be "EDGE"|"PASS"; bestSide is "OVER"|"UNDER")
  const playOver  = bestSide === "OVER"  && verdict === "EDGE";
  const playUnder = bestSide === "UNDER" && verdict === "EDGE";

  if (!prop) {
    return (
      <div style={{ flex: 1, padding: "16px 14px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 200 }}>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', letterSpacing: "0.5px" }}>
          No projection
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>

      {/* ── Pitcher header — mirrors lineup card pitcher section ── */}
      <div style={{
        padding: "10px 12px",
        borderBottom: "1px solid #182433",
        display: "flex", alignItems: "center", gap: 10,
        flexDirection: isRight ? "row-reverse" : "row",
      }}>
        <Headshot mlbamId={prop.mlbamId} size={68} />
        <div style={{ flex: 1, minWidth: 0, textAlign: isRight ? "right" : "left" }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "1.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', marginBottom: 3 }}>
            STARTING PITCHER
          </div>
          <div style={{ fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 20, fontWeight: 800, color: "#FFFFFF", lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {prop.pitcherName}
          </div>
          <div style={{ display: "flex", gap: 5, alignItems: "center", marginTop: 5, flexDirection: isRight ? "row-reverse" : "row" }}>
            {prop.pitcherHand && (
              <Pill label={`${prop.pitcherHand}HP`} bg="#101820" color="#FFFFFF" border="#182433" />
            )}
            <StatusPill confirmed={pitcherConfirmed === true} />
          </div>
        </div>
      </div>

      {/* ── K Projection block ── */}
      <div style={{
        padding: "12px 14px",
        borderBottom: "1px solid #182433",
        background: "rgba(255,255,255,0.02)",
      }}>
        {/* K Projection row */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
          <div style={{ fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 42, fontWeight: 800, color: "#ffffff", lineHeight: 1 }}>
            {fmtNum(prop.kProj, 1)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <div style={{ fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 11, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", color: "#a6a6a6" }}>
              TOTAL STRIKEOUTS PROJECTED
            </div>
          </div>
        </div>

        {/* Consensus line row */}
        {bookLine !== null && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <div style={{ fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 11, fontWeight: 600, letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.45)" }}>
              BOOK LINE:
            </div>
            <div style={{ fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 16, fontWeight: 800, color: "#FFFFFF" }}>
              {bookLine.toFixed(1)} Ks
            </div>
            <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
              <span style={{ fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 11, color: "rgba(255,255,255,0.45)" }}>
                o {fmtOdds(prop.bookOverOdds)}
              </span>
              <span style={{ color: "rgba(255,255,255,0.2)" }}>/</span>
              <span style={{ fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 11, color: "rgba(255,255,255,0.45)" }}>
                u {fmtOdds(prop.bookUnderOdds)}
              </span>
            </div>
          </div>
        )}

        {/* Model vs Book delta */}
        {kProj !== null && bookLine !== null && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <div style={{ fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 10, fontWeight: 600, letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.35)" }}>
              MODEL vs LINE
            </div>
            <div style={{
              fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 13, fontWeight: 800,
              color: kProj > bookLine ? "#39FF14" : kProj < bookLine ? "#FF2244" : "rgba(255,255,255,0.5)",
            }}>
              {kProj > bookLine ? "▲" : kProj < bookLine ? "▼" : "="} {Math.abs(kProj - bookLine).toFixed(2)}
            </div>
          </div>
        )}

        {/* Over / Under probability bars */}
        {overProb !== null && underProb !== null && (
          <div style={{ display: "flex", gap: 6 }}>
            {/* OVER */}
            <div style={{
              flex: 1, padding: "8px 10px", borderRadius: 6,
              background: playOver ? `${primary}22` : "rgba(255,255,255,0.04)",
              border: `1px solid ${playOver ? primary + "55" : "rgba(255,255,255,0.08)"}`,
              display: "flex", flexDirection: "column", gap: 2,
            }}>
              <div style={{ fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 9, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", color: playOver ? primary : "rgba(255,255,255,0.4)" }}>
                OVER {bookLine?.toFixed(1) ?? "—"}
              </div>
              <div style={{ fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 20, fontWeight: 800, color: playOver ? primary : "#FFFFFF", lineHeight: 1 }}>
                {fmtPct(prop.pOver)}
              </div>
              <div style={{ fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
                {probToAmerican(overProb)} model
              </div>
              {edgeOverPp !== null && (
                <div style={{ fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 10, fontWeight: 700, color: edgeColor(edgeOverPp) }}>
                  {edgeOverPp > 0 ? "+" : ""}{edgeOverPp.toFixed(1)}pp edge
                </div>
              )}
            </div>
            {/* UNDER */}
            <div style={{
              flex: 1, padding: "8px 10px", borderRadius: 6,
              background: playUnder ? "rgba(0,191,255,0.12)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${playUnder ? "rgba(0,191,255,0.4)" : "rgba(255,255,255,0.08)"}`,
              display: "flex", flexDirection: "column", gap: 2,
            }}>
              <div style={{ fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 9, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", color: playUnder ? "#00BFFF" : "rgba(255,255,255,0.4)" }}>
                UNDER {bookLine?.toFixed(1) ?? "—"}
              </div>
              <div style={{ fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 20, fontWeight: 800, color: playUnder ? "#00BFFF" : "#FFFFFF", lineHeight: 1 }}>
                {fmtPct(prop.pUnder)}
              </div>
              <div style={{ fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
                {probToAmerican(underProb)} model
              </div>
              {edgeUnderPp !== null && (
                <div style={{ fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 10, fontWeight: 700, color: edgeColor(edgeUnderPp) }}>
                  {edgeUnderPp > 0 ? "+" : ""}{edgeUnderPp.toFixed(1)}pp edge
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Verdict badge ── */}
      {verdict && verdict !== "PASS" && bestEdgePp !== null && (
        <div style={{
          padding: "10px 14px",
          borderBottom: "1px solid #182433",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <div style={{
            fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 11, fontWeight: 800,
            letterSpacing: "1.5px", textTransform: "uppercase",
            color: bestSide === "OVER" ? primary : "#00BFFF",
            background: bestSide === "OVER" ? `${primary}18` : "rgba(0,191,255,0.12)",
            border: `1px solid ${bestSide === "OVER" ? primary + "44" : "rgba(0,191,255,0.35)"}`,
            borderRadius: 4, padding: "4px 10px",
          }}>
            ▶ {bestSide} {bestSide === "OVER" ? fmtOdds(prop.bookOverOdds) : fmtOdds(prop.bookUnderOdds)}
          </div>
          <div style={{
            fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 11, fontWeight: 700,
            color: edgeColor(bestEdgePp),
          }}>
            {bestEdgePp > 0 ? "+" : ""}{bestEdgePp.toFixed(1)}pp
          </div>
          {prop.bestMlStr && (
            <div style={{ fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif', fontSize: 10, color: "rgba(255,255,255,0.4)", marginLeft: "auto" }}>
              {prop.bestMlStr}
            </div>
          )}
        </div>
      )}


    </div>
  );
}

// ─── Main Card ─────────────────────────────────────────────────────────────────

export default function MlbPropsCard({ awayTeam, homeTeam, startTime, gameDate, props, lineup }: MlbPropsCardProps) {
  const awayProp = props?.find(p => p.side === "away");
  const homeProp = props?.find(p => p.side === "home");

  const awayPrimary = teamPrimary(awayTeam);
  const homePrimary = teamPrimary(homeTeam);

  const hasData = (awayProp || homeProp) != null;

  return (
    <div style={{
      background: "#090E14",
      borderRadius: 12,
      border: "1px solid #182433",
      overflow: "hidden",
      width: "100%",
      fontFamily: '"Familjen Grotesk", system-ui, -apple-system, sans-serif',
    }}>
      {/* ── Color gradient top bar — identical to lineup card ── */}
      <div style={{
        height: 5,
        background: `linear-gradient(90deg, ${awayPrimary} 48%, ${homePrimary} 52%)`,
      }} />

      {/* ── Matchup header — mirrors lineup card header block ── */}
      <div style={{
        display: "flex", alignItems: "center", padding: "14px 18px 12px",
        borderBottom: "1px solid #182433", gap: 10,
      }}>
        {/* Away team */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
          <LogoCircle abbrev={awayTeam} size={44} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.5px", textTransform: "uppercase", color: "#FFFFFF", lineHeight: 1.1 }}>
              {teamCity(awayTeam)}
            </div>
            <div style={{ fontSize: 11, color: "#ffffff", fontWeight: 700, letterSpacing: "0.5px", marginTop: 1 }}>
              {teamNickname(awayTeam)}
            </div>
            <div style={{ marginTop: 4 }}>
              <Pill label="AWAY" bg={awayPrimary + "22"} color="#FFFFFF" border={awayPrimary + "44"} />
            </div>
          </div>
        </div>

        {/* Center: K PROPS label + time */}
        <div style={{ textAlign: "center", flexShrink: 0 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", color: "rgba(255,255,255,0.45)" }}>
            {gameDate ?? ""}
          </div>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.65)", marginTop: 2 }}>
            K PROPS
          </div>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#FFFFFF", letterSpacing: "1px", marginTop: 2 }}>
            {startTime}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "3px", marginTop: 3 }}>
            @
          </div>
        </div>

        {/* Home team */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, justifyContent: "flex-end" }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.5px", textTransform: "uppercase", color: "#FFFFFF", lineHeight: 1.1 }}>
              {teamCity(homeTeam)}
            </div>
            <div style={{ fontSize: 11, color: "#ffffff", fontWeight: 700, letterSpacing: "0.5px", marginTop: 1 }}>
              {teamNickname(homeTeam)}
            </div>
            <div style={{ marginTop: 4, display: "flex", justifyContent: "flex-end" }}>
              <Pill label="HOME" bg={homePrimary + "22"} color="#FFFFFF" border={homePrimary + "44"} />
            </div>
          </div>
          <LogoCircle abbrev={homeTeam} size={44} />
        </div>
      </div>

      {/* ── Two-column pitcher panels — separated by #182433 divider ── */}
      {hasData ? (
        <div style={{ display: "flex", borderBottom: "1px solid #182433" }}>
          {/* Away pitcher */}
          <div style={{ flex: 1, minWidth: 0, borderRight: "1px solid #182433" }}>
            <PitcherPanel prop={awayProp} teamAbbrev={awayTeam} side="away" isRight={false} pitcherConfirmed={lineup?.awayPitcherConfirmed} />
          </div>
          {/* Home pitcher */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <PitcherPanel prop={homeProp} teamAbbrev={homeTeam} side="home" isRight={true} pitcherConfirmed={lineup?.homePitcherConfirmed} />
          </div>
        </div>
      ) : (
        <div style={{
          padding: "40px 20px", textAlign: "center",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
        }}>
          <div style={{ fontSize: 14, color: "rgba(255,255,255,0.35)", fontWeight: 600, letterSpacing: "0.5px" }}>
            No strikeout projections yet
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", letterSpacing: "0.5px" }}>
            Run the model to generate K props for this game.
          </div>
        </div>
      )}
    </div>
  );
}
