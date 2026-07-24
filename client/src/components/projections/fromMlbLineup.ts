import type {
  ProjectionLineupPlayer,
  ProjectionPitcher,
  ProjectionPregameLineups,
} from "./types";

/**
 * Structural subset of games.mlbLineups. Keeping this adapter structural means
 * the projection card does not depend on the legacy MlbLineupCard component or
 * on database-only fields such as weather and umpire.
 */
export interface MlbLineupLike {
  scrapedAt?: number | null;
  awayPitcherName?: string | null;
  awayPitcherHand?: string | null;
  awayPitcherEra?: string | null;
  awayPitcherRotowireId?: number | null;
  awayPitcherMlbamId?: number | null;
  awayPitcherConfirmed?: boolean | null;
  homePitcherName?: string | null;
  homePitcherHand?: string | null;
  homePitcherEra?: string | null;
  homePitcherRotowireId?: number | null;
  homePitcherMlbamId?: number | null;
  homePitcherConfirmed?: boolean | null;
  awayLineup?: string | null;
  homeLineup?: string | null;
  awayLineupConfirmed?: boolean | null;
  homeLineupConfirmed?: boolean | null;
}

const finiteInteger = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null;

const nonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/**
 * Treat scraper JSON as untrusted at the UI boundary: malformed rows are
 * ignored, orders are normalized, and at most the nine MLB lineup spots render.
 */
export function parseRotowireBattingOrder(raw: string | null | undefined): ProjectionLineupPlayer[] {
  if (!raw) return [];

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(decoded)) return [];

  return decoded
    .map((entry): ProjectionLineupPlayer | null => {
      if (!entry || typeof entry !== "object") return null;
      const row = entry as Record<string, unknown>;
      const battingOrder = finiteInteger(row.battingOrder);
      const name = nonEmptyString(row.name);
      if (battingOrder == null || battingOrder < 1 || battingOrder > 9 || !name) return null;

      return {
        battingOrder,
        name,
        position: nonEmptyString(row.position) ?? "—",
        bats: nonEmptyString(row.bats),
        rotowireId: finiteInteger(row.rotowireId),
        mlbamId: finiteInteger(row.mlbamId),
      };
    })
    .filter((player): player is ProjectionLineupPlayer => player != null)
    .sort((a, b) => a.battingOrder - b.battingOrder)
    .slice(0, 9);
}

function pitcher(
  name: string | null | undefined,
  hand: string | null | undefined,
  seasonStats: string | null | undefined,
  rotowireId: number | null | undefined,
  mlbamId: number | null | undefined,
  confirmed: boolean | null | undefined,
): ProjectionPitcher {
  return {
    name: nonEmptyString(name),
    hand: nonEmptyString(hand),
    seasonStats: nonEmptyString(seasonStats),
    rotowireId: finiteInteger(rotowireId),
    mlbamId: finiteInteger(mlbamId),
    confirmed: confirmed === true,
  };
}

/**
 * Always returns a stable scheduled-card shape. Before Rotowire posts a game,
 * the card can say "Pitcher TBD" / "Batting order not posted yet" instead of
 * disappearing or shifting when the next 60-second poll arrives.
 */
export function mlbLineupToProjectionPregame(
  row: MlbLineupLike | null | undefined,
): ProjectionPregameLineups {
  return {
    source: "Rotowire",
    scrapedAt: finiteInteger(row?.scrapedAt),
    away: {
      pitcher: pitcher(
        row?.awayPitcherName,
        row?.awayPitcherHand,
        row?.awayPitcherEra,
        row?.awayPitcherRotowireId,
        row?.awayPitcherMlbamId,
        row?.awayPitcherConfirmed,
      ),
      battingOrder: parseRotowireBattingOrder(row?.awayLineup),
      confirmed: row?.awayLineupConfirmed === true,
    },
    home: {
      pitcher: pitcher(
        row?.homePitcherName,
        row?.homePitcherHand,
        row?.homePitcherEra,
        row?.homePitcherRotowireId,
        row?.homePitcherMlbamId,
        row?.homePitcherConfirmed,
      ),
      battingOrder: parseRotowireBattingOrder(row?.homeLineup),
      confirmed: row?.homeLineupConfirmed === true,
    },
  };
}
