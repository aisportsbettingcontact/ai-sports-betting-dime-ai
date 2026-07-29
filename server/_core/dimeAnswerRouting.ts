import { createHash } from "node:crypto";
import { MLB_TEAMS } from "@shared/mlbTeams";
import { NBA_TEAMS } from "@shared/nbaTeams";
import { NCAAM_TEAMS } from "@shared/ncaamTeams";
import { NHL_TEAMS } from "@shared/nhlTeams";
import CFB_TEAMS from "../../scripts/data/cfb-2026/teams.json";
import NFL_TEAMS from "../../scripts/data/nfl-2026/teams.json";
import { DIME_PLATFORM_KNOWLEDGE } from "./dimePlatformKnowledge";
import {
  americanToImpliedProbability,
  expectedValue,
  probabilityToAmericanOdds,
} from "./dimeVerdict";

export const DIME_ANSWER_ROUTING_VERSION = "runtime-answer-routing-v1";
export const DIME_PLATFORM_TIME_ZONE = "America/New_York";

export type DimeAnswerMode = "platform" | "matchup" | "slate" | "educational";
export type DimeEventResolutionKind =
  | "exact"
  | "nearby"
  | "ambiguous"
  | "missing"
  | "not_applicable";
export type DimeDateSource =
  | "explicit"
  | "relative"
  | "none"
  | "invalid"
  | "ambiguous";
export type DimeLeague = "MLB" | "NBA" | "NHL" | "NCAAM" | "NFL" | "NCAAF";
export type DimeGroundingStatus =
  | "full_event"
  | "identity_only"
  | "catalog_only"
  | "none";
export type DimeCompletenessStatus =
  | "passed"
  | "failed"
  | "not_applicable"
  | "disabled";

const ROUTING_DISABLED_RETRIEVAL_CAP = 12;
const DIME_RETRIEVAL_CAPS: Record<DimeAnswerMode, number> = {
  platform: 0,
  educational: 0,
  matchup: 2,
  slate: 12,
};

const LEAGUE_ALIASES: ReadonlyArray<{
  league: DimeLeague;
  aliases: readonly string[];
}> = [
  { league: "MLB", aliases: ["mlb", "major league baseball", "baseball"] },
  { league: "NBA", aliases: ["nba", "pro basketball"] },
  { league: "NHL", aliases: ["nhl", "hockey"] },
  {
    league: "NCAAM",
    aliases: [
      "ncaam",
      "ncaab",
      "college basketball",
      "mens college basketball",
      "march madness",
    ],
  },
  { league: "NFL", aliases: ["nfl", "pro football"] },
  {
    league: "NCAAF",
    aliases: ["ncaaf", "cfb", "college football"],
  },
];

const MONTHS: ReadonlyMap<string, number> = new Map([
  ["jan", 1],
  ["january", 1],
  ["feb", 2],
  ["february", 2],
  ["mar", 3],
  ["march", 3],
  ["apr", 4],
  ["april", 4],
  ["may", 5],
  ["jun", 6],
  ["june", 6],
  ["jul", 7],
  ["july", 7],
  ["aug", 8],
  ["august", 8],
  ["sep", 9],
  ["sept", 9],
  ["september", 9],
  ["oct", 10],
  ["october", 10],
  ["nov", 11],
  ["november", 11],
  ["dec", 12],
  ["december", 12],
] as const);

const GENERIC_TEAM_TOKENS = new Set([
  "and",
  "bay",
  "city",
  "los",
  "new",
  "san",
  "state",
  "the",
  "united",
]);

export interface DimeTeamReference {
  key: string;
  league: DimeLeague;
  name: string;
  matchedAliases: string[];
}

interface KnownTeam {
  key: string;
  league: DimeLeague;
  name: string;
  aliases: string[];
}

export interface DimeAnswerRoute {
  version: typeof DIME_ANSWER_ROUTING_VERSION;
  enabled: boolean;
  mode: DimeAnswerMode;
  platformScope: "capabilities" | "feature" | "not_applicable";
  leagueCandidates: DimeLeague[];
  league?: DimeLeague;
  unsupportedLeague?: string;
  requestedDate?: string;
  requestedGameNumber?: 1 | 2;
  dateCandidates: string[];
  dateSource: DimeDateSource;
  teamCandidates: DimeTeamReference[];
  retrievalCap: number;
  retrievalBypassed: boolean;
  hasMatchupDelimiter: boolean;
  normalizedQuery: string;
}

export interface DimeResolvableGame {
  id: number;
  sport: string;
  gameDate: string;
  startTimeEst: string | null;
  gameNumber?: number | null;
  awayTeam: string;
  homeTeam: string;
}

export interface DimeEventIdentity {
  id: number;
  sport: string;
  gameDate: string;
  startTimeEst: string | null;
  gameNumber: number | null;
  awayTeam: string;
  homeTeam: string;
}

export interface DimeEventResolution {
  kind: DimeEventResolutionKind;
  selected: DimeEventIdentity[];
  candidateEventIds: number[];
  confidence: number;
  reason: string;
}

export interface DimeAnswerEvidence {
  route: DimeAnswerRoute;
  resolution: DimeEventResolution;
  freshness: "live" | "delayed" | "none";
  grounding: DimeGroundingStatus;
  rowCount: number;
  retrievalCandidateCount: number;
  retrievalLatencyMs: number;
  supportedNumericValues: string[];
}

export interface DimeCompletenessResult {
  status: DimeCompletenessStatus;
  errorCodes: string[];
  safeFallback?: string;
}

function team(
  league: DimeLeague,
  key: string,
  name: string,
  aliases: Array<string | null | undefined>
): KnownTeam {
  return {
    league,
    key: `${league}:${key}`,
    name,
    aliases: Array.from(
      new Set(
        [name, ...aliases]
          .filter((value): value is string => Boolean(value))
          .map(normalizeDimeSearchText)
          .filter(value => value.length >= 2)
      )
    ),
  };
}

const KNOWN_TEAMS: KnownTeam[] = [
  ...MLB_TEAMS.map(item =>
    team("MLB", item.abbrev, item.name, [
      item.nickname,
      item.abbrev,
      item.brAbbrev,
      item.mlbCode,
      item.vsinSlug,
      item.dbSlug,
      item.anSlug,
    ])
  ),
  ...NBA_TEAMS.map(item =>
    team("NBA", item.abbrev, item.name, [
      item.nickname,
      item.abbrev,
      item.nbaSlug,
      item.vsinSlug,
      item.dbSlug,
      item.anSlug,
    ])
  ),
  ...NHL_TEAMS.map(item =>
    team("NHL", item.abbrev, item.name, [
      item.nickname,
      item.abbrev,
      item.nhlSlug,
      item.vsinSlug,
      item.dbSlug,
      item.anSlug,
    ])
  ),
  ...NCAAM_TEAMS.map(item =>
    team("NCAAM", item.dbSlug, item.ncaaName, [
      item.ncaaNickname,
      item.vsinName,
      item.ncaaSlug,
      item.vsinSlug,
      item.dbSlug,
      item.kenpomSlug,
      item.anSlug,
    ])
  ),
  ...NFL_TEAMS.map(item =>
    team("NFL", item.abbreviation, item.displayName, [
      item.abbreviation,
      item.displayName.split(" ").at(-1),
    ])
  ),
  ...CFB_TEAMS.map(item =>
    team("NCAAF", String(item.espnId), item.espnDisplayName, [
      item.espnAbbreviation,
      item.fbschedulesName,
      item.fbschedulesSlug
        .replace(/^20\d{2}-/, "")
        .replace(/-football-schedule$/, ""),
    ])
  ),
];

const ALIAS_INDEX = (() => {
  const index = new Map<string, KnownTeam[]>();
  for (const knownTeam of KNOWN_TEAMS) {
    for (const alias of knownTeam.aliases) {
      const existing = index.get(alias) ?? [];
      if (!existing.some(candidate => candidate.key === knownTeam.key)) {
        existing.push(knownTeam);
      }
      index.set(alias, existing);
    }
  }
  return index;
})();

const SORTED_TEAM_ALIASES = Array.from(ALIAS_INDEX.keys()).sort(
  (left, right) =>
    right.split(" ").length - left.split(" ").length ||
    right.length - left.length ||
    left.localeCompare(right)
);

export function normalizeDimeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function collectDimeNumericValues(values: readonly unknown[]): string[] {
  const numericValues = new Set<string>();
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const text = String(value).replace(/^\s*\d+[.)]\s+/gm, "");
    for (const match of Array.from(
      text.matchAll(/(?<![A-Za-z0-9])([+-]?\d+(?:\.\d+)?)(?![A-Za-z0-9])/g)
    )) {
      const number = Number(match[1]);
      if (Number.isFinite(number)) {
        numericValues.add(Object.is(number, -0) ? "0" : String(number));
      }
    }
  }
  return Array.from(numericValues).sort(
    (left, right) => Number(left) - Number(right) || left.localeCompare(right)
  );
}

interface DimeNumericOccurrence {
  normalized: string;
  raw: string;
  value: number;
  isPercentage: boolean;
}

function dimeNumericOccurrences(value: string): DimeNumericOccurrence[] {
  const text = value.replace(/^\s*\d+[.)]\s+/gm, "");
  return Array.from(
    text.matchAll(
      /(?<![A-Za-z0-9])([+-]?\d+(?:\.\d+)?)(?:\s*(%|percent(?:age)?(?:\s+points?)?|pp))?(?![A-Za-z0-9])/gi
    )
  ).flatMap(match => {
    const number = Number(match[1]);
    if (!Number.isFinite(number)) return [];
    return [
      {
        normalized: Object.is(number, -0) ? "0" : String(number),
        raw: match[1],
        value: number,
        isPercentage: Boolean(match[2]),
      },
    ];
  });
}

function roundedValueMatches(actual: DimeNumericOccurrence, expected: number) {
  const decimalPlaces = actual.raw.split(".")[1]?.length ?? 0;
  return actual.value === Number(expected.toFixed(decimalPlaces));
}

function isSupportedDeterministicCalculation(
  occurrence: DimeNumericOccurrence,
  clause: string,
  supportedValues: ReadonlySet<string>
): boolean {
  const occurrences = dimeNumericOccurrences(clause);
  const supported = occurrences.filter(item =>
    supportedValues.has(item.normalized)
  );
  const americanOdds = supported
    .filter(
      item =>
        /^[+-]/.test(item.raw) &&
        Number.isInteger(item.value) &&
        Math.abs(item.value) >= 100
    )
    .map(item => item.value);
  const probabilities = supported.flatMap(item => {
    if (item.isPercentage && item.value > 0 && item.value < 100) {
      return [item.value / 100];
    }
    if (!item.isPercentage && item.value > 0 && item.value < 1) {
      return [item.value];
    }
    return [];
  });
  const derivedValues: number[] = [];

  if (/\b(?:implied probability|break[- ]?even)\b/i.test(clause)) {
    for (const odds of americanOdds) {
      const implied = americanToImpliedProbability(odds);
      derivedValues.push(implied, implied * 100);
    }
  }

  if (/\bno[- ]?vig\b/i.test(clause) && americanOdds.length >= 2) {
    for (let left = 0; left < americanOdds.length; left += 1) {
      for (let right = left + 1; right < americanOdds.length; right += 1) {
        const first = americanToImpliedProbability(americanOdds[left]);
        const second = americanToImpliedProbability(americanOdds[right]);
        const total = first + second;
        derivedValues.push(
          first / total,
          (first / total) * 100,
          second / total,
          (second / total) * 100
        );
      }
    }
  }

  if (/\bfair (?:price|odds)\b/i.test(clause)) {
    for (const probability of probabilities) {
      derivedValues.push(probabilityToAmericanOdds(probability));
    }
  }

  if (/\b(?:expected value|ev|roi|return on investment)\b/i.test(clause)) {
    for (const probability of probabilities) {
      for (const odds of americanOdds) {
        const ev = expectedValue(probability, odds);
        derivedValues.push(ev, ev * 100);
      }
    }
  }

  if (/\b(?:edge|percentage points?|pp)\b/i.test(clause)) {
    for (let left = 0; left < probabilities.length; left += 1) {
      for (let right = left + 1; right < probabilities.length; right += 1) {
        const edge = probabilities[left] - probabilities[right];
        derivedValues.push(edge, edge * 100, -edge, -edge * 100);
      }
    }
  }

  return derivedValues.some(expected =>
    roundedValueMatches(occurrence, expected)
  );
}

function containsPhrase(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `);
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

export function isDimeAnswerRoutingEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.DIME_ANSWER_ROUTING_V1_ENABLED?.trim().toLowerCase() !== "false";
}

export function parseDimeLeagueAliases(query: string): DimeLeague[] {
  const normalized = normalizeDimeSearchText(query);
  return LEAGUE_ALIASES.filter(({ aliases }) =>
    aliases.some(alias =>
      containsPhrase(normalized, normalizeDimeSearchText(alias))
    )
  ).map(({ league }) => league);
}

function datePartsInTimeZone(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find(part => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function ymdFromParts(year: number, month: number, day: number): string | null {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < 2000 ||
    year > 2100
  ) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

export function addDimeCalendarDays(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function nearestYearDate(
  month: number,
  day: number,
  today: string
): string | null {
  const currentYear = Number(today.slice(0, 4));
  const currentMs = Date.parse(`${today}T12:00:00.000Z`);
  return (
    [currentYear - 1, currentYear, currentYear + 1]
      .map(year => ymdFromParts(year, month, day))
      .filter((value): value is string => Boolean(value))
      .sort(
        (left, right) =>
          Math.abs(Date.parse(`${left}T12:00:00.000Z`) - currentMs) -
            Math.abs(Date.parse(`${right}T12:00:00.000Z`) - currentMs) ||
          left.localeCompare(right)
      )[0] ?? null
  );
}

export function parseDimeRequestedDate(
  query: string,
  now = new Date(),
  timeZone = DIME_PLATFORM_TIME_ZONE
): {
  source: DimeDateSource;
  requestedDate?: string;
  candidates: string[];
} {
  const normalized = normalizeDimeSearchText(query);
  const todayParts = datePartsInTimeZone(now, timeZone);
  const today =
    ymdFromParts(todayParts.year, todayParts.month, todayParts.day) ??
    now.toISOString().slice(0, 10);
  const dates = new Set<string>();
  let source: Exclude<DimeDateSource, "ambiguous"> = "none";
  let invalidDateSeen = false;

  const add = (
    date: string | null,
    nextSource: Exclude<DimeDateSource, "ambiguous" | "none">
  ) => {
    if (!date) {
      invalidDateSeen = true;
      return;
    }
    dates.add(date);
    source = nextSource;
  };

  for (const match of Array.from(
    query.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g)
  )) {
    add(
      ymdFromParts(Number(match[1]), Number(match[2]), Number(match[3])),
      "explicit"
    );
  }

  for (const match of Array.from(
    query.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/g)
  )) {
    const rawYear = match[3];
    const year = rawYear
      ? rawYear.length === 2
        ? 2000 + Number(rawYear)
        : Number(rawYear)
      : null;
    add(
      year
        ? ymdFromParts(year, Number(match[1]), Number(match[2]))
        : nearestYearDate(Number(match[1]), Number(match[2]), today),
      "explicit"
    );
  }

  for (const match of Array.from(
    normalized.matchAll(
      /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:\s+(20\d{2}))?\b/g
    )
  )) {
    const month = MONTHS.get(match[1]);
    if (!month) {
      invalidDateSeen = true;
      continue;
    }
    add(
      match[3]
        ? ymdFromParts(Number(match[3]), month, Number(match[2]))
        : nearestYearDate(month, Number(match[2]), today),
      "explicit"
    );
  }

  const relativeDates: string[] = [];
  if (
    containsPhrase(normalized, "today") ||
    containsPhrase(normalized, "tonight")
  )
    relativeDates.push(today);
  if (containsPhrase(normalized, "tomorrow"))
    relativeDates.push(addDimeCalendarDays(today, 1));
  if (containsPhrase(normalized, "yesterday"))
    relativeDates.push(addDimeCalendarDays(today, -1));
  for (const date of relativeDates) {
    dates.add(date);
    if (source === "none") source = "relative";
  }

  const candidates = Array.from(dates).sort();
  if (candidates.length > 1) {
    return { source: "ambiguous", candidates };
  }
  if (candidates.length === 1) {
    return { source, requestedDate: candidates[0], candidates };
  }
  if (invalidDateSeen) return { source: "invalid", candidates: [] };
  return { source: "none", candidates: [] };
}

export function matchDimeTeamAliases(
  query: string,
  league?: DimeLeague
): DimeTeamReference[] {
  const normalized = normalizeDimeSearchText(query);
  const matches = new Map<string, DimeTeamReference>();

  for (const alias of SORTED_TEAM_ALIASES) {
    if (!containsPhrase(normalized, alias)) continue;
    for (const candidate of ALIAS_INDEX.get(alias) ?? []) {
      if (league && candidate.league !== league) continue;
      const existing = matches.get(candidate.key);
      if (existing) {
        existing.matchedAliases = unique([...existing.matchedAliases, alias]);
      } else {
        matches.set(candidate.key, {
          key: candidate.key,
          league: candidate.league,
          name: candidate.name,
          matchedAliases: [alias],
        });
      }
    }
  }

  return Array.from(matches.values()).sort(
    (left, right) =>
      left.league.localeCompare(right.league) ||
      left.name.localeCompare(right.name)
  );
}

function inferLeagueFromTeams(
  candidates: DimeTeamReference[]
): DimeLeague | undefined {
  if (candidates.length === 0) return undefined;
  const counts = new Map<DimeLeague, number>();
  for (const candidate of candidates) {
    counts.set(candidate.league, (counts.get(candidate.league) ?? 0) + 1);
  }
  const ranked = Array.from(counts.entries()).sort(
    ([leftLeague, leftCount], [rightLeague, rightCount]) =>
      rightCount - leftCount || leftLeague.localeCompare(rightLeague)
  );
  if (!ranked[0]) return undefined;
  if (ranked[1]?.[1] === ranked[0][1]) return undefined;
  return ranked[0][0];
}

function classifyDimeAnswerMode(
  query: string,
  teams: DimeTeamReference[],
  leagueCandidates: DimeLeague[]
): DimeAnswerMode {
  const normalized = normalizeDimeSearchText(query);
  const slate =
    /\b(slate|board|all games|rank(?: the)? games|best games|scan)\b/.test(
      normalized
    ) ||
    (leagueCandidates.length > 0 &&
      /\b(games|matchups)\b/.test(normalized) &&
      /\b(today|tonight|tomorrow|\d{1,2}\/\d{1,2}|20\d{2})\b/.test(normalized));
  if (slate) return "slate";

  const matchupLanguage =
    /\b(vs|versus|at|matchup|break down|analy[sz]e|bet|play|line|odds|spread|total|moneyline)\b/.test(
      normalized
    );
  if (
    (teams.length >= 2 && matchupLanguage) ||
    (teams.length >= 1 &&
      /\b(matchup|break down|analy[sz]e|bet|play|line|odds|spread|total|moneyline)\b/.test(
        normalized
      )) ||
    /\b(?:vs|versus)\b|@/.test(query)
  ) {
    return "matchup";
  }

  if (
    /\b(dime|platform|feature|capabilit(?:y|ies)|access|account|subscription(?: plan)?|bet tracker|model projections?|prop projections?|betting splits?|odds history|trends|where (?:can|do) i find)\b/.test(
      normalized
    )
  ) {
    return "platform";
  }
  return "educational";
}

function platformScope(
  query: string,
  mode: DimeAnswerMode
): DimeAnswerRoute["platformScope"] {
  if (mode !== "platform") return "not_applicable";
  const normalized = normalizeDimeSearchText(query);
  return /\b(what can (?:dime|you)|capabilit(?:y|ies)|features|currently help|across the platform|access now)\b/.test(
    normalized
  )
    ? "capabilities"
    : "feature";
}

export function planDimeAnswerRoute(
  query: string,
  now = new Date(),
  env: Record<string, string | undefined> = process.env
): DimeAnswerRoute {
  const enabled = isDimeAnswerRoutingEnabled(env);
  const normalizedQuery = normalizeDimeSearchText(query);
  const unsupportedLeague = containsPhrase(normalizedQuery, "wnba")
    ? "WNBA"
    : undefined;
  const explicitLeagues = parseDimeLeagueAliases(query);
  const unfilteredTeams = unsupportedLeague ? [] : matchDimeTeamAliases(query);
  const inferredLeague = inferLeagueFromTeams(unfilteredTeams);
  const league =
    explicitLeagues.length === 1 ? explicitLeagues[0] : inferredLeague;
  const teamCandidates = league
    ? unfilteredTeams.filter(candidate => candidate.league === league)
    : unfilteredTeams;
  const leagueCandidates = unique([
    ...explicitLeagues,
    ...unfilteredTeams.map(candidate => candidate.league),
  ]).sort();
  const date = parseDimeRequestedDate(query, now);
  const requestedGameNumber = (() => {
    if (/\b(?:game|g)\s*1\b|\bfirst game\b/.test(normalizedQuery)) return 1;
    if (/\b(?:game|g)\s*2\b|\bsecond game\b/.test(normalizedQuery)) return 2;
    return undefined;
  })();
  const mode = classifyDimeAnswerMode(query, teamCandidates, leagueCandidates);
  const retrievalCap = enabled
    ? DIME_RETRIEVAL_CAPS[mode]
    : ROUTING_DISABLED_RETRIEVAL_CAP;

  return {
    version: DIME_ANSWER_ROUTING_VERSION,
    enabled,
    mode,
    platformScope: platformScope(query, mode),
    leagueCandidates,
    ...(league ? { league } : {}),
    ...(unsupportedLeague ? { unsupportedLeague } : {}),
    ...(date.requestedDate ? { requestedDate: date.requestedDate } : {}),
    ...(requestedGameNumber ? { requestedGameNumber } : {}),
    dateCandidates: date.candidates,
    dateSource: date.source,
    teamCandidates,
    retrievalCap,
    retrievalBypassed:
      enabled && (retrievalCap === 0 || Boolean(unsupportedLeague)),
    hasMatchupDelimiter: /\b(?:vs|versus|at)\b|@/.test(normalizedQuery),
    normalizedQuery,
  };
}

function eventIdentity(row: DimeResolvableGame): DimeEventIdentity {
  return {
    id: row.id,
    sport: row.sport,
    gameDate: row.gameDate,
    startTimeEst: row.startTimeEst,
    gameNumber: row.gameNumber ?? null,
    awayTeam: row.awayTeam,
    homeTeam: row.homeTeam,
  };
}

function knownTeamsForRow(teamName: string, league?: DimeLeague): KnownTeam[] {
  const normalized = normalizeDimeSearchText(teamName);
  return KNOWN_TEAMS.filter(candidate => {
    if (league && candidate.league !== league) return false;
    return candidate.aliases.includes(normalized);
  });
}

function queryMatchesRowTeam(
  route: DimeAnswerRoute,
  teamName: string
): boolean {
  const normalizedTeam = normalizeDimeSearchText(teamName);
  if (!normalizedTeam) return false;
  if (containsPhrase(route.normalizedQuery, normalizedTeam)) return true;

  const knownMatches = knownTeamsForRow(teamName, route.league);
  if (
    knownMatches.some(candidate =>
      candidate.aliases.some(alias =>
        containsPhrase(route.normalizedQuery, alias)
      )
    )
  ) {
    return true;
  }

  return normalizedTeam
    .split(" ")
    .filter(token => token.length >= 3 && !GENERIC_TEAM_TOKENS.has(token))
    .some(token => containsPhrase(route.normalizedQuery, token));
}

function teamMatchCount(
  route: DimeAnswerRoute,
  row: DimeResolvableGame
): number {
  return (
    Number(queryMatchesRowTeam(route, row.awayTeam)) +
    Number(queryMatchesRowTeam(route, row.homeTeam))
  );
}

function dateDelta(left: string, right: string): number {
  return Math.round(
    (Date.parse(`${left}T12:00:00.000Z`) -
      Date.parse(`${right}T12:00:00.000Z`)) /
      (24 * 60 * 60 * 1_000)
  );
}

function stableRows<T extends DimeResolvableGame>(rows: T[]): T[] {
  return [...rows].sort(
    (left, right) =>
      left.gameDate.localeCompare(right.gameDate) ||
      (left.startTimeEst ?? "").localeCompare(right.startTimeEst ?? "") ||
      (left.gameNumber ?? 1) - (right.gameNumber ?? 1) ||
      left.id - right.id
  );
}

export function resolveDimeEvent<T extends DimeResolvableGame>(
  rows: T[],
  route: DimeAnswerRoute
): { resolution: DimeEventResolution; selectedRows: T[] } {
  if (!route.enabled) {
    const selectedRows = rows.slice(0, route.retrievalCap);
    return {
      selectedRows,
      resolution: {
        kind: "not_applicable",
        selected: selectedRows.map(eventIdentity),
        candidateEventIds: selectedRows.map(row => row.id),
        confidence: 0,
        reason: "routing_disabled",
      },
    };
  }
  if (route.mode === "platform" || route.mode === "educational") {
    return {
      selectedRows: [],
      resolution: {
        kind: "not_applicable",
        selected: [],
        candidateEventIds: [],
        confidence: 1,
        reason: "retrieval_bypassed_for_mode",
      },
    };
  }
  if (route.unsupportedLeague) {
    return {
      selectedRows: [],
      resolution: {
        kind: "missing",
        selected: [],
        candidateEventIds: [],
        confidence: 0,
        reason: `unsupported_league_${route.unsupportedLeague.toLowerCase()}`,
      },
    };
  }

  const leagueRows = route.league
    ? rows.filter(
        row => row.sport.toUpperCase() === route.league?.toUpperCase()
      )
    : rows;

  if (route.mode === "slate") {
    const matchingDate = route.requestedDate
      ? leagueRows.filter(row => row.gameDate === route.requestedDate)
      : leagueRows;
    const selectedRows = stableRows(matchingDate).slice(0, route.retrievalCap);
    return {
      selectedRows,
      resolution: {
        kind: selectedRows.length > 0 ? "exact" : "missing",
        selected: selectedRows.map(eventIdentity),
        candidateEventIds: selectedRows.map(row => row.id),
        confidence: selectedRows.length > 0 ? 0.98 : 0.2,
        reason:
          selectedRows.length > 0 ? "slate_rows_resolved" : "slate_not_found",
      },
    };
  }

  const expectedSides =
    route.teamCandidates.length >= 2 || route.hasMatchupDelimiter ? 2 : 1;
  const qualified = stableRows(leagueRows).filter(
    row => teamMatchCount(route, row) >= expectedSides
  );

  if (route.dateSource === "invalid" || route.dateSource === "ambiguous") {
    const selectedRows = qualified.slice(0, route.retrievalCap);
    return {
      selectedRows,
      resolution: {
        kind: "ambiguous",
        selected: selectedRows.map(eventIdentity),
        candidateEventIds: selectedRows.map(row => row.id),
        confidence: 0.35,
        reason: `requested_date_${route.dateSource}`,
      },
    };
  }

  const exact = route.requestedDate
    ? qualified.filter(row => row.gameDate === route.requestedDate)
    : qualified;
  const gameNumberExact = route.requestedGameNumber
    ? exact.filter(row => (row.gameNumber ?? 1) === route.requestedGameNumber)
    : exact;
  if (gameNumberExact.length === 1) {
    return {
      selectedRows: gameNumberExact,
      resolution: {
        kind: "exact",
        selected: gameNumberExact.map(eventIdentity),
        candidateEventIds: gameNumberExact.map(row => row.id),
        confidence: 0.99,
        reason: "one_exact_event",
      },
    };
  }
  if (gameNumberExact.length > 1) {
    const selectedRows = gameNumberExact.slice(0, route.retrievalCap);
    return {
      selectedRows,
      resolution: {
        kind: "ambiguous",
        selected: selectedRows.map(eventIdentity),
        candidateEventIds: selectedRows.map(row => row.id),
        confidence: 0.55,
        reason: "multiple_exact_events",
      },
    };
  }

  if (route.requestedDate) {
    const nearby = qualified.filter(
      row => Math.abs(dateDelta(row.gameDate, route.requestedDate!)) === 1
    );
    if (nearby.length === 1) {
      return {
        selectedRows: nearby,
        resolution: {
          kind: "nearby",
          selected: nearby.map(eventIdentity),
          candidateEventIds: nearby.map(row => row.id),
          confidence: 0.85,
          reason: "one_adjacent_date_event",
        },
      };
    }
    if (nearby.length > 1) {
      const selectedRows = nearby.slice(0, route.retrievalCap);
      return {
        selectedRows,
        resolution: {
          kind: "ambiguous",
          selected: selectedRows.map(eventIdentity),
          candidateEventIds: selectedRows.map(row => row.id),
          confidence: 0.45,
          reason: "multiple_adjacent_date_events",
        },
      };
    }
  }

  return {
    selectedRows: [],
    resolution: {
      kind: "missing",
      selected: [],
      candidateEventIds: [],
      confidence: 0.2,
      reason: "requested_event_not_found",
    },
  };
}

function routeSystemBlock(route: DimeAnswerRoute): string {
  if (route.mode === "platform") {
    return `RUNTIME ANSWER ROUTE: platform
- Answer from DIME_PLATFORM_KNOWLEDGE only. Do not use betting-verdict framing.
- Do not ask for an event, market, event ID, or timestamp unless the user separately requests betting analysis.
- For a broad capabilities question, use these exact sections: "Available in Chat now", "Available elsewhere in Dime", and "Not connected or not available".
- A broad answer must cover Dime AI Chat, AI Model Projections, Betting Splits and Odds History, Trends, Bet Tracker, and Prop Projections, including their actual access boundaries.`;
  }
  if (route.mode === "matchup") {
    return `RUNTIME ANSWER ROUTE: matchup
- Treat the server-generated DIME_EVENT_RESOLUTION block as authoritative.
- Analyze a full event only when result=exact.
- If result=nearby, begin with "DATE CHECK:", identify requested and candidate dates, and request confirmation without using the candidate's market/model numbers.
- If result=ambiguous, begin with "AMBIGUOUS MATCH:" and ask the user to choose a listed event.
- If result=missing, begin with "NO DATA:" and name the unresolved event/date. Never substitute another event.`;
  }
  if (route.mode === "slate") {
    return `RUNTIME ANSWER ROUTE: slate
- Rank only events present in the server-generated DIME_EVENT_RESOLUTION context.
- Preserve date, league, delayed-data, and missing-market disclosures. Do not expand beyond supplied rows.`;
  }
  return `RUNTIME ANSWER ROUTE: educational
- Explain the betting concept or deterministic math without retrieving or inventing current games, lines, projections, splits, injuries, or account facts.
- Label numeric examples as hypothetical unless the user supplied the numbers.`;
}

export function applyDimeAnswerRoute(
  baseSystemPrompt: string,
  route: DimeAnswerRoute
): string {
  if (!route.enabled) return baseSystemPrompt;
  return `${baseSystemPrompt.trim()}\n\nDIME_RUNTIME_ANSWER_ROUTING version=${route.version}\n${routeSystemBlock(route)}`;
}

export function hashDimeAnswerSystemPrompt(systemPrompt: string): string {
  return createHash("sha256").update(systemPrompt, "utf8").digest("hex");
}

function dateLabels(date: string): string[] {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  return [
    date,
    new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(parsed),
  ].map(normalizeDimeSearchText);
}

function mentionsDate(text: string, date: string): boolean {
  const normalized = normalizeDimeSearchText(text);
  return dateLabels(date).some(label => containsPhrase(normalized, label));
}

function unsupportedGroundedTeamErrors(
  evidence: DimeAnswerEvidence,
  output: string
): string[] {
  if (
    evidence.grounding !== "full_event" ||
    evidence.resolution.selected.length === 0
  ) {
    return [];
  }
  const allowedKeys = new Set(
    evidence.resolution.selected.flatMap(event => [
      ...knownTeamsForRow(event.awayTeam, evidence.route.league).map(
        team => team.key
      ),
      ...knownTeamsForRow(event.homeTeam, evidence.route.league).map(
        team => team.key
      ),
    ])
  );
  if (allowedKeys.size === 0) return [];
  const unsupported = matchDimeTeamAliases(output, evidence.route.league).some(
    team => !allowedKeys.has(team.key)
  );
  return unsupported ? ["unsupported_event_team"] : [];
}

function unsupportedGroundedNumericErrors(
  evidence: DimeAnswerEvidence,
  output: string
): string[] {
  if (
    evidence.grounding !== "full_event" ||
    evidence.resolution.kind !== "exact"
  ) {
    return [];
  }
  const allowed = new Set(evidence.supportedNumericValues);
  const clauses = output
    .split(/(?<!\d)[.!?](?!\d)|[;\n]+/)
    .map(clause => clause.trim())
    .filter(Boolean);
  const unsupported = clauses.some(clause =>
    dimeNumericOccurrences(clause).some(
      occurrence =>
        !allowed.has(occurrence.normalized) &&
        !isSupportedDeterministicCalculation(occurrence, clause, allowed)
    )
  );
  return unsupported ? ["unsupported_numeric_claim"] : [];
}

function unsupportedNonExactAnalysisErrors(
  evidence: DimeAnswerEvidence,
  output: string
): string[] {
  const { resolution, route } = evidence;
  if (
    (route.mode !== "matchup" && route.mode !== "slate") ||
    (resolution.kind !== "nearby" &&
      resolution.kind !== "ambiguous" &&
      resolution.kind !== "missing")
  ) {
    return [];
  }

  const normalized = normalizeDimeSearchText(output);
  const analysisLanguage =
    /\b(?:bet|back|play|pick|edge|odds?|spread|totals?|moneyline|over|under|expected value|ev|roi|probabilit(?:y|ies)|projections?|rank(?:ing|ed|s)?)\b/.test(
      normalized
    );
  const allowedNumbers = new Set(
    evidence.supportedNumericValues.flatMap(value => {
      const number = Number(value);
      return Number.isFinite(number)
        ? [value, String(Math.abs(number))]
        : [value];
    })
  );
  const unsupportedNumber = dimeNumericOccurrences(output).some(
    occurrence => !allowedNumbers.has(occurrence.normalized)
  );
  const allowedTeams = new Set([
    ...route.teamCandidates.map(team => team.key),
    ...resolution.selected.flatMap(event => [
      ...knownTeamsForRow(event.awayTeam, route.league).map(team => team.key),
      ...knownTeamsForRow(event.homeTeam, route.league).map(team => team.key),
    ]),
  ]);
  const unsupportedTeam = matchDimeTeamAliases(output, route.league).some(
    team => !allowedTeams.has(team.key)
  );

  return analysisLanguage || unsupportedNumber || unsupportedTeam
    ? ["unsupported_non_exact_analysis"]
    : [];
}

function broadPlatformErrors(output: string): string[] {
  const normalized = normalizeDimeSearchText(output);
  const required: Array<[string, string[]]> = [
    ["missing_section_chat_now", ["available in chat now"]],
    ["missing_section_elsewhere", ["available elsewhere in dime"]],
    ["missing_section_unavailable", ["not connected or not available"]],
    ["missing_feature_chat", ["dime ai chat"]],
    ["missing_feature_model_projections", ["ai model projections"]],
    [
      "missing_feature_splits_history",
      ["betting splits and odds history", "betting splits", "odds history"],
    ],
    ["missing_feature_trends", ["trends"]],
    ["missing_feature_bet_tracker", ["bet tracker"]],
    ["missing_feature_prop_projections", ["prop projections"]],
    ["missing_authenticated_access_boundary", ["authenticated"]],
    ["missing_owner_access_boundary", ["owner"]],
  ];
  return required
    .filter(([, alternatives]) =>
      alternatives.every(term => !containsPhrase(normalized, term))
    )
    .map(([code]) => code);
}

function unsupportedPlatformClaimErrors(output: string): string[] {
  const normalized = normalizeDimeSearchText(output);
  const errors: string[] = [];
  if (
    /\b(?:chat|i|dime)\s+(?:can|does|will)\s+(?:read|review|access|see)\s+(?:your\s+)?(?:bet\s+tracker|tracked bets|betting history)\b/.test(
      normalized
    ) ||
    /\b(?:i|chat|dime)\s+(?:reviewed|analyzed|accessed|read|saw)\s+(?:your\s+)?(?:bet tracker|tracked bets|betting history)\b/.test(
      normalized
    )
  ) {
    errors.push("unsupported_bet_tracker_chat_access");
  }
  const positivePropAvailability =
    /\bprop projections?\b.{0,40}\b(?:is|are|currently)\s+(?:live|available)\b/.test(
      normalized
    );
  const negatedPropAvailability =
    /\bprop projections?\b.{0,40}\b(?:not|isn t|aren t|unavailable)\b/.test(
      normalized
    );
  if (positivePropAvailability && !negatedPropAvailability) {
    errors.push("unsupported_prop_projections_availability");
  }
  if (
    /\b(?:dime|chat|i)\s+(?:can|will)\s+(?:place|submit|settle)\s+(?:a\s+)?bet\b/.test(
      normalized
    )
  ) {
    errors.push("unsupported_wager_execution");
  }
  if (
    (/\bbetting splits?(?: and odds history)?\b.{0,50}\bpublic\b/.test(
      normalized
    ) ||
      /\bpublic\b.{0,50}\bbetting splits?(?: and odds history)?\b/.test(
        normalized
      )) &&
    !/\bnot public\b/.test(normalized)
  ) {
    errors.push("unsupported_splits_public_access");
  }
  if (
    /\byour\s+(?:current\s+)?(?:[a-z0-9_-]+\s+)?(?:plan|subscription|role|billing status|permissions?)\s+(?:is|are|renews?|expires?)\b/.test(
      normalized
    ) ||
    /\byour\s+(?:plan|subscription)\s+(?:renews?|expires?)\b/.test(normalized)
  ) {
    errors.push("unsupported_personal_account_state");
  }
  return errors;
}

type SensitivePlatformScope = "bet_tracker_history" | "account_state";

function sensitivePlatformScope(
  route: DimeAnswerRoute
): SensitivePlatformScope | undefined {
  const query = route.normalizedQuery;
  if (
    /\b(?:bet tracker|betting history|bet history|tracked bets)\b/.test(
      query
    ) &&
    /\b(?:my|mine|me|i|review|analy[sz]e|strongest|weakest|strengths?|weaknesses?|habits?|patterns?|performance|record|roi|win rate)\b/.test(
      query
    )
  ) {
    return "bet_tracker_history";
  }
  if (
    /\b(?:account|plan|subscription|billing|renew|renewal|expires?|expiry|role|permissions?)\b/.test(
      query
    ) &&
    /\b(?:my|mine|me|am i|do i|when does|what plan|what role)\b/.test(query)
  ) {
    return "account_state";
  }
  return undefined;
}

function sensitivePlatformFallback(scope: SensitivePlatformScope): string {
  if (scope === "bet_tracker_history") {
    return "Bet Tracker exists, but Dime AI Chat cannot currently read or review your Bet Tracker history. I cannot assess your personal performance, strengths, weaknesses, habits, or patterns from data I cannot access. You can paste a sanitized betting summary here for analysis.";
  }
  return "I cannot see or infer your current account plan, role, renewal date, billing status, or permissions from Dime AI Chat. Check the account information visible in Dime or contact support for the authoritative account state.";
}

function platformAccessCompletenessErrors(
  route: DimeAnswerRoute,
  output: string
): string[] {
  if (
    !/\b(where|find|access|available|feature|platform|who can use)\b/.test(
      route.normalizedQuery
    )
  ) {
    return [];
  }
  const normalized = normalizeDimeSearchText(output);
  if (
    /\b(betting splits?|odds history|trends|bet tracker)\b/.test(
      route.normalizedQuery
    ) &&
    !containsPhrase(normalized, "authenticated")
  ) {
    return ["missing_authenticated_access_boundary"];
  }
  if (
    /\bdime ai chat\b/.test(route.normalizedQuery) &&
    !containsPhrase(normalized, "owner")
  ) {
    return ["missing_owner_access_boundary"];
  }
  if (
    /\bmodel projections?\b/.test(route.normalizedQuery) &&
    !containsPhrase(normalized, "authenticated")
  ) {
    return ["missing_authenticated_access_boundary"];
  }
  if (
    /\bprop projections?\b/.test(route.normalizedQuery) &&
    !/\b(not (?:currently )?(?:available|live)|unavailable)\b/.test(normalized)
  ) {
    return ["missing_prop_unavailable_boundary"];
  }
  return [];
}

function eventLabel(event: DimeEventIdentity): string {
  return `${event.awayTeam} at ${event.homeTeam}`;
}

export function renderPlatformCapabilitiesFallback(): string {
  const feature = (id: string) => {
    const result = DIME_PLATFORM_KNOWLEDGE.features.find(
      item => item.id === id
    );
    if (!result) throw new Error(`Missing platform feature ${id}`);
    return result;
  };
  const chat = feature("dime_chat");
  const projections = feature("model_projections");
  const splits = feature("betting_splits_odds_history");
  const trends = feature("trends");
  const tracker = feature("bet_tracker");
  const props = feature("prop_projections");

  return `Available in Chat now
- ${chat.name} (${chat.access_scope} access): sports-betting education and analysis grounded in the conversation and server-supplied Dime evidence. It can keep bounded context in the current thread and save chat threads.

Available elsewhere in Dime
- ${projections.name} (${projections.access_scope} access): published game projections and model-derived values when coverage exists.
- ${splits.name} (${splits.access_scope} access): provider-scoped bet/money percentages plus opening and current prices when available.
- ${trends.name} (${trends.access_scope} access): descriptive trend views; on mobile, Trends routes to Betting Splits.
- ${tracker.name} (${tracker.access_scope} access): records and grades wagers and shows bankroll, units, and performance analytics.

Not connected or not available
- Bet Tracker exists, but Dime AI Chat cannot currently read or coach from your Bet Tracker history.
- ${props.name} is not currently available as a standalone live feature.
- Dime cannot place, submit, or settle wagers, move money, or infer your account plan or permissions.`;
}

function resolutionFallback(evidence: DimeAnswerEvidence): string | undefined {
  const { route, resolution } = evidence;
  if (resolution.kind === "nearby" && resolution.selected[0]) {
    const candidate = resolution.selected[0];
    return `DATE CHECK: I did not find ${eventLabel(candidate)} on ${route.requestedDate ?? "the requested date"}. I found that matchup on ${candidate.gameDate} in delayed Dime evidence. Confirm that you want ${candidate.gameDate} before I analyze it; the exact market observation timestamp is unavailable.`;
  }
  if (resolution.kind === "ambiguous") {
    const candidates =
      resolution.selected.length > 0
        ? resolution.selected
            .map(
              candidate =>
                `${eventLabel(candidate)} on ${candidate.gameDate}${candidate.gameNumber ? ` (game ${candidate.gameNumber})` : ""}`
            )
            .join("; ")
        : route.dateCandidates.join(" or ");
    return `AMBIGUOUS MATCH: I cannot select one event safely. ${candidates || "The requested date or team alias has more than one valid interpretation."} Please confirm the exact event before I use any market or model numbers.`;
  }
  if (resolution.kind === "missing") {
    if (route.mode === "slate") {
      return `NO DATA: I could not resolve an eligible ${route.unsupportedLeague ?? route.league ?? "requested"} slate${route.requestedDate ? ` on ${route.requestedDate}` : ""} from Dime evidence. I will not invent games, lines, rankings, or picks. Confirm a supported league and date.`;
    }
    const teams =
      route.teamCandidates.map(candidate => candidate.name).join(" vs ") ||
      "the requested matchup";
    return `NO DATA: I could not match ${teams}${route.requestedDate ? ` on ${route.requestedDate}` : ""} to an eligible Dime event. I will not substitute another game or invent a line. Confirm the league, teams, date, and market.`;
  }
  return undefined;
}

export function validateDimeResponseCompleteness(
  evidence: DimeAnswerEvidence,
  output: string
): DimeCompletenessResult {
  if (!evidence.route.enabled) {
    return { status: "disabled", errorCodes: [] };
  }
  const normalized = normalizeDimeSearchText(output);
  if (!normalized) {
    return { status: "failed", errorCodes: ["empty_response"] };
  }

  const errors: string[] = [];
  errors.push(...unsupportedGroundedTeamErrors(evidence, output));
  errors.push(...unsupportedGroundedNumericErrors(evidence, output));
  errors.push(...unsupportedNonExactAnalysisErrors(evidence, output));
  if (evidence.route.mode === "platform") {
    const sensitiveScope = sensitivePlatformScope(evidence.route);
    if (sensitiveScope === "bet_tracker_history") {
      errors.push("bet_tracker_history_requires_deterministic_fallback");
    } else if (sensitiveScope === "account_state") {
      errors.push("account_state_requires_deterministic_fallback");
    }
    errors.push(...unsupportedPlatformClaimErrors(output));
    if (evidence.route.platformScope === "capabilities") {
      errors.push(...broadPlatformErrors(output));
    } else {
      errors.push(...platformAccessCompletenessErrors(evidence.route, output));
    }
    if (errors.length > 0) {
      return {
        status: "failed",
        errorCodes: unique(errors),
        safeFallback: sensitiveScope
          ? sensitivePlatformFallback(sensitiveScope)
          : renderPlatformCapabilitiesFallback(),
      };
    }
    return { status: "passed", errorCodes: [] };
  }

  const { resolution } = evidence;
  if (evidence.route.mode === "matchup") {
    if (resolution.kind === "nearby") {
      if (!containsPhrase(normalized, "date check"))
        errors.push("missing_nearby_date_check");
      if (
        evidence.route.requestedDate &&
        !mentionsDate(output, evidence.route.requestedDate)
      )
        errors.push("missing_requested_date");
      if (
        resolution.selected[0] &&
        !mentionsDate(output, resolution.selected[0].gameDate)
      )
        errors.push("missing_candidate_date");
    } else if (resolution.kind === "ambiguous") {
      if (!containsPhrase(normalized, "ambiguous match"))
        errors.push("missing_ambiguous_match_notice");
    } else if (resolution.kind === "missing") {
      if (!containsPhrase(normalized, "no data"))
        errors.push("missing_no_data_notice");
    } else if (resolution.kind === "exact" && resolution.selected[0]) {
      const selected = resolution.selected[0];
      if (
        !queryMatchesRowTeam(
          { ...evidence.route, normalizedQuery: normalized },
          selected.awayTeam
        )
      )
        errors.push("missing_away_team");
      if (
        !queryMatchesRowTeam(
          { ...evidence.route, normalizedQuery: normalized },
          selected.homeTeam
        )
      )
        errors.push("missing_home_team");
      if (
        evidence.freshness === "delayed" &&
        !/\b(delayed|stale|timestamp|freshness|market observed)\b/.test(
          normalized
        )
      )
        errors.push("missing_data_freshness");
    }
  } else if (evidence.route.mode === "slate") {
    if (resolution.kind === "missing") {
      if (!containsPhrase(normalized, "no data")) {
        errors.push("missing_no_data_notice");
      }
    } else if (resolution.kind === "exact" && resolution.selected[0]) {
      const first = resolution.selected[0];
      if (
        !queryMatchesRowTeam(
          { ...evidence.route, normalizedQuery: normalized },
          first.awayTeam
        ) &&
        !queryMatchesRowTeam(
          { ...evidence.route, normalizedQuery: normalized },
          first.homeTeam
        )
      ) {
        errors.push("missing_grounded_slate_event");
      }
    }
  }

  if (errors.length > 0) {
    return {
      status: "failed",
      errorCodes: unique(errors),
      ...(resolutionFallback(evidence)
        ? { safeFallback: resolutionFallback(evidence) }
        : {}),
    };
  }
  return {
    status: evidence.route.mode === "educational" ? "not_applicable" : "passed",
    errorCodes: [],
  };
}
