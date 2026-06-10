"""
Precise team name width analysis at ScorePanel 170px container (768px viewport).
Font: Inter Bold 13px (700 weight) — canvas-equivalent character width estimates.

ScorePanel at 768px: clamp(170px, 22vw, 260px)
  22vw of 768 = 168.96px → floors to 170px (clamp minimum)
  22vw of 820 = 180.4px

Layout inside ScorePanel:
  pl-2 (8px) + [logo 36px] + [gap-2 8px] + [team name text] + pr-2 (8px)
  Available text width = panel - 36 - 8 - 8 - 8 = panel - 60
"""

PANEL_768 = 170.0
PANEL_820 = 180.4

LOGO = 36
GAP = 8
PAD_L = 8
PAD_R = 8


def avail(panel):
    return panel - LOGO - GAP - PAD_L - PAD_R


# Inter Bold 13px character widths (px) — estimated from font metrics
# These are conservative estimates; actual canvas values may be 0-5% wider
CW = {
    "A": 9.1,
    "B": 8.5,
    "C": 8.3,
    "D": 9.0,
    "E": 7.8,
    "F": 7.2,
    "G": 8.8,
    "H": 9.0,
    "I": 3.8,
    "J": 5.5,
    "K": 8.8,
    "L": 7.2,
    "M": 10.5,
    "N": 9.0,
    "O": 9.2,
    "P": 8.2,
    "Q": 9.2,
    "R": 8.8,
    "S": 7.9,
    "T": 8.0,
    "U": 9.0,
    "V": 9.1,
    "W": 10.8,
    "X": 8.8,
    "Y": 8.8,
    "Z": 8.5,
    "a": 7.5,
    "b": 8.0,
    "c": 7.0,
    "d": 8.0,
    "e": 7.5,
    "f": 4.5,
    "g": 8.0,
    "h": 8.0,
    "i": 3.5,
    "j": 3.5,
    "k": 7.8,
    "l": 3.5,
    "m": 11.5,
    "n": 8.0,
    "o": 8.0,
    "p": 8.0,
    "q": 8.0,
    "r": 5.0,
    "s": 6.8,
    "t": 5.0,
    "u": 8.0,
    "v": 7.5,
    "w": 10.2,
    "x": 7.5,
    "y": 7.5,
    "z": 7.0,
    " ": 3.5,
}


def tw(text, size=13):
    scale = size / 13.0
    return sum(CW.get(c, 8.0) * scale for c in text)


# All MLB, NHL, NBA team names (nickname line — the longer of the two lines)
teams = [
    # MLB nicknames
    "White Sox",
    "Blue Jays",
    "Diamondbacks",
    "Cardinals",
    "Guardians",
    "Brewers",
    "Mariners",
    "Athletics",
    "Nationals",
    "Phillies",
    "Dodgers",
    "Yankees",
    "Red Sox",
    "Padres",
    "Giants",
    "Rockies",
    "Orioles",
    "Astros",
    "Rangers",
    "Braves",
    "Twins",
    "Tigers",
    "Royals",
    "Cubs",
    "Mets",
    "Pirates",
    "Reds",
    "Marlins",
    "Rays",
    "Angels",
    # NHL nicknames
    "Golden Knights",
    "Maple Leafs",
    "Canadiens",
    "Blackhawks",
    "Blue Jackets",
    "Hurricanes",
    "Avalanche",
    "Lightning",
    "Penguins",
    "Capitals",
    "Senators",
    "Panthers",
    "Predators",
    "Coyotes",
    "Canucks",
    "Oilers",
    # NBA nicknames
    "Timberwolves",
    "Trailblazers",
    "Mavericks",
    "Cavaliers",
    "Grizzlies",
    "Pelicans",
    "Thunder",
    "Warriors",
    "Raptors",
    "Clippers",
    "Pacers",
    "Nuggets",
    # MLB city names (top line)
    "San Francisco",
    "Los Angeles",
    "Kansas City",
    "San Diego",
    "Philadelphia",
    "Washington",
    "Pittsburgh",
    "Cincinnati",
    "Minnesota",
    "Cleveland",
    "Baltimore",
    "Milwaukee",
    "Toronto",
    "Chicago",
    "Detroit",
    "Houston",
    "Colorado",
    "Oakland",
    "Seattle",
    "Tampa Bay",
    "New York",
    "Boston",
    "Texas",
    "Atlanta",
    "Miami",
    "St. Louis",
    "Arizona",
    # NHL city names
    "Washington",
    "Philadelphia",
    "Pittsburgh",
    "Minnesota",
    "Colorado",
    "Nashville",
    "Columbus",
    "Carolina",
    "New Jersey",
    "San Jose",
    "Vancouver",
    "Edmonton",
    "Winnipeg",
    "Calgary",
    "Ottawa",
    "Montreal",
    "Toronto",
    "Tampa Bay",
    "Florida",
    "Detroit",
    "Boston",
    "Buffalo",
    "Chicago",
    "Dallas",
    "Arizona",
    "Seattle",
    "Vegas",
]

a768 = avail(PANEL_768)
a820 = avail(PANEL_820)

print(f"[INPUT] ScorePanel width at 768px: {PANEL_768}px")
print(f"[INPUT] ScorePanel width at 820px: {PANEL_820}px")
print(
    f"[INPUT] Available text width at 768px: {a768}px (panel - logo36 - gap8 - padL8 - padR8)"
)
print(f"[INPUT] Available text width at 820px: {a820:.1f}px")
print()
print(f"{'Team Name':<22} {'W@13px':>8} {'W@12px':>8} {'Fits768':>10} {'Fits820':>10}")
print("-" * 62)

overflows = []
for t in sorted(set(teams), key=lambda x: tw(x), reverse=True):
    w13 = tw(t, 13)
    w12 = tw(t, 12)
    f768 = "OK" if w13 <= a768 else "OVERFLOW"
    f820 = "OK" if w13 <= a820 else "OVERFLOW"
    if w13 > a768:
        overflows.append((t, w13, w12))
    marker = " <-- PROBLEM" if w13 > a768 else ""
    print(f"{t:<22} {w13:>8.1f} {w12:>8.1f} {f768:>10} {f820:>10}{marker}")

print()
print(f"[OUTPUT] Total overflows at 768px: {len(overflows)}")
if overflows:
    print("[OUTPUT] Overflow details:")
    for t, w13, _w12 in overflows:
        excess = w13 - a768
        fits_at = None
        for sz in [12, 11, 10, 9]:
            if tw(t, sz) <= a768:
                fits_at = sz
                break
        print(
            f"  '{t}': {w13:.1f}px > {a768}px (excess {excess:.1f}px) → fits at {fits_at}px"
        )
    print()
    print("[RECOMMENDATION] Options:")
    print(
        "  A) Reduce NAME_FONT_SIZE floor from 13px to 12px: clamp(12px, 1.1vw, 18px)"
    )
    print("     This gives 2px extra per char across all names — solves all overflows.")
    print("  B) Add overflow-x: hidden + text-overflow: ellipsis to team name spans")
    print("     (violates 'no truncation' requirement — NOT recommended)")
    print("  C) Add whiteSpace: 'normal' to allow wrapping on 2nd line")
    print(
        "     (violates 'no more than 2 lines' since nickname is already line 2 — NOT recommended)"
    )
    print("  D) Increase ScorePanel min-width from 170px to 180px")
    print("     (gives 10px more available text width — solves most overflows)")
else:
    print(
        "[VERIFY] All team names fit within available width at 13px. No action needed."
    )
