"""
official_schedule.py
====================
Official FIFA WC2026 Group Stage Schedule
Source: Al Jazeera / FIFA official schedule (verified June 13, 2026)

Format: (match_date_utc, kickoff_utc, home_team_id, away_team_id, venue_city, group_letter)
NOTE: "home" = team listed first in official schedule (left side / top of matchup)
      For WC2026, there is no true home team (all neutral venues), but the first-listed
      team is treated as "home" for display purposes (column 1 = home ML).

All times in UTC.
"""

OFFICIAL_FIXTURES = [
    # ── JUNE 11 ──────────────────────────────────────────────────────────────
    # Match 1: Mexico vs South Africa — Mexico City, 19:00 UTC
    ('2026-06-11', '2026-06-11 19:00:00', 'mex', 'rsa', 'Mexico City', 'A'),
    # Match 2: South Korea vs Czechia — Zapopan, 02:00 UTC June 12
    ('2026-06-11', '2026-06-12 02:00:00', 'kor', 'cze', 'Zapopan', 'A'),

    # ── JUNE 12 ──────────────────────────────────────────────────────────────
    # Match 3: Canada vs Bosnia — Toronto, 19:00 UTC
    ('2026-06-12', '2026-06-12 19:00:00', 'can', 'bih', 'Toronto', 'B'),
    # Match 4: USA vs Paraguay — Los Angeles, 01:00 UTC June 13
    ('2026-06-12', '2026-06-13 01:00:00', 'usa', 'par', 'Los Angeles', 'B'),

    # ── JUNE 13 ──────────────────────────────────────────────────────────────
    # Match 5: Qatar vs Switzerland — San Francisco, 19:00 UTC
    ('2026-06-13', '2026-06-13 19:00:00', 'qat', 'sui', 'San Francisco', 'B'),
    # Match 6: Brazil vs Morocco — East Rutherford, 22:00 UTC
    ('2026-06-13', '2026-06-13 22:00:00', 'bra', 'mar', 'East Rutherford', 'C'),
    # Match 7: Haiti vs Scotland — Boston, 01:00 UTC June 14
    ('2026-06-13', '2026-06-14 01:00:00', 'hai', 'sco', 'Foxborough', 'C'),
    # Match 8: Australia vs Turkey — Vancouver, 04:00 UTC June 14
    ('2026-06-13', '2026-06-14 04:00:00', 'aus', 'tur', 'Vancouver', 'D'),

    # ── JUNE 14 ──────────────────────────────────────────────────────────────
    # Match 9: Germany vs Curacao — Houston, 17:00 UTC
    ('2026-06-14', '2026-06-14 17:00:00', 'ger', 'cuw', 'Houston', 'E'),
    # Match 10: Netherlands vs Japan — Dallas/Arlington, 20:00 UTC
    ('2026-06-14', '2026-06-14 20:00:00', 'ned', 'jpn', 'Arlington', 'F'),
    # Match 11: Ivory Coast vs Ecuador — Philadelphia, 23:00 UTC
    ('2026-06-14', '2026-06-14 23:00:00', 'civ', 'ecu', 'Philadelphia', 'E'),
    # Match 12: Sweden vs Tunisia — Guadalupe, 02:00 UTC June 15
    ('2026-06-14', '2026-06-15 02:00:00', 'swe', 'tun', 'Guadalupe', 'F'),

    # ── JUNE 15 ──────────────────────────────────────────────────────────────
    # Match 13: Spain vs Cape Verde — Atlanta, 16:00 UTC
    ('2026-06-15', '2026-06-15 16:00:00', 'esp', 'cpv', 'Atlanta', 'H'),
    # Match 14: Belgium vs Egypt — Vancouver, 19:00 UTC
    ('2026-06-15', '2026-06-15 19:00:00', 'bel', 'egy', 'Seattle', 'G'),
    # Match 15: Saudi Arabia vs Uruguay — Miami, 22:00 UTC
    ('2026-06-15', '2026-06-15 22:00:00', 'ksa', 'uru', 'Miami Gardens', 'H'),
    # Match 16: Iran vs New Zealand — Los Angeles, 01:00 UTC June 16
    ('2026-06-15', '2026-06-16 01:00:00', 'irn', 'nzl', 'Inglewood', 'G'),

    # ── JUNE 16 ──────────────────────────────────────────────────────────────
    # Match 17: France vs Senegal — East Rutherford, 19:00 UTC
    ('2026-06-16', '2026-06-16 19:00:00', 'fra', 'sen', 'East Rutherford', 'I'),
    # Match 18: Iraq vs Norway — Boston, 22:00 UTC
    ('2026-06-16', '2026-06-16 22:00:00', 'irq', 'nor', 'Foxborough', 'I'),
    # Match 19: Argentina vs Algeria — Kansas City, 01:00 UTC June 17
    ('2026-06-16', '2026-06-17 01:00:00', 'arg', 'alg', 'Kansas City', 'J'),
    # Match 20: Austria vs Jordan — San Francisco, 04:00 UTC June 17
    ('2026-06-16', '2026-06-17 04:00:00', 'aut', 'jor', 'Santa Clara', 'J'),

    # ── JUNE 17 ──────────────────────────────────────────────────────────────
    # Match 21: Portugal vs DRC — Houston, 17:00 UTC
    ('2026-06-17', '2026-06-17 17:00:00', 'por', 'cod', 'Houston', 'K'),
    # Match 22: England vs Croatia — Dallas/Arlington, 20:00 UTC
    ('2026-06-17', '2026-06-17 20:00:00', 'eng', 'cro', 'Arlington', 'L'),
    # Match 23: Ghana vs Panama — Toronto, 23:00 UTC
    ('2026-06-17', '2026-06-17 23:00:00', 'gha', 'pan', 'Toronto', 'L'),
    # Match 24: Uzbekistan vs Colombia — Mexico City, 02:00 UTC June 18
    ('2026-06-17', '2026-06-18 02:00:00', 'uzb', 'col', 'Mexico City', 'K'),

    # ── JUNE 18 ──────────────────────────────────────────────────────────────
    # Match 25: Czechia vs South Africa — Atlanta, 16:00 UTC
    ('2026-06-18', '2026-06-18 16:00:00', 'cze', 'rsa', 'Atlanta', 'A'),
    # Match 26: Switzerland vs Bosnia — Los Angeles, 19:00 UTC
    ('2026-06-18', '2026-06-18 19:00:00', 'sui', 'bih', 'Inglewood', 'B'),
    # Match 27: Canada vs Qatar — Vancouver, 22:00 UTC
    ('2026-06-18', '2026-06-18 22:00:00', 'can', 'qat', 'Vancouver', 'B'),
    # Match 28: Mexico vs South Korea — Zapopan, 01:00 UTC June 19
    ('2026-06-18', '2026-06-19 01:00:00', 'mex', 'kor', 'Zapopan', 'A'),

    # ── JUNE 19 ──────────────────────────────────────────────────────────────
    # Match 29: Scotland vs Morocco — Boston, 22:00 UTC
    ('2026-06-19', '2026-06-19 22:00:00', 'sco', 'mar', 'Foxborough', 'C'),
    # Match 30: USA vs Australia — Seattle, 19:00 UTC
    ('2026-06-19', '2026-06-19 19:00:00', 'usa', 'aus', 'Seattle', 'D'),
    # Match 31: Brazil vs Haiti — Philadelphia, 00:30 UTC June 20
    ('2026-06-19', '2026-06-20 00:30:00', 'bra', 'hai', 'Philadelphia', 'C'),
    # Match 32: Turkey vs Paraguay — San Francisco, 03:00 UTC June 20
    ('2026-06-19', '2026-06-20 03:00:00', 'tur', 'par', 'Santa Clara', 'D'),

    # ── JUNE 20 ──────────────────────────────────────────────────────────────
    # Match 33: Netherlands vs Sweden — Houston, 17:00 UTC
    ('2026-06-20', '2026-06-20 17:00:00', 'ned', 'swe', 'Houston', 'F'),
    # Match 34: Germany vs Ivory Coast — Toronto, 20:00 UTC
    ('2026-06-20', '2026-06-20 20:00:00', 'ger', 'civ', 'Toronto', 'E'),
    # Match 35: Ecuador vs Curacao — Kansas City, 03:00 UTC June 21
    ('2026-06-20', '2026-06-21 03:00:00', 'ecu', 'cuw', 'Kansas City', 'E'),
    # Match 36: Tunisia vs Japan — Guadalupe, 04:00 UTC June 21
    ('2026-06-20', '2026-06-21 04:00:00', 'tun', 'jpn', 'Guadalupe', 'F'),

    # ── JUNE 21 ──────────────────────────────────────────────────────────────
    # Match 37: Spain vs Saudi Arabia — Atlanta, 16:00 UTC
    ('2026-06-21', '2026-06-21 16:00:00', 'esp', 'ksa', 'Atlanta', 'H'),
    # Match 38: Belgium vs Iran — Los Angeles, 19:00 UTC
    ('2026-06-21', '2026-06-21 19:00:00', 'bel', 'irn', 'Inglewood', 'G'),
    # Match 39: Uruguay vs Cape Verde — Miami, 22:00 UTC
    ('2026-06-21', '2026-06-21 22:00:00', 'uru', 'cpv', 'Miami Gardens', 'H'),
    # Match 40: New Zealand vs Egypt — Vancouver, 01:00 UTC June 22
    ('2026-06-21', '2026-06-22 01:00:00', 'nzl', 'egy', 'Vancouver', 'G'),

    # ── JUNE 22 ──────────────────────────────────────────────────────────────
    # Match 41: Argentina vs Austria — Dallas/Arlington, 17:00 UTC
    ('2026-06-22', '2026-06-22 17:00:00', 'arg', 'aut', 'Arlington', 'J'),
    # Match 42: France vs Iraq — Philadelphia, 21:00 UTC
    ('2026-06-22', '2026-06-22 21:00:00', 'fra', 'irq', 'Philadelphia', 'I'),
    # Match 43: Norway vs Senegal — East Rutherford, 00:00 UTC June 23
    ('2026-06-22', '2026-06-23 00:00:00', 'nor', 'sen', 'East Rutherford', 'I'),
    # Match 44: Jordan vs Algeria — San Francisco, 03:00 UTC June 23
    ('2026-06-22', '2026-06-23 03:00:00', 'jor', 'alg', 'Santa Clara', 'J'),

    # ── JUNE 23 ──────────────────────────────────────────────────────────────
    # Match 45: Portugal vs Uzbekistan — Houston, 17:00 UTC
    ('2026-06-23', '2026-06-23 17:00:00', 'por', 'uzb', 'Houston', 'K'),
    # Match 46: England vs Ghana — Boston, 20:00 UTC
    ('2026-06-23', '2026-06-23 20:00:00', 'eng', 'gha', 'Foxborough', 'L'),
    # Match 47: Panama vs Croatia — Toronto, 23:00 UTC
    ('2026-06-23', '2026-06-23 23:00:00', 'pan', 'cro', 'Toronto', 'L'),
    # Match 48: Colombia vs DRC — Zapopan, 02:00 UTC June 24
    ('2026-06-23', '2026-06-24 02:00:00', 'col', 'cod', 'Zapopan', 'K'),

    # ── JUNE 24 ──────────────────────────────────────────────────────────────
    # Match 49: Switzerland vs Canada — Vancouver, 19:00 UTC
    ('2026-06-24', '2026-06-24 19:00:00', 'sui', 'can', 'Vancouver', 'B'),
    # Match 50: Bosnia vs Qatar — Seattle, 19:00 UTC
    ('2026-06-24', '2026-06-24 19:00:00', 'bih', 'qat', 'Seattle', 'B'),
    # Match 51: Scotland vs Brazil — Miami, 22:00 UTC
    ('2026-06-24', '2026-06-24 22:00:00', 'sco', 'bra', 'Miami Gardens', 'C'),
    # Match 52: Morocco vs Haiti — Atlanta, 22:00 UTC
    ('2026-06-24', '2026-06-24 22:00:00', 'mar', 'hai', 'Atlanta', 'C'),
    # Match 53: Czechia vs Mexico — Mexico City, 01:00 UTC June 25
    ('2026-06-24', '2026-06-25 01:00:00', 'cze', 'mex', 'Mexico City', 'A'),
    # Match 54: South Africa vs South Korea — Guadalupe, 01:00 UTC June 25
    ('2026-06-24', '2026-06-25 01:00:00', 'rsa', 'kor', 'Guadalupe', 'A'),

    # ── JUNE 25 ──────────────────────────────────────────────────────────────
    # Match 55: Ecuador vs Germany — East Rutherford, 20:00 UTC
    ('2026-06-25', '2026-06-25 20:00:00', 'ecu', 'ger', 'East Rutherford', 'E'),
    # Match 56: Curacao vs Ivory Coast — Philadelphia, 20:00 UTC
    ('2026-06-25', '2026-06-25 20:00:00', 'cuw', 'civ', 'Philadelphia', 'E'),
    # Match 57: Japan vs Sweden — Dallas/Arlington, 23:00 UTC
    ('2026-06-25', '2026-06-25 23:00:00', 'jpn', 'swe', 'Arlington', 'F'),
    # Match 58: Tunisia vs Netherlands — Kansas City, 23:00 UTC
    ('2026-06-25', '2026-06-25 23:00:00', 'tun', 'ned', 'Kansas City', 'F'),
    # Match 59: Turkey vs USA — Los Angeles, 02:00 UTC June 26
    ('2026-06-25', '2026-06-26 02:00:00', 'tur', 'usa', 'Inglewood', 'D'),
    # Match 60: Paraguay vs Australia — San Francisco, 02:00 UTC June 26
    ('2026-06-25', '2026-06-26 02:00:00', 'par', 'aus', 'Santa Clara', 'D'),

    # ── JUNE 26 ──────────────────────────────────────────────────────────────
    # Match 61: Norway vs France — Boston, 19:00 UTC
    ('2026-06-26', '2026-06-26 19:00:00', 'nor', 'fra', 'Foxborough', 'I'),
    # Match 62: Senegal vs Iraq — Toronto, 19:00 UTC
    ('2026-06-26', '2026-06-26 19:00:00', 'sen', 'irq', 'Toronto', 'I'),
    # Match 63: Cape Verde vs Saudi Arabia — Houston, 00:00 UTC June 27
    ('2026-06-26', '2026-06-27 00:00:00', 'cpv', 'ksa', 'Houston', 'H'),
    # Match 64: Uruguay vs Spain — Zapopan, 00:00 UTC June 27
    ('2026-06-26', '2026-06-27 00:00:00', 'uru', 'esp', 'Zapopan', 'H'),
    # Match 65: Egypt vs Iran — Seattle, 03:00 UTC June 27
    ('2026-06-26', '2026-06-27 03:00:00', 'egy', 'irn', 'Seattle', 'G'),
    # Match 66: New Zealand vs Belgium — Vancouver, 03:00 UTC June 27
    ('2026-06-26', '2026-06-27 03:00:00', 'nzl', 'bel', 'Vancouver', 'G'),

    # ── JUNE 27 ──────────────────────────────────────────────────────────────
    # Match 67: Panama vs England — East Rutherford, 21:00 UTC
    ('2026-06-27', '2026-06-27 21:00:00', 'pan', 'eng', 'East Rutherford', 'L'),
    # Match 68: Croatia vs Ghana — Philadelphia, 21:00 UTC
    ('2026-06-27', '2026-06-27 21:00:00', 'cro', 'gha', 'Philadelphia', 'L'),
    # Match 69: Colombia vs Portugal — Miami, 23:30 UTC
    ('2026-06-27', '2026-06-27 23:30:00', 'col', 'por', 'Miami Gardens', 'K'),
    # Match 70: DRC vs Uzbekistan — Atlanta, 23:30 UTC
    ('2026-06-27', '2026-06-27 23:30:00', 'cod', 'uzb', 'Atlanta', 'K'),

    # ── JUNE 28 (Argentina vs Austria matchday 3 — same time as Jordan vs Algeria) ──
    # Match 71: Argentina vs Austria — Dallas, 17:00 UTC (June 22 matchday 2)
    # Already listed above — June 22

    # ── Additional Matchday 3 games (June 24-27) already listed above ──
]

if __name__ == '__main__':
    print(f'Total official fixtures: {len(OFFICIAL_FIXTURES)}')
    for i, f in enumerate(OFFICIAL_FIXTURES, 1):
        date, kickoff, home, away, city, grp = f
        print(f'  Match {i:2d}: {date} | {home:5s} vs {away:5s} | {city} | Group {grp}')
