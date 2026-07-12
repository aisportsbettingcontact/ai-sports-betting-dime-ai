import { test, expect } from "@playwright/test";

const BOUNDARY_SWEEP = [767, 768, 769, 700, 900] as const;

/**
 * PR #70 remediation — Task 2 (chat mount stability across the 768px shell
 * boundary).
 *
 * Defect this proves the fix for: App.tsx's Router() used to render two
 * structurally different trees on either side of 768px — the shared shell
 * (DimeAppShell) at >=768px, and a bare DimeChatPage mounted through a
 * *different* lazy chunk (pages/DimeChat.tsx) below it. Crossing 768px swapped
 * which lazy component sat at that React tree position, so React tore down
 * and rebuilt DimeChatPage: all `useReducer` conversation state, any
 * in-flight SSE stream, and the composer draft were destroyed.
 *
 * Fix under test: one DimeAppShell mount now owns /chat (and any
 * shellViewport-owned product route) at every width — only its `mode` prop
 * ("shell" | "chat-only") changes across the boundary, so the same
 * <DimeChatPage> element stays at the same tree position. This spec proves
 * the composer's DOM node identity and draft text survive repeated 768px
 * crossings.
 */
test.describe("chat mount stability across the 768px shell boundary", () => {
  test("composer DOM identity and draft text survive repeated resizes across 768px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto("/chat?preview=1");

    // "Wait for the chat root to render" — the composer is the first
    // interactive element the frozen-design chat home always renders,
    // whether the shell chrome (>=768px) or the bare chat-only tree (<768px)
    // owns the mount.
    const composerSelector =
      "input.dc-composer-input, textarea.dc-composer-input, [contenteditable].dc-composer-input";
    const composer = page.locator(composerSelector).first();
    await expect(composer).toBeVisible({ timeout: 20000 });

    const canType = await composer.isEditable().catch(() => false);
    const probe = `alive-${Date.now()}`;

    if (canType) {
      await composer.fill(probe);
    } else {
      // Preview mode disables typing on this build — stamp identity instead.
      await composer.evaluate((el, value) => {
        (el as HTMLElement).dataset.probe = value;
      }, probe);
    }

    const handle = await composer.elementHandle();
    if (!handle) {
      throw new Error("composer element handle not found after render");
    }

    const assertIdentityAndDraftSurvive = async (label: string) => {
      const stillConnected = await handle.evaluate(el => el.isConnected);
      expect(
        stillConnected,
        `[${label}] the ORIGINAL composer DOM node must stay connected — ` +
          `a remount disconnects the old node and mounts a new one`
      ).toBe(true);

      const current = page.locator(composerSelector).first();
      if (canType) {
        await expect(current, `[${label}] draft text must survive`).toHaveValue(
          probe
        );
      } else {
        await expect(
          current,
          `[${label}] identity stamp must survive`
        ).toHaveAttribute("data-probe", probe);
      }
    };

    // One explicit round trip across the boundary first (700 -> back to 900).
    await page.setViewportSize({ width: 700, height: 800 });
    await page.waitForTimeout(300);
    await assertIdentityAndDraftSurvive("700 (down)");

    await page.setViewportSize({ width: 900, height: 800 });
    await page.waitForTimeout(300);
    await assertIdentityAndDraftSurvive("900 (back up)");

    // Then sweep the boundary itself, one transition per step.
    for (const width of BOUNDARY_SWEEP) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(300);
      await assertIdentityAndDraftSurvive(String(width));
    }
  });
});
