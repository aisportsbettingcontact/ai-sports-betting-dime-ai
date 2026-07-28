"""Transform crawled MLB Stats API feeds into per-table NDJSON for the mlb_* canonical schema.

Reads docs/mlb-stats-api/data/feeds-{season}/*.json (+ games-{season}.json for the isTie /
seriesDescription / seriesGameNumber / gamesInSeries join) and writes
docs/mlb-stats-api/data/etl-out/{season}/{table}.ndjson for: mlb_games, mlb_plays, mlb_pitches,
mlb_boxscore_batting, mlb_boxscore_pitching, mlb_officials -- plus accumulating dimension
dictionaries (deduped by PK, merged across runs) at etl-out/dims/{mlb_people,mlb_venues,
mlb_franchises,mlb_seasons}.ndjson, and a per-season etl-out/{season}/manifest.json.

Python 3 stdlib only.

Usage: python3 transform.py --season 2026
       python3 transform.py --all
"""
import argparse, json, os
from datetime import datetime, timezone

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DATA_DIR = os.path.join(REPO, "docs", "mlb-stats-api", "data")
OUT_DIR = os.path.join(DATA_DIR, "etl-out")
DIMS_DIR = os.path.join(OUT_DIR, "dims")

TABLES = ["mlb_games", "mlb_plays", "mlb_pitches", "mlb_boxscore_batting",
          "mlb_boxscore_pitching", "mlb_officials"]
DIM_TABLES = ["mlb_people", "mlb_venues", "mlb_franchises", "mlb_seasons"]

POSTSEASON_TYPES = {"F", "D", "L", "W"}
LEAGUE_ABBREV = {"American League": "AL", "National League": "NL"}


# ─── generic helpers ─────────────────────────────────────────────────────────

def ensure_out_dir(path):
    os.makedirs(path, exist_ok=True)
    gi = os.path.join(path, ".gitignore")
    if not os.path.exists(gi):
        open(gi, "w").write("*\n!.gitignore\n")


def iso_to_sql_utc(s):
    """'2026-07-26T23:20:00Z' / with fractional seconds -> 'YYYY-MM-DD HH:MM:SS' UTC, or None."""
    if not s:
        return None
    try:
        s2 = s.replace("Z", "+00:00")
        dt = datetime.fromisoformat(s2)
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc)
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None


def innings_pitched_to_outs(ip):
    """'5.2' -> 17 outs: int(whole)*3 + int(frac)."""
    if ip is None or ip == "":
        return None
    whole, _, frac = str(ip).partition(".")
    try:
        w = int(whole) if whole not in ("", "-") else 0
        f = int(frac) if frac != "" else 0
    except ValueError:
        return None
    return w * 3 + f


def to_int(v):
    if v is None:
        return None
    try:
        return int(v)
    except (ValueError, TypeError):
        return None


def load_feeds_dir(season):
    d = os.path.join(DATA_DIR, f"feeds-{season}")
    if not os.path.isdir(d):
        return []
    return sorted(f for f in os.listdir(d) if f.endswith(".json") and f != "verify-report.json")


def load_dataset(season):
    path = os.path.join(DATA_DIR, f"games-{season}.json")
    if not os.path.exists(path):
        return {}
    rows = json.load(open(path))
    return {r["gamePk"]: r for r in rows}


def write_ndjson(path, rows):
    with open(path, "w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False))
            f.write("\n")


def load_ndjson_dict(path, pk_field):
    """Load an existing dims ndjson into {pk: row} for merge-on-rerun."""
    out = {}
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            out[row[pk_field]] = row
    return out


def merge_non_null(existing, new):
    """Fill in missing (None) fields on `existing` from `new`; leave existing non-null as-is."""
    for k, v in new.items():
        if existing.get(k) is None and v is not None:
            existing[k] = v
    return existing


# ─── per-feed extraction ─────────────────────────────────────────────────────

def game_max_inning(all_plays):
    if not all_plays:
        return None
    return max(p["about"]["inning"] for p in all_plays)


def extract_game(feed, dataset_row, loaded_at):
    gd = feed["gameData"]
    ld = feed["liveData"]
    game = gd["game"]
    dt = gd["datetime"]
    status = gd["status"]
    ls = ld.get("linescore", {})
    ls_teams = ls.get("teams", {})
    away_ls = ls_teams.get("away", {})
    home_ls = ls_teams.get("home", {})
    decisions = ld.get("decisions", {}) or {}
    venue = gd.get("venue", {}) or {}
    weather = gd.get("weather", {}) or {}
    game_info = gd.get("gameInfo", {}) or {}
    meta = feed.get("metaData", {}) or {}

    plays = ld.get("plays", {}).get("allPlays", [])
    innings = game_max_inning(plays)
    if innings is None:
        innings = len(ls.get("innings", [])) or ls.get("scheduledInnings")

    temp = weather.get("temp")
    row = {
        "game_pk": feed["gamePk"],
        "game_guid": game.get("id"),
        "season": to_int(game.get("season")),
        "game_type": game.get("type"),
        "series_description": (dataset_row or {}).get("seriesDescription"),
        "official_date": dt.get("officialDate"),
        "game_datetime_utc": iso_to_sql_utc(dt.get("dateTime")),
        "day_night": dt.get("dayNight"),
        "double_header": game.get("doubleHeader"),
        "game_number": game.get("gameNumber"),
        "games_in_series": (dataset_row or {}).get("gamesInSeries"),
        "series_game_number": (dataset_row or {}).get("seriesGameNumber"),
        "status_code": status.get("statusCode"),
        "detailed_state": status.get("detailedState"),
        "is_tie": bool((dataset_row or {}).get("isTie", False)),
        "away_team_id": gd["teams"]["away"]["id"],
        "home_team_id": gd["teams"]["home"]["id"],
        "away_score": away_ls.get("runs"),
        "home_score": home_ls.get("runs"),
        "away_hits": away_ls.get("hits"),
        "home_hits": home_ls.get("hits"),
        "away_errors": away_ls.get("errors"),
        "home_errors": home_ls.get("errors"),
        "innings": innings,
        "scheduled_innings": ls.get("scheduledInnings"),
        "venue_id": venue.get("id"),
        "attendance": game_info.get("attendance"),
        "duration_minutes": game_info.get("gameDurationMinutes"),
        "first_pitch_utc": iso_to_sql_utc(game_info.get("firstPitch")),
        "weather_condition": weather.get("condition"),
        "temp_f": to_int(temp),
        "wind": weather.get("wind"),
        "winner_pitcher_id": (decisions.get("winner") or {}).get("id"),
        "loser_pitcher_id": (decisions.get("loser") or {}).get("id"),
        "save_pitcher_id": (decisions.get("save") or {}).get("id"),
        "gameday_type": game.get("gamedayType"),
        "feed_timestamp": meta.get("timeStamp"),
        "loaded_at": loaded_at,
    }
    return row


def extract_runners(play_runners):
    out = []
    for r in play_runners:
        mv = r.get("movement", {}) or {}
        det = r.get("details", {}) or {}
        runner = det.get("runner") or {}
        out.append({
            "id": runner.get("id"),
            "start": mv.get("start"),
            "end": mv.get("end"),
            "out": mv.get("isOut"),
            "rbi": det.get("rbi"),
            "earned": det.get("earned"),
        })
    return out


def extract_plays(feed, season):
    game_pk = feed["gamePk"]
    plays = feed["liveData"]["plays"]["allPlays"]
    rows = []
    for p in plays:
        about = p["about"]
        result = p["result"]
        count = p.get("count", {}) or {}
        matchup = p.get("matchup", {}) or {}
        bat_side = matchup.get("batSide") or {}
        pitch_hand = matchup.get("pitchHand") or {}
        splits = matchup.get("splits") or {}
        events = p.get("playEvents", []) or []
        pitch_count = sum(1 for e in events if e.get("isPitch"))
        rows.append({
            "game_pk": game_pk,
            "at_bat_index": about["atBatIndex"],
            "inning": about["inning"],
            "half": about["halfInning"],
            "batter_id": matchup["batter"]["id"],
            "pitcher_id": matchup["pitcher"]["id"],
            "bat_side": bat_side.get("code"),
            "pitch_hand": pitch_hand.get("code"),
            # Extremely rare: at-bat interrupted mid-plate-appearance (game called, e.g. rain)
            # leaves `result` with no eventType/event classification at all.
            "event_type": result.get("eventType") or "unknown",
            "event": result.get("event"),
            "description": result.get("description"),
            "rbi": result.get("rbi", 0),
            "away_score": result.get("awayScore", 0),
            "home_score": result.get("homeScore", 0),
            "is_scoring_play": bool(about.get("isScoringPlay", False)),
            "has_out": about.get("hasOut"),
            "outs_end": count.get("outs"),
            "balls_end": count.get("balls"),
            "strikes_end": count.get("strikes"),
            "men_on_base_split": splits.get("menOnBase"),
            "start_time_utc": iso_to_sql_utc(about.get("startTime")),
            "end_time_utc": iso_to_sql_utc(about.get("endTime")),
            "runners": extract_runners(p.get("runners", [])),
            "pitch_count": pitch_count,
        })
    return rows


def extract_pitches(feed, season):
    game_pk = feed["gamePk"]
    plays = feed["liveData"]["plays"]["allPlays"]
    rows = []
    for p in plays:
        about = p["about"]
        matchup = p.get("matchup", {}) or {}
        batter_id = matchup["batter"]["id"]
        pitcher_id = matchup["pitcher"]["id"]
        at_bat_index = about["atBatIndex"]
        for e in p.get("playEvents", []) or []:
            if not e.get("isPitch") or not e.get("playId"):
                continue
            details = e.get("details", {}) or {}
            call = details.get("call") or {}
            ptype = details.get("type") or {}
            count = e.get("count", {}) or {}
            pd = e.get("pitchData", {}) or {}
            coords = pd.get("coordinates", {}) or {}
            breaks = pd.get("breaks", {}) or {}
            hit = e.get("hitData", {}) or {}
            hit_coords = hit.get("coordinates", {}) or {}
            rows.append({
                "play_id": e["playId"],
                "game_pk": game_pk,
                "season": season,
                "at_bat_index": at_bat_index,
                "pitch_number": e.get("pitchNumber"),
                "batter_id": batter_id,
                "pitcher_id": pitcher_id,
                "is_pitch": True,
                "call_code": call.get("code"),
                "call_description": call.get("description"),
                "pitch_type_code": ptype.get("code"),
                "pitch_type": ptype.get("description"),
                "type_confidence": pd.get("typeConfidence"),
                "balls": count.get("balls"),
                "strikes": count.get("strikes"),
                "start_speed": pd.get("startSpeed"),
                "end_speed": pd.get("endSpeed"),
                "spin_rate": breaks.get("spinRate"),
                "extension": pd.get("extension"),
                "plate_time": pd.get("plateTime"),
                "px": coords.get("pX"),
                "pz": coords.get("pZ"),
                "zone": pd.get("zone"),
                "sz_top": pd.get("strikeZoneTop"),
                "sz_bot": pd.get("strikeZoneBottom"),
                "break_angle": breaks.get("breakAngle"),
                "break_length": breaks.get("breakLength"),
                "break_vertical": breaks.get("breakVertical"),
                "break_horizontal": breaks.get("breakHorizontal"),
                "is_in_play": details.get("isInPlay"),
                "launch_speed": hit.get("launchSpeed"),
                "launch_angle": hit.get("launchAngle"),
                "total_distance": hit.get("totalDistance"),
                "trajectory": hit.get("trajectory"),
                "hit_coord_x": hit_coords.get("coordX"),
                "hit_coord_y": hit_coords.get("coordY"),
            })
    return rows


def extract_boxscores(feed):
    game_pk = feed["gamePk"]
    boxscore = feed["liveData"].get("boxscore", {}) or {}
    teams = boxscore.get("teams", {}) or {}
    batting_rows, pitching_rows = [], []
    for side in ("away", "home"):
        team = teams.get(side, {}) or {}
        team_id = (team.get("team") or {}).get("id")
        players = team.get("players", {}) or {}
        for _, p in players.items():
            person = p.get("person", {}) or {}
            mlbam_id = person.get("id")
            position = (p.get("position") or {}).get("abbreviation")
            stats = p.get("stats", {}) or {}
            batting = stats.get("batting") or {}
            pitching = stats.get("pitching") or {}
            if batting:
                batting_rows.append({
                    "game_pk": game_pk,
                    "mlbam_id": mlbam_id,
                    "team_id": team_id,
                    "batting_order": to_int(p.get("battingOrder")),
                    "position": position,
                    "ab": batting.get("atBats", 0),
                    "r": batting.get("runs", 0),
                    "h": batting.get("hits", 0),
                    "doubles": batting.get("doubles", 0),
                    "triples": batting.get("triples", 0),
                    "hr": batting.get("homeRuns", 0),
                    "rbi": batting.get("rbi", 0),
                    "bb": batting.get("baseOnBalls", 0),
                    "so": batting.get("strikeOuts", 0),
                    "hbp": batting.get("hitByPitch", 0),
                    "sb": batting.get("stolenBases", 0),
                    "cs": batting.get("caughtStealing", 0),
                    "lob": batting.get("leftOnBase"),
                    "sac_bunts": batting.get("sacBunts", 0),
                    "sac_flies": batting.get("sacFlies", 0),
                })
            if pitching:
                wins = pitching.get("wins", 0) or 0
                losses = pitching.get("losses", 0) or 0
                saves = pitching.get("saves", 0) or 0
                holds = pitching.get("holds")
                pitching_rows.append({
                    "game_pk": game_pk,
                    "mlbam_id": mlbam_id,
                    "team_id": team_id,
                    "outs_recorded": innings_pitched_to_outs(pitching.get("inningsPitched")) or 0,
                    "batters_faced": pitching.get("battersFaced", 0),
                    "h": pitching.get("hits", 0),
                    "r": pitching.get("runs", 0),
                    "er": pitching.get("earnedRuns", 0),
                    "bb": pitching.get("baseOnBalls", 0),
                    "so": pitching.get("strikeOuts", 0),
                    "hr": pitching.get("homeRuns", 0),
                    "pitches": pitching.get("numberOfPitches"),
                    "strikes": pitching.get("strikes"),
                    "win": bool(wins > 0),
                    "loss": bool(losses > 0),
                    "save": bool(saves > 0),
                    "hold": bool(holds > 0) if holds is not None else None,
                })
    return batting_rows, pitching_rows


def extract_officials(feed):
    game_pk = feed["gamePk"]
    officials = feed["liveData"].get("boxscore", {}).get("officials", []) or []
    rows = []
    for o in officials:
        official = o.get("official", {}) or {}
        if official.get("id") is None:
            continue
        rows.append({
            "game_pk": game_pk,
            "mlbam_id": official["id"],
            "position": o.get("officialType"),
        })
    return rows


# ─── dims ─────────────────────────────────────────────────────────────────

def update_people_from_game_players(feed, people):
    for _, person in feed["gameData"].get("players", {}).items():
        pid = person.get("id")
        if pid is None:
            continue
        pos = person.get("primaryPosition") or {}
        bat_side = person.get("batSide") or {}
        pitch_hand = person.get("pitchHand") or {}
        new = {
            "mlbam_id": pid,
            "full_name": person.get("fullName"),
            "first_name": person.get("firstName"),
            "last_name": person.get("lastName"),
            "primary_position": pos.get("abbreviation"),
            "bat_side": bat_side.get("code"),
            "pitch_hand": pitch_hand.get("code"),
            "birth_date": person.get("birthDate"),
            "mlb_debut": person.get("mlbDebutDate"),
            "active": person.get("active"),
            "is_umpire": False,
        }
        if pid in people:
            people[pid] = merge_non_null(people[pid], new)
        else:
            people[pid] = new


def update_people_from_officials(feed, people):
    officials = feed["liveData"].get("boxscore", {}).get("officials", []) or []
    for o in officials:
        official = o.get("official", {}) or {}
        pid = official.get("id")
        if pid is None:
            continue
        new = {
            "mlbam_id": pid,
            "full_name": official.get("fullName"),
            "first_name": None,
            "last_name": None,
            "primary_position": None,
            "bat_side": None,
            "pitch_hand": None,
            "birth_date": None,
            "mlb_debut": None,
            "active": None,
            "is_umpire": True,
        }
        if pid in people:
            existing = people[pid]
            merge_non_null(existing, new)
            existing["is_umpire"] = True
        else:
            people[pid] = new


def update_venues(feed, venues):
    venue = feed["gameData"].get("venue", {}) or {}
    vid = venue.get("id")
    if vid is None:
        return
    field = venue.get("fieldInfo", {}) or {}
    loc = venue.get("location", {}) or {}
    tz = venue.get("timeZone", {}) or {}
    new = {
        "venue_id": vid,
        "name": venue.get("name"),
        "active": venue.get("active"),
        "capacity": field.get("capacity"),
        "turf_type": field.get("turfType"),
        "roof_type": field.get("roofType"),
        "left_line": field.get("leftLine"),
        "left_field": field.get("left"),
        "left_center": field.get("leftCenter"),
        "center": field.get("center"),
        "right_center": field.get("rightCenter"),
        "right_field": field.get("right"),
        "right_line": field.get("rightLine"),
        "city": loc.get("city"),
        "state": loc.get("state") or loc.get("stateAbbrev"),
        "timezone": tz.get("id"),
    }
    if vid in venues:
        venues[vid] = merge_non_null(venues[vid], new)
    else:
        venues[vid] = new


def update_franchises(feed, franchises):
    teams = feed["gameData"].get("teams", {}) or {}
    for side in ("away", "home"):
        team = teams.get(side, {}) or {}
        tid = team.get("id")
        if tid is None:
            continue
        league = team.get("league") or {}
        division = team.get("division") or {}
        league_abbrev = LEAGUE_ABBREV.get(league.get("name"))
        division_short = None
        if division.get("name"):
            words = division["name"].split()
            if words:
                division_short = f"{league_abbrev or ''} {words[-1]}".strip()
        new = {
            "team_id": tid,
            "name": team.get("name"),
            "abbrev": team.get("abbreviation"),
            "league": league_abbrev,
            "division": division_short,
            "active": team.get("active"),
        }
        if tid in franchises:
            franchises[tid] = merge_non_null(franchises[tid], new)
        else:
            franchises[tid] = new


def update_seasons(season, dataset_rows, seasons):
    reg_dates = [r["officialDate"] for r in dataset_rows if r.get("gameType") == "R"]
    post_dates = [r["officialDate"] for r in dataset_rows if r.get("gameType") in POSTSEASON_TYPES]
    games_expected = sum(1 for r in dataset_rows if r.get("gameType") == "R")
    new = {
        "season": season,
        "regular_season_start": min(reg_dates) if reg_dates else None,
        "regular_season_end": max(reg_dates) if reg_dates else None,
        "postseason_end": max(post_dates) if post_dates else None,
        "games_expected": games_expected,
        "notes": None,
    }
    if season in seasons:
        seasons[season] = merge_non_null(seasons[season], new)
    else:
        seasons[season] = new


# ─── driver ───────────────────────────────────────────────────────────────

def transform_season(season, loaded_at):
    feed_files = load_feeds_dir(season)
    dataset = load_dataset(season)

    out_dir = os.path.join(OUT_DIR, str(season))
    ensure_out_dir(OUT_DIR)
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(DIMS_DIR, exist_ok=True)

    games, plays, pitches, batting, pitching, officials = [], [], [], [], [], []

    people = load_ndjson_dict(os.path.join(DIMS_DIR, "mlb_people.ndjson"), "mlbam_id")
    venues = load_ndjson_dict(os.path.join(DIMS_DIR, "mlb_venues.ndjson"), "venue_id")
    franchises = load_ndjson_dict(os.path.join(DIMS_DIR, "mlb_franchises.ndjson"), "team_id")
    seasons = load_ndjson_dict(os.path.join(DIMS_DIR, "mlb_seasons.ndjson"), "season")

    for fname in feed_files:
        path = os.path.join(DATA_DIR, f"feeds-{season}", fname)
        try:
            feed = json.load(open(path))
        except ValueError:
            continue
        game_pk = feed.get("gamePk")
        dataset_row = dataset.get(game_pk)

        games.append(extract_game(feed, dataset_row, loaded_at))
        plays.extend(extract_plays(feed, season))
        pitches.extend(extract_pitches(feed, season))
        b_rows, p_rows = extract_boxscores(feed)
        batting.extend(b_rows)
        pitching.extend(p_rows)
        officials.extend(extract_officials(feed))

        update_people_from_game_players(feed, people)
        update_people_from_officials(feed, people)
        update_venues(feed, venues)
        update_franchises(feed, franchises)

    update_seasons(season, list(dataset.values()), seasons)

    write_ndjson(os.path.join(out_dir, "mlb_games.ndjson"), games)
    write_ndjson(os.path.join(out_dir, "mlb_plays.ndjson"), plays)
    write_ndjson(os.path.join(out_dir, "mlb_pitches.ndjson"), pitches)
    write_ndjson(os.path.join(out_dir, "mlb_boxscore_batting.ndjson"), batting)
    write_ndjson(os.path.join(out_dir, "mlb_boxscore_pitching.ndjson"), pitching)
    write_ndjson(os.path.join(out_dir, "mlb_officials.ndjson"), officials)

    write_ndjson(os.path.join(DIMS_DIR, "mlb_people.ndjson"),
                 [people[k] for k in sorted(people)])
    write_ndjson(os.path.join(DIMS_DIR, "mlb_venues.ndjson"),
                 [venues[k] for k in sorted(venues)])
    write_ndjson(os.path.join(DIMS_DIR, "mlb_franchises.ndjson"),
                 [franchises[k] for k in sorted(franchises)])
    write_ndjson(os.path.join(DIMS_DIR, "mlb_seasons.ndjson"),
                 [seasons[k] for k in sorted(seasons)])

    manifest = {
        "games": len(games),
        "plays": len(plays),
        "pitches": len(pitches),
        "batting_rows": len(batting),
        "pitching_rows": len(pitching),
        "officials": len(officials),
    }
    json.dump(manifest, open(os.path.join(out_dir, "manifest.json"), "w"), indent=2)
    return manifest


def all_seasons():
    out = []
    for name in sorted(os.listdir(DATA_DIR)):
        if name.startswith("feeds-") and os.path.isdir(os.path.join(DATA_DIR, name)):
            try:
                out.append(int(name.split("-")[1]))
            except ValueError:
                pass
    return sorted(out)


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--season", type=int)
    g.add_argument("--all", action="store_true")
    a = ap.parse_args()

    loaded_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    seasons = all_seasons() if a.all else [a.season]
    for season in seasons:
        manifest = transform_season(season, loaded_at)
        print(f"{season}: {manifest}", flush=True)


if __name__ == "__main__":
    main()
