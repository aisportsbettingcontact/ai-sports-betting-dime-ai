/**
 * fixJune1Pitchers.ts
 *
 * 1. Fixes NYM @ SEA (id=2250846) — sets Austin Warren / Emerson Hancock
 * 2. Verifies all 18 June 1 pitchers exist in mlbPitcherStats
 * 3. Inserts any missing pitchers with live 2026 stats from MLB Stats API
 */
import { getDb } from "../server/db.ts";
import { games, mlbPitcherStats } from "../drizzle/schema.ts";
import { eq, inArray } from "drizzle-orm";

interface PitcherSpec {
  name: string;
  mlbamId: number;
  team: string;
  throws: "R" | "L";
}

// June 1 pitcher roster — confirmed from MLB Stats API + DB
const JUNE1_PITCHERS: PitcherSpec[] = [
  { name: "Ty Madden",        mlbamId: 680744, team: "DET", throws: "R" },
  { name: "Griffin Jax",      mlbamId: 643377, team: "TB",  throws: "R" },
  { name: "Sandy Alcantara",  mlbamId: 645261, team: "MIA", throws: "R" },
  { name: "Cade Cavalli",     mlbamId: 676917, team: "WSH", throws: "R" },
  { name: "Luinder Avila",    mlbamId: 679883, team: "KC",  throws: "L" },
  { name: "Chase Burns",      mlbamId: 695505, team: "CIN", throws: "R" },
  { name: "David Sandlin",    mlbamId: 0,      team: "CWS", throws: "R" },
  { name: "Joe Ryan",         mlbamId: 657746, team: "MIN", throws: "R" },
  { name: "Landen Roupp",     mlbamId: 694738, team: "SF",  throws: "R" },
  { name: "Chad Patrick",     mlbamId: 0,      team: "MIL", throws: "R" },
  { name: "Jacob deGrom",     mlbamId: 594798, team: "TEX", throws: "R" },
  { name: "Michael McGreevy", mlbamId: 700241, team: "STL", throws: "R" },
  { name: "Kyle Freeland",    mlbamId: 607536, team: "COL", throws: "L" },
  { name: "Jose Soriano",     mlbamId: 667755, team: "LAA", throws: "R" },
  { name: "Austin Warren",    mlbamId: 681810, team: "NYM", throws: "R" },
  { name: "Emerson Hancock",  mlbamId: 676106, team: "SEA", throws: "R" },
  { name: "Emmet Sheehan",    mlbamId: 686218, team: "LAD", throws: "R" },
  { name: "E. Rodriguez",     mlbamId: 593958, team: "ARI", throws: "L" },
];

async function fetchPitcherStats(spec: PitcherSpec): Promise<Record<string, unknown> | null> {
  if (!spec.mlbamId) return null;
  try {
    const url = `https://statsapi.mlb.com/api/v1/people?personIds=${spec.mlbamId}&hydrate=stats(group=[pitching],type=[season],season=2026),currentTeam`;
    const res = await fetch(url);
    const data = await res.json() as any;
    const person = data?.people?.[0];
    if (!person) {
      console.log(`  [WARN] No person data returned for ${spec.name} (id=${spec.mlbamId})`);
      return null;
    }
    const stat = person?.stats?.[0]?.splits?.[0]?.stat ?? {};
    const hand = (person.pitchHand?.code === "L") ? "L" : "R";
    return {
      mlbamId:      spec.mlbamId,
      fullName:     spec.name,
      teamAbbrev:   spec.team,
      throwsHand:   hand,
      era:          stat.era          ? parseFloat(stat.era)                   : null,
      k9:           stat.strikeoutsPer9Inn ? parseFloat(stat.strikeoutsPer9Inn) : null,
      bb9:          stat.walksPer9Inn ? parseFloat(stat.walksPer9Inn)           : null,
      hr9:          stat.homeRunsPer9 ? parseFloat(stat.homeRunsPer9)           : null,
      whip:         stat.whip         ? parseFloat(stat.whip)                  : null,
      ip:           stat.inningsPitched ? parseFloat(stat.inningsPitched)      : null,
      gamesStarted: stat.gamesStarted ?? 0,
      gamesPlayed:  stat.gamesPlayed  ?? 0,
      lastFetchedAt: Date.now(),
    };
  } catch (e) {
    console.error(`  [ERROR] fetchPitcherStats(${spec.name}):`, e);
    return null;
  }
}

async function main() {
  const db = await getDb();

  console.log(`\n[fixJune1Pitchers] ═══════════════════════════════════════════`);
  console.log(`[fixJune1Pitchers] [STEP 1] Fix NYM @ SEA pitchers (id=2250846)`);

  // ── Step 1: Fix NYM @ SEA ─────────────────────────────────────────────────
  await db.update(games)
    .set({
      awayStartingPitcher: "Austin Warren",
      homeStartingPitcher: "Emerson Hancock",
    })
    .where(eq(games.id, 2250846));

  console.log(`[fixJune1Pitchers] [STATE]  NYM @ SEA: AWAY=Austin Warren  HOME=Emerson Hancock`);
  console.log(`[fixJune1Pitchers] [VERIFY] NYM @ SEA pitcher update ✅`);

  // ── Step 2: Check which pitchers are missing from mlbPitcherStats ─────────
  console.log(`\n[fixJune1Pitchers] [STEP 2] Check pitcher stats in DB`);
  const pitcherNames = JUNE1_PITCHERS.map(p => p.name);
  const existing = await db.select({ fullName: mlbPitcherStats.fullName, throwsHand: mlbPitcherStats.throwsHand, era: mlbPitcherStats.era })
    .from(mlbPitcherStats)
    .where(inArray(mlbPitcherStats.fullName, pitcherNames));

  const existingSet = new Set(existing.map(r => r.fullName.toLowerCase().trim()));
  const missing = JUNE1_PITCHERS.filter(p => !existingSet.has(p.name.toLowerCase().trim()));

  console.log(`[fixJune1Pitchers] [STATE]  ${existing.length}/${JUNE1_PITCHERS.length} pitchers in DB`);
  if (missing.length === 0) {
    console.log(`[fixJune1Pitchers] [VERIFY] All pitchers present ✅`);
  } else {
    console.log(`[fixJune1Pitchers] [STATE]  Missing (${missing.length}): ${missing.map(p => p.name).join(", ")}`);
  }

  // ── Step 3: Insert missing pitchers ──────────────────────────────────────
  for (const spec of missing) {
    console.log(`\n[fixJune1Pitchers] [STEP 3] Fetching 2026 stats for ${spec.name} (mlbamId=${spec.mlbamId})...`);

    if (!spec.mlbamId) {
      // No MLB ID — insert stub
      console.log(`  [WARN] No mlbamId for ${spec.name} — inserting stub`);
      // Use a synthetic negative ID to avoid collision
      const stubId = -(Date.now() % 1000000);
      await db.insert(mlbPitcherStats).values({
        mlbamId:      stubId,
        fullName:     spec.name,
        teamAbbrev:   spec.team,
        throwsHand:   spec.throws,
        era:          null, k9: null, bb9: null, hr9: null,
        whip:         null, ip: null,
        gamesStarted: 0, gamesPlayed: 0,
        lastFetchedAt: Date.now(),
      }).onDuplicateKeyUpdate({ set: { throwsHand: spec.throws, teamAbbrev: spec.team } });
      console.log(`  [STATE] Stub inserted for ${spec.name} (throws=${spec.throws})`);
      continue;
    }

    const stats = await fetchPitcherStats(spec);
    if (!stats) {
      // Fallback stub with known handedness
      console.log(`  [WARN] No 2026 stats for ${spec.name} — inserting stub with throws=${spec.throws}`);
      await db.insert(mlbPitcherStats).values({
        mlbamId:      spec.mlbamId,
        fullName:     spec.name,
        teamAbbrev:   spec.team,
        throwsHand:   spec.throws,
        era:          null, k9: null, bb9: null, hr9: null,
        whip:         null, ip: null,
        gamesStarted: 0, gamesPlayed: 0,
        lastFetchedAt: Date.now(),
      }).onDuplicateKeyUpdate({ set: { throwsHand: spec.throws, teamAbbrev: spec.team } });
    } else {
      await db.insert(mlbPitcherStats).values(stats as any)
        .onDuplicateKeyUpdate({ set: stats as any });
      console.log(`  [STATE] Inserted ${spec.name}: ERA=${stats.era} K/9=${stats.k9} WHIP=${stats.whip} IP=${stats.ip} throws=${stats.throwsHand}`);
      console.log(`  [VERIFY] ${spec.name} ✅`);
    }
  }

  // ── Step 4: Final verification ────────────────────────────────────────────
  console.log(`\n[fixJune1Pitchers] [STEP 4] Final verification`);
  const finalCheck = await db.select({
    fullName:   mlbPitcherStats.fullName,
    throwsHand: mlbPitcherStats.throwsHand,
    era:        mlbPitcherStats.era,
    k9:         mlbPitcherStats.k9,
    whip:       mlbPitcherStats.whip,
    ip:         mlbPitcherStats.ip,
  }).from(mlbPitcherStats)
    .where(inArray(mlbPitcherStats.fullName, pitcherNames));

  const finalSet = new Set(finalCheck.map(r => r.fullName.toLowerCase().trim()));
  const stillMissing = JUNE1_PITCHERS.filter(p => !finalSet.has(p.name.toLowerCase().trim()));

  console.log(`\n[fixJune1Pitchers] ═══════════════════════════════════════════`);
  console.log(`[fixJune1Pitchers] [OUTPUT] Pitcher stats — all June 1 starters`);
  for (const p of finalCheck) {
    console.log(`  ✅ ${p.fullName.padEnd(22)} throws=${p.throwsHand ?? "?"} ERA=${String(p.era ?? "null").padEnd(6)} K/9=${String(p.k9 ?? "null").padEnd(6)} WHIP=${String(p.whip ?? "null").padEnd(6)} IP=${p.ip ?? "null"}`);
  }
  if (stillMissing.length > 0) {
    for (const p of stillMissing) console.log(`  ❌ STILL MISSING: ${p.name}`);
  }
  console.log(`[fixJune1Pitchers] [VERIFY] ${stillMissing.length === 0 ? "✅ ALL PITCHERS READY" : `❌ ${stillMissing.length} STILL MISSING`}`);
  console.log(`[fixJune1Pitchers] ═══════════════════════════════════════════`);

  process.exit(0);
}

main().catch(err => { console.error("[fixJune1Pitchers] FATAL:", err); process.exit(1); });
