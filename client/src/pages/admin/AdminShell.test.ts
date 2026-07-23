import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * AdminShell — shared chrome for the owner-only Admin Dashboard
 * (Round 3 Step 5, owner directive 2026-07-22).
 *
 * Source-contract pattern (see DimeAppShell.test.ts) — pins:
 *  1. AdminShell itself: two-tab nav (User Management | Publish
 *     Projections, in that order), a back-to-app affordance, the Dime
 *     wordmark, and the brand-law 160ms motion curve (via AdminShell.css,
 *     not Tailwind's differently-timed `transition-colors` utility).
 *  2. Both admin pages (UserManagement.tsx, PublishProjections.tsx) render
 *     their content inside <AdminShell>, with the correct `active` tab —
 *     "functional parity" requires the wrap not touch what's already
 *     inside, so this only asserts the wrapper is present, never that
 *     inner markup changed shape.
 */

const shellSource = fs.readFileSync(
  path.join(import.meta.dirname, "AdminShell.tsx"),
  "utf8"
);
const shellCss = fs.readFileSync(
  path.join(import.meta.dirname, "AdminShell.css"),
  "utf8"
);
const userMgmtSource = fs.readFileSync(
  path.join(import.meta.dirname, "..", "UserManagement.tsx"),
  "utf8"
);
const publishSource = fs.readFileSync(
  path.join(import.meta.dirname, "..", "PublishProjections.tsx"),
  "utf8"
);
const userActivitySource = fs.readFileSync(
  path.join(import.meta.dirname, "..", "UserActivity.tsx"),
  "utf8"
);

describe("AdminShell — shared admin chrome", () => {
  it("owns no auth logic — doc comment states RequireOwner + server ownerProcedure are the real boundary", () => {
    expect(shellSource).not.toMatch(/useAppAuth/);
    expect(shellSource).toMatch(/RequireOwner/);
    expect(shellSource).toMatch(/ownerProcedure/);
    expect(shellSource).toMatch(/not a security boundary/i);
  });

  it("is registry-driven — maps ADMIN_NAV and links the /admin dashboard hub", () => {
    // The nav is now sourced from the shared ADMIN_NAV registry (adminNav.ts)
    // rather than a hard-coded 3-tab literal, so every admin tool is reachable.
    expect(shellSource).toMatch(/import \{ ADMIN_NAV, type AdminNavKey \} from "\.\/adminNav";/);
    expect(shellSource).toMatch(/ADMIN_NAV\.map\(\(tab\) =>/);
    // Dashboard hub affordance → /admin.
    expect(shellSource).toMatch(/navigate\("\/admin"\)/);
    expect(shellSource).toMatch(/aria-label="Admin dashboard home"/);
  });

  it("adminNav registry covers all admin routes with real paths", () => {
    const navSource = fs.readFileSync(path.join(import.meta.dirname, "adminNav.ts"), "utf8");
    for (const p of [
      "/admin/users", "/admin/activity", "/admin/waitlist", "/admin/publish",
      "/admin/model-results", "/admin/backtest", "/admin/model-status", "/admin/f5-edge",
      "/admin/ingest-an", "/admin/postponed-games", "/admin/security", "/admin/claude",
    ]) {
      expect(navSource).toContain(`path: "${p}"`);
    }
  });

  it("renders a back-to-app affordance targeting the canonical feed", () => {
    expect(shellSource).toMatch(
      /const BACK_TO_APP_PATH = "\/feed\/model\/mlb";/
    );
    expect(shellSource).toMatch(/onClick=\{\(\) => navigate\(BACK_TO_APP_PATH\)\}/);
    expect(shellSource).toMatch(/aria-label="Back to app"/);
  });

  it("carries the Dime wordmark (dotless ı + mint coin-dot, brand law spec)", () => {
    expect(shellSource).toMatch(/className="dime-wordmark"/);
    expect(shellSource).toMatch(/className="dime-wordmark-i"/);
    expect(shellSource).toMatch(/className="dime-coindot"/);
  });

  it("active tab is keyed off the explicit `active` prop, not re-derived from the route", () => {
    expect(shellSource).toMatch(/active: AdminNavKey;/);
    expect(shellSource).toMatch(/const isActive = tab\.key === active;/);
    expect(shellSource).toMatch(/aria-selected=\{isActive\}/);
  });

  it("switches tabs via navigate(), never re-navigating to the already-active tab", () => {
    expect(shellSource).toMatch(
      /onClick=\{\(\) => \{\s*if \(!isActive\) navigate\(tab\.path\);\s*\}\}/
    );
  });

  it("uses semantic Dime brand tokens (--primary/--background/--foreground/--muted), never a hardcoded hex", () => {
    expect(shellSource).not.toMatch(/#[0-9A-Fa-f]{3,6}/);
    expect(shellSource).toMatch(/bg-background/);
    expect(shellSource).toMatch(/text-foreground/);
    expect(shellSource).toMatch(/bg-muted/);
  });

  it("uses the exact brand-law 160ms motion curve, not Tailwind's default transition-colors timing", () => {
    expect(shellSource).not.toMatch(/transition-colors/);
    expect(shellCss).toMatch(
      /transition:\s*\n?\s*background-color 160ms cubic-bezier\(0\.16, 1, 0\.3, 1\)/
    );
    expect(shellCss).toMatch(
      /transition:\s*\n?\s*background-color 160ms cubic-bezier\(0\.16, 1, 0\.3, 1\),\s*\n?\s*color 160ms cubic-bezier\(0\.16, 1, 0\.3, 1\)/
    );
  });

  it("collapses every transition under prefers-reduced-motion: reduce", () => {
    expect(shellCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*transition: none;[\s\S]*\}/
    );
  });
});

describe("UserManagement renders inside AdminShell", () => {
  it("imports AdminShell and wraps the authenticated render in it, active=\"users\"", () => {
    expect(userMgmtSource).toMatch(
      /import \{ AdminShell \} from "@\/pages\/admin\/AdminShell";/
    );
    expect(userMgmtSource).toMatch(/<AdminShell active="users">/);
    expect(userMgmtSource).toMatch(/<\/AdminShell>\s*\n\s*\);\s*\n\}/);
  });

  it("does not wrap the loading/redirecting screens in AdminShell (no chrome flash pre-auth)", () => {
    const shellIdx = userMgmtSource.indexOf('<AdminShell active="users">');
    const loadingGuardIdx = userMgmtSource.indexOf(
      "if (loading || (!loading && (!appUser || appUser.role !== \"owner\")))"
    );
    expect(shellIdx).toBeGreaterThan(-1);
    expect(loadingGuardIdx).toBeGreaterThan(-1);
    expect(loadingGuardIdx).toBeLessThan(shellIdx);
  });

  it("keeps the internal owner guard as defense-in-depth (unchanged redirect target)", () => {
    expect(userMgmtSource).toMatch(
      /if \(!loading && \(!appUser \|\| appUser\.role !== "owner"\)\) \{/
    );
    expect(userMgmtSource).toMatch(/navigate\("\/feed\/model\/mlb"\)/);
  });
});

describe("PublishProjections renders inside AdminShell", () => {
  it("imports AdminShell and wraps the authenticated render in it, active=\"publish\"", () => {
    expect(publishSource).toMatch(
      /import \{ AdminShell \} from "@\/pages\/admin\/AdminShell";/
    );
    expect(publishSource).toMatch(/<AdminShell active="publish">/);
    expect(publishSource).toMatch(/<\/AdminShell>\s*\n\s*\);\s*\n\}/);
  });

  it("does not wrap the loading/redirecting screens in AdminShell (no chrome flash pre-auth)", () => {
    const shellIdx = publishSource.indexOf('<AdminShell active="publish">');
    const loadingGuardIdx = publishSource.indexOf("if (authLoading) {");
    const redirectGuardIdx = publishSource.indexOf("if (!isOwner) return null;");
    expect(shellIdx).toBeGreaterThan(-1);
    expect(loadingGuardIdx).toBeGreaterThan(-1);
    expect(redirectGuardIdx).toBeGreaterThan(-1);
    expect(loadingGuardIdx).toBeLessThan(shellIdx);
    expect(redirectGuardIdx).toBeLessThan(shellIdx);
  });

  it("keeps the internal strict owner-only guard as defense-in-depth (unchanged)", () => {
    expect(publishSource).toMatch(
      /if \(!authLoading && \(!appUser \|\| !isOwner\)\) \{\s*setLocation\("\/feed\/model\/mlb"\);/
    );
  });
});

describe("UserActivity renders inside AdminShell", () => {
  it("imports AdminShell and wraps the authenticated render in it, active=\"activity\"", () => {
    expect(userActivitySource).toMatch(
      /import \{ AdminShell \} from "@\/pages\/admin\/AdminShell";/
    );
    expect(userActivitySource).toMatch(/<AdminShell active="activity">/);
    expect(userActivitySource).toMatch(/<\/AdminShell>\s*\n\s*\);\s*\n\}/);
  });
});
