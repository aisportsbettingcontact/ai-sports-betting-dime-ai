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
 *  - Whitelisted product claims only: 10,000 sims/game, 55+ outputs,
 *    124 enforcement tests, Brier-scored vs close, odds frozen at first pitch,
 *    MLB + World Cup 2026, $99.99/mo, $499.99/yr, ≈$3.30 & ≈$1.37/day, Save 58%.
 */

/** Switches CTA labels + destinations between waitlist capture and live checkout. */
export const LANDING_MODE: "waitlist" | "paid" = "paid";

// ─── Hero ─────────────────────────────────────────────────────────────────────

export const HERO = {
  eyebrow: "Sports betting intelligence software",
  headline: { before: "See where price and probability ", em: "disagree", after: "." },
  sub:
    "Dime AI compares sportsbook prices against projected probability, movement, volatility, matchup context, and risk flags so every market resolves to Pass, Monitor, or Edge Detected.",
  primaryCta: "Get Access",
  secondaryCta: "Preview Dime Chat",
  trustMicrocopy: "Analytical software. No guaranteed outcomes. Built for disciplined market evaluation.",
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
    signal: "Market efficiently priced — no edge to evaluate",
    status: "No action. Keep your bankroll.",
    creditCost: 1,
  },
];

export const CONSOLE_SCAN_STEPS = [
  "Ingesting book prices",
  "Running 10,000 simulations",
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
      "Monitor, not automatic. Dime projects Team C −4.5 at 55.8% against a 52.4% implied price, but recent movement and medium volatility reduce confidence. The number is only worth evaluating if the price holds or improves. If it moves past fair value, Pass.",
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
      "Two markets diverge from model price right now. Team A Moneyline: 58.9% projected vs 53.5% implied — Edge Detected. Team C −4.5: 55.8% vs 52.4% — Monitor, movement is eating the number. Everything else on the scanned slate prices within noise. That's the honest read.",
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
      "Because the market has it right. Dime projects the over at 49.6% against a 51.2% implied price — the book's number is slightly better than the model's. A negative edge isn't a lean to the under either; it's inside the noise band. Pass means the math found nothing worth paying a price for.",
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
      nextAction: "No action — keep your bankroll",
    },
  },
  {
    id: "totals",
    chip: "Scan today's MLB totals.",
    user: "Scan today's MLB totals.",
    dime:
      "Scan complete across the totals board. Most totals resolve to Pass — priced within the model's noise band. One Monitor: movement on a divisional total is drifting toward fair value; it becomes interesting only if it crosses. No Edge Detected classifications on totals right now, and I won't manufacture one.",
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
      "The book charges −115, which implies 53.5%. Ten thousand simulations of this matchup put Team A at 58.9%, which prices to −143. The 5.4-point gap is the edge — an estimate, not a promise. Confidence is 74/100 with medium volatility, so the classification is Edge Detected with a note to monitor the number before close.",
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
    "Odds screens, injury feeds, weather apps, line-move alerts, three group chats and a gut feeling — every bettor has more information than ever and no structured way to turn it into a decision.",
  items: [
    {
      title: "Fragmented inputs",
      copy: "Prices, lineups, movement and matchup context live in different tabs. By the time you've assembled them, the number moved.",
    },
    {
      title: "No pricing reference",
      copy: "Without a fair price to compare against, every line looks plausible. You're evaluating vibes, not value.",
    },
    {
      title: "Manufactured action",
      copy: "Most of the industry is paid to make you bet more. Nothing in the pick economy is built to tell you no.",
    },
  ],
} as const;

// ─── Mechanism section ────────────────────────────────────────────────────────

export const MECHANISM = {
  eyebrow: "The mechanism",
  headline: { before: "Four moves from line to ", em: "verdict", after: "." },
  sub: "The same engine behind every number on the site — ingested live, simulated in full, and graded against the close.",
  steps: [
    {
      num: "01",
      title: "Choose market",
      copy: "Moneyline, run line, totals, first-five, props — pick the market you're actually considering.",
      tele: "INPUT // MARKET",
    },
    {
      num: "02",
      title: "Compare price",
      copy: "The book's price becomes an implied probability and meets the model's projection from 10,000 simulations of the matchup.",
      tele: "SIM // 10,000_PER_GAME",
    },
    {
      num: "03",
      title: "Evaluate edge",
      copy: "The gap between implied and projected is stated in percent, with fair price, confidence, movement and volatility alongside.",
      tele: "EDGE // MODEL − IMPLIED",
    },
    {
      num: "04",
      title: "Decide",
      copy: "Every market resolves to Pass, Monitor, or Edge Detected. Most markets are priced efficiently — most verdicts are Pass.",
      tele: "OUTPUT // PASS · MONITOR · EDGE",
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
  lockedTier?: "Elite" | "Max";
  filters: string[];
}

export const SIGNAL_ROWS: SignalRow[] = [
  { id: "s1", market: "Team A ML", sport: "MLB", price: "−115", implied: "53.5%", projection: "58.9%", edge: "+5.4%", state: "edge", stateLabel: "Edge Detected", filters: ["MLB"] },
  { id: "s2", market: "Team C −4.5", sport: "NBA", price: "−110", implied: "52.4%", projection: "55.8%", edge: "+3.4%", state: "monitor", stateLabel: "Monitor", filters: ["NBA", "Spreads"] },
  { id: "s3", market: "Team E Over 8.5", sport: "MLB", price: "−105", implied: "51.2%", projection: "49.6%", edge: "−1.6%", state: "pass", stateLabel: "Pass", filters: ["MLB", "Totals"] },
  { id: "s4", market: "Player Prop Volatility Scan", sport: "MLB", price: "···", implied: "···", projection: "···", edge: "···", state: "locked", stateLabel: "Locked", lockedTier: "Elite", filters: ["Props", "MLB"] },
  { id: "s5", market: "Full Slate Simulation", sport: "All", price: "···", implied: "···", projection: "···", edge: "···", state: "locked", stateLabel: "Locked", lockedTier: "Max", filters: [] },
];

export const SIGNAL_FILTERS = ["All", "MLB", "NBA", "Soccer", "Spreads", "Totals", "Props"] as const;

// ─── Feature grid ─────────────────────────────────────────────────────────────

export const FEATURES = {
  eyebrow: "What you get",
  headline: { before: "An engine, not ", em: "a feed of opinions", after: "." },
  items: [
    { title: "10,000 simulations per game", copy: "A Monte Carlo engine plays every matchup inning by inning — 55+ outputs per game.", tele: "SIM.ENGINE" },
    { title: "Full projections board", copy: "Moneyline, run line, totals, F5, NRFI, K props and HR props — every market priced book vs model.", tele: "BOARD" },
    { title: "Dime Chat", copy: "Interrogate any number on the slate. Answers trace back to tables the model wrote — 124 enforcement tests stand between the engine and a made-up number.", tele: "CHAT // GROUNDED" },
    { title: "Graded against the close", copy: "Odds freeze at first pitch. Every projection is Brier-scored after the final out. The grading is the record.", tele: "SCORING // BRIER" },
    { title: "Honest PASS verdicts", copy: "No edge means grey, not a sales pitch. The most common verdict is the one that costs you nothing.", tele: "VERDICT // PASS" },
    { title: "Live 24/7 pipeline", copy: "Odds, lineups, park factors, umpires and weather refresh around the clock. MLB today, World Cup 2026 next.", tele: "PIPELINE // 24/7" },
  ],
} as const;

// ─── Trust architecture ───────────────────────────────────────────────────────

export const TRUST = {
  eyebrow: "Methodology",
  moduleHeadline: "A system that passes is more valuable than a system that screams.",
  moduleCopy:
    "Most markets are priced efficiently. Dime is built to separate signal from noise, not manufacture action.",
  principles: [
    "Dime evaluates markets, not outcomes. No guaranteed wins, no locks, no fake win rates.",
    "Pass is a valid output — the engine's most common verdict is no action.",
    "Model probabilities are estimates. Betting involves risk; nothing here removes it.",
    "Every projection is graded against the close, Brier-scored, with odds frozen at first pitch.",
    "Analytical software only — not financial or gambling advice. Follow your local laws. 21+ where applicable, bet responsibly.",
  ],
} as const;

// ─── Pricing ──────────────────────────────────────────────────────────────────

export type CheckoutPlanId = "monthly" | "annual";

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
    price: "$99.99",
    period: "/month",
    perDay: "≈ $3.30 / day · cancel anytime",
    featured: true,
    badge: "Most popular",
    features: [
      "Full AI Model Projections board — every game, priced",
      "Dime Chat — ask the engine anything on the slate",
      "F5, NRFI, K props & HR props markets",
      "Live edge grades, honest PASS signals",
    ],
    cta: { paid: "Start Pro", waitlist: "Request Pro Access" },
    action: { type: "checkout", plan: "monthly" },
  },
  {
    id: "elite",
    name: "Elite",
    audience: "For sharper users",
    price: "$499.99",
    period: "/year",
    perDay: "≈ $1.37 / day · save 58% vs monthly",
    badge: "Best value",
    features: [
      "Everything in Pro",
      "Save 58% vs paying monthly",
      "Locked-in price through the World Cup and full MLB season",
      "Priority access to new model markets",
    ],
    cta: { paid: "Upgrade to Elite", waitlist: "Request Elite Access" },
    action: { type: "checkout", plan: "annual" },
  },
  {
    id: "founder",
    name: "Founder",
    audience: "For power users — application based",
    price: "By application",
    period: "",
    features: [
      "Early access to new markets and model releases",
      "Priority feature input, direct line to the builder",
      "First in line for usage-credit add-ons when metering ships",
      "Limited seats — reviewed personally",
    ],
    cta: { paid: "Apply for Founder Access", waitlist: "Apply for Founder Access" },
    action: { type: "apply" },
  },
];

export const CREDITS_NOTE = {
  title: "Dime Credits",
  copy:
    "Scans, chat queries and simulations in the demos are metered in Dime Credits — the usage unit the product is built around. Metered credit add-ons (extra chat queries, custom breakdowns, full-slate research runs) ship after launch; today every paid plan includes the full board and chat.",
} as const;

export const PRICING_HEAD = {
  eyebrow: "Pricing",
  headline: { before: "One engine. ", em: "Priced like software", after: "." },
  sub: "No tiers of picks, no upsells to a 'VIP room'. Software access, billed like software — cancel anytime and keep access through the period you paid for.",
  legal: "Secure checkout · Auto-renews · Cancel anytime · 21+",
  proof:
    "Every number you're paying for is graded against the close after the final out — and when there's no edge, the model says PASS instead of selling you a pick.",
} as const;

// ─── Controlled access ────────────────────────────────────────────────────────

export const CONTROLLED_ACCESS = {
  eyebrow: "Controlled access",
  headline: { before: "Founder seats are ", em: "reviewed, not sold", after: "." },
  copy:
    "Dime is a small, serious tool built by one operator. Founder access is application-based so the earliest cohort shapes the product — no artificial countdown, no fake scarcity, just a genuinely limited review queue.",
  formTitle: "Apply for Founder Access",
  fields: { name: "Full name", email: "Email" },
  submit: "Submit application",
  success: "Application received. You'll hear back at this email.",
} as const;

// ─── Objection handling (adapted from the shipped Straight Answers layer) ────

export const OBJECTIONS = {
  eyebrow: "Straight answers",
  headline: { before: "The questions you ", em: "should", after: " be asking." },
  sub: "You're about to pay for numbers that touch your bankroll. Here's what we'd want to know before subscribing — answered without the sales voice.",
  items: [
    {
      q: "Isn't this just another pick service?",
      a: "No — dime doesn't sell picks. It's a pricing engine — 10,000 simulations per game, 55+ outputs — and when the math isn't there, the answer is PASS.",
      stamp: "No",
    },
    {
      q: "Where's the track record?",
      a: "We don't post cherry-picked win streaks — no honest model can promise you profit. Instead, every projection is graded against the close after the final out, Brier-scored, with odds frozen the moment a game goes live. The grading is the record, and it's built into the engine.",
      stamp: "Graded",
    },
    {
      q: "Why $99.99 a month?",
      a: "That's ≈ $3.30 a day for every market the model prices — full board, full chat, all 55+ outputs per game. Elite drops it to ≈ $1.37 a day.",
      stamp: "≈ $3.30/day",
    },
    {
      q: "What if I want out?",
      a: "Cancel anytime — no contracts, no cancellation calls, no fees to leave. Billing runs through Stripe's secure checkout, and your access runs through the period you've already paid for.",
      stamp: "Anytime",
    },
    {
      q: "How do I know the numbers are real?",
      a: "Dime Chat can only speak from the model's own tables — 124 enforcement tests stand between the engine and a made-up number, and frozen odds mean nothing is graded retroactively. This is statistical analysis, not gambling advice: 21+, bet responsibly, and no one here will ever guarantee you a profit.",
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
      a: "MLB is live today with moneyline, run line, totals, F5, NRFI, K props and HR props. World Cup 2026 markets are in the engine. New sports ship to Elite and Founder tiers first.",
    },
    {
      q: "Is this betting advice?",
      a: "No. Dime is analytical software that prices markets and classifies them as Pass, Monitor or Edge Detected. What you do with a classification is your decision, in your jurisdiction, within your limits.",
    },
    {
      q: "How fresh are the numbers?",
      a: "The pipeline ingests odds, lineups, park factors, umpires and weather around the clock. Odds freeze the moment a game goes live — what you saw priced is what gets graded.",
    },
    {
      q: "What are Dime Credits?",
      a: "The usage unit behind scans, chat queries and simulations. Paid plans include the full board and chat today; metered credit add-ons for heavy research use ship after launch.",
    },
    {
      q: "How do I cancel?",
      a: "In two clicks through the Stripe billing portal — no calls, no retention flow. Access continues through the period you've paid for.",
    },
    {
      q: "Do you guarantee profits?",
      a: "No, and you should close any tab that does. Model probabilities are estimates; betting involves risk. Dime's job is to make your evaluation sharper, not to promise outcomes.",
    },
  ],
} as const;

// ─── Final CTA ────────────────────────────────────────────────────────────────

export const FINAL_CTA = {
  mono: "No noise · No gut calls · Just the number",
  headline: "Bet with the math.",
  copy: "Price every line against 10,000 simulations before a dollar of your bankroll moves.",
  cta: "Get Access",
} as const;

// ─── Footer ───────────────────────────────────────────────────────────────────

export const FOOTER_LEGAL =
  "© 2026 AI Sports Betting. dime provides statistical model projections for informational and entertainment purposes only — nothing here is financial advice, and no model guarantees a profit. Must be 21+ (or of legal betting age in your jurisdiction) to wager. Please bet responsibly. If you or someone you know has a gambling problem, call 1-800-GAMBLER.";

// ─── Stats band ───────────────────────────────────────────────────────────────

export const STATS = [
  { value: "10,000", label: "Simulations per game" },
  { value: "55+", label: "Model outputs per matchup" },
  { value: "6", label: "Markets priced, book vs model" },
  { value: "24/7", label: "Odds, lineups & weather pipeline" },
] as const;
