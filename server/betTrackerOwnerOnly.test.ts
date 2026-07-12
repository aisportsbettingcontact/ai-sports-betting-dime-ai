import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Bet Tracker owner-only lockdown — contract tests (2026-07-12).
 *
 * Requirement: like the Dime Chat model, the Bet Tracker is restricted to the
 * owner accounts (@prez, @sippi). All non-owner users — subscribers, admins,
 * and handicappers — must be refused server-side and shown the pre-launch
 * screen (Dime wordmark + "AI BET TRACKER COMING SOON") client-side, on every
 * device and page that renders the tracker (standalone /bet-tracker, the
 * desktop shell tracker pane, and the mobile /m/tracker screen behind the
 * owner-only tabs shell).
 */

const routerSrc = fs.readFileSync(
  path.join(import.meta.dirname, "routers", "betTracker.ts"),
  "utf8"
);
const pageSrc = fs.readFileSync(
  path.join(import.meta.dirname, "..", "client", "src", "pages", "BetTracker.tsx"),
  "utf8"
);
const layoutSrc = fs.readFileSync(
  path.join(
    import.meta.dirname,
    "..",
    "client",
    "src",
    "features",
    "mobileOwnerTabs",
    "MobileOwnerLayout.tsx"
  ),
  "utf8"
);

describe("betTracker router — owner-only wiring", () => {
  it("builds every procedure on ownerProcedure via betTrackerProcedure", () => {
    expect(routerSrc).toMatch(/import \{ ownerProcedure \} from "\.\/appUsers"/);
    expect(routerSrc).toMatch(/const betTrackerProcedure = ownerProcedure;/);
  });

  it("no procedure remains on a weaker base", () => {
    // Every procedure key must bind to betTrackerProcedure — no handicapper/
    // appUser/public bases are allowed anywhere in this router.
    expect(routerSrc).not.toMatch(/:\s*handicapperProcedure/);
    expect(routerSrc).not.toMatch(/:\s*appUserProcedure/);
    expect(routerSrc).not.toMatch(/:\s*publicProcedure/);
    expect(routerSrc).not.toMatch(/:\s*protectedProcedure/);
    // All 16 procedures are present and bound to the owner-only base.
    expect(routerSrc.match(/:\s*betTrackerProcedure/g)?.length).toBe(16);
  });
});

describe("BetTracker page — non-owner COMING SOON screen", () => {
  it("grants tracker access to owners only", () => {
    expect(pageSrc).toMatch(/const canAccess = role === "owner";/);
    expect(pageSrc).not.toMatch(/\["owner", "admin", "handicapper"\]\.includes\(role\)/);
  });

  it("keeps protected queries disabled for non-owners", () => {
    expect(pageSrc).toMatch(/const canLoadProtectedData = canAccess && !!appUser/);
  });

  it("shows the Dime wordmark with the hardcoded line beneath it", () => {
    const gate = pageSrc.slice(
      pageSrc.indexOf("if (!canAccess) {"),
      pageSrc.indexOf("// ─────", pageSrc.indexOf("if (!canAccess) {"))
    );
    expect(gate).toContain("/brand/dime-wordmark-on-dark.svg");
    expect(gate).toContain("/brand/dime-wordmark-on-light.svg");
    // Wordmark first, coming-soon copy underneath.
    expect(gate.indexOf("dime-wordmark")).toBeLessThan(
      gate.indexOf("AI BET TRACKER COMING SOON")
    );
    // Theme-aware text: black on light mode, white on dark mode.
    expect(gate).toMatch(/light \? "text-black" : "text-white"/);
    // The old restricted-access screen is gone.
    expect(pageSrc).not.toContain("Access Restricted");
  });
});

describe("mobile owner tabs — Props replaced by Bet Tracker", () => {
  it("routes /m/tracker to the tracker screen and redirects the legacy slug", () => {
    expect(layoutSrc).toMatch(
      /<Route path="\/m\/tracker" component=\{MobileBetTracker\} \/>/
    );
    expect(layoutSrc).toMatch(
      /<Route path="\/m\/props">\{\(\) => <Redirect to="\/m\/tracker" replace \/>\}<\/Route>/
    );
  });
});
