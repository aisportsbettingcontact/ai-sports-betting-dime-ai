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

async function resolveViaApi(name: string): Promise<{ mlbId: number | null; apiName: string | null }> {
  const lastName = name.trim().split(/\s+/).slice(1).join(" ");
  const url = `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(name)}&sportId=1`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const json = await res.json() as any;
    const people = json.people ?? [];
    for (const p of people) {
      const apiLast = (p.fullName ?? "").split(" ").slice(1).join(" ").toLowerCase();
      if (apiLast === lastName.toLowerCase()) {
        return { mlbId: p.id, apiName: p.fullName };
      }
    }
    // fallback: last name only
    const url2 = `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(lastName)}&sportId=1`;
    const res2 = await fetch(url2, { signal: AbortSignal.timeout(8000) });
    const json2 = await res2.json() as any;
    const people2 = json2.people ?? [];
    for (const p of people2) {
      const apiLast = (p.fullName ?? "").split(" ").slice(1).join(" ").toLowerCase();
      if (apiLast === lastName.toLowerCase()) {
        return { mlbId: p.id, apiName: p.fullName };
      }
    }
    return { mlbId: null, apiName: null };
  } catch {
    return { mlbId: null, apiName: null };
  }
}

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const db = drizzle(conn);

  // Step 1: Get actual column names
  const descResult = await db.execute(sql`DESCRIBE mlb_players`);
  const cols = ((descResult as any)[0] as any[]).map((c: any) => c.Field);
  console.log(`[STATE] mlb_players columns: ${cols.join(", ")}`);

  // Determine the MLB ID column name
  const mlbIdCol = cols.find((c: string) => c.toLowerCase().includes("mlbam") || c.toLowerCase() === "mlb_id" || c.toLowerCase() === "mlbid");
  const nameCol = cols.find((c: string) => c.toLowerCase() === "name" || c.toLowerCase() === "full_name");
  const teamCol = cols.find((c: string) => c.toLowerCase() === "team");
  console.log(`[STATE] MLB ID col="${mlbIdCol}" name col="${nameCol}" team col="${teamCol}"`);

  if (!mlbIdCol || !nameCol) {
    console.error("[FATAL] Cannot determine MLB ID or name column from schema");
    await conn.end();
    return;
  }

  console.log("\n═══════════════════════════════════════════════════════════════════════");
  console.log("[INPUT] MLB ID DIAGNOSIS — 8 Missing Players");
  console.log("═══════════════════════════════════════════════════════════════════════");

  const fixes: Array<{ name: string; alias?: string; mlbId?: number }> = [];

  for (const player of MISSING_PLAYERS) {
    console.log(`\n────────────────────────────────────────────────────────────────────────`);
    console.log(`[INPUT] Player: "${player.name}" team=${player.team}`);

    const normalKey = normalizeNameForDb(player.name);
    console.log(`[STEP] normalizeNameForDb("${player.name}") = "${normalKey}"`);

    // DB exact match using dynamic column names
    const exactRows = await db.execute(sql.raw(`
      SELECT ${nameCol}, ${mlbIdCol}${teamCol ? `, ${teamCol}` : ""}
      FROM mlb_players
      WHERE LOWER(REPLACE(REPLACE(${nameCol}, '.', ''), '-', ' ')) = '${normalKey.replace(/'/g, "''")}'
      LIMIT 5
    `));
    const exactMatches = (exactRows as any)[0] as any[];
    console.log(`[STATE] DB exact match: ${exactMatches.length} row(s)`);
    for (const r of exactMatches) {
      console.log(`  [DB] name="${r[nameCol]}" ${mlbIdCol}=${r[mlbIdCol]}${teamCol ? ` team=${r[teamCol]}` : ""}`);
    }

    // DB last-name search
    const lastName = player.name.split(" ").slice(1).join(" ").toLowerCase();
    const lastRows = await db.execute(sql.raw(`
      SELECT ${nameCol}, ${mlbIdCol}${teamCol ? `, ${teamCol}` : ""}
      FROM mlb_players
      WHERE LOWER(${nameCol}) LIKE '%${lastName.replace(/'/g, "''")}%'
      LIMIT 10
    `));
    const lastMatches = (lastRows as any)[0] as any[];
    console.log(`[STATE] DB last-name "${lastName}" search: ${lastMatches.length} row(s)`);
    for (const r of lastMatches) {
      console.log(`  [DB] name="${r[nameCol]}" ${mlbIdCol}=${r[mlbIdCol]}${teamCol ? ` team=${r[teamCol]}` : ""}`);
    }

    // API fallback
    console.log(`[STEP] MLB Stats API lookup for "${player.name}"...`);
    const apiResult = await resolveViaApi(player.name);
    console.log(`[STATE] API result: mlbId=${apiResult.mlbId} apiName="${apiResult.apiName}"`);

    if (exactMatches.length > 0) {
      console.log(`[VERIFY] PASS — DB exact match: ${mlbIdCol}=${exactMatches[0][mlbIdCol]}`);
    } else if (lastMatches.length > 0) {
      // Check if any last-name match has a close first name
      const firstName = player.name.split(" ")[0].toLowerCase();
      const aliasFirst = FIRST_NAME_ALIASES[firstName] ?? firstName;
      const fuzzyMatch = lastMatches.find((r: any) => {
        const dbFirst = r[nameCol].split(" ")[0].toLowerCase();
        const dbAlias = FIRST_NAME_ALIASES[dbFirst] ?? dbFirst;
        return dbAlias === aliasFirst || dbFirst === firstName || dbFirst.startsWith(firstName) || firstName.startsWith(dbFirst);
      });
      if (fuzzyMatch) {
        console.log(`[VERIFY] WARN — DB fuzzy match: "${fuzzyMatch[nameCol]}" ${mlbIdCol}=${fuzzyMatch[mlbIdCol]} — need alias`);
        fixes.push({ name: player.name, alias: fuzzyMatch[nameCol], mlbId: fuzzyMatch[mlbIdCol] });
      } else {
        console.error(`[VERIFY] CRITICAL — DB last-name match but first name mismatch for "${player.name}"`);
        if (apiResult.mlbId) {
          console.log(`[VERIFY] WARN — API found: mlbId=${apiResult.mlbId} "${apiResult.apiName}" — need PLAYER_ID_OVERRIDES entry`);
          fixes.push({ name: player.name, mlbId: apiResult.mlbId });
        }
      }
    } else if (apiResult.mlbId) {
      console.log(`[VERIFY] WARN — DB miss, API found: mlbId=${apiResult.mlbId} "${apiResult.apiName}" — need PLAYER_ID_OVERRIDES entry`);
      fixes.push({ name: player.name, mlbId: apiResult.mlbId });
    } else {
      console.error(`[VERIFY] CRITICAL — No DB match AND no API match for "${player.name}" — player may not be in MLB system`);
    }
  }

  console.log("\n═══════════════════════════════════════════════════════════════════════");
  console.log("[OUTPUT] REQUIRED FIXES:");
  for (const fix of fixes) {
    if (fix.alias) {
      console.log(`  ALIAS: "${fix.name}" → DB name "${fix.alias}" (mlbId=${fix.mlbId})`);
    } else if (fix.mlbId) {
      console.log(`  OVERRIDE: "${fix.name}" → mlbId=${fix.mlbId}`);
    }
  }
  console.log("═══════════════════════════════════════════════════════════════════════");

  await conn.end();
}

main().catch(err => {
  console.error("[FATAL]", err);
  process.exit(1);
});
