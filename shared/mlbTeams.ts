/**
 * MLB Team Registry — 30 MLB teams
 * Authoritative cross-source mapping for all data integrations.
 *
 * Key fields:
 *   mlbId        — MLB Stats API numeric team ID (statsapi.mlb.com)
 *   mlbCode      — MLB.com internal team code (3-letter lowercase, e.g. "nya")
 *   abbrev       — Standard MLB abbreviation (e.g. "NYY", "LAD")
 *   brAbbrev     — Baseball Reference team abbreviation (e.g. "NYY", "LAD", "KCR", "TBD")
 *   league       — "AL" | "NL"
 *   division     — "East" | "Central" | "West"
 *   city         — Display city/region name (e.g. "New York", "Tampa Bay")
 *   nickname     — Team nickname (e.g. "Yankees", "Blue Jays")
 *   name         — Full team name (city + nickname)
 *   vsinSlug     — VSiN href slug (single-word, e.g. "yankees", "redsox")
 *   dbSlug       — Database storage key (vsinSlug, used as primary key)
 *   anSlug       — Action Network URL slug (e.g. "new-york-yankees")
 *   anLogoSlug   — Action Network logo slug for sprtactn.co CDN (e.g. "nyyd")
 *   logoUrl      — Official MLB.com SVG logo URL (www.mlbstatic.com/team-logos/{mlbId}.svg)
 *   primaryColor   — Primary brand hex color
 *   secondaryColor — Secondary brand hex color
 *   tertiaryColor  — Tertiary brand hex color (optional)
 *
 * Logo URL pattern:
 *   https://www.mlbstatic.com/team-logos/{mlbId}.svg
 *
 * AN logo URL pattern:
 *   https://static.sprtactn.co/teamlogos/mlb/100/{anLogoSlug}.png
 *
 * BR team URL pattern:
 *   https://www.baseball-reference.com/teams/{brAbbrev}/
 *
 * VSiN slug notes:
 *   - Single-word, no hyphens (e.g. "redsox" not "red-sox")
 *   - "dbacks" for Arizona Diamondbacks
 *   - "whitesox" for Chicago White Sox
 *   - "bluejays" for Toronto Blue Jays
 *
 * BR abbreviation notes:
 *   - Kansas City Royals: "KCR" (not "KC")
 *   - Tampa Bay Rays: "TBD" (historical BR code, not "TB")
 *   - San Diego Padres: "SDP" (not "SD")
 *   - San Francisco Giants: "SFG" (not "SF")
 *   - Washington Nationals: "WSN" (not "WSH")
 *   - Miami Marlins: "FLA" (historical BR code, not "MIA")
 *   - Chicago White Sox: "CHW" (not "CWS")
 *   - Athletics: "OAK" (BR still uses Oakland code)
 *
 * Athletics note:
 *   The team relocated from Oakland to Sacramento for 2025.
 *   MLB.com code is still "ath", abbrev "ATH", AN still uses "oakland-athletics" slug.
 *   BR still uses "OAK" as their team abbreviation.
 */

export interface MlbTeam {
  mlbId: number;
  mlbCode: string;
  abbrev: string;
  /** Baseball Reference team abbreviation — may differ from standard abbrev */
  brAbbrev: string;
  league: "AL" | "NL";
  division: "East" | "Central" | "West" | "All-Star";
  city: string;
  nickname: string;
  name: string;
  vsinSlug: string;
  dbSlug: string;
  anSlug: string;
  anLogoSlug: string;
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  tertiaryColor?: string;
}

export const MLB_TEAMS: MlbTeam[] = [
  // ── American League East ────────────────────────────────────────────────────
  {
    mlbId: 110, mlbCode: "bal", abbrev: "BAL", brAbbrev: "BAL",
    league: "AL", division: "East",
    city: "Baltimore", nickname: "Orioles", name: "Baltimore Orioles",
    vsinSlug: "orioles", dbSlug: "orioles",
    anSlug: "baltimore-orioles", anLogoSlug: "bal",
    logoUrl: "https://www.mlbstatic.com/team-logos/110.svg",
    primaryColor: "#DF4601", secondaryColor: "#000000",
  },
  {
    mlbId: 111, mlbCode: "bos", abbrev: "BOS", brAbbrev: "BOS",
    league: "AL", division: "East",
    city: "Boston", nickname: "Red Sox", name: "Boston Red Sox",
    vsinSlug: "redsox", dbSlug: "redsox",
    anSlug: "boston-red-sox", anLogoSlug: "bos",
    logoUrl: "https://www.mlbstatic.com/team-logos/111.svg",
    primaryColor: "#BD3039", secondaryColor: "#0C2340",
  },
  {
    mlbId: 147, mlbCode: "nya", abbrev: "NYY", brAbbrev: "NYY",
    league: "AL", division: "East",
    city: "New York", nickname: "Yankees", name: "New York Yankees",
    vsinSlug: "yankees", dbSlug: "yankees",
    anSlug: "new-york-yankees", anLogoSlug: "nyyd",
    logoUrl: "https://www.mlbstatic.com/team-logos/147.svg",
    primaryColor: "#003087", secondaryColor: "#FFFFFF",
  },
  {
    mlbId: 139, mlbCode: "tba", abbrev: "TB", brAbbrev: "TBD",
    league: "AL", division: "East",
    city: "Tampa Bay", nickname: "Rays", name: "Tampa Bay Rays",
    vsinSlug: "rays", dbSlug: "rays",
    anSlug: "tampa-bay-rays", anLogoSlug: "tb",
    logoUrl: "https://www.mlbstatic.com/team-logos/139.svg",
    primaryColor: "#092C5C", secondaryColor: "#8FBCE6", tertiaryColor: "#F5D130",
  },
  {
    mlbId: 141, mlbCode: "tor", abbrev: "TOR", brAbbrev: "TOR",
    league: "AL", division: "East",
    city: "Toronto", nickname: "Blue Jays", name: "Toronto Blue Jays",
    vsinSlug: "bluejays", dbSlug: "bluejays",
    anSlug: "toronto-blue-jays", anLogoSlug: "tor",
    logoUrl: "https://www.mlbstatic.com/team-logos/141.svg",
    primaryColor: "#134A8E", secondaryColor: "#1D2D5C", tertiaryColor: "#E8291C",
  },

  // ── American League Central ─────────────────────────────────────────────────
  {
    mlbId: 145, mlbCode: "cha", abbrev: "CWS", brAbbrev: "CHW",
    league: "AL", division: "Central",
    city: "Chicago", nickname: "White Sox", name: "Chicago White Sox",
    vsinSlug: "whitesox", dbSlug: "whitesox",
    anSlug: "chicago-white-sox", anLogoSlug: "cws",
    logoUrl: "https://www.mlbstatic.com/team-logos/145.svg",
    primaryColor: "#27251F", secondaryColor: "#C4CED4",
  },
  {
    mlbId: 114, mlbCode: "cle", abbrev: "CLE", brAbbrev: "CLE",
    league: "AL", division: "Central",
    city: "Cleveland", nickname: "Guardians", name: "Cleveland Guardians",
    vsinSlug: "guardians", dbSlug: "guardians",
    anSlug: "cleveland-guardians", anLogoSlug: "cle",
    logoUrl: "https://www.mlbstatic.com/team-logos/114.svg",
    primaryColor: "#00385D", secondaryColor: "#E31937",
  },
  {
    mlbId: 116, mlbCode: "det", abbrev: "DET", brAbbrev: "DET",
    league: "AL", division: "Central",
    city: "Detroit", nickname: "Tigers", name: "Detroit Tigers",
    vsinSlug: "tigers", dbSlug: "tigers",
    anSlug: "detroit-tigers", anLogoSlug: "det",
    logoUrl: "https://www.mlbstatic.com/team-logos/116.svg",
    primaryColor: "#0C2340", secondaryColor: "#FA4616",
  },
  {
    mlbId: 118, mlbCode: "kca", abbrev: "KC", brAbbrev: "KCR",
    league: "AL", division: "Central",
    city: "Kansas City", nickname: "Royals", name: "Kansas City Royals",
    vsinSlug: "royals", dbSlug: "royals",
    anSlug: "kansas-city-royals", anLogoSlug: "kcd",
    logoUrl: "https://www.mlbstatic.com/team-logos/118.svg",
    primaryColor: "#004687", secondaryColor: "#BD9B60",
  },
  {
    mlbId: 142, mlbCode: "min", abbrev: "MIN", brAbbrev: "MIN",
    league: "AL", division: "Central",
    city: "Minnesota", nickname: "Twins", name: "Minnesota Twins",
    vsinSlug: "twins", dbSlug: "twins",
    anSlug: "minnesota-twins", anLogoSlug: "mind",
    logoUrl: "https://www.mlbstatic.com/team-logos/142.svg",
    primaryColor: "#002B5C", secondaryColor: "#D31145", tertiaryColor: "#B9975B",
  },

  // ── American League West ────────────────────────────────────────────────────
  {
    mlbId: 133, mlbCode: "ath", abbrev: "ATH", brAbbrev: "OAK",
    league: "AL", division: "West",
    city: "Sacramento", nickname: "Athletics", name: "Athletics",
    vsinSlug: "athletics", dbSlug: "oakland-athletics", // AN API stores as oakland-athletics
    anSlug: "oakland-athletics", anLogoSlug: "oakd",
    logoUrl: "https://www.mlbstatic.com/team-logos/133.svg",
    primaryColor: "#003831", secondaryColor: "#EFB21E",
  },
  {
    mlbId: 117, mlbCode: "hou", abbrev: "HOU", brAbbrev: "HOU",
    league: "AL", division: "West",
    city: "Houston", nickname: "Astros", name: "Houston Astros",
    vsinSlug: "astros", dbSlug: "astros",
    anSlug: "houston-astros", anLogoSlug: "hou",
    logoUrl: "https://www.mlbstatic.com/team-logos/117.svg",
    primaryColor: "#002D62", secondaryColor: "#EB6E1F", tertiaryColor: "#F4911E",
  },
  {
    mlbId: 108, mlbCode: "ana", abbrev: "LAA", brAbbrev: "ANA",
    league: "AL", division: "West",
    city: "Los Angeles", nickname: "Angels", name: "Los Angeles Angels",
    vsinSlug: "angels", dbSlug: "angels",
    anSlug: "los-angeles-angels", anLogoSlug: "laa",
    logoUrl: "https://www.mlbstatic.com/team-logos/108.svg",
    primaryColor: "#BA0021", secondaryColor: "#003263", tertiaryColor: "#C4CED4",
  },
  {
    mlbId: 136, mlbCode: "sea", abbrev: "SEA", brAbbrev: "SEA",
    league: "AL", division: "West",
    city: "Seattle", nickname: "Mariners", name: "Seattle Mariners",
    vsinSlug: "mariners", dbSlug: "mariners",
    anSlug: "seattle-mariners", anLogoSlug: "sea",
    logoUrl: "https://www.mlbstatic.com/team-logos/136.svg",
    primaryColor: "#0C2C56", secondaryColor: "#005C5C", tertiaryColor: "#C4CED4",
  },
  {
    mlbId: 140, mlbCode: "tex", abbrev: "TEX", brAbbrev: "TEX",
    league: "AL", division: "West",
    city: "Texas", nickname: "Rangers", name: "Texas Rangers",
    vsinSlug: "rangers", dbSlug: "rangers",
    anSlug: "texas-rangers", anLogoSlug: "tex",
    logoUrl: "https://www.mlbstatic.com/team-logos/140.svg",
    primaryColor: "#003278", secondaryColor: "#C0111F",
  },

  // ── National League East ────────────────────────────────────────────────────
  {
    mlbId: 144, mlbCode: "atl", abbrev: "ATL", brAbbrev: "ATL",
    league: "NL", division: "East",
    city: "Atlanta", nickname: "Braves", name: "Atlanta Braves",
    vsinSlug: "braves", dbSlug: "braves",
    anSlug: "atlanta-braves", anLogoSlug: "atl",
    logoUrl: "https://www.mlbstatic.com/team-logos/144.svg",
    primaryColor: "#CE1141", secondaryColor: "#13274F", tertiaryColor: "#EAAA00",
  },
  {
    mlbId: 146, mlbCode: "mia", abbrev: "MIA", brAbbrev: "FLA",
    league: "NL", division: "East",
    city: "Miami", nickname: "Marlins", name: "Miami Marlins",
    vsinSlug: "marlins", dbSlug: "marlins",
    anSlug: "miami-marlins", anLogoSlug: "mia_n",
    logoUrl: "https://www.mlbstatic.com/team-logos/146.svg",
    primaryColor: "#00A3E0", secondaryColor: "#EF3340", tertiaryColor: "#000000",
  },
  {
    mlbId: 121, mlbCode: "nyn", abbrev: "NYM", brAbbrev: "NYM",
    league: "NL", division: "East",
    city: "New York", nickname: "Mets", name: "New York Mets",
    vsinSlug: "mets", dbSlug: "mets",
    anSlug: "new-york-mets", anLogoSlug: "nym",
    logoUrl: "https://www.mlbstatic.com/team-logos/121.svg",
    primaryColor: "#002D72", secondaryColor: "#FF5910",
  },
  {
    mlbId: 143, mlbCode: "phi", abbrev: "PHI", brAbbrev: "PHI",
    league: "NL", division: "East",
    city: "Philadelphia", nickname: "Phillies", name: "Philadelphia Phillies",
    vsinSlug: "phillies", dbSlug: "phillies",
    anSlug: "philadelphia-phillies", anLogoSlug: "phi",
    logoUrl: "https://www.mlbstatic.com/team-logos/143.svg",
    primaryColor: "#E81828", secondaryColor: "#002D72",
  },
  {
    mlbId: 120, mlbCode: "was", abbrev: "WSH", brAbbrev: "WSN",
    league: "NL", division: "East",
    city: "Washington", nickname: "Nationals", name: "Washington Nationals",
    vsinSlug: "nationals", dbSlug: "nationals",
    anSlug: "washington-nationals", anLogoSlug: "wsh",
    logoUrl: "https://www.mlbstatic.com/team-logos/120.svg",
    primaryColor: "#AB0003", secondaryColor: "#14225A", tertiaryColor: "#FFFFFF",
  },

  // ── National League Central ─────────────────────────────────────────────────
  {
    mlbId: 112, mlbCode: "chn", abbrev: "CHC", brAbbrev: "CHC",
    league: "NL", division: "Central",
    city: "Chicago", nickname: "Cubs", name: "Chicago Cubs",
    vsinSlug: "cubs", dbSlug: "cubs",
    anSlug: "chicago-cubs", anLogoSlug: "chc",
    logoUrl: "https://www.mlbstatic.com/team-logos/112.svg",
    primaryColor: "#0E3386", secondaryColor: "#CC3433",
  },
  {
    mlbId: 113, mlbCode: "cin", abbrev: "CIN", brAbbrev: "CIN",
    league: "NL", division: "Central",
    city: "Cincinnati", nickname: "Reds", name: "Cincinnati Reds",
    vsinSlug: "reds", dbSlug: "reds",
    anSlug: "cincinnati-reds", anLogoSlug: "cin",
    logoUrl: "https://www.mlbstatic.com/team-logos/113.svg",
    primaryColor: "#C6011F", secondaryColor: "#000000",
  },
  {
    mlbId: 158, mlbCode: "mil", abbrev: "MIL", brAbbrev: "MIL",
    league: "NL", division: "Central",
    city: "Milwaukee", nickname: "Brewers", name: "Milwaukee Brewers",
    vsinSlug: "brewers", dbSlug: "brewers",
    anSlug: "milwaukee-brewers", anLogoSlug: "mil",
    logoUrl: "https://www.mlbstatic.com/team-logos/158.svg",
    primaryColor: "#12284B", secondaryColor: "#FFC52F",
  },
  {
    mlbId: 134, mlbCode: "pit", abbrev: "PIT", brAbbrev: "PIT",
    league: "NL", division: "Central",
    city: "Pittsburgh", nickname: "Pirates", name: "Pittsburgh Pirates",
    vsinSlug: "pirates", dbSlug: "pirates",
    anSlug: "pittsburgh-pirates", anLogoSlug: "pit",
    logoUrl: "https://www.mlbstatic.com/team-logos/134.svg",
    primaryColor: "#27251F", secondaryColor: "#FDB827",
  },
  {
    mlbId: 138, mlbCode: "sln", abbrev: "STL", brAbbrev: "STL",
    league: "NL", division: "Central",
    city: "St. Louis", nickname: "Cardinals", name: "St. Louis Cardinals",
    vsinSlug: "cardinals", dbSlug: "st-louis-cardinals", // AN API stores as st-louis-cardinals
    anSlug: "st-louis-cardinals", anLogoSlug: "stl",
    logoUrl: "https://www.mlbstatic.com/team-logos/138.svg",
    primaryColor: "#C41E3A", secondaryColor: "#0C2340",
  },

  // ── National League West ────────────────────────────────────────────────────
  {
    mlbId: 109, mlbCode: "ari", abbrev: "ARI", brAbbrev: "ARI",
    league: "NL", division: "West",
    city: "Arizona", nickname: "D-backs", name: "Arizona Diamondbacks",
    vsinSlug: "dbacks", dbSlug: "dbacks",
    anSlug: "arizona-diamondbacks", anLogoSlug: "ari",
    logoUrl: "https://www.mlbstatic.com/team-logos/109.svg",
    primaryColor: "#A71930", secondaryColor: "#E3D4AD", tertiaryColor: "#000000",
  },
  {
    mlbId: 115, mlbCode: "col", abbrev: "COL", brAbbrev: "COL",
    league: "NL", division: "West",
    city: "Colorado", nickname: "Rockies", name: "Colorado Rockies",
    vsinSlug: "rockies", dbSlug: "rockies",
    anSlug: "colorado-rockies", anLogoSlug: "col",
    logoUrl: "https://www.mlbstatic.com/team-logos/115.svg",
    primaryColor: "#33006F", secondaryColor: "#C4CED4",
  },
  {
    mlbId: 119, mlbCode: "lan", abbrev: "LAD", brAbbrev: "LAD",
    league: "NL", division: "West",
    city: "Los Angeles", nickname: "Dodgers", name: "Los Angeles Dodgers",
    vsinSlug: "dodgers", dbSlug: "dodgers",
    anSlug: "los-angeles-dodgers", anLogoSlug: "ladd",
    logoUrl: "https://www.mlbstatic.com/team-logos/119.svg",
    primaryColor: "#005A9C", secondaryColor: "#EF3E42",
  },
  {
    mlbId: 135, mlbCode: "sdn", abbrev: "SD", brAbbrev: "SDP",
    league: "NL", division: "West",
    city: "San Diego", nickname: "Padres", name: "San Diego Padres",
    vsinSlug: "padres", dbSlug: "padres",
    anSlug: "san-diego-padres", anLogoSlug: "sd",
    logoUrl: "https://www.mlbstatic.com/team-logos/135.svg",
    primaryColor: "#2F241D", secondaryColor: "#FFC425",
  },
  {
    mlbId: 137, mlbCode: "sfn", abbrev: "SF", brAbbrev: "SFG",
    league: "NL", division: "West",
    city: "San Francisco", nickname: "Giants", name: "San Francisco Giants",
    vsinSlug: "giants", dbSlug: "giants",
    anSlug: "san-francisco-giants", anLogoSlug: "sf",
    logoUrl: "https://www.mlbstatic.com/team-logos/137.svg",
    primaryColor: "#FD5A1E", secondaryColor: "#27251F", tertiaryColor: "#EFD19F",
  },
];

// ─── Lookup maps ──────────────────────────────────────────────────────────────

/** Lookup map: abbrev → MlbTeam (e.g. "NYY" → Yankees) */
export const MLB_BY_ABBREV = new Map<string, MlbTeam>(
  MLB_TEAMS.map((t) => [t.abbrev, t])
);

/** Lookup map: mlbId → MlbTeam */
export const MLB_BY_ID = new Map<number, MlbTeam>(
  MLB_TEAMS.map((t) => [t.mlbId, t])
);

/** Lookup map: mlbCode → MlbTeam (e.g. "nya" → Yankees) */
export const MLB_BY_CODE = new Map<string, MlbTeam>(
  MLB_TEAMS.map((t) => [t.mlbCode, t])
);

/** Lookup map: vsinSlug → MlbTeam (e.g. "yankees" → Yankees) */
export const MLB_BY_VSIN_SLUG = new Map<string, MlbTeam>(
  MLB_TEAMS.map((t) => [t.vsinSlug, t])
);

/** Lookup map: dbSlug → MlbTeam */
export const MLB_BY_DB_SLUG = new Map<string, MlbTeam>(
  MLB_TEAMS.map((t) => [t.dbSlug, t])
);

/** Lookup map: anSlug → MlbTeam (e.g. "new-york-yankees" → Yankees) */
export const MLB_BY_AN_SLUG = new Map<string, MlbTeam>(
  MLB_TEAMS.map((t) => [t.anSlug, t])
);

/** Lookup map: brAbbrev → MlbTeam (e.g. "KCR" → Royals, "TBD" → Rays) */
export const MLB_BY_BR_ABBREV = new Map<string, MlbTeam>(
  MLB_TEAMS.map((t) => [t.brAbbrev, t])
);

/** Set of all valid MLB DB slugs — used for VSiN scrape filtering. */
export const MLB_VALID_DB_SLUGS = new Set<string>(MLB_TEAMS.map((t) => t.dbSlug));

/** Set of all valid MLB abbreviations — used for schedule-seeded game filtering (teams stored as abbrev). */
export const MLB_VALID_ABBREVS = new Set<string>(MLB_TEAMS.map((t) => t.abbrev));

// ─── All-Star pseudo-teams (AL / NL) ──────────────────────────────────────────
/**
 * The American League and National League squads for the MLB All-Star Game.
 *
 * These are DELIBERATELY NOT part of MLB_TEAMS (the 30 clubs), so they never
 * surface in team pickers, standings, or anything built by iterating MLB_TEAMS.
 * They are registered ONLY into the lookup maps/sets that the projections feed
 * and the live Action Network odds refresh depend on, so the AL-vs-NL All-Star
 * Game (a) passes isValidGame in games.list and (b) has its book ML / run line /
 * total kept CURRENT by the normal refreshAnApiOdds cycle
 * (getMlbTeamByAnSlug resolves the AN url_slug → these teams → the existing
 * updateAnOdds write path). The odds are therefore live, not a static snapshot.
 *
 * Field values verified from the Action Network API (event 291776, 2026-07-14):
 *   away_team_id 249 = American League (url_slug "american-league")
 *   home_team_id 250 = National League (url_slug "national-league")
 * mlbId holds the AN event team id (249/250) — these never collide with the
 * real 30-club statsapi ids (108–158) and MLB_BY_ID is not on the feed path for
 * these pseudo-teams. Logos use the AN CDN PNGs (mlbstatic has no AL/NL SVG).
 */
export const MLB_ALLSTAR_TEAMS: MlbTeam[] = [
  {
    mlbId: 249, mlbCode: "al", abbrev: "AL", brAbbrev: "AL",
    league: "AL", division: "All-Star",
    city: "American League", nickname: "All-Stars", name: "American League",
    vsinSlug: "al-allstars", dbSlug: "al-allstars",
    anSlug: "american-league", anLogoSlug: "al",
    logoUrl: "https://static.sprtactn.co/teamlogos/mlb/100/al.png",
    primaryColor: "#CE1141", secondaryColor: "#FFFFFF",
    isAllStar: true,
  },
  {
    mlbId: 250, mlbCode: "nl", abbrev: "NL", brAbbrev: "NL",
    league: "NL", division: "All-Star",
    city: "National League", nickname: "All-Stars", name: "National League",
    vsinSlug: "nl-allstars", dbSlug: "nl-allstars",
    anSlug: "national-league", anLogoSlug: "nl",
    logoUrl: "https://static.sprtactn.co/teamlogos/mlb/100/nl.png",
    primaryColor: "#13274F", secondaryColor: "#FFFFFF",
    isAllStar: true,
  },
];

// Register the pseudo-teams into the resolution maps/sets ONLY (never MLB_TEAMS).
for (const t of MLB_ALLSTAR_TEAMS) {
  MLB_BY_ABBREV.set(t.abbrev, t);
  MLB_BY_ID.set(t.mlbId, t);
  MLB_BY_CODE.set(t.mlbCode, t);
  MLB_BY_VSIN_SLUG.set(t.vsinSlug, t);
  MLB_BY_DB_SLUG.set(t.dbSlug, t);
  MLB_BY_AN_SLUG.set(t.anSlug, t);
  MLB_VALID_ABBREVS.add(t.abbrev);
  MLB_VALID_DB_SLUGS.add(t.dbSlug);
}

// ─── VSiN slug aliases ────────────────────────────────────────────────────────
/**
 * VSiN href aliases for MLB teams.
 * The live VSiN page may use alternate slugs for some teams.
 * Format: { "alternate-slug": "canonical-vsin-slug" }
 */
export const VSIN_MLB_HREF_ALIASES: Record<string, string> = {
  // ── Multi-word short-form aliases (combined betting-splits page) ──────────
  "red-sox": "redsox",
  "white-sox": "whitesox",
  "blue-jays": "bluejays",
  "d-backs": "dbacks",
  "diamondbacks": "dbacks",

  // ── Full hyphenated slugs (MLB-specific page: data.vsin.com/mlb/betting-splits/) ──
  // These match the anSlug format exactly (e.g. "new-york-yankees" → "yankees")
  "new-york-yankees": "yankees",
  "boston-red-sox": "redsox",
  "tampa-bay-rays": "rays",
  "toronto-blue-jays": "bluejays",
  "baltimore-orioles": "orioles",
  "chicago-white-sox": "whitesox",
  "cleveland-guardians": "guardians",
  "detroit-tigers": "tigers",
  "kansas-city-royals": "royals",
  "minnesota-twins": "twins",
  "houston-astros": "astros",
  "los-angeles-angels": "angels",
  "oakland-athletics": "athletics",
  "sacramento-athletics": "athletics",
  "athletics": "athletics",
  "seattle-mariners": "mariners",
  "texas-rangers": "rangers",
  "atlanta-braves": "braves",
  "miami-marlins": "marlins",
  "new-york-mets": "mets",
  "philadelphia-phillies": "phillies",
  "washington-nationals": "nationals",
  "chicago-cubs": "cubs",
  "cincinnati-reds": "reds",
  "milwaukee-brewers": "brewers",
  "pittsburgh-pirates": "pirates",
  "st-louis-cardinals": "cardinals",
  "arizona-diamondbacks": "dbacks",
  "colorado-rockies": "rockies",
  "los-angeles-dodgers": "dodgers",
  "san-diego-padres": "padres",
  "san-francisco-giants": "giants",
};

// ─── AN slug aliases ──────────────────────────────────────────────────────────
const MLB_AN_SLUG_ALIASES: Record<string, string> = {
  // Athletics relocated from Oakland to Sacramento; AN still uses oakland slug
  "sacramento-athletics": "oakland-athletics",
  // AN sometimes uses "st.-louis-cardinals" (with period) instead of "st-louis-cardinals"
  "st.-louis-cardinals": "st-louis-cardinals",
};

/** Get team by Action Network url_slug (from AN API or page) */
export function getMlbTeamByAnSlug(anSlug: string): MlbTeam | undefined {
  const canonical = MLB_AN_SLUG_ALIASES[anSlug] ?? anSlug;
  return MLB_BY_AN_SLUG.get(canonical);
}

/** Get team by VSiN slug (handles aliases) */
export function getMlbTeamByVsinSlug(slug: string): MlbTeam | undefined {
  const canonical = VSIN_MLB_HREF_ALIASES[slug] ?? slug;
  return MLB_BY_VSIN_SLUG.get(canonical);
}

/** Get team by Baseball Reference abbreviation (handles historical codes like "TBD", "FLA", "OAK") */
export function getMlbTeamByBrAbbrev(brAbbrev: string): MlbTeam | undefined {
  return MLB_BY_BR_ABBREV.get(brAbbrev);
}
