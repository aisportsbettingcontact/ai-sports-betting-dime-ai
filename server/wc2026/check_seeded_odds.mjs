import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Check all 12 seeded fixtures
const [rows] = await conn.query(`
  SELECT match_id, 
    book_home_ml, book_draw_ml, book_away_ml,
    book_spread_line, book_home_spread_odds, book_away_spread_odds,
    book_total_line, book_over_odds, book_under_odds,
    book_btts_yes_odds, book_btts_no_odds,
    book_dc_1x_odds, book_dc_x2_odds,
    book_no_draw_home_odds, book_no_draw_away_odds,
    to_advance_home_odds, to_advance_away_odds
  FROM wc2026_frozen_book_odds 
  WHERE match_id IN (?)
  ORDER BY match_id
`, [['wc26-r32-080','wc26-r32-081','wc26-r32-082','wc26-r32-083','wc26-r32-084','wc26-r32-085','wc26-r32-086','wc26-r32-087','wc26-r32-088','wc26-r16-089','wc26-r16-090','wc26-r16-091']]);

// Expected values from user's table
const EXPECTED = {
  'wc26-r32-080': { homeML:-345, drawML:400,  awayML:1100, spread:1.5,  homeSpreadOdds:-111, awaySpreadOdds:-105, totalLine:2.5, overOdds:103,  underOdds:-120, bttsYes:163,  toAdvH:-1100, toAdvA:600  },
  'wc26-r32-081': { homeML:115,  drawML:220,  awayML:270,  spread:1.5,  homeSpreadOdds:-435, awaySpreadOdds:300,  totalLine:2.5, overOdds:100,  underOdds:-118, bttsYes:-133, toAdvH:-175,  toAdvA:135  },
  'wc26-r32-082': { homeML:-250, drawML:400,  awayML:600,  spread:1.5,  homeSpreadOdds:-137, awaySpreadOdds:108,  totalLine:2.5, overOdds:-137, underOdds:110,  bttsYes:-105, toAdvH:-700,  toAdvA:450  },
  'wc26-r32-083': { homeML:-303, drawML:425,  awayML:750,  spread:1.5,  homeSpreadOdds:-120, awaySpreadOdds:103,  totalLine:2.5, overOdds:-125, underOdds:100,  bttsYes:120,  toAdvH:-750,  toAdvA:475  },
  'wc26-r32-084': { homeML:-133, drawML:250,  awayML:400,  spread:1.5,  homeSpreadOdds:-286, awaySpreadOdds:210,  totalLine:2.5, overOdds:110,  underOdds:-137, bttsYes:-105, toAdvH:-270,  toAdvA:205  },
  'wc26-r32-085': { homeML:100,  drawML:220,  awayML:320,  spread:1.5,  homeSpreadOdds:-385, awaySpreadOdds:270,  totalLine:2.5, overOdds:110,  underOdds:-137, bttsYes:-110, toAdvH:-200,  toAdvA:155  },
  'wc26-r32-086': { homeML:240,  drawML:188,  awayML:145,  spread:-1.5, homeSpreadOdds:450,  awaySpreadOdds:-667, totalLine:1.5, overOdds:-175, underOdds:138,  bttsYes:120,  toAdvH:115,   toAdvA:-150 },
  'wc26-r32-087': { homeML:-588, drawML:650,  awayML:1400, spread:2.5,  homeSpreadOdds:-189, awaySpreadOdds:142,  totalLine:2.5, overOdds:-149, underOdds:120,  bttsYes:175,  toAdvH:-2500, toAdvA:950  },
  'wc26-r32-088': { homeML:-189, drawML:290,  awayML:600,  spread:1.5,  homeSpreadOdds:-200, awaySpreadOdds:150,  totalLine:2.5, overOdds:120,  underOdds:-149, bttsYes:125,  toAdvH:-450,  toAdvA:320  },
  'wc26-r16-089': { homeML:-500, drawML:600,  awayML:1400, spread:-2.5, homeSpreadOdds:142,  awaySpreadOdds:-189, totalLine:2.5, overOdds:-175, underOdds:138,  bttsYes:138,  toAdvH:850,   toAdvA:-2000},
  'wc26-r16-090': { homeML:-125, drawML:250,  awayML:375,  spread:-1.5, homeSpreadOdds:230,  awaySpreadOdds:-303, totalLine:2.5, overOdds:130,  underOdds:-161, bttsYes:105,  toAdvH:195,   toAdvA:-255 },
  'wc26-r16-091': { homeML:-111, drawML:240,  awayML:320,  spread:1.5,  homeSpreadOdds:-303, awaySpreadOdds:230,  totalLine:2.5, overOdds:-108, underOdds:-108, bttsYes:-133, toAdvH:-215,  toAdvA:170  },
};

let totalErrors = 0;
for (const row of rows) {
  const fid = row.match_id;
  const exp = EXPECTED[fid];
  if (!exp) { console.log(`⚠️  No expected data for ${fid}`); continue; }
  
  const checks = [
    ['book_home_ml',          row.book_home_ml,          exp.homeML],
    ['book_draw_ml',          row.book_draw_ml,           exp.drawML],
    ['book_away_ml',          row.book_away_ml,           exp.awayML],
    ['book_spread_line',      row.book_spread_line,       exp.spread],
    ['book_home_spread_odds', row.book_home_spread_odds,  exp.homeSpreadOdds],
    ['book_away_spread_odds', row.book_away_spread_odds,  exp.awaySpreadOdds],
    ['book_total_line',       row.book_total_line,        exp.totalLine],
    ['book_over_odds',        row.book_over_odds,         exp.overOdds],
    ['book_under_odds',       row.book_under_odds,        exp.underOdds],
    ['book_btts_yes_odds',    row.book_btts_yes_odds,     exp.bttsYes],
    ['to_advance_home_odds',  row.to_advance_home_odds,   exp.toAdvH],
    ['to_advance_away_odds',  row.to_advance_away_odds,   exp.toAdvA],
  ];
  
  let rowErrors = 0;
  const errors = [];
  for (const [col, actual, expected] of checks) {
    const match = Number(actual) === Number(expected);
    if (!match) {
      errors.push(`  ❌ ${col}: DB=${actual} EXPECTED=${expected}`);
      rowErrors++;
      totalErrors++;
    }
  }
  
  if (rowErrors === 0) {
    console.log(`✅ ${fid}: ALL ${checks.length} VALUES CORRECT`);
  } else {
    console.log(`❌ ${fid}: ${rowErrors} ERRORS`);
    errors.forEach(e => console.log(e));
  }
}

console.log(`\n══ TOTAL ERRORS: ${totalErrors} ══`);
await conn.end();
