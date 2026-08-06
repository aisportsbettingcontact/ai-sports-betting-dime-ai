#!/usr/bin/env python3
"""fullgame-reinforcer-extract.py — master game-level dataset for the REINFORCER
synthesis analyses (fullgame market group).

Population: ALL 2026 regular-season finals with a replay projection
(mlb_replay_projections wf-19288f01-p1 AND -p2), 2026-03-25..2026-07-24.
Read-only DB access via DATABASE_URL (pymysql). Emits
granular/fullgame/fullgame-reinforcer-master.csv with one row per game.

Derived fields:
  - day/night: startTimeEst parsed to ET clock, shifted to park-local time by a
    static team->offset map (DST-season offsets); day = local start < 17:00.
  - line_ou: games.bookTotal, falling back to mlb_schedule_history.dkTotal via
    the census game-universe anGameId link (protocol line-at-projection order,
    odds_history middle tier only relevant for null bookTotal rows and noted).
  - calibMeta of the p2 row parsed for league_env_mult / T_fg / total_sd used.

Sanity checks executed at the end (printed): p2.projTotal == p1.projTotal *
env_mult, p2.pAwayMl == sigmoid(logit(p1.pAwayMl)/T_fg), row count == 1555.
"""
import csv
import json
import math
import os
import re
import sys

import pymysql

AUDIT = "/private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/e0e70461-6362-478c-8dcf-7469967be44b/scratchpad/audit-worktree/docs/audits/mlb-model-audit-2026"
OUT = os.path.join(AUDIT, "granular", "fullgame", "fullgame-reinforcer-master.csv")

URL_RE = re.compile(r"mysql2?://([^:]+):([^@]+)@([^:/]+):?(\d+)?/([^?]+)")

# Park-local offset from ET during DST season (hours to ADD to ET clock).
TEAM_ET_OFFSET = {
    # Eastern
    "ATL": 0, "BAL": 0, "BOS": 0, "CIN": 0, "CLE": 0, "DET": 0, "MIA": 0,
    "NYM": 0, "NYY": 0, "PHI": 0, "PIT": 0, "TB": 0, "TOR": 0, "WSH": 0,
    # Central
    "CHC": -1, "CWS": -1, "HOU": -1, "KC": -1, "MIL": -1, "MIN": -1,
    "STL": -1, "TEX": -1,
    # Mountain (DST)
    "COL": -2,
    # Arizona: MST year-round == PDT during season
    "ARI": -3,
    # Pacific (ATH = Sacramento / Sutter Health Park)
    "ATH": -3, "LAA": -3, "LAD": -3, "SD": -3, "SEA": -3, "SF": -3,
}

# Best-effort roof classification (2026 venues). retractable/fixed collapsed to
# "roof"; everything else "open". TB plays outdoors at Steinbrenner Field 2026.
ROOF = {t: "roof" for t in ["ARI", "HOU", "MIA", "MIL", "SEA", "TEX", "TOR", "LAD"]}
# LAD is open-air; remove.
ROOF.pop("LAD")


def connect():
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL not set")
    m = URL_RE.match(url)
    if not m:
        sys.exit("DATABASE_URL shape not recognized")
    conn = pymysql.connect(
        host=m.group(3), port=int(m.group(4) or 3306), user=m.group(1),
        password=m.group(2), database=m.group(5), ssl={"ssl": {}},
        charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor)
    try:
        with conn.cursor() as c:
            c.execute("SET SESSION transaction_read_only = 1")
    except pymysql.err.NotSupportedError:
        pass  # TiDB noop — script issues SELECT statements only
    return conn


def parse_et(s):
    """'7:05 PM ET' -> decimal hour 19.083; None if unparseable."""
    if not s:
        return None
    m = re.match(r"\s*(\d{1,2}):(\d{2})\s*(AM|PM)", s.strip(), re.I)
    if not m:
        return None
    h, mm, ap = int(m.group(1)), int(m.group(2)), m.group(3).upper()
    if ap == "PM" and h != 12:
        h += 12
    if ap == "AM" and h == 12:
        h = 0
    return h + mm / 60.0


def num(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def logit(p):
    p = min(max(p, 1e-9), 1 - 1e-9)
    return math.log(p / (1 - p))


def sigmoid(z):
    return 1.0 / (1.0 + math.exp(-max(-30, min(30, z))))


def main():
    conn = connect()
    with conn.cursor() as c:
        c.execute("""
            SELECT g.id gameId, g.gameDate, g.mlbGamePk, g.startTimeEst,
                   g.awayTeam, g.homeTeam, g.venue, g.doubleHeader, g.gameNumber,
                   COALESCE(g.actualAwayScore, g.awayScore) aScore,
                   COALESCE(g.actualHomeScore, g.homeScore) hScore,
                   g.actualFgTotal, g.bookTotal,
                   p1.pAwayMl p1_pAwayMl, p1.projTotal p1_projTotal,
                   p1.pOver p1_pOver, p1.projAwayScore p1_projAway,
                   p1.projHomeScore p1_projHome, p1.pAwayRl p1_pAwayRl,
                   p2.pAwayMl p2_pAwayMl, p2.projTotal p2_projTotal,
                   p2.pOver p2_pOver, p2.calibMeta p2_meta,
                   pf.parkFactor3yr
            FROM games g
            JOIN mlb_replay_projections p1
                 ON p1.gameId = g.id AND p1.modelVersion = 'wf-19288f01-p1'
            JOIN mlb_replay_projections p2
                 ON p2.gameId = g.id AND p2.modelVersion = 'wf-19288f01-p2'
            LEFT JOIN mlb_park_factors pf ON pf.teamAbbrev = g.homeTeam
            WHERE g.sport = 'MLB' AND g.gameStatus = 'final'
            ORDER BY g.gameDate, g.id""")
        rows = c.fetchall()

    # census link for schedule fallback totals
    an_by_gid = {}
    with open(os.path.join(AUDIT, "census", "game-universe.csv")) as f:
        for r in csv.DictReader(f):
            if r.get("gamesId") and r.get("anGameId"):
                an_by_gid[int(r["gamesId"])] = int(r["anGameId"])
    sched_total = {}
    with conn.cursor() as c:
        c.execute("SELECT anGameId, dkTotal FROM mlb_schedule_history")
        for r in c.fetchall():
            sched_total[r["anGameId"]] = num(r["dkTotal"])
    conn.close()

    out_rows = []
    n_fallback_line = 0
    chk_env = []
    chk_t = []
    for r in rows:
        gid = r["gameId"]
        meta = json.loads(r["p2_meta"]) if r["p2_meta"] else {}
        env_mult = meta.get("league_env_mult")
        t_fg = meta.get("T_fg")
        total_sd = meta.get("total_sd")
        et = parse_et(r["startTimeEst"])
        off = TEAM_ET_OFFSET.get(r["homeTeam"])
        local_hour = (et + off) if (et is not None and off is not None) else None
        day_night = ("day" if local_hour < 17 else "night") if local_hour is not None else ""
        a, h = r["aScore"], r["hScore"]
        total_actual = num(r["actualFgTotal"])
        if total_actual is None and a is not None and h is not None:
            total_actual = float(a + h)
        line_ou = num(r["bookTotal"])
        line_src = "games.bookTotal"
        if line_ou is None:
            an = an_by_gid.get(gid)
            line_ou = sched_total.get(an) if an else None
            line_src = "sched.dkTotal" if line_ou is not None else "none"
            n_fallback_line += 1
        p1t, p2t = num(r["p1_projTotal"]), num(r["p2_projTotal"])
        if p1t and p2t and env_mult:
            chk_env.append(abs(p2t - p1t * env_mult))
        p1m, p2m = num(r["p1_pAwayMl"]), num(r["p2_pAwayMl"])
        if p1m is not None and p2m is not None and t_fg:
            chk_t.append(abs(p2m - sigmoid(logit(p1m) / t_fg)))
        out_rows.append({
            "gameId": gid, "gameDate": r["gameDate"],
            "month": r["gameDate"][:7], "mlbGamePk": r["mlbGamePk"],
            "awayTeam": r["awayTeam"], "homeTeam": r["homeTeam"],
            "venue": r["venue"], "parkFactor3yr": r["parkFactor3yr"],
            "roof": ROOF.get(r["homeTeam"], "open"),
            "doubleHeader": r["doubleHeader"], "gameNumber": r["gameNumber"],
            "startET": round(et, 3) if et is not None else "",
            "localHour": round(local_hour, 3) if local_hour is not None else "",
            "dayNight": day_night,
            "aScore": a, "hScore": h, "totalActual": total_actual,
            "homeWin": (1 if h > a else 0) if (a is not None and h is not None) else "",
            "lineOu": line_ou if line_ou is not None else "",
            "lineSrc": line_src,
            "p1_pAwayMl": r["p1_pAwayMl"], "p1_projTotal": r["p1_projTotal"],
            "p1_pOver": r["p1_pOver"], "p1_projAway": r["p1_projAway"],
            "p1_projHome": r["p1_projHome"], "p1_pAwayRl": r["p1_pAwayRl"],
            "p2_pAwayMl": r["p2_pAwayMl"], "p2_projTotal": r["p2_projTotal"],
            "p2_pOver": r["p2_pOver"],
            "envMultUsed": env_mult, "TfgUsed": t_fg, "totalSdUsed": total_sd,
        })

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out_rows[0].keys()))
        w.writeheader()
        w.writerows(out_rows)

    print(f"rows={len(out_rows)} -> {OUT}")
    print(f"line fallback rows (bookTotal null): {n_fallback_line}")
    print(f"missing actual total: {sum(1 for r in out_rows if r['totalActual'] is None)}")
    print(f"missing homeWin: {sum(1 for r in out_rows if r['homeWin'] == '')}")
    print(f"missing dayNight: {sum(1 for r in out_rows if not r['dayNight'])}")
    print(f"sanity max|p2T - p1T*env| = {max(chk_env):.6f} over n={len(chk_env)}")
    print(f"sanity max|p2ML - Tscale(p1ML)| = {max(chk_t):.6f} over n={len(chk_t)}")
    months = {}
    for r in out_rows:
        months[r["month"]] = months.get(r["month"], 0) + 1
    print("by month:", dict(sorted(months.items())))


if __name__ == "__main__":
    main()
