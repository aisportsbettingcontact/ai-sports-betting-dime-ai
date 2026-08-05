/**
 * shared/os/artifacts.ts — the /os/ artifact contract (ISSUE-006 + ISSUE-007).
 *
 * Three pure functions, no I/O, so they run in the already-required `Vitest`
 * job with no credentials and no new required status check:
 *
 *   parseArtifactHeader   — reads the header conventions /os/ artifacts already use
 *   findOverdue           — the ISSUE-007 clock: which open items have gone quiet
 *   findSupersededClaims  — the ISSUE-006 sweep: which live artifact still asserts
 *                           a claim another artifact has marked refuted
 *
 * WHY THESE THREE. During Stages 1-4 the executor produced three self-inflicted
 * defects — two merge races and a half-finished correction — each invisible to
 * the push, to the green PR, and to CI, and each caught only by an after-the-fact
 * audit run by hand. `findSupersededClaims` is that hand-audit, automated. It is
 * the check that would actually have caught the real defect; a frontmatter
 * validator would not have.
 */

/** Statuses that mean an item is settled and no longer owes an observation. */
const CLOSED_PREFIXES = ["RULED", "CLOSED", "RESOLVED", "COMPLETE", "DONE", "SUPERSEDED"];

/**
 * Markers indicating a line is *correcting* a claim rather than asserting it.
 *
 * Deliberately UNAMBIGUOUS and case-sensitive for the shouted ones. An earlier
 * version included `stale`, `resolved`, `closed` and `answered` matched
 * case-insensitively — and ordinary prose defeated it: "Known **stale**ness"
 * and "remain un**resolved**" sat three lines above an assertion and silently
 * blessed it. A marker that appears in normal writing is not a marker.
 */
const CORRECTION_MARKERS = [
  "REFUTED",
  "SUPERSEDED",
  "CORRECTED",
  "~~",
  "was believed",
  "were believed",
  "Original text",
  "Original scope",
  "premise was wrong",
  "premise refuted",
  "this reading was wrong",
  "**Status:** CLOSED",
  "**Status:** RULED",
  "RESOLVED 20",
  "ANSWERED 20",
];

export interface ArtifactHeader {
  status: string | null;
  kind: string;
  observeBy: string | null;
}

export interface OpenItem {
  path: string;
  status: string | null;
  observeBy: string | null;
}

export interface OverdueItem {
  path: string;
  observeBy: string | null;
  /** Whole days past `observeBy`; null when the item declared no date at all. */
  daysOverdue: number | null;
}

export interface ArtifactFile {
  path: string;
  body: string;
}

/** Pull a `**Field:** value` out of a markdown header block. */
function headerField(md: string, field: string): string | null {
  const re = new RegExp(`\\*\\*${field}:\\*\\*\\s*([^\\n·]+)`, "i");
  const m = md.match(re);
  return m ? m[1].trim() : null;
}

/**
 * Read the header conventions /os/ artifacts already use. Deliberately NOT YAML
 * frontmatter: the 53 existing artifacts use `**Field:**` lines, and rewriting
 * all of them would be a large mechanical change buying nothing this parser
 * cannot already read.
 */
export function parseArtifactHeader(md: string): ArtifactHeader {
  return {
    status: headerField(md, "Status"),
    kind: headerField(md, "Kind") ?? "decision",
    observeBy: headerField(md, "observe_by"),
  };
}

function isClosed(status: string | null): boolean {
  if (!status) return false;
  const s = status.toUpperCase();
  return CLOSED_PREFIXES.some((p) => s.startsWith(p));
}

/**
 * The clock. An open item is overdue when its `observe_by` has passed — or when
 * it never declared one at all.
 *
 * That second case is the point of the whole mechanism: the 2026-07-28 program
 * died because five owner-gated items sat for eight days and nothing noticed. An
 * item with no date is not "fine", it is unobservable, so it is reported
 * immediately with `daysOverdue: null`. It must be impossible to write "blocked
 * on owner" without also writing when that silence becomes a defect.
 */
export function findOverdue(items: OpenItem[], asOf: Date): OverdueItem[] {
  const out: OverdueItem[] = [];
  for (const item of items) {
    if (isClosed(item.status)) continue;
    if (item.observeBy === null) {
      out.push({ path: item.path, observeBy: null, daysOverdue: null });
      continue;
    }
    const due = new Date(`${item.observeBy}T00:00:00Z`);
    if (Number.isNaN(due.getTime())) {
      out.push({ path: item.path, observeBy: item.observeBy, daysOverdue: null });
      continue;
    }
    const days = Math.floor((asOf.getTime() - due.getTime()) / 86_400_000);
    if (days > 0) out.push({ path: item.path, observeBy: item.observeBy, daysOverdue: days });
  }
  return out;
}

/** How many lines either side of an assertion may carry its correction. */
const CORRECTION_PROXIMITY = 3;

/**
 * The sweep. Given claim terms refuted elsewhere, find every *live* artifact
 * still asserting one without marking it corrected.
 *
 * A correction counts if it appears within `CORRECTION_PROXIMITY` lines of the
 * assertion — because in practice the marker lands on a neighbouring line: a
 * `**Status:** CLOSED` under a title, or a "*Original text:*" lead-in above a
 * retained quote. Requiring same-line markers produced false positives on five
 * artifacts that were in fact correctly corrected.
 *
 * Three deliberate exclusions:
 *  - `appendix/` paths, which are immutable point-in-time evidence. Editing them
 *    would falsify the record of what was found and when.
 *  - lines near a correction marker, matched case-insensitively.
 *  - `exemptPaths`, for artifacts whose *subject* is the error — the correcting
 *    audit itself, and the lesson that narrates it. Each must be named
 *    explicitly, so exempting one is a visible decision rather than a silent
 *    widening of the rule.
 */
export function findSupersededClaims(
  files: ArtifactFile[],
  terms: string[],
  exemptPaths: string[] = [],
): ArtifactFile[] {
  const hits: ArtifactFile[] = [];

  for (const file of files) {
    if (file.path.includes("/appendix/")) continue;
    if (exemptPaths.some((p) => file.path.endsWith(p))) continue;

    const lines = file.body.split("\n");
    const corrected = lines.map((l) =>
      CORRECTION_MARKERS.some((m) =>
        // Shouted markers are case-sensitive so prose cannot impersonate them;
        // the sentence-case ones are matched case-insensitively.
        m === m.toUpperCase() ? l.includes(m) : l.toLowerCase().includes(m.toLowerCase()),
      ),
    );

    const offending = lines.filter((line, i) => {
      if (!terms.some((t) => line.includes(t))) return false;
      const from = Math.max(0, i - CORRECTION_PROXIMITY);
      const to = Math.min(lines.length - 1, i + CORRECTION_PROXIMITY);
      for (let j = from; j <= to; j++) if (corrected[j]) return false;
      return true;
    });

    if (offending.length > 0) hits.push(file);
  }
  return hits;
}
