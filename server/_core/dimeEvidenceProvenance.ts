import { z } from "zod";

const ISO_TIMESTAMP = z.string().datetime({ offset: true });
const boundedLabel = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9][a-z0-9._:/@+-]*$/i);

const providerObservationRecordSchema = z
  .object({
    observedAt: ISO_TIMESTAMP,
    timestampSource: boundedLabel,
    providerName: boundedLabel,
    providerRevision: boundedLabel,
    confidence: z.number().min(0).max(1),
    fallbackUsed: z.boolean(),
  })
  .strict();

export type DimeProviderObservationRecord = z.infer<
  typeof providerObservationRecordSchema
>;

const providerObservationSchema = z
  .object({
    status: z.enum([
      "not_applicable",
      "unavailable",
      "available",
      "conflicting",
      "rejected",
    ]),
    observations: z.array(providerObservationRecordSchema).max(16),
    selectedObservedAt: ISO_TIMESTAMP.nullable(),
    freshnessAtRequest: z.enum([
      "current",
      "delayed",
      "stale",
      "not_applicable",
      "unavailable",
      "conflicting",
      "rejected",
    ]),
    issues: z.array(boundedLabel).max(16),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.status === "available" &&
      (value.observations.length === 0 || value.selectedObservedAt === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Available provider evidence requires a selected observation.",
      });
    }
    if (value.status !== "available" && value.selectedObservedAt !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only available evidence may select an observation timestamp.",
      });
    }
    if (
      value.status === "not_applicable" &&
      (value.observations.length > 0 ||
        value.freshnessAtRequest !== "not_applicable")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Not-applicable evidence cannot contain provider observations.",
      });
    }
  });

export type DimeProviderObservation = z.infer<typeof providerObservationSchema>;

const clockSkewClassificationSchema = z.enum([
  "source_clock_ahead",
  "pipeline_clock_skew",
  "cross_region_clock_skew",
  "unclassified_clock_skew",
]);

const ingestionLifecycleSchema = z
  .object({
    status: z.enum([
      "not_applicable",
      "unavailable",
      "available",
      "clock_skew",
      "rejected",
    ]),
    sourceObservedAt: ISO_TIMESTAMP.nullable(),
    receivedAt: ISO_TIMESTAMP.nullable(),
    normalizedAt: ISO_TIMESTAMP.nullable(),
    persistedAt: ISO_TIMESTAMP.nullable(),
    retrievedAt: ISO_TIMESTAMP.nullable(),
    responseGeneratedAt: ISO_TIMESTAMP.nullable(),
    pipelineRevision: boundedLabel.nullable(),
    ingestionRunId: boundedLabel.nullable(),
    clockSkewClassification: clockSkewClassificationSchema.nullable(),
    issues: z.array(boundedLabel).max(16),
  })
  .strict()
  .superRefine((value, context) => {
    const lifecycleFields = [
      value.sourceObservedAt,
      value.receivedAt,
      value.normalizedAt,
      value.persistedAt,
      value.retrievedAt,
      value.responseGeneratedAt,
      value.pipelineRevision,
      value.ingestionRunId,
    ];
    if (
      value.status === "available" &&
      lifecycleFields.some(field => field === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Available ingestion evidence requires the complete lifecycle.",
      });
    }
    if (
      value.status === "clock_skew" &&
      value.clockSkewClassification === null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Clock-skew evidence requires an explicit classification.",
      });
    }
    if (
      value.status === "not_applicable" &&
      lifecycleFields.some(field => field !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Not-applicable ingestion evidence must be empty.",
      });
    }
  });

export type DimeIngestionLifecycle = z.infer<typeof ingestionLifecycleSchema>;

export function dimeProviderObservationNotApplicable(): DimeProviderObservation {
  return providerObservationSchema.parse({
    status: "not_applicable",
    observations: [],
    selectedObservedAt: null,
    freshnessAtRequest: "not_applicable",
    issues: [],
  });
}

export function dimeProviderObservationUnavailable(
  issue = "authoritative_provider_timestamp_unavailable"
): DimeProviderObservation {
  return providerObservationSchema.parse({
    status: "unavailable",
    observations: [],
    selectedObservedAt: null,
    freshnessAtRequest: "unavailable",
    issues: [issue],
  });
}

export function resolveDimeProviderObservation(input: {
  requestAt: Date;
  observations: readonly DimeProviderObservationRecord[];
  currentThresholdMs: number;
  delayedThresholdMs: number;
  futureToleranceMs?: number;
}): DimeProviderObservation {
  if (
    !Number.isSafeInteger(input.currentThresholdMs) ||
    input.currentThresholdMs < 0 ||
    !Number.isSafeInteger(input.delayedThresholdMs) ||
    input.delayedThresholdMs < input.currentThresholdMs
  ) {
    throw new Error("Provider freshness thresholds are invalid.");
  }
  const observations = input.observations.map(observation =>
    providerObservationRecordSchema.parse(observation)
  );
  if (observations.length === 0) {
    return dimeProviderObservationUnavailable();
  }

  const futureToleranceMs = input.futureToleranceMs ?? 5_000;
  const impossible = observations.filter(
    observation =>
      Date.parse(observation.observedAt) >
      input.requestAt.getTime() + futureToleranceMs
  );
  if (impossible.length > 0) {
    return providerObservationSchema.parse({
      status: "rejected",
      observations,
      selectedObservedAt: null,
      freshnessAtRequest: "rejected",
      issues: ["provider_timestamp_after_request"],
    });
  }

  const distinctEvidence = new Set(
    observations.map(
      observation =>
        `${observation.providerName}|${observation.providerRevision}|${observation.observedAt}`
    )
  );
  if (distinctEvidence.size > 1) {
    return providerObservationSchema.parse({
      status: "conflicting",
      observations,
      selectedObservedAt: null,
      freshnessAtRequest: "conflicting",
      issues: ["conflicting_provider_observations_retained"],
    });
  }

  const selectedObservedAt = observations[0]!.observedAt;
  const ageMs = input.requestAt.getTime() - Date.parse(selectedObservedAt);
  const freshnessAtRequest =
    ageMs <= input.currentThresholdMs
      ? "current"
      : ageMs <= input.delayedThresholdMs
        ? "delayed"
        : "stale";
  return providerObservationSchema.parse({
    status: "available",
    observations,
    selectedObservedAt,
    freshnessAtRequest,
    issues: [],
  });
}

export function dimeIngestionLifecycleNotApplicable(): DimeIngestionLifecycle {
  return ingestionLifecycleSchema.parse({
    status: "not_applicable",
    sourceObservedAt: null,
    receivedAt: null,
    normalizedAt: null,
    persistedAt: null,
    retrievedAt: null,
    responseGeneratedAt: null,
    pipelineRevision: null,
    ingestionRunId: null,
    clockSkewClassification: null,
    issues: [],
  });
}

export function dimeIngestionLifecycleUnavailable(
  input: {
    retrievedAt?: string | null;
    responseGeneratedAt?: string | null;
    issue?: string;
  } = {}
): DimeIngestionLifecycle {
  return ingestionLifecycleSchema.parse({
    status: "unavailable",
    sourceObservedAt: null,
    receivedAt: null,
    normalizedAt: null,
    persistedAt: null,
    retrievedAt: input.retrievedAt ?? null,
    responseGeneratedAt: input.responseGeneratedAt ?? null,
    pipelineRevision: null,
    ingestionRunId: null,
    clockSkewClassification: null,
    issues: [input.issue ?? "persisted_ingestion_lifecycle_unavailable"],
  });
}

export function evaluateDimeIngestionLifecycle(input: {
  sourceObservedAt: string | null;
  receivedAt: string | null;
  normalizedAt: string | null;
  persistedAt: string | null;
  retrievedAt: string | null;
  responseGeneratedAt: string | null;
  pipelineRevision: string | null;
  ingestionRunId: string | null;
  clockSkewClassification?: z.infer<
    typeof clockSkewClassificationSchema
  > | null;
}): DimeIngestionLifecycle {
  const timestampFields = [
    "sourceObservedAt",
    "receivedAt",
    "normalizedAt",
    "persistedAt",
    "retrievedAt",
    "responseGeneratedAt",
  ] as const;
  const presentTimestamps = timestampFields.filter(field => input[field]);
  const complete =
    presentTimestamps.length === timestampFields.length &&
    input.pipelineRevision !== null &&
    input.ingestionRunId !== null;
  if (!complete) {
    return ingestionLifecycleSchema.parse({
      status: "unavailable",
      ...input,
      clockSkewClassification: input.clockSkewClassification ?? null,
      issues: ["incomplete_ingestion_lifecycle"],
    });
  }

  const orderingIssues: string[] = [];
  for (let index = 1; index < timestampFields.length; index += 1) {
    const earlierField = timestampFields[index - 1]!;
    const laterField = timestampFields[index]!;
    if (Date.parse(input[earlierField]!) > Date.parse(input[laterField]!)) {
      orderingIssues.push(`timestamp_order_violation:${earlierField}`);
    }
  }
  if (orderingIssues.length > 0) {
    const clockSkewClassification = input.clockSkewClassification ?? null;
    return ingestionLifecycleSchema.parse({
      status: clockSkewClassification ? "clock_skew" : "rejected",
      ...input,
      clockSkewClassification,
      issues: orderingIssues,
    });
  }

  return ingestionLifecycleSchema.parse({
    status: "available",
    ...input,
    clockSkewClassification: null,
    issues: [],
  });
}

export function completeDimeIngestionLifecycleForResponse(input: {
  lifecycle: DimeIngestionLifecycle;
  responseGeneratedAt: string;
}): DimeIngestionLifecycle {
  const lifecycle = validateDimeIngestionLifecycle(input.lifecycle);
  const responseGeneratedAt = ISO_TIMESTAMP.parse(input.responseGeneratedAt);
  if (lifecycle.status === "not_applicable") {
    return lifecycle;
  }
  return evaluateDimeIngestionLifecycle({
    sourceObservedAt: lifecycle.sourceObservedAt,
    receivedAt: lifecycle.receivedAt,
    normalizedAt: lifecycle.normalizedAt,
    persistedAt: lifecycle.persistedAt,
    retrievedAt: lifecycle.retrievedAt,
    responseGeneratedAt,
    pipelineRevision: lifecycle.pipelineRevision,
    ingestionRunId: lifecycle.ingestionRunId,
    clockSkewClassification: lifecycle.clockSkewClassification,
  });
}

export function validateDimeProviderObservation(
  value: unknown
): DimeProviderObservation {
  return providerObservationSchema.parse(value);
}

export function validateDimeIngestionLifecycle(
  value: unknown
): DimeIngestionLifecycle {
  return ingestionLifecycleSchema.parse(value);
}
