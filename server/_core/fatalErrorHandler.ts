import type { Server } from "node:http";

type FatalProcess = {
  once(event: "uncaughtException", listener: (error: Error) => void): unknown;
  exit(code: number): never | void;
};

type FatalServer = Pick<Server, "close"> & Partial<Pick<Server, "closeAllConnections">>;

type InstallFatalErrorHandlerOptions = {
  processTarget?: FatalProcess;
  server: FatalServer;
  graceMs?: number;
  logger?: Pick<Console, "error">;
  schedule?: typeof setTimeout;
};

/**
 * Stop accepting work after an uncaught exception and terminate the process.
 * Continuing is unsafe because application state may be only partially mutated.
 */
export function installFatalErrorHandler({
  processTarget = process,
  server,
  graceMs = 10_000,
  logger = console,
  schedule = setTimeout,
}: InstallFatalErrorHandlerOptions): void {
  let shuttingDown = false;

  processTarget.once("uncaughtException", (error) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.error("[FATAL] Uncaught exception — shutting down safely", error);

    const forceExit = schedule(() => {
      logger.error(`[FATAL] Graceful shutdown exceeded ${graceMs}ms — forcing exit`);
      server.closeAllConnections?.();
      processTarget.exit(1);
    }, graceMs);
    forceExit.unref?.();

    server.close((closeError?: Error) => {
      if (closeError) logger.error("[FATAL] HTTP server close failed", closeError);
      clearTimeout(forceExit);
      processTarget.exit(1);
    });
  });
}
