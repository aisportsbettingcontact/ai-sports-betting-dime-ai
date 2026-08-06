#!/usr/bin/env python
"""kprops-assessor-04-nextday.py — K-props ASSESSOR, step 4: next-day-starter hypothesis.

Step 3 found 1,641/2,837 live slots (58%) whose stored pitcherName is NOT the game's
actual starter. Phase-0 finding K-1 predicts the mechanism: after 00:00 UTC (=5pm PT)
the AN K-props fetch uses the SERVER-LOCAL (UTC) date and returns TOMORROW's slate,
which `upsertKPropsFromAN` then matches onto TODAY's PT-dated games by team abbreviation
(no game-status freeze, K-9), and `modelKPropsForDate(today)` re-scores the row for the
wrong pitcher within 5 minutes. If so, the stored (wrong) name should be the SAME TEAM's
STARTER ON THE NEXT CALENDAR DAY.

Test over every live slot: classify livePitcherName against
  - actual starter, same slot (SAME_STARTER)
  - the slot team's starter on date+1 (NEXT_DAY_TEAM_STARTER)
  - the slot team's starter on date+2 (DAY2_TEAM_STARTER; postponed/off-day chains)
  - any other starter for the same team within the window (SAME_TEAM_OTHER_DAY)
  - opponent starters (OPP_TEAM)
  - none of the above (UNMATCHED)
Also: SAME/OTHER rate conditional on whether the team plays the next day, and stored
bookLine agreement vs the audit's replay line for the same slot.

Output: granular/kprops/kprops-assessor-nextday.csv + stdout summary.
READ-ONLY (population CSV + replay p1 names only).
"""
from __future__ import annotations

import csv
import os
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools", "replay"))
from replay_db import connect  # noqa: E402

BASE = os.path.join(os.path.dirname(__file__), "..", "kprops")
POP = os.path.join(BASE, "kprops-assessor-population.csv")
OUT = os.path.join(BASE, "kprops-assessor-nextday.csv")


def norm_name(s):
    if not s:
        return ""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    for suf in (" jr", " sr", " ii", " iii", " iv"):
        if s.endswith(suf):
            s = s[: -len(suf)]
    return "".join(c for c in s if c.isalpha())


def dshift(d, n):
    y, m, dd = d.split("-")
    return (date(int(y), int(m), int(dd)) + timedelta(days=n)).isoformat()


def main():
    rows = list(csv.DictReader(open(POP)))
    assert len(rows) == 3110

    conn = connect()
    cur = conn.cursor()
    cur.execute(
        "SELECT gameId, side, playerName FROM mlb_replay_prop_projections "
        "WHERE propType='K' AND modelVersion='wf-19288f01-p1'")
    p1name = {(str(r["gameId"]), r["side"]): r["playerName"] for r in cur.fetchall()}
    conn.close()

    # team -> date -> set(normalized starter names); built from the population itself
    team_day_starter = defaultdict(dict)
    team_days = defaultdict(set)
    for r in rows:
        team = r["awayTeam"] if r["side"] == "away" else r["homeTeam"]
        nm = p1name.get((r["gameId"], r["side"]))
        team_days[team].add(r["gameDate"])
        if nm:
            team_day_starter[team].setdefault(r["gameDate"], set()).add(norm_name(nm))
    # all starters per team over the window
    team_all = {t: set().union(*d.values()) for t, d in team_day_starter.items()}
    # opponent starters same game
    opp_name = {}
    for r in rows:
        okey = (r["gameId"], "home" if r["side"] == "away" else "away")
        opp_name[(r["gameId"], r["side"])] = norm_name(p1name.get(okey) or "")

    out_rows = []
    cls_count = Counter()
    live_slots = 0
    plays_next = Counter()
    for r in rows:
        if not r["liveRowId"]:
            continue
        live_slots += 1
        team = r["awayTeam"] if r["side"] == "away" else r["homeTeam"]
        d = r["gameDate"]
        ln = norm_name(r["livePitcherName"])
        actual = norm_name(p1name.get((r["gameId"], r["side"])) or "")
        nd1 = team_day_starter[team].get(dshift(d, 1), set())
        nd2 = team_day_starter[team].get(dshift(d, 2), set())
        if ln and ln == actual:
            cls = "SAME_STARTER"
        elif ln in nd1:
            cls = "NEXT_DAY_TEAM_STARTER"
        elif ln in nd2:
            cls = "DAY2_TEAM_STARTER"
        elif ln in team_all.get(team, set()):
            cls = "SAME_TEAM_OTHER_DAY"
        elif ln and ln == opp_name.get((r["gameId"], r["side"])):
            cls = "OPP_SAME_GAME"
        else:
            cls = "UNMATCHED"
        cls_count[cls] += 1
        team_plays_next = dshift(d, 1) in team_days[team]
        plays_next[(team_plays_next, cls == "SAME_STARTER")] += 1
        out_rows.append([r["gameId"], r["side"], d, team, r["livePitcherName"],
                         p1name.get((r["gameId"], r["side"])), cls, int(team_plays_next),
                         r["kProj"], r["bookLine"], r["liveSignedError"]])

    with open(OUT, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["gameId", "side", "gameDate", "team", "livePitcherName",
                    "actualStarterName", "nameClass", "teamPlaysNextDay", "kProj",
                    "bookLine", "liveSignedError"])
        w.writerows(out_rows)
    print(f"[write] {OUT} ({live_slots} live slots)")

    print("\n[classes]")
    for cls, n in cls_count.most_common():
        print(f"    {cls:22s} {n:5d}  ({n/live_slots:.1%})")

    print("\n[conditional] SAME_STARTER rate by whether the team plays the next day:")
    for plays in (True, False):
        same = plays_next[(plays, True)]
        tot = same + plays_next[(plays, False)]
        if tot:
            print(f"    team plays next day={plays}: SAME_STARTER {same}/{tot} = {same/tot:.1%}")


if __name__ == "__main__":
    main()
