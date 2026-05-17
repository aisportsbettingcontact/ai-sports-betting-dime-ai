#!/usr/bin/env python3.11
"""
Diagnostic: Run MLBAIModel for ATL@LAD with rl_home_spread=-1.5 and +1.5
to determine which produces modelHomeSpreadOdds=-221.
"""
import sys
sys.path.insert(0, '/home/ubuntu/ai-sports-betting/server')
from MLBAIModel import project_game
from datetime import datetime

# Typical team stats for ATL (away) and LAD (home)
# Using representative 2026 season values
atl_stats = {
    'rpg': 4.2, 'era': 4.1, 'whip': 1.25, 'k9': 8.5, 'bb9': 3.2,
    'hr9': 1.1, 'fip': 4.0, 'xfip': 4.1, 'avg': 0.248, 'obp': 0.320,
    'slg': 0.415, 'woba': 0.320, 'k_pct': 0.230, 'bb_pct': 0.085,
    'hr_pct': 0.032, 'single_pct': 0.145, 'double_pct': 0.045, 'triple_pct': 0.005,
    'ip_per_game': 5.5
}
lad_stats = {
    'rpg': 4.8, 'era': 3.8, 'whip': 1.18, 'k9': 9.2, 'bb9': 2.9,
    'hr9': 1.0, 'fip': 3.7, 'xfip': 3.8, 'avg': 0.255, 'obp': 0.330,
    'slg': 0.430, 'woba': 0.330, 'k_pct': 0.220, 'bb_pct': 0.080,
    'hr_pct': 0.033, 'single_pct': 0.150, 'double_pct': 0.048, 'triple_pct': 0.005,
    'ip_per_game': 5.8
}
atl_pitcher = {
    'era': 4.2, 'fip': 4.0, 'xfip': 4.1, 'k9': 8.0, 'bb9': 3.0,
    'hr9': 1.2, 'k_pct': 0.220, 'bb_pct': 0.082, 'hr_pct': 0.033,
    'single_pct': 0.145, 'double_pct': 0.044, 'triple_pct': 0.004,
    'whiff_pct': 0.28, 'ip_per_game': 5.5, 'throwsHand': 0,
    'rolling_era': 4.2, 'rolling_starts': 5, 'fip_minus': 100, 'era_minus': 100
}
lad_pitcher = {
    'era': 3.5, 'fip': 3.4, 'xfip': 3.5, 'k9': 9.5, 'bb9': 2.5,
    'hr9': 0.9, 'k_pct': 0.260, 'bb_pct': 0.068, 'hr_pct': 0.025,
    'single_pct': 0.135, 'double_pct': 0.040, 'triple_pct': 0.003,
    'whiff_pct': 0.32, 'ip_per_game': 6.0, 'throwsHand': 1,
    'rolling_era': 3.5, 'rolling_starts': 6, 'fip_minus': 85, 'era_minus': 87
}

print("=" * 70)
print("TEST 1: rl_home_spread = -1.5 (LAD is -1.5 favorite — CORRECT)")
print("=" * 70)
book_lines_correct = {
    'ml_away': 113, 'ml_home': -136, 'ou_line': 9.0,
    'over_odds': -118, 'under_odds': -102,
    'rl_home_spread': -1.5, 'rl_home': 149, 'rl_away': -181
}
r1 = project_game(
    away_abbrev='ATL', home_abbrev='LAD',
    away_team_stats=atl_stats, home_team_stats=lad_stats,
    away_pitcher_stats=atl_pitcher, home_pitcher_stats=lad_pitcher,
    book_lines=book_lines_correct,
    game_date=datetime(2026, 5, 10),
    verbose=False
)
print(f"  home_win_pct: {r1['home_win_pct']}%")
print(f"  away_win_pct: {r1['away_win_pct']}%")
print(f"  home_rl_cover_pct: {r1['home_rl_cover_pct']}%")
print(f"  away_rl_cover_pct: {r1['away_rl_cover_pct']}%")
print(f"  home_rl_odds (modelHomeSpreadOdds): {r1['home_rl_odds']}")
print(f"  away_rl_odds (modelAwaySpreadOdds): {r1['away_rl_odds']}")
print(f"  home_run_line: {r1['home_run_line']}")
print(f"  away_run_line: {r1['away_run_line']}")
print()

print("=" * 70)
print("TEST 2: rl_home_spread = +1.5 (LAD is +1.5 underdog — WRONG)")
print("=" * 70)
book_lines_wrong = {
    'ml_away': 113, 'ml_home': -136, 'ou_line': 9.0,
    'over_odds': -118, 'under_odds': -102,
    'rl_home_spread': 1.5, 'rl_home': 149, 'rl_away': -181
}
r2 = project_game(
    away_abbrev='ATL', home_abbrev='LAD',
    away_team_stats=atl_stats, home_team_stats=lad_stats,
    away_pitcher_stats=atl_pitcher, home_pitcher_stats=lad_pitcher,
    book_lines=book_lines_wrong,
    game_date=datetime(2026, 5, 10),
    verbose=False
)
print(f"  home_win_pct: {r2['home_win_pct']}%")
print(f"  away_win_pct: {r2['away_win_pct']}%")
print(f"  home_rl_cover_pct: {r2['home_rl_cover_pct']}%")
print(f"  away_rl_cover_pct: {r2['away_rl_cover_pct']}%")
print(f"  home_rl_odds (modelHomeSpreadOdds): {r2['home_rl_odds']}")
print(f"  away_rl_odds (modelAwaySpreadOdds): {r2['away_rl_odds']}")
print(f"  home_run_line: {r2['home_run_line']}")
print(f"  away_run_line: {r2['away_run_line']}")
print()
print("CONCLUSION:")
print("  Stored modelHomeSpreadOdds = -221")
print(f"  Test 1 (rl=-1.5) home_rl_odds = {r1['home_rl_odds']}")
print(f"  Test 2 (rl=+1.5) home_rl_odds = {r2['home_rl_odds']}")
if abs(r2['home_rl_odds'] - (-221)) < 20:
    print("  ⚠️ CONFIRMED: rl_home_spread=+1.5 was used (WRONG — should be -1.5)")
elif abs(r1['home_rl_odds'] - (-221)) < 20:
    print("  ✓ rl_home_spread=-1.5 was used but still produces -221 — simulation issue")
else:
    print("  INCONCLUSIVE — neither test matches stored value exactly")
