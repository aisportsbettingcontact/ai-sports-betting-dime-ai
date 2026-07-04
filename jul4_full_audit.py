#!/usr/bin/env python3
"""
Jul 4 wc2026MatchOdds FULL AUDIT
=================================
1. Scrape fresh bet365 odds from BetExplorer AJAX (all 5 markets, both matches)
2. Pull current DB state
3. Cross-validate every book/model value
4. Report all discrepancies
"""
import requests
import json
import time
import os
import sys
from fractions import Fraction
from decimal import Decimal, ROUND_HALF_UP
from bs4 import BeautifulSoup

# ─── CONFIG ───────────────────────────────────────────────────────────────────
BET365_BID = 16
BET365_BID_US = 549
MATCHES = [
    {"id": "wc26-r16-089", "event_id": "M5YPKKbB", "slug": "paraguay-france",
     "be_name": "Paraguay - France", "home": "PAR", "away": "FRA"},
    {"id": "wc26-r16-090", "event_id": "pUYfr7u3", "slug": "canada-morocco",
     "be_name": "Canada - Morocco", "home": "CAN", "away": "MAR"},
]
MARKETS = ["1x2", "ou", "ah", "dc", "bts"]
BASE_URL = "https://www.betexplorer.com"

# ─── ODDS CONVERSION ─────────────────────────────────────────────────────────
def dec_to_american(dec_str):
    dec_str = str(dec_str).strip()
    if not dec_str or dec_str in ("0", "0.0", "—", "-", ""):
        return None
    frac = Fraction(dec_str)
    dec = Decimal(frac.numerator) / Decimal(frac.denominator)
    if dec == Decimal("1.00"):
        return 100
    if dec >= Decimal("2.00"):
        raw = (dec - Decimal("1")) * Decimal("100")
        return int(raw.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    else:
        raw = Decimal("-100") / (dec - Decimal("1"))
        return int(raw.quantize(Decimal("1"), rounding=ROUND_HALF_UP))

# ─── SCRAPE FUNCTIONS ─────────────────────────────────────────────────────────
def create_session():
    s = requests.Session()
    s.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Connection': 'keep-alive',
    })
    return s

def fetch_market_html(session, event_id, market, slug):
    referer = f'{BASE_URL}/football/world/world-championship-2026/{slug}/{event_id}/'
    session.headers['Referer'] = referer
    url = f'{BASE_URL}/match-odds/{event_id}/0/{market}/bestOdds/?lang=en'
    resp = session.get(url, timeout=25)
    if resp.status_code != 200:
        raise ValueError(f"HTTP {resp.status_code} for {event_id}/{market}")
    data = resp.json()
    html = data.get("odds", "")
    if not html:
        raise ValueError(f"Empty odds for {event_id}/{market}")
    return BeautifulSoup(html, "html.parser")

def find_bet365_row(soup):
    """Find bet365 row (bid=16 or bid=549)"""
    row = soup.select_one(f'tr[data-bid="{BET365_BID}"]')
    if not row:
        row = soup.select_one(f'tr[data-bid="{BET365_BID_US}"]')
    return row

def parse_1x2(soup):
    row = find_bet365_row(soup)
    if not row:
        # Try average/closing odds row
        raise ValueError("No bet365 row found for 1x2")
    cells = row.select("td[data-odd]")
    if len(cells) < 3:
        raise ValueError(f"1x2 row has {len(cells)} cells (need 3)")
    home_dec = cells[0].get("data-odd")
    draw_dec = cells[1].get("data-odd")
    away_dec = cells[2].get("data-odd")
    return {
        "home_ml": dec_to_american(home_dec),
        "draw": dec_to_american(draw_dec),
        "away_ml": dec_to_american(away_dec),
        "home_dec": home_dec,
        "draw_dec": draw_dec,
        "away_dec": away_dec,
    }

def parse_ou(soup):
    """Parse O/U market — find the 2.5 line from bet365"""
    results = {}
    # Find all handicap sections
    sections = soup.select('div.oddsComparisonAll__row')
    if not sections:
        # Try table-based layout
        rows = soup.select(f'tr[data-bid="{BET365_BID}"], tr[data-bid="{BET365_BID_US}"]')
        for row in rows:
            hcp = row.get("data-hcp", "")
            cells = row.select("td[data-odd]")
            if len(cells) >= 2 and hcp:
                try:
                    line = float(hcp)
                    over_dec = cells[0].get("data-odd")
                    under_dec = cells[1].get("data-odd")
                    results[str(line)] = {
                        "over": dec_to_american(over_dec),
                        "under": dec_to_american(under_dec),
                        "over_dec": over_dec,
                        "under_dec": under_dec,
                    }
                except:
                    pass
    else:
        # Modern layout with data-hcp on rows
        all_rows = soup.select(f'tr[data-bid="{BET365_BID}"], tr[data-bid="{BET365_BID_US}"]')
        for row in all_rows:
            hcp = row.get("data-hcp", "")
            cells = row.select("td[data-odd]")
            if len(cells) >= 2 and hcp:
                try:
                    line = float(hcp)
                    over_dec = cells[0].get("data-odd")
                    under_dec = cells[1].get("data-odd")
                    results[str(line)] = {
                        "over": dec_to_american(over_dec),
                        "under": dec_to_american(under_dec),
                        "over_dec": over_dec,
                        "under_dec": under_dec,
                    }
                except:
                    pass
    return results

def parse_ah(soup):
    """Parse AH (spread) market — find bet365 lines"""
    results = {}
    rows = soup.select(f'tr[data-bid="{BET365_BID}"], tr[data-bid="{BET365_BID_US}"]')
    for row in rows:
        hcp = row.get("data-hcp", "")
        cells = row.select("td[data-odd]")
        if len(cells) >= 2 and hcp:
            try:
                line = float(hcp)
                home_dec = cells[0].get("data-odd")
                away_dec = cells[1].get("data-odd")
                results[str(line)] = {
                    "home_spread_odds": dec_to_american(home_dec),
                    "away_spread_odds": dec_to_american(away_dec),
                    "home_dec": home_dec,
                    "away_dec": away_dec,
                    "line": line,
                }
            except:
                pass
    return results

def parse_dc(soup):
    """Parse Double Chance market"""
    row = find_bet365_row(soup)
    if not row:
        raise ValueError("No bet365 row for DC")
    cells = row.select("td[data-odd]")
    if len(cells) < 3:
        raise ValueError(f"DC row has {len(cells)} cells (need 3)")
    # DC: pos1=1X (home or draw), pos2=12 (no draw), pos3=X2 (away or draw)
    hod_dec = cells[0].get("data-odd")  # 1X = Home or Draw
    nd_dec = cells[1].get("data-odd")   # 12 = No Draw
    aod_dec = cells[2].get("data-odd")  # X2 = Away or Draw
    return {
        "home_or_draw": dec_to_american(hod_dec),
        "no_draw": dec_to_american(nd_dec),
        "away_or_draw": dec_to_american(aod_dec),
        "hod_dec": hod_dec,
        "nd_dec": nd_dec,
        "aod_dec": aod_dec,
    }

def parse_bts(soup):
    """Parse BTTS market"""
    row = find_bet365_row(soup)
    if not row:
        raise ValueError("No bet365 row for BTS")
    cells = row.select("td[data-odd]")
    if len(cells) < 2:
        raise ValueError(f"BTS row has {len(cells)} cells (need 2)")
    yes_dec = cells[0].get("data-odd")
    no_dec = cells[1].get("data-odd")
    return {
        "btts_yes": dec_to_american(yes_dec),
        "btts_no": dec_to_american(no_dec),
        "yes_dec": yes_dec,
        "no_dec": no_dec,
    }

# ─── MAIN ─────────────────────────────────────────────────────────────────────
def main():
    print("=" * 80)
    print("  WC2026 JUL 4 — FULL BETEXPLORER SCRAPE + AUDIT")
    print("=" * 80)
    
    session = create_session()
    all_data = {}
    
    for match in MATCHES:
        eid = match["event_id"]
        slug = match["slug"]
        mid = match["id"]
        print(f"\n{'─'*70}")
        print(f"  {mid}: {match['be_name']} (event_id={eid})")
        print(f"{'─'*70}")
        
        match_data = {"match": match, "markets": {}}
        
        for market in MARKETS:
            try:
                soup = fetch_market_html(session, eid, market, slug)
                
                if market == "1x2":
                    parsed = parse_1x2(soup)
                    match_data["markets"]["1x2"] = parsed
                    print(f"  ✓ 1X2: Home={parsed['home_ml']:+d} Draw={parsed['draw']:+d} Away={parsed['away_ml']:+d}")
                    
                elif market == "ou":
                    parsed = parse_ou(soup)
                    match_data["markets"]["ou"] = parsed
                    if "2.5" in parsed:
                        p = parsed["2.5"]
                        print(f"  ✓ O/U 2.5: Over={p['over']:+d} Under={p['under']:+d}")
                    else:
                        print(f"  ✓ O/U lines: {list(parsed.keys())}")
                        
                elif market == "ah":
                    parsed = parse_ah(soup)
                    match_data["markets"]["ah"] = parsed
                    # Find the primary spread line
                    for line_key in sorted(parsed.keys(), key=lambda x: abs(float(x))):
                        p = parsed[line_key]
                        print(f"  ✓ AH {line_key}: Home={p['home_spread_odds']:+d} Away={p['away_spread_odds']:+d}")
                    
                elif market == "dc":
                    parsed = parse_dc(soup)
                    match_data["markets"]["dc"] = parsed
                    print(f"  ✓ DC: 1X={parsed['home_or_draw']:+d} 12={parsed['no_draw']:+d} X2={parsed['away_or_draw']:+d}")
                    
                elif market == "bts":
                    parsed = parse_bts(soup)
                    match_data["markets"]["bts"] = parsed
                    print(f"  ✓ BTS: Yes={parsed['btts_yes']:+d} No={parsed['btts_no']:+d}")
                    
            except Exception as e:
                print(f"  ✗ {market}: {type(e).__name__}: {e}")
                match_data["markets"][market] = {"error": str(e)}
            
            time.sleep(2)  # 2s between requests
        
        all_data[mid] = match_data
    
    # Save results
    output_path = "/home/ubuntu/ai-sports-betting/jul4_fresh_scrape.json"
    with open(output_path, "w") as f:
        json.dump(all_data, f, indent=2)
    print(f"\n\n{'='*80}")
    print(f"  SCRAPE COMPLETE — saved to {output_path}")
    print(f"{'='*80}")
    
    # Print summary for DB comparison
    print(f"\n\n{'='*80}")
    print(f"  FRESH BET365 ODDS — DB COMPARISON FORMAT")
    print(f"{'='*80}")
    
    for mid, mdata in all_data.items():
        match = mdata["match"]
        mkts = mdata["markets"]
        print(f"\n  {mid} ({match['home']} vs {match['away']}):")
        
        if "1x2" in mkts and "error" not in mkts["1x2"]:
            m = mkts["1x2"]
            print(f"    book_home_ml = {m['home_ml']}")
            print(f"    book_draw = {m['draw']}")
            print(f"    book_away_ml = {m['away_ml']}")
        
        if "ou" in mkts and "error" not in mkts["ou"]:
            if "2.5" in mkts["ou"]:
                m = mkts["ou"]["2.5"]
                print(f"    book_over_odds = {m['over']}  (line 2.5)")
                print(f"    book_under_odds = {m['under']}  (line 2.5)")
        
        if "ah" in mkts and "error" not in mkts["ah"]:
            # Find the -1.5 or -2.5 line (primary spread)
            ah = mkts["ah"]
            for line_key in sorted(ah.keys(), key=lambda x: abs(float(x))):
                line = float(line_key)
                if abs(line) in (0.5, 1.0, 1.5, 2.0, 2.5):
                    p = ah[line_key]
                    print(f"    book_primary_spread = {line}")
                    print(f"    book_home_primary_spread_odds = {p['home_spread_odds']}  (AH {line_key})")
                    print(f"    book_away_primary_spread_odds = {p['away_spread_odds']}  (AH {line_key})")
        
        if "dc" in mkts and "error" not in mkts["dc"]:
            m = mkts["dc"]
            print(f"    book_home_wd = {m['home_or_draw']}  (1X)")
            print(f"    book_no_draw = {m['no_draw']}  (12)")
            print(f"    book_away_wd = {m['away_or_draw']}  (X2)")
        
        if "bts" in mkts and "error" not in mkts["bts"]:
            m = mkts["bts"]
            print(f"    book_btts_yes = {m['btts_yes']}")
            print(f"    book_btts_no = {m['btts_no']}")

if __name__ == "__main__":
    main()
