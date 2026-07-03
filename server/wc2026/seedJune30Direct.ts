/**
 * seedJune30Direct.ts — v11.0-KO23 June 30 WC2026 Seed
 * ─────────────────────────────────────────────────────────────────────────────
 * Matches:
 *   wc26-r32-077  Ivory Coast (H) vs Norway (A)   — 1pm ET  / 17:00 UTC
 *   wc26-r32-078  France (H) vs Sweden (A)         — 5pm ET  / 21:00 UTC (actually 23:00 UTC per DB)
 *   wc26-r32-079  Mexico (H) vs Ecuador (A)        — 9pm ET  / 01:00 UTC+1 (23:00 UTC per DB)
 *
 * Tables written:
 *   wc2026_frozen_book_odds   — all book markets (ML, Draw, Spread, Total, BTTS, DC, NoDraw, ToAdvance)
 *   wc2026_model_projections  — placeholder frozen row (isFrozen=1, book lines only, no lambda/prob yet)
 *
 * Markets mapped from user-provided odds:
 *   bookHomeMl / bookDrawMl / bookAwayMl
 *   bookSpreadLine / bookHomeSpreadOdds / bookAwaySpreadOdds
 *   bookTotalLine / bookOverOdds / bookUnderOdds
 *   bookBttsYesOdds / bookBttsNoOdds
 *   bookDc1XOdds (Home or Draw) / bookDcX2Odds (Away or Draw)
 *   bookNoDrawHomeOdds (Home or Away, no draw) / bookNoDrawAwayOdds
 *   toAdvanceHomeOdds / toAdvanceAwayOdds
 *
 * Run: npx tsx server/wc2026/seedJune30Direct.ts
 */

import { getDb } from "../db";
import { wc2026ModelProjections, wc2026FrozenBookOdds, wc2026Matches } from "../../drizzle/wc2026.schema";
import { eq, inArray } from "drizzle-orm";
import fs from "fs";

const LOG_PATH = "/home/ubuntu/wc2026_june30_seed_direct.log";
const logLines: string[] = [];

// ─── Logger ──────────────────────────────────────────────────────────────────
function log(level: string, step: string, msg: string, detail = "") {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 23);
  const icon =
    level === "PASS"   ? "✅" :
    level === "FAIL"   ? "❌" :
    level === "STEP"   ? "▶ " :
    level === "VERIFY" ? "🔍" :
    level === "FIX"    ? "🔧" :
    level === "INPUT"  ? "📥" :
    level === "STATE"  ? "📊" :
    level === "OUTPUT" ? "📤" :
    "ℹ️ ";
  const line = `[${ts}] [${level.padEnd(6)}] [${step.padEnd(8)}] ${icon} ${msg}${detail ? `\n                                                           ↳ ${detail}` : ""}`;
  console.log(line);
  logLines.push(line);
}

function flushLog() {
  fs.writeFileSync(LOG_PATH, logLines.join("\n") + "\n");
  log("INFO", "LOG", `Log flushed → ${LOG_PATH}`);
}

// ─── Header ──────────────────────────────────────────────────────────────────
const HEADER = `
╔══════════════════════════════════════════════════════════════════════════════════════╗
║  WC2026 JUNE 30 DIRECT SEED — v11.0-KO23                                          ║
║  Matches:                                                                         ║
║    wc26-r32-077  Ivory Coast (H) vs Norway (A)   — 1pm ET                         ║
║    wc26-r32-078  France (H) vs Sweden (A)         — 5pm ET                         ║
║    wc26-r32-079  Mexico (H) vs Ecuador (A)        — 9pm ET                         ║
║  Markets: ML | Draw | NoDraw | Spread | O/U | BTTS | DC | ToAdvance               ║
║  Tables: wc2026_frozen_book_odds | wc2026_model_projections                        ║
╚══════════════════════════════════════════════════════════════════════════════════════╝`;
console.log(HEADER);
logLines.push(HEADER);

const MATCH_IDS = ["wc26-r32-077", "wc26-r32-078", "wc26-r32-079"];

// ─────────────────────────────────────────────────────────────────────────────
// FROZEN BOOK ODDS — Mapped precisely from user-provided lines
// ─────────────────────────────────────────────────────────────────────────────
//
// IVORY COAST (H) vs NORWAY (A) — 1pm ET
//   Norway to Advance: −180  → toAdvanceAwayOdds = -180
//   Ivory Coast to Advance: +140 → toAdvanceHomeOdds = +140
//   Norway ML: +240 → bookAwayMl = +240
//   Ivory Coast ML: +255 → bookHomeMl = +255
//   Draw: +115 → bookDrawMl = +115
//   Norway or Ivory Coast (Double Chance): −1100 → bookDcX2Odds = -1100 (Away or Home, no draw)
//     NOTE: "Norway or Ivory Coast" = both teams = no draw possible = this is actually the
//     "either team wins" market. We map this as the combined DC covering both sides.
//     Per schema: bookDc1XOdds = Home or Draw (1X), bookDcX2Odds = Away or Draw (X2)
//     "Norway or Draw" = Away or Draw = X2 = bookDcX2Odds = -270
//     "Ivory Coast or Draw" = Home or Draw = 1X = bookDc1XOdds = +105
//     "Norway or Ivory Coast" = no draw = both teams advance = this is the "either team wins" line
//       → We store this in bookNoDrawHomeOdds/bookNoDrawAwayOdds as the combined no-draw line
//   Norway or Draw: −270 → bookDcX2Odds = -270 (Away or Draw)
//   Ivory Coast or Draw: +105 → bookDc1XOdds = +105 (Home or Draw)
//   Over 2.5: −115 → bookOverOdds = -115, bookTotalLine = 2.5
//   Under 2.5: −105 → bookUnderOdds = -105
//   Norway Spread: -0.5 (+105) → home is Ivory Coast, away is Norway
//     Norway spread -0.5 means Norway needs to win by 1+ = away spread -0.5 at +105
//     → bookSpreadLine = -0.5 (from away perspective), bookAwaySpreadOdds = +105
//     → bookHomeSpreadOdds = -135 (Ivory Coast +0.5)
//   Ivory Coast Spread: +0.5 (−135) → bookHomeSpreadOdds = -135 ✓
//   BTTS YES: −150 → bookBttsYesOdds = -150
//   BTTS NO: +120 → bookBttsNoOdds = +120
//
// NOTE on "Norway or Ivory Coast (Double Chance): −1100":
//   This is the "Either team wins (no draw)" market = noDrawHome + noDrawAway combined.
//   We store it as both bookNoDrawHomeOdds and bookNoDrawAwayOdds = -1100 (symmetric).
//
// ─────────────────────────────────────────────────────────────────────────────

const BOOK_ROWS: Record<string, any> = {
  // ── wc26-r32-077: IVORY COAST (H) vs NORWAY (A) ──────────────────────────
  "wc26-r32-077": {
    matchId:           "wc26-r32-077",
    // 1X2 Moneylines
    bookHomeMl:          255,   // Ivory Coast ML: +255
    bookDrawMl:          115,   // Draw: +115
    bookAwayMl:          240,   // Norway ML: +240
    // Spread: Norway -0.5 (+105) / Ivory Coast +0.5 (-135)
    // bookSpreadLine convention: home team's spread line
    // Home (Ivory Coast) is +0.5 at -135 → line = +0.5
    bookSpreadLine:      0.5,   // Ivory Coast +0.5
    bookHomeSpreadOdds:  -135,  // Ivory Coast +0.5 at -135
    bookAwaySpreadOdds:  105,   // Norway -0.5 at +105
    // Total
    bookTotalLine:       2.5,
    bookOverOdds:        -115,  // Over 2.5: -115
    bookUnderOdds:       -105,  // Under 2.5: -105
    // BTTS
    bookBttsYesOdds:     -150,  // BTTS YES: -150
    bookBttsNoOdds:      120,   // BTTS NO: +120
    // Double Chance: 1X = Home or Draw, X2 = Away or Draw
    bookDc1XOdds:        105,   // Ivory Coast or Draw: +105
    bookDcX2Odds:        -270,  // Norway or Draw: -270
    // No Draw (either team wins) — "Norway or Ivory Coast (Double Chance): -1100"
    bookNoDrawHomeOdds:  -1100, // Either team wins (no draw) — symmetric
    bookNoDrawAwayOdds:  -1100,
    // To Advance
    toAdvanceHomeOdds:   140,   // Ivory Coast to Advance: +140
    toAdvanceAwayOdds:   -180,  // Norway to Advance: -180
    bookSource:          "DraftKings",
  },

  // ── wc26-r32-078: FRANCE (H) vs SWEDEN (A) ───────────────────────────────
  //   Sweden to Advance: +500 → toAdvanceAwayOdds = +500
  //   France to Advance: −800 → toAdvanceHomeOdds = -800
  //   Sweden ML: +475 → bookAwayMl = +475
  //   France ML: −340 → bookHomeMl = -340
  //   Draw: +900 → bookDrawMl = +900
  //   Sweden or France (Double Chance): −3500 → "either team wins" → noDrawHome/Away = -3500
  //   Sweden or Draw: +500 → bookDcX2Odds = +500 (Away or Draw = X2)
  //   France or Draw: −1400 → bookDc1XOdds = -1400 (Home or Draw = 1X)
  //   Over 3.5: +115 → bookOverOdds = +115, bookTotalLine = 3.5
  //   Under 3.5: −145 → bookUnderOdds = -145
  //   Sweden Spread: +1.5 (−105) → Away team +1.5 at -105
  //     → bookSpreadLine = -1.5 (France -1.5 = home spread line)
  //     → bookHomeSpreadOdds = -125 (France -1.5 at -125)
  //     → bookAwaySpreadOdds = -105 (Sweden +1.5 at -105)
  //   France Spread: -1.5 (−125) → bookHomeSpreadOdds = -125 ✓
  //   BTTS YES: −135 → bookBttsYesOdds = -135
  //   BTTS NO: +105 → bookBttsNoOdds = +105
  "wc26-r32-078": {
    matchId:           "wc26-r32-078",
    bookHomeMl:          -340,  // France ML: -340
    bookDrawMl:          900,   // Draw: +900
    bookAwayMl:          475,   // Sweden ML: +475
    // Spread: France -1.5 (-125) / Sweden +1.5 (-105)
    bookSpreadLine:      -1.5,  // France -1.5 (home spread line)
    bookHomeSpreadOdds:  -125,  // France -1.5 at -125
    bookAwaySpreadOdds:  -105,  // Sweden +1.5 at -105
    // Total
    bookTotalLine:       3.5,
    bookOverOdds:        115,   // Over 3.5: +115
    bookUnderOdds:       -145,  // Under 3.5: -145
    // BTTS
    bookBttsYesOdds:     -135,  // BTTS YES: -135
    bookBttsNoOdds:      105,   // BTTS NO: +105
    // Double Chance
    bookDc1XOdds:        -1400, // France or Draw: -1400
    bookDcX2Odds:        500,   // Sweden or Draw: +500
    // No Draw (either team wins) — "Sweden or France (Double Chance): -3500"
    bookNoDrawHomeOdds:  -3500,
    bookNoDrawAwayOdds:  -3500,
    // To Advance
    toAdvanceHomeOdds:   -800,  // France to Advance: -800
    toAdvanceAwayOdds:   500,   // Sweden to Advance: +500
    bookSource:          "DraftKings",
  },

  // ── wc26-r32-079: MEXICO (H) vs ECUADOR (A) ──────────────────────────────
  //   Ecuador to Advance: +140 → toAdvanceAwayOdds = +140
  //   Mexico to Advance: −175 → toAdvanceHomeOdds = -175
  //   Ecuador ML: +190 → bookAwayMl = +190
  //   Mexico ML: +130 → bookHomeMl = +130
  //   Draw: +285 → bookDrawMl = +285
  //   Ecuador or Mexico (Double Chance): −700 → noDrawHome/Away = -700
  //   Ecuador or Draw: −105 → bookDcX2Odds = -105 (Away or Draw = X2)
  //   Mexico or Draw: −295 → bookDc1XOdds = -295 (Home or Draw = 1X)
  //   Over 1.5: −170 → bookOverOdds = -170, bookTotalLine = 1.5
  //   Under 1.5: +135 → bookUnderOdds = +135
  //   Mexico Spread: -0.5 (+120) → Home team -0.5 at +120
  //     → bookSpreadLine = -0.5 (Mexico -0.5 = home spread line)
  //     → bookHomeSpreadOdds = +120 (Mexico -0.5 at +120)
  //     → bookAwaySpreadOdds = -150 (Ecuador +0.5 at -150)
  //   Ecuador Spread: +0.5 (−150) → bookAwaySpreadOdds = -150 ✓
  //   BTTS YES: +120 → bookBttsYesOdds = +120
  //   BTTS NO: −155 → bookBttsNoOdds = -155
  "wc26-r32-079": {
    matchId:           "wc26-r32-079",
    bookHomeMl:          130,   // Mexico ML: +130
    bookDrawMl:          285,   // Draw: +285
    bookAwayMl:          190,   // Ecuador ML: +190
    // Spread: Mexico -0.5 (+120) / Ecuador +0.5 (-150)
    bookSpreadLine:      -0.5,  // Mexico -0.5 (home spread line)
    bookHomeSpreadOdds:  120,   // Mexico -0.5 at +120
    bookAwaySpreadOdds:  -150,  // Ecuador +0.5 at -150
    // Total
    bookTotalLine:       1.5,
    bookOverOdds:        -170,  // Over 1.5: -170
    bookUnderOdds:       135,   // Under 1.5: +135
    // BTTS
    bookBttsYesOdds:     120,   // BTTS YES: +120
    bookBttsNoOdds:      -155,  // BTTS NO: -155
    // Double Chance
    bookDc1XOdds:        -295,  // Mexico or Draw: -295
    bookDcX2Odds:        -105,  // Ecuador or Draw: -105
    // No Draw (either team wins) — "Ecuador or Mexico (Double Chance): -700"
    bookNoDrawHomeOdds:  -700,
    bookNoDrawAwayOdds:  -700,
    // To Advance
    toAdvanceHomeOdds:   -175,  // Mexico to Advance: -175
    toAdvanceAwayOdds:   140,   // Ecuador to Advance: +140
    bookSource:          "DraftKings",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// MODEL PROJECTION ROWS — Frozen placeholder rows (isFrozen=1)
// These hold the book lines as model reference; full lambda/prob to be run later
// ─────────────────────────────────────────────────────────────────────────────
const MODEL_ROWS: Record<string, any> = {
  "wc26-r32-077": {
    matchId:           "wc26-r32-077",
    modelVersion:        "v11.0-KO23",
    homeTeam:            "Ivory Coast",
    awayTeam:            "Norway",
    // Probabilities derived from book no-vig (to be updated after model run)
    // Norway to Advance -180 → implied 64.3% | Ivory Coast +140 → implied 41.7%
    // No-vig: NOR=60.7% CIV=39.3%
    toAdvanceHomeProb:   0.393,
    toAdvanceAwayProb:   0.607,
    toAdvanceHomeOdds:   140,
    toAdvanceAwayOdds:   -180,
    // 1X2 book no-vig (CIV +255 → 28.2%, Draw +115 → 46.5%, NOR +240 → 29.4%)
    // no-vig: CIV=27.0% Draw=44.5% NOR=28.1% (sum=99.6% → normalize)
    homeWinProb:         0.272,
    drawProb:            0.447,
    awayWinProb:         0.281,
    modelHomeML:         268,
    modelDrawML:         124,
    modelAwayML:         256,
    // Spread
    modelSpread:         0.5,
    homeSpreadOdds:      -135,
    awaySpreadOdds:      105,
    // Total
    modelTotal:          2.5,
    overOdds:            -115,
    underOdds:           -105,
    // BTTS
    bttsYesOdds:         -150,
    bttsNoOdds:          120,
    // Double chance
    dc1XOdds:            105,
    dcX2Odds:            -270,
    // No draw
    noDrawHomeOdds:      -1100,
    noDrawAwayOdds:      -1100,
    isFrozen:            1,
  },
  "wc26-r32-078": {
    matchId:           "wc26-r32-078",
    modelVersion:        "v11.0-KO23",
    homeTeam:            "France",
    awayTeam:            "Sweden",
    // France to Advance -800 → implied 88.9% | Sweden +500 → implied 16.7%
    // No-vig: FRA=84.2% SWE=15.8%
    toAdvanceHomeProb:   0.842,
    toAdvanceAwayProb:   0.158,
    toAdvanceHomeOdds:   -800,
    toAdvanceAwayOdds:   500,
    // 1X2 book no-vig (FRA -340 → 77.3%, Draw +900 → 10.0%, SWE +475 → 17.4%)
    // no-vig: FRA=73.6% Draw=9.5% SWE=16.6% (normalize)
    homeWinProb:         0.736,
    drawProb:            0.095,
    awayWinProb:         0.166,
    modelHomeML:         -279,
    modelDrawML:         953,
    modelAwayML:         503,
    // Spread
    modelSpread:         -1.5,
    homeSpreadOdds:      -125,
    awaySpreadOdds:      -105,
    // Total
    modelTotal:          3.5,
    overOdds:            115,
    underOdds:           -145,
    // BTTS
    bttsYesOdds:         -135,
    bttsNoOdds:          105,
    // Double chance
    dc1XOdds:            -1400,
    dcX2Odds:            500,
    // No draw
    noDrawHomeOdds:      -3500,
    noDrawAwayOdds:      -3500,
    isFrozen:            1,
  },
  "wc26-r32-079": {
    matchId:           "wc26-r32-079",
    modelVersion:        "v11.0-KO23",
    homeTeam:            "Mexico",
    awayTeam:            "Ecuador",
    // Mexico to Advance -175 → implied 63.6% | Ecuador +140 → implied 41.7%
    // No-vig: MEX=60.4% ECU=39.6%
    toAdvanceHomeProb:   0.604,
    toAdvanceAwayProb:   0.396,
    toAdvanceHomeOdds:   -175,
    toAdvanceAwayOdds:   140,
    // 1X2 book no-vig (MEX +130 → 43.5%, Draw +285 → 26.0%, ECU +190 → 34.5%)
    // no-vig: MEX=42.0% Draw=25.1% ECU=33.3% (normalize)
    homeWinProb:         0.420,
    drawProb:            0.251,
    awayWinProb:         0.333,
    modelHomeML:         138,
    modelDrawML:         298,
    modelAwayML:         200,
    // Spread
    modelSpread:         -0.5,
    homeSpreadOdds:      120,
    awaySpreadOdds:      -150,
    // Total
    modelTotal:          1.5,
    overOdds:            -170,
    underOdds:           135,
    // BTTS
    bttsYesOdds:         120,
    bttsNoOdds:          -155,
    // Double chance
    dc1XOdds:            -295,
    dcX2Odds:            -105,
    // No draw
    noDrawHomeOdds:      -700,
    noDrawAwayOdds:      -700,
    isFrozen:            1,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXECUTION
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  let stepCount = 0;
  let passCount = 0;
  let failCount = 0;

  const db = await getDb();

  // ─── S1: Log all input data ───────────────────────────────────────────────
  stepCount++;
  log("INPUT", `S${stepCount}`, "June 30 WC2026 book odds input — 3 matches, all markets");
  for (const fid of MATCH_IDS) {
    const b = BOOK_ROWS[fid];
    log("INPUT", "BOOK", `${fid}: ML H=${b.bookHomeMl} D=${b.bookDrawMl} A=${b.bookAwayMl}`,
      `Spread=${b.bookSpreadLine} (H${b.bookHomeSpreadOdds}/A${b.bookAwaySpreadOdds}) | Total=${b.bookTotalLine} (O${b.bookOverOdds}/U${b.bookUnderOdds}) | BTTS Y${b.bookBttsYesOdds}/N${b.bookBttsNoOdds} | DC 1X${b.bookDc1XOdds}/X2${b.bookDcX2Odds} | NoDraw H${b.bookNoDrawHomeOdds}/A${b.bookNoDrawAwayOdds} | ToAdv H${b.toAdvanceHomeOdds}/A${b.toAdvanceAwayOdds}`);
  }

  // ─── S2: Verify matches exist in DB ─────────────────────────────────────
  stepCount++;
  log("STEP", `S${stepCount}`, "Verifying 3 June 30 matches exist in wc2026_matches");
  const matches = await db.select().from(wc2026Matches).where(inArray(wc2026Matches.matchId, MATCH_IDS));
  if (matches.length !== 3) {
    log("FAIL", `S${stepCount}`, `Expected 3 matches, got ${matches.length}`, "Cannot proceed — matches missing from wc2026_matches");
    failCount++;
    flushLog();
    process.exit(1);
  }
  log("PASS", `S${stepCount}`, `All 3 matches confirmed in DB`);
  passCount++;
  matches.forEach((f: any) => {
    log("VERIFY", "FX", `${f.matchId}: home=${f.homeTeamId} away=${f.awayTeamId} | kickoff=${f.kickoffUtc} | stage=${f.stage}`);
  });

  // ─── S3-S5: Upsert frozen book odds ──────────────────────────────────────
  for (const fid of MATCH_IDS) {
    stepCount++;
    log("STEP", `S${stepCount}`, `Upserting frozen book odds for ${fid}`);
    const row = BOOK_ROWS[fid];
    try {
      // Delete existing (idempotent)
      await db.delete(wc2026FrozenBookOdds).where(eq(wc2026FrozenBookOdds.matchId, fid));
      // Insert fresh
      await db.insert(wc2026FrozenBookOdds).values({
        matchId:            row.matchId,
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
      log("PASS", `S${stepCount}`, `Frozen book odds inserted for ${fid}`,
        `bookHomeMl=${row.bookHomeMl} | bookDrawMl=${row.bookDrawMl} | bookAwayMl=${row.bookAwayMl} | spread=${row.bookSpreadLine} | total=${row.bookTotalLine} | toAdvH=${row.toAdvanceHomeOdds} | toAdvA=${row.toAdvanceAwayOdds}`);
      passCount++;
    } catch (e: any) {
      const fullErr = (e.message || '') + ' | CAUSE: ' + (e.cause?.message || '') + ' | SQL: ' + (e.sql || '');
      log("FAIL", `S${stepCount}`, `Frozen book odds insert FAILED for ${fid}`, fullErr.slice(0, 500));
      console.error('[FULL ERROR]', e);
      failCount++;
    }
  }

  // ─── S6-S8: Upsert model projections ─────────────────────────────────────
  for (const fid of MATCH_IDS) {
    stepCount++;
    log("STEP", `S${stepCount}`, `Upserting model projection for ${fid}`);
    const row = MODEL_ROWS[fid];
    try {
      await db.delete(wc2026ModelProjections).where(eq(wc2026ModelProjections.matchId, fid));
      await db.insert(wc2026ModelProjections).values({
        matchId:           row.matchId,
        modelVersion:        row.modelVersion,
        homeTeam:            row.homeTeam,
        awayTeam:            row.awayTeam,
        homeWinProb:         row.homeWinProb,
        drawProb:            row.drawProb,
        awayWinProb:         row.awayWinProb,
        modelHomeML:         row.modelHomeML,
        modelDrawML:         row.modelDrawML,
        modelAwayML:         row.modelAwayML,
        modelSpread:         row.modelSpread,
        homeSpreadOdds:      row.homeSpreadOdds,
        awaySpreadOdds:      row.awaySpreadOdds,
        modelTotal:          row.modelTotal,
        overOdds:            row.overOdds,
        underOdds:           row.underOdds,
        bttsYesOdds:         row.bttsYesOdds,
        bttsNoOdds:          row.bttsNoOdds,
        dc1XOdds:            row.dc1XOdds,
        dcX2Odds:            row.dcX2Odds,
        noDrawHomeOdds:      row.noDrawHomeOdds,
        noDrawAwayOdds:      row.noDrawAwayOdds,
        toAdvanceHomeProb:   row.toAdvanceHomeProb,
        toAdvanceAwayProb:   row.toAdvanceAwayProb,
        toAdvanceHomeOdds:   row.toAdvanceHomeOdds,
        toAdvanceAwayOdds:   row.toAdvanceAwayOdds,
        isFrozen:            row.isFrozen,
        frozenAt:            new Date(),
        modeledAt:           new Date(),
        createdAt:           new Date(),
      });
      log("PASS", `S${stepCount}`, `Model projection inserted for ${fid}`,
        `homeWin=${row.homeWinProb} | draw=${row.drawProb} | awayWin=${row.awayWinProb} | toAdvH=${row.toAdvanceHomeOdds} | toAdvA=${row.toAdvanceAwayOdds} | isFrozen=1`);
      passCount++;
    } catch (e: any) {
      const fullErr = (e.message || '') + ' | CAUSE: ' + (e.cause?.message || '') + ' | SQL: ' + (e.sql || '') + ' | PARAMS: ' + JSON.stringify(e.parameters || []).slice(0, 200);
      log("FAIL", `S${stepCount}`, `Model projection insert FAILED for ${fid}`, fullErr.slice(0, 600));
      console.error('[FULL ERROR]', e);
      failCount++;
    }
  }

  // ─── S9: Verify frozen book odds read-back ────────────────────────────────
  stepCount++;
  log("STEP", `S${stepCount}`, "Verifying frozen book odds read-back from DB");
  const bos = await db.select().from(wc2026FrozenBookOdds).where(inArray(wc2026FrozenBookOdds.matchId, MATCH_IDS));
  if (bos.length === 3) {
    log("PASS", `S${stepCount}`, `All 3 frozen book odds confirmed in DB`);
    passCount++;
    bos.forEach((bo: any) => {
      log("OUTPUT", "BO", `${bo.matchId}: ML H=${bo.bookHomeMl} D=${bo.bookDrawMl} A=${bo.bookAwayMl}`,
        `Spread=${bo.bookSpreadLine} (H${bo.bookHomeSpreadOdds}/A${bo.bookAwaySpreadOdds}) | Total=${bo.bookTotalLine} (O${bo.bookOverOdds}/U${bo.bookUnderOdds}) | BTTS Y${bo.bookBttsYesOdds}/N${bo.bookBttsNoOdds} | DC 1X${bo.bookDc1XOdds}/X2${bo.bookDcX2Odds} | NoDraw H${bo.bookNoDrawHomeOdds}/A${bo.bookNoDrawAwayOdds} | ToAdv H=${bo.toAdvanceHomeOdds} A=${bo.toAdvanceAwayOdds}`);
    });
  } else {
    log("FAIL", `S${stepCount}`, `Expected 3 frozen book odds, got ${bos.length}`);
    failCount++;
  }

  // ─── S10: Verify model projections read-back ─────────────────────────────
  stepCount++;
  log("STEP", `S${stepCount}`, "Verifying model projections read-back from DB (isFrozen=1)");
  const mps = await db.select().from(wc2026ModelProjections).where(inArray(wc2026ModelProjections.matchId, MATCH_IDS));
  if (mps.length === 3) {
    log("PASS", `S${stepCount}`, `All 3 model projections confirmed in DB`);
    passCount++;
    mps.forEach((mp: any) => {
      log("OUTPUT", "MP", `${mp.matchId}: homeWin=${mp.homeWinProb} draw=${mp.drawProb} awayWin=${mp.awayWinProb}`,
        `toAdvH=${mp.toAdvanceHomeOdds} | toAdvA=${mp.toAdvanceAwayOdds} | noDrawH=${mp.noDrawHomeOdds} | isFrozen=${mp.isFrozen}`);
    });
  } else {
    log("FAIL", `S${stepCount}`, `Expected 3 model projections, got ${mps.length}`);
    failCount++;
  }

  // ─── S11: Cross-validate — all 9 markets per match ─────────────────────
  stepCount++;
  log("STEP", `S${stepCount}`, "Cross-validating: all 9 market fields populated per match");
  const boMap: Record<string, any> = {};
  bos.forEach((bo: any) => { boMap[bo.matchId] = bo; });
  let marketPass = 0;
  let marketFail = 0;

  const MARKET_CHECKS: Array<{ key: string; label: string }> = [
    { key: "bookHomeMl",         label: "Home ML" },
    { key: "bookDrawMl",         label: "Draw ML" },
    { key: "bookAwayMl",         label: "Away ML" },
    { key: "bookSpreadLine",     label: "Spread Line" },
    { key: "bookHomeSpreadOdds", label: "Home Spread Odds" },
    { key: "bookAwaySpreadOdds", label: "Away Spread Odds" },
    { key: "bookTotalLine",      label: "Total Line" },
    { key: "bookOverOdds",       label: "Over Odds" },
    { key: "bookUnderOdds",      label: "Under Odds" },
    { key: "bookBttsYesOdds",    label: "BTTS Yes" },
    { key: "bookBttsNoOdds",     label: "BTTS No" },
    { key: "bookDc1XOdds",       label: "DC 1X" },
    { key: "bookDcX2Odds",       label: "DC X2" },
    { key: "bookNoDrawHomeOdds", label: "No Draw Home" },
    { key: "bookNoDrawAwayOdds", label: "No Draw Away" },
    { key: "toAdvanceHomeOdds",  label: "To Advance Home" },
    { key: "toAdvanceAwayOdds",  label: "To Advance Away" },
  ];

  for (const fid of MATCH_IDS) {
    const bo = boMap[fid];
    if (!bo) { log("FAIL", "MKTV", `${fid}: no frozen book odds row found`); marketFail++; continue; }
    for (const { key, label } of MARKET_CHECKS) {
      const val = bo[key];
      if (val === null || val === undefined) {
        log("FAIL", "MKTV", `${fid}: ${label} (${key}) is NULL`);
        marketFail++;
      } else {
        marketPass++;
      }
    }
    log("VERIFY", "MKTV", `${fid}: ${MARKET_CHECKS.length} market fields all populated`, `marketPass=${marketPass}`);
  }

  if (marketFail === 0) {
    log("PASS", `S${stepCount}`, `All ${marketPass} market field checks pass (${MATCH_IDS.length} matches × ${MARKET_CHECKS.length} markets)`);
    passCount++;
  } else {
    log("FAIL", `S${stepCount}`, `${marketFail} market fields are NULL`, "Check DB insert above");
    failCount++;
  }

  // ─── S12: State dump — final values in DB ────────────────────────────────
  stepCount++;
  log("STATE", `S${stepCount}`, "Final state dump — all 3 matches with frozen book odds + model projections");
  for (const fid of MATCH_IDS) {
    const bo = boMap[fid];
    const mp = mps.find((m: any) => m.matchId === fid);
    const match = matches.find((f: any) => f.matchId === fid);
    log("STATE", "DUMP", `━━━ ${fid}: ${match?.homeTeamId?.toUpperCase()} vs ${match?.awayTeamId?.toUpperCase()} ━━━`);
    log("STATE", "DUMP", `  [BOOK ODDS]`);
    log("STATE", "DUMP", `    1X2 ML:    Home=${bo?.bookHomeMl}  Draw=${bo?.bookDrawMl}  Away=${bo?.bookAwayMl}`);
    log("STATE", "DUMP", `    Spread:    Line=${bo?.bookSpreadLine}  H=${bo?.bookHomeSpreadOdds}  A=${bo?.bookAwaySpreadOdds}`);
    log("STATE", "DUMP", `    Total:     Line=${bo?.bookTotalLine}  Over=${bo?.bookOverOdds}  Under=${bo?.bookUnderOdds}`);
    log("STATE", "DUMP", `    BTTS:      Yes=${bo?.bookBttsYesOdds}  No=${bo?.bookBttsNoOdds}`);
    log("STATE", "DUMP", `    DC:        1X(H+D)=${bo?.bookDc1XOdds}  X2(A+D)=${bo?.bookDcX2Odds}`);
    log("STATE", "DUMP", `    No Draw:   Home=${bo?.bookNoDrawHomeOdds}  Away=${bo?.bookNoDrawAwayOdds}`);
    log("STATE", "DUMP", `    ToAdvance: Home=${bo?.toAdvanceHomeOdds}  Away=${bo?.toAdvanceAwayOdds}`);
    log("STATE", "DUMP", `  [MODEL PROJECTION]`);
    log("STATE", "DUMP", `    Probs:     homeWin=${mp?.homeWinProb}  draw=${mp?.drawProb}  awayWin=${mp?.awayWinProb}`);
    log("STATE", "DUMP", `    ToAdv:     Home=${mp?.toAdvanceHomeOdds}  Away=${mp?.toAdvanceAwayOdds}  isFrozen=${mp?.isFrozen}`);
  }
  passCount++;

  // ─── SUMMARY ──────────────────────────────────────────────────────────────
  const verdict = failCount === 0 ? "ALL SYSTEMS GO ✅" : "FAILURES DETECTED ❌";
  const summary = `
╔══════════════════════════════════════════════════════════════════════════════════════╗
║  SEED COMPLETE — v11.0-KO23 June 30 WC2026 Direct Seed                            ║
║  Steps: ${stepCount.toString().padEnd(3)} | PASS: ${passCount.toString().padEnd(3)} | FAIL: ${failCount.toString().padEnd(3)} | ${verdict.padEnd(22)}          ║
║  Markets seeded per match: 17 fields (ML×3, Spread×3, Total×3, BTTS×2,         ║
║    DC×2, NoDraw×2, ToAdvance×2)                                                    ║
╚══════════════════════════════════════════════════════════════════════════════════════╝`;
  console.log(summary);
  logLines.push(summary);
  flushLog();
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
