/**
 * Critically-damped ("no overshoot") spring integrator for the Dime chat
 * drawer's release-to-settle motion. Introduced by the PR #70 bundle-budget
 * remediation to replace framer-motion's `animate(motionValue, target,
 * { type: "spring", ... })` on the /chat critical path (see
 * DimeChatPage.tsx's `settleDrawer`) — framer-motion stays a dependency for
 * other, lazily-loaded pages, but the chat shell no longer imports it.
 *
 * Framework-agnostic and timer-agnostic by design: this module owns no
 * `requestAnimationFrame` loop and never reads `Date.now()`. The caller
 * drives it by calling `step(dt)` with an explicit elapsed time in seconds
 * (normally measured from its own rAF loop) and reads `.value` back each
 * step to write to the DOM. That split is what makes the physics
 * deterministically unit-testable with fixed dt values.
 *
 * Motion dial 2/10 ("Subtle", design-system/dime-ai/MASTER.md) forbids
 * overshoot/ringing, so the damping ratio is fixed at 1.0 (critical
 * damping) rather than exposed as an option. `responseSeconds` alone tunes
 * how quickly the spring settles (~0.3s default — close to the previous
 * framer spring's own near-critical {stiffness:520, damping:43, mass:0.9},
 * which resolves to damping ratio ~0.994 and a ~0.26s response).
 */

export interface SpringSettleOptions {
  /** Starting value (e.g. the drawer's current x, in px). */
  from: number;
  /** Target value to settle at. */
  to: number;
  /** Initial velocity (units/second) — the release velocity handoff. */
  velocity?: number;
  /** Called on every `step()` that advances the simulation. */
  onUpdate: (value: number) => void;
  /** Called exactly once, the step the simulation crosses into rest. */
  onSettle?: () => void;
  /** Settle speed in seconds. Default 0.3s. */
  responseSeconds?: number;
  /** Displacement-from-target threshold (units) below which motion is "at rest". */
  restDisplacement?: number;
  /** Velocity threshold (units/second) below which motion is "at rest". */
  restVelocity?: number;
}

export interface SpringSettleHandle {
  /** Advance the simulation by `dt` seconds (no-op once settled or stopped). */
  step(dt: number): void;
  /**
   * Re-target mid-flight. `value` is left untouched (no position jump) —
   * only the point the spring is pulling toward changes. Velocity carries
   * over unchanged unless an explicit `velocity` is passed (e.g. a fresh
   * gesture release measured its own velocity and should override).
   */
  retarget(to: number, velocity?: number): void;
  /** Stop the simulation permanently; no further onUpdate/onSettle calls. */
  stop(): void;
  readonly value: number;
  readonly velocity: number;
  readonly settled: boolean;
}

const DEFAULT_RESPONSE_SECONDS = 0.3;
const DEFAULT_REST_DISPLACEMENT = 0.01;
const DEFAULT_REST_VELOCITY = 0.01;

export function createSpringSettle(
  options: SpringSettleOptions
): SpringSettleHandle {
  const {
    onUpdate,
    onSettle,
    responseSeconds = DEFAULT_RESPONSE_SECONDS,
    restDisplacement = DEFAULT_REST_DISPLACEMENT,
    restVelocity = DEFAULT_REST_VELOCITY,
  } = options;

  let value = options.from;
  let velocity = options.velocity ?? 0;
  let target = options.to;
  let settled = false;
  let stopped = false;

  // Critically damped spring (damping ratio 1): x'' + 2*omega*x' + omega^2*x = 0.
  // Exact closed-form solution below — unconditionally stable for any dt,
  // and exact regardless of step size (no Euler-integration drift), which is
  // what makes fixed-dt test steps reproduce the same physics as an rAF loop.
  const omega = (2 * Math.PI) / responseSeconds;

  return {
    step(dt) {
      if (stopped || settled || dt <= 0) return;
      const displacement = value - target;
      const decay = Math.exp(-omega * dt);
      const nextDisplacement =
        (displacement + (velocity + omega * displacement) * dt) * decay;
      const nextVelocity =
        (velocity - omega * (velocity + omega * displacement) * dt) * decay;
      value = target + nextDisplacement;
      velocity = nextVelocity;
      onUpdate(value);
      if (
        Math.abs(nextDisplacement) < restDisplacement &&
        Math.abs(velocity) < restVelocity
      ) {
        settled = true;
        value = target;
        velocity = 0;
        onUpdate(value);
        onSettle?.();
      }
    },
    retarget(to, nextVelocity) {
      if (stopped) return;
      target = to;
      settled = false;
      if (nextVelocity !== undefined) velocity = nextVelocity;
    },
    stop() {
      stopped = true;
    },
    get value() {
      return value;
    },
    get velocity() {
      return velocity;
    },
    get settled() {
      return settled;
    },
  };
}
