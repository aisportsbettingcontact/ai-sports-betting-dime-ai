import { describe, expect, it } from "vitest";
import { createRafDeltaBatcher, type FrameScheduler } from "./streamBatcher";

function fakeScheduler() {
  let nextId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  const cancelled: number[] = [];
  const scheduler: FrameScheduler = {
    request(callback) {
      const id = ++nextId;
      callbacks.set(id, callback);
      return id;
    },
    cancel(id) {
      callbacks.delete(id);
      cancelled.push(id);
    },
  };
  return { scheduler, callbacks, cancelled };
}

describe("createRafDeltaBatcher", () => {
  it("coalesces multiple deltas into one animation-frame flush", () => {
    const fake = fakeScheduler();
    const flushed: string[] = [];
    const batcher = createRafDeltaBatcher(
      text => flushed.push(text),
      fake.scheduler
    );
    batcher.push("price ");
    batcher.push("meets probability");
    expect(fake.callbacks.size).toBe(1);
    [...fake.callbacks.values()][0](0);
    expect(flushed).toEqual(["price meets probability"]);
  });

  it("flushes pending text before a terminal action", () => {
    const fake = fakeScheduler();
    const order: string[] = [];
    const batcher = createRafDeltaBatcher(
      text => order.push(`delta:${text}`),
      fake.scheduler
    );
    batcher.push("final words");
    batcher.flushBeforeTerminal(() => order.push("done"));
    expect(order).toEqual(["delta:final words", "done"]);
    expect(fake.callbacks.size).toBe(0);
  });

  it("cancels the queued frame and discards pending text on unmount", () => {
    const fake = fakeScheduler();
    const flushed: string[] = [];
    const batcher = createRafDeltaBatcher(
      text => flushed.push(text),
      fake.scheduler
    );
    batcher.push("never render");
    batcher.dispose();
    expect(fake.cancelled).toEqual([1]);
    expect(fake.callbacks.size).toBe(0);
    expect(flushed).toEqual([]);
  });
});
