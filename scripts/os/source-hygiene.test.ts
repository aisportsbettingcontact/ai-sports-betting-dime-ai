/**
 * scripts/os/source-hygiene.test.ts — the /os/ tree must stay reviewable.
 *
 * WHY THIS EXISTS. `shared/os/goal.ts` shipped in PR #398 carrying two literal
 * NUL bytes, used as an internal sentinel in the glob-to-regex translation. The
 * code was correct — NUL is in fact the *safest* sentinel, because POSIX forbids
 * it in a path, so it can never collide with real input. But a raw control byte
 * in source has three costs that outweigh that:
 *
 *   1. git classifies the file as BINARY. `git diff` shows `Bin 0 -> 4863 bytes`
 *      and `--numstat` reports a dash for each side. A change to it cannot be
 *      reviewed, blamed, or three-way merged. A governance file that cannot be
 *      reviewed is a poor governance file.
 *   2. It is INVISIBLE. A NUL renders as a space in every viewer we use, so the
 *      line reads as if the sentinel were a space. That is a trap: the obvious
 *      "cleanup" to a literal space silently breaks any glob containing a space
 *      (`docs/a b/**` would then match `docs/aXXXb/x.md`). Verified by probe.
 *   3. Tooling disagrees about it. This repo's own Bash tool refuses a command
 *      containing control characters outright.
 *
 * The fix keeps the NUL *value* — it is the right sentinel — and writes it as a
 * backslash-u escape, so the source stays pure text and the intent is legible.
 *
 * This test guards the whole mission tree, not just the one file, because the
 * defect's cause (source written out through a shell) applies everywhere in it.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "..", "..");

/** git's empty-tree object — diffing against it yields "the whole file". */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** Every tracked file in the trees this mission owns. */
function missionFiles(): string[] {
  const out = execFileSync(
    "git",
    ["ls-files", "--", "shared/os", "scripts/os", "os", ".github/workflows/os-*.yml"],
    { cwd: REPO, encoding: "utf8" },
  );
  return out.split("\n").filter(Boolean);
}

describe("os source hygiene", () => {
  const files = missionFiles();

  it("finds the mission tree (guards against a vacuous pass)", () => {
    // If the pathspec ever stops matching, every assertion below would pass on
    // an empty set and report green. Fail loudly instead.
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain("shared/os/goal.ts");
  });

  it("no file in the /os/ tree contains a NUL byte", () => {
    const offenders = files
      .map((f) => {
        const buf = readFileSync(join(REPO, f));
        let n = 0;
        for (const b of buf) if (b === 0) n++;
        return `${f} (${n} NUL)`;
      })
      .filter((s) => !s.endsWith("(0 NUL)"));

    expect(
      offenders,
      "a raw NUL makes the file binary to git — write the escape sequence instead",
    ).toEqual([]);
  });

  it("the contradiction script owns no matcher of its own (D4: one reality)", () => {
    // PR #398 shipped scripts/os/contradiction.mjs with its own inline copy of the
    // glob translation, using a SPACE where the library uses NUL. The two gave
    // different answers on a glob containing a space, and the script — not the
    // library — is what produced the number written into GR-0001. The tested code
    // was not the running code. This asserts they cannot diverge again.
    const src = readFileSync(join(REPO, "scripts/os/contradiction.mts"), "utf8");

    expect(src, "the script must consume the shared, tested matcher").toMatch(
      /from\s+"\.\.\/\.\.\/shared\/os\/goal\.js"/,
    );
    // Any locally-built RegExp over a glob is a second implementation by definition.
    expect(
      /new RegExp\(/.test(src),
      "the script constructs its own RegExp — matching logic belongs only in shared/os/goal.ts",
    ).toBe(false);
    expect(
      /replace\(\/\\\*\\\*\/g/.test(src),
      "the script translates globs itself — that is the duplicate reality this guards",
    ).toBe(false);
  });

  it("git does not classify any mission file as binary", () => {
    // The property that actually matters, asserted directly rather than inferred
    // from the byte scan above: `--numstat` prints "-" for both sides of a binary
    // file. This is the check a reviewer's experience actually depends on.
    // Diff the empty tree against the WORKING TREE, not against HEAD. Comparing
    // to HEAD would test the last commit rather than the change in hand, so the
    // guard would go green on a defect that had not been committed yet — exactly
    // backwards for a pre-commit gate.
    const binary = files.filter((f) => {
      const out = execFileSync("git", ["diff", "--numstat", EMPTY_TREE, "--", f], {
        cwd: REPO,
        encoding: "utf8",
      });
      return out.startsWith("-\t-\t");
    });

    expect(binary, "these files are binary to git, and therefore unreviewable").toEqual([]);
  });
});
