import { z } from "zod";
import {
  DIME_PRODUCT_ROUTES,
  type DimeProductRoute,
} from "./dimeEngineeringControl";

export const DIME_SANITIZED_TRAFFIC_RECORD_VERSION =
  "dime-sanitized-traffic-record-v1" as const;
export const DIME_TRAFFIC_DISTRIBUTION_VERSION =
  "dime-traffic-distribution-v1" as const;

const ISO_TIMESTAMP = z.string().datetime({ offset: true });
const SHA256 = z.string().regex(/^[0-9a-f]{64}$/);
const boundedDimension = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._+-]*$/i);
const productRouteSchema = z.enum([
  "platform",
  "matchup",
  "full_slate",
  "educational",
  "bet_explanation",
  "historical",
  "account",
  "live_data",
  "general_sports",
]);

const sanitizedTrafficRecordSchema = z
  .object({
    schemaVersion: z.literal(DIME_SANITIZED_TRAFFIC_RECORD_VERSION),
    requestIdSha256: SHA256,
    occurredAt: ISO_TIMESTAMP,
    route: productRouteSchema,
    sport: boundedDimension.nullable(),
    league: boundedDimension.nullable(),
    messageLengthBucket: z.enum([
      "0-49",
      "50-199",
      "200-499",
      "500-999",
      "1000+",
    ]),
    multiTurnBucket: z.enum(["single", "2-3", "4-8", "9+"]),
    toolRequired: z.boolean(),
    temporalClass: z.enum([
      "live",
      "current",
      "historical",
      "ambiguous",
      "not_applicable",
    ]),
    entityResolution: z.enum([
      "exact",
      "nearby",
      "ambiguous",
      "missing",
      "not_applicable",
    ]),
    missingInformation: z.boolean(),
    accessClass: z.enum(["public", "subscriber"]),
    platformSupport: z.boolean(),
    routingConfidence: z.number().min(0).max(1),
    toolCallCount: z.number().int().min(0).max(32),
    toolSucceeded: z.boolean().nullable(),
    staleEvidence: z.boolean().nullable(),
    inputTokens: z.number().int().min(0).nullable(),
    outputTokens: z.number().int().min(0).nullable(),
    contextRecords: z.number().int().min(0).nullable(),
    contextTokens: z.number().int().min(0).nullable(),
    timeToFirstTokenMs: z.number().int().min(0).nullable(),
    endToEndMs: z.number().int().min(0).nullable(),
    estimatedCostUsd: z.number().min(0).nullable(),
    completenessPassed: z.boolean().nullable(),
  })
  .strict()
  .superRefine((record, context) => {
    if (!record.toolRequired && record.toolCallCount > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A tool-not-required record cannot report tool calls.",
      });
    }
    if (record.toolCallCount === 0 && record.toolSucceeded !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Tool success is not applicable without a tool call.",
      });
    }
  });

export type DimeSanitizedTrafficRecord = z.infer<
  typeof sanitizedTrafficRecordSchema
>;

export interface DimeDistributionWithMissing {
  p50: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
  maximum: number | null;
  sampleCount: number;
  missingCount: number;
}

function distribution(
  values: readonly (number | null)[]
): DimeDistributionWithMissing {
  const sorted = values
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
  const percentile = (value: number): number | null => {
    if (sorted.length === 0) return null;
    const index = Math.max(0, Math.ceil((value / 100) * sorted.length) - 1);
    return sorted[index]!;
  };
  return {
    p50: percentile(50),
    p90: percentile(90),
    p95: percentile(95),
    p99: percentile(99),
    maximum: sorted.at(-1) ?? null,
    sampleCount: sorted.length,
    missingCount: values.length - sorted.length,
  };
}

function nullableRate(values: readonly (boolean | null)[]): {
  rate: number | null;
  sampleCount: number;
  missingCount: number;
} {
  const present = values.filter((value): value is boolean => value !== null);
  return {
    rate:
      present.length === 0
        ? null
        : present.filter(Boolean).length / present.length,
    sampleCount: present.length,
    missingCount: values.length - present.length,
  };
}

function dimensionCounts(
  records: readonly DimeSanitizedTrafficRecord[],
  select: (record: DimeSanitizedTrafficRecord) => string | null
): Record<string, number> {
  const counts = new Map<string, number>();
  for (const record of records) {
    const value = select(record) ?? "unavailable";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.fromEntries(
    Array.from(counts.entries()).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  );
}

export function validateDimeSanitizedTrafficRecord(
  value: unknown
): DimeSanitizedTrafficRecord {
  return sanitizedTrafficRecordSchema.parse(value);
}

export function aggregateDimeSanitizedTraffic(values: readonly unknown[]): {
  schemaVersion: typeof DIME_TRAFFIC_DISTRIBUTION_VERSION;
  dataClassification: "sanitized_trace_aggregate";
  containsPromptOrResponseText: false;
  sampleCount: number;
  dimensions: Record<string, Record<string, number>>;
  perRoute: Record<
    DimeProductRoute,
    {
      sampleCount: number;
      routingConfidence: DimeDistributionWithMissing;
      ambiguity: ReturnType<typeof nullableRate>;
      missingInformation: ReturnType<typeof nullableRate>;
      toolRequired: ReturnType<typeof nullableRate>;
      toolSucceeded: ReturnType<typeof nullableRate>;
      staleEvidence: ReturnType<typeof nullableRate>;
      completenessPassed: ReturnType<typeof nullableRate>;
      inputTokens: DimeDistributionWithMissing;
      outputTokens: DimeDistributionWithMissing;
      contextRecords: DimeDistributionWithMissing;
      contextTokens: DimeDistributionWithMissing;
      timeToFirstTokenMs: DimeDistributionWithMissing;
      endToEndMs: DimeDistributionWithMissing;
      estimatedCostUsd: DimeDistributionWithMissing;
    }
  >;
} {
  const records = values.map(validateDimeSanitizedTrafficRecord);
  return {
    schemaVersion: DIME_TRAFFIC_DISTRIBUTION_VERSION,
    dataClassification: "sanitized_trace_aggregate",
    containsPromptOrResponseText: false,
    sampleCount: records.length,
    dimensions: {
      route: dimensionCounts(records, record => record.route),
      sport: dimensionCounts(records, record => record.sport),
      league: dimensionCounts(records, record => record.league),
      messageLengthBucket: dimensionCounts(
        records,
        record => record.messageLengthBucket
      ),
      multiTurnBucket: dimensionCounts(
        records,
        record => record.multiTurnBucket
      ),
      toolRequired: dimensionCounts(records, record =>
        String(record.toolRequired)
      ),
      temporalClass: dimensionCounts(records, record => record.temporalClass),
      entityResolution: dimensionCounts(
        records,
        record => record.entityResolution
      ),
      missingInformation: dimensionCounts(records, record =>
        String(record.missingInformation)
      ),
      accessClass: dimensionCounts(records, record => record.accessClass),
      platformSupport: dimensionCounts(records, record =>
        String(record.platformSupport)
      ),
    },
    perRoute: Object.fromEntries(
      DIME_PRODUCT_ROUTES.map(route => {
        const routeRecords = records.filter(record => record.route === route);
        return [
          route,
          {
            sampleCount: routeRecords.length,
            routingConfidence: distribution(
              routeRecords.map(record => record.routingConfidence)
            ),
            ambiguity: nullableRate(
              routeRecords.map(
                record => record.entityResolution === "ambiguous"
              )
            ),
            missingInformation: nullableRate(
              routeRecords.map(record => record.missingInformation)
            ),
            toolRequired: nullableRate(
              routeRecords.map(record => record.toolRequired)
            ),
            toolSucceeded: nullableRate(
              routeRecords.map(record => record.toolSucceeded)
            ),
            staleEvidence: nullableRate(
              routeRecords.map(record => record.staleEvidence)
            ),
            completenessPassed: nullableRate(
              routeRecords.map(record => record.completenessPassed)
            ),
            inputTokens: distribution(
              routeRecords.map(record => record.inputTokens)
            ),
            outputTokens: distribution(
              routeRecords.map(record => record.outputTokens)
            ),
            contextRecords: distribution(
              routeRecords.map(record => record.contextRecords)
            ),
            contextTokens: distribution(
              routeRecords.map(record => record.contextTokens)
            ),
            timeToFirstTokenMs: distribution(
              routeRecords.map(record => record.timeToFirstTokenMs)
            ),
            endToEndMs: distribution(
              routeRecords.map(record => record.endToEndMs)
            ),
            estimatedCostUsd: distribution(
              routeRecords.map(record => record.estimatedCostUsd)
            ),
          },
        ];
      })
    ) as Record<
      DimeProductRoute,
      {
        sampleCount: number;
        routingConfidence: DimeDistributionWithMissing;
        ambiguity: ReturnType<typeof nullableRate>;
        missingInformation: ReturnType<typeof nullableRate>;
        toolRequired: ReturnType<typeof nullableRate>;
        toolSucceeded: ReturnType<typeof nullableRate>;
        staleEvidence: ReturnType<typeof nullableRate>;
        completenessPassed: ReturnType<typeof nullableRate>;
        inputTokens: DimeDistributionWithMissing;
        outputTokens: DimeDistributionWithMissing;
        contextRecords: DimeDistributionWithMissing;
        contextTokens: DimeDistributionWithMissing;
        timeToFirstTokenMs: DimeDistributionWithMissing;
        endToEndMs: DimeDistributionWithMissing;
        estimatedCostUsd: DimeDistributionWithMissing;
      }
    >,
  };
}
