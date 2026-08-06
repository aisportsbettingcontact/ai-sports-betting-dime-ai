#!/usr/bin/env python3
"""fullgame-assessor-analyze.py — residual-structure hunt over EVERY final 2026 game.

ASSESSOR role, fullgame market group, 5x5 granular season backtest.

Inputs (produced by fullgame-assessor-extract.sh):
  <data-dir>/games-main.json   one row per final game in scope (games x linescores x p1 x p2)
  <data-dir>/sched.json        mlb_schedule_history (startTimeUtc + DK fallbacks)
  <data-dir>/calib-meta.json   p2 walk-forward calibration constants per month
  census/game-universe.csv     anGameId <-> games.id linkage

Series graded:
  live      modelProjTotal (pure) / modelProjTotal??modelTotal (grading-rule) ; modelAwayWinPct/100
  p1        wf-19288f01-p1 raw fixed model (full population)
  p2        wf-19288f01-p2 monthly walk-forward calibrated (full population)

Metrics: signed total error (proj - actual), MAE; ML Brier on P(away win), pick hit rate,
mean p_away vs actual away rate. Sliced by month, park (home team), day/night (venue-local),
favorite side, total-line bucket (<8 / 8-9 / >9), starter-handedness pair, team (both sides).

Flag rule (per task spec): slice n>=40 AND (95% CI of bias excludes 0 OR
|slice Brier - series mean Brier| > 0.01). A centered-bias flag (slice mean vs series mean)
is also emitted as a diagnostic to separate slice structure from the global offset.

Usage: python3 fullgame-assessor-analyze.py <data-dir> <out-dir> <census-game-universe.csv>
"""
import csv
import json
import math
import sys
from collections import defaultdict

DATA = sys.argv[1]
OUT = sys.argv[2]
UNIVERSE = sys.argv[3]

# ---------------------------------------------------------------- helpers
def fnum(x):
    if x is None or x == "":
        return None
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def parse_ml(s):
    """American odds varchar -> int, or None."""
    if s is None:
        return None
    t = str(s).strip().upper().replace(" ", "")
    if t in ("EVEN", "EV", "PK"):
        return 100
    t = t.replace("+", "")
    try:
        return int(float(t))
    except ValueError:
        return None


# Venue-local UTC offsets during DST (season window 2026-03-25..07-24 is entirely DST).
# ET = UTC-4 -> shift 0 relative to the stored ET start time.
TEAM_ET_SHIFT = {
    # Eastern
    "ATL": 0, "BAL": 0, "BOS": 0, "CIN": 0, "CLE": 0, "DET": 0, "MIA": 0,
    "NYM": 0, "NYY": 0, "PHI": 0, "PIT": 0, "TB": 0, "TOR": 0, "WSH": 0,
    # Central
    "CHC": -1, "CWS": -1, "HOU": -1, "KC": -1, "MIL": -1, "MIN": -1, "STL": -1, "TEX": -1,
    # Mountain
    "COL": -2,
    # Arizona (MST, no DST -> UTC-7 = ET-3 in season)
    "ARI": -3,
    # Pacific
    "ATH": -3, "LAA": -3, "LAD": -3, "SD": -3, "SEA": -3, "SF": -3,
}


def parse_et_hour(s):
    """'7:05 PM ET' -> 19.083 (decimal ET hours) or None."""
    if not s:
        return None
    parts = str(s).strip().split()
    if len(parts) < 2 or ":" not in parts[0]:
        return None
    hh, mm = parts[0].split(":")
    try:
        h, m = int(hh), int(mm)
    except ValueError:
        return None
    ampm = parts[1].upper()
    if ampm == "PM" and h != 12:
        h += 12
    if ampm == "AM" and h == 12:
        h = 0
    return h + m / 60.0


def mean(xs):
    return sum(xs) / len(xs) if xs else None


def sd(xs):
    n = len(xs)
    if n < 2:
        return None
    m = mean(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (n - 1))


def ci95(xs):
    n = len(xs)
    if n < 2:
        return (None, None)
    m, s = mean(xs), sd(xs)
    h = 1.96 * s / math.sqrt(n)
    return (m - h, m + h)


def r4(x, nd=4):
    return None if x is None else round(x, nd)


# ---------------------------------------------------------------- load
rows = json.load(open(f"{DATA}/games-main.json"))
sched = json.load(open(f"{DATA}/sched.json"))
calib = json.load(open(f"{DATA}/calib-meta.json"))

# games.id -> anGameId linkage from the census universe
games_to_an = {}
with open(UNIVERSE) as f:
    for r in csv.DictReader(f):
        if r.get("gamesId"):
            games_to_an[int(r["gamesId"])] = int(r["anGameId"])
an_sched = {int(s["anGameId"]): s for s in sched}

import datetime

def utc_ms(iso):
    if not iso:
        return None
    try:
        return int(datetime.datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        return None


# ---------------------------------------------------------------- per-game assembly
games = []          # analysis population (exempt rows excluded)
exempt = []
actual_mismatch = []
phantom_model = 0   # modelTotal present but modelRunAt null (book echo, no engine run)
venue_notes = defaultdict(set)

for g in rows:
    if g["mlbGamePk"] is None:
        exempt.append(g)
        continue
    aw, hm = fnum(g["actualAwayScore"]), fnum(g["actualHomeScore"])
    # internal cross-check vs StatsAPI-derived linescores substrate
    lw, lh = fnum(g["awayFinalRuns"]), fnum(g["homeFinalRuns"])
    if lw is not None and (lw != aw or lh != hm):
        actual_mismatch.append((g["id"], g["gameDate"], aw, hm, lw, lh))
    total_actual = aw + hm
    away_won = 1.0 if aw > hm else 0.0

    month = g["gameDate"][:7]
    park = g["homeTeam"]
    venue_notes[park].add(g["venue"] or "?")

    # day/night at venue-local time
    et_h = parse_et_hour(g["startTimeEst"])
    shift = TEAM_ET_SHIFT.get(park, 0)
    local_h = None if et_h is None else et_h + shift
    day_night = None if local_h is None else ("day" if local_h < 17 else "night")

    # favorite side from book ML (games row; fallback DK closing, then DK pregame)
    an = an_sched.get(games_to_an.get(g["id"], -1))
    aml, hml = parse_ml(g["awayML"]), parse_ml(g["homeML"])
    ml_src = "games"
    if aml is None or hml is None:
        if an:
            aml, hml = parse_ml(an["dkClosingAwayML"]), parse_ml(an["dkClosingHomeML"])
            ml_src = "dkClosing"
            if aml is None or hml is None:
                aml, hml = parse_ml(an["dkAwayML"]), parse_ml(an["dkHomeML"])
                ml_src = "dkPregame"
    if aml is None or hml is None:
        fav = None
        ml_src = "none"
    elif aml < hml:
        fav = "away_fav"
    elif hml < aml:
        fav = "home_fav"
    else:
        fav = "pickem"

    # total-line bucket (line the live model anchored to; DK fallbacks)
    line = fnum(g["bookTotal"])
    line_src = "games"
    if line is None and an:
        line = fnum(an["dkClosingTotal"])
        line_src = "dkClosing"
        if line is None:
            line = fnum(an["dkTotal"])
            line_src = "dkPregame"
    if line is None:
        bucket, line_src = None, "none"
    elif line < 8:
        bucket = "<8"
    elif line <= 9:
        bucket = "8-9"
    else:
        bucket = ">9"

    hand = (
        f"{g['awayStarterHand']}-{g['homeStarterHand']}"
        if g["awayStarterHand"] and g["homeStarterHand"]
        else "UNK"
    )

    # quarantine flag: live modelRunAt at/after first pitch (P-001)
    st_ms = utc_ms(an["startTimeUtc"]) if an else None
    mra = fnum(g["modelRunAt"])
    quarantined = (
        None if (st_ms is None or mra is None) else (1 if mra >= st_ms else 0)
    )

    live_proj_pure = fnum(g["modelProjTotal"])
    live_proj_rule = live_proj_pure if live_proj_pure is not None else fnum(g["modelTotal"])
    if fnum(g["modelTotal"]) is not None and mra is None:
        phantom_model += 1
    live_p_away = fnum(g["modelAwayWinPct"])
    live_p_away = None if live_p_away is None else live_p_away / 100.0

    games.append(
        dict(
            id=g["id"], gamePk=g["mlbGamePk"], date=g["gameDate"], month=month,
            away=g["awayTeam"], home=g["homeTeam"], venue=g["venue"],
            game_no=g["gameNumber"], dh=g["doubleHeader"],
            start_et=g["startTimeEst"], local_hour=r4(local_h, 2), day_night=day_night,
            fav=fav, fav_src=ml_src, away_ml=aml, home_ml=hml,
            book_total=line, line_src=line_src, bucket=bucket, hand=hand,
            away_sp=g["awayStartingPitcher"], home_sp=g["homeStartingPitcher"],
            actual_away=aw, actual_home=hm, actual_total=total_actual, away_won=away_won,
            quarantined=quarantined,
            live_proj_pure=live_proj_pure, live_proj_rule=live_proj_rule,
            live_proj_src=("modelProjTotal" if live_proj_pure is not None
                           else ("modelTotal(book)" if live_proj_rule is not None else "none")),
            live_p_away=live_p_away,
            p1_proj=fnum(g["p1ProjTotal"]), p1_p_away=fnum(g["p1PAwayMl"]),
            p2_proj=fnum(g["p2ProjTotal"]), p2_p_away=fnum(g["p2PAwayMl"]),
        )
    )

# derived errors per game
for g in games:
    at = g["actual_total"]
    for tag, key in [("live_pure", "live_proj_pure"), ("live_rule", "live_proj_rule"),
                     ("p1", "p1_proj"), ("p2", "p2_proj")]:
        v = g[key]
        g[f"se_{tag}"] = None if v is None else v - at
    for tag, key in [("live", "live_p_away"), ("p1", "p1_p_away"), ("p2", "p2_p_away")]:
        p = g[key]
        g[f"brier_{tag}"] = None if p is None else (p - g["away_won"]) ** 2
        if p is None or p == 0.5:
            g[f"hit_{tag}"] = None
        else:
            pick_away = p > 0.5
            g[f"hit_{tag}"] = 1.0 if (pick_away and g["away_won"]) or (not pick_away and not g["away_won"]) else 0.0

N = len(games)
print(f"analysis population: {N} (exempt: {len(exempt)}: "
      + ", ".join(f"{e['awayTeam']}@{e['homeTeam']} {e['gameDate']} (no mlbGamePk)" for e in exempt) + ")")
print(f"actuals mismatches vs linescores substrate: {len(actual_mismatch)}")
print(f"phantom model rows (modelTotal set, modelRunAt null): {phantom_model}")
qn = sum(1 for g in games if g["quarantined"] == 1)
qu = sum(1 for g in games if g["quarantined"] is None)
print(f"quarantined (modelRunAt >= first pitch): {qn}; quarantine-undetermined: {qu}")

# ---------------------------------------------------------------- overall series metrics
TOTAL_SERIES = ["live_pure", "live_rule", "p1", "p2"]
ML_SERIES = ["live", "p1", "p2"]

overall = {}
for s in TOTAL_SERIES:
    xs = [g[f"se_{s}"] for g in games if g[f"se_{s}"] is not None]
    lo, hi = ci95(xs)
    overall[f"total_{s}"] = dict(
        n=len(xs), bias=r4(mean(xs)), sd=r4(sd(xs)), ci_lo=r4(lo), ci_hi=r4(hi),
        mae=r4(mean([abs(x) for x in xs])),
    )
for s in ML_SERIES:
    bs = [g[f"brier_{s}"] for g in games if g[f"brier_{s}"] is not None]
    hs = [g[f"hit_{s}"] for g in games if g[f"hit_{s}"] is not None]
    ps = [g[f"{'live_p_away' if s == 'live' else s + '_p_away'}"] for g in games
          if g[f"brier_{s}"] is not None]
    ws = [g["away_won"] for g in games if g[f"brier_{s}"] is not None]
    lo, hi = ci95(bs)
    overall[f"ml_{s}"] = dict(
        n=len(bs), brier=r4(mean(bs)), ci_lo=r4(lo), ci_hi=r4(hi),
        hit=r4(mean(hs)), n_hit=len(hs), mean_p_away=r4(mean(ps)), actual_away_rate=r4(mean(ws)),
    )
print(json.dumps(overall, indent=1))

SERIES_BRIER_MEAN = {s: overall[f"ml_{s}"]["brier"] for s in ML_SERIES}

# quarantine sensitivity (live series only)
for s in ["live_pure", "live_rule"]:
    xs = [g[f"se_{s}"] for g in games if g[f"se_{s}"] is not None and g["quarantined"] != 1]
    lo, hi = ci95(xs)
    overall[f"total_{s}_noquar"] = dict(n=len(xs), bias=r4(mean(xs)), ci_lo=r4(lo), ci_hi=r4(hi))
bs = [g["brier_live"] for g in games if g["brier_live"] is not None and g["quarantined"] != 1]
lo, hi = ci95(bs)
overall["ml_live_noquar"] = dict(n=len(bs), brier=r4(mean(bs)), ci_lo=r4(lo), ci_hi=r4(hi))

# paired live-vs-p2 deltas on common games
pair = {}
for a, b, key in [("live_rule", "p2", "se"), ("live_pure", "p2", "se")]:
    ds = [g[f"{key}_{b}"] - g[f"{key}_{a}"] for g in games
          if g[f"{key}_{a}"] is not None and g[f"{key}_{b}"] is not None]
    lo, hi = ci95(ds)
    pair[f"d_bias_{b}_minus_{a}"] = dict(n=len(ds), mean=r4(mean(ds)), ci_lo=r4(lo), ci_hi=r4(hi))
ds = [g["brier_p2"] - g["brier_live"] for g in games
      if g["brier_live"] is not None and g["brier_p2"] is not None]
lo, hi = ci95(ds)
pair["d_brier_p2_minus_live"] = dict(n=len(ds), mean=r4(mean(ds), 5), ci_lo=r4(lo, 5), ci_hi=r4(hi, 5))
print("paired:", json.dumps(pair))

# ---------------------------------------------------------------- slices
def dim_value(g, dim):
    if dim == "team":  # handled by caller (two rows per game)
        raise RuntimeError
    return g[dim]


DIMS = ["month", "park", "day_night", "fav", "bucket", "hand"]


def slice_groups():
    """yield (dim, slice_value, [games])"""
    for dim in DIMS:
        key = {"park": "home"}.get(dim, dim)
        groups = defaultdict(list)
        for g in games:
            v = g[key]
            groups[v if v is not None else "UNKNOWN"].append(g)
        for v, gs in sorted(groups.items(), key=lambda kv: str(kv[0])):
            yield dim, v, gs
    # team dimension: each game counts for both participants
    groups = defaultdict(list)
    for g in games:
        groups[g["away"]].append(g)
        groups[g["home"]].append(g)
    for v, gs in sorted(groups.items()):
        yield "team", v, gs


slice_rows = []
for dim, val, gs in slice_groups():
    row = dict(dim=dim, slice=val, n_games=len(gs))
    for s in TOTAL_SERIES:
        xs = [g[f"se_{s}"] for g in gs if g[f"se_{s}"] is not None]
        m = mean(xs)
        lo, hi = ci95(xs)
        cent = None
        if m is not None and overall[f"total_{s}"]["bias"] is not None and len(xs) >= 2:
            gm = overall[f"total_{s}"]["bias"]
            h = 1.96 * sd(xs) / math.sqrt(len(xs))
            cent = 1 if (m - gm - h > 0 or m - gm + h < 0) else 0
        row[f"{s}_n"] = len(xs)
        row[f"{s}_bias"] = r4(m)
        row[f"{s}_ci_lo"] = r4(lo)
        row[f"{s}_ci_hi"] = r4(hi)
        row[f"{s}_mae"] = r4(mean([abs(x) for x in xs]) if xs else None)
        row[f"{s}_mean_proj"] = r4(mean([g[{"live_pure": "live_proj_pure", "live_rule": "live_proj_rule", "p1": "p1_proj", "p2": "p2_proj"}[s]] for g in gs if g[f"se_{s}"] is not None]))
        row[f"{s}_mean_actual"] = r4(mean([g["actual_total"] for g in gs if g[f"se_{s}"] is not None]))
        row[f"{s}_flag_bias"] = (
            1 if (len(xs) >= 40 and lo is not None and (lo > 0 or hi < 0)) else 0
        )
        row[f"{s}_flag_bias_centered"] = cent if len(xs) >= 40 else 0
    for s in ML_SERIES:
        bs = [g[f"brier_{s}"] for g in gs if g[f"brier_{s}"] is not None]
        hs = [g[f"hit_{s}"] for g in gs if g[f"hit_{s}"] is not None]
        pkey = "live_p_away" if s == "live" else f"{s}_p_away"
        ps = [g[pkey] for g in gs if g[f"brier_{s}"] is not None]
        ws = [g["away_won"] for g in gs if g[f"brier_{s}"] is not None]
        b = mean(bs)
        row[f"{s}_ml_n"] = len(bs)
        row[f"{s}_brier"] = r4(b)
        row[f"{s}_hit"] = r4(mean(hs))
        row[f"{s}_mean_p_away"] = r4(mean(ps))
        row[f"{s}_actual_away_rate"] = r4(mean(ws))
        dev = None if b is None else b - SERIES_BRIER_MEAN[s]
        row[f"{s}_brier_dev"] = r4(dev)
        row[f"{s}_flag_brier"] = 1 if (len(bs) >= 40 and dev is not None and abs(dev) > 0.01) else 0
    slice_rows.append(row)

# ---------------------------------------------------------------- outputs
import os

os.makedirs(OUT, exist_ok=True)

def write_csv(path, rows_, cols=None):
    if not rows_:
        open(path, "w").write("")
        return
    cols = cols or list(rows_[0].keys())
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows_:
            w.writerow(r)


per_game_cols = [
    "id", "gamePk", "date", "month", "away", "home", "venue", "game_no", "dh",
    "start_et", "local_hour", "day_night", "fav", "fav_src", "away_ml", "home_ml",
    "book_total", "line_src", "bucket", "hand", "away_sp", "home_sp",
    "actual_away", "actual_home", "actual_total", "away_won", "quarantined",
    "live_proj_pure", "live_proj_rule", "live_proj_src", "live_p_away",
    "p1_proj", "p1_p_away", "p2_proj", "p2_p_away",
    "se_live_pure", "se_live_rule", "se_p1", "se_p2",
    "brier_live", "brier_p1", "brier_p2", "hit_live", "hit_p1", "hit_p2",
]
for g in games:
    for c in ["se_live_pure", "se_live_rule", "se_p1", "se_p2"]:
        g[c] = r4(g[c], 3)
    for c in ["brier_live", "brier_p1", "brier_p2"]:
        g[c] = r4(g[c], 5)
write_csv(f"{OUT}/fullgame-assessor-per-game.csv", games, per_game_cols)

write_csv(f"{OUT}/fullgame-assessor-slices.csv", slice_rows)

flagged = [
    r for r in slice_rows
    if any(r[f"{s}_flag_bias"] for s in TOTAL_SERIES)
    or any(r[f"{s}_flag_brier"] for s in ML_SERIES)
]
write_csv(f"{OUT}/fullgame-assessor-flagged-slices.csv", flagged)

# worst-50 total misses (ranked by |live rule-series error|)
ctx = ["id", "gamePk", "date", "away", "home", "venue", "day_night", "fav", "bucket",
       "hand", "book_total", "away_sp", "home_sp", "actual_away", "actual_home",
       "actual_total", "quarantined", "live_proj_rule", "live_proj_src",
       "se_live_rule", "p1_proj", "se_p1", "p2_proj", "se_p2"]
wt = sorted((g for g in games if g["se_live_rule"] is not None),
            key=lambda g: -abs(g["se_live_rule"]))[:50]
write_csv(f"{OUT}/fullgame-assessor-worst50-total.csv", wt, ctx)

ctxm = ["id", "gamePk", "date", "away", "home", "venue", "day_night", "fav", "away_ml",
        "home_ml", "bucket", "hand", "actual_away", "actual_home", "away_won",
        "quarantined", "live_p_away", "brier_live", "p1_p_away", "brier_p1",
        "p2_p_away", "brier_p2"]
wm = sorted((g for g in games if g["brier_live"] is not None),
            key=lambda g: -g["brier_live"])[:50]
write_csv(f"{OUT}/fullgame-assessor-worst50-ml.csv", wm, ctxm)

# p2 tails (supplementary, full population)
wt2 = sorted((g for g in games if g["se_p2"] is not None), key=lambda g: -abs(g["se_p2"]))[:10]
wm2 = sorted((g for g in games if g["brier_p2"] is not None), key=lambda g: -g["brier_p2"])[:10]

summary = dict(
    population=dict(
        finals=len(rows), exempt=[f"{e['awayTeam']}@{e['homeTeam']} {e['gameDate']}" for e in exempt],
        analyzed=N, actual_mismatches=len(actual_mismatch), phantom_model_rows=phantom_model,
        quarantined=qn, quarantine_undetermined=qu,
    ),
    overall=overall, paired=pair,
    replay_grades_state="EMPTY at run time (pipeline had not written yet)",
    calib=[dict(month=c["month"], n=c["n"], meta=json.loads(c["calibMeta"])) for c in calib
           if c.get("calibMeta")],
    p2_worst10_total=[{k: g[k] for k in ctx if k in g} for g in wt2],
    p2_worst10_ml=[{k: g[k] for k in ctxm if k in g} for g in wm2],
    venue_multi={k: sorted(v) for k, v in venue_notes.items() if len(v) > 1},
)
json.dump(summary, open(f"{OUT}/fullgame-assessor-summary.json", "w"), indent=1, default=str)

print(f"\nwrote outputs to {OUT}")
print(f"flagged slices: {len(flagged)} of {len(slice_rows)}")
