import { z } from 'zod';
import { DeviceConfigSchema } from './devices';

export const BrowserEngineSchema = z.enum(['chromium', 'webkit', 'firefox']);
export type BrowserEngine = z.infer<typeof BrowserEngineSchema>;

export const ColorSchemeSchema = z.enum(['light', 'dark', 'no-preference']);
export const ReducedMotionSchema = z.enum(['reduce', 'no-preference']);

export const EmulationSchema = z.object({
  colorScheme: ColorSchemeSchema.optional(),
  reducedMotion: ReducedMotionSchema.optional(),
  locale: z.string().max(35).optional(),
  timezoneId: z.string().max(64).optional(),
  geolocation: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      accuracy: z.number().min(0).optional(),
    })
    .optional(),
  offline: z.boolean().optional(),
  /** Milliseconds of artificial round-trip latency; Chromium only. */
  networkThrottle: z
    .object({
      downloadKbps: z.number().min(0),
      uploadKbps: z.number().min(0),
      latencyMs: z.number().min(0),
    })
    .optional(),
  cacheDisabled: z.boolean().optional(),
});
export type Emulation = z.infer<typeof EmulationSchema>;

export const CreateSessionRequestSchema = z.object({
  device: z.union([z.string().min(1).max(64), DeviceConfigSchema]),
  engine: BrowserEngineSchema.default('chromium'),
  url: z.string().url().optional(),
  emulation: EmulationSchema.optional(),
  /** Path (workspace-relative or absolute inside workspace) to a Playwright storage-state JSON. */
  storageStatePath: z.string().max(1024).optional(),
  label: z.string().max(80).optional(),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

export const SessionInfoSchema = z.object({
  sessionId: z.string(),
  label: z.string(),
  engine: BrowserEngineSchema,
  device: DeviceConfigSchema,
  url: z.string().optional(),
  title: z.string().optional(),
  createdAt: z.number(),
  navigationId: z.string().optional(),
  state: z.enum(['starting', 'ready', 'crashed', 'closed']),
  orientation: z.enum(['portrait', 'landscape']),
  emulation: EmulationSchema.optional(),
  counters: z.object({
    consoleErrors: z.number().int(),
    consoleWarnings: z.number().int(),
    pageErrors: z.number().int(),
    failedRequests: z.number().int(),
  }),
  /** How live frames are produced for this session. */
  streamMode: z.enum(['cdp-screencast', 'screenshot-poll', 'none']),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;

export const NavigateRequestSchema = z.object({
  url: z.string().min(1).max(2048),
});

export const SetViewportRequestSchema = z.object({
  width: z.number().int().min(200).max(7680),
  height: z.number().int().min(200).max(4320),
  deviceScaleFactor: z.number().min(0.5).max(4).optional(),
});

export const RotateRequestSchema = z.object({});

export const ClearRequestSchema = z.object({
  storage: z.boolean().default(false),
  cookies: z.boolean().default(false),
  serviceWorkers: z.boolean().default(false),
});

export const SettleRequestSchema = z.object({
  quietWindowMs: z.number().int().min(50).max(10_000).default(500),
  maxSettleMs: z.number().int().min(500).max(60_000).default(10_000),
});
export type SettleRequest = z.infer<typeof SettleRequestSchema>;

export const SettleResultSchema = z.object({
  settled: z.boolean(),
  waitedMs: z.number(),
  timedOut: z.boolean(),
  /** Activity that never went quiet, when timedOut. */
  unresolvedActivity: z.array(z.string()),
});
export type SettleResult = z.infer<typeof SettleResultSchema>;
