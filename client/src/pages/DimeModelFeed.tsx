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
import { ChevronDown, ChevronUp } from "lucide-react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import type { inferRouterOutputs } from "@trpc/server";
import { keepPreviousData } from "@tanstack/react-query";
import { trpc, type AppRouter } from "@/lib/trpc";
import { useTheme } from "@/contexts/ThemeContext";
import { ProjectionCard } from "@/components/projections/ProjectionCard";
import { presentationToProjectionGame } from "@/components/projections/fromPresentation";
import { sportAdapters } from "@/lib/sport/presentation";
import { MLB_BY_ABBREV } from "@shared/mlbTeams";
import { formatGameTime, timeToMinutes } from "@/lib/gameUtils";
import {
  calculateEdge,
  calculate3WayResult,
  EDGE_THRESHOLD_PP,
  type ThreeWayOdds,
} from "@/lib/edgeUtils";
import { feedModelPath, bettingSplitsPath, toFeedSlugDate } from "@/lib/feedRoutes";

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
  /** Quiet secondary line under the mobile matchup header (venue / round). */
  venueLine?: string | null;
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

/**
 * Black or white ink for a monogram on a `hex` disc (WCAG relative luminance,
 * threshold 0.5) — light team discs need black ink, not hardcoded white.
 * Duplicated in client/src/components/TeamLogo.tsx (no shared export without
 * a new file) — keep in sync.
 */
function inkFor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#FFFFFF";
  const n = parseInt(m[1], 16);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.5 ? "#000000" : "#FFFFFF";
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
          style={{
            background: c.bg || "var(--dmf-card-hi)",
            // Team-colored disc: compute ink from disc luminance. No bg: the
            // CSS default var(--dmf-t1) is the theme ink for the card-hi disc.
            color: c.bg ? inkFor(c.bg) : undefined,
            fontSize: Math.max(7, size * 0.34),
          }}
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
          {g.venueLine ? <div className="dmf-venue">{g.venueLine}</div> : null}
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

export interface DimeModelFeedProps {
  sport?: string;
  date?: string;
  /** The unified app shell owns primary navigation when this surface is embedded. */
  embeddedInShell?: boolean;
  /** Allows the shell to preserve a local-only preview capability in route changes. */
  resolveRouteHref?: (href: string) => string;
}

const identityRouteHref = (href: string) => href;

export default function DimeModelFeed(props: DimeModelFeedProps) {
  const [, navigate] = useLocation();
  const resolveRouteHref = props.resolveRouteHref ?? identityRouteHref;
  const parsed = parseFeedModelPath(props.sport, props.date);
  // Theme is app-global (ThemeContext) so the choice follows the user across
  // every tab and the bottom tab bar. ?theme= is still honored for embeds.
  const { theme, setTheme } = useTheme();
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("theme");
      if ((q === "light" || q === "dark") && setTheme) setTheme(q);
    } catch {
      /* no-op */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sport = parsed?.sport ?? "MLB";
  const isoDate = parsed?.isoDate ?? "";

  // Bare-sport URLs (/feed/model/mlb) canonicalize to today's dated URL —
  // replace, so back-button never re-lands on the dateless form.
  const needsDateCanonicalize = parsed !== null && parsed.isoDate === null;
  useEffect(() => {
    if (needsDateCanonicalize) {
      navigate(resolveRouteHref(feedModelPath(sport)), { replace: true });
    }
  }, [needsDateCanonicalize, sport, navigate, resolveRouteHref]);

  // Discord account-link feedback lands here now (the legacy /dashboard
  // consumer is unrouted): surface it once, then strip the params.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linked = params.get("discord_linked");
    const linkError = params.get("discord_error");
    if (!linked && !linkError) return;
    if (linked === "1") toast.success("Discord account linked.");
    else if (linkError) toast.error(`Discord link failed: ${linkError.replace(/_/g, " ")}`);
    params.delete("discord_linked");
    params.delete("discord_error");
    const qs = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, []);

  // ADAPTER WIRING (exact bindings from GameCard / WcFeedInline) is attached
  // below in useFeedCards — see mlbRowToCard / wcMatchToCard. The feed is
  // combined (owner directive 2026-07-18): both leagues load for the date.
  const { sections, isLoading, isStale, gamesCount } = useFeedCards(isoDate);

  // Date nav canonicalizes on the mlb- slug: the combined feed has one URL per
  // date. Legacy wc- deep links still parse and render the same combined slate.
  const go = (nextIso: string) =>
    navigate(resolveRouteHref(feedModelPath("MLB", nextIso)));

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
        {/* One Dime identity per page (directive §6): when embedded in the app
            shell, the sidebar already carries the Dime brand — repeating the
            wordmark here would put two Dime logos on the same page. Standalone
            /feed keeps the wordmark so the surface is still branded. */}
        {!props.embeddedInShell && (
          <>
            <span className="dmf-wordmark" aria-label="dime">
              d<span className="dmf-i">ı<span className="dmf-coindot" /></span>me
            </span>
            <span className="dmf-topsep" />
          </>
        )}
        <span className="dmf-toptitle">AI Model Projections</span>
        <div className="dmf-sync">
          {/* Outbound nav — the canonical feed must never be a dead end
              (tablet/desktop have no bottom tab bar; non-owners never do) */}
          {!props.embeddedInShell && (
            <nav className="dmf-nav" aria-label="Dime surfaces">
              <Link href={bettingSplitsPath("MLB")} className="dmf-navlink">Splits</Link>
              <Link href="/chat" className="dmf-navlink">Chat</Link>
              <Link href="/profile" className="dmf-navlink">Profile</Link>
            </nav>
          )}
          {/* No theme toggle here — the Profile tab's Appearance setting is the
              single theme control (owner directive 2026-07-17). ?theme= embeds
              are still honored via the effect above. */}
        </div>
      </div>

      <div className="dmf-scroll">
        <div className="dmf-feedhead">
          <div className="dmf-datenav">
            <button className="dmf-sq" aria-label="Previous day" onClick={() => go(shiftIso(isoDate, -1))}>
              ‹
            </button>
            <div className="dmf-datelbl">{prettyDate(isoDate)}</div>
            <button className="dmf-sq" aria-label="Next day" onClick={() => go(shiftIso(isoDate, 1))}>
              ›
            </button>
          </div>
          {/* Combined slate (owner directive 2026-07-18): no sport toggle and
              no slate count — the league headers below own identification;
              the feedhead's bottom border stays as the divider. */}
        </div>

        <div className={`dmf-list${isStale ? " dmf-stale" : ""}`} aria-busy={isStale}>
          {isLoading && gamesCount === 0 ? (
            <>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </>
          ) : gamesCount === 0 ? (
            <div className="dmf-empty">
              <span className="dmf-micro">No games for this date</span>
              <p>Try the date arrows above.</p>
            </div>
          ) : (
            // Combined slate, league-sectioned (owner directive 2026-07-18):
            // World Cup on top, MLB beneath — buildFeedSections owns the order
            // and drops empty leagues. Each league is a COLLAPSIBLE container
            // (native details/summary, open by default): official league logo
            // + the full spelled-out name across the row, chevron affordance
            // at the right edge. The WC emblem is theme-keyed (black FIFA
            // wordmark on light, white on dark — CSS swaps by data-dmf-theme;
            // both render in the same fixed box). A missing logo file hides
            // itself and the header stays clean text.
            sections.map((section) => (
              <details key={section.key} className="dmf-league" open>
                <summary className="dmf-leaguehead">
                  <span className={`dmf-lglogo${section.key === "MLB" ? " dmf-lglogo--mlb" : ""}`} aria-hidden="true">
                    {section.key === "WC" ? (
                      <>
                        <img
                          className="dmf-lglogo-light"
                          src="/brand/wc26-emblem-on-light.png"
                          alt=""
                          loading="lazy"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                        <img
                          className="dmf-lglogo-dark"
                          src="/brand/wc26-emblem-on-dark.png"
                          alt=""
                          loading="lazy"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      </>
                    ) : (
                      // The actual current MLB mark (navy/red, owner directive
                      // 2026-07-21) — the official mlbstatic league SVG already
                      // shipped on the splits/tracker surfaces, with the bundled
                      // recolored mark as offline fallback before hiding.
                      <img
                        src="https://www.mlbstatic.com/team-logos/league-on-dark/1.svg"
                        alt=""
                        loading="lazy"
                        onError={(e) => {
                          const img = e.target as HTMLImageElement;
                          if (img.src.endsWith("/brand/mlb-logo.png")) {
                            img.style.display = "none";
                          } else {
                            img.src = "/brand/mlb-logo.png";
                          }
                        }}
                      />
                    )}
                  </span>
                  <span className="dmf-lgname">{section.label}</span>
                  <ChevronDown className="dmf-lgchev dmf-lgchev--expand" aria-hidden="true" />
                  <ChevronUp className="dmf-lgchev dmf-lgchev--collapse" aria-hidden="true" />
                </summary>
                <div className="dmf-leaguebody">
                  {section.cards.map((g) => {
                    const model =
                      section.key === "WC"
                        ? sportAdapters.SOCCER(g, { competition: "World Cup" })
                        : sportAdapters.MLB(g, { competition: "MLB" });
                    return <ProjectionCard key={g.id} game={presentationToProjectionGame(model)} />;
                  })}
                </div>
              </details>
            ))
          )}
        </div>
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
// Exported for DimeModelFeed.doubleheader.test.ts — the card id is the render
// key, so its per-EVENT uniqueness (doubleheader safety) is pinned by tests.

export function mlbRowToCard(g: MlbRow): FeedCardSpec {
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

  // Ballpark only — pitcher names are off the gamecards (owner directive
  // 2026-07-17). venueLine matches, so the presentation layer dedupes it and
  // the card renders the ballpark exactly once.
  const meta = g.venue || "MLB";

  return {
    // Stable event identity = DB primary key. The fallback must stay unique per
    // EVENT, not per matchup: two doubleheader games share awayAbbr/homeAbbr on
    // the same date, so a bare `${away}-${home}` key would collapse them into
    // one React key and silently drop a card. Include date + start time +
    // gameNumber so even the id-less fallback cannot merge distinct games.
    id: String(
      g.id ??
      `${awayAbbr}-${homeAbbr}-${g.gameDate ?? ""}-${g.startTimeEst ?? ""}-${(g as { gameNumber?: number | null }).gameNumber ?? 1}`
    ),
    liveLabel: isLive ? `LIVE${g.gameClock ? ` · ${g.gameClock}` : ""}` : null,
    timeLabel: isFinal ? "FINAL" : formatGameTime(g.startTimeEst),
    away: { name: awayReg?.nickname ?? awayAbbr, crest: awayCrest, score: isLive || isFinal ? (g.awayScore != null ? String(g.awayScore) : null) : null },
    home: { name: homeReg?.nickname ?? homeAbbr, crest: homeCrest, score: isLive || isFinal ? (g.homeScore != null ? String(g.homeScore) : null) : null },
    meta,
    venueLine: g.venue || null,
    markets: [rl, total, ml],
    verdict: verdictOf(best),
  };
}

// ── WC adapter (bindings: WcFeedInline WcDesktopMergedPanel, away = TOP) ─────

const fifaFlagUrl = (code: string): string =>
  `https://api.fifa.com/api/v3/picture/flags-sq-4/${code.toUpperCase()}`;

/** Round label by PT kickoff-day thresholds (WcFeedInline stage ternary). */
export function wcRoundLabel(isoDate: string): string {
  return isoDate >= "2026-07-19" ? "World Cup Final"
    : isoDate >= "2026-07-18" ? "3rd Place Match"
    : isoDate >= "2026-07-14" ? "Semifinal"
    : isoDate >= "2026-07-09" ? "Quarterfinal"
    : isoDate >= "2026-07-04" ? "Round of 16"
    : isoDate >= "2026-06-28" ? "Round of 32"
    : "Group Stage";
}

/** Owner display map (2026-07-18): stadium → "City, ST". Replaces the DB city
 *  wholesale ("Miami Gardens" → "Miami, FL"); stadiums not listed keep their
 *  DB city. Substring match so provider naming variants still hit. */
const WC_VENUE_CITY_DISPLAY: ReadonlyArray<readonly [pattern: string, city: string]> = [
  ["hard rock", "Miami, FL"],
  ["metlife", "East Rutherford, NJ"],
];
export function wcDisplayCity(
  stadium: string | null | undefined,
  city: string | null | undefined,
): string | null {
  const s = (stadium ?? "").toLowerCase();
  for (const [pattern, display] of WC_VENUE_CITY_DISPLAY) {
    if (s.includes(pattern)) return display;
  }
  return city || null;
}

/** Stadium display name drops a trailing parenthetical (owner directive
 *  2026-07-18): "MetLife Stadium (NY/NJ)" reads "MetLife Stadium" — the city
 *  line beside it already carries the location. Display-only: wcDisplayCity
 *  keeps matching on the RAW stadium string. */
export function wcDisplayStadium(stadium: string | null | undefined): string | null {
  if (!stadium) return null;
  const stripped = stadium.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return stripped || stadium;
}

function fmtKickoffEt(kickoffUtc: string | Date | null | undefined): string {
  if (!kickoffUtc) return "TBD";
  const d = typeof kickoffUtc === "string" ? new Date(kickoffUtc) : kickoffUtc;
  if (Number.isNaN(d.getTime())) return "TBD";
  return (
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET"
  );
}

/** Owner winner-scope markets (2026-07-18): the two remaining WC matches
 *  replace their MONEYLINE column with a match-WINNER market — graded on
 *  whoever wins the match when it settles, regardless of 90'+injury time,
 *  extra time, or penalties. Book prices are OWNER-PROVIDED (2026-07-18).
 *  Model prices are the v27 engine's model_*_to_advance (ET+pens
 *  sub-simulation: P(win 90') + P(draw)×[ET λ/3 + pens 50.5/49.5]) — for
 *  these two matches that is literally "wins the match outright" (engine
 *  header, v27_jul18_engine.mjs), i.e. the exact same grading scope. They
 *  reach the card as mo.toAdvanceHome/Away via wc2026_model_projections.
 *  homeCode/awayCode pin the v27-verified orientation (FRA home vs ENG away;
 *  ESP home vs ARG away) — if the live row ever disagreed, the card falls
 *  back to the plain 3-way ML rather than misassign the owner book prices. */
export const WC_WINNER_MARKETS: Record<
  string,
  { title: string; homeCode: string; awayCode: string; bookHome: number; bookAway: number }
> = {
  "wc26-3rd-103": { title: "World Cup 3rd Place", homeCode: "FRA", awayCode: "ENG", bookHome: -215, bookAway: 170 },
  "wc26-final-104": { title: "To Win the World Cup", homeCode: "ESP", awayCode: "ARG", bookHome: -150, bookAway: 130 },
};

function wcMatchToCard(m: WcMatch, isoDate: string): FeedCardSpec {
  const awayCode = m.awayTeam?.fifaCode ?? m.awayTeamId.toUpperCase();
  const homeCode = m.homeTeam?.fifaCode ?? m.homeTeamId.toUpperCase();
  const awayCrest: CrestSpec = { url: m.awayTeam?.flagUrl ?? fifaFlagUrl(awayCode), code: awayCode };
  const homeCrest: CrestSpec = { url: m.homeTeam?.flagUrl ?? fifaFlagUrl(homeCode), code: homeCode };
  const dk = m.dkOdds;
  const mo = m.modelOdds;

  // Winner-scope override applies ONLY when the live orientation matches the
  // v27-verified home/away — the owner book prices bind positionally.
  const winnerSpec = WC_WINNER_MARKETS[m.matchId];
  const winnerApplies =
    winnerSpec != null && winnerSpec.homeCode === homeCode && winnerSpec.awayCode === awayCode;
  // Clarity rule (owner directive 2026-07-18): with the winner market on the
  // card, the 90-minute-scoped markets say so in their headers.
  const t90 = (title: string): string => (winnerApplies ? `${title} (90 Min)` : title);

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

  // WINNER MARKET (owner directive 2026-07-18) — replaces ML on the 3rd-place
  // match and the Final. Away top / home bottom (card row order). Book = the
  // owner-provided winner prices; model = mo.toAdvanceHome/Away — the v27
  // ET+pens winner odds, the exact same "wins the match however it settles"
  // scope — so calculateEdge(book, model) inside twoWayCol IS the precise
  // 2-way edge for this market (the model side is fair: pAdvH + pAdvA = 1).
  const winner = winnerApplies
    ? twoWayCol(
        winnerSpec.title,
        { label: awayCode, crest: awayCrest, book: winnerSpec.bookAway, model: mo?.toAdvanceAway ?? null },
        { label: homeCode, crest: homeCrest, book: winnerSpec.bookHome, model: mo?.toAdvanceHome ?? null },
      )
    : null;
  if (process.env.NODE_ENV === "development" && winnerSpec && !winnerApplies) {
    console.warn(
      `[wcMatchToCard:WINNER] ${m.matchId}: live orientation ${awayCode}@${homeCode} disagrees with ` +
        `verified ${winnerSpec.awayCode}@${winnerSpec.homeCode} — falling back to plain ML (owner odds NOT applied)`,
    );
  }

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

  // DRAW — DRAW top / NO DRAW bottom (owner spec). 90-min scope tagged when
  // the winner market is on the card.
  const draw = twoWayCol(
    t90("Draw"),
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
    t90("Spread"),
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
    t90("Dbl Chc"),
    { label: "HOME WD", crest: homeCrest, book: dk?.homeDrawOdds ?? null, model: mo?.homeDrawOdds ?? null },
    { label: "AWAY WD", crest: awayCrest, book: dk?.awayDrawOdds ?? null, model: mo?.awayDrawOdds ?? null },
  );

  // BTTS — YES top / NO bottom.
  const btts = twoWayCol(
    t90("BTTS"),
    { label: "YES", book: dk?.bttsYes ?? null, model: mo?.bttsYes ?? null },
    { label: "NO", book: dk?.bttsNo ?? null, model: mo?.bttsNo ?? null },
  );

  // TO ADVANCE only exists as a book market when there IS a next round — the
  // 3rd-place match and the Final carry no such market (book adv NULL), so the
  // column is dropped for those cards instead of rendering dashes.
  const hasAdvMarket = dk?.toAdvanceAway != null || dk?.toAdvanceHome != null;
  // Winner market takes the ML slot on the 3rd-place match and the Final
  // (owner directive 2026-07-18); every other card keeps the 3-way ML.
  const markets = [...(hasAdvMarket ? [toAdv] : []), winner ?? ml, draw, total, spread, dblChc, btts];
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

  // Round and venue are separate card lines (owner directive 2026-07-18):
  // the context line carries the round only, and the full venue renders on
  // its own line beneath it so the stadium is never truncated.
  const venueBits = [wcDisplayStadium(m.venue?.stadium), wcDisplayCity(m.venue?.stadium, m.venue?.city)]
    .filter(Boolean)
    .join(" · ");
  const meta = wcRoundLabel(isoDate);

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
    venueLine: venueBits || null,
    markets,
    verdict: verdictOf(best),
  };
}

/** Slate status tier (owner directive 2026-07-18): LIVE games always sit
 *  above upcoming games, and settled/final games sink to the bottom.
 *  Within a tier the existing order holds — Array.sort is stable, so MLB
 *  keeps earliest-first-pitch order and WC keeps the server's match order.
 *  timeLabel prefix covers both "FINAL" and "FINAL (PENS)". */
export function slateStatusRank(card: Pick<FeedCardSpec, "liveLabel" | "timeLabel">): number {
  if (card.liveLabel) return 0;
  return card.timeLabel.startsWith("FINAL") ? 2 : 1;
}

// ── Query orchestration (contracts: exact {sport, gameDate}; 60s poll;
//    placeholderData keeps the previous slate while the next date loads) ─────

/** One league group in the combined slate. */
export interface FeedSection {
  key: "WC" | "MLB";
  /** Full spelled-out league name for the collapsible header (owner directive
   *  2026-07-18: no game counts in the header — the name owns the width). */
  label: string;
  cards: FeedCardSpec[];
}

/** Combined slate (owner directive 2026-07-18): ONE collective feed for the
 *  date — World Cup section on top, MLB beneath it (CBS-scores league grouping;
 *  only the grouping/order is mirrored, nothing else). A league renders only
 *  when it has games that date, so post-final WC dates are pure MLB with no
 *  empty header. Within a section the existing slate order holds. */
export function buildFeedSections(
  wcCards: FeedCardSpec[],
  mlbCards: FeedCardSpec[],
): FeedSection[] {
  const sections: FeedSection[] = [];
  if (wcCards.length > 0) sections.push({ key: "WC", label: "2026 FIFA World Cup", cards: wcCards });
  if (mlbCards.length > 0) sections.push({ key: "MLB", label: "Major League Baseball (MLB)", cards: mlbCards });
  return sections;
}

function useFeedCards(
  isoDate: string,
): { sections: FeedSection[]; isLoading: boolean; isStale: boolean; gamesCount: number } {
  // Both leagues load together — the combined feed has no sport toggle
  // (owner directive 2026-07-18), so neither query is gated on a tab.
  const mlbQuery = trpc.games.list.useQuery(
    { sport: "MLB", gameDate: isoDate },
    {
      enabled: !!isoDate,
      refetchOnWindowFocus: false,
      refetchInterval: 60 * 1000,
      staleTime: 60 * 1000,
      placeholderData: (prev) => prev,
    },
  );
  const wcQuery = trpc.wc2026.matchesByDate.useQuery(
    { date: isoDate },
    {
      enabled: !!isoDate,
      refetchOnWindowFocus: false,
      refetchInterval: 60 * 1000,
      staleTime: 60 * 1000,
      placeholderData: keepPreviousData,
    },
  );

  const sections = useMemo<FeedSection[]>(() => {
    // Slate order per league: earliest → latest first pitch (owner directive
    // 2026-07-17; timeToMinutes sends TBD times to the bottom), then LIVE
    // above upcoming above FINAL (2026-07-18) — the stable sort keeps the
    // time order within each tier. Tiers apply WITHIN a league section; the
    // WC-above-MLB section order is absolute.
    const wcCards = ((wcQuery.data ?? []) as WcMatch[])
      .map((m) => wcMatchToCard(m, isoDate))
      .sort((a, b) => slateStatusRank(a) - slateStatusRank(b));
    const mlbCards = [...((mlbQuery.data ?? []) as MlbRow[])]
      .sort((a, b) => timeToMinutes(a.startTimeEst) - timeToMinutes(b.startTimeEst))
      .map(mlbRowToCard)
      .sort((a, b) => slateStatusRank(a) - slateStatusRank(b));
    return buildFeedSections(wcCards, mlbCards);
  }, [wcQuery.data, mlbQuery.data, isoDate]);

  const isLoading = wcQuery.isLoading || mlbQuery.isLoading;
  // Stale = paging dates while placeholderData keeps the previous slate
  // mounted — the UI dims so the old cards are never mistaken for the new
  // date's numbers (this is a betting surface; wrong-slate reads cost money).
  const isStale =
    (wcQuery.isPlaceholderData && wcQuery.isFetching) ||
    (mlbQuery.isPlaceholderData && mlbQuery.isFetching);
  const gamesCount = sections.reduce((n, s) => n + s.cards.length, 0);
  return { sections, isLoading, isStale, gamesCount };
}

// ─── Scoped stylesheet — MASTER.md tokens verbatim, v4 reference layout ──────

const DMF_CSS = `
.dmf-root{
  /* THREE-COLOR LAW — dark: black ground, white ink/borders, mint the one accent */
  --dmf-page:#000000; --dmf-sidebar:#000000; --dmf-card:#000000; --dmf-card-hi:#000000;
  --dmf-border:#FFFFFF; --dmf-border-hi:#FFFFFF; --dmf-border-hover:#FFFFFF;
  --dmf-t1:#FFFFFF; --dmf-t2:#FFFFFF; --dmf-t3:#FFFFFF; --dmf-t4:#FFFFFF;
  --dmf-mint:#45E0A8; --dmf-mint-dim:transparent; --dmf-ring:#45E0A8;
  --dmf-ease:cubic-bezier(.16,1,.3,1); --dmf-t:160ms;
  --dmf-mono:"Familjen Grotesk",system-ui,-apple-system,"Segoe UI",sans-serif;
  --dmf-sans:"Familjen Grotesk",system-ui,-apple-system,"Segoe UI",sans-serif;
  --dmf-shadow-input:none;
  background:var(--dmf-page); color:var(--dmf-t1); font-family:var(--dmf-sans);
  min-height:100vh; min-height:100dvh; display:flex; flex-direction:column;
  container-type:inline-size; container-name:dmf;
  -webkit-font-smoothing:antialiased;
}
.dmf-root[data-dmf-theme="light"]{
  /* THREE-COLOR LAW — light: white ground, black ink/borders, mint the one accent */
  --dmf-page:#FFFFFF; --dmf-sidebar:#FFFFFF; --dmf-card:#FFFFFF; --dmf-card-hi:#FFFFFF;
  --dmf-border:#000000; --dmf-border-hi:#000000; --dmf-border-hover:#000000;
  --dmf-t1:#000000; --dmf-t2:#000000; --dmf-t3:#000000; --dmf-t4:#000000;
  --dmf-mint:#45E0A8; --dmf-mint-dim:transparent; --dmf-ring:#45E0A8;
  --dmf-shadow-input:none;
}
.dmf-root *{box-sizing:border-box}
.dmf-root :where(button){font:inherit;color:inherit;background:none;border:0;cursor:pointer;touch-action:manipulation}
.dmf-root :where(a){touch-action:manipulation}
.dmf-root :is(button,[tabindex]):focus-visible{outline:none;box-shadow:0 0 0 3px var(--dmf-ring);border-radius:8px}
.dmf-micro{font-family:var(--dmf-mono);font-size:10px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--dmf-t3)}

.dmf-topbar{display:flex;align-items:center;gap:14px;height:46px;padding:0 40px;background:var(--dmf-page);border-bottom:1px solid var(--dmf-border);position:sticky;top:0;z-index:20}
.dmf-wordmark{font-size:21px;font-weight:700;letter-spacing:-.05em;line-height:1}
.dmf-i{position:relative;display:inline-block}
.dmf-coindot{position:absolute;width:.2em;height:.2em;border-radius:50%;background:#45E0A8;left:calc(50% + .03em);top:.02em;transform:translateX(-50%)}
.dmf-root[data-dmf-theme="light"] .dmf-coindot{box-shadow:0 0 0 1px #000000}
.dmf-topsep{width:1px;height:18px;background:var(--dmf-border-hi)}
.dmf-toptitle{font-size:14px;font-weight:600;color:var(--dmf-t2)}
.dmf-sync{margin-left:auto;display:flex;align-items:center;gap:10px}
.dmf-nav{display:flex;align-items:center;gap:4px}
.dmf-navlink{font-family:var(--dmf-mono);font-size:10px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--dmf-t3);text-decoration:none;padding:6px 8px;border-radius:8px;position:relative;transition:color var(--dmf-t) var(--dmf-ease)}
.dmf-navlink::after{content:"";position:absolute;inset:-8px -2px}
.dmf-navlink:hover{color:var(--dmf-t1)}

/* Document scroll (no inner overflow) — otherwise .dmf-scroll becomes a
   never-scrolling scrollport and the sticky slate header can never stick. */
.dmf-scroll{flex:1;padding:0 40px 60px;position:relative}
@media (max-width:767px){.dmf-scroll{padding-bottom:130px}}
.dmf-feedhead{position:sticky;top:46px;z-index:10;padding:16px 0 10px;background:var(--dmf-page);border-bottom:1px solid var(--dmf-border);margin-bottom:10px;display:flex;align-items:center;gap:18px;flex-wrap:wrap}
.dmf-datenav{display:flex;align-items:center;gap:12px}
.dmf-sq{width:28px;height:28px;border-radius:8px;border:1px solid var(--dmf-border-hi);color:var(--dmf-t2);display:grid;place-items:center;position:relative;transition:border-color var(--dmf-t) var(--dmf-ease),color var(--dmf-t) var(--dmf-ease)}
.dmf-sq::after{content:"";position:absolute;inset:-8px}
.dmf-sq:hover{border-color:var(--dmf-border-hover);color:var(--dmf-t1)}
.dmf-sq:active{background:var(--dmf-card-hi)}
.dmf-datelbl{font-size:15px;font-weight:700;letter-spacing:-.005em;white-space:nowrap}
.dmf-list{display:flex;flex-direction:column;gap:12px;padding-top:6px;transition:opacity var(--dmf-t) var(--dmf-ease)}
.dmf-list.dmf-stale{opacity:.45;pointer-events:none}
/* League sections (owner directive 2026-07-18): the combined slate groups by
   league — World Cup on top, MLB beneath — and each is a COLLAPSIBLE
   container (native details/summary, open by default). Header row spans the
   full container width: official league logo (fixed 30px box, so the two WC
   emblem variants render the same size) + the spelled-out league name,
   centered as a cluster within the page; chevron affordance at the right
   edge. No game counts. The second section opens with a hairline rule. */
.dmf-league{display:block}
.dmf-league + .dmf-league{margin-top:10px;padding-top:16px;border-top:1px solid var(--dmf-border)}
/* Header content (logo + spelled-out name) centers within the page at 1.25x
   scale (owner directive 2026-07-18): 30px logo box, 15px label (clamped so
   "MAJOR LEAGUE BASEBALL (MLB)" stays one line on 320-375px phones), chevron
   pinned to the right edge outside the centered cluster. The side padding
   reserves the chevron's lane so the cluster never overlaps it. */
.dmf-leaguehead{display:flex;align-items:center;justify-content:center;gap:12px;width:100%;min-height:44px;padding:2px 32px;position:relative;cursor:pointer;list-style:none;font-family:var(--dmf-mono);font-size:clamp(12px,3.9vw,15px);font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--dmf-t2);border-radius:10px;transition:color var(--dmf-t) var(--dmf-ease),background var(--dmf-t) var(--dmf-ease)}
.dmf-leaguehead::-webkit-details-marker{display:none}
.dmf-leaguehead::marker{content:""}
.dmf-leaguehead:hover{color:var(--dmf-t1)}
.dmf-leaguehead:focus-visible{outline:none;box-shadow:0 0 0 3px var(--dmf-ring)}
.dmf-lglogo{display:inline-grid;place-items:center;width:30px;height:30px;flex:0 0 30px}
.dmf-lglogo img{max-width:100%;max-height:100%;object-fit:contain}
/* WC emblem is theme-keyed: black FIFA wordmark on light, white on dark. */
.dmf-root[data-dmf-theme="light"] .dmf-lglogo-dark{display:none}
.dmf-root:not([data-dmf-theme="light"]) .dmf-lglogo-light{display:none}
.dmf-lgname{flex:0 1 auto;min-width:0;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dmf-lgchev{position:absolute;right:8px;top:50%;transform:translateY(-50%);width:20px;height:20px;color:var(--dmf-t3)}
.dmf-lgchev--collapse{display:none}
.dmf-league[open] .dmf-lgchev--expand{display:none}
.dmf-league[open] .dmf-lgchev--collapse{display:inline-block}
.dmf-leaguebody{display:flex;flex-direction:column;gap:12px;margin-top:12px}
.dmf-game{background:var(--dmf-card);border:1px solid var(--dmf-border);border-radius:16px;display:flex;flex-direction:column;overflow:hidden;container-type:inline-size}/* card-level container: key type below scales by the CARD's width (cqi), not the viewport. Named @container dmf rules still target .dmf-root. */
.dmf-game.dmf-pass{opacity:.82}
.dmf-gbody{display:grid;grid-template-columns:250px 1fr 240px;align-items:stretch}

.dmf-matchup{padding:14px 16px;display:flex;flex-direction:column;justify-content:center;gap:8px;min-width:0}
.dmf-status{display:flex;align-items:center;gap:7px;margin-bottom:2px}
.dmf-ld{width:7px;height:7px;border-radius:50%;background:var(--dmf-mint);animation:dmf-pulse 1.6s var(--dmf-ease) infinite}
.dmf-root[data-dmf-theme="light"] .dmf-ld{box-shadow:0 0 0 1px #000000}
@keyframes dmf-pulse{0%,100%{opacity:.55}50%{opacity:1}}
.dmf-lt{font-family:var(--dmf-mono);font-size:10px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--dmf-mint)}
.dmf-time{font-family:var(--dmf-mono);font-size:10.5px;font-weight:500;letter-spacing:.08em;color:var(--dmf-t3);text-transform:uppercase}
.dmf-teams{display:flex;flex-direction:column;gap:8px;min-width:0}
.dmf-teamrow{display:flex;align-items:center;gap:9px;min-width:0}
.dmf-crest{border-radius:50%;overflow:hidden;display:inline-grid;place-items:center;box-shadow:inset 0 0 0 1px var(--dmf-border-hi);background:var(--dmf-card-hi)}
.dmf-crest-mono{width:100%;height:100%;display:grid;place-items:center;font-weight:700;color:var(--dmf-t1);border-radius:50%}
.dmf-tname{font-size:clamp(13.5px,7px + 1.3cqi,15.5px);font-weight:700;letter-spacing:-.006em;color:var(--dmf-t1)}
.dmf-tscore{margin-left:auto;font-size:16px;font-weight:700;color:var(--dmf-t2);font-variant-numeric:tabular-nums}
.dmf-meta{font-family:var(--dmf-mono);font-size:10px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--dmf-t4);margin-top:2px;line-height:1.6}
/* Mobile-only matchup elements — hidden on desktop (>=768px keeps dmf-meta). */
.dmf-venue{display:none}

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
.dmf-vv{font-size:clamp(14.5px,7px + 1.45cqi,17px);font-weight:700;letter-spacing:-.01em;color:var(--dmf-t1);font-variant-numeric:tabular-nums;white-space:nowrap;display:flex;align-items:center;gap:7px}
.dmf-vpick .dmf-vv{font-size:clamp(16px,8px + 1.6cqi,19px)}
.dmf-vv.dmf-vsig{color:var(--dmf-mint)}
.dmf-pass .dmf-vv{color:var(--dmf-t3)}
.dmf-grade{display:inline-grid;place-items:center;min-width:32px;height:26px;padding:0 8px;border-radius:8px;font-size:15px;font-weight:700;background:var(--dmf-card-hi);box-shadow:inset 0 0 0 1px var(--dmf-border-hi);color:var(--dmf-t1)}

.dmf-empty,.dmf-invalid{padding:60px 0;text-align:center;color:var(--dmf-t3)}
.dmf-empty p,.dmf-invalid p{margin-top:8px;font-size:14px}
.dmf-skel{background:color-mix(in srgb, var(--dmf-t1) 8%, transparent);border-radius:6px}

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

/* 1200 (not 1000): at 1001-1200px containers the 250|1fr|240 desktop grid
   left the three market columns ~17-43px value tracks — Book/Model odds
   overlapped on every iPad landscape (1024/1080/1180). Stack until true
   desktop widths. */
@container dmf (max-width: 1200px){
  .dmf-game.dmf-mk3 .dmf-gbody{grid-template-columns:1fr}
  .dmf-game.dmf-mk3 .dmf-matchup{border-bottom:1px solid var(--dmf-border)}
  .dmf-game.dmf-mk3 .dmf-markets{border-left:0;grid-auto-flow:row;grid-template-columns:repeat(3,1fr);grid-auto-columns:unset}
  .dmf-game.dmf-mk3 .dmf-mkcol{border-bottom:1px solid var(--dmf-border)}
  .dmf-game.dmf-mk3 .dmf-mkcol:nth-child(3n){border-right:0}
  .dmf-game.dmf-mk3 .dmf-verdict{display:flex;border-left:0;border-top:1px solid var(--dmf-border);background:var(--dmf-card-hi);padding:10px 16px;justify-content:center;gap:56px}
  .dmf-game.dmf-mk3 .dmf-vitem{flex:0 0 auto}
  .dmf-game.dmf-mk3 .dmf-vpick .dmf-vv{font-size:17px}
}
/* WC cards: 4-across squeezes the ML win%% annotation into the Book column
   on iPad portrait (768-834) — drop to 2x2 well before that point. */
@container dmf (max-width: 900px){
  .dmf-game.dmf-mk7 .dmf-markets{grid-template-columns:repeat(2,1fr)}
  .dmf-game.dmf-mk7 .dmf-mkcol{border-right:1px solid var(--dmf-border)}
  .dmf-game.dmf-mk7 .dmf-mkcol:nth-child(2n){border-right:0}
  .dmf-game.dmf-mk7 .dmf-mkcol:last-child:nth-child(odd){grid-column:1 / -1;border-right:0}
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
@container dmf (max-width: 520px){
  .dmf-toptitle,.dmf-topsep{display:none}
}
@container dmf (max-width: 440px){
  .dmf-mkhead{grid-template-columns:1fr 1fr}
  .dmf-mkhead span:first-child{display:none}
  .dmf-mkrow{grid-template-columns:1fr 1fr;grid-template-rows:auto auto;row-gap:2px}
  .dmf-rlab{grid-column:1 / -1;justify-content:flex-start}
  /* 320-360px: keep the date row inside the viewport without shrinking the
     28px arrows (their ::after keeps the effective hit area at 44px) */
  .dmf-datenav{flex-wrap:wrap;gap:8px}
  .dmf-datelbl{font-size:13.5px}
  .dmf-feedhead{gap:10px}
}
/* MOBILE (<768px): the bottom tab bar owns navigation (hide dmf-nav; theme
   control lives in Profile). Page chrome centers on one axis — the dime
   wordmark sits in the middle of the topbar and the date nav stacks centered
   beneath it (owner directive 2026-07-17; the sport chips are gone — the
   feed is combined per 2026-07-18). Bare transparent logos (no circle
   chrome); market grids align Book/Model as identical right-aligned tabular
   columns; row labels drop mono/all-caps for Grotesk 600. Desktop (>=768px)
   is untouched. */
@media (max-width:767px){
  .dmf-root .dmf-nav{display:none}
  /* Wordmark centered: dmf-sync is empty on mobile (nav hidden, no theme
     button) — hide it so its auto margin cannot pull the mark off-center.
     2x wordmark (owner directive 2026-07-18): the topbar grows to hold it
     and the sticky feedhead offset below tracks the new height. */
  .dmf-root .dmf-topbar{padding-left:16px;padding-right:16px;justify-content:center;height:64px}
  .dmf-root .dmf-wordmark{font-size:42px}
  .dmf-root .dmf-sync{display:none}
  .dmf-root .dmf-scroll{padding-left:16px;padding-right:16px}
  /* Date picker centered (no slate count — owner directive 2026-07-18; the
     collapsible league headers below span full width with logo + chevron). */
  .dmf-root .dmf-feedhead{top:64px;flex-direction:row;flex-wrap:wrap;justify-content:center;align-items:center;gap:10px 12px}
  .dmf-root .dmf-datenav{justify-content:center;flex-wrap:nowrap;gap:8px}
  .dmf-root .dmf-datelbl{font-size:13px}
  /* Verdict micro-labels ride the t3 label tier so Pick/Edge/Grade clear
     4.5:1 on the elevated card ground. */
  .dmf-root .dmf-vl{color:var(--dmf-t3)}

  /* Bare logos: no circle background/border/clip. The monogram fallback
     keeps its own disc (it needs the team-color ground to read). */
  .dmf-root .dmf-crest{border-radius:0;box-shadow:none;background:transparent;overflow:visible}
  .dmf-root .dmf-teams .dmf-crest{width:30px !important;height:30px !important;flex-basis:30px !important}

  /* One-row matchup header, centered rhythm. */
  .dmf-root .dmf-matchup{padding:14px 14px 12px;gap:8px}
  .dmf-root .dmf-status{justify-content:center;margin-bottom:0}
  .dmf-root .dmf-time{font-size:11px}
  .dmf-root .dmf-teams{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:8px 14px;max-width:none}
  .dmf-root .dmf-teams .dmf-teamrow:first-child{grid-column:1;grid-row:1}
  .dmf-root .dmf-teams .dmf-teamrow:last-child{grid-column:3;grid-row:1;flex-direction:row-reverse}
  .dmf-root .dmf-teamrow{gap:8px}
  .dmf-root .dmf-tname{font-size:14px;line-height:1.2;min-width:0}
  .dmf-root .dmf-tscore{margin-left:0;font-size:16px}
  .dmf-root .dmf-game .dmf-meta{display:none}
  .dmf-root .dmf-venue{display:block;text-align:center;font-size:12px;font-weight:500;letter-spacing:0;color:var(--dmf-t3);line-height:1.4}

  /* Markets: every card (MLB mk3 and WC mk7) stacks full-width so all
     markets share one aligned grid; Book and Model are identical-width
     columns with right-aligned Grotesk 700 tabular values (16px floor). */
  .dmf-root .dmf-game.dmf-mk3 .dmf-markets,
  .dmf-root .dmf-game.dmf-mk7 .dmf-markets{grid-template-columns:1fr !important}
  .dmf-root .dmf-game.dmf-mk3 .dmf-mkcol,
  .dmf-root .dmf-game.dmf-mk7 .dmf-mkcol{border-right:0 !important}
  .dmf-root .dmf-mkcol{padding:10px 12px}
  .dmf-root .dmf-mkhead{grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr);column-gap:10px;padding:5px 10px 4px}
  /* t3 (not desktop's t4): 4.5:1 floor on the dark card for these headers. */
  .dmf-root .dmf-mkhead span{text-align:right;color:var(--dmf-t3)}
  .dmf-root .dmf-mkhead span:first-child{display:block;text-align:left}
  .dmf-root .dmf-mkrow{grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr);grid-template-rows:auto;row-gap:0;column-gap:10px;padding:8px 10px;min-height:40px;align-items:center}
  .dmf-root .dmf-rlab{grid-column:auto;justify-content:flex-start;gap:7px}
  .dmf-root .dmf-lab{font-family:var(--dmf-sans);font-size:13px;font-weight:600;letter-spacing:0;text-transform:none;color:var(--dmf-t1)}
  .dmf-root .dmf-side{justify-content:flex-end}
  .dmf-root .dmf-val{font-size:16px;font-weight:700}
  .dmf-root .dmf-mkfoot{font-size:11px;padding:6px}
  .dmf-root .dmf-mkfoot.dmf-none{color:var(--dmf-t3)}
}
/* DESKTOP (>=1024px) emphasis pass (owner directive 2026-07-21):
   1) Inside the app shell the page title centers at 5x scale (14px -> 70px,
      shaved via cqi only where the pane is too narrow for one line). Scoped
      by the shell scroll wrapper so the standalone /feed topbar (wordmark +
      nav links) keeps its compact row. The topbar grows to a fixed 96px and
      the sticky feedhead offset tracks it; the empty dmf-sync spacer hides so
      the title truly centers.
   2) The MLB league-header logo box doubles (30px -> 60px).
   3) League bodies pack games 2-across (grid) to cut the single-column
      whitespace; each ProjectionCard is its own container and reflows to the
      half-width column on its own. align-items:stretch (Round 4 Wave 2, item 1
      — owner amendment 2026-07-23 to "start-aligned", annotated in
      design-system/dime-ai/pages/ai-model-projections.md) stretches row-mates
      to equal height; ProjectionCard.css's matching @media(min-width:1024px)
      block turns the surplus height into a centered summary + a
      bottom-pinned "VIEW FULL AI MODEL PROJECTIONS" expander per card.
   4) Round 4 Wave 3, item 6 (owner amendment 2026-07-23, annotated on the
      "Date nav" line in design-system/dime-ai/pages/ai-model-projections.md):
      the date nav becomes ONE centered header stack directly beneath the
      96px title band, replacing the old left-aligned leftover from the
      compact topbar. Fixed rhythm kills the old dead 16px-top/10px-bottom
      padding: padding-top:24px is exactly the gap from the title band's
      bottom edge to the date-nav row; padding-bottom:10px + margin-bottom:16px
      + the pre-existing (untouched — item 6 is shell/desktop-only, <1024 and
      standalone keep their shipped rhythm) .dmf-list padding-top:6px sum to
      the 32px gap down to the league header. Date text scales 15px -> 17px.
      top:96px is unchanged, so the sticky feedhead offset keeps tracking the
      96px title band exactly as the 07-21 law requires. */
@media (min-width:1024px){
  .dc-shell-external-scroll .dmf-topbar{height:96px;justify-content:center}
  .dc-shell-external-scroll .dmf-toptitle{font-size:min(70px,calc((100cqi - 80px)/10.8));line-height:1;letter-spacing:-.02em;white-space:nowrap}
  .dc-shell-external-scroll .dmf-sync{display:none}
  .dc-shell-external-scroll .dmf-feedhead{top:96px;justify-content:center;padding-top:24px;padding-bottom:10px;margin-bottom:16px}
  .dc-shell-external-scroll .dmf-datelbl{font-size:17px}
  .dmf-lglogo--mlb{width:60px;height:60px;flex:0 0 60px}
  .dmf-leaguebody{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:stretch}
}
@media (prefers-reduced-motion: reduce){
  .dmf-root *{transition:none !important}
  .dmf-ld{animation:none;opacity:1}
}
@media (prefers-contrast: more){
  .dmf-root{--dmf-border:#FFFFFF;--dmf-border-hi:#FFFFFF;--dmf-t3:#FFFFFF;--dmf-t4:#FFFFFF}
  .dmf-root[data-dmf-theme="light"]{--dmf-border:#000000;--dmf-border-hi:#000000;--dmf-t3:#000000;--dmf-t4:#000000}
}
`;
