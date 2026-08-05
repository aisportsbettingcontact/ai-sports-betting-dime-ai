#!/usr/bin/env node
/**
 * scripts/os/ledger-extract.mjs — build the token ledger from Claude Code transcripts.
 *
 * Reads session transcripts, sums cache-aware usage, prices with os/ledger/PRICES.json,
 * and writes one JSONL record per session to os/ledger/sessions.jsonl.
 *
 * The transcripts are NOT the system of record — they expire. These extracted
 * records are, and they are tiny and git-durable.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve, dirname, basename } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PRICES = JSON.parse(readFileSync(join(ROOT, "os/ledger/PRICES.json"), "utf-8"));
const SRC = process.env.TRANSCRIPT_DIR ||
  join(process.env.HOME, ".claude/projects/-Users-danielwalker-src-ai-sports-betting-dime-ai");
const M = 1_000_000;

function price(model, u) {
  if (model === "<synthetic>") return null;
  const p = PRICES.models[model];
  if (!p) return null;
  return (u.input/M)*p.inUsdPerMTok + (u.output/M)*p.outUsdPerMTok
       + (u.cacheWrite/M)*p.inUsdPerMTok*p.cacheWriteMult
       + (u.cacheRead/M)*p.inUsdPerMTok*p.cacheReadMult;
}

const out = [];
for (const f of readdirSync(SRC).filter((x) => x.endsWith(".jsonl"))) {
  const totals = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  let usd = 0, priced = 0, unpriced = 0, first = null, last = null;
  const models = new Set();
  for (const line of readFileSync(join(SRC, f), "utf-8").split("\n")) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    const m = r.message;
    if (!m || typeof m !== "object" || !m.usage) continue;
    const u = {
      input: m.usage.input_tokens || 0,
      output: m.usage.output_tokens || 0,
      cacheWrite: m.usage.cache_creation_input_tokens || 0,
      cacheRead: m.usage.cache_read_input_tokens || 0,
    };
    totals.input += u.input; totals.output += u.output;
    totals.cacheWrite += u.cacheWrite; totals.cacheRead += u.cacheRead;
    if (m.model) models.add(m.model);
    const v = price(m.model || "", u);
    if (v === null) unpriced++; else { usd += v; priced++; }
    if (r.timestamp) { first ??= r.timestamp; last = r.timestamp; }
  }
  if (priced + unpriced === 0) continue;
  out.push({
    sessionId: basename(f, ".jsonl"),
    firstAt: first, lastAt: last,
    models: [...models].sort(),
    totals,
    listUsd: priced > 0 ? Number(usd.toFixed(4)) : null,
    usdReason: priced > 0 ? null : "no priced messages",
    pricedMessages: priced, unpricedMessages: unpriced,
    priceTableVersion: PRICES.version,
  });
}
out.sort((a, b) => (a.firstAt || "").localeCompare(b.firstAt || ""));
mkdirSync(join(ROOT, "os/ledger"), { recursive: true });
writeFileSync(join(ROOT, "os/ledger/sessions.jsonl"), out.map((o) => JSON.stringify(o)).join("\n") + "\n");

const t = out.reduce((a, o) => ({
  input: a.input + o.totals.input, output: a.output + o.totals.output,
  cacheWrite: a.cacheWrite + o.totals.cacheWrite, cacheRead: a.cacheRead + o.totals.cacheRead,
  usd: a.usd + (o.listUsd || 0),
}), { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, usd: 0 });
console.log(`  sessions:    ${out.length}`);
console.log(`  input:       ${t.input.toLocaleString()}`);
console.log(`  output:      ${t.output.toLocaleString()}`);
console.log(`  cache write: ${t.cacheWrite.toLocaleString()}`);
console.log(`  cache read:  ${t.cacheRead.toLocaleString()}`);
console.log(`  TOTAL tokens:${(t.input+t.output+t.cacheWrite+t.cacheRead).toLocaleString()}`);
console.log(`  listUsd:     $${t.usd.toFixed(2)}`);
