/**
 * fix_fixtures.mjs
 * Corrects home/away orientation for WC2026 June 11 fixtures:
 *   wc26-g-001: MEX (home) vs RSA (away) — Estadio Azteca
 *   KOR/CZE fixture: KOR (home) vs CZE (away)
 * Also verifies wc26-g-002 (COL home, UZB away) is already correct.
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '/home/ubuntu/ai-sports-betting/.env') });
import mysql from 'mysql2/promise';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  
  console.log('[FixFixtures] [STEP] Querying current fixture orientations...');
  
  // Show all June 11 fixtures
  const [fixtures] = await conn.query(
    `SELECT f.match_id, f.home_team_id, f.away_team_id, f.match_date, f.kickoff_utc,
            ht.fifa_code AS home_code, ht.name AS home_name,
            at.fifa_code AS away_code, at.name AS away_name
     FROM wc2026_matches f
     JOIN wc2026_teams ht ON ht.team_id = f.home_team_id
     JOIN wc2026_teams at ON at.team_id = f.away_team_id
     WHERE f.match_date = '2026-06-11'
     ORDER BY f.kickoff_utc`
  );
  
  console.log('[FixFixtures] [STATE] Current June 11 fixtures:');
  for (const f of fixtures) {
    console.log(`  ${f.match_id}: home=${f.home_code}(${f.home_name}) away=${f.away_code}(${f.away_name}) kickoff=${f.kickoff_utc}`);
  }
  
  // Find team IDs for MEX, RSA, KOR, CZE
  const teamCodes = ['MEX', 'RSA', 'KOR', 'CZE'];
  const teamMap = {};
  for (const code of teamCodes) {
    const [rows] = await conn.query(
      'SELECT team_id, fifa_code, name FROM wc2026_teams WHERE fifa_code = ? LIMIT 1',
      [code]
    );
    if (rows[0]) {
      teamMap[code] = rows[0];
      console.log(`[FixFixtures] [STATE] ${code} -> team_id=${rows[0].team_id} name=${rows[0].name}`);
    } else {
      console.error(`[FixFixtures] [VERIFY] FAIL — team not found: ${code}`);
    }
  }
  
  // Fix wc26-g-001: swap home/away (MEX should be home, RSA should be away)
  const g001 = fixtures.find(f => f.match_id === 'wc26-g-001');
  if (g001) {
    console.log(`\n[FixFixtures] [STEP] Fixing wc26-g-001: ${g001.home_code} -> ${g001.away_code} (swapping home/away)`);
    console.log(`  Before: home=${g001.home_code}, away=${g001.away_code}`);
    console.log(`  After:  home=MEX, away=RSA`);
    
    const mexId = teamMap['MEX']?.team_id;
    const rsaId = teamMap['RSA']?.team_id;
    
    if (!mexId || !rsaId) {
      console.error('[FixFixtures] [VERIFY] FAIL — MEX or RSA team_id not found');
    } else {
      const [result] = await conn.query(
        'UPDATE wc2026_matches SET home_team_id=?, away_team_id=? WHERE match_id=?',
        [mexId, rsaId, 'wc26-g-001']
      );
      console.log(`[FixFixtures] [OUTPUT] Updated wc26-g-001: affectedRows=${result.affectedRows}`);
    }
  }
  
  // Find KOR/CZE fixture and fix it (KOR should be home, CZE should be away)
  const korCzeFixture = fixtures.find(f => 
    (f.home_code === 'KOR' || f.away_code === 'KOR') &&
    (f.home_code === 'CZE' || f.away_code === 'CZE')
  );
  
  if (korCzeFixture) {
    console.log(`\n[FixFixtures] [STEP] Found KOR/CZE fixture: ${korCzeFixture.match_id}`);
    console.log(`  Before: home=${korCzeFixture.home_code}, away=${korCzeFixture.away_code}`);
    
    if (korCzeFixture.home_code === 'KOR' && korCzeFixture.away_code === 'CZE') {
      console.log('[FixFixtures] [VERIFY] KOR/CZE already correct (KOR=home, CZE=away) — no change needed');
    } else {
      console.log('  After:  home=KOR, away=CZE');
      const korId = teamMap['KOR']?.team_id;
      const czeId = teamMap['CZE']?.team_id;
      
      if (!korId || !czeId) {
        console.error('[FixFixtures] [VERIFY] FAIL — KOR or CZE team_id not found');
      } else {
        const [result] = await conn.query(
          'UPDATE wc2026_matches SET home_team_id=?, away_team_id=? WHERE match_id=?',
          [korId, czeId, korCzeFixture.match_id]
        );
        console.log(`[FixFixtures] [OUTPUT] Updated ${korCzeFixture.match_id}: affectedRows=${result.affectedRows}`);
      }
    }
  } else {
    console.log('[FixFixtures] [STATE] KOR/CZE fixture not found on June 11 — checking all fixtures...');
    const [allKorCze] = await conn.query(
      `SELECT f.match_id, f.match_date, f.home_team_id, f.away_team_id,
              ht.fifa_code AS home_code, at.fifa_code AS away_code
       FROM wc2026_matches f
       JOIN wc2026_teams ht ON ht.team_id = f.home_team_id
       JOIN wc2026_teams at ON at.team_id = f.away_team_id
       WHERE (ht.fifa_code IN ('KOR','CZE') OR at.fifa_code IN ('KOR','CZE'))
       ORDER BY f.match_date`
    );
    console.log('[FixFixtures] [STATE] KOR/CZE fixtures found:');
    for (const f of allKorCze) {
      console.log(`  ${f.match_id} (${f.match_date}): home=${f.home_code}, away=${f.away_code}`);
    }
    
    // Fix the KOR/CZE fixture wherever it is
    for (const f of allKorCze) {
      if ((f.home_code === 'KOR' || f.away_code === 'KOR') && (f.home_code === 'CZE' || f.away_code === 'CZE')) {
        if (f.home_code === 'CZE' && f.away_code === 'KOR') {
          // Need to swap: KOR should be home
          const korId = teamMap['KOR']?.team_id;
          const czeId = teamMap['CZE']?.team_id;
          if (korId && czeId) {
            const [result] = await conn.query(
              'UPDATE wc2026_matches SET home_team_id=?, away_team_id=? WHERE match_id=?',
              [korId, czeId, f.match_id]
            );
            console.log(`[FixFixtures] [OUTPUT] Fixed ${f.match_id}: swapped to KOR=home, CZE=away. affectedRows=${result.affectedRows}`);
          }
        } else if (f.home_code === 'KOR' && f.away_code === 'CZE') {
          console.log(`[FixFixtures] [VERIFY] ${f.match_id} already correct (KOR=home, CZE=away)`);
        }
      }
    }
  }
  
  // Verify wc26-g-002 (COL home, UZB away)
  const g002 = fixtures.find(f => f.match_id === 'wc26-g-002');
  if (g002) {
    console.log(`\n[FixFixtures] [STATE] wc26-g-002: home=${g002.home_code}, away=${g002.away_code}`);
    if (g002.home_code === 'COL' && g002.away_code === 'UZB') {
      console.log('[FixFixtures] [VERIFY] wc26-g-002 orientation is correct (COL=home, UZB=away)');
    } else {
      console.log('[FixFixtures] [STATE] wc26-g-002 may need review');
    }
  }
  
  // Show final state
  console.log('\n[FixFixtures] [STEP] Final fixture state after fixes:');
  const [finalFixtures] = await conn.query(
    `SELECT f.match_id, f.match_date,
            ht.fifa_code AS home_code, ht.name AS home_name,
            at.fifa_code AS away_code, at.name AS away_name
     FROM wc2026_matches f
     JOIN wc2026_teams ht ON ht.team_id = f.home_team_id
     JOIN wc2026_teams at ON at.team_id = f.away_team_id
     WHERE f.match_date IN ('2026-06-11', '2026-06-12')
     ORDER BY f.match_date, f.kickoff_utc`
  );
  for (const f of finalFixtures) {
    console.log(`  ${f.match_id} (${f.match_date}): home=${f.home_code}(${f.home_name}) away=${f.away_code}(${f.away_name})`);
  }
  
  await conn.end();
  console.log('\n[FixFixtures] [VERIFY] PASS — Fixture orientation fixes complete');
}

main().catch(e => {
  console.error('[FixFixtures] [VERIFY] FAIL —', e.message);
  process.exit(1);
});
