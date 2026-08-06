/**
 * Mobile floating nav — browser-level contract + visual evidence
 * ══════════════════════════════════════════════════════════════
 * Runs against the vite dev server (no backend): every /api/trpc call is
 * stubbed at the network layer — appUsers.me returns an authenticated user so
 * RequireAuth + GlobalMobileNav activate; every other procedure returns
 * a tRPC error, exercising the pages' real error/empty states. This proves
 * the nav renders and navigates independently of data availability.
 *
 * Covers (docs/plans/2026-07-18-mobile-floating-nav.md):
 * - five destinations render in order with real anchors and correct names
 * - Chat pill is mathematically centered (≤2px) at 320/390/430
 * - 44px touch-target floor, no horizontal scroll at any supported width
 * - aria-current tracks the route: direct taps, deep links, refresh,
 *   back/forward history
 * - keyboard operation with visible focus
 * - reduced-motion collapses transitions
 * - the retired bottom bar renders nowhere; content is not obscured while
 *   scrolled
 *
 * Screenshots land in docs/evidence/2026-07-18-mobile-floating-nav/.
 */

import { test, expect, type Page } from "@playwright/test";

const EVIDENCE_DIR = "docs/evidence/2026-07-18-mobile-floating-nav";

const STUB_USER = {
  id: 1,
  email: "prez@aisportsbettingmodels.com",
  username: "prez",
  // a plain authenticated user — the nav has no role-gated tabs
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

/** Answer every tRPC batch: me → authenticated user, everything else → error.
 *  Pass role: "owner" to exercise the owner-gated surfaces (Bet Tracker). */
async function stubApi(page: Page, opts: { role?: string } = {}) {
  const user = { ...STUB_USER, role: opts.role ?? STUB_USER.role };
  await page.route("**/api/trpc/**", route => {
    const url = new URL(route.request().url());
    const ops = decodeURIComponent(
      url.pathname.replace(/^.*\/api\/trpc\//, "")
    ).split(",");
    const body = ops.map(op =>
      op === "appUsers.me"
        ? { result: { data: { json: user } } }
        : {
            error: {
              json: {
                message: "stubbed offline (e2e)",
                code: -32603,
                data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
              },
            },
          }
    );
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  // Non-tRPC API surfaces (SSE chat, uploads) — fail fast instead of hanging.
  await page.route("**/api/dime/**", route =>
    route.fulfill({ status: 500, body: "stubbed offline (e2e)" })
  );
}

const nav = (page: Page) => page.getByTestId("mobile-floating-nav");

async function gotoWithNav(page: Page, path: string) {
  await page.goto(path);
  await expect(nav(page)).toBeVisible();
}

// `label` is the accessible name; tracker's visible text is the short
// "Tracker" while its aria-label keeps the full product name.
const EXPECTED = [
  { id: "feed", label: "Feed", href: "/feed/model/mlb" },
  { id: "tools", label: "Tools", href: "/betting-splits/MLB" },
  { id: "chat", label: "Chat with Dime AI", href: "/chat" },
  { id: "tracker", label: "Bet Tracker", href: "/bet-tracker" },
  { id: "profile", label: "Profile", href: "/profile" },
];

test.describe("structure and semantics", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("five real links in order, correct accessible names, no retired bar", async ({
    page,
  }) => {
    await stubApi(page);
    await gotoWithNav(page, "/terms");

    const links = nav(page).getByRole("link");
    await expect(links).toHaveCount(5);
    for (let i = 0; i < EXPECTED.length; i++) {
      const link = links.nth(i);
      await expect(link).toHaveAccessibleName(new RegExp(EXPECTED[i].label));
      await expect(link).toHaveAttribute("href", EXPECTED[i].href);
    }

    // exactly one main-navigation landmark — no second/legacy nav bar
    await expect(page.locator('nav[aria-label="Main navigation"]')).toHaveCount(
      1
    );

    // tracker pill shows the short label; full name lives in the aria-label
    await expect(page.getByTestId("tab-tracker")).toHaveText("Tracker");

    // the logo is a brand mark, not a control — nothing focusable/clickable
    const logoInteractive = await page
      .locator(".mfn-logo")
      .evaluate(el => Boolean(el.querySelector("a, button, [tabindex]")));
    expect(logoInteractive).toBe(false);

    // /terms is no destination — nothing may claim aria-current
    await expect(nav(page).locator('[aria-current="page"]')).toHaveCount(0);
  });

  test("Chat pill exact brand mint + dark ink", async ({ page }) => {
    await stubApi(page);
    await gotoWithNav(page, "/terms");
    const chat = page.getByTestId("tab-chat");
    const bg = await chat.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).toBe("rgb(69, 224, 168)"); // #45E0A8 exactly
    const color = await chat.evaluate(el => getComputedStyle(el).color);
    expect(color).toBe("rgb(0, 0, 0)");
  });
});

test.describe("geometry across supported widths", () => {
  for (const width of [320, 360, 375, 390, 414, 430]) {
    test(`width ${width}: centered Chat, 44px targets, no overflow`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await stubApi(page);
      await gotoWithNav(page, "/terms");

      // Chat's horizontal center within 2px of the menu's center
      const menuBox = (await nav(page).locator(".mfn-nav").boundingBox())!;
      const chatBox = (await page.getByTestId("tab-chat").boundingBox())!;
      const menuCenter = menuBox.x + menuBox.width / 2;
      const chatCenter = chatBox.x + chatBox.width / 2;
      expect(Math.abs(menuCenter - chatCenter)).toBeLessThanOrEqual(2);

      // every destination visible with ≥44px targets, inside the viewport,
      // and its label fully contained in its own box (no text spill — this
      // is what a pure bounding-box check cannot see)
      for (const { id } of EXPECTED) {
        const item = page.getByTestId(`tab-${id}`);
        const box = (await item.boundingBox())!;
        expect(box.width, `tab-${id} width`).toBeGreaterThanOrEqual(44);
        expect(box.height, `tab-${id} height`).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
        const spill = await item.evaluate(
          el => el.scrollWidth - el.clientWidth
        );
        expect(spill, `tab-${id} text spill`).toBeLessThanOrEqual(1);
      }

      // the menu never forces horizontal scrolling
      const overflow = await page.evaluate(
        () =>
          document.scrollingElement!.scrollWidth -
          document.documentElement.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test("content is not obscured: page starts below the assembly and scrolls under it", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await stubApi(page);
    await gotoWithNav(page, "/terms");

    const navBottom = (await nav(page).boundingBox())!.height;
    const h1 = page.getByRole("heading").first();
    const h1Box = (await h1.boundingBox())!;
    expect(h1Box.y).toBeGreaterThanOrEqual(navBottom);

    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(150);
    await expect(nav(page)).toBeVisible(); // stays floating while scrolled

    // the band is solid: scrolled content may never show through or overlap
    // the assembly — probing gaps beside the logo and between logo and menu
    // must hit the nav band itself, never underlying page content
    const bandBox = (await nav(page).boundingBox())!;
    const probes = [
      { x: 20, y: bandBox.y + 16 }, // left of the logo
      { x: 195, y: bandBox.y + bandBox.height - 4 }, // band bottom padding
    ];
    for (const p of probes) {
      const inBand = await page.evaluate(
        ({ x, y }) =>
          Boolean(
            document
              .elementFromPoint(x, y)
              ?.closest('[data-testid="mobile-floating-nav"]')
          ),
        p
      );
      expect(inBand, `probe ${p.x},${p.y} hits the band`).toBe(true);
    }

    await page.screenshot({
      path: `${EVIDENCE_DIR}/scrolled-terms-390-dark.png`,
    });
  });
});

test.describe("route activation, history, deep links, refresh", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("tapping each destination navigates and moves aria-current", async ({
    page,
  }) => {
    await stubApi(page);
    await gotoWithNav(page, "/profile");
    await expect(page.getByTestId("tab-profile")).toHaveAttribute(
      "aria-current",
      "page"
    );

    await page.getByTestId("tab-tools").click();
    await expect(page).toHaveURL(/\/betting-splits\//);
    await expect(page.getByTestId("tab-tools")).toHaveAttribute(
      "aria-current",
      "page"
    );
    await expect(page.getByTestId("tab-profile")).not.toHaveAttribute(
      "aria-current",
      "page"
    );

    await page.getByTestId("tab-tracker").click();
    await expect(page).toHaveURL(/\/bet-tracker$/);
    await expect(page.getByTestId("tab-tracker")).toHaveAttribute(
      "aria-current",
      "page"
    );

    await page.getByTestId("tab-feed").click();
    await expect(page).toHaveURL(/\/feed\/model\/mlb/);
    await expect(page.getByTestId("tab-feed")).toHaveAttribute(
      "aria-current",
      "page"
    );

    await page.getByTestId("tab-chat").click();
    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.getByTestId("tab-chat")).toHaveAttribute(
      "aria-current",
      "page"
    );
    // Chat-active must NOT lose the primary mint fill (persistent emphasis
    // and route activation are separate concepts)
    const activeBg = await page
      .getByTestId("tab-chat")
      .evaluate(el => getComputedStyle(el).backgroundColor);
    expect(activeBg).toBe("rgb(69, 224, 168)");
  });

  test("browser back/forward keeps URL and active state in sync", async ({
    page,
  }) => {
    await stubApi(page);
    await gotoWithNav(page, "/profile");
    await page.getByTestId("tab-tracker").click();
    await expect(page).toHaveURL(/\/bet-tracker$/);

    await page.goBack();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByTestId("tab-profile")).toHaveAttribute(
      "aria-current",
      "page"
    );

    await page.goForward();
    await expect(page).toHaveURL(/\/bet-tracker$/);
    await expect(page.getByTestId("tab-tracker")).toHaveAttribute(
      "aria-current",
      "page"
    );
  });

  test("deep link + refresh keep the right destination active", async ({
    page,
  }) => {
    await stubApi(page);
    await gotoWithNav(page, "/betting-splits/MLB");
    await expect(page.getByTestId("tab-tools")).toHaveAttribute(
      "aria-current",
      "page"
    );

    await page.reload();
    await expect(nav(page)).toBeVisible();
    await expect(page.getByTestId("tab-tools")).toHaveAttribute(
      "aria-current",
      "page"
    );
  });

  test("dated feed deep link keeps Feed active (nested-route rule)", async ({
    page,
  }) => {
    await stubApi(page);
    await gotoWithNav(page, "/feed/model/mlb-07-18-2026");
    await expect(page.getByTestId("tab-feed")).toHaveAttribute(
      "aria-current",
      "page"
    );
  });
});

test.describe("keyboard and reduced motion", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("keyboard: links reachable in order, visible focus, Enter navigates", async ({
    page,
  }) => {
    await stubApi(page);
    await gotoWithNav(page, "/terms");

    // walk focus into the nav
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press("Tab");
      const inNav = await page.evaluate(() =>
        Boolean(
          document.activeElement?.closest('[data-testid="mobile-floating-nav"]')
        )
      );
      if (inNav) break;
    }
    await expect(page.getByTestId("tab-feed")).toBeFocused();

    // visible focus treatment (mint ring via box-shadow)
    const shadow = await page
      .getByTestId("tab-feed")
      .evaluate(el => getComputedStyle(el).boxShadow);
    expect(shadow).not.toBe("none");

    // DOM order matches visual order
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("tab-tools")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("tab-chat")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("tab-tracker")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("tab-profile")).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByTestId("tab-profile")).toHaveAttribute(
      "aria-current",
      "page"
    );
  });

  test("prefers-reduced-motion collapses nav transitions", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await stubApi(page);
    await gotoWithNav(page, "/terms");
    const transition = await page
      .getByTestId("tab-feed")
      .evaluate(el => getComputedStyle(el).transitionProperty);
    expect(transition).toBe("none");
    await context.close();
  });
});

test.describe("owner-only Bet Tracker", () => {
  test("non-owner gets the coming-soon gate; owner gets the themed tracker", async ({
    browser,
  }) => {
    // plain user → gate
    const userCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const userPage = await userCtx.newPage();
    await stubApi(userPage);
    await userPage.goto("/bet-tracker");
    await expect(userPage.getByTestId("bet-tracker-coming-soon")).toBeVisible();
    await userCtx.close();

    // owner in light theme → real tracker, following the theme tokens
    const ownerCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const ownerPage = await ownerCtx.newPage();
    await ownerPage.addInitScript(() =>
      window.localStorage.setItem("theme", "light")
    );
    await stubApi(ownerPage, { role: "owner" });
    await ownerPage.goto("/bet-tracker");
    await expect(ownerPage.getByTestId("bet-tracker-coming-soon")).toHaveCount(
      0
    );
    const pageBg = await ownerPage
      .locator(".bt-page")
      .first()
      .evaluate(el => getComputedStyle(el).backgroundColor);
    expect(pageBg).toBe("rgb(255, 255, 255)"); // light ramp, not hardcoded black
    await ownerCtx.close();
  });
});

test.describe("visual evidence", () => {
  const shots: Array<{
    name: string;
    width: number;
    height: number;
    theme: "dark" | "light";
    path: string;
    role?: string;
  }> = [
    {
      name: "320-dark-feed",
      width: 320,
      height: 693,
      theme: "dark",
      path: "/feed/model/mlb",
    },
    {
      name: "320-light-feed",
      width: 320,
      height: 693,
      theme: "light",
      path: "/feed/model/mlb",
    },
    {
      name: "390-dark-feed",
      width: 390,
      height: 844,
      theme: "dark",
      path: "/feed/model/mlb",
    },
    {
      name: "390-light-feed",
      width: 390,
      height: 844,
      theme: "light",
      path: "/feed/model/mlb",
    },
    {
      name: "430-dark-feed",
      width: 430,
      height: 932,
      theme: "dark",
      path: "/feed/model/mlb",
    },
    {
      name: "430-light-feed",
      width: 430,
      height: 932,
      theme: "light",
      path: "/feed/model/mlb",
    },
    // ≥768px wide the Dime shell owns navigation, so mobile landscape means
    // sub-768 widths (e.g. iPhone SE landscape 667×375).
    {
      name: "landscape-667x375-dark-feed",
      width: 667,
      height: 375,
      theme: "dark",
      path: "/feed/model/mlb",
    },
    {
      name: "active-tools-390-dark",
      width: 390,
      height: 844,
      theme: "dark",
      path: "/betting-splits/MLB",
    },
    {
      name: "active-chat-390-dark",
      width: 390,
      height: 844,
      theme: "dark",
      path: "/chat",
    },
    {
      name: "profile-390-light",
      width: 390,
      height: 844,
      theme: "light",
      path: "/profile",
    },
    // Bet Tracker is owner-only: owner sees the tracker in both themes
    // (token-driven — the page must follow Dark/Light/System)…
    {
      name: "tracker-390-dark",
      width: 390,
      height: 844,
      theme: "dark",
      path: "/bet-tracker",
      role: "owner",
    },
    {
      name: "tracker-390-light",
      width: 390,
      height: 844,
      theme: "light",
      path: "/bet-tracker",
      role: "owner",
    },
    // …while a non-owner gets the theme-keyed coming-soon gate.
    {
      name: "tracker-gate-390-light",
      width: 390,
      height: 844,
      theme: "light",
      path: "/bet-tracker",
      role: "user",
    },
  ];

  for (const shot of shots) {
    test(`screenshot ${shot.name}`, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: { width: shot.width, height: shot.height },
      });
      const page = await context.newPage();
      await page.addInitScript(theme => {
        window.localStorage.setItem("theme", theme);
      }, shot.theme);
      await stubApi(page, { role: shot.role });
      await gotoWithNav(page, shot.path);
      // let lazy chunks / error states settle before capturing
      await page.waitForTimeout(700);
      await expect(nav(page)).toBeVisible();
      await page.screenshot({ path: `${EVIDENCE_DIR}/${shot.name}.png` });
      await context.close();
    });
  }
});
