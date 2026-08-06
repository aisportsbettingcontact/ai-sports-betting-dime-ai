/**
 * shared/os/cycle.ts — the loop-cycle artifact appended on every merge (ISSUE-009).
 *
 * WHY MERGE-TO-MAIN. This is the strongest survival property available in the
 * plan: merge-to-main fires ~13x/day at Dime without anyone remembering to do
 * it. A mechanism riding that event cannot be forgotten, which is exactly what
 * the 2026-07-28 program's owner-gated queue could not say for itself.
 *
 * WHY `outcome` STARTS NULL. D5 is explicit that an action is not an outcome:
 * shipping is an action, adoption is an outcome. A merge is therefore only the
 * Action stage of the loop. The artifact is born with its outcome UNOBSERVED and
 * an `observe_by` date, so an unobserved merge becomes overdue on the clock
 * rather than quietly counting as success. That is the D15 #9 failure —
 * generated output mistaken for completion — designed against.
 *
 * WHY THE PROOF CONTRACT IS REFERENCED, NOT COPIED. Workflow 01 already emits
 * proof-contract.json with lockfile hashes and artifact digests. Duplicating it
 * would create a second reality (D4). The cycle artifact carries its run id.
 */
import { createHash } from "crypto";

export interface MergeFacts {
  commitSha: string;
  treeSha: string;
  prNumber: number;
  prTitle: string;
  /** ISO-8601 instant the merge landed. */
  mergedAt: string;
  filesChanged: number;
  /** Run id of 01-pr-proof-contract for the PR, or null when it did not run. */
  proofContractRunId: string | null;
}

export interface CycleArtifact {
  id: string;
  type: "loop_cycle";
  loop: string;
  commitSha: string;
  treeSha: string;
  prNumber: number;
  prTitle: string;
  mergedAt: string;
  filesChanged: number;
  gates: { proofContractRunId: string | null };
  /** null until a human or a later process observes what the merge actually did. */
  outcome: null;
  observe_by: string;
  contentHash: string;
}

/**
 * Reject anything that does not look like a commit-ish before it reaches git.
 *
 * SECURITY (CodeQL js/indirect-command-line-injection). The appender takes a
 * `--sha` from argv. git is already invoked via execFileSync with an argument
 * ARRAY and no shell, which is the real fix; this is defence in depth, and it
 * additionally blocks a leading dash so a value cannot masquerade as a git flag
 * (e.g. `--upload-pack=...`, which is command execution by another name).
 */
export function assertRevish(v: string): string {
  if (!v || v.length > 255 || v.startsWith("-") || !/^[0-9a-zA-Z._/-]+$/.test(v)) {
    throw new Error(`refusing suspicious commit-ish: ${JSON.stringify(v)}`);
  }
  return v;
}

/**
 * Extract the PR number from a GitHub merge-commit subject.
 *
 * Needed because 01-pr-proof-contract runs on `pull_request`, so its headSha is
 * the PR HEAD, never the merge commit. Linking a cycle to its proof therefore
 * requires: merge commit -> PR number -> PR head -> run. The first version
 * matched the merge SHA directly and silently recorded null on every artifact.
 */
export function prNumberFromMergeSubject(subject: string): number | null {
  const m = /^Merge pull request #(\d+)\b/.exec(subject.trim());
  return m ? Number(m[1]) : null;
}

/** How long a merge may go unobserved before the clock reports it. */
const OBSERVE_WINDOW_DAYS = 2;

function isoDatePlusDays(instant: string, days: number): string {
  const d = new Date(instant);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function buildCycleArtifact(f: MergeFacts): CycleArtifact {
  // The hash covers the material facts only — deliberately NOT observe_by or
  // any derived field, so replaying the same merge dedupes cleanly.
  const material = JSON.stringify({
    commitSha: f.commitSha,
    treeSha: f.treeSha,
    prNumber: f.prNumber,
    mergedAt: f.mergedAt,
    filesChanged: f.filesChanged,
  });
  return {
    id: `merge-${f.commitSha.slice(0, 12)}`,
    type: "loop_cycle",
    loop: "LOOP-001-engineering-build",
    commitSha: f.commitSha,
    treeSha: f.treeSha,
    prNumber: f.prNumber,
    prTitle: f.prTitle,
    mergedAt: f.mergedAt,
    filesChanged: f.filesChanged,
    gates: { proofContractRunId: f.proofContractRunId },
    outcome: null,
    observe_by: isoDatePlusDays(f.mergedAt, OBSERVE_WINDOW_DAYS),
    contentHash: createHash("sha256").update(material).digest("hex"),
  };
}

/**
 * Append must be idempotent: a re-run of the workflow on the same merge produces
 * no second record. Dedupe on (id, contentHash) — the same pair the untracked
 * `shared/loop/ledger.ts` primitive used, kept deliberately consistent.
 */
export function isDuplicate(candidate: CycleArtifact, existing: CycleArtifact[]): boolean {
  return existing.some((e) => e.id === candidate.id && e.contentHash === candidate.contentHash);
}
