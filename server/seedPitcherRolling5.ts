/**
 * seedPitcherRolling5.ts
 *
 * Fetches the last 5 game starts for every pitcher in mlb_pitcher_stats,
 * computes rolling ERA, K/9, BB/9, HR/9, WHIP, and FIP from those starts,
 * and upserts into mlb_pitcher_rolling5.
 *
 * Data source:
 *   GET /api/v1/people/{id}/stats?stats=gameLog&group=pitching&season=2026
 *   Filters to entries where stat.gamesStarted >= 1 (GS only, not relief)
 *   Takes the last 5 chronologically
 *
 * Derived metrics (computed from raw game log totals):
 *   era5  = ER5 / IP5 * 9
 *   k9_5  = K5  / IP5 * 9
 *   bb9_5 = BB5 / IP5 * 9
 *   hr9_5 = HR5 / IP5 * 9
 *   whip5 = (H5 + BB5) / IP5
 *   fip5  = (13*HR5 + 3*BB5 - 2*K5) / IP5 + FIP_CONSTANT
 *
 * FIP constant: 3.10 (standard MLB league-average FIP constant for 2026)
 *
 * IP parsing: "6.1" = 6 + 1/3 = 6.333..., "6.2" = 6 + 2/3 = 6.667...
 *
 * Execution model:
 *   - Reads all unique mlbamIds from mlb_pitcher_stats
 *   - Fetches game logs in parallel (concurrency=10)
 *   - Computes rolling-5 stats
 *   - Upserts on mlbamId unique key
 *   - Full structured logging at every stage
 *
 * Usage:
 *   npx tsx server/seedPitcherRolling5.ts
 */

import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { mlbPitcherStats, mlbPitcherRolling5 } from "../drizzle/schema";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Standard FIP constant (league-average ERA minus FIP components, 2026 estimate) */
const FIP_CONSTANT = 3.10;

/** Number of starts in the rolling window */
const ROLLING_WINDOW = 5;

// ─── IP Parsing ───────────────────────────────────────────────────────────────

/**
 * Parses MLB "innings pitched" string to decimal.
 * "6.1" = 6 + 1/3 = 6.3333
 * "6.2" = 6 + 2/3 = 6.6667
 * "6.0" = 6.0
 * "0"   = 0.0
 */
function parseIP(ipStr: string | number): number {
  const s = String(ipStr);
  const parts = s.split(".");
  const whole = parseInt(parts[0], 10) || 0;
  const outs = parseInt(parts[1] || "0", 10);
  return whole + outs / 3;
}

// ─── Rolling Stats Computation ────────────────────────────────────────────────

interface GameLogEntry {
  date: string;
  ip: number;
  er: number;
  h: number;
  bb: number;
  k: number;
  hr: number;
}

interface Rolling5Result {
  startsIncluded: number;
  ip5: number;
  er5: number;
  h5: number;
  bb5: number;
  k5: number;
  hr5: number;
  era5: number | null;
  k9_5: number | null;
  bb9_5: number | null;
  hr9_5: number | null;
  whip5: number | null;
  fip5: number | null;
  lastStartDate: string | null;
  firstStartDate: string | null;
}

function computeRolling5(starts: GameLogEntry[]): Rolling5Result {
  // Take last N starts (already sorted chronologically by API)
  const window = starts.slice(-ROLLING_WINDOW);
  const n = window.length;

  if (n === 0) {
    return {
      startsIncluded: 0,
      ip5: 0, er5: 0, h5: 0, bb5: 0, k5: 0, hr5: 0,
      era5: null, k9_5: null, bb9_5: null, hr9_5: null,
      whip5: null, fip5: null,
      lastStartDate: null, firstStartDate: null,
    };
  }

  // Sum all components
  let ip5 = 0, er5 = 0, h5 = 0, bb5 = 0, k5 = 0, hr5 = 0;
  for (const g of window) {
    ip5 += g.ip;
    er5 += g.er;
    h5  += g.h;
    bb5 += g.bb;
    k5  += g.k;
    hr5 += g.hr;
  }

  // Round IP to 4 decimal places to avoid floating-point drift
  ip5 = Math.round(ip5 * 10000) / 10000;

  if (ip5 === 0) {
    return {
      startsIncluded: n,
      ip5: 0, er5, h5, bb5, k5, hr5,
      era5: null, k9_5: null, bb9_5: null, hr9_5: null,
      whip5: null, fip5: null,
      lastStartDate: window[n - 1].date,
      firstStartDate: window[0].date,
    };
  }

  // Derived rates
  const era5  = Math.round((er5 / ip5 * 9) * 10000) / 10000;
  const k9_5  = Math.round((k5  / ip5 * 9) * 10000) / 10000;
  const bb9_5 = Math.round((bb5 / ip5 * 9) * 10000) / 10000;
  const hr9_5 = Math.round((hr5 / ip5 * 9) * 10000) / 10000;
  const whip5 = Math.round(((h5 + bb5) / ip5) * 10000) / 10000;
  // FIP = (13*HR + 3*BB - 2*K) / IP + constant
  const fip5  = Math.round(((13 * hr5 + 3 * bb5 - 2 * k5) / ip5 + FIP_CONSTANT) * 10000) / 10000;

  return {
    startsIncluded: n,
    ip5, er5, h5, bb5, k5, hr5,
    era5, k9_5, bb9_5, hr9_5, whip5, fip5,
    lastStartDate: window[n - 1].date,
    firstStartDate: window[0].date,
  };
}

// ─── MLB API Fetch ────────────────────────────────────────────────────────────

async function fetchGameLog(mlbamId: number): Promise<GameLogEntry[]> {
  const url = `https://statsapi.mlb.com/api/v1/people/${mlbamId}/stats?stats=gameLog&group=pitching&season=2026`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  const splits = data?.stats?.[0]?.splits ?? [];

  // Filter to starts only (gamesStarted >= 1)
  const starts: GameLogEntry[] = [];
  for (const s of splits) {
    const st = s.stat;
    if (Number(st.gamesStarted) < 1) continue; // skip relief appearances
    starts.push({
      date: s.date ?? "",
      ip: parseIP(st.inningsPitched ?? "0"),
      er: Number(st.earnedRuns) || 0,
      h:  Number(st.hits) || 0,
      bb: Number(st.baseOnBalls) || 0,
      k:  Number(st.strikeOuts) || 0,
      hr: Number(st.homeRuns) || 0,
    });
  }

  return starts; // already in chronological order from API
}

// ─── Concurrency Pool ─────────────────────────────────────────────────────────

async function runConcurrent<T>(
  items: T[],
  fn: (item: T, idx: number) => Promise<void>,
  concurrency: number
): Promise<void> {
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function seedPitcherRolling5(): Promise<{
  total: number;
  upserted: number;
  noStarts: number;
  errors: number;
}> {
  const db = await getDb();
  const now = Date.now();

  // ── Step 1: Load all unique pitchers from DB ───────────────────────────────
  console.log("[INPUT] Loading all pitchers from mlb_pitcher_stats...");
  const allPitchers = await db.select({
    mlbamId: mlbPitcherStats.mlbamId,
    fullName: mlbPitcherStats.fullName,
    teamAbbrev: mlbPitcherStats.teamAbbrev,
  }).from(mlbPitcherStats);

  // Deduplicate by mlbamId
  const uniqueMap = new Map<number, { mlbamId: number; fullName: string; teamAbbrev: string }>();
  for (const p of allPitchers) {
    if (!uniqueMap.has(p.mlbamId)) uniqueMap.set(p.mlbamId, p);
  }
  const uniquePitchers = Array.from(uniqueMap.values());

  console.log(`[STATE] Loaded ${uniquePitchers.length} unique pitchers (from ${allPitchers.length} DB rows)`);
  console.log(`[STATE] Rolling window: last ${ROLLING_WINDOW} starts | FIP constant: ${FIP_CONSTANT}`);

  // ── Step 2: Fetch game logs and compute rolling stats ─────────────────────
  const rollingRows: Array<{
    mlbamId: number;
    fullName: string;
    teamAbbrev: string;
    rolling: Rolling5Result;
  }> = [];
  let fetchErrors = 0;
  let noStarts = 0;

  console.log(`\n[STEP] Fetching game logs for ${uniquePitchers.length} pitchers (concurrency=10)...`);

  await runConcurrent(uniquePitchers, async (pitcher, i) => {
    const { mlbamId, fullName, teamAbbrev } = pitcher;
    const prefix = `  [${i + 1}/${uniquePitchers.length}] ${fullName} (${mlbamId})`;

    try {
      const starts = await fetchGameLog(mlbamId);
      const rolling = computeRolling5(starts);

      if (rolling.startsIncluded === 0) {
        noStarts++;
        console.log(`${prefix} — ⚠ No starts found in 2026 game log`);
      } else {
        console.log(
          `${prefix} — ✓ ${rolling.startsIncluded} starts | ` +
          `IP=${rolling.ip5.toFixed(1)} ERA=${rolling.era5?.toFixed(2)} ` +
          `K/9=${rolling.k9_5?.toFixed(2)} BB/9=${rolling.bb9_5?.toFixed(2)} ` +
          `HR/9=${rolling.hr9_5?.toFixed(2)} WHIP=${rolling.whip5?.toFixed(3)} ` +
          `FIP=${rolling.fip5?.toFixed(2)} | ` +
          `${rolling.firstStartDate} → ${rolling.lastStartDate}`
        );
      }

      rollingRows.push({ mlbamId, fullName, teamAbbrev, rolling });
    } catch (e: any) {
      fetchErrors++;
      console.error(`${prefix} — ✗ ERROR: ${e.message}`);
      rollingRows.push({
        mlbamId, fullName, teamAbbrev,
        rolling: {
          startsIncluded: 0,
          ip5: 0, er5: 0, h5: 0, bb5: 0, k5: 0, hr5: 0,
          era5: null, k9_5: null, bb9_5: null, hr9_5: null,
          whip5: null, fip5: null,
          lastStartDate: null, firstStartDate: null,
        },
      });
    }
  }, 10);

  console.log(`\n[STATE] Fetch complete: ${rollingRows.length} processed, ${noStarts} no-starts, ${fetchErrors} errors`);

  // ── Step 3: Upsert into mlb_pitcher_rolling5 ──────────────────────────────
  console.log(`[STEP] Upserting ${rollingRows.length} rows into mlb_pitcher_rolling5...`);
  let upserted = 0;
  let upsertErrors = 0;

  for (const { mlbamId, fullName, teamAbbrev, rolling } of rollingRows) {
    try {
      const existing = await db.select({ id: mlbPitcherRolling5.id })
        .from(mlbPitcherRolling5)
        .where(eq(mlbPitcherRolling5.mlbamId, mlbamId))
        .limit(1);

      const payload = {
        mlbamId,
        fullName,
        teamAbbrev,
        startsIncluded: rolling.startsIncluded,
        ip5: rolling.ip5 || null,
        er5: rolling.er5,
        h5:  rolling.h5,
        bb5: rolling.bb5,
        k5:  rolling.k5,
        hr5: rolling.hr5,
        era5:  rolling.era5,
        k9_5:  rolling.k9_5,
        bb9_5: rolling.bb9_5,
        hr9_5: rolling.hr9_5,
        whip5: rolling.whip5,
        fip5:  rolling.fip5,
        lastStartDate:  rolling.lastStartDate,
        firstStartDate: rolling.firstStartDate,
        lastFetchedAt: now,
      };

      if (existing.length > 0) {
        await db.update(mlbPitcherRolling5).set(payload).where(eq(mlbPitcherRolling5.mlbamId, mlbamId));
      } else {
        await db.insert(mlbPitcherRolling5).values(payload);
      }
      upserted++;
    } catch (e: any) {
      upsertErrors++;
      console.error(`  [ERROR] DB upsert failed for ${fullName} (${mlbamId}): ${e.message}`);
    }
  }

  // ── Step 4: Validation ─────────────────────────────────────────────────────
  const totalRows = await db.select({ id: mlbPitcherRolling5.id }).from(mlbPitcherRolling5);
  const totalErrors = fetchErrors + upsertErrors;

  console.log("\n[OUTPUT] Rolling-5 seed complete:");
  console.log(`  Unique pitchers:   ${uniquePitchers.length}`);
  console.log(`  Rows upserted:     ${upserted}`);
  console.log(`  Total DB rows:     ${totalRows.length}`);
  console.log(`  No starts:         ${noStarts}`);
  console.log(`  Fetch errors:      ${fetchErrors}`);
  console.log(`  DB upsert errors:  ${upsertErrors}`);

  // Sample verification
  const sample = await db.select().from(mlbPitcherRolling5).limit(5);
  console.log("\n[VERIFY] Sample rows:");
  for (const r of sample) {
    console.log(
      `  ${r.fullName} (${r.teamAbbrev}): ${r.startsIncluded} starts | ` +
      `IP=${r.ip5?.toFixed(1)} ERA=${r.era5?.toFixed(2)} K/9=${r.k9_5?.toFixed(2)} ` +
      `WHIP=${r.whip5?.toFixed(3)} FIP=${r.fip5?.toFixed(2)} | ` +
      `${r.firstStartDate} → ${r.lastStartDate}`
    );
  }

  if (totalErrors === 0) {
    console.log("[VERIFY] ✅ PASS — 0 errors");
  } else {
    console.log(`[VERIFY] ⚠ ${totalErrors} total errors`);
  }

  return { total: uniquePitchers.length, upserted, noStarts, errors: totalErrors };
}

// ─── CLI Entry Point ──────────────────────────────────────────────────────────
// NOTE: must match on the script filename, not `import.meta.url === file://argv[1]` —
// inside the esbuild server bundle every module's import.meta.url equals the entry
// file's URL, so that comparison is true at server boot and process.exit() here
// kills the production server (observed as an instant crash at Railway boot).
if (process.argv[1]?.endsWith("seedPitcherRolling5.ts")) {
  seedPitcherRolling5()
    .then((r) => {
      console.log("\n[DONE]", r);
      process.exit(0);
    })
    .catch((e) => {
      console.error("[FATAL]", e);
      process.exit(1);
    });
}
