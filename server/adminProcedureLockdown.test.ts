import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Admin procedure lockdown — server-side audit (Round 3 Step 5, owner
 * directive 2026-07-22).
 *
 * "Admin Dashboard is for @prez only ... No other users or site members
 * should be able to view these pages." The client route guard (RequireOwner)
 * is cosmetic; THIS is the real boundary — every tRPC procedure that
 * UserManagement.tsx and PublishProjections.tsx call must reject a
 * non-owner caller server-side.
 *
 * Why source-contract, not a live-call test: exercising the real request
 * pipeline (ownerProcedure's DB-authoritative role lookup) needs a live
 * DB connection, and this repo's vitest suite is DB-dependent-test-averse
 * outside CI (CLAUDE.md: "Vitest suite requires GitHub Actions secrets ...
 * DB-dependent tests fail without DATABASE_URL"). The DB-independent half
 * of the owner check IS covered by a real unit test already —
 * server/ownerAuth.test.ts exercises resolveOwnerIdentity() (the function
 * every ownerProcedure delegates to) end-to-end, including "rejects a
 * fresh database row after owner demotion". What THIS suite adds is the
 * missing link: proof that every procedure the two admin pages actually
 * call is wired to that middleware in the first place. Per the task brief,
 * a source-contract test on the procedure bindings is the acceptable
 * substitute here.
 *
 * Audit method: every trpc.<router>.<procedure>.useQuery/useMutation call
 * site in UserManagement.tsx and PublishProjections.tsx was enumerated by
 * hand (see .superpowers/sdd/r3-task-5-report.md for the full table), then
 * each procedure's declaration is pinned below to require the
 * `<name>: ownerProcedure` shape. One procedure — games.lastRefresh — is a
 * deliberate, pre-existing, reviewed exception (shared by non-admin pages,
 * returns only a timestamp, no admin/user/model data) and is pinned as
 * `publicProcedure` on purpose, not skipped.
 */

const appUsersSource = fs.readFileSync(
  path.join(import.meta.dirname, "routers", "appUsers.ts"),
  "utf8"
);
const metricsSource = fs.readFileSync(
  path.join(import.meta.dirname, "routers", "metrics.ts"),
  "utf8"
);
const routersSource = fs.readFileSync(
  path.join(import.meta.dirname, "routers.ts"),
  "utf8"
);
const wc2026Source = fs.readFileSync(
  path.join(import.meta.dirname, "wc2026", "wc2026Router.ts"),
  "utf8"
);

/** Procedure must be declared as `<name>: ownerProcedure` (possibly
 *  followed by .input(...)/.query(/.mutation( on the same or a later
 *  line) — i.e. ownerProcedure is the base builder, not chained onto
 *  something else afterward. */
function expectOwnerBound(source: string, name: string) {
  const re = new RegExp(`\\b${name}:\\s*ownerProcedure\\b`);
  expect(source, `${name} must be bound to ownerProcedure`).toMatch(re);
}

describe("appUsers router — procedures called by UserManagement.tsx", () => {
  const procedures = [
    "listUsers",
    "createUser",
    "updateUser",
    "deleteUser",
    "forceLogoutUser",
    "forceLogoutAll",
    "adminDisconnectDiscord",
    "generateDiscordInvite",
    "syncDiscordRole",
    "setManualDiscordId",
  ];

  it.each(procedures)("%s is ownerProcedure-bound", (name) => {
    expectOwnerBound(appUsersSource, name);
  });
});

describe("metrics router — procedures called by UserManagement.tsx", () => {
  const procedures = [
    "getSessionMetrics",
    "getMemberMetrics",
    "getDurationHistogram",
  ];

  it.each(procedures)("%s is ownerProcedure-bound", (name) => {
    expectOwnerBound(metricsSource, name);
  });

  it("imports ownerProcedure from the appUsers router (single source of the owner check)", () => {
    expect(metricsSource).toMatch(
      /import \{ ownerProcedure, appUserProcedure \} from "\.\/appUsers";/
    );
  });
});

describe("games router (routers.ts) — procedures called by PublishProjections.tsx", () => {
  const procedures = [
    "listStaging",
    "updateProjections",
    "setPublished",
    "setModelPublished",
    "bulkApproveModels",
    "publishAll",
    "deleteGame",
    "lastNbaModelSync",
    "triggerNbaModelSync",
    "triggerRefresh",
  ];

  it.each(procedures)("games.%s is ownerProcedure-bound", (name) => {
    expectOwnerBound(routersSource, name);
  });

  it("games.lastRefresh is a deliberate, reviewed public exception (timestamp only, no admin data) — not silently ungated", () => {
    // Shared by BettingSplits.tsx and ModelProjections.tsx ("Last updated
    // HH:MM") — locking it to owner would break those non-admin surfaces.
    // getLastRefreshResult() returns only refresh counters/timestamps, no
    // user list, no role, no publish control.
    expect(routersSource).toMatch(
      /\/\*\* Returns the result of the last auto-refresh run \(null if never run\)\.\s*\*\/\s*\n\s*\/\/ OK: returns only a timestamp — no model data\s*\n\s*lastRefresh: publicProcedure\.query/
    );
  });
});

describe("nhlModel router (routers.ts) — procedures called by PublishProjections.tsx", () => {
  const procedures = ["checkGoalies", "getLastGoalieCheck"];

  it.each(procedures)("nhlModel.%s is ownerProcedure-bound", (name) => {
    expectOwnerBound(routersSource, name);
  });
});

describe("wc2026 router — procedures called by PublishProjections.tsx", () => {
  const procedures = ["listMatchOdds", "updateMatchOdds"];

  it.each(procedures)("wc2026.%s is ownerProcedure-bound", (name) => {
    expectOwnerBound(wc2026Source, name);
  });

  it("imports ownerProcedure from the appUsers router (single source of the owner check)", () => {
    expect(wc2026Source).toMatch(
      /import \{ ownerProcedure \} from "\.\.\/routers\/appUsers";/
    );
  });
});

describe("ownerProcedure itself resolves role from an authoritative DB read, not the JWT claim", () => {
  it("re-fetches the user by id and checks role via resolveOwnerIdentity — a stale JWT role cannot grant access", () => {
    expect(appUsersSource).toMatch(
      /export const ownerProcedure = publicProcedure\.use\(async \(\{ ctx, next \}\) => \{/
    );
    expect(appUsersSource).toMatch(/const lookup = await lookupAppUserByIdFresh\(payload\.userId\);/);
    expect(appUsersSource).toMatch(/const resolved = resolveOwnerIdentity\(/);
    expect(appUsersSource).toMatch(/if \(!resolved\.ok\) \{/);
    expect(appUsersSource).toMatch(/code: "FORBIDDEN", message: "Owner access required"/);
  });
});
