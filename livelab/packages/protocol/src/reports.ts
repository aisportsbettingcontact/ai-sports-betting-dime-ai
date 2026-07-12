import { z } from 'zod';
import { ArtifactMetadataSchema } from './artifacts';

export const SmokeCheckResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['pass', 'warn', 'fail', 'skipped']),
  detail: z.string().optional(),
  evidence: z.array(z.string()).default([]),
});
export type SmokeCheckResult = z.infer<typeof SmokeCheckResultSchema>;

export const SmokeRouteResultSchema = z.object({
  route: z.string(),
  url: z.string(),
  sessionId: z.string(),
  device: z.string(),
  engine: z.string(),
  status: z.enum(['pass', 'warn', 'fail']),
  checks: z.array(SmokeCheckResultSchema),
  screenshot: z.string().optional(),
  durationMs: z.number(),
});
export type SmokeRouteResult = z.infer<typeof SmokeRouteResultSchema>;

export const SmokeReportSchema = z.object({
  reportId: z.string(),
  kind: z.literal('smoke'),
  startedAt: z.number(),
  completedAt: z.number(),
  status: z.enum(['pass', 'warn', 'fail']),
  results: z.array(SmokeRouteResultSchema),
  artifacts: z.array(ArtifactMetadataSchema).default([]),
});
export type SmokeReport = z.infer<typeof SmokeReportSchema>;

export const VisualCompareResultSchema = z.object({
  route: z.string(),
  device: z.string(),
  engine: z.string(),
  status: z.enum(['pass', 'fail', 'baseline-missing', 'baseline-invalidated']),
  diffPixels: z.number().int().optional(),
  totalPixels: z.number().int().optional(),
  diffRatio: z.number().optional(),
  threshold: z.number().optional(),
  maxDiffPixelRatio: z.number().optional(),
  baselinePath: z.string().optional(),
  actualPath: z.string().optional(),
  diffPath: z.string().optional(),
  reason: z.string().optional(),
});
export type VisualCompareResult = z.infer<typeof VisualCompareResultSchema>;

export const AccessibilityFindingSchema = z.object({
  rule: z.string(),
  impact: z.enum(['minor', 'moderate', 'serious', 'critical']).optional(),
  locator: z.string(),
  explanation: z.string(),
  evidence: z.string().optional(),
  suggestion: z.string().optional(),
});
export type AccessibilityFinding = z.infer<typeof AccessibilityFindingSchema>;

export const SourceLocationSchema = z.object({
  file: z.string(),
  line: z.number().int().optional(),
  column: z.number().int().optional(),
  fromStack: z.boolean().default(true),
});
export type SourceLocation = z.infer<typeof SourceLocationSchema>;

export const ChangeReportSessionSchema = z.object({
  sessionId: z.string(),
  device: z.string(),
  engine: z.string(),
  url: z.string().optional(),
  status: z.enum(['pass', 'warn', 'fail']),
  newConsoleErrors: z.array(z.string()).default([]),
  newConsoleWarnings: z.array(z.string()).default([]),
  resolvedErrors: z.array(z.string()).default([]),
  newPageErrors: z.array(z.string()).default([]),
  networkFailures: z.array(z.string()).default([]),
  screenshot: z.string().optional(),
  fullPageScreenshot: z.string().optional(),
  domSummaryPath: z.string().optional(),
  accessibilityFindings: z.array(AccessibilityFindingSchema).default([]),
  visual: VisualCompareResultSchema.optional(),
  failedAssertions: z.array(SmokeCheckResultSchema).default([]),
  suggestedSources: z.array(SourceLocationSchema).default([]),
  /** Event cursor for fetching full details via delta queries. */
  eventCursor: z.number().int(),
});
export type ChangeReportSession = z.infer<typeof ChangeReportSessionSchema>;

export const ChangeReportSchema = z.object({
  reportId: z.string(),
  kind: z.literal('change'),
  startedAt: z.number(),
  completedAt: z.number(),
  changedFiles: z.array(z.string()),
  url: z.string().optional(),
  commit: z.string().optional(),
  status: z.enum(['pass', 'warn', 'fail']),
  settle: z.object({
    settled: z.boolean(),
    waitedMs: z.number(),
    timedOut: z.boolean(),
    unresolvedActivity: z.array(z.string()).default([]),
  }),
  sessions: z.array(ChangeReportSessionSchema),
});
export type ChangeReport = z.infer<typeof ChangeReportSchema>;

export const ReportSchema = z.discriminatedUnion('kind', [SmokeReportSchema, ChangeReportSchema]);
export type Report = z.infer<typeof ReportSchema>;
