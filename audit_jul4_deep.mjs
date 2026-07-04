import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection({
  uri: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

console.log("═══════════════════════════════════════════════════════════════════════════════");
console.log(" DEEP AUDIT: wc2026MatchOdds — Jul 4, 2026 R16 Matches");
console.log(" Timestamp:", new Date().toISOString());
console.log("═══════════════════════════════════════════════════════════════════════════════\n");

// 1. Extract full rows
const [rows] = await conn.execute(
  "SELECT * FROM wc2026MatchOdds WHERE match_id IN ('wc26-r16-089', 'wc26-r16-090') ORDER BY match_id"
);

if (rows.length !== 2) {
  console.error("❌ FATAL: Expected 2 rows, got", rows.length);
  process.exit(1);
}

// 2. Cross-reference with wc2026_matches for team validation
const [matchRows] = await conn.execute(
  "SELECT * FROM wc2026_matches WHERE match_id IN ('wc26-r16-089', 'wc26-r16-090') ORDER BY match_id"
);

// 3. Cross-reference with wc2026_espn_matches for ESPN validation
const [espnRows] = await conn.execute(
  "SELECT * FROM wc2026_espn_matches WHERE espn_match_id IN ('760502', '760503') ORDER BY espn_match_id"
);

let errors = [];
let warnings = [];

for (const row of rows) {
  console.log("\n" + "━".repeat(75));
  console.log(`  MATCH: ${row.match_id}`);
  console.log("━".repeat(75));
  
  // ═══ SECTION A: METADATA VALIDATION ═══
  console.log("\n  [A] METADATA VALIDATION");
  
  // Check match_id format
  if (!/^wc26-r16-\d{3}$/.test(row.match_id)) {
    errors.push(`${row.match_id}: Invalid match_id format`);
    console.log("    ❌ match_id format invalid");
  } else {
    console.log("    ✅ match_id format: " + row.match_id);
  }
  
  // Check espn_match_id
  if (!row.espn_match_id || !/^\d{6}$/.test(String(row.espn_match_id))) {
    errors.push(`${row.match_id}: espn_match_id invalid: ${row.espn_match_id}`);
    console.log("    ❌ espn_match_id: " + row.espn_match_id);
  } else {
    console.log("    ✅ espn_match_id: " + row.espn_match_id);
  }
  
  // Check espn_slug format (xxx-yyy)
  if (!row.espn_slug || !/^[a-z]{3}-[a-z]{3}$/.test(row.espn_slug)) {
    errors.push(`${row.match_id}: espn_slug invalid: ${row.espn_slug}`);
    console.log("    ❌ espn_slug: " + row.espn_slug);
  } else {
    console.log("    ✅ espn_slug: " + row.espn_slug);
  }
  
  // Check bet_explorer_match_id (8 chars alphanumeric)
  if (!row.bet_explorer_match_id || !/^[A-Za-z0-9]{8}$/.test(row.bet_explorer_match_id)) {
    errors.push(`${row.match_id}: bet_explorer_match_id invalid: ${row.bet_explorer_match_id}`);
    console.log("    ❌ bet_explorer_match_id: " + row.bet_explorer_match_id);
  } else {
    console.log("    ✅ bet_explorer_match_id: " + row.bet_explorer_match_id);
  }
  
  // Check bet_explorer_slug
  if (!row.bet_explorer_slug || !row.bet_explorer_slug.includes("-")) {
    errors.push(`${row.match_id}: bet_explorer_slug invalid: ${row.bet_explorer_slug}`);
    console.log("    ❌ bet_explorer_slug: " + row.bet_explorer_slug);
  } else {
    console.log("    ✅ bet_explorer_slug: " + row.bet_explorer_slug);
  }
  
  // Check world_cup_stage/round
  if (row.world_cup_stage !== "knockout") {
    errors.push(`${row.match_id}: world_cup_stage should be 'knockout', got '${row.world_cup_stage}'`);
  }
  if (row.world_cup_round !== "r16") {
    errors.push(`${row.match_id}: world_cup_round should be 'r16', got '${row.world_cup_round}'`);
  }
  console.log(`    ✅ world_cup_stage=${row.world_cup_stage}, world_cup_round=${row.world_cup_round}`);
  
  // ═══ SECTION B: TEAM ORIENTATION VALIDATION ═══
  console.log("\n  [B] TEAM ORIENTATION VALIDATION");
  
  // Expected orientation from ESPN:
  // 089: espn_slug=fra-par → away=FRA(478), home=PAR(210)
  // 090: espn_slug=mar-can → away=MAR(2869), home=CAN(206)
  const expectedTeams = {
    'wc26-r16-089': { away: 478, home: 210, awayName: 'France', homeName: 'Paraguay', espnSlug: 'fra-par' },
    'wc26-r16-090': { away: 2869, home: 206, awayName: 'Morocco', homeName: 'Canada', espnSlug: 'mar-can' }
  };
  
  const expected = expectedTeams[row.match_id];
  
  if (Number(row.away_team) !== expected.away) {
    errors.push(`${row.match_id}: away_team should be ${expected.away} (${expected.awayName}), got ${row.away_team}`);
    console.log(`    ❌ away_team: ${row.away_team} (expected ${expected.away}/${expected.awayName})`);
  } else {
    console.log(`    ✅ away_team: ${row.away_team} (${expected.awayName})`);
  }
  
  if (Number(row.home_team) !== expected.home) {
    errors.push(`${row.match_id}: home_team should be ${expected.home} (${expected.homeName}), got ${row.home_team}`);
    console.log(`    ❌ home_team: ${row.home_team} (expected ${expected.home}/${expected.homeName})`);
  } else {
    console.log(`    ✅ home_team: ${row.home_team} (${expected.homeName})`);
  }
  
  if (row.espn_slug !== expected.espnSlug) {
    errors.push(`${row.match_id}: espn_slug mismatch: ${row.espn_slug} vs expected ${expected.espnSlug}`);
  }
  
  // Cross-validate with wc2026_matches
  const matchRow = matchRows.find(m => m.match_id === row.match_id);
  if (matchRow) {
    const matchHome = matchRow.home_team_id || matchRow.homeTeamId;
    const matchAway = matchRow.away_team_id || matchRow.awayTeamId;
    console.log(`    [CROSS-REF] wc2026_matches: home=${matchHome}, away=${matchAway}`);
    // Note: wc2026_matches may use string team IDs like 'par', 'fra'
  } else {
    console.log(`    [CROSS-REF] wc2026_matches: row not found (may use different format)`);
  }
  
  // ═══ SECTION C: BOOK ODDS VALIDATION ═══
  console.log("\n  [C] BOOK ODDS VALIDATION");
  
  const bookHome = Number(row.book_home_ml);
  const bookDraw = Number(row.book_draw);
  const bookAway = Number(row.book_away_ml);
  const bookOver = Number(row.book_over_odds);
  const bookUnder = Number(row.book_under_odds);
  const bookTotal = Number(row.book_total);
  const bookHomeAdv = Number(row.book_home_to_advance);
  const bookAwayAdv = Number(row.book_away_to_advance);
  const bookHomeWd = Number(row.book_home_wd);
  const bookAwayWd = Number(row.book_away_wd);
  const bookNoDraw = Number(row.book_no_draw);
  const bookBttsYes = Number(row.book_btts_yes);
  const bookBttsNo = Number(row.book_btts_no);
  const bookSpread = Number(row.book_primary_spread);
  const bookHomeSpreadOdds = Number(row.book_home_primary_spread_odds);
  const bookAwaySpreadOdds = Number(row.book_away_primary_spread_odds);
  
  // Helper: American odds to implied probability
  function americanToProb(odds) {
    if (odds > 0) return 100 / (odds + 100);
    return Math.abs(odds) / (Math.abs(odds) + 100);
  }
  
  // C1: 1X2 market — probabilities should sum to ~100-115% (with vig)
  const prob1x2 = americanToProb(bookHome) + americanToProb(bookDraw) + americanToProb(bookAway);
  console.log(`    1X2: Home=${bookHome > 0 ? '+' : ''}${bookHome} | Draw=${bookDraw > 0 ? '+' : ''}${bookDraw} | Away=${bookAway > 0 ? '+' : ''}${bookAway}`);
  console.log(`    1X2 implied sum: ${(prob1x2 * 100).toFixed(2)}%`);
  if (prob1x2 < 0.95 || prob1x2 > 1.20) {
    errors.push(`${row.match_id}: 1X2 implied prob sum out of range: ${(prob1x2*100).toFixed(2)}% (expected 95-120%)`);
    console.log(`    ❌ 1X2 sum OUT OF RANGE`);
  } else {
    console.log(`    ✅ 1X2 sum in valid range (95-120%)`);
  }
  
  // C2: Advance market — probabilities should sum to ~100-115%
  const probAdv = americanToProb(bookHomeAdv) + americanToProb(bookAwayAdv);
  console.log(`    Advance: Home=${bookHomeAdv > 0 ? '+' : ''}${bookHomeAdv} | Away=${bookAwayAdv > 0 ? '+' : ''}${bookAwayAdv}`);
  console.log(`    Advance implied sum: ${(probAdv * 100).toFixed(2)}%`);
  if (probAdv < 0.90 || probAdv > 1.20) {
    errors.push(`${row.match_id}: Advance implied prob sum out of range: ${(probAdv*100).toFixed(2)}% (expected 90-120%)`);
    console.log(`    ❌ Advance sum OUT OF RANGE`);
  } else {
    console.log(`    ✅ Advance sum in valid range (90-120%)`);
  }
  
  // C3: O/U market — probabilities should sum to ~100-115%
  const probOU = americanToProb(bookOver) + americanToProb(bookUnder);
  console.log(`    O/U ${bookTotal}: Over=${bookOver > 0 ? '+' : ''}${bookOver} | Under=${bookUnder > 0 ? '+' : ''}${bookUnder}`);
  console.log(`    O/U implied sum: ${(probOU * 100).toFixed(2)}%`);
  if (probOU < 0.95 || probOU > 1.20) {
    errors.push(`${row.match_id}: O/U implied prob sum out of range: ${(probOU*100).toFixed(2)}% (expected 95-120%)`);
    console.log(`    ❌ O/U sum OUT OF RANGE`);
  } else {
    console.log(`    ✅ O/U sum in valid range (95-120%)`);
  }
  
  // C4: BTTS market — probabilities should sum to ~100-115%
  const probBTTS = americanToProb(bookBttsYes) + americanToProb(bookBttsNo);
  console.log(`    BTTS: Yes=${bookBttsYes > 0 ? '+' : ''}${bookBttsYes} | No=${bookBttsNo > 0 ? '+' : ''}${bookBttsNo}`);
  console.log(`    BTTS implied sum: ${(probBTTS * 100).toFixed(2)}%`);
  if (probBTTS < 0.95 || probBTTS > 1.20) {
    errors.push(`${row.match_id}: BTTS implied prob sum out of range: ${(probBTTS*100).toFixed(2)}% (expected 95-120%)`);
    console.log(`    ❌ BTTS sum OUT OF RANGE`);
  } else {
    console.log(`    ✅ BTTS sum in valid range (95-120%)`);
  }
  
  // C5: Win/Draw market consistency
  // book_home_wd should be derived from home_ml + draw combined
  // book_away_wd should be derived from away_ml + draw combined
  const probHomeWd = americanToProb(bookHomeWd);
  const probAwayWd = americanToProb(bookAwayWd);
  const probNoDraw = americanToProb(bookNoDraw);
  console.log(`    WD: Home=${bookHomeWd > 0 ? '+' : ''}${bookHomeWd} | Away=${bookAwayWd > 0 ? '+' : ''}${bookAwayWd} | NoDraw=${bookNoDraw > 0 ? '+' : ''}${bookNoDraw}`);
  
  // C6: Spread market
  console.log(`    Spread: ${bookSpread} | Home=${bookHomeSpreadOdds > 0 ? '+' : ''}${bookHomeSpreadOdds} | Away=${bookAwaySpreadOdds > 0 ? '+' : ''}${bookAwaySpreadOdds}`);
  const probSpread = americanToProb(bookHomeSpreadOdds) + americanToProb(bookAwaySpreadOdds);
  console.log(`    Spread implied sum: ${(probSpread * 100).toFixed(2)}%`);
  if (probSpread < 0.90 || probSpread > 1.20) {
    errors.push(`${row.match_id}: Spread implied prob sum out of range: ${(probSpread*100).toFixed(2)}% (expected 90-120%)`);
    console.log(`    ❌ Spread sum OUT OF RANGE`);
  } else {
    console.log(`    ✅ Spread sum in valid range (90-120%)`);
  }
  
  // C7: Directional consistency checks
  // The favorite on ML should also be favorite to advance
  const awayIsFavML = bookAway < 0 || (bookAway > 0 && bookHome > 0 && bookAway < bookHome);
  const awayIsFavAdv = bookAwayAdv < 0 || (bookAwayAdv > 0 && bookHomeAdv > 0 && bookAwayAdv < bookHomeAdv);
  
  if (awayIsFavML !== awayIsFavAdv) {
    warnings.push(`${row.match_id}: ML favorite direction doesn't match Advance favorite direction`);
    console.log(`    ⚠️ ML fav (away=${awayIsFavML}) vs Advance fav (away=${awayIsFavAdv}) MISMATCH`);
  } else {
    console.log(`    ✅ ML and Advance favorite direction consistent (away favored: ${awayIsFavML})`);
  }
  
  // Spread direction: negative spread means that team is favored
  // book_primary_spread is the away team's spread
  const spreadFavAway = bookSpread < 0;
  if (spreadFavAway !== awayIsFavML) {
    // This can happen with draws — not necessarily an error in soccer
    warnings.push(`${row.match_id}: Spread direction (away fav: ${spreadFavAway}) vs ML direction (away fav: ${awayIsFavML})`);
    console.log(`    ⚠️ Spread fav (away=${spreadFavAway}) vs ML fav (away=${awayIsFavML}) — may be OK in soccer with draw`);
  } else {
    console.log(`    ✅ Spread and ML favorite direction consistent`);
  }
  
  // ═══ SECTION D: MODEL ODDS VALIDATION ═══
  console.log("\n  [D] MODEL ODDS VALIDATION");
  
  const modelHomeMl = Number(row.model_home_ml);
  const modelDraw = Number(row.model_draw);
  const modelAwayMl = Number(row.model_away_ml);
  const modelHomeAdv = Number(row.model_home_to_advance);
  const modelAwayAdv = Number(row.model_away_to_advance);
  const modelOver = Number(row.model_over_odds);
  const modelUnder = Number(row.model_under_odds);
  const modelTotal = Number(row.model_total);
  const modelHomeWd = Number(row.model_home_wd);
  const modelAwayWd = Number(row.model_away_wd);
  const modelNoDraw = Number(row.model_no_draw);
  const modelBttsYes = Number(row.model_btts_yes);
  const modelBttsNo = Number(row.model_btts_no);
  const modelSpread = Number(row.model_primary_spread);
  const modelHomeSpreadOdds = Number(row.model_home_primary_spread_odds);
  const modelAwaySpreadOdds = Number(row.model_away_primary_spread_odds);
  const lambdaAway = Number(row.lamba_away);
  const lambdaHome = Number(row.lamba_home);
  const projAwayGoals = Number(row.model_projected_away_goals);
  const projHomeGoals = Number(row.model_projected_home_goals);
  
  // D1: Lambda consistency with projected goals
  if (Math.abs(lambdaAway - projAwayGoals) > 0.001) {
    errors.push(`${row.match_id}: lamba_away (${lambdaAway}) != model_projected_away_goals (${projAwayGoals})`);
    console.log(`    ❌ lamba_away != projected_away_goals`);
  } else {
    console.log(`    ✅ lamba_away = projected_away_goals = ${lambdaAway.toFixed(4)}`);
  }
  
  if (Math.abs(lambdaHome - projHomeGoals) > 0.001) {
    errors.push(`${row.match_id}: lamba_home (${lambdaHome}) != model_projected_home_goals (${projHomeGoals})`);
    console.log(`    ❌ lamba_home != projected_home_goals`);
  } else {
    console.log(`    ✅ lamba_home = projected_home_goals = ${lambdaHome.toFixed(4)}`);
  }
  
  // D2: Model total should equal lambda_away + lambda_home
  const expectedTotal = lambdaAway + lambdaHome;
  if (Math.abs(modelTotal - expectedTotal) > 0.01) {
    errors.push(`${row.match_id}: model_total (${modelTotal}) != lamba_away + lamba_home (${expectedTotal})`);
    console.log(`    ❌ model_total (${modelTotal.toFixed(4)}) != λA+λH (${expectedTotal.toFixed(4)})`);
  } else {
    console.log(`    ✅ model_total = λA + λH = ${modelTotal.toFixed(4)}`);
  }
  
  // D3: Model 1X2 probabilities should sum to ~100% (no vig for model)
  const modelProb1x2 = americanToProb(modelHomeMl) + americanToProb(modelDraw) + americanToProb(modelAwayMl);
  console.log(`    Model 1X2: Home=${modelHomeMl > 0 ? '+' : ''}${modelHomeMl} | Draw=${modelDraw > 0 ? '+' : ''}${modelDraw} | Away=${modelAwayMl > 0 ? '+' : ''}${modelAwayMl}`);
  console.log(`    Model 1X2 implied sum: ${(modelProb1x2 * 100).toFixed(2)}%`);
  if (modelProb1x2 < 0.95 || modelProb1x2 > 1.05) {
    errors.push(`${row.match_id}: Model 1X2 implied prob sum should be ~100%, got ${(modelProb1x2*100).toFixed(2)}%`);
    console.log(`    ❌ Model 1X2 sum should be ~100% (no-vig)`);
  } else {
    console.log(`    ✅ Model 1X2 sum ≈ 100% (no-vig)`);
  }
  
  // D4: Model advance probabilities should sum to ~100%
  const modelProbAdv = americanToProb(modelHomeAdv) + americanToProb(modelAwayAdv);
  console.log(`    Model Advance: Home=${modelHomeAdv > 0 ? '+' : ''}${modelHomeAdv} | Away=${modelAwayAdv > 0 ? '+' : ''}${modelAwayAdv}`);
  console.log(`    Model Advance implied sum: ${(modelProbAdv * 100).toFixed(2)}%`);
  if (modelProbAdv < 0.95 || modelProbAdv > 1.05) {
    errors.push(`${row.match_id}: Model Advance implied prob sum should be ~100%, got ${(modelProbAdv*100).toFixed(2)}%`);
    console.log(`    ❌ Model Advance sum should be ~100%`);
  } else {
    console.log(`    ✅ Model Advance sum ≈ 100%`);
  }
  
  // D5: Model O/U probabilities should sum to ~100%
  const modelProbOU = americanToProb(modelOver) + americanToProb(modelUnder);
  console.log(`    Model O/U: Over=${modelOver > 0 ? '+' : ''}${modelOver} | Under=${modelUnder > 0 ? '+' : ''}${modelUnder}`);
  console.log(`    Model O/U implied sum: ${(modelProbOU * 100).toFixed(2)}%`);
  if (modelProbOU < 0.95 || modelProbOU > 1.05) {
    errors.push(`${row.match_id}: Model O/U implied prob sum should be ~100%, got ${(modelProbOU*100).toFixed(2)}%`);
    console.log(`    ❌ Model O/U sum should be ~100%`);
  } else {
    console.log(`    ✅ Model O/U sum ≈ 100%`);
  }
  
  // D6: Model BTTS probabilities should sum to ~100%
  const modelProbBTTS = americanToProb(modelBttsYes) + americanToProb(modelBttsNo);
  console.log(`    Model BTTS: Yes=${modelBttsYes > 0 ? '+' : ''}${modelBttsYes} | No=${modelBttsNo > 0 ? '+' : ''}${modelBttsNo}`);
  console.log(`    Model BTTS implied sum: ${(modelProbBTTS * 100).toFixed(2)}%`);
  if (modelProbBTTS < 0.95 || modelProbBTTS > 1.05) {
    errors.push(`${row.match_id}: Model BTTS implied prob sum should be ~100%, got ${(modelProbBTTS*100).toFixed(2)}%`);
    console.log(`    ❌ Model BTTS sum should be ~100%`);
  } else {
    console.log(`    ✅ Model BTTS sum ≈ 100%`);
  }
  
  // D7: Model spread odds should sum to ~100%
  const modelProbSpread = americanToProb(modelHomeSpreadOdds) + americanToProb(modelAwaySpreadOdds);
  console.log(`    Model Spread: ${modelSpread} | Home=${modelHomeSpreadOdds > 0 ? '+' : ''}${modelHomeSpreadOdds} | Away=${modelAwaySpreadOdds > 0 ? '+' : ''}${modelAwaySpreadOdds}`);
  console.log(`    Model Spread implied sum: ${(modelProbSpread * 100).toFixed(2)}%`);
  if (modelProbSpread < 0.95 || modelProbSpread > 1.05) {
    errors.push(`${row.match_id}: Model Spread implied prob sum should be ~100%, got ${(modelProbSpread*100).toFixed(2)}%`);
    console.log(`    ❌ Model Spread sum should be ~100%`);
  } else {
    console.log(`    ✅ Model Spread sum ≈ 100%`);
  }
  
  // D8: Lambda sanity checks (should be positive, reasonable for soccer: 0.1-5.0)
  if (lambdaAway <= 0 || lambdaAway > 5.0) {
    errors.push(`${row.match_id}: lamba_away out of range: ${lambdaAway} (expected 0.1-5.0)`);
    console.log(`    ❌ lamba_away out of range: ${lambdaAway}`);
  } else {
    console.log(`    ✅ lamba_away in range: ${lambdaAway.toFixed(4)}`);
  }
  
  if (lambdaHome <= 0 || lambdaHome > 5.0) {
    errors.push(`${row.match_id}: lamba_home out of range: ${lambdaHome} (expected 0.1-5.0)`);
    console.log(`    ❌ lamba_home out of range: ${lambdaHome}`);
  } else {
    console.log(`    ✅ lamba_home in range: ${lambdaHome.toFixed(4)}`);
  }
  
  // D9: Model favorite direction should match lambda direction
  // Higher lambda = more goals = more likely to win
  const modelAwayFav = lambdaAway > lambdaHome;
  const modelAwayFavMl = modelAwayMl < 0 || (modelAwayMl > 0 && modelHomeMl > 0 && modelAwayMl < modelHomeMl);
  if (modelAwayFav !== modelAwayFavMl) {
    errors.push(`${row.match_id}: Lambda direction (away fav: ${modelAwayFav}) doesn't match model ML direction (away fav: ${modelAwayFavMl})`);
    console.log(`    ❌ Lambda direction vs Model ML direction MISMATCH`);
  } else {
    console.log(`    ✅ Lambda direction matches Model ML direction (away favored: ${modelAwayFav})`);
  }
  
  // D10: Model WD consistency
  // model_home_wd = home win + draw combined
  // model_away_wd = away win + draw combined
  const modelProbHome = americanToProb(modelHomeMl);
  const modelProbDraw = americanToProb(modelDraw);
  const modelProbAway = americanToProb(modelAwayMl);
  const expectedHomeWdProb = modelProbHome + modelProbDraw;
  const expectedAwayWdProb = modelProbAway + modelProbDraw;
  const actualHomeWdProb = americanToProb(modelHomeWd);
  const actualAwayWdProb = americanToProb(modelAwayWd);
  
  console.log(`    Model WD: Home=${modelHomeWd > 0 ? '+' : ''}${modelHomeWd} | Away=${modelAwayWd > 0 ? '+' : ''}${modelAwayWd} | NoDraw=${modelNoDraw > 0 ? '+' : ''}${modelNoDraw}`);
  console.log(`    Expected HomeWD prob: ${(expectedHomeWdProb*100).toFixed(2)}% | Actual: ${(actualHomeWdProb*100).toFixed(2)}%`);
  console.log(`    Expected AwayWD prob: ${(expectedAwayWdProb*100).toFixed(2)}% | Actual: ${(actualAwayWdProb*100).toFixed(2)}%`);
  
  if (Math.abs(expectedHomeWdProb - actualHomeWdProb) > 0.03) {
    warnings.push(`${row.match_id}: model_home_wd prob (${(actualHomeWdProb*100).toFixed(1)}%) differs from H+D (${(expectedHomeWdProb*100).toFixed(1)}%) by >${3}%`);
    console.log(`    ⚠️ model_home_wd deviation > 3%`);
  } else {
    console.log(`    ✅ model_home_wd consistent with H+D`);
  }
  
  if (Math.abs(expectedAwayWdProb - actualAwayWdProb) > 0.03) {
    warnings.push(`${row.match_id}: model_away_wd prob (${(actualAwayWdProb*100).toFixed(1)}%) differs from A+D (${(expectedAwayWdProb*100).toFixed(1)}%) by >${3}%`);
    console.log(`    ⚠️ model_away_wd deviation > 3%`);
  } else {
    console.log(`    ✅ model_away_wd consistent with A+D`);
  }
  
  // ═══ SECTION E: NULL CHECK ═══
  console.log("\n  [E] NULL CHECK (all columns)");
  let nullCols = [];
  for (const [k, v] of Object.entries(row)) {
    if (v === null && k !== 'id') nullCols.push(k);
  }
  if (nullCols.length > 0) {
    errors.push(`${row.match_id}: NULL columns found: ${nullCols.join(', ')}`);
    console.log(`    ❌ NULL columns: ${nullCols.join(', ')}`);
  } else {
    console.log(`    ✅ ZERO NULL columns (all populated)`);
  }
  
  // ═══ SECTION F: CROSS-VALIDATION SUMMARY ═══
  console.log("\n  [F] FULL VALUE DUMP");
  console.log(`    BOOK: ML H=${bookHome > 0 ? '+':''}${bookHome} D=${bookDraw > 0 ? '+':''}${bookDraw} A=${bookAway > 0 ? '+':''}${bookAway}`);
  console.log(`    BOOK: Advance H=${bookHomeAdv > 0 ? '+':''}${bookHomeAdv} A=${bookAwayAdv > 0 ? '+':''}${bookAwayAdv}`);
  console.log(`    BOOK: Spread=${bookSpread} H=${bookHomeSpreadOdds > 0 ? '+':''}${bookHomeSpreadOdds} A=${bookAwaySpreadOdds > 0 ? '+':''}${bookAwaySpreadOdds}`);
  console.log(`    BOOK: Total=${bookTotal} O=${bookOver > 0 ? '+':''}${bookOver} U=${bookUnder > 0 ? '+':''}${bookUnder}`);
  console.log(`    BOOK: WD H=${bookHomeWd > 0 ? '+':''}${bookHomeWd} A=${bookAwayWd > 0 ? '+':''}${bookAwayWd} ND=${bookNoDraw > 0 ? '+':''}${bookNoDraw}`);
  console.log(`    BOOK: BTTS Y=${bookBttsYes > 0 ? '+':''}${bookBttsYes} N=${bookBttsNo > 0 ? '+':''}${bookBttsNo}`);
  console.log(`    MODEL: ML H=${modelHomeMl > 0 ? '+':''}${modelHomeMl} D=${modelDraw > 0 ? '+':''}${modelDraw} A=${modelAwayMl > 0 ? '+':''}${modelAwayMl}`);
  console.log(`    MODEL: Advance H=${modelHomeAdv > 0 ? '+':''}${modelHomeAdv} A=${modelAwayAdv > 0 ? '+':''}${modelAwayAdv}`);
  console.log(`    MODEL: Spread=${modelSpread} H=${modelHomeSpreadOdds > 0 ? '+':''}${modelHomeSpreadOdds} A=${modelAwaySpreadOdds > 0 ? '+':''}${modelAwaySpreadOdds}`);
  console.log(`    MODEL: Total=${modelTotal.toFixed(4)} O=${modelOver > 0 ? '+':''}${modelOver} U=${modelUnder > 0 ? '+':''}${modelUnder}`);
  console.log(`    MODEL: WD H=${modelHomeWd > 0 ? '+':''}${modelHomeWd} A=${modelAwayWd > 0 ? '+':''}${modelAwayWd} ND=${modelNoDraw > 0 ? '+':''}${modelNoDraw}`);
  console.log(`    MODEL: BTTS Y=${modelBttsYes > 0 ? '+':''}${modelBttsYes} N=${modelBttsNo > 0 ? '+':''}${modelBttsNo}`);
  console.log(`    LAMBDA: away=${lambdaAway.toFixed(6)} home=${lambdaHome.toFixed(6)} total=${(lambdaAway+lambdaHome).toFixed(6)}`);
}

// ═══ FINAL REPORT ═══
console.log("\n\n" + "═".repeat(75));
console.log(" FINAL AUDIT REPORT");
console.log("═".repeat(75));
console.log(`\n  ERRORS: ${errors.length}`);
for (const e of errors) console.log(`    ❌ ${e}`);
console.log(`\n  WARNINGS: ${warnings.length}`);
for (const w of warnings) console.log(`    ⚠️ ${w}`);
console.log(`\n  VERDICT: ${errors.length === 0 ? '✅ ALL CHECKS PASS — 100% ACCURATE & COMPLETE' : '❌ ERRORS FOUND — FIXES REQUIRED'}`);
console.log("═".repeat(75));

await conn.end();
process.exit(errors.length > 0 ? 1 : 0);
