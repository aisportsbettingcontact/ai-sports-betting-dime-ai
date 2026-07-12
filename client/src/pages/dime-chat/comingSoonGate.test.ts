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

  it("expiry and Discord rows hide when the data is absent — no placeholders", () => {
    expect(chatSource).toMatch(/\{expiryLine && \(/);
    expect(chatSource).toMatch(/\{appUser\.discordUsername && \(/);
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

  it("navigates Edit Profile / Upgrade / Cancel to real routes", () => {
    expect(chatSource).toMatch(/goTo\("\/profile"\)/);
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
    // Standalone route: previewMode only from allowsLocalDimePreview(DEV).
    expect(appSource).toMatch(
      /localPreview \? \(\s*<DimeChat previewMode \/>\s*\) : \(\s*<RequireAuth>\s*<DimeChat \/>\s*<\/RequireAuth>/
    );
    // Shell: forwards its own DEV-gated previewMode flag.
    expect(shellSource).toMatch(/<DimeChatPage\s+previewMode=\{previewMode\}/);
  });
});
