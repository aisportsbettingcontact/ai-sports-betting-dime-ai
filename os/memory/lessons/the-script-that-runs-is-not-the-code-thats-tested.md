# The script that runs is not always the code that's tested

**Origin:** the post-merge audit of PR #398 (ISSUE-011, goal record) · 2026-08-06

PR #398 shipped a tested library, `shared/os/goal.ts`, with twelve passing tests covering its glob
matcher — and a runner script, `scripts/os/contradiction.mjs`, that **reimplemented the same matcher
inline**. The two used different sentinel characters for the `**` placeholder: NUL in the library,
a literal space in the script. They disagreed:

| | `docs/a b/**` vs `docs/aXXXb/x.md` |
|---|---|
| library (NUL sentinel, 12 tests) | `false` — correct |
| script (space sentinel, 0 tests) | `true` — over-matches |

**The number written into GR-0001 came from the script.** Every test result cited as evidence for it
came from the library. The evidence and the claim were about different code, and nothing in a green
CI run could have revealed that.

**Why it mattered:** this is D4's "second reality" at its most deceptive, because the duplicate was
*shorter* than importing — a fifteen-line inline regex feels like less machinery than a module
import, so the cheap-looking choice created the defect. The failure is invisible by construction: the
tests are real, they pass, and they are about the wrong artifact. A governance mechanism whose output
comes from untested code reports whatever that code happens to compute, with the full authority of a
green suite behind it.

Two compounding details worth remembering:

- The library's NUL sentinel was the *correct* choice (POSIX forbids NUL in a pathname, so it can
  never collide with input) but it was written as a **raw byte**, which made the file binary to git —
  unreviewable, unblamable, and rendered as a space in every viewer. So the reviewer's obvious
  "cleanup" was precisely the bug the script already had.
- The same audit found the parser's section splitter used `/^##\s/`, which cannot match `### `. An
  H3 subsection added to document the result was therefore parsed as *more activity-path globs* —
  **writing down the reading changed the reading.**

**How to apply:**

1. When a script and a library compute the same thing, the script imports. No exceptions for "it's
   only fifteen lines" — that is the exact size at which duplication looks cheaper than a dependency.
2. Ask of every reported number: *which file produced this, and is that file under test?* Green tests
   next to a claim are not evidence for the claim unless they cover the code that produced it.
3. Never write a control character as a raw byte in source. Use the escape. If a file is binary to
   git, it is outside review, and code outside review is where this class of defect lives.
4. When a mechanism's output is recorded in the artifact the mechanism reads, check for the feedback
   loop before publishing. Prefer a separate `##` section, dated and append-only.

Related: [[tests-can-report-green-without-asserting]] — the same shape one level up. There, an
assertion existed but bound nothing; here, assertions bound something real that was not the thing
that ran. Both produce a green suite that certifies nothing.
