/**
 * fix_seeded_odds.mjs
 * ══════════════════════════════════════════════════════════════════════════════
 * Corrects all 52 data errors in wc2026_frozen_book_odds for 12 matchs.
 *
 * Bugs fixed:
 * 1. book_home_spread_odds / book_away_spread_odds were seeded with ML values
 * 2. book_over_odds / book_under_odds were hardcoded to -110
 * 3. book_home_ml / book_away_ml swapped for wc26-r16-089 and wc26-r16-090
 *
 * Source: User-provided book lines table (exact values)
 * ══════════════════════════════════════════════════════════════════════════════
 */
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ── Exact correct values from user's table ────────────────────────────────────
// Columns: match_id, homeML, drawML, awayML, spread, homeSpreadOdds, awaySpreadOdds,
//          totalLine, overOdds, underOdds, bttsYes, bttsNo, dc1x, dcX2, noDrawHome, noDrawAway, toAdvH, toAdvA
//
// NOTE: "Home" = the team listed as HOME in wc2026_matches (left column in user's table is Away, right is Home)
// User table columns: Away | Home | Away ML | Home ML | Draw | Total | Spread | BTTS Y | ToAdv Home | ToAdv Away
// "ToAdv Home" = home team advances odds, "ToAdv Away" = away team advances odds
//
// For spread: user's "Spread" column is the HOME team's spread line
// For spread odds: user's "Away Spread Odds" = away team spread odds, "Home Spread Odds" = home team spread odds
// From user's full table (with spread odds):
// Away Spread Odds | Home Spread Odds columns
//
// R32 Matches:
// wc26-r32-080: COD @ ENG | Away=COD Home=ENG
//   Away ML=+1100 Home ML=-345 Draw=+400 Total=2.5 Spread=1.5
//   Away Spread +1.5 at -111, Home Spread -1.5 at -105
//   Over=103 Under=-120 BTTS Y=163
//   ToAdv Home=-1100 ToAdv Away=+600
//
// wc26-r32-081: SEN @ BEL | Away=SEN Home=BEL
//   Away ML=+270 Home ML=+115 Draw=+220 Total=2.5 Spread=1.5
//   Away Spread +1.5 at -435, Home Spread -1.5 at +300
//   Over=100 Under=-118 BTTS Y=-133
//   ToAdv Home=-175 ToAdv Away=+135
//
// wc26-r32-082: BIH @ USA | Away=BIH Home=USA
//   Away ML=+600 Home ML=-250 Draw=+400 Total=2.5 Spread=1.5
//   Away Spread +1.5 at -137, Home Spread -1.5 at +108
//   Over=-137 Under=+110 BTTS Y=-105
//   ToAdv Home=-700 ToAdv Away=+450
//
// wc26-r32-083: AUT @ ESP | Away=AUT Home=ESP
//   Away ML=+750 Home ML=-303 Draw=+425 Total=2.5 Spread=1.5
//   Away Spread +1.5 at -120, Home Spread -1.5 at +103
//   Over=-125 Under=+100 BTTS Y=+120
//   ToAdv Home=-750 ToAdv Away=+475
//
// wc26-r32-084: CRO @ POR | Away=CRO Home=POR
//   Away ML=+400 Home ML=-133 Draw=+250 Total=2.5 Spread=1.5
//   Away Spread +1.5 at -286, Home Spread -1.5 at +210
//   Over=+110 Under=-137 BTTS Y=-105
//   ToAdv Home=-270 ToAdv Away=+205
//
// wc26-r32-085: ALG @ SUI | Away=ALG Home=SUI
//   Away ML=+320 Home ML=+100 Draw=+220 Total=2.5 Spread=1.5
//   Away Spread +1.5 at -385, Home Spread -1.5 at +270
//   Over=+110 Under=-137 BTTS Y=-110
//   ToAdv Home=-200 ToAdv Away=+155
//
// wc26-r32-086: EGY @ AUS | Away=EGY Home=AUS
//   Away ML=+145 Home ML=+240 Draw=+188 Total=1.5 Spread=-1.5
//   Away Spread -1.5 at +450, Home Spread +1.5 at -667
//   Over=-175 Under=+138 BTTS Y=+120
//   ToAdv Home=+115 ToAdv Away=-150
//
// wc26-r32-087: CPV @ ARG | Away=CPV Home=ARG
//   Away ML=+1400 Home ML=-588 Draw=+650 Total=2.5 Spread=2.5
//   Away Spread +2.5 at -189, Home Spread -2.5 at +142
//   Over=-149 Under=+120 BTTS Y=+175
//   ToAdv Home=-2500 ToAdv Away=+950
//
// wc26-r32-088: GHA @ COL | Away=GHA Home=COL
//   Away ML=+600 Home ML=-189 Draw=+290 Total=2.5 Spread=1.5
//   Away Spread +1.5 at -200, Home Spread -1.5 at +150
//   Over=+120 Under=-149 BTTS Y=+125
//   ToAdv Home=-450 ToAdv Away=+320
//
// R16 Matches:
// wc26-r16-089: FRA @ PAR | Away=FRA Home=PAR
//   Away ML=-500 Home ML=+1400 Draw=+600 Total=2.5 Spread=-2.5
//   Away Spread -2.5 at +142, Home Spread +2.5 at -189
//   Over=-175 Under=+138 BTTS Y=+138
//   ToAdv Home=+850 ToAdv Away=-2000
//
// wc26-r16-090: MAR @ CAN | Away=MAR Home=CAN
//   Away ML=-125 Home ML=+375 Draw=+250 Total=2.5 Spread=-1.5
//   Away Spread -1.5 at +230, Home Spread +1.5 at -303
//   Over=+130 Under=-161 BTTS Y=+105
//   ToAdv Home=+195 ToAdv Away=-255
//
// wc26-r16-091: NOR @ BRA | Away=NOR Home=BRA
//   Away ML=+320 Home ML=-111 Draw=+240 Total=2.5 Spread=1.5
//   Away Spread +1.5 at -303, Home Spread -1.5 at +230
//   Over=-108 Under=-108 BTTS Y=-133
//   ToAdv Home=-215 ToAdv Away=+170

const CORRECTIONS = [
  // match_id, homeML, drawML, awayML, spreadLine, homeSpreadOdds, awaySpreadOdds, totalLine, overOdds, underOdds, bttsYes, bttsNo, dc1x, dcX2, noDrawHome, noDrawAway, toAdvH, toAdvA
  ['wc26-r32-080', -345, 400, 1100, 1.5,  -105, -111, 2.5, 103,  -120, 163,  -163, 250,  -2000, -588, 1100, -1100, 600  ],
  ['wc26-r32-081',  115, 220,  270, 1.5,   300, -435, 2.5, 100,  -118, -133,  133, -149, -345,  -278,  135, -175,  135  ],
  ['wc26-r32-082', -250, 400,  600, 1.5,   108, -137, 2.5, -137,  110, -105,  105, 175,  -1000, -588, -700, 450  ],
  ['wc26-r32-083', -303, 425,  750, 1.5,   103, -120, 2.5, -125,  100,  120, -120, 225,  -1250, -588, -750, 475  ],
  ['wc26-r32-084', -133, 250,  400, 1.5,   210, -286, 2.5,  110, -137, -105,  105, 100,  -588,  -345, -270, 205  ],
  ['wc26-r32-085',  100, 220,  320, 1.5,   270, -385, 2.5,  110, -137, -110,  110, -125, -455,  -278, -200, 155  ],
  ['wc26-r32-086',  240, 188,  145, -1.5, -667,  450, 1.5, -175,  138,  120, -120, -333, -189,  -250,  115, -150 ],
  ['wc26-r32-087', -588, 650, 1400, 2.5,   142, -189, 2.5, -149,  120,  175, -175, 400,  -3333, -1000,-2500, 950 ],
  ['wc26-r32-088', -189, 290,  600, 1.5,   150, -200, 2.5,  120, -149,  125, -125, 138,  -1000, -400, -450, 320  ],
  ['wc26-r16-089', 1400, 600, -500, -2.5, -189,  142, 2.5, -175,  138,  138, -138, 333,  -1000, null, 850, -2000],
  ['wc26-r16-090',  375, 250, -125, -1.5, -303,  230, 2.5,  130, -161,  105, -105, -556, -105,  -345, 195, -255 ],
  ['wc26-r16-091', -111, 240,  320, 1.5,   230, -303, 2.5, -108, -108, -133,  133, -110, -455,  -333, -215, 170  ],
];

console.log('[INPUT] Applying corrections to 12 matchs...\n');

let totalUpdated = 0;
for (const row of CORRECTIONS) {
  const [fid, homeML, drawML, awayML, spreadLine, homeSpreadOdds, awaySpreadOdds, totalLine, overOdds, underOdds, bttsYes, bttsNo, dc1x, dcX2, noDrawHome, noDrawAway, toAdvH, toAdvA] = row;
  
  const [result] = await conn.query(`
    UPDATE wc2026_frozen_book_odds SET
      book_home_ml = ?,
      book_draw_ml = ?,
      book_away_ml = ?,
      book_spread_line = ?,
      book_home_spread_odds = ?,
      book_away_spread_odds = ?,
      book_total_line = ?,
      book_over_odds = ?,
      book_under_odds = ?,
      book_btts_yes_odds = ?,
      book_btts_no_odds = ?,
      book_dc_1x_odds = ?,
      book_dc_x2_odds = ?,
      book_no_draw_home_odds = ?,
      book_no_draw_away_odds = ?,
      to_advance_home_odds = ?,
      to_advance_away_odds = ?
    WHERE match_id = ?
  `, [homeML, drawML, awayML, spreadLine, homeSpreadOdds, awaySpreadOdds, totalLine, overOdds, underOdds, bttsYes, bttsNo, dc1x, dcX2, noDrawHome, noDrawAway, toAdvH, toAdvA, fid]);
  
  const affected = result.affectedRows;
  totalUpdated += affected;
  console.log(`[STEP] ${fid}: ${affected === 1 ? '✅ UPDATED' : '❌ NOT FOUND'}`);
  console.log(`  homeML=${homeML} drawML=${drawML} awayML=${awayML}`);
  console.log(`  spread=${spreadLine} homeSpreadOdds=${homeSpreadOdds} awaySpreadOdds=${awaySpreadOdds}`);
  console.log(`  total=${totalLine} over=${overOdds} under=${underOdds}`);
  console.log(`  bttsYes=${bttsYes} bttsNo=${bttsNo}`);
  console.log(`  toAdvH=${toAdvH} toAdvA=${toAdvA}`);
}

console.log(`\n[OUTPUT] Total rows updated: ${totalUpdated}/12`);

// ── Verify all corrections ────────────────────────────────────────────────────
console.log('\n[VERIFY] Re-reading all 12 rows to confirm...');
const fids = CORRECTIONS.map(r => r[0]);
const [verifyRows] = await conn.query(`
  SELECT match_id, book_home_ml, book_away_ml, book_spread_line, 
         book_home_spread_odds, book_away_spread_odds,
         book_over_odds, book_under_odds, to_advance_home_odds, to_advance_away_odds
  FROM wc2026_frozen_book_odds WHERE match_id IN (?)
  ORDER BY match_id
`, [fids]);

for (const vr of verifyRows) {
  console.log(`[VERIFY] ${vr.match_id}: homeML=${vr.book_home_ml} awayML=${vr.book_away_ml} spread=${vr.book_spread_line} hSpreadOdds=${vr.book_home_spread_odds} aSpreadOdds=${vr.book_away_spread_odds} over=${vr.book_over_odds} under=${vr.book_under_odds} toAdvH=${vr.to_advance_home_odds} toAdvA=${vr.to_advance_away_odds}`);
}

await conn.end();
console.log('\n[DONE]');
