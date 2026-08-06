/**
 * shared/os/goal.ts — goal records (ISSUE-011, doctrine L1).
 *
 * Doctrine L1 requires `os/goals/GR-####-*.md` carrying NINE fields. The Stage 1
 * audit found no goal record type existed anywhere, and DR-014 recorded the
 * consequence: D16 criteria 2, 5 and 9 all fail on that one missing type, and
 * D13's founder-loop flagship requirement — "surfaces contradictions: a claimed
 * priority that engineering activity ignores" — is not computable at all.
 *
 * `findPriorityContradiction` is what makes it computable. A goal declares the
 * paths it expects work to land in; the engineering loop's cycle artifacts say
 * where work actually landed. Divergence is a contradiction the founder loop can
 * surface without anyone remembering to look.
 */

/** The nine L1 fields, as section headings. Order is the doctrine's order. */
export const GOAL_FIELDS = [
  "Desired outcome",
  "The need behind it",
  "Evidence that justified pursuing it",
  "Acceptance criteria",
  "Constraints",
  "Time horizon",
  "Responsible individual",
  "Current status",
  "Evaluation measures",
] as const;

export interface Goal {
  id: string;
  status: string | null;
  dri: string | null;
  /** Globs the goal expects engineering activity to land in. */
  activityPaths: string[];
}

export interface ContradictionResult {
  state: "ok" | "not_measured";
  contradiction: boolean;
  onGoalCycles: number;
  totalCycles: number;
  /** Share of cycles touching the goal's declared paths; null when unmeasurable. */
  onGoalShare: number | null;
  reason: string | null;
}

/** Below this share of on-goal cycles, a declared priority is contradicted. */
const CONTRADICTION_THRESHOLD = 0.5;

function field(md: string, name: string): string | null {
  const m = md.match(new RegExp(`\\*\\*${name}:\\*\\*\\s*([^\\n·]+)`, "i"));
  return m ? m[1].trim() : null;
}

/**
 * The body of one `## Section`, ending at the NEXT HEADING OF ANY LEVEL.
 *
 * Ending only at `## ` was a real defect (found auditing PR #398): a `### First
 * reading` subsection added under `## Activity paths` did not terminate the
 * section, so its prose bullets were parsed as activity-path globs and GR-0001
 * silently declared six priorities instead of four. `/^##\s/` cannot match
 * `### ` at all, because the third character is `#` rather than whitespace.
 */
function sectionBody(md: string, heading: string): string {
  const after = md.split(new RegExp(`^##\\s+${heading}\\s*$`, "im"))[1] ?? "";
  return after.split(/^#{1,6}\s/m)[0];
}

/**
 * An activity path is a path glob, never prose. Enforced because an unmatchable
 * string is not an error the check can report — it simply never matches, and the
 * goal quietly declares a priority it does not have.
 */
const ACTIVITY_PATH = /^[A-Za-z0-9._*/-]+$/;

export function parseGoal(md: string): Goal {
  const idMatch = md.match(/^#\s*(GR-\d+)/m);
  if (!idMatch) throw new Error("goal record has no `# GR-####` heading");

  const missing = GOAL_FIELDS.filter(
    (f) => !new RegExp(`^##\\s+${f}\\s*$`, "im").test(md),
  );
  // Name every missing field at once. Reporting only the first turns a single
  // fix into N round trips.
  if (missing.length > 0) {
    throw new Error(`${idMatch[1]} is missing required L1 field(s): ${missing.join(", ")}`);
  }

  // "Evaluation measures" must be a table with at least one threshold row.
  // D5: a goal specific enough to evaluate. Prose is not a measure.
  const measureRows = sectionBody(md, "Evaluation measures")
    .split("\n")
    .filter((l) => l.trim().startsWith("|") && !/^\|[\s:|-]+\|$/.test(l.trim()));
  if (measureRows.length < 2) {
    throw new Error(`${idMatch[1]} states no evaluation measure with a threshold`);
  }

  const activityPaths = sectionBody(md, "Activity paths")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("-"))
    .map((l) => l.replace(/^-\s*/, "").replace(/`/g, "").trim())
    .filter(Boolean);

  for (const p of activityPaths) {
    if (!ACTIVITY_PATH.test(p)) {
      throw new Error(
        `${idMatch[1]} declares an activity path that is not path-shaped: ${JSON.stringify(p)}`,
      );
    }
    // A glob of only wildcards and separators matches every path, which would
    // make every cycle on-goal and retire the contradiction check permanently.
    // Silent universal assent is the worst possible failure for this mechanism.
    if (!/[A-Za-z0-9]/.test(p)) {
      throw new Error(
        `${idMatch[1]} declares an activity path matching everything: ${JSON.stringify(p)}` +
          " — a universal glob makes the contradiction check vacuous",
      );
    }
  }

  return { id: idMatch[1], status: field(md, "Status"), dri: field(md, "DRI"), activityPaths };
}

/**
 * Glob match supporting a trailing `**` and `*` within a segment.
 *
 * The two-pass translation needs a sentinel to hold `**` while `*` is rewritten,
 * and that sentinel must be a character no real path can contain. NUL is the only
 * such character: POSIX forbids it in a pathname, so it cannot collide with input.
 * A printable placeholder would be wrong — a space, for instance, makes
 * `docs/a b/**` match `docs/aXXXb/x.md`.
 *
 * It is written as an escape, never as a raw byte. A literal NUL makes the file
 * binary to git (unreviewable, unblamable) and renders as a space, so the next
 * reader "cleans it up" into exactly the bug described above. See
 * `scripts/os/source-hygiene.test.ts`, which enforces this.
 */
function matches(path: string, glob: string): boolean {
  // Escape every regex metacharacter EXCEPT `*`, which the two passes below
  // consume deliberately. `?` was missing from this class and survived as a
  // quantifier, so `a?b.ts` matched `b.ts`. Only `*` and `**` are wildcards here.
  const rx = new RegExp(
    "^" +
      glob
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "\u0000")
        .replace(/\*/g, "[^/]*")
        .replace(/\u0000/g, ".*") +
      "$",
  );
  return rx.test(path);
}

/**
 * D13's founder-loop requirement, made computable: compare a goal's declared
 * priority against where engineering activity actually went.
 *
 * A cycle counts as on-goal if ANY file it changed matches a declared path —
 * deliberately generous, so a flagged contradiction is a strong signal rather
 * than an artefact of mixed commits.
 */
export function findPriorityContradiction(
  activityPaths: string[],
  cycleFilePaths: string[][],
): ContradictionResult {
  const total = cycleFilePaths.length;
  if (total === 0) {
    return {
      state: "not_measured",
      contradiction: false,
      onGoalCycles: 0,
      totalCycles: 0,
      onGoalShare: null,
      reason: "no recorded cycles yet — a share cannot be computed from zero evidence",
    };
  }
  const onGoal = cycleFilePaths.filter((files) =>
    files.some((f) => activityPaths.some((g) => matches(f, g))),
  ).length;
  const share = onGoal / total;
  return {
    state: "ok",
    contradiction: share < CONTRADICTION_THRESHOLD,
    onGoalCycles: onGoal,
    totalCycles: total,
    onGoalShare: share,
    reason:
      share < CONTRADICTION_THRESHOLD
        ? `only ${onGoal}/${total} cycles touched the declared priority paths`
        : null,
  };
}
