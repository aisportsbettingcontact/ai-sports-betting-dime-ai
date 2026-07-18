/**
 * MobileFloatingNav — source-shape contract tests
 * ═══════════════════════════════════════════════
 * Repo convention (see DimeAppShell.test.ts): component/CSS wiring is
 * enforced by reading the source files and asserting structural invariants —
 * no DOM, no React render (vitest runs in the node environment).
 *
 * Contract under test: docs/plans/2026-07-18-mobile-floating-nav.md
 *  1. Semantics — nav landmark, real links, aria-current on active only,
 *     "Chat with Dime AI" accessible name with a decorative inline wordmark.
 *  2. Geometry — deterministic Chat centering, 44px targets, safe-area,
 *     measured height reservation (no fixed-pixel clearance).
 *  3. Brand law — exact mint token, solid surfaces (no backdrop blur /
 *     translucent fills), reduced-motion support, hover only on
 *     hover-capable devices, visible focus.
 *  4. Retirement — the bottom tab bar and every bottom-clearance rule are
 *     gone; the new body class carries all page integrations.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const read = (...segs: string[]) =>
  fs.readFileSync(path.join(import.meta.dirname, ...segs), "utf8");
const exists = (...segs: string[]) =>
  fs.existsSync(path.join(import.meta.dirname, ...segs));

const navSrc = read("MobileFloatingNav.tsx");
const navCss = read("mobileFloatingNav.css");
const globalSrc = read("GlobalMobileOwnerTabs.tsx");
const shellSrc = read("MobileOwnerTabsShell.tsx");
const indexCss = read("..", "..", "index.css");
const dimeMobileCss = read("..", "..", "styles", "dime-mobile.css");
const conversationCss = read(
  "..",
  "..",
  "pages",
  "dime-chat",
  "conversation.css"
);
const profileCss = read("..", "..", "pages", "profile.css");
const appSrc = read("..", "..", "App.tsx");

describe("Navigation semantics", () => {
  it("renders a semantic nav landmark with an accessible label", () => {
    expect(navSrc).toMatch(
      /<nav className="mfn-nav" aria-label="Main navigation">/
    );
  });

  it("destinations are real wouter <Link> anchors, not buttons or manual navigation", () => {
    expect(navSrc).toMatch(/import \{ Link, useLocation \} from "wouter"/);
    expect(navSrc).toMatch(/<Link\s/);
    expect(navSrc).not.toMatch(/window\.location/);
    expect(navSrc).not.toMatch(/<button/);
  });

  it("aria-current='page' is applied only to the genuinely active destination", () => {
    expect(navSrc).toMatch(/aria-current=\{isActive \? "page" : undefined\}/);
  });

  it("active state derives from the router location via the pure matcher", () => {
    expect(navSrc).toMatch(/const \[location\] = useLocation\(\)/);
    expect(navSrc).toMatch(/getActiveTabId\(location\)/);
  });

  it("Chat carries the accessible name 'Chat with Dime AI' with a decorative inline wordmark", () => {
    expect(navSrc).toMatch(
      /aria-label=\{isChat \? "Chat with Dime AI" : undefined\}/
    );
    expect(navSrc).toMatch(/<DimeWordmark decorative \/>/);
    // decorative → aria-hidden so screen readers don't read the logo twice
    expect(navSrc).toMatch(/"aria-hidden": true/);
  });

  it("re-tapping the active destination replaces instead of pushing history", () => {
    expect(navSrc).toMatch(/replace=\{isActive\}/);
  });

  it("visible order Feed→Tools→Chat→Bet Tracker→Profile comes from config (single source)", () => {
    expect(navSrc).toMatch(/MOBILE_OWNER_TABS\.map\(/);
  });
});

describe("Geometry and clearance", () => {
  it("Chat centering is deterministic: symmetric minmax(0,1fr) pairs around an auto center track", () => {
    // whitespace-normalized — prettier may wrap the long track list
    const flat = navCss.replace(/\s+/g, " ");
    expect(flat).toMatch(
      /grid-template-columns: minmax\( ?0, ?1fr ?\) minmax\( ?0, ?1fr ?\) auto minmax\( ?0, ?1fr ?\) minmax\( ?0, ?1fr ?\)/
    );
  });

  it("touch targets meet the 44px floor", () => {
    expect(navCss).toMatch(/\.mfn-item \{[^}]*min-height: 44px/s);
    expect(navCss).toMatch(/\.mfn-item \{[^}]*min-width: 44px/s);
  });

  it("respects the top safe-area inset", () => {
    expect(navCss).toMatch(/env\(safe-area-inset-top/);
  });

  it("publishes its measured height and reserves matching document space", () => {
    expect(navSrc).toMatch(/ResizeObserver/);
    expect(navSrc).toMatch(/--dime-floating-nav-h/);
    expect(navSrc).toMatch(/removeProperty\(NAV_CLEARANCE_VAR\)/);
    expect(indexCss).toMatch(
      /body\.dime-floating-nav-active \{\s*padding-top: var\(--dime-floating-nav-h/
    );
  });

  it("re-anchors viewport-sticky page headers below the nav", () => {
    expect(indexCss).toMatch(
      /body\.dime-floating-nav-active header\.sticky\.top-0 \{\s*top: var\(--dime-floating-nav-h/
    );
  });

  it("sits below modal dialogs in the existing z-index system", () => {
    // Modals (AgeModal/LoginModal/dialogs) render at z-50; nav stays at 40.
    expect(navCss).toMatch(/z-index: 40/);
  });
});

describe("Brand law (THREE-COLOR-LAW v2/v3)", () => {
  it("Chat pill uses the exact mint token with near-black ink", () => {
    const chatBlock = navCss.slice(navCss.indexOf(".mfn-chat {"));
    expect(chatBlock).toMatch(/background: var\(--dime-mint\)/);
    expect(chatBlock).toMatch(/color: #000000/);
    // the token's computed value is verified in dime-mobile.css
    expect(dimeMobileCss).toMatch(/--dime-mint: #45e0a8/i);
  });

  it("the coin-dot inside the mint pill flips to white (white dot on mint)", () => {
    expect(navCss).toMatch(
      /\.mfn-chat \.mfn-coindot \{[^}]*background: #ffffff/s
    );
  });

  it("Chat keeps the exact mint fill even while /chat is the active route", () => {
    // the generic [aria-current="page"] raised-grey fill must not beat the
    // mint pill — an explicit higher-specificity override pins it
    expect(navCss).toMatch(
      /\.mfn-item\.mfn-chat\[aria-current="page"\] \{[^}]*background: var\(--dime-mint\)/s
    );
    expect(navCss).toMatch(
      /\.mfn-item\.mfn-chat\[aria-current="page"\]::after \{[^}]*background: #ffffff/s
    );
  });

  it("surfaces are solid tokens — no translucent fills, no backdrop blur, no gradients", () => {
    expect(navCss).not.toMatch(/backdrop-filter/);
    expect(navCss).not.toMatch(/(?:linear|radial|conic)-gradient/i);
    // alpha only ever inside box-shadow values
    const alphaOutsideShadow = navCss
      .split("\n")
      .filter(
        l =>
          /rgba\(/.test(l) &&
          !/--mfn-shadow|--mfn-chat-shadow|box-shadow/.test(l)
      );
    expect(alphaOutsideShadow).toEqual([]);
    expect(navCss).toMatch(/background: var\(--dime-surface-raised\)/);
  });

  it("motion uses the brand curve and collapses under prefers-reduced-motion", () => {
    expect(navCss).toMatch(/var\(--dime-t\) var\(--dime-ease\)/);
    expect(navCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*transition: none/
    );
    expect(navCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*transform: none/
    );
  });

  it("hover styles apply only on hover-capable devices (no stuck touch hover)", () => {
    expect(navCss).toMatch(/@media \(hover: hover\)/);
    // no :hover rule outside the capability query
    const outside = navCss.replace(
      /@media \(hover: hover\) \{[\s\S]*?\n\}/,
      ""
    );
    expect(outside).not.toMatch(/:hover/);
  });

  it("keyboard focus is visible on every destination, including on the mint pill", () => {
    expect(navCss).toMatch(
      /\.mfn-item:focus-visible \{[^}]*var\(--dime-ring\)/s
    );
    // mint-on-mint needs a gap ring to stay visible
    expect(navCss).toMatch(
      /\.mfn-chat:focus-visible \{[^}]*0 0 0 2px var\(--dime-surface-raised\)/s
    );
  });

  it("active indicator is not color-only: fill + weight + dot", () => {
    expect(navCss).toMatch(
      /\.mfn-item\[aria-current="page"\] \{[^}]*font-weight: 600/s
    );
    expect(navCss).toMatch(
      /\.mfn-item\[aria-current="page"\]::after \{[^}]*var\(--dime-mint\)/s
    );
  });
});

describe("Old navigation retirement", () => {
  it("MobileOwnerBottomTabs no longer exists and is referenced nowhere", () => {
    expect(exists("MobileOwnerBottomTabs.tsx")).toBe(false);
    for (const src of [navSrc, globalSrc, shellSrc, appSrc]) {
      expect(src).not.toMatch(/MobileOwnerBottomTabs/);
    }
  });

  it("the retired bottom-clearance body class is gone from every stylesheet", () => {
    for (const css of [indexCss, dimeMobileCss, conversationCss, profileCss]) {
      expect(css).not.toMatch(/mobile-owner-tabs-active/);
    }
  });

  it("global mount renders the floating nav and toggles the new body class", () => {
    expect(globalSrc).toMatch(/return <MobileFloatingNav \/>/);
    expect(globalSrc).toMatch(
      /FLOATING_NAV_BODY_CLASS = "dime-floating-nav-active"/
    );
    expect(globalSrc).toMatch(/classList\.add\(FLOATING_NAV_BODY_CLASS\)/);
    expect(globalSrc).toMatch(/classList\.remove\(FLOATING_NAV_BODY_CLASS\)/);
  });

  it("global mount now covers /m/* (the shell lost its own bar) but still skips /login", () => {
    expect(globalSrc).not.toMatch(/location === "\/m"/);
    expect(globalSrc).toMatch(/location === "\/login"/);
    expect(shellSrc).not.toMatch(/MobileOwnerBottomTabs/);
    expect(shellSrc).toMatch(/paddingTop: "var\(--dime-floating-nav-h, 0px\)"/);
  });

  it("App.tsx still mounts the global nav outside the router", () => {
    expect(appSrc).toMatch(/<GlobalMobileOwnerTabs \/>/);
  });
});

describe("Page integrations under body.dime-floating-nav-active", () => {
  it("feed: wordmark topbar hides and the sticky feedhead re-anchors", () => {
    expect(dimeMobileCss).toMatch(
      /body\.dime-floating-nav-active \.dmf-root \.dmf-topbar \{\s*display: none/
    );
    expect(dimeMobileCss).toMatch(
      /body\.dime-floating-nav-active \.dmf-root \.dmf-feedhead \{\s*top: var\(--dime-floating-nav-h/
    );
  });

  it("splits: the brand-only header row hides (one Dime identity per page)", () => {
    expect(dimeMobileCss).toMatch(
      /body\.dime-floating-nav-active \.bs-header \.bs-brand-row \{\s*display: none/
    );
  });

  it("chat: the fixed viewport app shifts down by the nav height, keyboard vars intact", () => {
    expect(conversationCss).toMatch(
      /body\.dime-floating-nav-active \.dc-page\.dc-page--app \{[^}]*var\(--dc-visual-top, 0px\) \+ var\(--dime-floating-nav-h/s
    );
    expect(conversationCss).toMatch(
      /body\.dime-floating-nav-active \.dc-mobile-bar \{[^}]*var\(--dime-floating-nav-h/s
    );
    // the retired 60px bottom-bar composer compensation must not return
    expect(conversationCss).not.toMatch(
      /60px \+ env\(safe-area-inset-bottom\)/
    );
  });

  it("profile: the hero wordmark hides while the floating logo owns the identity", () => {
    expect(profileCss).toMatch(
      /body\.dime-floating-nav-active \.pf-wordmark \{\s*display: none/
    );
  });
});
