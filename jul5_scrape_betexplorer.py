#!/usr/bin/env python3
"""
Jul 5 BetExplorer Scraper — BRA vs NOR (tpOhKWcC) + MEX vs ENG (need event ID)
Scrapes bet365 odds from all markets via AJAX endpoints.
"""
import requests, time, re, json, sys
from bs4 import BeautifulSoup

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/javascript, */*',
    'X-Requested-With': 'XMLHttpRequest',
}

def decimal_to_american(dec):
    """Convert decimal odds to American."""
    if dec >= 2.0:
        return int(round((dec - 1) * 100))
    else:
        return int(round(-100 / (dec - 1)))

def parse_bet365_from_html(html, market_type):
    """Extract bet365 odds from BetExplorer AJAX HTML response."""
    soup = BeautifulSoup(html, 'html.parser')
    results = {}
    
    # Find bet365 row
    bet365_row = None
    rows = soup.find_all('tr')
    for row in rows:
        name_cell = row.find('a', class_='in-bookmaker-logo-link')
        if name_cell and 'bet365' in name_cell.get('title', '').lower():
            bet365_row = row
            break
    
    if not bet365_row:
        # Try alternate: look for data-bid="16" (bet365's ID)
        for row in rows:
            if row.get('data-bid') == '16':
                bet365_row = row
                break
    
    if not bet365_row:
        # Fallback: get average/best odds from header
        print(f"  [WARN] No bet365 row found for {market_type}, using average")
        return None
    
    # Extract odds from cells
    cells = bet365_row.find_all('td', class_='table-main__odds')
    if not cells:
        cells = bet365_row.find_all('td', attrs={'data-odd': True})
    
    odds_values = []
    for cell in cells:
        odd_val = cell.get('data-odd')
        if odd_val:
            odds_values.append(float(odd_val))
        else:
            text = cell.get_text(strip=True)
            try:
                odds_values.append(float(text))
            except:
                pass
    
    # Also check for handicap value
    hcp_cell = bet365_row.find('td', class_='table-main__doubleparameter')
    hcp_value = None
    if hcp_cell:
        hcp_text = hcp_cell.get_text(strip=True)
        try:
            hcp_value = float(hcp_text)
        except:
            pass
    
    return {'odds': odds_values, 'hcp': hcp_value}

def parse_all_bookmakers(html, market_type):
    """Parse all bookmaker rows to find bet365 and get average."""
    soup = BeautifulSoup(html, 'html.parser')
    
    # The AJAX response is JSON with an 'odds' key containing HTML
    try:
        data = json.loads(html)
        odds_html = data.get('odds', '')
        soup = BeautifulSoup(odds_html, 'html.parser')
    except json.JSONDecodeError:
        soup = BeautifulSoup(html, 'html.parser')
    
    bet365_odds = None
    all_odds = []
    
    # Find all bookmaker rows
    rows = soup.find_all('tr', attrs={'data-bid': True})
    
    for row in rows:
        bid = row.get('data-bid', '')
        
        # Get odds from this row
        cells = row.find_all('td', attrs={'data-odd': True})
        odds_vals = [float(c['data-odd']) for c in cells if c.get('data-odd')]
        
        # Get handicap if present
        hcp_cell = row.find('td', class_='table-main__doubleparameter')
        hcp = None
        if hcp_cell:
            try:
                hcp = float(hcp_cell.get_text(strip=True))
            except:
                pass
        
        if odds_vals:
            all_odds.append({'bid': bid, 'odds': odds_vals, 'hcp': hcp})
        
        # bet365 = bid 16
        if bid == '16' and odds_vals:
            bet365_odds = {'odds': odds_vals, 'hcp': hcp}
    
    return bet365_odds, all_odds

def scrape_match(event_id, match_label, referer_slug):
    """Scrape all markets for a match."""
    print(f"\n{'='*80}")
    print(f"  SCRAPING: {match_label} (event_id={event_id})")
    print(f"{'='*80}")
    
    h = dict(headers)
    h['Referer'] = f'https://www.betexplorer.com/football/world/world-championship-2026/{referer_slug}/{event_id}/'
    
    markets = {
        '1x2': '1',
        'ou': '2',
        'ah': '3',
        'dc': '5',
        'bts': '6',
    }
    
    results = {}
    
    for mkt_name, mkt_id in markets.items():
        url = f'https://www.betexplorer.com/match-odds/{event_id}/0/{mkt_id}/bestOdds/'
        try:
            r = requests.get(url, headers=h, timeout=15)
            if r.status_code == 200:
                bet365, all_bk = parse_all_bookmakers(r.text, mkt_name)
                if bet365:
                    print(f"  [✅] {mkt_name}: bet365 found — odds={bet365['odds']} hcp={bet365['hcp']}")
                    results[mkt_name] = bet365
                elif all_bk:
                    # Use first bookmaker as fallback
                    print(f"  [⚠️] {mkt_name}: No bet365, using first of {len(all_bk)} bookmakers")
                    results[mkt_name] = all_bk[0]
                else:
                    print(f"  [❌] {mkt_name}: No odds parsed from {len(r.text)} bytes")
            else:
                print(f"  [❌] {mkt_name}: HTTP {r.status_code}")
        except Exception as e:
            print(f"  [❌] {mkt_name}: {e}")
        time.sleep(2)
    
    return results

def convert_and_display(results, home_team, away_team):
    """Convert decimal odds to American and display."""
    print(f"\n  {'─'*60}")
    print(f"  CONVERTED ODDS (American) — {home_team} vs {away_team}")
    print(f"  {'─'*60}")
    
    converted = {}
    
    if '1x2' in results:
        odds = results['1x2']['odds']
        if len(odds) >= 3:
            h_ml = decimal_to_american(odds[0])
            d_ml = decimal_to_american(odds[1])
            a_ml = decimal_to_american(odds[2])
            print(f"  1X2: {home_team}={h_ml:+d} Draw={d_ml:+d} {away_team}={a_ml:+d}")
            converted['1x2'] = {'home': h_ml, 'draw': d_ml, 'away': a_ml}
    
    if 'ou' in results:
        odds = results['ou']['odds']
        hcp = results['ou']['hcp']
        if len(odds) >= 2:
            over = decimal_to_american(odds[0])
            under = decimal_to_american(odds[1])
            print(f"  O/U {hcp}: Over={over:+d} Under={under:+d}")
            converted['ou'] = {'over': over, 'under': under, 'line': hcp}
    
    if 'ah' in results:
        odds = results['ah']['odds']
        hcp = results['ah']['hcp']
        if len(odds) >= 2:
            home_ah = decimal_to_american(odds[0])
            away_ah = decimal_to_american(odds[1])
            print(f"  AH {hcp}: {home_team}={home_ah:+d} {away_team}={away_ah:+d}")
            converted['ah'] = {'home': home_ah, 'away': away_ah, 'line': hcp}
    
    if 'bts' in results:
        odds = results['bts']['odds']
        if len(odds) >= 2:
            yes = decimal_to_american(odds[0])
            no = decimal_to_american(odds[1])
            print(f"  BTTS: Yes={yes:+d} No={no:+d}")
            converted['bts'] = {'yes': yes, 'no': no}
    
    if 'dc' in results:
        odds = results['dc']['odds']
        if len(odds) >= 3:
            hwd = decimal_to_american(odds[0])
            awd = decimal_to_american(odds[1])
            nd = decimal_to_american(odds[2])
            print(f"  DC: {home_team}WD={hwd:+d} {away_team}WD={awd:+d} NoDraw={nd:+d}")
            converted['dc'] = {'home_wd': hwd, 'away_wd': awd, 'no_draw': nd}
    
    return converted

# ═══════════════════════════════════════════════════════════════════════════
# MAIN EXECUTION
# ═══════════════════════════════════════════════════════════════════════════
print("╔══════════════════════════════════════════════════════════════════════════════╗")
print("║  BETEXPLORER SCRAPER — JUL 5 R16 MATCHES                                   ║")
print("║  BRA vs NOR (tpOhKWcC) | MEX vs ENG (TBD)                                  ║")
print("╚══════════════════════════════════════════════════════════════════════════════╝")

# Match 1: BRA vs NOR
bra_nor = scrape_match('tpOhKWcC', 'Brazil vs Norway (R16-091)', 'brazil-norway')
bra_nor_conv = convert_and_display(bra_nor, 'BRA', 'NOR')

# Find MEX vs ENG event ID
print("\n\n[STEP] Finding Mexico vs England event ID...")
h2 = dict(headers)
h2['Accept'] = 'text/html'
del h2['X-Requested-With']

# Try the fixtures page
r = requests.get('https://www.betexplorer.com/football/world/world-championship-2026/fixtures/', headers=h2, timeout=15)
print(f"  Fixtures page: status={r.status_code} len={len(r.text)}")

# Search for mexico-england link
match = re.search(r'mexico-england/([a-zA-Z0-9]+)/', r.text)
if match:
    mex_eng_id = match.group(1)
    print(f"  [✅] Found MEX vs ENG event ID: {mex_eng_id}")
else:
    # Try alternate patterns
    match2 = re.search(r'england-mexico/([a-zA-Z0-9]+)/', r.text)
    if match2:
        mex_eng_id = match2.group(1)
        print(f"  [✅] Found ENG vs MEX event ID: {mex_eng_id}")
    else:
        print("  [❌] Could not find MEX vs ENG event ID from fixtures page")
        # Try the main page
        r2 = requests.get('https://www.betexplorer.com/football/world/world-championship-2026/', headers=h2, timeout=15)
        match3 = re.search(r'mexico-england/([a-zA-Z0-9]+)/', r2.text)
        if match3:
            mex_eng_id = match3.group(1)
            print(f"  [✅] Found MEX vs ENG event ID from main page: {mex_eng_id}")
        else:
            print("  [FATAL] Cannot find event ID. Trying known pattern...")
            mex_eng_id = None

if mex_eng_id:
    time.sleep(3)
    mex_eng = scrape_match(mex_eng_id, 'Mexico vs England (R16-092)', 'mexico-england')
    mex_eng_conv = convert_and_display(mex_eng, 'MEX', 'ENG')
else:
    mex_eng_conv = None

# Save results
output = {
    'bra_nor': {'event_id': 'tpOhKWcC', 'raw': {k: {'odds': v['odds'], 'hcp': v['hcp']} for k,v in bra_nor.items()}, 'american': bra_nor_conv},
    'mex_eng': {'event_id': mex_eng_id, 'raw': {k: {'odds': v['odds'], 'hcp': v['hcp']} for k,v in (mex_eng if mex_eng_id else {}).items()}, 'american': mex_eng_conv} if mex_eng_id else None,
}

with open('jul5_bet365_odds.json', 'w') as f:
    json.dump(output, f, indent=2)
print(f"\n[SAVED] jul5_bet365_odds.json")
print("\n[DONE] Scraping complete.")
