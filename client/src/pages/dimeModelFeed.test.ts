import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { WC_WINNER_MARKETS, buildFeedSections, slateStatusRank, wcDisplayCity, wcDisplayStadium, wcRoundLabel } from "./DimeModelFeed";

/**
 * Regression guards for the Dime AI Model Projections surface
 * (/feed/model/mlb-MM-DD-YYYY, /feed/model/wc-MM-DD-YYYY).
 *
 * Three protected properties:
 *   1. ODDS BINDINGS — the WC market bindings mirror the production
 *      WcFeedInline contract exactly (away = TOP row; DBL CHC crossed so
 *      HOME WD sits on top reading dkOdds.homeDrawOdds). These were the
 *      subject of money-critical orientation fixes and must never drift.
 *   2. OWNER RULES — crests/flags beside team labels, both sides per market,
 *      away-first row order, no legacy neon accent.
 *   3. ROUTES — both URL forms registered behind RequireAuth.
 *   4. EMBEDDING — serialization method: isolate the DimeModelFeed JSX source
 *      template, materialize standalone vs embedded conditional branches, then
 *      collapse whitespace. Exclusion list: the external shell wrapper (outside
 *      this component) and the intentionally suppressed `nav.dmf-nav` subtree.
 *      Crest/flag nodes and their props are never excluded.
 */

const src = fs.readFileSync(
  path.join(import.meta.dirname, "DimeModelFeed.tsx"),
  "utf8",
);
const appSrc = fs.readFileSync(
  path.join(import.meta.dirname, "..", "App.tsx"),
  "utf8",
);

const EMBEDDED_SERIALIZATION_EXCLUSIONS = Object.freeze([
  "external shell wrapper",
  "nav.dmf-nav",
]);
const EMBEDDED_NAV_CONDITIONAL = /\{!props\.embeddedInShell && \(\s*(<nav className="dmf-nav"[\s\S]*?<\/nav>)\s*\)\}/;

function serializeDimeModelFeedTemplate(mode: "standalone" | "embedded"): string {
  const start = src.indexOf('  return (\n    <div className="dmf-root"');
  const end = src.indexOf("\n}\n\n// ─── Data adapters", start);
  if (start < 0 || end < 0) throw new Error("DimeModelFeed JSX template anchors changed");

  const template = src.slice(start, end);
  if (!EMBEDDED_NAV_CONDITIONAL.test(template)) {
    throw new Error("embedded dmf-nav conditional changed");
  }

  const materialized = mode === "standalone"
    ? template.replace(EMBEDDED_NAV_CONDITIONAL, "$1")
    : template.replace(EMBEDDED_NAV_CONDITIONAL, "");
  return materialized.replace(/\s+/g, " ").trim();
}

function excludeSuppressedNav(serialized: string): string {
  return serialized
    .replace(/<nav className="dmf-nav"[\s\S]*?<\/nav>/, "")
    .replace(/\s+/g, " ")
    .trim();
}

describe("DimeModelFeed — WC odds bindings (production contract)", () => {
  it("ML binds away to the TOP row and home to the BOTTOM row", () => {
    expect(src).toMatch(/"ML",\s*\n\s*\{\s*\n\s*label: awayCode/);
    expect(src).toMatch(/book: dk\?\.away \?\? null/);
    expect(src).toMatch(/book: dk\?\.home \?\? null/);
  });

  it("TO ADV binds away/home to their own to-advance values", () => {
    expect(src).toMatch(/"To Adv",\s*\n\s*\{ label: awayCode, crest: awayCrest, book: dk\?\.toAdvanceAway/);
    expect(src).toMatch(/\{ label: homeCode, crest: homeCrest, book: dk\?\.toAdvanceHome/);
  });

  it("DBL CHC: HOME WD on top (homeDrawOdds + home crest), AWAY WD bottom", () => {
    expect(src).toMatch(/\{ label: "HOME WD", crest: homeCrest, book: dk\?\.homeDrawOdds/);
    expect(src).toMatch(/\{ label: "AWAY WD", crest: awayCrest, book: dk\?\.awayDrawOdds/);
    // HOME WD row must precede AWAY WD row.
    expect(src.indexOf('label: "HOME WD"')).toBeLessThan(src.indexOf('label: "AWAY WD"'));
  });

  it("DRAW top / NO DRAW bottom; BTTS YES top / NO bottom; O above U", () => {
    expect(src.indexOf('label: "DRAW"')).toBeLessThan(src.indexOf('label: "NO DRAW"'));
    expect(src.indexOf('label: "YES"')).toBeLessThan(src.indexOf('label: "NO",'));
    expect(src).toMatch(/label: `O \$\{totalLine\}`, book: dk\?\.overOdds/);
    expect(src).toMatch(/label: `U \$\{totalLine\}`, book: dk\?\.underOdds/);
  });

  it("SPREAD uses each side's own line and odds (away = awaySpreadLine/Odds)", () => {
    expect(src).toMatch(/aLine != null \? `\$\{awayCode\} \$\{fmtLine\(aLine\)\}`/);
    expect(src).toMatch(/book: dk\?\.awaySpreadOdds \?\? null/);
    expect(src).toMatch(/book: dk\?\.homeSpreadOdds \?\? null/);
  });

  it("ML/DRAW edges use the 3-way calc (calculate3WayResult), not 2-way", () => {
    expect(src).toMatch(/calculate3WayResult\(threeWayBook, threeWayModel\)/);
    expect(src).toMatch(/calc3\.away\.edgePP >= EDGE_THRESHOLD_PP/);
    expect(src).toMatch(/calc3\.draw\.edgePP >= EDGE_THRESHOLD_PP/);
  });

  it("uses matchesByDate (exact date), never todayWithOdds", () => {
    expect(src).toMatch(/trpc\.wc2026\.matchesByDate\.useQuery/);
    expect(src).not.toMatch(/todayWithOdds/);
  });
});
describe("DimeModelFeed — MLB bindings", () => {
  it("run line prefers VSiN awayRunLine/homeRunLine with book-spread fallback", () => {
    expect(src).toMatch(/n\(g\.awayRunLine\) \?\? n\(g\.awayBookSpread\)/);
    expect(src).toMatch(/n\(g\.homeRunLine\) \?\? n\(g\.homeBookSpread\)/);
    expect(src).toMatch(/n\(g\.awayRunLineOdds\)/);
  });

  it("gates model values on modelRunAt (null ⇒ invalidated model)", () => {
    expect(src).toMatch(/g\.modelRunAt != null/);
  });

  it("exact {sport, gameDate} contract with 60s poll + placeholderData", () => {
    expect(src).toMatch(/\{ sport: "MLB", gameDate: isoDate \}/);
    expect(src).toMatch(/refetchInterval: 60 \* 1000/);
    expect(src).toMatch(/placeholderData/);
  });

  it("slate sorts earliest → latest first pitch (owner directive 2026-07-17)", () => {
    expect(src).toMatch(
      /\.sort\(\(a, b\) => timeToMinutes\(a\.startTimeEst\) - timeToMinutes\(b\.startTimeEst\)\)/
    );
  });

  it("LIVE games rank above upcoming, settled/final sink last (2026-07-18)", () => {
    expect(slateStatusRank({ liveLabel: "LIVE · BOT 9TH", timeLabel: "9:40 PM ET" })).toBe(0);
    expect(slateStatusRank({ liveLabel: null, timeLabel: "7:05 PM ET" })).toBe(1);
    expect(slateStatusRank({ liveLabel: null, timeLabel: "FINAL" })).toBe(2);
    expect(slateStatusRank({ liveLabel: null, timeLabel: "FINAL (PENS)" })).toBe(2);
    // The tier sort is applied to BOTH league sections of the combined slate
    // (per-section — the WC-above-MLB section order is absolute).
    expect(src.match(/\.sort\(\(a, b\) => slateStatusRank\(a\) - slateStatusRank\(b\)\)/g)).toHaveLength(2);
  });
});

describe("DimeModelFeed — owner rules", () => {
  it("RULE 2/4: team crests resolved for both MLB (registry) and WC (flagUrl)", () => {
    expect(src).toMatch(/MLB_BY_ABBREV\.get\(awayAbbr\)/);
    expect(src).toMatch(/m\.awayTeam\?\.flagUrl \?\? fifaFlagUrl\(awayCode\)/);
    // Market rows and verdict pick carry the crest.
    expect(src).toMatch(/<Crest c=\{r\.crest\} size=\{14\}/);
    expect(src).toMatch(/<Crest c=\{v\.crest\} size=\{18\}/);
  });

  it("RULE 2 zero-diff: embedding does not branch or alter crest/flag rendering", () => {
    expect(src.match(/function Crest\(/g)).toHaveLength(1);
    expect(src.match(/<Crest c=\{/g)).toHaveLength(4);
    expect(src).not.toMatch(/embeddedInShell[^\n]*(?:crest|flag)|(?:crest|flag)[^\n]*embeddedInShell/i);
  });

  it("RULE 3: every market renders BOTH sides via twoWayCol(top, bottom)", () => {
    expect(src).toMatch(/function twoWayCol\(/);
    // WC card carries the markets in production order; TO ADV is gated on the
    // book actually offering the market (absent for the 3rd-place match and
    // the Final, which have no next round).
    expect(src).toMatch(/hasAdvMarket = dk\?\.toAdvanceAway != null \|\| dk\?\.toAdvanceHome != null/);
    // Winner market takes the ML slot on the two winner-scope cards
    // (owner directive 2026-07-18); all other WC cards keep the 3-way ML.
    expect(src).toMatch(/\[\.\.\.\(hasAdvMarket \? \[toAdv\] : \[\]\), winner \?\? ml, draw, total, spread, dblChc, btts\]/);
  });

  it("three-color law: mint #45E0A8 only (both themes), no neon/gold/legacy-mint", () => {
    expect(src).toContain("#45E0A8");
    expect(src).not.toContain("#0FA36B");
    expect(src).not.toMatch(/#39FF14|#FFD700|#FF6B35|#22D3EE|#F87171/i);
  });

  it("round-aware WC stage label (Quarterfinal on Jul 9-13 window)", () => {
    expect(src).toMatch(/isoDate >= "2026-07-09" \? "Quarterfinal"/);
  });
});

describe("DimeModelFeed — WC round + venue display (owner directive 2026-07-18)", () => {
  it("labels Jul 19 'World Cup Final' and Jul 18 '3rd Place Match'", () => {
    expect(wcRoundLabel("2026-07-19")).toBe("World Cup Final");
    expect(wcRoundLabel("2026-07-18")).toBe("3rd Place Match");
    expect(wcRoundLabel("2026-07-14")).toBe("Semifinal");
  });

  it("maps owner venues to City, ST and keeps the DB city otherwise", () => {
    expect(wcDisplayCity("Hard Rock Stadium", "Miami Gardens")).toBe("Miami, FL");
    expect(wcDisplayCity("MetLife Stadium", "East Rutherford")).toBe("East Rutherford, NJ");
    expect(wcDisplayCity("Estadio Azteca", "Mexico City")).toBe("Mexico City");
    expect(wcDisplayCity(null, "Dallas")).toBe("Dallas");
    expect(wcDisplayCity("Hard Rock Stadium (Miami)", "Miami Gardens")).toBe("Miami, FL");
  });
});

describe("DimeModelFeed — routes", () => {
  it("registers both URL forms behind RequireAuth", () => {
    expect(appSrc).toMatch(/path="\/feed\/model\/:sport\/:date"/);
    expect(appSrc).toMatch(/path="\/feed\/model\/:sport"/);
    // whitespace-tolerant: prettier may fold the route JSX across lines
    expect(appSrc.replace(/\s+/g, " ")).toMatch(
      /<RequireAuth> ?<DimeModelFeed/
    );
  });

  it("parseFeedModelPath accepts slug and split forms", () => {
    expect(src).toMatch(/\^\(mlb\|wc\)-\\d\{2\}-\\d\{2\}-\\d\{4\}\$/);
  });

  it("bare /feed/model/:sport canonicalizes to today's dated URL (history replace)", () => {
    expect(src).toMatch(/if \(!date\) return \{ sport: sportCode, isoDate: null \}/);
    expect(src).toMatch(
      /navigate\(resolveRouteHref\(feedModelPath\(sport\)\), \{ replace: true \}\)/
    );
  });

  it("in-page navigation builds URLs through the canonical feedModelPath helper", () => {
    expect(src).toMatch(/from "@\/lib\/feedRoutes"/);
    // Combined feed (2026-07-18): date nav canonicalizes on the mlb- slug —
    // one URL per date; legacy wc- deep links still parse and render.
    expect(src).toMatch(
      /navigate\(resolveRouteHref\(feedModelPath\("MLB", nextIso\)\)\)/
    );
  });
});

describe("DimeModelFeed — WC winner-scope markets (owner directive 2026-07-18)", () => {
  it("owner book prices + verified orientation are pinned for both matches", () => {
    // Graded on whoever WINS the match when it settles (90'+ET+pens).
    expect(WC_WINNER_MARKETS["wc26-3rd-103"]).toEqual({
      title: "World Cup 3rd Place",
      homeCode: "FRA", awayCode: "ENG",
      bookHome: -215, bookAway: 170,
    });
    expect(WC_WINNER_MARKETS["wc26-final-104"]).toEqual({
      title: "To Win the World Cup",
      homeCode: "ESP", awayCode: "ARG",
      bookHome: -150, bookAway: 130,
    });
    expect(Object.keys(WC_WINNER_MARKETS)).toHaveLength(2);
  });

  it("winner model odds bind to model_*_to_advance (v27 ET+pens winner scope)", () => {
    // Both the To Adv column and the winner market read mo.toAdvance* — the
    // winner market is the second binding (away top, home bottom).
    expect(src.match(/model: mo\?\.toAdvanceAway \?\? null/g)).toHaveLength(2);
    expect(src.match(/model: mo\?\.toAdvanceHome \?\? null/g)).toHaveLength(2);
    expect(src).toMatch(/book: winnerSpec\.bookAway, model: mo\?\.toAdvanceAway/);
    expect(src).toMatch(/book: winnerSpec\.bookHome, model: mo\?\.toAdvanceHome/);
  });

  it("the winner market replaces ML only under the orientation guard", () => {
    expect(src).toMatch(/winnerSpec\.homeCode === homeCode && winnerSpec\.awayCode === awayCode/);
    expect(src).toMatch(/winner \?\? ml, draw, total, spread, dblChc, btts/);
  });

  it("(90 Min) tags exactly Draw, Spread, Dbl Chc, and BTTS — never Total", () => {
    expect(src).toMatch(/t90\("Draw"\)/);
    expect(src).toMatch(/t90\("Spread"\)/);
    expect(src).toMatch(/t90\("Dbl Chc"\)/);
    expect(src).toMatch(/t90\("BTTS"\)/);
    expect(src).toMatch(/twoWayCol\(\s*"Total"/); // Total keeps its plain header
  });
});

describe("DimeModelFeed — combined slate (owner directive 2026-07-18)", () => {
  const card = (id: string): Parameters<typeof buildFeedSections>[0][number] =>
    ({ id, liveLabel: null, timeLabel: "7:05 PM ET" }) as Parameters<typeof buildFeedSections>[0][number];

  it("sections order is absolute: World Cup on top, MLB beneath", () => {
    const sections = buildFeedSections([card("wc-1"), card("wc-2")], [card("mlb-1")]);
    expect(sections.map((s) => s.key)).toEqual(["WC", "MLB"]);
    // Full spelled-out league names own the header width (2026-07-18).
    expect(sections[0].label).toBe("2026 FIFA World Cup");
    expect(sections[1].label).toBe("Major League Baseball (MLB)");
    expect(sections[0].cards.map((c) => c.id)).toEqual(["wc-1", "wc-2"]);
    expect(sections[1].cards.map((c) => c.id)).toEqual(["mlb-1"]);
  });

  it("a league with no games renders no section (no empty WC header post-final)", () => {
    expect(buildFeedSections([], [card("mlb-1")]).map((s) => s.key)).toEqual(["MLB"]);
    expect(buildFeedSections([card("wc-1")], []).map((s) => s.key)).toEqual(["WC"]);
    expect(buildFeedSections([], [])).toEqual([]);
  });

  it("the sport toggle chips are gone; both league queries always load", () => {
    expect(src).not.toMatch(/dmf-chip|dmf-sports|role="tablist"/);
    // Neither query is gated on a sport tab anymore — both enable on the date.
    expect(src.match(/enabled: !!isoDate/g)).toHaveLength(2);
  });

  it("league sections are collapsible containers with logo + full name, no counts", () => {
    // Native details/summary, open by default; chevron affordance pair.
    expect(src).toMatch(/<details key=\{section\.key\} className="dmf-league" open>/);
    expect(src).toMatch(/<summary className="dmf-leaguehead">/);
    expect(src).toMatch(/dmf-lgchev--expand/);
    expect(src).toMatch(/dmf-lgchev--collapse/);
    // No game counts anywhere in the header or feedhead (2026-07-18).
    expect(src).not.toMatch(/section\.cards\.length\}\s*\{/);
    expect(src).not.toMatch(/dmf-slatecount/);
    expect(src).not.toMatch(/\bnoun\b: "/);
  });

  it("league logos: theme-keyed WC emblem (same-size box) + current MLB mark", () => {
    expect(src).toMatch(/\/brand\/wc26-emblem-on-light\.png/);
    expect(src).toMatch(/\/brand\/wc26-emblem-on-dark\.png/);
    // The actual current MLB mark (owner directive 2026-07-21): the official
    // mlbstatic league SVG (already shipped on splits/tracker), falling back
    // to the bundled recolored mark before hiding.
    expect(src).toMatch(/https:\/\/www\.mlbstatic\.com\/team-logos\/league-on-dark\/1\.svg/);
    expect(src).toMatch(/img\.src = "\/brand\/mlb-logo\.png"/);
    // CSS swaps variants by theme; both render inside the fixed 30px box
    // (1.25x scale, owner directive 2026-07-18).
    expect(src).toMatch(/data-dmf-theme="light"\] \.dmf-lglogo-dark\{display:none\}/);
    expect(src).toMatch(/:not\(\[data-dmf-theme="light"\]\) \.dmf-lglogo-light\{display:none\}/);
    expect(src).toMatch(/\.dmf-lglogo\{[^}]*width:30px;height:30px/);
    // Header cluster centers within the page; chevron holds the right edge.
    expect(src).toMatch(/\.dmf-leaguehead\{[^}]*justify-content:center/);
    expect(src).toMatch(/\.dmf-lgchev\{position:absolute;right:8px/);
  });

  it("desktop emphasis pass (owner directive 2026-07-21)", () => {
    // 5x centered shell page title tracked by the sticky feedhead offset.
    expect(src).toMatch(/\.dc-shell-external-scroll \.dmf-topbar\{height:96px;justify-content:center\}/);
    expect(src).toMatch(/\.dc-shell-external-scroll \.dmf-toptitle\{font-size:min\(70px/);
    // top:96px keeps tracking the title band (Round 4 Wave 3, item 6 adds the
    // header-rhythm properties in the SAME rule — see the dedicated describe
    // block below for the full 24/32px contract).
    expect(src).toMatch(/\.dc-shell-external-scroll \.dmf-feedhead\{top:96px;/);
    // 2x MLB league logo box; responsive game columns are covered below.
    expect(src).toMatch(/\.dmf-lglogo--mlb\{width:60px;height:60px/);
  });

  it("lays out projection games 1-up on mobile, 2-up on tablet, and 3-up on desktop", () => {
    expect(src).toMatch(
      /\.dmf-leaguebody\{display:grid;grid-template-columns:minmax\(0,1fr\);align-items:start;gap:12px;margin-top:12px\}/,
    );
    expect(src).toMatch(
      /@media \(min-width:768px\)\{\s*\.dmf-leaguebody\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/,
    );
    expect(src).toMatch(
      /@media \(min-width:1024px\)\{[\s\S]*?\.dmf-leaguebody\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\);align-items:stretch\}/,
    );
  });

  it("stadium display drops a trailing parenthetical (2026-07-18)", () => {
    expect(wcDisplayStadium("MetLife Stadium (NY/NJ)")).toBe("MetLife Stadium");
    expect(wcDisplayStadium("Hard Rock Stadium (Miami)")).toBe("Hard Rock Stadium");
    expect(wcDisplayStadium("Estadio Azteca")).toBe("Estadio Azteca");
    expect(wcDisplayStadium(null)).toBeNull();
    expect(wcDisplayStadium("(weird)")).toBe("(weird)"); // never emit an empty name
    // wcDisplayCity still receives the RAW stadium string for pattern matching.
    expect(src).toMatch(/\[wcDisplayStadium\(m\.venue\?\.stadium\), wcDisplayCity\(m\.venue\?\.stadium/);
  });
});

/** Round 4 Wave 3, item 6 (docs/superpowers/plans/2026-07-23-feed-desktop-polish.md;
 *  law: design-system/dime-ai/pages/ai-model-projections.md "Date nav" line, amended
 *  2026-07-23). Shell/desktop (>=1024px) only — <1024px and the standalone /feed
 *  topbar (no 96px title band) must stay byte-identical to the shipped surface. */
describe("DimeModelFeed — header rhythm (Round 4 Wave 3, item 6)", () => {
  it("shell-desktop date nav centers under the title band with the 24/32px rhythm", () => {
    // 24px title-band -> date-nav (padding-top); date text scales 15 -> 17px;
    // the row centers instead of sitting left-aligned under the 5x title.
    expect(src).toMatch(
      /\.dc-shell-external-scroll \.dmf-feedhead\{top:96px;justify-content:center;padding-top:24px;padding-bottom:10px;margin-bottom:16px\}/,
    );
    expect(src).toMatch(/\.dc-shell-external-scroll \.dmf-datelbl\{font-size:17px\}/);
  });

  it("the 32px date-nav -> league header gap is padding-bottom + margin-bottom + the pre-existing .dmf-list top padding", () => {
    // 10 (padding-bottom) + 16 (margin-bottom) + 6 (.dmf-list padding-top,
    // untouched by item 6) = 32px of space, matching the law's fixed rhythm
    // step; the feedhead's pre-existing 1px divider border sits between the
    // padding and margin (33px edge-to-edge — divider, not rhythm).
    expect(src).toMatch(/padding-bottom:10px;margin-bottom:16px/);
    expect(src).toMatch(/\.dmf-list\{display:flex;flex-direction:column;gap:12px;padding-top:6px;/);
  });

  it("is scoped to the shell wrapper inside the single >=1024px block only (item 8 scoping)", () => {
    const desktopBlockStart = src.indexOf("@media (min-width:1024px){");
    const desktopBlockEnd = src.indexOf("@media (prefers-reduced-motion: reduce){", desktopBlockStart);
    expect(desktopBlockStart).toBeGreaterThan(-1);
    expect(desktopBlockEnd).toBeGreaterThan(desktopBlockStart);
    const desktopBlock = src.slice(desktopBlockStart, desktopBlockEnd);
    expect(desktopBlock).toContain(".dc-shell-external-scroll .dmf-feedhead{top:96px;justify-content:center");
    expect(desktopBlock).toContain(".dc-shell-external-scroll .dmf-datelbl{font-size:17px}");
    // Not duplicated anywhere else in the stylesheet (standalone /feed and
    // <1024px keep the shipped compact layout — no rhythm override leaks out).
    const outside = src.slice(0, desktopBlockStart) + src.slice(desktopBlockEnd);
    expect(outside).not.toMatch(/dmf-datelbl\{font-size:17px\}/);
    expect(outside).not.toMatch(/dmf-feedhead\{[^}]*padding-top:24px/);
  });

  it("<1024px and standalone keep the shipped 15px date label and 16/10px feedhead padding untouched", () => {
    const base = src.slice(0, src.indexOf("@media (min-width:1024px){"));
    expect(base).toMatch(/\.dmf-feedhead\{position:sticky;top:46px;z-index:10;padding:16px 0 10px;/);
    expect(base).toMatch(/\.dmf-datelbl\{font-size:15px;font-weight:700;/);
  });
});

describe("DimeModelFeed — unified shell embedding", () => {
  it("accepts an optional embeddedInShell prop", () => {
    expect(src).toMatch(/export interface DimeModelFeedProps[\s\S]*embeddedInShell\?: boolean/);
    expect(src).toMatch(/resolveRouteHref\?: \(href: string\) => string/);
    expect(src).toMatch(/function DimeModelFeed\(props: DimeModelFeedProps\)/);
  });

  it("serializes standalone and embedded templates with only the declared exclusions", () => {
    expect(EMBEDDED_SERIALIZATION_EXCLUSIONS).toEqual([
      "external shell wrapper",
      "nav.dmf-nav",
    ]);
    const standalone = serializeDimeModelFeedTemplate("standalone");
    const embedded = serializeDimeModelFeedTemplate("embedded");
    expect(excludeSuppressedNav(standalone)).toBe(embedded);
  });

  it("suppresses only the duplicate dmf-nav subtree when embedded", () => {
    expect(src).toMatch(/!props\.embeddedInShell && \(\s*<nav className="dmf-nav"/);
    expect(src.match(/<nav className="dmf-nav"/g)).toHaveLength(1);
    expect(src).toMatch(/<div className="dmf-topbar">/);
    // Theme control lives in Profile only (owner directive 2026-07-17) — the
    // feed header must NOT render its own toggle on any surface.
    expect(src).not.toMatch(/dmf-themebtn/);
  });

  it("has no existing h1, so the shell may inject the sole sr-only focus heading", () => {
    expect(src).not.toMatch(/<h1\b/);
    expect(src).toMatch(/<span className="dmf-toptitle">AI Model Projections<\/span>/);
  });
});
