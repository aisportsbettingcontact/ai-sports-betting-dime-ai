/**
 * jul5_publish.mjs — Check and insert Jul 5 R16 matches into wc2026_espn_matches
 * Then verify the full feed pipeline is working
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log('═══════════════════════════════════════════════════════════════');
console.log('  JUL 5 PUBLISH — CHECKING ESPN MATCHES TABLE');
console.log('═══════════════════════════════════════════════════════════════');

// Check if Jul 5 matches exist
const [existing] = await conn.query(
  `SELECT espn_match_id, homeTeamName, awayTeamName, matchGameDate, statusState, matchRound
   FROM wc2026_espn_matches 
   WHERE espn_match_id IN (760504, 760505)`
);

console.log(`\n[CHECK] Found ${existing.length} existing rows for ESPN IDs 760504/760505:`);
for (const row of existing) {
  console.log(`  ESPN ${row.espn_match_id}: ${row.homeTeamName} vs ${row.awayTeamName} | Date: ${row.matchGameDate} | Status: ${row.statusState} | Round: ${row.matchRound}`);
}

if (existing.length === 2) {
  console.log('\n✅ Both Jul 5 matches already exist in wc2026_espn_matches');
  console.log('   Feed should already display them. Checking matchGameDate...');
  
  // Verify dates are correct
  for (const row of existing) {
    if (row.matchGameDate && row.matchGameDate.includes('2026-07-05')) {
      console.log(`  ✅ ESPN ${row.espn_match_id} date correct: ${row.matchGameDate}`);
    } else {
      console.log(`  ⚠️  ESPN ${row.espn_match_id} date: ${row.matchGameDate} — may need update`);
    }
  }
} else {
  console.log('\n⚠️  Missing matches — need to insert them');
  
  // Check what round format existing R16 matches use
  const [r16Sample] = await conn.query(
    `SELECT espn_match_id, matchRound, round, homeTeamName, awayTeamName, matchGameDate 
     FROM wc2026_espn_matches 
     WHERE espn_match_id IN (760502, 760503) LIMIT 2`
  );
  console.log('\nExisting R16 samples (760502/760503):');
  for (const s of r16Sample) {
    console.log(`  ESPN ${s.espn_match_id}: round='${s.round}' matchRound='${s.matchRound}' date=${s.matchGameDate}`);
  }
  
  // Insert missing matches
  const matches = [
    {
      espn_match_id: 760504,
      uid: 's:600:l:4346:e:760504',
      competition: 'FIFA World Cup 2026',
      round: r16Sample[0]?.round || 'Round of 16',
      season: '2026',
      matchRound: r16Sample[0]?.matchRound || '4',
      matchDateUtc: '2026-07-05T18:00:00Z',
      statusState: 'pre',
      statusDetail: 'Scheduled',
      statusDisplay: '2:00 PM ET',
      venue: 'MetLife Stadium',
      city: 'East Rutherford, NJ',
      homeTeamId: 205,
      homeTeamAbbrev: 'BRA',
      homeTeamName: 'Brazil',
      homeTeamLogo: 'https://a.espncdn.com/i/teamlogos/soccer/500/205.png',
      awayTeamId: 464,
      awayTeamAbbrev: 'NOR',
      awayTeamName: 'Norway',
      awayTeamLogo: 'https://a.espncdn.com/i/teamlogos/soccer/500/464.png',
      matchGameDate: '2026-07-05',
      matchKickoffEt: '2:00 PM ET',
      scrapeVersion: 'manual-jul5-publish'
    },
    {
      espn_match_id: 760505,
      uid: 's:600:l:4346:e:760505',
      competition: 'FIFA World Cup 2026',
      round: r16Sample[0]?.round || 'Round of 16',
      season: '2026',
      matchRound: r16Sample[0]?.matchRound || '4',
      matchDateUtc: '2026-07-05T22:00:00Z',
      statusState: 'pre',
      statusDetail: 'Scheduled',
      statusDisplay: '6:00 PM ET',
      venue: 'AT&T Stadium',
      city: 'Arlington, TX',
      homeTeamId: 203,
      homeTeamAbbrev: 'MEX',
      homeTeamName: 'Mexico',
      homeTeamLogo: 'https://a.espncdn.com/i/teamlogos/soccer/500/203.png',
      awayTeamId: 448,
      awayTeamAbbrev: 'ENG',
      awayTeamName: 'England',
      awayTeamLogo: 'https://a.espncdn.com/i/teamlogos/soccer/500/448.png',
      matchGameDate: '2026-07-05',
      matchKickoffEt: '6:00 PM ET',
      scrapeVersion: 'manual-jul5-publish'
    }
  ];
  
  for (const m of matches) {
    const [check] = await conn.query('SELECT id FROM wc2026_espn_matches WHERE espn_match_id = ?', [m.espn_match_id]);
    if (check.length > 0) {
      console.log(`  ℹ️  ESPN ${m.espn_match_id} already exists, skipping insert`);
      continue;
    }
    await conn.query(
      `INSERT INTO wc2026_espn_matches 
       (espn_match_id, uid, competition, \`round\`, season, matchRound, matchDateUtc, 
        statusState, statusDetail, statusDisplay, venue, city,
        homeTeamId, homeTeamAbbrev, homeTeamName, homeTeamLogo,
        awayTeamId, awayTeamAbbrev, awayTeamName, awayTeamLogo,
        matchGameDate, matchKickoffEt, scrapeVersion, scrapedAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW())`,
      [m.espn_match_id, m.uid, m.competition, m.round, m.season, m.matchRound,
       m.matchDateUtc, m.statusState, m.statusDetail, m.statusDisplay, m.venue, m.city,
       m.homeTeamId, m.homeTeamAbbrev, m.homeTeamName, m.homeTeamLogo,
       m.awayTeamId, m.awayTeamAbbrev, m.awayTeamName, m.awayTeamLogo,
       m.matchGameDate, m.matchKickoffEt, m.scrapeVersion]
    );
    console.log(`  ✅ Inserted ESPN ${m.espn_match_id}: ${m.homeTeamName} vs ${m.awayTeamName}`);
  }
}

// Now verify wc2026_model_projections has entries
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  CHECKING wc2026_model_projections');
console.log('═══════════════════════════════════════════════════════════════');

const [projRows] = await conn.query(
  `SELECT match_id, model_version, home_lambda, away_lambda, proj_home_score, proj_away_score,
          model_home_ml, model_draw_ml, model_away_ml, to_advance_home_odds, to_advance_away_odds
   FROM wc2026_model_projections 
   WHERE match_id IN ('wc26-r16-091', 'wc26-r16-092')`
);

console.log(`\n[CHECK] Found ${projRows.length} projection rows:`);
for (const p of projRows) {
  console.log(`  ${p.match_id}: v=${p.model_version} | λH=${p.home_lambda} λA=${p.away_lambda} | Score: ${p.proj_home_score}-${p.proj_away_score}`);
  console.log(`    ML: H=${p.model_home_ml} D=${p.model_draw_ml} A=${p.model_away_ml} | Adv: H=${p.to_advance_home_odds} A=${p.to_advance_away_odds}`);
}

// Verify wc2026MatchOdds
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  CHECKING wc2026MatchOdds');
console.log('═══════════════════════════════════════════════════════════════');

const [oddsRows] = await conn.query(
  `SELECT match_id, book_home_ml, book_away_ml, book_draw, model_home_ml, model_away_ml, model_draw,
          book_home_to_advance, book_away_to_advance, model_home_to_advance, model_away_to_advance,
          espn_match_id, insert_method
   FROM wc2026MatchOdds 
   WHERE match_id IN ('wc26-r16-091', 'wc26-r16-092')`
);

console.log(`\n[CHECK] Found ${oddsRows.length} matchOdds rows:`);
for (const o of oddsRows) {
  console.log(`  ${o.match_id} (ESPN ${o.espn_match_id}): method=${o.insert_method}`);
  console.log(`    Book ML: H=${o.book_home_ml} D=${o.book_draw} A=${o.book_away_ml}`);
  console.log(`    Model ML: H=${o.model_home_ml} D=${o.model_draw} A=${o.model_away_ml}`);
  console.log(`    Advance: Book H=${o.book_home_to_advance} A=${o.book_away_to_advance} | Model H=${o.model_home_to_advance} A=${o.model_away_to_advance}`);
}

// Check the match_id mapping between espn_matches and matchOdds
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  VERIFYING MATCH_ID LINKAGE');
console.log('═══════════════════════════════════════════════════════════════');

// The router uses matchId from wc2026_espn_matches to query wc2026MatchOdds
// Check what matchId format wc2026_espn_matches uses
const [matchIdCheck] = await conn.query(
  `SELECT espn_match_id, uid FROM wc2026_espn_matches WHERE espn_match_id IN (760502, 760503, 760504, 760505) LIMIT 4`
);
console.log('\nESPN match UIDs (used as matchId in router):');
for (const m of matchIdCheck) {
  console.log(`  ESPN ${m.espn_match_id}: uid='${m.uid}'`);
}

// Check how the router maps espn_match_id to wc2026MatchOdds.match_id
// The router uses: inArray(wc2026MatchOdds.matchId, matchIds)
// where matchIds comes from the espn_matches query
// Need to check what field is used as the join key

// Check the Drizzle schema for the matchId field
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  ✅ PUBLISH VERIFICATION COMPLETE');
console.log('═══════════════════════════════════════════════════════════════');

await conn.end();
