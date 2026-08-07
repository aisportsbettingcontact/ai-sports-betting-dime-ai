/**
 * edge-soak-report.test.ts — tests for the EDGE_MODE arming gate.
 *
 * These tests drive the REAL verdict function (`evaluateSoak`) from
 * scripts/edge-soak-report.mjs with fixture event streams. Nothing about the
 * verdict is stubbed: there is no mock that returns a canned PASS/FAIL, and no
 * seam through which a test can move a threshold. The only injected values are
 * the event rows and the environment the known-source allowlist is read from.
 *
 * The load-bearing case is `the 2026-08-06 regression`: the exact evidence that
 * was accepted as arming proof (18 requests through Cloudflare + 5 direct, over
 * a few minutes) must produce FAIL.
 */

import { describe, expect, it, vi } from "vitest";

// ─── Mocks, for the securityDigest.ts PARITY test only ───────────────────────
// scripts/edge-soak-report.mjs itself imports none of this. server/securityDigest.ts
// pulls in the DB layer and discord.js at import time; the parity test needs only
// its two pure exports, so the heavy edges are replaced with inert doubles. Mirrors
// the mock block in server/securityDigest.test.ts.
vi.mock("../server/db", () => ({
  getSecurityEventCountsByBucket: vi.fn(),
  getSecurityEvents: vi.fn(),
  pruneSecurityEvents: vi.fn(),
  insertSecurityEvent: vi.fn(),
  DIGEST_MARKER_DAILY_EVENT_TYPE: "DIGEST_MARKER_DAILY",
  DIGEST_MARKER_WEEKLY_EVENT_TYPE: "DIGEST_MARKER_WEEKLY",
}));
vi.mock("../server/_core/notification", () => ({ notifyOwner: vi.fn() }));
vi.mock("../server/discord/bot", () => ({ getDiscordClient: vi.fn() }));
vi.mock("discord.js", () => {
  class MockEmbedBuilder {}
  class MockTextChannel {}
  return { EmbedBuilder: MockEmbedBuilder, TextChannel: MockTextChannel };
});

// @ts-expect-error — plain .mjs module without type declarations
import {
  DEFAULT_KNOWN_SOURCES,
  MAX_REAL_SHARE_PER_SOURCE,
  MIN_DISTINCT_REAL_SOURCES,
  MIN_REAL_REQUESTS,
  MIN_SOAK_MINUTES,
  REQUIRED_EDGE_MODE,
  SOURCE_CLASS,
  buildKnownSources,
  classifySource,
  evaluateSoak,
  main,
  matchesIpOrCidr,
  renderHumanSummary,
} from "./edge-soak-report.mjs";
import {
  classifyIp,
  getOwnerConfiguredAllowlist,
} from "../server/securityDigest";
import { isCloudflareEdgeIp } from "../server/_core/edgeProxy";

// ─── Fixture types (explicit fields: tsconfig excludes *.test.ts from tsc, so
// a missing field would read as `undefined` instead of failing the typecheck) ──

interface SoakRow {
  ip: string | null;
  occurredAt: number;
  edgeVerdict?: string;
  eventType?: string;
  context?: string;
  originLockKind?: string;
}

interface SoakInput {
  edgeMode: string | null;
  windowStartMs?: number;
  windowEndMs?: number;
  requests: SoakRow[];
  errors?: string[];
  label?: string;
}

interface SoakCondition {
  id: string;
  description: string;
  required: number | string;
  actual: number | string;
  pass: boolean;
}

interface SoakReport {
  verdict: "PASS" | "FAIL";
  gate: string;
  label: string | null;
  edgeMode: string | null;
  window: {
    declaredStartMs: number | null;
    declaredEndMs: number | null;
    declaredMinutes: number | null;
    observedMinutes: number;
    effectiveMinutes: number;
    requiredMinutes: number;
  };
  totals: {
    requests: number;
    classifiedRequests: number;
    malformedRows: number;
    realRequests: number;
    distinctSources: number;
    distinctRealSources: number;
    requiredDistinctRealSources: number;
    topRealSourceRequests: number;
    maxRequestsPerRealSource: number;
    wouldDenyTotal: number;
    wouldDenyExcluded: number;
    wouldDenyFromRealSources: number;
  };
  byClass: Record<
    string,
    { requests: number; wouldDeny: number; distinctSources: number }
  >;
  exclusionStatement: string;
  unclassifiableReasons: Array<{ reason: string; count: number }>;
  offendingSources: Array<{ ip: string; wouldDeny: number }>;
  conditions: SoakCondition[];
  failedConditions: string[];
  dataErrors: string[];
  dataErrorCount: number;
}

/** An environment with no allowlist env vars set, so tests are deterministic. */
const EMPTY_ENV: Record<string, string | undefined> = {};

const evaluate = (input: SoakInput, env = EMPTY_ENV): SoakReport =>
  evaluateSoak(input, { env }) as SoakReport;

const START = 1_754_400_000_000; // fixed epoch ms; nothing here reads the clock
const MIN = 60_000;

/**
 * `count` real-user requests spread evenly across `spanMinutes`, from a pool of
 * distinct client IPs in TEST-NET-3 (203.0.113.0/24, RFC 5737).
 */
function realTraffic(
  count: number,
  spanMinutes: number,
  startMs = START
): SoakRow[] {
  const rows: SoakRow[] = [];
  const step = count > 1 ? (spanMinutes * MIN) / (count - 1) : 0;
  for (let i = 0; i < count; i++) {
    rows.push({
      ip: `203.0.113.${(i % 200) + 1}`,
      occurredAt: Math.round(startMs + i * step),
      edgeVerdict: "allow",
    });
  }
  return rows;
}

/**
 * `count` real-user requests spread evenly across `spanMinutes`, drawn from
 * exactly `sources` distinct client IPs. Used to drive the distinct-real-source
 * floor at its boundary in both directions.
 */
function realTrafficFromSources(
  count: number,
  sources: number,
  spanMinutes: number,
  startMs = START
): SoakRow[] {
  const rows: SoakRow[] = [];
  const step = count > 1 ? (spanMinutes * MIN) / (count - 1) : 0;
  for (let i = 0; i < count; i++) {
    rows.push({
      ip: `203.0.113.${(i % sources) + 1}`,
      occurredAt: Math.round(startMs + i * step),
      edgeVerdict: "allow",
    });
  }
  return rows;
}

function row(
  ip: string | null,
  offsetMinutes: number,
  edgeVerdict: string,
  startMs = START
): SoakRow {
  return {
    ip,
    occurredAt: startMs + Math.round(offsetMinutes * MIN),
    edgeVerdict,
  };
}

/**
 * The clean baseline: 75 minutes, 520 real requests, `log` mode, plus the CI and
 * operator noise a real soak always contains. Every test below perturbs exactly
 * one thing about this so a FAIL can only come from the perturbation.
 */
function cleanSoak(): SoakInput {
  return {
    edgeMode: "log",
    windowStartMs: START,
    windowEndMs: START + 75 * MIN,
    label: "baseline",
    requests: [
      ...realTraffic(520, 75),
      // CI runners hitting the raw origin — the noise that was present during the
      // real 2026-08-06 soak and is legitimately excluded.
      row("40.81.6.244", 5, "would_deny"),
      row("172.182.201.162", 12, "would_deny"),
      row("48.217.34.226", 40, "would_deny"),
      // The operator's own curl probe.
      row("47.152.160.175", 22, "would_deny"),
    ],
    errors: [],
  };
}

// ─── The clean PASS case ─────────────────────────────────────────────────────

describe("edge-soak-report — the clean PASS case", () => {
  it("PASSes on 75 minutes / 520 real requests / zero real-source would-denies", () => {
    const report = evaluate(cleanSoak());
    expect(report.failedConditions).toEqual([]);
    expect(report.verdict).toBe("PASS");
  });

  it("excludes CI and operator would-denies from the pass condition, and says so", () => {
    const report = evaluate(cleanSoak());
    expect(report.totals.wouldDenyTotal).toBe(4);
    expect(report.totals.wouldDenyExcluded).toBe(4);
    expect(report.totals.wouldDenyFromRealSources).toBe(0);
    expect(report.byClass[SOURCE_CLASS.CI].wouldDeny).toBe(3);
    expect(report.byClass[SOURCE_CLASS.OPERATOR].wouldDeny).toBe(1);
    expect(report.exclusionStatement).toContain(
      "CI/operator sources were EXCLUDED"
    );
    expect(report.exclusionStatement).toContain("3 CI source(s)");
    expect(report.exclusionStatement).toContain("1 operator source(s)");
  });

  it("reports the total request count, the distinct-source count and the per-class breakdown", () => {
    const report = evaluate(cleanSoak());
    expect(report.totals.requests).toBe(524);
    expect(report.totals.realRequests).toBe(520);
    // 200 real client IPs + 3 CI runners + 1 operator IP.
    expect(report.totals.distinctSources).toBe(204);
    expect(report.byClass[SOURCE_CLASS.UNKNOWN].distinctSources).toBe(200);
    expect(report.byClass[SOURCE_CLASS.CI].distinctSources).toBe(3);
    expect(report.byClass[SOURCE_CLASS.OPERATOR].distinctSources).toBe(1);
    expect(report.byClass[SOURCE_CLASS.UNCLASSIFIABLE].requests).toBe(0);
  });

  it("the human summary carries every mandated field, and the JSON is serializable", () => {
    const report = evaluate(cleanSoak());
    const text = renderHumanSummary(report) as string;
    expect(text).toContain("VERDICT: PASS");
    expect(text).toContain("Total requests observed    : 524");
    expect(text).toContain("Distinct sources           : 204");
    expect(text).toContain("Per-class breakdown:");
    expect(text).toContain("CI/operator sources were EXCLUDED");
    // Machine-readable output must survive a round trip unchanged.
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
});

// ─── The mandated FAIL cases ─────────────────────────────────────────────────

describe("edge-soak-report — FAIL: one would-deny from a non-CI, non-operator source", () => {
  it("fails the gate on a SINGLE real-user would-deny in an otherwise clean soak", () => {
    const input = cleanSoak();
    input.requests.push(row("198.51.100.77", 30, "would_deny"));
    const report = evaluate(input);
    expect(report.verdict).toBe("FAIL");
    // Only this condition fails — proof the FAIL comes from the would-deny and
    // not from a fixture that was broken in some other way.
    expect(report.failedConditions).toEqual([
      "would_deny_from_real_sources_zero",
    ]);
    expect(report.totals.wouldDenyFromRealSources).toBe(1);
    expect(report.offendingSources).toEqual([
      { ip: "198.51.100.77", wouldDeny: 1 },
    ]);
  });

  it("counts an `edge_deny` the same as an `edge_would_deny` (both are refusals)", () => {
    const input = cleanSoak();
    input.requests.push(row("198.51.100.78", 31, "deny"));
    expect(evaluate(input).failedConditions).toContain(
      "would_deny_from_real_sources_zero"
    );
  });

  it("derives would-deny from a raw security_events row (eventType + context)", () => {
    const input = cleanSoak();
    input.requests.push({
      ip: "198.51.100.79",
      occurredAt: START + 33 * MIN,
      eventType: "RATE_LIMIT",
      context: "edge_origin_ingress_anomaly",
    });
    const report = evaluate(input);
    expect(report.totals.wouldDenyFromRealSources).toBe(1);
    expect(report.failedConditions).toEqual([
      "would_deny_from_real_sources_zero",
    ]);
  });
});

describe("edge-soak-report — FAIL: too few requests", () => {
  it(`fails at ${MIN_REAL_REQUESTS - 1} real requests and passes at ${MIN_REAL_REQUESTS}`, () => {
    const short: SoakInput = {
      edgeMode: "log",
      windowStartMs: START,
      windowEndMs: START + 75 * MIN,
      requests: realTraffic(MIN_REAL_REQUESTS - 1, 75),
      errors: [],
    };
    const failing = evaluate(short);
    expect(failing.verdict).toBe("FAIL");
    expect(failing.failedConditions).toEqual(["real_requests"]);
    expect(failing.totals.realRequests).toBe(MIN_REAL_REQUESTS - 1);

    const atThreshold: SoakInput = {
      ...short,
      requests: realTraffic(MIN_REAL_REQUESTS, 75),
    };
    expect(evaluate(atThreshold).verdict).toBe("PASS");
  });

  it("CI and operator volume cannot substitute for real traffic", () => {
    const ciFlood: SoakRow[] = [];
    for (let i = 0; i < 5000; i++) {
      ciFlood.push(row("40.81.6.244", (i / 5000) * 75, "allow"));
    }
    const input: SoakInput = {
      edgeMode: "log",
      windowStartMs: START,
      windowEndMs: START + 75 * MIN,
      requests: [...ciFlood, ...realTraffic(10, 75)],
      errors: [],
    };
    const report = evaluate(input);
    expect(report.totals.requests).toBe(5010);
    expect(report.totals.realRequests).toBe(10);
    expect(report.verdict).toBe("FAIL");
    expect(report.failedConditions).toContain("real_requests");
  });
});

describe("edge-soak-report — FAIL: too short a window", () => {
  it(`fails just under ${MIN_SOAK_MINUTES} minutes and passes at exactly ${MIN_SOAK_MINUTES}`, () => {
    const shortWindow: SoakInput = {
      edgeMode: "log",
      windowStartMs: START,
      windowEndMs: START + 60 * MIN,
      requests: realTraffic(600, 59.9),
      errors: [],
    };
    const failing = evaluate(shortWindow);
    expect(failing.verdict).toBe("FAIL");
    expect(failing.failedConditions).toEqual(["soak_window_minutes"]);
    expect(failing.window.effectiveMinutes).toBeLessThan(MIN_SOAK_MINUTES);

    const atThreshold: SoakInput = {
      ...shortWindow,
      requests: realTraffic(600, 60),
    };
    expect(evaluate(atThreshold).verdict).toBe("PASS");
  });

  it("a generously DECLARED window cannot inflate a short one — the data's own span wins", () => {
    // Declares 6 hours; the rows only ever span 3 minutes. This is the exact
    // shape of an operator writing an optimistic window into the evidence.
    const input: SoakInput = {
      edgeMode: "log",
      windowStartMs: START,
      windowEndMs: START + 360 * MIN,
      requests: realTraffic(600, 3),
      errors: [],
    };
    const report = evaluate(input);
    expect(report.window.declaredMinutes).toBe(360);
    expect(report.window.observedMinutes).toBe(3);
    expect(report.window.effectiveMinutes).toBe(3);
    expect(report.failedConditions).toEqual(["soak_window_minutes"]);
  });
});

describe("edge-soak-report — FAIL: an unclassifiable source", () => {
  it("fails on a row with no IP, and NEVER folds it into the CI bucket", () => {
    const input = cleanSoak();
    input.requests.push({
      ip: null,
      occurredAt: START + 9 * MIN,
      edgeVerdict: "would_deny",
    });
    const report = evaluate(input);

    expect(report.verdict).toBe("FAIL");
    expect(report.failedConditions).toContain("all_sources_classifiable");
    expect(report.byClass[SOURCE_CLASS.UNCLASSIFIABLE].requests).toBe(1);
    // The whole point: it did not get quietly excluded as automation.
    expect(report.byClass[SOURCE_CLASS.CI].requests).toBe(3);
    expect(report.byClass[SOURCE_CLASS.OPERATOR].requests).toBe(1);
    expect(report.totals.wouldDenyExcluded).toBe(4);
    // An unclassifiable would-deny counts AGAINST the pass condition too.
    expect(report.totals.wouldDenyFromRealSources).toBe(1);
    expect(report.failedConditions).toContain(
      "would_deny_from_real_sources_zero"
    );
  });

  it.each([
    ["a placeholder token", "unknown"],
    ["a dash", "-"],
    ["the digest's own marker IP", "system"],
    ["an empty string", ""],
    ["a hostname rather than an address", "runner-42.internal"],
    ["an out-of-range octet", "999.1.1.1"],
  ])("treats %s as UNCLASSIFIABLE, not UNKNOWN and not CI", (_label, ip) => {
    const result = classifySource(ip, buildKnownSources(EMPTY_ENV)) as {
      sourceClass: string;
      label: string;
    };
    expect(result.sourceClass).toBe(SOURCE_CLASS.UNCLASSIFIABLE);
  });

  it("explains each unclassifiable source in the report rather than dropping it", () => {
    const input = cleanSoak();
    input.requests.push({
      ip: "unknown",
      occurredAt: START + 9 * MIN,
      edgeVerdict: "allow",
    });
    const report = evaluate(input);
    expect(report.unclassifiableReasons).toHaveLength(1);
    expect(report.unclassifiableReasons[0].count).toBe(1);
    expect(report.unclassifiableReasons[0].reason).toContain(
      "placeholder token"
    );
    expect(renderHumanSummary(report)).toContain("never assumed CI");
  });
});

// ─── The 2026-08-06 regression (MANDATORY) ───────────────────────────────────

describe("edge-soak-report — the 2026-08-06 regression case", () => {
  /**
   * The as-built record cited "18 requests through Cloudflare + 5 direct" as
   * proof that arming was safe. Arming followed; real users were 403'd for ~7
   * hours. This fixture reproduces that evidence exactly: 23 requests over ~4
   * minutes, the 5 direct ones being the operator's own curl probes.
   */
  function evidenceOf20260806(): SoakInput {
    const requests: SoakRow[] = [];
    for (let i = 0; i < 18; i++) {
      // Through Cloudflare: served, real client addresses.
      requests.push(row(`203.0.113.${i + 1}`, i * 0.2, "allow"));
    }
    for (let i = 0; i < 5; i++) {
      // Direct to the raw origin, no edge secret: the operator's curl probes.
      requests.push(row("47.152.160.175", 3.5 + i * 0.1, "would_deny"));
    }
    return {
      edgeMode: "log",
      windowStartMs: START,
      windowEndMs: START + 4 * MIN,
      label: "2026-08-06 as-built arming evidence",
      requests,
      errors: [],
    };
  }

  it("FAILS the gate on the exact evidence that was accepted as PASS", () => {
    const report = evaluate(evidenceOf20260806());
    expect(report.verdict).toBe("FAIL");
    expect(report.totals.requests).toBe(23);
  });

  it("names both reasons the 2026-08-06 evidence was insufficient", () => {
    const report = evaluate(evidenceOf20260806());
    // ~4 minutes against a 60-minute floor.
    expect(report.failedConditions).toContain("soak_window_minutes");
    expect(report.window.effectiveMinutes).toBeLessThan(5);
    // 18 real requests against a 500 floor.
    expect(report.failedConditions).toContain("real_requests");
    expect(report.totals.realRequests).toBe(18);
  });

  it("is NOT rescued by the operator exclusion — every would-deny was excluded and it still FAILS", () => {
    const report = evaluate(evidenceOf20260806());
    // All 5 direct requests are the operator's, so the would-deny pass
    // condition itself is satisfied. Volume and window are what stop it, which
    // is precisely the check the prose gate could not perform.
    expect(report.totals.wouldDenyTotal).toBe(5);
    expect(report.totals.wouldDenyExcluded).toBe(5);
    expect(report.totals.wouldDenyFromRealSources).toBe(0);
    expect(report.failedConditions).not.toContain(
      "would_deny_from_real_sources_zero"
    );
    expect(report.verdict).toBe("FAIL");
  });

  it("the printed verdict tells the operator not to arm", () => {
    const text = renderHumanSummary(evaluate(evidenceOf20260806())) as string;
    expect(text).toContain("VERDICT: FAIL");
    expect(text).toContain("DO NOT set EDGE_MODE=on");
  });
});

// ─── Fail-closed behavior ────────────────────────────────────────────────────

describe("edge-soak-report — fail-closed", () => {
  it("a query error forces FAIL even when every other condition passes", () => {
    const input = cleanSoak();
    input.errors = ["security_events query failed: ECONNREFUSED"];
    const report = evaluate(input);
    expect(report.verdict).toBe("FAIL");
    expect(report.failedConditions).toEqual(["no_data_errors"]);
    expect(report.dataErrors[0]).toContain("ECONNREFUSED");
  });

  it("a row that states no edge verdict is a data error, never a silent `allow`", () => {
    const input = cleanSoak();
    input.requests.push({ ip: "198.51.100.90", occurredAt: START + 10 * MIN });
    const report = evaluate(input);
    expect(report.verdict).toBe("FAIL");
    expect(report.failedConditions).toEqual(["no_data_errors"]);
    expect(report.dataErrors.join(" ")).toContain("states no edge verdict");
  });

  it("an unrecognized edge verdict is rejected rather than bucketed", () => {
    const input = cleanSoak();
    input.requests.push(row("198.51.100.91", 11, "probably_fine"));
    const report = evaluate(input);
    expect(report.verdict).toBe("FAIL");
    expect(report.dataErrors.join(" ")).toContain("unrecognized edgeVerdict");
  });

  it("a row with an unreadable timestamp fails instead of being dropped from the window", () => {
    const input = cleanSoak();
    input.requests.push({
      ip: "198.51.100.92",
      occurredAt: Number.NaN,
      edgeVerdict: "would_deny",
    });
    const report = evaluate(input);
    expect(report.verdict).toBe("FAIL");
    expect(report.totals.malformedRows).toBe(1);
    expect(report.dataErrors.join(" ")).toContain("occurredAt");
  });

  it("rows outside the declared window are reported as a contradiction, not averaged in", () => {
    const input = cleanSoak();
    input.requests.push(row("198.51.100.93", 900, "allow"));
    const report = evaluate(input);
    expect(report.verdict).toBe("FAIL");
    expect(report.dataErrors.join(" ")).toContain(
      "outside the declared window"
    );
  });

  it("no data at all is FAIL, not a vacuous PASS", () => {
    const empty: SoakInput = { edgeMode: "log", requests: [], errors: [] };
    const report = evaluate(empty);
    expect(report.verdict).toBe("FAIL");
    expect(report.failedConditions).toContain("real_requests");
    expect(report.failedConditions).toContain("soak_window_minutes");
  });

  it("a missing requests array is FAIL", () => {
    const report = evaluateSoak(
      { edgeMode: "log" },
      { env: EMPTY_ENV }
    ) as SoakReport;
    expect(report.verdict).toBe("FAIL");
    expect(report.dataErrors.join(" ")).toContain("input.requests is missing");
  });

  it.each([
    ["on", "arming already happened — this is not a soak"],
    ["off", "the origin lock was not even observing"],
    [null, "the mode was never stated"],
  ])("refuses a soak conducted in EDGE_MODE=%s (%s)", (mode, _why) => {
    const input = cleanSoak();
    input.edgeMode = mode as string | null;
    const report = evaluate(input);
    expect(report.verdict).toBe("FAIL");
    expect(report.failedConditions).toEqual(["edge_mode_log"]);
  });
});

// ─── Source classification: reuse of server/securityDigest.ts's scheme ───────

describe("edge-soak-report — source classification reuses securityDigest.ts's scheme", () => {
  it("every default known source is also recognized by the real classifyIp()", () => {
    const defaults = DEFAULT_KNOWN_SOURCES as Array<{
      value: string;
      sourceClass: string;
    }>;
    expect(defaults.length).toBeGreaterThan(0);
    for (const entry of defaults) {
      // The digest's own classifier agrees this IP is known automation.
      expect(classifyIp(entry.value, [])).toMatchObject({
        matched: true,
        source: "known_automation",
      });
      // ...and this script gives it a CI/OPERATOR class the digest cannot express.
      expect([SOURCE_CLASS.CI, SOURCE_CLASS.OPERATOR]).toContain(
        entry.sourceClass
      );
    }
  });

  it("parses SECURITY_DIGEST_ALLOWLIST_IPS with the same grammar as getOwnerConfiguredAllowlist()", () => {
    const env: Record<string, string | undefined> = {
      SECURITY_DIGEST_ALLOWLIST_IPS:
        " 10.1.2.3 , 192.168.5.0/24 ,, 2001:db8::1 ",
    };
    const digestEntries = getOwnerConfiguredAllowlist(env).map(e => e.value);
    const soakEntries = (
      buildKnownSources(env) as Array<{ value: string; label: string }>
    )
      .filter(e => e.label.includes("SECURITY_DIGEST_ALLOWLIST_IPS"))
      .map(e => e.value);
    expect(soakEntries).toEqual(digestEntries);
    expect(soakEntries).toEqual(["10.1.2.3", "192.168.5.0/24", "2001:db8::1"]);
  });

  it("matches exact IPs and IPv4 CIDRs, and never matches an IPv6 address against a CIDR pattern", () => {
    expect(matchesIpOrCidr("192.168.5.9", "192.168.5.0/24")).toBe(true);
    expect(matchesIpOrCidr("192.168.6.9", "192.168.5.0/24")).toBe(false);
    expect(matchesIpOrCidr("2001:db8::1", "2001:db8::1")).toBe(true);
    // Same fail-safe rule as securityDigest.ts's matchesIpOrCidr().
    expect(matchesIpOrCidr("2001:db8::1", "2001:db8::/32")).toBe(false);
    expect(
      classifyIp("2001:db8::1", [{ value: "2001:db8::/32", label: "x" }])
    ).toMatchObject({
      matched: false,
    });
  });

  it("an IP known ONLY via SECURITY_DIGEST_ALLOWLIST_IPS is recognized but NOT excluded", () => {
    const env: Record<string, string | undefined> = {
      SECURITY_DIGEST_ALLOWLIST_IPS: "198.51.100.200",
    };
    const classified = classifySource(
      "198.51.100.200",
      buildKnownSources(env)
    ) as {
      sourceClass: string;
      label: string;
    };
    // The digest calls it known automation...
    expect(
      classifyIp("198.51.100.200", getOwnerConfiguredAllowlist(env))
    ).toMatchObject({
      matched: true,
    });
    // ...but "known automation" does not say CI or operator, so it is not excluded.
    expect(classified.sourceClass).toBe(SOURCE_CLASS.UNKNOWN);
    expect(classified.label).toContain("NOT excluded");

    const input = cleanSoak();
    input.requests.push(row("198.51.100.200", 15, "would_deny"));
    const report = evaluate(input, env);
    expect(report.failedConditions).toEqual([
      "would_deny_from_real_sources_zero",
    ]);
  });

  it("EDGE_SOAK_CI_IPS and EDGE_SOAK_OPERATOR_IPS do grant the exclusion", () => {
    const env: Record<string, string | undefined> = {
      EDGE_SOAK_CI_IPS: "198.51.100.201,10.20.0.0/16",
      EDGE_SOAK_OPERATOR_IPS: "198.51.100.202",
    };
    const input = cleanSoak();
    input.requests.push(row("198.51.100.201", 15, "would_deny"));
    input.requests.push(row("10.20.30.40", 16, "would_deny"));
    input.requests.push(row("198.51.100.202", 17, "would_deny"));
    const report = evaluate(input, env);
    expect(report.byClass[SOURCE_CLASS.CI].wouldDeny).toBe(5);
    expect(report.byClass[SOURCE_CLASS.OPERATOR].wouldDeny).toBe(2);
    expect(report.verdict).toBe("PASS");
  });

  it("a genuine Cloudflare PoP IP is NOT trusted (mirrors CF_RANGE_ALLOWLIST_ENABLED=false)", () => {
    const cfPop = "104.16.5.5";
    // Confirm the fixture really is inside the repo's Cloudflare CIDR snapshot,
    // so this test cannot silently degrade into "some random IP is untrusted".
    expect(isCloudflareEdgeIp(cfPop)).toBe(true);

    const classified = classifySource(cfPop, buildKnownSources(EMPTY_ENV)) as {
      sourceClass: string;
    };
    expect(classified.sourceClass).toBe(SOURCE_CLASS.UNKNOWN);

    const input = cleanSoak();
    input.requests.push(row(cfPop, 18, "would_deny"));
    const report = evaluate(input);
    expect(report.verdict).toBe("FAIL");
    expect(report.failedConditions).toEqual([
      "would_deny_from_real_sources_zero",
    ]);
  });
});

// ─── Traffic SHAPE: the distinct-source floor and the concentration cap ──────
//
// The gate's promise is "real traffic from real users". A request COUNT alone
// cannot keep that promise, because a count is the one quantity a single box
// can manufacture: before these two conditions existed, 500 requests from ONE
// IP satisfied `real_requests` and the whole gate returned PASS.

describe("edge-soak-report — FAIL: too few distinct real sources", () => {
  /** `count` requests over `spanMinutes`, distributed per the given [ip, n] pairs. */
  function weightedTraffic(
    pairs: Array<[string, number]>,
    spanMinutes: number
  ): SoakRow[] {
    const ips: string[] = [];
    for (const [ip, n] of pairs) for (let i = 0; i < n; i++) ips.push(ip);
    const step = ips.length > 1 ? (spanMinutes * MIN) / (ips.length - 1) : 0;
    return ips.map((ip, i) => ({
      ip,
      occurredAt: Math.round(START + i * step),
      edgeVerdict: "allow",
    }));
  }

  function soakWith(requests: SoakRow[]): SoakInput {
    return {
      edgeMode: "log",
      windowStartMs: START,
      windowEndMs: START + 75 * MIN,
      requests,
      errors: [],
    };
  }

  it("500 requests from ONE IP FAILS — the exact shape that used to PASS", () => {
    const input = soakWith(weightedTraffic([["198.51.100.7", 500]], 75));
    const report = evaluate(input);

    // Every condition the gate had BEFORE the floor existed still passes on this
    // bundle, which is precisely why it used to return PASS.
    for (const id of [
      "edge_mode_log",
      "soak_window_minutes",
      "real_requests",
      "would_deny_from_real_sources_zero",
      "all_sources_classifiable",
      "no_data_errors",
    ]) {
      expect(report.conditions.find(c => c.id === id)?.pass).toBe(true);
    }
    expect(report.totals.realRequests).toBe(MIN_REAL_REQUESTS);
    expect(report.totals.distinctRealSources).toBe(1);
    expect(report.totals.topRealSourceRequests).toBe(500);

    // ...and it now FAILS, on the two conditions that describe traffic shape.
    expect(report.verdict).toBe("FAIL");
    expect(report.failedConditions).toEqual([
      "distinct_real_sources",
      "real_source_concentration",
    ]);
  });

  it(`fails at ${MIN_DISTINCT_REAL_SOURCES - 1} distinct real sources and passes at ${MIN_DISTINCT_REAL_SOURCES}`, () => {
    const failing = evaluate(
      soakWith(realTrafficFromSources(600, MIN_DISTINCT_REAL_SOURCES - 1, 75))
    );
    expect(failing.totals.realRequests).toBe(600);
    expect(failing.totals.distinctRealSources).toBe(
      MIN_DISTINCT_REAL_SOURCES - 1
    );
    expect(failing.verdict).toBe("FAIL");
    // ONLY this condition fails — the FAIL comes from the source count and
    // nothing else about the fixture.
    expect(failing.failedConditions).toEqual(["distinct_real_sources"]);

    const atThreshold = evaluate(
      soakWith(realTrafficFromSources(600, MIN_DISTINCT_REAL_SOURCES, 75))
    );
    expect(atThreshold.totals.distinctRealSources).toBe(
      MIN_DISTINCT_REAL_SOURCES
    );
    expect(atThreshold.failedConditions).toEqual([]);
    expect(atThreshold.verdict).toBe("PASS");
  });

  it("CI and operator sources do not count toward the distinct-source floor", () => {
    // 24 real sources (one short) plus 40 CI sources. If CI leaked into the
    // floor this would pass with room to spare.
    const ci: SoakRow[] = [];
    for (let i = 0; i < 40; i++) ci.push(row(`10.20.${i}.5`, i, "allow"));
    const input = soakWith([
      ...realTrafficFromSources(600, MIN_DISTINCT_REAL_SOURCES - 1, 75),
      ...ci,
    ]);
    const report = evaluate(input, { EDGE_SOAK_CI_IPS: "10.20.0.0/16" });
    expect(report.byClass[SOURCE_CLASS.CI].distinctSources).toBe(40);
    expect(report.totals.distinctRealSources).toBe(
      MIN_DISTINCT_REAL_SOURCES - 1
    );
    expect(report.failedConditions).toEqual(["distinct_real_sources"]);
  });

  it("a distinct-source floor alone is not enough: one IP may not dominate the volume", () => {
    // 31 distinct real sources — comfortably over the floor — but one of them
    // supplies a quarter of the volume. This is the "476 from one box plus 24
    // incidental clients" evasion of a floor that only counts sources.
    const rest: Array<[string, number]> = [];
    for (let i = 0; i < 30; i++)
      rest.push([`203.0.113.${i + 10}`, i < 29 ? 15 : 14]);
    // 29 x 15 + 14 = 449 requests from 30 sources, so the top source's share is
    // exactly at the cap at 149 (149/598 -> cap floor(0.25 x 598) = 149) and one
    // past it at 150 (cap floor(0.25 x 599) = 149).

    const atCap = evaluate(
      soakWith(weightedTraffic([["198.51.100.7", 149], ...rest], 75))
    );
    expect(atCap.totals.realRequests).toBe(598);
    expect(atCap.totals.distinctRealSources).toBe(31);
    expect(atCap.totals.topRealSourceRequests).toBe(149);
    expect(atCap.totals.maxRequestsPerRealSource).toBe(
      Math.floor(MAX_REAL_SHARE_PER_SOURCE * 598)
    );
    expect(atCap.failedConditions).toEqual([]);
    expect(atCap.verdict).toBe("PASS");

    const overCap = evaluate(
      soakWith(weightedTraffic([["198.51.100.7", 150], ...rest], 75))
    );
    expect(overCap.totals.realRequests).toBe(599);
    expect(overCap.totals.distinctRealSources).toBe(31);
    expect(overCap.totals.topRealSourceRequests).toBe(150);
    expect(overCap.totals.maxRequestsPerRealSource).toBe(149);
    expect(overCap.verdict).toBe("FAIL");
    expect(overCap.failedConditions).toEqual(["real_source_concentration"]);
  });

  it("reports the shape numbers in the human summary so the operator can see them", () => {
    const text = renderHumanSummary(
      evaluate(soakWith(weightedTraffic([["198.51.100.7", 500]], 75)))
    ) as string;
    expect(text).toContain(
      `Distinct REAL sources      : 1 (floor ${MIN_DISTINCT_REAL_SOURCES})`
    );
    expect(text).toContain(
      "Busiest real source        : 500 request(s) (cap 125)"
    );
    expect(text).toContain("VERDICT: FAIL");
  });

  it("an empty soak fails on volume, never on a divide-by-zero concentration", () => {
    const report = evaluate({ edgeMode: "log", requests: [], errors: [] });
    expect(report.totals.topRealSourceRequests).toBe(0);
    expect(report.totals.maxRequestsPerRealSource).toBe(1);
    expect(
      report.conditions.find(c => c.id === "real_source_concentration")?.pass
    ).toBe(true);
    expect(report.failedConditions).toContain("real_requests");
    expect(report.failedConditions).toContain("distinct_real_sources");
  });
});

// ─── The thresholds themselves ───────────────────────────────────────────────

describe("edge-soak-report — the thresholds are the runbook's, and are non-waivable", () => {
  it("pins the runbook numbers so a silent relaxation shows up as a failing test", () => {
    expect(MIN_SOAK_MINUTES).toBe(60);
    expect(MIN_REAL_REQUESTS).toBe(500);
    expect(REQUIRED_EDGE_MODE).toBe("log");
    expect(MIN_DISTINCT_REAL_SOURCES).toBe(25);
    expect(MAX_REAL_SHARE_PER_SOURCE).toBe(0.25);
  });

  it("offers no seam through which a caller can move a threshold", () => {
    const input = cleanSoak();
    input.requests = realTraffic(20, 5);
    const report = evaluateSoak(input, {
      env: EMPTY_ENV,
      // Every plausible override name a future caller might reach for.
      minSoakMinutes: 1,
      minRealRequests: 1,
      MIN_SOAK_MINUTES: 1,
      MIN_REAL_REQUESTS: 1,
      force: true,
      waive: ["real_requests", "soak_window_minutes"],
    }) as SoakReport;
    expect(report.verdict).toBe("FAIL");
    expect(
      report.conditions.find(c => c.id === "real_requests")?.required
    ).toBe(500);
    expect(
      report.conditions.find(c => c.id === "soak_window_minutes")?.required
    ).toBe(60);
  });
});

// ─── CLI ─────────────────────────────────────────────────────────────────────

/**
 * main() is the path an operator actually runs, and every test above this line
 * drives evaluateSoak directly. That gap is where the CLI's fail-open lived:
 * main() coerced a non-array `errors` field to `[]` BEFORE calling evaluateSoak,
 * so a bundle REPORTING a collector failure came back VERDICT: PASS, exit 0 —
 * while the same input through evaluateSoak returned FAIL. These tests drive the
 * wrapper itself, with the filesystem and the database injected.
 */
describe("edge-soak-report — CLI", () => {
  function captureRun(argv: string[]) {
    const out: string[] = [];
    const err: string[] = [];
    const console_ = {
      log: (s: string) => out.push(s),
      error: (s: string) => err.push(s),
    };
    return { out, err, console_, argv };
  }

  const BUNDLE_PATH = "/evidence/soak.json";

  /** A readFile double: serves one path, throws ENOENT like the real one for others. */
  function fileWith(contents: string) {
    return (path: string) => {
      if (path !== BUNDLE_PATH) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }
      return contents;
    };
  }

  /** Runs main() over a bundle object serialized to the fake filesystem. */
  async function runCli(
    bundle: unknown,
    extraArgv: string[] = [],
    deps: Record<string, unknown> = {}
  ) {
    const { out, err, console_ } = captureRun([]);
    const code = (await main(
      [
        "node",
        "edge-soak-report.mjs",
        `--input=${BUNDLE_PATH}`,
        "--json",
        ...extraArgv,
      ],
      console_,
      { readFile: fileWith(JSON.stringify(bundle)), ...deps }
    )) as number;
    return {
      code,
      out,
      err,
      report: out.length ? (JSON.parse(out.join("\n")) as SoakReport) : null,
    };
  }

  it("exits 0 and prints VERDICT: PASS on a clean bundle", async () => {
    const { code, report } = await runCli(cleanSoak());
    expect(code).toBe(0);
    expect(report?.verdict).toBe("PASS");
    expect(report?.failedConditions).toEqual([]);
    expect(report?.totals.realRequests).toBe(520);
  });

  it("exits 1 on a bundle with a single real-user would-deny", async () => {
    const input = cleanSoak();
    input.requests.push(row("198.51.100.77", 30, "would_deny"));
    const { code, report } = await runCli(input);
    expect(code).toBe(1);
    expect(report?.verdict).toBe("FAIL");
    expect(report?.failedConditions).toEqual([
      "would_deny_from_real_sources_zero",
    ]);
  });

  it("renders the human summary (not JSON) when --json is absent, and still exits 1", async () => {
    const { out, console_ } = captureRun([]);
    const code = await main(
      ["node", "edge-soak-report.mjs", `--input=${BUNDLE_PATH}`],
      console_,
      {
        readFile: fileWith(
          JSON.stringify({ edgeMode: "log", requests: [], errors: [] })
        ),
      }
    );
    expect(code).toBe(1);
    expect(out.join("\n")).toContain("VERDICT: FAIL");
    expect(out.join("\n")).toContain("DO NOT set EDGE_MODE=on");
  });

  // ── The fail-open this gate almost shipped with ─────────────────────────────

  it.each([
    ["a string", "security_events query failed: ECONNREFUSED"],
    ["an object", { fatal: "security_events query failed: ETIMEDOUT" }],
    ["a number", 1],
    ["null", null],
  ])(
    "FAILS (exit 1) when `errors` is %s rather than an array — the malformed field is never coerced away",
    async (_shape, errorsValue) => {
      const input = { ...cleanSoak(), errors: errorsValue };
      const { code, report } = await runCli(input);
      // Before the fix this returned PASS / exit 0 on exactly this input.
      expect(code).toBe(1);
      expect(report?.verdict).toBe("FAIL");
      expect(report?.failedConditions).toEqual(["no_data_errors"]);
      expect(report?.dataErrors.join(" ")).toContain(
        "input.errors is present but is not an array"
      );
    }
  );

  it("main()'s `deps` seam carries no threshold — it cannot buy a PASS", async () => {
    const input = cleanSoak();
    input.requests = realTraffic(20, 5); // 20 requests over 5 minutes
    const { code, report } = await runCli(input, [], {
      // Every plausible override name a future caller might reach for, on the
      // one argument that DOES exist for injection.
      minSoakMinutes: 1,
      minRealRequests: 1,
      MIN_SOAK_MINUTES: 1,
      MIN_REAL_REQUESTS: 1,
      MIN_DISTINCT_REAL_SOURCES: 1,
      force: true,
      waive: ["real_requests", "soak_window_minutes", "distinct_real_sources"],
      evaluateSoak: () => ({ verdict: "PASS", failedConditions: [] }),
    });
    expect(code).toBe(1);
    expect(report?.verdict).toBe("FAIL");
    expect(
      report?.conditions.find(c => c.id === "real_requests")?.required
    ).toBe(MIN_REAL_REQUESTS);
    expect(
      report?.conditions.find(c => c.id === "distinct_real_sources")?.required
    ).toBe(MIN_DISTINCT_REAL_SOURCES);
  });

  it("quotes the collector's own message when `errors` is a bare string", async () => {
    const input = {
      ...cleanSoak(),
      errors: "security_events query failed: ECONNREFUSED",
    };
    const { report } = await runCli(input);
    expect(report?.dataErrors.join(" ")).toContain("ECONNREFUSED");
  });

  it("an ARRAY of errors still forces FAIL through the CLI (the honest shape)", async () => {
    const input = {
      ...cleanSoak(),
      errors: ["security_events query failed: ECONNREFUSED"],
    };
    const { code, report } = await runCli(input);
    expect(code).toBe(1);
    expect(report?.failedConditions).toEqual(["no_data_errors"]);
    expect(report?.dataErrors[0]).toContain("ECONNREFUSED");
  });

  it("an absent `errors` field is legal and does not fabricate a data error", async () => {
    const { errors: _dropped, ...withoutErrors } = cleanSoak();
    const { code, report } = await runCli(withoutErrors);
    expect(code).toBe(0);
    expect(report?.dataErrorCount).toBe(0);
  });

  it("FAILS (exit 1) when `requests` is not an array, instead of reading it as empty", async () => {
    const { code, report } = await runCli({
      edgeMode: "log",
      requests: "520 requests",
    });
    expect(code).toBe(1);
    expect(report?.dataErrors.join(" ")).toContain(
      "input.requests is missing or is not an array"
    );
    expect(report?.failedConditions).toContain("no_data_errors");
  });

  it("FAILS when the bundle is valid JSON but not an object", async () => {
    const { code, report } = await runCli([{ ip: "203.0.113.1" }]);
    expect(code).toBe(1);
    expect(report?.dataErrors.join(" ")).toContain("is not a JSON object");
  });

  // ── --db supplement ─────────────────────────────────────────────────────────

  it("--db merges anomaly rows into the bundle, and one real-source anomaly FAILS it", async () => {
    const { code, report } = await runCli(cleanSoak(), ["--db"], {
      loadDbEvents: async () => ({
        requests: [
          {
            ip: "198.51.100.44",
            occurredAt: START + 20 * MIN,
            eventType: "RATE_LIMIT",
            context: "edge_origin_ingress_anomaly",
          },
        ],
        errors: [],
      }),
    });
    expect(code).toBe(1);
    expect(report?.totals.requests).toBe(525);
    expect(report?.failedConditions).toEqual([
      "would_deny_from_real_sources_zero",
    ]);
    expect(report?.offendingSources).toEqual([
      { ip: "198.51.100.44", wouldDeny: 1 },
    ]);
  });

  it("a --db query error forces FAIL even when the bundle itself is clean", async () => {
    const { code, report } = await runCli(cleanSoak(), ["--db"], {
      loadDbEvents: async () => ({
        requests: [],
        errors: ["security_events query failed: ECONNREFUSED"],
      }),
    });
    expect(code).toBe(1);
    expect(report?.failedConditions).toEqual(["no_data_errors"]);
    expect(report?.dataErrors.join(" ")).toContain("ECONNREFUSED");
  });

  it("a --db loader that returns an unexpected shape FAILS rather than contributing nothing", async () => {
    const { code, report } = await runCli(cleanSoak(), ["--db"], {
      loadDbEvents: async () => ({}),
    });
    expect(code).toBe(1);
    expect(report?.dataErrors.join(" ")).toContain(
      "--db loader returned no usable"
    );
  });

  it("--db alone cannot manufacture a PASS: security_events holds anomalies, not traffic", async () => {
    const { out, console_ } = captureRun([]);
    const code = await main(
      ["node", "edge-soak-report.mjs", "--db", "--json"],
      console_,
      {
        loadDbEvents: async () => ({ requests: [], errors: [] }),
      }
    );
    expect(code).toBe(1);
    const report = JSON.parse(out.join("\n")) as SoakReport;
    expect(report.failedConditions).toContain("real_requests");
    expect(report.failedConditions).toContain("distinct_real_sources");
  });

  // ── Pre-existing coverage ───────────────────────────────────────────────────

  it("exits 1 and prints the FAIL report when the input file is missing (fail-closed)", async () => {
    const { out, console_ } = captureRun([]);
    const code = await main(
      [
        "node",
        "edge-soak-report.mjs",
        "--input=/nonexistent/soak.json",
        "--json",
      ],
      console_
    );
    expect(code).toBe(1);
    const report = JSON.parse(out.join("\n")) as SoakReport;
    expect(report.verdict).toBe("FAIL");
    expect(report.dataErrors.join(" ")).toContain("could not read input file");
  });

  it("exits 2 on a usage error without emitting a verdict", async () => {
    const { out, console_ } = captureRun([]);
    const code = await main(["node", "edge-soak-report.mjs"], console_);
    expect(code).toBe(2);
    expect(out.join("\n")).not.toContain("VERDICT");
  });
});
