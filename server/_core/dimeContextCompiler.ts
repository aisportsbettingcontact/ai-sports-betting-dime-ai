import type { DimeProductRoute } from "./dimeEngineeringControl";

export const DIME_CONTEXT_COMPILER_VERSION =
  "dime-route-aware-context-compiler-v1" as const;

export const DIME_CONTEXT_TOKEN_MEASUREMENT_STATUS =
  "STRUCTURAL_ESTIMATE_NOT_MODEL_EXACT" as const;

export type DimeContextFreshnessState =
  "static" | "current" | "stale" | "missing" | "conflicting" | "unknown";

export type DimeContextFactClass =
  | "event_identity"
  | "mandatory_constraint"
  | "authoritative_current"
  | "negative_or_missing"
  | "contradiction"
  | "required_tool_output"
  | "optional_evidence"
  | "platform_catalog"
  | "account";

export interface DimeContextItem {
  factId: string;
  claim: string;
  sourceId: string;
  sourceAuthority: string;
  sourceObservedAt: string | null;
  retrievedAt: string;
  freshnessState: DimeContextFreshnessState;
  required: boolean;
  contradicts: readonly string[];
  tokenCost: number;
  decisionValue: number;
  factClass: DimeContextFactClass;
  dynamic: boolean;
}

export interface DimeContextEventIdentity {
  exactEventId: string | null;
  candidateEventIds: readonly string[];
}

export interface DimeContextTemporalFrame {
  cutoffAt: string | null;
}

export interface DimeContextCompilerInput {
  route: DimeProductRoute;
  userIntent: string;
  generatedAt: string;
  eventIdentity: DimeContextEventIdentity;
  temporalFrame: DimeContextTemporalFrame;
  dynamicRetrievalExplicit: boolean;
  items: readonly DimeContextItem[];
  tokenBudget?: number;
}

export interface DimeContextCompilerMetrics {
  inputItemCount: number;
  outputItemCount: number;
  inputTokenCost: number;
  outputTokenCost: number;
  duplicateInputCount: number;
  duplicateContextRate: number;
  irrelevantInputCount: number;
  irrelevantContextRate: number;
  requiredFactCount: number;
  requiredFactsIncluded: number;
  criticalFactRecall: number;
  routePolicyViolations: number;
  silentContextTruncations: number;
}

export interface DimeCompiledContextPacket {
  schemaVersion: typeof DIME_CONTEXT_COMPILER_VERSION;
  tokenMeasurementStatus: typeof DIME_CONTEXT_TOKEN_MEASUREMENT_STATUS;
  route: DimeProductRoute;
  generatedAt: string;
  userIntent: string;
  eventIdentity: DimeContextEventIdentity;
  temporalFrame: DimeContextTemporalFrame;
  tokenBudget: number;
  items: DimeContextItem[];
  omittedOptionalFactIds: string[];
  metrics: DimeContextCompilerMetrics;
  contextText: string;
}

export class DimeContextCompilerError extends Error {
  readonly issues: string[];

  constructor(issues: readonly string[]) {
    super(`Dime context compilation rejected: ${issues.join("; ")}`);
    this.name = "DimeContextCompilerError";
    this.issues = [...issues];
  }
}

export interface DimeContextRoutePolicy {
  maxTokens: number;
  gameRetrieval: "allowed" | "prohibited";
  dynamicRetrieval: "allowed" | "explicit_only" | "prohibited";
  exactEventMaximum: number | null;
  candidateEventMaximum: number | null;
  pointInTimeCutoffRequired: boolean;
  authoritativeObservationTimestampRequired: boolean;
}

export const DIME_CONTEXT_ROUTE_POLICIES: Readonly<
  Record<DimeProductRoute, DimeContextRoutePolicy>
> = {
  platform: {
    maxTokens: 1_000,
    gameRetrieval: "prohibited",
    dynamicRetrieval: "prohibited",
    exactEventMaximum: 0,
    candidateEventMaximum: 0,
    pointInTimeCutoffRequired: false,
    authoritativeObservationTimestampRequired: false,
  },
  account: {
    maxTokens: 800,
    gameRetrieval: "prohibited",
    dynamicRetrieval: "prohibited",
    exactEventMaximum: 0,
    candidateEventMaximum: 0,
    pointInTimeCutoffRequired: false,
    authoritativeObservationTimestampRequired: false,
  },
  educational: {
    maxTokens: 1_000,
    gameRetrieval: "allowed",
    dynamicRetrieval: "explicit_only",
    exactEventMaximum: 1,
    candidateEventMaximum: 2,
    pointInTimeCutoffRequired: false,
    authoritativeObservationTimestampRequired: false,
  },
  bet_explanation: {
    maxTokens: 1_200,
    gameRetrieval: "allowed",
    dynamicRetrieval: "explicit_only",
    exactEventMaximum: 1,
    candidateEventMaximum: 2,
    pointInTimeCutoffRequired: false,
    authoritativeObservationTimestampRequired: false,
  },
  matchup: {
    maxTokens: 2_200,
    gameRetrieval: "allowed",
    dynamicRetrieval: "allowed",
    exactEventMaximum: 1,
    candidateEventMaximum: 2,
    pointInTimeCutoffRequired: false,
    authoritativeObservationTimestampRequired: false,
  },
  full_slate: {
    maxTokens: 3_200,
    gameRetrieval: "allowed",
    dynamicRetrieval: "allowed",
    exactEventMaximum: null,
    candidateEventMaximum: 12,
    pointInTimeCutoffRequired: false,
    authoritativeObservationTimestampRequired: false,
  },
  historical: {
    maxTokens: 2_400,
    gameRetrieval: "allowed",
    dynamicRetrieval: "allowed",
    exactEventMaximum: 1,
    candidateEventMaximum: 2,
    pointInTimeCutoffRequired: true,
    authoritativeObservationTimestampRequired: false,
  },
  live_data: {
    maxTokens: 1_800,
    gameRetrieval: "allowed",
    dynamicRetrieval: "allowed",
    exactEventMaximum: 1,
    candidateEventMaximum: 2,
    pointInTimeCutoffRequired: false,
    authoritativeObservationTimestampRequired: true,
  },
  general_sports: {
    maxTokens: 1_200,
    gameRetrieval: "allowed",
    dynamicRetrieval: "explicit_only",
    exactEventMaximum: 1,
    candidateEventMaximum: 2,
    pointInTimeCutoffRequired: false,
    authoritativeObservationTimestampRequired: false,
  },
};

const FACT_CLASS_ORDER: Readonly<Record<DimeContextFactClass, number>> = {
  event_identity: 0,
  mandatory_constraint: 1,
  authoritative_current: 2,
  negative_or_missing: 3,
  contradiction: 4,
  required_tool_output: 5,
  platform_catalog: 6,
  account: 6,
  optional_evidence: 7,
};

const GAME_FACT_CLASSES = new Set<DimeContextFactClass>([
  "event_identity",
  "authoritative_current",
  "negative_or_missing",
  "contradiction",
  "required_tool_output",
  "optional_evidence",
]);

const STABLE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

function normalizedClaim(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function isCanonicalUtc(value: string | null): boolean {
  if (value === null) return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

function validateItem(item: DimeContextItem): string[] {
  const issues: string[] = [];
  if (!STABLE_ID.test(item.factId)) {
    issues.push(`invalid fact_id ${item.factId || "<empty>"}`);
  }
  if (!item.claim.trim() || item.claim.length > 8_000) {
    issues.push(`${item.factId}: claim must contain 1 to 8000 characters`);
  }
  if (CONTROL_CHARACTER.test(item.claim)) {
    issues.push(`${item.factId}: claim contains a control character`);
  }
  if (!STABLE_ID.test(item.sourceId)) {
    issues.push(`${item.factId}: source_id is not a stable identifier`);
  }
  if (
    !item.sourceAuthority.trim() ||
    item.sourceAuthority.length > 256 ||
    CONTROL_CHARACTER.test(item.sourceAuthority)
  ) {
    issues.push(
      `${item.factId}: source_authority must contain 1 to 256 safe characters`
    );
  }
  if (!isCanonicalUtc(item.retrievedAt)) {
    issues.push(`${item.factId}: retrieved_at is not canonical UTC`);
  }
  if (
    item.sourceObservedAt !== null &&
    !isCanonicalUtc(item.sourceObservedAt)
  ) {
    issues.push(`${item.factId}: source_observed_at is not canonical UTC`);
  }
  if (item.dynamic && !isCanonicalUtc(item.sourceObservedAt)) {
    issues.push(
      `${item.factId}: dynamic facts require a provider-observation timestamp`
    );
  }
  if (
    !Number.isInteger(item.tokenCost) ||
    item.tokenCost <= 0 ||
    item.tokenCost > 100_000
  ) {
    issues.push(
      `${item.factId}: token_cost must be a bounded positive integer`
    );
  }
  if (
    !Number.isFinite(item.decisionValue) ||
    item.decisionValue < 0 ||
    item.decisionValue > 1
  ) {
    issues.push(`${item.factId}: decision_value must be between 0 and 1`);
  }
  if (item.contradicts.includes(item.factId)) {
    issues.push(`${item.factId}: cannot contradict itself`);
  }
  if (item.required && item.decisionValue === 0) {
    issues.push(
      `${item.factId}: a required fact cannot have zero decision value`
    );
  }
  return issues;
}

function routePolicyIssues(
  input: DimeContextCompilerInput,
  items: readonly DimeContextItem[]
): string[] {
  const policy = DIME_CONTEXT_ROUTE_POLICIES[input.route];
  const issues: string[] = [];
  const exactEventCount = input.eventIdentity.exactEventId ? 1 : 0;
  const candidateCount = new Set(input.eventIdentity.candidateEventIds).size;

  if (
    policy.exactEventMaximum !== null &&
    exactEventCount > policy.exactEventMaximum
  ) {
    issues.push(`${input.route}: exact-event maximum exceeded`);
  }
  if (
    policy.candidateEventMaximum !== null &&
    candidateCount > policy.candidateEventMaximum
  ) {
    issues.push(`${input.route}: candidate-event maximum exceeded`);
  }
  if (
    candidateCount !== input.eventIdentity.candidateEventIds.length ||
    (input.eventIdentity.exactEventId !== null &&
      input.eventIdentity.candidateEventIds.includes(
        input.eventIdentity.exactEventId
      ))
  ) {
    issues.push(`${input.route}: event identity contains duplicates`);
  }
  if (
    policy.gameRetrieval === "prohibited" &&
    (exactEventCount > 0 ||
      candidateCount > 0 ||
      items.some(item => GAME_FACT_CLASSES.has(item.factClass)))
  ) {
    issues.push(`${input.route}: game retrieval is prohibited`);
  }
  const dynamicItems = items.filter(item => item.dynamic);
  if (policy.dynamicRetrieval === "prohibited" && dynamicItems.length > 0) {
    issues.push(`${input.route}: dynamic retrieval is prohibited`);
  }
  if (
    policy.dynamicRetrieval === "explicit_only" &&
    dynamicItems.length > 0 &&
    !input.dynamicRetrievalExplicit
  ) {
    issues.push(
      `${input.route}: dynamic retrieval was not explicitly requested`
    );
  }
  if (
    policy.pointInTimeCutoffRequired &&
    !isCanonicalUtc(input.temporalFrame.cutoffAt)
  ) {
    issues.push(`${input.route}: point-in-time cutoff is required`);
  }
  if (
    policy.authoritativeObservationTimestampRequired &&
    dynamicItems.some(item => !isCanonicalUtc(item.sourceObservedAt))
  ) {
    issues.push(
      `${input.route}: authoritative observation timestamp is required`
    );
  }
  return issues;
}

function compareItems(left: DimeContextItem, right: DimeContextItem): number {
  const classOrder =
    FACT_CLASS_ORDER[left.factClass] - FACT_CLASS_ORDER[right.factClass];
  if (classOrder !== 0) return classOrder;
  if (left.required !== right.required) return left.required ? -1 : 1;
  const leftValuePerToken = left.decisionValue / left.tokenCost;
  const rightValuePerToken = right.decisionValue / right.tokenCost;
  if (leftValuePerToken !== rightValuePerToken) {
    return rightValuePerToken - leftValuePerToken;
  }
  if (left.decisionValue !== right.decisionValue) {
    return right.decisionValue - left.decisionValue;
  }
  return left.factId.localeCompare(right.factId);
}

function chooseDuplicate(
  current: DimeContextItem,
  candidate: DimeContextItem
): DimeContextItem {
  if (current.required !== candidate.required) {
    return candidate.required ? candidate : current;
  }
  return compareItems(current, candidate) <= 0 ? current : candidate;
}

function renderContext(input: {
  route: DimeProductRoute;
  generatedAt: string;
  userIntent: string;
  eventIdentity: DimeContextEventIdentity;
  temporalFrame: DimeContextTemporalFrame;
  items: readonly DimeContextItem[];
  omitted: readonly string[];
}): string {
  const lines = [
    `DIME_CONTEXT_PACKET version=${DIME_CONTEXT_COMPILER_VERSION}`,
    `route=${input.route} generated_at=${input.generatedAt}`,
    `user_intent=${input.userIntent.trim()}`,
    `exact_event_id=${input.eventIdentity.exactEventId ?? "none"} candidate_event_ids=${input.eventIdentity.candidateEventIds.join(",") || "none"}`,
    `point_in_time_cutoff=${input.temporalFrame.cutoffAt ?? "none"}`,
  ];
  for (const item of input.items) {
    lines.push(
      [
        `fact_id=${item.factId}`,
        `class=${item.factClass}`,
        `required=${item.required}`,
        `freshness=${item.freshnessState}`,
        `source_id=${item.sourceId}`,
        `source_authority=${item.sourceAuthority}`,
        `source_observed_at=${item.sourceObservedAt ?? "not_applicable"}`,
        `retrieved_at=${item.retrievedAt}`,
        `contradicts=${item.contradicts.join(",") || "none"}`,
        `claim=${item.claim.trim()}`,
      ].join(" | ")
    );
  }
  lines.push(`omitted_optional_fact_ids=${input.omitted.join(",") || "none"}`);
  return lines.join("\n");
}

export function compileDimeContext(
  input: DimeContextCompilerInput
): DimeCompiledContextPacket {
  const issues: string[] = [];
  if (
    !input.userIntent.trim() ||
    input.userIntent.length > 4_000 ||
    CONTROL_CHARACTER.test(input.userIntent)
  ) {
    issues.push("user_intent must contain 1 to 4000 safe characters");
  }
  if (!isCanonicalUtc(input.generatedAt)) {
    issues.push("generated_at is not canonical UTC");
  }
  if (
    input.temporalFrame.cutoffAt !== null &&
    !isCanonicalUtc(input.temporalFrame.cutoffAt)
  ) {
    issues.push("point_in_time_cutoff is not canonical UTC");
  }
  if (
    input.eventIdentity.exactEventId !== null &&
    !STABLE_ID.test(input.eventIdentity.exactEventId)
  ) {
    issues.push("exact_event_id is not a stable identifier");
  }
  for (const candidateId of input.eventIdentity.candidateEventIds) {
    if (!STABLE_ID.test(candidateId)) {
      issues.push(`candidate_event_id ${candidateId || "<empty>"} is invalid`);
    }
  }
  const policy = DIME_CONTEXT_ROUTE_POLICIES[input.route];
  if (!policy) {
    throw new DimeContextCompilerError([
      `unsupported route ${String(input.route)}`,
    ]);
  }
  const tokenBudget = input.tokenBudget ?? policy.maxTokens;
  if (
    !Number.isInteger(tokenBudget) ||
    tokenBudget <= 0 ||
    tokenBudget > policy.maxTokens
  ) {
    issues.push(
      `${input.route}: token budget exceeds the approved route budget`
    );
  }

  const factIds = new Set<string>();
  for (const item of input.items) {
    issues.push(...validateItem(item));
    if (
      isCanonicalUtc(input.generatedAt) &&
      isCanonicalUtc(item.retrievedAt) &&
      Date.parse(item.retrievedAt) > Date.parse(input.generatedAt)
    ) {
      issues.push(`${item.factId}: retrieved_at is later than generated_at`);
    }
    if (
      isCanonicalUtc(item.sourceObservedAt) &&
      isCanonicalUtc(item.retrievedAt) &&
      Date.parse(item.sourceObservedAt as string) > Date.parse(item.retrievedAt)
    ) {
      issues.push(
        `${item.factId}: source_observed_at is later than retrieved_at`
      );
    }
    if (factIds.has(item.factId)) {
      issues.push(`duplicate fact_id ${item.factId}`);
    }
    factIds.add(item.factId);
  }
  for (const item of input.items) {
    for (const contradictedId of item.contradicts) {
      if (!factIds.has(contradictedId)) {
        issues.push(
          `${item.factId}: contradicted fact ${contradictedId} is not present`
        );
      }
    }
  }
  const contradictionParticipantIds = new Set<string>();
  for (const item of input.items) {
    if (item.contradicts.length > 0) {
      contradictionParticipantIds.add(item.factId);
      for (const contradictedId of item.contradicts) {
        contradictionParticipantIds.add(contradictedId);
      }
    }
  }
  for (const item of input.items) {
    if (
      contradictionParticipantIds.has(item.factId) &&
      (!item.required || item.factClass !== "contradiction")
    ) {
      issues.push(
        `${item.factId}: contradiction participants must be required contradiction facts`
      );
    }
  }
  issues.push(...routePolicyIssues(input, input.items));
  if (issues.length > 0) throw new DimeContextCompilerError(issues);

  const byClaim = new Map<string, DimeContextItem>();
  const duplicateGroups = new Map<string, DimeContextItem[]>();
  for (const item of input.items) {
    const key = normalizedClaim(item.claim);
    const existing = byClaim.get(key);
    byClaim.set(key, existing ? chooseDuplicate(existing, item) : item);
    duplicateGroups.set(key, [...(duplicateGroups.get(key) ?? []), item]);
  }
  const deduplicated = Array.from(byClaim.values());
  const duplicateInputCount = input.items.length - deduplicated.length;
  const retainedFactIds = new Set(deduplicated.map(item => item.factId));
  const removedFactIds = new Set(
    input.items
      .filter(item => !retainedFactIds.has(item.factId))
      .map(item => item.factId)
  );
  const duplicateContextRate =
    input.items.length === 0 ? 0 : duplicateInputCount / input.items.length;
  const irrelevantInputCount = input.items.filter(
    item => item.decisionValue === 0
  ).length;
  const irrelevantContextRate =
    input.items.length === 0 ? 0 : irrelevantInputCount / input.items.length;
  const qualityIssues: string[] = [];
  if (
    Array.from(duplicateGroups.values()).some(
      group =>
        group.length > 1 &&
        (group.some(item => item.required || item.contradicts.length > 0) ||
          input.items.some(item =>
            item.contradicts.some(factId =>
              group.some(groupItem => groupItem.factId === factId)
            )
          ))
    ) ||
    input.items.some(item =>
      item.contradicts.some(factId => removedFactIds.has(factId))
    )
  ) {
    qualityIssues.push(
      "deduplication would discard required or contradictory provenance"
    );
  }
  if (duplicateContextRate > 0.02) {
    qualityIssues.push("duplicate context rate exceeds 0.02");
  }
  if (irrelevantContextRate > 0.05) {
    qualityIssues.push("irrelevant context rate exceeds 0.05");
  }
  if (qualityIssues.length > 0) {
    throw new DimeContextCompilerError(qualityIssues);
  }

  const sorted = deduplicated.sort(compareItems);
  const required = sorted.filter(item => item.required);
  const optional = sorted.filter(
    item => !item.required && item.decisionValue > 0
  );
  const requiredTokenCost = required.reduce(
    (total, item) => total + item.tokenCost,
    0
  );
  if (requiredTokenCost > tokenBudget) {
    throw new DimeContextCompilerError([
      `required facts cost ${requiredTokenCost} tokens but budget is ${tokenBudget}`,
    ]);
  }

  const selected = [...required];
  const omitted: string[] = [];
  let outputTokenCost = requiredTokenCost;
  for (const item of optional) {
    if (outputTokenCost + item.tokenCost <= tokenBudget) {
      selected.push(item);
      outputTokenCost += item.tokenCost;
    } else {
      omitted.push(item.factId);
    }
  }
  const requiredFactsIncluded = selected.filter(item => item.required).length;
  const criticalFactRecall =
    required.length === 0 ? 1 : requiredFactsIncluded / required.length;
  if (criticalFactRecall !== 1) {
    throw new DimeContextCompilerError(["critical fact recall is below 1.0"]);
  }

  const ordered = selected.sort(compareItems).map(item => ({
    ...item,
    contradicts: [...item.contradicts].sort(),
  }));
  const packet: DimeCompiledContextPacket = {
    schemaVersion: DIME_CONTEXT_COMPILER_VERSION,
    tokenMeasurementStatus: DIME_CONTEXT_TOKEN_MEASUREMENT_STATUS,
    route: input.route,
    generatedAt: input.generatedAt,
    userIntent: input.userIntent.trim(),
    eventIdentity: {
      exactEventId: input.eventIdentity.exactEventId,
      candidateEventIds: [...input.eventIdentity.candidateEventIds],
    },
    temporalFrame: { cutoffAt: input.temporalFrame.cutoffAt },
    tokenBudget,
    items: ordered,
    omittedOptionalFactIds: omitted.sort(),
    metrics: {
      inputItemCount: input.items.length,
      outputItemCount: ordered.length,
      inputTokenCost: input.items.reduce(
        (total, item) => total + item.tokenCost,
        0
      ),
      outputTokenCost,
      duplicateInputCount,
      duplicateContextRate,
      irrelevantInputCount,
      irrelevantContextRate,
      requiredFactCount: required.length,
      requiredFactsIncluded,
      criticalFactRecall,
      routePolicyViolations: 0,
      silentContextTruncations: 0,
    },
    contextText: "",
  };
  packet.contextText = renderContext({
    route: packet.route,
    generatedAt: packet.generatedAt,
    userIntent: packet.userIntent,
    eventIdentity: packet.eventIdentity,
    temporalFrame: packet.temporalFrame,
    items: packet.items,
    omitted: packet.omittedOptionalFactIds,
  });
  return packet;
}
