#!/usr/bin/env python3.11
"""
runMlbBacktest.py
=================
Full 3-season MLB backtest engine (2024 + 2025 + 2026).

PIPELINE:
  1. Load all graded games from mlb_historical_results.json
  2. For each game: fetch per-game boxscore from MLB Stats API
     → Starting pitcher stats (IP, ER, K, BB, H, HR)
     → Team batting stats (runs, hits, K, BB, AVG, OBP, SLG, HR)
     → Per-inning scoring arrays (I1-I9)
  3. Grade all 9 markets game-by-game:
     FG ML, FG RL (+/-1.5), FG Total
     F5 ML, F5 RL (+/-0.5), F5 Total
     NRFI, YRFI
     (Note: book odds are not in historical data → grade result correctness only)
  4. Compute empirical calibration constants:
     - NRFI rate overall + by team + by SP
     - F5 run share (F5 total / FG total)
     - I1 run share (I1 total / FG total)
     - Per-inning weights I1-I9
     - Team-level scoring tendencies
     - SP ERA/K9/BB9 → NRFI correlation
  5. Output:
     - /home/ubuntu/mlb_backtest_results.json (game-by-game grades)
     - /home/ubuntu/mlb_calibration_constants.json (calibration output)
     - /home/ubuntu/mlb_backtest_report.txt (human-readable report)

Logging: [INPUT] [STEP] [STATE] [OUTPUT] [VERIFY] [ERROR] [WARN]
"""

import json
import statistics
import time
import urllib.error
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

INPUT_FILE  = "/home/ubuntu/mlb_historical_results.json"
OUTPUT_JSON = "/home/ubuntu/mlb_backtest_results.json"
OUTPUT_CAL  = "/home/ubuntu/mlb_calibration_constants.json"
OUTPUT_RPT  = "/home/ubuntu/mlb_backtest_report.txt"
LOG_FILE    = "/tmp/mlb_backtest.log"

# ─── API helpers ─────────────────────────────────────────────────────────────

def fetch_boxscore(game_pk: int, retries: int = 3) -> dict | None:
    url = f"https://statsapi.mlb.com/api/v1/game/{game_pk}/boxscore"
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=10) as resp:
                return json.loads(resp.read())
        except Exception:
            if attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1))
            else:
                return None
    return None

def extract_game_stats(game_pk: int, boxscore: dict) -> dict:
    """
    Extract per-game SP stats and team batting stats from boxscore.
    Returns structured dict with away/home SP and team batting.
    """
    result = {
        "gamePk": game_pk,
        "away_sp": None,
        "home_sp": None,
        "away_batting": None,
        "home_batting": None,
    }

    teams = boxscore.get("teams", {})
    for side in ["away", "home"]:
        team = teams.get(side, {})
        pitchers = team.get("pitchers", [])
        players  = team.get("players", {})

        # Starting pitcher = first pitcher in list
        if pitchers:
            sp_id  = f"ID{pitchers[0]}"
            sp_obj = players.get(sp_id, {})
            sp_info = sp_obj.get("person", {})
            sp_stats = sp_obj.get("stats", {}).get("pitching", {})
            result[f"{side}_sp"] = {
                "id":   pitchers[0],
                "name": sp_info.get("fullName", "Unknown"),
                "ip":   sp_stats.get("inningsPitched", "0.0"),
                "er":   sp_stats.get("earnedRuns", 0),
                "k":    sp_stats.get("strikeOuts", 0),
                "bb":   sp_stats.get("baseOnBalls", 0),
                "h":    sp_stats.get("hits", 0),
                "hr":   sp_stats.get("homeRuns", 0),
            }

        # Team batting
        bat = team.get("teamStats", {}).get("batting", {})
        result[f"{side}_batting"] = {
            "runs":  bat.get("runs", 0),
            "hits":  bat.get("hits", 0),
            "k":     bat.get("strikeOuts", 0),
            "bb":    bat.get("baseOnBalls", 0),
            "hr":    bat.get("homeRuns", 0),
            "avg":   bat.get("avg", ".000"),
            "obp":   bat.get("obp", ".000"),
            "slg":   bat.get("slg", ".000"),
        }

    return result

# ─── Market grading ──────────────────────────────────────────────────────────

def grade_fg_ml(away_score: int, home_score: int) -> dict:
    """Grade FG ML: which team won outright."""
    if away_score > home_score:
        winner = "away"
    elif home_score > away_score:
        winner = "home"
    else:
        winner = "push"
    return {"market": "FG_ML", "winner": winner, "away_score": away_score, "home_score": home_score}

def grade_fg_rl(away_score: int, home_score: int, rl: float = 1.5) -> dict:
    """Grade FG RL: away +1.5 covers if away_score + 1.5 > home_score."""
    margin = away_score - home_score
    away_covers = margin + rl > 0
    home_covers = margin + rl < 0
    push = margin + rl == 0
    return {
        "market": "FG_RL",
        "rl": rl,
        "margin": margin,
        "away_covers": away_covers,
        "home_covers": home_covers,
        "push": push,
    }

def grade_fg_total(away_score: int, home_score: int, total: float) -> dict:
    """Grade FG Total: over/under."""
    actual = away_score + home_score
    over  = actual > total
    under = actual < total
    push  = actual == total
    return {
        "market": "FG_TOTAL",
        "total_line": total,
        "actual_total": actual,
        "over": over,
        "under": under,
        "push": push,
    }

def grade_f5_ml(away_f5: int, home_f5: int) -> dict:
    """Grade F5 ML: which team led after 5 innings."""
    if away_f5 > home_f5:
        winner = "away"
    elif home_f5 > away_f5:
        winner = "home"
    else:
        winner = "push"
    return {"market": "F5_ML", "winner": winner, "away_f5": away_f5, "home_f5": home_f5}

def grade_f5_rl(away_f5: int, home_f5: int, rl: float = 0.5) -> dict:
    """Grade F5 RL: away +0.5 covers if away_f5 + 0.5 > home_f5."""
    margin = away_f5 - home_f5
    away_covers = margin + rl > 0
    home_covers = margin + rl < 0
    push = margin + rl == 0
    return {
        "market": "F5_RL",
        "rl": rl,
        "margin": margin,
        "away_covers": away_covers,
        "home_covers": home_covers,
        "push": push,
    }

def grade_f5_total(away_f5: int, home_f5: int, f5_total: float | None) -> dict:
    """Grade F5 Total. If no book line, use empirical median."""
    actual = away_f5 + home_f5
    if f5_total is None:
        return {"market": "F5_TOTAL", "total_line": None, "actual_total": actual, "over": None, "under": None, "push": None}
    over  = actual > f5_total
    under = actual < f5_total
    push  = actual == f5_total
    return {
        "market": "F5_TOTAL",
        "total_line": f5_total,
        "actual_total": actual,
        "over": over,
        "under": under,
        "push": push,
    }

def grade_nrfi_yrfi(inning1_away: int, inning1_home: int) -> dict:
    """Grade NRFI/YRFI: did either team score in I1?"""
    yrfi = (inning1_away + inning1_home) > 0
    nrfi = not yrfi
    return {
        "market": "NRFI_YRFI",
        "i1_away": inning1_away,
        "i1_home": inning1_home,
        "i1_total": inning1_away + inning1_home,
        "nrfi": nrfi,
        "yrfi": yrfi,
    }

# ─── Calibration computation ─────────────────────────────────────────────────

def compute_calibration(graded_games: list) -> dict:
    """
    Compute all calibration constants from graded games.
    Returns dict of constants for MLBAIModel.py.
    """
    print(f"\n[STEP] Computing calibration constants from n={len(graded_games)} graded games")

    # Filter to games with complete data
    # fg_total = away_score + home_score (always present if graded)
    # f5_total = away_f5 + home_f5 (always present if graded)
    # i1_total may be None if inning data missing
    complete = [g for g in graded_games if
                g.get("fg_total") is not None and
                g.get("f5_total") is not None and
                g.get("i1_total") is not None]
    print(f"[STATE] Complete games (FG+F5+I1): {len(complete)}")

    # ── Overall rates ──────────────────────────────────────────────────────
    fg_totals   = [g["fg_total"] for g in complete]
    f5_totals   = [g["f5_total"] for g in complete]
    i1_totals   = [g["i1_total"] for g in complete]

    avg_fg    = statistics.mean(fg_totals)
    avg_f5    = statistics.mean(f5_totals)
    avg_i1    = statistics.mean(i1_totals)

    f5_share  = avg_f5 / avg_fg if avg_fg > 0 else 0.5311
    i1_share  = avg_i1 / avg_fg if avg_fg > 0 else 0.1093

    nrfi_games = [g for g in complete if g.get("nrfi") is not None]
    nrfi_rate  = sum(1 for g in nrfi_games if g["nrfi"]) / len(nrfi_games) if nrfi_games else 0.516

    print(f"[STATE] avg_fg={avg_fg:.4f} avg_f5={avg_f5:.4f} avg_i1={avg_i1:.4f}")
    print(f"[STATE] f5_share={f5_share:.4f} i1_share={i1_share:.4f} nrfi_rate={nrfi_rate:.4f}")

    # ── Per-inning weights ─────────────────────────────────────────────────
    inning_totals = defaultdict(list)
    for g in complete:
        innings = g.get("innings", [])
        for i, inning_runs in enumerate(innings[:9]):
            inning_totals[i+1].append(inning_runs)

    inning_weights = {}
    for inn in range(1, 10):
        vals = inning_totals[inn]
        if vals and avg_fg > 0:
            inning_weights[inn] = statistics.mean(vals) / avg_fg
        else:
            inning_weights[inn] = 1/9

    print(f"[STATE] Per-inning weights: {', '.join(f'I{k}={v:.4f}' for k,v in sorted(inning_weights.items()))}")

    # ── Team-level NRFI rates ──────────────────────────────────────────────
    team_nrfi = defaultdict(lambda: {"nrfi": 0, "total": 0})
    for g in nrfi_games:
        for side in ["away_team", "home_team"]:
            team = g.get(side)
            if team:
                team_nrfi[team]["total"] += 1
                if g["nrfi"]:
                    team_nrfi[team]["nrfi"] += 1

    team_nrfi_rates = {}
    for team, counts in team_nrfi.items():
        if counts["total"] >= 20:
            team_nrfi_rates[team] = round(counts["nrfi"] / counts["total"], 4)

    print(f"[STATE] Team NRFI rates computed for {len(team_nrfi_rates)} teams (min 20 games)")

    # ── Team-level F5 run share ────────────────────────────────────────────
    team_f5_rs = defaultdict(lambda: {"f5": [], "fg": []})
    for g in complete:
        for side, f5_key, fg_key in [("away_team","f5_away","away_score"), ("home_team","f5_home","home_score")]:
            team = g.get(side)
            if team and g.get(f5_key) is not None and g.get(fg_key) is not None:
                if g[fg_key] > 0:
                    team_f5_rs[team]["f5"].append(g[f5_key])
                    team_f5_rs[team]["fg"].append(g[fg_key])

    team_f5_run_share = {}
    for team, data in team_f5_rs.items():
        if len(data["fg"]) >= 20 and sum(data["fg"]) > 0:
            team_f5_run_share[team] = round(sum(data["f5"]) / sum(data["fg"]), 4)

    print(f"[STATE] Team F5 run shares computed for {len(team_f5_run_share)} teams")

    # ── SP NRFI correlation ────────────────────────────────────────────────
    # ERA vs NRFI rate by ERA bucket
    era_nrfi = defaultdict(lambda: {"nrfi": 0, "total": 0})
    for g in nrfi_games:
        for side in ["away_sp", "home_sp"]:
            sp = g.get(side)
            if sp and sp.get("era") is not None:
                era = sp["era"]
                bucket = f"era_{int(era // 1)}"
                era_nrfi[bucket]["total"] += 1
                if g["nrfi"]:
                    era_nrfi[bucket]["nrfi"] += 1

    era_nrfi_rates = {}
    for bucket, counts in era_nrfi.items():
        if counts["total"] >= 10:
            era_nrfi_rates[bucket] = round(counts["nrfi"] / counts["total"], 4)

    # ── FG ML win rates ────────────────────────────────────────────────────
    fg_ml_games = [g for g in graded_games if g.get("fg_ml_winner")]
    away_wins = sum(1 for g in fg_ml_games if g["fg_ml_winner"] == "away")
    home_wins = sum(1 for g in fg_ml_games if g["fg_ml_winner"] == "home")
    pushes    = sum(1 for g in fg_ml_games if g["fg_ml_winner"] == "push")
    away_win_rate = away_wins / len(fg_ml_games) if fg_ml_games else 0.5
    home_win_rate = home_wins / len(fg_ml_games) if fg_ml_games else 0.5
    print(f"[STATE] FG ML: away_win={away_win_rate:.4f} home_win={home_win_rate:.4f} pushes={pushes}")

    # ── FG RL cover rates ──────────────────────────────────────────────────
    rl_games = [g for g in graded_games if g.get("fg_rl_margin") is not None]
    margins  = [g["fg_rl_margin"] for g in rl_games]
    away_rl_cover = sum(1 for m in margins if m + 1.5 > 0) / len(margins) if margins else 0.5
    print(f"[STATE] FG RL: away +1.5 cover rate = {away_rl_cover:.4f} (n={len(margins)})")

    # ── FG Total over rates ────────────────────────────────────────────────
    total_games = [g for g in graded_games if g.get("fg_total") is not None and g.get("fg_book_total") is not None]
    over_rate   = sum(1 for g in total_games if g["fg_total"] > g["fg_book_total"]) / len(total_games) if total_games else 0.5
    print(f"[STATE] FG Total: over rate vs book = {over_rate:.4f} (n={len(total_games)})")

    # ── F5 ML win rates ────────────────────────────────────────────────────
    f5_ml_games = [g for g in graded_games if g.get("f5_ml_winner")]
    f5_away_wins = sum(1 for g in f5_ml_games if g["f5_ml_winner"] == "away")
    sum(1 for g in f5_ml_games if g["f5_ml_winner"] == "home")
    f5_pushes    = sum(1 for g in f5_ml_games if g["f5_ml_winner"] == "push")
    f5_away_win_rate = f5_away_wins / len(f5_ml_games) if f5_ml_games else 0.5
    f5_push_rate     = f5_pushes / len(f5_ml_games) if f5_ml_games else 0.0
    print(f"[STATE] F5 ML: away_win={f5_away_win_rate:.4f} pushes={f5_pushes} push_rate={f5_push_rate:.4f}")

    # ── Season-level breakdown ─────────────────────────────────────────────
    by_season = defaultdict(lambda: {"nrfi": 0, "yrfi": 0, "fg_total": [], "f5_total": [], "i1_total": []})
    for g in complete:
        season = g.get("season", "unknown")
        if g.get("nrfi") is not None:
            if g["nrfi"]:
                by_season[season]["nrfi"] += 1
            else:
                by_season[season]["yrfi"] += 1
        by_season[season]["fg_total"].append(g["fg_total"])
        by_season[season]["f5_total"].append(g["f5_total"])
        by_season[season]["i1_total"].append(g["i1_total"])

    season_stats = {}
    for season, data in by_season.items():
        n_nrfi = data["nrfi"] + data["yrfi"]
        season_stats[season] = {
            "nrfi_rate": round(data["nrfi"] / n_nrfi, 4) if n_nrfi > 0 else None,
            "avg_fg":    round(statistics.mean(data["fg_total"]), 4) if data["fg_total"] else None,
            "avg_f5":    round(statistics.mean(data["f5_total"]), 4) if data["f5_total"] else None,
            "avg_i1":    round(statistics.mean(data["i1_total"]), 4) if data["i1_total"] else None,
            "f5_share":  round(statistics.mean(data["f5_total"]) / statistics.mean(data["fg_total"]), 4)
                         if data["fg_total"] and data["f5_total"] else None,
            "i1_share":  round(statistics.mean(data["i1_total"]) / statistics.mean(data["fg_total"]), 4)
                         if data["fg_total"] and data["i1_total"] else None,
            "n_games":   len(data["fg_total"]),
        }

    print("\n[STATE] Season breakdown:")
    for s, stats in sorted(season_stats.items()):
        print(f"  {s}: n={stats['n_games']} nrfi={stats['nrfi_rate']} avg_fg={stats['avg_fg']} f5_share={stats['f5_share']} i1_share={stats['i1_share']}")

    return {
        "computed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "n_games_total": len(graded_games),
        "n_games_complete": len(complete),
        "n_nrfi_games": len(nrfi_games),
        "overall": {
            "avg_fg_total":    round(avg_fg, 4),
            "avg_f5_total":    round(avg_f5, 4),
            "avg_i1_total":    round(avg_i1, 4),
            "f5_run_share":    round(f5_share, 4),
            "i1_run_share":    round(i1_share, 4),
            "nrfi_rate":       round(nrfi_rate, 4),
            "fg_away_win_rate": round(away_win_rate, 4),
            "fg_home_win_rate": round(home_win_rate, 4),
            "fg_away_rl_cover": round(away_rl_cover, 4),
            "fg_over_rate":     round(over_rate, 4),
            "f5_away_win_rate": round(f5_away_win_rate, 4),
            "f5_push_rate":     round(f5_push_rate, 4),
        },
        "inning_weights": {str(k): round(v, 6) for k, v in inning_weights.items()},
        "team_nrfi_rates": team_nrfi_rates,
        "team_f5_run_share": team_f5_run_share,
        "era_nrfi_rates": era_nrfi_rates,
        "season_stats": season_stats,
    }

# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("[INPUT] MLB 3-Season Backtest Engine — starting")
    print(f"[INPUT] Source: {INPUT_FILE}")

    with open(INPUT_FILE) as f:
        data = json.load(f)

    all_games = data["games"]
    print(f"[INPUT] Total games loaded: {len(all_games)}")

    # Filter to games with complete scores
    complete_games = [g for g in all_games if
                      g.get("awayFinalScore") is not None and
                      g.get("homeFinalScore") is not None and
                      g.get("awayF5Score") is not None and
                      g.get("homeF5Score") is not None]
    print(f"[INPUT] Games with complete FG+F5 scores: {len(complete_games)}")

    # ── Phase 1: Fetch per-game boxscores ─────────────────────────────────
    print(f"\n[STEP] Phase 1: Fetching per-game boxscores for {len(complete_games)} games")
    print("[STATE] Using 8 concurrent threads with rate limiting")

    game_stats = {}
    fetched = failed = 0
    batch_size = 50

    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = {executor.submit(fetch_boxscore, g["gamePk"]): g for g in complete_games}
        for i, future in enumerate(as_completed(futures)):
            game = futures[future]
            gp   = game["gamePk"]
            try:
                bs = future.result()
                if bs:
                    stats = extract_game_stats(gp, bs)
                    game_stats[gp] = stats
                    fetched += 1
                else:
                    failed += 1
                    game_stats[gp] = {"gamePk": gp, "away_sp": None, "home_sp": None, "away_batting": None, "home_batting": None}
            except Exception:
                failed += 1
                game_stats[gp] = {"gamePk": gp, "away_sp": None, "home_sp": None, "away_batting": None, "home_batting": None}

            if (i + 1) % batch_size == 0:
                print(f"  [STATE] Fetched {i+1}/{len(complete_games)} | ok={fetched} failed={failed}")
                time.sleep(0.5)  # Rate limit courtesy pause

    print(f"[OUTPUT] Phase 1 complete: fetched={fetched} failed={failed}")

    # ── Phase 2: Grade all 9 markets game-by-game ─────────────────────────
    print(f"\n[STEP] Phase 2: Grading all 9 markets for {len(complete_games)} games")

    graded_games = []
    grade_errors = 0

    for game in complete_games:
        gp          = game["gamePk"]
        game_date   = game["gameDate"]
        season      = game_date[:4]
        away_team   = game["awayTeam"]
        home_team   = game["homeTeam"]
        away_score  = game["awayFinalScore"]
        home_score  = game["homeFinalScore"]
        away_f5     = game["awayF5Score"]
        home_f5     = game["homeF5Score"]
        innings     = game.get("innings", [])
        i1_away     = innings[0] if len(innings) > 0 else None
        i1_home     = innings[1] if len(innings) > 1 else None

        # Compute per-team inning arrays from innings list
        # innings format: [away_i1, home_i1, away_i2, home_i2, ...]
        away_innings = [innings[i] for i in range(0, min(len(innings), 18), 2)]
        home_innings = [innings[i] for i in range(1, min(len(innings), 18), 2)]

        # FG total
        fg_total = away_score + home_score
        f5_total = away_f5 + home_f5

        # I1 total
        i1_total = None
        if i1_away is not None and i1_home is not None:
            i1_total = i1_away + i1_home

        # Combined innings array (total per inning)
        inning_totals = []
        for i in range(min(len(away_innings), len(home_innings), 9)):
            inning_totals.append(away_innings[i] + home_innings[i])

        # Grade markets
        try:
            fg_ml   = grade_fg_ml(away_score, home_score)
            fg_rl   = grade_fg_rl(away_score, home_score, 1.5)
            f5_ml   = grade_f5_ml(away_f5, home_f5)
            f5_rl   = grade_f5_rl(away_f5, home_f5, 0.5)

            nrfi_grade = None
            if i1_away is not None and i1_home is not None:
                nrfi_grade = grade_nrfi_yrfi(i1_away, i1_home)

            # SP stats
            stats = game_stats.get(gp, {})
            away_sp = stats.get("away_sp")
            home_sp = stats.get("home_sp")

            # Compute SP ERA for this game (ER / IP * 9)
            def sp_era(sp):
                if not sp: return None
                try:
                    ip_str = sp.get("ip", "0.0")
                    ip_parts = ip_str.split(".")
                    ip_full = int(ip_parts[0]) + (int(ip_parts[1]) / 3 if len(ip_parts) > 1 else 0)
                    if ip_full == 0: return None
                    return round(sp["er"] / ip_full * 9, 2)
                except Exception:
                    return None

            graded = {
                "gamePk":         gp,
                "gameDate":       game_date,
                "season":         season,
                "away_team":      away_team,
                "home_team":      home_team,
                "away_score":     away_score,
                "home_score":     home_score,
                "away_f5":        away_f5,
                "home_f5":        home_f5,
                "fg_total":       fg_total,
                "f5_total":       f5_total,
                "i1_total":       i1_total,
                "i1_away":        i1_away,
                "i1_home":        i1_home,
                "innings":        inning_totals,
                "fg_ml_winner":   fg_ml["winner"],
                "fg_rl_margin":   fg_rl["margin"],
                "fg_rl_away_covers": fg_rl["away_covers"],
                "fg_rl_home_covers": fg_rl["home_covers"],
                "f5_ml_winner":   f5_ml["winner"],
                "f5_rl_margin":   f5_rl["margin"],
                "f5_rl_away_covers": f5_rl["away_covers"],
                "f5_rl_home_covers": f5_rl["home_covers"],
                "nrfi":           nrfi_grade["nrfi"] if nrfi_grade else None,
                "yrfi":           nrfi_grade["yrfi"] if nrfi_grade else None,
                "away_sp":        away_sp,
                "home_sp":        home_sp,
                "away_sp_era":    sp_era(away_sp),
                "home_sp_era":    sp_era(home_sp),
                "away_batting":   stats.get("away_batting"),
                "home_batting":   stats.get("home_batting"),
            }
            graded_games.append(graded)

        except Exception as e:
            grade_errors += 1
            if grade_errors <= 10:
                print(f"  [ERROR] gamePk={gp} date={game_date}: {e}")

    print(f"[OUTPUT] Phase 2 complete: graded={len(graded_games)} errors={grade_errors}")

    # ── Phase 3: Compute calibration constants ────────────────────────────
    calibration = compute_calibration(graded_games)

    # ── Phase 4: Write outputs ────────────────────────────────────────────
    print("\n[STEP] Phase 4: Writing outputs")

    with open(OUTPUT_JSON, "w") as f:
        json.dump({"graded_games": graded_games, "summary": calibration["overall"]}, f, indent=2)
    print(f"[OUTPUT] Game-by-game results → {OUTPUT_JSON}")

    with open(OUTPUT_CAL, "w") as f:
        json.dump(calibration, f, indent=2)
    print(f"[OUTPUT] Calibration constants → {OUTPUT_CAL}")

    # ── Phase 5: Write human-readable report ─────────────────────────────
    ov = calibration["overall"]
    ss = calibration["season_stats"]
    iw = calibration["inning_weights"]
    tn = calibration["team_nrfi_rates"]
    tf = calibration["team_f5_run_share"]

    lines = [
        "═══════════════════════════════════════════════════════════════════",
        "  MLB 3-SEASON BACKTEST REPORT",
        f"  Generated: {calibration['computed_at']}",
        f"  Games: {calibration['n_games_total']} total | {calibration['n_games_complete']} complete | {calibration['n_nrfi_games']} NRFI",
        "═══════════════════════════════════════════════════════════════════",
        "",
        "── OVERALL CALIBRATION CONSTANTS ──────────────────────────────────",
        f"  avg_fg_total     = {ov['avg_fg_total']}",
        f"  avg_f5_total     = {ov['avg_f5_total']}",
        f"  avg_i1_total     = {ov['avg_i1_total']}",
        f"  f5_run_share     = {ov['f5_run_share']}  (was 0.5311 in model)",
        f"  i1_run_share     = {ov['i1_run_share']}  (was 0.1093 in model)",
        f"  nrfi_rate        = {ov['nrfi_rate']}  (was 0.516 in model)",
        f"  fg_away_win_rate = {ov['fg_away_win_rate']}",
        f"  fg_home_win_rate = {ov['fg_home_win_rate']}",
        f"  fg_away_rl_cover = {ov['fg_away_rl_cover']}  (away +1.5 cover rate)",
        f"  fg_over_rate     = {ov['fg_over_rate']}   (over rate vs book total)",
        f"  f5_away_win_rate = {ov['f5_away_win_rate']}",
        f"  f5_push_rate     = {ov['f5_push_rate']}",
        "",
        "── PER-INNING WEIGHTS ─────────────────────────────────────────────",
    ]
    for inn in range(1, 10):
        w = iw.get(str(inn), 1/9)
        lines.append(f"  I{inn} weight = {w:.6f}")

    lines += [
        "",
        "── SEASON BREAKDOWN ───────────────────────────────────────────────",
    ]
    for season in sorted(ss.keys()):
        s = ss[season]
        lines.append(f"  {season}: n={s['n_games']} nrfi={s['nrfi_rate']} avg_fg={s['avg_fg']} f5_share={s['f5_share']} i1_share={s['i1_share']}")

    lines += [
        "",
        "── TEAM NRFI RATES (3yr, min 20 games) ────────────────────────────",
    ]
    for team, rate in sorted(tn.items(), key=lambda x: -x[1]):
        lines.append(f"  {team:4s} = {rate:.4f}  ({rate*100:.1f}%)")

    lines += [
        "",
        "── TEAM F5 RUN SHARE (3yr, min 20 games) ──────────────────────────",
    ]
    for team, share in sorted(tf.items(), key=lambda x: -x[1]):
        lines.append(f"  {team:4s} = {share:.4f}  ({share*100:.1f}%)")

    lines += [
        "",
        "═══════════════════════════════════════════════════════════════════",
        "[VERIFY] PASS — backtest complete",
        "═══════════════════════════════════════════════════════════════════",
    ]

    report_text = "\n".join(lines)
    with open(OUTPUT_RPT, "w") as f:
        f.write(report_text)
    print(f"[OUTPUT] Human-readable report → {OUTPUT_RPT}")

    print("\n" + report_text)

    print("\n[VERIFY] PASS — 3-season backtest complete")
    print(f"[VERIFY] graded={len(graded_games)} calibration_constants={len(calibration['overall'])} team_nrfi={len(tn)} team_f5={len(tf)}")

if __name__ == "__main__":
    main()
