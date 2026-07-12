import { z } from 'zod';

export const WatchStartRequestSchema = z.object({
  include: z.array(z.string().max(300)).optional(),
  exclude: z.array(z.string().max(300)).optional(),
  quietWindowMs: z.number().int().min(50).max(10_000).optional(),
  maxSettleMs: z.number().int().min(500).max(60_000).optional(),
  fullPageScreenshot: z.boolean().optional(),
  visualCompare: z.boolean().optional(),
});

export const WatchStatusSchema = z.object({
  active: z.boolean(),
  startedAt: z.number().optional(),
  watchedRoot: z.string().optional(),
  include: z.array(z.string()).default([]),
  exclude: z.array(z.string()).default([]),
  pendingChanges: z.number().int().default(0),
  processing: z.boolean().default(false),
  lastReportId: z.string().optional(),
  reportCount: z.number().int().default(0),
});
export type WatchStatus = z.infer<typeof WatchStatusSchema>;

export const WatchChangesQuerySchema = z.object({
  /** Return reports newer than this report id (exclusive). */
  sinceReportId: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(10),
});
