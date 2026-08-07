import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs module without type declarations
import { evaluateScan } from "./check-osv-scan.mjs";

function osvReport(
  packages: Array<{
    name: string;
    version: string;
    vulns: Array<{ id: string; severity?: string; maxCvss?: string }>;
  }>
) {
  return {
    results: [
      {
        packages: packages.map(p => ({
          package: { name: p.name, version: p.version },
          groups: p.vulns.map(v => ({
            ids: [v.id],
            max_severity: v.maxCvss ?? "",
          })),
          vulnerabilities: p.vulns.map(v => ({
            id: v.id,
            ...(v.severity
              ? { database_specific: { severity: v.severity } }
              : {}),
          })),
        })),
      },
    ],
  };
}

describe("osv-scanner gate — unrateable findings block (fail-closed)", () => {
  // Before this, `vulnSeverity()` returned null for an advisory carrying neither
  // database_specific.severity nor a CVSS rollup, and the caller's
  // `severity && FAILING_SEVERITIES.has(severity)` sent null to the NON-blocking
  // bucket. The gate failed open on precisely the advisories it understood least.
  it("blocks a finding with no declared severity and no CVSS rollup", () => {
    const { flagged, other } = evaluateScan(
      osvReport([
        {
          name: "mystery-pkg",
          version: "1.0.0",
          vulns: [{ id: "GHSA-no-severity" }],
        },
      ])
    );
    expect(other).toEqual([]);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({
      pkg: "mystery-pkg",
      id: "GHSA-no-severity",
      severity: "UNKNOWN",
    });
  });

  it("names the severity UNKNOWN rather than leaving it null, so the report can explain itself", () => {
    const { flagged } = evaluateScan(
      osvReport([{ name: "p", version: "1", vulns: [{ id: "GHSA-x" }] }])
    );
    expect(flagged[0].severity).toBe("UNKNOWN");
    expect(flagged[0].severity).not.toBeNull();
  });

  it("blocks when max_severity is present but unparseable", () => {
    const { flagged, other } = evaluateScan(
      osvReport([
        {
          name: "p",
          version: "1",
          vulns: [{ id: "GHSA-nan", maxCvss: "not-a-number" }],
        },
      ])
    );
    expect(other).toEqual([]);
    expect(flagged.map(f => f.severity)).toEqual(["UNKNOWN"]);
  });

  it("blocks when max_severity is 0 — a zero score is not a rating", () => {
    const { flagged } = evaluateScan(
      osvReport([
        { name: "p", version: "1", vulns: [{ id: "GHSA-zero", maxCvss: "0" }] },
      ])
    );
    expect(flagged.map(f => f.severity)).toEqual(["UNKNOWN"]);
  });

  it("still lets genuinely-rated MODERATE and LOW findings through as non-blocking", () => {
    // The guard must not have been implemented by simply blocking everything —
    // that would pass the tests above while breaking the gate's real purpose.
    const { flagged, other } = evaluateScan(
      osvReport([
        {
          name: "m",
          version: "1",
          vulns: [{ id: "GHSA-mod", maxCvss: "5.5" }],
        },
        {
          name: "l",
          version: "1",
          vulns: [{ id: "GHSA-low", maxCvss: "2.1" }],
        },
      ])
    );
    expect(flagged).toEqual([]);
    expect(other.map(o => o.severity).sort()).toEqual(["LOW", "MEDIUM"]);
  });

  it("separates rated blockers from unrateable ones in the same report", () => {
    const { flagged, other } = evaluateScan(
      osvReport([
        {
          name: "a",
          version: "1",
          vulns: [{ id: "GHSA-high", severity: "HIGH" }],
        },
        { name: "b", version: "1", vulns: [{ id: "GHSA-none" }] },
        {
          name: "c",
          version: "1",
          vulns: [{ id: "GHSA-low", maxCvss: "3.0" }],
        },
      ])
    );
    expect(flagged.map(f => f.id).sort()).toEqual(["GHSA-high", "GHSA-none"]);
    expect(other.map(o => o.id)).toEqual(["GHSA-low"]);
  });
});

describe("osv-scanner gate", () => {
  it("passes cleanly when results is an empty array (osv-scanner's real shape for zero findings)", () => {
    const { flagged, other } = evaluateScan({ results: [] });
    expect(flagged).toEqual([]);
    expect(other).toEqual([]);
  });

  it("flags a HIGH finding using the GHSA-reviewed severity field", () => {
    const report = osvReport([
      {
        name: "xlsx",
        version: "0.18.5",
        vulns: [{ id: "GHSA-4r6h-8v6p-xvw6", severity: "HIGH" }],
      },
    ]);
    const { flagged, other } = evaluateScan(report);
    expect(other).toEqual([]);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].pkg).toBe("xlsx");
  });

  it("flags a CRITICAL finding", () => {
    const report = osvReport([
      {
        name: "vitest",
        version: "2.1.9",
        vulns: [{ id: "GHSA-5xrq-8626-4rwp", severity: "CRITICAL" }],
      },
    ]);
    const { flagged } = evaluateScan(report);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].severity).toBe("CRITICAL");
  });

  it("does not flag MODERATE or LOW findings", () => {
    const report = osvReport([
      {
        name: "some-pkg",
        version: "1.0.0",
        vulns: [{ id: "GHSA-aaaa", severity: "MODERATE" }],
      },
      {
        name: "other-pkg",
        version: "1.0.0",
        vulns: [{ id: "GHSA-bbbb", severity: "LOW" }],
      },
    ]);
    const { flagged, other } = evaluateScan(report);
    expect(flagged).toEqual([]);
    expect(other).toHaveLength(2);
  });

  it("falls back to the group's CVSS score when database_specific.severity is absent", () => {
    const report = osvReport([
      {
        name: "no-text-severity",
        version: "1.0.0",
        vulns: [{ id: "GHSA-cccc", maxCvss: "8.2" }],
      },
    ]);
    const { flagged } = evaluateScan(report);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].severity).toBe("HIGH");
  });

  it("never silently passes on a malformed report (missing results field)", () => {
    expect(() => evaluateScan({})).toThrow(/results/);
    expect(() => evaluateScan({ error: "something broke" })).toThrow(/results/);
  });

  it("ignore-listed findings never appear at all, since osv-scanner.toml filters them before this script runs", () => {
    // Simulates the real pipeline: osv-scanner's [[IgnoredVulns]] config strips
    // ignored ids out of the JSON entirely, so this script only ever sees what's left.
    const report = osvReport([{ name: "xlsx", version: "0.18.5", vulns: [] }]);
    const { flagged, other } = evaluateScan(report);
    expect(flagged).toEqual([]);
    expect(other).toEqual([]);
  });
});
