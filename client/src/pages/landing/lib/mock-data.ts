// ── Types ─────────────────────────────────────────────────────────────────────
export type Confidence = "HIGH" | "MED" | "LOW";

export interface MarketRow {
  id: string;
  matchup: string;
  sport: string;
  gameTime: string;
  confidence: Confidence;
  updatedSecondsAgo: number;
  spread: { book: string; model: string; roi: number | null };
  total: { book: string; model: string; roi: number | null };
  moneyline: {
    bookHome: string;
    bookAway: string;
    modelHome: string;
    modelAway: string;
    roi: number | null;
  };
}

export interface SplitRow {
  id: string;
  matchup: string;
  awayTeam: string;
  homeTeam: string;
  market: string;
  awayTickets: number;
  homeTickets: number;
  awayMoney: number;
  homeMoney: number;
  openingLine: string;
  currentLine: string;
  signal: "MONEY_DIVERGENCE" | "PUBLIC_HEAVY" | "STEAM_MOVE" | "REVERSE_LINE" | "NO_SIGNAL";
  sharpSide: string | null;
}

export interface EdgeRow {
  id: string;
  matchup: string;
  market: string;
  bookPrice: string;
  noVigPrice: string;
  modelPrice: string;
  edgePct: number | null;
  roiPct: number | null;
  confidence: Confidence;
  updatedAt: string;
}

export interface SportCoverage {
  sport: string;
  emoji: string;
  markets: string[];
  status: "available" | "coming-soon";
  topEdge: string | null;
  updatedAt: string;
}

// ── Mock Market Rows ──────────────────────────────────────────────────────────
export const MOCK_MARKET_ROWS: MarketRow[] = [
  {
    id: "lad-sd",
    matchup: "LAD @ SD",
    sport: "MLB",
    gameTime: "7:10 PM ET",
    confidence: "HIGH",
    updatedSecondsAgo: 12,
    spread: { book: "LAD -1.5 (+115)", model: "LAD -1.5 (+108)", roi: 3.2 },
    total: { book: "O 8.5 (-110)", model: "O 8.5 (-104)", roi: 2.1 },
    moneyline: { bookHome: "SD +128", bookAway: "LAD -148", modelHome: "SD +118", modelAway: "LAD -138", roi: 4.1 },
  },
  {
    id: "nyy-bos",
    matchup: "NYY @ BOS",
    sport: "MLB",
    gameTime: "7:10 PM ET",
    confidence: "MED",
    updatedSecondsAgo: 34,
    spread: { book: "NYY -1.5 (-125)", model: "NYY -1.5 (-130)", roi: null },
    total: { book: "O 9.0 (-115)", model: "O 9.5 (-108)", roi: 2.8 },
    moneyline: { bookHome: "BOS +142", bookAway: "NYY -162", modelHome: "BOS +152", modelAway: "NYY -172", roi: null },
  },
  {
    id: "hou-tex",
    matchup: "HOU @ TEX",
    sport: "MLB",
    gameTime: "8:05 PM ET",
    confidence: "HIGH",
    updatedSecondsAgo: 8,
    spread: { book: "HOU -1.5 (+105)", model: "HOU -1.5 (+98)", roi: 3.6 },
    total: { book: "U 8.0 (-108)", model: "U 7.5 (-102)", roi: 1.9 },
    moneyline: { bookHome: "TEX +118", bookAway: "HOU -138", modelHome: "TEX +108", modelAway: "HOU -128", roi: 3.8 },
  },
  {
    id: "chi-mil",
    matchup: "CHC @ MIL",
    sport: "MLB",
    gameTime: "8:10 PM ET",
    confidence: "LOW",
    updatedSecondsAgo: 61,
    spread: { book: "MIL -1.5 (-135)", model: "MIL -1.5 (-140)", roi: null },
    total: { book: "O 8.5 (-112)", model: "O 8.5 (-112)", roi: null },
    moneyline: { bookHome: "MIL -155", bookAway: "CHC +135", modelHome: "MIL -160", modelAway: "CHC +140", roi: null },
  },
  {
    id: "atl-phi",
    matchup: "ATL @ PHI",
    sport: "MLB",
    gameTime: "6:45 PM ET",
    confidence: "HIGH",
    updatedSecondsAgo: 5,
    spread: { book: "ATL -1.5 (+120)", model: "ATL -1.5 (+112)", roi: 4.4 },
    total: { book: "O 9.0 (-110)", model: "O 9.0 (-105)", roi: 1.6 },
    moneyline: { bookHome: "PHI +132", bookAway: "ATL -152", modelHome: "PHI +122", modelAway: "ATL -142", roi: 5.1 },
  },
];

// ── Mock Split Rows ───────────────────────────────────────────────────────────
export const MOCK_SPLIT_ROWS: SplitRow[] = [
  {
    id: "lad-sd-split",
    matchup: "LAD @ SD",
    awayTeam: "LAD",
    homeTeam: "SD",
    market: "Spread",
    awayTickets: 38,
    homeTickets: 62,
    awayMoney: 71,
    homeMoney: 29,
    openingLine: "SD -1.5",
    currentLine: "SD -1.5",
    signal: "MONEY_DIVERGENCE",
    sharpSide: "LAD",
  },
  {
    id: "nyy-bos-split",
    matchup: "NYY @ BOS",
    awayTeam: "NYY",
    homeTeam: "BOS",
    market: "Moneyline",
    awayTickets: 74,
    homeTickets: 26,
    awayMoney: 78,
    homeMoney: 22,
    openingLine: "NYY -148",
    currentLine: "NYY -162",
    signal: "PUBLIC_HEAVY",
    sharpSide: null,
  },
  {
    id: "hou-tex-split",
    matchup: "HOU @ TEX",
    awayTeam: "HOU",
    homeTeam: "TEX",
    market: "Spread",
    awayTickets: 55,
    homeTickets: 45,
    awayMoney: 42,
    homeMoney: 58,
    openingLine: "HOU -1.5",
    currentLine: "TEX +1.5",
    signal: "REVERSE_LINE",
    sharpSide: "TEX",
  },
];

// ── Mock Edge Rows ────────────────────────────────────────────────────────────
export const MOCK_EDGE_ROWS: EdgeRow[] = [
  {
    id: "e1",
    matchup: "LAD @ SD",
    market: "LAD ML",
    bookPrice: "-148",
    noVigPrice: "-142",
    modelPrice: "-131",
    edgePct: 4.1,
    roiPct: 4.1,
    confidence: "HIGH",
    updatedAt: "12s ago",
  },
  {
    id: "e2",
    matchup: "ATL @ PHI",
    market: "ATL -1.5",
    bookPrice: "+120",
    noVigPrice: "+126",
    modelPrice: "+112",
    edgePct: 4.4,
    roiPct: 4.4,
    confidence: "HIGH",
    updatedAt: "5s ago",
  },
  {
    id: "e3",
    matchup: "HOU @ TEX",
    market: "HOU ML",
    bookPrice: "-138",
    noVigPrice: "-132",
    modelPrice: "-121",
    edgePct: 3.8,
    roiPct: 3.8,
    confidence: "HIGH",
    updatedAt: "8s ago",
  },
  {
    id: "e4",
    matchup: "NYY @ BOS",
    market: "O 9.0",
    bookPrice: "-115",
    noVigPrice: "-110",
    modelPrice: "-104",
    edgePct: 2.8,
    roiPct: 2.8,
    confidence: "MED",
    updatedAt: "34s ago",
  },
  {
    id: "e5",
    matchup: "LAD @ SD",
    market: "O 8.5",
    bookPrice: "-110",
    noVigPrice: "-105",
    modelPrice: "-100",
    edgePct: 2.1,
    roiPct: 2.1,
    confidence: "MED",
    updatedAt: "12s ago",
  },
];

// ── Sports Coverage ───────────────────────────────────────────────────────────
export const SPORTS_COVERAGE: SportCoverage[] = [
  {
    sport: "MLB",
    emoji: "⚾",
    markets: ["Moneyline", "Run Line", "Total", "F5", "Props"],
    status: "available",
    topEdge: "LAD ML +4.1% ROI",
    updatedAt: "Updated 12s ago",
  },
  {
    sport: "NBA",
    emoji: "🏀",
    markets: ["Spread", "Total", "Moneyline", "Props"],
    status: "available",
    topEdge: "BOS -3.5 +3.2% ROI",
    updatedAt: "Updated 2m ago",
  },
  {
    sport: "NFL",
    emoji: "🏈",
    markets: ["Spread", "Total", "Moneyline", "Props"],
    status: "available",
    topEdge: "KC -6.5 +2.9% ROI",
    updatedAt: "Updated 5m ago",
  },
  {
    sport: "NHL",
    emoji: "🏒",
    markets: ["Puck Line", "Total", "Moneyline"],
    status: "available",
    topEdge: "FLA ML +3.7% ROI",
    updatedAt: "Updated 18s ago",
  },
  {
    sport: "NCAAB",
    emoji: "🏀",
    markets: ["Spread", "Total", "Moneyline"],
    status: "available",
    topEdge: "Duke -4.5 +2.1% ROI",
    updatedAt: "Updated 1m ago",
  },
  {
    sport: "NCAAF",
    emoji: "🏈",
    markets: ["Spread", "Total", "Moneyline"],
    status: "available",
    topEdge: "Alabama -7 +1.8% ROI",
    updatedAt: "Updated 3m ago",
  },
  {
    sport: "WNBA",
    emoji: "🏀",
    markets: ["Spread", "Total", "Moneyline"],
    status: "available",
    topEdge: "LV Aces ML +2.4% ROI",
    updatedAt: "Updated 4m ago",
  },
  {
    sport: "NWSL",
    emoji: "⚽",
    markets: ["Moneyline", "Total", "Asian Handicap"],
    status: "available",
    topEdge: "Portland ML +1.9% ROI",
    updatedAt: "Updated 6m ago",
  },
  {
    sport: "More Sports",
    emoji: "🎯",
    markets: ["Tennis", "Golf", "MMA", "Boxing"],
    status: "coming-soon",
    topEdge: null,
    updatedAt: "In development",
  },
];
