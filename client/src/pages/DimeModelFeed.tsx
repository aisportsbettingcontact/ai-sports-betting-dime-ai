/**
 * DimeModelFeed — the Dime AI "AI Model Projections" feed surface.
 *
 * Route: /feed/model/:sport-:date  (e.g. /feed/model/mlb-07-11-2026,
 *        /feed/model/wc-07-11-2026) and /feed/model/:sport/:date.
 *        Bare /feed/model/:sport canonicalizes to today's dated URL.
 *
 * A parallel surface over the SAME tRPC data contracts as /feed
 * (DIME-FEED-MIGRATION-DRAFT §2: new frontend, zero backend changes).
 * Implements dime-ai/reference-pages/dime-feed-projections.html — the
 * judge-verified v4 reference — under the locked brand law
 * (design-system/dime-ai/MASTER.md + pages/ai-model-projections.md):
 *
 *  - one-accent mint strictly on signal (model edges, picks, live, active)
 *  - Familjen Grotesk values / IBM Plex Mono micro-labels, 160ms single curve
 *  - solid surfaces separated by background tier + 1px border (no glass,
 *    no gradients, no elevation on data cards)
 *  - OWNER RULES: crest/flag beside every team reference; every market keeps
 *    both sides as rows (away TOP / home BOTTOM, O/U, DRAW/NO DRAW,
 *    HOME WD top / AWAY WD bottom, YES/NO) with Book | Model per side;
 *    zero truncation down to 360px (labels stack above values <380px).
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import type { inferRouterOutputs } from "@trpc/server";
import { keepPreviousData } from "@tanstack/react-query";
import { trpc, type AppRouter } from "@/lib/trpc";
import { MLB_BY_ABBREV } from "@shared/mlbTeams";
import { formatGameTime } from "@/lib/gameUtils";
import {
  calculateEdge,
  calculate3WayResult,
  EDGE_THRESHOLD_PP,
  type ThreeWayOdds,
} from "@/lib/edgeUtils";
import { feedModelPath, toFeedSlugDate } from "@/lib/feedRoutes";

// ─── Normalized card model (adapters below map tRPC rows into this) ─────────

interface CrestSpec {
  /** Image URL when the data source provides one (MLB logos, WC flags). */
  url?: string | null;
  /** Fallback monogram + colors when no image is available. */
  code: string;
  bg?: string;
}
interface MarketRowSpec {
  label: string;
  crest?: CrestSpec | null;
  book: string;
  model: string;
  sig?: boolean;
  wp?: string | null;
}
interface MarketColSpec {
  title: string;
  rows: MarketRowSpec[];
  foot: { label: string; crest?: CrestSpec | null; edge: boolean };
}
interface TeamSpec {
  name: string;
  crest: CrestSpec;
  score?: string | null;
}
interface FeedCardSpec {
  id: string;
  liveLabel?: string | null;
  timeLabel: string;
  away: TeamSpec;
  home: TeamSpec;
  meta: string;
  markets: MarketColSpec[];
  verdict: {
    pick: string;
    crest?: CrestSpec | null;
    edge: string;
    grade: string;
    pass: boolean;
  };
}

// ─── Shared formatting ───────────────────────────────────────────────────────

const fmtAm = (v: number | null | undefined): string =>
  v == null || Number.isNaN(v) ? "—" : v > 0 ? `+${v}` : `${v}`;

const NO_EDGE = { label: "NO EDGE", edge: false } as const;

/** Simple edge → letter grade tiering (matches the reference verdict strip). */
function edgeGrade(pp: number): string {
  if (Number.isNaN(pp) || pp < EDGE_THRESHOLD_PP) return "—";
  if (pp >= 6) return "A";
  if (pp >= 4.5) return "A−";
  if (pp >= 3.5) return "B+";
  if (pp >= 2.5) return "B";
  return "C+";
}

// ─── Presentational components ───────────────────────────────────────────────

function Crest({ c, size }: { c: CrestSpec | null | undefined; size: number }) {
  const [failed, setFailed] = useState(false);
  if (!c) return null;
  const showImg = !!c.url && !failed;
  return (
    <span
      className="dmf-crest"
      style={{ width: size, height: size, flex: `0 0 ${size}px` }}
      aria-hidden="true"
    >
      {showImg ? (
        <img
          src={c.url!}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
      ) : (
        <span
          className="dmf-crest-mono"
          style={{ background: c.bg || "var(--dmf-card-hi)", fontSize: Math.max(7, size * 0.34) }}
        >
          {/* 2-char monogram — 3 letters clip inside small circles (Rule 5) */}
          {c.code.slice(0, 2)}
        </span>
      )}
    </span>
  );
}

function MarketCol({ mc }: { mc: MarketColSpec }) {
  return (
    <div className="dmf-mkcol">
      <div className="dmf-mktitle">
        <span>{mc.title}</span>
      </div>
      <div className="dmf-mkbox">
        <div className="dmf-mkhead">
          <span>Side</span>
          <span>Book</span>
          <span>Model</span>
        </div>
        {mc.rows.map((r, i) => (
          <div className="dmf-mkrow" key={i}>
            <div className="dmf-rlab">
              <Crest c={r.crest} size={14} />
              <span className="dmf-lab">{r.label}</span>
            </div>
            <div className="dmf-side">
              <span className="dmf-val">{r.book}</span>
            </div>
            <div className={`dmf-side dmf-model${r.sig ? " dmf-sig" : ""}`}>
              <span className="dmf-val">{r.model}</span>
              {r.wp ? <span className="dmf-wp">{r.wp}</span> : null}
            </div>
          </div>
        ))}
        <div className={`dmf-mkfoot ${mc.foot.edge ? "dmf-edge" : "dmf-none"}`}>
          <Crest c={mc.foot.crest} size={12} />
          <span>{mc.foot.label}</span>
        </div>
      </div>
    </div>
  );
}

function TeamRow({ t }: { t: TeamSpec }) {
  return (
    <div className="dmf-teamrow">
      <Crest c={t.crest} size={24} />
      <span className="dmf-tname">{t.name}</span>
      {t.score != null && t.score !== "" ? (
        <span className="dmf-tscore">{t.score}</span>
      ) : null}
    </div>
  );
}

function GameRow({ g }: { g: FeedCardSpec }) {
  const v = g.verdict;
  const mode = g.markets.length >= 6 ? "dmf-mk7" : "dmf-mk3";
  return (
    <div className={`dmf-game ${mode}${v.pass ? " dmf-pass" : ""}${g.liveLabel ? " dmf-live" : ""}`}>
      <div className="dmf-gbody">
        <div className="dmf-matchup">
          {g.liveLabel ? (
            <div className="dmf-status">
              <span className="dmf-ld" />
              <span className="dmf-lt">{g.liveLabel}</span>
            </div>
          ) : (
            <div className="dmf-status">
              <span className="dmf-time">{g.timeLabel}</span>
            </div>
          )}
          <div className="dmf-teams">
            <TeamRow t={g.away} />
            <TeamRow t={g.home} />
          </div>
          <div className="dmf-meta">{g.meta}</div>
        </div>
        <div className="dmf-markets">
          {g.markets.map((mc) => (
            <MarketCol mc={mc} key={mc.title} />
          ))}
        </div>
        <div className="dmf-verdict">
          <div className="dmf-vitem dmf-vpick">
            <span className="dmf-vl">Pick</span>
            <span className={`dmf-vv${v.pass ? "" : " dmf-vsig"}`}>
              <Crest c={v.crest} size={18} />
              {v.pick}
            </span>
          </div>
          <div className="dmf-vitem">
            <span className="dmf-vl">Edge</span>
            <span className={`dmf-vv${v.pass ? "" : " dmf-vsig"}`}>{v.edge}</span>
          </div>
          <div className="dmf-vitem">
            <span className="dmf-vl">Grade</span>
            <span className="dmf-vv">
              <span className="dmf-grade">{v.grade}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="dmf-game dmf-mk3" aria-hidden="true">
      <div className="dmf-gbody">
        <div className="dmf-matchup">
          <div className="dmf-skel" style={{ width: 90, height: 10 }} />
          <div className="dmf-skel" style={{ width: 170, height: 18, marginTop: 10 }} />
          <div className="dmf-skel" style={{ width: 150, height: 18, marginTop: 8 }} />
          <div className="dmf-skel" style={{ width: 200, height: 9, marginTop: 10 }} />
        </div>
      </div>
    </div>
  );
}

// ─── Route parsing ───────────────────────────────────────────────────────────

/** Accepts "mlb-07-11-2026" | "wc-07-11-2026" (also :sport/:date split form).
 *  A bare "mlb" | "wc" parses with isoDate=null — the page canonicalizes it
 *  to today's dated URL so sport-only links always land on a real slate. */
export function parseFeedModelPath(
  sportSeg: string | undefined,
  dateSeg: string | undefined,
): { sport: "MLB" | "WC"; isoDate: string | null } | null {
  let sport = (sportSeg ?? "").toLowerCase();
  let date = dateSeg ?? "";
  if (!date && /^(mlb|wc)-\d{2}-\d{2}-\d{4}$/.test(sport)) {
    date = sport.slice(sport.indexOf("-") + 1);
    sport = sport.slice(0, sport.indexOf("-"));
  }
  if (sport !== "mlb" && sport !== "wc") return null;
  const sportCode = sport === "mlb" ? ("MLB" as const) : ("WC" as const);
  if (!date) return { sport: sportCode, isoDate: null };
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(date);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  const mo = Number(mm), da = Number(dd);
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
  return { sport: sportCode, isoDate: `${yyyy}-${mm}-${dd}` };
}

const shiftIso = (iso: string, days: number): string => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const prettyDate = (iso: string): string =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DimeModelFeed(props: { sport?: string; date?: string }) {
  const [, navigate] = useLocation();
  const parsed = parseFeedModelPath(props.sport, props.date);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("theme");
      if (q === "light" || q === "dark") return q;
      const saved = localStorage.getItem("dime-feed-theme");
      return saved === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("dime-feed-theme", theme);
    } catch {
      /* private mode */
    }
  }, [theme]);

  const sport = parsed?.sport ?? "MLB";
  const isoDate = parsed?.isoDate ?? "";

  // Bare-sport URLs (/feed/model/mlb) canonicalize to today's dated URL —
  // replace, so back-button never re-lands on the dateless form.
  const needsDateCanonicalize = parsed !== null && parsed.isoDate === null;
  useEffect(() => {
    if (needsDateCanonicalize) {
      navigate(feedModelPath(sport), { replace: true });
    }
  }, [needsDateCanonicalize, sport, navigate]);

  // ADAPTER WIRING (exact bindings from GameCard / WcFeedInline) is attached
  // below in useFeedCards — see mlbRowsToCards / wcMatchesToCards.
  const { cards, isLoading, gamesCount } = useFeedCards(sport, isoDate);

  const go = (nextSport: "MLB" | "WC", nextIso: string) =>
    navigate(feedModelPath(nextSport, nextIso));

  if (needsDateCanonicalize) {
    // One-frame redirect to the dated URL; queries stay disabled (isoDate="").
    return (
      <div className="dmf-root" data-dmf-theme={theme}>
        <style>{DMF_CSS}</style>
      </div>
    );
  }

  if (!parsed) {
    return (
      <div className="dmf-root" data-dmf-theme="dark">
        <style>{DMF_CSS}</style>
        <div className="dmf-invalid">
          <span className="dmf-micro">Invalid feed URL</span>
          <p>
            Expected <code>/feed/model/mlb-MM-DD-YYYY</code> or{" "}
            <code>/feed/model/wc-MM-DD-YYYY</code>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="dmf-root" data-dmf-theme={theme}>
      <style>{DMF_CSS}</style>

      <div className="dmf-topbar">
        <span className="dmf-wordmark" aria-label="dime">
          d<span className="dmf-i">ı<span className="dmf-coindot" /></span>me
        </span>
        <span className="dmf-topsep" />
        <span className="dmf-toptitle">AI Model Projections</span>
        <div className="dmf-sync">
          <button
            className="dmf-themebtn"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            {theme === "dark" ? "Light" : "Dark"}
          </button>
        </div>
      </div>

      <div className="dmf-scroll">
        <div className="dmf-feedhead">
          <div className="dmf-datenav">
            <button className="dmf-sq" aria-label="Previous day" onClick={() => go(sport, shiftIso(isoDate, -1))}>
              ‹
            </button>
            <div className="dmf-datelbl">{prettyDate(isoDate)}</div>
            <button className="dmf-sq" aria-label="Next day" onClick={() => go(sport, shiftIso(isoDate, 1))}>
              ›
            </button>
            <span className="dmf-micro dmf-slatecount">
              {sport === "WC" ? "World Cup" : "MLB"} · {gamesCount} {gamesCount === 1 ? "game" : "games"}
            </span>
          </div>
          <div className="dmf-sports" role="tablist" aria-label="Sport">
            <button
              role="tab"
              aria-selected={sport === "MLB"}
              className={`dmf-chip${sport === "MLB" ? " dmf-active" : ""}`}
              onClick={() => go("MLB", isoDate)}
            >
              MLB
            </button>
            <button
              role="tab"
              aria-selected={sport === "WC"}
              className={`dmf-chip${sport === "WC" ? " dmf-active" : ""}`}
              onClick={() => go("WC", isoDate)}
            >
              World Cup
            </button>
          </div>
        </div>

        <div className="dmf-list">
          {isLoading && cards.length === 0 ? (
            <>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </>
          ) : cards.length === 0 ? (
            <div className="dmf-empty">
              <span className="dmf-micro">No games for this date</span>
              <p>Try the date arrows above.</p>
            </div>
          ) : (
            cards.map((g) => <GameRow g={g} key={g.id} />)
          )}
        </div>

        <div className="dmf-rg dmf-micro">21+ · Gambling problem? Call 1-800-GAMBLER</div>
      </div>
    </div>
  );
}

// ─── Data adapters — bindings copied EXACTLY from GameCard / WcFeedInline ────

type RouterOutputs = inferRouterOutputs<AppRouter>;
type MlbRow = RouterOutputs["games"]["list"][number];
type WcMatch = RouterOutputs["wc2026"]["matchesByDate"][number];

/** Parse a numeric-ish tRPC field (decimal columns arrive as strings). */
const n = (v: string | number | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : null;
};

const fmtLine = (v: number): string => (v > 0 ? `+${v}` : `${v}`);

interface SideCalc {
  label: string;
  crest?: CrestSpec | null;
  book: number | null;
  model: number | null;
  wp?: string | null;
}

/** Two-sided market column: edge per side via edgeUtils (2-way).
 *  pickSuffix contextualizes bare team-code labels in footers/PICK ("ML"/"ADV"). */
function twoWayCol(
  title: string,
  top: SideCalc,
  bottom: SideCalc,
  pickSuffix?: string,
): MarketColSpec & { bestPP: number; bestSide: SideCalc | null; pickSuffix?: string } {
  const pp = (s: SideCalc) =>
    s.book != null && s.model != null ? calculateEdge(s.book, s.model) : NaN;
  const topPP = pp(top);
  const botPP = pp(bottom);
  const rows: MarketRowSpec[] = [top, bottom].map((s, i) => ({
    label: s.label,
    crest: s.crest,
    book: fmtAm(s.book),
    model: fmtAm(s.model),
    sig: !Number.isNaN(i === 0 ? topPP : botPP) && (i === 0 ? topPP : botPP) >= EDGE_THRESHOLD_PP,
    wp: s.wp ?? null,
  }));
  let bestPP = NaN;
  let bestSide: SideCalc | null = null;
  if (!Number.isNaN(topPP) && (Number.isNaN(botPP) || topPP >= botPP)) {
    bestPP = topPP;
    bestSide = top;
  } else if (!Number.isNaN(botPP)) {
    bestPP = botPP;
    bestSide = bottom;
  }
  const hasEdge = !Number.isNaN(bestPP) && bestPP >= EDGE_THRESHOLD_PP && bestSide != null;
  const footLabel = hasEdge
    ? `${bestSide!.label}${pickSuffix ? ` ${pickSuffix}` : ""} · +${bestPP.toFixed(1)}%`
    : NO_EDGE.label;
  return {
    title,
    rows,
    foot: hasEdge
      ? { label: footLabel, crest: bestSide!.crest, edge: true }
      : { ...NO_EDGE },
    bestPP: hasEdge ? bestPP : NaN,
    bestSide: hasEdge
      ? { ...bestSide!, label: `${bestSide!.label}${pickSuffix ? ` ${pickSuffix}` : ""}` }
      : null,
    pickSuffix,
  };
}

interface BestPick {
  pp: number;
  label: string;
  crest?: CrestSpec | null;
}
function trackBest(best: BestPick | null, col: { bestPP: number; bestSide: SideCalc | null }): BestPick | null {
  if (col.bestSide == null || Number.isNaN(col.bestPP)) return best;
  if (best == null || col.bestPP > best.pp)
    return { pp: col.bestPP, label: col.bestSide.label, crest: col.bestSide.crest };
  return best;
}
function verdictOf(best: BestPick | null): FeedCardSpec["verdict"] {
  if (best == null)
    return { pick: "PASS", edge: "—", grade: "—", pass: true };
  return {
    pick: best.label,
    crest: best.crest,
    edge: `+${best.pp.toFixed(1)}%`,
    grade: edgeGrade(best.pp),
    pass: false,
  };
}

// ── MLB adapter (bindings: GameCard.tsx via @shared/mlbTeams registry) ───────

function mlbRowToCard(g: MlbRow): FeedCardSpec {
  const awayAbbr = (g.awayTeam ?? "").toUpperCase();
  const homeAbbr = (g.homeTeam ?? "").toUpperCase();
  const awayReg = MLB_BY_ABBREV.get(awayAbbr);
  const homeReg = MLB_BY_ABBREV.get(homeAbbr);
  const awayCrest: CrestSpec = { url: awayReg?.logoUrl, code: awayAbbr.slice(0, 3), bg: awayReg?.primaryColor };
  const homeCrest: CrestSpec = { url: homeReg?.logoUrl, code: homeAbbr.slice(0, 3), bg: homeReg?.primaryColor };

  const isLive = g.gameStatus === "live";
  const isFinal = g.gameStatus === "final";
  // Model freshness gate — modelRunAt null ⇒ model invalidated (GameCard rule).
  const hasModel = g.modelRunAt != null;
  const M = <T,>(v: T | null): T | null => (hasModel ? v : null);

  // RUN LINE — VSiN run line authoritative, book-spread fallback (GameCard 841).
  const awayRl = n(g.awayRunLine) ?? n(g.awayBookSpread);
  const homeRl = n(g.homeRunLine) ?? n(g.homeBookSpread);
  const rl = twoWayCol(
    "Run Line",
    {
      label: awayRl != null ? `${awayAbbr} ${fmtLine(awayRl)}` : awayAbbr,
      crest: awayCrest,
      book: n(g.awayRunLineOdds),
      model: M(n(g.modelAwaySpreadOdds) ?? n(g.modelAwayPLOdds)),
    },
    {
      label: homeRl != null ? `${homeAbbr} ${fmtLine(homeRl)}` : homeAbbr,
      crest: homeCrest,
      book: n(g.homeRunLineOdds),
      model: M(n(g.modelHomeSpreadOdds) ?? n(g.modelHomePLOdds)),
    },
  );

  // TOTAL — O above U (owner row order).
  const totalLine = n(g.bookTotal);
  const total = twoWayCol(
    "Total",
    { label: totalLine != null ? `O ${totalLine}` : "OVER", book: n(g.overOdds), model: M(n(g.modelOverOdds)) },
    { label: totalLine != null ? `U ${totalLine}` : "UNDER", book: n(g.underOdds), model: M(n(g.modelUnderOdds)) },
  );

  // MONEYLINE — away top; win% annotation on the model favorite (page spec).
  const awayWp = n(g.modelAwayWinPct);
  const homeWp = n(g.modelHomeWinPct);
  const favIsAway = awayWp != null && homeWp != null ? awayWp >= homeWp : false;
  const ml = twoWayCol(
    "Moneyline",
    {
      label: awayAbbr,
      crest: awayCrest,
      book: n(g.awayML),
      model: M(n(g.modelAwayML)),
      wp: hasModel && favIsAway && awayWp != null ? `${Math.round(awayWp)}%` : null,
    },
    {
      label: homeAbbr,
      crest: homeCrest,
      book: n(g.homeML),
      model: M(n(g.modelHomeML)),
      wp: hasModel && !favIsAway && homeWp != null ? `${Math.round(homeWp)}%` : null,
    },
    "ML",
  );

  let best: BestPick | null = null;
  for (const col of [rl, total, ml]) best = trackBest(best, col);

  const pitchers =
    g.awayStartingPitcher || g.homeStartingPitcher
      ? `${g.awayStartingPitcher ?? "TBD"} vs ${g.homeStartingPitcher ?? "TBD"}`
      : null;
  const meta = [pitchers, g.venue].filter(Boolean).join(" · ") || "MLB";

  return {
    id: String(g.id ?? `${awayAbbr}-${homeAbbr}`),
    liveLabel: isLive ? `LIVE${g.gameClock ? ` · ${g.gameClock}` : ""}` : null,
    timeLabel: isFinal ? "FINAL" : formatGameTime(g.startTimeEst),
    away: { name: awayReg?.nickname ?? awayAbbr, crest: awayCrest, score: isLive || isFinal ? (g.awayScore != null ? String(g.awayScore) : null) : null },
    home: { name: homeReg?.nickname ?? homeAbbr, crest: homeCrest, score: isLive || isFinal ? (g.homeScore != null ? String(g.homeScore) : null) : null },
    meta,
    markets: [rl, total, ml],
    verdict: verdictOf(best),
  };
}

// ── WC adapter (bindings: WcFeedInline WcDesktopMergedPanel, away = TOP) ─────

const fifaFlagUrl = (code: string): string =>
  `https://api.fifa.com/api/v3/picture/flags-sq-4/${code.toUpperCase()}`;

/** Round label by PT kickoff-day thresholds (WcFeedInline stage ternary). */
export function wcRoundLabel(isoDate: string): string {
  return isoDate >= "2026-07-19" ? "Final"
    : isoDate >= "2026-07-18" ? "Third-Place Play-Off"
    : isoDate >= "2026-07-14" ? "Semifinal"
    : isoDate >= "2026-07-09" ? "Quarterfinal"
    : isoDate >= "2026-07-04" ? "Round of 16"
    : isoDate >= "2026-06-28" ? "Round of 32"
    : "Group Stage";
}

function fmtKickoffEt(kickoffUtc: string | Date | null | undefined): string {
  if (!kickoffUtc) return "TBD";
  const d = typeof kickoffUtc === "string" ? new Date(kickoffUtc) : kickoffUtc;
  if (Number.isNaN(d.getTime())) return "TBD";
  return (
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET"
  );
}

function wcMatchToCard(m: WcMatch, isoDate: string): FeedCardSpec {
  const awayCode = m.awayTeam?.fifaCode ?? m.awayTeamId.toUpperCase();
  const homeCode = m.homeTeam?.fifaCode ?? m.homeTeamId.toUpperCase();
  const awayCrest: CrestSpec = { url: m.awayTeam?.flagUrl ?? fifaFlagUrl(awayCode), code: awayCode };
  const homeCrest: CrestSpec = { url: m.homeTeam?.flagUrl ?? fifaFlagUrl(homeCode), code: homeCode };
  const dk = m.dkOdds;
  const mo = m.modelOdds;

  // 3-way calc for ML + DRAW (WcMktCol rule) — also yields the win% annotation.
  const threeWayBook: ThreeWayOdds | null =
    dk?.home != null && dk?.draw != null && dk?.away != null
      ? { home: dk.home, draw: dk.draw, away: dk.away }
      : null;
  const threeWayModel: ThreeWayOdds | null =
    mo?.home != null && mo?.draw != null && mo?.away != null
      ? { home: mo.home, draw: mo.draw, away: mo.away }
      : null;
  const calc3 = threeWayBook && threeWayModel ? calculate3WayResult(threeWayBook, threeWayModel) : null;

  // TO ADV — away top (dkOdds.toAdvanceAway), home bottom.
  const toAdv = twoWayCol(
    "To Adv",
    { label: awayCode, crest: awayCrest, book: dk?.toAdvanceAway ?? null, model: mo?.toAdvanceAway ?? null },
    { label: homeCode, crest: homeCrest, book: dk?.toAdvanceHome ?? null, model: mo?.toAdvanceHome ?? null },
    "ADV",
  );

  // ML — away top; edge/sig from the 3-way calc when available.
  const favIsAway = calc3 ? calc3.away.modelFairProb >= calc3.home.modelFairProb : false;
  const ml = twoWayCol(
    "ML",
    {
      label: awayCode,
      crest: awayCrest,
      book: dk?.away ?? null,
      model: mo?.away ?? null,
      wp: calc3 && favIsAway ? `${Math.round(calc3.away.modelFairProb * 100)}%` : null,
    },
    {
      label: homeCode,
      crest: homeCrest,
      book: dk?.home ?? null,
      model: mo?.home ?? null,
      wp: calc3 && !favIsAway ? `${Math.round(calc3.home.modelFairProb * 100)}%` : null,
    },
    "ML",
  );
  if (calc3) {
    // Override 2-way edge flags with the 3-way results (matches WcMktCol).
    ml.rows[0].sig = calc3.away.edgePP >= EDGE_THRESHOLD_PP;
    ml.rows[1].sig = calc3.home.edgePP >= EDGE_THRESHOLD_PP;
    const top = calc3.away.edgePP >= calc3.home.edgePP;
    const pp = top ? calc3.away.edgePP : calc3.home.edgePP;
    if (pp >= EDGE_THRESHOLD_PP) {
      ml.foot = { label: `${top ? awayCode : homeCode} ML · +${pp.toFixed(1)}%`, crest: top ? awayCrest : homeCrest, edge: true };
      ml.bestPP = pp;
      ml.bestSide = { label: `${top ? awayCode : homeCode} ML`, crest: top ? awayCrest : homeCrest, book: null, model: null };
    } else {
      ml.foot = { ...NO_EDGE };
      ml.bestPP = NaN;
      ml.bestSide = null;
    }
  }

  // DRAW — DRAW top / NO DRAW bottom (owner spec).
  const draw = twoWayCol(
    "Draw",
    { label: "DRAW", book: dk?.draw ?? null, model: mo?.draw ?? null },
    { label: "NO DRAW", book: dk?.noDraw ?? null, model: mo?.noDraw ?? null },
  );
  if (calc3) {
    draw.rows[0].sig = calc3.draw.edgePP >= EDGE_THRESHOLD_PP;
    if (calc3.draw.edgePP >= EDGE_THRESHOLD_PP) {
      draw.foot = { label: `DRAW · +${calc3.draw.edgePP.toFixed(1)}%`, edge: true };
      draw.bestPP = calc3.draw.edgePP;
      draw.bestSide = { label: "DRAW", book: null, model: null };
    }
  }

  // TOTAL — O top / U bottom; line from dkOdds.overLine (2.5 fallback).
  const totalLine = dk?.overLine ?? 2.5;
  const total = twoWayCol(
    "Total",
    { label: `O ${totalLine}`, book: dk?.overOdds ?? null, model: mo?.overOdds ?? null },
    { label: `U ${totalLine}`, book: dk?.underOdds ?? null, model: mo?.underOdds ?? null },
  );

  // SPREAD — away top with its own line (awaySpreadLine = -bookPrimarySpread).
  const aLine = dk?.awaySpreadLine;
  const hLine = dk?.homeSpreadLine;
  const spread = twoWayCol(
    "Spread",
    {
      label: aLine != null ? `${awayCode} ${fmtLine(aLine)}` : awayCode,
      crest: awayCrest,
      book: dk?.awaySpreadOdds ?? null,
      model: mo?.awaySpreadOdds ?? null,
    },
    {
      label: hLine != null ? `${homeCode} ${fmtLine(hLine)}` : homeCode,
      crest: homeCrest,
      book: dk?.homeSpreadOdds ?? null,
      model: mo?.homeSpreadOdds ?? null,
    },
  );

  // DBL CHC — HOME WD top (dkOdds.homeDrawOdds) / AWAY WD bottom (owner spec),
  // each carrying the matching team's flag (Rule 4).
  const dblChc = twoWayCol(
    "Dbl Chc",
    { label: "HOME WD", crest: homeCrest, book: dk?.homeDrawOdds ?? null, model: mo?.homeDrawOdds ?? null },
    { label: "AWAY WD", crest: awayCrest, book: dk?.awayDrawOdds ?? null, model: mo?.awayDrawOdds ?? null },
  );

  // BTTS — YES top / NO bottom.
  const btts = twoWayCol(
    "BTTS",
    { label: "YES", book: dk?.bttsYes ?? null, model: mo?.bttsYes ?? null },
    { label: "NO", book: dk?.bttsNo ?? null, model: mo?.bttsNo ?? null },
  );

  const markets = [toAdv, ml, draw, total, spread, dblChc, btts];
  let best: BestPick | null = null;
  for (const col of markets) best = trackBest(best, col);

  const status = m.status;
  const minute = m.matchMinute ?? null;
  const liveLabel =
    status === "LIVE" ? `LIVE${minute && minute !== "ETHT" ? ` ${minute}'` : ""}`
    : status === "HT" ? (minute === "ETHT" ? "ET HT" : "HT")
    : status === "ET" ? `ET${minute ? ` ${minute}'` : ""}`
    : status === "SHOOTOUT" ? "PENS"
    : null;
  const isFinal = status === "FT" || status === "FT_PEN";
  const showScores = !!liveLabel || isFinal;

  const venueBits = [m.venue?.stadium, m.venue?.city].filter(Boolean).join(", ");
  const meta = [wcRoundLabel(isoDate), venueBits].filter(Boolean).join(" · ");

  return {
    id: m.matchId,
    liveLabel,
    timeLabel: isFinal ? (status === "FT_PEN" ? "FINAL (PENS)" : "FINAL") : fmtKickoffEt(m.kickoffUtc),
    away: {
      name: m.awayTeam?.name ?? awayCode,
      crest: awayCrest,
      score: showScores && m.awayScore != null ? String(m.awayScore) : null,
    },
    home: {
      name: m.homeTeam?.name ?? homeCode,
      crest: homeCrest,
      score: showScores && m.homeScore != null ? String(m.homeScore) : null,
    },
    meta,
    markets,
    verdict: verdictOf(best),
  };
}

// ── Query orchestration (contracts: exact {sport, gameDate}; 60s poll;
//    placeholderData keeps the previous slate while the next date loads) ─────

function useFeedCards(
  sport: "MLB" | "WC",
  isoDate: string,
): { cards: FeedCardSpec[]; isLoading: boolean; gamesCount: number } {
  const isWc = sport === "WC";
  const mlbQuery = trpc.games.list.useQuery(
    { sport: "MLB", gameDate: isoDate },
    {
      enabled: !isWc && !!isoDate,
      refetchOnWindowFocus: false,
      refetchInterval: 60 * 1000,
      staleTime: 60 * 1000,
      placeholderData: (prev) => prev,
    },
  );
  const wcQuery = trpc.wc2026.matchesByDate.useQuery(
    { date: isoDate },
    {
      enabled: isWc && !!isoDate,
      refetchOnWindowFocus: false,
      refetchInterval: 60 * 1000,
      staleTime: 60 * 1000,
      placeholderData: keepPreviousData,
    },
  );

  const cards = useMemo<FeedCardSpec[]>(() => {
    if (isWc) return ((wcQuery.data ?? []) as WcMatch[]).map((m) => wcMatchToCard(m, isoDate));
    return ((mlbQuery.data ?? []) as MlbRow[]).map(mlbRowToCard);
  }, [isWc, wcQuery.data, mlbQuery.data, isoDate]);

  const isLoading = isWc ? wcQuery.isLoading : mlbQuery.isLoading;
  return { cards, isLoading, gamesCount: cards.length };
}

// ─── Scoped stylesheet — MASTER.md tokens verbatim, v4 reference layout ──────

const DMF_CSS = `
.dmf-root{
  --dmf-page:#0B0B0F; --dmf-sidebar:#101016; --dmf-card:#16161C; --dmf-card-hi:#1A1A22;
  --dmf-border:#1E1E26; --dmf-border-hi:#24242E; --dmf-border-hover:#2E2E38;
  --dmf-t1:#EDEDF2; --dmf-t2:#C9C9D4; --dmf-t3:#9A9AA8; --dmf-t4:#6A6A78;
  --dmf-mint:#45E0A8; --dmf-mint-dim:rgba(69,224,168,.10); --dmf-ring:rgba(69,224,168,.35);
  --dmf-ease:cubic-bezier(.16,1,.3,1); --dmf-t:160ms;
  --dmf-mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  --dmf-sans:"Familjen Grotesk",system-ui,-apple-system,"Segoe UI",sans-serif;
  --dmf-shadow-input:none;
  background:var(--dmf-page); color:var(--dmf-t1); font-family:var(--dmf-sans);
  min-height:100vh; min-height:100dvh; display:flex; flex-direction:column;
  container-type:inline-size; container-name:dmf;
  -webkit-font-smoothing:antialiased;
}
.dmf-root[data-dmf-theme="light"]{
  --dmf-page:#FFFFFF; --dmf-sidebar:#F4F4F6; --dmf-card:#F7F7F9; --dmf-card-hi:#F4F4F6;
  --dmf-border:#E4E4E9; --dmf-border-hi:#D5D5DC; --dmf-border-hover:#C6C6CF;
  --dmf-t1:#0B0B0F; --dmf-t2:#2A2A32; --dmf-t3:#55555E; --dmf-t4:#9A9AA8;
  --dmf-mint:#0FA36B; --dmf-mint-dim:rgba(15,163,107,.08); --dmf-ring:rgba(15,163,107,.35);
  --dmf-shadow-input:0 1px 3px rgba(0,0,0,.12);
}
.dmf-root *{box-sizing:border-box}
.dmf-root :where(button){font:inherit;color:inherit;background:none;border:0;cursor:pointer}
.dmf-root :is(button,[tabindex]):focus-visible{outline:none;box-shadow:0 0 0 3px var(--dmf-ring);border-radius:8px}
.dmf-micro{font-family:var(--dmf-mono);font-size:10px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--dmf-t3)}

.dmf-topbar{display:flex;align-items:center;gap:14px;padding:12px 40px;background:var(--dmf-page);border-bottom:1px solid var(--dmf-border);position:sticky;top:0;z-index:20}
.dmf-wordmark{font-size:21px;font-weight:700;letter-spacing:-.05em;line-height:1}
.dmf-i{position:relative;display:inline-block}
.dmf-coindot{position:absolute;width:.2em;height:.2em;border-radius:50%;background:#45E0A8;left:calc(50% + .03em);top:.02em;transform:translateX(-50%)}
.dmf-root[data-dmf-theme="light"] .dmf-coindot{box-shadow:0 0 0 1px #0B0B0F}
.dmf-topsep{width:1px;height:18px;background:var(--dmf-border-hi)}
.dmf-toptitle{font-size:14px;font-weight:600;color:var(--dmf-t2)}
.dmf-sync{margin-left:auto;display:flex;align-items:center;gap:10px}
.dmf-themebtn{font-family:var(--dmf-mono);font-size:10px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--dmf-t3);border:1px solid var(--dmf-border-hi);border-radius:8px;padding:6px 10px;position:relative}
.dmf-themebtn::after{content:"";position:absolute;inset:-8px}
.dmf-themebtn:hover{color:var(--dmf-t1);border-color:var(--dmf-border-hover)}

.dmf-scroll{flex:1;overflow-y:auto;padding:0 40px 60px;position:relative}
@media (max-width:767px){.dmf-scroll{padding-bottom:130px}}
.dmf-feedhead{position:sticky;top:0;z-index:10;padding:16px 0 10px;background:var(--dmf-page);border-bottom:1px solid var(--dmf-border);margin-bottom:10px;display:flex;align-items:center;gap:18px;flex-wrap:wrap}
.dmf-datenav{display:flex;align-items:center;gap:12px}
.dmf-sq{width:28px;height:28px;border-radius:8px;border:1px solid var(--dmf-border-hi);color:var(--dmf-t2);display:grid;place-items:center;position:relative;transition:border-color var(--dmf-t) var(--dmf-ease),color var(--dmf-t) var(--dmf-ease)}
.dmf-sq::after{content:"";position:absolute;inset:-8px}
.dmf-sq:hover{border-color:var(--dmf-border-hover);color:var(--dmf-t1)}
.dmf-sq:active{background:var(--dmf-card-hi)}
.dmf-datelbl{font-size:15px;font-weight:700;letter-spacing:-.005em;white-space:nowrap}
.dmf-sports{margin-left:auto;display:flex;gap:8px}
.dmf-chip{padding:8px 16px;border-radius:18px;font-size:13px;font-weight:600;color:var(--dmf-t3);white-space:nowrap;position:relative;transition:color var(--dmf-t) var(--dmf-ease),background var(--dmf-t) var(--dmf-ease)}
.dmf-chip::after{content:"";position:absolute;inset:-6px}
.dmf-chip:hover{color:var(--dmf-t1)}
.dmf-chip.dmf-active{background:var(--dmf-card-hi);color:var(--dmf-t1);box-shadow:inset 0 0 0 1px var(--dmf-border-hi)}

.dmf-list{display:flex;flex-direction:column;gap:12px;padding-top:6px}
.dmf-game{background:var(--dmf-card);border:1px solid var(--dmf-border);border-radius:16px;display:flex;flex-direction:column;overflow:hidden}
.dmf-game.dmf-pass{opacity:.82}
.dmf-gbody{display:grid;grid-template-columns:250px 1fr 240px;align-items:stretch}

.dmf-matchup{padding:14px 16px;display:flex;flex-direction:column;justify-content:center;gap:8px;min-width:0}
.dmf-status{display:flex;align-items:center;gap:7px;margin-bottom:2px}
.dmf-ld{width:7px;height:7px;border-radius:50%;background:var(--dmf-mint);animation:dmf-pulse 1.6s var(--dmf-ease) infinite}
.dmf-root[data-dmf-theme="light"] .dmf-ld{box-shadow:0 0 0 1px #0B0B0F}
@keyframes dmf-pulse{0%,100%{opacity:.55}50%{opacity:1}}
.dmf-lt{font-family:var(--dmf-mono);font-size:10px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--dmf-mint)}
.dmf-time{font-family:var(--dmf-mono);font-size:10.5px;font-weight:500;letter-spacing:.08em;color:var(--dmf-t3);text-transform:uppercase}
.dmf-teams{display:flex;flex-direction:column;gap:8px;min-width:0}
.dmf-teamrow{display:flex;align-items:center;gap:9px;min-width:0}
.dmf-crest{border-radius:50%;overflow:hidden;display:inline-grid;place-items:center;box-shadow:inset 0 0 0 1px var(--dmf-border-hi);background:var(--dmf-card-hi)}
.dmf-crest-mono{width:100%;height:100%;display:grid;place-items:center;font-weight:700;color:#fff;border-radius:50%}
.dmf-tname{font-size:15.5px;font-weight:700;letter-spacing:-.006em;color:var(--dmf-t1)}
.dmf-tscore{margin-left:auto;font-size:16px;font-weight:700;color:var(--dmf-t2);font-variant-numeric:tabular-nums}
.dmf-meta{font-family:var(--dmf-mono);font-size:10px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--dmf-t4);margin-top:2px;line-height:1.6}

.dmf-markets{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;border-left:1px solid var(--dmf-border);min-width:0}
.dmf-mkcol{padding:10px 8px 8px;border-right:1px solid var(--dmf-border);display:flex;flex-direction:column;min-width:0}
.dmf-mkcol:last-child{border-right:0}
.dmf-mktitle{display:flex;align-items:center;gap:5px;margin-bottom:7px}
.dmf-mktitle::before,.dmf-mktitle::after{content:"";flex:1;height:1px;background:var(--dmf-border)}
.dmf-mktitle span{font-family:var(--dmf-mono);font-size:10px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--dmf-t3);white-space:nowrap}
.dmf-mkbox{background:var(--dmf-card-hi);border:1px solid var(--dmf-border);border-radius:8px;flex:1;display:flex;flex-direction:column;overflow:hidden}
.dmf-mkhead{display:grid;grid-template-columns:minmax(72px,1.15fr) 1fr 1fr;column-gap:8px;padding:4px 6px 3px;border-bottom:1px solid var(--dmf-border)}
.dmf-mkhead span{font-family:var(--dmf-mono);font-size:10px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;text-align:center;color:var(--dmf-t4)}
.dmf-mkhead span:first-child{text-align:left}
.dmf-mkrow{display:grid;grid-template-columns:minmax(72px,1.15fr) 1fr 1fr;column-gap:8px;padding:6px 6px;align-items:center}
.dmf-mkrow + .dmf-mkrow{border-top:1px solid var(--dmf-border)}
.dmf-rlab{display:flex;align-items:center;gap:5px;min-width:0}
.dmf-lab{font-family:var(--dmf-mono);font-size:10px;font-weight:500;letter-spacing:.04em;color:var(--dmf-t3);text-transform:uppercase;white-space:nowrap}
.dmf-side{display:flex;align-items:center;justify-content:center;min-width:0;gap:4px}
.dmf-val{font-size:15px;font-weight:500;color:var(--dmf-t2);font-variant-numeric:tabular-nums;white-space:nowrap}
.dmf-model .dmf-val{font-weight:700;color:var(--dmf-t1)}
.dmf-model.dmf-sig .dmf-val{color:var(--dmf-mint)}
.dmf-wp{font-size:11px;color:var(--dmf-t3);font-weight:500;white-space:nowrap}
.dmf-mkfoot{margin-top:auto;border-top:1px solid var(--dmf-border);padding:4px 6px;display:flex;align-items:center;justify-content:center;gap:5px;font-family:var(--dmf-mono);letter-spacing:.05em;text-transform:uppercase;white-space:nowrap}
.dmf-mkfoot.dmf-edge{color:var(--dmf-mint);background:var(--dmf-mint-dim);font-size:11px;font-weight:500}
.dmf-mkfoot.dmf-none{color:var(--dmf-t4);font-size:10px;font-weight:500}

.dmf-verdict{border-left:1px solid var(--dmf-border);display:grid;grid-template-columns:1fr 1fr;align-content:center;gap:12px 4px;padding:12px 14px}
.dmf-vitem{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:0 4px;min-width:0}
.dmf-vitem.dmf-vpick{grid-column:1 / -1}
.dmf-vl{font-family:var(--dmf-mono);font-size:10px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--dmf-t4)}
.dmf-vv{font-size:17px;font-weight:700;letter-spacing:-.01em;color:var(--dmf-t1);font-variant-numeric:tabular-nums;white-space:nowrap;display:flex;align-items:center;gap:7px}
.dmf-vpick .dmf-vv{font-size:19px}
.dmf-vv.dmf-vsig{color:var(--dmf-mint)}
.dmf-pass .dmf-vv{color:var(--dmf-t3)}
.dmf-grade{display:inline-grid;place-items:center;min-width:32px;height:26px;padding:0 8px;border-radius:8px;font-size:15px;font-weight:700;background:var(--dmf-card-hi);box-shadow:inset 0 0 0 1px var(--dmf-border-hi);color:var(--dmf-t1)}

.dmf-empty,.dmf-invalid{padding:60px 0;text-align:center;color:var(--dmf-t3)}
.dmf-empty p,.dmf-invalid p{margin-top:8px;font-size:14px}
.dmf-skel{background:var(--dmf-card-hi);border-radius:6px}
.dmf-rg{padding:28px 0 8px;text-align:center}

/* mk7 (WC): matchup header, 4-col market grid, verdict strip */
.dmf-game.dmf-mk7 .dmf-gbody{grid-template-columns:1fr}
.dmf-game.dmf-mk7 .dmf-matchup{border-bottom:1px solid var(--dmf-border);display:grid;grid-template-columns:1fr auto;align-items:start;gap:4px 16px}
.dmf-game.dmf-mk7 .dmf-status{grid-column:1;grid-row:1}
.dmf-game.dmf-mk7 .dmf-meta{grid-column:2;grid-row:1;text-align:right;margin:0}
.dmf-game.dmf-mk7 .dmf-teams{grid-column:1 / -1;grid-row:2;max-width:420px}
.dmf-game.dmf-mk7 .dmf-markets{border-left:0;grid-auto-flow:row;grid-template-columns:repeat(4,1fr);grid-auto-columns:unset}
.dmf-game.dmf-mk7 .dmf-mkcol{border-bottom:1px solid var(--dmf-border)}
.dmf-game.dmf-mk7 .dmf-mkcol:nth-child(4n){border-right:0}
.dmf-game.dmf-mk7 .dmf-mkcol:last-child:nth-child(4n+3){grid-column:span 2;border-right:0}
.dmf-game.dmf-mk7 .dmf-verdict{display:flex;border-left:0;border-top:1px solid var(--dmf-border);background:var(--dmf-card-hi);padding:10px 16px;justify-content:center;gap:56px}
.dmf-game.dmf-mk7 .dmf-vitem{flex:0 0 auto}
.dmf-game.dmf-mk7 .dmf-vpick .dmf-vv{font-size:17px}

@container dmf (max-width: 1000px){
  .dmf-game.dmf-mk3 .dmf-gbody{grid-template-columns:1fr}
  .dmf-game.dmf-mk3 .dmf-matchup{border-bottom:1px solid var(--dmf-border)}
  .dmf-game.dmf-mk3 .dmf-markets{border-left:0;grid-auto-flow:row;grid-template-columns:repeat(3,1fr);grid-auto-columns:unset}
  .dmf-game.dmf-mk3 .dmf-mkcol{border-bottom:1px solid var(--dmf-border)}
  .dmf-game.dmf-mk3 .dmf-mkcol:nth-child(3n){border-right:0}
  .dmf-game.dmf-mk3 .dmf-verdict{display:flex;border-left:0;border-top:1px solid var(--dmf-border);background:var(--dmf-card-hi);padding:10px 16px;justify-content:center;gap:56px}
  .dmf-game.dmf-mk3 .dmf-vitem{flex:0 0 auto}
  .dmf-game.dmf-mk3 .dmf-vpick .dmf-vv{font-size:17px}
}
@container dmf (max-width: 700px){
  .dmf-game .dmf-markets{grid-template-columns:repeat(2,1fr) !important}
  .dmf-game .dmf-mkcol{border-right:1px solid var(--dmf-border) !important;border-bottom:1px solid var(--dmf-border)}
  .dmf-game .dmf-mkcol:nth-child(2n){border-right:0 !important}
  .dmf-game .dmf-mkcol:last-child:nth-child(odd){grid-column:1 / -1 !important;border-right:0 !important}
  .dmf-game.dmf-mk7 .dmf-matchup{grid-template-columns:1fr}
  .dmf-game.dmf-mk7 .dmf-meta{grid-column:1;grid-row:3;text-align:left}
  .dmf-game.dmf-mk7 .dmf-teams{grid-row:2}
  .dmf-game .dmf-verdict{display:flex !important;gap:0 !important;justify-content:space-between !important;padding:10px 12px !important}
  .dmf-game .dmf-vitem{flex:1 1 0 !important}
  .dmf-game .dmf-vpick .dmf-vv{font-size:16px !important}
  .dmf-wp{display:none}
  .dmf-topbar{padding-left:16px;padding-right:16px}
  .dmf-scroll{padding-left:16px;padding-right:16px}
}
@container dmf (max-width: 440px){
  .dmf-mkhead{grid-template-columns:1fr 1fr}
  .dmf-mkhead span:first-child{display:none}
  .dmf-mkrow{grid-template-columns:1fr 1fr;grid-template-rows:auto auto;row-gap:2px}
  .dmf-rlab{grid-column:1 / -1;justify-content:flex-start}
}
@media (prefers-reduced-motion: reduce){
  .dmf-root *{transition:none !important}
  .dmf-ld{animation:none;opacity:1}
}
@media (prefers-contrast: more){
  .dmf-root{--dmf-border:#33333E;--dmf-border-hi:#44444E;--dmf-t3:#B6B6C2;--dmf-t4:#8E8E9C}
  .dmf-root[data-dmf-theme="light"]{--dmf-border:#B9B9C2;--dmf-border-hi:#9A9AA6;--dmf-t3:#3A3A44;--dmf-t4:#55555E}
}
`;
