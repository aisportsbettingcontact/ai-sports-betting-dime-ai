/**
 * jul5_publish_v2.mjs — Insert Jul 5 R16 matches into wc2026_espn_matches
 * matchDateUtc is bigint (UTC ms), not a string
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const now = Date.now();

console.log('═══════════════════════════════════════════════════════════════');
console.log('  JUL 5 PUBLISH v2 — INSERT ESPN MATCHES');
console.log('═══════════════════════════════════════════════════════════════');

// Check if they already exist
const [existing] = await conn.query(
  `SELECT espn_match_id, homeTeamName, awayTeamName, matchDateUtc, matchGameDate 
   FROM wc2026_espn_matches WHERE espn_match_id IN ('760504', '760505')`
);
console.log(`[CHECK] Found ${existing.length} existing rows`);
for (const r of existing) {
  console.log(`  ESPN ${r.espn_match_id}: ${r.homeTeamName} vs ${r.awayTeamName} | UTC: ${r.matchDateUtc} | Date: ${r.matchGameDate}`);
}

if (existing.length >= 2) {
  console.log('\n✅ Both matches already exist. No insert needed.');
} else {
  // Get matchRound format from existing R16 match
  const [sample] = await conn.query(
    `SELECT matchRound, \`round\`, competition FROM wc2026_espn_matches WHERE espn_match_id = '760502'`
  );
  const roundVal = sample[0]?.round || 'Round of 16';
  const matchRoundVal = sample[0]?.matchRound || 'round-of-16';
  const compVal = sample[0]?.competition || 'FIFA World Cup 2026, Round of 16';
  console.log(`\n[REF] Using round='${roundVal}', matchRound='${matchRoundVal}', competition='${compVal}'`);

  const matches = [
    {
      espn_match_id: '760504',
      uid: 's:600~l:4346~e:760504',
      competition: compVal,
      round: roundVal,
      season: '2026',
      matchDateUtc: new Date('2026-07-05T18:00:00Z').getTime(), // 2PM ET
      matchGameDate: '2026-07-05',
      matchKickoffEt: '14:00',
      statusState: 'pre',
      statusDetail: 'Scheduled',
      statusDisplay: '2:00 PM ET',
      venue: 'MetLife Stadium',
      city: 'East Rutherford, NJ',
      homeTeamId: '205',
      homeTeamAbbrev: 'BRA',
      homeTeamName: 'Brazil',
      homeTeamLogo: 'https://a.espncdn.com/i/teamlogos/soccer/500/205.png',
      awayTeamId: '464',
      awayTeamAbbrev: 'NOR',
      awayTeamName: 'Norway',
      awayTeamLogo: 'https://a.espncdn.com/i/teamlogos/soccer/500/464.png',
      matchRound: matchRoundVal,
    },
    {
      espn_match_id: '760505',
      uid: 's:600~l:4346~e:760505',
      competition: compVal,
      round: roundVal,
      season: '2026',
      matchDateUtc: new Date('2026-07-05T22:00:00Z').getTime(), // 6PM ET
      matchGameDate: '2026-07-05',
      matchKickoffEt: '18:00',
      statusState: 'pre',
      statusDetail: 'Scheduled',
      statusDisplay: '6:00 PM ET',
      venue: 'AT&T Stadium',
      city: 'Arlington, TX',
      homeTeamId: '203',
      homeTeamAbbrev: 'MEX',
      homeTeamName: 'Mexico',
      homeTeamLogo: 'https://a.espncdn.com/i/teamlogos/soccer/500/203.png',
      awayTeamId: '448',
      awayTeamAbbrev: 'ENG',
      awayTeamName: 'England',
      awayTeamLogo: 'https://a.espncdn.com/i/teamlogos/soccer/500/448.png',
      matchRound: matchRoundVal,
    }
  ];

  for (const m of matches) {
    const [check] = await conn.query(
      `SELECT id FROM wc2026_espn_matches WHERE espn_match_id = ?`, [m.espn_match_id]
    );
    if (check.length > 0) {
      console.log(`  ℹ️  ESPN ${m.espn_match_id} already exists, skipping`);
      continue;
    }
    await conn.query(
      `INSERT INTO wc2026_espn_matches 
       (espn_match_id, uid, competition, \`round\`, season, matchDateUtc, matchGameDate, matchKickoffEt,
        statusState, statusDetail, statusDisplay, venue, city,
        homeTeamId, homeTeamAbbrev, homeTeamName, homeTeamLogo,
        awayTeamId, awayTeamAbbrev, awayTeamName, awayTeamLogo,
        matchRound, scrapedAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [m.espn_match_id, m.uid, m.competition, m.round, m.season,
       m.matchDateUtc, m.matchGameDate, m.matchKickoffEt,
       m.statusState, m.statusDetail, m.statusDisplay, m.venue, m.city,
       m.homeTeamId, m.homeTeamAbbrev, m.homeTeamName, m.homeTeamLogo,
       m.awayTeamId, m.awayTeamAbbrev, m.awayTeamName, m.awayTeamLogo,
       m.matchRound, now, now, now]
    );
    console.log(`  ✅ Inserted ESPN ${m.espn_match_id}: ${m.homeTeamName} vs ${m.awayTeamName} | UTC: ${m.matchDateUtc}`);
  }
}

// Now check how the router maps espn_match_id to wc2026MatchOdds.match_id
// The router queries wc2026_espn_matches by date, gets matchIds, then queries wc2026MatchOdds
// Need to find what field is used as the join key
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  CHECKING MATCH_ID LINKAGE (router join key)');
console.log('═══════════════════════════════════════════════════════════════');

// The router code uses: inArray(wc2026MatchOdds.matchId, matchIds)
// where matchIds = matches.map(m => m.matchId)
// But wc2026_espn_matches doesn't have a 'matchId' column — it has espn_match_id
// The Drizzle schema for wc2026MatchOdds has matchId which is the 'wc26-r16-091' format
// So the router must be constructing matchIds from somewhere...

// Check if there's a matchId column we missed or if it's derived
const [matchOddsSchema] = await conn.query(`SHOW COLUMNS FROM wc2026MatchOdds WHERE Field = 'match_id'`);
console.log('wc2026MatchOdds.match_id:', JSON.stringify(matchOddsSchema[0]));

// Check what the router actually uses as matchIds
// From the code: const matchIds = matches.map(f => f.matchId)
// This means wc2026EspnMatches must have a matchId field... but schema doesn't show it
// Let me check if there's a fifaMatchId or similar
const [allCols] = await conn.query(`SHOW COLUMNS FROM wc2026_espn_matches`);
const colNames = allCols.map(c => c.Field);
console.log('\nAll wc2026_espn_matches columns:', colNames.join(', '));

// Check if espn_match_id IS the matchId used in the router (unlikely since format differs)
// Or if there's a mapping table
// The wc2026MatchOdds.espn_match_id should link them
const [oddsLink] = await conn.query(
  `SELECT match_id, espn_match_id FROM wc2026MatchOdds WHERE match_id IN ('wc26-r16-091', 'wc26-r16-092')`
);
console.log('\nwc2026MatchOdds linkage:');
for (const o of oddsLink) {
  console.log(`  ${o.match_id} → ESPN ${o.espn_match_id}`);
}

// Now verify the model projections table
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  CHECKING wc2026_model_projections');
console.log('═══════════════════════════════════════════════════════════════');

const [projRows] = await conn.query(
  `SELECT match_id, model_version, home_lambda, away_lambda, proj_home_score, proj_away_score
   FROM wc2026_model_projections WHERE match_id IN ('wc26-r16-091', 'wc26-r16-092')`
);
console.log(`Found ${projRows.length} projection rows:`);
for (const p of projRows) {
  console.log(`  ${p.match_id}: v=${p.model_version} | λ=${p.home_lambda}/${p.away_lambda} | Score: ${p.proj_home_score}-${p.proj_away_score}`);
}

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  ✅ PUBLISH COMPLETE');
console.log('═══════════════════════════════════════════════════════════════');

await conn.end();
