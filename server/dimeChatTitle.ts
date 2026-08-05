/**
 * dimeChatTitle.ts — deterministic topic-detection titling for Dime Chat
 * threads (owner directive 2026-07-29 r3).
 *
 * A new thread's title is derived from the user's FIRST message by a layered,
 * fully deterministic engine — no model call, no latency, no cost, and the
 * same input always yields the same title:
 *
 *   1. ENTITY DETECTION over the normalized text: league (MLB/NFL/…),
 *      betting topic (Schedule/Best Bets/Props/…), MLB team nicknames,
 *      matchup ("X @ Y" / "X vs Y"), and date ("July 29", "7/29", "tonight").
 *   2. COMPOSITION by richest pattern: matchup > teams > league+topic >
 *      single entity — with the date appended where it adds signal
 *      ("MLB Schedule — Jul 29", "Phillies @ Marlins Props", "Best Bets —
 *      Tonight").
 *   3. FALLBACK CLEANUP when nothing is detected: leading question/command
 *      scaffolding is stripped ("what is", "can you", "tell me", …), trailing
 *      punctuation dropped, the first letter capitalized, and the result
 *      truncated at a word boundary. Pure greetings become "New Chat".
 *
 * Renames NEVER pass through this engine — a user-chosen title is sanitized
 * verbatim by sanitizeThreadTitle (whitespace collapse + truncation only).
 */

export const TITLE_MAX = 80;
/** Composed/cleaned titles aim shorter than the storage cap — list-row width. */
const COMPOSED_MAX = 48;

/* ── Entity vocabularies (first match wins; multiword forms listed first) ── */

const LEAGUE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:cfb|ncaaf|college football)\b/, "CFB"],
  [/\b(?:mlb|major league baseball|baseball)\b/, "MLB"],
  [/\bnfl\b/, "NFL"],
  [/\b(?:nba|basketball)\b/, "NBA"],
  [/\b(?:nhl|hockey)\b/, "NHL"],
  [/\bworld cup\b/, "World Cup"],
  [/\b(?:epl|premier league)\b/, "Premier League"],
  [/\bsoccer\b/, "Soccer"],
  [/\b(?:ufc|mma)\b/, "UFC"],
];

/** Ordered by specificity: "best bets" must beat the generic "odds"/"lines". */
const TOPIC_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:best|top) (?:bets?|picks?|plays?)\b|\block of the day\b/, "Best Bets"],
  [
    /\bschedules?\b|\bslate\b|\bgames? (?:on|today|tonight|tomorrow)\b|\bwho(?:'s| is| are)? play/,
    "Schedule",
  ],
  [/\b(?:same[ -]?game )?parlays?\b|\bsgp\b/, "Parlay"],
  [/\bprops?\b/, "Props"],
  [/\bprojections?\b|\bmodel\b/, "Projections"],
  [/\bsplits?\b|\bpublic (?:money|betting)\b/, "Betting Splits"],
  [/\btrends?\b/, "Trends"],
  [
    /\blineups?\b|\bstarting pitchers?\b|\bbatting order\b|\bprobables?\b/,
    "Lineups",
  ],
  [/\binjur(?:y|ies|ed)\b/, "Injuries"],
  [/\bedges?\b/, "Edges"],
  [/\bspreads?\b|\bagainst the spread\b|\bats\b/, "Spread"],
  [/\bmoney ?lines?\b|\bml\b/, "Moneyline"],
  [/\bover[ /-]?unders?\b|\btotals?\b|\bo\/u\b/, "Totals"],
  [/\bfutures?\b/, "Futures"],
  [/\bstandings\b/, "Standings"],
  [/\bweather\b/, "Weather"],
  [/\bbankroll\b|\bunit size\b|\bstaking\b/, "Bankroll"],
  [/\bodds\b|\blines?\b|\bprices?\b/, "Odds"],
];

/** All 30 MLB nicknames (multiword forms first so "red sox" wins over none). */
const MLB_TEAM_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bred sox\b/, "Red Sox"],
  [/\bwhite sox\b/, "White Sox"],
  [/\bblue jays\b/, "Blue Jays"],
  [/\bdiamondbacks\b|\bd-?backs\b/, "D-backs"],
  [/\byankees\b/, "Yankees"],
  [/\brays\b/, "Rays"],
  [/\borioles\b/, "Orioles"],
  [/\bguardians\b/, "Guardians"],
  [/\btigers\b/, "Tigers"],
  [/\btwins\b/, "Twins"],
  [/\broyals\b/, "Royals"],
  [/\bastros\b/, "Astros"],
  [/\bmariners\b/, "Mariners"],
  [/\brangers\b/, "Rangers"],
  [/\bathletics\b|\ba's\b/, "Athletics"],
  [/\bangels\b/, "Angels"],
  [/\bbraves\b/, "Braves"],
  [/\bmarlins\b/, "Marlins"],
  [/\bmets\b/, "Mets"],
  [/\bphillies\b/, "Phillies"],
  [/\bnationals\b|\bnats\b/, "Nationals"],
  [/\bcubs\b/, "Cubs"],
  [/\breds\b/, "Reds"],
  [/\bbrewers\b/, "Brewers"],
  [/\bpirates\b/, "Pirates"],
  [/\bcardinals\b|\bcards\b/, "Cardinals"],
  [/\bdodgers\b/, "Dodgers"],
  [/\bgiants\b/, "Giants"],
  [/\bpadres\b/, "Padres"],
  [/\brockies\b/, "Rockies"],
];

const MONTH_LABELS: Readonly<Record<string, string>> = {
  jan: "Jan",
  feb: "Feb",
  mar: "Mar",
  apr: "Apr",
  may: "May",
  jun: "Jun",
  jul: "Jul",
  aug: "Aug",
  sep: "Sep",
  oct: "Oct",
  nov: "Nov",
  dec: "Dec",
};

/* ── Detectors ──────────────────────────────────────────────────────────── */

function firstMatch(
  lower: string,
  patterns: ReadonlyArray<readonly [RegExp, string]>
): string | null {
  for (const [re, label] of patterns) if (re.test(lower)) return label;
  return null;
}

/** Up to two distinct MLB teams, in order of appearance in the text. */
function detectTeams(lower: string): string[] {
  const hits: Array<{ index: number; label: string }> = [];
  for (const [re, label] of MLB_TEAM_PATTERNS) {
    const m = re.exec(lower);
    if (m) hits.push({ index: m.index, label });
  }
  hits.sort((a, b) => a.index - b.index);
  return hits.slice(0, 2).map(h => h.label);
}

function detectDate(lower: string): string | null {
  const monthDay =
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/.exec(
      lower
    );
  if (monthDay) {
    const day = Number(monthDay[2]);
    if (day >= 1 && day <= 31) return `${MONTH_LABELS[monthDay[1]]} ${day}`;
  }
  const slash = /\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/.exec(lower);
  if (slash) {
    const mm = Number(slash[1]);
    const dd = Number(slash[2]);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) return `${mm}/${dd}`;
  }
  if (/\btonight\b/.test(lower)) return "Tonight";
  if (/\btoday\b/.test(lower)) return "Today";
  if (/\btomorrow\b/.test(lower)) return "Tomorrow";
  return null;
}

/* ── Fallback cleanup ───────────────────────────────────────────────────── */

const LEAD_SCAFFOLD: ReadonlyArray<RegExp> = [
  /^(?:hey|hi|hello|yo|ok(?:ay)?|please|so|umm?|well|also)[,!. ]+/i,
  // Addressing the product by name only counts as scaffolding with a hard
  // separator — "dime, …" strips; "Dime AI currently…" is content and stays.
  /^dime[,!.:]\s*/i,
  // "what can/could/should <subject> …" sheds the whole modal head at once —
  // the generic strip below would otherwise leave a dangling "can <subject>".
  /^what (?:can|could|should|do(?:es)?|did|will|would)\s+/i,
  /^(?:what(?:'s| is| are| was| were)?|who(?:'s| is| are)?|when(?:'s| is| are| do(?:es)?)?|where(?:'s| is| are)?|which|why|how(?: do(?:es)?| can| should| much| many| about)?)\s+/i,
  /^(?:can|could|would|will|should|do|does) (?:you|i|we|u)\s+/i,
  /^(?:tell|show|give) (?:me|us)\s+/i,
  /^(?:i(?:'m| am)? (?:looking for|wondering about|curious about|trying to find)|i want to know(?: about)?|i need|help me(?: with)?)\s+/i,
];

const GREETING_ONLY =
  /^(?:hi|hey|hello|yo|sup|what'?s up|good (?:morning|afternoon|evening)|test(?:ing)?)$/i;

function cleanupFallback(collapsed: string): string {
  let t = collapsed;
  // Iterative strip — "hey dime, can you tell me …" sheds one layer per pass.
  for (let i = 0; i < 4; i++) {
    const before = t;
    for (const re of LEAD_SCAFFOLD) t = t.replace(re, "");
    if (t === before) break;
  }
  t = t.replace(/[?!. ]+$/, "").trim();
  if (t === "" || GREETING_ONLY.test(t)) return "New Chat";
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return truncateAtWord(t, COMPOSED_MAX);
}

function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const kept = lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut;
  return `${kept.trimEnd()}…`;
}

/* ── Public API ─────────────────────────────────────────────────────────── */

/** Whitespace-collapse + hard truncation only — for user-chosen titles. */
export function sanitizeThreadTitle(
  text: string,
  max: number = TITLE_MAX
): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1).trimEnd()}…`;
}

/** Topic-detected title for a NEW thread, from its first user message. */
export function deriveThreadTitle(
  text: string,
  max: number = TITLE_MAX
): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed === "") return "New Chat";
  const lower = collapsed.toLowerCase();

  const league = firstMatch(lower, LEAGUE_PATTERNS);
  const topic = firstMatch(lower, TOPIC_PATTERNS);
  const teams = detectTeams(lower);
  const date = detectDate(lower);

  // Matchup core: two known teams (separator mirrors the user's own form).
  let core: string | null = null;
  if (teams.length === 2) {
    core = `${teams[0]} ${/@/.test(lower) ? "@" : "vs"} ${teams[1]}`;
  } else if (teams.length === 1) {
    core = teams[0];
  }

  let composed: string | null = null;
  if (core && topic) composed = `${core} ${topic}`;
  else if (core && date) composed = `${core} — ${date}`;
  else if (core) composed = core;
  else if (league && topic)
    composed = date ? `${league} ${topic} — ${date}` : `${league} ${topic}`;
  else if (topic) composed = date ? `${topic} — ${date}` : topic;
  else if (league) composed = date ? `${league} — ${date}` : league;

  const title = composed ?? cleanupFallback(collapsed);
  return truncateAtWord(title, Math.min(max, composed ? COMPOSED_MAX : max));
}
