import { z } from 'zod';
import { LocatorSchema } from './input';

export const InspectRequestSchema = z.object({
  x: z.number().min(0).optional(),
  y: z.number().min(0).optional(),
  locator: LocatorSchema.optional(),
});

export const LocatorCandidateSchema = z.object({
  strategy: z.enum(['role', 'label', 'placeholder', 'text', 'testId', 'css']),
  value: z.string(),
  name: z.string().optional(),
  /** Playwright locator expression for direct reuse in tests. */
  expression: z.string(),
  unique: z.boolean(),
});
export type LocatorCandidate = z.infer<typeof LocatorCandidateSchema>;

export const ElementInfoSchema = z.object({
  tag: z.string(),
  role: z.string().optional(),
  accessibleName: z.string().optional(),
  text: z.string().optional(),
  attributes: z.record(z.string()),
  box: z
    .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
    .nullable(),
  visible: z.boolean(),
  zIndex: z.string().optional(),
  font: z.string().optional(),
  color: z.string().optional(),
  backgroundColor: z.string().optional(),
  display: z.string().optional(),
  position: z.string().optional(),
  overflowClipped: z.boolean(),
  offscreen: z.boolean(),
  locators: z.array(LocatorCandidateSchema),
  issues: z.array(
    z.object({
      kind: z.enum([
        'duplicate-id',
        'clipped',
        'hidden',
        'offscreen',
        'overlapped',
        'missing-accessible-name',
      ]),
      detail: z.string(),
    }),
  ),
});
export type ElementInfo = z.infer<typeof ElementInfoSchema>;

export const DomSnapshotRequestSchema = z.object({
  /** Root CSS selector; defaults to body. */
  selector: z.string().max(500).default('body'),
  maxDepth: z.number().int().min(1).max(40).default(12),
  maxNodes: z.number().int().min(10).max(5000).default(800),
  includeText: z.boolean().default(true),
});

export const AccessibilitySnapshotRequestSchema = z.object({
  interestingOnly: z.boolean().default(true),
  maxNodes: z.number().int().min(10).max(5000).default(800),
});

export const AxeScanRequestSchema = z.object({
  /** Limit scan to a CSS selector subtree. */
  selector: z.string().max(500).optional(),
});
