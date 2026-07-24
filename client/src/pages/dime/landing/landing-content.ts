/**
 * Dime AI landing v2 — content module.
 *
 * ALL copy, demo data, pricing, FAQ and CTA metadata for the v2 landing page.
 * Layout components read from here; nothing marketing-facing is hardcoded in JSX.
 *
 * HONESTY LAW (design-system/dime-ai/MASTER.md + repo compliance rules):
 *  - No fabricated win rates, records, testimonials or user counts.
 *  - No profit guarantees. PASS is a first-class output.
 *  - Demo/console data uses abstract team names (Team A/C/E) and is labeled DEMO.
 *  - Whitelisted product claims only: 400,000 sims/game, 55+ outputs,
 *    124 enforcement tests, Brier-scored vs close, odds frozen at first pitch,
 *    MLB + World Cup 2026, Pro $99/mo, Sharp $249/mo, Operator $499/mo,
 *    ≈$3.30 / ≈$8.30 / ≈$16.63 per day (legacy checkout only: $99.99/mo, $499.99/yr).
 */

/** Switches CTA labels + destinations between waitlist capture and live checkout. */
export const LANDING_MODE: "waitlist" | "paid" = "paid";

// ─── Hero ─────────────────────────────────────────────────────────────────────

export const HERO = {
  eyebrow: "Sports betting intelligence software",
  headline: { before: "See where price and probability ", em: "disagree", after: "." },
  sub:
    "Dime AI compares sportsbook prices against projected probability, movement, volatility, matchup context, and risk flags so every market resolves to Pass, Monitor, or Edge Detected.",
  primaryCta: "Get access",
  secondaryCta: "Preview Dime Chat",
  trustMicrocopy: "Analytical software for disciplined market evaluation. No guaranteed outcomes.",
} as const;

// ─── Dime Market Console (demo data — abstract teams, labeled DEMO) ──────────

export type MarketState = "edge" | "monitor" | "pass";

export interface ConsoleMarket {
  id: string;
  tab: string;
  market: string;
  sport: string;
  bookPrice: string;
  impliedProb: number; // percent
  dimeProjection: number; // percent
  edge: string;
  fairPrice: string;
  state: MarketState;
  stateLabel: string;
  confidence: string;
  risk: string;
  movement: { open: string; current: string; note: string };
  signal: string;
  status: string;
  creditCost: number;
}

export const CONSOLE_MARKETS: ConsoleMarket[] = [
  {
    id: "edge",
    tab: "Team A ML",
    market: "Team A Moneyline",
    sport: "MLB",
    bookPrice: "−115",
    impliedProb: 53.5,
    dimeProjection: 58.9,
    edge: "+5.4%",
    fairPrice: "−143",
    state: "edge",
    stateLabel: "Edge Detected",
    confidence: "74 / 100",
    risk: "Medium volatility",
    movement: { open: "−108", current: "−115", note: "open → current" },
    signal: "Model price ahead of current market",
    status: "Monitor movement before close",
    creditCost: 1,
  },
  {
    id: "monitor",
    tab: "Team C −4.5",
    market: "Team C −4.5 Spread",
    sport: "NBA",
    bookPrice: "−110",
    impliedProb: 52.4,
    dimeProjection: 55.8,
    edge: "+3.4%",
    fairPrice: "−126",
    state: "monitor",
    stateLabel: "Monitor",
    confidence: "61 / 100",
    risk: "Medium volatility",
    movement: { open: "−105", current: "−110", note: "open → current" },
    signal: "Edge present but shrinking with movement",
    status: "Only playable if the price holds or improves",
    creditCost: 1,
  },
  {
    id: "pass",
    tab: "Team E O8.5",
    market: "Team E Over 8.5 Total",
    sport: "MLB",
    bookPrice: "−105",
    impliedProb: 51.2,
    dimeProjection: 49.6,
    edge: "−1.6%",
    fairPrice: "+102",
    state: "pass",
    stateLabel: "Pass",
    confidence: "82 / 100",
    risk: "Low volatility",
    movement: { open: "−107", current: "−105", note: "open → current" },
    signal: "Market efficiently priced, no edge to evaluate",
    status: "No action. Keep your bankroll.",
    creditCost: 1,
  },
];

export const CONSOLE_SCAN_STEPS = [
  "Ingesting book prices",
  "Running 400,000 simulations",
  "Comparing implied vs projected",
  "Flagging movement & volatility",
  "Classifying market",
] as const;

// ─── Dime Chat demo (scripted, labeled DEMO) ─────────────────────────────────

export interface ChatExchange {
  id: string;
  chip: string;
  user: string;
  dime: string;
  card?: {
    classification: string;
    state: MarketState;
    rows: Array<[string, string]>;
    nextAction: string;
  };
}

export const CHAT_EXCHANGES: ChatExchange[] = [
  {
    id: "teamc",
    chip: "Is Team C −4.5 playable?",
    user: "Is there anything on Team C −4.5 tonight?",
    dime:
      "Monitor. Dime projects Team C −4.5 at 55.8% against a 52.4% implied price, but recent movement and medium volatility reduce confidence. Evaluate the number if the price holds or improves; once it moves past fair value, Pass.",
    card: {
      classification: "Monitor",
      state: "monitor",
      rows: [
        ["Book Price", "−110"],
        ["Implied Probability", "52.4%"],
        ["Dime Projection", "55.8%"],
        ["Edge", "+3.4%"],
        ["Risk", "Medium volatility"],
        ["Credit Cost", "1 Dime Credit"],
      ],
      nextAction: "Monitor price movement",
    },
  },
  {
    id: "disagreement",
    chip: "Show me markets with price disagreement.",
    user: "Show me markets with price disagreement.",
    dime:
      "Two markets diverge from model price right now. Team A Moneyline sits at 58.9% projected against 53.5% implied, an Edge Detected read. Team C −4.5 shows 55.8% against 52.4%, a Monitor, with movement eating the number. The rest of the scanned slate prices within noise.",
    card: {
      classification: "Edge Detected",
      state: "edge",
      rows: [
        ["Top divergence", "Team A ML"],
        ["Implied Probability", "53.5%"],
        ["Dime Projection", "58.9%"],
        ["Edge", "+5.4%"],
        ["Fair Price", "−143"],
        ["Credit Cost", "1 Dime Credit"],
      ],
      nextAction: "Review Team A ML card",
    },
  },
  {
    id: "whypass",
    chip: "Why is this a Pass?",
    user: "Why is Team E Over 8.5 a Pass?",
    dime:
      "Because the market has it right. Dime projects the over at 49.6% against a 51.2% implied price, so the book's number beats the model's by 1.6 points. A gap that size sits inside the noise band and reads as no lean in either direction, under included. Pass means the math found nothing worth paying a price for.",
    card: {
      classification: "Pass",
      state: "pass",
      rows: [
        ["Book Price", "−105"],
        ["Implied Probability", "51.2%"],
        ["Dime Projection", "49.6%"],
        ["Edge", "−1.6%"],
        ["Risk", "Low volatility"],
        ["Credit Cost", "1 Dime Credit"],
      ],
      nextAction: "No action. Keep your bankroll.",
    },
  },
  {
    id: "totals",
    chip: "Scan today's MLB totals.",
    user: "Scan today's MLB totals.",
    dime:
      "Scan complete across the totals board. Most totals resolve to Pass, priced within the model's noise band. One Monitor: a divisional total is drifting toward fair value and turns interesting if it crosses. Zero Edge Detected classifications on totals right now, and I won't manufacture one.",
    card: {
      classification: "Scan Summary",
      state: "monitor",
      rows: [
        ["Markets scanned", "Full totals board"],
        ["Edge Detected", "0"],
        ["Monitor", "1"],
        ["Pass", "Rest of board"],
        ["Credit Cost", "1 Dime Credit"],
      ],
      nextAction: "Watch the Monitor total for movement",
    },
  },
  {
    id: "nohype",
    chip: "Explain the edge without hype.",
    user: "Explain the Team A edge without hype.",
    dime:
      "The book charges −115, which implies 53.5%. Four hundred thousand simulations of this matchup put Team A at 58.9%, which prices to −143. The 5.4-point gap is the edge, and it is an estimate. Confidence is 74/100 with medium volatility, so the classification is Edge Detected with a note to monitor the number before close.",
    card: {
      classification: "Edge Detected",
      state: "edge",
      rows: [
        ["Book Price", "−115"],
        ["Implied Probability", "53.5%"],
        ["Dime Projection", "58.9%"],
        ["Fair Price", "−143"],
        ["Confidence", "74 / 100"],
        ["Credit Cost", "1 Dime Credit"],
      ],
      nextAction: "Monitor movement before close",
    },
  },
];

export const CHAT_SIDE = {
  filters: ["MLB", "NBA", "Soccer", "Totals", "Props"],
  creditsLabel: "Demo credits",
  creditsTotal: 5,
} as const;

// ─── Problem section ──────────────────────────────────────────────────────────

export const PROBLEM = {
  eyebrow: "The problem",
  headline: { before: "Data everywhere. ", em: "No decision system", after: "." },
  sub:
    "Odds screens, injury feeds, weather apps, line-move alerts, three group chats and a gut feeling: you have more information than ever and no structured way to turn it into a decision.",
  items: [
    {
      title: "Fragmented inputs",
      copy: "Prices, lineups, movement and matchup context live in different tabs. Assemble them by hand and the number moves before you finish.",
    },
    {
      title: "No pricing reference",
      copy: "Without a fair price to compare against, any line can look plausible. You end up grading vibes.",
    },
    {
      title: "Manufactured action",
      copy: "Most of the industry gets paid when you bet more, and no part of the pick economy exists to tell you no.",
    },
  ],
} as const;

// ─── Mechanism section ────────────────────────────────────────────────────────

export const MECHANISM = {
  eyebrow: "The mechanism",
  headline: { before: "Four moves from line to ", em: "verdict", after: "." },
  sub: "One engine powers the whole site. It ingests odds live, simulates matchups in full, and grades every projection against the close. We call the output the Dime Verdict.",
  steps: [
    {
      num: "01",
      title: "Choose market",
      copy: "Pick the market in front of you: moneyline, run line, totals, first-five, or props.",
    },
    {
      num: "02",
      title: "Compare price",
      copy: "Dime converts the book's price into an implied probability and lines it up against the model's projection from 400,000 simulations of the matchup.",
    },
    {
      num: "03",
      title: "Evaluate edge",
      copy: "Dime states the gap between implied and projected in percent, with fair price, confidence, movement and volatility alongside.",
    },
    {
      num: "04",
      title: "Decide",
      copy: "The market resolves to one of three verdicts: Pass, Monitor, or Edge Detected. Books price most markets tight, so expect Pass more often than the other two.",
    },
  ],
} as const;

// ─── Today's Market Signals (demo rows, labeled DEMO) ────────────────────────

export interface SignalRow {
  id: string;
  market: string;
  sport: string;
  price: string;
  implied: string;
  projection: string;
  edge: string;
  state: MarketState | "locked";
  stateLabel: string;
  lockedTier?: "Sharp" | "Operator";
  filters: string[];
}

export const SIGNAL_ROWS: SignalRow[] = [
  { id: "s1", market: "Team A ML", sport: "MLB", price: "−115", implied: "53.5%", projection: "58.9%", edge: "+5.4%", state: "edge", stateLabel: "Edge Detected", filters: ["MLB"] },
  { id: "s2", market: "Team C −4.5", sport: "NBA", price: "−110", implied: "52.4%", projection: "55.8%", edge: "+3.4%", state: "monitor", stateLabel: "Monitor", filters: ["NBA", "Spreads"] },
  { id: "s3", market: "Team E Over 8.5", sport: "MLB", price: "−105", implied: "51.2%", projection: "49.6%", edge: "−1.6%", state: "pass", stateLabel: "Pass", filters: ["MLB", "Totals"] },
  { id: "s4", market: "Player Prop Volatility Scan", sport: "MLB", price: "···", implied: "···", projection: "···", edge: "···", state: "locked", stateLabel: "Locked", lockedTier: "Sharp", filters: ["Props", "MLB"] },
  { id: "s5", market: "Full Slate Simulation", sport: "All", price: "···", implied: "···", projection: "···", edge: "···", state: "locked", stateLabel: "Locked", lockedTier: "Operator", filters: [] },
];

export const SIGNAL_FILTERS = ["All", "MLB", "NBA", "Soccer", "Spreads", "Totals", "Props"] as const;

// ─── Feature grid ─────────────────────────────────────────────────────────────

export const FEATURES = {
  eyebrow: "What you get",
  headline: { before: "The engine, ", em: "itemized", after: "." },
  items: [
    { title: "400,000 simulations per game", copy: "A Monte Carlo engine plays each matchup inning by inning and produces 55+ outputs per game." },
    { title: "Full projections board", copy: "Moneyline, run line, totals, F5, NRFI, K props and HR props, each priced book vs model." },
    { title: "Dime Chat", copy: "Interrogate any number on the slate. Answers trace back to tables the model wrote, and 124 enforcement tests stand between the engine and a made-up number." },
    { title: "Graded against the close", copy: "Odds freeze at first pitch, and the engine Brier-scores every projection against the close after the final out." },
    { title: "Honest PASS verdicts", copy: "No edge means a grey card that costs you nothing. Most days the board shows more grey than mint." },
    { title: "Live 24/7 pipeline", copy: "The pipeline refreshes odds, lineups, park factors, umpires and weather around the clock. MLB today, World Cup 2026 next." },
  ],
} as const;

// ─── Trust architecture ───────────────────────────────────────────────────────

export const TRUST = {
  eyebrow: "Methodology",
  moduleHeadline: "A system that passes is more valuable than a system that screams.",
  moduleCopy:
    "The books price most markets efficiently. We built Dime to separate signal from noise.",
  principles: [
    "Dime evaluates market prices and claims nothing it can't grade: no guaranteed wins, no locks, no fake win rates.",
    "Pass is a valid output and the engine's most common verdict.",
    "Model probabilities are estimates. Betting involves risk; nothing here removes it.",
    "The engine Brier-scores every projection against the close, with odds frozen at first pitch.",
    "Analytical software only, not financial or gambling advice. Follow your local laws. 21+ where applicable, bet responsibly.",
  ],
} as const;

// ─── Pricing ──────────────────────────────────────────────────────────────────

export type CheckoutPlanId = "pro" | "sharp" | "operator" | "monthly" | "annual";

export interface Tier {
  id: string;
  name: string;
  audience: string;
  price: string;
  period: string;
  perDay?: string;
  featured?: boolean;
  badge?: string;
  features: string[];
  cta: { paid: string; waitlist: string };
  /** Real destination — never a placeholder. */
  action: { type: "checkout"; plan: CheckoutPlanId } | { type: "scroll"; target: string } | { type: "apply" };
}

export const TIERS: Tier[] = [
  {
    id: "free",
    name: "Free Preview",
    audience: "For validating the workflow",
    price: "$0",
    period: "",
    features: [
      "Live Dime Market Console demo",
      "Dime Chat preview with sample markets",
      "Sample market signal cards",
      "See Pass, Monitor and Edge Detected in action",
    ],
    cta: { paid: "Preview the demos", waitlist: "Preview the demos" },
    action: { type: "scroll", target: "console" },
  },
  {
    id: "pro",
    name: "Pro",
    audience: "For serious daily bettors",
    price: "$99",
    period: "/month",
    perDay: "≈ $3.30 / day · cancel anytime",
    featured: true,
    badge: "Most popular",
    features: [
      "Full AI Model Projections board, every game priced",
      "Dime Chat with Standard + Pro Analyst (Sonnet + Opus)",
      "1,000 AI Analyst credits / month",
      "Live edge grades, honest PASS signals",
    ],
    cta: { paid: "Start Pro", waitlist: "Request Pro Access" },
    action: { type: "checkout", plan: "pro" },
  },
  {
    id: "sharp",
    name: "Sharp",
    audience: "For bettors working the full slate",
    price: "$249",
    period: "/month",
    perDay: "≈ $8.30 / day · cancel anytime",
    features: [
      "Everything in Pro",
      "MAX Analyst access (monthly cap)",
      "3,000 AI Analyst credits / month",
      "Priority access to new model markets",
    ],
    cta: { paid: "Start Sharp", waitlist: "Request Sharp Access" },
    action: { type: "checkout", plan: "sharp" },
  },
  {
    id: "operator",
    name: "Operator",
    audience: "For operators running this professionally",
    price: "$499",
    period: "/month",
    perDay: "≈ $16.63 / day · cancel anytime",
    features: [
      "Everything in Sharp",
      "Full MAX Analyst access (no cap)",
      "8,000 AI Analyst credits / month",
      "Early access to new markets and model releases",
    ],
    cta: { paid: "Start Operator", waitlist: "Request Operator Access" },
    action: { type: "checkout", plan: "operator" },
  },
];

export const CREDITS_NOTE = {
  title: "AI Analyst credits",
  copy:
    "Each paid tier includes a monthly allowance of AI Analyst credits: 1,000 on Pro, 3,000 on Sharp, 8,000 on Operator. Credits cover scans, chat queries and simulation runs, and add-on packs ship once the credit ledger does.",
} as const;

export const PRICING_HEAD = {
  eyebrow: "Pricing",
  headline: { before: "One engine. ", em: "Priced like software", after: "." },
  sub: "Three levels of the same engine, with more analyst depth and more credits at each step. The upgrade buys capacity rather than a \"VIP room\" of picks. Cancel anytime and keep access through the period you paid for.",
  legal: "Secure checkout · Auto-renews · Cancel anytime · 21+",
  proof:
    "The engine grades every number you pay for against the close after the final out, and when the edge is missing it says PASS instead of selling you a pick. A month costs less than one losing $110 bet; one honest Pass that keeps you off a bad number covers it.",
} as const;

// ─── Controlled access ────────────────────────────────────────────────────────

export const CONTROLLED_ACCESS = {
  eyebrow: "Controlled access",
  headline: { before: "Founder seats go through ", em: "review", after: ", one application at a time." },
  copy:
    "Dime is a small, serious tool built by one operator. Founder access runs on applications so the earliest cohort shapes the product, and the queue is short because one person reads it.",
  formTitle: "Apply for Founder access",
  fields: { name: "Full name", email: "Email" },
  submit: "Submit application",
  success: "Application received. You'll hear back at this email.",
} as const;

// ─── Objection handling (adapted from the shipped Straight Answers layer) ────

export const OBJECTIONS = {
  eyebrow: "Straight answers",
  headline: { before: "The questions you ", em: "should", after: " be asking." },
  sub: "You're about to pay for numbers that touch your bankroll. These are the questions we'd ask before subscribing, answered without the sales voice.",
  items: [
    {
      q: "Isn't this just another pick service?",
      a: "No. Dime is a pricing engine, 400,000 simulations per game and 55+ outputs, and when the math comes up short the answer is PASS.",
      stamp: "No",
    },
    {
      q: "Where's the track record?",
      a: "The engine freezes odds the moment a game goes live, then Brier-scores every projection against the close after the final out. That grading is the record, built into the engine. An honest model can't promise you profit, so we skip the cherry-picked win streaks.",
      stamp: "Graded",
    },
    {
      q: "Why $99 a month?",
      a: "That's ≈ $3.30 a day for every market the model prices: full board, full chat, all 55+ outputs per game. Sharp and Operator add analyst depth and credits on top of the same engine.",
      stamp: "≈ $3.30/day",
    },
    {
      q: "What if I want out?",
      a: "Cancel anytime. The subscription runs month to month through Stripe's secure checkout, cancellation is self-serve and free, and access continues through the period you've already paid for.",
      stamp: "Anytime",
    },
    {
      q: "How do I know the numbers are real?",
      a: "Dime Chat answers from the model's own tables, 124 enforcement tests keep invented numbers out of the replies, and frozen odds rule out retroactive grading. Dime offers statistical analysis and leaves the betting decisions to you: 21+, bet responsibly, and no one here will guarantee you a profit.",
      stamp: "124 tests",
    },
  ],
} as const;

// ─── FAQ ──────────────────────────────────────────────────────────────────────

export const FAQ = {
  eyebrow: "FAQ",
  headline: { before: "Practical ", em: "questions", after: "." },
  items: [
    {
      q: "Which sports are covered?",
      a: "MLB is live today with moneyline, run line, totals, F5, NRFI, K props and HR props. World Cup 2026 markets are in the engine. New sports ship to Sharp, Operator and Founder tiers first.",
    },
    {
      q: "Is this betting advice?",
      a: "No. Dime is analytical software that prices markets and classifies them as Pass, Monitor or Edge Detected. Acting on a classification is your decision, made in your jurisdiction and within your limits.",
    },
    {
      q: "How fresh are the numbers?",
      a: "The pipeline ingests odds, lineups, park factors, umpires and weather around the clock. Odds freeze the moment a game goes live, so the price you saw is the price that gets graded.",
    },
    {
      q: "What are Dime Credits?",
      a: "The usage unit behind scans, chat queries and simulations. Paid plans include the full board and chat today; metered credit add-ons for heavy research use ship after launch.",
    },
    {
      q: "How do I cancel?",
      a: "Two clicks in the Stripe billing portal end the subscription. Access continues through the period you've paid for.",
    },
    {
      q: "Do you guarantee profits?",
      a: "No, and you should close any tab that does. Model probabilities are estimates; betting involves risk. Dime's job is to sharpen your evaluation of a price.",
    },
  ],
} as const;

// ─── Final CTA ────────────────────────────────────────────────────────────────

export const FINAL_CTA = {
  mono: "Pass · Monitor · Edge Detected · the Dime Verdict",
  headline: "Bet with the math.",
  copy: "Price every line against 400,000 simulations before you move a dollar of your bankroll.",
  cta: "Get access",
} as const;

// ─── Footer ───────────────────────────────────────────────────────────────────

export const FOOTER_LEGAL =
  "© 2026 AI Sports Betting. dime provides statistical model projections for informational and entertainment purposes only. Nothing here is financial advice, and no model guarantees a profit. Must be 21+ (or of legal betting age in your jurisdiction) to wager. Please bet responsibly. If you or someone you know has a gambling problem, call 1-800-GAMBLER.";

// ─── Stats band ───────────────────────────────────────────────────────────────

export const STATS = [
  { value: "400,000", label: "Simulations per game" },
  { value: "55+", label: "Model outputs per matchup" },
  { value: "7", label: "Markets priced, book vs model" },
  { value: "24/7", label: "Odds, lineups & weather pipeline" },
] as const;
