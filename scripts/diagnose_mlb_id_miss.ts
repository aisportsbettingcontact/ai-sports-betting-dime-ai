/**
 * MLB ID RESOLUTION FAILURE DIAGNOSIS
 * =====================================
 * Uses the EXACT same logic as batchResolveMlbIdsFromDb + resolveMlbIdViaApi.
 * Traces every step for Samuel Antonacci and Hao Yu Lee.
 */

import * as dotenv from "dotenv";
dotenv.config();

import { getDb } from "../server/db";
import { sql as drizzleSql } from "drizzle-orm";

// ─── Exact copies of normalizeName / normalizeNameForDb / applyFirstNameAlias ─

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/-/g, " ").replace(/[^a-z ]/g, "").replace(/\s+/g, " ");
}

function normalizeNameForDb(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ");
}

const FIRST_NAME_ALIASES: Record<string, string> = {
  "cameron": "cam",
};

function applyFirstNameAlias(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  const firstLower = parts[0].toLowerCase();
  const alias = FIRST_NAME_ALIASES[firstLower];
  if (!alias) return name;
  const aliasCapitalized = alias.charAt(0).toUpperCase() + alias.slice(1);
  return [aliasCapitalized, ...parts.slice(1)].join(" ");
}

// ─── MLB Stats API ────────────────────────────────────────────────────────────

async function callMlbApi(name: string, sportId: number): Promise<{ id: number; fullName: string }[]> {
  const url = `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(name)}&sportId=${sportId}`;
  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { people?: { id: number; fullName: string }[] };
    return data.people ?? [];
  } catch {
    return [];
  }
}

// ─── DB raw query ─────────────────────────────────────────────────────────────

async function dbRawSearch(lastName: string): Promise<{ name: string; mlbamId: number }[]> {
  const db = await getDb();
  if (!db) return [];
  const [rows] = await db.execute(
    drizzleSql.raw(`SELECT name, mlbamId FROM mlb_players WHERE name COLLATE utf8mb4_unicode_ci LIKE '%${lastName.replace(/'/g, "''")}%' AND mlbamId IS NOT NULL LIMIT 50`)
  ) as [Array<{ name: string; mlbamId: number }>, unknown];
  return rows;
}

// ─── Diagnose one player ──────────────────────────────────────────────────────

async function diagnose(rgName: string, rgUrl: string) {
  console.log(`\n${"═".repeat(72)}`);
  console.log(`[INPUT] RG Name: "${rgName}"  URL: ${rgUrl}`);
  console.log(`${"═".repeat(72)}`);

  const aliasedName = applyFirstNameAlias(rgName);
  const key = normalizeName(aliasedName);
  const normalizedSearch = normalizeNameForDb(aliasedName);
  const nameParts = aliasedName.trim().split(/\s+/);
  const lastNameRaw = nameParts[nameParts.length - 1];

  console.log(`\n[STEP 1] Name normalization:`);
  console.log(`  rgName:           "${rgName}"`);
  console.log(`  aliasedName:      "${aliasedName}" (alias applied: ${aliasedName !== rgName})`);
  console.log(`  normalizeName:    "${key}"`);
  console.log(`  normalizeForDb:   "${normalizedSearch}"`);
  console.log(`  lastNameRaw:      "${lastNameRaw}"`);

  console.log(`\n[STEP 2] DB batch query (LIKE '%${lastNameRaw}%'):`);
  const dbRows = await dbRawSearch(lastNameRaw);
  console.log(`  DB returned ${dbRows.length} row(s):`);
  for (const row of dbRows) {
    const dbNorm = normalizeNameForDb(row.name);
    const match = dbNorm === normalizedSearch;
    console.log(`  ${match ? "✓ MATCH" : "  no-match"} DB name="${row.name}" norm="${dbNorm}" mlbamId=${row.mlbamId}`);
  }
  const dbMatch = dbRows.find(r => normalizeNameForDb(r.name) === normalizedSearch);
  if (dbMatch) {
    console.log(`  [VERIFY] PASS — DB match found: mlbamId=${dbMatch.mlbamId}`);
  } else {
    console.log(`  [VERIFY] FAIL — No DB match for normalizedSearch="${normalizedSearch}"`);
  }

  console.log(`\n[STEP 3] MLB Stats API — sportId=1 (MLB), name="${aliasedName}":`);
  const api1 = await callMlbApi(aliasedName, 1);
  console.log(`  Results: ${api1.length > 0 ? api1.map(p => `${p.fullName}(${p.id})`).join(", ") : "NONE"}`);

  if (api1.length === 0) {
    console.log(`\n[STEP 4] MLB Stats API — MiLB sport IDs [11,12,13,14,16], name="${aliasedName}":`);
    for (const sportId of [11, 12, 13, 14, 16]) {
      const apiN = await callMlbApi(aliasedName, sportId);
      if (apiN.length > 0) {
        console.log(`  sportId=${sportId}: ${apiN.map(p => `${p.fullName}(${p.id})`).join(", ")}`);
      }
    }
  }

  console.log(`\n[STEP 5] MLB Stats API — last name only "${lastNameRaw}", sportId=1:`);
  const apiLast = await callMlbApi(lastNameRaw, 1);
  console.log(`  Results: ${apiLast.length > 0 ? apiLast.map(p => `${p.fullName}(${p.id})`).join(", ") : "NONE"}`);

  if (apiLast.length === 0) {
    console.log(`\n[STEP 6] MLB Stats API — last name "${lastNameRaw}", all sport IDs:`);
    for (const sportId of [11, 12, 13, 14, 16]) {
      const apiN = await callMlbApi(lastNameRaw, sportId);
      if (apiN.length > 0) {
        console.log(`  sportId=${sportId}: ${apiN.map(p => `${p.fullName}(${p.id})`).join(", ")}`);
      }
    }
  }

  // Extract RG player ID from URL
  const rgIdMatch = rgUrl.match(/-(\d+)$/);
  const rgPlayerId = rgIdMatch ? rgIdMatch[1] : null;
  console.log(`\n[STATE] RG Player ID from URL: ${rgPlayerId ?? "NOT EXTRACTABLE"}`);

  console.log(`\n[OUTPUT] ROOT CAUSE for "${rgName}":`);
  if (dbMatch) {
    console.log(`  ✓ DB has a match — resolution should work. Check in-memory cache TTL.`);
  } else if (api1.length > 0) {
    console.log(`  ✗ DB miss but API hit. MLB ID=${api1[0].id}. DB name mismatch.`);
    console.log(`  FIX: Add to NAME_ALIASES or fix normalizeNameForDb for this name pattern.`);
  } else if (apiLast.length > 0) {
    const candidate = apiLast.find(p => p.fullName.toLowerCase().includes(nameParts[0].toLowerCase()));
    console.log(`  ✗ DB miss, API miss on full name, but last-name search found: ${apiLast.map(p => `${p.fullName}(${p.id})`).join(", ")}`);
    if (candidate) {
      console.log(`  CANDIDATE: ${candidate.fullName}(${candidate.id})`);
      console.log(`  FIX: Add NAME_ALIAS "${rgName}" → "${candidate.fullName}" in rotogrinderProxy.ts`);
    }
  } else {
    console.log(`  ✗ CRITICAL: Not found in DB OR MLB Stats API by any search.`);
    console.log(`  This player may be a non-MLB prospect or have a different name in MLB systems.`);
    console.log(`  FIX: Manually add a PLAYER_ID_OVERRIDES entry with the correct MLB ID.`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("[INPUT] MLB ID RESOLUTION FAILURE DIAGNOSIS");
  console.log("[STATE] Testing: Samuel Antonacci, Hao Yu Lee");
  console.log("═══════════════════════════════════════════════════════════════════════");

  await diagnose("Samuel Antonacci", "https://rotogrinders.com/players/sam-antonacci-6538449");
  await diagnose("Hao Yu Lee", "https://rotogrinders.com/players/hao-yu-lee-unknown");

  console.log(`\n${"═".repeat(72)}`);
  console.log("[OUTPUT] DIAGNOSIS COMPLETE");
  console.log(`${"═".repeat(72)}`);
  process.exit(0);
}

main().catch(err => {
  console.error("[FATAL]", err);
  process.exit(1);
});
