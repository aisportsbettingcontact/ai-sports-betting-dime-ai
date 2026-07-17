import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { installFatalErrorHandler } from "./fatalErrorHandler";

class FakeProcess extends EventEmitter {
  exit = vi.fn();
}

describe("installFatalErrorHandler", () => {
  it("closes the HTTP server and exits nonzero after an uncaught exception", () => {
    const processTarget = new FakeProcess();
    const close = vi.fn((callback: (error?: Error) => void) => callback());
    const logger = { error: vi.fn() };

    installFatalErrorHandler({
      processTarget,
      server: { close },
      logger,
    });
    processTarget.emit("uncaughtException", new Error("boom"));

    expect(close).toHaveBeenCalledOnce();
    expect(processTarget.exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith(
      "[FATAL] Uncaught exception — shutting down safely",
      expect.objectContaining({ message: "boom" }),
    );
  });

  it("forces connections closed when the graceful deadline expires", () => {
    const processTarget = new FakeProcess();
    const closeAllConnections = vi.fn();
    const scheduled: Array<() => void> = [];
    const schedule = vi.fn((callback: () => void) => {
      scheduled.push(callback);
      return { unref: vi.fn() } as unknown as NodeJS.Timeout;
    });

    installFatalErrorHandler({
      processTarget,
      server: { close: vi.fn(), closeAllConnections },
      schedule: schedule as typeof setTimeout,
      logger: { error: vi.fn() },
      graceMs: 25,
    });
    processTarget.emit("uncaughtException", new Error("boom"));
    scheduled[0]();

    expect(closeAllConnections).toHaveBeenCalledOnce();
    expect(processTarget.exit).toHaveBeenCalledWith(1);
  });
});
