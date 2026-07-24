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

function battingOrder(names: string[]) {
  const positions = ["CF", "SS", "RF", "1B", "DH", "3B", "LF", "2B", "C"];
  return JSON.stringify(names.map((name, index) => ({
    battingOrder: index + 1,
    position: positions[index],
    name,
    bats: index % 3 === 0 ? "L" : "R",
    rotowireId: 10_000 + index,
    mlbamId: 600_000 + index,
  })));
}

function lineupRow(overrides: Record<string, unknown>) {
  return {
    id: 1,
    gameId: 1,
    scrapedAt: 1_721_740_000_000,
    awayPitcherName: null,
    awayPitcherHand: null,
    awayPitcherEra: null,
    awayPitcherRotowireId: null,
    awayPitcherMlbamId: null,
    awayPitcherConfirmed: false,
    homePitcherName: null,
    homePitcherHand: null,
    homePitcherEra: null,
    homePitcherRotowireId: null,
    homePitcherMlbamId: null,
    homePitcherConfirmed: false,
    awayLineup: null,
    homeLineup: null,
    awayLineupConfirmed: false,
    homeLineupConfirmed: false,
    ...overrides,
  };
}

const LINEUPS_BY_GAME_ID = {
  401: lineupRow({
    gameId: 401,
    awayPitcherName: "JP Sears",
    awayPitcherHand: "L",
    awayPitcherEra: "7-7 · 4.18 ERA",
    awayPitcherRotowireId: 14201,
    awayPitcherMlbamId: null,
    awayPitcherConfirmed: false,
    homePitcherName: "Jacob deGrom",
    homePitcherHand: "R",
    homePitcherEra: "6-2 · 2.71 ERA",
    homePitcherRotowireId: 10755,
    homePitcherMlbamId: 594798,
    homePitcherConfirmed: true,
    awayLineup: battingOrder([
      "Lawrence Butler", "Jacob Wilson", "Brent Rooker", "Tyler Soderstrom",
      "Shea Langeliers", "Zack Gelof", "Max Schuemann", "JJ Bleday", "Nick Allen",
    ]),
    homeLineup: battingOrder([
      "Marcus Semien", "Corey Seager", "Josh Jung", "Adolis García",
      "Wyatt Langford", "Joc Pederson", "Jonah Heim", "Ezequiel Duran", "Leody Taveras",
    ]),
    awayLineupConfirmed: false,
    homeLineupConfirmed: true,
  }),
  403: lineupRow({
    gameId: 403,
    awayPitcherName: "Logan Webb",
    awayPitcherHand: "R",
    awayPitcherEra: "7-4 · 3.21 ERA",
    awayPitcherRotowireId: 14222,
    awayPitcherMlbamId: 657277,
    awayPitcherConfirmed: true,
    homePitcherName: "George Kirby",
    homePitcherHand: "R",
    homePitcherEra: "8-5 · 3.62 ERA",
    homePitcherRotowireId: 15669,
    homePitcherMlbamId: 669923,
    homePitcherConfirmed: false,
    awayLineup: battingOrder([
      "Jung Hoo Lee", "Heliot Ramos", "Matt Chapman", "Rafael Devers",
      "Willy Adames", "Mike Yastrzemski", "Patrick Bailey", "Casey Schmitt", "Tyler Fitzgerald",
    ]),
    homeLineup: battingOrder([
      "J.P. Crawford", "Julio Rodríguez", "Cal Raleigh", "Randy Arozarena",
      "Luke Raley", "Jorge Polanco", "Mitch Garver", "Cole Young", "Dominic Canzone",
    ]),
    awayLineupConfirmed: true,
    homeLineupConfirmed: false,
  }),
};

const MLB_LOGO_VIEWBOX: Record<string, readonly [number, number, string]> = {
  "119": [115, 150, "#005A9C"], // Dodgers
  "147": [144, 150, "#132448"], // Yankees (dark-contrast regression)
  "133": [181, 150, "#003831"], // Athletics
  "140": [132, 150, "#C0111F"], // Rangers
  "137": [108, 150, "#FD5A1E"], // Giants
  "136": [94, 150, "#0C2C56"], // Mariners
};

function deterministicTeamLogo(url: string): string {
  const id = /\/(\d+)\.svg(?:\?|$)/.exec(url)?.[1] ?? "";
  const [width, height, fill] = MLB_LOGO_VIEWBOX[id] ?? [150, 150, "#45E0A8"];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path fill="${fill}" d="M0 0h${width}v${height}H0z"/></svg>`;
}

// MLB's removed-background player assets are 180×270 (2:3). Keep that exact
// intrinsic geometry in-browser so portrait crop tests cannot pass against a
// meaningless 1×1 pixel while still remaining deterministic/offline.
const MLB_PORTRAIT_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="180" height="270" viewBox="0 0 180 270">
    <path fill="#173a31" d="M8 270c4-61 29-91 82-91s78 30 82 91z"/>
    <ellipse cx="90" cy="137" rx="48" ry="63" fill="#d49a78"/>
    <path fill="#101820" d="M37 91c3-48 26-72 53-72s50 24 53 72c-31-14-75-14-106 0z"/>
    <path fill="#45e0a8" d="M25 92c22-17 108-17 130 0-35 10-95 10-130 0z"/>
    <circle cx="72" cy="132" r="5" fill="#171717"/>
    <circle cx="108" cy="132" r="5" fill="#171717"/>
    <path fill="none" stroke="#6f382d" stroke-width="4" stroke-linecap="round" d="M75 161q15 12 30 0"/>
  </svg>
`;

const ROTOWIRE_PORTRAIT_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="250" height="250" viewBox="0 0 250 250">
    <rect width="250" height="250" fill="#101820"/>
    <path fill="#173a31" d="M18 250c8-61 41-83 107-83s99 22 107 83z"/>
    <ellipse cx="125" cy="120" rx="58" ry="75" fill="#d49a78"/>
    <path fill="#45e0a8" d="M53 64c24-34 120-34 144 0-34 16-110 16-144 0z"/>
    <circle cx="103" cy="113" r="6" fill="#171717"/>
    <circle cx="147" cy="113" r="6" fill="#171717"/>
  </svg>
`;

async function stubApi(page: Page) {
  await page.route("**/api/trpc/**", (route) => {
    const url = new URL(route.request().url());
    const ops = decodeURIComponent(url.pathname.replace(/^.*\/api\/trpc\//, "")).split(",");
    const body = ops.map((op) => {
      if (op === "appUsers.me") return { result: { data: { json: STUB_USER } } };
      if (op === "games.list")
        return { result: { data: { json: [PASS_GAME, LIVE_EDGE_GAME, SCHEDULED_EDGE_GAME] } } };
      if (op === "games.mlbLineups")
        return { result: { data: { json: LINEUPS_BY_GAME_ID } } };
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
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: deterministicTeamLogo(route.request().url()),
    }),
  );
  await page.route("https://img.mlbstatic.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/svg+xml", body: MLB_PORTRAIT_SVG }),
  );
  await page.route("https://www.rotowire.com/images/photos/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/svg+xml", body: ROTOWIRE_PORTRAIT_SVG }),
  );
}

/** Deterministic explicit mode so System's distinct grey palette does not
 *  silently inherit a host OS setting during Dark/Light geometry assertions. */
async function gotoShellFeed(
  page: Page,
  width: number,
  height = 1400,
  colorScheme: "dark" | "light" = "dark",
  themeMode: "system" | "light" | "dark" = colorScheme,
) {
  await stubApi(page);
  await page.emulateMedia({ colorScheme });
  await page.setViewportSize({ width, height });
  await page.addInitScript((mode) => {
    localStorage.setItem("dime-theme", mode);
  }, themeMode);
  await page.goto(`${baseURL}${SHELL_FEED_PATH}`);
  await page.waitForSelector(".projection-card", { timeout: 20_000 });
  await page.waitForSelector(".pregame-pitchers", { timeout: 20_000 });
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
  const signalBox = await summary.locator(".summary__signal").boundingBox();
  const bookLocator = summary.locator(".summary__item--book");
  const modelLocator = summary.locator(".summary__item--model");
  const bookBox = (await bookLocator.count()) > 0 ? await bookLocator.boundingBox() : null;
  const modelBox = (await modelLocator.count()) > 0 ? await modelLocator.boundingBox() : null;
  return {
    summaryBox,
    edgeX: edgeBox ? edgeBox.x - summaryBox.x : null,
    signalCenterX: signalBox ? signalBox.x + signalBox.width / 2 - summaryBox.x : null,
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

    if (width === 1920) {
      const rootAppearance = await page.locator(".dmf-root").evaluate((el) => ({
        background: getComputedStyle(el).backgroundColor,
        mode: el.getAttribute("data-dmf-mode"),
      }));
      expect(rootAppearance.mode).toBe("dark");
      expect(rootAppearance.background, "explicit Dark keeps the pure-black ground").toBe(
        "rgb(0, 0, 0)",
      );

      const logoGeometry = await liveCard.locator(".team-logo-box").evaluateAll((boxes) =>
        boxes.map((box) => {
          const image = box.querySelector("img");
          if (!image) throw new Error("team logo image missing");
          const wrapperRect = box.getBoundingClientRect();
          const imageRect = image.getBoundingClientRect();
          return {
            wrapperWidth: wrapperRect.width,
            wrapperHeight: wrapperRect.height,
            imageWidth: imageRect.width,
            imageHeight: imageRect.height,
            centerY: wrapperRect.y + wrapperRect.height / 2,
            filter: getComputedStyle(image).filter,
          };
        }),
      );
      expect(logoGeometry).toHaveLength(2);
      expect(Math.abs(logoGeometry[0].imageHeight - logoGeometry[1].imageHeight)).toBeLessThanOrEqual(0.5);
      expect(logoGeometry[0].imageWidth).not.toBeCloseTo(logoGeometry[1].imageWidth, 0);
      for (const logo of logoGeometry) {
        expect(Math.abs(logo.wrapperWidth - logo.imageWidth), "wrapper hugs visible logo width").toBeLessThanOrEqual(0.5);
        expect(Math.abs(logo.wrapperHeight - logo.imageHeight), "wrapper hugs visible logo height").toBeLessThanOrEqual(0.5);
      }
      expect(Math.abs(logoGeometry[0].centerY - logoGeometry[1].centerY), "team marks share one centerline").toBeLessThanOrEqual(0.5);
      expect(logoGeometry[1].filter, "Yankees receives an alpha outline on Dark").not.toBe("none");

      const passArrowColor = await passCard
        .locator(".summary-carousel--no-edge .summary__next")
        .first()
        .evaluate((el) => getComputedStyle(el).color);
      expect(passArrowColor, "No-edge pagination is neutral, never mint").toBe(
        "rgb(255, 255, 255)",
      );

      for (const [cardLabel, card] of [
        ["LIVE", liveCard],
        ["PASS", passCard],
        ["SCHEDULED", scheduledCard],
      ] as const) {
        const geometry = await card.locator(".summary").first().evaluate((summary) => {
          const pick = summary.querySelector<HTMLElement>(".summary__pick");
          const edge = summary.querySelector<HTMLElement>(".summary__item--edge");
          const book = summary.querySelector<HTMLElement>(".summary__item--book");
          const model = summary.querySelector<HTMLElement>(".summary__item--model");
          const signal = summary.querySelector<HTMLElement>(".summary__signal");
          if (!pick || !edge || !book || !model || !signal) {
            throw new Error("summary geometry node missing");
          }
          const pickStyle = getComputedStyle(pick);
          const pickRange = document.createRange();
          pickRange.selectNodeContents(pick);
          return {
            display: getComputedStyle(summary).display,
            whiteSpace: pickStyle.whiteSpace,
            pickHeight: pick.getBoundingClientRect().height,
            lineCount: Array.from(pickRange.getClientRects()).filter(
              (rect) => rect.width > 0 && rect.height > 0,
            ).length,
            edge: edge.getBoundingClientRect().toJSON(),
            book: book.getBoundingClientRect().toJSON(),
            model: model.getBoundingClientRect().toJSON(),
            signal: signal.getBoundingClientRect().toJSON(),
          };
        });
        expect(geometry.whiteSpace).toBe("nowrap");
        expect(geometry.lineCount, "MODEL EDGE stays on one line").toBe(1);
        const overlaps = (
          a: { left: number; right: number; top: number; bottom: number },
          b: { left: number; right: number; top: number; bottom: number },
        ) =>
          a.left < b.right &&
          a.right > b.left &&
          a.top < b.bottom &&
          a.bottom > b.top;
        expect(overlaps(geometry.edge, geometry.book), `${cardLabel} MODEL EDGE does not overlap BOOK`).toBe(false);
        expect(overlaps(geometry.book, geometry.model), `${cardLabel} BOOK does not overlap MODEL`).toBe(false);
        expect(
          overlaps(geometry.model, geometry.signal),
          `${cardLabel} MODEL does not overlap the signal: ${JSON.stringify(geometry)}`,
        ).toBe(false);
        if (geometry.display === "grid") {
          expect(geometry.edge.right).toBeLessThanOrEqual(geometry.book.left);
          expect(geometry.book.right).toBeLessThanOrEqual(geometry.model.left);
          expect(geometry.model.right).toBeLessThanOrEqual(geometry.signal.left);
        }
      }
    }

    // ── Item 1: scheduled row-mates stretch; live/final cards opt out and
    //    retain the requested compact natural height. ──
    await expect(liveCard.locator(".summary-carousel")).toBeVisible();
    await expect(passCard.locator(".summary-carousel")).toBeVisible();
    await expect(passCard.locator(".edge-indicator--none")).toHaveCount(3);
    const liveBox = await liveCard.boundingBox();
    const passBox = await passCard.boundingBox();
    const scheduledBox = await scheduledCard.boundingBox();
    if (!liveBox || !passBox || !scheduledBox) throw new Error("card bounding boxes missing");
    expect(passBox.x, "desktop column 2 sits to the right of column 1").toBeGreaterThan(liveBox.x + liveBox.width);
    expect(scheduledBox.x, "desktop column 3 sits to the right of column 2").toBeGreaterThan(passBox.x + passBox.width);
    expect(Math.abs(passBox.y - liveBox.y), "desktop columns 1 and 2 share one row").toBeLessThanOrEqual(1);
    expect(Math.abs(scheduledBox.y - liveBox.y), "desktop columns 1 and 3 share one row").toBeLessThanOrEqual(1);

    // The summary reflows by card width, not viewport width. Narrow desktop
    // cards stack; cards with >400px of usable content-box space use the fluid
    // full-width inline rhythm.
    const liveSummaryStyle = await liveCard.locator(".summary").first().evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        display: cs.display,
        flexDirection: cs.flexDirection,
        width: el.getBoundingClientRect().width,
      };
    });
    if (liveSummaryStyle.width <= 400) {
      expect(liveSummaryStyle.display, "narrow desktop card uses compact summary reflow").toBe("flex");
      expect(liveSummaryStyle.flexDirection).toBe("column");
    } else {
      expect(liveSummaryStyle.display, "wide desktop card uses the inline summary rhythm").toBe("grid");
    }
    if (width === 1920) {
      expect(liveSummaryStyle.display, "1920px desktop keeps all summary facts in one strip").toBe("grid");
    }
    if (liveSummaryStyle.display === "flex") {
      const passReadout = await passCard.locator(".summary__readout").first().boundingBox();
      const passEdge = await passCard.locator(".summary__edge").first().boundingBox();
      if (!passReadout || !passEdge) throw new Error("compact summary bounding boxes missing");
      expect(
        passEdge.y,
        "compact summary edge chip sits below the fact rows",
      ).toBeGreaterThanOrEqual(passReadout.y + passReadout.height - 1);
    }

    expect(
      liveBox.height,
      `compact LIVE (${liveBox.height}) is shorter than scheduled PASS (${passBox.height})`,
    ).toBeLessThan(passBox.height - 20);
    expect(
      Math.abs(passBox.height - scheduledBox.height),
      "scheduled row-mates still stretch to equal height",
    ).toBeLessThanOrEqual(1);

    const liveToggle = await liveCard.locator(".projection-card__markets-toggle").boundingBox();
    const passToggle = await passCard.locator(".projection-card__markets-toggle").boundingBox();
    const scheduledToggle = await scheduledCard.locator(".projection-card__markets-toggle").boundingBox();
    if (!liveToggle || !passToggle || !scheduledToggle) throw new Error("markets-toggle bounding boxes missing");
    expect(
      Math.abs(scheduledToggle.y + scheduledToggle.height - (passToggle.y + passToggle.height)),
      "market-trigger bottom edges align across scheduled row-mates",
    ).toBeLessThanOrEqual(1);
    // Pinned to the card's own bottom edge (padding-block-end: --space-sm =
    // 12px) — not floating mid-card.
    const passGap = passBox.y + passBox.height - (passToggle.y + passToggle.height);
    expect(passGap, `PASS market trigger sits ~12px above its own card bottom (measured ${passGap})`).toBeGreaterThanOrEqual(6);
    expect(passGap).toBeLessThanOrEqual(20);

    // ── Item 2: unified 24px/700 matchup score (LIVE card has scores) ──
    const scoreFontSize = await liveCard.locator(".matchup__score").first().evaluate((el) => getComputedStyle(el).fontSize);
    expect(scoreFontSize, "matchup__score computed font-size").toBe("24px");

    // ── Item 3: PASS-card law — opacity 0.82 ──
    const passOpacity = await passCard.evaluate((el) => getComputedStyle(el).opacity);
    expect(passOpacity, "PASS card computed opacity").toBe("0.82");
    const liveOpacity = await liveCard.evaluate((el) => getComputedStyle(el).opacity);
    expect(liveOpacity, "live card uses the lifecycle-diminished opacity").toBe("0.72");

    // Upcoming-only probable pitchers: both scheduled cards render the stable
    // Rotowire section; the live card never carries stale pregame data.
    await expect(liveCard.locator(".pregame-pitchers")).toHaveCount(0);
    const lineupsButton = passCard.getByRole("button", {
      name: "View lineups for Athletics at Rangers",
    });
    await expect(lineupsButton).toBeVisible();
    await expect(scheduledCard.getByText("Logan Webb")).toBeVisible();
    await expect(scheduledCard.getByText("7-4 · 3.21 ERA")).toBeVisible();
    const lineupsStyle = await lineupsButton.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        background: cs.backgroundColor,
        color: cs.color,
        fontWeight: cs.fontWeight,
        minHeight: cs.minHeight,
      };
    });
    expect(lineupsStyle.background, "LINEUPS uses Dime mint").toBe("rgb(69, 224, 168)");
    expect(lineupsStyle.color, "LINEUPS uses black text").toBe("rgb(0, 0, 0)");
    expect(Number(lineupsStyle.fontWeight), "LINEUPS label is bold").toBeGreaterThanOrEqual(700);
    expect(parseFloat(lineupsStyle.minHeight), "LINEUPS target is at least 44px").toBeGreaterThanOrEqual(44);

    const headshotFrame = scheduledCard.locator(".pregame-pitcher__photo").first();
    const headshot = headshotFrame.locator("img");
    await expect.poll(
      () => headshot.evaluate((image) => image.naturalWidth),
      { message: "deterministic 2:3 pitcher portrait loads" },
    ).toBe(180);
    const headshotFrameBox = await headshotFrame.boundingBox();
    const headshotBox = await headshot.boundingBox();
    if (!headshotFrameBox || !headshotBox) throw new Error("pitcher headshot geometry missing");
    const headshotGeometry = await headshot.evaluate((image) => {
      const style = getComputedStyle(image);
      const frame = image.parentElement;
      return {
        frameBorderTop: frame ? parseFloat(getComputedStyle(frame).borderTopWidth) : 0,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        objectFit: style.objectFit,
        objectPosition: style.objectPosition,
        transform: style.transform,
        untransformedWidth: parseFloat(style.width),
      };
    });
    expect(headshotGeometry).toMatchObject({
      naturalWidth: 180,
      naturalHeight: 270,
      objectFit: "contain",
      objectPosition: "50% 0%",
      transform: "matrix(0.82, 0, 0, 0.82, 0, 0)",
    });
    expect(
      headshotBox.width / headshotGeometry.untransformedWidth,
      "pitcher portrait uses the calibrated 82% scale",
    ).toBeCloseTo(0.82, 2);
    expect(
      headshotBox.height / headshotBox.width,
      "pitcher portrait preserves MLB's native 2:3 aspect ratio",
    ).toBeCloseTo(1.5, 2);
    expect(
      Math.abs(
        headshotBox.x
        + headshotBox.width / 2
        - (headshotFrameBox.x + headshotFrameBox.width / 2),
      ),
      "pitcher portrait is horizontally centered to subpixel precision",
    ).toBeLessThanOrEqual(0.5);
    expect(
      Math.abs(
        headshotBox.y - (headshotFrameBox.y + headshotGeometry.frameBorderTop),
      ),
      "pitcher portrait starts at the frame's inner top instead of the bottom",
    ).toBeLessThanOrEqual(0.5);

    const rotowireFrame = passCard.locator(".pregame-pitcher__photo").first();
    const rotowireHeadshot = rotowireFrame.locator('img[data-headshot-source="rotowire"]');
    await expect.poll(
      () => rotowireHeadshot.evaluate((image) => image.naturalWidth),
      { message: "deterministic square RotoWire portrait loads" },
    ).toBe(250);
    const rotowireFrameBox = await rotowireFrame.boundingBox();
    const rotowireHeadshotBox = await rotowireHeadshot.boundingBox();
    if (!rotowireFrameBox || !rotowireHeadshotBox) {
      throw new Error("RotoWire fallback geometry missing");
    }
    const rotowireGeometry = await rotowireHeadshot.evaluate((image) => {
      const style = getComputedStyle(image);
      return {
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        objectFit: style.objectFit,
        objectPosition: style.objectPosition,
        transform: style.transform,
        untransformedWidth: parseFloat(style.width),
      };
    });
    expect(rotowireGeometry).toMatchObject({
      naturalWidth: 250,
      naturalHeight: 250,
      objectFit: "cover",
      objectPosition: "50% 50%",
      transform: "matrix(0.9, 0, 0, 0.9, 0, 0)",
    });
    expect(
      rotowireHeadshotBox.width / rotowireGeometry.untransformedWidth,
      "square RotoWire fallback uses its source-specific 90% scale",
    ).toBeCloseTo(0.9, 2);
    expect(
      Math.abs(
        rotowireHeadshotBox.x
        + rotowireHeadshotBox.width / 2
        - (rotowireFrameBox.x + rotowireFrameBox.width / 2),
      ),
      "square RotoWire fallback is horizontally centered",
    ).toBeLessThanOrEqual(0.5);
    expect(
      Math.abs(
        rotowireHeadshotBox.y
        + rotowireHeadshotBox.height / 2
        - (rotowireFrameBox.y + rotowireFrameBox.height / 2),
      ),
      "square RotoWire fallback is vertically centered",
    ).toBeLessThanOrEqual(0.5);

    const matchupCenter = await scheduledCard.locator(".matchup__center").boundingBox();
    const matchupLogos = scheduledCard.locator(".matchup .team-logo-box");
    const awayLogo = await matchupLogos.nth(0).boundingBox();
    const homeLogo = await matchupLogos.nth(1).boundingBox();
    if (!matchupCenter || !awayLogo || !homeLogo) throw new Error("matchup logo geometry missing");
    expect(
      matchupCenter.x - (awayLogo.x + awayLogo.width),
      "away logo sits beside the away team name",
    ).toBeGreaterThanOrEqual(0);
    expect(
      matchupCenter.x - (awayLogo.x + awayLogo.width),
      "away logo-to-name gap stays compact",
    ).toBeLessThanOrEqual(12);
    expect(
      homeLogo.x - (matchupCenter.x + matchupCenter.width),
      "home logo sits beside the home team name",
    ).toBeGreaterThanOrEqual(0);
    expect(
      homeLogo.x - (matchupCenter.x + matchupCenter.width),
      "home logo-to-name gap stays compact",
    ).toBeLessThanOrEqual(12);

    const nextEdge = liveCard.locator('.summary__next[tabindex="0"]');
    await expect(nextEdge).toHaveCount(1);
    await expect(nextEdge).toHaveAccessibleName(/View next model edge:/);
    await expect(liveCard.locator(".summary-carousel__nav")).toHaveCount(0);
    const activeTrack = liveCard.locator(".summary-carousel__track");
    const initialTrackScroll = await activeTrack.evaluate((el) => el.scrollLeft);
    expect(initialTrackScroll, "the strongest edge starts flush at carousel page 1").toBeLessThanOrEqual(1);
    const nextEdgeStyle = await nextEdge.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { border: cs.borderColor, color: cs.color, width: cs.width, height: cs.height };
    });
    expect(nextEdgeStyle.border, "dark/system arrow border is white").toBe("rgb(255, 255, 255)");
    expect(nextEdgeStyle.color, "next-edge arrow is mint").toBe("rgb(69, 224, 168)");
    expect(parseFloat(nextEdgeStyle.width)).toBeGreaterThanOrEqual(44);
    expect(parseFloat(nextEdgeStyle.height)).toBeGreaterThanOrEqual(44);
    const activeSummary = liveCard.locator(".summary").first();
    const activeSummaryBox = await activeSummary.boundingBox();
    const activeTrackBox = await activeTrack.boundingBox();
    const activeEdgeBox = await activeSummary.locator(".summary__item--edge").boundingBox();
    const signalBox = await activeSummary.locator(".summary__signal").boundingBox();
    const nextEdgeBox = await nextEdge.boundingBox();
    if (!activeSummaryBox || !activeTrackBox || !activeEdgeBox || !signalBox || !nextEdgeBox) {
      throw new Error("active edge signal geometry missing");
    }
    expect(activeSummaryBox.x, "visible summary starts inside the carousel viewport").toBeGreaterThanOrEqual(
      activeTrackBox.x - 1,
    );
    expect(
      activeSummaryBox.x + activeSummaryBox.width,
      "visible summary ends inside the carousel viewport",
    ).toBeLessThanOrEqual(activeTrackBox.x + activeTrackBox.width + 1);
    for (const [label, box] of [
      ["MODEL EDGE readout", activeEdgeBox],
      ["signal group", signalBox],
      ["next-edge arrow", nextEdgeBox],
    ] as const) {
      expect(
        box.x,
        `${label} is not clipped on the carousel viewport's left edge`,
      ).toBeGreaterThanOrEqual(activeTrackBox.x - 1);
      expect(
        box.x + box.width,
        `${label} is not clipped on the carousel viewport's right edge`,
      ).toBeLessThanOrEqual(activeTrackBox.x + activeTrackBox.width + 1);
    }
    expect(nextEdgeBox.x, "next-edge arrow is not clipped on the summary left").toBeGreaterThanOrEqual(
      activeSummaryBox.x - 1,
    );
    expect(
      nextEdgeBox.x + nextEdgeBox.width,
      "next-edge arrow is not clipped on the summary right",
    ).toBeLessThanOrEqual(activeSummaryBox.x + activeSummaryBox.width + 1);
    if (width === 1280) {
      const track = liveCard.locator(".summary-carousel__track");
      await nextEdge.click();
      await expect.poll(() =>
        track.evaluate((el) => Math.round(el.scrollLeft / el.clientWidth)),
      ).toBe(1);
      const wrappedEdge = liveCard.locator('.summary__next[tabindex="0"]');
      await expect(wrappedEdge).toBeFocused();
      await wrappedEdge.click();
      await expect.poll(() =>
        track.evaluate((el) => Math.round(el.scrollLeft / el.clientWidth)),
      ).toBe(0);
      await expect(liveCard.locator('.summary__next[tabindex="0"]')).toBeFocused();
    }

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

    // ── Item 7: market-trigger hover — shell row-hover fill on the 160ms curve ──
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

    // ── Item 5: aligned summary mini-grid — fluid primary, stable fact tracks ──
    // Placed LAST (after items 1,2,3,4,6,7 above, which all independently
    // verify clean): a real pre-existing defect surfaces here at 1024/1280 —
    // see the block comment below — and this ordering keeps that failure
    // from masking the other six items' otherwise-passing verification.
    //
    // The inline summary now uses the card's full width and reflows
    // at or below a 400px content lane, so neither its readout nor the
    // pill/arrow group can create horizontal shell overflow.
    const shellScrollOverflow = await page
      .locator(".dc-shell-external-scroll")
      .evaluate((el) => el.scrollWidth - el.clientWidth);
    const liveOffsets = await summaryOffsets(liveCard);
    const passOffsets = await summaryOffsets(passCard);
    const scheduledOffsets = await summaryOffsets(scheduledCard);
    expect(
      shellScrollOverflow,
      `shell scroll pane horizontal overflow px (summary widths: ` +
        `LIVE .summary width=${liveOffsets.summaryBox.width} PASS=${passOffsets.summaryBox.width} SCHEDULED=${scheduledOffsets.summaryBox.width}, ` +
        `inline rhythm reflows at 400px content)`,
    ).toBeLessThanOrEqual(1);
    expect(liveOffsets.edgeX, "edge chip present on LIVE").not.toBeNull();
    expect(passOffsets.edgeX, "edge chip present on PASS ('No edge')").not.toBeNull();
    expect(scheduledOffsets.edgeX, "edge chip present on SCHEDULED").not.toBeNull();
    if (liveSummaryStyle.display === "flex") {
      for (const [label, offsets] of [
        ["LIVE", liveOffsets],
        ["PASS", passOffsets],
        ["SCHEDULED", scheduledOffsets],
      ] as const) {
        expect(
          Math.abs(offsets.signalCenterX! - offsets.summaryBox.width / 2),
          `${label} compact signal group is centered beneath its fact rows`,
        ).toBeLessThanOrEqual(1);
      }
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

    // ── Paginated market popover: one table at a time, all three MLB
    // markets reachable, portalled overlay never changes card/grid geometry,
    // and Escape closes then restores focus to the trigger. Captured at the
    // representative 1440px desktop width. ──
    if (width === 1440) {
      const liveToggle = liveCard.locator(".projection-card__markets-toggle");
      const beforeUrl = page.url();
      const closedLive = await liveCard.boundingBox();
      const closedPass = await passCard.boundingBox();
      if (!closedLive || !closedPass)
        throw new Error("closed card bounding boxes missing");

      await expect(liveToggle).toHaveAttribute("aria-expanded", "false");
      await liveToggle.click();
      await expect(liveToggle).toHaveAttribute("aria-expanded", "true");

      const popover = page.getByRole("dialog", {
        name: "Dodgers at Yankees model projections",
      });
      await expect(popover).toBeVisible();
      await popover.evaluate(async element => {
        await Promise.all(
          element
            .getAnimations()
            .map(animation => animation.finished.catch(() => undefined))
        );
      });
      await expect(popover.locator(".market-table")).toHaveCount(1);
      await expect(popover.locator(".market-table__caption")).toHaveText(
        "Run Line"
      );

      const openLive = await liveCard.boundingBox();
      const openPass = await passCard.boundingBox();
      const popoverBox = await popover.boundingBox();
      if (!openLive || !openPass || !popoverBox)
        throw new Error("popover/card bounding boxes missing");
      for (const dimension of ["x", "y", "width", "height"] as const) {
        expect(
          Math.abs(openLive[dimension] - closedLive[dimension]),
          `opening the portalled popover does not change its card ${dimension}`
        ).toBeLessThanOrEqual(1);
        expect(
          Math.abs(openPass[dimension] - closedPass[dimension]),
          `opening a neighbor's popover does not change its row-mate ${dimension}`
        ).toBeLessThanOrEqual(1);
      }
      expect(
        popoverBox.x,
        "popover respects the left viewport gutter"
      ).toBeGreaterThanOrEqual(8);
      expect(
        popoverBox.x + popoverBox.width,
        "popover respects the right viewport gutter"
      ).toBeLessThanOrEqual(width - 8);

      const pagination = popover.getByRole("navigation", {
        name: "Model projection market pages for Dodgers at Yankees",
      });
      const previous = pagination.getByRole("link", {
        name: "Go to previous page",
      });
      const next = pagination.getByRole("link", { name: "Go to next page" });
      const runLinePage = pagination.getByRole("link", {
        name: "Show Run Line projections, page 1 of 3",
      });
      const marketRegion = popover.getByRole("region", {
        name: "Run Line model projections",
      });
      const marketRegionId = await marketRegion.getAttribute("id");
      expect(
        marketRegionId,
        "market region exposes a pagination target id"
      ).toBeTruthy();
      await expect(previous).toHaveAttribute("aria-disabled", "true");
      await expect(previous).toHaveAttribute("tabindex", "-1");
      await expect(previous).toHaveAttribute("aria-controls", marketRegionId!);
      await expect(runLinePage).toHaveAttribute("aria-current", "page");
      await expect(runLinePage).toHaveAttribute(
        "aria-controls",
        marketRegionId!
      );

      for (const control of [
        previous,
        runLinePage,
        pagination.getByRole("link", {
          name: "Show Total projections, page 2 of 3",
        }),
        pagination.getByRole("link", {
          name: "Show Moneyline projections, page 3 of 3",
        }),
        next,
      ]) {
        const controlBox = await control.boundingBox();
        if (!controlBox)
          throw new Error("pagination control bounding box missing");
        expect(
          controlBox.width,
          "pagination control has a >=44px hit target"
        ).toBeGreaterThanOrEqual(44);
        expect(
          controlBox.height,
          "pagination control has a >=44px hit target"
        ).toBeGreaterThanOrEqual(44);
      }

      await next.click();
      await expect(popover.locator(".market-table__caption")).toHaveText(
        "Total"
      );
      await expect(popover.locator(".market-table")).toHaveCount(1);
      await expect(
        pagination.getByRole("link", {
          name: "Show Total projections, page 2 of 3",
        })
      ).toHaveAttribute("aria-current", "page");

      const moneylinePage = pagination.getByRole("link", {
        name: "Show Moneyline projections, page 3 of 3",
      });
      await moneylinePage.click();
      await expect(popover.locator(".market-table__caption")).toHaveText(
        "Moneyline"
      );
      await expect(moneylinePage).toBeFocused();
      await expect(next).toHaveAttribute("aria-disabled", "true");
      await expect(next).toHaveAttribute("tabindex", "-1");
      expect(page.url(), "pagination does not mutate the feed URL").toBe(
        beforeUrl
      );

      await previous.click();
      await expect(popover.locator(".market-table__caption")).toHaveText(
        "Total"
      );
      await expect(
        pagination.getByRole("link", {
          name: "Show Total projections, page 2 of 3",
        })
      ).toHaveAttribute("aria-current", "page");
      await expect(runLinePage).not.toHaveAttribute("aria-current", "page");
      await page.waitForTimeout(200);
      await page.screenshot({
        path: `${EVIDENCE_DIR}/popover-1440.png`,
        fullPage: true,
      });

      await page.keyboard.press("Escape");
      await expect(popover).toHaveCount(0);
      await expect(liveToggle).toHaveAttribute("aria-expanded", "false");
      await expect(liveToggle).toBeFocused();

      // Pointer interaction outside the floating layer closes it as well.
      await liveToggle.click();
      await expect(popover).toBeVisible();
      await page.locator(".dmf-toptitle").click();
      await expect(popover).toHaveCount(0);
      await expect(liveToggle).toHaveAttribute("aria-expanded", "false");
      await expect(liveToggle).toBeFocused();

      // The portalled surface consumes the global light-theme tokens rather
      // than a card-scoped dark fallback; mint text uses its contrast-safe
      // light-theme value.
      await page.evaluate(() =>
        document.documentElement.classList.remove("dark")
      );
      await liveToggle.click();
      await expect(popover).toBeVisible();
      const lightThemeColors = await popover.evaluate(element => {
        const popoverStyle = getComputedStyle(element);
        const eyebrowStyle = getComputedStyle(
          element.querySelector(".projection-card__markets-eyebrow")!
        );
        return {
          background: popoverStyle.backgroundColor,
          foreground: popoverStyle.color,
          eyebrow: eyebrowStyle.color,
        };
      });
      expect(lightThemeColors).toEqual({
        background: "rgb(255, 255, 255)",
        foreground: "rgb(0, 0, 0)",
        eyebrow: "rgb(15, 163, 107)",
      });
      await page.keyboard.press("Escape");
      await expect(popover).toHaveCount(0);
      await page.evaluate(() => document.documentElement.classList.add("dark"));

      // Full Rotowire lineups use a modal (18 rows need more room than the
      // market popover), preserve focus, and keep both teams visible.
      const lineupsTrigger = scheduledCard.getByRole("button", {
        name: "View lineups for Giants at Mariners",
      });
      await lineupsTrigger.click();
      const lineupsDialog = page.getByRole("dialog", {
        name: "Giants at Mariners lineups",
      });
      await expect(lineupsDialog).toBeVisible();
      await lineupsDialog.evaluate(async element => {
        await Promise.all(
          element
            .getAnimations()
            .map(animation => animation.finished.catch(() => undefined))
        );
      });
      await expect(lineupsDialog.getByText("Logan Webb")).toBeVisible();
      await expect(lineupsDialog.getByText("George Kirby")).toBeVisible();
      await expect(lineupsDialog.getByText("Confirmed lineup")).toBeVisible();
      await expect(lineupsDialog.getByText("Expected lineup")).toBeVisible();
      await expect(lineupsDialog.locator(".lineups-dialog__player")).toHaveCount(18);
      const teamColumns = lineupsDialog.locator(".lineups-dialog__team");
      const awayColumn = await teamColumns.nth(0).boundingBox();
      const homeColumn = await teamColumns.nth(1).boundingBox();
      if (!awayColumn || !homeColumn) throw new Error("lineup team columns missing");
      expect(homeColumn.x, "desktop lineup teams render side-by-side").toBeGreaterThan(
        awayColumn.x + awayColumn.width - 2,
      );
      await page.keyboard.press("Escape");
      await expect(lineupsDialog).toHaveCount(0);
      await expect(lineupsTrigger).toBeFocused();
    }
  });
}

test("shell feed tablet 900px: items 2,3,4,5,7 active; items 1,6 inert", async ({ page }) => {
  await gotoShellFeed(page, 900);
  await assertNoHorizontalOverflow(page, "shell-900");

  const liveCard = cardByAriaLabel(page, "Dodgers at Yankees");
  const passCard = cardByAriaLabel(page, "Athletics at Rangers");
  const scheduledCard = cardByAriaLabel(page, "Giants at Mariners");

  // ── Item 1 inert: 2-column tablet rows start-align. Scheduled PASS now owns
  //    the richer pitcher section, while LIVE stays compact. ──
  const liveBox = await liveCard.boundingBox();
  const passBox = await passCard.boundingBox();
  const scheduledBox = await scheduledCard.boundingBox();
  if (!liveBox || !passBox || !scheduledBox) throw new Error("card bounding boxes missing");
  expect(passBox.height, "scheduled PASS is taller than compact LIVE on tablet").toBeGreaterThan(liveBox.height + 20);
  expect(passBox.x, "two columns: PASS sits to the right of LIVE").toBeGreaterThan(liveBox.x + liveBox.width);
  expect(Math.abs(passBox.y - liveBox.y), "two columns: PASS and LIVE share the same row").toBeLessThanOrEqual(1);
  expect(Math.abs(scheduledBox.x - liveBox.x), "tablet row 2 returns to column 1").toBeLessThanOrEqual(1);
  expect(scheduledBox.y, "tablet row 2 sits below the taller row-1 card").toBeGreaterThan(passBox.y + passBox.height);

  // ── Item 2 active: 24px matchup score ──
  const scoreFontSize = await liveCard.locator(".matchup__score").first().evaluate((el) => getComputedStyle(el).fontSize);
  expect(scoreFontSize, "matchup__score computed font-size at tablet").toBe("24px");

  // ── Item 3 active: PASS opacity 0.82 ──
  const passOpacity = await passCard.evaluate((el) => getComputedStyle(el).opacity);
  expect(passOpacity, "PASS card computed opacity at tablet").toBe("0.82");
  const liveOpacity = await liveCard.evaluate((el) => getComputedStyle(el).opacity);
  expect(liveOpacity, "LIVE lifecycle opacity at tablet").toBe("0.72");
  await expect(liveCard.locator(".pregame-pitchers")).toHaveCount(0);
  await expect(passCard.locator(".pregame-pitchers")).toBeVisible();

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
  await gotoShellFeed(page, 375, 667);
  await assertNoHorizontalOverflow(page, "shell-375");

  const liveCard = cardByAriaLabel(page, "Dodgers at Yankees");
  const passCard = cardByAriaLabel(page, "Athletics at Rangers");

  // Item 1 inert: cards keep natural height; scheduled PASS is richer and
  // visibly taller than compact LIVE.
  const liveBox = await liveCard.boundingBox();
  const passBox = await passCard.boundingBox();
  if (!liveBox || !passBox) throw new Error("card bounding boxes missing");
  expect(passBox.height, "scheduled PASS is taller than compact LIVE on mobile").toBeGreaterThan(liveBox.height + 20);
  expect(Math.abs(passBox.x - liveBox.x), "mobile cards share the single grid column").toBeLessThanOrEqual(1);
  expect(passBox.y, "mobile card 2 sits below card 1").toBeGreaterThan(liveBox.y + liveBox.height);

  // Item 2 inert: fluid clamp, not the pinned 24px.
  const scoreFontSize = await liveCard.locator(".matchup__score").first().evaluate((el) => getComputedStyle(el).fontSize);
  expect(scoreFontSize, "matchup__score is NOT pinned to 24px on mobile").not.toBe("24px");
  expect(parseFloat(scoreFontSize)).toBeLessThan(24);

  // Item 3 inert: no forced opacity.
  const passOpacity = await passCard.evaluate((el) => getComputedStyle(el).opacity);
  expect(passOpacity, "PASS card opacity is NOT forced to 0.82 on mobile").toBe("1");
  const liveOpacity = await liveCard.evaluate((el) => getComputedStyle(el).opacity);
  expect(liveOpacity, "compact LIVE opacity applies at every breakpoint").toBe("0.72");

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

  // The popover remains viewport-contained and paginates all three MLB
  // markets without resizing the mobile card or changing the feed URL.
  const beforeUrl = page.url();
  await toggle.click();
  const popover = page.getByRole("dialog", {
    name: "Athletics at Rangers model projections",
  });
  await expect(popover).toBeVisible();
  await popover.evaluate(async element => {
    await Promise.all(
      element
        .getAnimations()
        .map(animation => animation.finished.catch(() => undefined))
    );
  });
  await expect(popover.locator(".market-table")).toHaveCount(1);
  await expect(popover.locator(".market-table__caption")).toHaveText(
    "Run Line"
  );
  const popoverBox = await popover.boundingBox();
  const openPassBox = await passCard.boundingBox();
  if (!popoverBox || !openPassBox)
    throw new Error("mobile popover/card bounding boxes missing");
  expect(
    popoverBox.x,
    "mobile popover respects the left gutter"
  ).toBeGreaterThanOrEqual(8);
  expect(
    popoverBox.x + popoverBox.width,
    "mobile popover respects the right gutter"
  ).toBeLessThanOrEqual(375 - 8);
  expect(
    popoverBox.y,
    "short mobile popover respects the top gutter"
  ).toBeGreaterThanOrEqual(8);
  expect(
    popoverBox.y + popoverBox.height,
    "short mobile popover respects the bottom gutter"
  ).toBeLessThanOrEqual(667 - 8);
  const verticalContainment = await popover.evaluate(element => {
    const style = getComputedStyle(element);
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: style.overflowY,
    };
  });
  expect(verticalContainment.overflowY).toBe("auto");
  expect(
    verticalContainment.clientHeight,
    "short mobile popover stays within the collision-safe viewport height"
  ).toBeLessThanOrEqual(667 - 16);
  expect(
    verticalContainment.scrollHeight,
    "limited-height content remains contained by the popover scrollport"
  ).toBeGreaterThanOrEqual(verticalContainment.clientHeight);
  expect(
    Math.abs(openPassBox.height - passBox.height),
    "mobile popover does not resize its card"
  ).toBeLessThanOrEqual(1);

  const pagination = popover.getByRole("navigation", {
    name: "Model projection market pages for Athletics at Rangers",
  });
  const moneylinePage = pagination.getByRole("link", {
    name: "Show Moneyline projections, page 3 of 3",
  });
  await moneylinePage.click();
  await expect(popover.locator(".market-table__caption")).toHaveText(
    "Moneyline"
  );
  await expect(moneylinePage).toBeFocused();
  await expect(moneylinePage).toHaveAttribute("aria-current", "page");
  await expect(
    pagination.getByRole("link", {
      name: "Show Run Line projections, page 1 of 3",
    })
  ).not.toHaveAttribute("aria-current", "page");
  await expect(popover.locator(".market-table")).toHaveCount(1);
  await expect(
    pagination.getByRole("link", { name: "Go to next page" })
  ).toHaveAttribute("aria-disabled", "true");
  await expect(
    pagination.getByRole("link", { name: "Go to next page" })
  ).toHaveAttribute("tabindex", "-1");
  expect(page.url(), "mobile pagination does not mutate the feed URL").toBe(
    beforeUrl
  );
  await assertNoHorizontalOverflow(page, "shell-375-popover");
  await page.waitForTimeout(200);
  await page.screenshot({
    path: `${EVIDENCE_DIR}/popover-375.png`,
    fullPage: true,
  });

  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(toggle).toBeFocused();

  const lineupsTrigger = passCard.getByRole("button", {
    name: "View lineups for Athletics at Rangers",
  });
  await lineupsTrigger.click();
  const lineupsDialog = page.getByRole("dialog", {
    name: "Athletics at Rangers lineups",
  });
  await expect(lineupsDialog).toBeVisible();
  await lineupsDialog.evaluate(async element => {
    await Promise.all(
      element
        .getAnimations()
        .map(animation => animation.finished.catch(() => undefined))
    );
  });
  await expect(lineupsDialog.locator(".lineups-dialog__player")).toHaveCount(18);
  const dialogBox = await lineupsDialog.boundingBox();
  if (!dialogBox) throw new Error("mobile lineups dialog bounding box missing");
  expect(dialogBox.x).toBeGreaterThanOrEqual(8);
  expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(375 - 8);
  expect(dialogBox.y).toBeGreaterThanOrEqual(8);
  expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(667 - 8);
  const mobileTeamsLayout = await lineupsDialog.locator(".lineups-dialog__teams").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      columns: style.gridTemplateColumns.split(" ").length,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: style.overflowY,
    };
  });
  expect(mobileTeamsLayout.columns, "mobile lineup teams stack in one column").toBe(1);
  expect(mobileTeamsLayout.overflowY).toBe("auto");
  expect(mobileTeamsLayout.scrollHeight).toBeGreaterThan(mobileTeamsLayout.clientHeight);
  const dialogClose = lineupsDialog.getByRole("button", { name: "Close" });
  const closeBox = await dialogClose.boundingBox();
  if (!closeBox) throw new Error("lineups dialog close control missing");
  expect(closeBox.width).toBeGreaterThanOrEqual(44);
  expect(closeBox.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Escape");
  await expect(lineupsDialog).toHaveCount(0);
  await expect(lineupsTrigger).toBeFocused();

  await page.screenshot({
    path: `${EVIDENCE_DIR}/shell-375.png`,
    fullPage: true,
  });
});

test("light theme: the next-edge control keeps a black border and mint arrow", async ({ page }) => {
  await gotoShellFeed(page, 900, 900, "light");
  const liveCard = cardByAriaLabel(page, "Dodgers at Yankees");
  const nextEdge = liveCard.locator('.summary__next[tabindex="0"]');
  await expect(nextEdge).toBeVisible();
  const colors = await nextEdge.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { border: cs.borderColor, color: cs.color };
  });
  expect(colors.border, "light-theme arrow border is black").toBe("rgb(0, 0, 0)");
  expect(colors.color, "light-theme arrow remains Dime mint").toBe("rgb(69, 224, 168)");
  const yankeesFilter = await liveCard
    .locator(".team-logo-box--dark-outline .team-logo")
    .last()
    .evaluate((el) => getComputedStyle(el).filter);
  expect(yankeesFilter, "Light keeps the original Yankees artwork without a white outline").toBe("none");
  await assertNoHorizontalOverflow(page, "shell-900-light");
});

test("System stays neutral grey with dark-contrast ink even when the OS prefers light", async ({ page }) => {
  await gotoShellFeed(page, 900, 900, "light", "system");
  const root = page.locator(".dmf-root");
  await expect(root).toHaveAttribute("data-dmf-mode", "system");
  const palette = await root.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      page: cs.backgroundColor,
      card: getComputedStyle(el.querySelector(".projection-card")!).backgroundColor,
      htmlMode: document.documentElement.dataset.themeMode,
      htmlDark: document.documentElement.classList.contains("dark"),
      contrastTheme: el.getAttribute("data-dmf-theme"),
    };
  });
  expect(palette.htmlMode).toBe("system");
  expect(palette.htmlDark, "System uses dark-contrast ink on its grey ground").toBe(true);
  expect(palette.contrastTheme).toBe("dark");
  expect(palette.page, "System page is grey, not black").toBe("rgb(18, 18, 18)");
  expect(palette.card, "System cards use the raised grey surface").toBe("rgb(24, 24, 24)");

  const yankeesFilter = await cardByAriaLabel(page, "Dodgers at Yankees")
    .locator(".team-logo-box--dark-outline .team-logo")
    .last()
    .evaluate((el) => getComputedStyle(el).filter);
  expect(yankeesFilter, "System keeps the Yankees mark legible").not.toBe("none");
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
