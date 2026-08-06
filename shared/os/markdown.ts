/**
 * shared/os/markdown.ts — the ONE fence-aware markdown reader for `/os/`.
 *
 * WHY THIS MODULE EXISTS. The `/os/` artifact parsers read structure out of
 * markdown, and a fenced code block is the one construct that looks exactly like
 * content while meaning the opposite: it is an EXAMPLE. Getting that wrong is not
 * cosmetic. The #403/#405 audit demonstrated two live consequences on `main`:
 *
 *   1. A fenced example whose first line was `## Activity paths` REPLACED the
 *      goal record's real declaration. `contradiction.mts` then printed
 *      "declared example/only/**" and "contradiction YES" against work that was
 *      100% on-goal — an inverted governance verdict, exit 0, no warning.
 *   2. A fenced example mentioning `## Constraints` SATISFIED that required
 *      field, so a record could omit the section entirely and still parse.
 *
 * Both had the same root cause: heading location ran against the raw document,
 * and fences were only stripped from an already-selected slice — so stripping
 * could never affect *where* a section was found. Fences are now removed once,
 * from the whole document, before anything is located.
 *
 * It is a module rather than a helper in each parser because `goal.ts` and
 * `loop.ts` both need it, and a copied helper is the D4 second-reality defect
 * this program has already paid for twice.
 */

/**
 * Blank every fenced code block, preserving line count.
 *
 * Follows CommonMark's fence rules closely enough to be correct on real
 * documents: a fence opens with three or more backticks or tildes at the start of
 * a line, and closes only on the SAME character at the SAME length or longer.
 * A naive toggle gets this wrong in the most ordinary case there is — a
 * four-backtick fence wrapping a three-backtick example, which is how fenced
 * markdown is documented.
 */
export function stripFences(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let fenceChar: string | null = null;
  let fenceLen = 0;

  for (const line of lines) {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceChar === null) {
      if (m) {
        fenceChar = m[1][0];
        fenceLen = m[1].length;
        out.push("");
        continue;
      }
      out.push(line);
      continue;
    }
    // Inside a fence: only a closing marker of the same char and >= length ends it.
    if (m && m[1][0] === fenceChar && m[1].length >= fenceLen) {
      fenceChar = null;
      fenceLen = 0;
    }
    out.push("");
  }
  // An unclosed fence runs to the end of the document, which is CommonMark's rule
  // and the safe reading: content nobody closed is not content anyone declared.
  return out.join("\n");
}

/** Is there a real `## <heading>` — not one that only appears inside a fence? */
export function hasHeading(md: string, heading: string): boolean {
  return new RegExp(`^##\\s+${escapeRe(heading)}\\s*$`, "im").test(stripFences(md));
}

/**
 * The body of one `## Section`, ending at the next heading OF ANY LEVEL.
 *
 * Fences are removed from the whole document FIRST, so a fenced example can
 * neither be mistaken for the section nor truncate it.
 */
export function sectionBody(md: string, heading: string): string {
  const clean = stripFences(md);
  const after = clean.split(new RegExp(`^##\\s+${escapeRe(heading)}\\s*$`, "im"))[1] ?? "";
  return after.split(/^#{1,6}\s/m)[0];
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
