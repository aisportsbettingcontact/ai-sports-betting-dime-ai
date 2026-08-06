"""asof_stub.py — SMOKE-TEST STUB of the AsOfFeatureStore interface.

*** THIS IS NOT THE REAL FEATURE STORE. ***
It exists only so replay_driver.py can be exercised end-to-end before
asof_features.py (the leakage-audited as-of store) lands. Every statistical
input below is a LEAGUE-AVERAGE PLACEHOLDER — none of it is as-of-correct,
and nothing produced through this stub may be treated as replay output.
Rows written through this stub must use a sentinel --sha (e.g. "smokestub")
and be deleted after inspection.

What IS real here (read-only DB / cached StatsAPI):
  - game identity, teams, gamePk (games ⋈ mlb_replay_linescores)
  - the as-of cutoff (mlb_schedule_history.startTimeUtc, DH-sequenced)
  - actual starters / hands / lineups (mlb_replay_linescores)
  - book lines (games row columns; mlb_strikeout_props / mlb_hr_props lines)
  - park factors (mlb_park_factors)
  - player names (StatsAPI /people, cached as JSON keyed by URL hash)

Interface mirrors asof_features.AsOfFeatureStore exactly (see REPLAY-PROTOCOL.md).
"""

from __future__ import annotations

import hashlib
import json
import os
import urllib.request
from datetime import datetime, timezone

from replay_db import connect

_LEAGUE = {
    # 2025 league-average placeholders (STUB ONLY)
    "rpg": 4.45,
    "era": 4.15,
    "avg": 0.245,
    "obp": 0.317,
    "slg": 0.410,
    "woba": 0.320,
    "k9": 8.5,
    "bb9": 3.2,
    "whip": 1.29,
    "xfip": 4.10,
    "fip": 4.15,
    "team_k9_samebasis": 6.8,   # K/AB*27 basis (mlb_team_batting_splits.k9 scale)
    "batter_hr_rate_per_ab": 0.0349,  # league HR/PA 0.0309 ÷ AB/PA 0.885
    "pitcher_hr9": 1.28,
    "ip_per_start": 5.1,
}

_HAND_NUM = {"R": 0, "L": 1, "S": 2}


def _parse_utc_ms(v) -> int:
    if isinstance(v, datetime):
        dt = v if v.tzinfo else v.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)
    s = str(v).strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


class StubAsOfFeatureStore:
    """Interface-compatible stub. See module docstring — smoke tests only."""

    is_stub = True

    def __init__(self, cache_dir: str):
        self.cache_dir = cache_dir
        os.makedirs(cache_dir, exist_ok=True)
        self.conn = connect()
        self._meta_cache: dict[int, dict | None] = {}

    # ── cached StatsAPI GET (JSON keyed by URL hash) ─────────────────────────
    def _statsapi_json(self, url: str) -> dict:
        key = hashlib.sha256(url.encode()).hexdigest()
        path = os.path.join(self.cache_dir, f"{key}.json")
        if os.path.exists(path):
            with open(path) as f:
                return json.load(f)
        with urllib.request.urlopen(url, timeout=30) as resp:
            data = json.loads(resp.read().decode())
        with open(path, "w") as f:
            json.dump(data, f)
        return data

    def _player_names(self, mlbam_ids: list[int]) -> dict[int, str]:
        ids = sorted({int(i) for i in mlbam_ids if i})
        if not ids:
            return {}
        url = "https://statsapi.mlb.com/api/v1/people?personIds=" + ",".join(map(str, ids))
        try:
            data = self._statsapi_json(url)
            return {p["id"]: p.get("fullName", f"mlbam:{p['id']}") for p in data.get("people", [])}
        except Exception:
            return {i: f"mlbam:{i}" for i in ids}

    def _q(self, sql: str, params=()):
        with self.conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()

    # ── interface: game_meta ─────────────────────────────────────────────────
    def game_meta(self, game_id: int) -> dict | None:
        if game_id in self._meta_cache:
            return self._meta_cache[game_id]
        rows = self._q(
            """SELECT g.id, g.mlbGamePk, g.gameDate, g.awayTeam, g.homeTeam, g.gameNumber,
                      g.awayML, g.homeML, g.bookTotal, g.homeRunLine,
                      r.awayStarterId, r.homeStarterId, r.awayStarterHand, r.homeStarterHand,
                      r.awayLineup, r.homeLineup
               FROM games g JOIN mlb_replay_linescores r ON r.gamePk = g.mlbGamePk
               WHERE g.id = %s""",
            (game_id,),
        )
        if not rows:
            self._meta_cache[game_id] = None
            return None
        g = rows[0]
        sched = self._q(
            """SELECT startTimeUtc FROM mlb_schedule_history
               WHERE gameDate = %s AND awayAbbr = %s AND homeAbbr = %s
               ORDER BY startTimeUtc""",
            (g["gameDate"], g["awayTeam"], g["homeTeam"]),
        )
        if not sched:
            self._meta_cache[game_id] = None
            return None
        idx = max(0, min(len(sched) - 1, (g["gameNumber"] or 1) - 1))
        meta = {
            "gameId": g["id"],
            "gamePk": g["mlbGamePk"],
            "gameDate": str(g["gameDate"]),
            "away": g["awayTeam"],
            "home": g["homeTeam"],
            "startUtcMs": _parse_utc_ms(sched[idx]["startTimeUtc"]),
            "awayStarterId": g["awayStarterId"],
            "homeStarterId": g["homeStarterId"],
            "awayStarterHand": g["awayStarterHand"],
            "homeStarterHand": g["homeStarterHand"],
            "lineupAway": json.loads(g["awayLineup"] or "[]"),
            "lineupHome": json.loads(g["homeLineup"] or "[]"),
            # stub extras for project_game_kwargs
            "_awayML": g["awayML"], "_homeML": g["homeML"],
            "_bookTotal": g["bookTotal"], "_homeRunLine": g["homeRunLine"],
        }
        self._meta_cache[game_id] = meta
        return meta

    # ── interface: project_game_kwargs ───────────────────────────────────────
    def project_game_kwargs(self, game_id: int) -> dict:
        m = self.game_meta(game_id)
        if m is None:
            raise LookupError(f"no substrate/schedule for game {game_id}")

        def _ml(v):
            try:
                return int(str(v).replace("+", ""))
            except (TypeError, ValueError):
                return None

        def _f(v):
            try:
                return float(str(v).replace("+", ""))
            except (TypeError, ValueError):
                return None

        team_stub = dict(
            rpg=_LEAGUE["rpg"], era=_LEAGUE["era"], avg=_LEAGUE["avg"],
            obp=_LEAGUE["obp"], slg=_LEAGUE["slg"], woba=_LEAGUE["woba"],
        )

        def _sp_stub(hand):
            return dict(
                era=_LEAGUE["era"], k9=_LEAGUE["k9"], bb9=_LEAGUE["bb9"],
                whip=_LEAGUE["whip"], ip=102.0, gp=20, xfip=_LEAGUE["xfip"],
                fip=_LEAGUE["fip"], throwsHand=_HAND_NUM.get(hand or "R", 0),
            )

        pf = self._q(
            "SELECT parkFactor3yr FROM mlb_park_factors WHERE teamAbbrev = %s", (m["home"],)
        )
        park_3yr = float(pf[0]["parkFactor3yr"]) if pf and pf[0]["parkFactor3yr"] is not None else 1.0

        book_lines = {}
        if _ml(m["_homeML"]) is not None:
            book_lines["ml_home"] = _ml(m["_homeML"])
        if _ml(m["_awayML"]) is not None:
            book_lines["ml_away"] = _ml(m["_awayML"])
        if _f(m["_bookTotal"]) is not None:
            book_lines["ou_line"] = _f(m["_bookTotal"])
        if _f(m["_homeRunLine"]) is not None:
            book_lines["rl_home_spread"] = _f(m["_homeRunLine"])

        return dict(
            away_abbrev=m["away"],
            home_abbrev=m["home"],
            away_team_stats=team_stub,
            home_team_stats=dict(team_stub),
            away_pitcher_stats=_sp_stub(m["awayStarterHand"]),
            home_pitcher_stats=_sp_stub(m["homeStarterHand"]),
            book_lines=book_lines,
            game_date=datetime.strptime(m["gameDate"], "%Y-%m-%d"),
            weather=None,
            seed=42,
            verbose=False,
            park_factor_3yr=park_3yr,
            away_bullpen=None,   # protocol: league-neutral bullpen for ALL replay games
            home_bullpen=None,
            umpire_k_mod=1.0,
            umpire_bb_mod=1.0,
            umpire_name="STUB_NEUTRAL",
            mlb_game_pk=m["gamePk"],
        )

    # ── interface: pitcher_asof / team_asof (unused by pass-1 driver) ────────
    def pitcher_asof(self, mlbam_id: int, cutoff_ms: int) -> dict:
        base = dict(
            k9=_LEAGUE["k9"], bb9=_LEAGUE["bb9"], hr9=_LEAGUE["pitcher_hr9"],
            era=_LEAGUE["era"], whip=_LEAGUE["whip"], ip_per_start=_LEAGUE["ip_per_start"],
            fip=_LEAGUE["fip"], starts_2026=0,
        )
        return dict(base, rolling5=dict(base), season2025=dict(base))

    def team_asof(self, abbrev: str, cutoff_ms: int, vs_hand: str) -> dict:
        return dict(
            rpg=_LEAGUE["rpg"], era=_LEAGUE["era"], avg=_LEAGUE["avg"],
            obp=_LEAGUE["obp"], slg=_LEAGUE["slg"], woba=_LEAGUE["woba"],
        )

    # ── interface: kprop_inputs ──────────────────────────────────────────────
    def kprop_inputs(self, game_id: int, side: str) -> dict | None:
        m = self.game_meta(game_id)
        if m is None:
            return None
        sp_id = m["awayStarterId"] if side == "away" else m["homeStarterId"]
        if not sp_id:
            return None
        hand = (m["awayStarterHand"] if side == "away" else m["homeStarterHand"]) or "R"
        name = self._player_names([sp_id]).get(sp_id, f"mlbam:{sp_id}")
        line_rows = self._q(
            "SELECT bookLine FROM mlb_strikeout_props WHERE gameId = %s AND side = %s LIMIT 1",
            (game_id, side),
        )
        book_line = None
        if line_rows and line_rows[0]["bookLine"] is not None:
            book_line = float(line_rows[0]["bookLine"])
        return {
            "mlbamId": sp_id,
            "name": name,
            "hand": hand,
            "pitcher_k9_blend": _LEAGUE["k9"],          # STUB league-average
            "xfip_adj": 1.0,                            # STUB neutral
            "opp_k9_samebasis": _LEAGUE["team_k9_samebasis"],   # STUB neutral
            "league_mean_k9_hand": _LEAGUE["team_k9_samebasis"],
            "ip_expected_asof": _LEAGUE["ip_per_start"],
            "umpire_k_mod": 1.0,
            "book_line": book_line,
        }

    # ── interface: hrprop_inputs ─────────────────────────────────────────────
    def hrprop_inputs(self, game_id: int) -> list:
        m = self.game_meta(game_id)
        if m is None:
            return []
        pf = self._q("SELECT hrFactor FROM mlb_park_factors WHERE teamAbbrev = %s", (m["home"],))
        park_hr = float(pf[0]["hrFactor"]) if pf and pf[0]["hrFactor"] is not None else 1.0
        lines = {
            r["mlbamId"]: (float(r["bookLine"]) if r["bookLine"] is not None else None)
            for r in self._q(
                "SELECT mlbamId, bookLine FROM mlb_hr_props WHERE gameId = %s", (game_id,)
            )
            if r["mlbamId"] is not None
        }
        all_ids = [int(i) for i in (m["lineupAway"] + m["lineupHome"])]
        names = self._player_names(all_ids)
        out = []
        for side, ids in (("away", m["lineupAway"]), ("home", m["lineupHome"])):
            for pid in ids:
                pid = int(pid)
                out.append({
                    "mlbamId": pid,
                    "name": names.get(pid, f"mlbam:{pid}"),
                    "side": side,
                    "batter_hr_rate_asof": _LEAGUE["batter_hr_rate_per_ab"],  # STUB
                    "pitcher_hr9_asof": _LEAGUE["pitcher_hr9"],               # STUB
                    "park_hr_factor": park_hr,
                    "book_line": lines.get(pid),
                })
        return out

    # ── interface: nrfi_features (unused by pass-1 driver) ───────────────────
    def nrfi_features(self, game_id: int) -> dict:
        m = self.game_meta(game_id) or {}
        return {
            "awayStarterNrfi": 0.89, "homeStarterNrfi": 0.89,
            "awayStarterNrfiStarts": 0, "homeStarterNrfiStarts": 0,
            "awayTeamInn1Rate": 0.27, "homeTeamInn1Rate": 0.27,
            "parkFactor": 1.0,
            "awayStarterHand": m.get("awayStarterHand"),
            "homeStarterHand": m.get("homeStarterHand"),
        }
