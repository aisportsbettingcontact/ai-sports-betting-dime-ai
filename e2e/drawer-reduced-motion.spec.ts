import { test, expect } from "@playwright/test";

/**
 * PR #70 remediation — Task 3 (reduced-motion drawer correctness).
 *
 * Defect this proves the fix for: under `prefers-reduced-motion: reduce`,
 * an edge-swipe drag on the 24px edge strip used to claim the gesture and
 * flip `drawerOpen`/`drawerMoving` true immediately (moveDrawerGesture),
 * but the drawer's visual position (`drawerX`) never updated because that
 * write was gated behind `if (!reduceMotion)`. The modal-semantics effect
 * set `main.inert = drawerOpen` unconditionally, so the main chat pane
 * froze (inert — unclickable, unfocusable) the instant the gesture
 * started, while the drawer itself stayed fully off-screen until the
 * finger lifted. The interface was unusable during the gesture for
 * exactly the population reduced motion serves.
 *
 * Fix under test: reduced-motion users never drive the drawer through the
 * edge-swipe gesture at all — the drawer opens and closes only via its
 * button and keyboard, with an immediate (untransitioned) state change,
 * and `main.inert` is derived from a pure `resolveDrawerAccessibility`
 * function (client/src/pages/dime-chat/drawerMotion.ts) that only inerts
 * the main pane once the drawer is open AND actually visible.
 */
test.describe("reduced-motion drawer never freezes the main pane", () => {
  test.use({ viewport: { width: 800, height: 900 } });

  test("holding an edge-swipe does not freeze the main pane or the composer", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/chat?preview=1");

    const composer = page.locator(".dc-composer-input").first();
    await expect(composer).toBeVisible({ timeout: 20000 });

    // `.dc-shell-stack` is the element the `mainRef`/modal-semantics effect
    // actually toggles `inert` on (it wraps `.dc-main` + the external pane
    // as one stable tree position — see DimeChatPage.tsx's [PR #70
    // REMEDIATION] comment on the chat-mount-stability fix); `.dc-main`
    // itself is never the inert target.
    const main = page.locator(".dc-shell-stack").first();
    // Sanity: the pane must not already be inert before any gesture starts.
    await expect(main).toHaveJSProperty("inert", false);

    // Simulate an edge drag from inside the 24px edge-capture strip and
    // HOLD (no mouse.up yet) — this is exactly the moment the old code
    // froze the main pane while the drawer was still invisible.
    await page.mouse.move(5, 450);
    await page.mouse.down();
    await page.mouse.move(60, 450, { steps: 6 });

    await expect(
      main,
      "main pane must not go inert while an edge-swipe is held under reduced motion"
    ).toHaveJSProperty("inert", false);

    // The composer must remain focusable/interactive while the pointer is
    // still down — `inert` disables focus on all descendants, so this is
    // the concrete, user-visible symptom of the regression.
    await composer.focus();
    await expect(composer).toBeFocused();

    await page.mouse.up();

    await expect(main).toHaveJSProperty("inert", false);
    await composer.click();
    await expect(composer).toBeFocused();
  });

  test("drawer opens/closes only via button and keyboard; Escape returns focus to the trigger", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/chat?preview=1");

    const trigger = page.locator(".dc-mobile-menu").first();
    await expect(trigger).toBeVisible({ timeout: 20000 });

    await trigger.click();

    // The drawer is a fixed-position, `transform`-driven panel (no
    // `display: none` toggle), so a plain `toBeVisible()` can't tell "open"
    // from "translated off-screen" — assert the actual open/closed signals
    // the component drives instead: `aria-modal`/`aria-hidden` and the main
    // pane's `inert` state.
    const drawer = page.locator(".dc-sidebar.dc-drawer").first();
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute("aria-modal", "true");
    await expect(drawer).not.toHaveAttribute("aria-hidden", "true");

    const main = page.locator(".dc-shell-stack").first();
    await expect(main).toHaveJSProperty("inert", true);

    await page.keyboard.press("Escape");

    await expect(drawer).toHaveAttribute("aria-hidden", "true");
    await expect(main).toHaveJSProperty("inert", false);
    await expect(trigger).toBeFocused();
  });
});
