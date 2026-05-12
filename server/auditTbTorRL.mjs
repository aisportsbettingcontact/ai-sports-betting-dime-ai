/**
 * DEEP AUDIT: TB @ TOR Run Line Inversion
 * 
 * Problem: TB is +129 ML (underdog, ~43.7% win prob) but -151 on TB -1.5 RL (~60.2% cover prob)
 * This is a mathematical impossibility: P(win by 2+) > P(win)
 * 
 * This script pulls every raw value from the DB and traces every transformation
 * to pinpoint the exact root cause.
 */

import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log('='.repeat(80));
console.log('DEEP AUDIT: TB @ TOR RUN LINE INVERSION');
console.log('='.repeat(80));

// ─── STEP 1: Pull ALL columns from mlb_games for TB @ TOR ───────────────────
console.log('\n[STEP 1] Pulling ALL DB columns for TB @ TOR...');

const [games] = await conn.execute(`
  SELECT * FROM mlb_games 
  WHERE (homeTeam LIKE '%TOR%' OR homeTeam LIKE '%Toronto%')
  AND (awayTeam LIKE '%TB%' OR awayTeam LIKE '%Tampa%' OR awayTeam LIKE '%Ray%')
  AND gameDate >= '2026-05-11'
  ORDER BY gameDate DESC LIMIT 3
`);

if (games.length === 0) {
  // Try reverse
  const [games2] = await conn.execute(`
    SELECT * FROM mlb_games 
    WHERE (awayTeam LIKE '%TOR%' OR awayTeam LIKE '%Toronto%')
    AND (homeTeam LIKE '%TB%' OR homeTeam LIKE '%Tampa%' OR homeTeam LIKE '%Ray%')
    AND gameDate >= '2026-05-11'
    ORDER BY gameDate DESC LIMIT 3
  `);
  if (games2.length > 0) {
    console.log('[INPUT] Found TB @ TOR (TB=home, TOR=away):');
    analyzeGame(games2[0], true);
  } else {
    // Search by gameId
    const [allGames] = await conn.execute(`
      SELECT id, homeTeam, awayTeam, gameDate FROM mlb_games 
      WHERE gameDate >= '2026-05-11'
      ORDER BY gameDate
    `);
    console.log('[INPUT] All May 11+ games:');
    allGames.forEach(g => console.log(`  id=${g.id} ${g.awayTeam} @ ${g.homeTeam} on ${g.gameDate}`));
  }
} else {
  console.log('[INPUT] Found TB @ TOR (TOR=home, TB=away):');
  analyzeGame(games[0], false);
}

function analyzeGame(g, tbIsHome) {
  console.log('\n' + '─'.repeat(80));
  console.log('[INPUT] RAW DB VALUES (ALL COLUMNS):');
  console.log('─'.repeat(80));
  
  // Print every column
  for (const [key, val] of Object.entries(g)) {
    if (val !== null && val !== undefined) {
      console.log(`  ${key.padEnd(30)} = ${val}`);
    }
  }

  console.log('\n' + '─'.repeat(80));
  console.log('[STEP 2] IDENTIFYING HOME/AWAY ASSIGNMENT:');
  console.log('─'.repeat(80));
  console.log(`  homeTeam = ${g.homeTeam}`);
  console.log(`  awayTeam = ${g.awayTeam}`);
  console.log(`  TB is: ${tbIsHome ? 'HOME' : 'AWAY'}`);
  console.log(`  TOR is: ${tbIsHome ? 'AWAY' : 'HOME'}`);

  console.log('\n' + '─'.repeat(80));
  console.log('[STEP 3] ML PROBABILITY ANALYSIS:');
  console.log('─'.repeat(80));
  
  const homeML = parseFloat(g.homeModelMl) || null;
  const awayML = parseFloat(g.awayModelMl) || null;
  const homeBookML = parseFloat(g.homeBookMl) || null;
  const awayBookML = parseFloat(g.awayBookMl) || null;
  
  // Convert American odds to implied probability
  function americanToProb(odds) {
    if (!odds) return null;
    if (odds > 0) return 100 / (odds + 100);
    return Math.abs(odds) / (Math.abs(odds) + 100);
  }
  
  function probToAmerican(p) {
    if (p >= 0.5) return -(p / (1 - p) * 100).toFixed(2);
    return ((1 - p) / p * 100).toFixed(2);
  }
  
  const homeMLProb = americanToProb(homeML);
  const awayMLProb = americanToProb(awayML);
  
  console.log(`  homeModelMl = ${homeML} → P(home win) = ${homeMLProb ? (homeMLProb*100).toFixed(2)+'%' : 'NULL'}`);
  console.log(`  awayModelMl = ${awayML} → P(away win) = ${awayMLProb ? (awayMLProb*100).toFixed(2)+'%' : 'NULL'}`);
  console.log(`  homeBookMl  = ${homeBookML}`);
  console.log(`  awayBookMl  = ${awayBookML}`);
  
  if (homeMLProb && awayMLProb) {
    const sum = homeMLProb + awayMLProb;
    console.log(`  P(home) + P(away) = ${(sum*100).toFixed(4)}% (should be 100%)`);
    if (Math.abs(sum - 1.0) > 0.001) {
      console.log(`  [WARN] ML probabilities do NOT sum to 1.0 — vig or error present`);
    }
  }
  
  // Identify which team is TB
  const tbML = tbIsHome ? homeML : awayML;
  const torML = tbIsHome ? awayML : homeML;
  const tbMLProb = tbIsHome ? homeMLProb : awayMLProb;
  const torMLProb = tbIsHome ? awayMLProb : homeMLProb;
  
  console.log(`\n  TB model ML  = ${tbML} → P(TB win) = ${tbMLProb ? (tbMLProb*100).toFixed(2)+'%' : 'NULL'}`);
  console.log(`  TOR model ML = ${torML} → P(TOR win) = ${torMLProb ? (torMLProb*100).toFixed(2)+'%' : 'NULL'}`);

  console.log('\n' + '─'.repeat(80));
  console.log('[STEP 4] RUN LINE ANALYSIS:');
  console.log('─'.repeat(80));
  
  const homeSpread = parseFloat(g.homeModelSpread) || null;
  const awaySpread = parseFloat(g.awayModelSpread) || null;
  const homeBookSpread = parseFloat(g.homeBookSpread) || null;
  const awayBookSpread = parseFloat(g.awayBookSpread) || null;
  const homeRLCover = parseFloat(g.modelHomePLCoverPct) || null;
  const awayRLCover = parseFloat(g.modelAwayPLCoverPct) || null;
  
  console.log(`  homeModelSpread    = ${homeSpread} (model RL odds for HOME team)`);
  console.log(`  awayModelSpread    = ${awaySpread} (model RL odds for AWAY team)`);
  console.log(`  homeBookSpread     = ${homeBookSpread} (book RL odds for HOME team)`);
  console.log(`  awayBookSpread     = ${awayBookSpread} (book RL odds for AWAY team)`);
  console.log(`  modelHomePLCoverPct = ${homeRLCover} (raw P(home covers -1.5))`);
  console.log(`  modelAwayPLCoverPct = ${awayRLCover} (raw P(away covers -1.5))`);
  
  // Convert RL odds to probabilities
  const homeRLProb = americanToProb(homeSpread);
  const awayRLProb = americanToProb(awaySpread);
  
  console.log(`\n  homeModelSpread → P(home covers) = ${homeRLProb ? (homeRLProb*100).toFixed(2)+'%' : 'NULL'}`);
  console.log(`  awayModelSpread → P(away covers) = ${awayRLProb ? (awayRLProb*100).toFixed(2)+'%' : 'NULL'}`);
  
  // Identify TB RL
  const tbRLOdds = tbIsHome ? homeSpread : awaySpread;
  const torRLOdds = tbIsHome ? awaySpread : homeSpread;
  const tbRLProb = tbIsHome ? homeRLProb : awayRLProb;
  const torRLProb = tbIsHome ? awayRLProb : homeRLProb;
  
  console.log(`\n  TB  model RL odds = ${tbRLOdds} → P(TB covers -1.5)  = ${tbRLProb ? (tbRLProb*100).toFixed(2)+'%' : 'NULL'}`);
  console.log(`  TOR model RL odds = ${torRLOdds} → P(TOR covers -1.5) = ${torRLProb ? (torRLProb*100).toFixed(2)+'%' : 'NULL'}`);

  console.log('\n' + '─'.repeat(80));
  console.log('[STEP 5] INVARIANT VIOLATION CHECK:');
  console.log('─'.repeat(80));
  
  if (tbMLProb && tbRLProb) {
    console.log(`  INVARIANT: P(TB win by 2+) ≤ P(TB win)`);
    console.log(`  P(TB win)      = ${(tbMLProb*100).toFixed(2)}%`);
    console.log(`  P(TB win by 2+) = ${(tbRLProb*100).toFixed(2)}%`);
    
    if (tbRLProb > tbMLProb) {
      console.log(`  [CRITICAL VIOLATION] P(TB win by 2+)=${(tbRLProb*100).toFixed(2)}% > P(TB win)=${(tbMLProb*100).toFixed(2)}%`);
      console.log(`  Delta: ${((tbRLProb - tbMLProb)*100).toFixed(2)}pp OVER`);
    } else {
      console.log(`  [PASS] Invariant holds`);
    }
  }
  
  if (torMLProb && torRLProb) {
    console.log(`\n  INVARIANT: P(TOR win by 2+) ≤ P(TOR win)`);
    console.log(`  P(TOR win)      = ${(torMLProb*100).toFixed(2)}%`);
    console.log(`  P(TOR win by 2+) = ${(torRLProb*100).toFixed(2)}%`);
    
    if (torRLProb > torMLProb) {
      console.log(`  [CRITICAL VIOLATION] P(TOR win by 2+)=${(torRLProb*100).toFixed(2)}% > P(TOR win)=${(torMLProb*100).toFixed(2)}%`);
    } else {
      console.log(`  [PASS] Invariant holds`);
    }
  }

  console.log('\n' + '─'.repeat(80));
  console.log('[STEP 6] SIGN/DIRECTION ANALYSIS:');
  console.log('─'.repeat(80));
  
  // The book RL for TB (away team) should be +1.5
  // The book RL for TOR (home team) should be -1.5
  // Model RL should follow same convention
  
  console.log(`  Book convention: away team gets +1.5, home team gets -1.5`);
  console.log(`  TB is ${tbIsHome ? 'HOME' : 'AWAY'} → TB book RL should be ${tbIsHome ? '-1.5' : '+1.5'}`);
  console.log(`  TOR is ${tbIsHome ? 'AWAY' : 'HOME'} → TOR book RL should be ${tbIsHome ? '+1.5' : '-1.5'}`);
  
  // What the screen shows: TB -1.5 at -151 (model)
  // This means TB is being shown as the FAVORITE on the RL
  // But TB is +129 ML (underdog)
  
  console.log(`\n  Screen shows: TB -1.5 at -151 (model) → TB is RL FAVORITE`);
  console.log(`  Screen shows: TB +129 ML (model) → TB is ML UNDERDOG`);
  console.log(`  CONTRADICTION: Cannot be RL favorite and ML underdog simultaneously`);
  
  console.log('\n' + '─'.repeat(80));
  console.log('[STEP 7] SPREAD DIRECTION HYPOTHESIS:');
  console.log('─'.repeat(80));
  
  // homeModelSpread is the odds for the HOME team's spread
  // If homeModelSpread = -151, that means HOME team covers -1.5 at -151 (60.2% prob)
  // But if TOR is home and TOR ML is -129... wait let's check
  
  console.log(`  homeModelSpread = ${homeSpread}`);
  console.log(`  awayModelSpread = ${awaySpread}`);
  console.log(`  homeBookSpread  = ${homeBookSpread}`);
  console.log(`  awayBookSpread  = ${awayBookSpread}`);
  
  // The book spread: home team -1.5 means home team is favored
  // homeBookSpread = -214 means home team covers -1.5 at -214 (very likely)
  // awayBookSpread = +174 means away team covers +1.5 at +174 (less likely)
  
  console.log(`\n  Book: homeBookSpread=${homeBookSpread} → P(home covers -1.5) = ${(americanToProb(homeBookSpread)*100).toFixed(2)}%`);
  console.log(`  Book: awayBookSpread=${awayBookSpread} → P(away covers +1.5) = ${(americanToProb(awayBookSpread)*100).toFixed(2)}%`);
  
  // Now model:
  console.log(`\n  Model: homeModelSpread=${homeSpread} → P(home covers -1.5) = ${homeRLProb ? (homeRLProb*100).toFixed(2)+'%' : 'NULL'}`);
  console.log(`  Model: awayModelSpread=${awaySpread} → P(away covers +1.5) = ${awayRLProb ? (awayRLProb*100).toFixed(2)+'%' : 'NULL'}`);
  
  // The display shows TB -1.5 at -151
  // TB is the AWAY team
  // awayModelSpread should be the odds for TB covering +1.5 (not -1.5)
  // BUT the screen shows TB -1.5 at -151 which is the HOME team's RL
  
  console.log(`\n  [HYPOTHESIS A] Frontend is displaying HOME RL odds as AWAY RL odds`);
  console.log(`    If homeModelSpread=${homeSpread} is being shown as TB's RL odds...`);
  console.log(`    TB is AWAY, so TB's RL should be +1.5 (underdog line)`);
  console.log(`    But screen shows TB -1.5 (favorite line) → HOME/AWAY SWAP in frontend`);
  
  console.log(`\n  [HYPOTHESIS B] RL direction is inverted in DB storage`);
  console.log(`    homeModelSpread=${homeSpread} should be TOR's -1.5 odds`);
  console.log(`    awayModelSpread=${awaySpread} should be TB's +1.5 odds`);
  console.log(`    If awayModelSpread=${awaySpread} → P(TB covers +1.5) = ${awayRLProb ? (awayRLProb*100).toFixed(2)+'%' : 'NULL'}`);
  console.log(`    This would make TB +1.5 at ${awaySpread} which is CONSISTENT with TB being ML underdog`);
  
  console.log(`\n  [HYPOTHESIS C] Model RL direction is inverted in Python output`);
  console.log(`    Python outputs P(home_rl) = P(home covers -1.5)`);
  console.log(`    But if home/away is swapped in the model runner, RL direction flips`);
  
  console.log('\n' + '─'.repeat(80));
  console.log('[STEP 8] CONSISTENCY CHECK — RL vs ML:');
  console.log('─'.repeat(80));
  
  // If TOR is home and TOR is ML favorite:
  // TOR should cover -1.5 at some probability
  // homeModelSpread should be TOR's -1.5 odds
  
  const torIsHome = !tbIsHome;
  const torMLOdds = tbIsHome ? awayML : homeML;
  const torMLProbVal = tbIsHome ? awayMLProb : homeMLProb;
  const torRLOddsVal = tbIsHome ? awaySpread : homeSpread;
  const torRLProbVal = torRLOddsVal ? americanToProb(torRLOddsVal) : null;
  
  console.log(`  TOR is ${torIsHome ? 'HOME' : 'AWAY'}`);
  console.log(`  TOR ML odds = ${torMLOdds} → P(TOR win) = ${torMLProbVal ? (torMLProbVal*100).toFixed(2)+'%' : 'NULL'}`);
  console.log(`  TOR RL odds = ${torRLOddsVal} → P(TOR covers) = ${torRLProbVal ? (torRLProbVal*100).toFixed(2)+'%' : 'NULL'}`);
  
  if (torMLProbVal && torRLProbVal) {
    if (torRLProbVal > torMLProbVal) {
      console.log(`  [VIOLATION] TOR: P(cover -1.5)=${(torRLProbVal*100).toFixed(2)}% > P(win)=${(torMLProbVal*100).toFixed(2)}%`);
    } else {
      console.log(`  [OK] TOR: P(cover -1.5)=${(torRLProbVal*100).toFixed(2)}% ≤ P(win)=${(torMLProbVal*100).toFixed(2)}%`);
    }
  }
  
  console.log('\n' + '─'.repeat(80));
  console.log('[STEP 9] FRONTEND RENDERING HYPOTHESIS — What the screen shows:');
  console.log('─'.repeat(80));
  console.log(`  Screen: TB -1.5 at -151 (model) | TB +1.5 at +151 (model)`);
  console.log(`  Screen: TB +129 ML (model) | TOR -129 ML (model)`);
  console.log(`\n  If TB is AWAY:`);
  console.log(`    awayModelSpread = ${awaySpread} → this is what frontend shows as TB's RL odds`);
  console.log(`    But screen shows -151 for TB -1.5`);
  
  if (awaySpread === -151 || Math.abs(awaySpread - (-151)) < 2) {
    console.log(`    [MATCH] awayModelSpread=${awaySpread} matches screen -151`);
    console.log(`    [ROOT CAUSE] awayModelSpread is being labeled as TB -1.5 but should be TB +1.5`);
    console.log(`    The odds value is correct but the DIRECTION LABEL is wrong`);
  } else if (homeSpread === -151 || Math.abs(homeSpread - (-151)) < 2) {
    console.log(`    [MATCH] homeModelSpread=${homeSpread} matches screen -151`);
    console.log(`    [ROOT CAUSE] homeModelSpread (TOR's line) is being displayed as TB's RL`);
    console.log(`    HOME/AWAY SWAP in frontend rendering`);
  } else {
    console.log(`    [NO MATCH] Neither homeModelSpread=${homeSpread} nor awayModelSpread=${awaySpread} matches -151`);
    console.log(`    The -151 may be computed dynamically in the frontend from raw probabilities`);
  }
  
  console.log('\n' + '─'.repeat(80));
  console.log('[STEP 10] LIVE GAME STATE ANALYSIS:');
  console.log('─'.repeat(80));
  console.log(`  The screenshot shows: LIVE TOP 2ND | TB 5 | TOR 0`);
  console.log(`  This is a LIVE game with TB leading 5-0 in the 2nd inning`);
  console.log(`  The model was run PRE-GAME with pre-game probabilities`);
  console.log(`  The live score is NOT being fed back into the model`);
  console.log(`  BUT: the RL display may be using live score context to flip direction`);
  console.log(`  TB leads 5-0 → TB is now the ACTUAL favorite in-game`);
  console.log(`  If frontend is applying live score adjustment to RL direction, this could cause the inversion`);
  
  // Check if there's a liveScore or currentScore column
  const liveFields = Object.keys(g).filter(k => k.toLowerCase().includes('live') || k.toLowerCase().includes('score') || k.toLowerCase().includes('inning'));
  if (liveFields.length > 0) {
    console.log(`\n  Live-related DB fields found:`);
    liveFields.forEach(f => console.log(`    ${f} = ${g[f]}`));
  }
}

await conn.end();
console.log('\n' + '='.repeat(80));
console.log('AUDIT COMPLETE');
console.log('='.repeat(80));
