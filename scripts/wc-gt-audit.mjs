/**
 * WC2026 June 24 Ground Truth Audit v2
 * Verifies: home/away orientation, kickoff times, game order, all 6 market odds
 * Ground truth from user-provided data (pasted_content_9.txt)
 */
import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

// Ground truth: away@home, kickoff EDT, all 6 market book odds
const GT = {
  'wc26-g-049': {
    away: 'CAN', home: 'SUI', kickoffEDT: '15:00', venue: 'Vancouver',
    book: {
      '1X2|away': 240, '1X2|home': 135, '1X2|draw': 210,
      'TOTAL|over': 100, 'TOTAL|under': -125, totalLine: 2.5,
      'ASIAN_HANDICAP|away': -575, 'ASIAN_HANDICAP|home': 400,
      awaySpreadLine: 1.5, homeSpreadLine: -1.5,
      'DOUBLE_CHANCE|away_draw': -170, 'DOUBLE_CHANCE|home_draw': -310,
      'BTTS|yes': -140, 'BTTS|no': 110
    }
  },
  'wc26-g-050': {
    away: 'QAT', home: 'BIH', kickoffEDT: '15:00', venue: 'Guadalupe',
    book: {
      '1X2|away': 600, '1X2|home': -240, '1X2|draw': 400,
      'TOTAL|over': -175, 'TOTAL|under': 140, totalLine: 2.5,
      'ASIAN_HANDICAP|away': -140, 'ASIAN_HANDICAP|home': 110,
      awaySpreadLine: 1.5, homeSpreadLine: -1.5,
      'DOUBLE_CHANCE|away_draw': 185, 'DOUBLE_CHANCE|home_draw': -1000,
      'BTTS|yes': -135, 'BTTS|no': 105
    }
  },
  'wc26-g-051': {
    away: 'BRA', home: 'SCO', kickoffEDT: '18:00', venue: 'Mexico City',
    book: {
      '1X2|away': -265, '1X2|home': 700, '1X2|draw': 425,
      'TOTAL|over': -115, 'TOTAL|under': -105, totalLine: 2.5,
      'ASIAN_HANDICAP|away': 100, 'ASIAN_HANDICAP|home': -130,
      awaySpreadLine: -1.5, homeSpreadLine: 1.5,
      'DOUBLE_CHANCE|away_draw': -1100, 'DOUBLE_CHANCE|home_draw': 200,
      'BTTS|yes': 130, 'BTTS|no': -165
    }
  },
  'wc26-g-052': {
    away: 'HAI', home: 'MAR', kickoffEDT: '18:00', venue: 'Atlanta',
    book: {
      '1X2|away': 1400, '1X2|home': -500, '1X2|draw': 600,
      'TOTAL|over': 145, 'TOTAL|under': -175, totalLine: 3.5,
      'ASIAN_HANDICAP|away': 135, 'ASIAN_HANDICAP|home': -170,
      awaySpreadLine: 1.5, homeSpreadLine: -1.5,
      'DOUBLE_CHANCE|away_draw': 340, 'DOUBLE_CHANCE|home_draw': -3500,
      'BTTS|yes': 130, 'BTTS|no': -165
    }
  },
  'wc26-g-053': {
    away: 'MEX', home: 'CZE', kickoffEDT: '18:00', venue: 'Atlanta',
    book: {
      '1X2|away': -105, '1X2|home': 265, '1X2|draw': 285,
      'TOTAL|over': 105, 'TOTAL|under': -130, totalLine: 2.5,
      'ASIAN_HANDICAP|away': 260, 'ASIAN_HANDICAP|home': -350,
      awaySpreadLine: -1.5, homeSpreadLine: 1.5,
      'DOUBLE_CHANCE|away_draw': -350, 'DOUBLE_CHANCE|home_draw': -120,
      'BTTS|yes': -110, 'BTTS|no': -115
    }
  },
  'wc26-g-054': {
    away: 'KOR', home: 'RSA', kickoffEDT: '21:00', venue: 'Miami Gardens',
    book: {
      '1X2|away': -150, '1X2|home': 425, '1X2|draw': 295,
      'TOTAL|over': 105, 'TOTAL|under': -130, totalLine: 2.5,
      'ASIAN_HANDICAP|away': 195, 'ASIAN_HANDICAP|home': -250,
      awaySpreadLine: -1.5, homeSpreadLine: 1.5,
      'DOUBLE_CHANCE|away_draw': -600, 'DOUBLE_CHANCE|home_draw': 115,
      'BTTS|yes': -105, 'BTTS|no': -125
    }
  }
};

const conn = await mysql.createConnection(process.env.DATABASE_URL);
let totalErrors = 0;

console.log('\n[AUDIT] ===== WC2026 JUNE 24 GROUND TRUTH AUDIT v2 =====\n');

// ── Step 1: Match orientation + kickoff ──────────────────────────────────
const [matches] = await conn.query(`
  SELECT f.match_id, f.kickoff_utc,
    ht.fifa_code AS home_code, at.fifa_code AS away_code
  FROM wc2026_matches f
  JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
  JOIN wc2026_teams at ON f.away_team_id = at.team_id
  WHERE f.match_date = '2026-06-24'
  ORDER BY f.kickoff_utc
`);

console.log('[AUDIT] === STEP 1: MATCH ORIENTATION + KICKOFF ===');
for (const f of matches) {
  const gt = GT[f.match_id];
  if (!gt) { console.log(`[AUDIT] ❓ Unknown: ${f.match_id}`); continue; }
  const awayOk = f.away_code === gt.away;
  const homeOk = f.home_code === gt.home;
  // Convert kickoff_utc to EDT (UTC-4)
  const kickoffUTC = f.kickoff_utc ? new Date(f.kickoff_utc) : null;
  const kickoffEDT = kickoffUTC ? `${String((kickoffUTC.getUTCHours() - 4 + 24) % 24).padStart(2,'0')}:${String(kickoffUTC.getUTCMinutes()).padStart(2,'0')}` : 'NULL';
  const timeOk = kickoffEDT === gt.kickoffEDT;
  if (!awayOk) { console.log(`  ❌ ${f.match_id} AWAY: DB=${f.away_code} GT=${gt.away}`); totalErrors++; }
  if (!homeOk) { console.log(`  ❌ ${f.match_id} HOME: DB=${f.home_code} GT=${gt.home}`); totalErrors++; }
  if (!timeOk) { console.log(`  ❌ ${f.match_id} KICKOFF: DB=${kickoffEDT}EDT GT=${gt.kickoffEDT}EDT`); totalErrors++; }
  if (awayOk && homeOk && timeOk) {
    console.log(`  ✅ ${f.match_id}: ${f.away_code}@${f.home_code} ${kickoffEDT}EDT`);
  }
}

// ── Step 2: Book odds accuracy ─────────────────────────────────────────────
console.log('\n[AUDIT] === STEP 2: BOOK ODDS ACCURACY (book_id=68) ===');
const matchIds = Object.keys(GT);
const [bookOdds] = await conn.query(`
  SELECT match_id, market, selection, line, american_odds
  FROM wc2026_odds_snapshots
  WHERE match_id IN (?) AND book_id = 68
  ORDER BY match_id, market, selection
`, [matchIds]);

const bookMap = {};
for (const r of bookOdds) {
  if (!bookMap[r.match_id]) bookMap[r.match_id] = {};
  bookMap[r.match_id][`${r.market}|${r.selection}`] = {
    line: parseFloat(r.line), odds: r.american_odds
  };
}

for (const [fid, gt] of Object.entries(GT)) {
  const rows = bookMap[fid] || {};
  const b = gt.book;
  const markets = [
    ['1X2|away', b['1X2|away'], null],
    ['1X2|home', b['1X2|home'], null],
    ['1X2|draw', b['1X2|draw'], null],
    ['TOTAL|over', b['TOTAL|over'], b.totalLine],
    ['TOTAL|under', b['TOTAL|under'], b.totalLine],
    ['ASIAN_HANDICAP|away', b['ASIAN_HANDICAP|away'], b.awaySpreadLine],
    ['ASIAN_HANDICAP|home', b['ASIAN_HANDICAP|home'], b.homeSpreadLine],
    ['DOUBLE_CHANCE|away_draw', b['DOUBLE_CHANCE|away_draw'], null],
    ['DOUBLE_CHANCE|home_draw', b['DOUBLE_CHANCE|home_draw'], null],
    ['BTTS|yes', b['BTTS|yes'], null],
    ['BTTS|no', b['BTTS|no'], null],
  ];
  let matchErrors = 0;
  const lines = [];
  for (const [key, expOdds, expLine] of markets) {
    const row = rows[key];
    if (!row) {
      lines.push(`  ❌ MISSING ${fid} ${key}`);
      matchErrors++; totalErrors++;
      continue;
    }
    const oddsOk = row.odds === expOdds;
    const lineOk = expLine === null || Math.abs(row.line - expLine) < 0.01;
    if (!oddsOk || !lineOk) {
      const msg = [];
      if (!oddsOk) msg.push(`odds DB=${row.odds} GT=${expOdds}`);
      if (!lineOk) msg.push(`line DB=${row.line} GT=${expLine}`);
      lines.push(`  ❌ ${fid} ${key}: ${msg.join(' | ')}`);
      matchErrors++; totalErrors++;
    } else {
      lines.push(`  ✅ ${fid} ${key}: odds=${row.odds}${expLine!==null?' line='+row.line:''}`);
    }
  }
  if (matchErrors > 0) {
    lines.forEach(l => console.log(l));
  } else {
    console.log(`  ✅ ${fid} (${gt.away}@${gt.home}): ALL 11 BOOK ODDS CORRECT`);
  }
}

// ── Step 3: Model odds independence ───────────────────────────────────────
console.log('\n[AUDIT] === STEP 3: MODEL ODDS INDEPENDENCE (book_id=0) ===');
const [modelOdds] = await conn.query(`
  SELECT match_id, market, selection, line, american_odds
  FROM wc2026_odds_snapshots
  WHERE match_id IN (?) AND book_id = 0
  ORDER BY match_id, market, selection
`, [matchIds]);

const modelMap = {};
for (const r of modelOdds) {
  if (!modelMap[r.match_id]) modelMap[r.match_id] = {};
  modelMap[r.match_id][`${r.market}|${r.selection}`] = {
    line: parseFloat(r.line), odds: r.american_odds
  };
}

for (const [fid, gt] of Object.entries(GT)) {
  const book = bookMap[fid] || {};
  const model = modelMap[fid] || {};
  const markets = ['1X2|away','1X2|home','1X2|draw','TOTAL|over','TOTAL|under',
    'ASIAN_HANDICAP|away','ASIAN_HANDICAP|home',
    'DOUBLE_CHANCE|away_draw','DOUBLE_CHANCE|home_draw','BTTS|yes','BTTS|no'];
  let notIndependent = 0;
  for (const key of markets) {
    if (book[key] && model[key] && book[key].odds === model[key].odds) {
      console.log(`  ⚠️  ${fid} ${key}: model=${model[key].odds} === book=${book[key].odds} NOT INDEPENDENT`);
      notIndependent++; totalErrors++;
    }
  }
  if (notIndependent === 0) {
    console.log(`  ✅ ${fid}: all model odds independent from book`);
  }
}

// ── Step 4: Projected scores ───────────────────────────────────────────────
console.log('\n[AUDIT] === STEP 4: PROJECTED SCORES ===');
const [projRows] = await conn.query(`
  SELECT p.match_id, p.proj_home_score, p.proj_away_score, p.proj_total
  FROM wc2026_model_projections p
  WHERE p.match_id IN (?)
  ORDER BY p.match_id, p.modeled_at DESC
`, [matchIds]);

const latestProj = {};
for (const r of projRows) {
  if (!latestProj[r.match_id]) latestProj[r.match_id] = r;
}

for (const [fid] of Object.entries(GT)) {
  const p = latestProj[fid];
  if (!p) { console.log(`  ❌ ${fid}: NO PROJECTION ROW`); totalErrors++; continue; }
  const homeRound = Number.isInteger(Number(p.proj_home_score)) || Number(p.proj_home_score) % 0.5 === 0;
  const awayRound = Number.isInteger(Number(p.proj_away_score)) || Number(p.proj_away_score) % 0.5 === 0;
  const totalRound = Number(p.proj_total) === 2.5 || Number(p.proj_total) === 3.5 || Number.isInteger(Number(p.proj_total));
  const issues = [];
  if (homeRound) { issues.push(`projHome=${p.proj_home_score} IS ROUND`); totalErrors++; }
  if (awayRound) { issues.push(`projAway=${p.proj_away_score} IS ROUND`); totalErrors++; }
  if (totalRound) { issues.push(`projTotal=${p.proj_total} IS ROUND`); totalErrors++; }
  if (issues.length > 0) {
    console.log(`  ❌ ${fid}: ${issues.join(' | ')}`);
  } else {
    console.log(`  ✅ ${fid}: projHome=${p.proj_home_score} projAway=${p.proj_away_score} projTotal=${p.proj_total}`);
  }
}

await conn.end();
console.log(`\n[AUDIT] ===== COMPLETE: ${totalErrors} ERRORS FOUND =====\n`);
process.exit(totalErrors > 0 ? 1 : 0);
