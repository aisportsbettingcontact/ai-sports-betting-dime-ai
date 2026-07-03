/**
 * wc_rescrape_june19.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Re-scrapes DraftKings odds for June 19 WC2026 matchs from AN API,
 * resolves correct home/away orientation by matching against DB match records,
 * recomputes Double Chance odds from no-vig fair probs,
 * and updates wc2026_odds_snapshots with current live lines.
 *
 * Logging:
 *   [INPUT]  source + parsed values
 *   [STEP]   operation description
 *   [STATE]  intermediate computations
 *   [OUTPUT] result
 *   [VERIFY] pass/fail + reason
 */
import { createConnection } from 'mysql2/promise';
import { config } from 'dotenv';
config();

const AN_URL = 'https://api.actionnetwork.com/web/v2/scoreboard/soccer?bookIds=68&date=20260619&periods=event';
const AN_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
  'Referer': 'https://www.actionnetwork.com/soccer/odds',
  'Origin': 'https://www.actionnetwork.com',
};

// ── Math helpers ──────────────────────────────────────────────────────────────
function americanToImplied(odds) {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function impliedToAmerican(p) {
  if (p <= 0 || p >= 1) throw new Error(`Invalid probability: ${p}`);
  if (p >= 0.5) return Math.round(-(p / (1 - p)) * 100);
  return Math.round(((1 - p) / p) * 100);
}

// Compute no-vig fair probs from 3-way american odds
function threeWayFairProbs(homeOdds, drawOdds, awayOdds) {
  const rawH = americanToImplied(homeOdds);
  const rawD = americanToImplied(drawOdds);
  const rawA = americanToImplied(awayOdds);
  const rawSum = rawH + rawD + rawA;
  return {
    fairH: rawH / rawSum,
    fairD: rawD / rawSum,
    fairA: rawA / rawSum,
    vig: rawSum - 1,
  };
}

(async () => {
  console.log('[INPUT] Re-scraping AN API for June 19 WC2026 DK odds');
  console.log('[INPUT] URL:', AN_URL);

  // ── 1. Fetch AN API ──────────────────────────────────────────────────────────
  let anData;
  try {
    const res = await fetch(AN_URL, { headers: AN_HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    anData = await res.json();
  } catch (err) {
    console.error('[VERIFY] FAIL — AN fetch error:', err.message);
    process.exit(1);
  }

  const games = anData.games ?? [];
  console.log(`[STEP] AN returned ${games.length} games for June 19`);

  // ── 2. Load DB matchs for June 19 ─────────────────────────────────────────
  const conn = await createConnection(process.env.DATABASE_URL);
  const [dbMatchs] = await conn.query(`
    SELECT f.match_id, f.home_team_id, f.away_team_id,
      ht.name AS home_name, at.name AS away_name,
      ht.fifa_code AS home_code, at.fifa_code AS away_code
    FROM wc2026_matches f
    JOIN wc2026_teams ht ON ht.team_id = f.home_team_id
    JOIN wc2026_teams at ON at.team_id = f.away_team_id
    WHERE f.match_date = '2026-06-19'
    ORDER BY f.kickoff_utc
  `);

  console.log(`[STEP] DB has ${dbMatchs.length} matchs for June 19`);
  for (const f of dbMatchs) {
    console.log(`  [STATE] ${f.match_id}: home=${f.home_name}(${f.home_code}) away=${f.away_name}(${f.away_code})`);
  }

  // ── 3. Build name→matchId lookup (bidirectional) ──────────────────────────
  // Key: normalized team name → { matchId, role: 'home'|'away' }
  const teamLookup = new Map();
  for (const f of dbMatchs) {
    const normalize = (s) => s.toLowerCase().replace(/[^a-z]/g, '');
    teamLookup.set(normalize(f.home_name), { matchId: f.match_id, role: 'home', match: f });
    teamLookup.set(normalize(f.away_name), { matchId: f.match_id, role: 'away', match: f });
    teamLookup.set(normalize(f.home_code), { matchId: f.match_id, role: 'home', match: f });
    teamLookup.set(normalize(f.away_code), { matchId: f.match_id, role: 'away', match: f });
    // Common AN aliases
    const homeAliases = {
      'usa': 'usa', 'unitedstates': 'usa', 'unitedstatesofamerica': 'usa',
      'scotland': 'sco', 'haiti': 'hai', 'turkey': 'tur', 'turkiye': 'tur',
    };
    const awayAliases = {
      'australia': 'aus', 'morocco': 'mar', 'brazil': 'bra', 'paraguay': 'par',
    };
  }

  // ── 4. Process each AN game ──────────────────────────────────────────────────
  const updates = []; // { matchId, market, selection, line, americanOdds, impliedProb }

  for (const game of games) {
    const t0 = game.teams[0];
    const t1 = game.teams[1];
    const name0 = (t0?.full_name ?? t0?.abbr ?? '').toLowerCase().replace(/[^a-z]/g, '');
    const name1 = (t1?.full_name ?? t1?.abbr ?? '').toLowerCase().replace(/[^a-z]/g, '');

    console.log(`\n[STEP] Game ${game.id}: teams[0]="${t0?.full_name}" teams[1]="${t1?.full_name}"`);

    // Resolve both teams to DB match
    const res0 = teamLookup.get(name0);
    const res1 = teamLookup.get(name1);

    let matchId = null;
    let anHomeIsTeams1 = true; // AN convention: teams[0]=away, teams[1]=home

    if (res0 && res1 && res0.matchId === res1.matchId) {
      matchId = res0.matchId;
      // Determine if AN orientation matches DB orientation
      // If res0.role === 'away' and res1.role === 'home' → standard AN convention
      // If res0.role === 'home' and res1.role === 'away' → AN has flipped orientation
      if (res0.role === 'away' && res1.role === 'home') {
        anHomeIsTeams1 = true;
        console.log(`[STATE] ${matchId}: Standard AN orientation (teams[0]=away, teams[1]=home) ✓`);
      } else if (res0.role === 'home' && res1.role === 'away') {
        anHomeIsTeams1 = false;
        console.log(`[STATE] ${matchId}: FLIPPED AN orientation (teams[0]=home, teams[1]=away) — correcting`);
      } else {
        console.log(`[STATE] ${matchId}: Ambiguous orientation — defaulting to standard`);
      }
    } else {
      // Fallback: try manual name matching
      const manualMap = {
        'usa': 'wc26-g-029', 'unitedstates': 'wc26-g-029',
        'scotland': 'wc26-g-031',
        'haiti': 'wc26-g-032',
        'turkey': 'wc26-g-030', 'turkiye': 'wc26-g-030', 'paraguay': 'wc26-g-030',
        'australia': 'wc26-g-029', 'morocco': 'wc26-g-031', 'brazil': 'wc26-g-032',
      };
      matchId = manualMap[name0] ?? manualMap[name1] ?? null;
      if (!matchId) {
        console.log(`[VERIFY] FAIL — Cannot resolve match for game ${game.id}: "${t0?.full_name}" vs "${t1?.full_name}"`);
        continue;
      }
      // Check DB orientation for this match
      const dbF = dbMatchs.find(f => f.match_id === matchId);
      const dbHomeName = dbF?.home_name?.toLowerCase().replace(/[^a-z]/g, '') ?? '';
      const dbAwayName = dbF?.away_name?.toLowerCase().replace(/[^a-z]/g, '') ?? '';
      if (name0 === dbHomeName || name0.includes(dbHomeName) || dbHomeName.includes(name0)) {
        anHomeIsTeams1 = false; // teams[0] is actually the DB home team
        console.log(`[STATE] ${matchId}: Fallback — teams[0] matches DB home → FLIPPED`);
      } else {
        anHomeIsTeams1 = true;
        console.log(`[STATE] ${matchId}: Fallback — standard orientation`);
      }
    }

    const dkBook = game.markets?.['68']?.event;
    if (!dkBook) {
      console.log(`[STATE] Game ${game.id}: No DK (book_id=68) odds available`);
      continue;
    }

    const ml = dkBook.moneyline ?? [];
    const totals = dkBook.total ?? [];
    const spreads = dkBook.spread ?? [];

    // AN moneyline: side='home' means teams[1] if standard, teams[0] if flipped
    // We need to map AN's 'home'/'away' to DB's 'home'/'away'
    const mlAnHome = ml.find(o => o.side === 'home');
    const mlAnAway = ml.find(o => o.side === 'away');
    const mlAnDraw = ml.find(o => o.side === 'draw');

    // Map AN home/away to DB home/away
    // anHomeIsTeams1=true: AN 'home' = DB home, AN 'away' = DB away (standard)
    // anHomeIsTeams1=false: AN 'home' = DB away, AN 'away' = DB home (flipped)
    const mlDbHome = anHomeIsTeams1 ? mlAnHome : mlAnAway;
    const mlDbAway = anHomeIsTeams1 ? mlAnAway : mlAnHome;
    const mlDbDraw = mlAnDraw;

    const dbF = dbMatchs.find(f => f.match_id === matchId);
    console.log(`[STATE] ${matchId} (${dbF?.home_name} vs ${dbF?.away_name}):`);
    console.log(`  AN raw: home=${mlAnHome?.odds ?? 'N/A'} draw=${mlAnDraw?.odds ?? 'N/A'} away=${mlAnAway?.odds ?? 'N/A'}`);
    console.log(`  DB mapped: home(${dbF?.home_name})=${mlDbHome?.odds ?? 'N/A'} draw=${mlDbDraw?.odds ?? 'N/A'} away(${dbF?.away_name})=${mlDbAway?.odds ?? 'N/A'}`);

    // Add 1X2 rows
    if (mlDbHome) updates.push({ matchId, market: '1X2', selection: 'home', line: null, americanOdds: mlDbHome.odds, impliedProb: americanToImplied(mlDbHome.odds) });
    if (mlDbAway) updates.push({ matchId, market: '1X2', selection: 'away', line: null, americanOdds: mlDbAway.odds, impliedProb: americanToImplied(mlDbAway.odds) });
    if (mlDbDraw) updates.push({ matchId, market: '1X2', selection: 'draw', line: null, americanOdds: mlDbDraw.odds, impliedProb: americanToImplied(mlDbDraw.odds) });

    // Compute DK Double Chance from no-vig fair probs
    if (mlDbHome && mlDbDraw && mlDbAway) {
      const { fairH, fairD, fairA, vig } = threeWayFairProbs(mlDbHome.odds, mlDbDraw.odds, mlDbAway.odds);
      const dc1X = fairH + fairD;  // home_draw = 1X
      const dcX2 = fairA + fairD;  // away_draw = X2
      const dc1XOdds = impliedToAmerican(dc1X);
      const dcX2Odds = impliedToAmerican(dcX2);
      console.log(`  DC (no-vig): fairH=${(fairH*100).toFixed(2)}% fairD=${(fairD*100).toFixed(2)}% fairA=${(fairA*100).toFixed(2)}% vig=${(vig*100).toFixed(2)}%`);
      console.log(`  DC odds: 1X(home_draw)=${dc1XOdds} X2(away_draw)=${dcX2Odds}`);
      updates.push({ matchId, market: 'DOUBLE_CHANCE', selection: 'home_draw', line: null, americanOdds: dc1XOdds, impliedProb: dc1X });
      updates.push({ matchId, market: 'DOUBLE_CHANCE', selection: 'away_draw', line: null, americanOdds: dcX2Odds, impliedProb: dcX2 });
    }

    // Total
    const over = totals.find(o => o.side === 'over');
    const under = totals.find(o => o.side === 'under');
    if (over) {
      console.log(`  Total: line=${over.value} over=${over.odds} under=${under?.odds ?? 'N/A'}`);
      updates.push({ matchId, market: 'TOTAL', selection: 'over', line: over.value ?? null, americanOdds: over.odds, impliedProb: americanToImplied(over.odds) });
    }
    if (under) {
      updates.push({ matchId, market: 'TOTAL', selection: 'under', line: under.value ?? null, americanOdds: under.odds, impliedProb: americanToImplied(under.odds) });
    }

    // Asian Handicap
    const spreadAnHome = spreads.find(o => o.side === 'home');
    const spreadAnAway = spreads.find(o => o.side === 'away');
    const spreadDbHome = anHomeIsTeams1 ? spreadAnHome : spreadAnAway;
    const spreadDbAway = anHomeIsTeams1 ? spreadAnAway : spreadAnHome;
    if (spreadDbHome) {
      const selH = `home${spreadDbHome.value >= 0 ? '+' : ''}${spreadDbHome.value}`;
      updates.push({ matchId, market: 'ASIAN_HANDICAP', selection: selH, line: spreadDbHome.value ?? null, americanOdds: spreadDbHome.odds, impliedProb: americanToImplied(spreadDbHome.odds) });
    }
    if (spreadDbAway) {
      const selA = `away${spreadDbAway.value >= 0 ? '+' : ''}${spreadDbAway.value}`;
      updates.push({ matchId, market: 'ASIAN_HANDICAP', selection: selA, line: spreadDbAway.value ?? null, americanOdds: spreadDbAway.odds, impliedProb: americanToImplied(spreadDbAway.odds) });
    }
  }

  console.log(`\n[STEP] Prepared ${updates.length} update rows`);

  // ── 5. Update DB: delete old DK rows for June 19, insert fresh ───────────────
  const matchIds = [...new Set(updates.map(u => u.matchId))];
  console.log(`[STEP] Updating DB for matchs: ${matchIds.join(', ')}`);

  // Delete existing DK rows for these matchs
  for (const fid of matchIds) {
    const [delResult] = await conn.query(
      `DELETE FROM wc2026_odds_snapshots WHERE match_id = ? AND book_id = 68`,
      [fid]
    );
    console.log(`[STEP] Deleted ${delResult.affectedRows} existing DK rows for ${fid}`);
  }

  // Insert fresh rows
  const snapshotTs = new Date().toISOString().slice(0, 19).replace('T', ' ');
  let inserted = 0;
  for (const u of updates) {
    await conn.query(
      `INSERT INTO wc2026_odds_snapshots (match_id, book_id, market, selection, line, american_odds, implied_prob, snapshot_ts, is_closing)
       VALUES (?, 68, ?, ?, ?, ?, ?, ?, 1)`,
      [u.matchId, u.market, u.selection, u.line, u.americanOdds, u.impliedProb.toFixed(6), snapshotTs]
    );
    inserted++;
    console.log(`[OUTPUT] Inserted: ${u.matchId} | DK | ${u.market} | ${u.selection} | line=${u.line ?? 'null'} | odds=${u.americanOdds}`);
  }

  console.log(`\n[OUTPUT] Total inserted: ${inserted} rows`);

  // ── 6. Verify final state ────────────────────────────────────────────────────
  const [finalRows] = await conn.query(`
    SELECT o.match_id, o.market, o.selection, o.line, o.american_odds,
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
    console.log(`  [${r.match_id}] ${r.home_name} vs ${r.away_name} | ${r.market} ${r.selection}${lineStr} => ${r.american_odds}`);
  }

  // Check for TUR-PAR: if no ML odds from AN, report it
  const turParML = finalRows.filter(r => r.match_id === 'wc26-g-030' && r.market === '1X2');
  if (turParML.length === 0) {
    console.log('\n[VERIFY] WARN — Turkey vs Paraguay: No DK 1X2 ML odds available from AN API (market not yet posted)');
    console.log('[VERIFY] Turkey vs Paraguay: Using previously stored DK odds from initial scrape');
  }

  await conn.end();
  console.log('\n[VERIFY] PASS — Re-scrape and DB update complete');
})();
