#!/usr/bin/env python3
"""
WC2026 JUL 9 BetExplorer Probe — FRA vs MAR (wc26-qf-097)
==========================================================
Lean, single-match recon derived from betexplorer_scraper.py (v4):
  1. Discover the BetExplorer event_id for France - Morocco (QF) from the
     tournament fixtures page (slug format: {home}-{away}/{event_id}).
  2. Pull bet365 (bid=16, fallback bid=549 bet365.us) odds via the same AJAX
     endpoints the v4 scraper uses:
       flat  : 1x2, dc, bts  -> bestOdds
       lined : ou, ah        -> allOdds
  3. Convert decimal -> American (same Fraction/Decimal math as v4) and print
     one JSON blob for the v23 engine's JUL9_BOOK block.

NO database writes. Output is stdout only — consumed from the Actions log,
exactly how the v22 Jul 7 book block was produced by the cloud scraper.
"""

import json
import re
import sys
import time
import random
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from fractions import Fraction

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.betexplorer.com"
TOURNAMENT_PATHS = [
    "/football/world/world-championship-2026/",
    "/football/world/world-cup-2026/",
]
AJAX_BEST = "{base}/match-odds/{event_id}/0/{market}/bestOdds/?lang=en"
AJAX_ALL = "{base}/match-odds/{event_id}/0/{market}/allOdds/"
BET365_BIDS = [16, 549]  # intl first, US fallback — same priority as v4
FLAT_MARKETS = ["1x2", "dc", "bts"]
LINED_MARKETS = ["ou", "ah"]

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")


def log(level, msg):
    print(f"[{datetime.now(timezone.utc).isoformat()}] [JUL9-BE] [{level}] {msg}", flush=True)


def dec_to_american(dec_str):
    """Decimal odds string -> American int (v4 scraper math, Fraction-exact)."""
    dec_str = str(dec_str).strip()
    if not dec_str or dec_str in ("0", "0.0", "-", ""):
        raise ValueError(f"invalid decimal '{dec_str}'")
    frac = Fraction(dec_str)
    dec = Decimal(frac.numerator) / Decimal(frac.denominator)
    if dec == Decimal("1.00"):
        return 100
    if dec >= Decimal("2.00"):
        return int(((dec - 1) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return int((Decimal("-100") / (dec - 1)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def discover_event(session):
    """Find the France - Morocco QF match link -> (slug, event_id, home_first)."""
    link_re = re.compile(
        r'href="(/football/world/[a-z0-9-]+/((?:france-morocco|morocco-france)[a-z0-9-]*)/([A-Za-z0-9]{8})/)"'
    )
    for path in TOURNAMENT_PATHS:
        url = BASE_URL + path
        log("STEP", f"Fetching fixtures page: {url}")
        try:
            resp = session.get(url, timeout=25)
        except Exception as e:
            log("WARN", f"fetch failed: {e}")
            continue
        log("STATE", f"HTTP {resp.status_code} | {len(resp.content):,}B")
        if resp.status_code != 200:
            continue
        html = resp.text
        m = link_re.search(html)
        if m:
            full_path, slug, event_id = m.group(1), m.group(2), m.group(3)
            log("PASS", f"FOUND: slug={slug} event_id={event_id} path={full_path}")
            return full_path, slug, event_id
        # Diagnostic: dump every match link containing either team so the log
        # is actionable even when the primary regex misses.
        near = re.findall(r'href="(/football/world/[a-z0-9-]+/[a-z0-9-]*(?:france|morocco)[a-z0-9-]*/[A-Za-z0-9]{8}/)"', html)
        log("DEBUG", f"links mentioning france/morocco on this page: {sorted(set(near))}")
    raise SystemExit("EVENT DISCOVERY FAILED — no France-Morocco link found")


def parse_rows(soup, market):
    """Extract all bookmaker rows for our bids: [(bid, pos, hcp, dec, american)]."""
    rows = []
    for bid in BET365_BIDS:
        for tr in soup.select(f'tr[data-bid="{bid}"]'):
            for td in tr.select("td[data-odd]"):
                dec = td.get("data-odd", "")
                if not dec:
                    continue
                try:
                    am = dec_to_american(dec)
                except ValueError:
                    continue
                rows.append({
                    "bid": bid,
                    "pos": td.get("data-pos", ""),
                    "hcp": td.get("data-hcp", tr.get("data-hcp", "")) or None,
                    "dec": dec,
                    "american": am,
                })
        if rows:
            break  # bid=16 satisfied; skip US fallback
    return rows


def fetch_market(session, event_id, market, referer):
    url = (AJAX_ALL if market in LINED_MARKETS else AJAX_BEST).format(
        base=BASE_URL, event_id=event_id, market=market)
    log("STEP", f"FETCH [{market}] {url}")
    for attempt in range(1, 4):
        try:
            resp = session.get(url, timeout=25, headers={
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "X-Requested-With": "XMLHttpRequest",
                "Referer": referer,
            })
            log("STATE", f"[{market}] HTTP {resp.status_code} | {len(resp.content):,}B")
            if resp.status_code != 200:
                raise ValueError(f"HTTP {resp.status_code}")
            data = resp.json()
            html = data.get("odds", "")
            if not html:
                raise ValueError("empty 'odds' key")
            soup = BeautifulSoup(html, "html.parser")
            all_bids = sorted({tr.get("data-bid") for tr in soup.select("tr[data-bid]")})
            log("DEBUG", f"[{market}] bids present: {all_bids}")
            return parse_rows(soup, market)
        except Exception as e:
            log("WARN", f"[{market}] attempt {attempt}: {e}")
            time.sleep(random.uniform(3, 6))
    raise SystemExit(f"MARKET FETCH FAILED: {market}")


def main():
    session = requests.Session()
    session.headers.update({
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Connection": "keep-alive",
    })

    full_path, slug, event_id = discover_event(session)
    referer = BASE_URL + full_path

    # Warmup on the match page (session cookies), same as v4 pipeline.
    try:
        r = session.get(referer, timeout=25)
        log("STATE", f"warmup HTTP {r.status_code} | {len(r.content):,}B")
        # Kickoff sanity: surface the page <title> so the log proves the fixture.
        title = re.search(r"<title>(.*?)</title>", r.text, re.S)
        if title:
            log("STATE", f"page title: {title.group(1).strip()[:120]}")
    except Exception as e:
        log("WARN", f"warmup failed: {e} — continuing")
    time.sleep(random.uniform(2, 4))

    result = {
        "slug": slug,
        "event_id": event_id,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "markets": {},
    }
    for market in FLAT_MARKETS + LINED_MARKETS:
        rows = fetch_market(session, event_id, market, referer)
        result["markets"][market] = rows
        log("PASS", f"[{market}] {len(rows)} odds cells captured")
        time.sleep(random.uniform(2.5, 5))

    print("\n===== JUL9_BOOK_RAW_JSON_BEGIN =====")
    print(json.dumps(result, indent=2))
    print("===== JUL9_BOOK_RAW_JSON_END =====")


if __name__ == "__main__":
    main()
