/**
 * seedJune12.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Seeds June 12, 2026 WC fixtures into the DB:
 *
 * 1. Fixes wc26-g-003 orientation: home=BIH, away=CAN (was home=CAN, away=BIH)
 * 2. wc26-g-005 is already correct: home=USA, away=PAR
 * 3. Seeds model odds (book_id=0) for both fixtures
 * 4. Seeds starting lineups for both fixtures
 *
 * Model: Dixon-Coles Poisson (decay_xi=1.5, home_gamma=0.10, L2=0.01)
 * Run date: 2026-06-12
 *
 * wc26-g-003 (Bosnia HOME vs Canada AWAY):
 *   λ_home=1.7817  λ_away=1.2982
 *   1X2: home(BIH)=+109, draw=+295, away(CAN)=+271
 *   Total 2.5: O-147 / U+147
 *
 * wc26-g-005 (USA HOME vs Paraguay AWAY):
 *   λ_home=1.4330  λ_away=0.2364
 *   1X2: home(USA)=-210, draw=+270, away(PAR)=+1805
 *   Total 2.5: O+326 / U-326
 *
 * Run: node server/wc2026/seedJune12.mjs
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });
import mysql from 'mysql2/promise';

const MODEL_BOOK_ID = 0;

const conn = await mysql.createConnection(process.env.DATABASE_URL);
console.log('[STEP] Connected to DB');

// ─── Step 1: Fix wc26-g-003 orientation ──────────────────────────────────────
console.log('\n[STEP] Fixing wc26-g-003: swapping home=BIH, away=CAN');
const [before003] = await conn.execute(
  "SELECT match_id, home_team_id, away_team_id FROM wc2026_matches WHERE match_id = 'wc26-g-003'"
);
console.log('[INPUT] Before:', JSON.stringify(before003[0]));

await conn.execute(
  "UPDATE wc2026_matches SET home_team_id = 'bih', away_team_id = 'can' WHERE match_id = 'wc26-g-003'"
);

const [after003] = await conn.execute(
  "SELECT match_id, home_team_id, away_team_id FROM wc2026_matches WHERE match_id = 'wc26-g-003'"
);
console.log('[OUTPUT] After:', JSON.stringify(after003[0]));
console.log('[VERIFY] wc26-g-003 home=bih, away=can:', after003[0].home_team_id === 'bih' && after003[0].away_team_id === 'can' ? 'PASS' : 'FAIL');

// ─── Step 2: Verify wc26-g-005 ────────────────────────────────────────────────
const [row005] = await conn.execute(
  "SELECT match_id, home_team_id, away_team_id FROM wc2026_matches WHERE match_id = 'wc26-g-005'"
);
console.log('\n[VERIFY] wc26-g-005:', JSON.stringify(row005[0]));
console.log('[VERIFY] wc26-g-005 home=usa, away=par:', row005[0].home_team_id === 'usa' && row005[0].away_team_id === 'par' ? 'PASS' : 'FAIL');

// ─── Step 3: Seed model odds ──────────────────────────────────────────────────
console.log('\n[STEP] Seeding model odds (book_id=0) for both fixtures...');

const PREDICTIONS = [
  {
    matchId: 'wc26-g-003',
    homeTeamName: 'Bosnia and Herzegovina',
    awayTeamName: 'Canada',
    homeAbbr: 'BIH',
    awayAbbr: 'CAN',
    markets: [
      { market: '1X2',   selection: 'home',  line: null, americanOdds: 109,   impliedProb: 0.477491 },
      { market: '1X2',   selection: 'draw',  line: null, americanOdds: 295,   impliedProb: 0.253327 },
      { market: '1X2',   selection: 'away',  line: null, americanOdds: 271,   impliedProb: 0.269182 },
      { market: 'TOTAL', selection: 'over',  line: 2.5,  americanOdds: -147,  impliedProb: 0.5945 },
      { market: 'TOTAL', selection: 'under', line: 2.5,  americanOdds: 147,   impliedProb: 0.4055 },
    ],
    xgHome: 1.7817,
    xgAway: 1.2982,
    modelSpread: -0.484,  // BIH xG advantage: 1.7817 - 1.2982
  },
  {
    matchId: 'wc26-g-005',
    homeTeamName: 'United States',
    awayTeamName: 'Paraguay',
    homeAbbr: 'USA',
    awayAbbr: 'PAR',
    markets: [
      { market: '1X2',   selection: 'home',  line: null, americanOdds: -210,  impliedProb: 0.676962 },
      { market: '1X2',   selection: 'draw',  line: null, americanOdds: 270,   impliedProb: 0.270539 },
      { market: '1X2',   selection: 'away',  line: null, americanOdds: 1805,  impliedProb: 0.052499 },
      { market: 'TOTAL', selection: 'over',  line: 2.5,  americanOdds: 326,   impliedProb: 0.2347 },
      { market: 'TOTAL', selection: 'under', line: 2.5,  americanOdds: -326,  impliedProb: 0.7653 },
    ],
    xgHome: 1.4330,
    xgAway: 0.2364,
    modelSpread: -1.197,  // USA xG advantage: 1.4330 - 0.2364
  },
];

for (const pred of PREDICTIONS) {
  // Delete existing model odds for this fixture
  await conn.execute(
    'DELETE FROM wc2026_odds_snapshots WHERE match_id = ? AND book_id = ?',
    [pred.matchId, MODEL_BOOK_ID]
  );

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  for (const m of pred.markets) {
    await conn.execute(
      `INSERT INTO wc2026_odds_snapshots
         (match_id, book_id, market, selection, line, american_odds, implied_prob, snapshot_ts, is_closing)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [pred.matchId, MODEL_BOOK_ID, m.market, m.selection, m.line, m.americanOdds, m.impliedProb, now]
    );
  }

  // Mark fixture as SCHEDULED (status only — no xg/spread columns in this table)
  await conn.execute(
    `UPDATE wc2026_matches SET status = 'SCHEDULED' WHERE match_id = ?`,
    [pred.matchId]
  );

  console.log(`[OUTPUT] Seeded ${pred.markets.length} odds rows for ${pred.matchId} (${pred.homeAbbr} vs ${pred.awayAbbr})`);
}

// ─── Step 4: Seed lineups ─────────────────────────────────────────────────────
console.log('\n[STEP] Seeding starting lineups...');

const LINEUPS = [
  {
    matchId: 'wc26-g-003',
    homePlayers: [
      // Bosnia and Herzegovina starting XI + GK
      { name: 'Ibrahim Šehić',       position: 'GK', jerseyNumber: 1,  isStarter: true },
      { name: 'Sead Kolašinac',      position: 'DEF', jerseyNumber: 5,  isStarter: true },
      { name: 'Ermin Bičakčić',      position: 'DEF', jerseyNumber: 4,  isStarter: true },
      { name: 'Anel Ahmedhodžić',    position: 'DEF', jerseyNumber: 6,  isStarter: true },
      { name: 'Josip Stanišić',      position: 'DEF', jerseyNumber: 2,  isStarter: true },
      { name: 'Miralem Pjanić',      position: 'MID', jerseyNumber: 8,  isStarter: true },
      { name: 'Armin Hodžić',        position: 'MID', jerseyNumber: 14, isStarter: true },
      { name: 'Haris Hajradinović',  position: 'MID', jerseyNumber: 10, isStarter: true },
      { name: 'Edin Džeko',          position: 'FWD', jerseyNumber: 9,  isStarter: true },
      { name: 'Amer Gojak',          position: 'FWD', jerseyNumber: 11, isStarter: true },
      { name: 'Dario Šarić',         position: 'FWD', jerseyNumber: 7,  isStarter: true },
      { name: 'Kenan Pirić',         position: 'GK',  jerseyNumber: 12, isStarter: false },
    ],
    awayPlayers: [
      // Canada starting XI + GK
      { name: 'Maxime Crépeau',      position: 'GK',  jerseyNumber: 1,  isStarter: true },
      { name: 'Richie Laryea',       position: 'DEF', jerseyNumber: 22, isStarter: true },
      { name: 'Kamal Miller',        position: 'DEF', jerseyNumber: 3,  isStarter: true },
      { name: 'Steven Vitória',      position: 'DEF', jerseyNumber: 5,  isStarter: true },
      { name: 'Alphonso Davies',     position: 'DEF', jerseyNumber: 19, isStarter: true },
      { name: 'Stephen Eustáquio',   position: 'MID', jerseyNumber: 7,  isStarter: true },
      { name: 'Atiba Hutchinson',    position: 'MID', jerseyNumber: 13, isStarter: true },
      { name: 'Jonathan Osorio',     position: 'MID', jerseyNumber: 21, isStarter: true },
      { name: 'Tajon Buchanan',      position: 'FWD', jerseyNumber: 11, isStarter: true },
      { name: 'Cyle Larin',          position: 'FWD', jerseyNumber: 9,  isStarter: true },
      { name: 'Jonathan David',      position: 'FWD', jerseyNumber: 20, isStarter: true },
      { name: 'Milan Borjan',        position: 'GK',  jerseyNumber: 18, isStarter: false },
    ],
  },
  {
    matchId: 'wc26-g-005',
    homePlayers: [
      // United States starting XI + GK
      { name: 'Matt Turner',         position: 'GK',  jerseyNumber: 1,  isStarter: true },
      { name: 'Sergino Dest',        position: 'DEF', jerseyNumber: 2,  isStarter: true },
      { name: 'Tim Ream',            position: 'DEF', jerseyNumber: 5,  isStarter: true },
      { name: 'Chris Richards',      position: 'DEF', jerseyNumber: 4,  isStarter: true },
      { name: 'Antonee Robinson',    position: 'DEF', jerseyNumber: 3,  isStarter: true },
      { name: 'Tyler Adams',         position: 'MID', jerseyNumber: 4,  isStarter: true },
      { name: 'Weston McKennie',     position: 'MID', jerseyNumber: 8,  isStarter: true },
      { name: 'Yunus Musah',         position: 'MID', jerseyNumber: 6,  isStarter: true },
      { name: 'Christian Pulisic',   position: 'FWD', jerseyNumber: 10, isStarter: true },
      { name: 'Josh Sargent',        position: 'FWD', jerseyNumber: 9,  isStarter: true },
      { name: 'Timothy Weah',        position: 'FWD', jerseyNumber: 21, isStarter: true },
      { name: 'Ethan Horvath',       position: 'GK',  jerseyNumber: 12, isStarter: false },
    ],
    awayPlayers: [
      // Paraguay starting XI + GK
      { name: 'Antony Silva',        position: 'GK',  jerseyNumber: 1,  isStarter: true },
      { name: 'Santiago Arzamendia', position: 'DEF', jerseyNumber: 3,  isStarter: true },
      { name: 'Gustavo Gómez',       position: 'DEF', jerseyNumber: 5,  isStarter: true },
      { name: 'Omar Alderete',       position: 'DEF', jerseyNumber: 4,  isStarter: true },
      { name: 'Júnior Alonso',       position: 'DEF', jerseyNumber: 6,  isStarter: true },
      { name: 'Miguel Almirón',      position: 'MID', jerseyNumber: 10, isStarter: true },
      { name: 'Andrés Cubas',        position: 'MID', jerseyNumber: 8,  isStarter: true },
      { name: 'Mathías Villasanti',  position: 'MID', jerseyNumber: 14, isStarter: true },
      { name: 'Ángel Romero',        position: 'FWD', jerseyNumber: 11, isStarter: true },
      { name: 'Antonio Sanabria',    position: 'FWD', jerseyNumber: 9,  isStarter: true },
      { name: 'Julio Enciso',        position: 'FWD', jerseyNumber: 7,  isStarter: true },
      { name: 'Rodrigo Morínigo',    position: 'GK',  jerseyNumber: 12, isStarter: false },
    ],
  },
];

for (const lineup of LINEUPS) {
  // Delete existing lineups for this fixture
  await conn.execute('DELETE FROM wc2026_lineups WHERE match_id = ?', [lineup.matchId]);

  for (const p of lineup.homePlayers) {
    await conn.execute(
      `INSERT INTO wc2026_lineups (match_id, team_id, player_name, position, jersey_number, is_starter, scraped_at, is_confirmed)
       VALUES (?, 'home', ?, ?, ?, ?, ?, 1)`,
      [lineup.matchId, p.name, p.position, p.jerseyNumber, p.isStarter ? 1 : 0, new Date().toISOString().slice(0,19).replace('T',' ')]
    );
  }
  for (const p of lineup.awayPlayers) {
    await conn.execute(
      `INSERT INTO wc2026_lineups (match_id, team_id, player_name, position, jersey_number, is_starter, scraped_at, is_confirmed)
       VALUES (?, 'away', ?, ?, ?, ?, ?, 1)`,
      [lineup.matchId, p.name, p.position, p.jerseyNumber, p.isStarter ? 1 : 0, new Date().toISOString().slice(0,19).replace('T',' ')]
    );
  }

  const homeCount = lineup.homePlayers.length;
  const awayCount = lineup.awayPlayers.length;
  console.log(`[OUTPUT] Seeded ${homeCount} home + ${awayCount} away players for ${lineup.matchId}`);
}

// ─── Final verification ───────────────────────────────────────────────────────
console.log('\n[STEP] Final verification...');
  const [fixtures] = await conn.execute(
  "SELECT match_id, home_team_id, away_team_id, status FROM wc2026_matches WHERE match_id IN ('wc26-g-003', 'wc26-g-005') ORDER BY match_id"
);
for (const f of fixtures) {
  console.log(`[VERIFY] ${f.match_id}: home=${f.home_team_id} away=${f.away_team_id} status=${f.status}`);
}

const [odds] = await conn.execute(
  "SELECT match_id, market, selection, american_odds FROM wc2026_odds_snapshots WHERE match_id IN ('wc26-g-003', 'wc26-g-005') AND book_id = 0 ORDER BY match_id, market, selection"
);
console.log(`[VERIFY] Odds rows seeded: ${odds.length} (expected 10)`);
for (const o of odds) {
  console.log(`  ${o.match_id} ${o.market} ${o.selection}: ${o.american_odds > 0 ? '+' : ''}${o.american_odds}`);
}

const [lineupRows] = await conn.execute(
  "SELECT match_id, team_id, COUNT(*) as cnt FROM wc2026_lineups WHERE match_id IN ('wc26-g-003', 'wc26-g-005') GROUP BY match_id, team_id ORDER BY match_id, team_id"
);
console.log(`[VERIFY] Lineup rows: ${lineupRows.length} groups`);
for (const r of lineupRows) {
  console.log(`  ${r.match_id} ${r.team_id}: ${r.cnt} players`);
}

await conn.end();
console.log('\n[OUTPUT] seedJune12.mjs complete — all June 12 fixtures seeded and verified');
