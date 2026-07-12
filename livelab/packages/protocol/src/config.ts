import { z } from 'zod';
import { DeviceConfigSchema } from './devices';

/** Versioned `.livelab/config.json` schema. */
export const SmokeAssertionSchema = z.object({
  id: z.string().min(1).max(64),
  description: z.string().max(300).optional(),
  kind: z.enum(['elementVisible', 'elementText', 'urlMatches', 'noSelector']),
  selector: z.string().max(500).optional(),
  text: z.string().max(500).optional(),
  pattern: z.string().max(500).optional(),
});
export type SmokeAssertion = z.infer<typeof SmokeAssertionSchema>;

export const WorkspaceConfigSchema = z.object({
  $schema: z.string().optional(),
  version: z.literal(1).default(1),
  /** Application routes checked by smoke tests and watch mode (path only, e.g. "/checkout"). */
  routes: z.array(z.string().regex(/^\//).max(500)).default(['/']),
  devices: z.array(z.union([z.string(), DeviceConfigSchema])).default([]),
  /** Extra allowlisted npm scripts, merged with the extension setting. */
  scripts: z.array(z.string().regex(/^[a-zA-Z0-9:_-]+$/).max(64)).default([]),
  smoke: z
    .object({
      assertions: z.array(SmokeAssertionSchema).default([]),
      /** Console-error substrings to ignore (third-party noise). */
      ignoreConsole: z.array(z.string().max(300)).default([]),
      ignoreRequests: z.array(z.string().max(300)).default([]),
      /** Allowed horizontal overflow in px before the overflow check fails. */
      overflowTolerancePx: z.number().int().min(0).max(100).default(0),
    })
    .default({}),
  auth: z
    .object({
      /** Workspace-relative path to user-owned Playwright storage-state JSON. */
      storageStatePath: z.string().max(1024).optional(),
    })
    .default({}),
  visual: z
    .object({
      /** pixelmatch per-pixel color threshold (0..1). */
      threshold: z.number().min(0).max(1).default(0.15),
      /** Fraction of pixels allowed to differ before the comparison fails. */
      maxDiffPixelRatio: z.number().min(0).max(1).default(0.002),
    })
    .default({}),
  headers: z.record(z.string().max(2048)).default({}),
  env: z.record(z.string().max(2048)).default({}),
  watch: z
    .object({
      include: z.array(z.string().max(300)).default(['src/**', 'app/**', 'pages/**', 'components/**', 'public/**', 'styles/**', 'index.html']),
      exclude: z.array(z.string().max(300)).default(['**/node_modules/**', '**/.git/**', '**/dist/**', '**/.livelab/**', '**/.next/**']),
      quietWindowMs: z.number().int().min(50).max(10_000).default(500),
      maxSettleMs: z.number().int().min(500).max(60_000).default(10_000),
      fullPageScreenshot: z.boolean().default(false),
      visualCompare: z.boolean().default(false),
    })
    .default({}),
});
export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

export const DEFAULT_REDACT_HEADERS = ['authorization', 'cookie', 'set-cookie', 'x-api-key', 'proxy-authorization'];
export const DEFAULT_REDACT_QUERY_PARAMS = ['token', 'key', 'api_key', 'apikey', 'access_token', 'refresh_token', 'secret', 'password', 'auth', 'session', 'sig', 'signature'];
export const DEFAULT_ALLOWED_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
export const DEFAULT_MANAGED_SCRIPTS = ['dev', 'start', 'test', 'test:e2e', 'lint', 'typecheck', 'build'];

/** Runtime-level options resolved from VS Code settings / CLI flags / config file. */
export const RuntimeOptionsSchema = z.object({
  workspaceRoot: z.string().min(1),
  allowedHosts: z.array(z.string().max(255)).default(DEFAULT_ALLOWED_HOSTS),
  managedScripts: z.array(z.string().max(64)).default(DEFAULT_MANAGED_SCRIPTS),
  redactHeaders: z.array(z.string().max(128)).default(DEFAULT_REDACT_HEADERS),
  redactQueryParameters: z.array(z.string().max(128)).default(DEFAULT_REDACT_QUERY_PARAMS),
  consoleMaxEntries: z.number().int().min(50).max(10_000).default(500),
  networkMaxEntries: z.number().int().min(50).max(20_000).default(1000),
  artifactsDirectory: z.string().default('.livelab/artifacts'),
  /** Max stored artifact bytes before oldest artifacts are pruned. */
  maxArtifactBytes: z.number().int().min(1_000_000).default(512 * 1024 * 1024),
  /** Screencast max frames per second. */
  maxFrameRate: z.number().int().min(1).max(30).default(10),
});
export type RuntimeOptions = z.infer<typeof RuntimeOptionsSchema>;
