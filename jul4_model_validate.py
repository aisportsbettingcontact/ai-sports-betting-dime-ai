#!/usr/bin/env python3
"""
Validate model outputs for Jul 4 matches against Dixon-Coles math.
Given lambdas, recompute all probabilities and compare to stored model values.
"""
import math
from decimal import Decimal, ROUND_HALF_UP

def poisson_pmf(k, lam):
    """Poisson probability mass function"""
    return math.exp(-lam) * (lam ** k) / math.factorial(k)

def compute_match_probs(home_lambda, away_lambda, max_goals=10):
    """Compute full match probability matrix from lambdas"""
    matrix = {}
    for h in range(max_goals + 1):
        for a in range(max_goals + 1):
            matrix[(h, a)] = poisson_pmf(h, home_lambda) * poisson_pmf(a, away_lambda)
    return matrix

def prob_to_american(prob):
    """Convert probability to American odds"""
    if prob <= 0 or prob >= 1:
        return None
    if prob >= 0.5:
        return int(Decimal(str(-100 * prob / (1 - prob))).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    else:
        return int(Decimal(str(100 * (1 - prob) / prob)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))

def validate_match(match_id, home_team, away_team, home_lambda, away_lambda, stored_model):
    """Validate all model outputs against recomputed values"""
    print(f"\n{'='*70}")
    print(f"  {match_id}: {home_team} vs {away_team}")
    print(f"  λ_home = {home_lambda:.6f}, λ_away = {away_lambda:.6f}")
    print(f"{'='*70}")
    
    matrix = compute_match_probs(home_lambda, away_lambda)
    
    # 1X2 probabilities
    home_win_prob = sum(v for (h, a), v in matrix.items() if h > a)
    draw_prob = sum(v for (h, a), v in matrix.items() if h == a)
    away_win_prob = sum(v for (h, a), v in matrix.items() if h < a)
    
    print(f"\n  1X2 PROBABILITIES:")
    print(f"    Home win: {home_win_prob:.6f} ({home_win_prob*100:.2f}%)")
    print(f"    Draw:     {draw_prob:.6f} ({draw_prob*100:.2f}%)")
    print(f"    Away win: {away_win_prob:.6f} ({away_win_prob*100:.2f}%)")
    print(f"    Sum:      {home_win_prob + draw_prob + away_win_prob:.6f}")
    
    # 1X2 American odds
    home_ml = prob_to_american(home_win_prob)
    draw_odds = prob_to_american(draw_prob)
    away_ml = prob_to_american(away_win_prob)
    
    print(f"\n  1X2 AMERICAN ODDS (computed vs stored):")
    print(f"    Home ML:  {home_ml:+d}  vs  {stored_model['model_home_ml']:+d}  {'✓' if home_ml == stored_model['model_home_ml'] else '✗ MISMATCH'}")
    print(f"    Draw:     {draw_odds:+d}  vs  {stored_model['model_draw']:+d}  {'✓' if draw_odds == stored_model['model_draw'] else '✗ MISMATCH'}")
    print(f"    Away ML:  {away_ml:+d}  vs  {stored_model['model_away_ml']:+d}  {'✓' if away_ml == stored_model['model_away_ml'] else '✗ MISMATCH'}")
    
    # O/U 2.5
    over_prob = sum(v for (h, a), v in matrix.items() if h + a > 2.5)
    under_prob = sum(v for (h, a), v in matrix.items() if h + a < 2.5)
    over_odds = prob_to_american(over_prob)
    under_odds = prob_to_american(under_prob)
    
    print(f"\n  O/U 2.5:")
    print(f"    Over prob:  {over_prob:.6f} ({over_prob*100:.2f}%)")
    print(f"    Under prob: {under_prob:.6f} ({under_prob*100:.2f}%)")
    print(f"    Over odds:  {over_odds:+d}  vs  {stored_model['model_over_odds']:+d}  {'✓' if over_odds == stored_model['model_over_odds'] else '✗ MISMATCH'}")
    print(f"    Under odds: {under_odds:+d}  vs  {stored_model['model_under_odds']:+d}  {'✓' if under_odds == stored_model['model_under_odds'] else '✗ MISMATCH'}")
    
    # BTTS
    btts_yes_prob = 1 - (poisson_pmf(0, home_lambda) + poisson_pmf(0, away_lambda) - poisson_pmf(0, home_lambda) * poisson_pmf(0, away_lambda))
    # Simpler: P(BTTS) = P(H>=1) * P(A>=1) = (1-P(H=0)) * (1-P(A=0))
    btts_yes_prob2 = (1 - poisson_pmf(0, home_lambda)) * (1 - poisson_pmf(0, away_lambda))
    btts_no_prob = 1 - btts_yes_prob2
    btts_yes_odds = prob_to_american(btts_yes_prob2)
    btts_no_odds = prob_to_american(btts_no_prob)
    
    print(f"\n  BTTS:")
    print(f"    Yes prob: {btts_yes_prob2:.6f} ({btts_yes_prob2*100:.2f}%)")
    print(f"    No prob:  {btts_no_prob:.6f} ({btts_no_prob*100:.2f}%)")
    print(f"    Yes odds: {btts_yes_odds:+d}  vs  {stored_model['model_btts_yes']:+d}  {'✓' if btts_yes_odds == stored_model['model_btts_yes'] else '✗ MISMATCH'}")
    print(f"    No odds:  {btts_no_odds:+d}  vs  {stored_model['model_btts_no']:+d}  {'✓' if btts_no_odds == stored_model['model_btts_no'] else '✗ MISMATCH'}")
    
    # Double Chance
    home_wd_prob = home_win_prob + draw_prob  # 1X
    away_wd_prob = away_win_prob + draw_prob  # X2
    no_draw_prob = home_win_prob + away_win_prob  # 12
    home_wd_odds = prob_to_american(home_wd_prob)
    away_wd_odds = prob_to_american(away_wd_prob)
    no_draw_odds = prob_to_american(no_draw_prob)
    
    print(f"\n  DOUBLE CHANCE:")
    print(f"    Home WD (1X): {home_wd_prob:.6f} → {home_wd_odds:+d}  vs  {stored_model['model_home_wd']:+d}  {'✓' if home_wd_odds == stored_model['model_home_wd'] else '✗ MISMATCH'}")
    print(f"    No Draw (12): {no_draw_prob:.6f} → {no_draw_odds:+d}  vs  {stored_model['model_no_draw']:+d}  {'✓' if no_draw_odds == stored_model['model_no_draw'] else '✗ MISMATCH'}")
    print(f"    Away WD (X2): {away_wd_prob:.6f} → {away_wd_odds:+d}  vs  {stored_model['model_away_wd']:+d}  {'✓' if away_wd_odds == stored_model['model_away_wd'] else '✗ MISMATCH'}")
    
    # Spread -1.5 (away favored means away -1.5 = home needs to lose by 2+)
    # If spread is -1.5 (away favored), then:
    #   Home covers +1.5 = home wins OR draws OR loses by exactly 1
    #   Away covers -1.5 = away wins by 2+
    spread = stored_model['model_primary_spread']
    abs_spread = abs(float(spread))
    
    # For negative spread (away favored): 
    # Home +spread: home wins by any, draws, or loses by less than spread
    # Away -spread: away wins by more than spread
    if float(spread) < 0:
        # Away is favored by abs_spread goals
        home_covers = sum(v for (h, a), v in matrix.items() if (h - a) > -abs_spread)
        away_covers = sum(v for (h, a), v in matrix.items() if (a - h) > abs_spread)
    else:
        home_covers = sum(v for (h, a), v in matrix.items() if (h - a) > abs_spread)
        away_covers = sum(v for (h, a), v in matrix.items() if (a - h) > -abs_spread)
    
    # For half-goal spreads, home_covers + away_covers should = 1
    home_spread_odds = prob_to_american(home_covers)
    away_spread_odds = prob_to_american(away_covers)
    
    print(f"\n  SPREAD ({spread}):")
    print(f"    Home covers: {home_covers:.6f} ({home_covers*100:.2f}%)")
    print(f"    Away covers: {away_covers:.6f} ({away_covers*100:.2f}%)")
    print(f"    Home odds:   {home_spread_odds:+d}  vs  {stored_model['model_home_primary_spread_odds']:+d}  {'✓' if home_spread_odds == stored_model['model_home_primary_spread_odds'] else '✗ MISMATCH'}")
    print(f"    Away odds:   {away_spread_odds:+d}  vs  {stored_model['model_away_primary_spread_odds']:+d}  {'✓' if away_spread_odds == stored_model['model_away_primary_spread_odds'] else '✗ MISMATCH'}")
    
    # Advance (home_win + draw goes to penalties)
    # In knockout: advance = win + 0.5*draw (simplified)
    # Or more precisely: advance = win_prob + draw_prob * 0.5
    home_advance_prob = home_win_prob + draw_prob * 0.5
    away_advance_prob = away_win_prob + draw_prob * 0.5
    home_advance_odds = prob_to_american(home_advance_prob)
    away_advance_odds = prob_to_american(away_advance_prob)
    
    print(f"\n  TO ADVANCE (win + 50% of draws):")
    print(f"    Home advance: {home_advance_prob:.6f} ({home_advance_prob*100:.2f}%)")
    print(f"    Away advance: {away_advance_prob:.6f} ({away_advance_prob*100:.2f}%)")
    print(f"    Home odds:    {home_advance_odds:+d}  vs  {stored_model['model_home_to_advance']:+d}  {'✓' if home_advance_odds == stored_model['model_home_to_advance'] else '✗ MISMATCH'}")
    print(f"    Away odds:    {away_advance_odds:+d}  vs  {stored_model['model_away_to_advance']:+d}  {'✓' if away_advance_odds == stored_model['model_away_to_advance'] else '✗ MISMATCH'}")
    
    # Also compute what spread odds would be at -0.5 for CAN vs MAR comparison
    if match_id == "wc26-r16-090":
        print(f"\n  SPREAD (-0.5) — FOR COMPARISON WITH BOOK:")
        home_covers_05 = sum(v for (h, a), v in matrix.items() if (h - a) > -0.5)
        away_covers_05 = sum(v for (h, a), v in matrix.items() if (a - h) > 0.5)
        print(f"    Home covers +0.5: {home_covers_05:.6f} ({home_covers_05*100:.2f}%) → {prob_to_american(home_covers_05):+d}")
        print(f"    Away covers -0.5: {away_covers_05:.6f} ({away_covers_05*100:.2f}%) → {prob_to_american(away_covers_05):+d}")

# ─── MATCH DATA ───────────────────────────────────────────────────────────────

# wc26-r16-089: PAR vs FRA
validate_match(
    "wc26-r16-089", "PAR", "FRA",
    home_lambda=0.32130621382925595,
    away_lambda=2.3958533773978408,
    stored_model={
        "model_home_ml": 2520,
        "model_draw": 720,
        "model_away_ml": -524,
        "model_over_odds": -104,
        "model_under_odds": 104,
        "model_primary_spread": -1.5,
        "model_home_primary_spread_odds": 156,
        "model_away_primary_spread_odds": -156,
        "model_home_wd": 514,
        "model_no_draw": -684,
        "model_away_wd": -2724,
        "model_btts_yes": 305,
        "model_btts_no": -305,
        "model_home_to_advance": 1306,
        "model_away_to_advance": -1306,
    }
)

# wc26-r16-090: CAN vs MAR
validate_match(
    "wc26-r16-090", "CAN", "MAR",
    home_lambda=2.013158169907316,
    away_lambda=1.6505021880837354,
    stored_model={
        "model_home_ml": 113,
        "model_draw": 389,
        "model_away_ml": 207,
        "model_over_odds": -243,
        "model_under_odds": 243,
        "model_primary_spread": -2.5,
        "model_home_primary_spread_odds": -1502,
        "model_away_primary_spread_odds": 1502,
        "model_home_wd": -212,
        "model_no_draw": -367,
        "model_away_wd": -115,
        "model_btts_yes": -228,
        "model_btts_no": 228,
        "model_home_to_advance": -138,
        "model_away_to_advance": 138,
    }
)
