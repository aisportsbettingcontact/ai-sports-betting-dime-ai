"""AsOfFeatureStore — Phase 5 walk-forward replay shared feature interface.

Binding spec: docs/audits/mlb-model-audit-2026/REPLAY-PROTOCOL.md.
This module is the ONLY feature source for the three replay components
(project_game driver, props driver, NRFI driver). It builds every feature
strictly as-of each game's first pitch (`mlb_schedule_history.startTimeUtc`).

As-of discipline (leakage checklist implementation)
---------------------------------------------------
* Cutoff = first pitch. "Strictly before" is enforced with a *prior-calendar-day*
  rule for game outcomes (`gameDate < cutoff gameDate`): a same-day day game
  elsewhere may not be final by the evening first pitch, so same-day results are
  excluded everywhere (teams, pitcher logs, linescores). Odds snapshots
  (`odds_history.scrapedAt`) are timestamped captures and are filtered by the
  exact cutoff millisecond instead.
* Starters & lineups: the ACTUAL starters/lineups (StatsAPI boxscore, stored in
  `mlb_replay_linescores`; direct cached StatsAPI boxscore fetch when the
  background substrate job has not reached the game yet) — pregame-legitimate
  per the protocol (announced by first pitch).
* Pitcher features: 2026 per-start data rebuilt from `mlb_replay_linescores`
  (starter Ks / outs preferred where present) merged with cached StatsAPI
  people game logs (IP/ER/BB/HR/H components); 2025-season StatsAPI stats act
  as the prior. Eligibility mirrors the live pipeline's seed gate
  (GS >= 1 AND IP >= 10, see server/seedPitcherStats.ts): below the gate the
  live model fell back to its frozen 2025 registry, so the replay uses the pure
  2025 season stats there. Above the gate, the live 70/30 season/rolling-5
  blend (server/mlbModelRunner.ts blendWithRolling, MIN_ROLLING_STARTS=3) is
  applied to the as-of 2026 aggregates.
* Team features: run environment as-of from cumulative `mlb_schedule_history`
  scores; batting K-rate as-of from the starter-K substrate (opposing-starter
  Ks per 27 opposing-starter outs, expressed on the current splits table's
  K/AB*27 basis through the league anchor 6.78 — the same-basis constant from
  server/kPropsDbHelpers.ts); hand-split adjustment = the STATIC ratio between
  the current `mlb_team_batting_splits` L/R rows applied to an as-of overall
  level (documented approximation — no historical split snapshots exist).
  Slash-line overall levels come from the frozen 2025 base (TEAM_STATS_2025,
  copied verbatim from server/mlbModelRunner.ts) because no as-of substrate
  exists for them; this is 2025-prior-dominated by construction.
* Park: `mlb_park_factors.parkFactor3yr` / `hrFactor` (2024-2025-weighted).
* Umpire: `mlb_lineups.umpire` (name cleaned) -> `mlb_umpire_modifiers`
  (2024-2025 seeded); neutral 1.0 otherwise.
* Bullpen: None always (protocol: live bullpen inputs are dead code).
* Weather: `mlb_lineups.weather*` where a pregame sheet exists, parsed with the
  same rules as server/mlbModelRunner.ts (dome -> None); None when no sheet.
* Lines: games row book columns -> last pre-cutoff `odds_history` snapshot ->
  `mlb_schedule_history` DK pregame columns -> the live runner's defaults.
* Lineup Statcast: `mlb_players.iso/barrelPct/hardHitPct` are a CURRENT
  snapshot (would leak end-of-July values into March games), so
  away/home_lineup_statcast are always None and the per-player lineup arrays
  carry league-average Statcast with the real (static, biographical) bat hand.
  Documented protocol difference; mirrors the live "no Statcast data" fallback.
* Outcomes never feed their own projection: every query in this module either
  filters `gameDate < cutoff date` or reads pre-season/static reference rows.

StatsAPI responses are cached as JSON in the cache dir keyed by URL hash so
reruns are cheap; season-long resources cover every cutoff <= today and are
filtered per cutoff after load.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

import pymysql

# ─────────────────────────────────────────────────────────────────────────────
# Frozen constants (copied from the live pipeline — sources annotated)
# ─────────────────────────────────────────────────────────────────────────────

# server/mlbModelRunner.ts TEAM_STATS_2025 (frozen 2025 season base, verbatim)
TEAM_STATS_2025 = {
    "NYY": {"rpg": 5.01, "era": 3.88, "avg": 0.260, "obp": 0.332, "slg": 0.445, "k9": 9.4, "bb9": 2.9, "whip": 1.20, "ip_per_game": 5.6},
    "SF":  {"rpg": 4.52, "era": 4.12, "avg": 0.251, "obp": 0.320, "slg": 0.415, "k9": 9.1, "bb9": 3.1, "whip": 1.27, "ip_per_game": 5.3},
    "ATH": {"rpg": 4.21, "era": 4.38, "avg": 0.244, "obp": 0.312, "slg": 0.395, "k9": 8.8, "bb9": 3.3, "whip": 1.30, "ip_per_game": 5.1},
    "TOR": {"rpg": 4.68, "era": 4.05, "avg": 0.255, "obp": 0.325, "slg": 0.422, "k9": 9.2, "bb9": 3.0, "whip": 1.25, "ip_per_game": 5.4},
    "COL": {"rpg": 5.18, "era": 5.42, "avg": 0.271, "obp": 0.340, "slg": 0.458, "k9": 8.2, "bb9": 3.6, "whip": 1.42, "ip_per_game": 4.8},
    "MIA": {"rpg": 3.89, "era": 4.28, "avg": 0.238, "obp": 0.305, "slg": 0.378, "k9": 9.0, "bb9": 3.2, "whip": 1.29, "ip_per_game": 5.2},
    "KC":  {"rpg": 4.55, "era": 4.15, "avg": 0.252, "obp": 0.320, "slg": 0.410, "k9": 8.9, "bb9": 3.1, "whip": 1.28, "ip_per_game": 5.2},
    "ATL": {"rpg": 5.08, "era": 3.78, "avg": 0.263, "obp": 0.335, "slg": 0.448, "k9": 9.6, "bb9": 2.8, "whip": 1.19, "ip_per_game": 5.6},
    "LAA": {"rpg": 4.18, "era": 4.48, "avg": 0.243, "obp": 0.310, "slg": 0.392, "k9": 8.7, "bb9": 3.4, "whip": 1.33, "ip_per_game": 5.0},
    "HOU": {"rpg": 4.71, "era": 3.82, "avg": 0.254, "obp": 0.323, "slg": 0.425, "k9": 9.5, "bb9": 2.9, "whip": 1.21, "ip_per_game": 5.5},
    "DET": {"rpg": 4.62, "era": 3.98, "avg": 0.251, "obp": 0.319, "slg": 0.416, "k9": 9.1, "bb9": 3.1, "whip": 1.26, "ip_per_game": 5.3},
    "SD":  {"rpg": 4.38, "era": 4.15, "avg": 0.246, "obp": 0.314, "slg": 0.399, "k9": 9.0, "bb9": 3.2, "whip": 1.28, "ip_per_game": 5.2},
    "CLE": {"rpg": 4.35, "era": 3.88, "avg": 0.247, "obp": 0.315, "slg": 0.398, "k9": 9.3, "bb9": 2.9, "whip": 1.22, "ip_per_game": 5.5},
    "SEA": {"rpg": 4.48, "era": 3.95, "avg": 0.249, "obp": 0.318, "slg": 0.408, "k9": 9.2, "bb9": 3.0, "whip": 1.24, "ip_per_game": 5.4},
    "ARI": {"rpg": 4.61, "era": 4.05, "avg": 0.252, "obp": 0.321, "slg": 0.418, "k9": 9.1, "bb9": 3.1, "whip": 1.26, "ip_per_game": 5.3},
    "LAD": {"rpg": 5.12, "era": 3.65, "avg": 0.265, "obp": 0.338, "slg": 0.452, "k9": 9.7, "bb9": 2.8, "whip": 1.18, "ip_per_game": 5.7},
    "BOS": {"rpg": 4.88, "era": 4.02, "avg": 0.258, "obp": 0.328, "slg": 0.432, "k9": 9.3, "bb9": 3.0, "whip": 1.23, "ip_per_game": 5.4},
    "BAL": {"rpg": 4.72, "era": 3.92, "avg": 0.255, "obp": 0.322, "slg": 0.425, "k9": 9.1, "bb9": 2.9, "whip": 1.22, "ip_per_game": 5.5},
    "TB":  {"rpg": 4.41, "era": 3.98, "avg": 0.248, "obp": 0.316, "slg": 0.405, "k9": 9.2, "bb9": 3.0, "whip": 1.24, "ip_per_game": 5.3},
    "MIN": {"rpg": 4.55, "era": 4.08, "avg": 0.252, "obp": 0.320, "slg": 0.415, "k9": 9.0, "bb9": 3.1, "whip": 1.26, "ip_per_game": 5.3},
    "CWS": {"rpg": 3.82, "era": 4.98, "avg": 0.235, "obp": 0.298, "slg": 0.375, "k9": 8.5, "bb9": 3.5, "whip": 1.38, "ip_per_game": 4.9},
    "CHC": {"rpg": 4.42, "era": 4.18, "avg": 0.248, "obp": 0.318, "slg": 0.408, "k9": 9.0, "bb9": 3.1, "whip": 1.27, "ip_per_game": 5.2},
    "CIN": {"rpg": 4.58, "era": 4.32, "avg": 0.251, "obp": 0.320, "slg": 0.415, "k9": 9.1, "bb9": 3.2, "whip": 1.28, "ip_per_game": 5.2},
    "MIL": {"rpg": 4.62, "era": 3.95, "avg": 0.252, "obp": 0.320, "slg": 0.418, "k9": 9.2, "bb9": 3.0, "whip": 1.24, "ip_per_game": 5.4},
    "PIT": {"rpg": 4.28, "era": 4.12, "avg": 0.245, "obp": 0.312, "slg": 0.398, "k9": 8.9, "bb9": 3.2, "whip": 1.28, "ip_per_game": 5.2},
    "STL": {"rpg": 4.38, "era": 4.05, "avg": 0.248, "obp": 0.318, "slg": 0.405, "k9": 9.0, "bb9": 3.1, "whip": 1.26, "ip_per_game": 5.3},
    "WSH": {"rpg": 4.12, "era": 4.42, "avg": 0.242, "obp": 0.308, "slg": 0.392, "k9": 8.8, "bb9": 3.3, "whip": 1.30, "ip_per_game": 5.1},
    "NYM": {"rpg": 4.62, "era": 4.02, "avg": 0.252, "obp": 0.322, "slg": 0.418, "k9": 9.1, "bb9": 3.0, "whip": 1.25, "ip_per_game": 5.4},
    "PHI": {"rpg": 4.88, "era": 3.88, "avg": 0.258, "obp": 0.328, "slg": 0.438, "k9": 9.4, "bb9": 2.9, "whip": 1.21, "ip_per_game": 5.5},
    "TEX": {"rpg": 4.52, "era": 4.15, "avg": 0.250, "obp": 0.318, "slg": 0.412, "k9": 9.0, "bb9": 3.1, "whip": 1.27, "ip_per_game": 5.3},
    "OAK": {"rpg": 4.21, "era": 4.38, "avg": 0.244, "obp": 0.312, "slg": 0.395, "k9": 8.8, "bb9": 3.3, "whip": 1.30, "ip_per_game": 5.1},
}
LEAGUE_TEAM_BASE = {"rpg": 4.50, "era": 4.20, "avg": 0.250, "obp": 0.318, "slg": 0.410,
                    "k9": 9.0, "bb9": 3.1, "whip": 1.26, "ip_per_game": 5.30}

# server/mlbModelRunner.ts DEFAULT_PITCHER_STATS (league-avg last resort)
DEFAULT_PITCHER_STATS = {"era": 4.25, "k9": 8.8, "bb9": 3.1, "hr9": 1.28,
                         "whip": 1.28, "ip": 140.0, "gp": 25, "xera": 4.25}

SEASON_W, ROLLING_W = 0.70, 0.30          # live blend weights (mlbModelRunner.ts)
MIN_ROLLING_STARTS = 3                    # live rolling-5 blend gate
ELIG_MIN_GS, ELIG_MIN_IP = 1, 10.0        # live seedPitcherStats.ts gate
FIP_CONSTANT = 3.15                       # standard cFIP; used for as-of FIP builds
LEAGUE_XFIP = 4.10                        # mlbKPropsModelService.ts
STARTER_IP_MEAN = 5.2                     # task-specified live starter IP mean
K_SPLITS_BASIS_ANCHOR = 6.78              # kPropsDbHelpers.ts LEAGUE_MEAN_TEAM_K9_FALLBACK (K/AB*27 basis)
LEAGUE_WOBA_SPLITS = 0.312                # mlbModelRunner.ts splits woba fallback
LEAGUE_OBP_2025 = 0.3174                  # MLBAIModel.py LEAGUE_OBP
SPLIT_DEFAULTS = {"avg": 0.250, "obp": 0.318, "slg": 0.410, "woba": 0.312,
                  "hr9": 1.0, "bb9": 3.1, "k9": 9.0}   # mlbModelRunner.ts splits fallbacks
LEAGUE_HR_PER_AB = 0.032                  # 2025 MLB league HR/AB (documented anchor)
HR_PRIOR_AB = 120                         # shrinkage pseudo-ABs toward the 2025 batter rate
LEAGUE_PITCHER_NRFI_PRIOR = 0.8899        # MLBAIModel.py LEAGUE_NRFI_PRIOR
NRFI_SHRINKAGE_K = 10                     # MLBAIModel.py NRFI_SHRINKAGE_K
TEAM_NRFI_LEAGUE_MEAN = 0.5150            # MLBAIModel.py (game-level)
LEAGUE_TEAM_I1_SCORE_RATE = 1 - math.sqrt(TEAM_NRFI_LEAGUE_MEAN)  # ≈0.282 per team-half
# buildLineupOrder league Statcast averages (mlbModelRunner.ts)
LEAGUE_BARREL, LEAGUE_ISO, LEAGUE_HARDHIT = 8.3, 0.150, 37.5

STATSAPI = "https://statsapi.mlb.com"
_CENSUS_CSV = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "..", "..", "census", "game-universe.csv")


# ─────────────────────────────────────────────────────────────────────────────
# small parsing helpers (mirrors of the TS runner's parsers)
# ─────────────────────────────────────────────────────────────────────────────

def parse_ip(val):
    """MLB '162.1' innings notation -> decimal (thirds)."""
    if val in (None, ""):
        return None
    parts = str(val).split(".")
    try:
        whole = int(parts[0] or 0)
        frac = int(parts[1]) if len(parts) > 1 and parts[1] else 0
    except ValueError:
        return None
    return whole + frac / 3.0


def parse_odds(val, default):
    if val is None:
        return default
    t = str(val).strip().upper()
    if t in ("EVEN", "EV", "PK"):
        return 100.0
    try:
        return float(t.replace("+", ""))
    except ValueError:
        return default


def parse_num(val):
    if val is None:
        return None
    try:
        f = float(str(val).replace("+", ""))
        return f
    except ValueError:
        return None


def parse_weather_temp(raw):
    """mlbModelRunner.parseWeatherTemp mirror."""
    if not raw:
        return 72.0
    cleaned = re.sub(r"[FC]", "", str(raw).replace("°", ""), flags=re.I).strip()
    try:
        v = float(cleaned)
    except ValueError:
        return 72.0
    return v if 20 <= v <= 120 else 72.0


def parse_weather_wind(raw):
    """mlbModelRunner.parseWeatherWind mirror -> (speed_mph, dir)."""
    if not raw:
        return 0.0, "calm"
    lower = str(raw).lower().strip()
    if lower == "calm" or lower == "0" or lower.startswith("calm"):
        return 0.0, "calm"
    m = re.search(r"(\d+(?:\.\d+)?)\s*mph", lower)
    speed = float(m.group(1)) if m else 0.0
    # direction classification mirrors mlbModelRunner.parseWeatherWind EXACTLY
    # (e.g. "11 mph Out" matches none of the live patterns -> "unknown")
    d = "unknown"
    if any(s in lower for s in ("out to", "out from", "out cf", "out lf", "out rf", "blowing out")):
        d = "out"
    elif any(s in lower for s in ("in from", "in to", "in cf", "in lf", "in rf", "blowing in")):
        d = "in"
    elif any(s in lower for s in ("l to r", "left to right", "r to l", "right to left")):
        d = "cross"
    elif speed < 3:
        d = "calm"
    return speed, d


def clean_umpire_name(raw):
    """Strip 'Umpire:' prefixes, nbsp junk, and trailing 'X.X R/G  Y.Y K/G' stats."""
    if not raw:
        return None
    s = str(raw).replace(" ", " ").replace("\n", " ")
    s = re.sub(r"(?i)^\s*umpire:?\s*", "", s)
    s = re.sub(r"\s*\d+(\.\d+)?\s*[RK]/G.*$", "", s).strip()
    s = re.sub(r"\s{2,}", " ", s)
    return s or None


def _iso_to_ms(iso_str):
    s = str(iso_str).replace("Z", "+00:00")
    return int(datetime.fromisoformat(s).timestamp() * 1000)


# ─────────────────────────────────────────────────────────────────────────────
# AsOfFeatureStore
# ─────────────────────────────────────────────────────────────────────────────

class AsOfFeatureStore:
    """Shared as-of feature interface for the Phase 5 replay components."""

    def __init__(self, cache_dir: str):
        self.cache_dir = cache_dir
        os.makedirs(cache_dir, exist_ok=True)
        url = os.environ.get("DATABASE_URL")
        if not url:
            raise RuntimeError("DATABASE_URL not set")
        u = urllib.parse.urlsplit(url)
        self._conn = pymysql.connect(
            host=u.hostname, port=u.port or 3306,
            user=urllib.parse.unquote(u.username or ""),
            password=urllib.parse.unquote(u.password or ""),
            database=u.path.lstrip("/").split("?")[0],
            ssl={"ssl": {}}, cursorclass=pymysql.cursors.DictCursor,
            autocommit=True, charset="utf8mb4",
        )
        self._memo = {}          # generic per-instance memo cache
        self._census = None      # gamesId -> census row

    # ── infrastructure ──────────────────────────────────────────────────────

    def _q(self, sql, params=()):
        with self._conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()

    def _api(self, path_and_query):
        """Cached StatsAPI GET. Cache key = sha256(url). Reads-through on miss."""
        url = STATSAPI + path_and_query
        key = hashlib.sha256(url.encode()).hexdigest()
        fp = os.path.join(self.cache_dir, key + ".json")
        if os.path.exists(fp):
            with open(fp) as f:
                return json.load(f)
        last_err = None
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "dime-replay-audit/1.0"})
                with urllib.request.urlopen(req, timeout=30) as r:
                    data = json.load(r)
                tmp = fp + ".tmp"
                with open(tmp, "w") as f:
                    json.dump(data, f)
                os.replace(tmp, fp)
                return data
            except Exception as e:  # noqa: BLE001 — retry then surface
                last_err = e
                time.sleep(1.5 * (attempt + 1))
        raise RuntimeError(f"StatsAPI fetch failed for {url}: {last_err}")

    def _memoized(self, key, fn):
        if key not in self._memo:
            self._memo[key] = fn()
        return self._memo[key]

    # ── linkage / meta ──────────────────────────────────────────────────────

    def _census_map(self):
        if self._census is None:
            self._census = {}
            try:
                with open(os.path.normpath(_CENSUS_CSV)) as f:
                    lines = f.read().strip().split("\n")
                cols = lines[0].split(",")
                for line in lines[1:]:
                    parts = line.split(",")
                    row = dict(zip(cols, parts))
                    if row.get("gamesId"):
                        self._census[int(row["gamesId"])] = row
            except FileNotFoundError:
                pass  # DB fallback below handles linkage
        return self._census

    def _games_row(self, game_id):
        return self._memoized(("games", game_id), lambda: (self._q(
            "SELECT * FROM games WHERE id=%s", (game_id,)) or [None])[0])

    def _schedule_row(self, game_id):
        """mlb_schedule_history row for a games.id (census link, DB fallback)."""
        def load():
            g = self._games_row(game_id)
            if g is None:
                raise ValueError(f"games row {game_id} not found")
            census = self._census_map().get(game_id)
            if census:
                rows = self._q("SELECT * FROM mlb_schedule_history WHERE anGameId=%s",
                               (int(census["anGameId"]),))
                if rows:
                    return rows[0]
            # fallback: match by date+teams, ordered by start time, pick gameNumber-th
            rows = self._q(
                "SELECT * FROM mlb_schedule_history WHERE gameDate=%s AND awayAbbr=%s "
                "AND homeAbbr=%s ORDER BY startTimeUtc",
                (g["gameDate"], g["awayTeam"], g["homeTeam"]))
            if not rows:
                raise ValueError(f"no mlb_schedule_history row for game {game_id}")
            idx = max(0, int(g.get("gameNumber") or 1) - 1)
            return rows[min(idx, len(rows) - 1)]
        return self._memoized(("sched", game_id), load)

    def _linescore_row(self, game_pk):
        return self._memoized(("ls", game_pk), lambda: (self._q(
            "SELECT * FROM mlb_replay_linescores WHERE gamePk=%s", (game_pk,)) or [None])[0])

    def _person(self, mlbam_id):
        def load():
            d = self._api(f"/api/v1/people/{mlbam_id}")
            p = (d.get("people") or [{}])[0]
            return {
                "fullName": p.get("fullName"),
                "pitchHand": (p.get("pitchHand") or {}).get("code"),
                "batSide": (p.get("batSide") or {}).get("code"),
            }
        return self._memoized(("person", mlbam_id), load)

    def _boxscore_starters_lineups(self, game_pk):
        """Fallback when mlb_replay_linescores has not been populated for a game.

        Uses the StatsAPI boxscore (the same source the substrate job stores) —
        protocol-legitimate as the actual starters/lineups.
        """
        def load():
            d = self._api(f"/api/v1/game/{game_pk}/boxscore")
            out = {}
            for side in ("away", "home"):
                t = (d.get("teams") or {}).get(side) or {}
                pitchers = t.get("pitchers") or []
                starter = pitchers[0] if pitchers else None
                lineup = []
                for pdata in (t.get("players") or {}).values():
                    bo = pdata.get("battingOrder")
                    if bo and str(bo).endswith("00"):
                        lineup.append((int(bo), (pdata.get("person") or {}).get("id")))
                lineup.sort()
                out[side] = {"starter": starter,
                             "lineup": [pid for _, pid in lineup if pid]}
            return out
        return self._memoized(("box", game_pk), load)

    def game_meta(self, game_id: int) -> dict:
        g = self._games_row(game_id)
        if g is None:
            raise ValueError(f"games row {game_id} not found")
        sched = self._schedule_row(game_id)
        start_ms = _iso_to_ms(sched["startTimeUtc"])
        game_pk = g.get("mlbGamePk")
        ls = self._linescore_row(game_pk) if game_pk else None
        if ls is not None:
            away_sp, home_sp = ls["awayStarterId"], ls["homeStarterId"]
            away_hand, home_hand = ls["awayStarterHand"], ls["homeStarterHand"]
            lineup_away = json.loads(ls["awayLineup"]) if ls.get("awayLineup") else []
            lineup_home = json.loads(ls["homeLineup"]) if ls.get("homeLineup") else []
        else:
            # substrate still populating — tolerate and pull the boxscore directly
            if not game_pk:
                raise ValueError(
                    f"game {game_id}: no mlbGamePk and no mlb_replay_linescores row — "
                    "cannot resolve actual starters/lineups")
            box = self._boxscore_starters_lineups(game_pk)
            away_sp, home_sp = box["away"]["starter"], box["home"]["starter"]
            away_hand = self._person(away_sp)["pitchHand"] if away_sp else None
            home_hand = self._person(home_sp)["pitchHand"] if home_sp else None
            lineup_away, lineup_home = box["away"]["lineup"], box["home"]["lineup"]
        return {
            "gameId": game_id,
            "gamePk": game_pk,
            "gameDate": g["gameDate"],
            "away": g["awayTeam"],
            "home": g["homeTeam"],
            "startUtcMs": start_ms,
            "awayStarterId": away_sp,
            "homeStarterId": home_sp,
            "awayStarterHand": away_hand or "R",
            "homeStarterHand": home_hand or "R",
            "lineupAway": lineup_away,
            "lineupHome": lineup_home,
        }

    def _cutoff_date(self, cutoff_ms):
        """Cutoff calendar date (ET) for the prior-day as-of rule.

        Both games.gameDate and mlb_schedule_history.gameDate are ET dates, so
        the cutoff date is derived in America/New_York (fixed -4/-5 handled by
        approximating with -5h then checking DST is irrelevant for MLB dates:
        the season runs Mar-Oct, always EDT (-4)). We use UTC-4.
        """
        return datetime.fromtimestamp(
            cutoff_ms / 1000.0 - 4 * 3600, tz=timezone.utc).strftime("%Y-%m-%d")

    # ── pitcher as-of ───────────────────────────────────────────────────────

    def _pitcher_log_2026(self, mlbam_id):
        def load():
            d = self._api(f"/api/v1/people/{mlbam_id}/stats?stats=gameLog&group=pitching&season=2026&gameType=R")
            stats = d.get("stats") or []
            return (stats[0].get("splits") or []) if stats else []
        return self._memoized(("plog26", mlbam_id), load)

    def _pitcher_season_2025(self, mlbam_id):
        def load():
            d = self._api(f"/api/v1/people/{mlbam_id}/stats?stats=season&group=pitching&season=2025")
            stats = d.get("stats") or []
            splits = (stats[0].get("splits") or []) if stats else []
            if not splits:
                return None
            st = splits[0].get("stat") or {}
            ip = parse_ip(st.get("inningsPitched"))
            if not ip or ip <= 0:
                return None
            gs = int(st.get("gamesStarted") or 0)
            k = int(st.get("strikeOuts") or 0)
            bb = int(st.get("baseOnBalls") or 0)
            hr = int(st.get("homeRuns") or 0)
            er = int(st.get("earnedRuns") or 0)
            h = int(st.get("hits") or 0)
            return {
                "k9": 9.0 * k / ip, "bb9": 9.0 * bb / ip, "hr9": 9.0 * hr / ip,
                "era": 9.0 * er / ip, "whip": (bb + h) / ip,
                "ip_per_start": (ip / gs) if gs > 0 else None,
                "fip": (13.0 * hr + 3.0 * bb - 2.0 * k) / ip + FIP_CONSTANT,
                "ip": ip, "starts": gs,
            }
        return self._memoized(("p2025", mlbam_id), load)

    def _pitcher_starts_asof(self, mlbam_id, cutoff_date):
        """2026 per-appearance rows strictly before the cutoff date.

        StatsAPI game log supplies IP/ER/BB/HR/H; `mlb_replay_linescores`
        (protocol substrate) overrides K and outs for starts where present.
        """
        log = self._pitcher_log_2026(mlbam_id)
        rows = []
        pks = []
        for s in log:
            if (s.get("date") or "9999") >= cutoff_date:
                continue  # strictly-prior-day rule
            st = s.get("stat") or {}
            ip = parse_ip(st.get("inningsPitched")) or 0.0
            rows.append({
                "date": s.get("date"),
                "gamePk": (s.get("game") or {}).get("gamePk"),
                "is_start": int(st.get("gamesStarted") or 0) >= 1,
                "outs": round(ip * 3),
                "k": int(st.get("strikeOuts") or 0),
                "bb": int(st.get("baseOnBalls") or 0),
                "hr": int(st.get("homeRuns") or 0),
                "er": int(st.get("earnedRuns") or 0),
                "h": int(st.get("hits") or 0),
            })
            if rows[-1]["gamePk"]:
                pks.append(rows[-1]["gamePk"])
        if pks:
            fmt = ",".join(["%s"] * len(pks))
            ls = self._q(
                f"SELECT gamePk, awayStarterId, homeStarterId, awayStarterKs, "
                f"awayStarterOuts, homeStarterKs, homeStarterOuts "
                f"FROM mlb_replay_linescores WHERE gamePk IN ({fmt})", tuple(pks))
            by_pk = {r["gamePk"]: r for r in ls}
            for row in rows:
                r = by_pk.get(row["gamePk"])
                if not r:
                    continue  # substrate gap tolerated — game log values stand
                if r["awayStarterId"] == mlbam_id:
                    if r["awayStarterKs"] is not None:
                        row["k"] = int(r["awayStarterKs"])
                    if r["awayStarterOuts"] is not None:
                        row["outs"] = int(r["awayStarterOuts"])
                elif r["homeStarterId"] == mlbam_id:
                    if r["homeStarterKs"] is not None:
                        row["k"] = int(r["homeStarterKs"])
                    if r["homeStarterOuts"] is not None:
                        row["outs"] = int(r["homeStarterOuts"])
        rows.sort(key=lambda r: r["date"] or "")
        return rows

    @staticmethod
    def _agg(rows):
        outs = sum(r["outs"] for r in rows)
        ip = outs / 3.0
        if ip <= 0:
            return None
        k = sum(r["k"] for r in rows)
        bb = sum(r["bb"] for r in rows)
        hr = sum(r["hr"] for r in rows)
        er = sum(r["er"] for r in rows)
        h = sum(r["h"] for r in rows)
        starts = [r for r in rows if r["is_start"]]
        start_outs = sum(r["outs"] for r in starts)
        return {
            "k9": 9.0 * k / ip, "bb9": 9.0 * bb / ip, "hr9": 9.0 * hr / ip,
            "era": 9.0 * er / ip, "whip": (bb + h) / ip,
            "ip_per_start": (start_outs / 3.0 / len(starts)) if starts else None,
            "fip": (13.0 * hr + 3.0 * bb - 2.0 * k) / ip + FIP_CONSTANT,
            "ip": ip, "starts": len(starts),
        }

    def pitcher_asof(self, mlbam_id: int, cutoff_ms: int) -> dict:
        """Blended as-of pitcher rates at the cutoff.

        Top-level k9/bb9/hr9/era/whip/fip are the value the live pipeline would
        have believed at first pitch: 2026-as-of season stats blended 70/30
        with the as-of rolling-5 when eligible (GS>=1, IP>=10, rolling>=3
        starts), else the pure 2025-season prior (frozen-registry analog),
        else league defaults. ip_per_start follows the task rule: as-of mean
        outs/3 of 2026 starts -> 2025 IP/GS -> STARTER_IP_MEAN (5.2).
        """
        cutoff_date = self._cutoff_date(cutoff_ms)
        key = ("pasof", mlbam_id, cutoff_date)
        if key in self._memo:
            return self._memo[key]
        rows = self._pitcher_starts_asof(mlbam_id, cutoff_date)
        season26 = self._agg(rows)
        starts26 = season26["starts"] if season26 else 0
        ip26 = season26["ip"] if season26 else 0.0
        start_rows = [r for r in rows if r["is_start"]]
        r5 = self._agg(start_rows[-5:]) if start_rows else None
        season25 = self._pitcher_season_2025(mlbam_id)

        eligible = season26 is not None and starts26 >= ELIG_MIN_GS and ip26 >= ELIG_MIN_IP
        if eligible:
            base, source = dict(season26), "2026-asof"
            if r5 and r5["starts"] >= MIN_ROLLING_STARTS:
                blended = {stat: SEASON_W * base[stat] + ROLLING_W * r5[stat]
                           for stat in ("era", "k9", "bb9", "hr9", "whip", "fip")}
                base.update(blended)
                source = "2026-asof+rolling5"
        elif season25 is not None:
            base, source = dict(season25), "2025-prior"
        else:
            d = DEFAULT_PITCHER_STATS
            base = {"k9": d["k9"], "bb9": d["bb9"], "hr9": d["hr9"], "era": d["era"],
                    "whip": d["whip"], "ip_per_start": None, "fip": d["era"],
                    "ip": d["ip"], "starts": d["gp"]}
            source = "league-default"

        # ip_expected rule (task-specified): 2026 as-of mean -> 2025 -> 5.2
        ip_per_start = None
        if season26 and season26["ip_per_start"]:
            ip_per_start = season26["ip_per_start"]
        elif season25 and season25["ip_per_start"]:
            ip_per_start = season25["ip_per_start"]
        else:
            ip_per_start = STARTER_IP_MEAN

        out = {
            "k9": base["k9"], "bb9": base["bb9"], "hr9": base["hr9"],
            "era": base["era"], "whip": base["whip"],
            "ip_per_start": ip_per_start, "fip": base["fip"],
            "starts_2026": starts26,
            "ip_2026": round(ip26, 2),
            "eligible_2026": eligible,
            "source": source,
            "rolling5": ({"k9": r5["k9"], "bb9": r5["bb9"], "hr9": r5["hr9"],
                          "era": r5["era"], "whip": r5["whip"],
                          "ip_per_start": r5["ip_per_start"], "fip": r5["fip"],
                          "starts": r5["starts"]} if r5 else None),
            "season2025": ({"k9": season25["k9"], "bb9": season25["bb9"],
                            "hr9": season25["hr9"], "era": season25["era"],
                            "whip": season25["whip"],
                            "ip_per_start": season25["ip_per_start"],
                            "fip": season25["fip"], "starts": season25["starts"],
                            "ip": season25["ip"]} if season25 else None),
            "season2026_asof": season26,
        }
        self._memo[key] = out
        return out

    # ── team as-of ──────────────────────────────────────────────────────────

    def _splits_table(self):
        def load():
            rows = self._q("SELECT teamAbbrev, hand, avg, obp, slg, woba, hr9, bb9, k9, "
                           "atBats, rpg, ipPerGame FROM mlb_team_batting_splits")
            table = {}
            for r in rows:
                team = r["teamAbbrev"].upper()
                table.setdefault(team, {})[r["hand"].upper()] = r
            return table
        return self._memoized(("splits",), load)

    @staticmethod
    def _split_ratio(entry, stat, hand):
        """Static L/R shape ratio: split[hand].stat / AB-weighted overall."""
        left, right = entry.get("L"), entry.get("R")
        if not left or not right:
            return 1.0
        lv, rv = left.get(stat), right.get(stat)
        if lv is None or rv is None:
            return 1.0
        ab_l = left.get("atBats") or 1
        ab_r = right.get("atBats") or 1
        overall = (lv * ab_l + rv * ab_r) / (ab_l + ab_r)
        if overall <= 0:
            return 1.0
        hv = lv if hand == "L" else rv
        return hv / overall

    def _substrate_rows(self, cutoff_date):
        """linescores joined to games (team labels), strictly before cutoff date."""
        season_start = cutoff_date[:4] + "-01-01"
        def load():
            return self._q(
                "SELECT l.gameDate, l.inn1AwayRuns, l.inn1HomeRuns, "
                "l.awayStarterKs, l.awayStarterOuts, l.homeStarterKs, l.homeStarterOuts, "
                "g.awayTeam, g.homeTeam "
                "FROM mlb_replay_linescores l JOIN games g ON g.id = l.gameId "
                "WHERE l.gameDate < %s AND l.gameDate >= %s", (cutoff_date, season_start))
        return self._memoized(("substrate", cutoff_date), load)

    def _team_k_substrate(self, cutoff_date):
        """As-of batting-K factors from the starter-K substrate.

        For each team: Ks recorded by OPPOSING starters against the team's
        batters, per 27 opposing-starter outs, before the cutoff. Returned as
        {team: rate}, plus the league mean rate. Factor = team/league.
        """
        def load():
            acc = {}
            for r in self._substrate_rows(cutoff_date):
                # away team bats vs HOME starter
                if r["homeStarterKs"] is not None and r["homeStarterOuts"]:
                    a = acc.setdefault(r["awayTeam"], [0, 0])
                    a[0] += r["homeStarterKs"]
                    a[1] += r["homeStarterOuts"]
                # home team bats vs AWAY starter
                if r["awayStarterKs"] is not None and r["awayStarterOuts"]:
                    a = acc.setdefault(r["homeTeam"], [0, 0])
                    a[0] += r["awayStarterKs"]
                    a[1] += r["awayStarterOuts"]
            rates = {t: 27.0 * k / outs for t, (k, outs) in acc.items() if outs > 0}
            league = (sum(rates.values()) / len(rates)) if rates else None
            return rates, league
        return self._memoized(("ksub", cutoff_date), load)

    def _team_schedule_asof(self, abbrev, cutoff_date):
        """Cumulative 2026 completed-game scores strictly before the cutoff date.

        mlb_schedule_history also holds prior-season rows, so the window is
        bounded to the cutoff's season — the pre-season fallback must be the
        frozen 2025 base (what live believed), not raw 2025 schedule scores.
        """
        season_start = cutoff_date[:4] + "-01-01"
        def load():
            rows = self._q(
                "SELECT gameDate, awayAbbr, homeAbbr, awayScore, homeScore "
                "FROM mlb_schedule_history WHERE gameStatus='complete' "
                "AND game_type='regular_season' AND gameDate < %s AND gameDate >= %s "
                "AND (awayAbbr=%s OR homeAbbr=%s) AND awayScore IS NOT NULL "
                "AND homeScore IS NOT NULL", (cutoff_date, season_start, abbrev, abbrev))
            n = len(rows)
            runs = 0
            pitch_ip = 0.0
            for r in rows:
                home = r["homeAbbr"] == abbrev
                runs += r["homeScore"] if home else r["awayScore"]
                # pitching IP/game approximation (documented): home team always
                # records 9 defensive innings in regulation; away team records 8
                # when the home side wins (bottom 9th skipped / walk-off).
                if home:
                    pitch_ip += 9.0
                else:
                    pitch_ip += 9.0 if r["awayScore"] > r["homeScore"] else 8.0
            return {
                "games": n,
                "rpg": (runs / n) if n else None,
                "ip_per_game": (pitch_ip / n) if n else None,
            }
        return self._memoized(("tsched", abbrev, cutoff_date), load)

    def team_asof(self, abbrev: str, cutoff_ms: int, vs_hand: str) -> dict:
        """Team batting dict in the exact shape mlbModelRunner passes to Python.

        Base keys (rpg/era/avg/obp/slg/k9/bb9/whip/ip_per_game) + hand-split
        overrides (avg/obp/slg/woba/batting_k9/batting_bb9/batting_hr9/
        split_hand). Levels are as-of (schedule scores, starter-K substrate,
        2025 frozen base); the L/R SHAPE comes from the current splits table as
        a static ratio (documented protocol approximation).
        """
        abbrev = abbrev.upper()
        hand = "L" if str(vs_hand).upper().startswith("L") else "R"
        cutoff_date = self._cutoff_date(cutoff_ms)
        base = dict(TEAM_STATS_2025.get(abbrev, LEAGUE_TEAM_BASE))

        sched = self._team_schedule_asof(abbrev, cutoff_date)
        if sched["games"] >= 1:
            base["rpg"] = sched["rpg"]
            base["ip_per_game"] = sched["ip_per_game"]
        # else: opening slate — frozen 2025 base stands (what live believed)

        entry = self._splits_table().get(abbrev)
        if not entry or not entry.get("L") or not entry.get("R"):
            return base  # no splits rows — live passed the base dict unchanged

        r = lambda stat: self._split_ratio(entry, stat, hand)  # noqa: E731
        # as-of overall levels for slash stats = frozen 2025 base (no substrate)
        avg = base["avg"] * r("avg")
        obp = base["obp"] * r("obp")
        slg = base["slg"] * r("slg")
        woba = LEAGUE_WOBA_SPLITS * (base["obp"] / LEAGUE_OBP_2025) * r("woba")
        # batting K: as-of substrate level on the splits K/AB*27 basis
        rates, league = self._team_k_substrate(cutoff_date)
        k_factor = 1.0
        if league and abbrev in rates:
            k_factor = rates[abbrev] / league
        batting_k9 = K_SPLITS_BASIS_ANCHOR * k_factor * r("k9")
        # batting BB: league-anchored shape (no as-of substrate; documented)
        batting_bb9 = SPLIT_DEFAULTS["bb9"] * r("bb9")
        # batting HR: 2025 ISO-scaled league anchor with the hand shape
        iso_factor = max(0.05, base["slg"] - base["avg"]) / 0.160
        batting_hr9 = SPLIT_DEFAULTS["hr9"] * iso_factor * r("hr9")

        out = dict(base)
        out.update({
            "avg": avg, "obp": obp, "slg": slg, "woba": woba,
            "batting_k9": batting_k9, "batting_bb9": batting_bb9,
            "batting_hr9": batting_hr9,
            "split_hand": 1 if hand == "L" else 0,
        })
        return out

    # ── shared reference lookups ────────────────────────────────────────────

    def _park_row(self, home_abbrev):
        return self._memoized(("park", home_abbrev), lambda: (self._q(
            "SELECT parkFactor3yr, hrFactor FROM mlb_park_factors WHERE teamAbbrev=%s",
            (home_abbrev.upper(),)) or [None])[0])

    def _lineups_row(self, game_id):
        return self._memoized(("lineups", game_id), lambda: (self._q(
            "SELECT * FROM mlb_lineups WHERE gameId=%s", (game_id,)) or [None])[0])

    def _umpire_mods(self, game_id):
        row = self._lineups_row(game_id)
        name = clean_umpire_name(row["umpire"]) if row else None
        if not name:
            return 1.0, 1.0, "UNKNOWN (league-avg)"
        mods = self._q(
            "SELECT umpireName, kModifier, bbModifier FROM mlb_umpire_modifiers "
            "WHERE LOWER(umpireName)=LOWER(%s) LIMIT 1", (name,))
        if not mods:
            return 1.0, 1.0, name
        m = mods[0]
        return (float(m["kModifier"]) if m["kModifier"] is not None else 1.0,
                float(m["bbModifier"]) if m["bbModifier"] is not None else 1.0,
                m["umpireName"])

    def _weather(self, game_id):
        """Protocol rule: pregame sheet -> parsed dict (dome -> None); else None."""
        row = self._lineups_row(game_id)
        if row is None:
            return None
        if row.get("weatherDome"):
            return None
        speed, direction = parse_weather_wind(row.get("weatherWind"))
        return {"temp_f": parse_weather_temp(row.get("weatherTemp")),
                "wind_speed_mph": speed, "wind_dir": direction, "dome": False}

    def _nrfi_prior(self, mlbam_id):
        if mlbam_id is None:
            return None, None
        rows = self._q(
            "SELECT nrfiRate, nrfiStarts FROM mlb_pitcher_stats "
            "WHERE mlbamId=%s AND nrfiRate IS NOT NULL LIMIT 1", (mlbam_id,))
        if not rows:
            return None, None
        return (float(rows[0]["nrfiRate"]),
                int(rows[0]["nrfiStarts"]) if rows[0]["nrfiStarts"] is not None else None)

    def _bat_sides(self, mlbam_ids):
        """Static biographical bat side per id: mlb_players -> StatsAPI -> 'R'."""
        ids = [i for i in mlbam_ids if i]
        out = {}
        if ids:
            fmt = ",".join(["%s"] * len(ids))
            for r in self._q(f"SELECT mlbamId, bats FROM mlb_players WHERE mlbamId IN ({fmt})",
                             tuple(ids)):
                if r["bats"]:
                    out[r["mlbamId"]] = str(r["bats"])[0].upper()
        for i in ids:
            if i not in out:
                side = self._person(i).get("batSide")
                out[i] = side if side in ("L", "R", "S") else "R"
        return out

    def _book_lines(self, game_id, cutoff_ms):
        """book_lines dict in the live runner's exact shape, with the protocol
        fallback chain applied field-by-field:
        games row -> last pre-cutoff odds_history snapshot -> schedule DK
        pregame columns -> live defaults."""
        g = self._games_row(game_id)
        sched = self._schedule_row(game_id)
        snap_rows = self._q(
            "SELECT awaySpread, awaySpreadOdds, homeSpreadOdds, total, overOdds, "
            "underOdds, awayML, homeML FROM odds_history "
            "WHERE gameId=%s AND sport='MLB' AND scrapedAt < %s "
            "ORDER BY scrapedAt DESC LIMIT 1", (game_id, cutoff_ms))
        snap = snap_rows[0] if snap_rows else {}

        def pick(*vals):
            for v in vals:
                if v is not None and parse_num(v) is not None:
                    return v
            return None

        ml_away = pick(g.get("awayML"), snap.get("awayML"), sched.get("dkAwayML"))
        ml_home = pick(g.get("homeML"), snap.get("homeML"), sched.get("dkHomeML"))
        ou_line = pick(g.get("bookTotal"), snap.get("total"), sched.get("dkTotal"))
        over_odds = pick(g.get("overOdds"), snap.get("overOdds"), sched.get("dkOverOdds"))
        under_odds = pick(g.get("underOdds"), snap.get("underOdds"), sched.get("dkUnderOdds"))
        away_rl = pick(g.get("awayRunLine"), snap.get("awaySpread"), sched.get("dkAwayRunLine"))
        rl_away_odds = pick(g.get("awayRunLineOdds"), snap.get("awaySpreadOdds"),
                            sched.get("dkAwayRunLineOdds"))
        rl_home_odds = pick(g.get("homeRunLineOdds"), snap.get("homeSpreadOdds"),
                            sched.get("dkHomeRunLineOdds"))

        ml_away_v = parse_odds(ml_away, 100.0)
        # rl_home_spread: -awayRunLine when parseable, else ML-derived (live rule)
        away_rl_num = parse_num(away_rl)
        if away_rl_num is not None and away_rl_num != 0:
            rl_home_spread = -away_rl_num
        else:
            rl_home_spread = 1.5 if ml_away_v < 0 else -1.5
        return {
            "ml_away": ml_away_v,
            "ml_home": parse_odds(ml_home, -120.0),
            "ou_line": parse_num(ou_line) if parse_num(ou_line) is not None else 8.5,
            "over_odds": parse_odds(over_odds, -110.0),
            "under_odds": parse_odds(under_odds, -110.0),
            "rl_home_spread": rl_home_spread,
            "rl_home": parse_odds(rl_home_odds, -150.0),
            "rl_away": parse_odds(rl_away_odds, 130.0),
        }

    def _lineup_order(self, mlbam_ids):
        """Per-player batting order array (league-avg Statcast + real bat hand).

        Statcast levels are neutral by design (no as-of snapshot exists — see
        module docstring); bat hand is static biography, as-of safe.
        """
        if not mlbam_ids or len(mlbam_ids) < 7:
            return None
        sides = self._bat_sides(mlbam_ids[:9])
        return [{"barrel_rate": LEAGUE_BARREL, "iso": LEAGUE_ISO,
                 "hard_hit": LEAGUE_HARDHIT, "bats": sides.get(pid, "R")}
                for pid in mlbam_ids[:9]]

    # ── project_game kwargs ─────────────────────────────────────────────────

    def _pitcher_engine_dict(self, mlbam_id, hand, cutoff_ms):
        """Pitcher stats dict in the exact shape batchFetchPitcherStats emits."""
        p = self.pitcher_asof(mlbam_id, cutoff_ms)
        gp = p["starts_2026"] if p["eligible_2026"] else (
            (p["season2025"] or {}).get("starts") or DEFAULT_PITCHER_STATS["gp"])
        gp = max(1, int(gp or 1))
        ip_total = (p["ip_per_start"] or STARTER_IP_MEAN) * gp
        d = {
            "era": p["era"], "k9": p["k9"], "bb9": p["bb9"], "hr9": p["hr9"],
            "whip": p["whip"], "ip": ip_total, "gp": gp,
            "xera": DEFAULT_PITCHER_STATS["xera"],   # not consumed by the engine features
            "fip": p["fip"],
            "xfip": p["fip"],                         # as-of FIP proxy (no as-of xFIP exists)
            "fipMinus": 100, "eraMinus": 100, "war": 0,
            "throwsHand": 1 if hand == "L" else (2 if hand == "S" else 0),
            "throwsHandStr": 0,
        }
        r5 = p.get("rolling5")
        if p["eligible_2026"] and r5 and r5["starts"] >= MIN_ROLLING_STARTS:
            d.update({
                "rolling_starts": r5["starts"], "rolling_era": r5["era"],
                "rolling_k9": r5["k9"], "rolling_bb9": r5["bb9"],
                "rolling_whip": r5["whip"], "rolling_fip": r5["fip"],
            })
        return d

    def project_game_kwargs(self, game_id: int) -> dict:
        """Every kwarg for MLBAIModel.project_game, strictly as-of first pitch.

        `game_date` is a datetime (the signature's type); everything else is
        plain JSON-able data. Bullpens are None per protocol; lineup Statcast
        aggregates are None (documented); per-player order arrays carry real
        bat hands with league-neutral Statcast.
        """
        meta = self.game_meta(game_id)
        cutoff_ms = meta["startUtcMs"]
        away, home = meta["away"], meta["home"]
        away_hand, home_hand = meta["awayStarterHand"], meta["homeStarterHand"]

        park = self._park_row(home)
        park_factor = float(park["parkFactor3yr"]) if park and park["parkFactor3yr"] else 1.0
        k_mod, bb_mod, ump_name = self._umpire_mods(game_id)
        away_nrfi, away_nrfi_starts = self._nrfi_prior(meta["awayStarterId"])
        home_nrfi, home_nrfi_starts = self._nrfi_prior(meta["homeStarterId"])

        return {
            "away_abbrev": away,
            "home_abbrev": home,
            # away batters face the HOME starter's hand and vice versa
            "away_team_stats": self.team_asof(away, cutoff_ms, home_hand),
            "home_team_stats": self.team_asof(home, cutoff_ms, away_hand),
            "away_pitcher_stats": self._pitcher_engine_dict(meta["awayStarterId"], away_hand, cutoff_ms),
            "home_pitcher_stats": self._pitcher_engine_dict(meta["homeStarterId"], home_hand, cutoff_ms),
            "book_lines": self._book_lines(game_id, cutoff_ms),
            "game_date": datetime.strptime(meta["gameDate"], "%Y-%m-%d"),
            "weather": self._weather(game_id),
            "seed": 42,
            "verbose": False,
            "park_factor_3yr": park_factor,
            "away_bullpen": None,
            "home_bullpen": None,
            "umpire_k_mod": k_mod,
            "umpire_bb_mod": bb_mod,
            "umpire_name": ump_name,
            "mlb_game_pk": meta["gamePk"],
            "away_pitcher_nrfi": away_nrfi,
            "home_pitcher_nrfi": home_nrfi,
            "away_pitcher_nrfi_starts": away_nrfi_starts,
            "home_pitcher_nrfi_starts": home_nrfi_starts,
            "away_team_nrfi": None,   # Python auto-lookup (3yr constants) — live behavior
            "home_team_nrfi": None,
            "away_f5_rs": None,
            "home_f5_rs": None,
            "away_lineup_statcast": None,  # no as-of Statcast snapshot (documented)
            "home_lineup_statcast": None,
            "away_lineup_order": self._lineup_order(meta["lineupAway"]),
            "home_lineup_order": self._lineup_order(meta["lineupHome"]),
        }

    # ── K props inputs ──────────────────────────────────────────────────────

    def _team_split_k9_asof(self, abbrev, hand, cutoff_date):
        """Team batting K vs hand on the splits K/AB*27 basis, as-of level."""
        entry = self._splits_table().get(abbrev.upper())
        ratio = self._split_ratio(entry, "k9", hand) if entry else 1.0
        rates, league = self._team_k_substrate(cutoff_date)
        k_factor = 1.0
        if league and abbrev.upper() in rates:
            k_factor = rates[abbrev.upper()] / league
        return K_SPLITS_BASIS_ANCHOR * k_factor * ratio

    def _league_mean_k9_hand(self, hand, cutoff_date):
        """League mean of the same-basis as-of team K rate vs the given hand."""
        def load():
            splits = self._splits_table()
            rates, league = self._team_k_substrate(cutoff_date)
            vals = []
            for team, entry in splits.items():
                ratio = self._split_ratio(entry, "k9", hand)
                factor = (rates[team] / league) if (league and team in rates) else 1.0
                vals.append(K_SPLITS_BASIS_ANCHOR * factor * ratio)
            return (sum(vals) / len(vals)) if vals else K_SPLITS_BASIS_ANCHOR
        return self._memoized(("lgk9", hand, cutoff_date), load)

    def kprop_inputs(self, game_id: int, side: str) -> dict:
        """Inputs for the FIXED K-props formula (protocol: unit-consistent
        opp_adj, as-of expected IP — NOT the line-anchored heuristic)."""
        if side not in ("away", "home"):
            raise ValueError(f"side must be 'away'|'home', got {side!r}")
        meta = self.game_meta(game_id)
        cutoff_ms = meta["startUtcMs"]
        cutoff_date = self._cutoff_date(cutoff_ms)
        sp_id = meta[f"{side}StarterId"]
        hand = meta[f"{side}StarterHand"]
        opp = meta["home"] if side == "away" else meta["away"]
        p = self.pitcher_asof(sp_id, cutoff_ms)

        # xfip_adj uses the as-of component FIP as the xFIP proxy (documented:
        # no as-of xFIP snapshot exists); clamped exactly like the live service.
        fip = p.get("fip")
        xfip_adj = 1.0
        if fip and fip > 0:
            xfip_adj = min(max(LEAGUE_XFIP / fip, 0.70), 1.40)

        k_mod, _, _ = self._umpire_mods(game_id)

        # book line: only when the stored prop row is for THIS actual starter
        book_line = None
        rows = self._q(
            "SELECT pitcherName, mlbamId, bookLine FROM mlb_strikeout_props "
            "WHERE gameId=%s AND side=%s", (game_id, side))
        person = self._person(sp_id) if sp_id else {}
        actual_name = (person.get("fullName") or "").lower()
        for row in rows:
            if row["bookLine"] is None:
                continue
            if row["mlbamId"] is not None and int(row["mlbamId"]) != sp_id:
                continue
            if row["mlbamId"] is None and actual_name:
                stored = _normalize_name(row["pitcherName"])
                if stored and stored != _normalize_name(actual_name):
                    continue
            bl = parse_num(row["bookLine"])
            if bl is not None:
                book_line = bl
                break

        return {
            "mlbamId": sp_id,
            "name": person.get("fullName"),
            "hand": hand,
            "pitcher_k9_blend": p["k9"],
            "xfip_adj": xfip_adj,
            "opp_k9_samebasis": self._team_split_k9_asof(opp, hand, cutoff_date),
            "league_mean_k9_hand": self._league_mean_k9_hand("L" if hand == "L" else "R", cutoff_date),
            "ip_expected_asof": p["ip_per_start"],
            "umpire_k_mod": k_mod,
            "book_line": book_line,
        }

    # ── HR props inputs ─────────────────────────────────────────────────────

    def _batter_log_2026(self, mlbam_id):
        def load():
            d = self._api(f"/api/v1/people/{mlbam_id}/stats?stats=gameLog&group=hitting&season=2026&gameType=R")
            stats = d.get("stats") or []
            return (stats[0].get("splits") or []) if stats else []
        return self._memoized(("blog26", mlbam_id), load)

    def _batter_season_2025_rate(self, mlbam_id):
        def load():
            d = self._api(f"/api/v1/people/{mlbam_id}/stats?stats=season&group=hitting&season=2025")
            stats = d.get("stats") or []
            splits = (stats[0].get("splits") or []) if stats else []
            if not splits:
                return None
            st = splits[0].get("stat") or {}
            ab = int(st.get("atBats") or 0)
            if ab < 50:  # too thin to be a meaningful prior
                return None
            return int(st.get("homeRuns") or 0) / ab
        return self._memoized(("b2025", mlbam_id), load)

    def _batter_hr_rate_asof(self, mlbam_id, cutoff_date):
        """Per-AB HR rate as-of: 2026 pre-cutoff counts shrunk toward the 2025
        season rate (HR_PRIOR_AB pseudo-ABs). Early season -> prior dominates,
        mirroring the frozen-registry pattern for pitchers."""
        hr26 = ab26 = 0
        for s in self._batter_log_2026(mlbam_id):
            if (s.get("date") or "9999") >= cutoff_date:
                continue
            st = s.get("stat") or {}
            hr26 += int(st.get("homeRuns") or 0)
            ab26 += int(st.get("atBats") or 0)
        prior = self._batter_season_2025_rate(mlbam_id)
        if prior is None:
            prior = LEAGUE_HR_PER_AB
        return (hr26 + prior * HR_PRIOR_AB) / (ab26 + HR_PRIOR_AB)

    def hrprop_inputs(self, game_id: int) -> list:
        """Per actual-lineup batter (away 9 then home 9): inputs for the FIXED
        HR-props formula (per-AB basis, park hrFactor)."""
        meta = self.game_meta(game_id)
        cutoff_ms = meta["startUtcMs"]
        cutoff_date = self._cutoff_date(cutoff_ms)
        park = self._park_row(meta["home"])
        hr_factor = float(park["hrFactor"]) if park and park["hrFactor"] else 1.0

        p_home = self.pitcher_asof(meta["homeStarterId"], cutoff_ms)  # faces away batters
        p_away = self.pitcher_asof(meta["awayStarterId"], cutoff_ms)  # faces home batters

        book = {}
        for row in self._q("SELECT playerName, mlbamId, side, bookLine FROM mlb_hr_props "
                           "WHERE gameId=%s", (game_id,)):
            bl = parse_num(row["bookLine"])
            if bl is None:
                continue
            if row["mlbamId"] is not None:
                book[("id", int(row["mlbamId"]))] = bl
            book[("name", _normalize_name(row["playerName"]))] = bl

        out = []
        for side, lineup, opp_p in (("away", meta["lineupAway"], p_home),
                                    ("home", meta["lineupHome"], p_away)):
            for pid in (lineup or [])[:9]:
                person = self._person(pid)
                name = person.get("fullName")
                bl = book.get(("id", pid))
                if bl is None and name:
                    bl = book.get(("name", _normalize_name(name)))
                out.append({
                    "mlbamId": pid,
                    "name": name,
                    "side": side,
                    "batter_hr_rate_asof": self._batter_hr_rate_asof(pid, cutoff_date),
                    "pitcher_hr9_asof": opp_p["hr9"],
                    "park_hr_factor": hr_factor,
                    "book_line": bl,
                })
        return out

    # ── NRFI features ───────────────────────────────────────────────────────

    def _starter_nrfi_asof(self, mlbam_id, cutoff_date):
        """2026 as-of NRFI record for a starter from the linescores substrate.

        Away starter pitches the BOTTOM of the 1st (allowed = inn1HomeRuns);
        home starter pitches the TOP (allowed = inn1AwayRuns).
        """
        rows = self._q(
            "SELECT awayStarterId, homeStarterId, inn1AwayRuns, inn1HomeRuns "
            "FROM mlb_replay_linescores WHERE gameDate < %s AND gameDate >= %s "
            "AND (awayStarterId=%s OR homeStarterId=%s)",
            (cutoff_date, cutoff_date[:4] + "-01-01", mlbam_id, mlbam_id))
        starts = nrfi = 0
        for r in rows:
            if r["awayStarterId"] == mlbam_id:
                allowed = r["inn1HomeRuns"]
            else:
                allowed = r["inn1AwayRuns"]
            if allowed is None:
                continue
            starts += 1
            if allowed == 0:
                nrfi += 1
        return starts, nrfi

    def _team_inn1_rates(self, cutoff_date):
        """Per-team as-of P(score >=1 in inning 1) + the pooled league rate."""
        def load():
            acc = {}
            pooled = [0, 0]
            for r in self._substrate_rows(cutoff_date):
                for team, runs in ((r["awayTeam"], r["inn1AwayRuns"]),
                                   (r["homeTeam"], r["inn1HomeRuns"])):
                    if runs is None:
                        continue
                    a = acc.setdefault(team, [0, 0])
                    a[0] += 1 if runs > 0 else 0
                    a[1] += 1
                    pooled[0] += 1 if runs > 0 else 0
                    pooled[1] += 1
            rates = {t: (s / n, n) for t, (s, n) in acc.items() if n > 0}
            # league rate shrunk toward the 2025-derived prior (100 pseudo
            # team-halves) so opening-week fallbacks stay prior-dominated
            # instead of collapsing onto a 2-observation empirical rate.
            league = (pooled[0] + LEAGUE_TEAM_I1_SCORE_RATE * 100.0) / (pooled[1] + 100.0)
            return rates, league
        return self._memoized(("inn1", cutoff_date), load)

    def nrfi_features(self, game_id: int) -> dict:
        """Features for the rebuilt walk-forward NRFI model (protocol item):
        starter as-of NRFI rates with 2025 priors + shrinkage counts, team
        as-of inning-1 scoring rates, park factor, starter hands."""
        meta = self.game_meta(game_id)
        cutoff_date = self._cutoff_date(meta["startUtcMs"])
        park = self._park_row(meta["home"])
        park_factor = float(park["parkFactor3yr"]) if park and park["parkFactor3yr"] else 1.0
        team_rates, league_inn1 = self._team_inn1_rates(cutoff_date)
        if league_inn1 is None:
            league_inn1 = LEAGUE_TEAM_I1_SCORE_RATE

        def starter_block(sp_id, hand, batting_team):
            starts26, nrfi26 = (self._starter_nrfi_asof(sp_id, cutoff_date)
                                if sp_id else (0, 0))
            prior_rate, prior_starts = self._nrfi_prior(sp_id)
            eff_prior = prior_rate if prior_rate is not None else LEAGUE_PITCHER_NRFI_PRIOR
            shrunk = (nrfi26 + eff_prior * NRFI_SHRINKAGE_K) / (starts26 + NRFI_SHRINKAGE_K)
            rate, n = team_rates.get(batting_team, (league_inn1, 0))
            return {
                "starter_mlbam_id": sp_id,
                "hand": hand,
                "nrfi_rate_2026_asof": (nrfi26 / starts26) if starts26 else None,
                "nrfi_starts_2026_asof": starts26,
                "nrfi_count_2026_asof": nrfi26,
                "prior_nrfi_rate_2025": prior_rate,
                "prior_nrfi_starts_2025": prior_starts,
                "nrfi_rate_shrunk": shrunk,        # K=NRFI_SHRINKAGE_K pseudo-starts
                "opp_team_inn1_score_rate_asof": rate,
                "opp_team_inn1_games_asof": n,
            }

        return {
            "gameId": game_id,
            "gamePk": meta["gamePk"],
            "cutoffMs": meta["startUtcMs"],
            "park_factor_3yr": park_factor,
            "league_inn1_score_rate_asof": league_inn1,
            # away starter faces the HOME batting side and vice versa
            "away_starter": starter_block(meta["awayStarterId"],
                                          meta["awayStarterHand"], meta["home"]),
            "home_starter": starter_block(meta["homeStarterId"],
                                          meta["homeStarterHand"], meta["away"]),
            # team blocks: each team's own inning-1 scoring rate as-of
            "away_team_inn1_score_rate_asof": team_rates.get(meta["away"], (league_inn1, 0))[0],
            "home_team_inn1_score_rate_asof": team_rates.get(meta["home"], (league_inn1, 0))[0],
        }


def _normalize_name(name):
    """NFD-strip accents, drop suffixes, lowercase (mirror of mlbamIdCache)."""
    if not name:
        return ""
    import unicodedata
    s = unicodedata.normalize("NFD", str(name))
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"\s+(jr|sr|ii|iii|iv)\.?$", "", s.strip().lower())
    return re.sub(r"\s+", " ", s)
