import type { MarketSideInput } from "@/lib/gameInsight";
import type {
  ProjectionGame,
  ProjectionMarket,
  ProjectionTeam,
  GameStatus,
} from "./types";

/**
 * Adapter: DimeModelFeed's normalized FeedCardSpec → ProjectionGame.
 *
 * Structurally typed (FeedSpecLike) so it does not couple to the page's internal
 * type, and so it can be unit-tested in isolation. It only RE-SHAPES existing
 * data — it does not change any projection, price, or edge. The American prices
 * are parsed back to numbers so the decision engine can rank markets; because the
 * engine uses the same calculateEdge as the feed, the derived edges match.
 */

interface CrestLike {
  url?: string | null;
  code: string;
  bg?: string;
}
interface TeamLike {
  name: string;
  crest: CrestLike;
  score?: string | null;
}
interface RowLike {
  label: string;
  book: string;
  model: string;
}
interface MarketLike {
  title: string;
  rows: RowLike[];
  foot: { label: string; edge: boolean };
}
export interface FeedSpecLike {
  id: string;
  /** Explicit source status when available; without it postponed and suspended
   *  games fall through the score-based inference and read as scheduled/final
   *  (mirrors presentation.ts's FeedEventLike). */
  status?: GameStatus;
  liveLabel?: string | null;
  timeLabel: string;
  away: TeamLike;
  home: TeamLike;
  meta: string;
  venueLine?: string | null;
  markets: MarketLike[];
}

/** Parse a formatted American-odds string ("-198", "+163", "—") to a number. */
export function parseAmerican(s: string | null | undefined): number | null {
  if (s == null) return null;
  const t = s.replace(/[−–]/g, "-").replace(/[^0-9.+-]/g, "");
  if (!t || t === "-" || t === "+" || t === ".") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parseScore(s: string | null | undefined): number | null {
  if (s == null || s === "") return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

export function feedSpecToProjectionGame(
  g: FeedSpecLike,
  league: string
): ProjectionGame {
  const status: GameStatus =
    g.status ??
    (g.liveLabel
      ? "live"
      : g.away.score != null || g.home.score != null
        ? "final"
        : "scheduled");
  const isPregame = status === "scheduled";

  const team = (t: TeamLike): ProjectionTeam => ({
    abbr: t.crest.code,
    name: t.name,
    logo: t.crest.url ?? null,
    color: t.crest.bg ?? null,
    score: parseScore(t.score),
  });

  const markets: ProjectionMarket[] = g.markets.map(m => {
    const key = m.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const sides: MarketSideInput[] = m.rows.map((row, i) => ({
      marketKey: key,
      marketLabel: m.title,
      sideLabel: row.label,
      bookPrice: parseAmerican(row.book),
      // two-sided markets: the opposite row supplies the no-vig comparison
      bookOppPrice: parseAmerican(m.rows[m.rows.length - 1 - i]?.book),
      modelPrice: parseAmerican(row.model),
    }));
    return {
      key,
      label: m.title,
      sides,
      resultLabel: m.foot.edge ? undefined : m.foot.label,
    };
  });

  return {
    id: g.id,
    league,
    status,
    statusLabel: g.liveLabel || g.timeLabel,
    away: team(g.away),
    home: team(g.home),
    // Ballpark + first pitch are PREGAME-ONLY (owner directive 2026-08-05).
    // This adapter feeds team-sport cards, where the context line IS the
    // ballpark, so all three lifecycle-gate together; the centered card header
    // carries the status at every state.
    matchupContext: isPregame ? g.meta || undefined : undefined,
    venue: isPregame ? (g.venueLine ?? undefined) : undefined,
    startTime: isPregame ? g.timeLabel || undefined : undefined,
    markets,
  };
}
