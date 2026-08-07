/**
 * Ledger + envelope + query-layer unit tests.
 *
 * PROVENANCE / HONESTY NOTE (repo convention, see server/mlbDoubleheaderFixtures.ts):
 * all artifacts here are synthetic fixtures. gamePk values are in the 9xxxxx
 * range and deliberately not real MLB ids. Fixture-based verification must
 * never be described as live verification.
 */
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  computeContentHash,
  makeArtifact,
  type MakeArtifactInput,
} from "./envelope";
import { LoopLedger } from "./ledger";
import {
  costPerVerifiedOutcome,
  gradingByModelVersion,
  lineage,
  pendingApprovals,
  MIN_GRADED_SAMPLE,
} from "./queries";

const T0 = 1_753_600_000_000; // fixed synthetic epoch-ms base

function artifact(overrides: Partial<MakeArtifactInput> = {}) {
  return makeArtifact({
    artifactId: "obs:900101:1",
    artifactType: "provider_observation",
    createdAtMs: T0,
    observedAtMs: T0,
    producer: "test",
    sources: ["ext:statsapi.mlb.com/schedule"],
    entityRefs: { gamePk: 900101, gameDate: "2026-07-01" },
    payload: { hello: "world" },
    ...overrides,
  });
}

describe("envelope", () => {
  it("canonicalJson is key-order independent and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: undefined, c: [2, null] } })).toBe(
      canonicalJson({ a: { c: [2, null] }, b: 1 }),
    );
  });

  it("contentHash ignores processing time but covers semantic content", () => {
    const a = artifact();
    const later = artifact({ createdAtMs: T0 + 999_999 });
    expect(later.contentHash).toBe(a.contentHash);
    const changed = artifact({ payload: { hello: "changed" } });
    expect(changed.contentHash).not.toBe(a.contentHash);
  });

  it("rejects malformed envelopes at construction", () => {
    expect(() => artifact({ entityRefs: { gameDate: "07/01/2026" } })).toThrow();
    expect(() =>
      artifact({ artifactType: "not_a_type" as never }),
    ).toThrow();
  });
});

describe("ledger append semantics", () => {
  it("appends, deduplicates identical replays, rejects id conflicts", () => {
    const ledger = new LoopLedger();
    expect(ledger.append(artifact()).status).toBe("appended");
    // Replay of the same fact (different processing time, same content hash).
    expect(ledger.append(artifact({ createdAtMs: T0 + 5000 })).status).toBe("deduplicated");
    expect(ledger.size()).toBe(1);
    // Same id, different content: history is immutable.
    const conflict = ledger.append(artifact({ payload: { hello: "mutated" } }));
    expect(conflict.status).toBe("rejected");
    if (conflict.status === "rejected") expect(conflict.reason).toContain("ID_CONFLICT");
  });

  it("rejects fabricated content hashes", () => {
    const ledger = new LoopLedger();
    const fake = { ...artifact(), contentHash: "0".repeat(64) };
    const result = ledger.append(fake);
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.reason).toContain("HASH_MISMATCH");
  });

  it("requires internal sources and links to resolve; ext: refs are exempt", () => {
    const ledger = new LoopLedger();
    const dangling = ledger.append(
      artifact({ artifactId: "evt:900101", sources: ["obs:never-appended"] }),
    );
    expect(dangling.status).toBe("rejected");
    if (dangling.status === "rejected") expect(dangling.reason).toContain("UNRESOLVED_SOURCE");
    expect(ledger.append(artifact()).status).toBe("appended");
    const linked = ledger.append(
      artifact({ artifactId: "evt:900101", sources: ["obs:900101:1"] }),
    );
    expect(linked.status).toBe("appended");
    const badLink = ledger.append(
      artifact({ artifactId: "res:900101:9", links: { correctionOf: "res:ghost" } }),
    );
    expect(badLink.status).toBe("rejected");
  });

  it("verifyIntegrity detects in-memory tampering", () => {
    const ledger = new LoopLedger();
    ledger.append(artifact());
    ledger.append(artifact({ artifactId: "obs:900101:2" }));
    expect(ledger.verifyIntegrity().ok).toBe(true);
    // Tamper directly with a stored artifact payload.
    (ledger.allRecords()[0].artifact as { payload: unknown }).payload = { hello: "evil" };
    const integrity = ledger.verifyIntegrity();
    expect(integrity.ok).toBe(false);
    expect(integrity.reason).toContain("CONTENT_TAMPERED");
    expect(integrity.brokenAtSeq).toBe(0);
  });

  it("round-trips through JSONL and refuses altered files (interrupted-run recovery)", () => {
    const ledger = new LoopLedger();
    ledger.append(artifact());
    ledger.append(artifact({ artifactId: "obs:900101:2", observedAtMs: T0 + 1 }));
    const jsonl = ledger.toJSONL();

    const restored = LoopLedger.fromJSONL(jsonl);
    expect(restored.ok).toBe(true);
    if (restored.ok) {
      expect(restored.ledger.size()).toBe(2);
      expect(restored.ledger.verifyIntegrity().ok).toBe(true);
      // Resumed ledger keeps appending normally.
      expect(
        restored.ledger.append(artifact({ artifactId: "obs:900101:3", observedAtMs: T0 + 2 }))
          .status,
      ).toBe("appended");
    }

    const tampered = jsonl.replace('"hello":"world"', '"hello":"evil"');
    const bad = LoopLedger.fromJSONL(tampered);
    expect(bad.ok).toBe(false);

    expect(LoopLedger.fromJSONL("not-json").ok).toBe(false);
  });
});

describe("query honesty states", () => {
  it("reports not_measured on empty evidence instead of fabricating zeros", () => {
    const ledger = new LoopLedger();
    expect(gradingByModelVersion(ledger).state).toBe("not_measured");
    expect(pendingApprovals(ledger).state).toBe("not_measured");
    expect(costPerVerifiedOutcome(ledger).state).toBe("not_measured");
    const missing = lineage(ledger, "ghost");
    expect(missing.state).toBe("unknown");
    expect(missing.value).toBeNull();
  });

  it("reports incomplete below the minimum graded sample", () => {
    const ledger = new LoopLedger();
    const n = MIN_GRADED_SAMPLE - 1;
    for (let i = 0; i < n; i++) {
      const result = ledger.append(
        artifact({
          artifactId: `grade:p${i}:r${i}`,
          artifactType: "grading_record",
          versions: { modelVersion: "mlb-mc-v1" },
          entityRefs: { gamePk: 900200 + i, gameDate: "2026-07-01" },
          sources: [],
          payload: {
            grading: { grade: "WIN", modelProb: 0.6, clv: 0.01, profitLoss: 0.909, edge: 0.03 },
            outcomeBinary: 1,
          },
        }),
      );
      expect(result.status).toBe("appended");
    }
    const point = gradingByModelVersion(ledger);
    expect(point.state).toBe("incomplete");
    expect(point.value?.[0].wins).toBe(n);
    expect(point.reason).toContain(`${n} graded records`);
    expect(point.evidence.length).toBe(n);
  });
});
