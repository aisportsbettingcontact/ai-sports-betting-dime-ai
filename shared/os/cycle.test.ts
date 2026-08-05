import { describe, expect, it } from "vitest";
import { buildCycleArtifact, isDuplicate, type MergeFacts } from "./cycle";

const FACTS: MergeFacts = {
  commitSha: "6965b5800ee00ee7da720cc7703202ff4f8b65ce",
  treeSha: "9d6bd01d53fb0ef675c40f7b13cb512a7ab1d8c4",
  prNumber: 388,
  prTitle: "os(stage-4): ISSUE-008 token ledger",
  mergedAt: "2026-08-05T22:22:15Z",
  filesChanged: 8,
  proofContractRunId: "31052169665",
};

describe("buildCycleArtifact", () => {
  it("records the merge as a loop cycle with an UNOBSERVED outcome", () => {
    const a = buildCycleArtifact(FACTS);
    expect(a.type).toBe("loop_cycle");
    expect(a.loop).toBe("LOOP-001-engineering-build");
    expect(a.commitSha).toBe(FACTS.commitSha);
    expect(a.prNumber).toBe(388);
    // The whole point: a merge is an ACTION, not an outcome (D5).
    expect(a.outcome).toBeNull();
  });

  it("sets observe_by 2 days after the merge, so an unobserved merge goes overdue", () => {
    expect(buildCycleArtifact(FACTS).observe_by).toBe("2026-08-07");
  });

  it("REFERENCES the proof contract by run id rather than duplicating it", () => {
    const a = buildCycleArtifact(FACTS);
    expect(a.gates.proofContractRunId).toBe("31052169665");
    expect(JSON.stringify(a)).not.toContain("dependency_lock_hashes");
  });

  it("derives a stable content hash from the merge facts", () => {
    expect(buildCycleArtifact(FACTS).contentHash).toBe(buildCycleArtifact({ ...FACTS }).contentHash);
  });

  it("changes the content hash when a material fact changes", () => {
    const a = buildCycleArtifact(FACTS);
    const b = buildCycleArtifact({ ...FACTS, commitSha: "0000000000000000000000000000000000000000" });
    expect(a.contentHash).not.toBe(b.contentHash);
  });
});

describe("isDuplicate", () => {
  it("treats a replay of the same merge as a duplicate — appending must be idempotent", () => {
    const a = buildCycleArtifact(FACTS);
    expect(isDuplicate(a, [a])).toBe(true);
  });

  it("does not treat a different merge as a duplicate", () => {
    const a = buildCycleArtifact(FACTS);
    const b = buildCycleArtifact({ ...FACTS, commitSha: "abc", prNumber: 389 });
    expect(isDuplicate(b, [a])).toBe(false);
  });

  it("returns false against an empty ledger", () => {
    expect(isDuplicate(buildCycleArtifact(FACTS), [])).toBe(false);
  });
});
