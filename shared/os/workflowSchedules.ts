/**
 * shared/os/workflowSchedules.ts — read the `on.schedule` crons out of a workflow.
 *
 * WHY THIS REPLACES A REGEX SCAN. The LOOP-002 precision audit measured what the
 * previous line-by-line scanner actually did, against five workflow shapes GitHub
 * accepts. Of four that genuinely declared a schedule it found ONE — and that one
 * aborted the whole observation. It also invented two schedules that did not exist:
 *
 *   flow mapping   `on: { schedule: [{cron: ...}] }`        SILENTLY DROPPED
 *   inline seq     `schedule: [{cron: ...}]`                SILENTLY DROPPED
 *   flush block    items indented level with their key      SILENTLY DROPPED
 *   folded scalar  `cron: >-` on the next line              captured ">-", ABORTED THE RUN
 *   heredoc        `schedule:` inside a `run: |` block       FALSE POSITIVE
 *   env block      `schedule:` under `env:`                  FALSE POSITIVE
 *
 * A dropped workflow is the worse half: LOOP-002 exists to notice that a schedule
 * is not being honoured, and a schedule it cannot see is one it always reports as
 * fine. So the rule here is **parse what is unambiguous, refuse the rest by name,
 * and never guess**. A refusal fails the run; a silent drop looks like compliance.
 *
 * No YAML library is used: this repo has none as a dependency, and its own
 * `scripts/check-github-actions-security.mjs` reads workflows the same way. The
 * difference is that this reader knows what it cannot read.
 */

export interface ScheduleExtraction {
  /** Cron expressions declared under the workflow's `on.schedule`. */
  crons: string[];
  /** Non-null when the file uses a shape this reader will not guess at. */
  refused: string | null;
}

/** `key:` at a given indent, with whatever follows it on the line. */
interface KeyLine {
  indent: number;
  key: string;
  rest: string;
}

function readKey(line: string): KeyLine | null {
  const m = /^(\s*)(?:(["'])([^"']+)\2|([A-Za-z_][\w.-]*))\s*:(.*)$/.exec(line);
  if (!m) return null;
  return { indent: m[1].length, key: (m[3] ?? m[4]).toLowerCase(), rest: m[5].trim() };
}

/** A block-scalar header: `key: |`, `key: >-`, `key: |2+` … */
const BLOCK_SCALAR = /^[|>][+-]?\d*$/;

const FLOW_START = /^[[{]/;

/**
 * A YAML anchor (`&name`) or alias (`*name`) as a whole token.
 *
 * Testing only for a leading `*` was wrong in the one place it matters most: a
 * cron expression legitimately begins with one. `*​/5 * * * *` is a schedule,
 * `*ref` is an alias, and the difference is whether an identifier follows.
 */
const ANCHOR_OR_ALIAS = /^[&*][A-Za-z_][\w-]*\s*$/;

export function extractSchedules(yamlText: string, filename: string): ScheduleExtraction {
  const refuse = (why: string): ScheduleExtraction => ({
    crons: [],
    refused: `${filename}: ${why} — this reader will not guess; parse it by hand or simplify the file`,
  });

  const lines = yamlText.split("\n");

  // ── pass 1: mask out every block scalar body ─────────────────────────────
  // `run: |` bodies are arbitrary text. The old scanner read a shell heredoc
  // containing the word `schedule:` as a real trigger.
  const masked: (string | null)[] = lines.slice();
  for (let i = 0; i < lines.length; i++) {
    const k = readKey(lines[i]);
    if (!k || !BLOCK_SCALAR.test(k.rest)) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const raw = lines[j];
      if (raw.trim() === "") {
        masked[j] = null;
        continue;
      }
      const ind = raw.length - raw.trimStart().length;
      if (ind <= k.indent) break; // the scalar ended
      masked[j] = null;
      i = j;
    }
  }

  // ── pass 2: locate the top-level `on:` mapping ───────────────────────────
  let onIndent = -1;
  let onLine = -1;
  for (let i = 0; i < masked.length; i++) {
    const raw = masked[i];
    if (raw === null) continue;
    const k = readKey(raw);
    if (!k || k.key !== "on") continue;
    if (k.indent !== 0) continue; // `on:` is a top-level key
    if (FLOW_START.test(k.rest)) {
      return refuse("`on:` is written as a flow mapping/sequence");
    }
    if (ANCHOR_OR_ALIAS.test(k.rest)) {
      return refuse("`on:` uses a YAML anchor or alias");
    }
    onIndent = k.indent;
    onLine = i;
    break;
  }
  if (onLine === -1) return { crons: [], refused: null }; // no triggers at all

  // ── pass 3: find `schedule:` INSIDE that mapping ─────────────────────────
  let schedIndent = -1;
  let schedLine = -1;
  for (let i = onLine + 1; i < masked.length; i++) {
    const raw = masked[i];
    if (raw === null || raw.trim() === "" || raw.trim().startsWith("#")) continue;
    const ind = raw.length - raw.trimStart().length;
    if (ind <= onIndent) break; // left the `on:` mapping
    const k = readKey(raw);
    if (!k || k.key !== "schedule") continue;
    if (FLOW_START.test(k.rest)) {
      return refuse("`schedule:` is written as an inline/flow sequence");
    }
    if (ANCHOR_OR_ALIAS.test(k.rest)) {
      return refuse("`schedule:` uses a YAML anchor or alias");
    }
    if (k.rest !== "" && !k.rest.startsWith("#")) {
      return refuse(`\`schedule:\` has an unexpected inline value ${JSON.stringify(k.rest)}`);
    }
    schedIndent = k.indent;
    schedLine = i;
    break;
  }
  if (schedLine === -1) return { crons: [], refused: null }; // triggers, but no schedule

  // ── pass 4: collect the sequence items ───────────────────────────────────
  // A block sequence may be indented deeper than its key OR flush with it —
  // both are valid YAML, and dropping the flush form lost real workflows.
  const crons: string[] = [];
  for (let i = schedLine + 1; i < masked.length; i++) {
    const raw = masked[i];
    if (raw === null || raw.trim() === "" || raw.trim().startsWith("#")) continue;
    const ind = raw.length - raw.trimStart().length;
    const isItem = raw.trimStart().startsWith("-");

    if (ind < schedIndent) break;
    if (ind === schedIndent && !isItem) break; // a sibling key ended the block
    if (!isItem) {
      // A continuation line inside an item we already consumed, or something
      // structural we do not understand. Only the latter is worth refusing.
      if (ind > schedIndent) continue;
      break;
    }

    const body = raw.trimStart().replace(/^-\s*/, "");
    const k = readKey(body);
    if (!k || k.key !== "cron") {
      return refuse(`a \`schedule:\` entry is not a \`cron:\` mapping (${JSON.stringify(body.slice(0, 40))})`);
    }
    if (BLOCK_SCALAR.test(k.rest)) {
      return refuse("a `cron:` value uses a block or folded scalar");
    }
    if (ANCHOR_OR_ALIAS.test(k.rest)) {
      return refuse("a `cron:` value uses a YAML anchor or alias");
    }
    const value = k.rest
      .replace(/\s+#.*$/, "")
      .trim()
      .replace(/^(["'])(.*)\1$/, "$2")
      .trim();
    if (value === "") return refuse("a `cron:` entry has an empty value");
    crons.push(value);
  }

  return { crons, refused: null };
}
