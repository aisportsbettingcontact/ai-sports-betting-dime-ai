import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const [r32] = await conn.execute(
  "SELECT match_id, book_home_ml, book_primary_spread, insert_method FROM wc2026MatchOdds WHERE match_id LIKE 'wc26-r32-%' ORDER BY match_id"
);

console.log('=== R32 SPREAD vs ML ===');
let mismatches = 0;
let checked = 0;
for (const r of r32) {
  if (r.book_home_ml === null || r.book_primary_spread === null) continue;
  if (r.book_primary_spread === 0) continue; // pick'em
  checked++;
  const homeFav = r.book_home_ml < 0;
  const spreadFavorsHome = r.book_primary_spread < 0;
  const consistent = homeFav === spreadFavorsHome;
  if (!consistent) {
    mismatches++;
    console.log(`  ${r.match_id}: ML_home=${r.book_home_ml} spread=${r.book_primary_spread} → MISMATCH`);
  }
}
console.log(`\nChecked: ${checked}, Mismatches: ${mismatches}`);

// Also check the v19 hardcoded R16 values more carefully
// The issue might be that BetExplorer shows spread from FAVORITE perspective
// and v19 hardcoded it without flipping for home-underdog matches

// Check r16-091 (home favorite) and r16-093/094 (close matches)
const [r16detail] = await conn.execute(
  "SELECT match_id, book_home_ml, book_away_ml, book_primary_spread, book_home_primary_spread_odds, book_away_primary_spread_odds FROM wc2026MatchOdds WHERE match_id LIKE 'wc26-r16-%' ORDER BY match_id"
);
console.log('\n=== R16 FULL SPREAD DETAIL ===');
for (const r of r16detail) {
  console.log(`${r.match_id}: ML=${r.book_home_ml}/${r.book_away_ml} spread=${r.book_primary_spread} spreadOdds=H${r.book_home_primary_spread_odds}/A${r.book_away_primary_spread_odds}`);
}

await conn.end();
process.exit(0);
