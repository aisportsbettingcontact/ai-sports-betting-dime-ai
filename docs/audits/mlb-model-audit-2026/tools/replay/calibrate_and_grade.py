#!/usr/bin/env python3
"""Phase 5 walk-forward calibration (pass 2) + unified grading for the MLB replay audit.

Binding spec: docs/audits/mlb-model-audit-2026/REPLAY-PROTOCOL.md
Grading rules: docs/audits/mlb-model-audit-2026/GRADING-REPORT.md ("Grading rules")

DB writes are restricted to: mlb_replay_projections, mlb_replay_prop_projections,
mlb_replay_grades. Everything else is read-only. All cutoffs come from
mlb_schedule_history.startTimeUtc (via the Phase 1 census linkage).

Pipeline
  fit     - fit walk-forward calibration per month (no writes; prints fitted values)
  pass2   - fit + write pass-2 rows (modelVersion <p1v with -p1 replaced by -p2>) into
            mlb_replay_projections / mlb_replay_prop_projections, calibMeta JSON per row
  grade   - grade source='live_pregame' (games/props stored projections, modelVersion 'live')
            and source='walkforward_replay' (pass-1 AND pass-2 rows) into mlb_replay_grades
  report  - emit calibration/before-after.md (live vs replay-p1 vs replay-p2 per market x month)
  all     - fit + pass2 + grade + report

Walk-forward rules (REPLAY-PROTOCOL.md):
  - months: Mar+Apr jointly seeded (env mult 1.0, T 1.0, K/HR factors 1.0, NRFI prior-only,
    total sd seed 4.5 / F5 2.9); each later month m is fitted ONLY on months < m.
  - league_env_mult(m) = (actual runs) / (raw replay projected runs) over months < m.
  - T(m): minimize log loss of sigmoid(logit(p)/T), FG and F5 ML separately (scipy bounded).
  - K factor(m) = sum(actualKs)/sum(kProj) over months < m (ratio of means - documented choice;
    robust to small projections; recorded in calibMeta as k_method).
  - HR factor(m) = (actual HR>=1 rate) / (mean pHr) over months < m.
  - NRFI: numpy Newton/IRLS logistic (ridge 1e-3, standardized features) on
    AsOfFeatureStore.nrfi_features for games < m; prior-only (pass-1 passthrough) for the
    seed months or when asof_features is unavailable (recorded in calibMeta).
  - projTotal transformation: projected runs are multiplied by env mult; pOver is recentred
    under the sim's total-distribution assumption approximated as Normal(proj, sd):
        pOver2 = Phi( Phi^-1(pOver1) + (projTotal2 - projTotal1)/sd )
    sd = residual sd of (p1 projTotal - actual total) measured on months < m (seed 4.5;
    F5 analogue seed 2.9). The sd used is recorded in calibMeta.
  - RL probabilities pass through unchanged (env mult scales both teams; the margin
    distribution is unchanged to first order) - recorded in calibMeta.

Grading conventions (identical to GRADING-REPORT.md rules):
  markets: fg_ml fg_rl fg_total f5_ml f5_rl f5_total nrfi_yrfi k_prop hr_prop
  prob    = canonical-side probability: P(away) / P(over) / P(NRFI) / P(HR>=1)
  pick    = side with p>0.5 (FG RL live has no stored probability: margin + line rule)
  push/tie => result PUSH, correct NULL; brier only where a probability exists and no push
  signedError: fg_rl margin error, totals proj-actual, k_prop kProj-actualKs
  refId   = prop source row id (mlb_strikeout_props / mlb_hr_props for live;
            mlb_replay_prop_projections for replay); 0 for game markets
  line    = as-of line: live => the games row's stored book columns (exactly as
            GRADING-REPORT); replay => games stored book columns, else last odds_history
            snapshot before cutoff, else mlb_schedule_history DK pre-game columns.
  actuals = games.actual*, falling back to census schedule scores (FG), replay linescores
            (F5 / NRFI / starter Ks), mlb_hr_props actuals then StatsAPI boxscore (HR),
            all cached under the StatsAPI cache dir.
"""

import argparse
import hashlib
import json
import math
import os
import re
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from urllib.parse import urlsplit, unquote

import numpy as np
import pymysql
from scipy.optimize import minimize_scalar
from scipy.stats import norm, poisson

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
AUDIT_DIR = os.path.abspath(os.path.join(THIS_DIR, "..", ".."))
CENSUS_CSV = os.path.join(AUDIT_DIR, "census", "game-universe.csv")
REPORT_PATH = os.path.join(AUDIT_DIR, "calibration", "before-after.md")
DEFAULT_CACHE_DIR = os.environ.get(
    "STATSAPI_CACHE_DIR",
    os.path.join(os.environ.get("TMPDIR", "/tmp"), "statsapi-cache"),
)

SEED_MONTHS = {"2026-03", "2026-04"}
SEASON_START = "2026-03-01"
SEED_TOTAL_SD = 4.5
SEED_F5_TOTAL_SD = 2.9
MARKETS = [
    "fg_ml", "fg_rl", "fg_total", "f5_ml", "f5_rl", "f5_total",
    "nrfi_yrfi", "k_prop", "hr_prop",
]
LIVE_VERSION = "live"

EPS = 1e-6


# --------------------------------------------------------------------------- utils

def num(v):
    if v is None or v == "":
        return None
    if isinstance(v, Decimal):
        return float(v)
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def parse_odds(s):
    """American odds string -> int, or None."""
    if s is None:
        return None
    t = str(s).strip().upper()
    if t in ("EVEN", "EV", "PK"):
        return 100
    if not re.match(r"^[+-]?\d+(\.\d+)?$", t):
        return None
    v = float(t)
    return v if abs(v) >= 100 else None


def clamp_p(p):
    return min(1.0 - EPS, max(EPS, p))


def logit(p):
    p = clamp_p(p)
    return math.log(p / (1.0 - p))


def sigmoid(x):
    if x >= 0:
        return 1.0 / (1.0 + math.exp(-x))
    e = math.exp(x)
    return e / (1.0 + e)


def brier(p, y):
    return (p - y) ** 2


def log_loss(p, y):
    p = clamp_p(p)
    return -(y * math.log(p) + (1 - y) * math.log(1 - p))


def month_of(game_date):
    return str(game_date)[:7]


def iso_to_ms(iso):
    if not iso:
        return None
    s = str(iso).replace("Z", "+00:00")
    try:
        return int(datetime.fromisoformat(s).timestamp() * 1000)
    except ValueError:
        return None


def fmt(v, nd=4):
    return "-" if v is None else f"{v:.{nd}f}"


# --------------------------------------------------------------------------- DB

class SafeConn:
    """Auto-reconnecting pymysql wrapper: TiDB serverless drops idle/long-lived
    connections (observed OperationalError 2013 / InterfaceError mid-run), so every
    cursor acquisition pings first and callers retry once after reconnect. Safe here
    because every write in this tool is an idempotent upsert."""

    def __init__(self):
        self._conn = self._open()

    @staticmethod
    def _open():
        url = os.environ.get("DATABASE_URL")
        if not url:
            raise SystemExit("DATABASE_URL not set")
        sp = urlsplit(url)
        return pymysql.connect(
            host=sp.hostname,
            port=sp.port or 3306,
            user=unquote(sp.username or ""),
            password=unquote(sp.password or ""),
            database=sp.path.lstrip("/"),
            ssl={"ssl": True},
            charset="utf8mb4",
            autocommit=True,
        )

    def reconnect(self):
        try:
            self._conn.close()
        except Exception:
            pass
        self._conn = self._open()

    def cursor(self, *a, **k):
        try:
            self._conn.ping(reconnect=True)
        except Exception:
            self.reconnect()
        return self._conn.cursor(*a, **k)


def connect_db():
    return SafeConn()


_RETRYABLE = (pymysql.err.OperationalError, pymysql.err.InterfaceError)


def qall(conn, sql, params=None):
    for attempt in (1, 2):
        try:
            with conn.cursor(pymysql.cursors.DictCursor) as cur:
                cur.execute(sql, params or ())
                return cur.fetchall()
        except _RETRYABLE:
            if attempt == 2:
                raise
            conn.reconnect()


def executemany(conn, sql, rows, batch=500):
    if not rows:
        return 0
    n = 0
    for i in range(0, len(rows), batch):
        chunk = rows[i:i + batch]
        for attempt in (1, 2):
            try:
                with conn.cursor() as cur:
                    n += cur.executemany(sql, chunk)
                break
            except _RETRYABLE:
                if attempt == 2:
                    raise
                conn.reconnect()
    return n


# --------------------------------------------------------------------------- census linkage

def load_census():
    """games.id -> {anGameId, mlbGamePk, schedStatus, schedAway, schedHome}."""
    out = {}
    with open(CENSUS_CSV) as f:
        header = f.readline().strip().split(",")
        idx = {c: i for i, c in enumerate(header)}
        for line in f:
            parts = line.rstrip("\n").split(",")
            if len(parts) < len(header):
                continue
            gid = parts[idx["gamesId"]]
            if not gid:
                continue
            out[int(gid)] = {
                "anGameId": int(parts[idx["anGameId"]]) if parts[idx["anGameId"]] else None,
                "mlbGamePk": int(parts[idx["mlbGamePk"]]) if parts[idx["mlbGamePk"]] else None,
                "schedStatus": parts[idx["schedStatus"]],
                "schedAway": num(parts[idx["schedAway"]]),
                "schedHome": num(parts[idx["schedHome"]]),
            }
    return out


# --------------------------------------------------------------------------- StatsAPI cache

class StatsApiCache:
    """Cached GET against statsapi.mlb.com; JSON responses keyed by URL sha256."""

    def __init__(self, cache_dir):
        self.cache_dir = cache_dir
        os.makedirs(cache_dir, exist_ok=True)

    def get(self, url):
        key = hashlib.sha256(url.encode()).hexdigest()
        path = os.path.join(self.cache_dir, key + ".json")
        if os.path.exists(path):
            with open(path) as f:
                return json.load(f)
        req = urllib.request.Request(url, headers={"User-Agent": "dime-audit-replay/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(data, f)
        os.replace(tmp, path)
        return data

    def boxscore_batting_hr(self, game_pk):
        """{mlbamId: homeRuns} for all batters in the game."""
        data = self.get(f"https://statsapi.mlb.com/api/v1/game/{game_pk}/boxscore")
        out = {}
        for side in ("away", "home"):
            players = (data.get("teams", {}).get(side, {}) or {}).get("players", {}) or {}
            for pk, pdata in players.items():
                batting = ((pdata.get("stats") or {}).get("batting") or {})
                if "homeRuns" in batting:
                    try:
                        out[int(str(pk).replace("ID", ""))] = int(batting["homeRuns"])
                    except (TypeError, ValueError):
                        pass
        return out


# --------------------------------------------------------------------------- data loading

class DataStore:
    """Read-only loads of everything grading + calibration needs."""

    def __init__(self, conn, cache_dir=DEFAULT_CACHE_DIR):
        self.conn = conn
        self.census = load_census()
        self.statsapi = StatsApiCache(cache_dir)
        self._sched_by_an = None
        self._games = None            # gameId -> games row (resolved)
        self._linescores = None       # gameId -> row
        self._odds_hist = {}          # gameId -> sorted [(scrapedAt, row)] (lazy per game set)
        self._hr_boxscores = {}       # gamePk -> {mlbamId: hr}

    # ---- schedule / cutoffs
    def sched_by_an(self):
        if self._sched_by_an is None:
            rows = qall(self.conn, """
                SELECT anGameId, gameDate, startTimeUtc, awayScore, homeScore, gameStatus,
                       dkAwayML, dkHomeML, dkTotal, dkAwayRunLine
                FROM mlb_schedule_history
                WHERE game_type='regular_season' AND gameDate >= %s""", (SEASON_START,))
            self._sched_by_an = {r["anGameId"]: r for r in rows}
        return self._sched_by_an

    def cutoff_ms(self, game_id):
        link = self.census.get(game_id)
        if not link or link["anGameId"] is None:
            return None
        sched = self.sched_by_an().get(link["anGameId"])
        return iso_to_ms(sched["startTimeUtc"]) if sched else None

    def game_pk(self, game_id):
        link = self.census.get(game_id)
        if link and link["mlbGamePk"]:
            return link["mlbGamePk"]
        ls = self.linescores().get(game_id)
        return ls["gamePk"] if ls else None

    # ---- games
    def games(self):
        if self._games is None:
            rows = qall(self.conn, """
                SELECT id, gameDate, awayTeam, homeTeam, gameStatus, gameNumber,
                       awayML, homeML, awayRunLine, awayRunLineOdds, bookTotal,
                       f5AwayML, f5AwayRunLine, f5Total, nrfiOverOdds, yrfiUnderOdds,
                       modelAwayWinPct, modelAwayScore, modelHomeScore, modelOverRate,
                       modelProjTotal, modelTotal,
                       modelF5AwayWinPct, modelF5AwayRLCoverPct, modelF5OverRate, modelF5Total,
                       modelF5AwayScore, modelF5HomeScore, modelPNrfi,
                       actualAwayScore, actualHomeScore, actualFgTotal,
                       actualF5AwayScore, actualF5HomeScore, actualF5Total,
                       actualNrfiBinary, nrfiActualResult
                FROM games WHERE sport='MLB' AND gameDate >= %s
                ORDER BY gameDate, id""", (SEASON_START,))
            self._games = {r["id"]: r for r in rows}
        return self._games

    def linescores(self):
        if self._linescores is None:
            rows = qall(self.conn, """
                SELECT gamePk, gameId, gameDate, awayStarterId, homeStarterId,
                       inn1AwayRuns, inn1HomeRuns, f5AwayRuns, f5HomeRuns,
                       awayStarterKs, homeStarterKs, awayFinalRuns, homeFinalRuns
                FROM mlb_replay_linescores""")
            self._linescores = {r["gameId"]: r for r in rows}
        return self._linescores

    def is_final(self, game_id):
        g = self.games().get(game_id)
        link = self.census.get(game_id)
        if link and link["schedStatus"]:
            return link["schedStatus"] == "complete"
        return bool(g and g["gameStatus"] == "final")

    # ---- actual outcomes (with documented fallbacks)
    def actual_scores(self, game_id):
        g = self.games().get(game_id)
        if g and g["actualAwayScore"] is not None and g["actualHomeScore"] is not None:
            return num(g["actualAwayScore"]), num(g["actualHomeScore"])
        link = self.census.get(game_id)
        if link and link["schedAway"] is not None:
            return link["schedAway"], link["schedHome"]
        ls = self.linescores().get(game_id)
        if ls and ls["awayFinalRuns"] is not None:
            return num(ls["awayFinalRuns"]), num(ls["homeFinalRuns"])
        return None, None

    def actual_f5(self, game_id):
        g = self.games().get(game_id)
        if g and g["actualF5AwayScore"] is not None and g["actualF5HomeScore"] is not None:
            return num(g["actualF5AwayScore"]), num(g["actualF5HomeScore"])
        ls = self.linescores().get(game_id)
        if ls and ls["f5AwayRuns"] is not None and ls["f5HomeRuns"] is not None:
            return num(ls["f5AwayRuns"]), num(ls["f5HomeRuns"])
        return None, None

    def actual_nrfi(self, game_id):
        """1 = NRFI, 0 = YRFI, None unknown."""
        g = self.games().get(game_id)
        if g:
            if g["actualNrfiBinary"] is not None:
                return int(g["actualNrfiBinary"])
            if g["nrfiActualResult"] in ("NRFI", "YRFI"):
                return 1 if g["nrfiActualResult"] == "NRFI" else 0
        ls = self.linescores().get(game_id)
        if ls and ls["inn1AwayRuns"] is not None and ls["inn1HomeRuns"] is not None:
            return 1 if (ls["inn1AwayRuns"] + ls["inn1HomeRuns"]) == 0 else 0
        return None

    def actual_starter_ks(self, game_id, side, mlbam_id, live_props_by_key):
        """Starter Ks: replay linescores when the starter matches, else live props row."""
        ls = self.linescores().get(game_id)
        if ls is not None:
            sid = ls["awayStarterId"] if side == "away" else ls["homeStarterId"]
            ks = ls["awayStarterKs"] if side == "away" else ls["homeStarterKs"]
            if ks is not None and (mlbam_id is None or sid == mlbam_id):
                return float(ks)
        live = live_props_by_key.get((game_id, mlbam_id)) or live_props_by_key.get((game_id, side))
        if live and live.get("actualKs") is not None:
            return num(live["actualKs"])
        return None

    def actual_hr(self, game_id, mlbam_id, player_name, hr_actual_by_key):
        """HR>=1 actual for a batter: mlb_hr_props first, then cached StatsAPI boxscore."""
        v = None
        if mlbam_id is not None:
            v = hr_actual_by_key.get((game_id, mlbam_id))
        if v is None and player_name:
            v = hr_actual_by_key.get((game_id, str(player_name).strip().lower()))
        if v is not None:
            return int(v)
        pk = self.game_pk(game_id)
        if pk is None or mlbam_id is None:
            return None
        if pk not in self._hr_boxscores:
            try:
                self._hr_boxscores[pk] = self.statsapi.boxscore_batting_hr(pk)
            except Exception as e:  # noqa: BLE001 - tolerate missing games (substrate in flight)
                print(f"[warn] boxscore fetch failed gamePk={pk}: {e}", file=sys.stderr)
                self._hr_boxscores[pk] = {}
        hr = self._hr_boxscores[pk].get(mlbam_id)
        return None if hr is None else (1 if hr >= 1 else 0)

    # ---- as-of lines (REPLAY-PROTOCOL "Lines")
    def _odds_history_for(self, game_id):
        if game_id not in self._odds_hist:
            rows = qall(self.conn, """
                SELECT scrapedAt, total, awayML, awaySpread
                FROM odds_history WHERE sport='MLB' AND gameId=%s
                ORDER BY scrapedAt""", (game_id,))
            self._odds_hist[game_id] = rows
        return self._odds_hist[game_id]

    def asof_lines(self, game_id, allow_fallback):
        """Line set for grading. live => games stored columns only (GRADING-REPORT rules).
        replay => games stored, else last odds_history snapshot before cutoff, else
        mlb_schedule_history DK pre-game columns."""
        g = self.games().get(game_id) or {}
        lines = {
            "awayML": g.get("awayML"),
            "awayRunLine": num(g.get("awayRunLine")),
            "bookTotal": num(g.get("bookTotal")),
            "f5AwayML": g.get("f5AwayML"),
            "f5AwayRunLine": num(g.get("f5AwayRunLine")),
            "f5Total": num(g.get("f5Total")),
            "nrfiOverOdds": g.get("nrfiOverOdds"),
        }
        if not allow_fallback:
            return lines
        need = [k for k in ("awayML", "awayRunLine", "bookTotal") if lines[k] in (None, "")]
        if need:
            cutoff = self.cutoff_ms(game_id)
            snap = None
            for row in self._odds_history_for(game_id):
                if cutoff is not None and num(row["scrapedAt"]) is not None \
                        and num(row["scrapedAt"]) >= cutoff:
                    break
                if any(row[c] is not None for c in ("total", "awayML", "awaySpread")):
                    snap = row
            if snap:
                if lines["awayML"] in (None, "") and snap["awayML"] is not None:
                    lines["awayML"] = snap["awayML"]
                if lines["bookTotal"] is None and snap["total"] is not None:
                    lines["bookTotal"] = num(snap["total"])
                if lines["awayRunLine"] is None and snap["awaySpread"] is not None:
                    lines["awayRunLine"] = num(snap["awaySpread"])
        if any(lines[k] in (None, "") for k in ("awayML", "awayRunLine", "bookTotal")):
            link = self.census.get(game_id)
            sched = self.sched_by_an().get(link["anGameId"]) if link and link["anGameId"] else None
            if sched:
                if lines["awayML"] in (None, ""):
                    lines["awayML"] = sched["dkAwayML"]
                if lines["bookTotal"] is None:
                    lines["bookTotal"] = num(sched["dkTotal"])
                if lines["awayRunLine"] is None:
                    lines["awayRunLine"] = num(sched["dkAwayRunLine"])
        return lines

    # ---- replay + live projection loads
    def load_p1_games(self, p1_version):
        return qall(self.conn, """
            SELECT * FROM mlb_replay_projections
            WHERE modelVersion=%s ORDER BY gameDate, gameId""", (p1_version,))

    def load_p1_props(self, p1_version):
        return qall(self.conn, """
            SELECT * FROM mlb_replay_prop_projections
            WHERE modelVersion=%s ORDER BY gameDate, gameId, id""", (p1_version,))

    def load_live_kprops(self):
        return qall(self.conn, """
            SELECT p.id, p.gameId, g.gameDate, p.side, p.mlbamId, p.pitcherName,
                   p.kProj, p.bookLine, p.pOver, p.pUnder, p.actualKs
            FROM mlb_strikeout_props p JOIN games g ON g.id=p.gameId
            WHERE g.sport='MLB' AND g.gameDate >= %s ORDER BY g.gameDate, p.id""",
            (SEASON_START,))

    def load_live_hrprops(self):
        return qall(self.conn, """
            SELECT p.id, p.gameId, g.gameDate, p.side, p.mlbamId, p.playerName,
                   p.bookLine, p.modelPHr, p.actualHr, p.verdict
            FROM mlb_hr_props p JOIN games g ON g.id=p.gameId
            WHERE g.sport='MLB' AND g.gameDate >= %s ORDER BY g.gameDate, p.id""",
            (SEASON_START,))


# --------------------------------------------------------------------------- calibration

def fit_temperature(pairs):
    """pairs: [(p, y)]. Fit T minimizing mean logloss of sigmoid(logit(p)/T)."""
    if len(pairs) < 20:
        return 1.0, len(pairs)
    logits = np.array([logit(p) for p, _ in pairs])
    ys = np.array([y for _, y in pairs], dtype=float)

    def nll(t):
        z = logits / t
        p = 1.0 / (1.0 + np.exp(-z))
        p = np.clip(p, EPS, 1 - EPS)
        return float(-np.mean(ys * np.log(p) + (1 - ys) * np.log(1 - p)))

    res = minimize_scalar(nll, bounds=(0.2, 5.0), method="bounded")
    return float(res.x), len(pairs)


def irls_logistic(X, y, ridge=1e-3, max_iter=50, tol=1e-8):
    """Newton/IRLS logistic regression (numpy only). X excludes intercept; returns
    (beta incl. intercept, mu, sd) with standardized features."""
    X = np.asarray(X, dtype=float)
    y = np.asarray(y, dtype=float)
    mu = X.mean(axis=0)
    sd = X.std(axis=0)
    sd[sd < 1e-9] = 1.0
    Xs = (X - mu) / sd
    Xd = np.hstack([np.ones((Xs.shape[0], 1)), Xs])
    beta = np.zeros(Xd.shape[1])
    base = y.mean()
    beta[0] = logit(min(max(base, 0.02), 0.98))
    for _ in range(max_iter):
        z = Xd @ beta
        p = 1.0 / (1.0 + np.exp(-np.clip(z, -30, 30)))
        W = p * (1 - p)
        grad = Xd.T @ (y - p) - ridge * np.r_[0.0, beta[1:]]
        H = (Xd * W[:, None]).T @ Xd + ridge * np.eye(Xd.shape[1])
        try:
            step = np.linalg.solve(H, grad)
        except np.linalg.LinAlgError:
            break
        beta = beta + step
        if float(np.max(np.abs(step))) < tol:
            break
    return beta, mu, sd


def nrfi_feature_vector(feats):
    """Deterministic numeric vector from AsOfFeatureStore.nrfi_features output.
    Sorted-key order; hands mapped L->1/R->0; id-ish keys excluded. Returns (keys, vec)."""
    keys, vec = [], []
    for k in sorted(feats.keys()):
        v = feats[k]
        lk = k.lower()
        if lk.endswith("id") or lk in ("gameid", "gamepk"):
            continue
        if isinstance(v, bool):
            keys.append(k); vec.append(1.0 if v else 0.0)
        elif isinstance(v, (int, float)) and not isinstance(v, bool):
            keys.append(k); vec.append(float(v))
        elif isinstance(v, str) and v.upper() in ("L", "R", "S"):
            keys.append(k); vec.append(1.0 if v.upper() == "L" else 0.0)
        elif isinstance(v, dict):
            for k2 in sorted(v.keys()):
                v2 = v[k2]
                if isinstance(v2, (int, float)) and not isinstance(v2, bool):
                    keys.append(f"{k}.{k2}"); vec.append(float(v2))
    return keys, vec


class NrfiWalkForward:
    """Monthly-refit NRFI logistic on AsOfFeatureStore.nrfi_features. Falls back to
    pass-1 passthrough (prior-only model) when asof_features is unavailable."""

    def __init__(self, cache_dir):
        self.store = None
        self.error = None
        try:
            sys.path.insert(0, THIS_DIR)
            import asof_features  # shared interface, provided by the replay driver
            self.store = asof_features.AsOfFeatureStore(cache_dir)
        except Exception as e:  # noqa: BLE001
            self.error = f"asof_features unavailable ({e.__class__.__name__}: {e})"
        self._feat_cache = {}

    def features(self, game_id):
        if game_id in self._feat_cache:
            return self._feat_cache[game_id]
        out = None
        if self.store is not None:
            try:
                out = nrfi_feature_vector(self.store.nrfi_features(game_id))
            except Exception as e:  # noqa: BLE001
                print(f"[warn] nrfi_features failed game {game_id}: {e}", file=sys.stderr)
        self._feat_cache[game_id] = out
        return out

    def fit(self, train_games, data):
        """train_games: [(gameId, y)] -> model dict or None."""
        if self.store is None:
            return None
        X, y, keys = [], [], None
        for gid, label in train_games:
            fv = self.features(gid)
            if fv is None:
                continue
            k, v = fv
            if keys is None:
                keys = k
            if k != keys:
                continue  # inconsistent feature sets - skip defensively
            X.append(v); y.append(label)
        if keys is None or len(y) < 50:
            return None
        beta, mu, sd = irls_logistic(np.array(X), np.array(y))
        return {"keys": keys, "beta": beta.tolist(), "mu": mu.tolist(), "sd": sd.tolist(),
                "n_train": len(y)}

    def predict(self, model, game_id):
        fv = self.features(game_id)
        if fv is None or model is None:
            return None
        keys, vec = fv
        if keys != model["keys"]:
            return None
        xs = (np.array(vec) - np.array(model["mu"])) / np.array(model["sd"])
        z = model["beta"][0] + float(np.dot(np.array(model["beta"][1:]), xs))
        return sigmoid(max(-30, min(30, z)))


def build_month_params(data, p1_games, p1_props, months, nrfi_wf):
    """Fit walk-forward calibration params per month. p1 rows are the raw fixed-model
    outputs; every month m>seed is fitted strictly on months < m."""
    by_month = defaultdict(list)
    for r in p1_games:
        by_month[month_of(r["gameDate"])].append(r)
    kprops = [p for p in p1_props if p["propType"] == "K"]
    hrprops = [p for p in p1_props if p["propType"] == "HR"]
    live_k = {(r["gameId"], r["mlbamId"]): r for r in data.load_live_kprops()}

    params = {}
    all_months = sorted(set(list(by_month.keys()) + list(months)))
    for m in all_months:
        train_months = [mm for mm in by_month if mm < m]
        if m in SEED_MONTHS:
            params[m] = {
                "month": m, "seed": True, "fitted_on_months": [],
                "n_train_games": 0, "league_env_mult": 1.0, "T_fg": 1.0, "T_f5": 1.0,
                "k_factor": 1.0, "hr_factor": 1.0,
                "total_sd": SEED_TOTAL_SD, "f5_total_sd": SEED_F5_TOTAL_SD,
                "k_method": "ratio_of_means",
                "total_recenter": "pOver2=Phi(Phi^-1(pOver1)+(projTotal2-projTotal1)/sd)",
                "rl_passthrough": True,
                "nrfi": {"mode": "prior_only_passthrough"},
            }
            continue

        train = [r for mm in train_months for r in by_month[mm]]
        train_ids = {r["gameId"] for r in train}

        # league env mult + residual sds
        proj_sum = act_sum = 0.0
        resid, f5_resid = [], []
        fg_pairs, f5_pairs = [], []
        nrfi_train = []
        for r in train:
            gid = r["gameId"]
            if not data.is_final(gid):
                continue
            a_away, a_home = data.actual_scores(gid)
            if a_away is not None and num(r["projTotal"]) is not None:
                proj_sum += num(r["projTotal"])
                act_sum += a_away + a_home
                resid.append(num(r["projTotal"]) - (a_away + a_home))
            f5a, f5h = data.actual_f5(gid)
            if f5a is not None and num(r["projF5Total"]) is not None:
                f5_resid.append(num(r["projF5Total"]) - (f5a + f5h))
            if a_away is not None and num(r["pAwayMl"]) is not None:
                fg_pairs.append((num(r["pAwayMl"]), 1 if a_away > a_home else 0))
            if f5a is not None and num(r["pF5AwayMl"]) is not None and f5a != f5h:
                f5_pairs.append((num(r["pF5AwayMl"]), 1 if f5a > f5h else 0))
            y_n = data.actual_nrfi(gid)
            if y_n is not None:
                nrfi_train.append((gid, y_n))

        env_mult = (act_sum / proj_sum) if proj_sum > 0 else 1.0
        t_fg, n_fg = fit_temperature(fg_pairs)
        t_f5, n_f5 = fit_temperature(f5_pairs)
        total_sd = float(np.std(resid, ddof=1)) if len(resid) >= 30 else SEED_TOTAL_SD
        f5_sd = float(np.std(f5_resid, ddof=1)) if len(f5_resid) >= 30 else SEED_F5_TOTAL_SD

        # K factor (ratio of means) on train prop rows
        k_proj_sum = k_act_sum = 0.0
        n_k = 0
        for p in kprops:
            if p["gameId"] not in train_ids or num(p["projValue"]) is None:
                continue
            a = data.actual_starter_ks(p["gameId"], p["side"], p["mlbamId"], live_k)
            if a is None:
                continue
            k_proj_sum += num(p["projValue"]); k_act_sum += a; n_k += 1
        k_factor = (k_act_sum / k_proj_sum) if k_proj_sum > 0 else 1.0

        # HR factor on train prop rows
        hr_actual_by_key = build_hr_actual_index(data)
        p_sum = y_sum = 0.0
        n_hr = 0
        for p in hrprops:
            if p["gameId"] not in train_ids or num(p["pOver"]) is None:
                continue
            y = data.actual_hr(p["gameId"], p["mlbamId"], p["playerName"], hr_actual_by_key)
            if y is None:
                continue
            p_sum += num(p["pOver"]); y_sum += y; n_hr += 1
        hr_factor = (y_sum / n_hr) / (p_sum / n_hr) if n_hr > 0 and p_sum > 0 else 1.0

        nrfi_model = nrfi_wf.fit(nrfi_train, data)
        nrfi_meta = ({"mode": "logistic", "n_train": nrfi_model["n_train"],
                      "feature_keys": nrfi_model["keys"],
                      "beta": [round(b, 6) for b in nrfi_model["beta"]]}
                     if nrfi_model else
                     {"mode": "prior_only_passthrough",
                      "reason": nrfi_wf.error or "insufficient training features"})

        params[m] = {
            "month": m, "seed": False, "fitted_on_months": sorted(train_months),
            "n_train_games": len(train), "n_train_final": len(fg_pairs),
            "league_env_mult": round(env_mult, 5),
            "T_fg": round(t_fg, 4), "T_f5": round(t_f5, 4),
            "n_T_fg": n_fg, "n_T_f5": n_f5,
            "k_factor": round(k_factor, 5), "n_k_train": n_k,
            "hr_factor": round(hr_factor, 5), "n_hr_train": n_hr,
            "total_sd": round(total_sd, 4), "f5_total_sd": round(f5_sd, 4),
            "k_method": "ratio_of_means",
            "total_recenter": "pOver2=Phi(Phi^-1(pOver1)+(projTotal2-projTotal1)/sd)",
            "rl_passthrough": True,
            "nrfi": nrfi_meta,
            "_nrfi_model": nrfi_model,  # not serialized into calibMeta
        }
    return params


def build_hr_actual_index(data):
    if not hasattr(data, "_hr_actual_idx"):
        idx = {}
        for r in data.load_live_hrprops():
            if r["actualHr"] is None:
                continue
            y = 1 if num(r["actualHr"]) >= 1 else 0
            if r["mlbamId"] is not None:
                idx[(r["gameId"], r["mlbamId"])] = y
            if r["playerName"]:
                idx[(r["gameId"], str(r["playerName"]).strip().lower())] = y
        data._hr_actual_idx = idx
    return data._hr_actual_idx


# --------------------------------------------------------------------------- pass 2

def recenter_over_prob(p_over1, proj1, proj2, sd):
    if p_over1 is None:
        return None
    if proj1 is None or proj2 is None or sd is None or sd <= 0:
        return p_over1
    z1 = norm.ppf(clamp_p(p_over1))
    return float(norm.cdf(z1 + (proj2 - proj1) / sd))


def temperature_scale(p, t):
    if p is None:
        return None
    if not t or abs(t - 1.0) < 1e-9:
        return p
    return sigmoid(logit(p) / t)


def poisson_over_prob(mu, line):
    """P(over) with correct push handling: half lines P(X>line); integer lines
    P(X>line)/(1-P(X==line)) (push-excluded)."""
    if mu is None or line is None:
        return None
    mu = max(0.05, mu)
    if abs(line - round(line)) < 1e-9:
        li = int(round(line))
        p_push = float(poisson.pmf(li, mu))
        p_over = float(1.0 - poisson.cdf(li, mu))
        denom = 1.0 - p_push
        return p_over / denom if denom > 0 else 0.5
    return float(1.0 - poisson.cdf(math.floor(line), mu))


def write_pass2(conn, data, p1_games, p1_props, params, nrfi_wf, p2_version, months=None):
    game_sql = """
        INSERT INTO mlb_replay_projections
          (gameId, gameDate, provenance, modelVersion, asOfCutoffMs,
           pAwayMl, projAwayScore, projHomeScore, projTotal, pOver, pAwayRl,
           pF5AwayMl, projF5Total, pF5Over, pF5AwayRl, pNrfi, calibMeta)
        VALUES (%s,%s,'walkforward_replay',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON DUPLICATE KEY UPDATE
          asOfCutoffMs=VALUES(asOfCutoffMs), pAwayMl=VALUES(pAwayMl),
          projAwayScore=VALUES(projAwayScore), projHomeScore=VALUES(projHomeScore),
          projTotal=VALUES(projTotal), pOver=VALUES(pOver), pAwayRl=VALUES(pAwayRl),
          pF5AwayMl=VALUES(pF5AwayMl), projF5Total=VALUES(projF5Total),
          pF5Over=VALUES(pF5Over), pF5AwayRl=VALUES(pF5AwayRl), pNrfi=VALUES(pNrfi),
          calibMeta=VALUES(calibMeta)"""
    prop_sql = """
        INSERT INTO mlb_replay_prop_projections
          (gameId, gameDate, propType, mlbamId, playerName, side, provenance,
           modelVersion, projValue, pOver, line)
        VALUES (%s,%s,%s,%s,%s,%s,'walkforward_replay',%s,%s,%s,%s)
        ON DUPLICATE KEY UPDATE projValue=VALUES(projValue), pOver=VALUES(pOver),
          line=VALUES(line)"""

    game_rows, prop_rows = [], []
    for r in p1_games:
        m = month_of(r["gameDate"])
        if months and m not in months:
            continue
        cp = params.get(m)
        if cp is None:
            continue
        mult, sd, f5sd = cp["league_env_mult"], cp["total_sd"], cp["f5_total_sd"]
        proj_total1 = num(r["projTotal"])
        proj_total2 = proj_total1 * mult if proj_total1 is not None else None
        proj_f5_1 = num(r["projF5Total"])
        proj_f5_2 = proj_f5_1 * mult if proj_f5_1 is not None else None
        p_nrfi2 = None
        model = cp.get("_nrfi_model")
        if model is not None:
            p_nrfi2 = nrfi_wf.predict(model, r["gameId"])
        if p_nrfi2 is None:
            p_nrfi2 = num(r["pNrfi"])  # prior-only / fallback passthrough
        meta = {k: v for k, v in cp.items() if not k.startswith("_")}
        meta["p1_version"] = r["modelVersion"]
        game_rows.append((
            r["gameId"], r["gameDate"], p2_version, r["asOfCutoffMs"],
            temperature_scale(num(r["pAwayMl"]), cp["T_fg"]),
            num(r["projAwayScore"]) * mult if num(r["projAwayScore"]) is not None else None,
            num(r["projHomeScore"]) * mult if num(r["projHomeScore"]) is not None else None,
            proj_total2,
            recenter_over_prob(num(r["pOver"]), proj_total1, proj_total2, sd),
            num(r["pAwayRl"]),  # documented passthrough
            temperature_scale(num(r["pF5AwayMl"]), cp["T_f5"]),
            proj_f5_2,
            recenter_over_prob(num(r["pF5Over"]), proj_f5_1, proj_f5_2, f5sd),
            num(r["pF5AwayRl"]),  # documented passthrough
            p_nrfi2,
            json.dumps(meta),
        ))

    for p in p1_props:
        m = month_of(p["gameDate"])
        if months and m not in months:
            continue
        cp = params.get(m)
        if cp is None:
            continue
        if p["propType"] == "K":
            mu2 = num(p["projValue"]) * cp["k_factor"] if num(p["projValue"]) is not None else None
            line = num(p["line"])
            p_over2 = poisson_over_prob(mu2, line) if line is not None else num(p["pOver"])
            prop_rows.append((p["gameId"], p["gameDate"], "K", p["mlbamId"], p["playerName"],
                              p["side"], p2_version, mu2, p_over2, line))
        elif p["propType"] == "HR":
            p_hr1 = num(p["pOver"])
            p_hr2 = min(0.99, max(1e-4, p_hr1 * cp["hr_factor"])) if p_hr1 is not None else None
            pv2 = num(p["projValue"]) * cp["hr_factor"] if num(p["projValue"]) is not None else None
            prop_rows.append((p["gameId"], p["gameDate"], "HR", p["mlbamId"], p["playerName"],
                              p["side"], p2_version, pv2, p_hr2, num(p["line"])))

    n1 = executemany(conn, game_sql, game_rows)
    n2 = executemany(conn, prop_sql, prop_rows)
    print(f"[pass2] upserted {len(game_rows)} game rows, {len(prop_rows)} prop rows "
          f"(affected {n1}+{n2}) as {p2_version}")
    return len(game_rows), len(prop_rows)


# --------------------------------------------------------------------------- grading

GRADE_SQL = """
    INSERT INTO mlb_replay_grades
      (gameId, gameDate, market, refId, source, modelVersion, pick, prob, projValue,
       line, actual, result, correct, brier, signedError)
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    ON DUPLICATE KEY UPDATE pick=VALUES(pick), prob=VALUES(prob),
      projValue=VALUES(projValue), line=VALUES(line), actual=VALUES(actual),
      result=VALUES(result), correct=VALUES(correct), brier=VALUES(brier),
      signedError=VALUES(signedError)"""


def side_result(pick, actual_side):
    """WIN/LOSS/PUSH + correct for a side pick vs actual side ('PUSH' => push)."""
    if actual_side == "PUSH":
        return "PUSH", None
    if pick is None:
        return None, None
    return ("WIN", 1) if pick == actual_side else ("LOSS", 0)


def grade_game_markets(data, game_id, proj, source, model_version, lines):
    """proj: canonical projection dict. Returns grade rows for the 7 game markets."""
    rows = []
    g = data.games().get(game_id)
    if g is None or not data.is_final(game_id):
        return rows
    game_date = g["gameDate"]
    a_away, a_home = data.actual_scores(game_id)
    f5a, f5h = data.actual_f5(game_id)
    y_nrfi = data.actual_nrfi(game_id)

    def add(market, pick, prob, proj_value, line, actual, result, correct, br, se):
        rows.append((game_id, game_date, market, 0, source, model_version, pick,
                     round(prob, 5) if prob is not None else None,
                     round(proj_value, 4) if proj_value is not None else None,
                     None if line is None else str(line)[:16],
                     None if actual is None else str(actual)[:16],
                     result, correct,
                     round(br, 6) if br is not None else None,
                     round(se, 3) if se is not None else None))

    # fg_ml
    p = proj.get("pAway")
    if p is not None and a_away is not None:
        pick = "AWAY" if p > 0.5 else "HOME"
        actual = "AWAY" if a_away > a_home else "HOME"
        result, correct = side_result(pick, actual)
        y = 1 if actual == "AWAY" else 0
        add("fg_ml", pick, p, None, lines.get("awayML"), actual, result, correct,
            brier(p, y), None)

    # fg_rl
    rl = lines.get("awayRunLine")
    margin = (proj["projAway"] - proj["projHome"]) \
        if proj.get("projAway") is not None and proj.get("projHome") is not None else None
    p_rl = proj.get("pAwayRl")
    if rl is not None and (p_rl is not None or margin is not None) and a_away is not None:
        pick = ("AWAY" if p_rl > 0.5 else "HOME") if p_rl is not None \
            else ("AWAY" if margin + rl > 0 else "HOME")
        cover = a_away + rl - a_home
        actual = "AWAY" if cover > 0 else ("HOME" if cover < 0 else "PUSH")
        result, correct = side_result(pick, actual)
        y = None if actual == "PUSH" else (1 if actual == "AWAY" else 0)
        se = (margin - (a_away - a_home)) if margin is not None else None
        add("fg_rl", pick, p_rl, margin, rl, actual, result, correct,
            brier(p_rl, y) if (p_rl is not None and y is not None) else None, se)

    # fg_total
    bt = lines.get("bookTotal")
    p_over = proj.get("pOver")
    at = num(g["actualFgTotal"])
    if at is None and a_away is not None:
        at = a_away + a_home
    if bt is not None and p_over is not None and at is not None:
        pick = "OVER" if p_over > 0.5 else "UNDER"
        actual_side = "OVER" if at > bt else ("UNDER" if at < bt else "PUSH")
        result, correct = side_result(pick, actual_side)
        y = None if actual_side == "PUSH" else (1 if actual_side == "OVER" else 0)
        se = (proj["projTotal"] - at) if proj.get("projTotal") is not None else None
        add("fg_total", pick, p_over, proj.get("projTotal"), bt, at, result, correct,
            brier(p_over, y) if y is not None else None, se)

    # f5_ml
    p5 = proj.get("pF5Away")
    if p5 is not None and f5a is not None:
        pick = "AWAY" if p5 > 0.5 else "HOME"
        actual = "AWAY" if f5a > f5h else ("HOME" if f5a < f5h else "PUSH")
        result, correct = side_result(pick, actual)
        y = None if actual == "PUSH" else (1 if actual == "AWAY" else 0)
        add("f5_ml", pick, p5, None, lines.get("f5AwayML"),
            "TIE" if actual == "PUSH" else actual, result, correct,
            brier(p5, y) if y is not None else None, None)

    # f5_rl
    f5rl = lines.get("f5AwayRunLine")
    p5rl = proj.get("pF5AwayRl")
    if f5rl is not None and p5rl is not None and f5a is not None:
        pick = "AWAY" if p5rl > 0.5 else "HOME"
        cover = f5a + f5rl - f5h
        actual = "AWAY" if cover > 0 else ("HOME" if cover < 0 else "PUSH")
        result, correct = side_result(pick, actual)
        y = None if actual == "PUSH" else (1 if actual == "AWAY" else 0)
        add("f5_rl", pick, p5rl, None, f5rl, actual, result, correct,
            brier(p5rl, y) if y is not None else None, None)

    # f5_total
    f5t = lines.get("f5Total")
    p5o = proj.get("pF5Over")
    at5 = num(g["actualF5Total"])
    if at5 is None and f5a is not None:
        at5 = f5a + f5h
    if f5t is not None and p5o is not None and at5 is not None:
        pick = "OVER" if p5o > 0.5 else "UNDER"
        actual_side = "OVER" if at5 > f5t else ("UNDER" if at5 < f5t else "PUSH")
        result, correct = side_result(pick, actual_side)
        y = None if actual_side == "PUSH" else (1 if actual_side == "OVER" else 0)
        se = (proj["projF5Total"] - at5) if proj.get("projF5Total") is not None else None
        add("f5_total", pick, p5o, proj.get("projF5Total"), f5t, at5, result, correct,
            brier(p5o, y) if y is not None else None, se)

    # nrfi_yrfi (one row, reported from both sides via P(NRFI))
    pn = proj.get("pNrfi")
    if pn is not None and y_nrfi is not None:
        pick = "NRFI" if pn > 0.5 else "YRFI"
        actual = "NRFI" if y_nrfi else "YRFI"
        result, correct = side_result(pick, actual)
        add("nrfi_yrfi", pick, pn, None, lines.get("nrfiOverOdds"), actual, result, correct,
            brier(pn, y_nrfi), None)

    return rows


def grade_live(conn, data, game_ids, months):
    rows = []
    for gid, g in data.games().items():
        if game_ids and gid not in game_ids:
            continue
        if months and month_of(g["gameDate"]) not in months:
            continue
        proj = {
            "pAway": num(g["modelAwayWinPct"]) / 100 if g["modelAwayWinPct"] is not None else None,
            "projAway": num(g["modelAwayScore"]), "projHome": num(g["modelHomeScore"]),
            "projTotal": num(g["modelProjTotal"]) if g["modelProjTotal"] is not None else num(g["modelTotal"]),
            "pOver": num(g["modelOverRate"]) / 100 if g["modelOverRate"] is not None else None,
            "pAwayRl": None,  # live stores no FG RL probability (GRADING-REPORT)
            "pF5Away": num(g["modelF5AwayWinPct"]) / 100 if g["modelF5AwayWinPct"] is not None else None,
            "projF5Total": num(g["modelF5Total"]),
            "pF5Over": num(g["modelF5OverRate"]),  # already 0-1 (P-003)
            "pF5AwayRl": num(g["modelF5AwayRLCoverPct"]) / 100 if g["modelF5AwayRLCoverPct"] is not None else None,
            "pNrfi": num(g["modelPNrfi"]),
        }
        lines = data.asof_lines(gid, allow_fallback=False)
        rows.extend(grade_game_markets(data, gid, proj, "live_pregame", LIVE_VERSION, lines))

    live_k = {(r["gameId"], r["mlbamId"]): r for r in data.load_live_kprops()}
    for r in data.load_live_kprops():
        gid = r["gameId"]
        if game_ids and gid not in game_ids:
            continue
        if months and month_of(r["gameDate"]) not in months:
            continue
        if num(r["kProj"]) is None or not data.is_final(gid):
            continue
        rows.extend(grade_k_prop(data, gid, r["gameDate"], r["id"], "live_pregame",
                                 LIVE_VERSION, num(r["kProj"]),
                                 num(r["pOver"]), num(r["pUnder"]), num(r["bookLine"]),
                                 r["side"], r["mlbamId"], live_k))

    hr_idx = build_hr_actual_index(data)
    for r in data.load_live_hrprops():
        gid = r["gameId"]
        if game_ids and gid not in game_ids:
            continue
        if months and month_of(r["gameDate"]) not in months:
            continue
        p = num(r["modelPHr"])
        if p is None or not data.is_final(gid):
            continue
        y = data.actual_hr(gid, r["mlbamId"], r["playerName"], hr_idx)
        if y is None:
            continue
        verdict = str(r["verdict"] or "").upper()
        pick = "OVER" if verdict == "OVER" else None  # bet grading only when actionable
        result, correct = (("WIN", 1) if y else ("LOSS", 0)) if pick else (None, None)
        rows.append((gid, r["gameDate"], "hr_prop", r["id"], "live_pregame", LIVE_VERSION,
                     pick, round(p, 5), None,
                     str(num(r["bookLine"]) if r["bookLine"] is not None else 0.5),
                     "HR" if y else "NO_HR", result, correct,
                     round(brier(p, y), 6), None))
    n = executemany(conn, GRADE_SQL, rows)
    print(f"[grade live] {len(rows)} rows upserted (affected {n})")
    return len(rows)


def grade_k_prop(data, gid, game_date, ref_id, source, version, k_proj, p_over, p_under,
                 line, side, mlbam_id, live_k):
    aks = data.actual_starter_ks(gid, side, mlbam_id, live_k)
    if aks is None:
        return []
    if p_over is not None and p_under is not None:
        pick = "OVER" if p_over > p_under else "UNDER"
    elif p_over is not None:
        pick = "OVER" if p_over > 0.5 else "UNDER"
    elif line is not None and k_proj is not None:
        pick = "OVER" if k_proj > line else "UNDER"
    else:
        pick = None
    se = (k_proj - aks) if k_proj is not None else None
    if line is None:
        return [(gid, game_date, "k_prop", ref_id, source, version, None,
                 round(p_over, 5) if p_over is not None else None,
                 round(k_proj, 4) if k_proj is not None else None, None, str(int(aks)),
                 None, None, None, round(se, 3) if se is not None else None)]
    actual_side = "OVER" if aks > line else ("UNDER" if aks < line else "PUSH")
    result, correct = side_result(pick, actual_side)
    y = None if actual_side == "PUSH" else (1 if actual_side == "OVER" else 0)
    br = brier(p_over, y) if (p_over is not None and y is not None) else None
    return [(gid, game_date, "k_prop", ref_id, source, version, pick,
             round(p_over, 5) if p_over is not None else None,
             round(k_proj, 4) if k_proj is not None else None,
             str(line), str(int(aks)), result, correct,
             round(br, 6) if br is not None else None,
             round(se, 3) if se is not None else None)]


def grade_replay(conn, data, version, game_ids, months):
    """Grade one replay series (pass 1 or pass 2) under source='walkforward_replay'."""
    p_games = data.load_p1_games(version)
    p_props = data.load_p1_props(version)
    live_k = {(r["gameId"], r["mlbamId"]): r for r in data.load_live_kprops()}
    live_k_line = {(r["gameId"], r["mlbamId"]): num(r["bookLine"])
                   for r in data.load_live_kprops()}
    hr_idx = build_hr_actual_index(data)
    rows = []
    for r in p_games:
        gid = r["gameId"]
        if game_ids and gid not in game_ids:
            continue
        if months and month_of(r["gameDate"]) not in months:
            continue
        proj = {
            "pAway": num(r["pAwayMl"]), "projAway": num(r["projAwayScore"]),
            "projHome": num(r["projHomeScore"]), "projTotal": num(r["projTotal"]),
            "pOver": num(r["pOver"]), "pAwayRl": num(r["pAwayRl"]),
            "pF5Away": num(r["pF5AwayMl"]), "projF5Total": num(r["projF5Total"]),
            "pF5Over": num(r["pF5Over"]), "pF5AwayRl": num(r["pF5AwayRl"]),
            "pNrfi": num(r["pNrfi"]),
        }
        lines = data.asof_lines(gid, allow_fallback=True)
        rows.extend(grade_game_markets(data, gid, proj, "walkforward_replay", version, lines))

    for p in p_props:
        gid = p["gameId"]
        if game_ids and gid not in game_ids:
            continue
        if months and month_of(p["gameDate"]) not in months:
            continue
        if not data.is_final(gid):
            continue
        if p["propType"] == "K":
            line = num(p["line"])
            if line is None:
                line = live_k_line.get((gid, p["mlbamId"]))
            rows.extend(grade_k_prop(data, gid, p["gameDate"], p["id"],
                                     "walkforward_replay", version, num(p["projValue"]),
                                     num(p["pOver"]), None, line, p["side"], p["mlbamId"],
                                     live_k))
        elif p["propType"] == "HR":
            ph = num(p["pOver"])
            if ph is None:
                continue
            y = data.actual_hr(gid, p["mlbamId"], p["playerName"], hr_idx)
            if y is None:
                continue
            rows.append((gid, p["gameDate"], "hr_prop", p["id"], "walkforward_replay",
                         version, None, round(ph, 5),
                         round(num(p["projValue"]), 4) if num(p["projValue"]) is not None else None,
                         str(num(p["line"]) if p["line"] is not None else 0.5),
                         "HR" if y else "NO_HR", None, None,
                         round(brier(ph, y), 6), None))
    n = executemany(conn, GRADE_SQL, rows)
    print(f"[grade replay {version}] {len(rows)} rows upserted (affected {n})")
    return len(rows)


# --------------------------------------------------------------------------- report

def recover_y(market, row):
    """Recover the canonical binary outcome from a grade row (None => not prob-gradable)."""
    actual = row["actual"]
    if actual is None or row["result"] == "PUSH":
        return None
    if market in ("fg_ml", "fg_rl", "f5_ml", "f5_rl"):
        return 1 if actual == "AWAY" else (0 if actual in ("HOME",) else None)
    if market in ("fg_total", "f5_total"):
        line = num(row["line"])
        at = num(actual)
        if line is None or at is None or at == line:
            return None
        return 1 if at > line else 0
    if market == "nrfi_yrfi":
        return 1 if actual == "NRFI" else (0 if actual == "YRFI" else None)
    if market == "k_prop":
        line = num(row["line"])
        ak = num(actual)
        if line is None or ak is None or ak == line:
            return None
        return 1 if ak > line else 0
    if market == "hr_prop":
        return 1 if actual == "HR" else (0 if actual == "NO_HR" else None)
    return None


def series_metrics(rows, market):
    graded = [r for r in rows if r["correct"] is not None]
    hits = sum(1 for r in graded if int(r["correct"]) == 1)
    briers, lls = [], []
    for r in rows:
        p = num(r["prob"])
        if p is None:
            continue
        y = recover_y(market, r)
        if y is None:
            continue
        briers.append(brier(p, y))
        lls.append(log_loss(p, y))
    errs = [num(r["signedError"]) for r in rows if r["signedError"] is not None]
    return {
        "n": len(rows),
        "graded": len(graded),
        "hit": hits / len(graded) if graded else None,
        "n_prob": len(briers),
        "brier": sum(briers) / len(briers) if briers else None,
        "logloss": sum(lls) / len(lls) if lls else None,
        "mae": sum(abs(e) for e in errs) / len(errs) if errs else None,
        "bias": sum(errs) / len(errs) if errs else None,
    }


def write_report(conn, p1_version, p2_version, banner=None):
    grades = qall(conn, """
        SELECT gameDate, market, source, modelVersion, prob, line, actual, result,
               correct, brier, signedError
        FROM mlb_replay_grades WHERE gameDate >= %s""", (SEASON_START,))
    calib_rows = qall(conn, """
        SELECT gameDate, calibMeta FROM mlb_replay_projections
        WHERE modelVersion=%s AND calibMeta IS NOT NULL""", (p2_version,))
    metas = {}
    for r in calib_rows:
        m = month_of(r["gameDate"])
        if m not in metas:
            try:
                metas[m] = json.loads(r["calibMeta"])
            except (TypeError, json.JSONDecodeError):
                pass

    def series_of(row):
        if row["source"] == "live_pregame":
            return "live"
        if row["modelVersion"] == p1_version:
            return "p1"
        if row["modelVersion"] == p2_version:
            return "p2"
        return None

    grouped = defaultdict(list)  # (market, month, series) -> rows
    for r in grades:
        s = series_of(r)
        if s is None:
            continue
        grouped[(r["market"], month_of(r["gameDate"]), s)].append(r)

    months = sorted({k[1] for k in grouped})
    lines_out = ["# Walk-forward replay: before / after calibration", ""]
    if banner:
        lines_out += [f"> **{banner}**", ""]
    lines_out += [
        f"Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} by "
        f"`tools/replay/calibrate_and_grade.py`. Series: `live` = live_pregame stored "
        f"projections; `p1` = raw fixed model (`{p1_version}`); `p2` = walk-forward "
        f"calibrated (`{p2_version}`). Grading rules per GRADING-REPORT.md; push/tie "
        "excluded from hit rate and probability metrics. `prob` is the canonical-side "
        "probability (away / over / NRFI / HR).", "",
        "## Fitted calibration values per month", "",
        "| month | seed | league_env_mult | T_fg | T_f5 | k_factor | hr_factor | "
        "total_sd | f5_total_sd | nrfi mode | n_train |", "|---|" + "---|" * 10,
    ]
    for m in months:
        meta = metas.get(m)
        if not meta:
            lines_out.append(f"| {m} | - | (no p2 rows) | | | | | | | | |")
            continue
        lines_out.append(
            f"| {m} | {'yes' if meta.get('seed') else 'no'} | {meta.get('league_env_mult')} | "
            f"{meta.get('T_fg')} | {meta.get('T_f5')} | {meta.get('k_factor')} | "
            f"{meta.get('hr_factor')} | {meta.get('total_sd')} | {meta.get('f5_total_sd')} | "
            f"{(meta.get('nrfi') or {}).get('mode')} | {meta.get('n_train_games')} |")
    lines_out += ["",
                  "Transformations: totals recentred via "
                  "`pOver2=Phi(Phi^-1(pOver1)+(projTotal2-projTotal1)/sd)` with the sd above; "
                  "RL probabilities pass through unchanged; K props re-Poissoned at "
                  "`mu*k_factor` with push-excluded over probability; HR probabilities scaled "
                  "by hr_factor (clamped to [0.0001, 0.99]).", ""]

    for market in MARKETS:
        lines_out += [f"## {market}", "",
                      "| month | series | n | graded | hit | brier | logloss | mae | bias |",
                      "|---|---|---|---|---|---|---|---|---|"]
        any_row = False
        for m in months:
            for s in ("live", "p1", "p2"):
                rows = grouped.get((market, m, s))
                if not rows:
                    continue
                any_row = True
                mm = series_metrics(rows, market)
                lines_out.append(
                    f"| {m} | {s} | {mm['n']} | {mm['graded']} | "
                    f"{fmt(mm['hit'], 3)} | {fmt(mm['brier'])} | {fmt(mm['logloss'])} | "
                    f"{fmt(mm['mae'], 3)} | {fmt(mm['bias'], 3)} |")
        if not any_row:
            lines_out.append("| - | - | 0 | | | | | | |")
        lines_out.append("")

    os.makedirs(os.path.dirname(REPORT_PATH), exist_ok=True)
    with open(REPORT_PATH, "w") as f:
        f.write("\n".join(lines_out) + "\n")
    print(f"[report] wrote {REPORT_PATH} ({len(lines_out)} lines)")
    return REPORT_PATH


# --------------------------------------------------------------------------- CLI

def detect_p1_version(conn, explicit=None):
    if explicit:
        return explicit
    rows = qall(conn, """
        SELECT DISTINCT modelVersion FROM mlb_replay_projections
        WHERE modelVersion LIKE %s""", ("%-p1",))
    versions = [r["modelVersion"] for r in rows]
    if len(versions) == 1:
        return versions[0]
    raise SystemExit(
        f"cannot auto-detect pass-1 modelVersion (found {versions}); pass --p1-version")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("command", choices=["fit", "pass2", "grade", "report", "all"])
    ap.add_argument("--p1-version", help="pass-1 modelVersion (auto-detected if unique)")
    ap.add_argument("--months", help="comma list e.g. 2026-05,2026-06 (scope pass2/grade)")
    ap.add_argument("--game-ids", help="comma list of games.id to grade (smoke scoping)")
    ap.add_argument("--replay-games-only", action="store_true",
                    help="grade live source only for games that have replay pass-1 rows")
    ap.add_argument("--sources", default="live,replay",
                    help="grade: which sources (live,replay)")
    ap.add_argument("--cache-dir", default=DEFAULT_CACHE_DIR)
    ap.add_argument("--banner", help="banner line for before-after.md (e.g. smoke note)")
    args = ap.parse_args()

    months = set(args.months.split(",")) if args.months else None
    game_ids = set(int(x) for x in args.game_ids.split(",")) if args.game_ids else None

    conn = connect_db()
    data = DataStore(conn, args.cache_dir)
    p1v = detect_p1_version(conn, args.p1_version)
    p2v = p1v[:-3] + "-p2" if p1v.endswith("-p1") else p1v + "-p2"
    print(f"[main] pass-1 version {p1v} -> pass-2 version {p2v}")

    p1_games = data.load_p1_games(p1v)
    p1_props = data.load_p1_props(p1v)
    all_months = sorted({month_of(r["gameDate"]) for r in p1_games})
    print(f"[main] {len(p1_games)} pass-1 game rows, {len(p1_props)} prop rows, "
          f"months {all_months}")

    nrfi_wf = NrfiWalkForward(args.cache_dir)
    if nrfi_wf.error:
        print(f"[warn] NRFI walk-forward falls back to prior-only passthrough: "
              f"{nrfi_wf.error}", file=sys.stderr)

    params = None
    if args.command in ("fit", "pass2", "all"):
        params = build_month_params(data, p1_games, p1_props, all_months, nrfi_wf)
        for m in sorted(params):
            show = {k: v for k, v in params[m].items()
                    if not k.startswith("_") and k != "nrfi"}
            show["nrfi_mode"] = (params[m].get("nrfi") or {}).get("mode")
            print(f"[fit] {m}: {json.dumps(show)}")

    if args.command in ("pass2", "all"):
        write_pass2(conn, data, p1_games, p1_props, params, nrfi_wf, p2v, months)

    if args.command in ("grade", "all"):
        replay_ids = {r["gameId"] for r in p1_games}
        live_ids = game_ids or (replay_ids if args.replay_games_only else None)
        srcs = set(args.sources.split(","))
        if "live" in srcs:
            grade_live(conn, data, live_ids, months)
        if "replay" in srcs:
            grade_replay(conn, data, p1v, game_ids, months)
            grade_replay(conn, data, p2v, game_ids, months)

    if args.command in ("report", "all"):
        write_report(conn, p1v, p2v, args.banner)

    conn.close()


if __name__ == "__main__":
    main()
