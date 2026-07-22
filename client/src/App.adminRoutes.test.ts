import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Admin Dashboard route wiring (Round 3 Step 5, owner directive 2026-07-22).
 *
 * "Admin Dashboard is for @prez only ... No other users or site members
 * should be able to view these pages." This suite pins the CLIENT half of
 * the lockdown at the route-composition layer: /admin/users and
 * /admin/publish must both be wrapped in RequireAuth (existing) AND the new
 * RequireOwner, nested in that order (RequireAuth resolves authentication
 * first — unauthenticated visitors never reach RequireOwner's redirect at
 * all; they hit RequireAuth's own /login redirect instead).
 *
 * Source-contract pattern (see DimeAppShell.test.ts) — this repo's client
 * vitest suite runs under `environment: "node"`, so route composition is
 * verified by pinning source shape, not by mounting the router.
 */

const appSource = fs.readFileSync(
  path.join(import.meta.dirname, "App.tsx"),
  "utf8"
);

describe("Admin Dashboard route guard composition", () => {
  it("imports RequireOwner alongside the existing RequireAuth", () => {
    expect(appSource).toMatch(
      /import \{ RequireAuth \} from "\.\/components\/RequireAuth";/
    );
    expect(appSource).toMatch(
      /import \{ RequireOwner \} from "\.\/components\/RequireOwner";/
    );
  });

  it("wraps /admin/users in RequireAuth > RequireOwner > UserManagement, in that nesting order", () => {
    const routeStart = appSource.indexOf('<Route path="/admin/users">');
    const routeEnd = appSource.indexOf("</Route>", routeStart);
    expect(routeStart).toBeGreaterThan(-1);
    const routeBlock = appSource.slice(routeStart, routeEnd);

    const authIdx = routeBlock.indexOf("<RequireAuth>");
    const ownerIdx = routeBlock.indexOf("<RequireOwner>");
    const pageIdx = routeBlock.indexOf("<UserManagement />");
    const ownerCloseIdx = routeBlock.indexOf("</RequireOwner>");
    const authCloseIdx = routeBlock.indexOf("</RequireAuth>");

    expect(authIdx).toBeGreaterThan(-1);
    expect(ownerIdx).toBeGreaterThan(authIdx);
    expect(pageIdx).toBeGreaterThan(ownerIdx);
    expect(ownerCloseIdx).toBeGreaterThan(pageIdx);
    expect(authCloseIdx).toBeGreaterThan(ownerCloseIdx);
  });

  it("wraps /admin/publish in RequireAuth > RequireOwner > PublishProjections, in that nesting order", () => {
    const routeStart = appSource.indexOf('<Route path="/admin/publish">');
    const routeEnd = appSource.indexOf("</Route>", routeStart);
    expect(routeStart).toBeGreaterThan(-1);
    const routeBlock = appSource.slice(routeStart, routeEnd);

    const authIdx = routeBlock.indexOf("<RequireAuth>");
    const ownerIdx = routeBlock.indexOf("<RequireOwner>");
    const pageIdx = routeBlock.indexOf("<PublishProjections />");
    const ownerCloseIdx = routeBlock.indexOf("</RequireOwner>");
    const authCloseIdx = routeBlock.indexOf("</RequireAuth>");

    expect(authIdx).toBeGreaterThan(-1);
    expect(ownerIdx).toBeGreaterThan(authIdx);
    expect(pageIdx).toBeGreaterThan(ownerIdx);
    expect(ownerCloseIdx).toBeGreaterThan(pageIdx);
    expect(authCloseIdx).toBeGreaterThan(ownerCloseIdx);
  });

  it("does not wrap any OTHER /admin/* route in RequireOwner (scope is exactly users + publish for this step)", () => {
    const otherAdminRoutes = [
      "/admin/ingest-an",
      "/admin/model-results",
      "/admin/security",
      "/admin/model-status",
      "/admin/postponed-games",
      "/admin/backtest",
      "/admin/waitlist",
      "/admin/claude",
    ];
    for (const route of otherAdminRoutes) {
      const routeStart = appSource.indexOf(`<Route path="${route}">`);
      if (routeStart === -1) continue; // redirected route, no block to check
      const routeEnd = appSource.indexOf("</Route>", routeStart);
      const routeBlock = appSource.slice(routeStart, routeEnd);
      expect(routeBlock).not.toContain("<RequireOwner>");
    }
  });
});
