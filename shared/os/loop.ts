/**
 * shared/os/loop.ts — the closed loop, enforced (ISSUE-013, doctrine D5).
 *
 * D5 calls the closed loop "the smallest complete unit of Dime" and requires
 * every important process to be captured as one, with seven components and an
 * answer to all nine interrogation questions AT ANY TIME. A loop that cannot
 * answer them is not a loop; it is a description of one.
 *
 * That distinction is the entire point, so it is enforced here rather than
 * trusted. The Stage 1 audit scored Dime Level 2 of 4 precisely because work
 * happened without anything observing whether it worked — open loops that look
 * closed from the outside. A prose file describing a loop reproduces exactly
 * that failure one level up.
 *
 * WHY DEFERRED LOOPS PARSE DIFFERENTLY. A loop that has not been designated
 * cannot answer "what did the system do?" — demanding an answer would force a
 * fabricated one, which is worse than an honest gap. So DEFERRED requires only
 * a `blocked_on:` reason, on the same principle as the authority ladder: a
 * deferral must be a decision with a reason, never a quiet omission.
 */
import { stripFences, escapeRe } from "./markdown";

/** D5's nine-question interrogation, in the doctrine's order. */
export const LOOP_QUESTIONS = [
  "What objective controls this process?",
  "Who owns the result?",
  "What evidence informed the most recent action?",
  "What did the system do?",
  "What artifact records it?",
  "What happened afterward?",
  "How was the result evaluated?",
  "What changed because of the evaluation?",
  "What knowledge will influence the next cycle?",
] as const;

/** The seven components of the D5 cycle. */
export const LOOP_COMPONENTS = [
  "Goal",
  "Context",
  "Action",
  "Artifact",
  "Outcome",
  "Evaluation",
  "Adjustment + Memory",
] as const;

export interface Loop {
  id: string;
  status: string | null;
  dri: string | null;
  /** The goal record this loop serves. Required while ACTIVE. */
  goal: string | null;
  blockedOn: string | null;
  /** Answers keyed by question number, 1-9. */
  answers: Map<number, string>;
}

function field(md: string, name: string): string | null {
  const m = stripFences(md).match(new RegExp(`\\*\\*${name}:\\*\\*\\s*([^\\n·]+)`, "i"));
  return m ? m[1].trim() : null;
}

/**
 * The text answering question `n`, or null when the heading is absent.
 * Returns "" when the heading exists but nothing follows it — an unanswered
 * question, which is the failure this is built to catch.
 */
function answer(md: string, n: number): string | null {
  const clean = stripFences(md);
  const rx = new RegExp(`^##\\s+${n}\\.\\s+${escapeRe(LOOP_QUESTIONS[n - 1])}\\s*$`, "im");
  const parts = clean.split(rx);
  if (parts.length < 2) return null;
  return parts[1].split(/^#{1,6}\s/m)[0].trim();
}

export function parseLoop(md: string): Loop {
  const idMatch = md.match(/^#\s*(LOOP-\d+)/m);
  if (!idMatch) throw new Error("loop record has no `# LOOP-####` heading");
  const id = idMatch[1];

  const status = field(md, "Status");
  const blockedOn = field(md, "blocked_on");
  const S = (status ?? "").toUpperCase();

  if (S.startsWith("DEFERRED")) {
    // A deferred loop owes a reason, not nine answers it cannot honestly give.
    if (!blockedOn) {
      throw new Error(`${id} is DEFERRED but states no blocked_on: reason — a deferral must be a decision`);
    }
    return { id, status: S, dri: field(md, "DRI"), goal: field(md, "Goal"), blockedOn, answers: new Map() };
  }

  const goal = field(md, "Goal");
  if (!goal) {
    throw new Error(`${id} names no goal record — D5: a loop's objective must be specific enough to evaluate`);
  }

  const answers = new Map<number, string>();
  const missing: number[] = [];
  const unanswered: number[] = [];
  for (let n = 1; n <= LOOP_QUESTIONS.length; n++) {
    const a = answer(md, n);
    if (a === null) missing.push(n);
    else if (a === "") unanswered.push(n);
    else answers.set(n, a);
  }
  // Report every gap at once. Reporting the first turns one fix into N round trips.
  if (missing.length > 0) {
    throw new Error(
      `${id} does not ask D5 question(s) ${missing.join(", ")}: ` +
        missing.map((n) => `"${LOOP_QUESTIONS[n - 1]}"`).join("; "),
    );
  }
  if (unanswered.length > 0) {
    throw new Error(`${id} leaves D5 question(s) ${unanswered.join(", ")} unanswered — the heading is empty`);
  }

  const body = stripFences(md);
  const absent = LOOP_COMPONENTS.filter((c) => !new RegExp(`^\\|\\s*${escapeRe(c)}\\s*\\|`, "im").test(body));
  if (absent.length > 0) {
    throw new Error(`${id} omits D5 component(s): ${absent.join(", ")}`);
  }

  return { id, status: S, dri: field(md, "DRI"), goal, blockedOn, answers };
}

/**
 * Wiki-links in a loop that resolve to no known artifact.
 *
 * D6 requires artifacts to form semantic connections; a link to something that
 * does not exist is the opposite — it reads as evidence and carries none. This
 * is what makes the cross-link between two loops *demonstrated* rather than
 * asserted: the id LOOP-002 produces must actually resolve.
 */
export function findUnresolvedCrossLinks(md: string, known: Set<string>): string[] {
  const out: string[] = [];
  const body = stripFences(md);
  const rx = /\[\[([^\]]+)\]\]/g;
  // Explicit exec loop rather than matchAll: the TypeScript program this file now
  // belongs to (added in #405) targets a level without downlevelIteration, so
  // iterating the returned iterator is a compile error.
  let m: RegExpExecArray | null;
  while ((m = rx.exec(body)) !== null) {
    const target = m[1].trim();
    if (!known.has(target) && !out.includes(target)) out.push(target);
  }
  return out;
}
