import { LOGO } from "@/lib/data/logos";
import type {
  Conversation,
  CreditActivityEntry,
  FeedGame,
  MatchAnalysis,
  PropProjection,
  SplitsData,
} from "@/lib/types";

export const DISPLAY_NAME = "Prez Bets";
export const HANDLE = "@prez";

export const SIDE_NAV = [
  { key: "new", label: "New Chat", plus: true },
  { key: "proj", label: "AI Model Projections", plus: false },
  { key: "splits", label: "Betting Splits + Odds History", plus: false },
  { key: "trends", label: "Trends", plus: false },
  { key: "props", label: "Prop Projections", plus: false },
  { key: "tracker", label: "Bet Tracker", plus: false },
] as const;

export const SIDE_RECENTS = [
  "Will Messi score a goal today vs Egypt?",
  "Ohtani strikeout total projection",
  "Rockies vs Dodgers Best Bets",
  "The Model’s favorite picks July 7",
  "France World Cup Odds",
  "Bankroll Management Advice",
];

export const HOME_PROMPTS = [
  "World Cup Model Simulations",
  "Player Props with the Most Edge",
  "Best Trends for MLB July 7, 2026",
];

export const BOTTOM_NAV: { key: "feed" | "splits" | "chat" | "props" | "profile"; label: string }[] = [
  { key: "feed", label: "Feed" },
  { key: "splits", label: "Splits" },
  { key: "chat", label: "Chat" },
  { key: "props", label: "Props" },
  { key: "profile", label: "Profile" },
];

const SIMS = "400,000 simulations";
const META = "Updated 6:02 PM ET · Model v2.4";
export const PROPS_META = "Updated 6:15 PM ET · Model v2.4";
export const FEED_UPDATED = "Updated 6:02 PM ET";
export const PROPS_UPDATED = "Updated 6:15 PM ET";

export function worldCupMatch(): MatchAnalysis {
  return {
    comp: "FIFA World Cup · Semifinal · 3:00 PM ET",
    sims: SIMS,
    away: "Argentina",
    awayLogo: LOGO.argentina,
    awayAlt: "Argentina flag",
    home: "France",
    homeLogo: LOGO.france,
    homeAlt: "France flag",
    score: "2 – 1",
    probs: [
      { label: "Argentina", pct: 46, lead: true },
      { label: "Draw", pct: 27, lead: false },
      { label: "France", pct: 27, lead: false },
    ],
    totals: "Total 2.5 · Model lean Over",
    marketName: "Argentina ML",
    bookPrice: "+136",
    fairPrice: "+117",
    edge: "+3.6%",
    drivers: [
      "Model gives Argentina a 46% win probability across 400,000 simulations, with a 27% draw chance and France at 27%.",
      "Argentina's expected-goals rate has outpaced France's over their last 6 meetings.",
      "The extra rest day before kickoff favors Argentina's press intensity late in the match.",
    ],
    risk: "Extra time and penalties introduce variance the base model doesn't fully capture.",
    meta: META,
    aria: "Argentina vs France match analysis",
  };
}

export function yankeesRedSoxMatch(): MatchAnalysis {
  return {
    comp: "MLB · Tonight 7:10 PM ET",
    sims: SIMS,
    away: "Red Sox",
    awayLogo: LOGO.redsox,
    awayAlt: "Boston Red Sox logo",
    home: "Yankees",
    homeLogo: LOGO.yankees,
    homeAlt: "New York Yankees logo",
    score: "5 – 4",
    probs: [
      { label: "Yankees", pct: 54, lead: true },
      { label: "Red Sox", pct: 46, lead: false },
    ],
    totals: "Model total 9.4 · Book 8.5",
    marketName: "Over 8.5",
    bookPrice: "−110",
    fairPrice: "−126",
    edge: "+3.8%",
    drivers: [
      "Combined run environment projects to 9.4, nearly a full run above the posted 8.5 total.",
      "Both bullpens have logged extra innings in the last 3 days, elevating late hard-contact rates.",
      "Wind profile at first pitch favors fly-ball carry toward the shorter porch in right.",
    ],
    risk: "A wind shift before first pitch could flatten the park factor back toward the posted number.",
    meta: META,
    aria: "Yankees vs Red Sox match analysis",
  };
}

export function dodgersRockiesMatch(): MatchAnalysis {
  return {
    comp: "MLB · Tonight 8:40 PM ET",
    sims: SIMS,
    away: "Rockies",
    awayLogo: LOGO.rockies,
    awayAlt: "Colorado Rockies logo",
    home: "Dodgers",
    homeLogo: LOGO.dodgers,
    homeAlt: "Los Angeles Dodgers logo",
    score: "6 – 4",
    probs: [
      { label: "Dodgers", pct: 61, lead: true },
      { label: "Rockies", pct: 39, lead: false },
    ],
    totals: "Model margin −1.9 · Book −1.5",
    marketName: "Dodgers −1.5",
    bookPrice: "+142",
    fairPrice: "+118",
    edge: "+5.1%",
    drivers: [
      "Projected margin sits just under two runs, with the Dodgers' rotation holding a strikeout-rate edge.",
      "The Rockies' road bullpen ERA is up over a full run this month.",
      "Altitude-adjusted park factors still keep the total moderate for this specific matchup.",
    ],
    risk: "Altitude variance widens the run distribution; re-check the price near first pitch.",
    meta: META,
    aria: "Dodgers vs Rockies match analysis",
  };
}

export function celticsKnicksMatch(): MatchAnalysis {
  return {
    comp: "NBA · Tonight 7:30 PM ET",
    sims: SIMS,
    away: "Knicks",
    awayLogo: LOGO.knicks,
    awayAlt: "New York Knicks logo",
    home: "Celtics",
    homeLogo: LOGO.celtics,
    homeAlt: "Boston Celtics logo",
    score: "112 – 108",
    probs: [
      { label: "Celtics", pct: 58, lead: true },
      { label: "Knicks", pct: 42, lead: false },
    ],
    totals: "Model margin +4 · Book +6.5",
    marketName: "Knicks +6.5",
    bookPrice: "−110",
    fairPrice: "−128",
    edge: "+3.9%",
    drivers: [
      "Simulations keep this game within five points far more often than the posted spread implies.",
      "New York's clutch-minute net rating ranks top-6 since the trade deadline.",
      "Boston is on the road-trip back end, historically its softer defensive stretch.",
    ],
    risk: "An early Celtics blowout would remove the late-game possessions this lean depends on.",
    meta: META,
    aria: "Celtics vs Knicks match analysis",
  };
}

export function propProjections(): PropProjection[] {
  return [
    {
      player: "Jayson Tatum",
      team: "BOS",
      teamLogo: LOGO.celtics,
      teamAlt: "Boston Celtics logo",
      opp: "NYK",
      oppLogo: LOGO.knicks,
      oppAlt: "New York Knicks logo",
      vs: "vs",
      market: "Points Over 27.5",
      bookPrice: "−112",
      projection: "30.1",
      fairPrice: "−138",
      edge: "+5.2%",
      confidence: "High",
      evidence: [
        "Averaging 31.4 points over his last 8 matches.",
        "New York allows the 4th-most points to wings.",
        "Pace-up spot: model projects 101 possessions.",
      ],
      risk: "A lopsided score could trim fourth-quarter minutes.",
    },
    {
      player: "Shai Gilgeous-Alexander",
      team: "OKC",
      teamLogo: LOGO.thunder,
      teamAlt: "Oklahoma City Thunder logo",
      opp: "DEN",
      oppLogo: LOGO.nuggets,
      oppAlt: "Denver Nuggets logo",
      vs: "at",
      market: "Pts + Ast Over 38.5",
      bookPrice: "−108",
      projection: "41.2",
      fairPrice: "−129",
      edge: "+4.1%",
      confidence: "High",
      evidence: [
        "Cleared 38.5 in 7 of the last 9 meetings with Denver.",
        "Denver ranks 22nd defending pick-and-roll ball handlers.",
      ],
      risk: "Usage dips if the second unit extends a lead.",
    },
    {
      player: "Jalen Brunson",
      team: "NYK",
      teamLogo: LOGO.knicks,
      teamAlt: "New York Knicks logo",
      opp: "BOS",
      oppLogo: LOGO.celtics,
      oppAlt: "Boston Celtics logo",
      vs: "at",
      market: "Assists Over 6.5",
      bookPrice: "−105",
      projection: "7.3",
      fairPrice: "−118",
      edge: "+2.6%",
      confidence: "Medium",
      evidence: [
        "Assist rate up 14% with the starting center back.",
        "Boston funnels drives into kick-out passes.",
      ],
      risk: "Lower sample against Boston's new switching scheme.",
    },
  ];
}

export const FEED_GAMES: FeedGame[] = [
  {
    id: "g1",
    league: "soccer",
    comp: "FIFA World Cup · Semifinal · 3:00 PM ET",
    sims: "400K simulations",
    away: { name: "Argentina", logo: LOGO.argentina, alt: "Argentina flag", pct: 46, lead: true },
    home: { name: "France", logo: LOGO.france, alt: "France flag", pct: 27, lead: false },
    markets: [
      { label: "Argentina ML", book: "+136", fair: "+117", edge: "+3.6%" },
      { label: "Over 2.5", book: "−110", fair: "−102", edge: "−1.7%" },
    ],
  },
  {
    id: "g2",
    league: "mlb",
    comp: "MLB · Tonight 7:10 PM ET",
    sims: "400K simulations",
    away: { name: "Red Sox", logo: LOGO.redsox, alt: "Boston Red Sox logo", pct: 46, lead: false },
    home: { name: "Yankees", logo: LOGO.yankees, alt: "New York Yankees logo", pct: 54, lead: true },
    markets: [
      { label: "Yankees ML", book: "−105", fair: "−124", edge: "+4.3%" },
      { label: "Over 8.5", book: "−110", fair: "−126", edge: "+3.8%" },
      { label: "Yankees −1.5", book: "+142", fair: "+128", edge: "+2.6%" },
    ],
  },
  {
    id: "g3",
    league: "mlb",
    comp: "MLB · Tonight 8:40 PM ET",
    sims: "400K simulations",
    away: { name: "Rockies", logo: LOGO.rockies, alt: "Colorado Rockies logo", pct: 39, lead: false },
    home: { name: "Dodgers", logo: LOGO.dodgers, alt: "Los Angeles Dodgers logo", pct: 61, lead: true },
    markets: [
      { label: "Dodgers −1.5", book: "+142", fair: "+118", edge: "+5.1%" },
      { label: "Dodgers ML", book: "−162", fair: "−178", edge: "+1.9%" },
      { label: "Under 11.5", book: "−108", fair: "−119", edge: "+2.4%" },
    ],
  },
  {
    id: "g4",
    league: "nba",
    comp: "NBA · Tonight 7:30 PM ET",
    sims: "400K simulations",
    away: { name: "Knicks", logo: LOGO.knicks, alt: "New York Knicks logo", pct: 42, lead: false },
    home: { name: "Celtics", logo: LOGO.celtics, alt: "Boston Celtics logo", pct: 58, lead: true },
    markets: [
      { label: "Knicks +6.5", book: "−110", fair: "−128", edge: "+3.9%" },
      { label: "Under 221.5", book: "−108", fair: "−115", edge: "+1.6%" },
      { label: "Knicks ML", book: "+205", fair: "+232", edge: "−2.1%" },
    ],
  },
];

export const SPLITS_DATA: SplitsData = {
  status: "Final",
  away: { city: "Pittsburgh", name: "Pirates", logo: LOGO.pirates, alt: "Pittsburgh Pirates logo", score: 5 },
  home: { city: "Atlanta", name: "Braves", logo: LOGO.braves, alt: "Atlanta Braves logo", score: 10 },
  markets: [
    {
      title: "Run Line",
      sideLabels: { a: "Braves −1.5", b: "Pirates +1.5" },
      book: { a: "+139", b: "−168" },
      model: { a: "+189", b: "−189" },
      modelHighlight: "B",
      tickets: { a: 66, b: 34 },
      money: { a: 97, b: 3 },
    },
    {
      title: "Total",
      sideLabels: { a: "Over 9.5", b: "Under 9.5" },
      book: { a: "−112", b: "−108" },
      model: { a: "−105", b: "+105" },
      modelHighlight: null,
      tickets: { a: 68, b: 32 },
      money: { a: 45, b: 55 },
    },
    {
      title: "Moneyline",
      sideLabels: { a: "Braves", b: "Pirates" },
      book: { a: "−110", b: "−110" },
      model: { a: "+135", b: "−135" },
      modelHighlight: "B",
      tickets: { a: 69, b: 31 },
      money: { a: 44, b: 56 },
    },
  ],
  edges: [
    { teamLogo: LOGO.pirates, teamAlt: "Pittsburgh Pirates logo", label: "Pirates +1.5", marketName: "Run Line", roi: "+9.05% ROI" },
    { teamLogo: LOGO.pirates, teamAlt: "Pittsburgh Pirates logo", label: "Pirates ML", marketName: "Moneyline", roi: "+14.89% ROI" },
  ],
};

export const CONVERSATIONS: Conversation[] = [
  { id: "new", title: "World Cup simulations", sub: "Active now", group: "Today", current: true },
  { id: "c2", title: "Tonight's prop edges", sub: "6:15 PM · 1 analysis", group: "Today", current: false },
  { id: "c3", title: "Yankees at Red Sox analysis", sub: "Yesterday · 2 analyses", group: "Yesterday", current: false },
  { id: "c4", title: "Saved line movement review", sub: "Yesterday · 1 analysis", group: "Yesterday", current: false },
];

export const CREDIT_ACTIVITY: CreditActivityEntry[] = [
  { label: "World Cup semifinal simulation", time: "Today, 6:02 PM", amount: "−40", positive: false },
  { label: "Prop edge scan · NBA", time: "Today, 6:15 PM", amount: "−40", positive: false },
  { label: "Monthly plan refill", time: "Jul 4", amount: "+2,500", positive: true },
];

export const MEMBERSHIP = {
  planName: "Dime Pro",
  price: "$29 / month",
  renewDate: "Aug 4, 2026",
  features: [
    "2,500 monthly analysis credits",
    "Full simulation engine — all leagues",
    "Prop edge scanner and line alerts",
    "Discord community access",
  ],
};

/** Per-conversation canned exchange, keyed to match CONVERSATIONS ids. */
export function cannedConversation(id: string): { userText: string; ai: ReturnType<typeof aiResponseFor> } | null {
  switch (id) {
    case "new":
      return { userText: "Will Argentina win the World Cup semifinal?", ai: aiResponseFor("worldcup") };
    case "c2":
      return { userText: "What are tonight's best prop edges?", ai: aiResponseFor("props") };
    case "c3":
      return { userText: "Yankees at Red Sox — where's the edge?", ai: aiResponseFor("mlb") };
    case "c4":
      return { userText: "Show me the line movement on the Dodgers game.", ai: aiResponseFor("dodgers") };
    default:
      return null;
  }
}

export interface CannedResponse {
  text: string;
  match?: MatchAnalysis;
  props?: PropProjection[];
  propsMeta?: string;
  followups?: string[];
}

type ResponseKey = "worldcup" | "props" | "mlb" | "dodgers" | "knicks" | "generic";

function aiResponseFor(key: ResponseKey): CannedResponse {
  switch (key) {
    case "worldcup":
      return {
        text: "Ran 400,000 simulations on today's semifinal. Argentina projects as a modest favorite at 46%, and the current moneyline is priced below the model's fair number — a small but real edge, not a lock.",
        match: worldCupMatch(),
        followups: ["Compare total markets", "Show line movement", "Simulate a France win"],
      };
    case "props":
      return {
        text: "Here are tonight's highest-confidence prop edges across the slate, ranked by estimated edge.",
        props: propProjections(),
        propsMeta: PROPS_META,
        followups: ["Filter to high confidence only", "Show more props"],
      };
    case "mlb":
      return {
        text: "The model leans to the total rather than a side. Both simulated win probabilities sit close to the market, but the projected run environment is nearly a run above the posted total.",
        match: yankeesRedSoxMatch(),
        followups: ["First-5-innings total", "Starter strikeout props"],
      };
    case "dodgers":
      return {
        text: "The model makes Dodgers −1.5 the cleanest lean on this slate. The projected margin is nearly two runs, and the current price sits well above Dime's fair number.",
        match: dodgersRockiesMatch(),
        followups: ["Compare run line and moneyline", "Starter strikeout props"],
      };
    case "knicks":
      return {
        text: "The model leans Knicks +6.5. Simulations keep this within five points far more often than the posted spread implies.",
        match: celticsKnicksMatch(),
        followups: ["First-half spread", "Brunson prop edges"],
      };
    case "generic":
    default:
      return {
        text: "Here's how I'd approach that — I can run a full simulation on a specific matchup or scan today's board for the props with the most edge. Which would help more?",
        followups: ["Run a matchup simulation", "Scan today's prop edges"],
      };
  }
}

/** Naive keyword router mirroring the design's pickResponse() behavior. */
export function pickResponse(query: string): CannedResponse {
  const q = query.toLowerCase();
  if (q.includes("world cup") || q.includes("simulation") || q.includes("argentina")) {
    return aiResponseFor("worldcup");
  }
  if (q.includes("prop") || q.includes("edge")) {
    return aiResponseFor("props");
  }
  if (q.includes("yankee") || q.includes("red sox")) {
    return aiResponseFor("mlb");
  }
  return aiResponseFor("generic");
}

/** Hand-authored detail response per Feed game id, used by "Open model analysis". */
export function matchDetailFor(gameId: string): CannedResponse {
  switch (gameId) {
    case "g1":
      return aiResponseFor("worldcup");
    case "g2":
      return aiResponseFor("mlb");
    case "g3":
      return aiResponseFor("dodgers");
    case "g4":
    default:
      return aiResponseFor("knicks");
  }
}
