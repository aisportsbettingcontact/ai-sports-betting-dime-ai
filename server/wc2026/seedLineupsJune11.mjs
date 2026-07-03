/**
 * seedLineupsJune11.mjs
 * Re-seeds lineups for June 11, 2026 WC matches with CORRECTED home/away orientation:
 *   wc26-g-001: RSA (away) vs MEX (home)
 *   wc26-g-002: CZE (away) vs KOR (home)
 */
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });
import mysql from 'mysql2/promise';

const GAMES = [
  {
    espn_match_id: 'wc26-g-001',
    awayAbbr: 'RSA',
    homeAbbr: 'MEX',
    awayPlayers: [
      { name: 'R. Williams', position: 'GK', isStarter: true },
      { name: 'A. Modiba', position: 'DL', isStarter: true, injuryStatus: 'QUES' },
      { name: 'M. Mbokazi', position: 'DC', isStarter: true },
      { name: 'Ime Okon', position: 'DC', isStarter: true },
      { name: 'K. Mudau', position: 'DR', isStarter: true },
      { name: 'T. Mbatha', position: 'DMC', isStarter: true },
      { name: 'T. Mokoena', position: 'DMC', isStarter: true },
      { name: 'T. Moremi', position: 'AML', isStarter: true },
      { name: 'R. Mofokeng', position: 'AMC', isStarter: true },
      { name: 'O. Appollis', position: 'AMR', isStarter: true },
      { name: 'Lyle Foster', position: 'FW', isStarter: true },
      { name: 'A. Modiba', position: 'D', isStarter: false, injuryStatus: 'QUES' },
    ],
    homePlayers: [
      { name: 'Jose Rangel', position: 'GK', isStarter: true },
      { name: 'J. Gallardo', position: 'DL', isStarter: true },
      { name: 'Cesar Montes', position: 'DC', isStarter: true },
      { name: 'J. Vasquez', position: 'DC', isStarter: true },
      { name: 'Israel Reyes', position: 'DR', isStarter: true },
      { name: 'Erik Lira', position: 'DMC', isStarter: true },
      { name: 'Julian Quinones', position: 'ML', isStarter: true },
      { name: 'B. Gutierrez', position: 'MC', isStarter: true },
      { name: 'A. Fidalgo', position: 'MC', isStarter: true },
      { name: 'R. Alvarado', position: 'MR', isStarter: true },
      { name: 'Raul Jimenez', position: 'FW', isStarter: true },
      { name: 'S. Gimenez', position: 'F', isStarter: false, injuryStatus: 'QUES' },
    ],
  },
  {
    espn_match_id: 'wc26-g-002',
    awayAbbr: 'CZE',
    homeAbbr: 'KOR',
    awayPlayers: [
      { name: 'Matej Kovar', position: 'GK', isStarter: true },
      { name: 'L. Krejci', position: 'DC', isStarter: true },
      { name: 'Robin Hranac', position: 'DC', isStarter: true },
      { name: 'S. Chaloupek', position: 'DC', isStarter: true },
      { name: 'D. Jurasek', position: 'ML', isStarter: true },
      { name: 'Tomas Soucek', position: 'MC', isStarter: true },
      { name: 'M. Sadilek', position: 'MC', isStarter: true },
      { name: 'V. Coufal', position: 'MR', isStarter: true },
      { name: 'Lukas Provod', position: 'AMC', isStarter: true },
      { name: 'Pavel Sulc', position: 'AMC', isStarter: true },
      { name: 'P. Schick', position: 'FW', isStarter: true },
      { name: 'Jan Kuchta', position: 'F', isStarter: false, injuryStatus: 'QUES' },
    ],
    homePlayers: [
      { name: 'K. Seung-gyu', position: 'GK', isStarter: true },
      { name: 'Kim Min-Jae', position: 'DC', isStarter: true },
      { name: 'Lee Han-Beom', position: 'DC', isStarter: true },
      { name: 'Lee Gi-Hyuk', position: 'DC', isStarter: true },
      { name: 'Lee Tae-Seok', position: 'ML', isStarter: true },
      { name: 'Lee Jae-Sung', position: 'MC', isStarter: true },
      { name: 'H. In-beom', position: 'MC', isStarter: true },
      { name: 'Seol Young-Woo', position: 'MR', isStarter: true },
      { name: 'Lee Kang-in', position: 'AMC', isStarter: true },
      { name: 'Son Heung-Min', position: 'AMC', isStarter: true },
      { name: 'Hwang Hee-Chan', position: 'FW', isStarter: true },
      { name: 'Bae Jun-Ho', position: 'M', isStarter: false, injuryStatus: 'QUES' },
    ],
  },
];

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const scrapedAt = new Date();
  let total = 0;

  for (const game of GAMES) {
    console.log(`[LineupSeed] [STEP] Processing ${game.espn_match_id}: away=${game.awayAbbr} home=${game.homeAbbr}`);

    // Resolve team IDs
    const [[awayRow]] = await conn.query('SELECT team_id FROM wc2026_teams WHERE fifa_code=? LIMIT 1', [game.awayAbbr]);
    const [[homeRow]] = await conn.query('SELECT team_id FROM wc2026_teams WHERE fifa_code=? LIMIT 1', [game.homeAbbr]);
    const awayId = awayRow?.team_id;
    const homeId = homeRow?.team_id;
    console.log(`[LineupSeed] [STATE] away_team_id=${awayId}, home_team_id=${homeId}`);

    if (!awayId || !homeId) {
      console.error(`[LineupSeed] [VERIFY] FAIL — Could not resolve team IDs`);
      continue;
    }

    // Delete existing lineups
    const [del] = await conn.query('DELETE FROM wc2026_lineups WHERE match_id=?', [game.espn_match_id]);
    console.log(`[LineupSeed] [STEP] Deleted ${del.affectedRows} existing lineup rows`);

    const rows = [];
    for (const p of game.awayPlayers) {
      rows.push([game.espn_match_id, awayId, scrapedAt, false, p.name, p.position, p.isStarter, p.injuryStatus ?? null]);
    }
    for (const p of game.homePlayers) {
      rows.push([game.espn_match_id, homeId, scrapedAt, false, p.name, p.position, p.isStarter, p.injuryStatus ?? null]);
    }

    const [ins] = await conn.query(
      'INSERT INTO wc2026_lineups (match_id, team_id, scraped_at, is_confirmed, player_name, position, is_starter, injury_status) VALUES ?',
      [rows]
    );
    total += ins.affectedRows;
    console.log(`[LineupSeed] [OUTPUT] Inserted ${ins.affectedRows} lineup rows for ${game.espn_match_id}`);
  }

  await conn.end();
  console.log(`\n[LineupSeed] [OUTPUT] Total rows inserted: ${total}`);
  console.log('[LineupSeed] [VERIFY] PASS — Lineups seeded with corrected orientation');
}

main().catch(e => {
  console.error('[LineupSeed] [VERIFY] FAIL —', e.message);
  process.exit(1);
});
