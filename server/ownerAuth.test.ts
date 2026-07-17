import { describe, expect, it } from "vitest";
import type { AppUser } from "../drizzle/schema";
import { OWNER_FALLBACK_MAX_AGE_MS, resolveOwnerIdentity } from "./ownerAuth";

function user(overrides: Partial<AppUser> = {}): AppUser {
  return {
    id: 7,
    email: "owner@test.invalid",
    username: "owner",
    passwordHash: "not-used",
    role: "owner",
    hasAccess: true,
    expiryDate: null,
    termsAccepted: true,
    termsAcceptedAt: null,
    tokenVersion: 3,
    discordId: null,
    discordUsername: null,
    discordAvatar: null,
    discordConnectedAt: null,
    manualDiscordId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastSignedIn: null,
    passwordResetToken: null,
    passwordResetExpiresAt: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripeSubscriptionStatus: null,
    pendingSetup: false,
    ...overrides,
  };
}

describe("resolveOwnerIdentity", () => {
  it("uses a recent last-known-good owner during a database outage", () => {
    const now = 100_000;
    const result = resolveOwnerIdentity({
      lookup: { status: "unavailable", error: new Error("offline") },
      fallback: { user: user(), cachedAt: now - 1_000 },
      tokenVersion: 3,
      now,
    });
    expect(result).toMatchObject({ ok: true, source: "fallback" });
  });

  it("never falls back after an authoritative deletion", () => {
    const result = resolveOwnerIdentity({
      lookup: { status: "not_found" },
      fallback: { user: user(), cachedAt: 99_000 },
      tokenVersion: 3,
      now: 100_000,
    });
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects a fresh database row after owner demotion", () => {
    const result = resolveOwnerIdentity({
      lookup: { status: "found", user: user({ role: "admin" }) },
      fallback: { user: user(), cachedAt: 99_000 },
      tokenVersion: 3,
      now: 100_000,
    });
    expect(result).toEqual({ ok: false, reason: "not_owner" });
  });

  it("rejects a tokenVersion mismatch for both fresh and fallback rows", () => {
    const fresh = resolveOwnerIdentity({
      lookup: { status: "found", user: user({ tokenVersion: 4 }) },
      fallback: null,
      tokenVersion: 3,
    });
    const fallback = resolveOwnerIdentity({
      lookup: { status: "unavailable", error: new Error("offline") },
      fallback: { user: user({ tokenVersion: 4 }), cachedAt: 99_000 },
      tokenVersion: 3,
      now: 100_000,
    });
    expect(fresh).toEqual({ ok: false, reason: "token_version_mismatch" });
    expect(fallback).toEqual({ ok: false, reason: "token_version_mismatch" });
  });

  it("rejects stale outage fallback rows", () => {
    const now = 100_000;
    const result = resolveOwnerIdentity({
      lookup: { status: "unavailable", error: new Error("offline") },
      fallback: { user: user(), cachedAt: now - OWNER_FALLBACK_MAX_AGE_MS - 1 },
      tokenVersion: 3,
      now,
    });
    expect(result).toEqual({ ok: false, reason: "fallback_stale" });
  });
});
