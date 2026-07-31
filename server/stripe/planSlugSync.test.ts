/**
 * planSlugSync.test.ts — slug derivation and collision resolution behind
 * syncPlanSlug.
 *
 * Pure logic only: no database, no Stripe. What is being defended here is an
 * FK-BY-VALUE relationship — `subscription_plans.slug` is copied verbatim into
 * `app_users.stripePlanId` and checkout resolves plans by it — so every slug
 * this code emits is an entitlement key. Two failure modes matter:
 *
 *   - Emitting a suffixed slug for a plan that did not actually change name
 *     (dime-pro → dime-pro-2 on every save) churns the key on the plan row while
 *     the referrers still hold the old one.
 *   - Emitting a slug another plan already owns collapses two plans onto one
 *     entitlement.
 */
import { describe, it, expect, vi } from "vitest";

// The module under test pulls in the Stripe SDK and the DB layer at import time.
// Neither is exercised here — stub them so the import stays side-effect free.
vi.mock("stripe", () => ({ default: vi.fn(() => ({})) }));
vi.mock("../db", () => ({ getDb: vi.fn(async () => null) }));
vi.mock("../dbCircuitBreaker", () => ({ withCircuitBreaker: vi.fn((fn: () => unknown) => fn()) }));
vi.mock("./planStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./planStore")>();
  return { ...actual, getPlanBySlug: vi.fn(async () => null), invalidatePlanCache: vi.fn() };
});

import { slugify, resolveUniqueSlug, readAffectedRows } from "./planProvisioning";

/**
 * The real production catalog at the time of writing: two plans were renamed in
 * the admin and kept the slug of the plan they were duplicated from.
 */
const CATALOG: ReadonlyArray<{ id: number; slug: string }> = [
  { id: 30001, slug: "dime-pro" },
  { id: 90001, slug: "dime-pro-copy" },
  { id: 90002, slug: "dime-pro-copy-2" },
];

/** A getPlanBySlug stand-in over a fixed catalog — no DB, no cache. */
function lookupOver(catalog: ReadonlyArray<{ id: number; slug: string }>) {
  return async (slug: string) => catalog.find((p) => p.slug === slug) ?? null;
}

describe("slugify — name → entitlement key", () => {
  it("kebab-cases a plain plan name", () => {
    expect(slugify("Dime Sharp")).toBe("dime-sharp");
    expect(slugify("Dime Max")).toBe("dime-max");
    expect(slugify("Dime Pro")).toBe("dime-pro");
  });

  it("collapses punctuation, emoji and repeated separators into single dashes", () => {
    expect(slugify("Dime Pro+ (2026)")).toBe("dime-pro-2026");
    expect(slugify("Dime — Sharp / Max")).toBe("dime-sharp-max");
    expect(slugify("Dime 🔥 Sharp")).toBe("dime-sharp");
    expect(slugify("Dime___Sharp")).toBe("dime-sharp");
  });

  it("trims surrounding and repeated whitespace rather than encoding it", () => {
    expect(slugify("   Dime   Sharp   ")).toBe("dime-sharp");
    expect(slugify("\tDime\nSharp ")).toBe("dime-sharp");
  });

  it("never returns an empty slug for a symbol-only or blank name", () => {
    // An empty slug would be written into app_users.stripePlanId as "" and match
    // no plan at all, so the fallback is load-bearing, not cosmetic.
    expect(slugify("")).toBe("plan");
    expect(slugify("   ")).toBe("plan");
    expect(slugify("!!!")).toBe("plan");
    expect(slugify("🔥🔥🔥")).toBe("plan");
    expect(slugify("---")).toBe("plan");
  });

  it("caps the slug at the 48-char column budget without a trailing dash", () => {
    const long = slugify("Dime " + "Very ".repeat(30) + "Long Plan");
    expect(long.length).toBeLessThanOrEqual(48);
    expect(long.endsWith("-")).toBe(false);
  });
});

describe("resolveUniqueSlug — self-collision is NOT a collision", () => {
  it("leaves a plan whose name still matches its own slug untouched", async () => {
    // THE BUG THIS PREVENTS: without the ownerPlanId rule, plan 30001 (name
    // "Dime Pro", slug "dime-pro") would see its own slug as taken and rename
    // itself to dime-pro-2 on every save — moving the entitlement key while
    // every app_users row still says "dime-pro".
    const slug = await resolveUniqueSlug("Dime Pro", lookupOver(CATALOG), 30001);
    expect(slug).toBe("dime-pro");
  });

  it("is stable across repeated saves — the same name always yields the same slug", async () => {
    const once = await resolveUniqueSlug("Dime Pro", lookupOver(CATALOG), 30001);
    const twice = await resolveUniqueSlug("Dime Pro", lookupOver(CATALOG), 30001);
    expect(once).toBe("dime-pro");
    expect(twice).toBe("dime-pro");
  });

  it("still suffixes when the holder is a DIFFERENT plan", async () => {
    // Plan 90001 renamed to "Dime Pro" cannot take 30001's key.
    const slug = await resolveUniqueSlug("Dime Pro", lookupOver(CATALOG), 90001);
    expect(slug).toBe("dime-pro-2");
  });
});

describe("resolveUniqueSlug — the stale production slugs", () => {
  it('renames plan 90001 "Dime Sharp" off dime-pro-copy', async () => {
    expect(await resolveUniqueSlug("Dime Sharp", lookupOver(CATALOG), 90001)).toBe("dime-sharp");
  });

  it('renames plan 90002 "Dime Max" off dime-pro-copy-2', async () => {
    expect(await resolveUniqueSlug("Dime Max", lookupOver(CATALOG), 90002)).toBe("dime-max");
  });
});

describe("resolveUniqueSlug — collision walk", () => {
  it("appends -2 when another plan already owns the base slug (create path)", async () => {
    // No ownerPlanId at all — the plan-creation path, where every existing slug
    // is a collision.
    expect(await resolveUniqueSlug("Dime Pro", lookupOver(CATALOG))).toBe("dime-pro-2");
  });

  it("walks past consecutively-taken suffixes", async () => {
    const crowded = [
      { id: 1, slug: "dime-sharp" },
      { id: 2, slug: "dime-sharp-2" },
      { id: 3, slug: "dime-sharp-3" },
    ];
    expect(await resolveUniqueSlug("Dime Sharp", lookupOver(crowded))).toBe("dime-sharp-4");
  });

  it("suffixes the fallback slug too, so two symbol-only names cannot collide", async () => {
    expect(await resolveUniqueSlug("!!!", lookupOver([{ id: 1, slug: "plan" }]))).toBe("plan-2");
  });

  it("does not collide two DIFFERENT plans onto one key", async () => {
    // Renaming 90001 to a name that slugifies to 90002's slug must not hand it
    // 90002's entitlement key.
    const slug = await resolveUniqueSlug("Dime Pro Copy 2", lookupOver(CATALOG), 90001);
    expect(slug).not.toBe("dime-pro-copy-2");
    expect(slug).toBe("dime-pro-copy-2-2");
  });

  it("falls back to a timestamped slug rather than looping forever", async () => {
    // Every candidate taken by some other plan: the walk must terminate.
    const everything = { find: () => ({ id: 999 }) };
    const alwaysTaken = async () => everything.find();
    const slug = await resolveUniqueSlug("Dime Sharp", alwaysTaken, 1);
    expect(slug).toMatch(/^dime-sharp-\d{13,}$/);
  });
});

describe("readAffectedRows — the referrer count reported by a rename", () => {
  it("reads mysql2's ResultSetHeader out of Drizzle's raw tuple", () => {
    expect(readAffectedRows([{ affectedRows: 7 }, []])).toBe(7);
  });

  it("reads a bare header too", () => {
    expect(readAffectedRows({ affectedRows: 0 })).toBe(0);
  });

  it("returns null (not 0) when the driver reports nothing", () => {
    // null means "unknown, fall back to the pre-counted value" — reporting 0
    // would claim no referrers moved when they may well have.
    expect(readAffectedRows(undefined)).toBeNull();
    expect(readAffectedRows(null)).toBeNull();
    expect(readAffectedRows({})).toBeNull();
    expect(readAffectedRows([])).toBeNull();
    expect(readAffectedRows({ affectedRows: "7" })).toBeNull();
  });
});
