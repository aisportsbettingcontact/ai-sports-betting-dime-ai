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

export interface DrawerAccessibilityInput {
  drawerOpen: boolean;
  drawerMoving: boolean;
  /** 0 = drawer fully off-screen, 1 = drawer fully on-screen. */
  drawerVisibleFraction: number;
  reduceMotion: boolean;
}

export interface DrawerAccessibilityState {
  /** Should the main chat pane (and everything behind the drawer) be inert. */
  mainInert: boolean;
  /** Should the drawer's own focus trap (Tab wrap + initial focus) be armed. */
  trapFocus: boolean;
}

/**
 * Decides whether the main chat pane should be `inert` and whether the
 * drawer's focus trap should be active. Pulled out as a pure function so
 * the rule can be truth-tabled and unit tested independently of the
 * gesture/DOM code in DimeChatPage.
 *
 * [PR #70 regression] `moveDrawerGesture` used to call
 * `setDrawerOpen(true)` / `setDrawerMoving(true)` unconditionally the
 * moment an edge-swipe claimed horizontal intent, while the drawer's visual
 * position (`drawerX`) only updated when `!reduceMotion`. Under
 * `prefers-reduced-motion: reduce`, that let `drawerOpen` flip true — and
 * the old `main.inert = drawerOpen` assignment follow it — while the
 * drawer was still fully off-screen (`drawerVisibleFraction === 0`),
 * freezing the main pane behind an invisible drawer until the pointer
 * lifted. `mainInert` must be `false` for that exact combination (open +
 * moving + invisible + reduceMotion); the gesture-claim path is now also
 * gated on `!reduceMotion` so `drawerOpen` can only become true via the
 * drawer button under reduced motion, but this function forbids the
 * unsafe state on its own regardless of how it might be reached.
 *
 * Without reduced motion, this task leaves the animated path unchanged:
 * `mainInert` mirrors `drawerOpen` outright (inerting the background from
 * the first frame of the 160ms slide-in is intentional — the animation is
 * fast enough that "open" and "visible" are effectively simultaneous).
 * Under reduced motion, state changes are immediate rather than animated,
 * so `mainInert` additionally requires the drawer to actually be visible.
 */
export function resolveDrawerAccessibility({
  drawerOpen,
  drawerMoving,
  drawerVisibleFraction,
  reduceMotion,
}: DrawerAccessibilityInput): DrawerAccessibilityState {
  const visible = reduceMotion ? drawerVisibleFraction > 0 : true;
  const mainInert = drawerOpen && visible;
  const trapFocus = mainInert && !drawerMoving;
  return { mainInert, trapFocus };
}
