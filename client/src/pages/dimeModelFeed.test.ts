import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

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
 *   4. EMBEDDING — source-level structural serialization removes exactly the
 *      `nav.dmf-nav` subtree when `embeddedInShell=true`. The exclusion list is
 *      limited to that nav subtree; shell wrappers live outside this component.
 *      Crest/flag nodes and their props are not excluded and remain guarded.
 */

const src = fs.readFileSync(
  path.join(import.meta.dirname, "DimeModelFeed.tsx"),
  "utf8"
);
const appSrc = fs.readFileSync(
  path.join(import.meta.dirname, "..", "App.tsx"),
  "utf8"
);

describe("DimeModelFeed — WC odds bindings (production contract)", () => {
  it("ML binds away to the TOP row and home to the BOTTOM row", () => {
    expect(src).toMatch(/"ML",\s*\n\s*\{\s*\n\s*label: awayCode/);
    expect(src).toMatch(/book: dk\?\.away \?\? null/);
    expect(src).toMatch(/book: dk\?\.home \?\? null/);
  });

  it("TO ADV binds away/home to their own to-advance values", () => {
    expect(src).toMatch(
      /"To Adv",\s*\n\s*\{ label: awayCode, crest: awayCrest, book: dk\?\.toAdvanceAway/
    );
    expect(src).toMatch(
      /\{ label: homeCode, crest: homeCrest, book: dk\?\.toAdvanceHome/
    );
  });

  it("DBL CHC: HOME WD on top (homeDrawOdds + home crest), AWAY WD bottom", () => {
    expect(src).toMatch(
      /\{ label: "HOME WD", crest: homeCrest, book: dk\?\.homeDrawOdds/
    );
    expect(src).toMatch(
      /\{ label: "AWAY WD", crest: awayCrest, book: dk\?\.awayDrawOdds/
    );
    // HOME WD row must precede AWAY WD row.
    expect(src.indexOf('label: "HOME WD"')).toBeLessThan(
      src.indexOf('label: "AWAY WD"')
    );
  });

  it("DRAW top / NO DRAW bottom; BTTS YES top / NO bottom; O above U", () => {
    expect(src.indexOf('label: "DRAW"')).toBeLessThan(
      src.indexOf('label: "NO DRAW"')
    );
    expect(src.indexOf('label: "YES"')).toBeLessThan(
      src.indexOf('label: "NO",')
    );
    expect(src).toMatch(/label: `O \$\{totalLine\}`, book: dk\?\.overOdds/);
    expect(src).toMatch(/label: `U \$\{totalLine\}`, book: dk\?\.underOdds/);
  });

  it("SPREAD uses each side's own line and odds (away = awaySpreadLine/Odds)", () => {
    expect(src).toMatch(
      /aLine != null \? `\$\{awayCode\} \$\{fmtLine\(aLine\)\}`/
    );
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
    expect(src).not.toMatch(
      /embeddedInShell[^\n]*(?:crest|flag)|(?:crest|flag)[^\n]*embeddedInShell/i
    );
  });

  it("RULE 3: every market renders BOTH sides via twoWayCol(top, bottom)", () => {
    expect(src).toMatch(/function twoWayCol\(/);
    // WC card carries all 7 markets in production order.
    expect(src).toMatch(/\[toAdv, ml, draw, total, spread, dblChc, btts\]/);
  });

  it("brand law: mint token only (#45E0A8 dark / #0FA36B light), no neon/gold", () => {
    expect(src).toContain("#45E0A8");
    expect(src).toContain("#0FA36B");
    expect(src).not.toMatch(/#39FF14|#FFD700|#FF6B35|#22D3EE|#F87171/i);
  });

  it("round-aware WC stage label (Quarterfinal on Jul 9-13 window)", () => {
    expect(src).toMatch(/isoDate >= "2026-07-09" \? "Quarterfinal"/);
  });
});

describe("DimeModelFeed — routes", () => {
  it("registers both URL forms behind RequireAuth", () => {
    expect(appSrc).toMatch(/path="\/feed\/model\/:sport\/:date"/);
    expect(appSrc).toMatch(/path="\/feed\/model\/:sport"/);
    expect(appSrc).toMatch(/<RequireAuth><DimeModelFeed/);
  });

  it("parseFeedModelPath accepts slug and split forms", () => {
    expect(src).toMatch(/\^\(mlb\|wc\)-\\d\{2\}-\\d\{2\}-\\d\{4\}\$/);
  });

  it("bare /feed/model/:sport canonicalizes to today's dated URL (history replace)", () => {
    expect(src).toMatch(
      /if \(!date\) return \{ sport: sportCode, isoDate: null \}/
    );
    expect(src).toMatch(
      /navigate\(feedModelPath\(sport\), \{ replace: true \}\)/
    );
  });

  it("in-page navigation builds URLs through the canonical feedModelPath helper", () => {
    expect(src).toMatch(/from "@\/lib\/feedRoutes"/);
    expect(src).toMatch(/navigate\(feedModelPath\(nextSport, nextIso\)\)/);
  });
});

describe("DimeModelFeed — unified shell embedding", () => {
  it("accepts an optional embeddedInShell prop", () => {
    expect(src).toMatch(
      /export interface DimeModelFeedProps[\s\S]*embeddedInShell\?: boolean/
    );
    expect(src).toMatch(/function DimeModelFeed\(props: DimeModelFeedProps\)/);
  });

  it("suppresses only the duplicate dmf-nav subtree when embedded", () => {
    expect(src).toMatch(
      /!props\.embeddedInShell && \(\s*<nav className="dmf-nav"/
    );
    expect(src.match(/<nav className="dmf-nav"/g)).toHaveLength(1);
    expect(src).toMatch(/<div className="dmf-topbar">/);
    expect(src).toMatch(/<button\s+className="dmf-themebtn"/);
  });

  it("has no existing h1, so the shell may inject the sole sr-only focus heading", () => {
    expect(src).not.toMatch(/<h1\b/);
    expect(src).toMatch(
      /<span className="dmf-toptitle">AI Model Projections<\/span>/
    );
  });
});
