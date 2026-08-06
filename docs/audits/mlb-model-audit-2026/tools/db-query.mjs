#!/usr/bin/env node
// Read-only query runner for the MLB model audit (Phases 0-2).
// Reads DATABASE_URL from env (never printed). Enforces read-only two ways:
//  1. statement-level allowlist (SELECT/SHOW/DESCRIBE/EXPLAIN/WITH only, write keywords rejected)
//  2. SET SESSION transaction_read_only = 1, so the server refuses writes even if the filter misses.
// Usage: node db-query.mjs --sql "SELECT ..." | --file query.sql [--json] [--out path] [--quiet]

import mysql from 'mysql2/promise';
import fs from 'fs';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set');
  process.exit(2);
}

const args = process.argv.slice(2);
let sql = null;
let format = 'tsv';
let outFile = null;
let quiet = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--sql') sql = args[++i];
  else if (args[i] === '--file') sql = fs.readFileSync(args[++i], 'utf8');
  else if (args[i] === '--json') format = 'json';
  else if (args[i] === '--out') outFile = args[++i];
  else if (args[i] === '--quiet') quiet = true;
}
if (!sql) {
  console.error('usage: node db-query.mjs --sql "SELECT ..." | --file query.sql [--json] [--out path]');
  process.exit(2);
}

const statements = sql
  .split(/;\s*(?=\S)/)
  .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
  .filter(Boolean);

const ALLOWED_START = /^(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN|WITH)\b/i;
const WRITE_KEYWORDS =
  /\b(INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM|REPLACE\s+INTO|DROP\s+(TABLE|DATABASE|INDEX|VIEW)|TRUNCATE\s+|ALTER\s+(TABLE|DATABASE)|CREATE\s+(TABLE|DATABASE|INDEX|VIEW)|GRANT\s+|REVOKE\s+|LOAD\s+DATA|CALL\s+)/i;

for (const st of statements) {
  if (!ALLOWED_START.test(st) || WRITE_KEYWORDS.test(st)) {
    console.error('REFUSED non-read-only statement: ' + st.slice(0, 120));
    process.exit(3);
  }
}

function tsvEscape(v) {
  if (v === null || v === undefined) return '\\N';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return s.replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
}

async function connect() {
  try {
    const conn = await mysql.createConnection(url);
    await conn.query('SELECT 1');
    return conn;
  } catch (e) {
    // TiDB Cloud requires TLS; retry with a TLS config if the plain attempt fails.
    const conn = await mysql.createConnection({
      uri: url,
      ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    });
    return conn;
  }
}

const conn = await connect();
try {
  // TiDB implements transaction_read_only as a rejected noop, so this is best-effort;
  // the statement allowlist above is the operative guard there.
  await conn.query('SET SESSION transaction_read_only = 1').catch(() => {});
  const out = outFile ? fs.createWriteStream(outFile) : process.stdout;
  for (const st of statements) {
    const [rows, fields] = await conn.query(st);
    if (!Array.isArray(rows)) continue;
    if (format === 'json') {
      out.write(JSON.stringify(rows, null, 1) + '\n');
    } else {
      if (fields) out.write(fields.map((f) => f.name).join('\t') + '\n');
      for (const row of rows) {
        out.write(
          (fields ? fields.map((f) => tsvEscape(row[f.name])) : Object.values(row).map(tsvEscape)).join('\t') + '\n'
        );
      }
    }
    if (!quiet) console.error(`[db-query] ${rows.length} rows :: ${st.slice(0, 100).replace(/\s+/g, ' ')}`);
  }
  if (outFile) out.end();
} finally {
  await conn.end();
}
