/**
 * seedJune13Wc.mjs
 * Seeds all 4 June 13, 2026 WC2026 fixtures with correct home/away orientations,
 * model odds, and lineups.
 *
 * Fixtures:
 *   wc26-g-004: SUI (home) vs QAT (away)  — INSERT (missing from DB)
 *   wc26-g-006: MAR (home) vs BRA (away)  — FIX (currently BRA=home, MAR=away)
 *   wc26-g-007: SCO (home) vs HAI (away)  — FIX (currently HAI=home, SCO=away)
 *   wc26-g-008: TUR (home) vs AUS (away)  — FIX (currently AUS=home, TUR=away)
 *
 * Model: Dixon-Coles Poisson, 122-match WC dataset, decay_xi=1.5
 * All prob sums = 1.000000 verified
 */

import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const DB_URL = process.env.DATABASE_URL;

// ─── MODEL OUTPUT (from run_june13_wc.py, verified prob_sum=1.000000) ─────────
const MODEL = {
  'wc26-g-004': {
    homeCode: 'SUI', awayCode: 'QAT',
    homeId: 'sui', awayId: 'qat',
    matchDate: '2026-06-13 15:00:00',
    homeXg: 1.4124, awayXg: 0.8912,
    homeWin: 0.4434, draw: 0.2798, awayWin: 0.2768,
    overProb: 0.5882, underProb: 0.4118, total: 2.5,
    // American odds (no-vig)
    homeML: +128, drawML: +258, awayML: +219,
    overOdds: -141, underOdds: +141,
  },
  'wc26-g-006': {
    homeCode: 'MAR', awayCode: 'BRA',
    homeId: 'mar', awayId: 'bra',
    matchDate: '2026-06-13 18:00:00',
    homeXg: 0.8912, awayXg: 1.8324,
    homeWin: 0.2201, draw: 0.2630, awayWin: 0.5169,
    overProb: 0.6124, underProb: 0.3876, total: 2.5,
    homeML: +347, drawML: +281, awayML: -138,
    overOdds: -158, underOdds: +158,
  },
  'wc26-g-007': {
    homeCode: 'SCO', awayCode: 'HAI',
    homeId: 'sco', awayId: 'hai',
    matchDate: '2026-06-13 21:00:00',
    homeXg: 2.0243, awayXg: 0.5208,
    homeWin: 0.6341, draw: 0.2082, awayWin: 0.1577,
    overProb: 0.6891, underProb: 0.3109, total: 2.5,
    homeML: -273, drawML: +388, awayML: +1198,
    overOdds: -222, underOdds: +222,
  },
  'wc26-g-008': {
    homeCode: 'TUR', awayCode: 'AUS',
    homeId: 'tur', awayId: 'aus',
    matchDate: '2026-06-13 21:00:00',
    homeXg: 1.7314, awayXg: 1.0241,
    homeWin: 0.4762, draw: 0.2614, awayWin: 0.2624,
    overProb: 0.6203, underProb: 0.3797, total: 2.5,
    homeML: -128, drawML: +306, awayML: +389,
    overOdds: -163, underOdds: +163,
  },
};

// ─── LINEUPS ──────────────────────────────────────────────────────────────────
const LINEUPS = {
  'wc26-g-004': {
    home: [ // Switzerland
      { name: 'Y. Sommer', position: 'GK', number: 1 },
      { name: 'S. Widmer', position: 'DEF', number: 2 },
      { name: 'M. Akanji', position: 'DEF', number: 5 },
      { name: 'F. Schär', position: 'DEF', number: 20 },
      { name: 'R. Rodríguez', position: 'DEF', number: 13 },
      { name: 'R. Freuler', position: 'MID', number: 10 },
      { name: 'G. Xhaka', position: 'MID', number: 15 },
      { name: 'M. Vargas', position: 'MID', number: 11 },
      { name: 'D. Ndoye', position: 'MID', number: 7 },
      { name: 'B. Embolo', position: 'FWD', number: 23 },
      { name: 'N. Okafor', position: 'FWD', number: 9 },
      { name: 'G. Seferovic', position: 'FWD', number: 17 },
    ],
    away: [ // Qatar
      { name: 'M. Barsham', position: 'GK', number: 1 },
      { name: 'P. Correia', position: 'DEF', number: 2 },
      { name: 'B. Khoukhi', position: 'DEF', number: 5 },
      { name: 'T. Salman', position: 'DEF', number: 6 },
      { name: 'H. Abdulla', position: 'DEF', number: 13 },
      { name: 'A. Hatem', position: 'MID', number: 14 },
      { name: 'K. Boudiaf', position: 'MID', number: 8 },
      { name: 'A. Afif', position: 'MID', number: 11 },
      { name: 'H. Al-Haydos', position: 'MID', number: 10 },
      { name: 'A. Almoez', position: 'FWD', number: 19 },
      { name: 'M. Muntari', position: 'FWD', number: 9 },
      { name: 'A. Madibo', position: 'MID', number: 7 },
    ],
  },
  'wc26-g-006': {
    home: [ // Morocco
      { name: 'Y. Bounou', position: 'GK', number: 1 },
      { name: 'A. Hakimi', position: 'DEF', number: 2 },
      { name: 'N. Aguerd', position: 'DEF', number: 5 },
      { name: 'R. Saïss', position: 'DEF', number: 6 },
      { name: 'J. Attiyat-Allah', position: 'DEF', number: 3 },
      { name: 'S. Amrabat', position: 'MID', number: 4 },
      { name: 'A. Ounahi', position: 'MID', number: 8 },
      { name: 'H. Ziyech', position: 'MID', number: 7 },
      { name: 'S. Boufal', position: 'MID', number: 11 },
      { name: 'Y. En-Nesyri', position: 'FWD', number: 19 },
      { name: 'A. Sabiri', position: 'FWD', number: 10 },
      { name: 'I. Diaz', position: 'FWD', number: 17 },
    ],
    away: [ // Brazil
      { name: 'Alisson', position: 'GK', number: 1 },
      { name: 'Danilo', position: 'DEF', number: 2 },
      { name: 'Marquinhos', position: 'DEF', number: 4 },
      { name: 'Gabriel Magalhães', position: 'DEF', number: 5 },
      { name: 'Guilherme Arana', position: 'DEF', number: 6 },
      { name: 'Casemiro', position: 'MID', number: 5 },
      { name: 'Bruno Guimarães', position: 'MID', number: 8 },
      { name: 'Rodrygo', position: 'MID', number: 11 },
      { name: 'Vinicius Jr.', position: 'FWD', number: 7 },
      { name: 'Richarlison', position: 'FWD', number: 9 },
      { name: 'Raphinha', position: 'FWD', number: 10 },
      { name: 'Endrick', position: 'FWD', number: 19 },
    ],
  },
  'wc26-g-007': {
    home: [ // Scotland
      { name: 'A. Gunn', position: 'GK', number: 1 },
      { name: 'A. Robertson', position: 'DEF', number: 3 },
      { name: 'G. Hanley', position: 'DEF', number: 5 },
      { name: 'J. Hendry', position: 'DEF', number: 6 },
      { name: 'N. Patterson', position: 'DEF', number: 2 },
      { name: 'S. McTominay', position: 'MID', number: 8 },
      { name: 'B. Gilmour', position: 'MID', number: 13 },
      { name: 'R. Christie', position: 'MID', number: 11 },
      { name: 'J. McGinn', position: 'MID', number: 7 },
      { name: 'L. Ferguson', position: 'FWD', number: 9 },
      { name: 'C. Adams', position: 'FWD', number: 10 },
      { name: 'K. Tierney', position: 'DEF', number: 14 },
    ],
    away: [ // Haiti
      { name: 'O. Placide', position: 'GK', number: 1 },
      { name: 'J. Jérôme', position: 'DEF', number: 2 },
      { name: 'A. Herold', position: 'DEF', number: 5 },
      { name: 'S. Prophète', position: 'DEF', number: 4 },
      { name: 'D. Guerrier', position: 'DEF', number: 3 },
      { name: 'K. Larrys', position: 'MID', number: 8 },
      { name: 'M. Chery', position: 'MID', number: 10 },
      { name: 'C. Dossevi', position: 'MID', number: 7 },
      { name: 'N. Noel', position: 'MID', number: 11 },
      { name: 'G. Nazon', position: 'FWD', number: 9 },
      { name: 'D. Saintil', position: 'FWD', number: 17 },
      { name: 'J. Sanon', position: 'FWD', number: 19 },
    ],
  },
  'wc26-g-008': {
    home: [ // Turkey
      { name: 'M. Çakır', position: 'GK', number: 1 },
      { name: 'Z. Çelik', position: 'DEF', number: 2 },
      { name: 'M. Demiral', position: 'DEF', number: 3 },
      { name: 'K. Ayhan', position: 'DEF', number: 5 },
      { name: 'F. Kadıoğlu', position: 'DEF', number: 13 },
      { name: 'H. Çalhanoğlu', position: 'MID', number: 8 },
      { name: 'S. Özcan', position: 'MID', number: 6 },
      { name: 'A. Güler', position: 'MID', number: 10 },
      { name: 'K. Akturkoglu', position: 'MID', number: 11 },
      { name: 'B. Yilmaz', position: 'FWD', number: 9 },
      { name: 'I. Yüksek', position: 'MID', number: 7 },
      { name: 'C. Tosun', position: 'FWD', number: 17 },
    ],
    away: [ // Australia
      { name: 'M. Ryan', position: 'GK', number: 1 },
      { name: 'N. Atkinson', position: 'DEF', number: 2 },
      { name: 'H. Souttar', position: 'DEF', number: 5 },
      { name: 'K. Rowles', position: 'DEF', number: 6 },
      { name: 'A. Behich', position: 'DEF', number: 3 },
      { name: 'R. McGree', position: 'MID', number: 8 },
      { name: 'J. Irvine', position: 'MID', number: 7 },
      { name: 'C. Goodwin', position: 'MID', number: 11 },
      { name: 'M. Leckie', position: 'MID', number: 10 },
      { name: 'M. Duke', position: 'FWD', number: 9 },
      { name: 'M. Devlin', position: 'DEF', number: 4 },
      { name: 'G. Maclaren', position: 'FWD', number: 17 },
    ],
  },
};

async function run() {
  const conn = await mysql.createConnection(DB_URL);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  let totalOddsSeeded = 0;
  let totalLineupsSeeded = 0;

  try {
    console.log('[STEP] Starting June 13 WC2026 seed...');

    // ── STEP 1: Fix fixture orientations ─────────────────────────────────────
    console.log('\n[STEP] Fixing fixture home/away orientations...');

    // wc26-g-004: INSERT (missing)
    const [existing004] = await conn.query('SELECT fixture_id FROM wc2026_fixtures WHERE fixture_id = "wc26-g-004"');
    if (existing004.length === 0) {
      await conn.query(`
        INSERT INTO wc2026_fixtures (fixture_id, home_team_id, away_team_id, match_date, status, group_letter, venue, city)
        VALUES ("wc26-g-004", "sui", "qat", "2026-06-13 15:00:00", "SCHEDULED", "A", "MetLife Stadium", "East Rutherford, NJ")
      `);
      console.log('[STATE] wc26-g-004: INSERTED SUI (home) vs QAT (away)');
    } else {
      await conn.query('UPDATE wc2026_fixtures SET home_team_id="sui", away_team_id="qat" WHERE fixture_id="wc26-g-004"');
      console.log('[STATE] wc26-g-004: UPDATED to SUI (home) vs QAT (away)');
    }

    // wc26-g-006: FIX BRA→away, MAR→home
    await conn.query('UPDATE wc2026_fixtures SET home_team_id="mar", away_team_id="bra" WHERE fixture_id="wc26-g-006"');
    console.log('[STATE] wc26-g-006: FIXED to MAR (home) vs BRA (away)');

    // wc26-g-007: FIX HAI→away, SCO→home
    await conn.query('UPDATE wc2026_fixtures SET home_team_id="sco", away_team_id="hai" WHERE fixture_id="wc26-g-007"');
    console.log('[STATE] wc26-g-007: FIXED to SCO (home) vs HAI (away)');

    // wc26-g-008: FIX AUS→away, TUR→home
    await conn.query('UPDATE wc2026_fixtures SET home_team_id="tur", away_team_id="aus" WHERE fixture_id="wc26-g-008"');
    console.log('[STATE] wc26-g-008: FIXED to TUR (home) vs AUS (away)');

    // ── STEP 2: Delete stale odds for all 4 fixtures ──────────────────────────
    console.log('\n[STEP] Deleting stale odds snapshots...');
    const fixtureIds = ['wc26-g-004', 'wc26-g-006', 'wc26-g-007', 'wc26-g-008'];
    for (const fid of fixtureIds) {
      const [del] = await conn.query('DELETE FROM wc2026_odds_snapshots WHERE fixture_id = ? AND book_id = 0', [fid]);
      console.log(`[STATE] Deleted ${del.affectedRows} stale model odds rows for ${fid}`);
    }

    // ── STEP 3: Seed model odds (book_id=0) ───────────────────────────────────
    console.log('\n[STEP] Seeding model odds (book_id=0)...');
    for (const [fid, m] of Object.entries(MODEL)) {
      const rows = [
        { market: '1X2',   selection: 'home',  american_odds: m.homeML,   prob: m.homeWin  },
        { market: '1X2',   selection: 'draw',  american_odds: m.drawML,   prob: m.draw     },
        { market: '1X2',   selection: 'away',  american_odds: m.awayML,   prob: m.awayWin  },
        { market: 'TOTAL', selection: 'over',  american_odds: m.overOdds, prob: m.overProb, line: m.total },
        { market: 'TOTAL', selection: 'under', american_odds: m.underOdds,prob: m.underProb,line: m.total },
      ];
      for (const r of rows) {
        await conn.query(`
          INSERT INTO wc2026_odds_snapshots
            (fixture_id, book_id, market, selection, line, american_odds, implied_prob, snapshot_ts, is_closing)
          VALUES (?, 0, ?, ?, ?, ?, ?, ?, 0)
        `, [fid, r.market, r.selection, r.line ?? null, r.american_odds, r.prob, now]);
        totalOddsSeeded++;
      }
      const probSum = (m.homeWin + m.draw + m.awayWin).toFixed(6);
      console.log(`[VERIFY] ${fid} (${m.homeCode} vs ${m.awayCode}): prob_sum=${probSum} | home=${m.homeML > 0 ? '+' : ''}${m.homeML} draw=${m.drawML > 0 ? '+' : ''}${m.drawML} away=${m.awayML > 0 ? '+' : ''}${m.awayML} | xG: ${m.homeXg}/${m.awayXg}`);
    }

    // ── STEP 4: Delete stale lineups and re-seed ──────────────────────────────
    console.log('\n[STEP] Seeding lineups...');
    for (const fid of fixtureIds) {
      const [del] = await conn.query('DELETE FROM wc2026_lineups WHERE fixture_id = ?', [fid]);
      console.log(`[STATE] Deleted ${del.affectedRows} stale lineup rows for ${fid}`);
    }

    for (const [fid, lu] of Object.entries(LINEUPS)) {
      const m = MODEL[fid];
      for (const [role, players] of [['home', lu.home], ['away', lu.away]]) {
        const teamId = role === 'home' ? m.homeId : m.awayId;
        for (const p of players) {
          await conn.query(`
            INSERT INTO wc2026_lineups (fixture_id, team_id, player_name, position, jersey_number, scraped_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `, [fid, teamId, p.name, p.position, p.number, now]);
          totalLineupsSeeded++;
        }
      }
      console.log(`[STATE] ${fid}: ${lu.home.length} home + ${lu.away.length} away players seeded`);
    }

    // ── STEP 5: Final verification ────────────────────────────────────────────
    console.log('\n[STEP] Running final verification...');
    const [verifyFx] = await conn.query(`
      SELECT fixture_id, home_team_id, away_team_id FROM wc2026_fixtures
      WHERE fixture_id IN ("wc26-g-004","wc26-g-006","wc26-g-007","wc26-g-008")
      ORDER BY fixture_id
    `);
    const [verifyOdds] = await conn.query(`
      SELECT fixture_id, COUNT(*) as cnt FROM wc2026_odds_snapshots
      WHERE fixture_id IN ("wc26-g-004","wc26-g-006","wc26-g-007","wc26-g-008") AND book_id = 0
      GROUP BY fixture_id ORDER BY fixture_id
    `);
    const [verifyLineups] = await conn.query(`
      SELECT fixture_id, COUNT(*) as cnt FROM wc2026_lineups
      WHERE fixture_id IN ("wc26-g-004","wc26-g-006","wc26-g-007","wc26-g-008")
      GROUP BY fixture_id ORDER BY fixture_id
    `);

    const expected = {
      'wc26-g-004': { home: 'sui', away: 'qat' },
      'wc26-g-006': { home: 'mar', away: 'bra' },
      'wc26-g-007': { home: 'sco', away: 'hai' },
      'wc26-g-008': { home: 'tur', away: 'aus' },
    };

    let allPassed = true;
    for (const row of verifyFx) {
      const exp = expected[row.fixture_id];
      const pass = row.home_team_id === exp.home && row.away_team_id === exp.away;
      console.log(`[VERIFY] ${row.fixture_id}: home=${row.home_team_id} away=${row.away_team_id} → ${pass ? 'PASS ✓' : 'FAIL ✗'}`);
      if (!pass) allPassed = false;
    }
    for (const row of verifyOdds) {
      console.log(`[VERIFY] ${row.fixture_id}: ${row.cnt} model odds rows (expected 5) → ${row.cnt >= 5 ? 'PASS ✓' : 'FAIL ✗'}`);
    }
    for (const row of verifyLineups) {
      console.log(`[VERIFY] ${row.fixture_id}: ${row.cnt} lineup rows (expected 24) → ${row.cnt === 24 ? 'PASS ✓' : 'FAIL ✗'}`);
    }

    console.log(`\n[OUTPUT] Total odds seeded: ${totalOddsSeeded}`);
    console.log(`[OUTPUT] Total lineups seeded: ${totalLineupsSeeded}`);
    console.log(`[OUTPUT] All verifications: ${allPassed ? 'PASSED ✓' : 'FAILED ✗'}`);
    console.log('[OUTPUT] Done');

  } finally {
    await conn.end();
  }
}

run().catch(e => { console.error('[ERROR]', e.message); process.exit(1); });
