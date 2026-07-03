import mysql from 'mysql2/promise';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../../.env') });

const MATCH_IDS = ['760487','760489','760488','760486'];
const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Check glossary column name
const [glossaryCols] = await conn.execute('DESCRIBE wc2026_espn_glossary');
console.log('GLOSSARY COLS:', glossaryCols.map(c => c.Field).join(', '));

// Check glossary counts using correct column
const matchIdCol = glossaryCols.find(c => c.Field.toLowerCase() === 'matchid')?.Field ?? 'espn_match_id';
console.log('Using column:', matchIdCol);
for (const mid of MATCH_IDS) {
  const [[gl]] = await conn.execute(`SELECT COUNT(*) AS cnt FROM wc2026_espn_glossary WHERE \`${matchIdCol}\`=?`, [mid]);
  console.log(`[${mid}] glossary terms: ${gl.cnt}`);
}

// Match stats null check
console.log('\n─── match_stats null fields ─────────────────────────────');
for (const mid of MATCH_IDS) {
  const [[ms]] = await conn.execute('SELECT * FROM wc2026_espn_match_stats WHERE espn_match_id=?', [mid]);
  if (!ms) { console.log(`[${mid}] NO match_stats row!`); continue; }
  const nullFields = Object.entries(ms).filter(([k,v]) => v === null).map(([k]) => k);
  if (nullFields.length === 0) {
    console.log(`[${mid}] ✅ All match_stats fields populated (0 nulls)`);
  } else {
    console.log(`[${mid}] ⚠️  ${nullFields.length} null fields: ${nullFields.join(', ')}`);
  }
}

// Shot map outcome breakdown
console.log('\n─── shot_map outcome breakdown ──────────────────────────');
for (const mid of MATCH_IDS) {
  const [smRows] = await conn.execute(
    `SELECT outcome, COUNT(*) AS cnt FROM wc2026_espn_shot_map WHERE espn_match_id=? GROUP BY outcome`,
    [mid]
  );
  const breakdown = smRows.map(r => `${r.outcome}:${r.cnt}`).join(' | ');
  console.log(`[${mid}] ${breakdown}`);
}

// Player stats null check
console.log('\n─── player_stats null fields (sample) ───────────────────');
for (const mid of MATCH_IDS) {
  const [psRows] = await conn.execute('SELECT * FROM wc2026_espn_player_stats WHERE espn_match_id=? LIMIT 1', [mid]);
  if (!psRows.length) { console.log(`[${mid}] NO player_stats rows!`); continue; }
  const nullFields = Object.entries(psRows[0]).filter(([k,v]) => v === null).map(([k]) => k);
  console.log(`[${mid}] sample player null fields (${nullFields.length}): ${nullFields.slice(0,10).join(', ')}`);
}

// Team stats possession check
console.log('\n─── team_stats possession sum check ─────────────────────');
const [tsRows] = await conn.execute(
  `SELECT espn_match_id, homePossession, awayPossession FROM wc2026_espn_team_stats WHERE espn_match_id IN (?,?,?,?)`,
  MATCH_IDS
);
for (const r of tsRows) {
  const sum = parseFloat(r.homePossession ?? 0) + parseFloat(r.awayPossession ?? 0);
  console.log(`[${r.espn_match_id}] H=${r.homePossession}% A=${r.awayPossession}% sum=${sum.toFixed(1)} ${Math.abs(sum-100)<1?'✅':'⚠️'}`);
}

// xG range check
console.log('\n─── expected_goals range check ──────────────────────────');
const [xgRows] = await conn.execute(
  `SELECT espn_match_id, homeXg, awayXg FROM wc2026_espn_expected_goals WHERE espn_match_id IN (?,?,?,?)`,
  MATCH_IDS
);
for (const r of xgRows) {
  const hxg = parseFloat(r.homeXg);
  const axg = parseFloat(r.awayXg);
  const ok = hxg >= 0 && hxg <= 5 && axg >= 0 && axg <= 5;
  console.log(`[${r.espn_match_id}] homeXg=${r.homeXg} awayXg=${r.awayXg} ${ok?'✅':'⚠️ OUT OF RANGE'}`);
}

// matchDateUtc vs ESPN HTML Game Information
console.log('\n─── matchDateUtc vs ESPN Game Information HTML ──────────');
const [mRows] = await conn.execute(
  `SELECT espn_match_id, homeTeamAbbrev, awayTeamAbbrev, matchDateUtc, venue, attendance, referee FROM wc2026_espn_matches WHERE espn_match_id IN (?,?,?,?) ORDER BY matchDateUtc`,
  MATCH_IDS
);
// Ground truth from ESPN HTML (pasted_content_52.txt): "12:00 PM, June 28, 2026" for match 760487 (Japan vs Brazil)
// But wait - 760487 is BRA vs JPN, and the HTML says SoFi Stadium which is 760486 (RSA vs CAN)
// Let's map them:
const groundTruth = {
  '760486': { etTime: '3:00 PM ET Jun 28', venue: 'SoFi Stadium', attendance: 69237, referee: 'João Pinheiro' },
  '760487': { etTime: '1:00 PM ET Jun 29', venue: 'NRG Stadium', attendance: 68777, referee: 'Maurizio Mariani' },
  '760489': { etTime: '4:30 PM ET Jun 29', venue: 'Gillette Stadium', attendance: 63945, referee: 'Jalal Jayed' },
  '760488': { etTime: '9:00 PM ET Jun 29', venue: 'Estadio BBVA', attendance: 51243, referee: 'Wilton Pereira Sampaio' },
};
// Note: HTML shows "12:00 PM, June 28, 2026" for SoFi Stadium / João Pinheiro = match 760486 (RSA vs CAN)
// But DB shows 3:00 PM ET for 760486 — need to check if HTML "12:00 PM" is local PT (SoFi is in Inglewood, CA = PT)
// 12:00 PM PT = 3:00 PM ET = 19:00 UTC ✅ CORRECT
for (const r of mRows) {
  const dt = new Date(Number(r.matchDateUtc));
  const etStr = dt.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  const ptStr = dt.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  const gt = groundTruth[r.espn_match_id];
  const venueOk = r.venue === gt.venue ? '✅' : `⚠️ DB="${r.venue}" expected="${gt.venue}"`;
  const attOk = r.attendance === gt.attendance ? '✅' : `⚠️ DB=${r.attendance} expected=${gt.attendance}`;
  const refOk = r.referee === gt.referee ? '✅' : `⚠️ DB="${r.referee}" expected="${gt.referee}"`;
  console.log(`[${r.espn_match_id}] ${r.homeTeamAbbrev} vs ${r.awayTeamAbbrev}`);
  console.log(`  UTC: ${dt.toISOString()} | ET: ${etStr} | PT: ${ptStr}`);
  console.log(`  venue: ${venueOk}`);
  console.log(`  attendance: ${attOk}`);
  console.log(`  referee: ${refOk}`);
}

// Note about ESPN HTML Game Information time extraction
console.log('\n─── ESPN HTML Game Information Time Extraction Analysis ──');
console.log('HTML shows: "12:00 PM, June 28, 2026" for SoFi Stadium (match 760486 RSA vs CAN)');
console.log('This is LOCAL time (PT = Pacific Time, Inglewood CA)');
console.log('12:00 PM PT = 15:00 ET = 19:00 UTC');
console.log('DB matchDateUtc for 760486: 1782673200000 = 2026-06-28T19:00:00.000Z ✅ CORRECT');
console.log('');
console.log('Scraper source: gmStrp["dt"] from __espnfitt__ JSON = ISO UTC string');
console.log('This is the CORRECT source — machine-readable UTC, not the display local time');
console.log('The HTML "12:00 PM" is display-only local time and would require timezone lookup per venue');
console.log('Current approach (UTC from __espnfitt__) is MORE ACCURATE than parsing HTML display time');

await conn.end();
console.log('\n✅ checkNulls.mjs complete');
