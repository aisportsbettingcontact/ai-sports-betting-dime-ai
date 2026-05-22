/**
 * Live end-to-end test of the batch MLB ID resolution.
 * Simulates exactly what parseRgCsv does: 390 player names → 1 DB query → JS matching.
 */
import { config } from 'dotenv';
config();
import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm';
import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  uri: process.env.DATABASE_URL,
  connectionLimit: 20,
  waitForConnections: true,
  queueLimit: 100,
  connectTimeout: 5000,
});
const db = drizzle(pool);

// Simulate 390 hitter names (a realistic sample from the RG CSV)
const playerNames = [
  'Shohei Ohtani','Corbin Carroll','Aaron Judge','Juan Soto','Bobby Witt Jr.',
  'James Wood','Ronald Acuna Jr.','Ketel Marte','Elly De La Cruz','Oneil Cruz',
  'Jordan Walker','Fernando Tatis Jr.','JJ Wetherholt','Alec Burleson','CJ Abrams',
  'Freddie Freeman','Gunnar Henderson','Ivan Herrera','Jackson Chourio','Nick Kurtz',
  'Shea Langeliers','Christian Walker','Kyle Higashioka','Keibert Ruiz','Austin Wells',
  'Sal Frelick','Jeremiah Jackson','Josh Lowe','Nolan Schanuel','Jesus Rodriguez',
  'Jared Triolo','Jonny DeLuca','Andres Gimenez','Michael Helman','Ernie Clement',
  'Jake Meyers','Lenyn Sosa','Weston Wilson','Starling Marte','Trevor Larnach',
  'Tristan Peters','Luisangel Acuna','Jhostynxon Garcia','Paul Goldschmidt','Luis Arraez',
  'Ty France','Manny Machado','Fernando Tatis Jr.','Xander Bogaerts','Jake Cronenworth',
  'Ha-Seong Kim','Jurickson Profar','Trent Grisham','David Peralta','Rougned Odor',
  'Wil Myers','Eric Hosmer','Matt Carpenter','Manny Margot','Wil Myers',
  'Jose Abreu','Yoan Moncada','Eloy Jimenez','Luis Robert','Andrew Vaughn',
  'Gavin Sheets','Seby Zavala','Romy Gonzalez','Adam Engel','Jake Burger',
  'Jose Ramirez','Josh Naylor','Amed Rosario','Owen Miller','Myles Straw',
  'Bradley Zimmer','Austin Hedges','Yu Chang','Ernie Clement','Will Benson',
  'Rafael Devers','Xander Bogaerts','J.D. Martinez','Trevor Story','Christian Arroyo',
  'Kiké Hernandez','Alex Verdugo','Rob Refsnyder','Jarren Duran','Connor Wong',
  'Yordan Alvarez','Jose Altuve','Alex Bregman','Jeremy Pena','Kyle Tucker',
  'Mauricio Dubon','Chas McCormick','Martin Maldonado','Yainer Diaz','Jake Meyers',
  'Mike Trout','Shohei Ohtani','Anthony Rendon','Luis Rengifo','Jo Adell',
  'Taylor Ward','Hunter Renfroe','Max Stassi','Chad Wallach','Matt Thaiss',
  'Aaron Judge','Anthony Rizzo','Gleyber Torres','Josh Donaldson','Isiah Kiner-Falefa',
  'Harrison Bader','Kyle Higashioka','Jose Trevino','Oswaldo Cabrera','Oswald Peraza',
  'Trea Turner','Bryce Harper','Kyle Schwarber','Rhys Hoskins','Alec Bohm',
  'Nick Castellanos','J.T. Realmuto','Bryson Stott','Didi Gregorius','Johan Camargo',
];

// Normalize functions (same as production)
function normalizeNameForDb(name) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ');
}

const t0 = Date.now();
console.log(`[TEST] Batch DB lookup for ${playerNames.length} players...`);

// Extract unique last names
const uniqueLastNames = Array.from(new Set(
  playerNames.map(name => {
    const parts = name.trim().split(/\s+/);
    return parts[parts.length - 1];
  })
));
console.log(`[TEST] ${uniqueLastNames.length} unique last names → 1 DB query`);

// Build OR conditions
const conditions = uniqueLastNames
  .map(ln => `name COLLATE utf8mb4_unicode_ci LIKE '%${ln.replace(/'/g, "''")}%'`)
  .join(' OR ');

const [dbRowsRaw] = await db.execute(
  sql.raw(`SELECT name, mlbamId FROM mlb_players WHERE (${conditions}) AND mlbamId IS NOT NULL LIMIT 2000`)
);

const dbElapsed = Date.now() - t0;
console.log(`[TEST] DB returned ${dbRowsRaw.length} rows in ${dbElapsed}ms`);

// Build lookup map
const dbLookup = new Map();
for (const row of dbRowsRaw) {
  dbLookup.set(normalizeNameForDb(row.name), row.mlbamId);
}

// Match players
let resolved = 0, missing = [];
for (const name of playerNames) {
  const normalized = normalizeNameForDb(name);
  const mlbId = dbLookup.get(normalized);
  if (mlbId) {
    resolved++;
  } else {
    missing.push(name);
  }
}

const totalElapsed = Date.now() - t0;
console.log(`[TEST] Resolution: ${resolved}/${playerNames.length} resolved from DB in ${totalElapsed}ms`);
console.log(`[TEST] Missing (need API fallback): ${missing.length} players`);
if (missing.length > 0 && missing.length <= 20) {
  console.log(`[TEST] Missing names: ${missing.join(', ')}`);
}

await pool.end();
