/**
 * marchMadnessTeams.ts
 *
 * The complete set of 68 teams in the 2026 NCAA Division I Men's Basketball
 * Championship (March Madness) bracket, keyed by their DB slug.
 *
 * This allowlist is used to filter the NCAAM game feed so that only
 * March Madness bracket games appear on the public dashboard.
 *
 * Bracket regions:
 *   FIRST FOUR (Dayton, 3/17-3/18):
 *     UMBC vs Howard  (already played 3/17)
 *     Texas vs NC State  (already played 3/17)
 *     Prairie View A&M vs Lehigh  (3/18)
 *     Miami (OH) vs SMU  (3/18)
 *
 *   EAST: Duke, Siena, Ohio St, TCU, St. John's, Northern Iowa, Kansas, Cal Baptist,
 *         Louisville, South Florida, Michigan St, North Dakota St, UCLA, UCF, UConn, Furman
 *
 *   SOUTH: Florida, Prairie View A&M*, Clemson, Iowa, Vanderbilt, McNeese, Nebraska, Troy,
 *          North Carolina, VCU, Illinois, Penn, Saint Mary's, Texas A&M, Houston, Idaho
 *
 *   WEST: Arizona, Long Island, Villanova, Utah St, Wisconsin, High Point, Arkansas, Hawaii,
 *         BYU, Texas, Gonzaga, Kennesaw St, Miami (FL), Missouri, Purdue, Queens (NC)
 *
 *   MIDWEST: Michigan, Howard*, Georgia, Saint Louis, Texas Tech, Akron, Alabama, Hofstra,
 *            Tennessee, Tennessee St, Virginia, Wright St, Kentucky, Santa Clara, Iowa St, Miami (OH)*
 *
 * (* = First Four participants — winner advances to main bracket)
 */

export const MARCH_MADNESS_DB_SLUGS = new Set<string>([
  // ── First Four ────────────────────────────────────────────────────────────
  "umbc", // 16-seed East (played 3/17, lost)
  "howard", // 16-seed Midwest (played 3/17, won → advances)
  "texas", // 11-seed West (played 3/17, WON → advances to play BYU)
  "nc_state", // 11-seed West (played 3/17, lost to Texas)
  "prairie_view_a_and_m", // 16-seed South (3/18)
  "lehigh", // 16-seed South (3/18)
  "miami_oh", // 11-seed Midwest (3/18)
  "smu", // 11-seed Midwest (3/18)

  // ── East Region ───────────────────────────────────────────────────────────
  "duke", // 1
  "siena", // 16
  "ohio_st", // 8
  "tcu", // 9
  "st_johns", // 5
  "n_iowa", // 12
  "kansas", // 4
  "california_baptist", // 13
  "louisville", // 6
  "south_florida", // 11
  "michigan_st", // 3
  "n_dakota_st", // 14
  "ucla", // 7
  "c_florida", // 10
  "connecticut", // 2
  "furman", // 15

  // ── South Region ──────────────────────────────────────────────────────────
  "florida", // 1
  // prairie_view_a_and_m already listed above (First Four → 16-seed)
  "clemson", // 8
  "iowa", // 9
  "vanderbilt", // 5
  "mcneese_st", // 12
  "nebraska", // 4
  "troy", // 13
  "north_carolina", // 6
  "va_commonwealth", // 11 (VCU)
  "illinois", // 3
  "pennsylvania", // 14
  "st_marys", // 7
  "texas_a_and_m", // 10
  "houston", // 2
  "idaho", // 15

  // ── West Region ───────────────────────────────────────────────────────────
  "arizona", // 1
  "liu_brooklyn", // 16 (Long Island)
  "villanova", // 8
  "utah_st", // 9
  "wisconsin", // 5
  "high_point", // 12
  "arkansas", // 4
  "hawaii", // 13
  "brigham_young", // 6 (BYU)
  // texas already listed above (First Four → 11-seed)
  "gonzaga", // 3
  "kennesaw_st", // 14
  "miami_fl", // 7
  "missouri", // 10
  "purdue", // 2
  "queens_nc", // 15

  // ── Midwest Region ────────────────────────────────────────────────────────
  "michigan", // 1
  // howard already listed above (First Four → 16-seed)
  "georgia", // 8
  "saint_louis", // 9
  "texas_tech", // 5
  "akron", // 12
  "alabama", // 4
  "hofstra", // 13
  "tennessee", // 6
  // miami_oh already listed above (First Four → 11-seed)
  "virginia", // 3
  "wright_st", // 14
  "kentucky", // 7
  "santa_clara", // 10
  "iowa_st", // 2
  "tennessee_st", // 15
]);

/**
 * Returns true if both teams in a game are March Madness bracket participants.
 */
export function isMarchMadnessGame(
  awayTeam: string,
  homeTeam: string
): boolean {
  return (
    MARCH_MADNESS_DB_SLUGS.has(awayTeam) && MARCH_MADNESS_DB_SLUGS.has(homeTeam)
  );
}
