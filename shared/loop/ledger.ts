/**
 * Append-only, tamper-evident artifact ledger.
 *
 * Guarantees (docs/ai-native/target-architecture.md invariants 3, 8, 9):
 * - Idempotent append: re-appending an identical artifact (same id + contentHash)
 *   is a no-op ("deduplicated"), so replayed pipeline stages are safe.
 * - Conflict rejection: same id with different content is rejected — corrections
 *   must be new artifacts linked via links.correctionOf / links.supersedes.
 * - Referential integrity: internal source refs and links must resolve to
 *   artifacts already in the ledger (the ledger is an append-only DAG).
 * - Tamper evidence: each record chains sha-256(prevChainHash + contentHash);
 *   verifyIntegrity() recomputes the chain and re-validates every content hash.
 * - Interruption recovery: toJSONL()/fromJSONL() round-trips the full ledger.
 *
 * The ledger is storage-agnostic and clock-free on purpose: persistence and
 * wall-clock live at the edges so every behavior here is deterministic in tests.
 */
import {
  type LoopArtifact,
  loopArtifactSchema,
  computeContentHash,
  isExternalRef,
  sha256Hex,
} from "./envelope";

export interface LedgerRecord {
  seq: number;
  prevChainHash: string;
  chainHash: string;
  artifact: LoopArtifact;
}

export type AppendResult =
  | { status: "appended"; seq: number }
  | { status: "deduplicated"; seq: number }
  | { status: "rejected"; reason: string };

export interface IntegrityResult {
  ok: boolean;
  records: number;
  brokenAtSeq: number | null;
  reason: string | null;
}

const GENESIS_HASH = sha256Hex("dime-loop-ledger-genesis-v1");

export class LoopLedger {
  private records: LedgerRecord[] = [];
  private byId = new Map<string, LedgerRecord>();

  append(candidate: LoopArtifact): AppendResult {
    const parsed = loopArtifactSchema.safeParse(candidate);
    if (!parsed.success) {
      return {
        status: "rejected",
        reason: `SCHEMA_INVALID: ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      };
    }
    const artifact = parsed.data;

    const expectedHash = computeContentHash(artifact);
    if (artifact.contentHash !== expectedHash) {
      return {
        status: "rejected",
        reason: "HASH_MISMATCH: contentHash does not match artifact content — refusing fabricated or mutated artifact",
      };
    }

    const existing = this.byId.get(artifact.artifactId);
    if (existing) {
      if (existing.artifact.contentHash === artifact.contentHash) {
        return { status: "deduplicated", seq: existing.seq };
      }
      return {
        status: "rejected",
        reason: `ID_CONFLICT: artifact '${artifact.artifactId}' already exists with different content — append a correction artifact (links.correctionOf) instead of mutating history`,
      };
    }

    for (const ref of artifact.sources) {
      if (!isExternalRef(ref) && !this.byId.has(ref)) {
        return {
          status: "rejected",
          reason: `UNRESOLVED_SOURCE: '${ref}' is not in the ledger — citations must resolve`,
        };
      }
    }
    for (const [linkName, target] of Object.entries(artifact.links)) {
      if (target !== undefined && !this.byId.has(target)) {
        return {
          status: "rejected",
          reason: `UNRESOLVED_LINK: links.${linkName} → '${target}' is not in the ledger`,
        };
      }
    }

    const prevChainHash =
      this.records.length === 0
        ? GENESIS_HASH
        : this.records[this.records.length - 1].chainHash;
    const record: LedgerRecord = {
      seq: this.records.length,
      prevChainHash,
      chainHash: sha256Hex(prevChainHash + artifact.contentHash),
      artifact,
    };
    this.records.push(record);
    this.byId.set(artifact.artifactId, record);
    return { status: "appended", seq: record.seq };
  }

  getById(artifactId: string): LoopArtifact | null {
    return this.byId.get(artifactId)?.artifact ?? null;
  }

  list(filter?: {
    artifactType?: LoopArtifact["artifactType"];
    gamePk?: number;
    modelVersion?: string;
  }): LoopArtifact[] {
    return this.records
      .map((r) => r.artifact)
      .filter((a) => {
        if (filter?.artifactType && a.artifactType !== filter.artifactType) return false;
        if (filter?.gamePk !== undefined && a.entityRefs.gamePk !== filter.gamePk) return false;
        if (
          filter?.modelVersion !== undefined &&
          a.versions.modelVersion !== filter.modelVersion &&
          a.entityRefs.modelVersion !== filter.modelVersion
        ) {
          return false;
        }
        return true;
      });
  }

  /** Artifacts that were superseded by a later artifact (excluded from current views). */
  supersededIds(): Set<string> {
    const out = new Set<string>();
    for (const r of this.records) {
      const s = r.artifact.links.supersedes;
      if (s) out.add(s);
      const c = r.artifact.links.correctionOf;
      if (c) out.add(c);
    }
    return out;
  }

  size(): number {
    return this.records.length;
  }

  allRecords(): readonly LedgerRecord[] {
    return this.records;
  }

  verifyIntegrity(): IntegrityResult {
    let prev = GENESIS_HASH;
    for (const record of this.records) {
      const expectedContent = computeContentHash(record.artifact);
      if (record.artifact.contentHash !== expectedContent) {
        return {
          ok: false,
          records: this.records.length,
          brokenAtSeq: record.seq,
          reason: `CONTENT_TAMPERED: artifact '${record.artifact.artifactId}' contentHash no longer matches content`,
        };
      }
      const expectedChain = sha256Hex(prev + record.artifact.contentHash);
      if (record.chainHash !== expectedChain || record.prevChainHash !== prev) {
        return {
          ok: false,
          records: this.records.length,
          brokenAtSeq: record.seq,
          reason: "CHAIN_BROKEN: hash chain does not reproduce — records reordered, removed, or altered",
        };
      }
      prev = record.chainHash;
    }
    return { ok: true, records: this.records.length, brokenAtSeq: null, reason: null };
  }

  toJSONL(): string {
    return this.records.map((r) => JSON.stringify(r)).join("\n");
  }

  /**
   * Rebuild a ledger from JSONL. Every record is re-appended through the same
   * validation path, then the persisted chain is compared against the rebuilt
   * one — a mutated file fails loudly instead of resuming silently.
   */
  static fromJSONL(jsonl: string):
    | { ok: true; ledger: LoopLedger }
    | { ok: false; reason: string } {
    const ledger = new LoopLedger();
    const lines = jsonl.split("\n").filter((l) => l.trim().length > 0);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      let parsed: LedgerRecord;
      try {
        parsed = JSON.parse(line) as LedgerRecord;
      } catch {
        return { ok: false, reason: `MALFORMED_LINE: line ${index} is not valid JSON` };
      }
      const result = ledger.append(parsed.artifact);
      if (result.status === "rejected") {
        return { ok: false, reason: `REPLAY_REJECTED at line ${index}: ${result.reason}` };
      }
      const rebuilt = ledger.allRecords()[ledger.size() - 1];
      if (rebuilt.chainHash !== parsed.chainHash) {
        return {
          ok: false,
          reason: `CHAIN_MISMATCH at line ${index}: persisted chain hash does not reproduce — file altered`,
        };
      }
    }
    return { ok: true, ledger };
  }
}
