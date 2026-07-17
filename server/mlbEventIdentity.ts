/**
 * mlbEventIdentity.ts — Canonical MLB event identity + doubleheader handling
 * ─────────────────────────────────────────────────────────────────────────────
 * EVENT-IDENTITY CONTRACT (2026-07-17 doubleheader incident remediation)
 *
 * 1. The canonical external identity of an MLB game is its MLB Stats API
 *    `gamePk` (provider event id). Two games with the same teams on the same
 *    date are DISTINCT events whenever their gamePks differ. Matchup text,
 *    team pair, calendar date, and start time are NEVER identities.
 * 2. Doubleheader grouping is a separate concept from identity: grouping
 *    associates sibling games (same officialDate + team pair) but must never
 *    decide whether a game is retained.
 * 3. `gameNumber` (1|2) orders games within a doubleheader group for display
 *    and for the (gameDate, awayTeam, homeTeam, gameNumber) storage key. The
 *    provider's own gameNumber wins; chronological order (then gamePk) is the
 *    deterministic fallback. A missing/conflicting doubleheader flag demotes
 *    detection confidence — it never deletes an event.
 * 4. Re-ingesting the same gamePk updates that row idempotently. Ingesting a
 *    second same-matchup gamePk inserts a second row. A sync never deletes
 *    rows; status transitions (postponed/suspended/final) are updates.
 * 5. Instants stay UTC (`startUtc`); the official schedule date is the
 *    provider `officialDate` (venue-local), NOT a UTC calendar date.
 *
 * Everything in this module is pure and deterministic — no I/O, no Date.now —
 * so the full doubleheader test matrix runs without a database.
 */

// ─── Provider-normalized event ────────────────────────────────────────────────

/** Doubleheader flag as sent by statsapi.mlb.com: N=no, Y=traditional, S=split */
export type MlbDoubleHeaderFlag = "N" | "Y" | "S";

/** One normalized MLB provider event (from the statsapi schedule endpoint). */
export interface MlbProviderGame {
  /** Canonical provider event id (statsapi gamePk). Required — events without it are rejected. */
  gamePk: number;
  /** Official schedule date in venue-local terms, "YYYY-MM-DD" (provider `officialDate`). */
  officialDate: string;
  /** Scheduled first pitch as UTC ISO string (provider `gameDate`). */
  startUtc: string;
  /** DB-convention team abbreviations (already alias-normalized, e.g. AZ→ARI). */
  awayAbbrev: string;
  homeAbbrev: string;
  /** Provider doubleheader flag; undefined when the payload omitted it. */
  doubleHeader?: MlbDoubleHeaderFlag | string;
  /** Provider gameNumber within the day (1|2); undefined when omitted. */
  gameNumber?: number;
  seriesGameNumber?: number;
  /** "day" | "night" when provided. */
  dayNight?: string;
  /** Provider abstract state: "Preview" | "Live" | "Final". */
  abstractGameState: string;
  /** Provider detailed state: "Scheduled" | "Postponed" | "Suspended" | … */
  detailedState: string;
  /** Original date when this game is a rescheduled makeup (provider `rescheduledFrom`). */
  rescheduledFrom?: string;
  venueName?: string;
}

// ─── Doubleheader detection ───────────────────────────────────────────────────

export type DoubleheaderConfidence =
  | "EXPLICIT"          // provider labels the games as a doubleheader (flag Y/S on ≥1 sibling)
  | "CORROBORATED"      // no flag, but ≥2 independent fields agree (gameNumbers, dayNight, reschedule link)
  | "POSSIBLE"          // distinct same-day games exist, provider metadata incomplete
  | "NOT_DOUBLEHEADER"  // a single game (or zero) for the matchup+date
  | "UNKNOWN";          // insufficient evidence (e.g. malformed group)

export interface DoubleheaderGroup {
  /** Stable group id: officialDate + ordered team pair. Grouping only — never an event identity. */
  groupId: string;
  officialDate: string;
  awayAbbrev: string;
  homeAbbrev: string;
  confidence: DoubleheaderConfidence;
  /** Sibling gamePks ordered by resolved gameNumber. Length always equals the input count — grouping never drops events. */
  gamePks: number[];
  /** Resolved gameNumber per gamePk (provider value when consistent, else chronological). */
  resolvedGameNumbers: Map<number, number>;
  /** Human-readable inconsistency notes (flag conflicts, duplicate gameNumbers, …). */
  warnings: string[];
}

/** Grouping key for sibling association (NOT identity). */
export function doubleheaderGroupId(officialDate: string, awayAbbrev: string, homeAbbrev: string): string {
  return `${officialDate}:${awayAbbrev}@${homeAbbrev}`;
}

/** Deterministic chronological order: startUtc, then gamePk as a stable tie-breaker. */
export function compareProviderGames(a: MlbProviderGame, b: MlbProviderGame): number {
  if (a.startUtc < b.startUtc) return -1;
  if (a.startUtc > b.startUtc) return 1;
  return a.gamePk - b.gamePk;
}

function isValidFlag(flag: unknown): flag is MlbDoubleHeaderFlag {
  return flag === "N" || flag === "Y" || flag === "S";
}

/**
 * Classify one matchup+date group of provider events and resolve gameNumbers.
 *
 * Guarantees:
 *  - Output gamePks are exactly the input gamePks (no event is ever dropped).
 *  - Resolved gameNumbers are unique within the group and deterministic.
 *  - Missing/conflicting provider metadata lowers confidence and adds a
 *    warning; it never removes an event.
 */
export function classifyDoubleheaderGroup(group: MlbProviderGame[]): DoubleheaderGroup {
  const sorted = [...group].sort(compareProviderGames);
  const first = sorted[0];
  const groupId = first
    ? doubleheaderGroupId(first.officialDate, first.awayAbbrev, first.homeAbbrev)
    : "empty";
  const warnings: string[] = [];
  const resolved = new Map<number, number>();

  if (sorted.length === 0) {
    return {
      groupId, officialDate: "", awayAbbrev: "", homeAbbrev: "",
      confidence: "UNKNOWN", gamePks: [], resolvedGameNumbers: resolved, warnings: ["empty group"],
    };
  }

  // Provider gameNumbers are trusted only when they form a consistent 1..N set.
  const providerNumbers = sorted.map(g => g.gameNumber);
  const providerNumbersUsable =
    sorted.length > 1 &&
    providerNumbers.every(n => typeof n === "number" && n >= 1 && n <= sorted.length) &&
    new Set(providerNumbers).size === sorted.length;

  if (sorted.length > 1 && !providerNumbersUsable && providerNumbers.some(n => n !== undefined)) {
    warnings.push(
      `provider gameNumbers inconsistent for ${groupId}: [${providerNumbers.map(n => n ?? "∅").join(",")}] — falling back to chronological order`
    );
  }

  if (providerNumbersUsable) {
    for (const g of sorted) resolved.set(g.gamePk, g.gameNumber as number);
  } else {
    sorted.forEach((g, i) => resolved.set(g.gamePk, i + 1));
  }

  // ── Confidence ──────────────────────────────────────────────────────────────
  let confidence: DoubleheaderConfidence;
  if (sorted.length <= 1) {
    confidence = "NOT_DOUBLEHEADER";
  } else {
    const flags = sorted.map(g => g.doubleHeader);
    const validFlags = flags.filter(isValidFlag);
    const anyExplicit = validFlags.some(f => f === "Y" || f === "S");
    const anyDenies = validFlags.some(f => f === "N");

    if (anyExplicit && anyDenies) {
      warnings.push(
        `conflicting doubleheader flags for ${groupId}: [${flags.map(f => f ?? "∅").join(",")}] — distinct gamePks take precedence; keeping all events`
      );
    }
    if (anyExplicit) {
      confidence = "EXPLICIT";
    } else {
      // Independent corroborating signals beyond "two same-day games exist"
      let signals = 0;
      if (providerNumbersUsable) signals++;
      const dayNights = new Set(sorted.map(g => g.dayNight).filter(Boolean));
      if (dayNights.size > 1) signals++;                       // day + night designations
      if (sorted.some(g => g.rescheduledFrom)) signals++;      // makeup-game linkage
      if (anyDenies) {
        warnings.push(
          `provider flags say N but ${sorted.length} distinct gamePks share ${groupId} — flag ignored, events preserved`
        );
      }
      confidence = signals >= 2 ? "CORROBORATED" : "POSSIBLE";
    }
  }

  return {
    groupId,
    officialDate: first.officialDate,
    awayAbbrev: first.awayAbbrev,
    homeAbbrev: first.homeAbbrev,
    confidence,
    gamePks: sorted
      .slice()
      .sort((a, b) => (resolved.get(a.gamePk)! - resolved.get(b.gamePk)!) || (a.gamePk - b.gamePk))
      .map(g => g.gamePk),
    resolvedGameNumbers: resolved,
    warnings,
  };
}

/** Group a slate by (officialDate, matchup) and classify every group. */
export function classifySlate(slate: MlbProviderGame[]): Map<string, DoubleheaderGroup> {
  const byGroup = new Map<string, MlbProviderGame[]>();
  for (const g of slate) {
    const key = doubleheaderGroupId(g.officialDate, g.awayAbbrev, g.homeAbbrev);
    const arr = byGroup.get(key);
    if (arr) arr.push(g); else byGroup.set(key, [g]);
  }
  const out = new Map<string, DoubleheaderGroup>();
  for (const [key, group] of byGroup) out.set(key, classifyDoubleheaderGroup(group));
  return out;
}

// ─── Schedule reconciliation planning (pure) ─────────────────────────────────

/** The subset of a `games` DB row that reconciliation needs. */
export interface DbGameRow {
  id: number;
  gameDate: string;
  startTimeEst: string;
  awayTeam: string;
  homeTeam: string;
  sport: string;
  mlbGamePk: number | null;
  gameNumber: number | null;
  doubleHeader: string | null;
  gameStatus: string;
  venue?: string | null;
  rescheduledFrom?: string | null;
}

export interface SyncFieldUpdate {
  startTimeEst?: string;
  gameNumber?: number;
  doubleHeader?: string;
  mlbGamePk?: number;
  gameStatus?: "upcoming" | "live" | "final" | "postponed" | "suspended";
  venue?: string;
  rescheduledFrom?: string;
}

export interface PlannedInsert {
  gamePk: number;
  gameDate: string;
  startTimeEst: string;
  awayTeam: string;
  homeTeam: string;
  gameNumber: number;
  doubleHeader: string;
  gameStatus: "upcoming" | "live" | "final" | "postponed" | "suspended";
  venue?: string;
  rescheduledFrom?: string;
  dhConfidence: DoubleheaderConfidence;
}

export interface PlannedUpdate {
  rowId: number;
  gamePk: number;
  /** true when this update claims a legacy row (null mlbGamePk) and stamps identity onto it */
  adoptsLegacyRow: boolean;
  set: SyncFieldUpdate;
  dhConfidence: DoubleheaderConfidence;
}

export interface MlbScheduleSyncPlan {
  inserts: PlannedInsert[];
  updates: PlannedUpdate[];
  /** Provider events dropped before planning, each with a contract-valid reason. */
  rejected: Array<{ gamePk: number | null; reason: string }>;
  /** Non-fatal anomalies (flag conflicts, duplicate payload entries, …). */
  warnings: string[];
  /** Fatal-loss signals: a distinct provider event could not be planned into storage. Must be empty after a healthy sync. */
  collisions: Array<{ gamePk: number; reason: string }>;
  /** Cardinality ledger for the reconciliation log. */
  counts: {
    provider: number;
    providerDistinct: number;
    matchedByGamePk: number;
    adoptedLegacyRows: number;
    inserts: number;
    unchanged: number;
    rejected: number;
  };
  /** Doubleheader classifications for observability. */
  groups: DoubleheaderGroup[];
}

/** Map provider abstract/detailed status onto DB gameStatus (same semantics as mlbScoreRefresh). */
export function mapProviderStatus(
  abstractGameState: string,
  detailedState: string
): "upcoming" | "live" | "final" | "postponed" | "suspended" {
  const detail = detailedState.toLowerCase();
  if (detail.includes("postponed") || detail.includes("cancelled") || detail.includes("canceled")) return "postponed";
  if (detail.includes("suspended")) return "suspended";
  if (abstractGameState === "Final") return "final";
  if (abstractGameState === "Live") return "live";
  return "upcoming";
}

/** Convert a UTC ISO instant to the "h:mm AM/PM" ET string stored in startTimeEst. */
export function utcToEasternTimeString(utcIso: string): string {
  const d = new Date(utcIso);
  if (isNaN(d.getTime())) return "TBD";
  return d.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Status transitions a sync snapshot may not regress. Protects against a
 * stale/out-of-order provider read reverting terminal state:
 *   final → live/upcoming, and (final|postponed|suspended) unchanged by "upcoming".
 */
export function isStatusRegression(current: string, incoming: string): boolean {
  if (current === incoming) return false;
  if (current === "final") return incoming === "live" || incoming === "upcoming";
  if (current === "live") return incoming === "upcoming";
  if ((current === "postponed" || current === "suspended") && incoming === "upcoming") return true;
  return false;
}

/**
 * Pure reconciliation planner: provider slate → insert/update plan against
 * existing DB rows. Guarantees (the doubleheader invariant):
 *
 *   For N valid distinct provider gamePks, the plan accounts for exactly N
 *   events as insert + update + unchanged, or records each miss in
 *   `collisions`/`rejected` with a reason. Distinct gamePks NEVER merge into
 *   one row, regardless of matchup/date similarity, payload order, or flags.
 */
export function planMlbScheduleSync(
  providerSlate: MlbProviderGame[],
  dbRows: DbGameRow[]
): MlbScheduleSyncPlan {
  const warnings: string[] = [];
  const rejected: Array<{ gamePk: number | null; reason: string }> = [];
  const collisions: Array<{ gamePk: number; reason: string }> = [];

  // ── 1. Reject malformed events individually (never the whole payload) ──────
  const valid: MlbProviderGame[] = [];
  for (const g of providerSlate) {
    if (!g || typeof g.gamePk !== "number" || !Number.isFinite(g.gamePk)) {
      rejected.push({ gamePk: null, reason: "missing/invalid gamePk" });
      continue;
    }
    if (!g.officialDate || !/^\d{4}-\d{2}-\d{2}$/.test(g.officialDate)) {
      rejected.push({ gamePk: g.gamePk, reason: `invalid officialDate "${g.officialDate}"` });
      continue;
    }
    if (!g.awayAbbrev || !g.homeAbbrev) {
      rejected.push({ gamePk: g.gamePk, reason: "unresolvable team abbreviation" });
      continue;
    }
    valid.push(g);
  }

  // ── 2. Idempotent de-dupe of duplicate network deliveries (same gamePk) ────
  const byPk = new Map<number, MlbProviderGame>();
  for (const g of valid) {
    if (byPk.has(g.gamePk)) {
      warnings.push(`duplicate provider delivery for gamePk=${g.gamePk} — kept one copy (idempotent)`);
    }
    byPk.set(g.gamePk, g); // last delivery wins within one payload
  }
  const slate = [...byPk.values()].sort(compareProviderGames);

  // ── 3. Doubleheader classification + gameNumber resolution ─────────────────
  const groups = classifySlate(slate);
  for (const grp of groups.values()) warnings.push(...grp.warnings);
  const resolvedNumber = (g: MlbProviderGame): number => {
    const grp = groups.get(doubleheaderGroupId(g.officialDate, g.awayAbbrev, g.homeAbbrev));
    return grp?.resolvedGameNumbers.get(g.gamePk) ?? g.gameNumber ?? 1;
  };

  // ── 4. Index DB rows: by gamePk (identity) and by matchup (legacy adoption) ─
  const mlbRows = dbRows.filter(r => r.sport === "MLB");
  const rowByPk = new Map<number, DbGameRow>();
  for (const r of mlbRows) {
    if (r.mlbGamePk == null) continue;
    const existing = rowByPk.get(r.mlbGamePk);
    if (existing) {
      warnings.push(
        `DB integrity: rows id=${existing.id} and id=${r.id} share mlbGamePk=${r.mlbGamePk} — using id=${existing.id}; deduplicate manually`
      );
      continue;
    }
    rowByPk.set(r.mlbGamePk, r);
  }
  const legacyByMatchup = new Map<string, DbGameRow[]>();
  for (const r of mlbRows) {
    if (r.mlbGamePk != null) continue;
    const key = `${r.gameDate}:${r.awayTeam}@${r.homeTeam}`;
    const arr = legacyByMatchup.get(key);
    if (arr) arr.push(r); else legacyByMatchup.set(key, [r]);
  }

  // ── 4b. Legacy adoption pairing: closest start time wins ──────────────────
  // A pre-seeded row (null mlbGamePk) must be claimed by the provider event it
  // was originally seeded for, NOT by whichever event is processed first.
  // Incident case: the pre-seeded 7:10 PM row must pair with the 7:10 PM
  // gamePk, so the 1:35 PM makeup game inserts a NEW row instead of hijacking
  // the evening game's odds/model data. Greedy assignment over globally
  // sorted (timeDistance, gamePk, rowId) pairs is deterministic and optimal
  // for the ≤2-sibling case.
  const timeToMinutes = (t: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(t.trim());
    if (!m) return null;
    let h = parseInt(m[1], 10) % 12;
    if (/pm/i.test(m[3])) h += 12;
    return h * 60 + parseInt(m[2], 10);
  };
  const adoptionByPk = new Map<number, DbGameRow>();
  {
    const pairs: Array<{ dist: number; gamePk: number; row: DbGameRow }> = [];
    for (const g of slate) {
      if (rowByPk.has(g.gamePk)) continue; // identity match takes precedence
      const legacy = legacyByMatchup.get(`${g.officialDate}:${g.awayAbbrev}@${g.homeAbbrev}`) ?? [];
      const gMin = timeToMinutes(utcToEasternTimeString(g.startUtc));
      for (const row of legacy) {
        const rMin = timeToMinutes(row.startTimeEst);
        const dist = gMin != null && rMin != null ? Math.abs(gMin - rMin) : 24 * 60;
        pairs.push({ dist, gamePk: g.gamePk, row });
      }
    }
    pairs.sort((a, b) => (a.dist - b.dist) || (a.gamePk - b.gamePk) || (a.row.id - b.row.id));
    const takenRows = new Set<number>();
    for (const p of pairs) {
      if (adoptionByPk.has(p.gamePk) || takenRows.has(p.row.id)) continue;
      adoptionByPk.set(p.gamePk, p.row);
      takenRows.add(p.row.id);
    }
  }

  // ── 5. Plan one action per distinct provider event ─────────────────────────
  const inserts: PlannedInsert[] = [];
  const updates: PlannedUpdate[] = [];
  const claimedRowIds = new Set<number>();
  /** matchup-unique-key occupancy: gameDate:away:home:gameNumber → gamePk, to pre-detect storage-key collisions */
  const storageKeyOwner = new Map<string, number>();
  for (const r of mlbRows) {
    if (r.mlbGamePk != null) {
      storageKeyOwner.set(`${r.gameDate}:${r.awayTeam}:${r.homeTeam}:${r.gameNumber ?? 1}`, r.mlbGamePk);
    }
  }

  let matchedByGamePk = 0;
  let adoptedLegacyRows = 0;
  let unchanged = 0;

  for (const g of slate) {
    const grp = groups.get(doubleheaderGroupId(g.officialDate, g.awayAbbrev, g.homeAbbrev));
    const confidence = grp?.confidence ?? "UNKNOWN";
    const gameNumber = resolvedNumber(g);
    const dhFlag = isValidFlag(g.doubleHeader)
      ? g.doubleHeader
      : (grp && grp.gamePks.length > 1 ? "S" : "N");
    const status = mapProviderStatus(g.abstractGameState, g.detailedState);
    const startTimeEst = utcToEasternTimeString(g.startUtc);

    // 5a. Identity match by gamePk — idempotent update of that row only.
    let row = rowByPk.get(g.gamePk);
    let adopts = false;

    // 5b. Legacy adoption: the closest-start-time pre-seeded row (paired in 4b).
    if (!row) {
      const candidate = adoptionByPk.get(g.gamePk);
      if (candidate && !claimedRowIds.has(candidate.id)) {
        row = candidate;
        adopts = true;
      }
    }

    if (row) {
      if (claimedRowIds.has(row.id)) {
        // Should be unreachable (rowByPk is 1:1 and legacy candidates are claim-filtered),
        // but guard anyway: NEVER let two provider events share one row.
        collisions.push({ gamePk: g.gamePk, reason: `row id=${row.id} already claimed by another provider event` });
        continue;
      }
      claimedRowIds.add(row.id);
      if (!adopts) matchedByGamePk++; else adoptedLegacyRows++;

      const set: SyncFieldUpdate = {};
      if (row.startTimeEst !== startTimeEst) set.startTimeEst = startTimeEst;
      if ((row.gameNumber ?? 1) !== gameNumber) set.gameNumber = gameNumber;
      if ((row.doubleHeader ?? "N") !== dhFlag) set.doubleHeader = dhFlag;
      if (row.mlbGamePk !== g.gamePk) set.mlbGamePk = g.gamePk;
      if (row.gameStatus !== status && !isStatusRegression(row.gameStatus, status)) {
        set.gameStatus = status;
      } else if (row.gameStatus !== status) {
        warnings.push(
          `status regression blocked for gamePk=${g.gamePk}: ${row.gameStatus} → ${status} (stale snapshot?)`
        );
      }
      if (g.venueName && (row.venue ?? null) !== g.venueName) set.venue = g.venueName;
      if (g.rescheduledFrom && (row.rescheduledFrom ?? null) !== g.rescheduledFrom) {
        set.rescheduledFrom = g.rescheduledFrom;
      }

      if (Object.keys(set).length === 0) {
        unchanged++;
      } else {
        updates.push({ rowId: row.id, gamePk: g.gamePk, adoptsLegacyRow: adopts, set, dhConfidence: confidence });
      }
      // Update storage-key occupancy to reflect the planned gameNumber.
      storageKeyOwner.set(`${g.officialDate}:${g.awayAbbrev}:${g.homeAbbrev}:${gameNumber}`, g.gamePk);
      continue;
    }

    // 5c. New event → insert. Pre-check the matchup unique key so a collision
    // surfaces as an explicit signal instead of a silent upsert-overwrite.
    const storageKey = `${g.officialDate}:${g.awayAbbrev}:${g.homeAbbrev}:${gameNumber}`;
    const owner = storageKeyOwner.get(storageKey);
    if (owner !== undefined && owner !== g.gamePk) {
      collisions.push({
        gamePk: g.gamePk,
        reason: `storage key ${storageKey} already owned by gamePk=${owner} — distinct events colliding on matchup key`,
      });
      continue;
    }
    storageKeyOwner.set(storageKey, g.gamePk);
    inserts.push({
      gamePk: g.gamePk,
      gameDate: g.officialDate,
      startTimeEst,
      awayTeam: g.awayAbbrev,
      homeTeam: g.homeAbbrev,
      gameNumber,
      doubleHeader: dhFlag,
      gameStatus: status,
      venue: g.venueName,
      rescheduledFrom: g.rescheduledFrom,
      dhConfidence: confidence,
    });
  }

  const counts = {
    provider: providerSlate.length,
    providerDistinct: slate.length,
    matchedByGamePk,
    adoptedLegacyRows,
    inserts: inserts.length,
    unchanged,
    rejected: rejected.length,
  };

  // ── 6. Cardinality self-check: every distinct event must be accounted for ──
  const accounted = matchedByGamePk + adoptedLegacyRows + inserts.length + collisions.length;
  if (accounted !== slate.length) {
    collisions.push({
      gamePk: -1,
      reason: `cardinality mismatch: ${slate.length} distinct provider events but only ${accounted} accounted for`,
    });
  }

  return { inserts, updates, rejected, warnings, collisions, counts, groups: [...groups.values()] };
}
