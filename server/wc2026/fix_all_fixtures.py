"""
fix_all_matches.py
===================
Compare DB matches against official FIFA WC2026 schedule.
Identify ALL mismatches in: date, home_team_id, away_team_id, group_letter.
Generate and execute SQL UPDATE statements to fix them.

Execution log format:
  [INPUT]  - source data
  [STEP]   - operation
  [STATE]  - intermediate result
  [OUTPUT] - final result
  [VERIFY] - pass/fail
"""
import os, re, sys
import mysql.connector
from datetime import datetime, date

DB_URL = os.environ.get('DATABASE_URL', '')
m = re.match(r'mysql://([^:]+):([^@]+)@([^:]+):(\d+)/([^?]+)', DB_URL)
if not m:
    print('[FATAL] Cannot parse DATABASE_URL')
    sys.exit(1)
user, password, host, port, database = m.groups()

conn = mysql.connector.connect(
    user=user, password=password, host=host, port=int(port), database=database,
    ssl_disabled=False
)
cur = conn.cursor(dictionary=True)

# ── Official schedule ─────────────────────────────────────────────────────
# (match_date, kickoff_utc, home_team_id, away_team_id, venue_city, group_letter)
OFFICIAL = [
    # June 11
    ('2026-06-11', '2026-06-11 19:00:00', 'mex', 'rsa', 'Mexico City', 'A'),
    ('2026-06-11', '2026-06-12 02:00:00', 'kor', 'cze', 'Zapopan', 'A'),
    # June 12
    ('2026-06-12', '2026-06-12 19:00:00', 'can', 'bih', 'Toronto', 'B'),
    ('2026-06-12', '2026-06-13 01:00:00', 'usa', 'par', 'Los Angeles', 'B'),
    # June 13
    ('2026-06-13', '2026-06-13 19:00:00', 'qat', 'sui', 'San Francisco', 'B'),
    ('2026-06-13', '2026-06-13 22:00:00', 'bra', 'mar', 'East Rutherford', 'C'),
    ('2026-06-13', '2026-06-14 01:00:00', 'hai', 'sco', 'Foxborough', 'C'),
    ('2026-06-13', '2026-06-14 04:00:00', 'aus', 'tur', 'Vancouver', 'D'),
    # June 14
    ('2026-06-14', '2026-06-14 17:00:00', 'ger', 'cuw', 'Houston', 'E'),
    ('2026-06-14', '2026-06-14 20:00:00', 'ned', 'jpn', 'Arlington', 'F'),
    ('2026-06-14', '2026-06-14 23:00:00', 'civ', 'ecu', 'Philadelphia', 'E'),
    ('2026-06-14', '2026-06-15 02:00:00', 'swe', 'tun', 'Guadalupe', 'F'),
    # June 15
    ('2026-06-15', '2026-06-15 16:00:00', 'esp', 'cpv', 'Atlanta', 'H'),
    ('2026-06-15', '2026-06-15 19:00:00', 'bel', 'egy', 'Seattle', 'G'),
    ('2026-06-15', '2026-06-15 22:00:00', 'ksa', 'uru', 'Miami Gardens', 'H'),
    ('2026-06-15', '2026-06-16 01:00:00', 'irn', 'nzl', 'Inglewood', 'G'),
    # June 16
    ('2026-06-16', '2026-06-16 19:00:00', 'fra', 'sen', 'East Rutherford', 'I'),
    ('2026-06-16', '2026-06-16 22:00:00', 'irq', 'nor', 'Foxborough', 'I'),
    ('2026-06-16', '2026-06-17 01:00:00', 'arg', 'alg', 'Kansas City', 'J'),
    ('2026-06-16', '2026-06-17 04:00:00', 'aut', 'jor', 'Santa Clara', 'J'),
    # June 17
    ('2026-06-17', '2026-06-17 17:00:00', 'por', 'cod', 'Houston', 'K'),
    ('2026-06-17', '2026-06-17 20:00:00', 'eng', 'cro', 'Arlington', 'L'),
    ('2026-06-17', '2026-06-17 23:00:00', 'gha', 'pan', 'Toronto', 'L'),
    ('2026-06-17', '2026-06-18 02:00:00', 'uzb', 'col', 'Mexico City', 'K'),
    # June 18
    ('2026-06-18', '2026-06-18 16:00:00', 'cze', 'rsa', 'Atlanta', 'A'),
    ('2026-06-18', '2026-06-18 19:00:00', 'sui', 'bih', 'Inglewood', 'B'),
    ('2026-06-18', '2026-06-18 22:00:00', 'can', 'qat', 'Vancouver', 'B'),
    ('2026-06-18', '2026-06-19 01:00:00', 'mex', 'kor', 'Zapopan', 'A'),
    # June 19
    ('2026-06-19', '2026-06-19 19:00:00', 'usa', 'aus', 'Seattle', 'D'),
    ('2026-06-19', '2026-06-19 22:00:00', 'sco', 'mar', 'Foxborough', 'C'),
    ('2026-06-19', '2026-06-20 00:30:00', 'bra', 'hai', 'Philadelphia', 'C'),
    ('2026-06-19', '2026-06-20 03:00:00', 'tur', 'par', 'Santa Clara', 'D'),
    # June 20
    ('2026-06-20', '2026-06-20 17:00:00', 'ned', 'swe', 'Houston', 'F'),
    ('2026-06-20', '2026-06-20 20:00:00', 'ger', 'civ', 'Toronto', 'E'),
    ('2026-06-20', '2026-06-21 03:00:00', 'ecu', 'cuw', 'Kansas City', 'E'),
    ('2026-06-20', '2026-06-21 04:00:00', 'tun', 'jpn', 'Guadalupe', 'F'),
    # June 21
    ('2026-06-21', '2026-06-21 16:00:00', 'esp', 'ksa', 'Atlanta', 'H'),
    ('2026-06-21', '2026-06-21 19:00:00', 'bel', 'irn', 'Inglewood', 'G'),
    ('2026-06-21', '2026-06-21 22:00:00', 'uru', 'cpv', 'Miami Gardens', 'H'),
    ('2026-06-21', '2026-06-22 01:00:00', 'nzl', 'egy', 'Vancouver', 'G'),
    # June 22
    ('2026-06-22', '2026-06-22 17:00:00', 'arg', 'aut', 'Arlington', 'J'),
    ('2026-06-22', '2026-06-22 21:00:00', 'fra', 'irq', 'Philadelphia', 'I'),
    ('2026-06-22', '2026-06-23 00:00:00', 'nor', 'sen', 'East Rutherford', 'I'),
    ('2026-06-22', '2026-06-23 03:00:00', 'jor', 'alg', 'Santa Clara', 'J'),
    # June 23
    ('2026-06-23', '2026-06-23 17:00:00', 'por', 'uzb', 'Houston', 'K'),
    ('2026-06-23', '2026-06-23 20:00:00', 'eng', 'gha', 'Foxborough', 'L'),
    ('2026-06-23', '2026-06-23 23:00:00', 'pan', 'cro', 'Toronto', 'L'),
    ('2026-06-23', '2026-06-24 02:00:00', 'col', 'cod', 'Zapopan', 'K'),
    # June 24
    ('2026-06-24', '2026-06-24 19:00:00', 'sui', 'can', 'Vancouver', 'B'),
    ('2026-06-24', '2026-06-24 19:00:00', 'bih', 'qat', 'Seattle', 'B'),
    ('2026-06-24', '2026-06-24 22:00:00', 'sco', 'bra', 'Miami Gardens', 'C'),
    ('2026-06-24', '2026-06-24 22:00:00', 'mar', 'hai', 'Atlanta', 'C'),
    ('2026-06-24', '2026-06-25 01:00:00', 'cze', 'mex', 'Mexico City', 'A'),
    ('2026-06-24', '2026-06-25 01:00:00', 'rsa', 'kor', 'Guadalupe', 'A'),
    # June 25
    ('2026-06-25', '2026-06-25 20:00:00', 'ecu', 'ger', 'East Rutherford', 'E'),
    ('2026-06-25', '2026-06-25 20:00:00', 'cuw', 'civ', 'Philadelphia', 'E'),
    ('2026-06-25', '2026-06-25 23:00:00', 'jpn', 'swe', 'Arlington', 'F'),
    ('2026-06-25', '2026-06-25 23:00:00', 'tun', 'ned', 'Kansas City', 'F'),
    ('2026-06-25', '2026-06-26 02:00:00', 'tur', 'usa', 'Inglewood', 'D'),
    ('2026-06-25', '2026-06-26 02:00:00', 'par', 'aus', 'Santa Clara', 'D'),
    # June 26
    ('2026-06-26', '2026-06-26 19:00:00', 'nor', 'fra', 'Foxborough', 'I'),
    ('2026-06-26', '2026-06-26 19:00:00', 'sen', 'irq', 'Toronto', 'I'),
    ('2026-06-26', '2026-06-27 00:00:00', 'cpv', 'ksa', 'Houston', 'H'),
    ('2026-06-26', '2026-06-27 00:00:00', 'uru', 'esp', 'Zapopan', 'H'),
    ('2026-06-26', '2026-06-27 03:00:00', 'egy', 'irn', 'Seattle', 'G'),
    ('2026-06-26', '2026-06-27 03:00:00', 'nzl', 'bel', 'Vancouver', 'G'),
    # June 27
    ('2026-06-27', '2026-06-27 21:00:00', 'pan', 'eng', 'East Rutherford', 'L'),
    ('2026-06-27', '2026-06-27 21:00:00', 'cro', 'gha', 'Philadelphia', 'L'),
    ('2026-06-27', '2026-06-27 23:30:00', 'col', 'por', 'Miami Gardens', 'K'),
    ('2026-06-27', '2026-06-27 23:30:00', 'cod', 'uzb', 'Atlanta', 'K'),
]

print('=' * 80)
print('[STEP 1] LOADING DB MATCHES')
print('=' * 80)

cur.execute("""
    SELECT f.match_id, f.match_date, f.kickoff_utc, f.group_letter,
           f.home_team_id, f.away_team_id
    FROM wc2026_matches f
    ORDER BY f.kickoff_utc
""")
db_matches = cur.fetchall()
print(f'[INPUT] DB matches: {len(db_matches)}')
print(f'[INPUT] Official matches: {len(OFFICIAL)}')

# Build lookup: (home, away) -> match_id from DB
db_by_teams = {}
for f in db_matches:
    key = (f['home_team_id'], f['away_team_id'])
    db_by_teams[key] = f

# Build lookup: (home, away) -> official data
official_by_teams = {}
for o in OFFICIAL:
    date_, kickoff, home, away, city, grp = o
    key = (home, away)
    official_by_teams[key] = o

print()
print('=' * 80)
print('[STEP 2] COMPARING DB vs OFFICIAL — FINDING MISMATCHES')
print('=' * 80)

fixes_needed = []
ok_count = 0
mismatch_count = 0

for o in OFFICIAL:
    off_date, off_kickoff, off_home, off_away, off_city, off_grp = o
    key = (off_home, off_away)
    
    if key not in db_by_teams:
        print(f'[MISSING] {off_home} vs {off_away} on {off_date} — NOT IN DB')
        continue
    
    db = db_by_teams[key]
    fid = db['match_id']
    
    # Normalize dates for comparison
    db_date = db['match_date']
    if hasattr(db_date, 'strftime'):
        db_date = db_date.strftime('%Y-%m-%d')
    else:
        db_date = str(db_date)
    
    db_kickoff = db['kickoff_utc']
    if hasattr(db_kickoff, 'strftime'):
        db_kickoff = db_kickoff.strftime('%Y-%m-%d %H:%M:%S')
    else:
        db_kickoff = str(db_kickoff)
    
    db_grp = db['group_letter'] or ''
    
    issues = []
    if db_date != off_date:
        issues.append(f'match_date: DB={db_date} OFFICIAL={off_date}')
    if db_kickoff != off_kickoff:
        issues.append(f'kickoff_utc: DB={db_kickoff} OFFICIAL={off_kickoff}')
    if db_grp.upper() != off_grp.upper():
        issues.append(f'group_letter: DB={db_grp} OFFICIAL={off_grp}')
    
    if issues:
        mismatch_count += 1
        print(f'[MISMATCH] {fid} | {off_home} vs {off_away}')
        for issue in issues:
            print(f'  ⚠ {issue}')
        fixes_needed.append((fid, off_date, off_kickoff, off_grp, off_home, off_away))
    else:
        ok_count += 1

# Check for DB matches not in official schedule
print()
print('[STEP 2b] DB MATCHES NOT IN OFFICIAL SCHEDULE:')
extra_count = 0
for key, db in db_by_teams.items():
    if key not in official_by_teams:
        fid = db['match_id']
        db_date = db['match_date']
        if hasattr(db_date, 'strftime'):
            db_date = db_date.strftime('%Y-%m-%d')
        print(f'  [EXTRA] {fid} | {db["home_team_id"]} vs {db["away_team_id"]} on {db_date}')
        extra_count += 1

print()
print(f'[STATE] OK: {ok_count} | Mismatches: {mismatch_count} | Extra in DB: {extra_count}')

print()
print('=' * 80)
print('[STEP 3] APPLYING FIXES')
print('=' * 80)

fixed = 0
for fid, off_date, off_kickoff, off_grp, off_home, off_away in fixes_needed:
    print(f'[FIX] {fid}: setting match_date={off_date}, kickoff_utc={off_kickoff}, group_letter={off_grp}')
    cur.execute("""
        UPDATE wc2026_matches
        SET match_date = %s, kickoff_utc = %s, group_letter = %s
        WHERE match_id = %s
    """, (off_date, off_kickoff, off_grp, fid))
    rows = cur.rowcount
    print(f'  [OUTPUT] Rows updated: {rows}')
    fixed += rows

conn.commit()
print(f'\n[OUTPUT] Total matches fixed: {fixed}')

print()
print('=' * 80)
print('[STEP 4] POST-FIX VERIFICATION')
print('=' * 80)

cur.execute("""
    SELECT f.match_id, f.match_date, f.kickoff_utc, f.group_letter,
           f.home_team_id, f.away_team_id,
           ht.fifa_code as home_code, at.fifa_code as away_code
    FROM wc2026_matches f
    JOIN wc2026_teams ht ON ht.team_id = f.home_team_id
    JOIN wc2026_teams at ON at.team_id = f.away_team_id
    ORDER BY f.kickoff_utc
""")
post_matches = cur.fetchall()

verify_pass = 0
verify_fail = 0
for o in OFFICIAL:
    off_date, off_kickoff, off_home, off_away, off_city, off_grp = o
    key = (off_home, off_away)
    
    found = None
    for f in post_matches:
        if f['home_team_id'] == off_home and f['away_team_id'] == off_away:
            found = f
            break
    
    if not found:
        print(f'[VERIFY FAIL] {off_home} vs {off_away} — not found in DB')
        verify_fail += 1
        continue
    
    db_date = found['match_date']
    if hasattr(db_date, 'strftime'):
        db_date = db_date.strftime('%Y-%m-%d')
    
    db_kickoff = found['kickoff_utc']
    if hasattr(db_kickoff, 'strftime'):
        db_kickoff = db_kickoff.strftime('%Y-%m-%d %H:%M:%S')
    
    if db_date == off_date and db_kickoff == off_kickoff:
        verify_pass += 1
    else:
        print(f'[VERIFY FAIL] {found["match_id"]} | {off_home} vs {off_away}')
        print(f'  date: DB={db_date} vs OFFICIAL={off_date}')
        print(f'  kickoff: DB={db_kickoff} vs OFFICIAL={off_kickoff}')
        verify_fail += 1

print(f'\n[VERIFY] PASS: {verify_pass}/{len(OFFICIAL)} | FAIL: {verify_fail}/{len(OFFICIAL)}')

print()
print('=' * 80)
print('[STEP 5] PRINT CORRECTED JUNE 11-17 MATCHES')
print('=' * 80)
for f in post_matches:
    db_date = f['match_date']
    if hasattr(db_date, 'strftime'):
        db_date = db_date.strftime('%Y-%m-%d')
    if db_date >= '2026-06-11' and db_date <= '2026-06-17':
        print(f'  {f["match_id"]} | {db_date} | {f["away_code"]:5s} @ {f["home_code"]:5s} | Group {f["group_letter"]} | kickoff={f["kickoff_utc"]}')

conn.close()
print()
print('[DONE] fix_all_matches.py complete')
