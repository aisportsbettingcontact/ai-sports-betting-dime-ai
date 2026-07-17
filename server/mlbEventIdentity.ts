/**
 * MLB event identity and doubleheader grouping contract.
 *
 * Existence is keyed exclusively by the authoritative gamePk. Grouping is a
 * presentation/analysis concern and must never be used to remove an event.
 */
export type DoubleheaderConfidence = "EXPLICIT" | "CORROBORATED" | "POSSIBLE" | "NOT_DOUBLEHEADER" | "UNKNOWN";

export interface MlbProviderEvent {
  gamePk: number;
  scheduledStartUtc: string;
  officialDate: string;
  awayTeamId: number;
  homeTeamId: number;
  venueId?: number | null;
  doubleHeader?: string | null;
  gameNumber?: number | null;
  seriesGameNumber?: number | null;
  dayNight?: string | null;
}

export interface IdentifiedMlbEvent extends MlbProviderEvent {
  provider: "mlb-stats";
  providerEventId: string;
  canonicalEventId: string;
  doubleheaderGroupId: string | null;
  doubleheaderConfidence: DoubleheaderConfidence;
}

export function canonicalMlbEventId(gamePk: number): string {
  if (!Number.isSafeInteger(gamePk) || gamePk <= 0) throw new Error("MLB gamePk must be a positive safe integer");
  return `mlb-stats:MLB:${gamePk}`;
}

function groupKey(event: MlbProviderEvent): string {
  // Team IDs are sorted so a provider orientation correction cannot split a group.
  const teams = [event.awayTeamId, event.homeTeamId].sort((a, b) => a - b).join(":");
  return `${event.officialDate}:${event.venueId ?? "unknown"}:${teams}`;
}

export function identifyMlbEvents(events: readonly MlbProviderEvent[]): IdentifiedMlbEvent[] {
  const unique = new Map<number, MlbProviderEvent>();
  for (const event of events) {
    if (unique.has(event.gamePk)) continue; // repeated network delivery: idempotent
    unique.set(event.gamePk, event);
  }
  const groups = new Map<string, MlbProviderEvent[]>();
  for (const event of unique.values()) {
    const key = groupKey(event);
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return [...unique.values()].map(event => {
    const siblings = groups.get(groupKey(event)) ?? [];
    const explicit = siblings.some(s => ["Y", "S"].includes((s.doubleHeader ?? "").toUpperCase()));
    const corroborated = siblings.length > 1 && siblings.some(s => s.gameNumber != null || s.seriesGameNumber != null || s.dayNight != null);
    const confidence: DoubleheaderConfidence = siblings.length < 2
      ? "NOT_DOUBLEHEADER"
      : explicit ? "EXPLICIT" : corroborated ? "CORROBORATED" : "POSSIBLE";
    return {
      ...event,
      provider: "mlb-stats",
      providerEventId: String(event.gamePk),
      canonicalEventId: canonicalMlbEventId(event.gamePk),
      doubleheaderGroupId: siblings.length > 1 ? `mlb-dh:${groupKey(event)}` : null,
      doubleheaderConfidence: confidence,
    };
  }).sort((a, b) => a.scheduledStartUtc.localeCompare(b.scheduledStartUtc) || a.canonicalEventId.localeCompare(b.canonicalEventId));
}

/** Boundary reconciliation signal; callers should emit/alert when missing is non-empty. */
export function reconcileMlbEventIds(expected: readonly string[], observed: readonly string[]) {
  const expectedSet = new Set(expected);
  const observedSet = new Set(observed);
  return {
    expected: expectedSet.size,
    observed: observedSet.size,
    duplicates: observed.length - observedSet.size,
    missing: [...expectedSet].filter(id => !observedSet.has(id)),
    unexpected: [...observedSet].filter(id => !expectedSet.has(id)),
    ok: expectedSet.size === observedSet.size && [...expectedSet].every(id => observedSet.has(id)),
  };
}
