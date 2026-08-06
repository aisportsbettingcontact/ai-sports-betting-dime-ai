#!/usr/bin/env node
/**
 * scripts/os/authority-sync.mjs — generate os/agents/authority.json from AUTHORITY.md.
 *
 * The markdown is canonical. This produces the machine mirror so consumers
 * (charter gates, runtime assertions) read structured data without a second
 * hand-maintained file drifting from the first.
 *
 *   --check   exit 1 if the committed JSON differs from what the markdown yields
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MD = join(ROOT, "os/agents/AUTHORITY.md");
const JSON_PATH = join(ROOT, "os/agents/authority.json");

// Mirrors shared/os/authority.ts. Kept in sync by shared/os/authority.test.ts,
// which parses this very file's output and asserts the same invariants.
const cells = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isDivider = (l) => /^\|[\s:|-]+\|$/.test(l.trim());
const strip = (s) => s.replace(/`/g, "").trim();

function tableUnder(md, heading) {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start === -1) return [];
  const rows = []; let seenHeader = false;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("## ")) break;
    if (!line.trim().startsWith("|") || isDivider(line)) continue;
    if (!seenHeader) { seenHeader = true; continue; }
    rows.push(cells(line));
  }
  return rows;
}

const md = readFileSync(MD, "utf8");
const rungs = tableUnder(md, "Rungs")
  .filter((r) => r.length >= 4 && /^\d+$/.test(strip(r[0])))
  .map((r) => ({ rung: Number(strip(r[0])), name: strip(r[1]), mayDo: strip(r[2]), gate: strip(r[3]) }));
const actors = tableUnder(md, "Actors")
  .filter((r) => r.length >= 4 && strip(r[0]) !== "")
  .map((r) => ({ actor: strip(r[0]), rung: Number(strip(r[1])), status: strip(r[2]).toUpperCase(), notes: strip(r[3]) }));

const out = {
  _generated: "DO NOT EDIT — generated from os/agents/AUTHORITY.md by scripts/os/authority-sync.mjs",
  source: "os/agents/AUTHORITY.md",
  rungs,
  actors,
};
const text = JSON.stringify(out, null, 2) + "\n";

if (process.argv.includes("--check")) {
  let current = "";
  try { current = readFileSync(JSON_PATH, "utf8"); } catch (e) { if (e.code !== "ENOENT") throw e; }
  if (current !== text) {
    console.error("[authority] authority.json is out of sync with AUTHORITY.md — run: node scripts/os/authority-sync.mjs");
    process.exit(1);
  }
  console.log(`[authority] in sync — ${rungs.length} rungs, ${actors.length} actors`);
  process.exit(0);
}

writeFileSync(JSON_PATH, text);
console.log(`[authority] wrote authority.json — ${rungs.length} rungs, ${actors.length} actors`);
