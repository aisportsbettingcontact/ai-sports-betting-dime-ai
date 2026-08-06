#!/usr/bin/env node
/**
 * scripts/os/ledger-append.mjs — append one loop-cycle artifact per merge to main.
 *
 * Writes to the ORPHAN branch `os-ledger`, which is VERIFIED deploy-inert: both
 * Railway services pin source.branch = "main", so pushing here never deploys.
 *
 * Idempotent: replaying the same merge appends nothing (dedupe on id+contentHash).
 * --dry-run prints the artifact and touches no branch.
 */
import { execFileSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";

const DRY = process.argv.includes("--dry-run");
const shaArg = process.argv.indexOf("--sha");
const repoArg = process.argv.indexOf("--repo");

// Read git facts from the REPO; write the ledger to CWD. These are different
// places in the workflow (the repo checkout vs the os-ledger worktree), and
// conflating them made the script untestable outside a git directory.
const REPO = repoArg > -1 ? process.argv[repoArg + 1] : process.env.GITHUB_WORKSPACE || process.cwd();

// SECURITY (CodeQL js/indirect-command-line-injection). Arguments reach this
// script from argv, so git is invoked via execFileSync with an ARRAY of args and
// no shell. There is no string a caller can craft that becomes a second command.
const git = (...args) => execFileSync("git", args, { encoding: "utf8", cwd: REPO }).trim();

// Defence in depth lives in shared/os/cycle.ts so it is covered by the required
// Vitest job rather than duplicated here untested.
function assertRevish(v) {
  if (!v || v.length > 255 || v.startsWith("-") || !/^[0-9a-zA-Z._/-]+$/.test(v)) {
    throw new Error(`refusing suspicious commit-ish: ${JSON.stringify(v)}`);
  }
  return v;
}

const commitSha = shaArg > -1 ? assertRevish(process.argv[shaArg + 1]) : git("rev-parse", "HEAD");
const treeSha = git("rev-parse", `${commitSha}^{tree}`);
const subject = git("log", "-1", "--format=%s", commitSha);
// The PR title lives in the merge commit BODY; the subject is "Merge pull request #N from ...".
const body = git("log", "-1", "--format=%b", commitSha);
const prTitle = body.split("\n").map((l) => l.trim()).find(Boolean) || subject;
const mergedAt = new Date(git("log", "-1", "--format=%cI", commitSha)).toISOString().replace(/\.\d{3}/, "");
const m = subject.match(/Merge pull request #(\d+)/);
const prNumber = m ? Number(m[1]) : 0;
let filesChanged = 0;
try {
  filesChanged = git("diff", "--name-only", `${commitSha}^1`, commitSha).split("\n").filter(Boolean).length;
} catch {
  /* root commit or shallow clone — leave 0 rather than guess */
}

const material = JSON.stringify({ commitSha, treeSha, prNumber, mergedAt, filesChanged });
const d = new Date(mergedAt); d.setUTCDate(d.getUTCDate() + 2);
const artifact = {
  id: `merge-${commitSha.slice(0, 12)}`,
  type: "loop_cycle",
  loop: "LOOP-001-engineering-build",
  commitSha, treeSha, prNumber,
  prTitle,
  mergedAt, filesChanged,
  gates: { proofContractRunId: process.env.PROOF_CONTRACT_RUN_ID || null },
  outcome: null,
  observe_by: d.toISOString().slice(0, 10),
  contentHash: createHash("sha256").update(material).digest("hex"),
};

if (DRY) { console.log(JSON.stringify(artifact, null, 2)); process.exit(0); }

const LEDGER = "cycles.jsonl";
// SECURITY (CodeQL js/file-system-race). No existsSync-then-readFileSync: that
// check-then-act pair is a TOCTOU window. Read once and treat "missing" as the
// empty ledger, which is also simply correct on the very first append.
let existing = [];
try {
  existing = readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
} catch (err) {
  if (err.code !== "ENOENT") throw err;
}
if (existing.some((e) => e.id === artifact.id && e.contentHash === artifact.contentHash)) {
  console.log(`[os-ledger] duplicate ${artifact.id} — nothing appended (idempotent)`);
  process.exit(0);
}
writeFileSync(LEDGER, existing.concat(artifact).map((o) => JSON.stringify(o)).join("\n") + "\n");
console.log(`[os-ledger] appended ${artifact.id} (PR #${artifact.prNumber}, observe_by ${artifact.observe_by})`);
