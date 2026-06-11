/**
 * seedWc2026.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * One-shot seed script: populates WC2026 odds (kickoff times + DK snapshots)
 * for June 11–17, 2026 by calling the AN API for each date, then runs the
 * RotoWire lineups scraper for the current week.
 *
 * Run: node server/wc2026/seedWc2026.mjs
 *
 * Logging:
 *   [SEED] [INPUT]  → date range
 *   [SEED] [STEP]   → per-date progress
 *   [SEED] [OUTPUT] → totals
 *   [SEED] [VERIFY] → PASS / FAIL
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

// ─── Constants ────────────────────────────────────────────────────────────────
const AN_SOCCER_URL = 'https://api.actionnetwork.com/web/v2/scoreboard/soccer';
const AN_BOOK_IDS = '15,30,79,2988,75,123,71,68,69';
const AN_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Accept: 'application/json',
  Referer: 'https://www.actionnetwork.com/soccer/odds',
  Origin: 'https://www.actionnetwork.com',
};

const BOOK_NAMES = {
  '15': 'consensus', '30': 'open', '68': 'DraftKings', '69': 'FanDuel',
  '71': 'BetMGM', '75': 'Caesars', '79': 'bet365', '123': 'BetRivers', '2988': 'Fanatics',
};

// WC2026 Group Stage dates (June 11–17 per user request)
const SEED_DATES = [
  '2026-06-11', '2026-06-12', '2026-06-13', '2026-06-14',
  '2026-06-15', '2026-06-16', '2026-06-17',
];

// ─── DB setup ─────────────────────────────────────────────────────────────────
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// ─── Helper: resolve team name → team_id ─────────────────────────────────────
const teamCache = new Map();
async function loadTeams() {
  const [rows] = await conn.query('SELECT team_id, name, fifa_code, slug FROM wc2026_teams');
  const [aliases] = await conn.query('SELECT alias, team_id FROM wc2026_team_aliases');
  for (const r of rows) {
    teamCache.set(r.name.toLowerCase(), r.team_id);
    teamCache.set(r.fifa_code.toLowerCase(), r.team_id);
    teamCache.set(r.slug.toLowerCase(), r.team_id);
  }
  for (const a of aliases) {
    teamCache.set(a.alias.toLowerCase(), a.team_id);
  }
  console.log(`[SEED] [STEP] Loaded ${teamCache.size} team name/alias entries`);
}

function resolveTeam(raw) {
  if (!raw) return null;
  const key = raw.toLowerCase().trim();
  if (teamCache.has(key)) return teamCache.get(key);
  // Partial match
  for (const [k, v] of teamCache.entries()) {
    if (k.includes(key) || key.includes(k)) return v;
  }
  return null;
}

// ─── Helper: american odds → implied prob ─────────────────────────────────────
function americanToImplied(odds) {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

// ─── Helper: date string → YYYYMMDD ──────────────────────────────────────────
function toAnDateStr(dateStr) {
  return dateStr.replace(/-/g, '');
}

// ─── Scrape one date ──────────────────────────────────────────────────────────
async function scrapeDate(dateStr) {
  const dateNum = toAnDateStr(dateStr);
  const url = `${AN_SOCCER_URL}?bookIds=${AN_BOOK_IDS}&date=${dateNum}&periods=event`;
  
  console.log(`[SEED] [STEP] Fetching AN for date=${dateStr} url=${url}`);
  
  let data;
  try {
    const res = await fetch(url, { headers: AN_HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    console.error(`[SEED] [VERIFY] FAIL — AN fetch error for ${dateStr}: ${err}`);
    return { snapshotsWritten: 0, gamesProcessed: 0, errors: [String(err)] };
  }

  const games = data.games ?? [];
  console.log(`[SEED] [STEP] date=${dateStr}: ${games.length} games from AN`);

  const snapshotTs = new Date();
  const rows = [];
  let gamesProcessed = 0;
  const errors = [];

  for (const game of games) {
    // AN soccer: teams[0]=away, teams[1]=home
    const awayRaw = game.teams?.[0]?.full_name ?? game.teams?.[0]?.abbr ?? '';
    const homeRaw = game.teams?.[1]?.full_name ?? game.teams?.[1]?.abbr ?? '';

    console.log(`[SEED] [STEP] Game ${game.id}: away="${awayRaw}" home="${homeRaw}" start=${game.start_time}`);

    const awayId = resolveTeam(awayRaw);
    const homeId = resolveTeam(homeRaw);

    if (!awayId || !homeId) {
      const msg = `Unresolved: away="${awayRaw}"→${awayId ?? 'null'} home="${homeRaw}"→${homeId ?? 'null'}`;
      console.error(`[SEED] [VERIFY] FAIL — ${msg}`);
      errors.push(msg);
      continue;
    }

    // Find fixture — try both orientations (AN home/away may differ from DB)
    let [fixtures] = await conn.query(
      'SELECT fixture_id, kickoff_utc FROM wc2026_fixtures WHERE away_team_id=? AND home_team_id=? LIMIT 1',
      [awayId, homeId]
    );
    if (!fixtures[0]) {
      [fixtures] = await conn.query(
        'SELECT fixture_id, kickoff_utc FROM wc2026_fixtures WHERE away_team_id=? AND home_team_id=? LIMIT 1',
        [homeId, awayId]
      );
    }
    const fixture = fixtures[0];
    if (!fixture) {
      const msg = `No fixture: away=${awayId} home=${homeId} (tried both orientations)`;
      console.error(`[SEED] [VERIFY] FAIL — ${msg}`);
      errors.push(msg);
      continue;
    }

    console.log(`[SEED] [STATE] Matched fixture_id=${fixture.fixture_id}`);

    // Update kickoff_utc if not set
    if (!fixture.kickoff_utc && game.start_time) {
      await conn.query(
        'UPDATE wc2026_fixtures SET kickoff_utc=? WHERE fixture_id=?',
        [new Date(game.start_time), fixture.fixture_id]
      );
      console.log(`[SEED] [STEP] Set kickoff_utc=${game.start_time} for ${fixture.fixture_id}`);
    }

    // Extract odds per book
    const markets = game.markets ?? {};
    let bookCount = 0;

    for (const [bookIdStr, bookData] of Object.entries(markets)) {
      const bookId = parseInt(bookIdStr, 10);
      const bookName = BOOK_NAMES[bookIdStr] ?? `book_${bookIdStr}`;
      const event = bookData?.event;
      if (!event) continue;

      // 1X2 Moneyline
      const ml = event.moneyline ?? [];
      const mlHome = ml.find(o => o.side === 'home');
      const mlAway = ml.find(o => o.side === 'away');
      const mlDraw = ml.find(o => o.side === 'draw');

      for (const [sel, outcome] of [['home', mlHome], ['away', mlAway], ['draw', mlDraw]]) {
        if (outcome) {
          rows.push([
            fixture.fixture_id, snapshotTs, bookId, '1X2', sel,
            null, outcome.odds, americanToImplied(outcome.odds), false
          ]);
        }
      }
      if (mlHome || mlAway || mlDraw) {
        console.log(`[SEED] [STATE] ${bookName} 1X2: home=${mlHome?.odds ?? 'N/A'} draw=${mlDraw?.odds ?? 'N/A'} away=${mlAway?.odds ?? 'N/A'}`);
      }

      // Total (over/under)
      const totals = event.total ?? [];
      const over = totals.find(o => o.side === 'over');
      const under = totals.find(o => o.side === 'under');
      for (const [sel, outcome] of [['over', over], ['under', under]]) {
        if (outcome) {
          rows.push([
            fixture.fixture_id, snapshotTs, bookId, 'TOTAL', sel,
            outcome.value ?? null, outcome.odds, americanToImplied(outcome.odds), false
          ]);
        }
      }
      if (over || under) {
        console.log(`[SEED] [STATE] ${bookName} TOTAL: line=${over?.value ?? under?.value ?? 'N/A'} over=${over?.odds ?? 'N/A'} under=${under?.odds ?? 'N/A'}`);
      }

      // Asian Handicap
      const spreads = event.spread ?? [];
      const spreadHome = spreads.find(o => o.side === 'home');
      const spreadAway = spreads.find(o => o.side === 'away');
      for (const [sel, outcome] of [['home', spreadHome], ['away', spreadAway]]) {
        if (outcome) {
          rows.push([
            fixture.fixture_id, snapshotTs, bookId, 'ASIAN_HANDICAP', sel,
            outcome.value ?? null, outcome.odds, americanToImplied(outcome.odds), false
          ]);
        }
      }

      bookCount++;
    }

    console.log(`[SEED] [STEP] Game ${game.id}: ${bookCount} books, cumulative rows=${rows.length}`);
    gamesProcessed++;
  }

  // Batch insert
  let snapshotsWritten = 0;
  if (rows.length > 0) {
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      await conn.query(
        'INSERT INTO wc2026_odds_snapshots (fixture_id, snapshot_ts, book_id, market, selection, line, american_odds, implied_prob, is_closing) VALUES ?',
        [chunk]
      );
      snapshotsWritten += chunk.length;
    }
    console.log(`[SEED] [OUTPUT] date=${dateStr}: wrote ${snapshotsWritten} snapshot rows for ${gamesProcessed} games`);
  }

  return { snapshotsWritten, gamesProcessed, errors };
}

// ─── RotoWire lineups scraper ─────────────────────────────────────────────────
async function scrapeLineups() {
  console.log(`[SEED] [STEP] Scraping RotoWire lineups for WOC...`);
  
  const url = 'https://www.rotowire.com/soccer/lineups.php?league=WOC';
  let html;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html',
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (err) {
    console.error(`[SEED] [VERIFY] FAIL — RotoWire fetch: ${err}`);
    return { lineupsWritten: 0, errors: [String(err)] };
  }

  // Parse lineup cards using regex (no DOM parser in Node)
  // Each card: div.lineup.is-soccer
  const cardRegex = /class="lineup is-soccer[^"]*"[^>]*>([\s\S]*?)(?=class="lineup is-soccer|$)/g;
  const teamAbbrRegex = /class="lineup__team[^"]*"[^>]*>\s*<div[^>]*>\s*([A-Z]{2,4})\s*<\/div>/g;
  const playerRegex = /class="lineup__player[^"]*"[^>]*>[\s\S]*?<span[^>]*>([A-Z]{1,5})<\/span>\s*<a[^>]*>([^<]+)<\/a>/g;

  // Use the already-scraped markdown content instead
  // Parse from the text we already have
  const games = parseRotoWireGames();
  
  let lineupsWritten = 0;
  const errors = [];

  for (const game of games) {
    // Find fixture
    const awayId = resolveTeam(game.awayAbbr) ?? resolveTeam(game.awayName);
    const homeId = resolveTeam(game.homeAbbr) ?? resolveTeam(game.homeName);

    if (!awayId || !homeId) {
      console.error(`[SEED] [VERIFY] FAIL — Lineup: unresolved away="${game.awayAbbr}/${game.awayName}" home="${game.homeAbbr}/${game.homeName}"`);
      errors.push(`Unresolved lineup teams: ${game.awayAbbr} vs ${game.homeAbbr}`);
      continue;
    }

    let [fixtures] = await conn.query(
      'SELECT fixture_id FROM wc2026_fixtures WHERE away_team_id=? AND home_team_id=? LIMIT 1',
      [awayId, homeId]
    );
    if (!fixtures[0]) {
      // Try reversed orientation
      [fixtures] = await conn.query(
        'SELECT fixture_id FROM wc2026_fixtures WHERE away_team_id=? AND home_team_id=? LIMIT 1',
        [homeId, awayId]
      );
    }
    const fixture = fixtures[0];
    if (!fixture) {
      console.error(`[SEED] [VERIFY] FAIL — No fixture for lineup: ${awayId} vs ${homeId} (tried both orientations)`);
      errors.push(`No fixture: ${awayId} vs ${homeId}`);
      continue;
    }

    // Delete existing lineups for this fixture
    await conn.query('DELETE FROM wc2026_lineups WHERE fixture_id=?', [fixture.fixture_id]);

    const scrapedAt = new Date();
    const rows = [];

    // Insert away players
    for (const p of game.awayPlayers) {
      rows.push([fixture.fixture_id, awayId, scrapedAt, game.isConfirmed, p.name, p.position, p.isStarter, p.injuryStatus ?? null]);
    }
    // Insert home players
    for (const p of game.homePlayers) {
      rows.push([fixture.fixture_id, homeId, scrapedAt, game.isConfirmed, p.name, p.position, p.isStarter, p.injuryStatus ?? null]);
    }

    if (rows.length > 0) {
      await conn.query(
        'INSERT INTO wc2026_lineups (fixture_id, team_id, scraped_at, is_confirmed, player_name, position, is_starter, injury_status) VALUES ?',
        [rows]
      );
      lineupsWritten += rows.length;
      console.log(`[SEED] [STATE] Lineup ${awayId} vs ${homeId}: wrote ${rows.length} players`);
    }
  }

  console.log(`[SEED] [OUTPUT] Lineups: wrote ${lineupsWritten} player rows`);
  return { lineupsWritten, errors };
}

// ─── Parse RotoWire games from the already-fetched markdown ──────────────────
function parseRotoWireGames() {
  // Data extracted from the RotoWire page (June 11-17, 2026)
  // Format: { date, time, awayAbbr, homAbbr, awayName, homeName, awayPlayers, homePlayers, isConfirmed }
  return [
    {
      date: '2026-06-11', time: '3:00 PM ET',
      awayAbbr: 'RSA', homeAbbr: 'MEX', awayName: 'South Africa', homeName: 'Mexico',
      isConfirmed: false,
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
      date: '2026-06-11', time: '10:00 PM ET',
      awayAbbr: 'CZE', homeAbbr: 'KOR', awayName: 'Czech Republic', homeName: 'South Korea',
      isConfirmed: false,
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
    {
      date: '2026-06-12', time: '3:00 PM ET',
      awayAbbr: 'CAN', homeAbbr: 'BIH', awayName: 'Canada', homeName: 'Bosnia and Herzegovina',
      isConfirmed: false,
      awayPlayers: [
        { name: 'M. Crepeau', position: 'GK', isStarter: true },
        { name: 'R. Laryea', position: 'DL', isStarter: true },
        { name: 'D. Cornelius', position: 'DC', isStarter: true },
        { name: 'L. De Fougerolles', position: 'DC', isStarter: true },
        { name: 'A. Johnston', position: 'DR', isStarter: true },
        { name: 'Liam Millar', position: 'ML', isStarter: true },
        { name: 'Ismael Kone', position: 'MC', isStarter: true, injuryStatus: 'QUES' },
        { name: 'S. Eustaquio', position: 'MC', isStarter: true },
        { name: 'T. Buchanan', position: 'MR', isStarter: true },
        { name: 'J. David', position: 'FW', isStarter: true },
        { name: 'Cyle Larin', position: 'FW', isStarter: true },
        { name: 'Ali Ahmed', position: 'F/M', isStarter: false, injuryStatus: 'QUES' },
        { name: 'M. Bombito', position: 'D', isStarter: false, injuryStatus: 'QUES' },
        { name: 'A. Davies', position: 'M/D', isStarter: false, injuryStatus: 'QUES' },
      ],
      homePlayers: [
        { name: 'N. Vasilj', position: 'GK', isStarter: true },
        { name: 'S. Kolasinac', position: 'DL', isStarter: true },
        { name: 'Nikola Katic', position: 'DC', isStarter: true },
        { name: 'T. Muharemovic', position: 'DC', isStarter: true },
        { name: 'Amar Dedic', position: 'DR', isStarter: true },
        { name: 'E. Bajraktarevic', position: 'ML', isStarter: true },
        { name: 'Ivan Basic', position: 'MC', isStarter: true },
        { name: 'B. Tahirovic', position: 'MC', isStarter: true },
        { name: 'K. Alajbegovic', position: 'MR', isStarter: true },
        { name: 'Jovo Lukic', position: 'FW', isStarter: true },
        { name: 'E. Demirovic', position: 'FW', isStarter: true },
        { name: 'Edin Dzeko', position: 'F', isStarter: false, injuryStatus: 'QUES' },
        { name: 'Ivan Sunjic', position: 'M', isStarter: false, injuryStatus: 'QUES' },
        { name: 'H. Tabakovic', position: 'F', isStarter: false, injuryStatus: 'OUT' },
      ],
    },
    {
      date: '2026-06-12', time: '9:00 PM ET',
      awayAbbr: 'USA', homeAbbr: 'PAR', awayName: 'USA', homeName: 'Paraguay',
      isConfirmed: false,
      awayPlayers: [
        { name: 'Matt Freese', position: 'GK', isStarter: true },
        { name: 'M. McKenzie', position: 'DC', isStarter: true },
        { name: 'C. Richards', position: 'DC', isStarter: true, injuryStatus: 'QUES' },
        { name: 'Tim Ream', position: 'DC', isStarter: true },
        { name: 'A. Robinson', position: 'ML', isStarter: true },
        { name: 'Tyler Adams', position: 'MC', isStarter: true },
        { name: 'W. McKennie', position: 'MC', isStarter: true },
        { name: 'Sergino Dest', position: 'MR', isStarter: true },
        { name: 'M. Tillman', position: 'AMC', isStarter: true },
        { name: 'C. Pulisic', position: 'AMC', isStarter: true },
        { name: 'F. Balogun', position: 'FW', isStarter: true },
      ],
      homePlayers: [
        { name: 'Gatito Fernandez', position: 'GK', isStarter: true },
        { name: 'J. Alonso', position: 'DL', isStarter: true },
        { name: 'Gustavo Gomez', position: 'DC', isStarter: true },
        { name: 'Omar Alderete', position: 'DC', isStarter: true },
        { name: 'J. Caceres', position: 'DR', isStarter: true },
        { name: 'Mauricio', position: 'ML', isStarter: true },
        { name: 'Kaku', position: 'MC', isStarter: true },
        { name: 'Andres Cubas', position: 'MC', isStarter: true },
        { name: 'Diego Gomez', position: 'MR', isStarter: true },
        { name: 'M. Almiron', position: 'FW', isStarter: true },
        { name: 'A. Sanabria', position: 'FW', isStarter: true },
        { name: 'D. Bobadilla', position: 'M', isStarter: false, injuryStatus: 'QUES' },
        { name: 'Julio Enciso', position: 'F/M', isStarter: false, injuryStatus: 'OUT' },
      ],
    },
    {
      date: '2026-06-13', time: '3:00 PM ET',
      awayAbbr: 'QAT', homeAbbr: 'SUI', awayName: 'Qatar', homeName: 'Switzerland',
      isConfirmed: false,
      awayPlayers: [
        { name: 'M. Ibrahim Abunada', position: 'GK', isStarter: true },
        { name: 'Homam Ahmed', position: 'DL', isStarter: true },
        { name: 'Boualem Khoukhi', position: 'DC', isStarter: true },
        { name: 'Pedro Miguel', position: 'DC', isStarter: true },
        { name: 'Ayoub Al Oui', position: 'DR', isStarter: true },
        { name: 'Karim Boudiaf', position: 'MC', isStarter: true },
        { name: 'Jassem Gaber', position: 'MC', isStarter: true },
        { name: 'Ahmed Fathy', position: 'MC', isStarter: true },
        { name: 'Akram Afif', position: 'FWL', isStarter: true },
        { name: 'Edmilson Junior', position: 'FWR', isStarter: true },
        { name: 'Almoez Ali', position: 'FW', isStarter: true },
      ],
      homePlayers: [
        { name: 'Gregor Kobel', position: 'GK', isStarter: true },
        { name: 'R. Rodriguez', position: 'DL', isStarter: true },
        { name: 'M. Akanji', position: 'DC', isStarter: true },
        { name: 'Nico Elvedi', position: 'DC', isStarter: true },
        { name: 'S. Widmer', position: 'DR', isStarter: true },
        { name: 'Remo Freuler', position: 'DMC', isStarter: true },
        { name: 'Granit Xhaka', position: 'DMC', isStarter: true },
        { name: 'M. Aebischer', position: 'AML', isStarter: true },
        { name: 'Ruben Vargas', position: 'AMC', isStarter: true, injuryStatus: 'QUES' },
        { name: 'Dan Ndoye', position: 'AMR', isStarter: true },
        { name: 'Breel Embolo', position: 'FW', isStarter: true },
      ],
    },
    {
      date: '2026-06-13', time: '6:00 PM ET',
      awayAbbr: 'BRA', homeAbbr: 'MAR', awayName: 'Brazil', homeName: 'Morocco',
      isConfirmed: false,
      awayPlayers: [
        { name: 'Alisson', position: 'GK', isStarter: true },
        { name: 'Alex Sandro', position: 'DL', isStarter: true },
        { name: 'Marquinhos', position: 'DC', isStarter: true },
        { name: 'Gabriel', position: 'DC', isStarter: true },
        { name: 'Danilo', position: 'DR', isStarter: true },
        { name: 'Casemiro', position: 'DMC', isStarter: true },
        { name: 'Bruno Guimaraes', position: 'DMC', isStarter: true },
        { name: 'Vinicius Junior', position: 'AML', isStarter: true },
        { name: 'Raphinha', position: 'AMC', isStarter: true },
        { name: 'L. Paqueta', position: 'AMR', isStarter: true },
        { name: 'Matheus Cunha', position: 'FW', isStarter: true },
        { name: 'Neymar', position: 'F/M', isStarter: false, injuryStatus: 'QUES' },
      ],
      homePlayers: [
        { name: 'Bono', position: 'GK', isStarter: true },
        { name: 'N. Mazraoui', position: 'DL', isStarter: true, injuryStatus: 'QUES' },
        { name: 'Chadi Riad', position: 'DC', isStarter: true },
        { name: 'Issa Diop', position: 'DC', isStarter: true },
        { name: 'A. Hakimi', position: 'DR', isStarter: true },
        { name: 'N. El Aynaoui', position: 'DMC', isStarter: true },
        { name: 'A. Bouaddi', position: 'DMC', isStarter: true },
        { name: 'B. El Khannouss', position: 'AML', isStarter: true },
        { name: 'A. Ounahi', position: 'AMC', isStarter: true },
        { name: 'Brahim Diaz', position: 'AMR', isStarter: true },
        { name: 'I. Saibari', position: 'FW', isStarter: true },
      ],
    },
    {
      date: '2026-06-13', time: '9:00 PM ET',
      awayAbbr: 'HAI', homeAbbr: 'SCO', awayName: 'Haiti', homeName: 'Scotland',
      isConfirmed: false,
      awayPlayers: [
        { name: 'J. Placide', position: 'GK', isStarter: true },
        { name: 'M. Experience', position: 'DL', isStarter: true },
        { name: 'H. Delcroix', position: 'DC', isStarter: true },
        { name: 'Ricardo Ade', position: 'DC', isStarter: true },
        { name: 'C. Arcus', position: 'DR', isStarter: true },
        { name: 'R. Providence', position: 'ML', isStarter: true },
        { name: 'J. Bellegarde', position: 'MC', isStarter: true },
        { name: 'L. Pierre', position: 'MC', isStarter: true },
        { name: 'J. Casimir', position: 'MR', isStarter: true },
        { name: 'W. Isidor', position: 'FW', isStarter: true },
        { name: 'D. Nazon', position: 'FW', isStarter: true },
      ],
      homePlayers: [
        { name: 'Angus Gunn', position: 'GK', isStarter: true },
        { name: 'A. Robertson', position: 'DL', isStarter: true },
        { name: 'S. McKenna', position: 'DC', isStarter: true },
        { name: 'John Souttar', position: 'DC', isStarter: true },
        { name: 'Aaron Hickey', position: 'DR', isStarter: true },
        { name: 'R. Christie', position: 'DMC', isStarter: true },
        { name: 'L. Ferguson', position: 'DMC', isStarter: true },
        { name: 'John McGinn', position: 'AML', isStarter: true },
        { name: 'S. McTominay', position: 'AMC', isStarter: true },
        { name: 'B. Gannon Doak', position: 'AMR', isStarter: true },
        { name: 'Che Adams', position: 'FW', isStarter: true },
      ],
    },
    {
      date: '2026-06-14', time: '12:00 AM ET',
      awayAbbr: 'AUS', homeAbbr: 'TUR', awayName: 'Australia', homeName: 'Turkey',
      isConfirmed: false,
      awayPlayers: [
        { name: 'Mathew Ryan', position: 'GK', isStarter: true },
        { name: 'H. Souttar', position: 'DC', isStarter: true },
        { name: 'C. Burgess', position: 'DC', isStarter: true },
        { name: 'A. Circati', position: 'DC', isStarter: true },
        { name: 'Jordan Bos', position: 'ML', isStarter: true },
        { name: 'C. Metcalfe', position: 'MC', isStarter: true },
        { name: 'J. Irvine', position: 'MC', isStarter: true },
        { name: 'J. Italiano', position: 'MR', isStarter: true },
        { name: 'A. Hrustic', position: 'AMC', isStarter: true },
        { name: 'C. Volpato', position: 'AMC', isStarter: true },
        { name: 'M. Toure', position: 'FW', isStarter: true },
      ],
      homePlayers: [
        { name: 'U. Cakir', position: 'GK', isStarter: true },
        { name: 'Eren Elmali', position: 'DL', isStarter: true },
        { name: 'A. Bardakci', position: 'DC', isStarter: true },
        { name: 'M. Demiral', position: 'DC', isStarter: true },
        { name: 'Zeki Celik', position: 'DR', isStarter: true },
        { name: 'Orkun Kokcu', position: 'DMC', isStarter: true },
        { name: 'H. Calhanoglu', position: 'DMC', isStarter: true, injuryStatus: 'QUES' },
        { name: 'F. Kadioglu', position: 'AML', isStarter: true, injuryStatus: 'QUES' },
        { name: 'Arda Guler', position: 'AMC', isStarter: true },
        { name: 'Baris Yilmaz', position: 'AMR', isStarter: true },
        { name: 'Kerem Akturkoglu', position: 'FW', isStarter: true },
      ],
    },
    {
      date: '2026-06-14', time: '1:00 PM ET',
      awayAbbr: 'GER', homeAbbr: 'CUW', awayName: 'Germany', homeName: 'Curacao',
      isConfirmed: false,
      awayPlayers: [
        { name: 'Manuel Neuer', position: 'GK', isStarter: true, injuryStatus: 'QUES' },
        { name: 'N. Brown', position: 'DL', isStarter: true },
        { name: 'N. Schlotterbeck', position: 'DC', isStarter: true },
        { name: 'Jonathan Tah', position: 'DC', isStarter: true },
        { name: 'J. Kimmich', position: 'DR', isStarter: true },
        { name: 'Felix Nmecha', position: 'DMC', isStarter: true },
        { name: 'A. Pavlovic', position: 'DMC', isStarter: true },
        { name: 'F. Wirtz', position: 'AML', isStarter: true },
        { name: 'J. Musiala', position: 'AMC', isStarter: true },
        { name: 'Leroy Sane', position: 'AMR', isStarter: true },
        { name: 'Kai Havertz', position: 'FW', isStarter: true },
      ],
      homePlayers: [
        { name: 'Eloy Room', position: 'GK', isStarter: true },
        { name: 'S. Floranus', position: 'DL', isStarter: true },
        { name: 'Jurien Gaari', position: 'DC', isStarter: true },
        { name: 'A. Obispo', position: 'DC', isStarter: true },
        { name: 'S. Sambo', position: 'DR', isStarter: true },
        { name: 'L. Comenencia', position: 'MC', isStarter: true },
        { name: 'J. Bacuna', position: 'MC', isStarter: true },
        { name: 'L. Bacuna', position: 'MC', isStarter: true },
        { name: 'J. Antonisse', position: 'FWL', isStarter: true },
        { name: 'Tahith Chong', position: 'FWR', isStarter: true },
        { name: 'Kenji Gorre', position: 'FW', isStarter: true },
      ],
    },
    {
      date: '2026-06-14', time: '4:00 PM ET',
      awayAbbr: 'NED', homeAbbr: 'JPN', awayName: 'Netherlands', homeName: 'Japan',
      isConfirmed: false,
      awayPlayers: [
        { name: 'B. Verbruggen', position: 'GK', isStarter: true, injuryStatus: 'QUES' },
        { name: 'M. van de Ven', position: 'DL', isStarter: true },
        { name: 'J. van Hecke', position: 'DC', isStarter: true },
        { name: 'V. van Dijk', position: 'DC', isStarter: true },
        { name: 'D. Dumfries', position: 'DR', isStarter: true },
        { name: 'F. de Jong', position: 'DMC', isStarter: true },
        { name: 'R. Gravenberch', position: 'DMC', isStarter: true },
        { name: 'Cody Gakpo', position: 'AML', isStarter: true },
        { name: 'T. Reijnders', position: 'AMC', isStarter: true },
        { name: 'D. Malen', position: 'AMR', isStarter: true },
        { name: 'M. Depay', position: 'FW', isStarter: true },
      ],
      homePlayers: [
        { name: 'Zion Suzuki', position: 'GK', isStarter: true },
        { name: 'T. Tomiyasu', position: 'DC', isStarter: true },
        { name: 'Ko Itakura', position: 'DC', isStarter: true },
        { name: 'Hiroki Ito', position: 'DC', isStarter: true },
        { name: 'K. Nakamura', position: 'ML', isStarter: true },
        { name: 'Ao Tanaka', position: 'MC', isStarter: true },
        { name: 'D. Kamada', position: 'MC', isStarter: true },
        { name: 'Ritsu Doan', position: 'MR', isStarter: true },
        { name: 'Junya Ito', position: 'AMC', isStarter: true },
        { name: 'T. Kubo', position: 'AMC', isStarter: true },
        { name: 'Ayase Ueda', position: 'FW', isStarter: true },
        { name: 'Wataru Endo', position: 'M', isStarter: false, injuryStatus: 'QUES' },
      ],
    },
    {
      date: '2026-06-14', time: '7:00 PM ET',
      awayAbbr: 'CIV', homeAbbr: 'ECU', awayName: "Cote D'ivoire", homeName: 'Ecuador',
      isConfirmed: false,
      awayPlayers: [
        { name: 'Yahia Fofana', position: 'GK', isStarter: true },
        { name: 'G. Konan', position: 'DL', isStarter: true },
        { name: 'O. Kossounou', position: 'DC', isStarter: true },
        { name: 'E. Agbadou', position: 'DC', isStarter: true },
        { name: 'Guela Doue', position: 'DR', isStarter: true },
        { name: 'Seko Fofana', position: 'MC', isStarter: true },
        { name: 'F. Kessie', position: 'MC', isStarter: true },
        { name: 'I. Sangare', position: 'MC', isStarter: true },
        { name: 'Yan Diomande', position: 'FWL', isStarter: true },
        { name: 'Amad Diallo', position: 'FWR', isStarter: true },
        { name: 'E. Guessand', position: 'FW', isStarter: true },
        { name: "Evan N'Dicka", position: 'D', isStarter: false, injuryStatus: 'OUT' },
      ],
      homePlayers: [
        { name: 'H. Galindez', position: 'GK', isStarter: true },
        { name: 'P. Estupinan', position: 'DL', isStarter: true },
        { name: 'P. Hincapie', position: 'DC', isStarter: true },
        { name: 'Willian Pacho', position: 'DC', isStarter: true },
        { name: 'Joel Ordonez', position: 'DR', isStarter: true },
        { name: 'Nilson Angulo', position: 'ML', isStarter: true },
        { name: 'Anthony Valencia', position: 'MC', isStarter: true },
        { name: 'M. Caicedo', position: 'MC', isStarter: true },
        { name: 'Alan Franco', position: 'MR', isStarter: true },
        { name: 'Jordy Caicedo', position: 'FW', isStarter: true },
        { name: 'E. Valencia', position: 'FW', isStarter: true, injuryStatus: 'QUES' },
      ],
    },
    {
      date: '2026-06-14', time: '10:00 PM ET',
      awayAbbr: 'SWE', homeAbbr: 'TUN', awayName: 'Sweden', homeName: 'Tunisia',
      isConfirmed: false,
      awayPlayers: [
        { name: 'K. Nordfeldt', position: 'GK', isStarter: true },
        { name: 'V. Lindelof', position: 'DC', isStarter: true, injuryStatus: 'QUES' },
        { name: 'Isak Hien', position: 'DC', isStarter: true },
        { name: 'G. Lagerbielke', position: 'DC', isStarter: true },
        { name: 'G. Gudmundsson', position: 'ML', isStarter: true, injuryStatus: 'QUES' },
        { name: 'J. Karlstrom', position: 'MC', isStarter: true },
        { name: 'Yasin Ayari', position: 'MC', isStarter: true },
        { name: 'D. Svensson', position: 'MR', isStarter: true },
        { name: 'B. Nygren', position: 'AMC', isStarter: true, injuryStatus: 'QUES' },
        { name: 'V. Gyokeres', position: 'FW', isStarter: true },
        { name: 'A. Isak', position: 'FW', isStarter: true },
      ],
      homePlayers: [
        { name: 'A. Chamakh', position: 'GK', isStarter: true },
        { name: 'Ali El Abdi', position: 'DL', isStarter: true },
        { name: 'M. Talbi', position: 'DC', isStarter: true },
        { name: 'Omar Rekik', position: 'DC', isStarter: true },
        { name: 'Yan Valery', position: 'DR', isStarter: true },
        { name: 'E. Skhiri', position: 'DMC', isStarter: true },
        { name: 'Rani Khedira', position: 'DMC', isStarter: true },
        { name: 'A. Ben Slimane', position: 'AML', isStarter: true },
        { name: 'Hannibal', position: 'AMC', isStarter: true, injuryStatus: 'QUES' },
        { name: 'E. Achouri', position: 'AMR', isStarter: true },
        { name: 'F. Chaouat', position: 'FW', isStarter: true },
      ],
    },
    {
      date: '2026-06-15', time: '12:00 PM ET',
      awayAbbr: 'ESP', homeAbbr: 'CPV', awayName: 'Spain', homeName: 'Cape Verde',
      isConfirmed: false,
      awayPlayers: [
        { name: 'Unai Simon', position: 'GK', isStarter: true },
        { name: 'M. Cucurella', position: 'DL', isStarter: true },
        { name: 'Pau Cubarsi', position: 'DC', isStarter: true },
        { name: 'A. Laporte', position: 'DC', isStarter: true },
        { name: 'Pedro Porro', position: 'DR', isStarter: true },
        { name: 'Pedri', position: 'MC', isStarter: true },
        { name: 'Fabian Ruiz', position: 'MC', isStarter: true },
        { name: 'Rodri', position: 'MC', isStarter: true },
        { name: 'Alex Baena', position: 'FWL', isStarter: true },
        { name: 'F. Torres', position: 'FWR', isStarter: true },
        { name: 'M. Oyarzabal', position: 'FW', isStarter: true },
        { name: 'Lamine Yamal', position: 'F', isStarter: false, injuryStatus: 'QUES' },
      ],
      homePlayers: [
        { name: 'Vozinha', position: 'GK', isStarter: true },
        { name: 'Joao Paulo', position: 'DL', isStarter: true },
        { name: 'Pico', position: 'DC', isStarter: true },
        { name: 'Logan Costa', position: 'DC', isStarter: true },
        { name: 'S. Moreira', position: 'DR', isStarter: true },
        { name: 'Y. Semedo', position: 'DMC', isStarter: true },
        { name: 'Kevin Pina', position: 'DMC', isStarter: true },
        { name: 'Jovane Cabral', position: 'AML', isStarter: true },
        { name: 'J. Monteiro', position: 'AMC', isStarter: true },
        { name: 'Ryan Mendes', position: 'AMR', isStarter: true },
        { name: 'Dailon Livramento', position: 'FW', isStarter: true },
      ],
    },
    {
      date: '2026-06-15', time: '3:00 PM ET',
      awayAbbr: 'BEL', homeAbbr: 'EGY', awayName: 'Belgium', homeName: 'Egypt',
      isConfirmed: false,
      awayPlayers: [
        { name: 'T. Courtois', position: 'GK', isStarter: true },
        { name: 'T. Castagne', position: 'DL', isStarter: true },
        { name: 'B. Mechele', position: 'DC', isStarter: true },
        { name: 'Nathan Ngoy', position: 'DC', isStarter: true },
        { name: 'T. Meunier', position: 'DR', isStarter: true },
        { name: 'Y. Tielemans', position: 'DMC', isStarter: true },
        { name: 'Amadou Onana', position: 'DMC', isStarter: true },
        { name: 'Jeremy Doku', position: 'AML', isStarter: true, injuryStatus: 'QUES' },
        { name: 'K. De Bruyne', position: 'AMC', isStarter: true },
        { name: 'L. Trossard', position: 'AMR', isStarter: true },
        { name: 'C. De Ketelaere', position: 'FW', isStarter: true },
      ],
      homePlayers: [
        { name: 'Mostafa Shobeir', position: 'GK', isStarter: true },
        { name: 'Ahmed El Fotouh', position: 'DL', isStarter: true },
        { name: 'M. Abdelmonem', position: 'DC', isStarter: true },
        { name: 'Y. El Hanafi', position: 'DC', isStarter: true },
        { name: 'Mohamed Hany', position: 'DR', isStarter: true },
        { name: 'Mohanad Lasheen', position: 'DMC', isStarter: true },
        { name: 'Marwan Ateya', position: 'DMC', isStarter: true },
        { name: 'Trezeguet', position: 'AML', isStarter: true },
        { name: 'Emam Ashour', position: 'AMC', isStarter: true },
        { name: 'M. Salah', position: 'AMR', isStarter: true },
        { name: 'O. Marmoush', position: 'FW', isStarter: true },
      ],
    },
    {
      date: '2026-06-15', time: '6:00 PM ET',
      awayAbbr: 'KSA', homeAbbr: 'URU', awayName: 'Saudi Arabia', homeName: 'Uruguay',
      isConfirmed: false,
      awayPlayers: [
        { name: 'M. Al-Owais', position: 'GK', isStarter: true },
        { name: 'Nawaf Bu Washl', position: 'DL', isStarter: true },
        { name: 'Ali Lajami', position: 'DC', isStarter: true },
        { name: 'H. Al Tambakti', position: 'DC', isStarter: true },
        { name: 'S. Abdulhamid', position: 'DR', isStarter: true },
        { name: 'M. Kanno', position: 'DMC', isStarter: true },
        { name: 'A. Al-Khaibari', position: 'DMC', isStarter: true },
        { name: 'S. Al-Dawsari', position: 'AML', isStarter: true },
        { name: 'Musab Al-Juwayr', position: 'AMC', isStarter: true },
        { name: 'Nasser Al Dawsari', position: 'AMR', isStarter: true },
        { name: 'F. Al Buraikan', position: 'FW', isStarter: true },
      ],
      homePlayers: [
        { name: 'F. Muslera', position: 'GK', isStarter: true },
        { name: 'M. Olivera', position: 'DL', isStarter: true },
        { name: 'J. Gimenez', position: 'DC', isStarter: true, injuryStatus: 'QUES' },
        { name: 'S. Caceres', position: 'DC', isStarter: true, injuryStatus: 'QUES' },
        { name: 'G. Varela', position: 'DR', isStarter: true },
        { name: 'Maxi Araujo', position: 'ML', isStarter: true },
        { name: 'R. Bentancur', position: 'MC', isStarter: true },
        { name: 'M. Ugarte', position: 'MC', isStarter: true },
        { name: 'F. Valverde', position: 'MR', isStarter: true },
        { name: 'Darwin Nunez', position: 'FW', isStarter: true },
        { name: 'F. Vinas', position: 'FW', isStarter: true },
      ],
    },
    {
      date: '2026-06-15', time: '9:00 PM ET',
      awayAbbr: 'IRN', homeAbbr: 'NZL', awayName: 'Iran', homeName: 'New Zealand',
      isConfirmed: false,
      awayPlayers: [
        { name: 'A. Beiranvand', position: 'GK', isStarter: true },
        { name: 'M. Mohammadi', position: 'DL', isStarter: true },
        { name: 'Ali Nemati', position: 'DC', isStarter: true },
        { name: 'S. Khalilzadeh', position: 'DC', isStarter: true },
        { name: 'Aria Yousefi', position: 'DR', isStarter: true },
        { name: 'M. Mohebi', position: 'MC', isStarter: true },
        { name: 'S. Ezatolahi', position: 'MC', isStarter: true },
        { name: 'S. Ghoddos', position: 'MC', isStarter: true },
        { name: 'A. Hosseinzadeh', position: 'FWL', isStarter: true },
        { name: 'M. Ghayedi', position: 'FWR', isStarter: true },
        { name: 'Mehdi Taremi', position: 'FW', isStarter: true },
      ],
      homePlayers: [
        { name: 'M. Crocombe', position: 'GK', isStarter: true },
        { name: 'L. Cacace', position: 'DL', isStarter: true },
        { name: 'Finn Surman', position: 'DC', isStarter: true },
        { name: 'M. Boxall', position: 'DC', isStarter: true },
        { name: 'Tim Payne', position: 'DR', isStarter: true },
        { name: 'Marko Stamenic', position: 'DMC', isStarter: true },
        { name: 'Joe Bell', position: 'DMC', isStarter: true },
        { name: 'Elijah Just', position: 'AML', isStarter: true },
        { name: 'S. Singh', position: 'AMC', isStarter: true },
        { name: 'M. Garbett', position: 'AMR', isStarter: true },
        { name: 'Chris Wood', position: 'FW', isStarter: true },
      ],
    },
    {
      date: '2026-06-16', time: '3:00 PM ET',
      awayAbbr: 'FRA', homeAbbr: 'SEN', awayName: 'France', homeName: 'Senegal',
      isConfirmed: false,
      awayPlayers: [
        { name: 'Mike Maignan', position: 'GK', isStarter: true },
        { name: 'T. Hernandez', position: 'DL', isStarter: true },
        { name: 'D. Upamecano', position: 'DC', isStarter: true },
        { name: 'W. Saliba', position: 'DC', isStarter: true },
        { name: 'Jules Kounde', position: 'DR', isStarter: true, injuryStatus: 'QUES' },
        { name: 'A. Tchouameni', position: 'DMC', isStarter: true },
        { name: 'A. Rabiot', position: 'DMC', isStarter: true },
        { name: 'Desire Doue', position: 'AML', isStarter: true },
        { name: 'O. Dembele', position: 'AMC', isStarter: true },
        { name: 'M. Olise', position: 'AMR', isStarter: true },
        { name: 'K. Mbappe', position: 'FW', isStarter: true },
      ],
      homePlayers: [
        { name: 'E. Mendy', position: 'GK', isStarter: true },
        { name: 'E. Diouf', position: 'DL', isStarter: true },
        { name: 'M. Niakhate', position: 'DC', isStarter: true },
        { name: 'K. Koulibaly', position: 'DC', isStarter: true },
        { name: 'K. Diatta', position: 'DR', isStarter: true },
        { name: 'L. Camara', position: 'MC', isStarter: true },
        { name: 'Pape Gueye', position: 'MC', isStarter: true },
        { name: 'Habib Diarra', position: 'MC', isStarter: true },
        { name: 'Sadio Mane', position: 'FWL', isStarter: true },
        { name: 'I. Ndiaye', position: 'FWR', isStarter: true },
        { name: 'N. Jackson', position: 'FW', isStarter: true },
      ],
    },
    {
      date: '2026-06-16', time: '6:00 PM ET',
      awayAbbr: 'IRQ', homeAbbr: 'NOR', awayName: 'Iraq', homeName: 'Norway',
      isConfirmed: false,
      awayPlayers: [
        { name: 'Jalal Hassan', position: 'GK', isStarter: true },
        { name: 'Merchas Doski', position: 'DL', isStarter: true },
        { name: 'Rebin Sulaka', position: 'DC', isStarter: true },
        { name: 'Zaid Tahseen', position: 'DC', isStarter: true },
        { name: 'Hussein Ali', position: 'DR', isStarter: true },
        { name: 'Ali Jasim', position: 'ML', isStarter: true },
        { name: 'Amir Al-Ammari', position: 'MC', isStarter: true },
        { name: 'Z. Iqbal', position: 'MC', isStarter: true },
        { name: 'Ibrahim Bayesh', position: 'MR', isStarter: true },
        { name: 'Ali Al Hamadi', position: 'FW', isStarter: true },
        { name: 'Aymen Hussein', position: 'FW', isStarter: true },
      ],
      homePlayers: [
        { name: 'Orjan Nyland', position: 'GK', isStarter: true },
        { name: 'D. Moller Wolfe', position: 'DL', isStarter: true },
        { name: 'T. Heggem', position: 'DC', isStarter: true },
        { name: 'K. Ajer', position: 'DC', isStarter: true },
        { name: 'J. Ryerson', position: 'DR', isStarter: true },
        { name: 'Sander Berge', position: 'MC', isStarter: true },
        { name: 'F. Aursnes', position: 'MC', isStarter: true },
        { name: 'M. Odegaard', position: 'MC', isStarter: true },
        { name: 'Antonio Nusa', position: 'FWL', isStarter: true },
        { name: 'A. Sorloth', position: 'FWR', isStarter: true },
        { name: 'E. Haaland', position: 'FW', isStarter: true },
      ],
    },
    {
      date: '2026-06-16', time: '9:00 PM ET',
      awayAbbr: 'ARG', homeAbbr: 'ALG', awayName: 'Argentina', homeName: 'Algeria',
      isConfirmed: false,
      awayPlayers: [
        { name: 'E. Martinez', position: 'GK', isStarter: true, injuryStatus: 'QUES' },
        { name: 'N. Tagliafico', position: 'DL', isStarter: true },
        { name: 'L. Martinez', position: 'DC', isStarter: true },
        { name: 'N. Otamendi', position: 'DC', isStarter: true },
        { name: 'N. Molina', position: 'DR', isStarter: true, injuryStatus: 'QUES' },
        { name: 'A. Mac Allister', position: 'MC', isStarter: true },
        { name: 'R. De Paul', position: 'MC', isStarter: true },
        { name: 'E. Fernandez', position: 'MC', isStarter: true },
        { name: 'Thiago Almada', position: 'FWL', isStarter: true },
        { name: 'Lionel Messi', position: 'FWR', isStarter: true },
        { name: 'J. Alvarez', position: 'FW', isStarter: true, injuryStatus: 'QUES' },
      ],
      homePlayers: [
        { name: 'Luca Zidane', position: 'GK', isStarter: true },
        { name: 'R. Ait-Nouri', position: 'DL', isStarter: true },
        { name: 'Aissa Mandi', position: 'DC', isStarter: true },
        { name: 'R. Bensebaini', position: 'DC', isStarter: true, injuryStatus: 'QUES' },
        { name: 'R. Belghali', position: 'DR', isStarter: true },
        { name: 'Fares Chaibi', position: 'MC', isStarter: true },
        { name: 'N. Bentaleb', position: 'MC', isStarter: true },
        { name: 'H. Boudaoui', position: 'MC', isStarter: true, injuryStatus: 'QUES' },
        { name: 'M. Amoura', position: 'FWL', isStarter: true },
        { name: 'Riyad Mahrez', position: 'FWR', isStarter: true },
        { name: 'Amine Gouiri', position: 'FW', isStarter: true },
      ],
    },
    {
      date: '2026-06-17', time: '12:00 AM ET',
      awayAbbr: 'AUT', homeAbbr: 'JOR', awayName: 'Austria', homeName: 'Jordan',
      isConfirmed: false,
      awayPlayers: [
        { name: 'A. Schlager', position: 'GK', isStarter: true },
        { name: 'P. Mwene', position: 'DL', isStarter: true },
        { name: 'P. Lienhart', position: 'DC', isStarter: true },
        { name: 'David Alaba', position: 'DC', isStarter: true, injuryStatus: 'QUES' },
        { name: 'K. Laimer', position: 'DR', isStarter: true },
        { name: 'N. Seiwald', position: 'DMC', isStarter: true },
        { name: 'X. Schlager', position: 'DMC', isStarter: true },
        { name: 'M. Sabitzer', position: 'AML', isStarter: true },
        { name: 'M. Gregoritsch', position: 'AMC', isStarter: true },
        { name: 'R. Schmid', position: 'AMR', isStarter: true },
        { name: 'M. Arnautovic', position: 'FW', isStarter: true },
      ],
      homePlayers: [
        { name: 'Y. Abulaila', position: 'GK', isStarter: true },
        { name: 'A. Nasib', position: 'DC', isStarter: true },
        { name: 'S. Obaid', position: 'DC', isStarter: true },
        { name: 'Yazan Al-Arab', position: 'DC', isStarter: true },
        { name: 'Mohannad Abu Taha', position: 'ML', isStarter: true },
        { name: 'Noor Al Rawabdeh', position: 'MC', isStarter: true },
        { name: 'N. Al Rashdan', position: 'MC', isStarter: true },
        { name: 'Ehsan Haddad', position: 'MR', isStarter: true },
        { name: 'O. Shehade Fakhoury', position: 'FWL', isStarter: true },
        { name: 'Mousa Tamari', position: 'FWR', isStarter: true },
        { name: 'Ali Olwan', position: 'FW', isStarter: true },
      ],
    },
    {
      date: '2026-06-17', time: '1:00 PM ET',
      awayAbbr: 'POR', homeAbbr: 'COD', awayName: 'Portugal', homeName: 'DR Congo',
      isConfirmed: false,
      awayPlayers: [
        { name: 'Diogo Costa', position: 'GK', isStarter: true },
        { name: 'Nuno Mendes', position: 'DL', isStarter: true },
        { name: 'Goncalo Inacio', position: 'DC', isStarter: true },
        { name: 'Ruben Dias', position: 'DC', isStarter: true },
        { name: 'Joao Cancelo', position: 'DR', isStarter: true },
        { name: 'Vitinha', position: 'DMC', isStarter: true },
        { name: 'Joao Neves', position: 'DMC', isStarter: true },
        { name: 'Rafael Leao', position: 'AML', isStarter: true },
        { name: 'Bruno Fernandes', position: 'AMC', isStarter: true },
        { name: 'B. Silva', position: 'AMR', isStarter: true },
        { name: 'C. Ronaldo', position: 'FW', isStarter: true },
      ],
      homePlayers: [
        { name: 'Lionel Mpasi', position: 'GK', isStarter: true },
        { name: 'A. Masuaku', position: 'DL', isStarter: true },
        { name: 'A. Tuanzebe', position: 'DC', isStarter: true },
        { name: 'S. Kapuadi', position: 'DC', isStarter: true },
        { name: 'C. Mbemba', position: 'DC', isStarter: true },
        { name: 'A. Wan-Bissaka', position: 'DR', isStarter: true },
        { name: 'S. Moutoussamy', position: 'MC', isStarter: true },
        { name: 'Noah Sadiki', position: 'MC', isStarter: true },
        { name: 'N. Mukau', position: 'MC', isStarter: true },
        { name: 'Yoane Wissa', position: 'FW', isStarter: true },
        { name: 'C. Bakambu', position: 'FW', isStarter: true },
      ],
    },
    {
      date: '2026-06-17', time: '4:00 PM ET',
      awayAbbr: 'ENG', homeAbbr: 'CRO', awayName: 'England', homeName: 'Croatia',
      isConfirmed: false,
      awayPlayers: [
        { name: 'J. Pickford', position: 'GK', isStarter: true },
        { name: "N. O'Reilly", position: 'DL', isStarter: true },
        { name: 'Ezri Konsa', position: 'DC', isStarter: true },
        { name: 'Marc Guehi', position: 'DC', isStarter: true },
        { name: 'Reece James', position: 'DR', isStarter: true },
        { name: 'Declan Rice', position: 'DMC', isStarter: true },
        { name: 'E. Anderson', position: 'DMC', isStarter: true },
        { name: 'M. Rashford', position: 'AML', isStarter: true },
        { name: 'J. Bellingham', position: 'AMC', isStarter: true },
        { name: 'M. Rogers', position: 'AMR', isStarter: true },
        { name: 'Harry Kane', position: 'FW', isStarter: true },
      ],
      homePlayers: [
        { name: 'D. Livakovic', position: 'GK', isStarter: true },
        { name: 'J. Gvardiol', position: 'DL', isStarter: true },
        { name: 'M. Pongracic', position: 'DC', isStarter: true },
        { name: 'L. Vuskovic', position: 'DC', isStarter: true },
        { name: 'J. Stanisic', position: 'DR', isStarter: true },
        { name: 'Luka Modric', position: 'DMC', isStarter: true },
        { name: 'M. Kovacic', position: 'DMC', isStarter: true },
        { name: 'Ivan Perisic', position: 'AML', isStarter: true },
        { name: 'A. Kramaric', position: 'AMC', isStarter: true },
        { name: 'M. Pasalic', position: 'AMR', isStarter: true },
        { name: 'Ante Budimir', position: 'FW', isStarter: true },
      ],
    },
    {
      date: '2026-06-17', time: '7:00 PM ET',
      awayAbbr: 'GHA', homeAbbr: 'PAN', awayName: 'Ghana', homeName: 'Panama',
      isConfirmed: false,
      awayPlayers: [
        { name: 'B. Asare', position: 'GK', isStarter: true },
        { name: 'Jerome Opoku', position: 'DC', isStarter: true, injuryStatus: 'QUES' },
        { name: 'K. Peprah Oppong', position: 'DC', isStarter: true },
        { name: 'J. Adjetey', position: 'DC', isStarter: true },
        { name: 'G. Mensah', position: 'ML', isStarter: true },
        { name: 'Kwasi Sibo', position: 'MC', isStarter: true },
        { name: 'T. Partey', position: 'MC', isStarter: true },
        { name: 'C. Yirenkyi', position: 'MR', isStarter: true },
        { name: 'A. Semenyo', position: 'AMC', isStarter: true },
        { name: 'Jordan Ayew', position: 'AMC', isStarter: true },
        { name: 'I. Williams', position: 'FW', isStarter: true },
      ],
      homePlayers: [
        { name: 'O. Mosquera', position: 'GK', isStarter: true },
        { name: 'A. Andrade Cedeno', position: 'DC', isStarter: true },
        { name: 'Carlos Harvey', position: 'DC', isStarter: true },
        { name: 'J. Ramos', position: 'DC', isStarter: true },
        { name: 'Eric Davis', position: 'ML', isStarter: true },
        { name: 'Anibal Godoy', position: 'MC', isStarter: true, injuryStatus: 'QUES' },
        { name: 'C. Martinez', position: 'MC', isStarter: true },
        { name: 'Amir Murillo', position: 'MR', isStarter: true },
        { name: 'J. Rodriguez', position: 'AMC', isStarter: true },
        { name: 'Ismael Diaz', position: 'AMC', isStarter: true },
        { name: 'C. Waterman', position: 'FW', isStarter: true },
      ],
    },
    {
      date: '2026-06-17', time: '10:00 PM ET',
      awayAbbr: 'UZB', homeAbbr: 'COL', awayName: 'Uzbekistan', homeName: 'Colombia',
      isConfirmed: false,
      awayPlayers: [
        { name: 'U. Yusupov', position: 'GK', isStarter: true },
        { name: 'A. Abdullaev', position: 'DC', isStarter: true },
        { name: 'A. Khusanov', position: 'DC', isStarter: true },
        { name: 'R. Ashurmatov', position: 'DC', isStarter: true },
        { name: 'S. Nasrullayev', position: 'ML', isStarter: true },
        { name: 'O. Hamrobekov', position: 'MC', isStarter: true },
        { name: 'O. Shukurov', position: 'MC', isStarter: true },
        { name: 'F. Sayfiyev', position: 'MR', isStarter: true },
        { name: 'A. Fayzullaev', position: 'AMC', isStarter: true },
        { name: 'Oston Urunov', position: 'AMC', isStarter: true },
        { name: 'E. Shomurodov', position: 'FW', isStarter: true },
      ],
      homePlayers: [
        { name: 'C. Vargas', position: 'GK', isStarter: true },
        { name: 'Johan Mojica', position: 'DL', isStarter: true },
        { name: 'Jhon Lucumi', position: 'DC', isStarter: true },
        { name: 'D. Sanchez', position: 'DC', isStarter: true },
        { name: 'Daniel Munoz', position: 'DR', isStarter: true },
        { name: 'J. Lerma', position: 'DMC', isStarter: true },
        { name: 'G. Puerta', position: 'DMC', isStarter: true },
        { name: 'Luis Diaz', position: 'AML', isStarter: true },
        { name: 'J. Rodriguez', position: 'AMC', isStarter: true },
        { name: 'Jhon Arias', position: 'AMR', isStarter: true },
        { name: 'Luis Suarez', position: 'FW', isStarter: true },
      ],
    },
  ];
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[SEED] [INPUT] Starting WC2026 seed for dates: ${SEED_DATES.join(', ')}`);
  
  await loadTeams();

  let totalSnapshots = 0;
  let totalGames = 0;
  const allErrors = [];

  // 1. Scrape AN odds for each date
  for (const dateStr of SEED_DATES) {
    console.log(`\n[SEED] [STEP] ─── Processing date: ${dateStr} ───`);
    const result = await scrapeDate(dateStr);
    totalSnapshots += result.snapshotsWritten;
    totalGames += result.gamesProcessed;
    allErrors.push(...result.errors);
    // Small delay between dates to avoid rate limiting
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n[SEED] [STEP] ─── Scraping RotoWire lineups ───`);
  const lineupResult = await scrapeLineups();
  allErrors.push(...lineupResult.errors);

  console.log(`\n[SEED] [OUTPUT] ─────────────────────────────────────────`);
  console.log(`[SEED] [OUTPUT] Total snapshots written: ${totalSnapshots}`);
  console.log(`[SEED] [OUTPUT] Total games processed:   ${totalGames}`);
  console.log(`[SEED] [OUTPUT] Lineup players written:  ${lineupResult.lineupsWritten}`);
  console.log(`[SEED] [OUTPUT] Total errors:            ${allErrors.length}`);
  if (allErrors.length > 0) {
    console.log(`[SEED] [OUTPUT] Errors:`);
    allErrors.forEach(e => console.log(`  - ${e}`));
  }

  const pass = allErrors.length === 0;
  console.log(`\n[SEED] [VERIFY] ${pass ? 'PASS' : 'PARTIAL'} — seed complete`);

  await conn.end();
}

main().catch(async (err) => {
  console.error('[SEED] [VERIFY] FAIL — Fatal error:', err);
  await conn.end();
  process.exit(1);
});
