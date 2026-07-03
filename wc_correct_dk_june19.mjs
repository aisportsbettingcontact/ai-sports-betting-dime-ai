/**
 * wc_correct_dk_june19.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Corrects DK odds for all 4 June 19 WC2026 matchs using exact values
 * from the DraftKings screenshot (authoritative source).
 *
 * DK Screenshot (June 19, 2026):
 *   USA vs Australia:    USA(home)=-165  Draw=+330  AUS(away)=+425
 *   Scotland vs Morocco: SCO(home)=+425  Draw=+260  MAR(away)=-135
 *   Brazil vs Haiti:     BRA(home)=-900  Draw=+1000 HAI(away)=+2200
 *     → DB has HAI as home_team_id, BRA as away_team_id for wc26-g-032
 *     → DK has Brazil listed as "home" (top), Haiti as "away" (bottom)
 *     → Must map: DB home(HAI)=+2200, DB away(BRA)=-900
 *   Turkey vs Paraguay:  TUR(home)=+105  Draw=+245  PAR(away)=+285
 *
 * Logging:
 *   [INPUT]  → source + values
 *   [STEP]   → operation
 *   [STATE]  → intermediate computation
 *   [OUTPUT] → DB change
 *   [VERIFY] → PASS/FAIL + reason
 */
import { createConnection } from 'mysql2/promise';
import { config } from 'dotenv';
config();

function americanToImplied(odds) {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function impliedToAmerican(p) {
  if (p <= 0 || p >= 1) throw new Error(`Invalid prob: ${p}`);
  if (p >= 0.5) return Math.round(-(p / (1 - p)) * 100);
  return Math.round(((1 - p) / p) * 100);
}

function threeWayFairProbs(homeOdds, drawOdds, awayOdds) {
  const rawH = americanToImplied(homeOdds);
  const rawD = americanToImplied(drawOdds);
  const rawA = americanToImplied(awayOdds);
  const rawSum = rawH + rawD + rawA;
  return {
    fairH: rawH / rawSum,
    fairD: rawD / rawSum,
    fairA: rawA / rawSum,
    vig: ((rawSum - 1) * 100).toFixed(3),
  };
}

// ── Authoritative DK lines from screenshot ────────────────────────────────────
// home/draw/away are relative to OUR DB match orientation (home_team_id / away_team_id)
const DK_LINES = [
  {
    matchId: 'wc26-g-029',
    desc: 'USA(home) vs Australia(away)',
    // DK: USA=home=-165, Draw=+330, AUS=away=+425
    // DB: home=usa, away=aus → direct match
    home: -165, draw: 330, away: 425,
    totalLine: 2.5, over: -115, under: -110,
    spreadHome: -0.5, spreadHomeOdds: -175,
    spreadAway: 0.5, spreadAwayOdds: 135,
  },
  {
    matchId: 'wc26-g-031',
    desc: 'Scotland(home) vs Morocco(away)',
    // DK: SCO=home=+425, Draw=+260, MAR=away=-135
    // DB: home=sco, away=mar → direct match
    home: 425, draw: 260, away: -135,
    totalLine: 2.5, over: 130, under: -160,
    spreadHome: 0.5, spreadHomeOdds: 110,
    spreadAway: -0.5, spreadAwayOdds: -140,
  },
  {
    matchId: 'wc26-g-032',
    desc: 'Haiti(DB home) vs Brazil(DB away) — DK has Brazil as home',
    // DK screenshot: Brazil(top/home)=-900, Draw=+1000, Haiti(bottom/away)=+2200
    // DB orientation: home_team_id=hai, away_team_id=bra
    // Therefore: DB home(HAI) gets DK "away" odds = +2200
    //            DB away(BRA) gets DK "home" odds = -900
    home: 2200, draw: 1000, away: -900,
    totalLine: 3.5, over: -125, under: 100,
    spreadHome: 2.5, spreadHomeOdds: -105,   // HAI +2.5
    spreadAway: -2.5, spreadAwayOdds: -125,  // BRA -2.5
  },
  {
    matchId: 'wc26-g-030',
    desc: 'Turkey(home) vs Paraguay(away)',
    // DK screenshot: TUR=home=+105, Draw=+245, PAR=away=+285
    // DB: home=tur, away=par → direct match
    home: 105, draw: 245, away: 285,
    totalLine: 2.5, over: 105, under: -130,
    spreadHome: null, spreadHomeOdds: null,
    spreadAway: null, spreadAwayOdds: null,
  },
];

(async () => {
  const conn = await createConnection(process.env.DATABASE_URL);
  const snapshotTs = new Date().toISOString().slice(0, 19).replace('T', ' ');

  console.log('[INPUT] Applying authoritative DK odds from DraftKings screenshot');
  console.log('[INPUT] Source: DraftKings WC2026 June 19 odds page (user-provided screenshot)');

  let totalInserted = 0;
  let totalErrors = 0;

  for (const fix of DK_LINES) {
    console.log(`\n[STEP] Processing ${fix.matchId}: ${fix.desc}`);

    // Validate 3-way sum
    const { fairH, fairD, fairA, vig } = threeWayFairProbs(fix.home, fix.draw, fix.away);
    console.log(`[STATE] DK 1X2: home=${fix.home} draw=${fix.draw} away=${fix.away}`);
    console.log(`[STATE] Fair probs: H=${(fairH*100).toFixed(3)}% D=${(fairD*100).toFixed(3)}% A=${(fairA*100).toFixed(3)}% vig=${vig}%`);

    // Compute DK Double Chance from no-vig fair probs
    const dc1X = fairH + fairD;   // home_draw = 1X
    const dcX2 = fairA + fairD;   // away_draw = X2
    const dc1XOdds = impliedToAmerican(dc1X);
    const dcX2Odds = impliedToAmerican(dcX2);
    console.log(`[STATE] DC: 1X(home_draw)=${dc1XOdds} (${(dc1X*100).toFixed(3)}%) | X2(away_draw)=${dcX2Odds} (${(dcX2*100).toFixed(3)}%)`);

    // Delete all existing DK rows for this match
    const [delResult] = await conn.query(
      `DELETE FROM wc2026_odds_snapshots WHERE match_id = ? AND book_id = 68`,
      [fix.matchId]
    );
    console.log(`[STEP] Deleted ${delResult.affectedRows} existing DK rows for ${fix.matchId}`);

    // Build insert rows
    const rows = [
      // 1X2
      { market: '1X2', selection: 'home', line: null, odds: fix.home, prob: americanToImplied(fix.home) },
      { market: '1X2', selection: 'draw', line: null, odds: fix.draw, prob: americanToImplied(fix.draw) },
      { market: '1X2', selection: 'away', line: null, odds: fix.away, prob: americanToImplied(fix.away) },
      // Double Chance (computed from no-vig)
      { market: 'DOUBLE_CHANCE', selection: 'home_draw', line: null, odds: dc1XOdds, prob: dc1X },
      { market: 'DOUBLE_CHANCE', selection: 'away_draw', line: null, odds: dcX2Odds, prob: dcX2 },
      // Total
      { market: 'TOTAL', selection: 'over', line: fix.totalLine, odds: fix.over, prob: americanToImplied(fix.over) },
      { market: 'TOTAL', selection: 'under', line: fix.totalLine, odds: fix.under, prob: americanToImplied(fix.under) },
    ];

    // Asian Handicap (if available)
    if (fix.spreadHome !== null) {
      const selH = `home${fix.spreadHome >= 0 ? '+' : ''}${fix.spreadHome}`;
      const selA = `away${fix.spreadAway >= 0 ? '+' : ''}${fix.spreadAway}`;
      rows.push({ market: 'ASIAN_HANDICAP', selection: selH, line: fix.spreadHome, odds: fix.spreadHomeOdds, prob: americanToImplied(fix.spreadHomeOdds) });
      rows.push({ market: 'ASIAN_HANDICAP', selection: selA, line: fix.spreadAway, odds: fix.spreadAwayOdds, prob: americanToImplied(fix.spreadAwayOdds) });
    }

    // Insert all rows
    for (const r of rows) {
      try {
        await conn.query(
          `INSERT INTO wc2026_odds_snapshots (match_id, book_id, market, selection, line, american_odds, implied_prob, snapshot_ts, is_closing)
           VALUES (?, 68, ?, ?, ?, ?, ?, ?, 1)`,
          [fix.matchId, r.market, r.selection, r.line, r.odds, r.prob.toFixed(6), snapshotTs]
        );
        console.log(`[OUTPUT] ${fix.matchId} | DK | ${r.market} | ${r.selection} | line=${r.line ?? 'null'} | odds=${r.odds}`);
        totalInserted++;
      } catch (err) {
        console.error(`[VERIFY] FAIL — Insert error for ${fix.matchId} ${r.market} ${r.selection}: ${err.message}`);
        totalErrors++;
      }
    }
  }

  // ── Final verification ────────────────────────────────────────────────────────
  const [finalRows] = await conn.query(`
    SELECT o.match_id, o.market, o.selection, o.line, o.american_odds, o.implied_prob,
      ht.name AS home_name, at.name AS away_name
    FROM wc2026_odds_snapshots o
    JOIN wc2026_matches f ON f.match_id = o.match_id
    JOIN wc2026_teams ht ON ht.team_id = f.home_team_id
    JOIN wc2026_teams at ON at.team_id = f.away_team_id
    WHERE f.match_date = '2026-06-19' AND o.book_id = 68
    ORDER BY o.match_id, o.market, o.selection
  `);

  console.log('\n[VERIFY] Final DK odds in DB for June 19:');
  for (const r of finalRows) {
    const lineStr = r.line ? ` line=${r.line}` : '';
    const implStr = ` (${(parseFloat(r.implied_prob)*100).toFixed(2)}%)`;
    console.log(`  [${r.match_id}] ${r.home_name} vs ${r.away_name} | ${r.market.padEnd(15)} ${r.selection.padEnd(15)}${lineStr} => ${String(r.american_odds).padStart(6)}${implStr}`);
  }

  // Cross-check Haiti vs Brazil specifically
  const haiBraRows = finalRows.filter(r => r.match_id === 'wc26-g-032' && r.market === '1X2');
  const haiRow = haiBraRows.find(r => r.selection === 'home');
  const braRow = haiBraRows.find(r => r.selection === 'away');
  console.log('\n[VERIFY] Haiti vs Brazil cross-check:');
  console.log(`  DB home(Haiti) odds = ${haiRow?.american_odds} — expected +2200 — ${haiRow?.american_odds === 2200 ? 'PASS ✓' : 'FAIL ✗'}`);
  console.log(`  DB away(Brazil) odds = ${braRow?.american_odds} — expected -900 — ${braRow?.american_odds === -900 ? 'PASS ✓' : 'FAIL ✗'}`);

  await conn.end();
  console.log(`\n[VERIFY] ${totalErrors === 0 ? 'PASS' : 'FAIL'} — Total inserted=${totalInserted} errors=${totalErrors}`);
})();
