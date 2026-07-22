import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Real identity + owner gate — client contract (plan 2026-07-12, Phases 1-2).
 *
 * Requirements under test:
 *  1. The chat sidebar renders the REAL session identity — the frozen
 *     "PREZ BETS" sample (name, handle, tier, expiry date, prez photo) must
 *     never render for anyone but the actual prez account, and the sample
 *     literals must not exist in the source at all.
 *  2. The settings-menu buttons are live: Log Out runs the logout mutation
 *     then hard-redirects; Edit Profile / Upgrade / Cancel navigate.
 *  3. Non-owners get the Dime wordmark + "AI MODEL CHAT COMING SOON" — no
 *     composer, no send pill, no prompt pills, no hero — and the gate fails
 *     closed while auth resolves (source-contract pattern, DimeAppShell.test.ts).
 */

const chatSource = fs.readFileSync(
  path.join(import.meta.dirname, "DimeChatPage.tsx"),
  "utf8"
);
const cssSource = fs.readFileSync(
  path.join(import.meta.dirname, "conversation.css"),
  "utf8"
);
const appSource = fs.readFileSync(
  path.join(import.meta.dirname, "..", "..", "App.tsx"),
  "utf8"
);
const shellSource = fs.readFileSync(
  path.join(import.meta.dirname, "..", "dime-shell", "DimeAppShell.tsx"),
  "utf8"
);

describe("real identity — no frozen sample renders (Phase 1)", () => {
  it("contains none of the PREZ BETS sample literals", () => {
    expect(chatSource).not.toContain("PREZ BETS");
    expect(chatSource).not.toContain('"@prez"');
    expect(chatSource).not.toContain("Expires August 8, 2026");
    expect(chatSource).not.toContain('alt="PREZ BETS"');
  });

  it("reads the session user from useAppAuth", () => {
    expect(chatSource).toMatch(
      /import \{ useAppAuth \} from "@\/_core\/hooks\/useAppAuth"/
    );
    expect(chatSource).toMatch(
      /const \{ appUser, isOwner, loading: authLoading \} = useAppAuth\(\)/
    );
  });

  it("derives every profile field from sidebarIdentity helpers", () => {
    expect(chatSource).toMatch(/displaySidebarName\(appUser\.username\)/);
    expect(chatSource).toMatch(/deriveTierLabel\(appUser\)/);
    expect(chatSource).toMatch(/formatHandle\(appUser\.username\)/);
    expect(chatSource).toMatch(/formatExpiryLine\(appUser\.expiryDate\)/);
  });

  // [ROUND 3 STEP 1 — owner directive 2026-07-22] The Discord Connected row
  // this test used to also pin is cut from the popover entirely (not merely
  // conditionally hidden) — see "account popover v2" below for that contract.
  it("expiry row hides when the data is absent — no placeholder", () => {
    expect(chatSource).toMatch(/\{expiryLine && \(/);
  });

  it("avatar policy: prez photo exclusive; Discord avatar when linked; blank silhouette otherwise", () => {
    expect(chatSource).toMatch(/isPrezAccount\(user\.username\)/);
    // Discord CDN avatar for linked accounts, blank silhouette for the rest —
    // never initials, never someone else's photo (product req 2026-07-12).
    expect(chatSource).toContain("cdn.discordapp.com/avatars/");
    expect(chatSource).toContain("BLANK_AVATAR_URI");
    expect(chatSource).toMatch(/src=\{resolveAvatarSrc\(user\)\}/);
    expect(chatSource).not.toContain("deriveInitials");
  });

  it("renders a neutral profile row while auth resolves (never the sample)", () => {
    expect(chatSource).toMatch(
      /\{appUser \? \(\s*<div ref=\{profileRef\} className="dc-sidebar-row dc-profile-row">/
    );
  });
});

describe("live settings menu (Phase 1.3)", () => {
  it("wires Log Out to the logout mutation with a hard redirect", () => {
    expect(chatSource).toMatch(
      /const logoutMutation = trpc\.appUsers\.logout\.useMutation\(\)/
    );
    const logoutFn = chatSource.indexOf("const onLogout = async () => {");
    const mutateIdx = chatSource.indexOf(
      "await logoutMutation.mutateAsync()",
      logoutFn
    );
    const redirectIdx = chatSource.indexOf(
      'window.location.assign("/")',
      logoutFn
    );
    expect(logoutFn).toBeGreaterThan(-1);
    expect(mutateIdx).toBeGreaterThan(logoutFn);
    expect(redirectIdx).toBeGreaterThan(mutateIdx);
    expect(chatSource).toMatch(/onClick=\{onLogout\}/);
  });

  // [ROUND 3 STEP 1 — owner directive 2026-07-22] "Edit Profile" no longer
  // navigates from this popover — the row was cut (see "account popover v2"
  // below); goTo("/profile") has no remaining call site. Upgrade/Cancel are
  // untouched by the amendment, so those two assertions carry over as-is.
  it("navigates Upgrade / Cancel to real routes", () => {
    expect(chatSource).toMatch(/goTo\("\/checkout"\)/);
    expect(chatSource).toMatch(/goTo\("\/account"\)/);
  });

  it("hides Upgrade/Cancel for owners AND lifetime members", () => {
    expect(chatSource).toMatch(
      /const showPlanCtas = !!appUser && !isOwner && !isLifetimeMember\(appUser\)/
    );
    expect(chatSource).toMatch(/\{showPlanCtas && \(\s*<div className="dc-menu-cta-row">/);
  });
});

describe("account popover v2 (Round 3 Step 1, owner directive 2026-07-22)", () => {
  it("cuts Edit Profile and Discord Connected from the popover — no trace in source", () => {
    // The rows are gone; goTo("/profile") had exactly two call sites (both of
    // these rows) and neither survives the amendment. "Discord Connected:"
    // was the row's exact literal text — its absence is unambiguous, unlike
    // bare "Edit Profile" which now also appears inside this amendment's own
    // explanatory comment.
    expect(chatSource).not.toMatch(/goTo\("\/profile"\)/);
    expect(chatSource).not.toContain("Discord Connected:");
    // No <button> anywhere still renders the literal "Edit Profile" label —
    // scan JSX-only lines (a bare ">Edit Profile<" would appear if a button
    // opened and closed around the text on adjoining lines; the row's real
    // shape was multi-line, so match the specific line that held it instead).
    expect(chatSource).not.toMatch(/^\s*Edit Profile\s*$/m);
  });

  it("still derives every identity field the removed rows depended on (logic kept, only the menu rows are gone)", () => {
    // sidebarIdentity + resolveAvatarSrc are untouched — /profile and the
    // Discord identity plumbing still work, just from Settings in Step 2.
    expect(chatSource).toMatch(/formatHandle\(appUser\.username\)/);
    expect(chatSource).toMatch(/resolveAvatarSrc\(user\)/);
  });

  it("renders the row set in order: Theme, Settings, [Admin Dashboard], divider, Log Out", () => {
    const viewportIdx = chatSource.indexOf('<div className="dc-menu-viewport"');
    const themeRowIdx = chatSource.indexOf("<SunMoon", viewportIdx);
    const settingsRowIdx = chatSource.indexOf("<SettingsIcon", viewportIdx);
    const adminRowIdx = chatSource.indexOf("<ShieldCheck", viewportIdx);
    const logOutIdx = chatSource.indexOf(
      'className="dc-menu-item dc-menu-item--strong',
      viewportIdx
    );
    expect(viewportIdx).toBeGreaterThan(-1);
    expect(themeRowIdx).toBeGreaterThan(viewportIdx);
    expect(settingsRowIdx).toBeGreaterThan(themeRowIdx);
    expect(adminRowIdx).toBeGreaterThan(settingsRowIdx);
    expect(logOutIdx).toBeGreaterThan(adminRowIdx);
  });

  it("gates the Admin Dashboard row on the server-verified isOwner prop, not a username check", () => {
    // The gate reuses the same `isOwner` prop the sidebar already threads
    // from useAppAuth()'s server-verified role — not isPrezAccount (username).
    const adminBlockIdx = chatSource.indexOf("{isOwner && (");
    const adminButtonIdx = chatSource.indexOf("<ShieldCheck", adminBlockIdx);
    const adminOnClickIdx = chatSource.indexOf(
      'onClick={() => goTo("/admin/users")}',
      adminBlockIdx
    );
    const adminBlockCloseIdx = chatSource.indexOf(")}", adminButtonIdx);
    expect(adminBlockIdx).toBeGreaterThan(-1);
    expect(adminOnClickIdx).toBeGreaterThan(adminBlockIdx);
    expect(adminOnClickIdx).toBeLessThan(adminButtonIdx);
    expect(adminButtonIdx).toBeLessThan(adminBlockCloseIdx);
  });

  it("Theme row drills into a segmented System|Light|Dark radiogroup driven by ThemeContext's mode", () => {
    expect(chatSource).toMatch(
      /const \{ mode: themeMode, setMode: setThemeMode \} = useTheme\(\)/
    );
    expect(chatSource).toMatch(/onClick=\{\(\) => setMenuView\("theme"\)\}/);
    expect(chatSource).toMatch(/onClick=\{\(\) => setMenuView\("root"\)\}/);
    expect(chatSource).toMatch(/role="radiogroup"/);
    expect(chatSource).toMatch(/role="radio"/);
    expect(chatSource).toMatch(/aria-checked=\{themeMode === optMode\}/);
    expect(chatSource).toMatch(/onClick=\{\(\) => setThemeMode\?\.\(optMode\)\}/);
    expect(chatSource).toMatch(/THEME_MODE_OPTIONS\.map/);
  });

  it("Theme options are exactly System, Light, Dark in that order", () => {
    expect(chatSource).toMatch(
      /const THEME_MODE_OPTIONS: Array<\{[\s\S]{0,120}\}> = \[\s*\{ mode: "system", label: "System", Icon: Monitor \},\s*\{ mode: "light", label: "Light", Icon: Sun \},\s*\{ mode: "dark", label: "Dark", Icon: Moon \},\s*\];/
    );
  });

  it("Settings row is wired to an onOpenSettings callback with a Step 2 TODO — not a route", () => {
    expect(chatSource).toMatch(/onOpenSettings\?: \(\) => void/);
    expect(chatSource).toMatch(/TODO\(step-2\)/);
    expect(chatSource).toMatch(/onOpenSettings\?\.\(\)/);
    // It closes the popover but never calls goTo/navigate.
    const settingsBtnIdx = chatSource.indexOf("<SettingsIcon");
    const settingsHandlerStart = chatSource.lastIndexOf("onClick={() => {", settingsBtnIdx);
    const settingsHandlerEnd = chatSource.indexOf("}}", settingsHandlerStart);
    const settingsHandlerBody = chatSource.slice(settingsHandlerStart, settingsHandlerEnd);
    expect(settingsHandlerBody).toContain("setMenuOpen(false)");
    expect(settingsHandlerBody).not.toMatch(/goTo\(/);
  });

  it("the slide is the ONE frozen 160ms curve via a plain CSS transition, not a keyframe animation", () => {
    expect(cssSource).toMatch(
      /\.dc-menu-slider \{[^}]*transition: transform 160ms cubic-bezier\(0\.16, 1, 0\.3, 1\);[^}]*\}/
    );
    expect(cssSource).not.toMatch(/@keyframes dcMenuSlide/);
  });

  it("reduced motion collapses the slide + height sync to an instant swap", () => {
    expect(cssSource).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.dc-menu-viewport \{ transition: none; \}[\s\S]*\.dc-menu-slider \{ transition: none; \}[\s\S]*\}/
    );
  });
});

describe("non-owner coming-soon gate (Phase 2)", () => {
  it("computes a fail-closed access state (pending while auth resolves)", () => {
    expect(chatSource).toMatch(
      /const chatAccess: "granted" \| "pending" \| "denied" = previewMode\s*\? "granted"\s*: authLoading\s*\? "pending"\s*: isOwner\s*\? "granted"\s*: "denied"/
    );
  });

  it("renders the wordmark + exact copy for denied users", () => {
    expect(chatSource).toContain("AI MODEL CHAT COMING SOON");
    expect(chatSource).toMatch(
      /src=\{`\/brand\/dime-wordmark-on-\$\{theme\}\.svg`\}/
    );
    expect(cssSource).toMatch(/\.dc-coming-soon/);
  });

  it("renders composer, hero, pills and ghost ONLY when access is granted", () => {
    // Every chat-surface block is behind the granted check; the denied branch
    // renders only the coming-soon block.
    expect(chatSource).toMatch(
      /\{chatAccess === "granted" && conversation && \(\s*<div\s+className="dc-scroller"/
    );
    expect(chatSource).toMatch(
      /\{chatAccess === "granted" && !conversation && \(\s*<BrandHero/
    );
    expect(chatSource).toMatch(
      /\{chatAccess === "granted" && \(\s*<div className="dc-composer-zone">/
    );
    expect(chatSource).toMatch(
      /\{chatAccess === "granted" && !conversation && \(\s*<PromptPills/
    );
    expect(chatSource).toMatch(/\{chatAccess === "granted" && ghost && \(/);
    expect(chatSource).toMatch(
      /\{chatAccess === "denied" && \(/
    );
  });

  it("gates submit() and retry() before any dispatch or stream", () => {
    const submitStart = chatSource.indexOf("const submit = useCallback(");
    const submitGate = chatSource.indexOf(
      'if (chatAccess !== "granted") return;',
      submitStart
    );
    const dispatchIdx = chatSource.indexOf(
      'dispatch({ type: "append_user"',
      submitStart
    );
    expect(submitStart).toBeGreaterThan(-1);
    expect(submitGate).toBeGreaterThan(submitStart);
    expect(submitGate).toBeLessThan(dispatchIdx);

    const retryStart = chatSource.indexOf("const retry = useCallback(() => {");
    const retryGate = chatSource.indexOf(
      'if (chatAccess !== "granted") return;',
      retryStart
    );
    const retryStream = chatSource.indexOf("void runStream(", retryStart);
    expect(retryStart).toBeGreaterThan(-1);
    expect(retryGate).toBeGreaterThan(retryStart);
    expect(retryGate).toBeLessThan(retryStream);
  });

  it("preview bypass stays compile-time DEV-gated at both call sites", () => {
    // [PR #70 REMEDIATION 2026-07-12] The standalone DimeChatRoute fork this
    // test originally pinned was removed: /chat now has ONE owner
    // (DimeAppShell) at every width so crossing 768px cannot remount the
    // chat. The DEV-gating contract is unchanged — previewMode still flows
    // ONLY from allowsLocalDimePreview(search, import.meta.env.DEV) at the
    // unified Router call site, and previewGate.ts hard-returns false in
    // non-DEV builds (enforced by scripts/verify-preview-production.mjs).
    expect(appSource).toMatch(
      /const localPreview = allowsLocalDimePreview\(\s*window\.location\.search,\s*import\.meta\.env\.DEV\s*\)/
    );
    expect(appSource).toMatch(
      /localPreview \? \(\s*<DimeAppShell mode=\{shellMode\} previewMode \/>/
    );
    // Shell: forwards its own DEV-gated previewMode flag.
    expect(shellSource).toMatch(/<DimeChatPage\s+previewMode=\{previewMode\}/);
  });
});
