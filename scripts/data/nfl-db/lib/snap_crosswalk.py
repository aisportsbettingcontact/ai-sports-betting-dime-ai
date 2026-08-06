"""PFR player id -> nflverse gsis_id crosswalk for the snap_counts feed.

Why this module exists
----------------------
nflverse's ``snap_counts`` release carries **no** ``gsis_id``. Its only player key
is ``pfr_player_id`` (Pro-Football-Reference's id, e.g. ``AndeAl01``). ``build_db.py``
originally resolved that key through ``raw/players.csv``'s ``pfr_id`` column alone,
which left **227 of 324,611 snap rows (30 distinct players) with a NULL gsis_id** --
orphaned from the ``player`` dimension, so any prop model joining snaps to players
silently dropped them.

Root cause: ``players.csv`` simply has an empty ``pfr_id`` for those 30 players
(2,481 of its 25,035 rows have a blank ``pfr_id``). It is not a mismatch or a
collision -- the value was never populated. Two of the 30 have a further problem:
``players.csv`` records a *different* pfr id than the snap feed uses (see
``KNOWN_SOURCE_CONTRADICTIONS``).

Resolution strategy, in descending order of authority
-----------------------------------------------------
=====  =========================================================================
Tier   Rule
=====  =========================================================================
0a     Direct ``pfr_id`` -> ``gsis_id`` from ``players.csv``.
0b     Direct ``pfr_id`` -> ``gsis_id`` from ``rosters.csv`` (fills gaps in 0a).
1      Name-prefix inference. A PFR id is ``<Last4><First2><NN>``; reconstruct the
       prefix from every name variant in players/rosters/player_stats and accept
       it only when exactly one candidate gsis for that prefix is not already
       claimed by a different pfr id.
2      As tier 1, but when several unclaimed candidates remain, keep only those
       with a documented season >= ``SNAP_ERA_START``. snap_counts does not exist
       before then, so an older-only player cannot be the referent. Accept only
       if that leaves exactly one.
3      ``MANUAL_PFR_TO_GSIS`` -- hand-resolved, each with cited evidence.
=====  =========================================================================

Tiers 1 and 2 are not guesses: leave-one-out back-testing over the 7,065 snap-count
pfr ids that *do* have a direct mapping gives 5,644/5,645 (99.982%) for tier 1 and
462/462 (100.000%) for tier 2. See ``docs/audits/2026-07-27-nfl-db-completion/
reports/B1-snap-crosswalk.md`` and re-run with ``python3 -m lib.snap_crosswalk
--backtest``.

Every one of the 30 previously-orphaned players is additionally corroborated
per-row against nflverse ``weekly_rosters``: for all 227 snap rows the resolved
gsis_id is on that exact team in that exact week. That check is in the report's
Reproduce section, not in this module, because it needs network access.

This module has **no import-time side effects**. Nothing is read from disk until
``build_pfr_to_gsis`` or ``resolve`` is called.
"""

from __future__ import annotations

import csv
import os
import re
import sys
from collections import defaultdict
from typing import Iterable, Optional

__all__ = [
    "MANUAL_PFR_TO_GSIS",
    "UNRESOLVABLE",
    "KNOWN_SOURCE_CONTRADICTIONS",
    "build_pfr_to_gsis",
    "resolve",
    "pfr_prefix",
]

# --------------------------------------------------------------------------- paths
_LIB_DIR = os.path.dirname(os.path.abspath(__file__))
_NFLDB_DIR = os.path.dirname(_LIB_DIR)
RAW_DIR = os.path.join(_NFLDB_DIR, "raw")

DEFAULT_PLAYERS_CSV = os.path.join(RAW_DIR, "players.csv")
DEFAULT_ROSTERS_CSV = os.path.join(RAW_DIR, "rosters.csv")
DEFAULT_PLAYER_STATS_CSV = os.path.join(RAW_DIR, "player_stats.csv")
DEFAULT_SNAP_COUNTS_CSV = os.path.join(RAW_DIR, "snap_counts.csv")

#: snap_counts has no rows before this season, so a candidate whose entire
#: documented career predates it cannot be the referent of a snap-count pfr id.
SNAP_ERA_START = 2012

# --------------------------------------------------------------------------- manual
#: pfr_id -> (gsis_id, one-line justification citing the evidence)
#:
#: Only ids that tiers 0-2 cannot reach. Each was verified against nflverse
#: weekly_rosters (season+week+team+status), and the rejected same-name
#: candidates were shown absent or inactive on that team in that week.
MANUAL_PFR_TO_GSIS: dict[str, tuple[str, str]] = {
    "BrowJo03": (
        "00-0032835",
        "PFR 'Jonathan Brown' is nflverse 'Jon Brown' (players.csv first_name=Jonathan), K, "
        "Louisville; weekly_rosters 2020 has him ACT/A01 on JAX in wk6 only -- the single snap "
        "row (JAX wk6 vs DET, 4 ST snaps) -- and player_stats.csv carries 00-0032835 for game "
        "2020_06_DET_JAX. The other two unclaimed Jo* Browns are absent from JAX that week.",
    ),
    "CartTJ00": (
        "00-0037052",
        "Two T.J. Carters on the 2022 Rams. weekly_rosters 2022 has 00-0037052 (TCU, DB #20) "
        "ACT/A01 in wk16 and wk18 while 00-0035916 is DEV/P01 in both -- exactly CartTJ00's two "
        "snap rows; snap position 'DB' matches; player_stats.csv has a 00-0037052 CB line in "
        "game 2022_16_DEN_LA.",
    ),
    "CartTJ01": (
        "00-0035916",
        "Mirror of CartTJ00: weekly_rosters 2022 has 00-0035916 (Kentucky, DL #98) ACT in wk13 "
        "and wk15 while 00-0037052 is DEV/P01 in both -- exactly CartTJ01's two snap rows; snap "
        "position 'DE' matches; depth_charts.csv lists 00-0035916 as the 2022 LA DE.",
    ),
    "CoopBu00": (
        "00-0039245",
        "PFR 'Bump Cooper' is nflverse 'Ryan Cooper Jr.': ESPN athlete 5085881 displayName is "
        "'Bump Cooper' (CB, Oregon State) and 5085881 is the espn_id players.csv records for "
        "00-0039245; depth_charts.csv also maps the name 'Bump Cooper'/5085881 to that gsis. "
        "weekly_rosters 2024 has him ACT/A01 on BAL in wk8 only (practice-squad elevation; DEV "
        "every other BAL week) -- the single snap row. See KNOWN_SOURCE_CONTRADICTIONS.",
    ),
    "JoneJa16": (
        "00-0040317",
        "players.csv and rosters.csv record pfr_id JoneJa15 for 00-0040317 (Jacoby Jones, WR, "
        "WAS, 2025) but JoneJa15 appears 0 times in snap_counts.csv and JoneJa16 once. "
        "player_stats.csv has a 00-0040317 WR line in game 2025_11_WAS_MIA -- the exact game of "
        "the single snap row -- and weekly_rosters 2025 wk11 lists him ACT/A01 on WAS at WR #84. "
        "See KNOWN_SOURCE_CONTRADICTIONS.",
    ),
    "LoveJo02": (
        "00-0035161",
        "Four John Lovetts in the player dimension; only 00-0035161 (Princeton, #45) is ever on "
        "GB. weekly_rosters 2020 has him ACT/A01 in all eight snap weeks (1-4, 6-9), listed at "
        "TE in wks 2-7 which matches the snap position; the other three are absent from GB in "
        "every one of those weeks.",
    ),
    "MillJo01": (
        "00-0028349",
        "Two Jordan Millers. weekly_rosters 2013 has 00-0028349 (DT #96) ACT/A01 on JAX in wk16 "
        "and wk17 -- exactly the two snap rows -- and rosters.csv confirms 2013 JAX DT. The "
        "other candidate 00-0039570 is a 2024 Denver rookie with no 2013 existence.",
    ),
    "OkoyCJ00": (
        "00-0039176",
        "PFR 'CJ Okoye' is nflverse 'Basil Okoye': depth_charts.csv carries the alias 'CJ Okoye' "
        "on gsis 00-0039176 with espn_id 5144942, the same espn_id players.csv records for that "
        "gsis. weekly_rosters 2025 has him ACT/A01 on BAL in all 12 snap weeks and "
        "player_stats.csv lists 00-0039176 as a 2025 BAL DT; the other Okoye lineman "
        "(00-0034696) is absent from BAL in every one of those weeks.",
    ),
    "WillCh06": (
        "00-0026691",
        "Three modern Chris Williamses. Only 00-0026691 (WR #82) is on CHI in 2014, and "
        "weekly_rosters puts him on the active roster (status_description_abbr A01) in all seven "
        "snap weeks; the other two are absent from CHI in every one. Snap position 'WR' matches.",
    ),
    "WillDa14": (
        "00-0035892",
        "Six modern Darryl/Darrell Williams candidates. weekly_rosters 2022 wk4 has only "
        "00-0035892 (Mississippi State, OL #60) on JAX, status ACT/A01 -- his single active week "
        "and the single snap row (position C, 3 ST snaps); the other five are absent.",
    ),
    "WillIs02": (
        "00-0033161",
        "Two Isaiah Williamses. weekly_rosters 2021 has 00-0033161 (Akron, OL, depth_chart "
        "position G, #71) ACT/A01 on NYJ in all four snap weeks (4, 5, 7, 16) and the snap "
        "position 'G' matches; 00-0026864 is a WR whose last documented season is 2012 and who "
        "never appears on NYJ.",
    ),
}

#: pfr_id -> reason. Empty: every snap_counts pfr id resolves to a gsis_id.
UNRESOLVABLE: dict[str, str] = {}

#: Places where nflverse's own ``pfr_id`` disagrees with the pfr id PFR uses in the
#: snap_counts feed. Recorded rather than silently reconciled (CONTEXT.md rule 4).
#: gsis_id -> (pfr id per players.csv, pfr id per snap_counts.csv, note)
KNOWN_SOURCE_CONTRADICTIONS: dict[str, tuple[str, str, str]] = {
    "00-0039245": (
        "CoopRy00",
        "CoopBu00",
        "PFR renders him as 'Bump Cooper', nflverse as 'Ryan Cooper Jr.'. CoopRy00 occurs 0 "
        "times in snap_counts.csv, CoopBu00 once. Identity is not in doubt (shared espn_id "
        "5085881); only the id string differs.",
    ),
    "00-0040317": (
        "JoneJa15",
        "JoneJa16",
        "Same player (Jacoby Jones, WAS 2025, espn 5083297), different PFR disambiguation "
        "suffix. JoneJa15 occurs 0 times in snap_counts.csv, JoneJa16 once. nflverse's stored "
        "value is stale relative to the snap feed.",
    ),
}

# --------------------------------------------------------------------------- helpers
_NON_ALPHA = re.compile(r"[^A-Za-z]")
_PFR_SPLIT = re.compile(r"^(.*?)(\d{2})$")


def _alpha(value: Optional[str]) -> str:
    return _NON_ALPHA.sub("", value or "")


def pfr_prefix(first: Optional[str], last: Optional[str]) -> Optional[str]:
    """Reconstruct the ``<Last4><First2>`` stem of a PFR player id from a name.

    PFR keeps the source capitalisation, so ``McCray, Robert`` -> ``McCrRo`` and
    ``Carter, T.J.`` -> ``CartTJ``. Returns ``None`` when the name is too short.
    """
    surname, forename = _alpha(last), _alpha(first)
    if len(surname) < 2 or len(forename) < 2:
        return None
    stem = surname[:4]
    stem = stem[0].upper() + stem[1:]
    initials = forename[:2]
    return stem + initials[0].upper() + initials[1:]


def _split_pfr_id(pfr_id: str) -> tuple[Optional[str], Optional[str]]:
    match = _PFR_SPLIT.match(pfr_id or "")
    return (match.group(1), match.group(2)) if match else (None, None)


def _read_columns(path: str, columns: Iterable[str]):
    """Yield tuples of the named columns. Missing columns yield ''. Missing file -> nothing."""
    wanted = list(columns)
    if not path or not os.path.exists(path):
        return
    with open(path, newline="", encoding="utf-8") as handle:
        reader = csv.reader(handle)
        try:
            header = next(reader)
        except StopIteration:
            return
        index = {name: i for i, name in enumerate(header)}
        picks = [index.get(name, -1) for name in wanted]
        width = len(header)
        for row in reader:
            if len(row) < width:
                row = row + [""] * (width - len(row))
            yield tuple("" if i < 0 else row[i] for i in picks)


def _snap_count_pfr_ids(snap_counts_csv: str) -> set[str]:
    return {pfr for (pfr,) in _read_columns(snap_counts_csv, ["pfr_player_id"]) if pfr}


def _as_season(value: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


# --------------------------------------------------------------------------- index
def _build_name_index(
    players_csv: str, rosters_csv: str, player_stats_csv: str
) -> tuple[dict[str, set[str]], dict[str, int]]:
    """``(pfr_prefix -> {gsis_id}, gsis_id -> latest documented season)``.

    Every name variant each source offers is indexed -- display/full name, the
    ``first_name``/``last_name`` pair, and ``football_name`` -- because PFR's id is
    built from whichever spelling PFR chose, and that is often not nflverse's
    ``display_name`` (``Nathan Meadors`` vs ``Nate Meadors``, ``Rod Williams`` vs
    PFR's ``Rodney Williams``).
    """
    candidates: dict[str, set[str]] = defaultdict(set)
    latest_season: dict[str, int] = defaultdict(int)

    def note(gsis_id: str, first: Optional[str], last: Optional[str], season: str = "") -> None:
        if not gsis_id:
            return
        prefix = pfr_prefix(first, last)
        if prefix:
            candidates[prefix].add(gsis_id)
        year = _as_season(season)
        if year > latest_season[gsis_id]:
            latest_season[gsis_id] = year

    def ingest(path: str, columns: list[str]) -> None:
        for gsis_id, whole, first, last, football, season in _read_columns(path, columns):
            parts = (whole or "").split()
            surname = last or (parts[-1] if parts else "")
            for forename in (first, football, parts[0] if parts else ""):
                note(gsis_id, forename, surname, season)
            if len(parts) >= 2:
                note(gsis_id, parts[0], parts[-1], season)

    ingest(players_csv, ["gsis_id", "display_name", "first_name", "last_name",
                         "football_name", "last_season"])
    ingest(rosters_csv, ["gsis_id", "full_name", "first_name", "last_name",
                         "football_name", "season"])
    for gsis_id, short_name, display, season in _read_columns(
        player_stats_csv, ["player_id", "player_name", "player_display_name", "season"]
    ):
        parts = (display or "").split()
        if len(parts) >= 2:
            note(gsis_id, parts[0], parts[-1], season)
        abbreviated = (short_name or "").replace(".", " ").split()
        if len(abbreviated) >= 2:
            note(gsis_id, abbreviated[0], abbreviated[-1], season)
    return candidates, latest_season


def _infer(
    pfr_id: str,
    candidates: dict[str, set[str]],
    latest_season: dict[str, int],
    claimed: dict[str, set[str]],
) -> tuple[Optional[str], Optional[str]]:
    """Tier 1/2 inference for one pfr id. Returns ``(gsis_id, tier)``."""
    prefix, _ = _split_pfr_id(pfr_id)
    if not prefix:
        return None, None
    pool = candidates.get(prefix)
    if not pool:
        return None, None
    free = pool - claimed.get(prefix, frozenset())
    if len(free) == 1:
        return next(iter(free)), "tier1"
    if not free:
        return None, None
    in_era = {g for g in free if latest_season.get(g, 0) >= SNAP_ERA_START}
    if len(in_era) == 1:
        return next(iter(in_era)), "tier2"
    return None, None


# --------------------------------------------------------------------------- build
#: Tier hit counts from the most recent ``build_pfr_to_gsis`` call. Diagnostics only.
LAST_BUILD_STATS: dict[str, int] = {}


def build_pfr_to_gsis(
    players_csv: str = DEFAULT_PLAYERS_CSV,
    rosters_csv: str = DEFAULT_ROSTERS_CSV,
    player_stats_csv: str = DEFAULT_PLAYER_STATS_CSV,
    targets: Optional[Iterable[str]] = None,
    snap_counts_csv: str = DEFAULT_SNAP_COUNTS_CSV,
) -> dict[str, str]:
    """Return the full ``pfr_player_id -> gsis_id`` crosswalk.

    Built from all three sources rather than ``players.csv`` alone -- see the module
    docstring for the tier rules.

    ``targets`` is the set of pfr ids the name-inference tiers are asked to cover.
    Tiers 1-3 only fire for ids that have no direct mapping, so the target set has
    to be supplied from outside; it defaults to every ``pfr_player_id`` in
    ``snap_counts_csv`` (this crosswalk's reason for existing), and to the manual
    table's keys when that file is not present.
    """
    # ---- tier 0a/0b: direct pfr_id columns
    crosswalk: dict[str, str] = {}
    for pfr_id, gsis_id in _read_columns(players_csv, ["pfr_id", "gsis_id"]):
        if pfr_id and gsis_id:
            crosswalk.setdefault(pfr_id, gsis_id)
    direct_from_players = len(crosswalk)
    for pfr_id, gsis_id in _read_columns(rosters_csv, ["pfr_id", "gsis_id"]):
        if pfr_id and gsis_id:
            crosswalk.setdefault(pfr_id, gsis_id)
    LAST_BUILD_STATS.clear()
    LAST_BUILD_STATS.update(
        players_direct=direct_from_players,
        rosters_direct=len(crosswalk) - direct_from_players,
        tier1=0,
        tier2=0,
        manual=len(MANUAL_PFR_TO_GSIS),
    )

    if targets is None:
        targets = _snap_count_pfr_ids(snap_counts_csv) or set(MANUAL_PFR_TO_GSIS)
    pending = {pfr for pfr in targets if pfr and pfr not in crosswalk}
    if not pending:
        _apply_manual(crosswalk)
        return crosswalk

    # ---- tiers 1-2: name-prefix inference
    candidates, latest_season = _build_name_index(players_csv, rosters_csv, player_stats_csv)
    claimed: dict[str, set[str]] = defaultdict(set)
    for pfr_id, gsis_id in crosswalk.items():
        prefix, _ = _split_pfr_id(pfr_id)
        if prefix:
            claimed[prefix].add(gsis_id)

    for pfr_id in sorted(pending):
        gsis_id, tier = _infer(pfr_id, candidates, latest_season, claimed)
        if gsis_id:
            crosswalk[pfr_id] = gsis_id
            LAST_BUILD_STATS[tier] += 1

    _apply_manual(crosswalk)
    return crosswalk


def _apply_manual(crosswalk: dict[str, str]) -> None:
    """Tier 3. Manual entries win, so a bad automated inference can always be pinned."""
    for pfr_id, (gsis_id, _justification) in MANUAL_PFR_TO_GSIS.items():
        crosswalk[pfr_id] = gsis_id


# --------------------------------------------------------------------------- resolve
_CACHE: Optional[dict[str, str]] = None


def resolve(pfr_id: str) -> Optional[str]:
    """Return the ``gsis_id`` for a PFR player id, or ``None`` if unresolvable.

    Builds the crosswalk on first use from the default ``raw/*.csv`` paths and
    caches it for the life of the process.
    """
    global _CACHE
    if _CACHE is None:
        _CACHE = build_pfr_to_gsis()
    return _CACHE.get(pfr_id)


# --------------------------------------------------------------------------- checks
def _self_check(snap_counts_csv: str = DEFAULT_SNAP_COUNTS_CSV) -> int:
    crosswalk = build_pfr_to_gsis(snap_counts_csv=snap_counts_csv)
    tiers = dict(LAST_BUILD_STATS)

    total_rows = 0
    unresolved_rows = 0
    unresolved_ids: dict[str, int] = defaultdict(int)
    resolved_ids: set[str] = set()
    for (pfr_id,) in _read_columns(snap_counts_csv, ["pfr_player_id"]):
        total_rows += 1
        if crosswalk.get(pfr_id):
            resolved_ids.add(pfr_id)
        else:
            unresolved_rows += 1
            unresolved_ids[pfr_id] += 1

    if total_rows == 0:
        print(f"FAIL  no rows read from {snap_counts_csv}", file=sys.stderr)
        return 2

    print(f"snap_counts.csv          {snap_counts_csv}")
    print(f"crosswalk entries        {len(crosswalk)}")
    print(f"  tier 0a players.csv    {tiers.get('players_direct', 0)}")
    print(f"  tier 0b rosters.csv    {tiers.get('rosters_direct', 0)}")
    print(f"  tier 1  name-prefix    {tiers.get('tier1', 0)}")
    print(f"  tier 2  era-filtered   {tiers.get('tier2', 0)}")
    print(f"  tier 3  manual         {len(MANUAL_PFR_TO_GSIS)}")
    print(f"snap rows                {total_rows}")
    print(f"snap rows resolved       {total_rows - unresolved_rows}")
    print(f"snap rows UNRESOLVED     {unresolved_rows}")
    print(f"distinct pfr ids         {len(resolved_ids) + len(unresolved_ids)}")
    print(f"distinct ids UNRESOLVED  {len(unresolved_ids)}")
    print(f"UNRESOLVABLE constant    {len(UNRESOLVABLE)}")

    if unresolved_ids:
        print("\nUNRESOLVED:", file=sys.stderr)
        for pfr_id, count in sorted(unresolved_ids.items(), key=lambda kv: -kv[1]):
            print(f"  {pfr_id or '<blank>'}  {count} rows", file=sys.stderr)
        return 1
    if UNRESOLVABLE:
        print("\nUNRESOLVABLE is non-empty:", file=sys.stderr)
        for pfr_id, reason in sorted(UNRESOLVABLE.items()):
            print(f"  {pfr_id}: {reason}", file=sys.stderr)
        return 1
    print("\nOK  every snap_counts row resolves to a gsis_id")
    return 0


def _back_test(snap_counts_csv: str = DEFAULT_SNAP_COUNTS_CSV) -> int:
    """Leave-one-out precision of tiers 1-2 over snap ids that have a direct mapping.

    For each snap-count pfr id that ``players.csv``/``rosters.csv`` already resolve,
    hide that mapping and ask the inference tiers to reproduce it. This measures the
    tiers on exactly the population they are applied to.
    """
    snap_ids = _snap_count_pfr_ids(snap_counts_csv)
    direct = build_pfr_to_gsis(targets=(), snap_counts_csv=snap_counts_csv)
    for pfr_id in MANUAL_PFR_TO_GSIS:                  # tier 3 is not under test
        direct.pop(pfr_id, None)
    candidates, latest_season = _build_name_index(
        DEFAULT_PLAYERS_CSV, DEFAULT_ROSTERS_CSV, DEFAULT_PLAYER_STATS_CSV
    )
    claimed: dict[str, set[str]] = defaultdict(set)
    for pfr_id, gsis_id in direct.items():
        prefix, _ = _split_pfr_id(pfr_id)
        if prefix:
            claimed[prefix].add(gsis_id)

    testable = sorted(pfr_id for pfr_id in snap_ids if pfr_id in direct)
    counts = {"tier1": [0, 0], "tier2": [0, 0]}        # tier -> [agree, disagree]
    abstain = 0
    mismatches: list[tuple[str, str, str, str]] = []
    for pfr_id in testable:
        truth = direct[pfr_id]
        prefix, _ = _split_pfr_id(pfr_id)
        # hide this mapping only if no other pfr id claims the same gsis under it
        others = {g for p, g in direct.items()
                  if p != pfr_id and _split_pfr_id(p)[0] == prefix}
        saved = claimed[prefix]
        claimed[prefix] = others
        guess, tier = _infer(pfr_id, candidates, latest_season, claimed)
        claimed[prefix] = saved
        if guess is None:
            abstain += 1
            continue
        counts[tier][0 if guess == truth else 1] += 1
        if guess != truth:
            mismatches.append((pfr_id, tier, truth, guess))

    agree = sum(v[0] for v in counts.values())
    disagree = sum(v[1] for v in counts.values())
    produced = agree + disagree
    print(f"testable snap pfr ids with a direct mapping: {len(testable)}")
    for tier, (ok, bad) in counts.items():
        total = ok + bad
        rate = f"{ok / total * 100:.3f}%" if total else "n/a"
        print(f"  {tier}: produced {total}  agree {ok}  disagree {bad}  precision {rate}")
    rate = f"{agree / produced * 100:.3f}%" if produced else "n/a"
    print(f"  combined: produced {produced}  agree {agree}  disagree {disagree}  "
          f"precision {rate}  abstain {abstain}")
    for pfr_id, tier, truth, guess in mismatches[:25]:
        print(f"  MISMATCH {pfr_id} ({tier}): direct={truth} inferred={guess}")
    return 0


if __name__ == "__main__":
    if "--backtest" in sys.argv:
        sys.exit(_back_test())
    sys.exit(_self_check())
