/**
 * PublishProjections — Owner-only page for entering model projections and publishing games.
 *
 * Looks IDENTICAL to the Dashboard GameCard feed. The MODEL LINE and MODEL O/U
 * pill cells are editable inputs — @prez taps/clicks them and types the value.
 * Edge verdict at the bottom auto-calculates live as values are typed.
 *
 * Access: owner role only — non-owners are immediately redirected to /dashboard.
 * Backend: all procedures use ownerProcedure (server-side owner check enforced).
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Loader2, Send, ChevronLeft, ChevronRight, Eye, EyeOff, Trophy, RefreshCw, Trash2, CheckCheck } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { getNbaTeamByDbSlug } from "@shared/nbaTeams";
import { NHL_BY_DB_SLUG } from "@shared/nhlTeams";
import { BettingSplitsPanel } from "@/components/BettingSplitsPanel";
import { OddsHistoryPanel } from "@/components/OddsHistoryPanel";
import { AdminShell } from "@/pages/admin/AdminShell";

// ─── Helpers (mirrors GameCard exactly) ──────────────────────────────────────

function formatTeamName(slug: string): string {
  return slug
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .replace("Mount St Marys", "Mt. St. Mary's")
    .replace("Nc Wilmington", "UNCW")
    .replace("Uab", "UAB")
    .replace("Utsa", "UTSA")
    .replace("College Of Charleston", "Charleston")
    .replace("Illinois Chicago", "UIC")
    .replace("Northern Iowa", "UNI")
    .replace("Southern Illinois", "SIU")
    .replace("Michigan State", "Michigan St.")
    .replace("Florida Atlantic", "FAU")
    .replace("Saint Peters", "Saint Peter's")
    .replace("Nc State", "NC State")
    .replace("Iupui", "IUPUI")
    .replace("Northern Arizona", "NAU")
    .replace("Iowa State", "Iowa St.")
    .replace("Eastern Washington", "EWU")
    .replace("Weber State", "Weber St.")
    .replace("Portland State", "Portland St.")
    .replace("Idaho State", "Idaho St.")
    .replace("Sacramento State", "Sac State");
}

function formatMilitaryTime(time: string): string {
  const upper = time?.toUpperCase() ?? "";
  if (!time || upper === "TBD" || upper === "TBA" || !time.includes(":")) return "TBD";
  const parts = time.split(":");
  let hours = parseInt(parts[0], 10);
  const minutes = parts[1]?.slice(0, 2) ?? "00";
  if (isNaN(hours)) return "TBD";
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${ampm} ET`;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

function getEdgeColor(diff: number): string {
  if (diff <= 0)  return "#FFFFFF";
  if (diff < 1.5) return "#45E0A8";
  if (diff < 2.0) return "#45E0A8";
  if (diff < 2.5) return "#45E0A8";
  if (diff < 3.0) return "#45E0A8";
  if (diff < 3.5) return "#45E0A8";
  if (diff < 4.0) return "#45E0A8";
  if (diff < 4.5) return "#45E0A8";
  return "#45E0A8";
}
function getEvGrade(diff: number | null): string {
  const d = diff ?? 0;
  if (d <= 0)   return "F";
  if (d < 0.5)  return "D";
  if (d < 1.0)  return "C";
  if (d < 1.5)  return "C+";
  if (d < 2.0)  return "B-";
  if (d < 2.5)  return "B";
  if (d < 3.0)  return "B+";
  if (d < 3.5)  return "A-";
  if (d < 4.0)  return "A";
  if (d < 4.5)  return "A+";
  return "A+";
}


function spreadSign(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function toNum(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === "") return NaN;
  return typeof v === "number" ? v : parseFloat(v as string);
}

function normalizeEdgeLabel(label: string | null | undefined): string {
  if (!label || label.toUpperCase() === "PASS") return "PASS";
  return label.replace(/^([a-z][a-z0-9_]*)(\s+\()/i, (_, slug, rest) => {
    const nba = getNbaTeamByDbSlug(slug);
    if (nba) return nba.name + rest;
    return formatTeamName(slug) + rest;
  });
}

// ─── TeamLogo (identical to GameCard) ────────────────────────────────────────

function TeamLogo({ slug, name, logoUrl }: { slug: string; name: string; logoUrl?: string }) {
  const [error, setError] = useState(false);
  if (!logoUrl || error) {
    return (
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
        style={{ background: "#000000", color: "#FFFFFF" }}
      >
        {name.slice(0, 2).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={logoUrl}
      alt={name}
      className="w-9 h-9 object-contain flex-shrink-0"
      style={{ mixBlendMode: "screen" }}
      onError={() => setError(true)}
    />
  );
}

// ─── EditablePill — looks like the dark pill but is an input ─────────────────

function EditablePill({
  value,
  onChange,
  placeholder,
  prefix,
  inputRef,
  allowNegative = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  prefix?: string;   // "O" or "U" shown before the number
  inputRef?: React.RefObject<HTMLInputElement | null>;
  allowNegative?: boolean;
}) {
  const hasValue = value !== "" && value !== "-" && !isNaN(parseFloat(value));

  // Allow typing negative numbers: permit "-", "-.", "-0", etc. as intermediate states
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    // Strip anything that isn't a digit, dot, or leading minus
    const cleaned = raw.replace(/[^\d.\-]/g, "");
    // Allow at most one minus (only at start) and one dot
    const normalized = cleaned
      .replace(/(?!^)-/g, "")   // remove any minus not at position 0
      .replace(/(\..*)\./g, "$1"); // remove duplicate dots
    onChange(normalized);
  };

  return (
    <div
      className="flex items-center justify-center rounded-lg"
      style={{
        background: "transparent",
        minWidth: prefix ? "64px" : "52px",
        width: "auto",
        maxWidth: allowNegative ? "80px" : "90px",
        padding: "0 8px",
        height: "36px",
        cursor: "text",
      }}
    >
      {prefix && (
        <span
          className="font-bold flex-shrink-0 mr-1"
          style={{
            fontSize: "clamp(13px, 3.5vw, 15px)",
            color: hasValue ? "#FFFFFF" : "#FFFFFF",
            userSelect: "none",
          }}
        >
          {prefix}
        </span>
      )}
      <input
        ref={inputRef}
        type="text"
        inputMode="text"
        value={value}
        onChange={handleChange}
        placeholder={placeholder ?? "—"}
        className="bg-transparent border-none outline-none text-center font-bold w-full"
        style={{
          // 16px minimum prevents iOS Safari from auto-zooming on input focus
          fontSize: "clamp(16px, 3.5vw, 17px)",
          color: hasValue ? "#FFFFFF" : "#FFFFFF",
          caretColor: "#45E0A8",
          minWidth: 0,
        }}
      />
    </div>
  );
}

// ─── EditableTeamRow — identical layout to GameCard TeamRow ──────────────────

function EditableTeamRow({
  slug, name, nickname, consensus, modelSpread,
  logoUrl, onSpreadChange, spreadInputRef,
  goalie, goalieConfirmed, isNHL: isNHLRow,
}: {
  slug: string; name: string; nickname?: string;
  consensus: string; modelSpread: string;
  logoUrl?: string;
  onSpreadChange: (v: string) => void;
  spreadInputRef?: React.RefObject<HTMLInputElement | null>;
  goalie?: string | null;
  goalieConfirmed?: boolean | null;
  isNHL?: boolean;
}) {

  return (
    <div className="flex items-center gap-1.5 py-1.5 min-w-0">
      {/* Logo */}
      <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center">
        <TeamLogo slug={slug} name={name} logoUrl={logoUrl} />
      </div>

      {/* Team name — school on top, nickname on bottom */}
      {/* Width handles longest NBA city names: "Oklahoma City" (13 chars), "Golden State" (12 chars) */}
      <div
        className="flex-shrink-0 flex flex-col justify-center overflow-hidden"
        style={{ width: "clamp(108px, 28vw, 135px)" }}
      >
        <div
          className="font-bold leading-none"
          style={{
            fontSize: "clamp(11px, 2.8vw, 13px)",
            color: "#FFFFFF",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {name}
        </div>
        {nickname && (
          <div
            className="font-medium leading-none mt-0.5"
            style={{
              fontSize: "clamp(9px, 2.2vw, 11px)",
              color: "#FFFFFF",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {nickname}
          </div>
        )}
        {isNHLRow && goalie && (
          <div className="flex flex-col gap-0" style={{ marginTop: "2px" }}>
            {/* Goalie name */}
            <div
              className="font-medium leading-none flex items-center gap-0.5"
              style={{
                fontSize: "clamp(8px, 2vw, 10px)",
                color: "#FFFFFF",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              🥅 {goalie}
            </div>
            {/* RotoWire-style status badge: colored dot + Confirmed/Expected */}
            <div
              className="flex items-center gap-0.5 leading-none"
              style={{ marginTop: "1px" }}
            >
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  backgroundColor: goalieConfirmed ? "#45E0A8" : "#FFFFFF",
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: "clamp(7px, 1.8vw, 9px)",
                  color: goalieConfirmed ? "#45E0A8" : "#FFFFFF",
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                }}
              >
                {goalieConfirmed ? "Confirmed" : "Expected"}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 2 data columns: BOOKS | MODEL LINE */}
      <div className="flex-1 grid min-w-0" style={{ gridTemplateColumns: "1fr 1fr", gap: "4px" }}>

        {/* BOOKS — plain consensus number, same as GameCard */}
        <div className="flex items-center justify-center">
          <span
            className="font-bold leading-none whitespace-nowrap"
            style={{ fontSize: "clamp(13px, 3.5vw, 16px)", color: "#FFFFFF" }}
          >
            {consensus}
          </span>
        </div>

        {/* MODEL LINE — editable pill */}
        <div className="flex items-center justify-center">
          <EditablePill
            value={modelSpread}
            onChange={onSpreadChange}
            placeholder="—"
            inputRef={spreadInputRef}
          />
        </div>

      </div>
    </div>
  );
}

// ─── EdgeVerdictLive — auto-calculates as @prez types ────────────────────────

function EdgeVerdictLive({
  spreadDiff, spreadEdge, totalDiff, totalEdge,
}: {
  spreadDiff: number; spreadEdge: string;
  totalDiff: number; totalEdge: string;
}) {
  const spreadPass = normalizeEdgeLabel(spreadEdge) === "PASS" || spreadDiff <= 0;
  const totalPass  = normalizeEdgeLabel(totalEdge)  === "PASS" || totalDiff  <= 0;

  if (spreadPass && totalPass) {
    return (
      <div
        className="mt-2 pt-2 flex items-center justify-center"
        style={{ borderTop: "1px solid #FFFFFF" }}
      >
        <span
          className="text-xs font-medium tracking-widest uppercase"
          style={{ color: "#FFFFFF" }}
        >
          PASS
        </span>
      </div>
    );
  }

  const spreadColor = getEdgeColor(spreadDiff);
  const totalColor  = getEdgeColor(totalDiff);
  const isSpreadStrong = spreadDiff >= 3;
  const isTotalStrong  = totalDiff  >= 3;

  return (
    <div
      className="mt-2 pt-2 flex items-center"
      style={{ borderTop: "1px solid #FFFFFF" }}
    >
      {!spreadPass && (
        <div className="flex-1 flex flex-col items-center gap-1 py-0.5">
          <span
            className="font-bold leading-none whitespace-nowrap"
            style={{ fontSize: isSpreadStrong ? "13px" : "12px", color: "#FFFFFF" }}
          >
            {isSpreadStrong && <span className="mr-0.5 text-sm" style={{ color: spreadColor }}>▲</span>}
            {normalizeEdgeLabel(spreadEdge)}
          </span>
          <span className="text-sm leading-none" style={{ color: "#FFFFFF", fontWeight: 500 }}>
            EDGE:{" "}
            <span style={{ color: spreadColor, fontWeight: 700 }}>
              {spreadDiff} {spreadDiff === 1 ? "pt" : "pts"}
            </span>
          </span>
        </div>
      )}
      {!spreadPass && !totalPass && (
        <div style={{ width: 1, alignSelf: "stretch", background: "#FFFFFF", margin: "0 8px" }} />
      )}
      {!totalPass && (
        <div className="flex-1 flex flex-col items-center gap-1 py-0.5">
          <span
            className="font-bold leading-none whitespace-nowrap"
            style={{ fontSize: isTotalStrong ? "13px" : "12px", color: "#FFFFFF" }}
          >
            {isTotalStrong && <span className="mr-0.5 text-sm" style={{ color: totalColor }}>▲</span>}
            {normalizeEdgeLabel(totalEdge)}
          </span>
          <span className="text-sm leading-none" style={{ color: "#FFFFFF", fontWeight: 500 }}>
            EDGE:{" "}
            <span style={{ color: totalColor, fontWeight: 700 }}>
              {totalDiff} {totalDiff === 1 ? "pt" : "pts"}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

type GameRow = {
  id: number;
  awayTeam: string;
  homeTeam: string;
  awayBookSpread: string | null;
  homeBookSpread: string | null;
  bookTotal: string | null;
  awayModelSpread: string | null;
  homeModelSpread: string | null;
  modelTotal: string | null;
  spreadEdge: string | null;
  spreadDiff: string | null;
  totalEdge: string | null;
  totalDiff: string | null;
  publishedToFeed: boolean;
  publishedModel: boolean;
  startTimeEst: string;
  gameDate: string;
  gameType: "regular_season" | "conference_tournament";
  conference: string | null;
  sport: string | null;
  // Betting splits
  spreadAwayBetsPct: number | null;
  spreadAwayMoneyPct: number | null;
  totalOverBetsPct: number | null;
  totalOverMoneyPct: number | null;
  mlAwayBetsPct: number | null;
  mlAwayMoneyPct: number | null;
  awayML: string | null;
  homeML: string | null;
  modelAwayML: string | null;
  modelHomeML: string | null;
  // NHL-specific
  awayGoalie: string | null;
  homeGoalie: string | null;
  awayGoalieConfirmed: boolean | null;
  homeGoalieConfirmed: boolean | null;
  awaySpreadOdds: string | null;   // puck line odds for NHL
  homeSpreadOdds: string | null;
  overOdds: string | null;          // O/U odds for NHL
  underOdds: string | null;
  modelAwayPLCoverPct: string | null;
  modelHomePLCoverPct: string | null;
  modelAwayScore: string | null;   // projected goals for NHL
  modelHomeScore: string | null;
  modelAwayWinPct: string | null;
  modelHomeWinPct: string | null;
  // Model fair-value puck line and O/U odds (from model engine)
  modelAwayPuckLine: string | null;
  modelHomePuckLine: string | null;
  modelAwayPLOdds: string | null;
  modelHomePLOdds: string | null;
  modelOverOdds: string | null;
  modelUnderOdds: string | null;
};

// ─── EditableGameCard ─────────────────────────────────────────────────────────

function EditableGameCard({ game, onSaved, showDeleteButton = false }: { game: GameRow; onSaved: () => void; showDeleteButton?: boolean }) {
  // Active market toggle — mirrors the SPREAD/TOTAL/MONEYLINE toggle for OddsHistoryPanel
  const [activeMarket, setActiveMarket] = useState<'spread' | 'total' | 'ml'>('spread');

  const [awaySpread, setAwaySpread] = useState(game.awayModelSpread ?? "");
  const [homeSpread, setHomeSpread] = useState(game.homeModelSpread ?? "");
  const [modelTotal, setModelTotal] = useState(game.modelTotal ?? "");
  const [awayML, setAwayML] = useState(game.modelAwayML ?? "");
  const [homeML, setHomeML] = useState(game.modelHomeML ?? "");
  // NHL-specific odds inputs
  const [awayPLOdds, setAwayPLOdds] = useState(game.awaySpreadOdds ?? "");
  const [homePLOdds, setHomePLOdds] = useState(game.homeSpreadOdds ?? "");
  const [overOddsInput, setOverOddsInput] = useState(game.overOdds ?? "");
  const [underOddsInput, setUnderOddsInput] = useState(game.underOdds ?? "");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // Track whether this game has ever been submitted in this session
  // (or was already submitted before — i.e. has model data from the server)
  const [hasBeenSubmitted, setHasBeenSubmitted] = useState(
    !!(game.awayModelSpread || game.modelTotal)
  );
  const awaySpreadRef = useRef<HTMLInputElement | null>(null);

  const utils = trpc.useUtils();
  const updateMutation = trpc.games.updateProjections.useMutation();
  const publishMutation = trpc.games.setPublished.useMutation();
  const approveModelMutation = trpc.games.setModelPublished.useMutation();
  const deleteMutation = trpc.games.deleteGame.useMutation({
    onSuccess: () => {
      toast.success("Game permanently deleted from database");
      utils.games.listStaging.invalidate();
      onSaved();
    },
    onError: () => toast.error("Delete failed — please try again"),
  });

  // Sync from server when game data refreshes (don't overwrite if user is typing)
  useEffect(() => {
    if (!dirty) {
      setAwaySpread(game.awayModelSpread ?? "");
      setHomeSpread(game.homeModelSpread ?? "");
      setModelTotal(game.modelTotal ?? "");
      setAwayML(game.modelAwayML ?? "");
      setHomeML(game.modelHomeML ?? "");
      setAwayPLOdds(game.awaySpreadOdds ?? "");
      setHomePLOdds(game.homeSpreadOdds ?? "");
      setOverOddsInput(game.overOdds ?? "");
      setUnderOddsInput(game.underOdds ?? "");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.awayModelSpread, game.homeModelSpread, game.modelTotal, game.modelAwayML, game.modelHomeML, game.awaySpreadOdds, game.homeSpreadOdds, game.overOdds, game.underOdds]);

  // Away spread change → auto-compute home spread as inverse
  const handleAwaySpreadChange = (val: string) => {
    setAwaySpread(val);
    const n = parseFloat(val);
    if (!isNaN(n)) setHomeSpread(n === 0 ? "0" : n > 0 ? String(-n) : `+${-n}`);
    setDirty(true);
  };

  // Home spread change → auto-compute away spread as inverse
  const handleHomeSpreadChange = (val: string) => {
    setHomeSpread(val);
    const n = parseFloat(val);
    if (!isNaN(n)) setAwaySpread(n === 0 ? "0" : n > 0 ? String(-n) : `+${-n}`);
    setDirty(true);
  };

  const handleTotalChange = (val: string) => {
    setModelTotal(val);
    setDirty(true);
  };

  // ML inverse: straight sign flip, always show + on positive
  const mlInverse = (val: string): string => {
    const n = parseFloat(val);
    if (isNaN(n) || val === "" || val === "-") return "";
    const inv = -n;
    return inv > 0 ? `+${inv}` : String(inv);
  };

  const handleAwayMLChange = (val: string) => {
    setAwayML(val);
    const inv = mlInverse(val);
    if (inv !== "") setHomeML(inv);
    setDirty(true);
  };

  const handleHomeMLChange = (val: string) => {
    setHomeML(val);
    const inv = mlInverse(val);
    if (inv !== "") setAwayML(inv);
    setDirty(true);
  };

  // NHL odds change handlers
  const handleAwayPLOddsChange = (val: string) => { setAwayPLOdds(val); setDirty(true); };
  const handleHomePLOddsChange = (val: string) => { setHomePLOdds(val); setDirty(true); };
  const handleOverOddsChange   = (val: string) => { setOverOddsInput(val); setDirty(true); };
  const handleUnderOddsChange  = (val: string) => { setUnderOddsInput(val); setDirty(true); };

  // Reset all model projections and auto-save
  const handleReset = async () => {
    setAwaySpread("");
    setHomeSpread("");
    setModelTotal("");
    setAwayML("");
    setHomeML("");
    setAwayPLOdds("");
    setHomePLOdds("");
    setOverOddsInput("");
    setUnderOddsInput("");
    setDirty(false);
    setSaving(true);
    try {
      await updateMutation.mutateAsync({
        id: game.id,
        awayModelSpread: null,
        homeModelSpread: null,
        modelTotal: null,
        modelAwayML: null,
        modelHomeML: null,
        spreadEdge: null,
        spreadDiff: null,
        totalEdge: null,
        totalDiff: null,
        awaySpreadOdds: null,
        homeSpreadOdds: null,
        overOdds: null,
        underOdds: null,
      });
      setHasBeenSubmitted(false);
      toast.success("Projections reset");
      onSaved();
    } catch {
      toast.error("Reset failed");
    } finally {
      setSaving(false);
    }
  };

  // Compute edge labels live from current input values
  function computeEdges() {
    const awayN    = parseFloat(awaySpread);
    const homeN    = parseFloat(homeSpread);
    const totalN   = parseFloat(modelTotal);
    const awayBook = toNum(game.awayBookSpread);
    const homeBook = toNum(game.homeBookSpread);
    const bookTot  = toNum(game.bookTotal);

    let spreadEdge: string | null = null;
    let spreadDiff: string | null = null;
    let totalEdge: string | null  = null;
    let totalDiffVal: string | null = null;

    if (!isNaN(awayN) && !isNaN(homeN) && !isNaN(awayBook) && !isNaN(homeBook)) {
      // Positive diff = model is more favorable for that team vs book
      const awayDiff = awayBook - awayN;
      const homeDiff = homeBook - homeN;
      const useAway  = Math.abs(awayDiff) >= Math.abs(homeDiff);
      const bestDiff = useAway ? awayDiff : homeDiff;
      const edgeTeam   = useAway ? game.awayTeam : game.homeTeam;
      const edgeSpread = useAway ? awayN : homeN;

      if (Math.abs(bestDiff) > 0) {
        spreadEdge = `${edgeTeam} (${edgeSpread > 0 ? "+" : ""}${edgeSpread})`;
        spreadDiff = String(Math.round(Math.abs(bestDiff) * 10) / 10);
      } else {
        spreadEdge = "PASS";
        spreadDiff = "0";
      }
    }

    if (!isNaN(totalN) && !isNaN(bookTot)) {
      const diff = Math.round((totalN - bookTot) * 10) / 10;
      if (diff > 0) {
        totalEdge    = `OVER ${totalN}`;
        totalDiffVal = String(Math.abs(diff));
      } else if (diff < 0) {
        totalEdge    = `UNDER ${totalN}`;
        totalDiffVal = String(Math.abs(diff));
      } else {
        totalEdge    = "PASS";
        totalDiffVal = "0";
      }
    }

    return { spreadEdge, spreadDiff, totalEdge, totalDiff: totalDiffVal };
  }

  const handleSave = async () => {
    setSaving(true);
    const isFirstSubmit = !hasBeenSubmitted;
    try {
      const edges = computeEdges();
      await updateMutation.mutateAsync({
        id: game.id,
        awayModelSpread: awaySpread || null,
        homeModelSpread: homeSpread || null,
        modelTotal: modelTotal || null,
        modelAwayML: awayML || null,
        modelHomeML: homeML || null,
        ...edges,
        // NHL-specific odds (only send if NHL game)
        ...(game.sport === 'NHL' ? {
          awaySpreadOdds: awayPLOdds || null,
          homeSpreadOdds: homePLOdds || null,
          overOdds: overOddsInput || null,
          underOdds: underOddsInput || null,
        } : {}),
      });
      setDirty(false);
      setHasBeenSubmitted(true);
      toast.success(isFirstSubmit ? "Projections submitted ✓" : "Projections saved");
      onSaved();
    } catch {
      toast.error(isFirstSubmit ? "Failed to submit projections" : "Failed to save projections");
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePublish = async () => {
    // Auto-save unsaved changes before toggling publish
    if (dirty) await handleSave();
    try {
      await publishMutation.mutateAsync({ id: game.id, published: !game.publishedToFeed });
      toast.success(game.publishedToFeed ? "Removed from feed" : "Published to feed ✓");
      onSaved();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update publish status";
      toast.error(msg.includes("no live VSiN odds") ? "No VSiN odds yet — cannot publish" : "Failed to update publish status");
    }
  };

  const handleToggleModelApproval = async () => {
    try {
      await approveModelMutation.mutateAsync({ id: game.id, published: !game.publishedModel });
      toast.success(game.publishedModel ? "Model projections retracted" : "Model projections approved ✓");
      onSaved();
    } catch {
      toast.error("Failed to update model approval status");
    }
  };

  // ── Derived display values ──────────────────────────────────────────────────
  const awayBookSpread = toNum(game.awayBookSpread);
  const homeBookSpread = toNum(game.homeBookSpread);
  const bookTotal      = toNum(game.bookTotal);

  // BOOKS column: show spread for the favorite, total for the underdog (same as GameCard)
  const awayConsensus = awayBookSpread < 0 ? spreadSign(awayBookSpread) : isNaN(bookTotal) ? "—" : `${bookTotal}`;
  const homeConsensus = homeBookSpread < 0 ? spreadSign(homeBookSpread) : isNaN(bookTotal) ? "—" : `${bookTotal}`;

  // Live edge preview
  const edges = computeEdges();
  const previewSpreadDiff = parseFloat(edges.spreadDiff ?? "0") || 0;
  const previewTotalDiff  = parseFloat(edges.totalDiff  ?? "0") || 0;
  const maxDiff = Math.max(previewSpreadDiff, previewTotalDiff);

  // Border color: green if published, edge-colored if has model data, dim if empty
  const borderColor = game.publishedToFeed
    ? "#45E0A8"
    : maxDiff > 0
      ? getEdgeColor(maxDiff)
      : "#FFFFFF";

  const isNHL = game.sport === 'NHL';
  const awayNba  = getNbaTeamByDbSlug(game.awayTeam);
  const homeNba  = getNbaTeamByDbSlug(game.homeTeam);
  const awayNhl  = !awayNba ? NHL_BY_DB_SLUG.get(game.awayTeam) ?? null : null;
  const homeNhl  = !homeNba ? NHL_BY_DB_SLUG.get(game.homeTeam) ?? null : null;
  // Show city on line 1, nickname on line 2
  const awayName     = awayNba?.city ?? awayNhl?.city ?? formatTeamName(game.awayTeam);
  const homeName     = homeNba?.city ?? homeNhl?.city ?? formatTeamName(game.homeTeam);
  const awayNickname = awayNba?.nickname ?? awayNhl?.nickname ?? undefined;
  const homeNickname = homeNba?.nickname ?? homeNhl?.nickname ?? undefined;
  const awayLogoUrl  = awayNba?.logoUrl ?? awayNhl?.logoUrl ?? undefined;
  const homeLogoUrl  = homeNba?.logoUrl ?? homeNhl?.logoUrl ?? undefined;
  const time      = formatMilitaryTime(game.startTimeEst);
  // Midnight ET games (startTimeEst = "00:00") are stored under the actual play date (e.g. Mar 5)
  // but the ET clock has rolled over to the next day (e.g. Fri, Mar 6 · 12:00 AM ET).
  const displayDate = (() => {
    if (game.startTimeEst === "00:00") {
      const d = new Date(game.gameDate + "T00:00:00");
      d.setDate(d.getDate() + 1);
      return d.toISOString().slice(0, 10);
    }
    return game.gameDate;
  })();
  const dateLabel = formatDate(displayDate);

  const hasAnyModel = awaySpread !== "" || modelTotal !== "" || awayML !== "" || homeML !== "";
  const hasOdds = !isNaN(awayBookSpread) || !isNaN(bookTotal);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full rounded-xl relative"
      style={{
        background: "#000000",
        border: "1px solid #FFFFFF",
        borderLeft: `3px solid ${borderColor}`,
        overflow: "hidden",
      }}
    >
      {/* Top-right button group: Delete (conditional) + Publish toggle */}
      <div className="absolute top-1.5 right-2 z-10 flex items-center gap-1.5">

        {/* DELETE button — only shown when showDeleteButton=true (owner-only, MISSING ODDS / NOT MODELED views) */}
        {showDeleteButton && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button type="button" disabled={deleteMutation.isPending}
                className="flex items-center gap-1 px-2 py-0.5 rounded-md text-sm font-semibold transition-all"
                style={{ background: "transparent", color: "#FFFFFF", border: "1px solid #FFFFFF" }}
                title="Permanently delete this game from the database"
              >
                {deleteMutation.isPending
                  ? <Loader2 size={9} className="animate-spin" />
                  : <Trash2 size={9} />
                }
                Delete
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent
              style={{
                background: "#000000",
                border: "2px solid #FFFFFF",
                boxShadow: "none",
              }}
            >
              <AlertDialogHeader>
                <AlertDialogTitle
                  className="flex items-center gap-2 text-base font-black tracking-wide"
                  style={{ color: "#FFFFFF" }}
                >
                  <Trash2 size={18} />
                  PERMANENTLY DELETE GAME
                </AlertDialogTitle>
                <AlertDialogDescription className="text-sm leading-relaxed" style={{ color: "#FFFFFF" }}>
                  <span className="block font-bold text-white mb-1">
                    {game.awayTeam.split("_").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}
                    {" @ "}
                    {game.homeTeam.split("_").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}
                  </span>
                  This will <strong style={{ color: "#FFFFFF" }}>permanently remove this game</strong> from the database.
                  {" "}It will no longer appear on the Publish Projections page or the public feed.
                  <br /><br />
                  <strong style={{ color: "#FFFFFF" }}>This action is irreversible.</strong>{" "}
                  There is no undo. The game cannot be recovered once deleted.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel
                  className="text-xs font-semibold"
                  style={{ background: "transparent", border: "1px solid #FFFFFF", color: "#FFFFFF" }}
                >
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteMutation.mutate({ id: game.id })}
                  className="text-xs font-black tracking-wide"
                  style={{ background: "transparent", color: "#FFFFFF", border: "1px solid #FFFFFF" }}
                >
                  Yes, Delete Permanently
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}



        {/* Publish toggle */}
        <button type="button" onClick={handleTogglePublish}
          disabled={publishMutation.isPending || saving || (!game.publishedToFeed && !hasOdds)}
          className="flex items-center gap-1 px-2 py-0.5 rounded-md text-sm font-semibold transition-all"
          style={game.publishedToFeed
            ? { background: "transparent", color: "#45E0A8", border: "1px solid #45E0A8" }
            : !hasOdds
              ? { background: "transparent", color: "#FFFFFF", border: "1px solid #FFFFFF", cursor: "not-allowed" }
              : { background: "transparent", color: "#FFFFFF", border: "1px solid #FFFFFF" }
          }
          title={game.publishedToFeed ? "Remove from feed" : !hasOdds ? "No VSiN odds yet — cannot publish" : "Publish to feed"}
        >
          {publishMutation.isPending || saving
            ? <Loader2 size={9} className="animate-spin" />
            : game.publishedToFeed
              ? <><Eye size={9} /> Live</>
              : !hasOdds
                ? <><EyeOff size={9} /> No Odds</>
                : <><EyeOff size={9} /> Off</>
          }
        </button>
      </div>

      {/* Header — identical to GameCard */}
      <div
        className="flex items-center justify-center gap-1.5 px-4 py-2"
        style={{ background: "#000000", borderBottom: "1px solid #FFFFFF" }}
      >
        <span className="text-xs font-semibold" style={{ color: "#FFFFFF" }}>
          {dateLabel}
        </span>
        <span className="text-sm" style={{ color: "#FFFFFF" }}>·</span>
        <span className="text-xs font-medium" style={{ color: "#FFFFFF" }}>
          {time}
        </span>
        {/* VSiN odds status indicator */}
        <span
          title={hasOdds ? "VSiN odds loaded" : "No VSiN odds yet"}
          className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ background: hasOdds ? "#45E0A8" : "#FFFFFF", marginLeft: 2 }}
        />
        {game.gameType === "conference_tournament" && game.conference && (
          <>
            <span className="text-sm" style={{ color: "#FFFFFF" }}>·</span>
            <span className="text-sm font-medium flex items-center gap-0.5" style={{ color: "#FFFFFF" }}>
              <Trophy size={9} />
              {game.conference}
            </span>
          </>
        )}
      </div>

      {/* ── Card body: responsive layout ── */}
      {/* MOBILE (<lg): stacked vertical sections — SPREAD / TOTAL / ML / Splits */}
      {/* DESKTOP (lg+): two-column side-by-side — inputs left | splits right */}
      <div style={{ borderTop: "1px solid #FFFFFF" }}>

        {/* ── DESKTOP layout (lg+): side-by-side ── */}
        <div className="hidden lg:flex flex-row min-h-0">

          {/* LEFT: model inputs */}
          <div className="flex-1 min-w-0 px-3 pt-2 pb-3 flex flex-col justify-between" style={{ borderRight: "1px solid #FFFFFF" }}>
            {/* Column labels */}
            <div>
              <div
                className="flex items-center gap-1.5 pb-1.5"
                style={{ borderBottom: "1px solid #FFFFFF" }}
              >
                <div className="w-8 flex-shrink-0" />
                <div className="flex-shrink-0" style={{ width: "clamp(90px, 22vw, 120px)" }} />
                <div className="flex-1 grid text-center" style={{ gridTemplateColumns: "1fr 1fr", gap: "4px" }}>
                  <span className="text-sm uppercase tracking-widest" style={{ color: "#FFFFFF" }}>Books</span>
                  <span className="text-sm font-bold uppercase tracking-widest" style={{ color: "#45E0A8" }}>Model Line</span>
                </div>
                <div className="flex-shrink-0 text-center" style={{ width: "clamp(48px, 12vw, 60px)" }}>
                  <span className="text-sm uppercase tracking-widest" style={{ color: "#FFFFFF" }}>{isNHL ? 'PL Odds' : 'Book ML'}</span>
                </div>
                <div className="flex-shrink-0 text-center" style={{ width: "clamp(48px, 12vw, 72px)" }}>
                  <span className="text-sm font-bold uppercase tracking-widest" style={{ color: "#45E0A8" }}>O/U</span>
                </div>
                <div className="flex-shrink-0 text-center" style={{ width: "clamp(52px, 13vw, 76px)" }}>
                  <span className="text-sm font-bold uppercase tracking-widest" style={{ color: isNHL ? "#45E0A8" : "#45E0A8" }}>{isNHL ? 'O/U Odds' : 'Model ML'}</span>
                </div>
              </div>
              {/* Team rows */}
              <div className="flex gap-1.5 min-w-0 mt-1">
                <div className="flex-1 min-w-0 flex flex-col">
                  <EditableTeamRow
                    slug={game.awayTeam}
                    name={awayName}
                    nickname={awayNickname}
                    consensus={isNHL ? (game.awayBookSpread ? '+1.5' : '—') : awayConsensus}
                    modelSpread={awaySpread}
                    logoUrl={awayLogoUrl}
                    onSpreadChange={handleAwaySpreadChange}
                    spreadInputRef={awaySpreadRef}
                    goalie={game.awayGoalie}
                    goalieConfirmed={game.awayGoalieConfirmed}
                    isNHL={isNHL}
                  />
                  <div className="my-0.5" style={{ height: 1, background: "#FFFFFF" }} />
                  <EditableTeamRow
                    slug={game.homeTeam}
                    name={homeName}
                    nickname={homeNickname}
                    consensus={isNHL ? (game.homeBookSpread ? '-1.5' : '—') : homeConsensus}
                    modelSpread={homeSpread}
                    logoUrl={homeLogoUrl}
                    onSpreadChange={handleHomeSpreadChange}
                    goalie={game.homeGoalie}
                    goalieConfirmed={game.homeGoalieConfirmed}
                    isNHL={isNHL}
                  />
                </div>
                {/* Book ML column — for NHL shows editable puck line odds instead of static ML */}
                <div className="flex-shrink-0 flex flex-col justify-around" style={{ width: "clamp(48px, 12vw, 60px)", gap: 4 }}>
                  <div className="flex flex-col items-center justify-center" style={{ flex: 1 }}>
                    {isNHL ? (
                      <EditablePill value={awayPLOdds} onChange={handleAwayPLOddsChange} placeholder="Odds" allowNegative />
                    ) : (
                      <span className="font-bold tabular-nums" style={{ fontSize: "clamp(12px, 3vw, 15px)", color: "#FFFFFF" }}>
                        {game.awayML ?? "—"}
                      </span>
                    )}
                  </div>
                  <div style={{ height: 1, background: "#FFFFFF" }} />
                  <div className="flex flex-col items-center justify-center" style={{ flex: 1 }}>
                    {isNHL ? (
                      <EditablePill value={homePLOdds} onChange={handleHomePLOddsChange} placeholder="Odds" allowNegative />
                    ) : (
                      <span className="font-bold tabular-nums" style={{ fontSize: "clamp(12px, 3vw, 15px)", color: "#FFFFFF" }}>
                        {game.homeML ?? "—"}
                      </span>
                    )}
                  </div>
                </div>
                {/* O/U pill */}
                <div className="flex-shrink-0 flex items-center justify-center" style={{ width: "clamp(48px, 12vw, 72px)" }}>
                  <EditablePill value={modelTotal} onChange={handleTotalChange} placeholder="—" />
                </div>
                {/* Model ML pills — for NHL shows Over/Under odds instead */}
                <div className="flex-shrink-0 flex flex-col justify-around" style={{ width: "clamp(60px, 14vw, 80px)", gap: 4 }}>
                  {isNHL ? (
                    <>
                      <div className="flex items-center justify-center" style={{ flex: 1 }}>
                        <EditablePill value={overOddsInput} onChange={handleOverOddsChange} placeholder="O Odds" allowNegative />
                      </div>
                      <div style={{ height: 1, background: "#FFFFFF" }} />
                      <div className="flex items-center justify-center" style={{ flex: 1 }}>
                        <EditablePill value={underOddsInput} onChange={handleUnderOddsChange} placeholder="U Odds" allowNegative />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-center" style={{ flex: 1 }}>
                        <EditablePill value={awayML} onChange={handleAwayMLChange} placeholder="—" allowNegative />
                      </div>
                      <div style={{ height: 1, background: "#FFFFFF" }} />
                      <div className="flex items-center justify-center" style={{ flex: 1 }}>
                        <EditablePill value={homeML} onChange={handleHomeMLChange} placeholder="—" allowNegative />
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
            {/* Save + Reset + edge verdict */}
            <div>
              <div className="mt-2 flex items-center justify-between gap-2">
                {hasAnyModel ? (
                  <button type="button" onClick={handleReset}
                    disabled={saving}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md text-sm font-semibold transition-all"
                    style={{ background: "transparent", color: "#FFFFFF", border: "1px solid #FFFFFF" }}
                    title="Clear all model projections and save"
                  >
                    {saving ? <Loader2 size={9} className="animate-spin" /> : null}
                    Reset
                  </button>
                ) : (
                  <div />
                )}
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={saving || !dirty}
                  className="h-7 px-4 text-xs gap-1.5 font-bold transition-all"
                  style={dirty
                    ? { background: "#45E0A8", color: "#000000" }
                    : { background: "transparent", color: "#45E0A8", border: "1px solid #45E0A8" }
                  }
                >
                  {saving && <Loader2 size={10} className="animate-spin" />}
                  {saving
                    ? (hasBeenSubmitted ? "Saving…" : "Submitting…")
                    : dirty
                      ? (hasBeenSubmitted ? "Save" : "Submit")
                      : (hasBeenSubmitted ? "Saved" : "Submit")
                  }
                </Button>
              </div>
              {hasAnyModel && (
                <EdgeVerdictLive
                  spreadDiff={previewSpreadDiff}
                  spreadEdge={edges.spreadEdge ?? "PASS"}
                  totalDiff={previewTotalDiff}
                  totalEdge={edges.totalEdge ?? "PASS"}
                />
              )}
            </div>
          </div>

          {/* RIGHT: betting splits */}
          <div className="flex-1 min-w-0 overflow-hidden">
            <BettingSplitsPanel gameId={game.id} game={game} awayLabel={awayName} homeLabel={homeName} />
          </div>
        </div>

        {/* ── MOBILE layout (<lg): stacked vertical sections ── */}
        <div className="lg:hidden flex flex-col">

          {/* ── SPREAD SECTION ── */}
          <div className="px-3 pt-3 pb-2" style={{ borderBottom: "1px solid #FFFFFF" }}>
            {/* Section header */}
            <div className="flex items-center justify-between mb-2">
              <span
                className="text-sm font-black uppercase tracking-[0.18em]"
                style={{ color: "#45E0A8" }}
              >
                {isNHL ? 'PUCK LINE' : 'SPREAD'}
              </span>
              <div className="flex items-center gap-3">
                <span className="text-sm uppercase tracking-widest" style={{ color: "#FFFFFF" }}>BOOK</span>
                <span className="text-sm font-bold uppercase tracking-widest" style={{ color: "#45E0A8", minWidth: 64, textAlign: 'center' }}>MODEL</span>
                {isNHL && <span className="text-sm font-bold uppercase tracking-widest" style={{ color: "#45E0A8", minWidth: 64, textAlign: 'center' }}>PL ODDS</span>}
              </div>
            </div>

            {/* Away team spread row */}
            <div className="flex items-center gap-2 py-1.5">
              {/* Logo */}
              <div className="w-9 h-9 flex-shrink-0 flex items-center justify-center">
                <TeamLogo slug={game.awayTeam} name={awayName} logoUrl={awayLogoUrl} />
              </div>
              {/* Team name */}
              <div className="flex-1 min-w-0 flex flex-col justify-center">
                <span
                  className="font-bold leading-tight"
                  style={{ fontSize: "clamp(13px, 3.5vw, 15px)", color: "#FFFFFF" }}
                >
                  {awayName}
                </span>
                {awayNickname && (
                  <span
                    className="font-medium leading-tight"
                    style={{ fontSize: "clamp(11px, 2.8vw, 13px)", color: "#FFFFFF" }}
                  >
                    {awayNickname}
                  </span>
                )}
                {isNHL && game.awayGoalie && (
                  <div className="flex flex-col gap-0" style={{ marginTop: "1px" }}>
                    <span
                      className="font-medium leading-tight"
                      style={{ fontSize: "clamp(9px, 2.2vw, 11px)", color: "#FFFFFF" }}
                    >
                      🥅 {game.awayGoalie}
                    </span>
                    <div className="flex items-center gap-0.5">
                      <div style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: game.awayGoalieConfirmed ? "#45E0A8" : "#FFFFFF", flexShrink: 0 }} />
                      <span style={{ fontSize: "clamp(7px, 1.8vw, 9px)", color: game.awayGoalieConfirmed ? "#45E0A8" : "#FFFFFF", fontWeight: 500, whiteSpace: "nowrap" }}>
                        {game.awayGoalieConfirmed ? "Confirmed" : "Expected"}
                      </span>
                    </div>
                  </div>
                )}
              </div>
              {/* Book value: for NHL show puck line + odds */}
              <div className="flex-shrink-0 flex flex-col items-center justify-center" style={{ minWidth: 52 }}>
                {isNHL ? (
                  <>
                    <span className="font-bold tabular-nums" style={{ fontSize: "clamp(13px, 3.5vw, 15px)", color: "#FFFFFF", lineHeight: 1.1 }}>
                      {game.awayBookSpread ? `+1.5` : '—'}
                    </span>
                    {game.awaySpreadOdds && (
                      <span className="tabular-nums" style={{ fontSize: "clamp(10px, 2.5vw, 12px)", color: "#FFFFFF", lineHeight: 1.1 }}>
                        ({game.awaySpreadOdds})
                      </span>
                    )}
                  </>
                ) : (
                  <span
                    className="font-bold tabular-nums"
                    style={{ fontSize: "clamp(15px, 4vw, 18px)", color: "#FFFFFF" }}
                  >
                    {awayConsensus}
                  </span>
                )}
              </div>
              {/* Model input */}
              <div className="flex-shrink-0 flex items-center justify-center" style={{ minWidth: 64 }}>
                <EditablePill
                  value={awaySpread}
                  onChange={handleAwaySpreadChange}
                  placeholder="—"
                  inputRef={awaySpreadRef}
                />
              </div>
              {/* NHL PL odds input */}
              {isNHL && (
                <div className="flex-shrink-0 flex items-center justify-center" style={{ minWidth: 64 }}>
                  <EditablePill
                    value={awayPLOdds}
                    onChange={handleAwayPLOddsChange}
                    placeholder="Odds"
                    allowNegative
                  />
                </div>
              )}
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: "#FFFFFF", margin: "0 0" }} />

            {/* Home team spread row */}
            <div className="flex items-center gap-2 py-1.5">
              <div className="w-9 h-9 flex-shrink-0 flex items-center justify-center">
                <TeamLogo slug={game.homeTeam} name={homeName} logoUrl={homeLogoUrl} />
              </div>
              <div className="flex-1 min-w-0 flex flex-col justify-center">
                <span
                  className="font-bold leading-tight"
                  style={{ fontSize: "clamp(13px, 3.5vw, 15px)", color: "#FFFFFF" }}
                >
                  {homeName}
                </span>
                {homeNickname && (
                  <span
                    className="font-medium leading-tight"
                    style={{ fontSize: "clamp(11px, 2.8vw, 13px)", color: "#FFFFFF" }}
                  >
                    {homeNickname}
                  </span>
                )}
                {isNHL && game.homeGoalie && (
                  <div className="flex flex-col gap-0" style={{ marginTop: "1px" }}>
                    <span
                      className="font-medium leading-tight"
                      style={{ fontSize: "clamp(9px, 2.2vw, 11px)", color: "#FFFFFF" }}
                    >
                      🥅 {game.homeGoalie}
                    </span>
                    <div className="flex items-center gap-0.5">
                      <div style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: game.homeGoalieConfirmed ? "#45E0A8" : "#FFFFFF", flexShrink: 0 }} />
                      <span style={{ fontSize: "clamp(7px, 1.8vw, 9px)", color: game.homeGoalieConfirmed ? "#45E0A8" : "#FFFFFF", fontWeight: 500, whiteSpace: "nowrap" }}>
                        {game.homeGoalieConfirmed ? "Confirmed" : "Expected"}
                      </span>
                    </div>
                  </div>
                )}
              </div>
              {/* Book value: for NHL show puck line + odds */}
              <div className="flex-shrink-0 flex flex-col items-center justify-center" style={{ minWidth: 52 }}>
                {isNHL ? (
                  <>
                    <span className="font-bold tabular-nums" style={{ fontSize: "clamp(13px, 3.5vw, 15px)", color: "#FFFFFF", lineHeight: 1.1 }}>
                      {game.homeBookSpread ? `-1.5` : '—'}
                    </span>
                    {game.homeSpreadOdds && (
                      <span className="tabular-nums" style={{ fontSize: "clamp(10px, 2.5vw, 12px)", color: "#FFFFFF", lineHeight: 1.1 }}>
                        ({game.homeSpreadOdds})
                      </span>
                    )}
                  </>
                ) : (
                  <span
                    className="font-bold tabular-nums"
                    style={{ fontSize: "clamp(15px, 4vw, 18px)", color: "#FFFFFF" }}
                  >
                    {homeConsensus}
                  </span>
                )}
              </div>
              <div className="flex-shrink-0 flex items-center justify-center" style={{ minWidth: 64 }}>
                <EditablePill
                  value={homeSpread}
                  onChange={handleHomeSpreadChange}
                  placeholder="—"
                />
              </div>
              {/* NHL PL odds input */}
              {isNHL && (
                <div className="flex-shrink-0 flex items-center justify-center" style={{ minWidth: 64 }}>
                  <EditablePill
                    value={homePLOdds}
                    onChange={handleHomePLOddsChange}
                    placeholder="Odds"
                    allowNegative
                  />
                </div>
              )}
            </div>
          </div>

          {/* ── TOTAL SECTION ── */}
          <div className="px-3 pt-2.5 pb-2.5" style={{ borderBottom: "1px solid #FFFFFF" }}>
            {/* Section header */}
            <div className="flex items-center justify-between mb-2">
              <span
                className="text-sm font-black uppercase tracking-[0.18em]"
                style={{ color: "#45E0A8" }}
              >
                TOTAL
              </span>
              <div className="flex items-center gap-3">
                <span className="text-sm uppercase tracking-widest" style={{ color: "#FFFFFF" }}>BOOK O/U</span>
                <span className="text-sm font-bold uppercase tracking-widest" style={{ color: "#45E0A8", minWidth: 64, textAlign: 'center' }}>MODEL O/U</span>
                {isNHL && <span className="text-sm font-bold uppercase tracking-widest" style={{ color: "#45E0A8", minWidth: 64, textAlign: 'center' }}>O ODDS</span>}
                {isNHL && <span className="text-sm font-bold uppercase tracking-widest" style={{ color: "#45E0A8", minWidth: 64, textAlign: 'center' }}>U ODDS</span>}
              </div>
            </div>
            {/* Single row: OVER / UNDER label + book total + model input */}
            <div className="flex items-center gap-2 py-1">
              <div className="flex-1 min-w-0">
                <span
                  className="font-semibold"
                  style={{ fontSize: "clamp(12px, 3vw, 14px)", color: "#FFFFFF" }}
                >
                  OVER / UNDER
                </span>
              </div>
              <div className="flex-shrink-0 flex items-center justify-center" style={{ minWidth: 44 }}>
                <span
                  className="font-bold tabular-nums"
                  style={{ fontSize: "clamp(15px, 4vw, 18px)", color: "#FFFFFF" }}
                >
                  {isNaN(bookTotal) ? "—" : String(bookTotal)}
                </span>
              </div>
              <div className="flex-shrink-0 flex items-center justify-center" style={{ minWidth: 64 }}>
                <EditablePill value={modelTotal} onChange={handleTotalChange} placeholder="—" />
              </div>
              {/* NHL Over/Under odds inputs */}
              {isNHL && (
                <div className="flex-shrink-0 flex items-center justify-center" style={{ minWidth: 64 }}>
                  <EditablePill value={overOddsInput} onChange={handleOverOddsChange} placeholder="O Odds" allowNegative />
                </div>
              )}
              {isNHL && (
                <div className="flex-shrink-0 flex items-center justify-center" style={{ minWidth: 64 }}>
                  <EditablePill value={underOddsInput} onChange={handleUnderOddsChange} placeholder="U Odds" allowNegative />
                </div>
              )}
            </div>
          </div>

          {/* ── MONEYLINE SECTION ── */}
          <div className="px-3 pt-2.5 pb-2.5" style={{ borderBottom: "1px solid #FFFFFF" }}>
            {/* Section header */}
            <div className="flex items-center justify-between mb-2">
              <span
                className="text-sm font-black uppercase tracking-[0.18em]"
                style={{ color: "#45E0A8" }}
              >
                MONEYLINE
              </span>
              <div className="flex items-center gap-3">
                <span className="text-sm uppercase tracking-widest" style={{ color: "#FFFFFF" }}>BOOK ML</span>
                <span className="text-sm font-bold uppercase tracking-widest" style={{ color: "#45E0A8", minWidth: 64, textAlign: 'center' }}>MODEL ML</span>
              </div>
            </div>

            {/* Away ML row */}
            <div className="flex items-center gap-2 py-1.5">
              <div className="w-9 h-9 flex-shrink-0 flex items-center justify-center">
                <TeamLogo slug={game.awayTeam} name={awayName} logoUrl={awayLogoUrl} />
              </div>
              <div className="flex-1 min-w-0 flex flex-col justify-center">
                <span
                  className="font-bold leading-tight"
                  style={{ fontSize: "clamp(13px, 3.5vw, 15px)", color: "#FFFFFF" }}
                >
                  {awayName}
                </span>
                {awayNickname && (
                  <span
                    className="font-medium leading-tight"
                    style={{ fontSize: "clamp(11px, 2.8vw, 13px)", color: "#FFFFFF" }}
                  >
                    {awayNickname}
                  </span>
                )}
              </div>
              {/* Book ML */}
              <div className="flex-shrink-0 flex items-center justify-center" style={{ minWidth: 44 }}>
                <span
                  className="font-bold tabular-nums"
                  style={{ fontSize: "clamp(15px, 4vw, 18px)", color: "#FFFFFF" }}
                >
                  {game.awayML ?? "—"}
                </span>
              </div>
              {/* Model ML input */}
              <div className="flex-shrink-0 flex items-center justify-center" style={{ minWidth: 64 }}>
                <EditablePill value={awayML} onChange={handleAwayMLChange} placeholder="—" allowNegative />
              </div>
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: "#FFFFFF" }} />

            {/* Home ML row */}
            <div className="flex items-center gap-2 py-1.5">
              <div className="w-9 h-9 flex-shrink-0 flex items-center justify-center">
                <TeamLogo slug={game.homeTeam} name={homeName} logoUrl={homeLogoUrl} />
              </div>
              <div className="flex-1 min-w-0 flex flex-col justify-center">
                <span
                  className="font-bold leading-tight"
                  style={{ fontSize: "clamp(13px, 3.5vw, 15px)", color: "#FFFFFF" }}
                >
                  {homeName}
                </span>
                {homeNickname && (
                  <span
                    className="font-medium leading-tight"
                    style={{ fontSize: "clamp(11px, 2.8vw, 13px)", color: "#FFFFFF" }}
                  >
                    {homeNickname}
                  </span>
                )}
              </div>
              <div className="flex-shrink-0 flex items-center justify-center" style={{ minWidth: 44 }}>
                <span
                  className="font-bold tabular-nums"
                  style={{ fontSize: "clamp(15px, 4vw, 18px)", color: "#FFFFFF" }}
                >
                  {game.homeML ?? "—"}
                </span>
              </div>
              <div className="flex-shrink-0 flex items-center justify-center" style={{ minWidth: 64 }}>
                <EditablePill value={homeML} onChange={handleHomeMLChange} placeholder="—" allowNegative />
              </div>
            </div>
          </div>

          {/* ── BETTING SPLITS (mobile) ── */}
          <div style={{ borderBottom: "1px solid #FFFFFF" }}>
            <BettingSplitsPanel gameId={game.id} game={game} awayLabel={awayName} homeLabel={homeName} />
          </div>

          {/* ── SAVE / RESET / EDGE VERDICT (mobile) ── */}
          <div className="px-3 pt-2 pb-3">
            <div className="flex items-center justify-between gap-2">
              {hasAnyModel ? (
                <button type="button" onClick={handleReset}
                  disabled={saving}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md text-sm font-semibold transition-all"
                  style={{ background: "transparent", color: "#FFFFFF", border: "1px solid #FFFFFF" }}
                  title="Clear all model projections and save"
                >
                  {saving ? <Loader2 size={9} className="animate-spin" /> : null}
                  Reset
                </button>
              ) : (
                <div />
              )}
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving || !dirty}
                className="h-8 px-5 text-xs gap-1.5 font-bold transition-all"
                style={dirty
                  ? { background: "#45E0A8", color: "#000000" }
                  : { background: "transparent", color: "#45E0A8", border: "1px solid #45E0A8" }
                }
              >
                {saving && <Loader2 size={10} className="animate-spin" />}
                {saving
                  ? (hasBeenSubmitted ? "Saving…" : "Submitting…")
                  : dirty
                    ? (hasBeenSubmitted ? "Save" : "Submit")
                    : (hasBeenSubmitted ? "Saved" : "Submit")
                }
              </Button>
            </div>
            {hasAnyModel && (
              <EdgeVerdictLive
                spreadDiff={previewSpreadDiff}
                spreadEdge={edges.spreadEdge ?? "PASS"}
                totalDiff={previewTotalDiff}
                totalEdge={edges.totalEdge ?? "PASS"}
              />
            )}
          </div>

        </div>{/* end MOBILE layout */}

      </div>

      {/* ── NHL MODEL PROJECTIONS: read-only panel showing model's own puck line, odds, and total ── */}
      {isNHL && (game.modelAwayPuckLine || game.modelOverOdds || game.modelAwayScore) && (
        <div
          className="px-3 pt-2.5 pb-3"
          style={{ borderTop: "1px solid #FFFFFF", background: "transparent" }}
        >
          {/* Section header */}
          <div className="flex items-center gap-2 mb-2">
            <span
              className="text-sm font-black uppercase tracking-[0.18em]"
              style={{ color: "#45E0A8" }}
            >
              ⚙ NHL MODEL PROJECTIONS
            </span>
            <span className="text-xs uppercase tracking-widest" style={{ color: "#45E0A8" }}>
              (auto-generated · read-only)
            </span>
          </div>

          {/* Puck line row */}
          {game.modelAwayPuckLine && (
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-sm uppercase tracking-widest flex-shrink-0" style={{ color: "#FFFFFF", minWidth: 72 }}>PUCK LINE</span>
              <div className="flex items-center gap-3 flex-1 flex-wrap">
                <span className="text-sm font-bold tabular-nums" style={{ color: "#FFFFFF" }}>
                  {awayName}: <span style={{ color: "#45E0A8" }}>{game.modelAwayPuckLine}</span>
                  {game.modelAwayPLOdds && (
                    <span className="font-semibold" style={{ color: "#45E0A8" }}> ({game.modelAwayPLOdds})</span>
                  )}
                  {game.modelAwayPLCoverPct && (
                    <span className="text-sm ml-1" style={{ color: "#FFFFFF" }}>{parseFloat(game.modelAwayPLCoverPct).toFixed(1)}% cover</span>
                  )}
                </span>
                <span className="text-sm" style={{ color: "#FFFFFF" }}>·</span>
                <span className="text-sm font-bold tabular-nums" style={{ color: "#FFFFFF" }}>
                  {homeName}: <span style={{ color: "#45E0A8" }}>{game.modelHomePuckLine}</span>
                  {game.modelHomePLOdds && (
                    <span className="font-semibold" style={{ color: "#45E0A8" }}> ({game.modelHomePLOdds})</span>
                  )}
                  {game.modelHomePLCoverPct && (
                    <span className="text-sm ml-1" style={{ color: "#FFFFFF" }}>{parseFloat(game.modelHomePLCoverPct).toFixed(1)}% cover</span>
                  )}
                </span>
              </div>
            </div>
          )}

          {/* Total row */}
          {game.modelOverOdds && (
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-sm uppercase tracking-widest flex-shrink-0" style={{ color: "#FFFFFF", minWidth: 72 }}>TOTAL</span>
              <span className="text-sm font-bold tabular-nums" style={{ color: "#FFFFFF" }}>
                {game.modelTotal ? (
                  <>
                    <span style={{ color: "#45E0A8" }}>{game.modelTotal}</span>
                    {" "}
                    <span style={{ color: "#45E0A8" }}>O({game.modelOverOdds})</span>
                    {" / "}
                    <span style={{ color: "#45E0A8" }}>U({game.modelUnderOdds})</span>
                  </>
                ) : "—"}
              </span>
            </div>
          )}

          {/* Projected goals + win probability row */}
          {(game.modelAwayScore || game.modelAwayWinPct) && (
            <div className="flex items-center gap-3 flex-wrap">
              {game.modelAwayScore && (
                <div className="flex items-center gap-1.5">
                  <span className="text-sm uppercase tracking-widest" style={{ color: "#FFFFFF" }}>PROJ GOALS</span>
                  <span className="text-sm font-bold tabular-nums" style={{ color: "#FFFFFF" }}>
                    {awayName} {parseFloat(game.modelAwayScore).toFixed(2)} — {homeName} {parseFloat(game.modelHomeScore ?? "0").toFixed(2)}
                  </span>
                </div>
              )}
              {game.modelAwayWinPct && (
                <div className="flex items-center gap-1.5">
                  <span className="text-sm uppercase tracking-widest" style={{ color: "#FFFFFF" }}>WIN%</span>
                  <span className="text-sm font-bold tabular-nums" style={{ color: "#FFFFFF" }}>
                    {awayName} {parseFloat(game.modelAwayWinPct).toFixed(1)}% / {homeName} {parseFloat(game.modelHomeWinPct ?? "0").toFixed(1)}%
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── ODDS HISTORY: collapsible snapshot table (owner-only) ── */}
      <OddsHistoryPanel
        gameId={game.id}
        awayTeam={game.awayTeam}
        homeTeam={game.homeTeam}
        activeMarket={activeMarket}
      />

    </motion.div>
  );
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

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

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PublishProjections() {
  const [, setLocation] = useLocation();
  const { appUser, isOwner, loading: authLoading } = useAppAuth();
  const [filter, setFilter] = useState<"all" | "regular_season" | "conference_tournament">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "upcoming" | "live" | "final" | "missing_odds" | "modeled" | "not_modeled">("all");
  const [selectedSport, setSelectedSport] = useState<"NBA" | "NHL" | "MLB" | "WC2026">("MLB");
  const [gameDate, setGameDate] = useState(() => todayPst());
  const [isRefreshing, setIsRefreshing] = useState(false);
  // WC2026-specific state
  const [wcRound, setWcRound] = useState<"r32" | "quarterfinals" | "semifinals" | "third_place" | "finals">("r32");

  // Reset status filter when sport changes to NBA (no status tracking yet)
  useEffect(() => {
    if (selectedSport === "NBA") setStatusFilter("all");
  }, [selectedSport]);

  // Reset to "all" when switching dates so stale filter doesn't hide games
  useEffect(() => {
    setStatusFilter("all");
  }, [gameDate]);

  // ── Strict owner-only guard ─────────────────────────────────────────────────
  useEffect(() => {
    if (!authLoading && (!appUser || !isOwner)) {
      setLocation("/feed/model/mlb");
    }
  }, [authLoading, appUser, isOwner, setLocation]);

  const utils = trpc.useUtils();

  const {
    data: games,
    isLoading,
    refetch,
  } = trpc.games.listStaging.useQuery(
    { gameDate, sport: selectedSport === "WC2026" ? "MLB" : selectedSport },
    { enabled: !!appUser && isOwner && selectedSport !== "WC2026", refetchOnWindowFocus: false }
  );

  // ── WC2026 Match Odds query ─────────────────────────────────────────────────
  const {
    data: wcMatchOddsData,
    isLoading: wcIsLoading,
    refetch: wcRefetch,
  } = trpc.wc2026.listMatchOdds.useQuery(
    { round: wcRound },
    {
      enabled: !!appUser && isOwner && selectedSport === "WC2026",
      refetchOnWindowFocus: false,
    }
  );
  const wcRows = wcMatchOddsData?.rows ?? [];

  // ── WC2026 updateMatchOdds mutation ─────────────────────────────────────────
  const wcUpdateMatchOddsMutation = trpc.wc2026.updateMatchOdds.useMutation({
    onMutate: (vars) => {
      console.log(
        `[PublishProjections][WC2026][updateMatchOdds] ► START | matchId=${vars.matchId}` +
        ` fields=${JSON.stringify(Object.keys(vars).filter(k => k !== 'matchId'))}`
      );
    },
    onSuccess: (data) => {
      console.log(
        `[PublishProjections][WC2026][updateMatchOdds] ✅ COMPLETE | matchId=${data.matchId}` +
        ` updated=${data.updated} elapsed=${data.elapsedMs}ms`
      );
      toast.success(`WC2026 odds saved — ${data.updated} row updated`);
      wcRefetch();
    },
    onError: (err, vars) => {
      console.error(
        `[PublishProjections][WC2026][updateMatchOdds] ❌ FAILED | matchId=${vars.matchId} error:`, err
      );
      toast.error(`WC2026 save failed: ${err.message}`);
    },
  });

  const publishAllMutation = trpc.games.publishAll.useMutation({
    onMutate: (vars) => {
      console.log(
        `[PublishProjections][PublishAll] ► Publishing all ${vars.sport} games — ` +
        `date: ${vars.gameDate} | scope: ${vars.sport} | timestamp: ${new Date().toISOString()}`
      );
    },
    onSuccess: (_data, vars) => {
      console.log(
        `[PublishProjections][PublishAll] ✅ Complete — all ${vars.sport} games published to feed | ` +
        `date: ${vars.gameDate}`
      );
      toast.success(`✅ All ${vars.sport} games published to feed!`);
      refetch();
    },
    onError: (err, vars) => {
      console.error(
        `[PublishProjections][PublishAll] ❌ Failed — sport: ${vars.sport} | date: ${vars.gameDate} | error:`, err
      );
      toast.error(`Failed to publish ${vars.sport} games`);
    },
  });
  const bulkApproveModelsMutation = trpc.games.bulkApproveModels.useMutation({
    onMutate: (vars) => {
      console.log(
        `[PublishProjections][BulkApprove] ► Approving all pending ${vars.sport} model projections | ` +
        `date: ${vars.gameDate}`
      );
    },
    onSuccess: (data, vars) => {
      console.log(
        `[PublishProjections][BulkApprove] ✅ Complete — approved: ${data.approved} | ` +
        `sport: ${vars.sport} | date: ${vars.gameDate}`
      );
      if (data.approved === 0) {
        toast.info("No pending model projections to approve — all are already live or missing model data.");
      } else {
        toast.success(`Approved ${data.approved} model projection${data.approved === 1 ? '' : 's'} ✔`);
      }
      refetch();
    },
    onError: (e, vars) => {
      console.error(
        `[PublishProjections][BulkApprove] ❌ Failed — sport: ${vars.sport} | error:`, e
      );
      toast.error(`Bulk approve failed: ${e.message}`);
    },
  });
  // Count games with model data that are not yet approved (pending approval)
  const pendingApprovalCount = (games ?? []).filter(
    (g) => !!(g.awayModelSpread && g.modelTotal) && !g.publishedModel
  ).length;

  const triggerRefreshMutation = trpc.games.triggerRefresh.useMutation({
    onMutate: () => {
      setIsRefreshing(true);
      console.log(
        `[PublishProjections][RefreshNow] ► Triggered manual refresh — scope: ${selectedSport} | ` +
        `date: ${gameDate} | timestamp: ${new Date().toISOString()}`
      );
    },
    onSuccess: (result) => {
      setIsRefreshing(false);
      const scope = selectedSport;
      const nbaUpdated   = result.nbaUpdated ?? 0;
      const nhlUpdated   = result.nhlUpdated ?? 0;
      const totalUpdated = nbaUpdated + nhlUpdated;
      console.log(
        `[PublishProjections][RefreshNow] ✅ Complete — scope: ${scope} | ` +
        `NBA: ${nbaUpdated} updated | NHL: ${nhlUpdated} updated | ` +
        `total: ${totalUpdated} | refreshedAt: ${result.refreshedAt}`
      );
      const oddsMsg = totalUpdated > 0
        ? `${totalUpdated} ${scope} odds updated`
        : `${scope} odds refreshed (no changes)`;
      toast.success(`✅ ${scope} refresh complete — ${oddsMsg}, scores updated`);
      // Invalidate staging queries so the game list re-fetches with fresh data
      utils.games.listStaging.invalidate();
      utils.games.lastRefresh.invalidate();
      refetch();
    },
    onError: (err) => {
      setIsRefreshing(false);
      console.error(
        `[PublishProjections][RefreshNow] ❌ Failed — scope: ${selectedSport} | error:`, err
      );
      toast.error(`${selectedSport} refresh failed`);
    },
  });

  const triggerNbaModelSyncMutation = trpc.games.triggerNbaModelSync.useMutation({
    onMutate: () => {
      console.log(`[PublishProjections][NbaModelSync] ► Triggered NBA model sync | date: ${gameDate}`);
    },
    onSuccess: (result) => {
      utils.games.lastNbaModelSync.invalidate();
      utils.games.listStaging.invalidate();
      refetch();
      console.log(`[PublishProjections][NbaModelSync] ✅ Complete — ${result.synced} games synced`);
      toast.success(`NBA model synced — ${result.synced} games updated`);
    },
    onError: (err) => {
      console.error(`[PublishProjections][NbaModelSync] ❌ Failed:`, err);
      toast.error("NBA model sync failed");
    },
  });

  // ── NHL Goalie Watcher ──────────────────────────────────────────────────────
  const { data: lastGoalieCheck, refetch: refetchGoalieCheck } = trpc.nhlModel.getLastGoalieCheck.useQuery(undefined, {
    refetchInterval: selectedSport === "NHL" ? 30_000 : false,
    refetchOnWindowFocus: selectedSport === "NHL",
    enabled: !!appUser && isOwner,
  });

  const checkGoaliesMutation = trpc.nhlModel.checkGoalies.useMutation({
    onMutate: () => {
      console.log(`[PublishProjections][GoalieCheck] ► Triggered manual goalie check`);
    },
    onSuccess: (result) => {
      refetchGoalieCheck();
      utils.games.listStaging.invalidate();
      refetch();
      const changeCount = result.changes?.length ?? 0;
      if (changeCount > 0) {
        toast.success(`Goalie check complete — ${changeCount} change${changeCount === 1 ? '' : 's'} detected, model re-run`);
      } else {
        toast.success(`Goalie check complete — no changes detected`);
      }
      console.log(`[PublishProjections][GoalieCheck] ✅ Complete — changes: ${changeCount} modelRerun: ${result.modelRerun}`);
    },
    onError: (err) => {
      console.error(`[PublishProjections][GoalieCheck] ❌ Failed:`, err);
      toast.error("Goalie check failed");
    },
  });

  const handleRefreshNow = () => {
    console.log(
      `[PublishProjections][RefreshNow] User clicked Refresh Now — ` +
      `activeSport: ${selectedSport} | date: ${gameDate}`
    );
    // Pass the active sport so the server only refreshes that sport's data
    if (selectedSport !== "MLB") {
      triggerRefreshMutation.mutate({ sport: selectedSport as "NBA" | "NHL" });
    }
    // NBA also triggers model sync (NBA-specific model pipeline)
    if (selectedSport === "NBA") {
      console.log(`[PublishProjections][RefreshNow] Also triggering NBA model sync…`);
      triggerNbaModelSyncMutation.mutate();
    }
    // NHL also triggers goalie watcher check
    if (selectedSport === "NHL") {
      console.log(`[PublishProjections][RefreshNow] Also triggering NHL goalie check…`);
      checkGoaliesMutation.mutate();
    }
  };

  // ── Auto-refresh status (server-driven, every 30 min) ──────────────────────
  const { data: lastRefresh } = trpc.games.lastRefresh.useQuery(undefined, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  // NBA model sync timestamp — polls every 30s to stay fresh
  const { data: lastNbaModelSync } = trpc.games.lastNbaModelSync.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    enabled: !!appUser && isOwner,
  });

  // Re-fetch game list whenever the server completes a new refresh
  const lastRefreshKey = lastRefresh?.refreshedAt ?? null;
  const prevRefreshKey = useRef<string | null>(null);
  useEffect(() => {
    if (lastRefreshKey && lastRefreshKey !== prevRefreshKey.current) {
      prevRefreshKey.current = lastRefreshKey;
      refetch();
    }
  }, [lastRefreshKey, refetch]);

  const handleRefetch = useCallback(() => { refetch(); }, [refetch]);

  // Count live games for the LIVE badge
  const liveCount = (games ?? []).filter((g) => (g as GameRow & { gameStatus?: string }).gameStatus === 'live').length;

  const filtered = (games ?? []).filter((g) => {
    const typeOk = filter === "all" ? true : g.gameType === filter;
    const gameStatus = (g as GameRow & { gameStatus?: string }).gameStatus;
    let statusOk = true;
    if (statusFilter === "all") statusOk = true;
    else if (statusFilter === "missing_odds") statusOk = g.awayBookSpread === null || g.bookTotal === null;
    else if (statusFilter === "modeled") statusOk = !!(g.awayModelSpread && g.modelTotal);
    else if (statusFilter === "not_modeled") statusOk = !g.awayModelSpread || !g.modelTotal;
    else statusOk = gameStatus === statusFilter;
    return typeOk && statusOk;
  });

  // Counts for new filter badges
  const missingOddsGames = (games ?? []).filter((g) => g.awayBookSpread === null || g.bookTotal === null).length;
  const modeledGames     = (games ?? []).filter((g) => !!(g.awayModelSpread && g.modelTotal)).length;
  const notModeledGames  = (games ?? []).filter((g) => !g.awayModelSpread || !g.modelTotal).length;

  // Stats scoped to the current league+date (games is already filtered by listStaging with {gameDate, sport})
  const publishedCount   = (games ?? []).filter((g) => g.publishedToFeed).length;
  const totalCount       = games?.length ?? 0;
  // "Modeled" = has both away spread AND total entered
  const withModelCount   = (games ?? []).filter((g) => g.awayModelSpread && g.modelTotal).length;
  // "All Odds" = has both spread AND total from VSiN/books
  const withOddsCount    = (games ?? []).filter((g) => g.awayBookSpread !== null && g.bookTotal !== null).length;
  const missingOddsCount = totalCount - withOddsCount;

  // Show loading spinner while auth resolves
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#000000" }}>
        <Loader2 className="animate-spin" style={{ color: "#45E0A8" }} />
      </div>
    );
  }

  // Render nothing while redirect fires
  if (!isOwner) return null;

  return (
    <AdminShell active="publish">
    <div className="w-full" style={{ background: "var(--background)" }}>

      {/* Sticky header — mirrors Dashboard header style */}
      <header className="sticky top-14 z-40 bg-black backdrop-blur-sm border-b border-white">
        {/* Top row: publish all — back button and "AI SPORTS BETTING |
            PUBLISH PROJECTIONS" brand text removed (now owned by
            AdminShell's back-to-app affordance + wordmark/tab nav) */}
        <div className="relative flex items-center px-4 py-2 max-w-5xl mx-auto">

          {/* Right: Approve All Models + Publish All */}
          <div className="flex-1" />
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Approve All Models — only shown when there are pending model approvals */}
            {pendingApprovalCount > 0 && (
              <Button
                size="sm"
                onClick={() => bulkApproveModelsMutation.mutate({ gameDate, sport: selectedSport as "MLB" | "NBA" | "NHL" })}
                disabled={bulkApproveModelsMutation.isPending}
                className="gap-1.5 text-xs h-8 font-bold border"
                style={{
                  background: "transparent",
                  color: "#45E0A8",
                  borderColor: "#45E0A8",
                }}
                title={`Approve all ${pendingApprovalCount} pending model projection${pendingApprovalCount === 1 ? '' : 's'}`}
              >
                {bulkApproveModelsMutation.isPending
                  ? <Loader2 size={12} className="animate-spin" />
                  : <CheckCheck size={12} />
                }
                Approve All Models
                <span
                  className="ml-0.5 px-1 py-0 rounded text-sm font-bold"
                  style={{ background: "transparent", color: "#45E0A8" }}
                >
                  {pendingApprovalCount}
                </span>
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => publishAllMutation.mutate({ gameDate, sport: selectedSport as "MLB" | "NBA" | "NHL" })}
              disabled={publishAllMutation.isPending || totalCount === 0}
              className="gap-1.5 text-xs h-8 font-bold"
              style={{ background: "#45E0A8", color: "#000000" }}
            >
              {publishAllMutation.isPending
                ? <Loader2 size={12} className="animate-spin" />
                : <Send size={12} />
              }
              Publish All
            </Button>
          </div>
        </div>

        {/* Date navigation row */}
        <div className="px-4 pb-1.5 max-w-5xl mx-auto flex items-center gap-2">
          {/* Prev day */}
          <button type="button" onClick={() => setGameDate(d => addDays(d, -1))}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors flex-shrink-0"
          >
            <ChevronLeft size={14} style={{ color: "#FFFFFF" }} />
          </button>

          {/* Date display — centered */}
          <div className="flex-1 flex items-center justify-center gap-2">
            <span className="text-xs font-bold text-white tracking-wide">
              {formatDateNav(gameDate)}
            </span>
            {gameDate === todayPst() && (
              <span
                className="text-sm font-semibold px-1.5 py-0.5 rounded"
                style={{ background: "transparent", color: "#45E0A8" }}
              >
                TODAY
              </span>
            )}
          </div>

          {/* Next day */}
          <button type="button" onClick={() => setGameDate(d => addDays(d, 1))}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors flex-shrink-0"
          >
            <ChevronRight size={14} style={{ color: "#FFFFFF" }} />
          </button>

          {/* Refresh Now button — sport-aware */}
          <button type="button" onClick={handleRefreshNow}
            disabled={isRefreshing || triggerRefreshMutation.isPending || triggerNbaModelSyncMutation.isPending}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-semibold transition-all flex-shrink-0"
            style={isRefreshing || triggerRefreshMutation.isPending || triggerNbaModelSyncMutation.isPending
              ? { background: "transparent", color: "#45E0A8", border: "1px solid #45E0A8" }
              : { background: "transparent", color: "#45E0A8", border: "1px solid #45E0A8" }
            }
            title={selectedSport === "NBA"
              ? "Refresh VSiN NBA odds, scores, and NBA model data"
              : selectedSport === "NHL"
              ? "Refresh NHL odds, scores, and check for goalie changes"
              : "Refresh odds and scores"}
          >
            <RefreshCw
              size={11}
              className={isRefreshing || triggerRefreshMutation.isPending || triggerNbaModelSyncMutation.isPending ? "animate-spin" : ""}
            />
            {isRefreshing || triggerRefreshMutation.isPending || triggerNbaModelSyncMutation.isPending ? "Refreshing…" : "Refresh Now"}
          </button>
        </div>

        {/* Sport filter toggle — MLB primary (leftmost) */}
        <div className="px-4 pb-1 max-w-5xl mx-auto flex items-center gap-2">

          {/* MLB button — primary sport, leftmost */}
          <button type="button" onClick={() => setSelectedSport("MLB")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all"
            style={selectedSport === "MLB"
              ? { background: "transparent", color: "#45E0A8", border: "1px solid #45E0A8" }
              : { background: "#000000", color: "#FFFFFF", border: "1px solid #FFFFFF" }
            }
          >
            <img
              src="https://www.mlbstatic.com/team-logos/league-on-dark/1.svg"
              alt="MLB"
              width={16}
              height={16}
              style={{ opacity: selectedSport === "MLB" ? 1 : 0.5 }}
            />
            MLB
          </button>
          {/* NHL button */}
          <button type="button" onClick={() => setSelectedSport("NHL")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all"
            style={selectedSport === "NHL"
              ? { background: "transparent", color: "#45E0A8", border: "1px solid #45E0A8" }
              : { background: "#000000", color: "#FFFFFF", border: "1px solid #FFFFFF" }
            }
          >
            <img
              src="https://assets.nhle.com/logos/nhl/svg/NHL_dark.svg"
              alt="NHL"
              width={16}
              height={16}
              style={{ opacity: selectedSport === "NHL" ? 1 : 0.5 }}
            />
            NHL
          </button>
          {/* NBA button */}
          <button type="button" onClick={() => setSelectedSport("NBA")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all"
            style={selectedSport === "NBA"
              ? { background: "transparent", color: "#45E0A8", border: "1px solid #45E0A8" }
              : { background: "#000000", color: "#FFFFFF", border: "1px solid #FFFFFF" }
            }
          >
            <img
              src="https://cdn.nba.com/logos/leagues/logo-nba.svg"
              alt="NBA"
              width={16}
              height={16}
              style={{ opacity: selectedSport === "NBA" ? 1 : 0.5 }}
            />
            NBA
          </button>
          {/* WC2026 button */}
          <button type="button" onClick={() => setSelectedSport("WC2026")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all"
            style={selectedSport === "WC2026"
              ? { background: "transparent", color: "#45E0A8", border: "1px solid #45E0A8" }
              : { background: "#000000", color: "#FFFFFF", border: "1px solid #FFFFFF" }
            }
          >
            <span style={{ fontSize: 14 }}>⚽</span>
            WC 2026
          </button>
        </div>



        {/* Stats bar — slate completeness + refresh timestamps */}
        <div className="px-4 pb-3 max-w-5xl mx-auto">
          <div
            className="rounded-lg px-4 py-2.5 grid gap-x-4 gap-y-1.5"
            style={{
              background: "transparent",
              border: "1px solid #FFFFFF",
              gridTemplateColumns: "repeat(2, 1fr)",
            }}
          >
            {/* Context label spanning both columns */}
            <div className="col-span-2 flex items-center gap-1.5 pb-1" style={{ borderBottom: "1px solid #FFFFFF" }}>
              <span className="font-bold uppercase tracking-widest" style={{ color: '#FFFFFF', fontSize: '20px' }}>
                {selectedSport}
              </span>
              <span className="text-sm" style={{ color: "#FFFFFF" }}>·</span>
              <span className="font-semibold" style={{ color: '#FFFFFF', fontSize: '18px' }}>
                {gameDate === todayPst()
                  ? new Date(gameDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
                  : formatDateNav(gameDate)}
              </span>
              {totalCount > 0 && (
                <>
                  <span className="text-sm" style={{ color: "#FFFFFF" }}>·</span>
                  <span style={{ color: "#FFFFFF", fontSize: '15px' }}>{totalCount} Total {selectedSport} Games</span>
                </>
              )}
            </div>
            {/* Row 1: Odds count | Modeled count */}
            <div className="flex items-baseline gap-1.5">
              <span
                className="text-[13px] font-black tabular-nums"
                style={{ color: withOddsCount === totalCount ? "#45E0A8" : missingOddsCount > 0 ? "#FFFFFF" : "#FFFFFF" }}
              >
                {withOddsCount}/{totalCount}
              </span>
              <span className="text-sm uppercase tracking-wide" style={{ color: "#FFFFFF" }}>
                Games with All Odds
              </span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span
                className="text-[13px] font-black tabular-nums"
                style={{ color: withModelCount === totalCount ? "#45E0A8" : withModelCount > 0 ? "#FFFFFF" : "#FFFFFF" }}
              >
                {withModelCount}/{totalCount}
              </span>
              <span className="text-sm uppercase tracking-wide" style={{ color: "#FFFFFF" }}>
                Games Modeled
              </span>
            </div>

            {/* Divider */}
            <div className="col-span-2" style={{ height: 1, background: "#FFFFFF" }} />

            {/* Row 2: Odds timestamp | Scores timestamp */}
            <div className="flex flex-col gap-0.5">
              <span className="uppercase tracking-widest" style={{ color: "#FFFFFF", fontSize: '14px' }}>
                Odds Last Updated
              </span>
              <span className="text-sm font-mono" style={{ color: lastRefresh?.refreshedAt ? "#FFFFFF" : "#FFFFFF" }}>
                {lastRefresh?.refreshedAt
                  ? new Date(lastRefresh.refreshedAt).toLocaleTimeString("en-US", {
                      hour: "2-digit", minute: "2-digit", second: "2-digit",
                      timeZone: "America/New_York", hour12: true,
                    }) + " EST"
                  : "—"}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="uppercase tracking-widest" style={{ color: "#FFFFFF", fontSize: '14px' }}>
                Scores Last Updated
              </span>
              <span className="text-sm font-mono" style={{ color: lastRefresh?.scoresRefreshedAt ? "#FFFFFF" : "#FFFFFF" }}>
                {lastRefresh?.scoresRefreshedAt
                  ? new Date(lastRefresh.scoresRefreshedAt).toLocaleTimeString("en-US", {
                      hour: "2-digit", minute: "2-digit", second: "2-digit",
                      timeZone: "America/New_York", hour12: true,
                    }) + " EST"
                  : "—"}
              </span>
            </div>

            {/* NBA Model Sync timestamp — only shown when NBA tab is active */}
            {selectedSport === "NBA" && (
              <>
                <div className="col-span-2" style={{ height: 1, background: "#FFFFFF" }} />
                <div className="col-span-2 flex items-center justify-between">
                  <div className="flex flex-col gap-0.5">
                    <span className="uppercase tracking-widest" style={{ color: "#FFFFFF", fontSize: '14px' }}>
                      NBA Model Last Synced
                    </span>
                    <span
                      className="font-mono"
                      style={{ color: '#45E0A8', fontSize: '13px' }}
                    >
                      {lastNbaModelSync?.syncedAt
                        ? new Date(lastNbaModelSync.syncedAt).toLocaleTimeString("en-US", {
                            hour: "2-digit", minute: "2-digit", second: "2-digit",
                            timeZone: "America/New_York", hour12: true,
                          }) + " EST"
                        : "Not yet synced"}
                    </span>
                  </div>
                  {lastNbaModelSync && (
                    <div className="flex items-center gap-2 text-sm" style={{ color: "#FFFFFF" }}>
                      <span>
                        <span className="font-bold" style={{ color: "#45E0A8" }}>{lastNbaModelSync.synced}</span> synced
                      </span>
                      {lastNbaModelSync.errors.length > 0 && (
                        <span>
                          <span className="font-bold" style={{ color: "#FFFFFF" }}>{lastNbaModelSync.errors.length}</span> errors
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* MLB Refresh Stats — only shown when MLB tab is active */}
            {selectedSport === "MLB" && lastRefresh && (
              <>
                <div className="col-span-2" style={{ height: 1, background: "#FFFFFF" }} />
                <div className="col-span-2 flex items-center justify-between">
                  <div className="flex flex-col gap-0.5">
                    <span className="uppercase tracking-widest" style={{ color: "#FFFFFF", fontSize: '14px' }}>
                      MLB Last Refresh Stats
                    </span>
                    <span className="font-mono" style={{ color: '#FFFFFF', fontSize: '11px' }}>
                      {lastRefresh.mlbTotal ?? 0} VSiN games processed
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-sm" style={{ color: "#FFFFFF" }}>
                    <span>
                      <span className="font-bold" style={{ color: "#45E0A8" }}>{lastRefresh.mlbUpdated ?? 0}</span> updated
                    </span>
                    <span>
                      <span className="font-bold" style={{ color: "#45E0A8" }}>{lastRefresh.mlbInserted ?? 0}</span> inserted
                    </span>
                  </div>
                </div>
              </>
            )}

            {/* NHL Refresh Stats + Goalie Watcher — only shown when NHL tab is active */}
            {selectedSport === "NHL" && (
              <>
                <div className="col-span-2" style={{ height: 1, background: "#FFFFFF" }} />
                {/* NHL Refresh Stats */}
                {lastRefresh && (
                  <div className="col-span-2 flex items-center justify-between">
                    <div className="flex flex-col gap-0.5">
                      <span className="uppercase tracking-widest" style={{ color: "#FFFFFF", fontSize: '14px' }}>
                        NHL Last Refresh Stats
                      </span>
                      <span className="font-mono" style={{ color: '#FFFFFF', fontSize: '11px' }}>
                        {lastRefresh.nhlTotal ?? 0} VSiN games processed
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-sm" style={{ color: "#FFFFFF" }}>
                      <span>
                        <span className="font-bold" style={{ color: "#45E0A8" }}>{lastRefresh.nhlUpdated ?? 0}</span> updated
                      </span>
                      <span>
                        <span className="font-bold" style={{ color: "#45E0A8" }}>{lastRefresh.nhlInserted ?? 0}</span> inserted
                      </span>
                      <span>
                        <span className="font-bold" style={{ color: "#FFFFFF" }}>{lastRefresh.nhlScheduleInserted ?? 0}</span> schedule-only
                      </span>
                    </div>
                  </div>
                )}
                {/* Goalie Watcher Status */}
                <div className="col-span-2" style={{ height: 1, background: "#FFFFFF" }} />
                <div className="col-span-2 flex items-center justify-between">
                  <div className="flex flex-col gap-0.5">
                    <span className="uppercase tracking-widest" style={{ color: "#FFFFFF", fontSize: '14px' }}>
                      🥅 Goalie Watcher
                    </span>
                    <span className="font-mono" style={{ color: lastGoalieCheck?.checkedAt ? "#FFFFFF" : "#FFFFFF", fontSize: '11px' }}>
                      {lastGoalieCheck?.checkedAt
                        ? "Last check: " + new Date(lastGoalieCheck.checkedAt).toLocaleTimeString("en-US", {
                            hour: "2-digit", minute: "2-digit", second: "2-digit",
                            timeZone: "America/New_York", hour12: true,
                          }) + " EST"
                        : "Not yet checked"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {lastGoalieCheck && (
                      <div className="flex items-center gap-2 text-sm" style={{ color: "#FFFFFF" }}>
                        <span>
                          <span className="font-bold" style={{ color: "#FFFFFF" }}>{lastGoalieCheck.gamesChecked}</span> games checked
                        </span>
                        {lastGoalieCheck.changes.length > 0 && (
                          <span>
                            <span className="font-bold" style={{ color: "#FFFFFF" }}>{lastGoalieCheck.changes.length}</span> changes
                          </span>
                        )}
                        {lastGoalieCheck.modelRerun && (
                          <span style={{ color: "#45E0A8" }}>model re-run ✓</span>
                        )}
                      </div>
                    )}
                    <button type="button" onClick={() => checkGoaliesMutation.mutate()}
                      disabled={checkGoaliesMutation.isPending}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-sm font-semibold transition-all"
                      style={checkGoaliesMutation.isPending
                        ? { background: "transparent", color: "#45E0A8", border: "1px solid #45E0A8" }
                        : { background: "transparent", color: "#45E0A8", border: "1px solid #45E0A8" }
                      }
                    >
                      {checkGoaliesMutation.isPending ? "Checking…" : "Check Now"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Game cards — same max-width and padding as Dashboard */}
      <main className="max-w-5xl mx-auto px-4 pb-8 pt-3 space-y-3">
        {selectedSport === "WC2026" ? (
          <WcMatchOddsPanel
            rows={wcRows}
            isLoading={wcIsLoading}
            round={wcRound}
            onRoundChange={setWcRound}
            onSave={(matchId, fields) => wcUpdateMatchOddsMutation.mutate({ matchId, ...fields })}
            isSaving={wcUpdateMatchOddsMutation.isPending}
          />
        ) : isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="animate-spin" style={{ color: "#45E0A8" }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-2">
            <span className="text-sm" style={{ color: "#FFFFFF" }}>
              {statusFilter === "missing_odds"
                ? `No games missing odds on ${formatDateNav(gameDate)} — all odds are in ✓`
                : statusFilter === "modeled"
                  ? `No modeled games yet on ${formatDateNav(gameDate)}`
                  : statusFilter === "not_modeled"
                    ? `All games have been modeled on ${formatDateNav(gameDate)} ✓`
                    : statusFilter !== "all"
                      ? `No ${statusFilter} ${selectedSport} games on ${formatDateNav(gameDate)}`
                      : `No games found for ${formatDateNav(gameDate)}`
              }
            </span>
          </div>
        ) : (
          filtered.map((game) => (
            <EditableGameCard
              key={game.id}
              game={game as GameRow}
              onSaved={handleRefetch}
              showDeleteButton={isOwner && (statusFilter === "missing_odds" || statusFilter === "not_modeled")}
            />
          ))
        )}
      </main>
    </div>
    </AdminShell>
  );
}

// ─── WC2026 Match Odds Panel ──────────────────────────────────────────────────
// Owner-only panel for entering model odds for wc2026MatchOdds rows.
// Queries ONLY wc2026MatchOdds (enriched with team names from wc2026_espn_matches).
// 8 markets per match: TO ADV, ML (3-way), DRAW/NO DRAW, TOTAL, SPREAD, DBL CHC, BTTS.

type WcMatchOddsRow = {
  id: number;
  matchId: string;
  espnMatchId: string | null;
  espnSlug: string | null;
  worldCupRound: string | null;
  worldCupStage: string | null;
  // Book odds
  bookAwayToAdvance: number | null;
  bookHomeToAdvance: number | null;
  bookAwayMl: number | null;
  bookHomeMl: number | null;
  bookDraw: number | null;
  bookNoDraw: number | null;
  bookAwayWd: number | null;
  bookHomeWd: number | null;
  bookPrimarySpread: number | null;
  bookAwayPrimarySpreadOdds: number | null;
  bookHomePrimarySpreadOdds: number | null;
  bookTotal: number | null;
  bookOverOdds: number | null;
  bookUnderOdds: number | null;
  bookBttsYes: number | null;
  bookBttsNo: number | null;
  // Model odds
  modelAwayToAdvance: number | null;
  modelHomeToAdvance: number | null;
  modelAwayMl: number | null;
  modelHomeMl: number | null;
  modelDraw: number | null;
  modelNoDraw: number | null;
  modelAwayWd: number | null;
  modelHomeWd: number | null;
  modelPrimarySpread: number | null;
  modelAwayPrimarySpreadOdds: number | null;
  modelHomePrimarySpreadOdds: number | null;
  modelTotal: number | null;
  modelOverOdds: number | null;
  modelUnderOdds: number | null;
  modelBttsYes: number | null;
  modelBttsNo: number | null;
  // Enriched from wc2026_espn_matches
  awayTeamName: string | null;
  homeTeamName: string | null;
  awayTeamAbbrev: string | null;
  homeTeamAbbrev: string | null;
  awayTeamLogo: string | null;
  homeTeamLogo: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wcFmtAmerican(odds: number | null | undefined): string {
  if (odds == null) return "—";
  const r = Math.round(odds);
  return r > 0 ? `+${r}` : `${r}`;
}

function wcFmtSpreadLine(line: number | null | undefined): string {
  if (line == null) return "—";
  return line > 0 ? `+${line}` : `${line}`;
}

function wcParseOdds(val: string): number | null {
  const trimmed = val.trim();
  if (!trimmed || trimmed === "—") return null;
  const n = Number(trimmed);
  if (isNaN(n)) return null;
  return Math.round(n);
}

function wcParseSpread(val: string): number | null {
  const trimmed = val.trim();
  if (!trimmed || trimmed === "—") return null;
  const n = parseFloat(trimmed);
  if (isNaN(n)) return null;
  return n;
}

// ─── WcOddsInput — inline editable cell ──────────────────────────────────────

function WcOddsInput({
  value,
  onChange,
  placeholder = "—",
  isSpread = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  isSpread?: boolean;
}) {
  return (
    <input
      type="text"
      inputMode={isSpread ? "decimal" : "numeric"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full text-center font-mono font-bold text-xs rounded px-1 py-0.5 outline-none focus:ring-1 focus:ring-[#45E0A8]"
      style={{
        background: "transparent",
        color: "#45E0A8",
        border: "1px solid #45E0A8",
        minWidth: 44,
        maxWidth: 64,
      }}
    />
  );
}

// ─── WcMatchOddsCard — one match row ────────────────────────────────────────

function WcMatchOddsCard({
  row,
  onSave,
  isSaving,
}: {
  row: WcMatchOddsRow;
  onSave: (matchId: string, fields: Record<string, number | null>) => void;
  isSaving: boolean;
}) {
  const awayName = row.awayTeamName ?? row.awayTeamAbbrev ?? row.espnSlug?.split("-")[0]?.toUpperCase() ?? "AWAY";
  const homeName = row.homeTeamName ?? row.homeTeamAbbrev ?? row.espnSlug?.split("-")[1]?.toUpperCase() ?? "HOME";
  const awayAbbr = row.awayTeamAbbrev ?? awayName.slice(0, 3).toUpperCase();
  const homeAbbr = row.homeTeamAbbrev ?? homeName.slice(0, 3).toUpperCase();

  // ── Local draft state — all model fields as strings ──────────────────────────
  const [mAwayAdv,  setMAwayAdv]  = useState(row.modelAwayToAdvance  != null ? String(row.modelAwayToAdvance)  : "");
  const [mHomeAdv,  setMHomeAdv]  = useState(row.modelHomeToAdvance  != null ? String(row.modelHomeToAdvance)  : "");
  const [mAwayMl,   setMAwayMl]   = useState(row.modelAwayMl         != null ? String(row.modelAwayMl)         : "");
  const [mHomeMl,   setMHomeMl]   = useState(row.modelHomeMl         != null ? String(row.modelHomeMl)         : "");
  const [mDraw,     setMDraw]     = useState(row.modelDraw            != null ? String(row.modelDraw)           : "");
  const [mNoDraw,   setMNoDraw]   = useState(row.modelNoDraw          != null ? String(row.modelNoDraw)         : "");
  const [mAwayWd,   setMAwayWd]   = useState(row.modelAwayWd          != null ? String(row.modelAwayWd)         : "");
  const [mHomeWd,   setMHomeWd]   = useState(row.modelHomeWd          != null ? String(row.modelHomeWd)         : "");
  const [mSpread,   setMSpread]   = useState(row.modelPrimarySpread   != null ? String(row.modelPrimarySpread)  : "");
  const [mAwaySpOdds, setMAwaySpOdds] = useState(row.modelAwayPrimarySpreadOdds != null ? String(row.modelAwayPrimarySpreadOdds) : "");
  const [mHomeSpOdds, setMHomeSpOdds] = useState(row.modelHomePrimarySpreadOdds != null ? String(row.modelHomePrimarySpreadOdds) : "");
  const [mTotal,    setMTotal]    = useState(row.modelTotal           != null ? String(row.modelTotal)          : "");
  const [mOverOdds, setMOverOdds] = useState(row.modelOverOdds        != null ? String(row.modelOverOdds)       : "");
  const [mUnderOdds,setMUnderOdds]= useState(row.modelUnderOdds       != null ? String(row.modelUnderOdds)      : "");
  const [mBttsYes,  setMBttsYes]  = useState(row.modelBttsYes         != null ? String(row.modelBttsYes)        : "");
  const [mBttsNo,   setMBttsNo]   = useState(row.modelBttsNo          != null ? String(row.modelBttsNo)         : "");
  const [isDirty,   setIsDirty]   = useState(false);

  // Mark dirty on any change
  const mkChange = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setIsDirty(true);
  };

  const handleSave = () => {
    const fields: Record<string, number | null> = {
      modelAwayToAdvance:          wcParseOdds(mAwayAdv),
      modelHomeToAdvance:          wcParseOdds(mHomeAdv),
      modelAwayMl:                 wcParseOdds(mAwayMl),
      modelHomeMl:                 wcParseOdds(mHomeMl),
      modelDraw:                   wcParseOdds(mDraw),
      modelNoDraw:                 wcParseOdds(mNoDraw),
      modelAwayWd:                 wcParseOdds(mAwayWd),
      modelHomeWd:                 wcParseOdds(mHomeWd),
      modelPrimarySpread:          wcParseSpread(mSpread),
      modelAwayPrimarySpreadOdds:  wcParseOdds(mAwaySpOdds),
      modelHomePrimarySpreadOdds:  wcParseOdds(mHomeSpOdds),
      modelTotal:                  wcParseSpread(mTotal),
      modelOverOdds:               wcParseOdds(mOverOdds),
      modelUnderOdds:              wcParseOdds(mUnderOdds),
      modelBttsYes:                wcParseOdds(mBttsYes),
      modelBttsNo:                 wcParseOdds(mBttsNo),
    };
    console.log(
      `[WcMatchOddsCard][handleSave] matchId=${row.matchId}` +
      ` | [INPUT] fields=${JSON.stringify(fields)}` +
      ` | [VERIFY] dirtyFields=${Object.entries(fields).filter(([,v]) => v !== null).map(([k]) => k).join(",")}`
    );
    onSave(row.matchId, fields);
    setIsDirty(false);
  };

  // ── Market cell helper ──────────────────────────────────────────────────────
  // Each market column: label | book value | model input
  const MktCell = ({
    label,
    bookVal,
    modelVal,
    onModelChange,
    isSpread = false,
  }: {
    label: string;
    bookVal: number | null | undefined;
    modelVal: string;
    onModelChange: (v: string) => void;
    isSpread?: boolean;
  }) => (
    <div className="flex flex-col items-center gap-0.5 min-w-[52px]">
      <span className="text-[10px] uppercase tracking-widest font-semibold text-center leading-tight"
        style={{ color: "#FFFFFF" }}>
        {label}
      </span>
      {/* Book value — static */}
      <span className="font-mono font-bold text-xs"
        style={{ color: bookVal != null ? "#FFFFFF" : "#FFFFFF" }}>
        {isSpread ? wcFmtSpreadLine(bookVal) : wcFmtAmerican(bookVal)}
      </span>
      {/* Model input */}
      <WcOddsInput
        value={modelVal}
        onChange={onModelChange}
        isSpread={isSpread}
      />
    </div>
  );

  return (
    <div
      className="w-full rounded-lg overflow-hidden"
      style={{
        background: "#000000",
        border: "1px solid #FFFFFF",
        borderLeft: "3px solid #45E0A8",
      }}
    >
      {/* Header row: match ID + team names + save button */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs" style={{ color: "#FFFFFF" }}>
            {row.matchId}
          </span>
          <span className="font-bold text-sm text-white">
            {awayAbbr} vs {homeAbbr}
          </span>
          <span className="text-xs" style={{ color: "#FFFFFF" }}>
            {awayName} vs {homeName}
          </span>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving || !isDirty}
          className="flex items-center gap-1 px-3 py-1 rounded text-xs font-bold transition-all"
          style={isDirty
            ? { background: "transparent", color: "#45E0A8", border: "1px solid #45E0A8" }
            : { background: "transparent", color: "#FFFFFF", border: "1px solid #FFFFFF" }
          }
        >
          {isSaving ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} />}
          {isDirty ? "Submit" : "Saved"}
        </button>
      </div>

      {/* Markets grid */}
      <div className="px-3 py-2 overflow-x-auto">
        {/* Column headers */}
        <div className="flex items-start gap-3 min-w-max">

          {/* ── TO ADVANCE ── */}
          <div className="flex flex-col gap-1" style={{ minWidth: 120 }}>
            <span className="text-[10px] font-bold uppercase tracking-widest text-center"
              style={{ color: "#45E0A8" }}>TO ADV</span>
            <div className="flex gap-2">
              <MktCell
                label={`${homeAbbr} ADV`}
                bookVal={row.bookHomeToAdvance}
                modelVal={mHomeAdv}
                onModelChange={mkChange(setMHomeAdv)}
              />
              <MktCell
                label={`${awayAbbr} ADV`}
                bookVal={row.bookAwayToAdvance}
                modelVal={mAwayAdv}
                onModelChange={mkChange(setMAwayAdv)}
              />
            </div>
          </div>

          <div style={{ width: 1, background: "#FFFFFF", alignSelf: "stretch" }} />

          {/* ── 3-WAY ML ── */}
          <div className="flex flex-col gap-1" style={{ minWidth: 180 }}>
            <span className="text-[10px] font-bold uppercase tracking-widest text-center"
              style={{ color: "#FFFFFF" }}>ML (3-WAY)</span>
            <div className="flex gap-2">
              <MktCell
                label={`${homeAbbr} ML`}
                bookVal={row.bookHomeMl}
                modelVal={mHomeMl}
                onModelChange={mkChange(setMHomeMl)}
              />
              <MktCell
                label="DRAW"
                bookVal={row.bookDraw}
                modelVal={mDraw}
                onModelChange={mkChange(setMDraw)}
              />
              <MktCell
                label={`${awayAbbr} ML`}
                bookVal={row.bookAwayMl}
                modelVal={mAwayMl}
                onModelChange={mkChange(setMAwayMl)}
              />
            </div>
          </div>

          <div style={{ width: 1, background: "#FFFFFF", alignSelf: "stretch" }} />

          {/* ── DRAW / NO DRAW ── */}
          <div className="flex flex-col gap-1" style={{ minWidth: 120 }}>
            <span className="text-[10px] font-bold uppercase tracking-widest text-center"
              style={{ color: "#FFFFFF" }}>DRAW/NO DRAW</span>
            <div className="flex gap-2">
              <MktCell
                label="DRAW"
                bookVal={row.bookDraw}
                modelVal={mDraw}
                onModelChange={mkChange(setMDraw)}
              />
              <MktCell
                label="NO DRAW"
                bookVal={row.bookNoDraw}
                modelVal={mNoDraw}
                onModelChange={mkChange(setMNoDraw)}
              />
            </div>
          </div>

          <div style={{ width: 1, background: "#FFFFFF", alignSelf: "stretch" }} />

          {/* ── TOTAL ── */}
          <div className="flex flex-col gap-1" style={{ minWidth: 160 }}>
            <span className="text-[10px] font-bold uppercase tracking-widest text-center"
              style={{ color: "#45E0A8" }}>
              TOTAL {row.bookTotal != null ? `(${row.bookTotal})` : ""}
            </span>
            <div className="flex gap-2">
              <MktCell
                label="LINE"
                bookVal={row.bookTotal}
                modelVal={mTotal}
                onModelChange={mkChange(setMTotal)}
                isSpread
              />
              <MktCell
                label="OVER"
                bookVal={row.bookOverOdds}
                modelVal={mOverOdds}
                onModelChange={mkChange(setMOverOdds)}
              />
              <MktCell
                label="UNDER"
                bookVal={row.bookUnderOdds}
                modelVal={mUnderOdds}
                onModelChange={mkChange(setMUnderOdds)}
              />
            </div>
          </div>

          <div style={{ width: 1, background: "#FFFFFF", alignSelf: "stretch" }} />

          {/* ── SPREAD ── */}
          <div className="flex flex-col gap-1" style={{ minWidth: 180 }}>
            <span className="text-[10px] font-bold uppercase tracking-widest text-center"
              style={{ color: "#FFFFFF" }}>
              SPREAD {row.bookPrimarySpread != null ? `(${wcFmtSpreadLine(row.bookPrimarySpread)})` : ""}
            </span>
            <div className="flex gap-2">
              <MktCell
                label="LINE"
                bookVal={row.bookPrimarySpread}
                modelVal={mSpread}
                onModelChange={mkChange(setMSpread)}
                isSpread
              />
              <MktCell
                label={`${homeAbbr} ODS`}
                bookVal={row.bookHomePrimarySpreadOdds}
                modelVal={mHomeSpOdds}
                onModelChange={mkChange(setMHomeSpOdds)}
              />
              <MktCell
                label={`${awayAbbr} ODS`}
                bookVal={row.bookAwayPrimarySpreadOdds}
                modelVal={mAwaySpOdds}
                onModelChange={mkChange(setMAwaySpOdds)}
              />
            </div>
          </div>

          <div style={{ width: 1, background: "#FFFFFF", alignSelf: "stretch" }} />

          {/* ── DOUBLE CHANCE ── */}
          <div className="flex flex-col gap-1" style={{ minWidth: 120 }}>
            <span className="text-[10px] font-bold uppercase tracking-widest text-center"
              style={{ color: "#FFFFFF" }}>DBL CHC</span>
            <div className="flex gap-2">
              <MktCell
                label={`${homeAbbr}/D`}
                bookVal={row.bookHomeWd}
                modelVal={mHomeWd}
                onModelChange={mkChange(setMHomeWd)}
              />
              <MktCell
                label={`${awayAbbr}/D`}
                bookVal={row.bookAwayWd}
                modelVal={mAwayWd}
                onModelChange={mkChange(setMAwayWd)}
              />
            </div>
          </div>

          <div style={{ width: 1, background: "#FFFFFF", alignSelf: "stretch" }} />

          {/* ── BTTS ── */}
          <div className="flex flex-col gap-1" style={{ minWidth: 120 }}>
            <span className="text-[10px] font-bold uppercase tracking-widest text-center"
              style={{ color: "#FFFFFF" }}>BTTS</span>
            <div className="flex gap-2">
              <MktCell
                label="YES"
                bookVal={row.bookBttsYes}
                modelVal={mBttsYes}
                onModelChange={mkChange(setMBttsYes)}
              />
              <MktCell
                label="NO"
                bookVal={row.bookBttsNo}
                modelVal={mBttsNo}
                onModelChange={mkChange(setMBttsNo)}
              />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ─── WcMatchOddsPanel — round selector + list of cards ───────────────────────

const WC_ROUND_LABELS: Record<string, string> = {
  r32:          "Round of 32",
  quarterfinals: "Quarterfinals",
  semifinals:   "Semifinals",
  third_place:  "Third Place",
  finals:       "Final",
};

function WcMatchOddsPanel({
  rows,
  isLoading,
  round,
  onRoundChange,
  onSave,
  isSaving,
}: {
  rows: WcMatchOddsRow[];
  isLoading: boolean;
  round: string;
  onRoundChange: (r: "r32" | "quarterfinals" | "semifinals" | "third_place" | "finals") => void;
  onSave: (matchId: string, fields: Record<string, number | null>) => void;
  isSaving: boolean;
}) {
  console.log(
    `[WcMatchOddsPanel] RENDER | round=${round} rows=${rows.length} isLoading=${isLoading} isSaving=${isSaving}`
  );

  return (
    <div className="space-y-3">
      {/* Round selector */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["r32", "quarterfinals", "semifinals", "third_place", "finals"] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => {
              console.log(`[WcMatchOddsPanel] Round changed: ${round} → ${r}`);
              onRoundChange(r);
            }}
            className="px-3 py-1 rounded-full text-xs font-bold transition-all"
            style={round === r
              ? { background: "transparent", color: "#45E0A8", border: "1px solid #45E0A8" }
              : { background: "#000000", color: "#FFFFFF", border: "1px solid #FFFFFF" }
            }
          >
            {WC_ROUND_LABELS[r] ?? r}
          </button>
        ))}
        <span className="text-xs ml-2" style={{ color: "#FFFFFF" }}>
          {rows.length} match{rows.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-1">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs font-bold" style={{ color: "#FFFFFF" }}>+100</span>
          <span className="text-[10px] uppercase tracking-wide" style={{ color: "#FFFFFF" }}>= Book</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs font-bold" style={{ color: "#45E0A8" }}>+100</span>
          <span className="text-[10px] uppercase tracking-wide" style={{ color: "#FFFFFF" }}>= Model (editable)</span>
        </div>
      </div>

      {/* Loading */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="animate-spin" style={{ color: "#45E0A8" }} />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-2">
          <span className="text-sm" style={{ color: "#FFFFFF" }}>
            No matchs found for {WC_ROUND_LABELS[round] ?? round}
          </span>
        </div>
      ) : (
        rows.map((row) => {
          console.log(
            `[WcMatchOddsPanel] Rendering card matchId=${row.matchId}` +
            ` away=${row.awayTeamName ?? row.awayTeamAbbrev ?? "?"}` +
            ` home=${row.homeTeamName ?? row.homeTeamAbbrev ?? "?"}` +
            ` bookAwayMl=${row.bookAwayMl ?? "null"}` +
            ` bookHomeMl=${row.bookHomeMl ?? "null"}` +
            ` modelAwayMl=${row.modelAwayMl ?? "null"}` +
            ` modelHomeMl=${row.modelHomeMl ?? "null"}`
          );
          return (
            <WcMatchOddsCard
              key={row.matchId}
              row={row}
              onSave={onSave}
              isSaving={isSaving}
            />
          );
        })
      )}
    </div>
  );
}
