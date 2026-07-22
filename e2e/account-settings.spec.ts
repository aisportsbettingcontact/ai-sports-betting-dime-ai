/**
 * Account settings — popover v2, theme, settings modal, billing, owner lockdown
 * ════════════════════════════════════════════════════════════════════════════
 * Round 3 Step 6 harness. Runs against the vite dev server with every tRPC
 * procedure stubbed (no DB), following the same batch-envelope stub pattern
 * `e2e/trends-layout.spec.ts` / `e2e/splits-layout.spec.ts` established:
 * `appUsers.me` answers with a fabricated session, the four `stripe.*`
 * read-only billing procedures answer with a fixture plan, and every other
 * procedure falls through to a stubbed tRPC error — exercising the app's own
 * real empty/error states rather than fabricating them.
 *
 * Contracts, at each width in WIDTHS (1024, 1440 — the persistent-sidebar
 * desktop/tablet band, DimeChatPage.tsx's `compact` boundary is 1023px):
 *   1. Popover: profile-row click opens it. OWNER sees exactly 5 rows
 *      (header + Theme + Settings + Admin Dashboard + Log Out); NON-OWNER
 *      sees 4 (no Admin row). Neither ever renders "Edit Profile" or
 *      "Discord Connected" (Round 3 Step 1 cut both from this popover).
 *   2. Theme: clicking the Theme row slides in the System|Light|Dark
 *      segmented control; selecting Light flips the app root's `.dark`
 *      class (index.css: `html:not(.dark)` is the light-mode selector) and
 *      persists `localStorage['dime-theme'] === 'light'` across a real
 *      `page.reload()`.
 *   3. Settings modal: opens from the popover's Settings row;
 *      `[role="dialog"][aria-modal]`; Esc closes it; focus returns to the
 *      profile row's trigger (`.dc-settings-trigger`).
 *   4. Billing: the Billing tab renders the fixture plan card
 *      ("Current Plan — Sharp"), an invoice-history table with rows equal
 *      to (and ≤24) the fixture's invoice count, and a payment-method row
 *      showing the masked `•••• {last4}`. Clicking Cancel opens the confirm
 *      panel with the owner's EXACT copy and a "Cancel plan" button whose
 *      computed background is `rgb(229, 72, 77)` (`--dime-danger`); "Keep
 *      plan" closes the confirm without navigating away.
 *   5. Admin lockdown: a NON-OWNER fixture navigating directly to
 *      `/admin/users` and `/admin/publish` never renders admin content —
 *      the URL lands off `/admin` and zero `.admin-shell` DOM exists at any
 *      point. An OWNER fixture sees `.admin-shell` with both tabs
 *      ("User Management" / "Publish Projections") on both routes.
 *   6. No horizontal page overflow on any asserted surface — folded into
 *      every test above right after the surface under test renders
 *      (the same `scrollWidth - clientWidth <= 1` walk trends/splits use).
 *
 * Screenshots land in docs/evidence/2026-07-22-account-settings/.
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";

const EVIDENCE_DIR = "docs/evidence/2026-07-22-account-settings";
const WIDTHS = [1024, 1440] as const;

// ─── appUsers.me fixtures ───────────────────────────────────────────────────
// Field set matches the STUB_USER shape already proven in
// e2e/trends-layout.spec.ts / e2e/splits-layout.spec.ts (appUsers.me's real
// return shape) — only role/username/stripe fields vary per fixture below.

const OWNER_USER = {
  id: 1,
  email: "prez@aisportsbettingmodels.com",
  username: "prez",
  role: "owner",
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

// expiryDate: null → sidebarIdentity's isLifetimeMember() is true, which
// keeps DimeSidebar's showPlanCtas false — the popover's Upgrade/Cancel CTA
// row stays out of the DOM so the row-count contract (4 for non-owner) isn't
// polluted by a plan-status concern unrelated to this task. The real active
// "Sharp" plan lives entirely in the stripe.getPlanStatus fixture below,
// which the Billing pane reads independently.
const NON_OWNER_USER = {
  id: 2,
  email: "sharpbettor@aisportsbettingmodels.com",
  username: "sharpbettor",
  role: "user",
  hasAccess: true,
  expiryDate: null,
  termsAccepted: true,
  discordId: null,
  discordUsername: null,
  discordAvatar: null,
  discordConnectedAt: null,
  sessionExpiresAt: null,
  stripePlanId: "sharp",
  stripeCustomerId: "cus_fixture_sharp1",
  stripeSubscriptionId: "sub_fixture_sharp1",
  cancelAtPeriodEnd: false,
};

// ─── stripe.* billing fixtures (server/routers/stripe.ts output shapes) ────
// Mid-day UTC to dodge local-timezone rollover in formatLongDate's
// toLocaleDateString — see server/stripe/planStatus.ts's governingDate doc.
const GOVERNING_DATE = new Date("2026-09-22T16:00:00Z").getTime();

const PLAN_STATUS_ACTIVE = {
  state: "active",
  planId: "sharp",
  // Fixture label, not the server's real planLabelMap string — this e2e
  // stubs the tRPC response directly (never calls derivePlanStatus), so the
  // fixture is free to use the plain "Sharp" label the task's contract pins
  // ("Current Plan — Sharp").
  planLabel: "Sharp",
  governingDate: GOVERNING_DATE,
};

const INVOICES = [
  {
    date: new Date("2026-07-01T12:00:00Z").getTime(),
    amountCents: 4900,
    currency: "usd",
    status: "paid",
    hostedInvoiceUrl: "https://invoice.stripe.com/i/fixture_1",
  },
  {
    date: new Date("2026-06-01T12:00:00Z").getTime(),
    amountCents: 4900,
    currency: "usd",
    status: "paid",
    hostedInvoiceUrl: "https://invoice.stripe.com/i/fixture_2",
  },
  {
    date: new Date("2026-05-01T12:00:00Z").getTime(),
    amountCents: 4900,
    currency: "usd",
    status: "paid",
    hostedInvoiceUrl: "https://invoice.stripe.com/i/fixture_3",
  },
];

const PAYMENT_METHODS = [
  { brand: "visa", last4: "4242", expMonth: 8, expYear: 2028, isDefault: true },
];

const BILLING_INFO = {
  name: "Sharp Bettor",
  email: "sharpbettor@aisportsbettingmodels.com",
  address: {
    line1: "123 Vig St",
    line2: null,
    city: "Las Vegas",
    state: "NV",
    postal_code: "89101",
    country: "US",
  },
};

// Owner's verbatim cancel-confirm copy (round3-constraints.md / r3-task-4
// BillingSection.tsx CANCEL_CONFIRM_COPY) — pinned character-for-character.
const CANCEL_CONFIRM_COPY =
  "If you cancel, you'll keep full access to your plan features until the end of your billing period.";

async function stubApi(page: Page, user: typeof OWNER_USER | typeof NON_OWNER_USER) {
  await page.route("**/api/trpc/**", route => {
    const url = new URL(route.request().url());
    const ops = decodeURIComponent(
      url.pathname.replace(/^.*\/api\/trpc\//, "")
    ).split(",");
    const body = ops.map(op => {
      if (op === "appUsers.me") return { result: { data: { json: user } } };
      if (op === "stripe.getPlanStatus")
        return { result: { data: { json: PLAN_STATUS_ACTIVE } } };
      if (op === "stripe.getInvoices")
        return { result: { data: { json: INVOICES } } };
      if (op === "stripe.getPaymentMethods")
        return { result: { data: { json: PAYMENT_METHODS } } };
      if (op === "stripe.getBillingInfo")
        return { result: { data: { json: BILLING_INFO } } };
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
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  // Non-tRPC API surfaces (SSE chat, uploads) — fail fast instead of hanging,
  // matching the established pattern in every sibling spec.
  await page.route("**/api/dime/**", route =>
    route.fulfill({ status: 500, body: "stubbed offline (e2e)" })
  );
}

async function assertNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement!;
    return el.scrollWidth - el.clientWidth;
  });
  expect(overflow, `${label}: horizontal page overflow px`).toBeLessThanOrEqual(1);
}

/** Opens the account popover via the profile row's gear trigger
 *  (`.dc-settings-trigger`) — the same trigger SettingsModal's own
 *  findReturnFocusTarget() looks for first when returning focus on close. */
async function openPopover(page: Page) {
  await page.waitForSelector(".dc-settings-trigger");
  await page.locator(".dc-settings-trigger").click();
  await expect(page.locator(".dc-settings-menu.open")).toBeVisible();
}

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

for (const width of WIDTHS) {
  // ── Contract 1: popover row set ───────────────────────────────────────────
  test(`popover: OWNER sees exactly 5 rows incl. Admin Dashboard, no legacy rows [${width}px]`, async ({
    page,
  }) => {
    await stubApi(page, OWNER_USER);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/chat");
    await openPopover(page);

    const menu = page.locator(".dc-settings-menu.open");
    const rowCount = await menu.locator(".dc-menu-header, .dc-menu-item").count();
    expect(rowCount, "owner popover row count (header + Theme/Settings/Admin/LogOut)").toBe(5);

    await expect(menu.getByRole("menuitem", { name: "Admin Dashboard" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Theme" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Settings" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Log Out" })).toBeVisible();

    const menuText = await menu.innerText();
    expect(menuText, "no frozen 'Edit Profile' row").not.toContain("Edit Profile");
    expect(menuText, "no frozen 'Discord Connected' row").not.toContain("Discord Connected");

    await assertNoHorizontalOverflow(page, "popover-owner");
    await page.screenshot({ path: `${EVIDENCE_DIR}/popover-owner-${width}.png` });
  });

  test(`popover: NON-OWNER sees exactly 4 rows, no Admin row, no legacy rows [${width}px]`, async ({
    page,
  }) => {
    await stubApi(page, NON_OWNER_USER);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/chat");
    await openPopover(page);

    const menu = page.locator(".dc-settings-menu.open");
    const rowCount = await menu.locator(".dc-menu-header, .dc-menu-item").count();
    expect(rowCount, "non-owner popover row count (header + Theme/Settings/LogOut)").toBe(4);

    await expect(
      menu.getByRole("menuitem", { name: "Admin Dashboard" }),
      "Admin Dashboard row absent for a non-owner"
    ).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Theme" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Settings" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Log Out" })).toBeVisible();

    const menuText = await menu.innerText();
    expect(menuText, "no frozen 'Edit Profile' row").not.toContain("Edit Profile");
    expect(menuText, "no frozen 'Discord Connected' row").not.toContain("Discord Connected");

    await assertNoHorizontalOverflow(page, "popover-non-owner");
    await page.screenshot({ path: `${EVIDENCE_DIR}/popover-non-owner-${width}.png` });
  });

  // ── Contract 2: Theme slide-out + persistence ─────────────────────────────
  test(`theme: System|Light|Dark slides in; Light flips the root class + persists across reload [${width}px]`, async ({
    page,
  }) => {
    // This sandbox's outbound proxy resets the render-blocking Google Fonts
    // <link> (client/index.html) on every navigation — confirmed via a
    // throwaway repro (goto/reload each measured ~14-15s to "load" solely
    // waiting on that stylesheet's connection to fail) — so a test that
    // navigates twice (goto + reload) needs more than the 30s default.
    test.setTimeout(90_000);
    await stubApi(page, NON_OWNER_USER);
    // Deterministic starting point: system resolves dark (nothing stored in
    // localStorage yet), so selecting Light is a genuine, observable flip —
    // not a no-op against an already-light root.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/chat");
    await page.waitForSelector(".dc-settings-trigger");

    await expect(page.locator("html")).toHaveClass(/dark/);

    await openPopover(page);
    await page.getByRole("menuitem", { name: "Theme" }).click();

    const segment = page.locator('.dc-theme-segment[role="radiogroup"]');
    await expect(segment).toBeVisible();
    const radios = segment.getByRole("radio");
    await expect(radios, "exactly System/Light/Dark").toHaveCount(3);
    await expect(radios.nth(0)).toHaveAccessibleName(/System/);
    await expect(radios.nth(1)).toHaveAccessibleName(/Light/);
    await expect(radios.nth(2)).toHaveAccessibleName(/Dark/);
    // System is selected by default (nothing persisted yet).
    await expect(radios.nth(0)).toHaveAttribute("aria-checked", "true");

    await assertNoHorizontalOverflow(page, "theme-slide");
    await page.screenshot({ path: `${EVIDENCE_DIR}/theme-slide-${width}.png` });

    await radios.nth(1).click(); // Light

    await page.waitForFunction(
      () => !document.documentElement.classList.contains("dark"),
      undefined,
      { timeout: 5000 }
    );
    await expect(radios.nth(1)).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("html")).not.toHaveClass(/dark/);

    const storedBefore = await page.evaluate(() => localStorage.getItem("dime-theme"));
    expect(storedBefore, "localStorage['dime-theme'] === 'light' before reload").toBe("light");

    await page.reload();
    await page.waitForSelector(".dc-settings-trigger");

    await expect(page.locator("html"), "root class stays light after reload").not.toHaveClass(
      /dark/
    );
    const storedAfter = await page.evaluate(() => localStorage.getItem("dime-theme"));
    expect(storedAfter, "localStorage['dime-theme'] persists 'light' across reload").toBe(
      "light"
    );

    await assertNoHorizontalOverflow(page, "theme-after-reload");
  });

  // ── Contract 3: Settings modal dialog semantics ───────────────────────────
  test(`settings modal: dialog semantics, Esc closes, focus returns to the profile-row trigger [${width}px]`, async ({
    page,
  }) => {
    await stubApi(page, NON_OWNER_USER);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/chat");
    await openPopover(page);
    await page.getByRole("menuitem", { name: "Settings" }).click();

    const dialog = page.locator('[role="dialog"][aria-modal]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(dialog).toHaveAttribute("aria-labelledby", "dc-sm-title");

    await assertNoHorizontalOverflow(page, "modal-account");
    await page.screenshot({ path: `${EVIDENCE_DIR}/modal-account-${width}.png` });

    await page.keyboard.press("Escape");
    await expect(dialog, "Esc closes the dialog").toHaveCount(0);

    const focusedClass = await page.evaluate(
      () => document.activeElement?.className ?? ""
    );
    expect(
      focusedClass,
      "focus returns to the profile row's gear trigger, not document.body"
    ).toContain("dc-settings-trigger");
  });

  // ── Contract 4: Billing pane ──────────────────────────────────────────────
  test(`billing: plan card, invoice history, payment method, cancel confirm copy + red button [${width}px]`, async ({
    page,
  }) => {
    await stubApi(page, NON_OWNER_USER);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/chat");
    await openPopover(page);
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Billing", exact: true }).click();

    const headline = page.locator(".dc-sm-plan-headline");
    await expect(headline).toContainText("Current Plan");
    await expect(headline).toContainText("Sharp");

    expect(INVOICES.length, "fixture invoice count is within the 24-row cap").toBeLessThanOrEqual(
      24
    );
    const invoiceRows = page.locator(".dc-sm-table tbody tr");
    await expect(invoiceRows, "invoice rows match the fixture count").toHaveCount(
      INVOICES.length
    );

    const pmList = page.locator(".dc-sm-pm-list");
    await expect(pmList).toContainText("••••");
    await expect(pmList).toContainText(PAYMENT_METHODS[0].last4);

    await assertNoHorizontalOverflow(page, "modal-billing");
    await page.screenshot({ path: `${EVIDENCE_DIR}/modal-billing-${width}.png` });

    await page.getByRole("button", { name: "Cancel", exact: true }).click();

    const confirm = page.locator(".dc-sm-cancel-confirm");
    await expect(confirm).toBeVisible();
    await expect(confirm).toHaveAttribute("role", "alertdialog");
    const confirmText = await confirm.innerText();
    expect(confirmText, "verbatim owner cancel-confirm copy").toContain(CANCEL_CONFIRM_COPY);

    const cancelPlanBtn = page.getByRole("button", { name: "Cancel plan", exact: true });
    const bg = await cancelPlanBtn.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg, "Cancel plan button background is --dime-danger #E5484D").toBe(
      "rgb(229, 72, 77)"
    );

    await assertNoHorizontalOverflow(page, "cancel-confirm");
    await page.screenshot({ path: `${EVIDENCE_DIR}/cancel-confirm-${width}.png` });

    await page.getByRole("button", { name: "Keep plan", exact: true }).click();
    await expect(confirm, "Keep plan closes the confirm").toHaveCount(0);
  });

  // ── Contract 5: Admin lockdown ────────────────────────────────────────────
  test(`admin lockdown: NON-OWNER never renders admin content on /admin/users or /admin/publish [${width}px]`, async ({
    page,
  }) => {
    // Two full navigations in one test — see the Contract 2 theme test's
    // comment above for why this sandbox needs more than the 30s default.
    test.setTimeout(90_000);
    await stubApi(page, NON_OWNER_USER);
    await page.setViewportSize({ width, height: 900 });

    for (const path of ["/admin/users", "/admin/publish"] as const) {
      await page.goto(path);
      await page.waitForURL(url => !url.pathname.startsWith("/admin"), {
        timeout: 10000,
      });

      await expect(
        page.locator(".admin-shell"),
        `${path}: zero admin-shell DOM after redirect`
      ).toHaveCount(0);

      const bodyText = await page.locator("body").innerText();
      expect(bodyText, `${path}: no "User Management" text leaked`).not.toContain(
        "User Management"
      );
      expect(bodyText, `${path}: no "Publish Projections" text leaked`).not.toContain(
        "Publish Projections"
      );

      await assertNoHorizontalOverflow(page, `admin-redirect-${path}`);
    }
  });

  test(`admin lockdown: OWNER sees AdminShell with both tabs on /admin/users and /admin/publish [${width}px]`, async ({
    page,
  }) => {
    // Two full navigations in one test — see the Contract 2 theme test's
    // comment above for why this sandbox needs more than the 30s default.
    test.setTimeout(90_000);
    await stubApi(page, OWNER_USER);
    await page.setViewportSize({ width, height: 900 });

    for (const path of ["/admin/users", "/admin/publish"] as const) {
      await page.goto(path);
      await expect(page.locator(".admin-shell"), `${path}: AdminShell renders for owner`).toBeVisible(
        { timeout: 10000 }
      );

      const tabs = page.getByRole("tab");
      await expect(tabs, `${path}: exactly two admin tabs`).toHaveCount(2);
      await expect(tabs.nth(0)).toContainText("User Management");
      await expect(tabs.nth(1)).toContainText("Publish Projections");

      await assertNoHorizontalOverflow(page, `admin-owner-${path}`);

      if (path === "/admin/users") {
        await page.screenshot({ path: `${EVIDENCE_DIR}/admin-users-owner-${width}.png` });
      }
    }
  });
}
