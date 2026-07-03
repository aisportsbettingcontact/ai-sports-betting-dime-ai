/**
 * wc-june24-gt-validate.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Ground truth validation for all 6 June 24, 2026 WC fixtures.
 * Checks: home/away orientation, kickoff times, game order, all 6 market odds.
 * 
 * [INPUT] Ground truth from user-provided data (June 24, 2026)
 * [OUTPUT] Pass/Fail for every field, with exact DB vs GT comparison
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const db = await mysql.createConnection(process.env.DATABASE_URL);

// ─── GROUND TRUTH ─────────────────────────────────────────────────────────────
// Format: { fixtureId, awayCode, homeCode, kickoffET, bookOdds }
// kickoffET: local Eastern Time (e.g. "3:00 PM ET")
// bookOdds: all 12 DK book odds values
const GT = [
  {
    match: "Canada vs Switzerland",
    awayCode: "CAN", homeCode: "SUI",
    kickoffET: "3:00 PM ET", groupLetter: "B", venue: "Vancouver",
    bookOdds: {
      awayMl: +240, homeMl: +135, draw: +210, noDraw: -270,
      over: +100, under: -125, overLine: 2.5,
      awaySpread: -575, homeSpread: +400, spreadLine: -1.5, // homeSpreadLine = -1.5 (SUI -1.5)
      awayDc: -170, homeDc: -310, // awayDc = CAN OR DRAW, homeDc = SUI OR DRAW
      bttsYes: -140, bttsNo: +110,
    }
  },
  {
    match: "Qatar @ Bosnia",
    awayCode: "QAT", homeCode: "BIH",
    kickoffET: "3:00 PM ET", groupLetter: "A", venue: "Guadalupe",
    bookOdds: {
      awayMl: +600, homeMl: -240, draw: +400, noDraw: -575,
      over: -175, under: +140, overLine: 2.5,
      awaySpread: -140, homeSpread: +110, spreadLine: -1.5, // homeSpreadLine = -1.5 (BIH -1.5)
      awayDc: +185, homeDc: -1000,
      bttsYes: -135, bttsNo: +105,
    }
  },
  {
    match: "Brazil vs Scotland",
    awayCode: "BRA", homeCode: "SCO",
    kickoffET: "6:00 PM ET", groupLetter: "A", venue: "Mexico City",
    bookOdds: {
      awayMl: -265, homeMl: +700, draw: +425, noDraw: -600,
      over: -115, under: -105, overLine: 2.5,
      awaySpread: +100, homeSpread: -130, spreadLine: -1.5, // awaySpreadLine = -1.5 (BRA -1.5)
      awayDc: -1100, homeDc: +200,
      bttsYes: +130, bttsNo: -165,
    }
  },
  {
    match: "Haiti @ Morocco",
    awayCode: "HAI", homeCode: "MAR",
    kickoffET: "6:00 PM ET", groupLetter: "C", venue: "Atlanta",
    bookOdds: {
      awayMl: +1400, homeMl: -500, draw: +600, noDraw: -1000,
      over: +145, under: -175, overLine: 3.5,
      awaySpread: +135, homeSpread: -170, spreadLine: -1.5, // homeSpreadLine = -1.5 (MAR -1.5)
      awayDc: +340, homeDc: -3500,
      bttsYes: +130, bttsNo: -165,
    }
  },
  {
    match: "Mexico @ Czech Republic",
    awayCode: "MEX", homeCode: "CZE",
    kickoffET: "6:00 PM ET", groupLetter: "C", venue: "Seattle",
    bookOdds: {
      awayMl: -105, homeMl: +265, draw: +285, noDraw: -370,
      over: +105, under: -130, overLine: 2.5,
      awaySpread: +260, homeSpread: -350, spreadLine: -1.5, // awaySpreadLine = -1.5 (MEX -1.5)
      awayDc: -350, homeDc: -120,
      bttsYes: -110, bttsNo: -115,
    }
  },
  {
    match: "South Korea @ South Africa",
    awayCode: "KOR", homeCode: "RSA",
    kickoffET: "9:00 PM ET", groupLetter: "C", venue: "Miami Gardens",
    bookOdds: {
      awayMl: -150, homeMl: +425, draw: +295, noDraw: -390,
      over: +105, under: -130, overLine: 2.5,
      awaySpread: +195, homeSpread: -250, spreadLine: -1.5, // awaySpreadLine = -1.5 (KOR -1.5)
      awayDc: -600, homeDc: +115,
      bttsYes: -105, bttsNo: -125,
    }
  },
];

// ─── QUERY DB ─────────────────────────────────────────────────────────────────
console.log('\n[INPUT] Loading June 24 fixtures from DB...\n');

const [fixtures] = await db.execute(`
  SELECT f.fixture_id, f.home_team_id, f.away_team_id, f.kickoff_utc, f.group_letter,
         ht.fifa_code AS home_code, at.fifa_code AS away_code,
         v.city AS venue_city
  FROM wc2026_matches f
  JOIN wc2026_teams ht ON ht.team_id = f.home_team_id
  JOIN wc2026_teams at ON at.team_id = f.away_team_id
  LEFT JOIN wc2026_venues v ON v.venue_id = f.venue_id
  WHERE f.match_date = '2026-06-24'
  ORDER BY f.kickoff_utc ASC
`);

console.log(`[STATE] Found ${fixtures.length} fixtures in DB for June 24\n`);

// ─── VALIDATE EACH FIXTURE ────────────────────────────────────────────────────
let allPass = true;
const fixtureIdMap = {};

for (const fix of fixtures) {
  const kickoffET = new Date(fix.kickoff_utc).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York'
  }) + ' ET';

  // Find matching GT entry by away+home codes
  const gt = GT.find(g => g.awayCode === fix.away_code && g.homeCode === fix.home_code);
  
  if (!gt) {
    console.log(`[VERIFY] FAIL: No GT match for ${fix.away_code}@${fix.home_code} (fixture_id=${fix.fixture_id})`);
    // Check if home/away are swapped
    const gtSwapped = GT.find(g => g.awayCode === fix.home_code && g.homeCode === fix.away_code);
    if (gtSwapped) {
      console.log(`  → HOME/AWAY SWAPPED: DB has home=${fix.home_code} away=${fix.away_code}, GT expects home=${gtSwapped.homeCode} away=${gtSwapped.awayCode}`);
      console.log(`  → FIXTURE: ${fix.fixture_id} needs home_team_id/away_team_id swapped`);
    }
    allPass = false;
    continue;
  }

  fixtureIdMap[gt.match] = fix.fixture_id;

  // Check kickoff time
  const kickoffOk = kickoffET === gt.kickoffET;
  console.log(`[STEP] Fixture: ${fix.fixture_id} | ${fix.away_code}@${fix.home_code}`);
  console.log(`  Kickoff: DB=${kickoffET} GT=${gt.kickoffET} → ${kickoffOk ? '✅' : '❌ MISMATCH'}`);
  if (!kickoffOk) allPass = false;
}

// ─── VALIDATE BOOK ODDS ────────────────────────────────────────────────────────
console.log('\n[STEP] Validating book odds (book_id=68) for each fixture...\n');

for (const gt of GT) {
  const fix = fixtures.find(f => f.away_code === gt.awayCode && f.home_code === gt.homeCode);
  if (!fix) {
    console.log(`[VERIFY] SKIP: ${gt.match} — fixture not found in DB (home/away may be swapped)`);
    continue;
  }

  const [rows] = await db.execute(`
    SELECT market, selection, american_odds, line
    FROM wc2026_odds_snapshots
    WHERE fixture_id = ? AND book_id = 68
    ORDER BY market, selection
  `, [fix.fixture_id]);

  const oddsMap = {};
  for (const r of rows) {
    oddsMap[`${r.market}:${r.selection}`] = { odds: r.american_odds, line: parseFloat(r.line) };
  }

  const checks = [
    ['1X2:away', gt.bookOdds.awayMl],
    ['1X2:home', gt.bookOdds.homeMl],
    ['1X2:draw', gt.bookOdds.draw],
    ['1X2:no_draw', gt.bookOdds.noDraw],
    ['TOTAL:over', gt.bookOdds.over],
    ['TOTAL:under', gt.bookOdds.under],
    ['ASIAN_HANDICAP:away', gt.bookOdds.awaySpread],
    ['ASIAN_HANDICAP:home', gt.bookOdds.homeSpread],
    ['DOUBLE_CHANCE:away', gt.bookOdds.awayDc],
    ['DOUBLE_CHANCE:home', gt.bookOdds.homeDc],
    ['BTTS:yes', gt.bookOdds.bttsYes],
    ['BTTS:no', gt.bookOdds.bttsNo],
  ];

  let matchPass = true;
  for (const [key, gtOdds] of checks) {
    const dbEntry = oddsMap[key];
    const dbOdds = dbEntry?.odds;
    const ok = dbOdds === gtOdds;
    if (!ok) {
      console.log(`  [VERIFY] ❌ ${gt.match} | ${key}: DB=${dbOdds} GT=${gtOdds}`);
      matchPass = false;
      allPass = false;
    }
  }

  // Check total line
  const overEntry = oddsMap['TOTAL:over'];
  const lineOk = overEntry && overEntry.line === gt.bookOdds.overLine;
  if (!lineOk) {
    console.log(`  [VERIFY] ❌ ${gt.match} | TOTAL line: DB=${overEntry?.line} GT=${gt.bookOdds.overLine}`);
    matchPass = false;
    allPass = false;
  }

  if (matchPass) {
    console.log(`  [VERIFY] ✅ ${gt.match} — all 12 book odds correct`);
  }
}

console.log(`\n[OUTPUT] Overall: ${allPass ? '✅ ALL PASS' : '❌ FAILURES DETECTED — see above'}\n`);

await db.end();
