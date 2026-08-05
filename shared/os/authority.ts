/**
 * shared/os/authority.ts — parse the authority ladder (ISSUE-010, doctrine L5).
 *
 * `os/agents/AUTHORITY.md` is the CANONICAL, human-readable ladder.
 * `os/agents/authority.json` is a GENERATED mirror. One source, never two
 * hand-maintained files — the Stage 1 audit found the set had an enforcement
 * gate, two consumers, and no ladder, precisely because nobody owned the source.
 *
 * The parser enforces three invariants that a prose file cannot enforce itself:
 *   1. the mission executor MUST have a rung — doctrine L5 requires it by name
 *   2. every actor's rung must be one of the defined rungs
 *   3. a DEFERRED actor must state why (`blocked_on:`), so deferral is a
 *      decision with a reason rather than a quiet omission
 */

export interface Rung {
  rung: number;
  name: string;
  mayDo: string;
  gate: string;
}

export interface Actor {
  actor: string;
  rung: number;
  status: string;
  notes: string;
}

export interface Authority {
  rungs: Rung[];
  actors: Actor[];
}

/** Split a markdown table row into trimmed cells, dropping the outer pipes. */
function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function isDivider(line: string): boolean {
  return /^\|[\s:|-]+\|$/.test(line.trim());
}

/** Collect the data rows of the table that follows a given `## Heading`. */
function tableUnder(md: string, heading: string): string[][] {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start === -1) return [];
  const rows: string[][] = [];
  let seenHeader = false;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("## ")) break;
    if (!line.trim().startsWith("|")) continue;
    if (isDivider(line)) continue;
    if (!seenHeader) {
      seenHeader = true; // the first pipe row is the header
      continue;
    }
    rows.push(cells(line));
  }
  return rows;
}

const strip = (s: string) => s.replace(/`/g, "").trim();

export function parseAuthority(md: string): Authority {
  const rungs: Rung[] = tableUnder(md, "Rungs")
    .filter((r) => r.length >= 4 && /^\d+$/.test(strip(r[0])))
    .map((r) => ({ rung: Number(strip(r[0])), name: strip(r[1]), mayDo: strip(r[2]), gate: strip(r[3]) }));

  if (rungs.length === 0) throw new Error("AUTHORITY.md defines no rungs");

  const actors: Actor[] = tableUnder(md, "Actors")
    .filter((r) => r.length >= 4 && strip(r[0]) !== "")
    .map((r) => ({ actor: strip(r[0]), rung: Number(strip(r[1])), status: strip(r[2]).toUpperCase(), notes: strip(r[3]) }));

  const defined = new Set(rungs.map((r) => r.rung));
  for (const a of actors) {
    if (!defined.has(a.rung)) {
      throw new Error(`actor ${a.actor} claims rung ${a.rung}, which is not a defined rung`);
    }
    if (a.status === "DEFERRED" && !/blocked_on:\s*\S/.test(a.notes)) {
      throw new Error(`actor ${a.actor} is DEFERRED but states no blocked_on: reason`);
    }
  }

  // Doctrine L5: the ladder must include "a rung for the executor of this
  // mission". Everything Stage 4 does is performed under it, so its absence is
  // a hole rather than an omission.
  if (!actors.some((a) => a.actor === "executor")) {
    throw new Error("AUTHORITY.md must give the mission executor a rung (doctrine L5)");
  }

  return { rungs, actors };
}

/** Charters that exist but carry no rung — L4 requires every seat to have one. */
export function findUnrungedActors(auth: Authority, charterIds: string[]): string[] {
  const known = new Set(auth.actors.map((a) => a.actor));
  return charterIds.filter((id) => !known.has(id));
}
