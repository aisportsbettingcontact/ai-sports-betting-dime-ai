/**
 * TARGETED MLB ID DIAGNOSIS — 8 players missing from Tomorrow Hitters tab
 * Traces each player through: normalizeName → DB lookup → API fallback → result
 */

import * as dotenv from "dotenv";
dotenv.config();

import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { sql } from "drizzle-orm";

const MISSING_PLAYERS = [
  { name: "Samuel Antonacci", team: "CHW" },
  { name: "Esmerlyn Valdez",  team: "NYY" },
  { name: "Bryan Torres",     team: "SFG" },
  { name: "Pedro Ramirez",    team: "CHC" },
  { name: "Gabriel Gonzalez", team: "SEA" },
  { name: "Wade Meckler",     team: "SFG" },
  { name: "Donovan Walton",   team: "SEA" },
];

// Exact normalization from rotogrinderProxy.ts
const FIRST_NAME_ALIASES: Record<string, string> = {
  "alex": "alexander", "bill": "william", "bob": "robert", "bobby": "robert",
  "brad": "bradley", "chris": "christopher", "dan": "daniel", "dave": "david",
  "ed": "edward", "fred": "frederick", "jack": "john", "jake": "jacob",
  "jeff": "jeffrey", "jim": "james", "joe": "joseph", "jon": "jonathan",
  "josh": "joshua", "ken": "kenneth", "matt": "matthew", "mike": "michael",
  "nick": "nicholas", "pat": "patrick", "pete": "peter", "rob": "robert",
  "ron": "ronald", "sam": "samuel", "steve": "steven", "tim": "timothy",
  "tom": "thomas", "tony": "anthony", "will": "william",
  "samuel": "sam",
};

function normalizeNameForDb(name: string): string {
  const parts = name.trim().toLowerCase().split(/\s+/);
  if (parts.length >= 2) {
    const first = parts[0];
    const rest = parts.slice(1).join(" ");
    const canonical = FIRST_NAME_ALIASES[first] ?? first;
    return `${canonical} ${rest}`;
  }
  return name.trim().toLowerCase();
}

async function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const conn = await mysql.createConnection(url);
  return drizzle(conn);
}

async function resolveViaApi(name: string): Promise<{ mlbId: number | null; apiName: string | null }> {
  const parts = name.trim().split(/\s+/);
  const lastName = parts.slice(1).join(" ");
  const firstName = parts[0];
  const url = `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(name)}&sportId=1`;
  console.log(`  [API] GET ${url}`);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const json = await res.json() as any;
    const people = json.people ?? [];
    console.log(`  [API] ${people.length} result(s) for "${name}"`);
    for (const p of people) {
      const fullName = p.fullName ?? "";
      const apiLast = fullName.split(" ").slice(1).join(" ").toLowerCase();
      const apiFirst = fullName.split(" ")[0].toLowerCase();
      if (apiLast === lastName.toLowerCase()) {
        console.log(`  [API] Match: "${fullName}" id=${p.id}`);
        return { mlbId: p.id, apiName: fullName };
      }
    }
    // Try last-name only
    const url2 = `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(lastName)}&sportId=1`;
    console.log(`  [API] Fallback GET ${url2}`);
    const res2 = await fetch(url2, { signal: AbortSignal.timeout(8000) });
    const json2 = await res2.json() as any;
    const people2 = json2.people ?? [];
    console.log(`  [API] ${people2.length} result(s) for last="${lastName}"`);
    for (const p of people2) {
      const fullName = p.fullName ?? "";
      const apiLast = fullName.split(" ").slice(1).join(" ").toLowerCase();
      if (apiLast === lastName.toLowerCase()) {
        console.log(`  [API] Last-name match: "${fullName}" id=${p.id}`);
        return { mlbId: p.id, apiName: fullName };
      }
    }
    return { mlbId: null, apiName: null };
  } catch (err: any) {
    console.error(`  [API] ERROR: ${err.message}`);
    return { mlbId: null, apiName: null };
  }
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("[INPUT] MLB ID DIAGNOSIS — 8 Missing Players");
  console.log("═══════════════════════════════════════════════════════════════════════");

  const db = await getDb();

  for (const player of MISSING_PLAYERS) {
    console.log(`\n────────────────────────────────────────────────────────────────────────`);
    console.log(`[INPUT] Player: "${player.name}" team=${player.team}`);

    const normalKey = normalizeNameForDb(player.name);
    console.log(`[STEP] normalizeNameForDb("${player.name}") = "${normalKey}"`);

    // DB lookup — exact match
    const dbRows = await db.execute(sql`
      SELECT id, name, mlbam_id, team
      FROM mlb_players
      WHERE LOWER(REPLACE(REPLACE(name, '.', ''), '-', ' ')) = ${normalKey}
      LIMIT 5
    `);
    const rows = (dbRows as any)[0] as any[];
    console.log(`[STATE] DB exact match: ${rows.length} row(s)`);
    if (rows.length > 0) {
      for (const r of rows) {
        console.log(`  [DB] id=${r.id} name="${r.name}" mlbam_id=${r.mlbam_id} team=${r.team}`);
      }
    }

    // DB lookup — last name only
    const lastName = player.name.split(" ").slice(1).join(" ").toLowerCase();
    const dbLastRows = await db.execute(sql`
      SELECT id, name, mlbam_id, team
      FROM mlb_players
      WHERE LOWER(REPLACE(REPLACE(name, '.', ''), '-', ' ')) LIKE ${`%${lastName}%`}
      LIMIT 10
    `);
    const lastRows = (dbLastRows as any)[0] as any[];
    console.log(`[STATE] DB last-name "${lastName}" search: ${lastRows.length} row(s)`);
    if (lastRows.length > 0) {
      for (const r of lastRows) {
        console.log(`  [DB] id=${r.id} name="${r.name}" mlbam_id=${r.mlbam_id} team=${r.team}`);
      }
    }

    // MLB Stats API
    console.log(`[STEP] MLB Stats API lookup for "${player.name}"...`);
    const apiResult = await resolveViaApi(player.name);
    console.log(`[STATE] API result: mlbId=${apiResult.mlbId} apiName="${apiResult.apiName}"`);

    if (rows.length > 0) {
      console.log(`[VERIFY] PASS — DB match found: mlbam_id=${rows[0].mlbam_id}`);
    } else if (apiResult.mlbId) {
      console.log(`[VERIFY] WARN — DB miss but API found: mlbId=${apiResult.mlbId} — need to add alias or DB entry`);
    } else {
      console.error(`[VERIFY] CRITICAL — No DB match AND no API match for "${player.name}"`);
    }
  }

  console.log("\n═══════════════════════════════════════════════════════════════════════");
  console.log("[OUTPUT] DIAGNOSIS COMPLETE");
  console.log("═══════════════════════════════════════════════════════════════════════");
  process.exit(0);
}

main().catch(err => {
  console.error("[FATAL]", err);
  process.exit(1);
});
