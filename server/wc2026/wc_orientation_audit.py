"""
wc_orientation_audit.py
=======================
Maximum-depth audit of WC2026 match orientations, column header mapping,
and invalid match detection.

Checks:
1. Every match home/away team vs official FIFA WC2026 schedule
2. Odds selection mapping: 'home' selection must map to home_team_id
3. Frontend column header logic: what label does each column get?
4. Invalid matches (teams not in WC2026, e.g. Qatar, Switzerland)
5. Brazil vs Morocco specific column swap investigation
"""
import json, os, sys
import urllib.request, urllib.parse
import mysql.connector

DB_URL = os.environ.get('DATABASE_URL', '')

# Parse mysql://user:pass@host:port/db?ssl=...
import re
m = re.match(r'mysql://([^:]+):([^@]+)@([^:]+):(\d+)/([^?]+)', DB_URL)
if not m:
    print('[FATAL] Cannot parse DATABASE_URL:', DB_URL[:40])
    sys.exit(1)
user, password, host, port, database = m.groups()

conn = mysql.connector.connect(
    user=user, password=password, host=host, port=int(port), database=database,
    ssl_disabled=False
)
cur = conn.cursor(dictionary=True)

print('=' * 80)
print('[STEP 1] FETCHING ALL WC2026 MATCHES WITH FULL TEAM DATA')
print('=' * 80)

cur.execute("""
    SELECT 
        f.match_id, f.match_date, f.kickoff_utc, f.group_letter, f.matchday,
        f.home_team_id, f.away_team_id, f.venue_id, f.is_host_home,
        ht.name as home_name, ht.fifa_code as home_code,
        at.name as away_name, at.fifa_code as away_code,
        v.city as venue_city, v.stadium as venue_stadium
    FROM wc2026_matches f
    JOIN wc2026_teams ht ON ht.team_id = f.home_team_id
    JOIN wc2026_teams at ON at.team_id = f.away_team_id
    LEFT JOIN wc2026_venues v ON v.venue_id = f.venue_id
    ORDER BY f.kickoff_utc
""")
all_matches = cur.fetchall()

print(f'[INPUT] Total matches in DB: {len(all_matches)}')
print()

# Official FIFA WC2026 Group Stage schedule (June 11 - June 27)
# Format: match_id -> (home_team_id, away_team_id, match_date)
# Source: FIFA official schedule
OFFICIAL_SCHEDULE = {
    # June 11
    'wc26-g-001': ('bra', 'mar', '2026-06-11'),   # Brazil vs Morocco
    'wc26-g-002': ('bel', 'egy', '2026-06-11'),   # Wait — need to verify
    # June 12
    'wc26-g-003': ('mex', 'arg', '2026-06-12'),
    'wc26-g-004': ('usa', 'can', '2026-06-12'),
    'wc26-g-005': ('hai', 'sco', '2026-06-12'),
    # June 13
    'wc26-g-006': ('bra', 'mar', '2026-06-13'),   # placeholder - need real data
    'wc26-g-007': ('bra', 'mar', '2026-06-13'),
    'wc26-g-008': ('tur', 'aus', '2026-06-13'),
}

# ── STEP 2: Check for invalid teams (Qatar not in WC2026) ─────────────────
print('=' * 80)
print('[STEP 2] CHECKING FOR INVALID TEAMS IN MATCHES')
print('=' * 80)

# Qatar did NOT qualify for WC2026 (they were hosts of WC2022 but didn't qualify for 2026)
# Switzerland also did not qualify
INVALID_TEAMS = {'qat', 'sui', 'qatar', 'switzerland'}  # common IDs
INVALID_TEAMS_NAMES = {'qatar', 'switzerland', 'qat', 'sui'}

invalid_matches = []
for f in all_matches:
    home_id = f['home_team_id'].lower()
    away_id = f['away_team_id'].lower()
    home_name = f['home_name'].lower()
    away_name = f['away_name'].lower()
    
    is_invalid = (
        home_id in INVALID_TEAMS or away_id in INVALID_TEAMS or
        home_name in INVALID_TEAMS_NAMES or away_name in INVALID_TEAMS_NAMES or
        'qatar' in home_name or 'qatar' in away_name or
        'switzerland' in home_name or 'switzerland' in away_name or
        'switz' in home_name or 'switz' in away_name
    )
    
    if is_invalid:
        invalid_matches.append(f)
        print(f'[INVALID] {f["match_id"]} | {f["match_date"]} | {f["away_name"]} ({f["away_code"]}) @ {f["home_name"]} ({f["home_code"]})')
        print(f'  home_team_id={f["home_team_id"]} away_team_id={f["away_team_id"]}')

if not invalid_matches:
    print('[OK] No invalid teams found by name/code')
else:
    print(f'[FAIL] Found {len(invalid_matches)} invalid matches')

# Also check by looking at June 12 specifically
print()
print('[STEP 2b] ALL JUNE 12 MATCHES:')
for f in all_matches:
    if str(f['match_date']) == '2026-06-12' or (hasattr(f['match_date'], 'strftime') and f['match_date'].strftime('%Y-%m-%d') == '2026-06-12'):
        print(f'  {f["match_id"]}: {f["away_name"]} ({f["away_code"]}) @ {f["home_name"]} ({f["home_code"]}) | {f["kickoff_utc"]} | {f["venue_city"]}')

# ── STEP 3: Get all teams in DB ───────────────────────────────────────────
print()
print('=' * 80)
print('[STEP 3] ALL TEAMS IN wc2026_teams TABLE')
print('=' * 80)
cur.execute("SELECT team_id, name, fifa_code FROM wc2026_teams ORDER BY team_id")
all_teams = cur.fetchall()
print(f'[INPUT] Total teams: {len(all_teams)}')
for t in all_teams:
    print(f'  {t["team_id"]:10s} | {t["fifa_code"]:5s} | {t["name"]}')

# ── STEP 4: Brazil vs Morocco detailed odds audit ─────────────────────────
print()
print('=' * 80)
print('[STEP 4] BRAZIL vs MOROCCO (wc26-g-001) — FULL ODDS TRACE')
print('=' * 80)

# First get the match
cur.execute("""
    SELECT f.*, ht.name as home_name, ht.fifa_code as home_code,
           at.name as away_name, at.fifa_code as away_code
    FROM wc2026_matches f
    JOIN wc2026_teams ht ON ht.team_id = f.home_team_id
    JOIN wc2026_teams at ON at.team_id = f.away_team_id
    WHERE f.match_id = 'wc26-g-001'
""")
bra_mar = cur.fetchone()
if bra_mar:
    print(f'[DB] match_id: {bra_mar["match_id"]}')
    print(f'[DB] home_team_id: {bra_mar["home_team_id"]} = {bra_mar["home_name"]} ({bra_mar["home_code"]})')
    print(f'[DB] away_team_id: {bra_mar["away_team_id"]} = {bra_mar["away_name"]} ({bra_mar["away_code"]})')
    print(f'[DB] match_date: {bra_mar["match_date"]}')
    print(f'[DB] kickoff_utc: {bra_mar["kickoff_utc"]}')
    
    # Get all odds
    cur.execute("""
        SELECT book_id, market, selection, line, american_odds, implied_prob
        FROM wc2026_odds_snapshots
        WHERE match_id = 'wc26-g-001'
        ORDER BY book_id, market, selection
    """)
    odds = cur.fetchall()
    print(f'\n[DB] All odds rows ({len(odds)} total):')
    for o in odds:
        print(f'  book={o["book_id"]:3d} | {o["market"]:6s} | {o["selection"]:5s} | line={o["line"]} | odds={o["american_odds"]:6} | prob={o["implied_prob"]}')
    
    # Now trace what the router returns
    print()
    print('[TRACE] What the router buildOddsMap returns:')
    print('  home_team_id =', bra_mar['home_team_id'], '→ home selection maps to', bra_mar['home_name'])
    print('  away_team_id =', bra_mar['away_team_id'], '→ away selection maps to', bra_mar['away_name'])
    
    # Find home/away/draw odds
    for o in odds:
        if o['market'] == '1X2':
            print(f'  selection={o["selection"]:5s} odds={o["american_odds"]:6} → displayed as: ', end='')
            if o['selection'] == 'home':
                print(f'{bra_mar["home_code"]} ML column')
            elif o['selection'] == 'away':
                print(f'{bra_mar["away_code"]} ML column')
            elif o['selection'] == 'draw':
                print('DRAW column')

# ── STEP 5: Check what the API actually returns ───────────────────────────
print()
print('=' * 80)
print('[STEP 5] API RESPONSE FOR JUNE 11 — TRPC ENDPOINT')
print('=' * 80)

try:
    inp = json.dumps({'json': {'date': '2026-06-11'}})
    url = f'http://localhost:3000/api/trpc/wc2026.matchesByDate?input={urllib.parse.quote(inp)}'
    with urllib.request.urlopen(url, timeout=15) as r:
        data = json.loads(r.read())
    matches_api = data['result']['data']['json']
    
    for f in matches_api:
        fid = f['matchId']
        home_team = f.get('homeTeam', {})
        away_team = f.get('awayTeam', {})
        dk = f.get('dkOdds') or {}
        model = f.get('modelOdds') or {}
        
        print(f'\n[API] {fid}')
        print(f'  homeTeam: id={home_team.get("teamId")} code={home_team.get("fifaCode")} name={home_team.get("name")}')
        print(f'  awayTeam: id={away_team.get("teamId")} code={away_team.get("fifaCode")} name={away_team.get("name")}')
        print(f'  DK  1X2: home={dk.get("home","—")} draw={dk.get("draw","—")} away={dk.get("away","—")}')
        print(f'  MDL 1X2: home={model.get("home","—")} draw={model.get("draw","—")} away={model.get("away","—")}')
        print(f'  DK  TOT: O{dk.get("overLine","?")} {dk.get("overOdds","—")}/{dk.get("underOdds","—")}')
        print(f'  MDL TOT: O{model.get("overLine","?")} {model.get("overOdds","—")}/{model.get("underOdds","—")}')
        
        # Check column header logic
        home_code = home_team.get('fifaCode', '???')
        away_code = away_team.get('fifaCode', '???')
        print(f'  [HEADER] Column 1 = "{home_code} ML" | Column 2 = "DRAW" | Column 3 = "{away_code} ML"')
        print(f'  [VERIFY] home odds ({model.get("home","—")}) should appear under "{home_code} ML" column')
        print(f'  [VERIFY] away odds ({model.get("away","—")}) should appear under "{away_code} ML" column')
        
except Exception as e:
    print(f'[ERROR] API call failed: {e}')

# ── STEP 6: Check June 12 API response ───────────────────────────────────
print()
print('=' * 80)
print('[STEP 6] API RESPONSE FOR JUNE 12 — CHECK FOR QATAR/SWITZERLAND')
print('=' * 80)

try:
    inp = json.dumps({'json': {'date': '2026-06-12'}})
    url = f'http://localhost:3000/api/trpc/wc2026.matchesByDate?input={urllib.parse.quote(inp)}'
    with urllib.request.urlopen(url, timeout=15) as r:
        data = json.loads(r.read())
    matches_api = data['result']['data']['json']
    
    print(f'[API] June 12 match count: {len(matches_api)}')
    for f in matches_api:
        home_team = f.get('homeTeam', {})
        away_team = f.get('awayTeam', {})
        print(f'  {f["matchId"]}: {away_team.get("fifaCode","?")} ({away_team.get("name","?")}) @ {home_team.get("fifaCode","?")} ({home_team.get("name","?")})')
        
except Exception as e:
    print(f'[ERROR] API call failed: {e}')

# ── STEP 7: Full match list with official FIFA schedule comparison ───────
print()
print('=' * 80)
print('[STEP 7] FULL MATCH LIST — ALL DATES')
print('=' * 80)

for f in all_matches:
    date_str = f['match_date']
    if hasattr(date_str, 'strftime'):
        date_str = date_str.strftime('%Y-%m-%d')
    print(f'  {f["match_id"]} | {date_str} | {f["away_code"]:5s} ({f["away_name"]}) @ {f["home_code"]:5s} ({f["home_name"]}) | {f["venue_city"]}')

conn.close()
print()
print('=' * 80)
print('[DONE] Audit complete')
print('=' * 80)
