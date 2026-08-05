# In inherited context, narrative claims survive verification and specific numbers usually do not

**Discovered 2026-08-05** while verifying the mission brief's 110 claims against the repo.

A clean pattern emerged. Claims describing *what something is* traced to real artifacts. Claims
carrying a *specific count* were almost all unsourced:

| Claimed | Actual |
|---|---|
| 28 landing-page assertions | 14 cases / 38 `expect()`s — 28 matches nothing at any point in git history |
| 91/100 composite, 2 blockers open | No such number in the repo, PR body, or comments; blockers **closed** 2026-07-12 |
| nine subscription states | No nine-member enum; three non-overlapping vocabularies of 8, 4, and 11 |
| seven hard gates | 11 hard failures / 15 machine gates / 9 zero-tolerance items |
| four scored dimensions | 6 / 9 / 7 depending on which set; and they belong to a *different pipeline* |
| 32 Mint seats, three groupings | **No design document has ever existed.** "Assay" has zero occurrences repo-wide |
| 400K Monte Carlo iterations | **Exactly 400,000** — one of the few that survived |

**Why it mattered:** the false numbers were not lies; they were the residue of earlier summarisation,
where a plausible figure got fixed in narrative and then re-inherited as fact. Several had traceable
origins — "Rules 1/2/3" came from a verbatim transcript dump of a one-off owner prompt to Codex, and
the "four dimensions / banned AI slop" attributes were transplanted onto the wrong pipeline entirely.

**How to apply:**
- Treat every inherited number as UNKNOWN until you open the file and count. Say "N, counted at
  `path:line`".
- Report the real shape when the number is wrong, not just "refuted" — the real shape is what the
  next reader needs.
- When you write a number into an artifact, cite where it can be recounted.
