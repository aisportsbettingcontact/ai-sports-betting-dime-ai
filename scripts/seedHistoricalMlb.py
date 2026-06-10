#!/usr/bin/env python3.11
"""
seedHistoricalMlb.py
====================
Seeds the DB with 2024+2025 historical MLB games from the fetched JSON.
Each game is inserted as a historical record with:
  - actualAwayScore / actualHomeScore (final scores)
  - actualF5AwayScore / actualF5HomeScore (F5 scores)
  - nrfiActualResult (NRFI/YRFI)
  - gameStatus = 'final'
  - sport = 'MLB'
  - fileId = 0 (MLB convention)
  - All model/odds fields = NULL (historical only)

Also updates 2026 games in the DB with actualF5 scores and nrfiActualResult
where those fields are missing.

Logging: [INPUT] [STEP] [STATE] [OUTPUT] [VERIFY] [ERROR] [WARN]
"""

import json
import os
import sys

import mysql.connector

INPUT_FILE = "/home/ubuntu/mlb_historical_results.json"
DATABASE_URL = os.environ.get("DATABASE_URL", "")


def parse_db_url(url: str) -> dict:
    url = url.replace("mysql2://", "mysql://").replace("mysql://", "")
    user_pass, rest = url.split("@", 1)
    user, password = user_pass.split(":", 1)
    host_port, dbname = rest.split("/", 1)
    if ":" in host_port:
        host, port = host_port.split(":", 1)
        port = int(port)
    else:
        host, port = host_port, 3306
    dbname = dbname.split("?")[0]
    return {
        "host": host,
        "port": port,
        "user": user,
        "password": password,
        "database": dbname,
    }


def get_conn():
    cfg = parse_db_url(DATABASE_URL)
    return mysql.connector.connect(
        host=cfg["host"],
        port=cfg["port"],
        user=cfg["user"],
        password=cfg["password"],
        database=cfg["database"],
        ssl_disabled=False,
        connection_timeout=30,
    )


def get_existing_game_pks(conn) -> set:
    cur = conn.cursor()
    cur.execute(
        "SELECT mlbGamePk FROM games WHERE sport = 'MLB' AND mlbGamePk IS NOT NULL"
    )
    rows = cur.fetchall()
    cur.close()
    return {r[0] for r in rows}


def insert_historical_game(conn, game: dict) -> str:
    """Insert a single historical game. Returns 'inserted', 'duplicate', or 'error:<msg>'"""
    game_pk = game["gamePk"]
    game_date = game["gameDate"]
    away = game["awayTeam"]
    home = game["homeTeam"]
    away_fin = game["awayFinalScore"]
    home_fin = game["homeFinalScore"]
    away_f5 = game.get("awayF5Score")
    home_f5 = game.get("homeF5Score")
    nrfi = game.get("nrfiResult")  # 'NRFI' or 'YRFI'

    cur = conn.cursor()
    try:
        cur.execute(
            """
            INSERT INTO games (
                fileId, gameDate, startTimeEst,
                awayTeam, homeTeam,
                sport, gameType, gameStatus, mlbGamePk,
                actualAwayScore, actualHomeScore,
                actualF5AwayScore, actualF5HomeScore,
                nrfiActualResult,
                awayScore, homeScore,
                publishedToFeed, publishedModel
            ) VALUES (
                0, %s, 'TBD',
                %s, %s,
                'MLB', 'regular_season', 'final', %s,
                %s, %s,
                %s, %s,
                %s,
                %s, %s,
                0, 0
            )
        """,
            (
                game_date,
                away,
                home,
                game_pk,
                away_fin,
                home_fin,
                away_f5,
                home_f5,
                nrfi,
                away_fin,
                home_fin,
            ),
        )
        conn.commit()
        cur.close()
        return "inserted"
    except mysql.connector.IntegrityError as e:
        conn.rollback()
        cur.close()
        if "1062" in str(e) or "Duplicate" in str(e):
            return "duplicate"
        return f"error:{e}"
    except Exception as e:
        conn.rollback()
        cur.close()
        return f"error:{e}"


def update_2026_actuals(conn, games_2026: list) -> dict:
    """Update 2026 games with actualF5 scores and nrfiActualResult where missing."""
    print(f"\n[STEP] Updating 2026 games with F5/NRFI actuals (n={len(games_2026)})")
    updated = skipped = errors = 0
    cur = conn.cursor()
    for g in games_2026:
        gp = g["gamePk"]
        af5 = g.get("awayF5Score")
        hf5 = g.get("homeF5Score")
        nrfi = g.get("nrfiResult")
        if af5 is None or hf5 is None or nrfi is None:
            skipped += 1
            continue
        try:
            cur.execute(
                """
                UPDATE games
                SET actualF5AwayScore = %s,
                    actualF5HomeScore = %s,
                    nrfiActualResult  = %s
                WHERE mlbGamePk = %s AND sport = 'MLB'
                  AND (actualF5AwayScore IS NULL OR nrfiActualResult IS NULL)
            """,
                (af5, hf5, nrfi, gp),
            )
            if cur.rowcount > 0:
                updated += 1
            else:
                skipped += 1
        except Exception as e:
            errors += 1
            print(f"  [ERROR] gamePk={gp}: {e}")
    conn.commit()
    cur.close()
    print(f"[OUTPUT] 2026 update: updated={updated} skipped={skipped} errors={errors}")
    return {"updated": updated, "skipped": skipped, "errors": errors}


def main():
    print("[INPUT] MLB Historical DB Seed — starting")
    print(f"[INPUT] Source file: {INPUT_FILE}")

    if not DATABASE_URL:
        print("[ERROR] DATABASE_URL not set in environment")
        sys.exit(1)

    with open(INPUT_FILE) as f:
        data = json.load(f)

    all_games = data["games"]
    games_2024 = [g for g in all_games if g["gameDate"].startswith("2024")]
    games_2025 = [g for g in all_games if g["gameDate"].startswith("2025")]
    games_2026 = [g for g in all_games if g["gameDate"].startswith("2026")]

    print(
        f"[INPUT] Loaded: 2024={len(games_2024)} 2025={len(games_2025)} 2026={len(games_2026)} total={len(all_games)}"
    )

    conn = get_conn()
    print("[STATE] DB connection established")

    existing_pks = get_existing_game_pks(conn)
    print(f"[STATE] Existing MLB gamePks in DB: {len(existing_pks)}")

    totals = {"inserted": 0, "duplicate": 0, "skipped_existing": 0, "error": 0}

    for season_label, season_games in [("2024", games_2024), ("2025", games_2025)]:
        print(f"\n[STEP] Inserting {season_label} games (n={len(season_games)})")
        s_inserted = s_dup = s_skip = s_err = 0

        for i, game in enumerate(season_games):
            gp = game["gamePk"]

            if gp in existing_pks:
                s_skip += 1
                totals["skipped_existing"] += 1
                continue

            result = insert_historical_game(conn, game)

            if result == "inserted":
                s_inserted += 1
                totals["inserted"] += 1
                existing_pks.add(gp)
            elif result == "duplicate":
                s_dup += 1
                totals["duplicate"] += 1
            else:
                s_err += 1
                totals["error"] += 1
                if totals["error"] <= 10:
                    print(
                        f"  [ERROR] {season_label} gamePk={gp} date={game['gameDate']}: {result}"
                    )

            if (i + 1) % 200 == 0:
                print(
                    f"  [STATE] {season_label}: {i + 1}/{len(season_games)} processed | inserted={s_inserted} errors={s_err}"
                )

        print(
            f"[OUTPUT] {season_label}: inserted={s_inserted} duplicate={s_dup} skipped={s_skip} errors={s_err}"
        )

    # Update 2026 games with F5/NRFI actuals
    update_2026_actuals(conn, games_2026)

    conn.close()

    print("\n[OUTPUT] ═══ FINAL SEED SUMMARY ═══")
    print(f"  inserted        = {totals['inserted']}")
    print(f"  skipped_existing= {totals['skipped_existing']}")
    print(f"  duplicate       = {totals['duplicate']}")
    print(f"  error           = {totals['error']}")

    if totals["error"] == 0:
        print("[VERIFY] PASS — historical seed complete with 0 errors")
    else:
        print(
            f"[VERIFY] WARN — seed complete with {totals['error']} errors (see above)"
        )


if __name__ == "__main__":
    main()
