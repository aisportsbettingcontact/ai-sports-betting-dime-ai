import { describe, expect, it, vi } from "vitest";
import { createSpringSettle } from "./springSettle";

// Fixed dt steps throughout — no Date.now/performance.now anywhere in this
// file. createSpringSettle owns no timer/rAF loop of its own, so driving it
// with synthetic dt values exercises exactly the same code path a real rAF
// loop would (see springSettle.ts's module doc).

describe("createSpringSettle", () => {
  it("converges to the target and calls onSettle once", () => {
    const onUpdate = vi.fn();
    const onSettle = vi.fn();
    const spring = createSpringSettle({
      from: 0,
      to: 200,
      onUpdate,
      onSettle,
    });

    // 3 seconds at a 60fps-ish fixed step is far past a 0.3s response spring's
    // settle time.
    for (let i = 0; i < 180; i++) spring.step(1 / 60);

    expect(spring.settled).toBe(true);
    expect(spring.value).toBe(200);
    expect(spring.velocity).toBe(0);
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalled();
  });

  it("settle callback fires exactly once even if step() keeps being called", () => {
    const onSettle = vi.fn();
    const spring = createSpringSettle({
      from: 0,
      to: 1,
      onUpdate: () => {},
      onSettle,
      responseSeconds: 0.05,
    });

    for (let i = 0; i < 60; i++) spring.step(1 / 60);
    expect(spring.settled).toBe(true);
    expect(onSettle).toHaveBeenCalledTimes(1);

    // Continuing to step after settling must not fire onSettle again, nor
    // move the value away from the target.
    for (let i = 0; i < 30; i++) spring.step(1 / 60);
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(spring.value).toBe(1);
  });

  it("carries the release velocity into its very first step", () => {
    const atRest = createSpringSettle({
      from: 0,
      to: 200,
      velocity: 0,
      onUpdate: () => {},
    });
    const withVelocity = createSpringSettle({
      from: 0,
      to: 200,
      velocity: 800, // moving toward the target
      onUpdate: () => {},
    });

    atRest.step(1 / 60);
    withVelocity.step(1 / 60);

    // Same starting position and target, same dt — only initial velocity
    // differs, so the one carrying velocity toward the target must have
    // advanced further after one identical step.
    expect(withVelocity.value).toBeGreaterThan(atRest.value);
  });

  it("re-target mid-flight has no position jump", () => {
    const spring = createSpringSettle({
      from: 0,
      to: 100,
      onUpdate: () => {},
    });

    spring.step(0.05);
    spring.step(0.05);
    spring.step(0.05);
    const valueBeforeRetarget = spring.value;

    spring.retarget(300);

    // Retargeting must not itself move the value — only change what the
    // spring is pulling toward.
    expect(spring.value).toBe(valueBeforeRetarget);
    expect(spring.settled).toBe(false);

    // Motion continues toward the NEW target from here.
    spring.step(0.05);
    expect(spring.value).toBeGreaterThan(valueBeforeRetarget);

    for (let i = 0; i < 200; i++) spring.step(1 / 60);
    expect(spring.value).toBe(300);
  });

  it("retarget without an explicit velocity preserves the current velocity (interruption)", () => {
    const spring = createSpringSettle({
      from: 0,
      to: 100,
      velocity: 500,
      onUpdate: () => {},
    });
    spring.step(0.02);
    const velocityBeforeRetarget = spring.velocity;

    spring.retarget(50);
    expect(spring.velocity).toBe(velocityBeforeRetarget);

    spring.retarget(80, -120);
    expect(spring.velocity).toBe(-120);
  });

  it("stop() prevents further onUpdate/onSettle calls", () => {
    const onUpdate = vi.fn();
    const onSettle = vi.fn();
    const spring = createSpringSettle({
      from: 0,
      to: 10,
      onUpdate,
      onSettle,
    });

    spring.step(1 / 60);
    const callsBeforeStop = onUpdate.mock.calls.length;
    spring.stop();
    spring.step(1 / 60);
    spring.step(1 / 60);

    expect(onUpdate.mock.calls.length).toBe(callsBeforeStop);
    expect(onSettle).not.toHaveBeenCalled();
  });

  it("ignores non-positive dt", () => {
    const onUpdate = vi.fn();
    const spring = createSpringSettle({ from: 0, to: 10, onUpdate });
    spring.step(0);
    spring.step(-1);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(spring.value).toBe(0);
  });
});
