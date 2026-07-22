/**
 * Trends layout — side-by-side rows, always-open panels, sidebar scale
 * ═══════════════════════════════════════════════════════════════════
 * Reproduces the v2 Trends contracts (Tasks 1-5): per-game rows lay Last 5
 * Games and Trends out side by side (`[data-trends-game-row]`, a 2-column
 * grid), both panels render permanently expanded (`collapsible={false}` —
 * no chevron toggle), games sort chronologically using the canonical
 * gameUtils 12-hour-aware time helpers, and the persistent (>=1024px)
 * sidebar renders at the owner-directed text/icon scale with a profile row
 * grounded to the sidebar's content-box foot. Runs against the vite dev
 * server with every tRPC procedure stubbed (no DB) — two fixture MLB games
 * at TODAY_ISO, one 12-hour-AM start time and one 12-hour-PM start time,
 * deliberately listed PM-first in the games.list fixture so a passing
 * chronological-order assertion proves the app's own sort runs (not just
 * fixture-order pass-through).
 *
 * Contracts, at each width in WIDTHS:
 *   1. Every `[data-trends-game-row]` contains exactly 2 visible panel
 *      columns whose boxes overlap vertically and do not overlap
 *      horizontally (genuinely side-by-side).
 *   2. Both panels render real content (Last-5 table rows + Trends record
 *      bars) and zero lucide chevron-toggle svgs exist inside any
 *      `[data-trends-game-row]`.
 *   3. Games render in true chronological order (11:35 AM row above
 *      6:40 PM row) with correct AM/PM text.
 *   4. No horizontal page overflow and no `[data-trends-game-row]`
 *      descendant's right edge past the viewport.
 *   5. (>=1024px only, persistent sidebar) `.dc-sidebar-row` computed
 *      font-size is 22.75px; the Trends nav icon's box width >= 22px; the
 *      longest label is not truncated; the profile row bottom sits within
 *      2px of the sidebar's content-box bottom.
 * Screenshots land in docs/evidence/2026-07-21-trends-v2/.
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";

const EVIDENCE_DIR = "docs/evidence/2026-07-21-trends-v2";
const WIDTHS = [768, 1024, 1440, 1920] as const;
const SIDEBAR_MIN_WIDTH = 1024; // DimeChatPage.tsx:1092 — `compact` drawer below this
const SIDEBAR_SCREENSHOT_WIDTH = 1024; // tightest width where the sidebar is persistent

const TODAY_ISO = "2026-07-21";

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

// ─── games.list fixture ─────────────────────────────────────────────────────
// TrendsPage.tsx only reads `id` / `awayTeam` / `homeTeam` / `startTimeEst`
// off each games.list row (see the `TrendsGameRow` structural interface,
// TrendsPage.tsx:26-31) — it does not render GameCard, so none of the wider
// games.list field set (spreads/totals/model fields) is needed here.
// Deliberately listed PM-first: TrendsPage.tsx's `sortedGames` memo re-sorts
// by `timeToMinutes(startTimeEst)` (gameUtils.ts), so a passing chronological
// assertion below proves that sort runs — not that the fixture happened to
// already be in order.
const GAMES_LIST = [
  {
    id: 7002,
    sport: "MLB",
    awayTeam: "LAD",
    homeTeam: "SF",
    gameDate: TODAY_ISO,
    startTimeEst: "6:40 PM",
    gameStatus: "upcoming",
  },
  {
    id: 7001,
    sport: "MLB",
    awayTeam: "NYY",
    homeTeam: "BOS",
    gameDate: TODAY_ISO,
    startTimeEst: "11:35 AM",
    gameStatus: "upcoming",
  },
];

// ─── mlbSchedule.getLast5ForMatchup / getH2HGames fixtures ─────────────────
// Field shapes confirmed against the `ScheduleGame` interface consumed in
// RecentSchedulePanel.tsx:32-78 (the client-side shape the panel actually
// reads — server/mlbScheduleHistoryService.ts's getLast5ForMatchup /
// getMlbH2HGames are the server-side source of these same fields, wired
// through server/routers/mlbSchedule.ts's getLast5ForMatchup (returns
// `{ awayLast5, homeLast5 }`, line 87) and getH2HGames (returns `{ games }`,
// line 187) unchanged). One stub payload answers every
// getLast5ForMatchup/getH2HGames call regardless of awaySlug/homeSlug input
// (matching the batch-by-op-name stub pattern already proven in
// e2e/splits-layout.spec.ts) — sufficient to prove both panels render real
// table rows, which is the only thing the contracts below assert.
function scheduleGame(overrides: Record<string, unknown>) {
  return {
    id: 1,
    anGameId: 900001,
    gameDate: "2026-07-14",
    startTimeUtc: "2026-07-14T23:05:00Z",
    gameStatus: "final",
    awaySlug: "new-york-yankees",
    awayAbbr: "NYY",
    awayName: "New York Yankees",
    awayTeamId: 147,
    awayScore: 6,
    homeSlug: "boston-red-sox",
    homeAbbr: "BOS",
    homeName: "Boston Red Sox",
    homeTeamId: 111,
    homeScore: 3,
    dkAwayRunLine: "-1.5",
    dkAwayRunLineOdds: "+135",
    dkHomeRunLine: "+1.5",
    dkHomeRunLineOdds: "-160",
    dkTotal: "8.5",
    dkOverOdds: "-110",
    dkUnderOdds: "-110",
    dkAwayML: "-150",
    dkHomeML: "+130",
    awayRunLineCovered: true,
    homeRunLineCovered: false,
    totalResult: "OVER",
    awayWon: true,
    ...overrides,
  };
}

const AWAY_LAST5 = [
  scheduleGame({ id: 1, anGameId: 900001 }),
  scheduleGame({
    id: 2,
    anGameId: 900002,
    gameDate: "2026-07-13",
    awayScore: 2,
    homeScore: 5,
    awayRunLineCovered: false,
    homeRunLineCovered: true,
    totalResult: "UNDER",
    awayWon: false,
  }),
];

const HOME_LAST5 = [
  scheduleGame({
    id: 3,
    anGameId: 900003,
    gameDate: "2026-07-12",
    awaySlug: "tampa-bay-rays",
    awayAbbr: "TB",
    awayName: "Tampa Bay Rays",
    awayTeamId: 139,
    homeSlug: "boston-red-sox",
    homeAbbr: "BOS",
    homeName: "Boston Red Sox",
    homeTeamId: 111,
    awayScore: 3,
    homeScore: 7,
    awayWon: false,
  }),
  scheduleGame({
    id: 4,
    anGameId: 900004,
    gameDate: "2026-07-11",
    awaySlug: "tampa-bay-rays",
    awayAbbr: "TB",
    awayName: "Tampa Bay Rays",
    awayTeamId: 139,
    homeSlug: "boston-red-sox",
    homeAbbr: "BOS",
    homeName: "Boston Red Sox",
    homeTeamId: 111,
    awayScore: 4,
    homeScore: 1,
    totalResult: "OVER",
    awayWon: true,
  }),
];

const H2H_GAMES = [
  scheduleGame({ id: 5, anGameId: 900005 }),
  scheduleGame({
    id: 6,
    anGameId: 900006,
    gameDate: "2026-06-02",
    awayScore: 1,
    homeScore: 4,
    awayWon: false,
    totalResult: "UNDER",
  }),
];

// ─── mlbSchedule.getSituationalStats fixture ───────────────────────────────
// Full `SituationalStats` shape confirmed against
// client/src/components/SituationalResultsPanel.tsx:39-65: ml/spread/total,
// each with overall/last10/home/away/favorite/underdog `SituationalRecord`s
// ({ wins, losses, pushes? }), plus a top-level `gamesAnalyzed`. Server-side
// this is produced by getMlbSituationalStats (mlbScheduleHistoryService.ts),
// wired unchanged through server/routers/mlbSchedule.ts's getSituationalStats
// (returns the stats object directly, line 153 — no `{ json: ... }` envelope
// wrapper beyond tRPC's own). One block answers both the away-team and
// home-team query for every tab.
function situationalRecord(wins: number, losses: number, pushes = 0) {
  return pushes > 0 ? { wins, losses, pushes } : { wins, losses };
}

function situationalBlock() {
  return {
    overall: situationalRecord(24, 18),
    last10: situationalRecord(6, 4),
    home: situationalRecord(14, 8),
    away: situationalRecord(10, 10),
    favorite: situationalRecord(16, 12),
    underdog: situationalRecord(8, 6, 1),
  };
}

const SITUATIONAL_STATS = {
  ml: situationalBlock(),
  spread: situationalBlock(),
  total: situationalBlock(),
  gamesAnalyzed: 42,
};

async function stubApi(page: Page) {
  await page.route("**/api/trpc/**", route => {
    const url = new URL(route.request().url());
    const ops = decodeURIComponent(
      url.pathname.replace(/^.*\/api\/trpc\//, "")
    ).split(",");
    const body = ops.map(op => {
      if (op === "appUsers.me") return { result: { data: { json: STUB_USER } } };
      // Answered regardless of the requested gameDate input (procedure-level
      // stub, not date-level) — date-independent even across a rollover.
      if (op === "games.list") return { result: { data: { json: GAMES_LIST } } };
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
      if (op === "mlbSchedule.getLast5ForMatchup")
        return {
          result: {
            data: { json: { awayLast5: AWAY_LAST5, homeLast5: HOME_LAST5 } },
          },
        };
      if (op === "mlbSchedule.getH2HGames")
        return { result: { data: { json: { games: H2H_GAMES } } } };
      if (op === "mlbSchedule.getSituationalStats")
        return { result: { data: { json: SITUATIONAL_STATS } } };
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
  // Non-tRPC API surfaces (SSE chat, uploads) — fail fast instead of hanging.
  // /trends renders inside the Dime shell (DimeChatPage) at every width in
  // WIDTHS, so the chat pane's own network surface must not hang the page.
  await page.route("**/api/dime/**", route =>
    route.fulfill({ status: 500, body: "stubbed offline (e2e)" })
  );
}

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

for (const width of WIDTHS) {
  test(`trends layout: side-by-side rows, always-open panels, chronological order at ${width}px`, async ({
    page,
  }) => {
    await stubApi(page);
    // Tall viewport: both fixture game rows must sit inside the initial
    // layout + the useVisibility hook's 200px IntersectionObserver root
    // margin (useVisibility.ts) so BOTH panels' queries actually fire on
    // load — a page that never renders real (non-empty-state) panel content
    // is not a valid pass per the task brief, so this harness must not rely
    // on scrolling to trigger the gate.
    await page.setViewportSize({ width, height: 2400 });
    await page.goto("/trends");
    await page.waitForSelector("[data-trends-game-row]");
    // Wait for genuine fetched content (not the "No completed games found."
    // empty state, which would also satisfy a weaker DOM-presence check).
    await page.waitForSelector("[data-trends-game-row] table tbody tr");
    await page.waitForSelector("[data-trends-game-row] >> text=Overall Record");

    await page.screenshot({
      path: `${EVIDENCE_DIR}/trends-${width}.png`,
      fullPage: false,
    });

    // ── Contract 1: genuinely side-by-side columns ─────────────────────
    const rowGeometry = await page.evaluate(() => {
      return Array.from(
        document.querySelectorAll<HTMLElement>("[data-trends-game-row]")
      ).map(row => {
        const cols = Array.from(row.children) as HTMLElement[];
        return cols.map(c => {
          const r = c.getBoundingClientRect();
          return {
            top: r.top,
            bottom: r.bottom,
            left: r.left,
            right: r.right,
            width: r.width,
            height: r.height,
          };
        });
      });
    });
    expect(rowGeometry.length, "at least one trends game row rendered").toBeGreaterThan(0);
    for (const cols of rowGeometry) {
      expect(cols.length, "exactly 2 panel columns per row").toBe(2);
      const [left, right] = cols;
      expect(left.width, "left column has visible width").toBeGreaterThan(0);
      expect(left.height, "left column has visible height").toBeGreaterThan(0);
      expect(right.width, "right column has visible width").toBeGreaterThan(0);
      expect(right.height, "right column has visible height").toBeGreaterThan(0);
      const overlapsVertically = left.top < right.bottom && right.top < left.bottom;
      expect(overlapsVertically, "columns share the same row vertically").toBe(true);
      expect(
        left.right,
        `left column right (${left.right}) must not pass right column left (${right.left})`
      ).toBeLessThanOrEqual(right.left);
    }

    // ── Contract 2: both panels expanded with real content, zero chevrons ──
    const chevronCount = await page
      .locator(
        "[data-trends-game-row] svg.lucide-chevron-down, [data-trends-game-row] svg.lucide-chevron-up"
      )
      .count();
    expect(chevronCount, "no chevron toggle svgs inside any trends game row").toBe(0);

    const contentVisibility = await page.evaluate(() => {
      return Array.from(
        document.querySelectorAll<HTMLElement>("[data-trends-game-row]")
      ).map(row => {
        const tableRows = Array.from(row.querySelectorAll("table tbody tr"));
        const anyTableRowVisible = tableRows.some(tr => {
          const r = (tr as HTMLElement).getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        const overallLabels = Array.from(row.querySelectorAll("span")).filter(
          s => s.textContent?.trim() === "Overall Record"
        );
        const anyLabelVisible = overallLabels.some(l => {
          const r = l.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        // Trends record bars: leaf divs whose text is a "W-L" / "W-L-P"
        // record (fmtRecord output), e.g. "24-18" or "8-6-1" — distinct from
        // the "—" no-data placeholder, so this proves real fixture data
        // rendered, not just an empty shell.
        const recordBars = Array.from(row.querySelectorAll("div")).filter(d => {
          if (d.children.length > 0) return false;
          const text = d.textContent?.trim() ?? "";
          return /^\d+-\d+(-\d+)?$/.test(text);
        });
        const anyRecordBarVisible = recordBars.some(b => {
          const r = (b as HTMLElement).getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        return {
          tableRowCount: tableRows.length,
          anyTableRowVisible,
          overallLabelCount: overallLabels.length,
          anyLabelVisible,
          recordBarCount: recordBars.length,
          anyRecordBarVisible,
        };
      });
    });
    for (const c of contentVisibility) {
      expect(c.tableRowCount, "Last-5 panel rendered table rows").toBeGreaterThan(0);
      expect(c.anyTableRowVisible, "Last-5 table rows are visible").toBe(true);
      expect(c.overallLabelCount, "Trends panel rendered its Overall Record row").toBeGreaterThan(0);
      expect(c.anyLabelVisible, "Trends 'Overall Record' label is visible").toBe(true);
      expect(c.recordBarCount, "Trends panel rendered W-L record bars").toBeGreaterThan(0);
      expect(c.anyRecordBarVisible, "Trends record bars are visible").toBe(true);
    }

    // ── Contract 3: true chronological order + correct AM/PM text ──────
    const order = await page.evaluate(() => {
      return Array.from(
        document.querySelectorAll<HTMLElement>("[data-trends-game-row]")
      ).map(row => {
        const header = row.previousElementSibling as HTMLElement | null;
        const spans = header ? Array.from(header.querySelectorAll("span")) : [];
        return {
          top: row.getBoundingClientRect().top,
          matchupText: spans[0]?.textContent ?? "",
          timeText: spans[1]?.textContent ?? "",
        };
      });
    });
    expect(order.length, "two matchup rows rendered").toBe(2);
    expect(
      order[0].matchupText,
      "first row is the New York Yankees @ Boston Red Sox matchup"
    ).toMatch(/New York Yankees @ Boston Red Sox/);
    expect(order[0].timeText, "first row renders the 11:35 AM time correctly").toMatch(
      /11:35\s*AM/i
    );
    expect(
      order[1].matchupText,
      "second row is the Los Angeles Dodgers @ San Francisco Giants matchup"
    ).toMatch(/Los Angeles Dodgers @ San Francisco Giants/);
    expect(order[1].timeText, "second row renders the 6:40 PM time correctly").toMatch(
      /6:40\s*PM/i
    );
    expect(
      order[0].top,
      "11:35 AM row renders above the 6:40 PM row"
    ).toBeLessThan(order[1].top);

    // ── Contract 4: no horizontal overflow, no right-edge viewport cut ──
    const overflow = await page.evaluate(() => {
      const el = document.scrollingElement!;
      return el.scrollWidth - el.clientWidth;
    });
    expect(overflow, "horizontal page overflow px").toBeLessThanOrEqual(1);

    const rightEdgeViolations = await page.evaluate(() => {
      const bad: string[] = [];
      document
        .querySelectorAll<HTMLElement>("[data-trends-game-row] *")
        .forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          if (r.right > window.innerWidth + 1) {
            const cls = el.getAttribute("class") ?? "(no class)";
            bad.push(`${el.tagName}.${cls}: right=${r.right.toFixed(1)} viewport=${window.innerWidth}`);
          }
        });
      return bad;
    });
    expect(rightEdgeViolations, rightEdgeViolations.join("\n")).toEqual([]);

    // ── Contract 5: persistent sidebar scale (>=1024px only) ───────────
    if (width >= SIDEBAR_MIN_WIDTH) {
      const sidebarRowFontSize = await page
        .locator(".dc-sidebar-row")
        .first()
        .evaluate(el => getComputedStyle(el).fontSize);
      expect(sidebarRowFontSize, "computed font-size of .dc-sidebar-row").toBe("22.75px");

      const trendsRow = page.locator(".dc-nav-group .dc-sidebar-row").filter({
        has: page.locator(".dc-sidebar-text", { hasText: /^Trends$/ }),
      });
      await expect(trendsRow, "exactly one Trends nav row").toHaveCount(1);
      const iconBox = await trendsRow.locator("svg.dc-nav-ico").boundingBox();
      expect(iconBox, "Trends nav icon has a bounding box").not.toBeNull();
      expect(
        iconBox!.width,
        "Trends nav icon bounding box width >= 22px"
      ).toBeGreaterThanOrEqual(22);

      const longestLabel = page.getByText("Betting Splits + Odds History", {
        exact: true,
      });
      await expect(longestLabel, "exactly one longest-label span").toHaveCount(1);
      const truncation = await longestLabel.evaluate(el => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }));
      expect(
        truncation.scrollWidth,
        `longest label not truncated (scrollWidth=${truncation.scrollWidth} clientWidth=${truncation.clientWidth})`
      ).toBeLessThanOrEqual(truncation.clientWidth);

      const profileGeometry = await page.evaluate(() => {
        const sidebar = document.querySelector(".dc-sidebar") as HTMLElement | null;
        const profile = document.querySelector(".dc-profile-row") as HTMLElement | null;
        if (!sidebar || !profile) return null;
        const sidebarRect = sidebar.getBoundingClientRect();
        const paddingBottom = parseFloat(
          getComputedStyle(sidebar).paddingBottom || "0"
        );
        // Measure against the sidebar's content-box (padding-inner) edge,
        // not its border-box bottom — .dc-sidebar carries a frozen 20px
        // padding-bottom (frozen-tokens.css) unrelated to the profile-row
        // grounding fix, matching Task 5's own measurement approach.
        const contentBottom = sidebarRect.bottom - paddingBottom;
        const profileBottom = profile.getBoundingClientRect().bottom;
        return {
          contentBottom,
          profileBottom,
          delta: Math.abs(contentBottom - profileBottom),
        };
      });
      expect(profileGeometry, "sidebar and profile row both present").not.toBeNull();
      expect(
        profileGeometry!.delta,
        `profile row bottom within 2px of sidebar content-box bottom (delta=${profileGeometry?.delta})`
      ).toBeLessThanOrEqual(2);

      if (width === SIDEBAR_SCREENSHOT_WIDTH) {
        await page
          .locator(".dc-sidebar")
          .screenshot({ path: `${EVIDENCE_DIR}/trends-sidebar.png` });
      }
    }
  });
}
