#!/usr/bin/env node
/**
 * Refresh the checked-in Cloudflare edge IP-range snapshot in
 * server/_core/edgeProxy.ts against Cloudflare's published lists.
 *
 *   node scripts/refresh-cf-cidrs.mjs           # fetch + rewrite arrays + date
 *   node scripts/refresh-cf-cidrs.mjs --check    # exit 3 if drifted (no write)
 *   node scripts/refresh-cf-cidrs.mjs --date=YYYY-MM-DD   # pin the date (tests)
 *
 * The CF-range test is a SECOND factor (edgeProxy design law #2), so this is
 * defence-in-depth freshness, never a gate. FAIL-CLOSED on write: the script
 * refuses to write an empty or malformed list, which would otherwise weaken the
 * check or trip the boot assert. A scheduled workflow runs this monthly and
 * opens a PR; the boot staleness alarm is the backstop if that lapses.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const EDGE = resolve(HERE, "../server/_core/edgeProxy.ts");
const V4_URL = "https://www.cloudflare.com/ips-v4";
const V6_URL = "https://www.cloudflare.com/ips-v6";

const V4_CIDR = /^(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const V6_CIDR = /^[0-9a-fA-F:]+\/\d{1,3}$/;

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const dateArg = args
  .find(a => a.startsWith("--date="))
  ?.slice("--date=".length);

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

async function fetchList(url, validator, label) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  let text;
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
    text = await res.text();
  } finally {
    clearTimeout(timer);
  }
  const list = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  // FAIL-CLOSED: never accept an empty or malformed list.
  if (list.length === 0) throw new Error(`${label}: empty list from upstream`);
  const bad = list.filter(c => !validator.test(c));
  if (bad.length)
    throw new Error(
      `${label}: ${bad.length} malformed entr(y/ies): ${bad.slice(0, 3).join(", ")}`
    );
  return list;
}

function currentArray(src, name) {
  const m = src.match(
    new RegExp(
      `export const ${name}: readonly string\\[\\] = \\[([\\s\\S]*?)\\] as const;`
    )
  );
  if (!m) throw new Error(`could not locate ${name} in edgeProxy.ts`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]);
}

function renderArray(name, list) {
  const body = list.map(c => `  "${c}",`).join("\n");
  return `export const ${name}: readonly string[] = [\n${body}\n] as const;`;
}

function replaceArray(src, name, list) {
  return src.replace(
    new RegExp(
      `export const ${name}: readonly string\\[\\] = \\[[\\s\\S]*?\\] as const;`
    ),
    renderArray(name, list)
  );
}

const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

async function main() {
  const src = readFileSync(EDGE, "utf8");
  const [v4, v6] = await Promise.all([
    fetchList(V4_URL, V4_CIDR, "ips-v4"),
    fetchList(V6_URL, V6_CIDR, "ips-v6"),
  ]);
  const curV4 = currentArray(src, "CF_IPV4_CIDRS");
  const curV6 = currentArray(src, "CF_IPV6_CIDRS");
  const rangesDrifted = !eq(curV4, v4) || !eq(curV6, v6);

  if (checkOnly) {
    if (rangesDrifted) {
      console.error(
        `[cf-cidr] DRIFT: checked-in ranges differ from upstream (v4 ${curV4.length}->${v4.length}, v6 ${curV6.length}->${v6.length}). Run: node scripts/refresh-cf-cidrs.mjs`
      );
      process.exit(3);
    }
    console.log(`[cf-cidr] up to date (v4=${v4.length}, v6=${v6.length})`);
    return;
  }

  const date = dateArg ?? todayUtc();
  let out = replaceArray(src, "CF_IPV4_CIDRS", v4);
  out = replaceArray(out, "CF_IPV6_CIDRS", v6);
  out = out.replace(
    /export const CF_CIDR_SNAPSHOT_DATE = "[^"]*";/,
    `export const CF_CIDR_SNAPSHOT_DATE = "${date}";`
  );
  writeFileSync(EDGE, out);
  console.log(
    rangesDrifted
      ? `[cf-cidr] updated ranges (v4 ${curV4.length}->${v4.length}, v6 ${curV6.length}->${v6.length}) + date=${date}`
      : `[cf-cidr] ranges unchanged; refreshed verification date=${date}`
  );
}

main().catch(err => {
  console.error(`[cf-cidr] FAILED (no write): ${err.message}`);
  process.exit(1);
});
