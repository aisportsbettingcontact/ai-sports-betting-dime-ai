import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();
const db = await mysql.createConnection(process.env.DATABASE_URL);
const [r] = await db.execute('DELETE FROM wc2026_model_projections WHERE fixture_id IN (?,?,?)', ['wc26-r32-077','wc26-r32-078','wc26-r32-079']);
console.log('[CLEAR] Deleted', r.affectedRows, 'placeholder model projection rows for June 30 fixtures');
await db.end();
process.exit(0);
