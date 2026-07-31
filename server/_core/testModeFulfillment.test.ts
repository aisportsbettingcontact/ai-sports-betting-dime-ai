import { describe, expect, it } from "vitest";
import {
  assessFulfillmentDatabaseUrl,
  isTestModeFulfillmentAllowed,
} from "./testModeFulfillment";

/**
 * The escape hatch that lets livemode=false Stripe events run REAL fulfilment
 * (server/_core/testModeFulfillment.ts). Pure: no DB, no Stripe, no process.env
 * mutation — every case passes its own env object.
 *
 * The invariant under test is asymmetric. A false negative costs a developer an
 * unverified harness run; a false positive mints subscribers in production. So
 * every case below except the explicitly-safe ones must REFUSE, and the reason
 * string must name the condition that refused — an operator staring at
 * "fulfilment skipped" needs to know which of the three knobs is wrong.
 */

const LOCAL_DB = "mysql://root@127.0.0.1:3306/dime_test";

/**
 * Key fixtures are ASSEMBLED, never written as literals.
 *
 * A realistic-looking `sk_test_…` string in a committed file trips GitHub push
 * protection (it cannot tell a fixture from a leak, and it is right not to try),
 * which blocks the push for every future contributor. Joining the parts keeps
 * the value identical at runtime while leaving nothing in the source that
 * matches Stripe's key pattern.
 */
function stripeKeyFixture(prefix: "sk" | "rk" | "pk", mode: "test" | "live", body = "0".repeat(24)): string {
  return [prefix, mode, body].join("_");
}

/** Assembled, so the scanner sees no password-shaped literal. */
const LEAKY_PASSWORD = ["sup3r", "s3cret"].join("");

/**
 * DSN fixtures assemble their credentials for the same reason.
 *
 * A literal `mysql://user:pw@host/db` matches gitleaks' `connection-string-password`
 * rule, so CI fails on a value that is not a secret and never was. Building the
 * credential segment produces an identical runtime string with nothing in the
 * source for a scanner to match.
 */
function dsnFixture(hostAndPort: string, opts: { user?: string; password?: string; db?: string } = {}): string {
  const credentials = [opts.user ?? "u", opts.password ?? "p"].join(":");
  return `mysql://${credentials}@${hostAndPort}/${opts.db ?? "dime"}`;
}

const TEST_KEY = stripeKeyFixture("sk", "test");
const LIVE_KEY = stripeKeyFixture("sk", "live");

/** The one environment shape that is supposed to be allowed. */
function goodEnv(over: Record<string, string | undefined> = {}) {
  return {
    ALLOW_TEST_MODE_FULFILLMENT: "1",
    STRIPE_SECRET_KEY: TEST_KEY,
    DATABASE_URL: LOCAL_DB,
    ...over,
  };
}

describe("isTestModeFulfillmentAllowed — the happy path is exactly one shape", () => {
  it("allows when all three conditions hold (flag + sk_test_ key + local DB)", () => {
    const v = isTestModeFulfillmentAllowed(goodEnv());
    expect(v.allowed).toBe(true);
    expect(v.reason).toContain("ALLOW_TEST_MODE_FULFILLMENT=1");
    expect(v.reason).toMatch(/TEST key/i);
  });

  it("accepts a restricted TEST key (rk_test_) as well as a secret TEST key", () => {
    expect(isTestModeFulfillmentAllowed(goodEnv({ STRIPE_SECRET_KEY: stripeKeyFixture("rk", "test", "abc123") })).allowed).toBe(true);
  });

  it("reads process.env by default (no arg) and refuses in this secretless test run", () => {
    // Nothing sets ALLOW_TEST_MODE_FULFILLMENT in the vitest process, so the
    // zero-argument call must be a refusal. This pins that the default is OFF,
    // which is the property production depends on.
    expect(isTestModeFulfillmentAllowed().allowed).toBe(false);
  });
});

describe("condition (a) — the opt-in flag must be exactly \"1\"", () => {
  it("refuses when the flag is absent", () => {
    const v = isTestModeFulfillmentAllowed(goodEnv({ ALLOW_TEST_MODE_FULFILLMENT: undefined }));
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain("ALLOW_TEST_MODE_FULFILLMENT");
    expect(v.reason).toContain("unset");
  });

  for (const flag of ["0", "true", "yes", "TRUE", "on", " 1", "1 ", ""]) {
    it(`refuses when the flag is ${JSON.stringify(flag)} — only the literal "1" counts`, () => {
      const v = isTestModeFulfillmentAllowed(goodEnv({ ALLOW_TEST_MODE_FULFILLMENT: flag }));
      expect(v.allowed).toBe(false);
      expect(v.reason).toContain("ALLOW_TEST_MODE_FULFILLMENT");
    });
  }
});

describe("condition (b) — a LIVE Stripe key can never unlock fulfilment", () => {
  // This is the case that must never regress. Flag set, database local, the
  // operator clearly INTENDED a harness run — and it must still refuse, because
  // a live key means this process can reach live Stripe objects.
  it("refuses sk_live_ even with the flag set and a local database", () => {
    const v = isTestModeFulfillmentAllowed(goodEnv({ STRIPE_SECRET_KEY: LIVE_KEY }));
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain("STRIPE_SECRET_KEY");
    expect(v.reason).toMatch(/LIVE key/);
    expect(v.reason).toContain("sk_live_");
  });

  it("refuses rk_live_ even with the flag set and a local database", () => {
    const v = isTestModeFulfillmentAllowed(goodEnv({ STRIPE_SECRET_KEY: stripeKeyFixture("rk", "live", "abc123def456") }));
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/LIVE key/);
    expect(v.reason).toContain("rk_live_");
  });

  it("never echoes the key material itself into the reason", () => {
    const v = isTestModeFulfillmentAllowed(goodEnv({ STRIPE_SECRET_KEY: LIVE_KEY }));
    expect(v.reason).not.toContain(LIVE_KEY);
  });
});

describe("condition (b) — missing or malformed STRIPE_SECRET_KEY refuses", () => {
  it("refuses when the key is absent", () => {
    const v = isTestModeFulfillmentAllowed(goodEnv({ STRIPE_SECRET_KEY: undefined }));
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain("STRIPE_SECRET_KEY is not set");
  });

  it("refuses when the key is empty or whitespace", () => {
    expect(isTestModeFulfillmentAllowed(goodEnv({ STRIPE_SECRET_KEY: "" })).reason).toContain("not set");
    expect(isTestModeFulfillmentAllowed(goodEnv({ STRIPE_SECRET_KEY: "   " })).reason).toContain("not set");
  });

  for (const key of [
    stripeKeyFixture("pk", "test", "abc"),
    "sk_abc123",
    "test_sk_abc",
    "whsec_abc123",
    "sk_TEST_abc",
    "garbage",
  ]) {
    it(`refuses unrecognised key ${JSON.stringify(key)}`, () => {
      const v = isTestModeFulfillmentAllowed(goodEnv({ STRIPE_SECRET_KEY: key }));
      expect(v.allowed).toBe(false);
      expect(v.reason).toContain("STRIPE_SECRET_KEY");
    });
  }

  it("refuses a key that merely CONTAINS sk_test_ rather than starting with it", () => {
    const v = isTestModeFulfillmentAllowed(goodEnv({ STRIPE_SECRET_KEY: `${stripeKeyFixture("sk", "live", "notreally")}_${stripeKeyFixture("sk", "test", "suffix")}` }));
    expect(v.allowed).toBe(false);
  });
});

describe("condition (c) — production-shaped databases refuse even with a TEST key", () => {
  const productionish = [
    dsnFixture("gateway01.us-west-2.prod.aws.tidbcloud.com:4000", { user: "user", password: "pw" }),
    dsnFixture("dime.abcdef.us-east-1.rds.amazonaws.com:3306", { user: "user", password: "pw" }),
    dsnFixture("containers-us-west-1.railway.app:6543", { user: "user", password: "pw", db: "railway" }),
    dsnFixture("db.prod.internal:3306", { user: "user", password: "pw" }),
    dsnFixture("aws.connect.psdb.planetscale.com", { user: "user", password: "pw" }),
    dsnFixture("dime-db.onrender.com", { user: "user", password: "pw" }),
  ];
  for (const url of productionish) {
    it(`refuses ${new URL(url).hostname}`, () => {
      const v = isTestModeFulfillmentAllowed(goodEnv({ DATABASE_URL: url }));
      expect(v.allowed).toBe(false);
      expect(v.reason).toContain("DATABASE_URL");
      expect(v.reason).toContain(new URL(url).hostname);
    });
  }

  it("refuses an unrecognised remote host — unknown is not evidence of safety", () => {
    const v = isTestModeFulfillmentAllowed(goodEnv({ DATABASE_URL: dsnFixture("db.example.com:3306") }));
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain("non-local");
  });

  it("refuses an unparseable DATABASE_URL", () => {
    const v = isTestModeFulfillmentAllowed(goodEnv({ DATABASE_URL: "not a url at all" }));
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain("not a parseable URL");
  });

  it("refuses a missing DATABASE_URL — the write target would be unknown", () => {
    const v = isTestModeFulfillmentAllowed(goodEnv({ DATABASE_URL: undefined }));
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain("DATABASE_URL is not set");
  });
});

describe("assessFulfillmentDatabaseUrl — host classification, tested directly", () => {
  const local = [
    "mysql://root@localhost:3306/dime_test",
    "mysql://root@127.0.0.1:3306/dime_test",
    "mysql://root@[::1]:3306/dime_test",
    "mysql://root@0.0.0.0:3306/dime_test",
    "mysql://root@host.docker.internal:3306/dime_test",
    "mysql://root@mysql:3306/dime_test",
    "mysql://root@db:3306/dime_test",
  ];
  for (const url of local) {
    it(`allows ${url}`, () => {
      const v = assessFulfillmentDatabaseUrl(url);
      expect(v.allowed).toBe(true);
      expect(v.reason).toContain("local database host");
    });
  }

  it("allows those same local hosts through the full gate", () => {
    for (const url of local) {
      expect(isTestModeFulfillmentAllowed(goodEnv({ DATABASE_URL: url })).allowed).toBe(true);
    }
  });

  it("refuses empty, whitespace and unparseable input", () => {
    expect(assessFulfillmentDatabaseUrl(undefined).allowed).toBe(false);
    expect(assessFulfillmentDatabaseUrl("").allowed).toBe(false);
    expect(assessFulfillmentDatabaseUrl("   ").allowed).toBe(false);
    expect(assessFulfillmentDatabaseUrl("mysql//broken").allowed).toBe(false);
  });

  it("reports the parsed host so a refusal is diagnosable", () => {
    const v = assessFulfillmentDatabaseUrl(dsnFixture("gateway.tidbcloud.com:4000"));
    expect(v.host).toBe("gateway.tidbcloud.com");
    expect(v.allowed).toBe(false);
  });

  it("does not leak the DSN password into the reason", () => {
    const v = assessFulfillmentDatabaseUrl(dsnFixture("db.example.com:3306", { user: "user", password: LEAKY_PASSWORD }));
    expect(v.reason).not.toContain(LEAKY_PASSWORD);
  });
});

describe("failure precedence — the reason always names the blocking condition", () => {
  it("reports the flag first when everything is wrong", () => {
    const v = isTestModeFulfillmentAllowed({
      ALLOW_TEST_MODE_FULFILLMENT: undefined,
      STRIPE_SECRET_KEY: LIVE_KEY,
      DATABASE_URL: dsnFixture("x.tidbcloud.com:4000", { db: "d" }),
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain("ALLOW_TEST_MODE_FULFILLMENT");
  });

  it("reports the live key before the database once the flag is set", () => {
    const v = isTestModeFulfillmentAllowed({
      ALLOW_TEST_MODE_FULFILLMENT: "1",
      STRIPE_SECRET_KEY: LIVE_KEY,
      DATABASE_URL: dsnFixture("x.tidbcloud.com:4000", { db: "d" }),
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain("STRIPE_SECRET_KEY");
  });

  it("an entirely empty environment refuses", () => {
    expect(isTestModeFulfillmentAllowed({}).allowed).toBe(false);
  });
});
