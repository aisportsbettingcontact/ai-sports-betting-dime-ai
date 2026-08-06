# ISSUE-016 — Make the Level-4 rescore repeatable and signable

**Wave:** 4 — Certification · **Effort:** M · **Status:** NOT STARTED · **DRI:** Prez
**Ruling dependency:** DR-014 Ruling 4
**Doctrine:** D1 (the central test + four levels) · D16 criterion 1

---

## Scope

The Level-2 score came from an **84-agent, 6,134,033-token one-off**. Nothing makes the rescore
repeatable, and nothing names who signs it. Criterion 1 has **no owner for its instrument**.

Certification requires the rescore to be reproducible by a fresh-context verifier and countersigned
by Prez. A score that cannot be re-derived is an opinion.

## Files

- Create: `scripts/os/level-score.mjs` (the deterministic half — layer inventory, loop closure, artifact counts)
- Create: `os/audits/RESCORE-PROTOCOL.md` (the judgment half — what a verifier must read and assess)
- Create: `os/certification/` scaffold

## Acceptance criteria

Every criterion is checkable. A criterion that cannot be checked is not a criterion.

- [ ] The deterministic half computes from artifacts, not from prose: layers implemented, loops with a completed live cycle, artifacts with resolvable links, seats chartered, overdue items
- [ ] The judgment half is a written protocol a **fresh-context** verifier can follow without this conversation
- [ ] Re-running the deterministic half on unchanged inputs produces an **identical** result (verified by running twice and diffing)
- [ ] The protocol names the signature requirement: fresh-context verifier signs, Prez countersigns
- [ ] The score is evidence-linked per criterion — **PARTIAL and MISSING are failing grades** and route back through the cycle
- [ ] The protocol states which criteria this mission expects to score PARTIAL (4 and 6) and why, **before** scoring, so the result cannot be rationalized afterwards

## Verification

Run these and paste the raw output. Per `OPERATING-RULES.md` Rule 6, a DONE claim without
this evidence is void.

```bash
node scripts/os/level-score.mjs > /tmp/score1.json
node scripts/os/level-score.mjs > /tmp/score2.json
diff /tmp/score1.json /tmp/score2.json && echo "DETERMINISTIC"   # expect no diff
```

## Depends on

Waves 0-3.

## If the ruling differs

No record claimed this.
