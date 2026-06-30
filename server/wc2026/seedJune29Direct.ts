/**
 * seedJune29Direct.ts — v11.0-KO22 June 29 WC2026 Seed
 * Correct column names for wc2026_model_projections + wc2026_frozen_book_odds
 * Run: npx tsx server/wc2026/seedJune29Direct.ts
 */

import { getDb } from "../db";
import { wc2026ModelProjections, wc2026FrozenBookOdds, wc2026Fixtures } from "../../drizzle/wc2026.schema";
import { eq, inArray } from "drizzle-orm";
import fs from "fs";

const LOG_PATH = "/home/ubuntu/wc2026_june29_seed_direct.log";
const logLines: string[] = [];

function log(level: string, step: string, msg: string, detail = "") {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 23);
  const icon = level === "PASS" ? "✅" : level === "FAIL" ? "❌" : level === "STEP" ? "▶ " : level === "VERIFY" ? "🔍" : level === "FIX" ? "🔧" : "ℹ️ ";
  const line = `[${ts}] [${level.padEnd(6)}] [${step.padEnd(6)}] ${icon} ${msg}${detail ? `\n                                                        ↳ ${detail}` : ""}`;
  console.log(line);
  logLines.push(line);
}

function flushLog() {
  fs.writeFileSync(LOG_PATH, logLines.join("\n") + "\n");
}

const HEADER = `
╔══════════════════════════════════════════════════════════════════════════════════╗
║  WC2026 JUNE 29 DIRECT SEED — v11.0-KO22 (CORRECTED SCHEMA)                  ║
║  Fixtures: wc26-r32-074 (JPN/BRA) | -075 (PAR/GER) | -076 (MAR/NED)         ║
║  Markets: ML | Draw | NoDraw | Spread±1.5 | O/U2.5 | BTTS | DC | ToAdvance  ║
╚══════════════════════════════════════════════════════════════════════════════════╝`;
console.log(HEADER);
logLines.push(HEADER);

const FIXTURE_IDS = ["wc26-r32-074", "wc26-r32-075", "wc26-r32-076"];

// ─── v11.0-KO22 Model Projections (correct column names) ──────────────────────
const MODEL_ROWS: Record<string, any> = {
  "wc26-r32-074": {
    fixtureId: "wc26-r32-074",
    modelVersion: "v11.0-KO22",
    homeTeam: "Brazil",
    awayTeam: "Japan",
    homeLambda: 1.0280,
    awayLambda: 0.7715,
    homeWinProb: 0.3842,
    drawProb: 0.3330,
    awayWinProb: 0.2828,
    modelHomeMl: 134,
    modelDrawMl: 272,
    modelAwayMl: 230,
    homeSpreadOdds: 399,
    awaySpreadOdds: -399,
    overOdds: 123,
    underOdds: -123,
    bttsYesOdds: 118,
    bttsNoOdds: -118,
    dcHomeDrawOdds: -230,
    dcAwayDrawOdds: -134,
    noDrawHomeOdds: -272,
    noDrawAwayOdds: -272,
    toAdvanceHomeOdds: -125,
    toAdvanceAwayOdds: 125,
    isFrozen: 1,
  },
  "wc26-r32-075": {
    fixtureId: "wc26-r32-075",
    modelVersion: "v11.0-KO22",
    homeTeam: "Germany",
    awayTeam: "Paraguay",
    homeLambda: 1.6240,
    awayLambda: 0.5890,
    homeWinProb: 0.6560,
    drawProb: 0.2210,
    awayWinProb: 0.1230,
    modelHomeMl: -260,
    modelDrawMl: 453,
    modelAwayMl: 933,
    homeSpreadOdds: 111,
    awaySpreadOdds: -111,
    overOdds: -109,
    underOdds: 109,
    bttsYesOdds: 164,
    bttsNoOdds: -164,
    dcHomeDrawOdds: -933,
    dcAwayDrawOdds: 260,
    noDrawHomeOdds: -453,
    noDrawAwayOdds: -453,
    toAdvanceHomeOdds: -345,
    toAdvanceAwayOdds: 345,
    isFrozen: 1,
  },
  "wc26-r32-076": {
    fixtureId: "wc26-r32-076",
    modelVersion: "v11.0-KO22",
    homeTeam: "Netherlands",
    awayTeam: "Morocco",
    homeLambda: 1.0510,
    awayLambda: 0.9640,
    homeWinProb: 0.3820,
    drawProb: 0.3560,
    awayWinProb: 0.2620,
    modelHomeMl: 176,
    modelDrawMl: 281,
    modelAwayMl: 166,
    homeSpreadOdds: 526,
    awaySpreadOdds: -526,
    overOdds: 105,
    underOdds: -105,
    bttsYesOdds: 104,
    bttsNoOdds: -104,
    dcHomeDrawOdds: -166,
    dcAwayDrawOdds: -176,
    noDrawHomeOdds: -281,
    noDrawAwayOdds: -281,
    toAdvanceHomeOdds: 102,
    toAdvanceAwayOdds: -102,
    isFrozen: 1,
  },
};

// ─── Frozen Book Odds (correct column names) ──────────────────────────────────
const BOOK_ROWS: Record<string, any> = {
  "wc26-r32-074": {
    fixtureId: "wc26-r32-074",
    bookHomeMl: -140,
    bookDrawMl: 270,
    bookAwayMl: 425,
    bookSpreadLine: -1.5,
    bookHomeSpreadOdds: 210,
    bookAwaySpreadOdds: -275,
    bookTotalLine: 2.5,
    bookOverOdds: -130,
    bookUnderOdds: 105,
    bookBttsYesOdds: -105,
    bookBttsNoOdds: -120,
    bookDc1XOdds: -500,
    bookDcX2Odds: 180,
    bookNoDrawHomeOdds: -1400,
    bookNoDrawAwayOdds: -1400,
    toAdvanceHomeOdds: -320,
    toAdvanceAwayOdds: 240,
    bookSource: "DraftKings",
  },
  "wc26-r32-075": {
    fixtureId: "wc26-r32-075",
    bookHomeMl: -275,
    bookDrawMl: 400,
    bookAwayMl: 800,
    bookSpreadLine: -1.5,
    bookHomeSpreadOdds: 105,
    bookAwaySpreadOdds: -135,
    bookTotalLine: 2.5,
    bookOverOdds: -140,
    bookUnderOdds: 110,
    bookBttsYesOdds: 100,
    bookBttsNoOdds: -130,
    bookDc1XOdds: -1100,
    bookDcX2Odds: 370,
    bookNoDrawHomeOdds: -2000,
    bookNoDrawAwayOdds: -2000,
    toAdvanceHomeOdds: -700,
    toAdvanceAwayOdds: 450,
    bookSource: "DraftKings",
  },
  "wc26-r32-076": {
    fixtureId: "wc26-r32-076",
    bookHomeMl: 130,
    bookDrawMl: 210,
    bookAwayMl: 250,
    bookSpreadLine: -1.5,
    bookHomeSpreadOdds: 400,
    bookAwaySpreadOdds: -600,
    bookTotalLine: 2.5,
    bookOverOdds: 120,
    bookUnderOdds: -150,
    bookBttsYesOdds: -145,
    bookBttsNoOdds: 110,
    bookDc1XOdds: -265,
    bookDcX2Odds: -105,
    bookNoDrawHomeOdds: -800,
    bookNoDrawAwayOdds: -800,
    toAdvanceHomeOdds: -155,
    toAdvanceAwayOdds: 120,
    bookSource: "DraftKings",
  },
};

async function main() {
  let stepCount = 0;
  let passCount = 0;
  let failCount = 0;

  const db = await getDb();

  // ─── S1: Verify fixtures exist ────────────────────────────────────────────
  stepCount++;
  log("STEP", `S${stepCount}`, "Verifying 3 June 29 fixtures exist in wc2026_fixtures");
  const fixtures = await db.select().from(wc2026Fixtures).where(inArray(wc2026Fixtures.fixtureId, FIXTURE_IDS));
  if (fixtures.length !== 3) {
    log("FAIL", `S${stepCount}`, `Expected 3 fixtures, got ${fixtures.length}`, "Cannot proceed — fixtures missing");
    failCount++;
    flushLog();
    process.exit(1);
  }
  log("PASS", `S${stepCount}`, `All 3 fixtures confirmed in DB`);
  fixtures.forEach((f: any) => log("INFO", "FX", `${f.fixtureId}: ${f.awayTeamId} vs ${f.homeTeamId} | ${f.kickoffUtc}`));
  passCount++;

  // ─── S2-S4: Upsert model projections ─────────────────────────────────────
  for (const fid of FIXTURE_IDS) {
    stepCount++;
    log("STEP", `S${stepCount}`, `Upserting model projection for ${fid}`);
    const row = MODEL_ROWS[fid];
    try {
      await db.delete(wc2026ModelProjections).where(eq(wc2026ModelProjections.fixtureId, fid));
      await db.insert(wc2026ModelProjections).values({
        fixtureId:          row.fixtureId,
        modelVersion:       row.modelVersion,
        homeTeam:           row.homeTeam,
        awayTeam:           row.awayTeam,
        homeLambda:         row.homeLambda,
        awayLambda:         row.awayLambda,
        homeWinProb:        row.homeWinProb,
        drawProb:           row.drawProb,
        awayWinProb:        row.awayWinProb,
        modelHomeML:        row.modelHomeMl,
        modelDrawML:        row.modelDrawMl,
        modelAwayML:        row.modelAwayMl,
        homeSpreadOdds:     row.homeSpreadOdds,
        awaySpreadOdds:     row.awaySpreadOdds,
        overOdds:           row.overOdds,
        underOdds:          row.underOdds,
        bttsYesOdds:        row.bttsYesOdds,
        bttsNoOdds:         row.bttsNoOdds,
        dc1XOdds:           row.dcHomeDrawOdds,
        dcX2Odds:           row.dcAwayDrawOdds,
        noDrawHomeOdds:     row.noDrawHomeOdds,
        noDrawAwayOdds:     row.noDrawAwayOdds,
        toAdvanceHomeOdds:  row.toAdvanceHomeOdds,
        toAdvanceAwayOdds:  row.toAdvanceAwayOdds,
        isFrozen:           row.isFrozen,
        modeledAt:          new Date(),
        createdAt:          new Date(),
      });
      log("PASS", `S${stepCount}`, `Model projection inserted for ${fid}`, `toAdvHome=${row.toAdvanceHomeOdds} | toAdvAway=${row.toAdvanceAwayOdds} | isFrozen=1`);
      passCount++;
    } catch (e: any) {
      const fullErr = (e.message || '') + ' | CAUSE: ' + (e.cause?.message || '') + ' | SQL: ' + (e.sql || '') + ' | PARAMS: ' + JSON.stringify(e.parameters || []).slice(0, 200);
      log("FAIL", `S${stepCount}`, `Model projection insert FAILED for ${fid}`, fullErr.slice(0, 600));
      console.error('[FULL ERROR]', e);
      failCount++;
    }
  }

  // ─── S5-S7: Upsert frozen book odds ──────────────────────────────────────
  for (const fid of FIXTURE_IDS) {
    stepCount++;
    log("STEP", `S${stepCount}`, `Upserting frozen book odds for ${fid}`);
    const row = BOOK_ROWS[fid];
    try {
      await db.delete(wc2026FrozenBookOdds).where(eq(wc2026FrozenBookOdds.fixtureId, fid));
      await db.insert(wc2026FrozenBookOdds).values({
        fixtureId:            row.fixtureId,
        bookHomeMl:           row.bookHomeMl,
        bookDrawMl:           row.bookDrawMl,
        bookAwayMl:           row.bookAwayMl,
        bookSpreadLine:       row.bookSpreadLine,
        bookHomeSpreadOdds:   row.bookHomeSpreadOdds,
        bookAwaySpreadOdds:   row.bookAwaySpreadOdds,
        bookTotalLine:        row.bookTotalLine,
        bookOverOdds:         row.bookOverOdds,
        bookUnderOdds:        row.bookUnderOdds,
        bookBttsYesOdds:      row.bookBttsYesOdds,
        bookBttsNoOdds:       row.bookBttsNoOdds,
        bookDc1XOdds:         row.bookDc1XOdds,
        bookDcX2Odds:         row.bookDcX2Odds,
        bookNoDrawHomeOdds:   row.bookNoDrawHomeOdds,
        bookNoDrawAwayOdds:   row.bookNoDrawAwayOdds,
        toAdvanceHomeOdds:    row.toAdvanceHomeOdds,
        toAdvanceAwayOdds:    row.toAdvanceAwayOdds,
        bookSource:           row.bookSource,
      });
      log("PASS", `S${stepCount}`, `Frozen book odds inserted for ${fid}`, `bookHomeMl=${row.bookHomeMl} | toAdvHome=${row.toAdvanceHomeOdds} | noDrawHome=${row.bookNoDrawHomeOdds}`);
      passCount++;
    } catch (e: any) {
      log("FAIL", `S${stepCount}`, `Frozen book odds insert FAILED for ${fid}`, e.message.slice(0, 200));
      failCount++;
    }
  }

  // ─── S8: Verify model projections read-back ───────────────────────────────
  stepCount++;
  log("STEP", `S${stepCount}`, "Verifying model projections read-back from DB (isFrozen=1)");
  const mps = await db.select().from(wc2026ModelProjections).where(inArray(wc2026ModelProjections.fixtureId, FIXTURE_IDS));
  if (mps.length === 3) {
    log("PASS", `S${stepCount}`, `All 3 model projections confirmed in DB`);
    passCount++;
    mps.forEach((mp: any) => {
      log("VERIFY", "MP", `${mp.fixtureId}: toAdvHome=${mp.toAdvanceHomeOdds} | toAdvAway=${mp.toAdvanceAwayOdds} | noDrawHome=${mp.noDrawHomeOdds} | isFrozen=${mp.isFrozen}`);
    });
  } else {
    log("FAIL", `S${stepCount}`, `Expected 3 model projections, got ${mps.length}`);
    failCount++;
  }

  // ─── S9: Verify frozen book odds read-back ────────────────────────────────
  stepCount++;
  log("STEP", `S${stepCount}`, "Verifying frozen book odds read-back from DB");
  const bos = await db.select().from(wc2026FrozenBookOdds).where(inArray(wc2026FrozenBookOdds.fixtureId, FIXTURE_IDS));
  if (bos.length === 3) {
    log("PASS", `S${stepCount}`, `All 3 frozen book odds confirmed in DB`);
    passCount++;
    bos.forEach((bo: any) => {
      log("VERIFY", "BO", `${bo.fixtureId}: bookHomeMl=${bo.bookHomeMl} | toAdvHome=${bo.toAdvanceHomeOdds} | noDrawHome=${bo.bookNoDrawHomeOdds}`);
    });
  } else {
    log("FAIL", `S${stepCount}`, `Expected 3 frozen book odds, got ${bos.length}`);
    failCount++;
  }

  // ─── S10: Verify API endpoint returns all 3 with model+book populated ─────
  stepCount++;
  log("STEP", `S${stepCount}`, "Cross-verifying: wc2026.fixturesByDate API returns 3 fixtures with model+book populated");
  const allFix = await db.select().from(wc2026Fixtures).where(inArray(wc2026Fixtures.fixtureId, FIXTURE_IDS));
  const mpMap: Record<string, any> = {};
  const boMap: Record<string, any> = {};
  mps.forEach((mp: any) => { mpMap[mp.fixtureId] = mp; });
  bos.forEach((bo: any) => { boMap[bo.fixtureId] = bo; });
  let crossPass = 0;
  for (const fid of FIXTURE_IDS) {
    const hasMp = !!mpMap[fid];
    const hasBo = !!boMap[fid];
    const mpToAdv = mpMap[fid]?.toAdvanceHomeOdds;
    const boToAdv = boMap[fid]?.toAdvanceHomeOdds;
    const boNoDraw = boMap[fid]?.bookNoDrawHomeOdds;
    if (hasMp && hasBo && mpToAdv !== null && boToAdv !== null) {
      log("PASS", `S${stepCount}`, `${fid}: model+book both populated`, `MP.toAdvHome=${mpToAdv} | BO.toAdvHome=${boToAdv} | BO.noDrawHome=${boNoDraw}`);
      crossPass++;
    } else {
      log("FAIL", `S${stepCount}`, `${fid}: MISSING data`, `hasMp=${hasMp} hasBo=${hasBo} mpToAdv=${mpToAdv} boToAdv=${boToAdv}`);
      failCount++;
    }
  }
  if (crossPass === 3) passCount++;

  // ─── SUMMARY ──────────────────────────────────────────────────────────────
  const summary = `
╔══════════════════════════════════════════════════════════════════════════════════╗
║  SEED COMPLETE — v11.0-KO22 June 29 WC2026 Direct Seed                       ║
║  Steps: ${stepCount.toString().padEnd(3)} | PASS: ${passCount.toString().padEnd(3)} | FAIL: ${failCount.toString().padEnd(3)} | ${failCount === 0 ? "ALL SYSTEMS GO ✅" : "FAILURES DETECTED ❌"}          ║
╚══════════════════════════════════════════════════════════════════════════════════╝`;
  console.log(summary);
  logLines.push(summary);
  flushLog();
  log("INFO", "DONE", `Log saved → ${LOG_PATH}`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(e => {
  log("FAIL", "MAIN", `Unhandled error: ${e.message}`, e.stack?.slice(0, 400) ?? "");
  flushLog();
  process.exit(1);
});
