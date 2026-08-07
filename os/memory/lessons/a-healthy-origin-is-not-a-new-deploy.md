# A healthy origin is not a new deploy

**Origin:** Incident 64 · 2026-08-07

The repository moved from one GitHub account to another. A transfer drops the repo out of the old
account's GitHub App installations, so Railway stopped receiving push events. PR #432 merged and
produced **no deployment at all** — not queued, not failed, no record.

`deploy-smoke` ran on that merge commit anyway, `10:33:44Z → 10:38:04Z`, and concluded **success**.
The Railway deployment for the commit was not created until `11:13:08Z`, thirty-five minutes later.

The workflow is not wrong about anything it actually checked. It sleeps four minutes, then asserts
`/health → 200` and that the schema gate is satisfied. Production *was* healthy the whole time — it
was serving the previous commit. Every assertion passed and the conclusion drawn from them was false.

**Why it mattered:** the deploy law — *merge to `main` IS a production deploy* — is the apply step
of LOOP-001 and the premise under every "shipped" claim in the repo. It was false for ~40 minutes
and the one gate built to verify deployment certified the opposite. It was found because a human
asked "is it deploying?", not because anything went red.

The reason no assertion could have caught it: `/health` returns
`{db, integrations, schema, status, ts}`. There is **no commit, version or build identifier in the
response**. Nothing the server says distinguishes "the new build is answering" from "the old build
is answering". The smoke test was not badly written; it was asked to verify a property the system
does not expose.

Note what did behave correctly: `os-ledger-append` fired 2s after the merge and wrote a cycle
artifact with `outcome: null`. That is the honest record — an action happened, its outcome was never
observed. The signal existed. Nothing consumed it.

**How to apply:**

1. **A deployment check must assert identity, not liveness.** "The site responds 200" answers a
   different question than "the thing I just built is what is responding". If the running artifact
   cannot name itself, no downstream test can verify a deploy — fix the exposure before writing more
   assertions.
2. **Ship a build stamp with the artifact.** A commit SHA on `/health` (or any readable endpoint)
   converts an unfalsifiable claim into a one-line assertion: `expect(health.commit === GITHUB_SHA)`.
3. **When a gate infers rather than observes, name the inference.** `deploy-smoke` inferred "the
   deploy happened" from "the origin is healthy" plus a `sleep 240`. A sleep is a guess about
   timing, and a guess is where this class of bug lives.
4. **An `outcome: null` that never resolves is a finding.** The ledger recorded the action honestly;
   nothing asked why the outcome never arrived. An artifact whose outcome stays null past a
   threshold is the cheapest available detector for "applied but never took effect".
5. **Account transfers break integrations silently.** GitHub redirects the old path for API and git
   traffic, so most things keep working and the broken ones fail by *omission* — no error, no event.
   After any transfer, enumerate what was installed on the old account.

Related: [[a-green-cron-is-not-a-run]], [[tests-can-report-green-without-asserting]] and
[[a-formatter-can-disable-a-control-path]] — the same family. Something reported success, and the
success described a different thing than the one everyone assumed.
