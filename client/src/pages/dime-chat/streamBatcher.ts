export interface FrameScheduler {
  request(callback: FrameRequestCallback): number;
  cancel(id: number): void;
}

export interface RafDeltaBatcher {
  push(text: string): void;
  flushBeforeTerminal(terminal: () => void): void;
  dispose(): void;
}

const browserScheduler: FrameScheduler = {
  request: callback => requestAnimationFrame(callback),
  cancel: id => cancelAnimationFrame(id),
};

/**
 * Coalesces arbitrary SSE delta cadence into at most one React update per
 * animation frame. Terminal events synchronously drain pending text first.
 */
export function createRafDeltaBatcher(
  onFlush: (text: string) => void,
  scheduler: FrameScheduler = browserScheduler
): RafDeltaBatcher {
  let pending = "";
  let frame: number | null = null;
  let disposed = false;

  const drain = () => {
    if (!pending || disposed) return;
    const text = pending;
    pending = "";
    onFlush(text);
  };

  const cancelFrame = () => {
    if (frame == null) return;
    scheduler.cancel(frame);
    frame = null;
  };

  return {
    push(text) {
      if (disposed || !text) return;
      pending += text;
      if (frame != null) return;
      frame = scheduler.request(() => {
        frame = null;
        drain();
      });
    },
    flushBeforeTerminal(terminal) {
      if (disposed) return;
      cancelFrame();
      drain();
      terminal();
    },
    dispose() {
      cancelFrame();
      pending = "";
      disposed = true;
    },
  };
}
