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
  idleTimeout: 30000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  compress: true,
});
const db = drizzle(pool);

// Simulate 390 parallel DB queries (same as production)
const names = [
  'Walker','Higashioka','Ruiz','Wells','Frelick','Jackson','Lowe','Schanuel','Rodriguez','Triolo',
  'DeLuca','Gimenez','Helman','Clement','Meyers','Sosa','Wilson','Marte','Larnach','Peters',
  'Judge','Ohtani','Freeman','Betts','Trout','Harper','Acuna','Soto','Guerrero','Vlad',
  'Goldschmidt','Arenado','Machado','Tatis','Lindor','Bogaerts','Turner','Seager','Story','Swanson',
  'Devers','Ramirez','Bregman','Tucker','Alvarez','Yordan','Pena','Abreu','Moncada','Jimenez',
  'Arraez','Votto','Aquino','Castellanos','Winker','Suarez','India','Farmer','Drury','Naquin',
  'Bellinger','Heyward','Contreras','Baez','Bryant','Rizzo','Wisdom','Ortega','Hoerner','Morel',
  'Alonso','McNeil','Lindor2','Escobar','Davis','Nimmo','Marte2','Canha','Vogelbach','Guillorme',
  'Stanton','Judge2','Rizzo2','Torres','Donaldson','Higashioka2','Trevino','Carpenter','Gallo','Kiner',
  'Harper2','Hoskins','Schwarber','Realmuto','Bohm','Segura','Didi','Gregorius','Herrera','Williams',
];
const t0 = Date.now();
let success = 0, fail = 0;
const errors = [];
await Promise.all(names.map(async (name) => {
  try {
    const result = await db.execute(
      sql`SELECT name, mlbamId FROM mlb_players WHERE name COLLATE utf8mb4_unicode_ci LIKE ${`%${name}%`} AND mlbamId IS NOT NULL LIMIT 5`
    );
    const rows = result[0];
    success++;
  } catch(e) {
    fail++;
    errors.push(`[${name}]: ${e.message.substring(0, 80)}`);
  }
}));
const elapsed = Date.now() - t0;
console.log(`Done in ${elapsed}ms: success=${success} fail=${fail} total=${names.length}`);
if (errors.length > 0) {
  console.log('First 5 errors:');
  errors.slice(0, 5).forEach(e => console.log(' ', e));
}
await pool.end();
