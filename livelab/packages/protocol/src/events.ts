import { z } from 'zod';

/**
 * Runtime event records. Every record carries a per-session monotonically
 * increasing `seq` so clients can issue delta queries (`since` cursors).
 */
export const ConsoleLevelSchema = z.enum(['log', 'info', 'warn', 'error', 'debug']);
export type ConsoleLevel = z.infer<typeof ConsoleLevelSchema>;

export const ConsoleRecordSchema = z.object({
  type: z.literal('console'),
  seq: z.number().int().nonnegative(),
  sessionId: z.string(),
  navigationId: z.string().optional(),
  level: ConsoleLevelSchema,
  text: z.string(),
  url: z.string().optional(),
  line: z.number().int().optional(),
  column: z.number().int().optional(),
  stack: z.string().optional(),
  timestamp: z.number(),
  /** Number of identical occurrences folded into this record. */
  count: z.number().int().min(1).default(1),
});
export type ConsoleRecord = z.infer<typeof ConsoleRecordSchema>;

export const PageErrorRecordSchema = z.object({
  type: z.literal('pageError'),
  seq: z.number().int().nonnegative(),
  sessionId: z.string(),
  navigationId: z.string().optional(),
  message: z.string(),
  stack: z.string().optional(),
  /** 'exception' = uncaught exception, 'rejection' = unhandled promise rejection. */
  errorType: z.enum(['exception', 'rejection']).default('exception'),
  timestamp: z.number(),
  count: z.number().int().min(1).default(1),
});
export type PageErrorRecord = z.infer<typeof PageErrorRecordSchema>;

export const NetworkRecordSchema = z.object({
  type: z.literal('network'),
  seq: z.number().int().nonnegative(),
  sessionId: z.string(),
  navigationId: z.string().optional(),
  method: z.string(),
  /** URL after redaction of sensitive query parameters. */
  url: z.string(),
  resourceType: z.string().optional(),
  status: z.number().int().optional(),
  ok: z.boolean().optional(),
  failureText: z.string().optional(),
  durationMs: z.number().optional(),
  transferSize: z.number().optional(),
  fromCache: z.boolean().optional(),
  initiator: z.string().optional(),
  requestHeaders: z.record(z.string()).optional(),
  responseHeaders: z.record(z.string()).optional(),
  timestamp: z.number(),
});
export type NetworkRecord = z.infer<typeof NetworkRecordSchema>;

export const WebSocketRecordSchema = z.object({
  type: z.literal('websocket'),
  seq: z.number().int().nonnegative(),
  sessionId: z.string(),
  url: z.string(),
  event: z.enum(['open', 'close', 'error', 'framesent', 'framereceived']),
  detail: z.string().optional(),
  timestamp: z.number(),
});
export type WebSocketRecord = z.infer<typeof WebSocketRecordSchema>;

export const LifecycleRecordSchema = z.object({
  type: z.literal('lifecycle'),
  seq: z.number().int().nonnegative(),
  sessionId: z.string(),
  navigationId: z.string().optional(),
  event: z.enum([
    'navigation',
    'load',
    'domcontentloaded',
    'crash',
    'close',
    'created',
    'hmr',
    'dialog',
  ]),
  url: z.string().optional(),
  detail: z.string().optional(),
  timestamp: z.number(),
});
export type LifecycleRecord = z.infer<typeof LifecycleRecordSchema>;

export const RuntimeEventSchema = z.discriminatedUnion('type', [
  ConsoleRecordSchema,
  PageErrorRecordSchema,
  NetworkRecordSchema,
  WebSocketRecordSchema,
  LifecycleRecordSchema,
]);
export type RuntimeEvent = z.infer<typeof RuntimeEventSchema>;

export const EventQuerySchema = z.object({
  since: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(500).default(100),
  levels: z.array(ConsoleLevelSchema).optional(),
  /** Only network entries with failures / 4xx / 5xx. */
  failedOnly: z.boolean().optional(),
  urlFilter: z.string().max(200).optional(),
});
export type EventQuery = z.infer<typeof EventQuerySchema>;

export interface EventPage<T> {
  items: T[];
  /** Cursor to pass as `since` for the next delta query. */
  cursor: number;
  truncated: boolean;
  totalMatched: number;
}
