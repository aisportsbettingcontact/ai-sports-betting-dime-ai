import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get all match_ids in both tables
const [frozenIds] = await conn.execute('SELECT match_id FROM wc2026_frozen_book_odds ORDER BY match_id');
const [moIds] = await conn.execute('SELECT match_id FROM wc2026MatchOdds ORDER BY match_id');

const frozenSet = new Set(frozenIds.map(r => r.match_id));
const moSet = new Set(moIds.map(r => r.match_id));

const both = [...frozenSet].filter(id => moSet.has(id));
const frozenOnly = [...frozenSet].filter(id => !moSet.has(id));
const moOnly = [...moSet].filter(id => !frozenSet.has(id));

console.log('=== OVERLAP SUMMARY ===');
console.log(`  frozen_book_odds total rows: ${frozenIds.length}`);
console.log(`  wc2026MatchOdds total rows: ${moIds.length}`);
console.log(`  In BOTH tables: ${both.length}`);
console.log(`  In frozen_book_odds ONLY: ${frozenOnly.length}`, frozenOnly.slice(0, 5));
console.log(`  In wc2026MatchOdds ONLY: ${moOnly.length}`, moOnly.slice(0, 5));

// For overlapping matches, compare book_home_ml, book_draw, book_away_ml
if (both.length > 0) {
  console.log('\n=== VALUE COMPARISON (shared book columns) ===');
  const [frozenData] = await conn.execute(
    `SELECT match_id, book_home_ml, book_draw, book_away_ml, book_primary_spread, book_total FROM wc2026_frozen_book_odds WHERE match_id IN (${both.map(() => '?').join(',')})`,
    both
  );
  const [moData] = await conn.execute(
    `SELECT match_id, book_home_ml, book_draw, book_away_ml, book_primary_spread, book_total FROM wc2026MatchOdds WHERE match_id IN (${both.map(() => '?').join(',')})`,
    both
  );
  
  const frozenMap = new Map(frozenData.map(r => [r.match_id, r]));
  const moMap = new Map(moData.map(r => [r.match_id, r]));
  
  let agree = 0, disagree = 0, partial = 0;
  const disagreements = [];
  
  for (const mid of both) {
    const f = frozenMap.get(mid);
    const m = moMap.get(mid);
    if (!f || !m) continue;
    
    const fields = ['book_home_ml', 'book_draw', 'book_away_ml', 'book_primary_spread', 'book_total'];
    let matchAgree = true;
    const diffs = [];
    
    for (const field of fields) {
      if (f[field] !== m[field] && !(f[field] === null && m[field] === null)) {
        matchAgree = false;
        diffs.push(`${field}: frozen=${f[field]} vs MO=${m[field]}`);
      }
    }
    
    if (matchAgree) {
      agree++;
    } else {
      disagree++;
      disagreements.push({ match_id: mid, diffs });
    }
  }
  
  console.log(`  Agree (all 5 fields match): ${agree}/${both.length}`);
  console.log(`  Disagree: ${disagree}/${both.length}`);
  
  if (disagreements.length > 0) {
    console.log('\n=== DISAGREEMENTS (first 10) ===');
    for (const d of disagreements.slice(0, 10)) {
      console.log(`  ${d.match_id}:`);
      d.diffs.forEach(diff => console.log(`    ${diff}`));
    }
  }
}

await conn.end();
process.exit(0);
