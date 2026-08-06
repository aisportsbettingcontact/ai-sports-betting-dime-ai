"""Smoke test for AsOfFeatureStore (Phase 5 replay shared interface).

Usage:
    python smoke_asof_features.py <cache_dir> [game_id ...]

Defaults to the protocol smoke set:
  2251450  2026-07-24 COL@MIL   (late-season, dome, DB-linked closing lines)
  2250007  2026-03-26 PIT@NYM   (opening week — 2025-prior-dominated features)
  2250620  2026-05-15 PHI@PIT   (May game)

Also prints an as-of proof: a July starter's blended k9 at his July cutoff vs
the same pitcher's k9 computed over his FULL 2026 game log (season-final view),
which must differ because the as-of value excludes later starts.
"""

import json
import sys

from asof_features import AsOfFeatureStore, parse_ip

DEFAULT_GAMES = [2251450, 2250007, 2250620]


def show(store: AsOfFeatureStore, game_id: int) -> None:
    meta = store.game_meta(game_id)
    print("=" * 78)
    print(f"GAME {game_id}: {meta['away']}@{meta['home']} {meta['gameDate']} "
          f"gamePk={meta['gamePk']} startUtcMs={meta['startUtcMs']}")
    print(f"starters: away={meta['awayStarterId']}({meta['awayStarterHand']}) "
          f"home={meta['homeStarterId']}({meta['homeStarterHand']})")

    kwargs = store.project_game_kwargs(game_id)
    printable = dict(kwargs)
    printable["game_date"] = kwargs["game_date"].strftime("%Y-%m-%d")
    print("\n-- project_game_kwargs --")
    print(json.dumps(printable, indent=2, default=str))

    for side in ("away", "home"):
        print(f"\n-- kprop_inputs ({side}) --")
        print(json.dumps(store.kprop_inputs(game_id, side), indent=2))

    hr = store.hrprop_inputs(game_id)
    print(f"\n-- hrprop_inputs ({len(hr)} batters; first 4 shown) --")
    print(json.dumps(hr[:4], indent=2))

    print("\n-- nrfi_features --")
    print(json.dumps(store.nrfi_features(game_id), indent=2))


def asof_proof(store: AsOfFeatureStore, game_id: int) -> None:
    """Show that a July pitcher's as-of k9 differs from his season-final k9."""
    meta = store.game_meta(game_id)
    sp = meta["awayStarterId"]
    p = store.pitcher_asof(sp, meta["startUtcMs"])
    log = store._pitcher_log_2026(sp)
    ip = k = 0.0
    for s in log:
        st = s.get("stat") or {}
        ip += parse_ip(st.get("inningsPitched")) or 0.0
        k += int(st.get("strikeOuts") or 0)
    season_final_k9 = 9.0 * k / ip if ip else None
    s26 = p.get("season2026_asof") or {}
    print("=" * 78)
    print(f"AS-OF PROOF — pitcher {sp} ({store._person(sp)['fullName']}), "
          f"cutoff {meta['gameDate']} ({meta['away']}@{meta['home']}):")
    print(f"  2026 starts as-of cutoff : {p['starts_2026']} (full log: "
          f"{sum(1 for s in log if int((s.get('stat') or {}).get('gamesStarted') or 0) >= 1)})")
    print(f"  k9 season-2026 as-of     : {s26.get('k9'):.4f}" if s26.get("k9") else "  k9 season-2026 as-of     : n/a")
    print(f"  k9 blended as-of (used)  : {p['k9']:.4f}  [source={p['source']}]")
    print(f"  k9 full-season-final     : {season_final_k9:.4f}")
    if s26.get("k9") is not None and season_final_k9 is not None:
        diff = abs(s26["k9"] - season_final_k9)
        print(f"  |as-of − season-final|   : {diff:.4f}  -> {'DIFFERS (as-of confirmed)' if diff > 1e-9 else 'IDENTICAL (check!)'}")


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    cache_dir = sys.argv[1]
    game_ids = [int(a) for a in sys.argv[2:]] or DEFAULT_GAMES
    store = AsOfFeatureStore(cache_dir)
    for gid in game_ids:
        show(store, gid)
    # as-of proof on the July game if present
    july = [g for g in game_ids if g == 2251450] or game_ids[:1]
    asof_proof(store, july[0])


if __name__ == "__main__":
    main()
