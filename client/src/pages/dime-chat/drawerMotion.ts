/**
 * Pure drawer-gesture math for the responsive Dime chat shell.
 * Visual geometry remains in the frozen/derived CSS; this module owns only
 * pointer intent, rubber-band resistance, and velocity-directed release.
 */

export type HorizontalIntent = "horizontal" | "vertical" | "pending";

export function classifyPointerIntent(
  dx: number,
  dy: number,
  threshold = 10
): HorizontalIntent {
  if (Math.hypot(dx, dy) < threshold) return "pending";
  return Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
}

/** Progressive resistance after either physical drawer bound. */
export function rubberBand(
  value: number,
  min: number,
  max: number,
  resistance = 0.18
): number {
  const dimension = Math.max(1, max - min);
  const resisted = (overshoot: number) =>
    (overshoot * dimension * resistance) / (dimension + resistance * overshoot);
  if (value < min) return min - resisted(min - value);
  if (value > max) return max + resisted(value - max);
  return value;
}

export interface DrawerRelease {
  velocityX: number;
  lastDirection: -1 | 0 | 1;
  closedX: number;
}

/**
 * Founder rule: release direction, never drawer position, chooses the target.
 * A nearly stationary release inherits the last meaningful drag direction.
 */
export function resolveDrawerTarget({
  velocityX,
  lastDirection,
  closedX,
}: DrawerRelease): number {
  const direction =
    Math.abs(velocityX) >= 1 ? Math.sign(velocityX) : lastDirection;
  return direction > 0 ? 0 : closedX;
}
