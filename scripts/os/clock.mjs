#!/usr/bin/env node
/**
 * scripts/os/clock.mjs — the /os/ clock (ISSUE-007).
 *
 * Emits ONE line naming what has gone quiet. Consumed by
 * .claude/scripts/prompt-capsule.sh, a UserPromptSubmit hook that fires on
 * EVERY prompt — not once a session, and not through GitHub issues (0 opened in
 * 366 PRs) or a new required check (never once promoted in 5 ruleset revisions).
 *
 * Must be fast and must never fail: a clock that wedges a prompt is worse than
 * no clock. Prints nothing and exits 0 on any error.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const OS = resolve(dirname(fileURLToPath(import.meta.url)), "../../os");
/**
 * Only these statuses OWE an observation. "NOT STARTED" is queued work, not a
 * broken promise — clocking it would put 18 lines on every prompt and the line
 * would be ignored within a day. A clock that cries wolf is a clock nobody reads.
 */
// ACTIVE was missing, which made every ACTIVE artifact's observe_by INERT — including
// GR-0001's, the mission's own goal record. A governance system whose flagship goal
// carries a deadline nothing watches is the exact failure it was built to prevent
// (the 2026-07-28 program died in 8 days because nothing noticed it had stopped).
// Found by the PR #399 adversarial audit.
const OWES_OBSERVATION = ["AWAITING", "BLOCKED", "OPEN", "IN PROGRESS", "ACTIVE"];

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith(".md")) out.push(p);
  }
  return out;
}

function field(md, name) {
  const m = md.match(new RegExp(`\\*\\*${name}:\\*\\*\\s*([^\\n·]+)`, "i"));
  return m ? m[1].trim() : null;
}

try {
  const asOf = new Date();
  const overdue = [];
  for (const p of walk(OS)) {
    if (p.includes("/appendix/")) continue;
    const md = readFileSync(p, "utf-8");
    const status = field(md, "Status");
    if (!status) continue;
    const S = status.toUpperCase();
    if (!OWES_OBSERVATION.some((c) => S.startsWith(c))) continue;
    const by = field(md, "observe_by");
    const id = p.slice(OS.length + 1).replace(/\.md$/, "").split("/").pop().split("-").slice(0, 2).join("-");
    if (!by) {
      overdue.push({ id, days: null });
      continue;
    }
    const due = new Date(`${by}T00:00:00Z`);
    const days = Math.floor((asOf - due) / 86400000);
    if (days > 0) overdue.push({ id, days });
  }
  if (overdue.length === 0) process.exit(0);
  overdue.sort((a, b) => (b.days ?? 1e9) - (a.days ?? 1e9));
  const shown = overdue.slice(0, 4).map((o) => (o.days === null ? `${o.id} (no observe_by)` : `${o.id} (${o.days}d)`));
  const more = overdue.length > shown.length ? ` +${overdue.length - shown.length} more` : "";
  process.stdout.write(`[OS] ${overdue.length} item(s) overdue — ${shown.join(", ")}${more}.\n`);
} catch {
  /* a clock must never wedge a prompt */
}
process.exit(0);
