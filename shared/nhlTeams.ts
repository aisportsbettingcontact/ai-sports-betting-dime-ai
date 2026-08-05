/**
 * NHL Team Registry — 32 NHL teams
 * Authoritative source: nhl_teams database table (seeded from build_nhl_mapping.py).
 * DO NOT edit manually — regenerate from the nhl_teams DB table.
 *
 * Key fields:
 *   nhlSlug   — NHL.com team slug (e.g. "boston-bruins")
 *   vsinSlug  — VSiN href slug (hyphen format, e.g. "boston-bruins")
 *   dbSlug    — Database storage key (vsinSlug with hyphens → underscores)
 *   logoUrl   — Official NHL.com SVG logo URL (assets.nhle.com)
 *
 * VSiN href aliases (live page may use shortened forms):
 *   None currently known for NHL. If discovered, add to VSIN_NHL_HREF_ALIASES below.
 */

export interface NhlTeam {
  conference: string;
  division: string;
  abbrev: string;
  city: string;
  nickname: string;
  name: string;
  nhlSlug: string;
  vsinSlug: string;
  dbSlug: string;
  anSlug: string;
  logoUrl: string;
}

export const NHL_TEAMS: NhlTeam[] = [
  // ── Eastern Conference — Atlantic Division ─────────────────────────────────
  {
    conference: "EASTERN",
    division: "ATLANTIC",
    abbrev: "BOS",
    city: "Boston",
    nickname: "Bruins",
    name: "Boston Bruins",
    nhlSlug: "boston-bruins",
    vsinSlug: "boston-bruins",
    dbSlug: "boston_bruins",
    anSlug: "boston-bruins",
    logoUrl: "https://assets.nhle.com/logos/nhl/svg/BOS_dark.svg",
  },
  {
    conference: "EASTERN",
    division: "ATLANTIC",
    abbrev: "BUF",
    city: "Buffalo",
    nickname: "Sabres",
    name: "Buffalo Sabres",
    nhlSlug: "buffalo-sabres",
    vsinSlug: "buffalo-sabres",
    dbSlug: "buffalo_sabres",
    anSlug: "buffalo-sabres",
    logoUrl: "https://assets.nhle.com/logos/nhl/svg/BUF_dark.svg",
  },
  {
    conference: "EASTERN",
    division: "ATLANTIC",
    abbrev: "DET",
    city: "Detroit",
    nickname: "Red Wings",
    name: "Detroit Red Wings",
    nhlSlug: "detroit-red-wings",
    vsinSlug: "detroit-red-wings",
    dbSlug: "detroit_red_wings",
    anSlug: "detroit-red-wings",
    logoUrl: "https://assets.nhle.com/logos/nhl/svg/DET_dark.svg",
  },
  {
    conference: "EASTERN",
    division: "ATLANTIC",
    abbrev: "FLA",
    city: "Florida",
    nickname: "Panthers",
    name: "Florida Panthers",
    nhlSlug: "florida-panthers",
    vsinSlug: "florida-panthers",
    dbSlug: "florida_panthers",
    anSlug: "florida-panthers",
    logoUrl: "https://assets.nhle.com/logos/nhl/svg/FLA_dark.svg",
  },
  {
    conference: "EASTERN",
    division: "ATLANTIC",
    abbrev: "MTL",
    city: "Montreal",
    nickname: "Canadiens",
    name: "Montreal Canadiens",
    nhlSlug: "montreal-canadiens",
    vsinSlug: "montreal-canadiens",
    dbSlug: "montreal_canadiens",
    anSlug: "montreal-canadiens",
    logoUrl: "https://assets.nhle.com/logos/nhl/svg/MTL_dark.svg",
  },
  {
    conference: "EASTERN",
    division: "ATLANTIC",
    abbrev: "OTT",
    city: "Ottawa",
    nickname: "Senators",
    name: "Ottawa Senators",
    nhlSlug: "ottawa-senators",
    vsinSlug: "ottawa-senators",
    dbSlug: "ottawa_senators",
    anSlug: "ottawa-senators",
    logoUrl: "https://assets.nhle.com/logos/nhl/svg/OTT_dark.svg",
  },
  {
    conference: "EASTERN",
    division: "ATLANTIC",
    abbrev: "TBL",
    city: "Tampa Bay",
    nickname: "Lightning",
    name: "Tampa Bay Lightning",
    nhlSlug: "tampa-bay-lightning",
    vsinSlug: "tampa-bay-lightning",
    dbSlug: "tampa_bay_lightning",
    anSlug: "tampa-bay-lightning",
    logoUrl: "https://assets.nhle.com/logos/nhl/svg/TBL_dark.svg",
  },
  {
    conference: "EASTERN",
    division: "ATLANTIC",
    abbrev: "TOR",
    city: "Toronto",
    nickname: "Maple Leafs",
    name: "Toronto Maple Leafs",
    nhlSlug: "toronto-maple-leafs",
    vsinSlug: "toronto-maple-leafs",
    dbSlug: "toronto_maple_leafs",
    anSlug: "toronto-maple-leafs",
    logoUrl: "https://assets.nhle.com/logos/nhl/svg/TOR_dark.svg",
  },
  // ── Eastern Conference — Metropolitan Division ─────────────────────────────
  {
    conference: "EASTERN",
    division: "METROPOLITAN",
    abbrev: "CAR",
    city: "Carolina",
    nickname: "Hurricanes",
    name: "Carolina Hurricanes",
    nhlSlug: "carolina-hurricanes",
    vsinSlug: "carolina-hurricanes",
    dbSlug: "carolina_hurricanes",
    anSlug: "carolina-hurricanes",
    logoUrl: "https://assets.nhle.com/logos/nhl/svg/CAR_dark.svg",
  },
  {
    conference: "EASTERN",
    division: "METROPOLITAN",
    abbrev: "CBJ",
    city: "Columbus",
    nickname: "Blue Jackets",
    name: "Columbus Blue Jackets",
    nhlSlug: "columbus-blue-jackets",
    vsinSlug: "columbus-blue-jackets",
    dbSlug: "columbus_blue_jackets",
    anSlug: "columbus-blue-jackets",
    logoUrl: "https://assets.nhle.com/logos/nhl/svg/CBJ_dark.svg",
  },
  {
    conference: "EASTERN",
    division: "METROPOLITAN",
    abbrev: "NJD",
    city: "New Jersey",
    nickname: "Devils",
    name: "New Jersey Devils",
    nhlSlug: "new-jersey-devils",
    vsinSlug: "new-jersey-devils",
    dbSlug: "new_jersey_devils",
    anSlug: "new-jersey-devils",
    logoUrl: "https://assets.nhle.com/logos/nhl/svg/NJD_dark.svg",
  },
  {
    conference: "EASTERN",
    division: "METROPOLITAN",
    abbrev: "NYI",
    city: "New York",
    nickname: "Islanders",
    name: "New York Islanders",
    nhlSlug: "new-york-islanders",
    vsinSlug: "new-york-islanders",
    dbSlug: "new_york_islanders",
    anSlug: "new-york-islanders",
    logoUrl: "https://assets.nhle.com/logos/nhl/svg/NYI_dark.svg",
  },
  {
    conference: "EASTERN",
    division: "METROPOLITAN",
    abbrev: "NYR",
    city: "New York",
    nickname: "Rangers",
    name: "New York Rangers",
    nhlSlug: "new-york-rangers",
    vsinSlug: "new-york-rangers",
    dbSlug: "new_york_rangers",
    anSlug: "new-york-rangers",
    logoUrl: "https://assets.nhle.com/logos/nhl/svg/NYR_dark.svg",
  },
  {
    conference: "EASTERN",
    division: "METROPOLITAN",
    abbrev: "PHI",
    city: "Philadelphia",
    nickname: "Flyers",
    name: "Philadelphia Flyers",
    nhlSlug: "philadelphia-flyers",
    vsinSlug: "philadelphia-flyers",
    dbSlug: "philadelphia_flyers",
    anSlug: "philadelphia-flyers",
    logoUrl: "https://assets.nhle.com/logos/nhl/svg/PHI_dark.svg",
  },
  {
    conference: "EASTERN",
    division: "METROPOLITAN",
    abbrev: "PIT",
    city: "Pittsburgh",
    nickname: "Penguins",
    name: "Pittsburgh Penguins",
    nhlSlug: "pittsburgh-penguins",
    vsinSlug: "pittsburgh-penguins",
    dbSlug: "pittsburgh_penguins",
    anSlug: "pittsburgh-penguins",
    logoUrl: "https://assets.nhle.com/logos/nhl/svg/PIT_dark.svg",
  },
  {
    conference: "EASTERN",
    division: "METROPOLITAN",
    abbrev: "WSH",
    city: "Washington",
    nickname: "Capitals",
    name: "Washington Capitals",
    nhlSlug: "washington-capitals",
    vsinSlug: "washington-capitals",
    dbSlug: "washington_capitals",
    anSlug: "washington-capitals",
    logoUrl: "https://assets.nhle.com/logos/nhl/svg/WSH_dark.svg",
  },
  // ── Western Conference — Central Division ──────────────────────────────────
  {
    conference: "WESTERN",
    division: "CENTRAL",
    abbrev: "CHI",
    city: "Chicago",
    nickname: "Blackhawks",
    name: "Chicago Blackhawks",
    nhlSlug: "chicago-blackhawks",
    vsinSlug: "chicago-blackhawks",
    dbSlug: "chicago_blackhawks",
    anSlug: "chicago-blackhawks",
    logoUrl: "https://assets.nhle.com/logos/nhl/svg/CHI_dark.svg",
  },
  {
    conference: "WESTERN",
    division: "CENTRAL",
    abbrev: "COL",
    city: "Colorado",
    nickname: "Avalanche",
    name: "Colorado Avalanche",
    nhlSlug: "colorado-avalanche",
    vsinSlug: "colorado-avalanche",
    dbSlug: "colorado_avalanche",
    anSlug: "colorado-avalanche",
    logoUrl: "https://assets.nhle.com/logos/nhl/svg/COL_dark.svg",
  },
  {
    conference: "WESTERN",
    division: "CENTRAL",
    abbrev: "DAL",
    city: "Dallas",
    nickname: "Stars",
    name: "Dallas Stars",
    nhlSlug: "dallas-stars",
    vsinSlug: "dallas-stars",
    dbSlug: "dallas_stars",
    anSlug: "dallas-stars",
    logoUrl: "https://assets.nhle.com/logos/nhl/svg/DAL_dark.svg",
  },
  {
    conference: "WESTERN",
    division: "CENTRAL",
    abbrev: "MIN",
    city: "Minnesota",
    nickname: "Wild",
    name: "Minnesota Wild",
    nhlSlug: "minnesota-wild",
    vsinSlug: "minnesota-wild",
    dbSlug: "minnesota_wild",
    anSlug: "minnesota-wild",
    logoUrl: "https://assets.nhle.com/logos/nhl/svg/MIN_dark.svg",
  },
  {
    conference: "WESTERN",
    division: "CENTRAL",
    abbrev: "NSH",
    city: "Nashville",
    nickname: "Predators",
    name: "Nashville Predators",
    nhlSlug: "nashville-predators",
    vsinSlug: "nashville-predators",
    dbSlug: "nashville_predators",
    anSlug: "nashville-predators",
    logoUrl: "https://assets.nhle.com/logos/nhl/svg/NSH_dark.svg",
  },
  {
    conference: "WESTERN",
    division: "CENTRAL",
    abbrev: "STL",
    city: "St. Louis",
    nickname: "Blues",
    name: "St. Louis Blues",
    nhlSlug: "st-louis-blues",
    vsinSlug: "st-louis-blues",
    dbSlug: "st_louis_blues",
    anSlug: "st-louis-blues",
    logoUrl: "https://assets.nhle.com/logos/nhl/svg/STL_dark.svg",
  },
  {
    conference: "WESTERN",
    division: "CENTRAL",
    abbrev: "UTA",
    city: "Utah",
    nickname: "Mammoth",
    name: "Utah Mammoth",
    nhlSlug: "utah-mammoth",
    vsinSlug: "utah-mammoth",
    dbSlug: "utah_mammoth",
    anSlug: "utah-mammoth",
    logoUrl: "https://assets.nhle.com/logos/nhl/svg/UTA_dark.svg",
  },
  {
    conference: "WESTERN",
    division: "CENTRAL",
    abbrev: "WPG",
    city: "Winnipeg",
    nickname: "Jets",
    name: "Winnipeg Jets",
    nhlSlug: "winnipeg-jets",
    vsinSlug: "winnipeg-jets",
    dbSlug: "winnipeg_jets",
    anSlug: "winnipeg-jets",
    logoUrl: "https://assets.nhle.com/logos/nhl/svg/WPG_dark.svg",
  },
  // ── Western Conference — Pacific Division ──────────────────────────────────
  {
    conference: "WESTERN",
    division: "PACIFIC",
    abbrev: "ANA",
    city: "Anaheim",
    nickname: "Ducks",
    name: "Anaheim Ducks",
    nhlSlug: "anaheim-ducks",
    vsinSlug: "anaheim-ducks",
    dbSlug: "anaheim_ducks",
    anSlug: "anaheim-ducks",
    logoUrl: "https://assets.nhle.com/logos/nhl/svg/ANA_dark.svg",
  },
  {
    conference: "WESTERN",
    division: "PACIFIC",
    abbrev: "CGY",
    city: "Calgary",
    nickname: "Flames",
    name: "Calgary Flames",
    nhlSlug: "calgary-flames",
    vsinSlug: "calgary-flames",
    dbSlug: "calgary_flames",
    anSlug: "calgary-flames",
    logoUrl: "https://assets.nhle.com/logos/nhl/svg/CGY_dark.svg",
  },
  {
    conference: "WESTERN",
    division: "PACIFIC",
    abbrev: "EDM",
    city: "Edmonton",
    nickname: "Oilers",
    name: "Edmonton Oilers",
    nhlSlug: "edmonton-oilers",
    vsinSlug: "edmonton-oilers",
    dbSlug: "edmonton_oilers",
    anSlug: "edmonton-oilers",
    logoUrl: "https://assets.nhle.com/logos/nhl/svg/EDM_dark.svg",
  },
  {
    conference: "WESTERN",
    division: "PACIFIC",
    abbrev: "LAK",
    city: "Los Angeles",
    nickname: "Kings",
    name: "Los Angeles Kings",
    nhlSlug: "los-angeles-kings",
    vsinSlug: "los-angeles-kings",
    dbSlug: "los_angeles_kings",
    anSlug: "los-angeles-kings",
    logoUrl: "https://assets.nhle.com/logos/nhl/svg/LAK_dark.svg",
  },
  {
    conference: "WESTERN",
    division: "PACIFIC",
    abbrev: "SJS",
    city: "San Jose",
    nickname: "Sharks",
    name: "San Jose Sharks",
    nhlSlug: "san-jose-sharks",
    vsinSlug: "san-jose-sharks",
    dbSlug: "san_jose_sharks",
    anSlug: "san-jose-sharks",
    logoUrl: "https://assets.nhle.com/logos/nhl/svg/SJS_dark.svg",
  },
  {
    conference: "WESTERN",
    division: "PACIFIC",
    abbrev: "SEA",
    city: "Seattle",
    nickname: "Kraken",
    name: "Seattle Kraken",
    nhlSlug: "seattle-kraken",
    vsinSlug: "seattle-kraken",
    dbSlug: "seattle_kraken",
    anSlug: "seattle-kraken",
    logoUrl: "https://assets.nhle.com/logos/nhl/svg/SEA_dark.svg",
  },
  {
    conference: "WESTERN",
    division: "PACIFIC",
    abbrev: "VAN",
    city: "Vancouver",
    nickname: "Canucks",
    name: "Vancouver Canucks",
    nhlSlug: "vancouver-canucks",
    vsinSlug: "vancouver-canucks",
    dbSlug: "vancouver_canucks",
    anSlug: "vancouver-canucks",
    logoUrl: "https://assets.nhle.com/logos/nhl/svg/VAN_dark.svg",
  },
  {
    conference: "WESTERN",
    division: "PACIFIC",
    abbrev: "VGK",
    city: "Vegas",
    nickname: "Golden Knights",
    name: "Vegas Golden Knights",
    nhlSlug: "vegas-golden-knights",
    vsinSlug: "vegas-golden-knights",
    dbSlug: "vegas_golden_knights",
    anSlug: "vegas-golden-knights",
    logoUrl: "https://assets.nhle.com/logos/nhl/svg/VGK_dark.svg",
  },
];

/**
 * Lookup map: vsinSlug → NhlTeam
 * Used by the NHL VSiN scraper for O(1) slug resolution.
 */
export const NHL_BY_VSIN_SLUG = new Map<string, NhlTeam>(
  NHL_TEAMS.map(t => [t.vsinSlug, t])
);

/**
 * Lookup map: dbSlug → NhlTeam
 * Used by the NHL schedule importer for O(1) DB slug resolution.
 */
export const NHL_BY_DB_SLUG = new Map<string, NhlTeam>(
  NHL_TEAMS.map(t => [t.dbSlug, t])
);

/**
 * Lookup map: nhlSlug → NhlTeam
 * Used by the NHL.com API schedule importer for O(1) NHL slug resolution.
 */
export const NHL_BY_NHL_SLUG = new Map<string, NhlTeam>(
  NHL_TEAMS.map(t => [t.nhlSlug, t])
);

/**
 * Lookup map: abbrev → NhlTeam
 * Used for abbreviation-based lookups (e.g. NHL API uses 3-letter team abbrevs).
 */
export const NHL_BY_ABBREV = new Map<string, NhlTeam>(
  NHL_TEAMS.map(t => [t.abbrev, t])
);

/**
 * Lookup map: anSlug → NhlTeam
 * Used by the Action Network scraper for O(1) AN slug resolution.
 */
export const NHL_BY_AN_SLUG = new Map<string, NhlTeam>(
  NHL_TEAMS.map(t => [t.anSlug, t])
);

/**
 * Set of all valid NHL DB slugs — used for VSiN scrape filtering.
 */
export const NHL_VALID_DB_SLUGS = new Set<string>(NHL_TEAMS.map(t => t.dbSlug));

/**
 * VSiN href aliases for NHL teams.
 * The live VSiN page may use shortened slugs for some teams.
 * Add entries here if discovered during scraping.
 * Format: { "short-slug": "canonical-vsin-slug" }
 */
export const VSIN_NHL_HREF_ALIASES: Record<string, string> = {
  // Confirmed live aliases from VSiN NHL betting splits page (2026-03-12)
  "ny-rangers": "new-york-rangers", // VSiN uses ny-rangers not new-york-rangers
  "ny-islanders": "new-york-islanders", // Keep consistent with NBA pattern
};

// ─── Helper functions ─────────────────────────────────────────────────────────

// AN slug aliases — old/alternate slugs that map to the same team
const NHL_AN_SLUG_ALIASES: Record<string, string> = {
  "utah-hockey-club": "utah-mammoth", // Utah rebranded from Hockey Club to Mammoth
};

/** Get team by Action Network url_slug (from AN API) */
export function getNhlTeamByAnSlug(anSlug: string): NhlTeam | undefined {
  const canonical = NHL_AN_SLUG_ALIASES[anSlug] ?? anSlug;
  return NHL_BY_AN_SLUG.get(canonical);
}
