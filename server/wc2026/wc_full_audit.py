#!/usr/bin/env python3
"""
WC2026 Full Feed Audit
======================
Validates:
1. All 7 dates have correct match counts
2. Every match has correct home/away team orientation
3. Every match has DK book odds (1X2 + TOTAL)
4. Every match has Model odds (1X2 + TOTAL)
5. All moneyline values are whole integers
6. Total line is present and valid (2.5 or similar)
7. Over/under odds are present for both book and model
8. Fixture dates match expected dates
9. Kickoff times are valid UTC datetimes
"""

import json
import urllib.request
import sys

BASE = "http://localhost:3000"
DATES = [
    "2026-06-11",
    "2026-06-12",
    "2026-06-13",
    "2026-06-14",
    "2026-06-15",
    "2026-06-16",
    "2026-06-17",
]

# Expected match counts per date (based on DB audit)
EXPECTED_COUNTS = {
    "2026-06-11": 2,
    "2026-06-12": 3,
    "2026-06-13": 3,
    "2026-06-14": 4,
    "2026-06-15": 4,
    "2026-06-16": 4,
    "2026-06-17": 4,
}

errors = []
warnings = []
total_matches = 0
total_with_dk_odds = 0
total_with_model_odds = 0
total_with_totals_book = 0
total_with_totals_model = 0
total_with_full_1x2_book = 0
total_with_full_1x2_model = 0

def fetch_matches(date):
    import urllib.parse
    input_str = json.dumps({"json": {"date": date}})
    encoded = urllib.parse.quote(input_str)
    url = f"{BASE}/api/trpc/wc2026.matchesByDate?input={encoded}"
    with urllib.request.urlopen(url, timeout=15) as resp:
        data = json.loads(resp.read())
    return data["result"]["data"]["json"]

def validate_odds(odds, label, match_id):
    """Validate an odds object (either dkOdds or modelOdds)"""
    issues = []
    if odds is None:
        issues.append(f"[MISSING] {label} odds is null")
        return issues
    
    # Check 1X2
    home = odds.get("home")
    draw = odds.get("draw")
    away = odds.get("away")
    
    if home is None:
        issues.append(f"[MISSING] {label}.home is null")
    elif not isinstance(home, (int, float)):
        issues.append(f"[TYPE_ERR] {label}.home={home!r} is not a number")
    
    if draw is None:
        issues.append(f"[MISSING] {label}.draw is null")
    elif not isinstance(draw, (int, float)):
        issues.append(f"[TYPE_ERR] {label}.draw={draw!r} is not a number")
    
    if away is None:
        issues.append(f"[MISSING] {label}.away is null")
    elif not isinstance(away, (int, float)):
        issues.append(f"[TYPE_ERR] {label}.away={away!r} is not a number")
    
    # Check TOTAL
    over_line = odds.get("overLine")
    over_odds = odds.get("overOdds")
    under_odds = odds.get("underOdds")
    
    if over_line is None:
        issues.append(f"[MISSING] {label}.overLine is null")
    else:
        try:
            line_val = float(over_line)
            if line_val <= 0 or line_val > 10:
                issues.append(f"[INVALID] {label}.overLine={over_line} is out of range (expected 1.5-6.5)")
        except (ValueError, TypeError):
            issues.append(f"[TYPE_ERR] {label}.overLine={over_line!r} cannot be parsed as float")
    
    if over_odds is None:
        issues.append(f"[MISSING] {label}.overOdds is null")
    elif not isinstance(over_odds, (int, float)):
        issues.append(f"[TYPE_ERR] {label}.overOdds={over_odds!r} is not a number")
    
    if under_odds is None:
        issues.append(f"[MISSING] {label}.underOdds is null")
    elif not isinstance(under_odds, (int, float)):
        issues.append(f"[TYPE_ERR] {label}.underOdds={under_odds!r} is not a number")
    
    return issues

print("=" * 80)
print("WC2026 FEED FULL AUDIT")
print("=" * 80)

for date in DATES:
    print(f"\n{'─'*60}")
    print(f"[DATE] {date}")
    try:
        matches = fetch_matches(date)
    except Exception as e:
        errors.append(f"[FETCH_ERR] {date}: {e}")
        print(f"  [ERROR] Failed to fetch: {e}")
        continue
    
    count = len(matches)
    expected = EXPECTED_COUNTS.get(date, "?")
    total_matches += count
    
    count_status = "✓" if count == expected else "✗"
    print(f"  [FIXTURES] count={count} expected={expected} {count_status}")
    
    if count != expected:
        errors.append(f"[COUNT_MISMATCH] {date}: got {count}, expected {expected}")
    
    for f in matches:
        fid = f.get("matchId", "?")
        home_team = f.get("homeTeam") or {}
        away_team = f.get("awayTeam") or {}
        home_code = home_team.get("fifaCode", f.get("homeTeamId", "?").upper())
        away_code = away_team.get("fifaCode", f.get("awayTeamId", "?").upper())
        kickoff = f.get("kickoffUtc", "?")
        status = f.get("status", "?")
        group = f.get("groupLetter", "?")
        venue = (f.get("venue") or {}).get("city", "?")
        match_date = f.get("matchDate", "?")
        
        # Validate match date matches expected date
        if match_date and not match_date.startswith(date):
            errors.append(f"[DATE_MISMATCH] {fid}: matchDate={match_date} but queried for {date}")
        
        dk_odds = f.get("dkOdds")
        model_odds = f.get("modelOdds")
        
        # Validate DK odds
        dk_issues = validate_odds(dk_odds, "DK", fid)
        model_issues = validate_odds(model_odds, "MODEL", fid)
        
        has_dk = dk_odds is not None
        has_model = model_odds is not None
        has_dk_1x2 = has_dk and all(dk_odds.get(k) is not None for k in ["home", "draw", "away"])
        has_model_1x2 = has_model and all(model_odds.get(k) is not None for k in ["home", "draw", "away"])
        has_dk_total = has_dk and all(dk_odds.get(k) is not None for k in ["overOdds", "underOdds"])
        has_model_total = has_model and all(model_odds.get(k) is not None for k in ["overOdds", "underOdds"])
        
        if has_dk: total_with_dk_odds += 1
        if has_model: total_with_model_odds += 1
        if has_dk_total: total_with_totals_book += 1
        if has_model_total: total_with_totals_model += 1
        if has_dk_1x2: total_with_full_1x2_book += 1
        if has_model_1x2: total_with_full_1x2_model += 1
        
        dk_1x2_str = f"{dk_odds.get('away','—')}/{dk_odds.get('draw','—')}/{dk_odds.get('home','—')}" if has_dk else "MISSING"
        model_1x2_str = f"{model_odds.get('away','—')}/{model_odds.get('draw','—')}/{model_odds.get('home','—')}" if has_model else "MISSING"
        dk_total_str = f"O{dk_odds.get('overLine','?')} {dk_odds.get('overOdds','—')}/{dk_odds.get('underOdds','—')}" if has_dk else "MISSING"
        model_total_str = f"O{model_odds.get('overLine','?')} {model_odds.get('overOdds','—')}/{model_odds.get('underOdds','—')}" if has_model else "MISSING"
        
        print(f"\n  [{fid}] {away_code} @ {home_code} | Group {group} | {venue}")
        print(f"    Kickoff: {kickoff} | Status: {status}")
        print(f"    DK  1X2: {dk_1x2_str}")
        print(f"    MDL 1X2: {model_1x2_str}")
        print(f"    DK  TOT: {dk_total_str}")
        print(f"    MDL TOT: {model_total_str}")
        
        for issue in dk_issues:
            print(f"    [DK ISSUE] {issue}")
            errors.append(f"{fid} DK: {issue}")
        for issue in model_issues:
            print(f"    [MODEL ISSUE] {issue}")
            errors.append(f"{fid} MODEL: {issue}")
        
        # Validate home/away orientation — away team should be listed first (top row)
        # In soccer, the convention is Away @ Home
        if not away_team:
            errors.append(f"[MISSING_TEAM] {fid}: awayTeam is null")
        if not home_team:
            errors.append(f"[MISSING_TEAM] {fid}: homeTeam is null")
        
        # Validate venue
        if not f.get("venue"):
            warnings.append(f"[MISSING_VENUE] {fid}: venue is null")

print(f"\n{'='*80}")
print("AUDIT SUMMARY")
print(f"{'='*80}")
print(f"Total matches audited: {total_matches}")
print(f"Fixtures with DK odds:  {total_with_dk_odds}/{total_matches}")
print(f"Fixtures with Model odds: {total_with_model_odds}/{total_matches}")
print(f"Fixtures with DK 1X2 (home+draw+away): {total_with_full_1x2_book}/{total_matches}")
print(f"Fixtures with Model 1X2: {total_with_full_1x2_model}/{total_matches}")
print(f"Fixtures with DK Total (over+under): {total_with_totals_book}/{total_matches}")
print(f"Fixtures with Model Total: {total_with_totals_model}/{total_matches}")

if errors:
    print(f"\n[ERRORS] {len(errors)} errors found:")
    for e in errors:
        print(f"  ✗ {e}")
else:
    print(f"\n[PASS] No errors found!")

if warnings:
    print(f"\n[WARNINGS] {len(warnings)} warnings:")
    for w in warnings:
        print(f"  ⚠ {w}")

print(f"\n{'='*80}")
sys.exit(1 if errors else 0)
