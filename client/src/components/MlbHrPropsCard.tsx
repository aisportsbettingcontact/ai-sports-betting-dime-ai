/**
 * MlbHrPropsCard
 *
 * Displays MLB HR prop projections for a single game.
 *
 * Data source: Consensus (Action Network book_id=15)
 * Model: Poisson P(≥1 HR) using team batting splits + pitcher HR/9 + park factor
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  TEAM GRADIENT BAR + MATCHUP HEADER                     │
 *   ├─────────────────────────────────────────────────────────┤
 *   │  AWAY TEAM COLUMN | HOME TEAM COLUMN                    │
 *   │  Player | Line | Consensus | Model% | Model Odds | Edge │
 *   │  ...                                                    │
 *   └─────────────────────────────────────────────────────────┘
 */
import { useMemo } from "react";
import { MLB_BY_ABBREV } from "@shared/mlbTeams";

// ─── Types ─────────────────────────────────────────────────────────────────────
export interface HrPropRow {
  id: number;
  gameId: number;
  side: string;
  teamAbbrev: string;
  playerName: string;
  mlbamId: number | null;
  bookLine: string | null;
  consensusOverOdds: string | null;
  consensusUnderOdds: string | null;
  anNoVigOverPct: string | null;
  modelPHr: string | null;
  modelOverOdds: string | null;
  edgeOver: string | null;
  evOver: string | null;
  verdict: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MlbHrPropsCardProps {
  awayTeam: string;
  homeTeam: string;
  startTime: string;
  props: HrPropRow[] | null | undefined;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function fmtOdds(val: string | number | null | undefined): string {
  if (val == null) return "—";
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(n)) return "—";
  return n > 0 ? `+${n}` : `${n}`;
}

function fmtPct(val: string | null | undefined): string {
  if (!val) return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function fmtEdge(val: string | null | undefined): string {
  if (!val) return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(1)}%`;
}

function fmtEv(val: string | null | undefined): string {
  if (!val) return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}`;
}

function fmtLine(val: string | null | undefined): string {
  if (!val) return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return val;
  return n > 0 ? `+${n}` : `${n}`;
}

function formatTime(t: string | null | undefined): string {
  if (!t) return "TBD";
  const [h, m] = t.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return t;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

const mlbPhoto = (id: number | null | undefined): string | null => {
  if (!id) return null;
  return `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_180,q_auto:best,e_background_removal,f_png/v1/people/${id}/headshot/67/current`;
};

// ─── Player Row ────────────────────────────────────────────────────────────────
interface PlayerRowProps {
  row: HrPropRow;
}

function PlayerRow({ row }: PlayerRowProps) {
  const isOver = row.verdict === "OVER";
  const edgeNum = row.edgeOver ? parseFloat(row.edgeOver) : null;
  const edgeColor = edgeNum != null
    ? edgeNum >= 0.03 ? "#39FF14"
    : edgeNum <= -0.03 ? "#FF4444"
    : "rgba(255,255,255,0.7)"
    : "rgba(255,255,255,0.7)";

  const photo = mlbPhoto(row.mlbamId);

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "26px 1fr 36px 44px 44px 44px 44px",
      alignItems: "center",
      padding: "4px 8px",
      borderBottom: "1px solid rgba(255,255,255,0.04)",
      gap: 3,
      background: isOver ? "rgba(57,255,20,0.04)" : "transparent",
    }}>
      {/* Headshot */}
      <div style={{ width: 22, height: 22, borderRadius: "50%", overflow: "hidden", background: "rgba(255,255,255,0.08)", flexShrink: 0 }}>
        {photo ? (
          <img src={photo} alt={row.playerName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", background: "rgba(255,255,255,0.1)" }} />
        )}
      </div>

      {/* Player name */}
      <div style={{ minWidth: 0 }}>
        <span style={{
          fontSize: 11,
          fontWeight: isOver ? 800 : 600,
          color: isOver ? "#39FF14" : "rgba(255,255,255,0.85)",
          fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          display: "block",
        }}>
          {row.playerName}
        </span>
      </div>

      {/* Book line */}
      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", textAlign: "center", fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif" }}>
        {fmtLine(row.bookLine)}
      </span>

      {/* Consensus over odds */}
      <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.85)", textAlign: "center", fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif" }}>
        {fmtOdds(row.consensusOverOdds)}
      </span>

      {/* Model P(HR) */}
      <span style={{ fontSize: 11, fontWeight: 700, color: "#39FF14", textAlign: "center", fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif" }}>
        {fmtPct(row.modelPHr)}
      </span>

      {/* Model odds */}
      <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.7)", textAlign: "center", fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif" }}>
        {fmtOdds(row.modelOverOdds)}
      </span>

      {/* Edge */}
      <span style={{ fontSize: 11, fontWeight: 800, color: edgeColor, textAlign: "center", fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif" }}>
        {fmtEdge(row.edgeOver)}
      </span>
    </div>
  );
}

// ─── Team section ──────────────────────────────────────────────────────────────
interface TeamSectionProps {
  teamAbbrev: string;
  rows: HrPropRow[];
  primaryColor: string;
}

function TeamSection({ teamAbbrev, rows, primaryColor }: TeamSectionProps) {
  const teamInfo = MLB_BY_ABBREV.get(teamAbbrev);
  const teamName = teamInfo?.city ?? teamAbbrev;
  const edgeRows = rows.filter(r => r.verdict === "OVER");

  return (
    <div style={{ marginBottom: 4 }}>
      {/* Team header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "4px 8px",
        background: "rgba(255,255,255,0.04)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}>
        <span style={{
          fontSize: 10, fontWeight: 800, letterSpacing: "0.08em",
          color: primaryColor, textTransform: "uppercase",
          fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
        }}>
          {teamName} ({teamAbbrev})
        </span>
        {edgeRows.length > 0 && (
          <span style={{
            fontSize: 9, fontWeight: 700, color: "#39FF14",
            background: "rgba(57,255,20,0.12)", borderRadius: 3,
            padding: "1px 5px", letterSpacing: "0.06em",
          }}>
            {edgeRows.length} EDGE{edgeRows.length > 1 ? "S" : ""}
          </span>
        )}
      </div>

      {/* Column headers */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "26px 1fr 36px 44px 44px 44px 44px",
        padding: "2px 8px",
        gap: 3,
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        {["", "PLAYER", "LINE", "CONS", "MDL%", "MDL$", "EDGE"].map((h, i) => (
          <span key={i} style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", textAlign: i > 1 ? "center" : "left", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {h}
          </span>
        ))}
      </div>

      {/* Player rows */}
      {rows.map(row => (
        <PlayerRow key={row.id} row={row} />
      ))}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function MlbHrPropsCard({ awayTeam, homeTeam, startTime, props }: MlbHrPropsCardProps) {
  const awayInfo = MLB_BY_ABBREV.get(awayTeam);
  const homeInfo = MLB_BY_ABBREV.get(homeTeam);
  const awayColor = awayInfo?.primaryColor ?? "#666";
  const homeColor = homeInfo?.primaryColor ?? "#888";

  const awayRows = useMemo(() => (props ?? []).filter(r => r.side === "away"), [props]);
  const homeRows = useMemo(() => (props ?? []).filter(r => r.side === "home"), [props]);

  const totalEdges = useMemo(() => (props ?? []).filter(r => r.verdict === "OVER").length, [props]);

  if (!props || props.length === 0) {
    return (
      <div style={{
        background: "#090E14",
        border: "1px solid #182433",
        borderRadius: 10,
        marginBottom: 10,
        padding: "16px",
        textAlign: "center",
        fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif",
      }}>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
          HR props not yet available for {awayTeam} @ {homeTeam}
        </span>
      </div>
    );
  }

  return (
    <div style={{
      background: "#090E14",
      border: "1px solid #182433",
      borderRadius: 10,
      marginBottom: 10,
      overflow: "hidden",
      fontFamily: "'Familjen Grotesk', 'Familjen Grotesk', system-ui, -apple-system, sans-serif",
    }}>
      {/* Team gradient bar */}
      <div style={{
        height: 4,
        background: `linear-gradient(to right, ${awayColor}, ${homeColor})`,
      }} />

      {/* Matchup header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "7px 12px 6px",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: "rgba(255,255,255,0.9)", letterSpacing: "0.04em", fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif" }}>
            {awayTeam}
          </span>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>@</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: "rgba(255,255,255,0.9)", letterSpacing: "0.04em", fontFamily: "'Familjen Grotesk', system-ui, -apple-system, sans-serif" }}>
            {homeTeam}
          </span>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginLeft: 4 }}>
            {formatTime(startTime)}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {totalEdges > 0 && (
            <span style={{
              fontSize: 9, fontWeight: 700, color: "#39FF14",
              background: "rgba(57,255,20,0.12)", borderRadius: 3,
              padding: "2px 6px", letterSpacing: "0.06em",
            }}>
              {totalEdges} OVER EDGE{totalEdges > 1 ? "S" : ""}
            </span>
          )}
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", letterSpacing: "0.04em" }}>
            {props.length} PLAYERS
          </span>
        </div>
      </div>

      {/* Away team section */}
      {awayRows.length > 0 && (
        <TeamSection teamAbbrev={awayTeam} rows={awayRows} primaryColor={awayColor} />
      )}

      {/* Home team section */}
      {homeRows.length > 0 && (
        <TeamSection teamAbbrev={homeTeam} rows={homeRows} primaryColor={homeColor} />
      )}

      {/* Source footer */}
      <div style={{ padding: "4px 10px", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", letterSpacing: "0.04em" }}>
          Odds: Consensus (Action Network) · Model: Poisson P(≥1 HR) | Park + Pitcher Adjusted
        </span>
      </div>
    </div>
  );
}
