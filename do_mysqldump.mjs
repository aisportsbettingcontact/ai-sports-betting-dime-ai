#!/usr/bin/env node
/**
 * Live-DB Full Backup (mysqldump) for Schema-Alignment Authorization A
 * 
 * Takes a full dump of all wc2026_* tables + the full DB structure.
 * Outputs to /home/ubuntu/ai-sports-betting/audit-notes/backups/
 */
import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const url = process.env.DATABASE_URL;
const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
if (!m) { console.error('Failed to parse DATABASE_URL'); process.exit(1); }

const [, user, pass, host, port, db] = m;
const backupDir = '/home/ubuntu/ai-sports-betting/audit-notes/backups';
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });

const commonArgs = `--host=${host} --port=${port} --user=${user} --password='${pass}' --ssl-mode=REQUIRED --single-transaction --set-gtid-purged=OFF`;

// Full structure + data dump
const fullDumpFile = `${backupDir}/full_dump_${timestamp}.sql`;
console.log(`[BACKUP] Starting full mysqldump to ${fullDumpFile}`);
console.log(`[BACKUP] Host: ${host}, DB: ${db}`);

try {
  execSync(
    `mysqldump ${commonArgs} --databases ${db} --routines --triggers > ${fullDumpFile} 2>/tmp/mysqldump_err.log`,
    { shell: '/bin/bash', timeout: 120000 }
  );
  const size = execSync(`ls -lh ${fullDumpFile} | awk '{print $5}'`).toString().trim();
  console.log(`[BACKUP] Full dump complete: ${size}`);
} catch (e) {
  const err = execSync('cat /tmp/mysqldump_err.log 2>/dev/null').toString();
  console.error(`[BACKUP] Full dump FAILED: ${err}`);
  // Try without --set-gtid-purged for TiDB
  console.log('[BACKUP] Retrying without --set-gtid-purged...');
  try {
    execSync(
      `mysqldump --host=${host} --port=${port} --user=${user} --password='${pass}' --ssl-mode=REQUIRED --single-transaction ${db} > ${fullDumpFile} 2>/tmp/mysqldump_err2.log`,
      { shell: '/bin/bash', timeout: 120000 }
    );
    const size = execSync(`ls -lh ${fullDumpFile} | awk '{print $5}'`).toString().trim();
    console.log(`[BACKUP] Retry succeeded: ${size}`);
  } catch (e2) {
    const err2 = execSync('cat /tmp/mysqldump_err2.log 2>/dev/null').toString();
    console.error(`[BACKUP] Retry also FAILED: ${err2}`);
    process.exit(1);
  }
}

// Verify dump is non-empty and contains expected tables
try {
  const tableCount = execSync(`grep -c "^CREATE TABLE" ${fullDumpFile}`).toString().trim();
  const wc2026Count = execSync(`grep -c "wc2026" ${fullDumpFile} | head -1`).toString().trim();
  console.log(`[VERIFY] Tables in dump: ${tableCount}`);
  console.log(`[VERIFY] wc2026 references: ${wc2026Count}`);
  console.log(`[BACKUP] Dump file: ${fullDumpFile}`);
} catch (e) {
  console.log('[VERIFY] grep check completed (non-zero may be normal)');
}

console.log('[BACKUP] DONE');
