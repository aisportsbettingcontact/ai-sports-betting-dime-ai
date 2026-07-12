import { z } from 'zod';

export const ArtifactTypeSchema = z.enum([
  'screenshot',
  'fullpage-screenshot',
  'trace',
  'har',
  'dom-snapshot',
  'accessibility-snapshot',
  'visual-diff',
  'visual-actual',
  'visual-expected',
  'report',
  'log',
  'ios-simulator-screenshot',
]);
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;

export const ArtifactMetadataSchema = z.object({
  artifactId: z.string(),
  type: ArtifactTypeSchema,
  /** Path relative to the workspace root (always inside `.livelab/`). */
  path: z.string(),
  sessionId: z.string().optional(),
  reportId: z.string().optional(),
  url: z.string().optional(),
  device: z.string().optional(),
  engine: z.string().optional(),
  createdAt: z.number(),
  bytes: z.number().int().nonnegative(),
  contentType: z.string(),
  label: z.string().optional(),
});
export type ArtifactMetadata = z.infer<typeof ArtifactMetadataSchema>;

export const ScreenshotRequestSchema = z.object({
  fullPage: z.boolean().default(false),
  /** Return base64 inline in addition to persisting (bounded; viewport only). */
  inline: z.boolean().default(false),
  quality: z.number().int().min(10).max(100).optional(),
  format: z.enum(['png', 'jpeg']).default('png'),
  label: z.string().max(120).optional(),
});
export type ScreenshotRequest = z.infer<typeof ScreenshotRequestSchema>;
