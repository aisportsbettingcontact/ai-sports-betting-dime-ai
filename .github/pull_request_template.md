<!-- A large PR with an empty body is not release-ready. Every section below is
required; write "none" explicitly where a section does not apply. -->

## Purpose and scope
<!-- What this PR does and deliberately does not do. -->

## Linked incident / finding
<!-- INCIDENTS.md entry, issue number, audit finding, or "none". -->

## User-facing behavior changes
<!-- Every change a user can observe, including changed defaults and routes.
"Mechanical refactor" claims require the diff to contain zero behavior change. -->

## Reproduction evidence
<!-- For each fixed defect: how it was reproduced BEFORE the fix (command/test
+ failing output reference). A fix without a reproduced defect is a guess. -->

## Tests
- Added/changed tests:
- Full counts (passed / failed / skipped / not executed):
- Skipped tests and the declared reason for each:

## Bundle impact
<!-- check:bundle output: critical-path bytes vs budget. "Not measured" fails review. -->

## Database impact
<!-- Schema changes (db-push workflow required BEFORE deploy), data migrations, or "none". -->

## Security impact
<!-- Auth paths, redirects, secrets, preview/debug gates touched? Scanner results. -->

## Accessibility impact
<!-- Keyboard, focus, inert, reduced-motion, contrast. -->

## Deployment and rollback plan
<!-- What deploys when this merges (Railway auto-deploys main), how to verify
(smoke commands), and the exact rollback target SHA. -->

## Authorization
- [ ] CI green (all required checks)
- [ ] Owner has explicitly authorized merging this PR
- [ ] Post-deployment validation plan below

## Post-deployment validation
<!-- Exact commands/checks to run after deploy, e.g.
node scripts/smoke-deploy.mjs https://aisportsbettingmodels.com -->
