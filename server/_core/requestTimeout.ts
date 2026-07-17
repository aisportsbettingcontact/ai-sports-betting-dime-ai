/**
 * requestTimeout.ts
 *
 * Express-level last-resort timeout — NON-tRPC routes only.
 *
 * INCIDENT 2026-07 (recurring ERR_HTTP_HEADERS_SENT + restart loop after slow
 * /api/trpc/games.list requests): the previous inline middleware in index.ts
 * raced the tRPC adapter for response ownership. When a request exceeded the
 * deadline it wrote its own body, and the tRPC adapter's later setHeader()/end()
 * hit an already-sent response (reproduced end-to-end against the installed
 * @trpc/server 11.11.0 + compression 1.8.1 — see INCIDENTS.md 2026-07-17).
 * Two additional defects compounded it:
 *
 *   1. isTrpc was computed from req.path at TIMER-FIRE time. While a request is
 *      inside the app.use("/api/trpc", ...) mount, Express strips the mount
 *      prefix from req.path, so isTrpc evaluated FALSE for every in-flight tRPC
 *      request and the plain-503 branch fired instead of the tRPC envelope the
 *      comment promised.
 *   2. The timeout body was written via res.json(), which stamps an ETag on a
 *      constant error payload — conditional-request (304) bait for clients.
 *
 * Design now (single-writer rule):
 *   - tRPC requests: this middleware NEVER writes. The procedure-level timeout
 *     in _core/trpc.ts (procedureTimeout) throws TRPCError TIMEOUT, so the tRPC
 *     adapter is the only writer on /api/trpc — no second writer exists.
 *   - Non-tRPC requests: keep the 503 guard, written with raw writeHead/end so
 *     no ETag is generated and no Express freshness (304) logic can engage, plus
 *     Cache-Control: no-store so the error can never be cached.
 */
import type { NextFunction, Request, Response } from "express";

export const NON_TRPC_TIMEOUT_MS = 60_000;

/**
 * Mount-safe tRPC detection. req.originalUrl is never rewritten by Express
 * mounts, unlike req.path/req.url which have the mount prefix stripped while a
 * request is being handled inside app.use("/api/trpc", ...).
 */
export function isTrpcRequest(req: Pick<Request, "originalUrl">): boolean {
  return req.originalUrl.startsWith("/api/trpc");
}

export function createRequestTimeoutMiddleware(opts?: { timeoutMs?: number }) {
  const timeoutMs = opts?.timeoutMs ?? NON_TRPC_TIMEOUT_MS;

  return function requestTimeout(req: Request, res: Response, next: NextFunction): void {
    // Single-writer rule: the tRPC adapter owns /api/trpc responses. The
    // procedure-level timeout in trpc.ts bounds those requests instead.
    if (isTrpcRequest(req)) {
      next();
      return;
    }

    const timeout = setTimeout(() => {
      if (res.headersSent || res.writableEnded) return;
      console.error(`[TIMEOUT] Request timed out: ${req.method} ${req.originalUrl}`);
      // Raw write (NOT res.json): bypasses Express send() so no ETag is stamped
      // and the freshness/304 machinery cannot run on an error response.
      res.writeHead(503, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ error: "Request timeout" }));
    }, timeoutMs);
    timeout.unref?.();

    res.on("finish", () => clearTimeout(timeout));
    res.on("close", () => clearTimeout(timeout));
    next();
  };
}
