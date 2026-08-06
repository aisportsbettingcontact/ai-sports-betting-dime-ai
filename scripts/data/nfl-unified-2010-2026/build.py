#!/usr/bin/env python3
"""Conform and union the NFL historical lines extract with the 2026 dataset.

This is a UNION, not a join: the inputs are disjoint in time (2010-2025 vs 2026)
and share zero ESPN event ids, so no row ever matches another row. Every
integrity risk is in schema conformance - making a 2015 row and a 2026 row mean
the same thing in the same column.

Four hazards this script exists to neutralise (see the forensic audit,
docs/audits/2026-07-26-nflverse-stack-forensic-audit.md):

  1. Week numbering is ambiguous. Regular season was 17 weeks through 2020 and
     18 from 2021; the historical extract continues the count into the playoffs
     (Wild Card = week 18 pre-2021, week 19 after), while the 2026 dataset
     restarts playoff weeks at 1. So `week` 18 means REGULAR SEASON in 2021+ but
     WILD CARD in 2010-2020. Fix: `week` holds regular-season week ONLY and is
     null for playoff games; `playoffRound` carries the round.

  2. Franchise relocation breaks team identity on 18% of historical rows. Five
     abbreviations (LA, OAK, SD, STL, WAS) do not exist in the current team
     list. ESPN franchise ids are stable across relocation, so they are the
     durable identity and the abbreviation is an era-specific label.

  3. espnEventId is NOT unique - nflverse attaches 301114022 to two different
     2010 games. It is an indexed attribute, never the primary key.

  4. Null means three different things. Encoded explicitly via `resultStatus`
     rather than left to inference.

Run:  python3 scripts/data/nfl-unified-2010-2026/build.py
Exits non-zero if any validation gate fails. It never writes a partial dataset.
"""

import json
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))))
HIST = os.path.join(ROOT, "scripts/data/nfl-lines-2010-2025/games.json")
NEW = os.path.join(ROOT, "scripts/data/nfl-2026/games.json")
TEAMS = os.path.join(ROOT, "scripts/data/nfl-2026/teams.json")
OUT_DIR = os.path.join(ROOT, "scripts/data/nfl-unified-2010-2026")

# --- franchise identity -----------------------------------------------------
# ESPN franchise ids survive relocation; only the abbreviation changes. Verified
# against scripts/data/nfl-2026/teams.json: Raiders 13 (OAK -> LV), Rams 14
# (STL -> LA -> LAR), Chargers 24 (SD -> LAC), Washington 28 (WAS -> WSH).
RELOCATION_ALIASES = {
    "OAK": 13,   # Oakland Raiders      -> Las Vegas (2020)
    "STL": 14,   # St. Louis Rams       -> Los Angeles (2016)
    "LA": 14,    # nflverse's LA        == LAR
    "SD": 24,    # San Diego Chargers   -> Los Angeles (2017)
    "WAS": 28,   # nflverse's WAS       == WSH
}

# 2026 playoff weeks restart at 1; week 4 is the bye between conference
# championships and the Super Bowl, so there is no week-4 game.
POST_WEEK_TO_ROUND_2026 = {1: "WC", 2: "DIV", 3: "CON", 5: "SB"}

# Expected regular-season game counts. 2022 is 271, not 272: the Bills-Bengals
# game of 2023-01-02 was abandoned after Damar Hamlin's cardiac arrest, never
# resumed, and nflverse omits the row entirely rather than carrying it unplayed.
REG_GAMES_EXPECTED = {}
for _s in range(2010, 2027):
    REG_GAMES_EXPECTED[_s] = 256 if _s <= 2020 else 272
REG_GAMES_EXPECTED[2022] = 271

# The same cancellation leaves Buffalo (17) and Cincinnati (4) one game short in
# 2022. Encoded as a named exception rather than by loosening the gate, so any
# OTHER team-count anomaly in any season still fails the build.
TEAM_GAME_EXCEPTIONS = {
    (2022, 2): 16,  # BUF (ESPN id 2)  - Bills-Bengals 2023-01-02, abandoned, never resumed
    (2022, 4): 16,  # CIN (ESPN id 4)  - same game
}

# Wild Card expanded from 4 games to 6 for the 2020 season.
def expected_rounds(season):
    return {"WC": 4 if season <= 2019 else 6, "DIV": 4, "CON": 2, "SB": 1}

FAILURES = []
def gate(name, ok, detail=""):
    FAILURES.append((name, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail and not ok else ""))
    return ok


def load(path):
    with open(path) as fh:
        return json.load(fh)


def main():
    hist, new, teams = load(HIST), load(NEW), load(TEAMS)

    abbr_to_id = {t["abbreviation"]: t["espnId"] for t in teams}
    id_to_abbr = {t["espnId"]: t["abbreviation"] for t in teams}
    id_to_name = {t["espnId"]: t["displayName"] for t in teams}
    name_to_id = {t["displayName"]: t["espnId"] for t in teams}
    crosswalk = dict(abbr_to_id)
    crosswalk.update(RELOCATION_ALIASES)
    valid_ids = set(id_to_abbr)

    rows = []
    unmapped = Counter()

    # ---- historical (2010-2025) -------------------------------------------
    for r in hist:
        away_id = crosswalk.get(r["awayTeam"])
        home_id = crosswalk.get(r["homeTeam"])
        for abbr, fid in ((r["awayTeam"], away_id), (r["homeTeam"], home_id)):
            if fid is None:
                unmapped[abbr] += 1
        is_reg = r["seasonType"] == "REG"
        rows.append({
            "gameId": r["gameId"],
            "espnEventId": r["espnId"],
            "dataSource": "nflverse",
            "season": r["season"],
            "seasonType": "REG" if is_reg else "POST",
            "week": r["week"] if is_reg else None,
            "playoffRound": None if is_reg else r["seasonType"],
            "kickoffUtc": r["kickoffUtc"],
            "gameday": r["gameday"],
            "gametimeEt": r["gametimeEt"],
            "timeValid": True,
            "resultStatus": "final",
            "awayFranchiseId": away_id,
            "homeFranchiseId": home_id,
            "awayAbbr": r["awayTeam"],
            "homeAbbr": r["homeTeam"],
            "awayName": id_to_name.get(away_id),
            "homeName": id_to_name.get(home_id),
            "awayScore": r["awayScore"],
            "homeScore": r["homeScore"],
            "result": r["result"],
            "total": r["total"],
            "overtime": r["overtime"],
            "divGame": r["divGame"],
            "spreadLine": r["spreadLine"],
            "totalLine": r["totalLine"],
            "awayMoneyline": r["awayMoneyline"],
            "homeMoneyline": r["homeMoneyline"],
            "awaySpreadOdds": r["awaySpreadOdds"],
            "homeSpreadOdds": r["homeSpreadOdds"],
            "overOdds": r["overOdds"],
            "underOdds": r["underOdds"],
            "oddsSource": r["oddsSource"],
            "roof": r["roof"],
            "surface": r["surface"],
            "stadiumId": r["stadiumId"],
            "stadium": r["stadium"],
            "venueId": None,
            "broadcast": None,
            "note": None,
            "location": r["location"],
            "weekday": r["weekday"],
            "awayRest": r["awayRest"],
            "homeRest": r["homeRest"],
            "temp": r["temp"],
            "wind": r["wind"],
            "awayQbId": r["awayQbId"],
            "homeQbId": r["homeQbId"],
            "awayQbName": r["awayQbName"],
            "homeQbName": r["homeQbName"],
            "awayCoach": r["awayCoach"],
            "homeCoach": r["homeCoach"],
            "referee": r["referee"],
            "gsisId": r["gsisId"],
            "pfrId": r["pfrId"],
            "ftnId": r["ftnId"],
            "oldGameId": r["oldGameId"],
        })

    # ---- 2026 --------------------------------------------------------------
    for r in new:
        is_reg = r["seasonType"] == 2
        away_id, home_id = r["awayEspnId"], r["homeEspnId"]
        tbd = r["isTbd"] or away_id is None or home_id is None
        rnd = None if is_reg else POST_WEEK_TO_ROUND_2026.get(r["week"])
        if not is_reg and rnd is None:
            raise SystemExit(f"unmapped 2026 playoff week {r['week']} (eventId {r['eventId']})")

        away_ab = id_to_abbr.get(away_id)
        home_ab = id_to_abbr.get(home_id)
        # Prefer the id; fall back to resolving the display name if ESPN omitted it.
        if away_id is None and r["awayTeam"] in name_to_id:
            away_id = name_to_id[r["awayTeam"]]; away_ab = id_to_abbr[away_id]
        if home_id is None and r["homeTeam"] in name_to_id:
            home_id = name_to_id[r["homeTeam"]]; home_ab = id_to_abbr[home_id]

        if is_reg:
            gid = f"2026_{r['week']:02d}_{away_ab}_{home_ab}"
        else:
            # Playoff matchups are unresolved, so a team-based id is impossible;
            # the ESPN event id is the only stable handle.
            gid = f"2026_POST_{rnd}_{r['eventId']}"

        rows.append({
            "gameId": gid,
            "espnEventId": str(r["eventId"]),
            "dataSource": "espn",
            "season": 2026,
            "seasonType": "REG" if is_reg else "POST",
            "week": r["week"] if is_reg else None,
            "playoffRound": rnd,
            "kickoffUtc": r["kickoffUtc"],
            "gameday": (r["kickoffUtc"] or "")[:10] or None,
            "gametimeEt": None,
            "timeValid": r["timeValid"],
            "resultStatus": "tbd" if tbd else "scheduled",
            "awayFranchiseId": away_id,
            "homeFranchiseId": home_id,
            "awayAbbr": away_ab,
            "homeAbbr": home_ab,
            "awayName": None if tbd else r["awayTeam"],
            "homeName": None if tbd else r["homeTeam"],
            "awayScore": None, "homeScore": None, "result": None, "total": None,
            "overtime": None, "divGame": None,
            "spreadLine": None, "totalLine": None,
            "awayMoneyline": None, "homeMoneyline": None,
            "awaySpreadOdds": None, "homeSpreadOdds": None,
            "overOdds": None, "underOdds": None,
            "oddsSource": None,
            "roof": None, "surface": None, "stadiumId": None, "stadium": None,
            "venueId": r["venueId"],
            "broadcast": r["broadcast"],
            "note": r["note"],
            # Situational features are nflverse-only; ESPN's 2026 schedule ships
            # none of them. Left null rather than derived, so "unknown" stays
            # visibly unknown instead of becoming a plausible-looking guess.
            "location": "Home" if r["venueId"] is not None else None,
            "weekday": None, "awayRest": None, "homeRest": None,
            "temp": None, "wind": None,
            "awayQbId": None, "homeQbId": None,
            "awayQbName": None, "homeQbName": None,
            "awayCoach": None, "homeCoach": None, "referee": None,
            "gsisId": None, "pfrId": None, "ftnId": None, "oldGameId": None,
        })

    rows.sort(key=lambda x: (x["season"], x["seasonType"] == "POST",
                             x["week"] or 0,
                             ["WC", "DIV", "CON", "SB"].index(x["playoffRound"])
                             if x["playoffRound"] else -1,
                             x["kickoffUtc"] or "", x["gameId"]))

    # ================= VALIDATION =========================================
    print("\nVALIDATION GATES")
    n_hist, n_new = len(hist), len(new)

    gate("G01 row count is the exact sum of both inputs",
         len(rows) == n_hist + n_new, f"{len(rows)} != {n_hist}+{n_new}")

    ids = Counter(r["gameId"] for r in rows)
    dup_gid = [k for k, v in ids.items() if v > 1]
    gate("G02 gameId unique (primary key)", not dup_gid, f"duplicates: {dup_gid[:5]}")

    gate("G03 no unmapped team abbreviation (relocation crosswalk complete)",
         not unmapped, f"unmapped: {dict(unmapped)}")

    bad_fid = [r["gameId"] for r in rows
               if r["resultStatus"] != "tbd"
               and not (r["awayFranchiseId"] in valid_ids and r["homeFranchiseId"] in valid_ids)]
    gate("G04 every non-TBD game resolves to two known franchise ids",
         not bad_fid, f"{len(bad_fid)} bad, e.g. {bad_fid[:3]}")

    same = [r["gameId"] for r in rows
            if r["awayFranchiseId"] is not None
            and r["awayFranchiseId"] == r["homeFranchiseId"]]
    gate("G05 no game has a team playing itself", not same, f"{same[:3]}")

    seen_ids = {r["awayFranchiseId"] for r in rows} | {r["homeFranchiseId"] for r in rows}
    seen_ids.discard(None)
    gate("G06 franchise id universe is exactly the 32 known teams",
         seen_ids == valid_ids, f"unexpected: {sorted(seen_ids - valid_ids)}")

    # week/playoffRound are mutually exclusive - this is what kills the week-18 collision
    bad_week = [r["gameId"] for r in rows
                if (r["seasonType"] == "REG") != (r["week"] is not None)]
    gate("G07 week is populated iff REG (playoff week ambiguity removed)",
         not bad_week, f"{len(bad_week)} violations")
    bad_rnd = [r["gameId"] for r in rows
               if (r["seasonType"] == "POST") != (r["playoffRound"] is not None)]
    gate("G08 playoffRound is populated iff POST", not bad_rnd, f"{len(bad_rnd)} violations")

    rs_by_season = Counter(r["season"] for r in rows if r["seasonType"] == "REG")
    bad_counts = {s: (c, REG_GAMES_EXPECTED[s]) for s, c in rs_by_season.items()
                  if c != REG_GAMES_EXPECTED[s]}
    gate("G09 regular-season game count is era-correct every season",
         not bad_counts, f"{bad_counts}")

    bad_rounds = {}
    for s in sorted({r["season"] for r in rows if r["seasonType"] == "POST"}):
        got = Counter(r["playoffRound"] for r in rows
                      if r["season"] == s and r["seasonType"] == "POST")
        want = expected_rounds(s)
        if dict(got) != want:
            bad_rounds[s] = (dict(got), want)
    gate("G10 playoff bracket size is correct every season", not bad_rounds, f"{bad_rounds}")

    bad_score = [r["gameId"] for r in rows if r["resultStatus"] == "final"
                 and (r["result"] != r["homeScore"] - r["awayScore"]
                      or r["total"] != r["homeScore"] + r["awayScore"])]
    gate("G11 result and total are arithmetically consistent with the scores",
         not bad_score, f"{len(bad_score)} bad, e.g. {bad_score[:3]}")

    bad_status = [r["gameId"] for r in rows
                  if (r["resultStatus"] == "final") != (r["awayScore"] is not None)]
    gate("G12 scores present iff resultStatus is final", not bad_status, f"{len(bad_status)}")

    req = ["gameId", "espnEventId", "dataSource", "season", "seasonType",
           "kickoffUtc", "resultStatus", "timeValid"]
    bad_req = [(r["gameId"], f) for r in rows for f in req if r[f] is None]
    gate("G13 no null in any required identity field", not bad_req, f"{bad_req[:3]}")

    bad_kick = []
    for r in rows:
        try:
            datetime.strptime(r["kickoffUtc"], "%Y-%m-%dT%H:%M:%SZ")
        except (ValueError, TypeError):
            bad_kick.append(r["gameId"])
    gate("G14 every kickoffUtc parses as a UTC instant", not bad_kick, f"{bad_kick[:3]}")

    chrono = [r["season"] for r in rows]
    gate("G15 seasons are contiguous 2010-2026 with no gap",
         sorted(set(chrono)) == list(range(2010, 2027)), f"{sorted(set(chrono))}")

    # Every team should appear a plausible number of times per completed season.
    odd_team = {}
    for s in range(2010, 2026):
        c = Counter()
        for r in rows:
            if r["season"] == s and r["seasonType"] == "REG":
                c[r["awayFranchiseId"]] += 1
                c[r["homeFranchiseId"]] += 1
        base = 16 if s <= 2020 else 17
        off = {id_to_abbr[k]: v for k, v in c.items()
               if v != TEAM_GAME_EXCEPTIONS.get((s, k), base)}
        if off:
            odd_team[s] = off
    gate("G16 every team plays the era-correct number of regular-season games",
         not odd_team, f"{odd_team}")

    # espnEventId is deliberately NOT unique - assert only the one known collision.
    ev = Counter(r["espnEventId"] for r in rows)
    dup_ev = sorted(k for k, v in ev.items() if v > 1)
    # This extract stays byte-faithful to nflverse, so the upstream defect is asserted here
    # rather than patched here. The correct value is known -- ESPN's own summary endpoint says
    # 301114022 is SEA@ARI and 2010_10_HOU_JAX is 301114030 -- and the fix is applied downstream
    # in scripts/data/nfl-db/lib/corrections.py (defect D9), which asserts this prior value.
    # Correcting it here instead would break that assertion. Verified 2026-07-27 by agents A1/A2.
    gate("G17 espnEventId duplicates are exactly the one documented upstream defect",
         dup_ev == ["301114022"], f"{dup_ev}")

    lines = [r for r in rows if r["resultStatus"] == "final"]
    complete = [r for r in lines if all(r[f] is not None for f in
                ("spreadLine", "totalLine", "awayMoneyline", "homeMoneyline",
                 "awaySpreadOdds", "homeSpreadOdds", "overOdds", "underOdds"))]
    gate("G18 every completed game carries a full set of lines and prices",
         len(complete) == len(lines), f"{len(lines)-len(complete)} incomplete")

    # 2026 rows must carry no result data at all - the games have not been played.
    leak = [r["gameId"] for r in rows if r["season"] == 2026
            and any(r[f] is not None for f in ("awayScore", "homeScore", "result",
                                               "total", "spreadLine", "totalLine"))]
    gate("G19 no 2026 row carries score or line data", not leak, f"{leak[:3]}")

    tbd = [r for r in rows if r["resultStatus"] == "tbd"]
    bad_tbd = [r["gameId"] for r in tbd
               if r["awayFranchiseId"] is not None or r["homeFranchiseId"] is not None]
    gate("G20 TBD games carry no franchise id (matchup genuinely unresolved)",
         not bad_tbd, f"{bad_tbd[:3]}")

    failed = [n for n, ok, _ in FAILURES if not ok]
    print(f"\n  {len(FAILURES)-len(failed)}/{len(FAILURES)} gates passed")
    if failed:
        print("  REFUSING TO WRITE - failed:", ", ".join(failed))
        sys.exit(1)

    # ================= WRITE ==============================================
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, "games.json"), "w") as fh:
        json.dump(rows, fh, indent=2)
        fh.write("\n")

    null_by_field = {k: sum(1 for r in rows if r[k] is None) for k in rows[0]}
    manifest = {
        "dataset": "nfl-unified-2010-2026",
        "description": "Conformed union of the nflverse 2010-2025 lines extract and the ESPN 2026 schedule",
        "generatedUtc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "operation": "UNION (inputs are disjoint in time and in ESPN event id space; no row-level join occurs)",
        "inputs": [
            {"path": "scripts/data/nfl-lines-2010-2025/games.json", "rows": n_hist,
             "seasons": "2010-2025", "source": "nflverse via nflreadr"},
            {"path": "scripts/data/nfl-2026/games.json", "rows": n_new,
             "seasons": "2026", "source": "ESPN"},
        ],
        "rows": len(rows),
        "primaryKey": "gameId",
        "joinKey": "espnEventId is indexed but NOT unique - never use it as a key",
        "conformance": {
            "week": "regular-season week ONLY; null for playoffs. Resolves the week-18 collision (RS wk18 in 2021+ vs Wild Card in 2010-2020).",
            "playoffRound": "WC/DIV/CON/SB; null for regular season. 2026 playoff weeks 1/2/3/5 map to WC/DIV/CON/SB (week 4 is the pre-Super-Bowl bye).",
            "franchiseId": "ESPN franchise id, stable across relocation. OAK->13, STL/LA->14, SD->24, WAS->28. The abbreviation is an era-specific label, never a key.",
            "resultStatus": "final (played, scores present) | scheduled (2026, teams known) | tbd (2026 playoff slot, matchup unresolved)",
        },
        "knownUpstreamDefects": [
            {"field": "espnEventId", "value": "301114022",
             "detail": "nflverse attaches this id to both 2010_10_HOU_JAX and 2010_10_SEA_ARI. "
                       "ESPN confirms 301114022 is SEA@ARI; the correct id for 2010_10_HOU_JAX is "
                       "301114030. Asserted (not patched) by gate G17 to keep this extract faithful "
                       "to upstream; corrected downstream as defect D9. Never join on this id "
                       "without the correction applied."},
            {"season": 2022, "detail": "271 regular-season games, not 272: the 2023-01-02 Bills-Bengals game was abandoned and never resumed; nflverse omits the row."},
        ],
        "validation": {"gatesRun": len(FAILURES), "gatesPassed": len(FAILURES),
                       "gates": [n for n, _, _ in FAILURES]},
        "nullsByField": {k: v for k, v in null_by_field.items() if v},
        "provenance": "docs/audits/2026-07-26-nflverse-stack-forensic-audit.md",
    }
    with open(os.path.join(OUT_DIR, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
        fh.write("\n")

    print(f"\nwrote {len(rows)} games ({n_hist} historical + {n_new} from 2026)")
    print(f"  seasons 2010-2026 | {len([r for r in rows if r['resultStatus']=='final'])} final, "
          f"{len([r for r in rows if r['resultStatus']=='scheduled'])} scheduled, "
          f"{len(tbd)} tbd")


if __name__ == "__main__":
    main()
