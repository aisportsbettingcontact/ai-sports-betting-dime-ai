/**
 * server/adminAccountProvisioning.test.ts
 *
 * Pure-logic tests for the Create Account v2 helpers, plus source-contract
 * tests that the createUser mutation actually wires them (a derivation helper
 * whose result never reaches the INSERT is the exact class of bug
 * entitlementAssignment.test.ts exists to catch — same convention here).
 */
import { describe, it, expect } from "vitest";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  CLAIM_LINK_TTL_MS,
  buildClaimUrl,
  deriveEntitlementFromPrice,
  findPriceByNumericId,
  mintClaimToken,
  resolveCreationPassword,
} from "./adminAccountProvisioning";
import {
  LIFETIME_ACCESS_UNTIL_MS,
  type StoredPlan,
  type StoredPrice,
} from "./stripe/planStore";

const NOW = Date.UTC(2026, 7, 3); // 2026-08-03T00:00:00Z
const DAY = 24 * 60 * 60 * 1000;

function price(over: Partial<StoredPrice>): StoredPrice {
  return {
    id: 1,
    stripePriceId: "price_x",
    label: null,
    amountCents: 9999,
    currency: "usd",
    interval: "month",
    intervalCount: 1,
    trialPeriodDays: null,
    promoType: null,
    promoValue: null,
    promoCode: null,
    stripeCouponId: null,
    active: true,
    isDefault: false,
    hidden: false,
    sortOrder: 0,
    livemode: true,
    ...over,
  };
}

function plan(over: Partial<StoredPlan>): StoredPlan {
  return {
    id: 1,
    slug: "dime-sharp",
    name: "Dime Sharp",
    description: null,
    planType: "recurring",
    stripeProductId: null,
    active: true,
    accessUntil: null,
    maxSubscribers: null,
    autoRestock: false,
    availableQuantity: null,
    restockThreshold: null,
    restockAmount: null,
    discordRoleId: null,
    telegramChatId: null,
    livemode: true,
    features: [],
    prices: [],
    ...over,
  };
}

/** Mirror of the live catalog's Sharp plan: month + year + lifetime SKUs. */
const CATALOG: StoredPlan[] = [
  plan({
    id: 90001,
    slug: "dime-sharp",
    prices: [
      price({ id: 120003, interval: "month", amountCents: 9999 }),
      price({ id: 120004, interval: "year", amountCents: 49999 }),
      price({
        id: 120005,
        interval: null,
        intervalCount: null,
        amountCents: 99999,
      }),
      price({ id: 120099, interval: "week", active: false }),
    ],
  }),
  plan({
    id: 90002,
    slug: "dime-max",
    active: false,
    prices: [price({ id: 120010, interval: null })],
  }),
];

describe("findPriceByNumericId", () => {
  it("locates a price by numeric plan_prices.id across plans", () => {
    const found = findPriceByNumericId(CATALOG, 120005);
    expect(found?.plan.slug).toBe("dime-sharp");
    expect(found?.price.interval).toBeNull();
  });
  it("returns null for an unknown id", () => {
    expect(findPriceByNumericId(CATALOG, 999999)).toBeNull();
  });
});

describe("deriveEntitlementFromPrice", () => {
  it("derives slug + exact 30-day expiry for a monthly SKU (webhook parity)", () => {
    const r = deriveEntitlementFromPrice(CATALOG, 120003, NOW);
    expect(r).toEqual({
      ok: true,
      entitlement: {
        stripePlanId: "dime-sharp",
        planPriceId: 120003,
        expiryDate: NOW + 30 * DAY,
      },
    });
  });

  it("derives exact 365-day expiry for a yearly SKU", () => {
    const r = deriveEntitlementFromPrice(CATALOG, 120004, NOW);
    expect(r.ok && r.entitlement.expiryDate).toBe(NOW + 365 * DAY);
  });

  it("maps the lifetime sentinel to NULL expiry — the schema's lifetime encoding", () => {
    const r = deriveEntitlementFromPrice(CATALOG, 120005, NOW);
    expect(r).toEqual({
      ok: true,
      entitlement: {
        stripePlanId: "dime-sharp",
        planPriceId: 120005,
        expiryDate: null,
      },
    });
  });

  it("keeps a real accessUntil for fixed_date plans (only the 2100 sentinel maps to NULL)", () => {
    const until = NOW + 90 * DAY;
    const fixed = [
      plan({
        id: 5,
        slug: "season-pass",
        planType: "fixed_date",
        accessUntil: until,
        prices: [price({ id: 7, interval: null })],
      }),
    ];
    const r = deriveEntitlementFromPrice(fixed, 7, NOW);
    expect(r.ok && r.entitlement.expiryDate).toBe(until);
  });

  it("rejects an unknown planPriceId", () => {
    const r = deriveEntitlementFromPrice(CATALOG, 424242, NOW);
    expect(r.ok).toBe(false);
  });

  it("rejects an inactive price and an inactive plan", () => {
    expect(deriveEntitlementFromPrice(CATALOG, 120099, NOW).ok).toBe(false);
    expect(deriveEntitlementFromPrice(CATALOG, 120010, NOW).ok).toBe(false);
  });

  it("LIFETIME_ACCESS_UNTIL_MS sanity — sentinel is the far-future constant, not near-term", () => {
    expect(LIFETIME_ACCESS_UNTIL_MS).toBeGreaterThan(Date.UTC(2099, 0, 1));
  });
});

describe("mintClaimToken", () => {
  it("mints a 22-char base64url token (128-bit CSPRNG) whose sha256 is what gets stored, 7-day TTL", () => {
    const t = mintClaimToken(NOW);
    expect(t.rawToken).toMatch(/^[0-9a-zA-Z_-]{22}$/);
    expect(t.tokenHash).toBe(
      crypto.createHash("sha256").update(t.rawToken).digest("hex")
    );
    expect(t.expiresAt).toBe(NOW + CLAIM_LINK_TTL_MS);
    expect(CLAIM_LINK_TTL_MS).toBe(7 * DAY);
  });

  it("never repeats tokens", () => {
    expect(mintClaimToken(NOW).rawToken).not.toBe(mintClaimToken(NOW).rawToken);
  });
});

describe("buildClaimUrl", () => {
  it("builds the compact /invite/<base36 uid>.<token> form (codec in shared/inviteCode.ts)", () => {
    expect(
      buildClaimUrl(
        "https://aisportsbettingmodels.com/",
        1650001,
        "invite_token_fixture-0"
      )
    ).toBe(
      "https://aisportsbettingmodels.com/invite/zd5d.invite_token_fixture-0"
    );
  });

  it("stays parseable by the client codec end-to-end", async () => {
    const { parseInviteCode } = await import("../shared/inviteCode");
    const t = mintClaimToken(NOW);
    const url = new URL(
      buildClaimUrl("https://aisportsbettingmodels.com", 1680001, t.rawToken)
    );
    const code = url.pathname.replace("/invite/", "");
    expect(parseInviteCode(code)).toEqual({ uid: 1680001, token: t.rawToken });
  });
});

describe("resolveCreationPassword", () => {
  it("owner-typed password wins", () => {
    const r = resolveCreationPassword({
      password: "hunter2hunter2",
      generateClaimLink: true,
    });
    expect(r).toEqual({
      ok: true,
      password: "hunter2hunter2",
      generated: false,
    });
  });
  it("short typed password is rejected, not silently replaced", () => {
    expect(
      resolveCreationPassword({ password: "short", generateClaimLink: true }).ok
    ).toBe(false);
  });
  it("no password + claim link mints a strong throwaway", () => {
    const r = resolveCreationPassword({
      password: "",
      generateClaimLink: true,
    });
    expect(r.ok && r.generated).toBe(true);
    expect(r.ok && r.password.length).toBeGreaterThanOrEqual(24);
  });
  it("no password + no claim link is a hard error", () => {
    expect(
      resolveCreationPassword({ password: null, generateClaimLink: false }).ok
    ).toBe(false);
  });
});

// ─── Source contracts: the mutation actually uses the helpers ────────────────

describe("createUser wiring (source contract)", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "routers", "appUsers.ts"),
    "utf8"
  );
  const createUserBlock = src.slice(
    src.indexOf("createUser: ownerProcedure"),
    src.indexOf("backfillEntitlement:")
  );

  it("derives entitlement from planPriceId via deriveEntitlementFromPrice", () => {
    expect(createUserBlock).toContain("deriveEntitlementFromPrice(");
  });
  it("resolves the password through resolveCreationPassword (claim-link-aware)", () => {
    expect(createUserBlock).toContain("resolveCreationPassword(");
  });
  it("stores only the claim token HASH in the reset columns", () => {
    expect(createUserBlock).toContain("mintClaimToken(");
    expect(createUserBlock).toContain("passwordResetToken: claim.tokenHash");
    expect(createUserBlock).toContain(
      "passwordResetExpiresAt: claim.expiresAt"
    );
  });
  it("returns the claim URL and the new userId to the client", () => {
    expect(createUserBlock).toContain("claimUrl");
    expect(createUserBlock).toContain("userId: createdUser");
  });
});
