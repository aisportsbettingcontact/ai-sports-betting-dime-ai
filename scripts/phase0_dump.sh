#!/bin/bash
set -euo pipefail

# Parse DATABASE_URL from Node.js - suppress dotenv logging
DB_INFO=$(cd /home/ubuntu/ai-sports-betting && node -e "
require('dotenv').config({quiet:true});
const u=process.env.DATABASE_URL||'';
const m=u.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
if(m){process.stdout.write(m[1]+'\n'+m[2]+'\n'+m[3]+'\n'+m[4]+'\n'+m[5]+'\n');}
else{process.stderr.write('PARSE FAIL: '+u.substring(0,50)+'\n');process.exit(1);}
" 2>/dev/null)

DB_USER=$(echo "$DB_INFO" | sed -n '1p')
DB_PASS=$(echo "$DB_INFO" | sed -n '2p')
DB_HOST=$(echo "$DB_INFO" | sed -n '3p')
DB_PORT=$(echo "$DB_INFO" | sed -n '4p')
DB_NAME=$(echo "$DB_INFO" | sed -n '5p')

echo "[PHASE 0a] Starting full live-DB mysqldump..."
echo "[INPUT] host=$DB_HOST port=$DB_PORT db=$DB_NAME user=$DB_USER"

DUMP_DIR="/home/ubuntu/ai-sports-betting/audit-notes/archives"
mkdir -p "$DUMP_DIR"

DUMP_FILE="$DUMP_DIR/full_live_db_$(date +%Y%m%d_%H%M%S).sql"

mysqldump \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --user="$DB_USER" \
  --password="$DB_PASS" \
  --ssl-mode=REQUIRED \
  --single-transaction \
  --routines \
  --triggers \
  --set-gtid-purged=OFF \
  --column-statistics=0 \
  "$DB_NAME" > "$DUMP_FILE" 2>/tmp/mysqldump_stderr.txt

DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
TABLE_COUNT=$(grep -c "^CREATE TABLE" "$DUMP_FILE" || echo 0)

echo "[OUTPUT] Dump file: $DUMP_FILE"
echo "[OUTPUT] Dump size: $DUMP_SIZE"
echo "[OUTPUT] Tables in dump: $TABLE_COUNT"
echo "[STEP] Full dump complete."

# Count tables in live DB
LIVE_TABLE_COUNT=$(mysql \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --user="$DB_USER" \
  --password="$DB_PASS" \
  --ssl-mode=REQUIRED \
  "$DB_NAME" -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DB_NAME' AND table_type='BASE TABLE';" 2>/dev/null)

echo "[VERIFY] Live DB table count: $LIVE_TABLE_COUNT"
echo "[VERIFY] Dump table count: $TABLE_COUNT"

if [ "$TABLE_COUNT" -eq "$LIVE_TABLE_COUNT" ]; then
  echo "[VERIFY] PASS — table counts match"
else
  echo "[VERIFY] WARNING — table count mismatch (live=$LIVE_TABLE_COUNT, dump=$TABLE_COUNT)"
fi

echo ""
echo "=== DUMP FILE ==="
echo "$DUMP_FILE"
