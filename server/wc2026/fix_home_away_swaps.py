"""
fix_home_away_swaps.py
======================
Fix the 8 matches where home_team_id and away_team_id are swapped
relative to the official FIFA WC2026 schedule.

Also fixes the associated odds_snapshots rows — the 'home' and 'away'
selection labels must match the corrected orientation.

Execution log:
  [INPUT]  - source data
  [STEP]   - operation
  [STATE]  - intermediate result
  [OUTPUT] - result
  [VERIFY] - pass/fail
"""
import os, re, sys
import mysql.connector

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

# Matchs where home/away are swapped:
# (match_id, correct_home, correct_away, match_date, kickoff_utc, group_letter)
SWAPPED_MATCHES = [
    # DB: bih vs can → Official: can vs bih
    ('wc26-g-003', 'can', 'bih', '2026-06-12', '2026-06-12 19:00:00', 'B'),
    # DB: sui vs qat → Official: qat vs sui
    ('wc26-g-004', 'qat', 'sui', '2026-06-13', '2026-06-13 19:00:00', 'B'),
    # DB: mar vs bra → Official: bra vs mar  ← THE BRAZIL COLUMN SWAP
    ('wc26-g-006', 'bra', 'mar', '2026-06-13', '2026-06-13 22:00:00', 'C'),
    # DB: sco vs hai → Official: hai vs sco
    ('wc26-g-007', 'hai', 'sco', '2026-06-13', '2026-06-14 01:00:00', 'C'),
    # DB: tur vs aus → Official: aus vs tur
    ('wc26-g-008', 'aus', 'tur', '2026-06-13', '2026-06-14 04:00:00', 'D'),
    # DB: can vs sui → Official: sui vs can
    ('wc26-g-049', 'sui', 'can', '2026-06-24', '2026-06-24 19:00:00', 'B'),
    # DB: mex vs cze → Official: cze vs mex
    ('wc26-g-051', 'cze', 'mex', '2026-06-24', '2026-06-25 01:00:00', 'A'),
    # DB: usa vs tur → Official: tur vs usa
    ('wc26-g-055', 'tur', 'usa', '2026-06-25', '2026-06-26 02:00:00', 'D'),
]

print('=' * 80)
print('[STEP 1] FIXING HOME/AWAY SWAPS IN wc2026_matches')
print('=' * 80)

for fid, correct_home, correct_away, match_date, kickoff, grp in SWAPPED_MATCHES:
    # First verify current state
    cur.execute("SELECT home_team_id, away_team_id FROM wc2026_matches WHERE match_id = %s", (fid,))
    row = cur.fetchone()
    if not row:
        print(f'[ERROR] {fid} not found in DB')
        continue
    
    current_home = row['home_team_id']
    current_away = row['away_team_id']
    
    print(f'[INPUT] {fid}: current home={current_home} away={current_away}')
    print(f'[STEP]  Correcting to: home={correct_home} away={correct_away}')
    
    # Update the match
    cur.execute("""
        UPDATE wc2026_matches
        SET home_team_id = %s, away_team_id = %s,
            match_date = %s, kickoff_utc = %s, group_letter = %s
        WHERE match_id = %s
    """, (correct_home, correct_away, match_date, kickoff, grp, fid))
    rows = cur.rowcount
    print(f'[OUTPUT] match rows updated: {rows}')
    
    # Now fix the odds_snapshots: swap 'home' and 'away' selections
    # because the odds were seeded with the wrong orientation
    # Step 1: rename 'home' → 'temp_home'
    cur.execute("""
        UPDATE wc2026_odds_snapshots
        SET selection = 'temp_home'
        WHERE match_id = %s AND selection = 'home'
    """, (fid,))
    temp_count = cur.rowcount
    
    # Step 2: rename 'away' → 'home'
    cur.execute("""
        UPDATE wc2026_odds_snapshots
        SET selection = 'home'
        WHERE match_id = %s AND selection = 'away'
    """, (fid,))
    away_to_home = cur.rowcount
    
    # Step 3: rename 'temp_home' → 'away'
    cur.execute("""
        UPDATE wc2026_odds_snapshots
        SET selection = 'away'
        WHERE match_id = %s AND selection = 'temp_home'
    """, (fid,))
    home_to_away = cur.rowcount
    
    # Also fix ASIAN_HANDICAP lines: -1.5 ↔ +1.5
    cur.execute("""
        UPDATE wc2026_odds_snapshots
        SET line = CASE
            WHEN line = -1.5 THEN 1.5
            WHEN line = 1.5 THEN -1.5
            ELSE line
        END
        WHERE match_id = %s AND market = 'ASIAN_HANDICAP'
    """, (fid,))
    ah_fixed = cur.rowcount
    
    print(f'[STATE] odds swap: temp={temp_count} away→home={away_to_home} home→away={home_to_away} AH_lines={ah_fixed}')
    print()

conn.commit()

print('=' * 80)
print('[STEP 2] VERIFICATION — CHECK CORRECTED MATCHES')
print('=' * 80)

for fid, correct_home, correct_away, match_date, kickoff, grp in SWAPPED_MATCHES:
    cur.execute("""
        SELECT f.match_id, f.home_team_id, f.away_team_id, f.match_date, f.kickoff_utc,
               ht.fifa_code as home_code, at.fifa_code as away_code
        FROM wc2026_matches f
        JOIN wc2026_teams ht ON ht.team_id = f.home_team_id
        JOIN wc2026_teams at ON at.team_id = f.away_team_id
        WHERE f.match_id = %s
    """, (fid,))
    row = cur.fetchone()
    if not row:
        print(f'[VERIFY FAIL] {fid} not found')
        continue
    
    home_ok = row['home_team_id'] == correct_home
    away_ok = row['away_team_id'] == correct_away
    
    status = 'PASS' if home_ok and away_ok else 'FAIL'
    print(f'[VERIFY {status}] {fid}: {row["away_code"]} @ {row["home_code"]} | {row["match_date"]} | {row["kickoff_utc"]}')
    
    if not home_ok:
        print(f'  ⚠ home: expected={correct_home} got={row["home_team_id"]}')
    if not away_ok:
        print(f'  ⚠ away: expected={correct_away} got={row["away_team_id"]}')
    
    # Verify odds selections
    cur.execute("""
        SELECT selection, COUNT(*) as cnt
        FROM wc2026_odds_snapshots
        WHERE match_id = %s AND market = '1X2'
        GROUP BY selection
    """, (fid,))
    sel_counts = {r['selection']: r['cnt'] for r in cur.fetchall()}
    print(f'  odds 1X2 selections: {sel_counts}')

print()
print('=' * 80)
print('[STEP 3] FINAL JUNE 11-17 MATCH LIST (CORRECTED)')
print('=' * 80)

cur.execute("""
    SELECT f.match_id, f.match_date, f.kickoff_utc, f.group_letter,
           ht.fifa_code as home_code, ht.name as home_name,
           at.fifa_code as away_code, at.name as away_name
    FROM wc2026_matches f
    JOIN wc2026_teams ht ON ht.team_id = f.home_team_id
    JOIN wc2026_teams at ON at.team_id = f.away_team_id
    WHERE f.match_date BETWEEN '2026-06-11' AND '2026-06-17'
    ORDER BY f.kickoff_utc
""")
june_matches = cur.fetchall()

print(f'{"Match ID":<14} {"Date":<12} {"Kickoff UTC":<22} {"Grp":<5} {"Home":<8} {"Away":<8} {"Matchup"}')
print('-' * 90)
for f in june_matches:
    date_str = f['match_date']
    if hasattr(date_str, 'strftime'):
        date_str = date_str.strftime('%Y-%m-%d')
    kickoff_str = str(f['kickoff_utc'])
    print(f'{f["match_id"]:<14} {date_str:<12} {kickoff_str:<22} {f["group_letter"]:<5} {f["home_code"]:<8} {f["away_code"]:<8} {f["home_name"]} vs {f["away_name"]}')

conn.close()
print()
print('[DONE] fix_home_away_swaps.py complete')
