import { z } from 'zod';

/**
 * Input events dispatched from the webview (or MCP tools) to a session page.
 * Coordinates are in CSS pixels in page viewport space — the webview performs
 * frame→page mapping (zoom, device-frame padding) before sending.
 */
export const MouseButtonSchema = z.enum(['left', 'middle', 'right']);

export const MouseEventSchema = z.object({
  kind: z.enum(['move', 'down', 'up', 'click', 'dblclick', 'wheel']),
  x: z.number().min(0).max(20_000),
  y: z.number().min(0).max(20_000),
  button: MouseButtonSchema.default('left'),
  clickCount: z.number().int().min(1).max(3).default(1),
  deltaX: z.number().min(-5000).max(5000).default(0),
  deltaY: z.number().min(-5000).max(5000).default(0),
  modifiers: z.array(z.enum(['Alt', 'Control', 'Meta', 'Shift'])).default([]),
});

export const TouchEventSchema = z.object({
  kind: z.enum(['tap']),
  x: z.number().min(0).max(20_000),
  y: z.number().min(0).max(20_000),
});

export const KeyEventSchema = z.object({
  kind: z.enum(['down', 'up', 'press']),
  /** Playwright key name, e.g. "Enter", "ArrowLeft", "a". */
  key: z.string().min(1).max(32),
});

export const TextEventSchema = z.object({
  kind: z.literal('insertText'),
  text: z.string().max(10_000),
});

export const ScrollEventSchema = z.object({
  kind: z.literal('scrollTo'),
  /** Scroll position as percentage of scrollable range (0..1) for cross-device sync. */
  xPercent: z.number().min(0).max(1),
  yPercent: z.number().min(0).max(1),
});

export const FocusEventSchema = z.object({
  kind: z.literal('focus'),
});

export const InputEventSchema = z.discriminatedUnion('inputType', [
  z.object({ inputType: z.literal('mouse') }).merge(z.object({ event: MouseEventSchema })),
  z.object({ inputType: z.literal('touch') }).merge(z.object({ event: TouchEventSchema })),
  z.object({ inputType: z.literal('key') }).merge(z.object({ event: KeyEventSchema })),
  z.object({ inputType: z.literal('text') }).merge(z.object({ event: TextEventSchema })),
  z.object({ inputType: z.literal('scroll') }).merge(z.object({ event: ScrollEventSchema })),
  z.object({ inputType: z.literal('focus') }).merge(z.object({ event: FocusEventSchema })),
]);
export type InputEvent = z.infer<typeof InputEventSchema>;

/**
 * Locator description used by MCP tools and cross-device interaction sync.
 * Stable locators are preferred; raw coordinates are an explicit fallback.
 */
export const LocatorSchema = z.object({
  strategy: z.enum(['role', 'label', 'placeholder', 'text', 'testId', 'css']),
  value: z.string().min(1).max(500),
  /** For strategy 'role': accessible name. */
  name: z.string().max(200).optional(),
  nth: z.number().int().min(0).optional(),
});
export type Locator = z.infer<typeof LocatorSchema>;

export const ClickRequestSchema = z.object({
  locator: LocatorSchema.optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  button: MouseButtonSchema.default('left'),
  clickCount: z.number().int().min(1).max(3).default(1),
});

export const TypeRequestSchema = z.object({
  locator: LocatorSchema.optional(),
  text: z.string().max(10_000),
  /** Replace existing value instead of appending. */
  clear: z.boolean().default(false),
  delayMs: z.number().int().min(0).max(1000).default(0),
});

export const PressRequestSchema = z.object({
  locator: LocatorSchema.optional(),
  key: z.string().min(1).max(64),
});

export const SelectRequestSchema = z.object({
  locator: LocatorSchema,
  values: z.array(z.string().max(500)).min(1).max(50),
});

export const HoverRequestSchema = z.object({
  locator: LocatorSchema.optional(),
  x: z.number().optional(),
  y: z.number().optional(),
});

export const ScrollRequestSchema = z.object({
  locator: LocatorSchema.optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  yPercent: z.number().min(0).max(1).optional(),
  deltaY: z.number().min(-20_000).max(20_000).optional(),
});
