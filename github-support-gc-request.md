# GitHub Support request — post-rewrite garbage collection

Submit via the support portal flow you have open. Paste the body below.

---

**Subject:** Sensitive data removal — run gc + remove cached views/PR references after history rewrite

**Body:**

Repository: `aisportsbettingcontact/ai-sports-betting-dime-ai` (owner: aisportsbettingcontact)

On 2026-08-05 we completed an authorized sensitive-data history rewrite with
git-filter-repo, removing an internal session-log directory (`.manus-logs/`,
~607MB uncompressed across 327 blobs) from all history. Client-side work is
complete per the "Removing sensitive data from a repository" docs:

- rewrote history with `git filter-repo --path .manus-logs --invert-paths`,
- force-pushed rewritten `main` (old tip `37cb4ee98367ebaef6ac1ee6775122b2e2258e88`,
  new tip `730274aa4060d5c78f49d90f90b36d7c14dc2089`),
- deleted the 38 stale branches that carried the data and force-pushed rewritten
  replacements for the remaining 34 branches and the `clean-baseline-20260709` tag,
- verified zero `.manus-logs` objects are reachable from any current ref,
- clone cleanup is coordinated (single-maintainer repository).

Details the docs ask us to include:

- **Repository owner and name:** aisportsbettingcontact / ai-sports-betting-dime-ai
- **Number of affected pull requests:** 353 (all PRs — every PR predates the
  rewrite, so all closed/merged PR views reference pre-rewrite commit IDs)
- **First Changed Commit (git-filter-repo):** `441055edce9a017d3c11007741b880bbd5031c2b`
  (old ID; rewritten to `58ad5cdb9374d32f3675bf0da73cfa2a368355b7`)
- **Orphaned LFS objects:** none — the repository does not use Git LFS and
  git-filter-repo reported no LFS objects
- **Forks:** none (forks_count = 0), so no fork-side copies exist

The pre-rewrite objects are still resident server-side — e.g. old commits
`37cb4ee98367ebaef6ac1ee6775122b2e2258e88` and
`5f5b1846eb7b0cd4a5f939acbbf665413ca02f7c` remain retrievable by SHA, and old
pull-request views still render the purged `.manus-logs/*` paths.

Please:

1. dereference/de-cache the affected pull requests,
2. remove cached views of the purged paths,
3. run server-side garbage collection to expunge the unreachable pre-rewrite objects.

The repository itself must remain intact — this is a history-data purge only,
not a repository deletion.

Thank you.
