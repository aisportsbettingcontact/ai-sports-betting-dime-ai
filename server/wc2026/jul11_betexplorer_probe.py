#!/usr/bin/env python3
"""
WC2026 JUL 11 BetExplorer Probe — two QFs, engine-ready output.

  - wc26-qf-099 (ESPN 760512): Norway (home) vs England (away)      [5 PM ET]
  - wc26-qf-100 (ESPN 760513): Argentina (home) vs Switzerland (away) [9 PM ET]

Reuses betexplorer_scraper.py's OWN parse_* + _select_primary_* functions so the
primary-line selection is identical to the production scraper (bid=16 intl,
549 bet365.us fallback; OU line closest to 2.5 within ceiling; AH no-pk rule).
Emits a clean JUL11_BOOK dict per match in the exact v22 engine field format.

NO database writes. Output is stdout only, consumed from the Actions log.
BetExplorer has no to-advance market, so bookHomeAdv/bookAwayAdv are null
(same as the v4 scraper, which always writes book_*_to_advance NULL).
"""

import json
import re
import sys
import time
import random
from pathlib import Path
from datetime import datetime, timezone

import requests
from bs4 import BeautifulSoup

# Reuse the production scraper's parsing + primary-line selection verbatim.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import betexplorer_scraper as BX  # import-safe: guarded by __main__

BASE_URL = "https://www.betexplorer.com"
TOURNAMENT_PATHS = [
    "/football/world/world-championship-2026/",
    "/football/world/world-cup-2026/",
]
AJAX_BEST = "{base}/match-odds/{event_id}/0/{market}/bestOdds/?lang=en"
AJAX_ALL = "{base}/match-odds/{event_id}/0/{market}/allOdds/"

MATCHES = [
    {"fid": "wc26-qf-099", "espn": "760512", "home": "NOR", "away": "ENG",
     "tokens": ("norway", "england")},
    {"fid": "wc26-qf-100", "espn": "760513", "home": "ARG", "away": "SUI",
     "tokens": ("argentina", "switzerland")},
]

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")


def log(level, msg):
    print(f"[{datetime.now(timezone.utc).isoformat()}] [JUL11-BE] [{level}] {msg}", flush=True)


def discover_event(session, tokens):
    a, b = tokens
    link_re = re.compile(
        r'href="(/football/world/[a-z0-9-]+/((?:%s-%s|%s-%s)[a-z0-9-]*)/([A-Za-z0-9]{8})/)"'
        % (a, b, b, a))
    for path in TOURNAMENT_PATHS:
        url = BASE_URL + path
        log("STEP", f"Fetching fixtures page: {url} (looking for {a}/{b})")
        try:
            resp = session.get(url, timeout=25)
        except Exception as e:
            log("WARN", f"fetch failed: {e}"); continue
        log("STATE", f"HTTP {resp.status_code} | {len(resp.content):,}B")
        if resp.status_code != 200:
            continue
        m = link_re.search(resp.text)
        if m:
            log("PASS", f"FOUND: slug={m.group(2)} event_id={m.group(3)}")
            return m.group(1), m.group(2), m.group(3)
        near = re.findall(
            r'href="(/football/world/[a-z0-9-]+/[a-z0-9-]*(?:%s|%s)[a-z0-9-]*/[A-Za-z0-9]{8}/)"' % (a, b),
            resp.text)
        log("DEBUG", f"links mentioning {a}/{b}: {sorted(set(near))}")
    log("FAIL", f"EVENT DISCOVERY FAILED — no {a}-{b} link (not posted yet?)")
    return None, None, None


def fetch_soup(session, event_id, market, referer, lined):
    url = (AJAX_ALL if lined else AJAX_BEST).format(base=BASE_URL, event_id=event_id, market=market)
    for attempt in range(1, 4):
        try:
            resp = session.get(url, timeout=25, headers={
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "X-Requested-With": "XMLHttpRequest", "Referer": referer})
            if resp.status_code != 200:
                raise ValueError(f"HTTP {resp.status_code}")
            html = resp.json().get("odds", "")
            if not html:
                raise ValueError("empty 'odds' key")
            return BeautifulSoup(html, "html.parser")
        except Exception as e:
            log("WARN", f"[{market}] attempt {attempt}: {e}")
            time.sleep(random.uniform(3, 6))
    return None


def probe_match(session, spec, logger):
    log("STEP", f"===== {spec['fid']} {spec['home']}(H) vs {spec['away']}(A) =====")
    full_path, slug, event_id = discover_event(session, spec["tokens"])
    if not event_id:
        return {"fid": spec["fid"], "error": "event not found"}
    referer = BASE_URL + full_path
    try:
        r = session.get(referer, timeout=25)
        t = re.search(r"<title>(.*?)</title>", r.text, re.S)
        if t:
            log("STATE", f"page title: {t.group(1).strip()[:120]}")
    except Exception as e:
        log("WARN", f"warmup failed: {e}")
    time.sleep(random.uniform(2, 4))

    book = {"bookHomeMl": None, "bookDraw": None, "bookAwayMl": None,
            "bookSpread": None, "bookTotal": None, "bookOver": None, "bookUnder": None,
            "bookBttsY": None, "bookBttsN": None,
            "bookHomeAdv": None, "bookAwayAdv": None,  # not on BetExplorer
            "bookHomeWD": None, "bookAwayWD": None, "bookNoDraw": None,
            "bookHomeSpreadOdds": None, "bookAwaySpreadOdds": None}

    def safe(market, lined, fn):
        soup = fetch_soup(session, event_id, market, referer, lined)
        time.sleep(random.uniform(2.5, 5))
        if soup is None:
            log("FAIL", f"[{market}] no soup"); return None
        try:
            return fn(soup)
        except Exception as e:
            log("FAIL", f"[{market}] parse error: {e}"); return None

    d = safe("1x2", False, lambda s: BX.parse_1x2(s, logger, event_id))
    if d:
        book["bookHomeMl"], book["bookDraw"], book["bookAwayMl"] = d["home_ml"], d["draw"], d["away_ml"]
        log("PASS", f"1x2: H={d['home_ml']} D={d['draw']} A={d['away_ml']}")
    dc = safe("dc", False, lambda s: BX.parse_dc(s, logger, event_id))
    if dc:
        book["bookHomeWD"] = dc.get("home_or_draw")
        book["bookAwayWD"] = dc.get("away_or_draw")
        book["bookNoDraw"] = dc.get("no_draw")
    bt = safe("bts", False, lambda s: BX.parse_bts(s, logger, event_id))
    if bt:
        book["bookBttsY"], book["bookBttsN"] = bt.get("btts_yes"), bt.get("btts_no")
    ou = safe("ou", True, lambda s: BX.parse_ou(s, logger, event_id))
    if ou:
        line, over, under = BX._select_primary_ou_line(ou)
        book["bookTotal"], book["bookOver"], book["bookUnder"] = line, over, under
        log("PASS", f"OU primary: {line} O={over} U={under}")
    ah = safe("ah", True, lambda s: BX.parse_ah(s, logger, event_id))
    if ah:
        spread, ho, ao = BX._select_primary_ah_line(ah, book["bookHomeMl"], book["bookAwayMl"])
        book["bookSpread"], book["bookHomeSpreadOdds"], book["bookAwaySpreadOdds"] = spread, ho, ao
        log("PASS", f"AH primary: home_spread={spread} HO={ho} AO={ao}")

    return {"fid": spec["fid"], "espn": spec["espn"], "home": spec["home"],
            "away": spec["away"], "slug": slug, "event_id": event_id,
            "scraped_at": datetime.now(timezone.utc).isoformat(), "book": book}


def main():
    session = requests.Session()
    session.headers.update({"User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9", "Connection": "keep-alive"})
    logger = BX.ForensicLogger(Path("/tmp/jul11_probe.jsonl"), session_id="jul11-probe")
    out = []
    for spec in MATCHES:
        out.append(probe_match(session, spec, logger))
        time.sleep(random.uniform(3, 6))

    print("\n===== JUL11_BOOK_ENGINE_FORMAT_BEGIN =====")
    for m in out:
        if "book" not in m:
            print(f"  // {m['fid']}: {m.get('error')}")
            continue
        b = m["book"]
        print(f"  '{m['fid']}': {{ // {m['home']}(H) vs {m['away']}(A) — BE event {m['event_id']}")
        print(f"    bookHomeMl: {b['bookHomeMl']}, bookDraw: {b['bookDraw']}, bookAwayMl: {b['bookAwayMl']},")
        print(f"    bookSpread: {b['bookSpread']}, bookTotal: {b['bookTotal']},")
        print(f"    bookOver: {b['bookOver']}, bookUnder: {b['bookUnder']},")
        print(f"    bookBttsY: {b['bookBttsY']}, bookBttsN: {b['bookBttsN']},")
        print(f"    bookHomeAdv: {b['bookHomeAdv']}, bookAwayAdv: {b['bookAwayAdv']},")
        print(f"    bookHomeWD: {b['bookHomeWD']}, bookAwayWD: {b['bookAwayWD']}, bookNoDraw: {b['bookNoDraw']},")
        print(f"    bookHomeSpreadOdds: {b['bookHomeSpreadOdds']}, bookAwaySpreadOdds: {b['bookAwaySpreadOdds']},")
        print(f"  }},")
    print("===== JUL11_BOOK_ENGINE_FORMAT_END =====")
    print("\n===== JUL11_RAW_JSON =====")
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
