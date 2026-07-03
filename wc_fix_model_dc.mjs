/**
 * wc_fix_model_dc.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Recomputes model DOUBLE_CHANCE odds for all June 19 fixtures using
 * correct no-vig fair probabilities derived from model 1X2 odds.
 * Also validates 3-way probability sums for model 1X2 rows.
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

(async () => {
  const conn = await createConnection(process.env.DATABASE_URL);

  // Get all model (book_id=0) 1X2 rows for June 19
  const [model1X2] = await conn.query(`
    SELECT o.match_id, o.selection, o.american_odds, o.implied_prob,
      ht.name AS home_name, at.name AS away_name
    FROM wc2026_odds_snapshots o
    JOIN wc2026_fixtures f ON f.match_id = o.match_id
    JOIN wc2026_teams ht ON ht.team_id = f.home_team_id
    JOIN wc2026_teams at ON at.team_id = f.away_team_id
    WHERE f.match_date = '2026-06-19'
      AND o.book_id = 0
      AND o.market = '1X2'
    ORDER BY o.match_id, o.selection
  `);

  // Group by fixture
  const byFixture = {};
  for (const row of model1X2) {
    if (!byFixture[row.match_id]) byFixture[row.match_id] = { home: null, draw: null, away: null, homeName: row.home_name, awayName: row.away_name };
    byFixture[row.match_id][row.selection] = row;
  }

  console.log('[INPUT] Model 1X2 odds for June 19 fixtures:');
  let totalErrors = 0;

  for (const [fid, data] of Object.entries(byFixture)) {
    const { home, draw, away } = data;
    if (!home || !draw || !away) {
      console.error(`[VERIFY] FAIL — ${fid}: Missing 1X2 rows (home=${!!home} draw=${!!draw} away=${!!away})`);
      totalErrors++;
      continue;
    }

    const rawH = parseFloat(home.implied_prob);
    const rawD = parseFloat(draw.implied_prob);
    const rawA = parseFloat(away.implied_prob);
    const rawSum = rawH + rawD + rawA;

    console.log(`\n[STATE] ${fid}: ${data.homeName} vs ${data.awayName}`);
    console.log(`  Model 1X2: home=${home.american_odds} draw=${draw.american_odds} away=${away.american_odds}`);
    console.log(`  Raw implied: H=${(rawH*100).toFixed(3)}% D=${(rawD*100).toFixed(3)}% A=${(rawA*100).toFixed(3)}% sum=${(rawSum*100).toFixed(3)}%`);

    // Validate 3-way sum (should be ~1.000 for model, no vig)
    const sumError = Math.abs(rawSum - 1.0);
    if (sumError > 0.005) {
      console.log(`  [VERIFY] WARN — 3-way sum=${rawSum.toFixed(4)} (error=${(sumError*100).toFixed(3)}pp) — normalizing`);
    } else {
      console.log(`  [VERIFY] PASS — 3-way sum=${rawSum.toFixed(4)} (error=${(sumError*100).toFixed(3)}pp)`);
    }

    // Compute fair probs (normalize to remove any residual vig)
    const fairH = rawH / rawSum;
    const fairD = rawD / rawSum;
    const fairA = rawA / rawSum;

    // Double Chance
    const dc1X = fairH + fairD;   // home_draw = 1X = home wins OR draw
    const dcX2 = fairA + fairD;   // away_draw = X2 = away wins OR draw

    const dc1XOdds = impliedToAmerican(dc1X);
    const dcX2Odds = impliedToAmerican(dcX2);

    console.log(`  Fair probs: H=${(fairH*100).toFixed(3)}% D=${(fairD*100).toFixed(3)}% A=${(fairA*100).toFixed(3)}%`);
    console.log(`  DC: 1X(home_draw)=${dc1XOdds} (${(dc1X*100).toFixed(3)}%) | X2(away_draw)=${dcX2Odds} (${(dcX2*100).toFixed(3)}%)`);

    // Delete existing model DC rows for this fixture
    const [delResult] = await conn.query(
      `DELETE FROM wc2026_odds_snapshots WHERE match_id = ? AND book_id = 0 AND market = 'DOUBLE_CHANCE'`,
      [fid]
    );
    console.log(`  [STEP] Deleted ${delResult.affectedRows} old model DC rows`);

    // Insert corrected DC rows
    const snapshotTs = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await conn.query(
      `INSERT INTO wc2026_odds_snapshots (match_id, book_id, market, selection, line, american_odds, implied_prob, snapshot_ts, is_closing)
       VALUES (?, 0, 'DOUBLE_CHANCE', 'home_draw', NULL, ?, ?, ?, 0)`,
      [fid, dc1XOdds, dc1X.toFixed(6), snapshotTs]
    );
    await conn.query(
      `INSERT INTO wc2026_odds_snapshots (match_id, book_id, market, selection, line, american_odds, implied_prob, snapshot_ts, is_closing)
       VALUES (?, 0, 'DOUBLE_CHANCE', 'away_draw', NULL, ?, ?, ?, 0)`,
      [fid, dcX2Odds, dcX2.toFixed(6), snapshotTs]
    );
    console.log(`  [OUTPUT] Inserted: home_draw=${dc1XOdds} away_draw=${dcX2Odds}`);
  }

  // Final verification
  const [finalDC] = await conn.query(`
    SELECT o.match_id, o.book_id, o.selection, o.american_odds, o.implied_prob,
      ht.name AS home_name, at.name AS away_name
    FROM wc2026_odds_snapshots o
    JOIN wc2026_fixtures f ON f.match_id = o.match_id
    JOIN wc2026_teams ht ON ht.team_id = f.home_team_id
    JOIN wc2026_teams at ON at.team_id = f.away_team_id
    WHERE f.match_date = '2026-06-19'
      AND o.market = 'DOUBLE_CHANCE'
    ORDER BY o.match_id, o.book_id, o.selection
  `);

  console.log('\n[VERIFY] Final DOUBLE_CHANCE odds in DB for June 19:');
  for (const r of finalDC) {
    const bookLabel = r.book_id === 68 ? 'DK   ' : (r.book_id === 0 ? 'MODEL' : `b${r.book_id}`);
    console.log(`  [${r.match_id}] ${r.home_name} vs ${r.away_name} | [${bookLabel}] ${r.selection} => ${r.american_odds} (${(parseFloat(r.implied_prob)*100).toFixed(2)}%)`);
  }

  await conn.end();
  console.log(`\n[VERIFY] ${totalErrors === 0 ? 'PASS' : 'FAIL'} — Model DC recomputation complete (errors=${totalErrors})`);
})();
