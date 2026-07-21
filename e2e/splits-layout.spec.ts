/**
 * Splits layout — desktop/tablet overflow + divider-crossing contract
 * ═══════════════════════════════════════════════════════════════════
 * Reproduces the 2026-07-21 owner report: at wide viewports the moneyline
 * labels ("CLE (-150)", "TOR (-108)") were cut at the right screen edge and
 * splits content sat flush against / across the SPREAD|TOTAL|MONEYLINE
 * dividers. Runs against the vite dev server with every tRPC procedure
 * stubbed (no DB) — one fixture game with worst-case-width labels.
 *
 * Contracts, at each width in WIDTHS:
 *   1. Zero horizontal page overflow (scrollWidth ≤ clientWidth + 1).
 *   2. Every splits label's right edge ≤ viewport right edge.
 *   3. Every splits label keeps ≥8px clearance from both dividers.
 * Screenshots land in docs/evidence/2026-07-21-splits-layout/.
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";

const EVIDENCE_DIR = "docs/evidence/2026-07-21-splits-layout";
const WIDTHS = [768, 834, 1024, 1280, 1440, 1920] as const;

const TODAY_ISO = "2026-07-21";
const SLUG = "mlb-07-21-2026";

const STUB_USER = {
  id: 1,
  email: "prez@aisportsbettingmodels.com",
  username: "prez",
  role: "user",
  hasAccess: true,
  expiryDate: null,
  termsAccepted: true,
  discordId: null,
  discordUsername: null,
  discordAvatar: null,
  discordConnectedAt: null,
  sessionExpiresAt: null,
  stripePlanId: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  cancelAtPeriodEnd: false,
};

// Worst-case-width labels from the owner's screenshots: TB @ TOR, -111/-108
// moneylines, lopsided 92/8 and 99/1 splits (single-digit segments trigger
// the minWidth floors).
//
// Field-completeness NOTE (adapted per brief): GameCardInner (GameCard.tsx)
// unconditionally destructures/derives many `game.*` fields at the top of
// the component body regardless of `mode` — e.g. game.modelAwaySpreadOdds,
// game.homeRunLineOdds, game.spreadEdge, game.totalEdge, game.modelRunAt,
// game.modelOverOdds/modelUnderOdds, game.awaySpreadOdds/homeSpreadOdds,
// game.overOdds/underOdds, game.openAwaySpread/openHomeSpread/openTotal +
// their odds counterparts, game.openAwayML/openHomeML, game.awayModelSpread/
// homeModelSpread, game.modelAwayPuckLine/modelHomePuckLine, game.modelTotal,
// game.spreadDiff/totalDiff. All are read through `??`/`!= null`/`toNum()`
// (which treats undefined as NaN) — never through an unguarded method call —
// so they are explicitly null-filled below for fidelity with the real
// games.list row shape rather than left absent, even though GameCard's own
// null-safety means omitting them would not crash the render.
const GAME = {
  id: 9101,
  sport: "MLB",
  awayTeam: "TB",
  homeTeam: "TOR",
  gameDate: TODAY_ISO,
  startTimeEst: "19:07",
  gameStatus: "upcoming",
  gameClock: null,
  awayScore: null,
  homeScore: null,
  awayBookSpread: "-1.5",
  homeBookSpread: "+1.5",
  bookTotal: "7.5",
  awayML: "-111",
  homeML: "-108",
  spreadAwayBetsPct: 39,
  spreadAwayMoneyPct: 92,
  totalOverBetsPct: 84,
  totalOverMoneyPct: 99,
  mlAwayBetsPct: 79,
  mlAwayMoneyPct: 95,
  modelRunAt: null,
  // ── Additional fields GameCardInner reads unconditionally (null-filled) ──
  awaySpreadOdds: null,
  homeSpreadOdds: null,
  overOdds: null,
  underOdds: null,
  awayModelSpread: null,
  homeModelSpread: null,
  modelAwayPuckLine: null,
  modelHomePuckLine: null,
  modelTotal: null,
  modelAwayML: null,
  modelHomeML: null,
  modelAwaySpreadOdds: null,
  modelHomeSpreadOdds: null,
  modelAwayPLOdds: null,
  modelHomePLOdds: null,
  modelOverOdds: null,
  modelUnderOdds: null,
  awayRunLine: null,
  homeRunLine: null,
  awayRunLineOdds: null,
  homeRunLineOdds: null,
  spreadDiff: null,
  totalDiff: null,
  spreadEdge: null,
  totalEdge: null,
  openAwaySpread: null,
  openHomeSpread: null,
  openAwaySpreadOdds: null,
  openHomeSpreadOdds: null,
  openTotal: null,
  openOverOdds: null,
  openUnderOdds: null,
  openAwayML: null,
  openHomeML: null,
};
// NOTE while implementing: run the spec once and read the browser console /
// error boundary — if BettingSplits or GameCard destructures additional
// fields at render time, add them to GAME as null. The authoritative field
// list is the games.list row type consumed in GameCard.tsx (interface GameRow).

async function stubApi(page: Page) {
  await page.route("**/api/trpc/**", route => {
    const url = new URL(route.request().url());
    const ops = decodeURIComponent(
      url.pathname.replace(/^.*\/api\/trpc\//, "")
    ).split(",");
    const body = ops.map(op => {
      if (op === "appUsers.me") return { result: { data: { json: STUB_USER } } };
      // Answered regardless of the requested gameDate input (stubbed at the
      // procedure level, not the date level) — the harness must stay
      // date-independent even if 11:00 UTC rollover logic asks for a
      // different date than TODAY_ISO on a future run.
      if (op === "games.list") return { result: { data: { json: [GAME] } } };
      if (op === "games.getCurrentDate")
        return {
          result: {
            data: {
              json: { effectiveDate: TODAY_ISO, utcHour: 18, isBeforeCutoff: false },
            },
          },
        };
      if (op === "games.getAvailableDates")
        return { result: { data: { json: { dates: [TODAY_ISO] } } } };
      if (op === "games.lastRefresh")
        return {
          result: { data: { json: { refreshedAt: `${TODAY_ISO}T18:00:00Z` } } },
        };
      return {
        error: {
          json: {
            message: "stubbed",
            code: -32603,
            data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
          },
        },
      };
    });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  // Non-tRPC API surfaces (SSE chat, uploads) — fail fast instead of hanging,
  // mirroring e2e/mobile-floating-nav.spec.ts. The splits pane renders inside
  // the Dime shell (DimeChatPage) at every width ≥768px, so the chat pane's
  // own network surface must not hang the page.
  await page.route("**/api/dime/**", route =>
    route.fulfill({ status: 500, body: "stubbed offline (e2e)" })
  );
}

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

for (const width of WIDTHS) {
  test(`splits surface fits and respects section dividers at ${width}px`, async ({
    page,
  }) => {
    await stubApi(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/betting-splits/${SLUG}`);
    await page.waitForSelector("[data-market-col]");

    await page.screenshot({
      path: `${EVIDENCE_DIR}/splits-${width}.png`,
      fullPage: false,
    });

    // 1. No horizontal page overflow (the "CLE (-150" cutoff class of bug).
    const overflow = await page.evaluate(() => {
      const el = document.scrollingElement!;
      return el.scrollWidth - el.clientWidth;
    });
    expect(overflow, "horizontal page overflow px").toBeLessThanOrEqual(1);

    // 2 + 3. Label geometry vs viewport edge and divider tracks.
    const violations = await page.evaluate(() => {
      const bad: string[] = [];
      const dividers = Array.from(
        document.querySelectorAll<HTMLElement>("[data-splits-divider]")
      ).map(d => d.getBoundingClientRect());
      document
        .querySelectorAll<HTMLElement>("[data-market-col] span")
        .forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.width === 0) return;
          if (r.right > window.innerWidth + 1)
            bad.push(`viewport-cut: "${el.textContent}" right=${r.right}`);
          for (const d of dividers) {
            const overlapsVertically = r.bottom > d.top && r.top < d.bottom;
            if (!overlapsVertically) continue;
            const gapLeft = d.left - r.right; // label left of divider
            const gapRight = r.left - d.right; // label right of divider
            const crosses = r.left < d.right && r.right > d.left;
            if (crosses)
              bad.push(`divider-cross: "${el.textContent}"`);
            else if (Math.max(gapLeft, gapRight) < 8 && Math.min(gapLeft, gapRight) > -9999)
              bad.push(
                `divider-clearance<8px: "${el.textContent}" gap=${Math.max(gapLeft, gapRight).toFixed(1)}`
              );
          }
        });
      return bad;
    });
    expect(violations, violations.join("\n")).toEqual([]);
  });
}
