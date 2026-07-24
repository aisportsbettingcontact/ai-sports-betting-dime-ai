/**
 * Feed desktop polish — Round 4 closing harness (W4)
 * ══════════════════════════════════════════════════
 * Plan: docs/superpowers/plans/2026-07-23-feed-desktop-polish.md (W4). Proves
 * the 8 owner-approved items in a REAL rendered browser (bounding-box
 * geometry + computed style), complementing the string-level CSS-source unit
 * tests already shipped in ProjectionCard.test.ts / dimeModelFeed.test.ts.
 *
 * ── Why this spec boots its OWN prod server (unlike the sibling e2e specs) ──
 * Every other e2e/*.spec.ts shares the root playwright.config.ts webServer
 * (vite dev server on :5199). This spec deliberately tests the BUILT
 * artifact instead — `npm run build` then `node dist/index.js` — because
 * item 6's rhythm and the standalone-vs-shell scoping it depends on
 * (`.dc-shell-external-scroll`) is exactly the kind of thing a dev-server
 * HMR tree can paper over. `beforeAll`/`afterAll` below build (only if
 * `dist/index.js` is missing — trust a fresh build already run as gate 3c
 * immediately before gate 3d's full suite; auto-build otherwise so this file
 * is self-sufficient run in isolation), spawn the server with
 * `APP_SESSION_SECRET=testsecret DISABLE_BACKGROUND_JOBS=1`, parse the
 * REAL bound port from its own stdout ("Server running on
 * http://localhost:<port>/" — the server auto-bumps if the preferred port is
 * busy), and kill only that one child process afterward. Every `page.goto`
 * below uses an ABSOLUTE URL against that port — the shared config's
 * `baseURL` (:5199, vite dev) is never touched by this file.
 *
 * ── Fixtures (one MLB slate, 2026-07-23, three games) ──
 *   1. LIVE_EDGE_GAME  — Dodgers @ Yankees, gameStatus "live", 2 real edges
 *      (moneyline + total) -> SummaryCarousel (a genuinely TALLER natural
 *      card than PASS's single-line summary — the real content contrast
 *      item 1's equal-height claim needs to be non-trivial).
 *   2. PASS_GAME       — Athletics @ Rangers, gameStatus "upcoming", book and
 *      model priced within noise on every market -> zero edges, genuine PASS
 *      (`.projection-card--pass`).
 *   3. SCHEDULED_EDGE_GAME — Giants @ Mariners, gameStatus "upcoming", one
 *      real edge (Total) -> plain (non-carousel) summary.
 * DimeModelFeed's slate order is `timeToMinutes(startTimeEst)` ascending,
 * then a STABLE re-sort promoting LIVE to rank 0 (slateStatusRank). Start
 * times below (6:05 PM / 7:05 PM / 9:10 PM) make the pre-promotion order
 * [PASS, LIVE, SCHEDULED]; after promotion it's [LIVE, PASS, SCHEDULED] — in
 * the >=1024px 3-across grid that puts LIVE (tall), PASS (short), and
 * SCHEDULED in ROW 1 together. LIVE/PASS provide the unequal natural-height
 * pairing item 1 targets; SCHEDULED provides the distinct third column for
 * item 5's cross-card alignment claim.
 * Odds inputs for PASS/LIVE/SCHEDULED are carried over verbatim from
 * .superpowers/sdd/r4-w2/_pw/tests/r4w2-smoke.spec.ts's PASS_GAME /
 * TALL_MULTI_EDGE_GAME / SIMPLE_EDGE_GAME (that wave's own gate-verified
 * edge counts), only gameStatus/scores/id/venue/time changed here.
 *
 * ── Contracts (see the plan's W4 section for the full per-width table) ──
 * Shell feed at 1920/1440/1280/1024 (desktop): items 1,2,3,4,5,6,7 all active.
 * Shell feed at 900 (tablet): items 2,3,4,5,7 active; 1,6 inert.
 * Shell feed at 375 (mobile): every round-4 rule inert.
 * Standalone /feed at 1440 (matchMedia override — see STANDALONE section):
 * item 6 rhythm absent even though the raw viewport clears min-width:1024px,
 * proving the CSS truly requires the `.dc-shell-external-scroll` ancestor
 * and not just the width media query.
 *
 * Motion/hover figures (160ms cubic-bezier(0.16,1,0.3,1); --row-hover
 * #141414 dark fallback) are pinned per design-system/dime-ai/MASTER.md
 * "Motion" + `.claude/skills/apple-design/SKILL.md` — not invented here.
 * MASTER.md's canonical --row-hover token (rgba(255,255,255,0.065)) differs
 * from the shipped literal fallback (#141414) — a pre-existing, logged,
 * out-of-scope discrepancy (.superpowers/sdd/r4-w3-item8-scoping-audit.md
 * "Reviewer's Minor 5") — this spec asserts the actual shipped value, not
 * the aspirational token, since W4 may not "fix" product code.
 *
 * Screenshots land in docs/evidence/2026-07-23-feed-desktop-polish/.
 */
import { test, expect, type Page, type Locator } from "@playwright/test";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Playwright always runs with cwd = repo root (see every sibling e2e/*.spec.ts,
// which use plain repo-relative paths for the same reason).
const REPO_ROOT = process.cwd();
const EVIDENCE_DIR = path.join(REPO_ROOT, "docs/evidence/2026-07-23-feed-desktop-polish");
const PREFERRED_PORT = 5301;
const SESSION_SECRET = "testsecret";
const GAME_DATE = "2026-07-23";
const DATE_SLUG = "mlb-07-23-2026";
const SHELL_FEED_PATH = `/feed/model/${DATE_SLUG}`;

let serverProcess: ChildProcess | null = null;
let baseURL = "";

/** Spawn `node dist/index.js` and resolve once it logs its real bound port
 *  (findAvailablePort in server/_core/index.ts auto-bumps past the preferred
 *  port if busy — parsing the log line is the only way to know the real
 *  port, so this spec never has to pre-verify port availability itself). */
function waitForServerReady(proc: ChildProcess, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      reject(new Error(`prod server did not report ready within ${timeoutMs}ms. Output so far:\n${buffer}`));
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const m = /Server running on http:\/\/localhost:(\d+)\//.exec(buffer);
      if (m) {
        clearTimeout(timer);
        proc.stdout?.off("data", onData);
        resolve(parseInt(m[1], 10));
      }
    };
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
    });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`prod server exited early (code ${code}). Output:\n${buffer}`));
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const distEntry = path.join(REPO_ROOT, "dist", "index.js");
  if (!fs.existsSync(distEntry)) {
    execSync("npm run build", { cwd: REPO_ROOT, stdio: "inherit" });
  }

  serverProcess = spawn("node", ["dist/index.js"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PREFERRED_PORT),
      APP_SESSION_SECRET: SESSION_SECRET,
      // Web-only mode: skip the 24/7 odds/lineup/score scheduler loops —
      // irrelevant to a stubbed-tRPC harness and only slow boot/shutdown.
      DISABLE_BACKGROUND_JOBS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const boundPort = await waitForServerReady(serverProcess, 60_000);
  baseURL = `http://localhost:${boundPort}`;
});

test.afterAll(async () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGTERM");
  }
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

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

function mlbRow(overrides: Record<string, unknown>) {
  return {
    id: 1,
    gameDate: GAME_DATE,
    startTimeEst: "7:05 PM",
    sport: "MLB",
    gameStatus: "upcoming",
    awayScore: null,
    homeScore: null,
    gameClock: null,
    venue: "Fenway Park",
    doubleHeader: "N",
    gameNumber: 1,
    awayML: null, homeML: null,
    awayRunLine: null, homeRunLine: null,
    awayRunLineOdds: null, homeRunLineOdds: null,
    awayBookSpread: null, homeBookSpread: null,
    bookTotal: null, overOdds: null, underOdds: null,
    modelRunAt: "2026-07-23T10:00:00Z",
    modelAwayML: null, modelHomeML: null,
    modelAwayWinPct: null, modelHomeWinPct: null,
    modelTotal: null, modelOverRate: null, modelUnderRate: null,
    modelOverOdds: null, modelUnderOdds: null,
    modelAwaySpreadOdds: null, modelHomeSpreadOdds: null,
    modelAwayPLOdds: null, modelHomePLOdds: null,
    ...overrides,
  };
}

// PASS — book/model priced within noise on every market -> zero edges
// (odds carried verbatim from r4-w2's PASS_GAME, that wave's own
// gate-verified zero-edge fixture).
const PASS_GAME = mlbRow({
  id: 401,
  awayTeam: "ATH",
  homeTeam: "TEX",
  startTimeEst: "6:05 PM",
  venue: "Globe Life Field",
  awayML: 130, homeML: -150,
  modelAwayML: 128, modelHomeML: -148,
  modelAwayWinPct: 42.5, modelHomeWinPct: 57.5,
  awayRunLine: 1.5, homeRunLine: -1.5,
  awayRunLineOdds: -110, homeRunLineOdds: -110,
  modelAwaySpreadOdds: -112, modelHomeSpreadOdds: -108,
  bookTotal: 8, overOdds: -110, underOdds: -110,
  modelOverOdds: -112, modelUnderOdds: -108,
});

// LIVE, two real edges (moneyline + total; run line dead-even stays out) ->
// SummaryCarousel — a genuinely taller natural card than PASS's single-line
// summary (odds carried verbatim from r4-w2's TALL_MULTI_EDGE_GAME).
const LIVE_EDGE_GAME = mlbRow({
  id: 402,
  awayTeam: "LAD",
  homeTeam: "NYY",
  startTimeEst: "7:05 PM",
  venue: "Yankee Stadium",
  gameStatus: "live",
  gameClock: "5th",
  awayScore: 3,
  homeScore: 2,
  awayML: -110, homeML: -105,
  modelAwayML: -145, modelHomeML: 125,
  modelAwayWinPct: 59.2, modelHomeWinPct: 40.8,
  awayRunLine: 1.5, homeRunLine: -1.5,
  awayRunLineOdds: -165, homeRunLineOdds: 145,
  modelAwaySpreadOdds: -170, modelHomeSpreadOdds: 150,
  bookTotal: 7.5, overOdds: -108, underOdds: -112,
  modelOverOdds: -108, modelUnderOdds: -140,
});

// Scheduled, ONE real edge (Total, "Under 7") -> plain summary (odds carried
// verbatim from r4-w2's SIMPLE_EDGE_GAME).
const SCHEDULED_EDGE_GAME = mlbRow({
  id: 403,
  awayTeam: "SF",
  homeTeam: "SEA",
  startTimeEst: "9:10 PM",
  venue: "T-Mobile Park",
  bookTotal: 7, overOdds: -108, underOdds: -112,
  modelOverOdds: 118, modelUnderOdds: -136,
});

const BLANK_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function stubApi(page: Page) {
  await page.route("**/api/trpc/**", (route) => {
    const url = new URL(route.request().url());
    const ops = decodeURIComponent(url.pathname.replace(/^.*\/api\/trpc\//, "")).split(",");
    const body = ops.map((op) => {
      if (op === "appUsers.me") return { result: { data: { json: STUB_USER } } };
      if (op === "games.list")
        return { result: { data: { json: [PASS_GAME, LIVE_EDGE_GAME, SCHEDULED_EDGE_GAME] } } };
      if (op === "wc2026.matchesByDate") return { result: { data: { json: [] } } };
      return {
        error: {
          json: {
            message: "stubbed offline (e2e)",
            code: -32603,
            data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
          },
        },
      };
    });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  // Non-tRPC API surfaces (SSE chat, uploads) — fail fast instead of hanging,
  // matching the established pattern in every sibling spec.
  await page.route("**/api/dime/**", (route) => route.fulfill({ status: 500, body: "stubbed offline (e2e)" }));
  await page.route("https://www.mlbstatic.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: BLANK_PNG }),
  );
}

/** Deterministic dark theme (mode defaults to "system" with nothing in
 *  localStorage — pin prefers-color-scheme so every geometry/color assertion
 *  below is reproducible regardless of the host's OS theme). */
async function gotoShellFeed(page: Page, width: number, height = 1400) {
  await stubApi(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width, height });
  await page.goto(`${baseURL}${SHELL_FEED_PATH}`);
  await page.waitForSelector(".projection-card", { timeout: 20_000 });
  await page.waitForTimeout(300);
}

async function assertNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth);
  expect(overflow, `${label}: horizontal page overflow px`).toBeLessThanOrEqual(1);
}

function cardByAriaLabel(page: Page, label: string): Locator {
  return page.locator(`.projection-card[aria-label="${label}"]`);
}

/** Item 5 helper: each summary cell's offset relative to ITS OWN `.summary`
 *  element's left edge — track-width alignment, not raw page x, so the
 *  comparison holds across cards in DIFFERENT physical grid columns (unlike
 *  raw x, which only matches for same-column cards). Uses the FIRST
 *  `.summary` in the card, which is correct for both a plain card and a
 *  carousel card (ProjectionSummary renders its own `.summary` inside each
 *  `.summary-carousel__slide`, so the first slide's `.summary` is what's on
 *  screen by default). */
async function summaryOffsets(card: Locator) {
  const summary = card.locator(".summary").first();
  const summaryBox = await summary.boundingBox();
  if (!summaryBox) throw new Error("summary bounding box missing");
  const edgeBox = await summary.locator(".summary__edge").boundingBox();
  const bookLocator = summary.locator(".summary__item--book");
  const modelLocator = summary.locator(".summary__item--model");
  const bookBox = (await bookLocator.count()) > 0 ? await bookLocator.boundingBox() : null;
  const modelBox = (await modelLocator.count()) > 0 ? await modelLocator.boundingBox() : null;
  return {
    summaryBox,
    edgeX: edgeBox ? edgeBox.x - summaryBox.x : null,
    edgeCenterX: edgeBox ? edgeBox.x + edgeBox.width / 2 - summaryBox.x : null,
    bookX: bookBox ? bookBox.x - summaryBox.x : null,
    modelX: modelBox ? modelBox.x - summaryBox.x : null,
  };
}

// ─ Shell feed: desktop (1920/1440/1280/1024) + tablet (900) + mobile (375) ──

const DESKTOP_WIDTHS = [1920, 1440, 1280, 1024] as const;

for (const width of DESKTOP_WIDTHS) {
  test(`shell feed desktop ${width}px: items 1-7 all active`, async ({ page }) => {
    await gotoShellFeed(page, width);
    await assertNoHorizontalOverflow(page, `shell-${width}`);

    const liveCard = cardByAriaLabel(page, "Dodgers at Yankees");
    const passCard = cardByAriaLabel(page, "Athletics at Rangers");
    const scheduledCard = cardByAriaLabel(page, "Giants at Mariners");
    await expect(liveCard).toBeVisible();
    await expect(passCard).toBeVisible();
    await expect(scheduledCard).toBeVisible();

    // ── Item 1: equal-height row-mates + pinned expander (desktop only) ──
    await expect(liveCard.locator(".summary-carousel")).toBeVisible();
    await expect(passCard.locator(".summary-carousel")).toHaveCount(0);
    const liveBox = await liveCard.boundingBox();
    const passBox = await passCard.boundingBox();
    const scheduledBox = await scheduledCard.boundingBox();
    if (!liveBox || !passBox || !scheduledBox) throw new Error("card bounding boxes missing");
    expect(passBox.x, "desktop column 2 sits to the right of column 1").toBeGreaterThan(liveBox.x + liveBox.width);
    expect(scheduledBox.x, "desktop column 3 sits to the right of column 2").toBeGreaterThan(passBox.x + passBox.width);
    expect(Math.abs(passBox.y - liveBox.y), "desktop columns 1 and 2 share one row").toBeLessThanOrEqual(1);
    expect(Math.abs(scheduledBox.y - liveBox.y), "desktop columns 1 and 3 share one row").toBeLessThanOrEqual(1);

    // The summary reflows by card width, not viewport width. Standard
    // 3-across desktop cards stay compact at every required viewport:
    // MODEL EDGE full-width, BOOK / MODEL beneath, signal chip last.
    const liveSummaryStyle = await liveCard.locator(".summary").first().evaluate((el) => {
      const cs = getComputedStyle(el);
      return { display: cs.display, flexDirection: cs.flexDirection };
    });
    expect(liveSummaryStyle.display, "three-across desktop card uses compact summary reflow").toBe("flex");
    expect(liveSummaryStyle.flexDirection).toBe("column");
    const passReadout = await passCard.locator(".summary__readout").boundingBox();
    const passEdge = await passCard.locator(".summary__edge").boundingBox();
    if (!passReadout || !passEdge) throw new Error("compact summary bounding boxes missing");
    expect(
      passEdge.y,
      "compact summary edge chip sits below the fact rows",
    ).toBeGreaterThanOrEqual(passReadout.y + passReadout.height - 1);

    expect(
      Math.abs(liveBox.height - passBox.height),
      `row-mates (LIVE ${liveBox.height} vs PASS ${passBox.height}) render equal height`,
    ).toBeLessThanOrEqual(1);

    const liveToggle = await liveCard.locator(".projection-card__markets-toggle").boundingBox();
    const passToggle = await passCard.locator(".projection-card__markets-toggle").boundingBox();
    if (!liveToggle || !passToggle) throw new Error("markets-toggle bounding boxes missing");
    expect(
      Math.abs(liveToggle.y + liveToggle.height - (passToggle.y + passToggle.height)),
      "expander bottom edges align across row-mates",
    ).toBeLessThanOrEqual(1);
    // Pinned to the card's own bottom edge (padding-block-end: --space-sm =
    // 12px) — not floating mid-card.
    const passGap = passBox.y + passBox.height - (passToggle.y + passToggle.height);
    expect(passGap, `PASS expander bottom sits ~12px above its own card bottom (measured ${passGap})`).toBeGreaterThanOrEqual(6);
    expect(passGap).toBeLessThanOrEqual(20);

    // ── Item 2: unified 24px/700 matchup score (LIVE card has scores) ──
    const scoreFontSize = await liveCard.locator(".matchup__score").first().evaluate((el) => getComputedStyle(el).fontSize);
    expect(scoreFontSize, "matchup__score computed font-size").toBe("24px");

    // ── Item 3: PASS-card law — opacity 0.82 ──
    const passOpacity = await passCard.evaluate((el) => getComputedStyle(el).opacity);
    expect(passOpacity, "PASS card computed opacity").toBe("0.82");

    // ── Item 4: live dot visible on the live-game card ──
    const liveDot = liveCard.locator(".projection-card__live-dot");
    await expect(liveDot).toHaveCount(1);
    const dotDisplay = await liveDot.evaluate((el) => getComputedStyle(el).display);
    expect(dotDisplay, "live dot computed display").not.toBe("none");
    const dotBox = await liveDot.boundingBox();
    expect(dotBox, "live dot has a real bounding box").not.toBeNull();
    expect(dotBox!.width, "live dot visible width").toBeGreaterThan(0);
    await expect(passCard.locator(".projection-card__live-dot")).toHaveCount(0);

    // ── Item 6: date-nav rhythm under the 96px title band (shell only) ──
    const topbar = page.locator(".dc-shell-external-scroll .dmf-topbar");
    const feedhead = page.locator(".dc-shell-external-scroll .dmf-feedhead");
    const datelbl = page.locator(".dc-shell-external-scroll .dmf-datelbl");
    const topbarHeight = await topbar.evaluate((el) => getComputedStyle(el).height);
    expect(topbarHeight, "shell topbar height (96px title band)").toBe("96px");
    const feedheadStyle = await feedhead.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { top: cs.top, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, marginBottom: cs.marginBottom };
    });
    expect(feedheadStyle.top, "feedhead sticky offset tracks the 96px band").toBe("96px");
    expect(feedheadStyle.paddingTop, "feedhead padding-top (title band -> date-nav gap)").toBe("24px");
    expect(feedheadStyle.paddingBottom).toBe("10px");
    expect(feedheadStyle.marginBottom).toBe("16px");
    const datelblFontSize = await datelbl.evaluate((el) => getComputedStyle(el).fontSize);
    expect(datelblFontSize, "date label font-size").toBe("17px");

    // Centered directly under the title band: date-nav's horizontal center
    // matches the title's horizontal center.
    const titleBox = await page.locator(".dc-shell-external-scroll .dmf-toptitle").boundingBox();
    const datenavBox = await page.locator(".dc-shell-external-scroll .dmf-datenav").boundingBox();
    if (!titleBox || !datenavBox) throw new Error("title/date-nav bounding boxes missing");
    const titleCenter = titleBox.x + titleBox.width / 2;
    const datenavCenter = datenavBox.x + datenavBox.width / 2;
    expect(
      Math.abs(titleCenter - datenavCenter),
      `date-nav centered under the title band (title center ${titleCenter}, date-nav center ${datenavCenter})`,
    ).toBeLessThanOrEqual(4);

    // Fixed rhythm to the league header: date-nav's OWN bottom edge (the
    // element the law's padding-bottom is measured from) -> league header
    // top ~= padding-bottom(10) + the pre-existing 1px divider border +
    // margin-bottom(16) + .dmf-list's untouched padding-top(6) = 33px
    // edge-to-edge (the annotation in ai-model-projections.md item 6: "32px
    // of space" + the 1px border the space doesn't itself count).
    const leagueHeadBox = await page.locator(".dmf-leaguehead").first().boundingBox();
    if (!leagueHeadBox) throw new Error("league-head bounding box missing");
    const gap = leagueHeadBox.y - (datenavBox.y + datenavBox.height);
    expect(gap, `date-nav-to-league-header rhythm gap (measured ${gap}, law = 33px edge-to-edge)`).toBeGreaterThanOrEqual(31);
    expect(gap).toBeLessThanOrEqual(35);

    // ── Item 7: expander hover — shell row-hover fill on the 160ms curve ──
    const toggle = passCard.locator(".projection-card__markets-toggle");
    const bgBefore = await toggle.evaluate((el) => getComputedStyle(el).backgroundColor);
    const duration = await toggle.evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(duration, "160ms brand curve on the toggle").toContain("0.16s");
    await toggle.hover();
    await page.waitForTimeout(250);
    const bgAfter = await toggle.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bgAfter, "hover background differs from resting state").not.toBe(bgBefore);
    expect(bgAfter, "hover fill matches --row-hover dark fallback #141414").toBe("rgb(20, 20, 20)");
    await page.mouse.move(0, 0);

    await page.screenshot({ path: `${EVIDENCE_DIR}/shell-${width}.png`, fullPage: true });

    // ── Item 5: aligned summary mini-grid — same fixed tracks everywhere ──
    // Placed LAST (after items 1,2,3,4,6,7 above, which all independently
    // verify clean): a real pre-existing defect surfaces here at 1024/1280 —
    // see the block comment below — and this ordering keeps that failure
    // from masking the other six items' otherwise-passing verification.
    //
    // DEFECT CAUGHT BY THIS CONTRACT (pre-existing from W2, surfaced on this
    // spec's first full run, then fixed in-round by the controller before
    // merge — the fix commit changes the floors described below to
    // minmax(0,fr) + a 5rem chip floor and adds min-inline-size:0 to
    // .summary; the description is kept for the record): `.summary`'s grid
    // (ProjectionCard.css `@media (min-width:768px) .summary{display:grid;
    // grid-template-columns: minmax(6.5rem,1.6fr) minmax(3.5rem,0.8fr)
    // minmax(3.5rem,0.8fr) minmax(5.5rem,1fr)}`) has an intrinsic minimum
    // width of 376px (sum of the minmax "low" bounds + 3 column-gaps
    // inherited from the base `.summary{gap:var(--space-sm) var(--space-lg)}`
    // rule) and never resets its own automatic minimum size
    // (`min-inline-size:0`/`min-width:0`) the way its sibling
    // `.summary-carousel{min-inline-size:0}` (used for 2+-edge cards) does.
    // At the persistent-sidebar >=1024px multi-column grid, a card's available
    // content width drops BELOW 376+2*24(card padding)=424px at 1024px
    // (~296px cards) and 1280px (~400px cards) — two of the four REQUIRED
    // desktop widths in this plan — so a PLAIN (non-carousel) card's
    // `.summary` overflows its own card, its own grid column, and (since
    // `.dc-shell-external-layer{overflow:hidden}` is the first ancestor that
    // clips it) is visually cut off at the shell pane's right edge. Real,
    // reproducible, evidence-backed (see the shell-1024.png/shell-1280.png
    // screenshots this test captures above, and the shell-scroll overflow
    // measurement below) — reported here, not patched (W4 may not touch
    // client/src). The 3-across layout now uses the card-level compact
    // reflow at every required desktop width; the original fixed row remains
    // available only when an individual card itself exceeds 520px.
    const shellScrollOverflow = await page
      .locator(".dc-shell-external-scroll")
      .evaluate((el) => el.scrollWidth - el.clientWidth);
    const liveOffsets = await summaryOffsets(liveCard);
    const passOffsets = await summaryOffsets(passCard);
    const scheduledOffsets = await summaryOffsets(scheduledCard);
    expect(
      shellScrollOverflow,
      `shell scroll pane horizontal overflow px (diagnostic for the .summary min-width defect above; ` +
        `LIVE .summary width=${liveOffsets.summaryBox.width} PASS=${passOffsets.summaryBox.width} SCHEDULED=${scheduledOffsets.summaryBox.width}, ` +
        `376px = the un-shrinkable grid minimum)`,
    ).toBeLessThanOrEqual(1);
    expect(liveOffsets.edgeX, "edge chip present on LIVE").not.toBeNull();
    expect(passOffsets.edgeX, "edge chip present on PASS ('No edge')").not.toBeNull();
    expect(scheduledOffsets.edgeX, "edge chip present on SCHEDULED").not.toBeNull();
    for (const [label, offsets] of [
      ["LIVE", liveOffsets],
      ["PASS", passOffsets],
      ["SCHEDULED", scheduledOffsets],
    ] as const) {
      expect(
        Math.abs(offsets.edgeCenterX! - offsets.summaryBox.width / 2),
        `${label} compact chip is centered beneath its fact rows`,
      ).toBeLessThanOrEqual(1);
    }
    expect(liveOffsets.bookX, "LIVE has a real BOOK column").not.toBeNull();
    expect(scheduledOffsets.bookX, "SCHEDULED has a real BOOK column").not.toBeNull();
    expect(
      Math.abs(liveOffsets.bookX! - scheduledOffsets.bookX!),
      "BOOK column offset matches between two different real-edge cards",
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(liveOffsets.modelX! - scheduledOffsets.modelX!),
      "MODEL column offset matches between two different real-edge cards",
    ).toBeLessThanOrEqual(1);

    // ── Item 1, OPEN-disclosure state (final-review I1): opening one
    // row-mate's "VIEW FULL AI MODEL PROJECTIONS" stretches the closed
    // neighbor to match (that IS the owner-approved stretch law) — the
    // closed card's summary row absorbs the surplus. Captured as owner
    // evidence at 1440 only; the geometry assertion just pins that stretch
    // stays in force (equal heights) rather than judging the aesthetics —
    // that call is the owner's, via the open-1440.png evidence. ──
    if (width === 1440) {
      const liveToggle = liveCard.locator(".projection-card__markets-toggle");
      await liveToggle.click();
      await page.waitForTimeout(200);
      const openLive = await liveCard.boundingBox();
      const stretchedPass = await passCard.boundingBox();
      if (!openLive || !stretchedPass) throw new Error("open-state bounding boxes missing");
      expect(
        Math.abs(openLive.height - stretchedPass.height),
        "row-mates stay equal-height with one disclosure open (stretch law holds)",
      ).toBeLessThanOrEqual(2);
      await page.screenshot({ path: `${EVIDENCE_DIR}/open-1440.png`, fullPage: true });
      await liveToggle.click();
      await page.waitForTimeout(200);
    }
  });
}

test("shell feed tablet 900px: items 2,3,4,5,7 active; items 1,6 inert", async ({ page }) => {
  await gotoShellFeed(page, 900);
  await assertNoHorizontalOverflow(page, "shell-900");

  const liveCard = cardByAriaLabel(page, "Dodgers at Yankees");
  const passCard = cardByAriaLabel(page, "Athletics at Rangers");
  const scheduledCard = cardByAriaLabel(page, "Giants at Mariners");

  // ── Item 1 inert: 2-column tablet rows start-align, so PASS keeps its
  //    naturally shorter height instead of stretching to LIVE. ──
  const liveBox = await liveCard.boundingBox();
  const passBox = await passCard.boundingBox();
  const scheduledBox = await scheduledCard.boundingBox();
  if (!liveBox || !passBox || !scheduledBox) throw new Error("card bounding boxes missing");
  expect(passBox.height, "PASS is NOT stretched to LIVE's height on tablet").toBeLessThan(liveBox.height - 5);
  expect(passBox.x, "two columns: PASS sits to the right of LIVE").toBeGreaterThan(liveBox.x + liveBox.width);
  expect(Math.abs(passBox.y - liveBox.y), "two columns: PASS and LIVE share the same row").toBeLessThanOrEqual(1);
  expect(Math.abs(scheduledBox.x - liveBox.x), "tablet row 2 returns to column 1").toBeLessThanOrEqual(1);
  expect(scheduledBox.y, "tablet row 2 sits below row 1").toBeGreaterThan(liveBox.y + liveBox.height);

  // ── Item 2 active: 24px matchup score ──
  const scoreFontSize = await liveCard.locator(".matchup__score").first().evaluate((el) => getComputedStyle(el).fontSize);
  expect(scoreFontSize, "matchup__score computed font-size at tablet").toBe("24px");

  // ── Item 3 active: PASS opacity 0.82 ──
  const passOpacity = await passCard.evaluate((el) => getComputedStyle(el).opacity);
  expect(passOpacity, "PASS card computed opacity at tablet").toBe("0.82");

  // ── Item 4 active: live dot visible ──
  const dotDisplay = await liveCard.locator(".projection-card__live-dot").evaluate((el) => getComputedStyle(el).display);
  expect(dotDisplay, "live dot computed display at tablet").not.toBe("none");

  // ── Item 5 active: LIVE and SCHEDULED occupy the first column in
  //    consecutive tablet rows, so their relative summary tracks align. ──
  const liveOffsets = await summaryOffsets(liveCard);
  const scheduledOffsets = await summaryOffsets(scheduledCard);
  expect(
    Math.abs(liveOffsets.bookX! - scheduledOffsets.bookX!),
    "BOOK column offset matches across cards at tablet width",
  ).toBeLessThanOrEqual(1);

  // ── Item 6 inert: compact chrome, NOT the 96px/17px shell rhythm ──
  const feedhead = page.locator(".dc-shell-external-scroll .dmf-feedhead");
  const datelbl = page.locator(".dc-shell-external-scroll .dmf-datelbl");
  const feedheadTop = await feedhead.evaluate((el) => getComputedStyle(el).top);
  expect(feedheadTop, "feedhead top stays compact (46px) below 1024px, even inside the shell").toBe("46px");
  const datelblFontSize = await datelbl.evaluate((el) => getComputedStyle(el).fontSize);
  expect(datelblFontSize, "date label stays 15px below 1024px").toBe("15px");

  // ── Item 7 active: hover fill still applies (min-width:768 clears) ──
  const toggle = passCard.locator(".projection-card__markets-toggle");
  const bgBefore = await toggle.evaluate((el) => getComputedStyle(el).backgroundColor);
  await toggle.hover();
  await page.waitForTimeout(250);
  const bgAfter = await toggle.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bgAfter, "hover fill still applies at tablet width").not.toBe(bgBefore);
  await page.mouse.move(0, 0);

  await page.screenshot({ path: `${EVIDENCE_DIR}/shell-900.png`, fullPage: true });
});

test("shell feed mobile 375px: every round-4 rule inert", async ({ page }) => {
  await gotoShellFeed(page, 375, 1600);
  await assertNoHorizontalOverflow(page, "shell-375");

  const liveCard = cardByAriaLabel(page, "Dodgers at Yankees");
  const passCard = cardByAriaLabel(page, "Athletics at Rangers");

  // Item 1 inert: PASS visibly shorter than LIVE (not stretched).
  const liveBox = await liveCard.boundingBox();
  const passBox = await passCard.boundingBox();
  if (!liveBox || !passBox) throw new Error("card bounding boxes missing");
  expect(passBox.height, "PASS is NOT stretched on mobile").toBeLessThan(liveBox.height - 5);
  expect(Math.abs(passBox.x - liveBox.x), "mobile cards share the single grid column").toBeLessThanOrEqual(1);
  expect(passBox.y, "mobile card 2 sits below card 1").toBeGreaterThan(liveBox.y + liveBox.height);

  // Item 2 inert: fluid clamp, not the pinned 24px.
  const scoreFontSize = await liveCard.locator(".matchup__score").first().evaluate((el) => getComputedStyle(el).fontSize);
  expect(scoreFontSize, "matchup__score is NOT pinned to 24px on mobile").not.toBe("24px");
  expect(parseFloat(scoreFontSize)).toBeLessThan(24);

  // Item 3 inert: no forced opacity.
  const passOpacity = await passCard.evaluate((el) => getComputedStyle(el).opacity);
  expect(passOpacity, "PASS card opacity is NOT forced to 0.82 on mobile").toBe("1");

  // Item 4 inert: live dot display:none (base rule, unconditional below 768px).
  const dotDisplay = await liveCard.locator(".projection-card__live-dot").evaluate((el) => getComputedStyle(el).display);
  expect(dotDisplay, "live dot is display:none on mobile").toBe("none");

  // Item 5 inert: flex summary, not the 4-column grid.
  const summaryDisplay = await page.locator(".summary").first().evaluate((el) => getComputedStyle(el).display);
  expect(summaryDisplay, "summary stays flex below 768px").toBe("flex");

  // "base paddings": card padding is the mobile-first --space-lg/--space-sm
  // pair, unaffected by any round-4 rule (round-4 introduces no card-padding
  // override at any breakpoint, so this is a byte-identity check via the
  // card's own computed padding-block-end).
  const paddingBottom = await passCard.evaluate((el) => getComputedStyle(el).paddingBottom);
  expect(paddingBottom, "card padding-block-end is the base 12px (--space-sm), untouched by round 4").toBe("12px");

  // Item 7 inert: hovering the toggle produces NO fill change (gated on
  // min-width:768px — headless Chromium reports (hover:hover)=true by
  // default, so this genuinely isolates the width gate, not hover capability).
  const toggle = passCard.locator(".projection-card__markets-toggle");
  const bgBefore = await toggle.evaluate((el) => getComputedStyle(el).backgroundColor);
  await toggle.hover();
  await page.waitForTimeout(250);
  const bgAfter = await toggle.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bgAfter, "no hover transition/fill on the toggle below 768px").toBe(bgBefore);
  const duration = await toggle.evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(duration, "no visible transition duration on the toggle below 768px").not.toContain("0.16s");

  await page.screenshot({ path: `${EVIDENCE_DIR}/shell-375.png`, fullPage: true });
});

// ─── Standalone /feed at 1440: item-6 rhythm absent (negative contract) ──────
//
// The real router only ever mounts DimeModelFeed standalone (embeddedInShell
// undefined, no `.dc-shell-external-scroll` ancestor) below the 768px shell
// boundary (App.tsx Router(): `chatShellOwnsRoute = isChatLocation(location)
// || (shellViewport && isDimeProductLocation(location))`) — at >=768px
// physical width, /feed/model/... is ALWAYS shell-owned. To exercise the
// genuinely standalone render tree at a full 1440px viewport (proving item
// 6's CSS truly gates on the `.dc-shell-external-scroll` ancestor and not
// merely on `@media (min-width:1024px)`, which 1440px would trip on its
// own), this test overrides `window.matchMedia` for EXACTLY the shell's own
// query string ("(min-width: 768px)", DIME_SHELL_MEDIA_QUERY in
// client/src/pages/dime-shell/breakpoints.ts) to force
// `useDimeShellViewport()` to report false — every other query (color
// scheme, reduced motion, etc.) still resolves natively. This is a
// browser-API-level test harness technique, not a product-code change: no
// client/src or server file is touched, and the real CSS media query
// (`@media (min-width:1024px)`) still evaluates against the REAL 1440px
// viewport exactly as a real browser would.
test("standalone /feed at 1440px: item-6 rhythm absent (no shell ancestor)", async ({ page }) => {
  await stubApi(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    const native = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => {
      if (query === "(min-width: 768px)") {
        const mql = {
          matches: false,
          media: query,
          onchange: null,
          addListener() {},
          removeListener() {},
          addEventListener() {},
          removeEventListener() {},
          dispatchEvent() {
            return false;
          },
        } as unknown as MediaQueryList;
        return mql;
      }
      return native(query);
    };
  });
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto(`${baseURL}${SHELL_FEED_PATH}`);
  await page.waitForSelector(".projection-card", { timeout: 20_000 });
  await page.waitForTimeout(300);
  await assertNoHorizontalOverflow(page, "standalone-1440");

  // Genuinely standalone: no shell ancestor, and the standalone-only
  // wordmark/nav (suppressed when embeddedInShell) is present.
  await expect(page.locator(".dc-shell-external-scroll")).toHaveCount(0);
  await expect(page.locator(".dmf-wordmark")).toBeVisible();

  const topbarHeight = await page.locator(".dmf-topbar").evaluate((el) => getComputedStyle(el).height);
  expect(topbarHeight, "standalone topbar stays compact (46px), NOT the shell's 96px band").toBe("46px");
  const feedheadTop = await page.locator(".dmf-feedhead").evaluate((el) => getComputedStyle(el).top);
  expect(feedheadTop, "standalone feedhead top stays 46px").toBe("46px");
  const datelblFontSize = await page.locator(".dmf-datelbl").evaluate((el) => getComputedStyle(el).fontSize);
  expect(datelblFontSize, "standalone date label stays 15px, NOT the shell's 17px").toBe("15px");

  await page.screenshot({ path: `${EVIDENCE_DIR}/standalone-1440.png`, fullPage: true });
});
