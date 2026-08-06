// Shared DB connection for remediation batch scripts (Phase 3+, write-authorized at
// CHECKPOINT ALPHA 2026-07-25). Reads DATABASE_URL from env; never logs its value.
import mysql from 'mysql2/promise';

export async function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  try {
    const c = await mysql.createConnection({ uri: url, multipleStatements: false });
    await c.query('SELECT 1');
    return c;
  } catch {
    return mysql.createConnection({
      uri: url,
      ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      multipleStatements: false,
    });
  }
}

export function execFlag() {
  const on = process.argv.includes('--execute');
  console.error(on ? '[mode] EXECUTE — writes will run in a transaction' : '[mode] DRY-RUN — no writes');
  return on;
}
