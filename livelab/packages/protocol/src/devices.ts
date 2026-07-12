import { z } from 'zod';

/**
 * Device presets. These are *viewport presets*, not exact physical-device
 * simulations. `playwrightDescriptor` names an exact Playwright device
 * descriptor when a supported one exists; otherwise explicit viewport +
 * user-agent settings are used and `simulationFidelity` is 'viewport'.
 */
export const DeviceKindSchema = z.enum(['phone', 'tablet', 'laptop', 'desktop']);
export type DeviceKind = z.infer<typeof DeviceKindSchema>;

export const DeviceConfigSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  kind: DeviceKindSchema,
  width: z.number().int().min(200).max(7680),
  height: z.number().int().min(200).max(4320),
  deviceScaleFactor: z.number().min(0.5).max(4).default(1),
  isMobile: z.boolean().default(false),
  hasTouch: z.boolean().default(false),
  userAgent: z.string().max(512).optional(),
  /** Exact Playwright device descriptor name when one exists. */
  playwrightDescriptor: z.string().max(80).optional(),
  simulationFidelity: z.enum(['descriptor', 'viewport']).default('viewport'),
});
export type DeviceConfig = z.infer<typeof DeviceConfigSchema>;

export const DEVICE_PRESETS: readonly DeviceConfig[] = [
  {
    id: 'iphone-13-mini',
    label: 'iPhone 13 mini',
    kind: 'phone',
    width: 375,
    height: 812,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    playwrightDescriptor: 'iPhone 13 Mini',
    simulationFidelity: 'descriptor',
  },
  {
    id: 'iphone-16',
    label: 'iPhone 16',
    kind: 'phone',
    width: 393,
    height: 852,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    simulationFidelity: 'viewport',
  },
  {
    id: 'iphone-16-plus',
    label: 'iPhone 16 Plus',
    kind: 'phone',
    width: 430,
    height: 932,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    simulationFidelity: 'viewport',
  },
  {
    id: 'android-compact',
    label: 'Compact Android',
    kind: 'phone',
    width: 360,
    height: 800,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    simulationFidelity: 'viewport',
  },
  {
    id: 'android-standard',
    label: 'Standard Android',
    kind: 'phone',
    width: 412,
    height: 915,
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    simulationFidelity: 'viewport',
  },
  {
    id: 'ipad-mini-portrait',
    label: 'iPad mini portrait',
    kind: 'tablet',
    width: 744,
    height: 1133,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    simulationFidelity: 'viewport',
  },
  {
    id: 'ipad-landscape',
    label: 'iPad landscape',
    kind: 'tablet',
    width: 1133,
    height: 744,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    simulationFidelity: 'viewport',
  },
  {
    id: 'laptop-1366',
    label: 'Laptop',
    kind: 'laptop',
    width: 1366,
    height: 768,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    simulationFidelity: 'viewport',
  },
  {
    id: 'desktop-1440',
    label: 'Desktop',
    kind: 'desktop',
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    simulationFidelity: 'viewport',
  },
  {
    id: 'desktop-1728',
    label: 'Large desktop',
    kind: 'desktop',
    width: 1728,
    height: 1117,
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: false,
    simulationFidelity: 'viewport',
  },
] as const;

export function findDevicePreset(id: string): DeviceConfig | undefined {
  return DEVICE_PRESETS.find((d) => d.id === id);
}
