/**
 * appUserDeletion.test.ts — the guard that stops account deletion orphaning data.
 *
 * The decision is pure, so this needs no database. The bug it protects against
 * was found in production on 2026-08-04: account 60002 was hard-deleted and left
 * 278 verified bets, a login session and an owner-reviewed edit request pointing
 * at an id with no row.
 */

import { describe, it, expect } from "vitest";
import {
  APP_USER_DEPENDENT_TABLES,
  AppUserHasDataError,
  describeDeletionBlock,
} from "./appUserDeletion";

describe("describeDeletionBlock", () => {
  it("allows deletion when the account owns nothing", () => {
    expect(describeDeletionBlock(42, {})).toBeNull();
    expect(describeDeletionBlock(42, { "tracked bets": 0, "login sessions": 0 })).toBeNull();
  });

  it("REGRESSION: refuses the exact shape that orphaned account 60002", () => {
    const msg = describeDeletionBlock(60002, {
      "tracked bets": 278,
      "login sessions": 1,
      "edit requests raised": 1,
    });
    expect(msg).not.toBeNull();
    expect(msg).toContain("Cannot delete user 60002");
    expect(msg).toContain("280 rows");          // 278 + 1 + 1
    expect(msg).toContain("278 tracked bets");
  });

  it("names every category that would be stranded, largest first", () => {
    const msg = describeDeletionBlock(7, {
      "login sessions": 5,
      "tracked bets": 100,
      "chat threads": 20,
    })!;
    const order = ["100 tracked bets", "20 chat threads", "5 login sessions"];
    let cursor = -1;
    for (const fragment of order) {
      const at = msg.indexOf(fragment);
      expect(at, `${fragment} missing`).toBeGreaterThan(-1);
      expect(at, `${fragment} out of order`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it("tells the operator what to do instead of just refusing", () => {
    const msg = describeDeletionBlock(7, { "tracked bets": 1 })!;
    expect(msg).toMatch(/hasAccess = false/);
    expect(msg).toMatch(/preserves the history/i);
  });

  it("blocks on a single stranded row, not just large accounts", () => {
    // user_sessions already orphans 1050001; user_favorite_games orphans
    // 150003 and 180002. Small residue is still residue.
    expect(describeDeletionBlock(1050001, { "login sessions": 1 })).not.toBeNull();
  });

  it("uses singular phrasing for one row", () => {
    expect(describeDeletionBlock(7, { "login sessions": 1 })).toContain("1 row reference");
  });
});

describe("APP_USER_DEPENDENT_TABLES", () => {
  it("covers every table that held an app_users id in production", () => {
    // Verified against information_schema on 2026-08-04. The guard is only as
    // complete as this list, so a new user-referencing table must be added here.
    const pairs = APP_USER_DEPENDENT_TABLES.map(d => `${d.table}.${d.column}`);
    for (const required of [
      "tracked_bets.userId",
      "bet_edit_requests.requestedBy",
      "bet_edit_requests.reviewedBy",
      "user_sessions.userId",
      "user_favorite_games.appUserId",
      "checkout_sessions.userId",
      "payment_events.userId",
      "entitlement_events.userId",
      "dime_chat_threads.userId",
      "discord_invite_tokens.createdBy",
      "discord_invite_tokens.targetUserId",
      "waitlist.reviewedBy",
    ]) {
      expect(pairs, `${required} not guarded`).toContain(required);
    }
  });

  it("has no duplicate table/column pairs", () => {
    const pairs = APP_USER_DEPENDENT_TABLES.map(d => `${d.table}.${d.column}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("gives every entry a human label for the refusal message", () => {
    for (const d of APP_USER_DEPENDENT_TABLES) {
      expect(d.label, `${d.table}.${d.column} needs a label`).toBeTruthy();
    }
  });
});

describe("AppUserHasDataError", () => {
  it("carries the userId and counts so callers can render them", () => {
    const counts = { "tracked bets": 278 };
    const err = new AppUserHasDataError(60002, counts, "blocked");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AppUserHasDataError");
    expect(err.userId).toBe(60002);
    expect(err.counts).toEqual(counts);
  });
});
