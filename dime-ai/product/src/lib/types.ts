export type League = "soccer" | "mlb" | "nba";
export type Confidence = "High" | "Medium" | "Low";

export interface ProbabilityItem {
  label: string;
  pct: number;
  lead: boolean;
}

export interface MatchAnalysis {
  comp: string;
  sims: string;
  away: string;
  awayLogo: string;
  awayAlt: string;
  home: string;
  homeLogo: string;
  homeAlt: string;
  score: string;
  probs: ProbabilityItem[];
  totals: string;
  marketName: string;
  bookPrice: string;
  fairPrice: string;
  edge: string;
  drivers: string[];
  risk: string;
  meta: string;
  aria: string;
}

export interface PropProjection {
  player: string;
  team: string;
  teamLogo: string;
  teamAlt: string;
  opp: string;
  oppLogo: string;
  oppAlt: string;
  vs: "vs" | "at";
  market: string;
  bookPrice: string;
  projection: string;
  fairPrice: string;
  edge: string;
  confidence: Confidence;
  evidence: string[];
  risk: string;
}

export type MessageStatus = "thinking" | "streaming" | "done" | "stopped";

export interface UserChatMessage {
  id: string;
  role: "user";
  text: string;
}

export interface AiChatMessage {
  id: string;
  role: "ai";
  status: MessageStatus;
  text: string;
  shownText: string;
  match?: MatchAnalysis;
  props?: PropProjection[];
  propsMeta?: string;
  followups?: string[];
  evidenceOpen: boolean;
  whyOpen: Record<number, boolean>;
  saved: boolean;
  cost: number;
}

export type ChatMessage = UserChatMessage | AiChatMessage;

export interface FeedMarketRow {
  label: string;
  book: string;
  fair: string;
  edge: string;
}

export interface FeedTeam {
  name: string;
  logo: string;
  alt: string;
  pct: number;
  lead: boolean;
}

export interface FeedGame {
  id: string;
  league: League;
  comp: string;
  sims: string;
  away: FeedTeam;
  home: FeedTeam;
  markets: FeedMarketRow[];
}

export interface SplitsSide {
  a: string;
  b: string;
}

export interface SplitsMarket {
  title: string;
  book: SplitsSide;
  model: SplitsSide;
  modelHighlight: "A" | "B" | null;
  tickets: { a: number; b: number };
  money: { a: number; b: number };
  sideLabels: SplitsSide;
}

export interface SplitsTeam {
  city: string;
  name: string;
  logo: string;
  alt: string;
  score: number;
}

export interface SplitsEdge {
  teamLogo: string;
  teamAlt: string;
  label: string;
  marketName: string;
  roi: string;
}

export interface SplitsData {
  status: "Final" | "Live" | "Scheduled";
  away: SplitsTeam;
  home: SplitsTeam;
  markets: SplitsMarket[];
  edges: SplitsEdge[];
}

export interface Conversation {
  id: string;
  title: string;
  sub: string;
  group: "Today" | "Yesterday";
  current: boolean;
}

export interface CreditActivityEntry {
  label: string;
  time: string;
  amount: string;
  positive: boolean;
}

export type Tab = "chat" | "feed" | "splits" | "props" | "profile";

export type CreditScenario =
  | "live"
  | "low"
  | "critical"
  | "zero"
  | "unlimited"
  | "loading"
  | "error";

export type EffectiveCreditTier = "normal" | "low" | "critical" | "zero" | "unlimited" | "error";
