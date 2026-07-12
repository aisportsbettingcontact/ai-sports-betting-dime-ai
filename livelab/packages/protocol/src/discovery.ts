import { z } from 'zod';

/**
 * Runtime discovery record persisted at `.livelab/runtime.json` (0600 where
 * supported). One compatible runtime per workspace; clients verify pid
 * liveness + protocol compatibility + workspaceId before attaching.
 * The bearer token never leaves the local machine and is never committed —
 * `.livelab/` is gitignored by the extension/CLI on first run.
 */
export const RuntimeDiscoverySchema = z.object({
  protocolVersion: z.string(),
  runtimeVersion: z.string(),
  runtimeId: z.string(),
  workspaceId: z.string(),
  workspaceRoot: z.string(),
  pid: z.number().int().positive(),
  host: z.literal('127.0.0.1'),
  port: z.number().int().min(1024).max(65_535),
  token: z.string().min(32),
  startedAt: z.number(),
  /** 'extension' when VS Code launched the daemon; 'headless' for MCP/CLI-launched. */
  owner: z.enum(['extension', 'headless']),
});
export type RuntimeDiscovery = z.infer<typeof RuntimeDiscoverySchema>;

export const RuntimeStatusSchema = z.object({
  ok: z.boolean(),
  protocolVersion: z.string(),
  runtimeVersion: z.string(),
  runtimeId: z.string(),
  workspaceId: z.string(),
  workspaceRoot: z.string(),
  owner: z.enum(['extension', 'headless']),
  uptimeMs: z.number(),
  sessions: z.number().int(),
  watch: z.object({ active: z.boolean(), reports: z.number().int() }),
  devServer: z.object({
    state: z.enum(['stopped', 'starting', 'running', 'attached', 'failed']),
    url: z.string().optional(),
    script: z.string().optional(),
    pid: z.number().optional(),
  }),
  capabilities: z.object({
    engines: z.array(z.string()),
    cdpScreencast: z.boolean(),
    webkitVerification: z.boolean(),
    iosSimulator: z.boolean(),
    networkThrottle: z.boolean(),
  }),
  diagnostics: z.object({
    rssBytes: z.number(),
    activePages: z.number().int(),
    droppedFrames: z.number().int(),
    lastCaptureLatencyMs: z.number().nullable(),
  }),
});
export type RuntimeStatus = z.infer<typeof RuntimeStatusSchema>;
