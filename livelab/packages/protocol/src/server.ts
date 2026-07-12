import { z } from 'zod';

/** Development-server detection and control. */
export const FrameworkSchema = z.enum([
  'nextjs',
  'vite',
  'astro',
  'remix',
  'nuxt',
  'sveltekit',
  'generic',
]);
export type Framework = z.infer<typeof FrameworkSchema>;

export const DetectedServerSchema = z.object({
  framework: FrameworkSchema,
  /** npm script name, e.g. "dev". */
  script: z.string(),
  command: z.string(),
  /** Best-guess URL once running. */
  defaultUrl: z.string(),
  packageDir: z.string(),
});
export type DetectedServer = z.infer<typeof DetectedServerSchema>;

export const StartServerRequestSchema = z.object({
  /** npm script name from the allowlist. No arbitrary command strings. */
  script: z.string().regex(/^[a-zA-Z0-9:_-]+$/).max(64),
  packageDir: z.string().max(1024).optional(),
  /** Wait up to this long for the URL to become reachable. */
  readyTimeoutMs: z.number().int().min(1000).max(300_000).default(120_000),
  expectedUrl: z.string().max(2048).optional(),
});

export const AttachServerRequestSchema = z.object({
  url: z.string().min(1).max(2048),
});

export const ServerStatusSchema = z.object({
  state: z.enum(['stopped', 'starting', 'running', 'attached', 'failed']),
  framework: FrameworkSchema.optional(),
  script: z.string().optional(),
  url: z.string().optional(),
  pid: z.number().optional(),
  startedAt: z.number().optional(),
  exitCode: z.number().nullable().optional(),
  /** Tail of captured stdout/stderr for managed processes (bounded). */
  logTail: z.array(z.string()).default([]),
});
export type ServerStatus = z.infer<typeof ServerStatusSchema>;

export const RunScriptRequestSchema = z.object({
  script: z.string().regex(/^[a-zA-Z0-9:_-]+$/).max(64),
  packageDir: z.string().max(1024).optional(),
  timeoutMs: z.number().int().min(1000).max(1_800_000).default(600_000),
});

export const RunScriptResultSchema = z.object({
  script: z.string(),
  exitCode: z.number().nullable(),
  timedOut: z.boolean(),
  durationMs: z.number(),
  stdoutTail: z.array(z.string()),
  stderrTail: z.array(z.string()),
});
export type RunScriptResult = z.infer<typeof RunScriptResultSchema>;
