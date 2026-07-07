import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Item 2: Full candidate sweep — every wc2026MatchOdds row where home is ML underdog
// In 3-way soccer: home is underdog when book_home_ml > book_away_ml (both positive)
// OR when book_home_ml > 0 and book_away_ml < 0 (home positive = underdog)
// Standard: positive ML = underdog, negative ML = favorite
// In 3-way: both can be positive, lower positive = closer to favorite

const [allRows] = await conn.execute(`
  SELECT match_id, 
    book_home_ml, book_away_ml,
    book_primary_spread, book_home_primary_spread_odds, book_away_primary_spread_odds,
    model_primary_spread, model_home_primary_spread_odds, model_away_primary_spread_odds,
    model_projected_home_goals, model_projected_away_goals
  FROM wc2026MatchOdds 
  WHERE book_home_ml IS NOT NULL AND book_away_ml IS NOT NULL
  ORDER BY match_id
`);

console.log('=== FULL CANDIDATE SWEEP: HOME IS ML UNDERDOG ===');
console.log('Criteria: home_ml > away_ml (home is bigger underdog in 3-way)');
console.log('');

const candidates = [];
for (const r of allRows) {
  // Determine if home is underdog
  // In American odds: more positive = bigger underdog, more negative = bigger favorite
  // Compare: if both positive, higher = more underdog; if mixed, positive side = underdog
  let homeIsUnderdog = false;
  if (r.book_home_ml > 0 && r.book_away_ml < 0) {
    homeIsUnderdog = true; // Clear: home positive, away negative
  } else if (r.book_home_ml > 0 && r.book_away_ml > 0 && r.book_home_ml > r.book_away_ml) {
    homeIsUnderdog = true; // Both positive, home is bigger underdog
  }
  // If home_ml < 0 and away_ml > 0: home is favorite (not a candidate)
  // If home_ml < 0 and away_ml < 0: home is less negative = less favorite... edge case
  
  if (homeIsUnderdog) {
    candidates.push(r);
  }
}

console.log(`Total rows with non-null ML: ${allRows.length}`);
console.log(`Candidates (home is ML underdog): ${candidates.length}`);
console.log('');
console.log('| match_id | home_ml | away_ml | book_spread | model_spread | VERDICT |');
console.log('|----------|---------|---------|-------------|--------------|---------|');

for (const r of candidates) {
  let verdict = 'N/A';
  if (r.book_primary_spread === null) {
    verdict = 'N/A (no spread)';
  } else if (r.book_primary_spread < 0) {
    // Home is underdog but spread is negative = home gives goals = INVERTED
    verdict = 'INVERTED';
  } else if (r.book_primary_spread > 0) {
    // Home is underdog and spread is positive = home gets goals = CORRECT
    verdict = 'CORRECT';
  } else {
    // spread = 0 = pick'em
    verdict = 'PICK_EM';
  }
  
  console.log(`| ${r.match_id} | ${r.book_home_ml} | ${r.book_away_ml} | ${r.book_primary_spread} | ${r.model_primary_spread} | ${verdict} |`);
}

await conn.end();
process.exit(0);
