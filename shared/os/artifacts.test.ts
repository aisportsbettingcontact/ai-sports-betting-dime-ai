import { describe, expect, it } from "vitest";
import { parseArtifactHeader, findOverdue, findSupersededClaims } from "./artifacts";

describe("parseArtifactHeader", () => {
  it("reads Status, Kind and observe_by from a decision-record header", () => {
    const md = [
      "# DR-999 — a decision",
      "",
      "**Status:** AWAITING RULING · **DRI:** Prez · **Raised:** 2026-08-05",
      "**Kind:** consolidation",
      "**observe_by:** 2026-08-12",
      "",
      "## The question",
    ].join("\n");
    const h = parseArtifactHeader(md);
    expect(h.status).toBe("AWAITING RULING");
    expect(h.kind).toBe("consolidation");
    expect(h.observeBy).toBe("2026-08-12");
  });

  it("defaults kind to 'decision' when the record does not declare one", () => {
    const h = parseArtifactHeader("# DR-001 — x\n\n**Status:** AWAITING RULING\n");
    expect(h.kind).toBe("decision");
  });

  it("returns observeBy null when absent, rather than guessing a date", () => {
    expect(parseArtifactHeader("# x\n\n**Status:** OPEN\n").observeBy).toBeNull();
  });
});

describe("findOverdue", () => {
  const asOf = new Date("2026-08-20T00:00:00Z");

  it("flags an open item whose observe_by has passed, with its age in days", () => {
    const out = findOverdue(
      [{ path: "os/decisions/DR-001.md", status: "AWAITING RULING", observeBy: "2026-08-12" }],
      asOf,
    );
    expect(out).toEqual([{ path: "os/decisions/DR-001.md", observeBy: "2026-08-12", daysOverdue: 8 }]);
  });

  it("does not flag an item whose observe_by is still in the future", () => {
    expect(findOverdue([{ path: "a.md", status: "OPEN", observeBy: "2026-09-01" }], asOf)).toEqual([]);
  });

  it("does not flag a CLOSED or RULED item even if its date passed", () => {
    const items = [
      { path: "a.md", status: "RULED", observeBy: "2026-01-01" },
      { path: "b.md", status: "CLOSED — premise refuted", observeBy: "2026-01-01" },
    ];
    expect(findOverdue(items, asOf)).toEqual([]);
  });

  it("reports an open item with NO observe_by as overdue with daysOverdue null — silence must be loud", () => {
    const out = findOverdue([{ path: "c.md", status: "AWAITING RULING", observeBy: null }], asOf);
    expect(out).toEqual([{ path: "c.md", observeBy: null, daysOverdue: null }]);
  });
});

describe("findSupersededClaims", () => {
  it("flags a live artifact asserting a claim another artifact marks REFUTED", () => {
    const files = [
      { path: "os/audits/resolution.md", body: "**REFUTED 2026-08-05:** the builder is RAILPACK" },
      { path: "os/plan/README.md", body: "- Both services build with RAILPACK, not the Dockerfile." },
    ];
    const out = findSupersededClaims(files, ["RAILPACK"]);
    expect(out.map((f) => f.path)).toEqual(["os/plan/README.md"]);
  });

  it("does not flag the artifact that carries the correction itself", () => {
    const files = [{ path: "os/audits/r.md", body: "RAILPACK was asserted. **REFUTED 2026-08-05.**" }];
    expect(findSupersededClaims(files, ["RAILPACK"])).toEqual([]);
  });

  it("does not flag appendices — they are immutable point-in-time evidence", () => {
    const files = [{ path: "os/audits/appendix/ledger.md", body: "builder reports RAILPACK" }];
    expect(findSupersededClaims(files, ["RAILPACK"])).toEqual([]);
  });

  it("does NOT treat lowercase prose as a correction marker — that is how prose defeated the rule", () => {
    const files = [{ path: "os/memory/lessons/README.md", body: "I refuted my own RAILPACK finding" }];
    // Narrative files like this are handled by exemptPaths, never by prose matching.
    expect(findSupersededClaims(files, ["RAILPACK"]).length).toBe(1);
    expect(findSupersededClaims(files, ["RAILPACK"], ["os/memory/lessons/README.md"])).toEqual([]);
  });

  it("accepts a correction on a NEARBY line, not only the same line", () => {
    const body = [
      "# ISSUE-017 — Resolve RAILPACK-vs-Dockerfile",
      "",
      "**Status:** CLOSED — premise refuted",
    ].join("\n");
    expect(findSupersededClaims([{ path: "os/plan/issues/ISSUE-017.md", body }], ["RAILPACK"])).toEqual([]);
  });

  it("still flags an assertion with no correction anywhere near it", () => {
    const body = ["intro", "", "- services build with RAILPACK, not the Dockerfile", "", "unrelated", "", "more", "", "REFUTED far below"].join("\n");
    expect(findSupersededClaims([{ path: "os/plan/README.md", body }], ["RAILPACK"]).length).toBe(1);
  });

  it("is NOT fooled by ordinary prose containing 'unresolved' or 'staleness'", () => {
    const body = [
      "**Known staleness:** deploy counts drift within hours. The UNKNOWN items",
      "remain unresolved and each names what would resolve it.",
      "",
      "- Services build with RAILPACK, not the Dockerfile.",
    ].join("\n");
    expect(findSupersededClaims([{ path: "os/STATE.md", body }], ["RAILPACK"]).length).toBe(1);
  });

  it("accepts an explicit dated correction near the assertion", () => {
    const body = ["**REFUTED 2026-08-05.**", "", "- was believed to build with RAILPACK"].join("\n");
    expect(findSupersededClaims([{ path: "os/x.md", body }], ["RAILPACK"])).toEqual([]);
  });

  it("exempts the artifact that carries the correction, named explicitly", () => {
    const files = [{ path: "os/audits/2026-08-05-builder-resolution.md", body: "RAILPACK everywhere\nRAILPACK again" }];
    expect(findSupersededClaims(files, ["RAILPACK"], ["os/audits/2026-08-05-builder-resolution.md"])).toEqual([]);
  });
});
