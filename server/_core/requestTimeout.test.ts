/**
 * requestTimeout.test.ts
 *
 * Regression suite for the 2026-07 production incident: recurring
 * ERR_HTTP_HEADERS_SENT (and process-fatal restarts via fatalErrorHandler)
 * caused by the express-level timeout middleware racing the tRPC adapter for
 * response ownership on slow /api/trpc requests (INCIDENTS.md 2026-07-17).
 *
 * Invariants pinned here:
 *  [SW-1] tRPC path: the adapter is the ONLY writer. A procedure slower than
 *         its timeout yields exactly one well-formed TRPCError TIMEOUT
 *         response, and when the slow procedure later resolves, NO second
 *         write occurs: no ERR_HTTP_HEADERS_SENT surfaces through onError and
 *         no 'error' is emitted on the response stream.
 *  [SW-2] The express middleware never writes on /api/trpc requests, and its
 *         tRPC detection is mount-safe (req.originalUrl, not the
 *         mount-stripped req.path that broke the legacy version).
 *  [SW-3] Non-tRPC path: slow routes get a 503 {"error":"Request timeout"}
 *         with Cache-Control: no-store and NO ETag (the legacy res.json()
 *         writer stamped an ETag on a constant error body — conditional-304
 *         bait), and a handler completing later does not crash the process.
 *  [SW-4] Legacy-defect documentation: the OLD interleaving (express writer
 *         first, adapter second) demonstrably produces ERR_HTTP_HEADERS_SENT —
 *         proving the mechanism the fix removes.
 *  [SW-5] The client-facing timeout message keeps the "Request timed out"
 *         phrasing that client/src/lib/errorUtils.ts [CHECK 6] maps.
 */
import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import compression from "compression";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { initTRPC } from "@trpc/server";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import superjson from "superjson";
import {
  createRequestTimeoutMiddleware,
  isTrpcRequest,
} from "./requestTimeout";
import { procedureTimeoutRace, PROCEDURE_TIMEOUT_MS } from "./trpc";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Harness = {
  server: Server;
  base: string;
  onErrorCauses: string[];
  resStreamErrors: string[];
};

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) => new Promise<void>((resolve) => s.close(() => resolve())),
    ),
  );
});

/**
 * Builds an express app mirroring the production middleware order
 * (compression → timeout middleware → tRPC adapter) with a procedure-level
 * timeout built from the SAME exported race helper trpc.ts uses.
 */
function buildHarness(opts: {
  procedureDelayMs: number;
  procedureTimeoutMs: number;
  expressTimeoutMs: number;
  legacyExpressWriter?: boolean;
}): Promise<Harness> {
  const t = initTRPC.create({ transformer: superjson });
  const slowProcedure = t.procedure
    .use(({ next, path }) =>
      procedureTimeoutRace(next, opts.procedureTimeoutMs, path),
    )
    .query(async () => {
      await sleep(opts.procedureDelayMs);
      return { games: ["slow-db-result"] };
    });
  const appRouter = t.router({ games: t.router({ list: slowProcedure }) });

  const onErrorCauses: string[] = [];
  const resStreamErrors: string[] = [];

  const app = express();
  app.use(compression({ threshold: 512 }));
  app.use((req, res, next) => {
    res.on("error", (err: NodeJS.ErrnoException) =>
      resStreamErrors.push(String(err.code ?? err.message)),
    );
    next();
  });

  if (opts.legacyExpressWriter) {
    // [SW-4] The defective pre-fix middleware, verbatim mechanism: races the
    // adapter and writes its own body on timeout.
    app.use((req, res, next) => {
      const timeout = setTimeout(() => {
        if (!res.headersSent) {
          res.status(503).json({ error: "Request timeout" });
        }
      }, opts.expressTimeoutMs);
      res.on("finish", () => clearTimeout(timeout));
      res.on("close", () => clearTimeout(timeout));
      next();
    });
  } else {
    app.use(createRequestTimeoutMiddleware({ timeoutMs: opts.expressTimeoutMs }));
  }

  // Non-tRPC slow route for [SW-3]
  app.get("/api/scheduled/slow-heartbeat", async (_req, res) => {
    await sleep(opts.procedureDelayMs);
    try {
      res.json({ ok: true });
    } catch {
      // late-writer errors must stay contained — never crash the process
    }
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext: () => ({}),
      onError: ({ error }) => {
        const cause = error.cause as NodeJS.ErrnoException | undefined;
        onErrorCauses.push(String(cause?.code ?? error.code));
      },
    }),
  );

  const server = createServer(app);
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        server,
        base: `http://127.0.0.1:${port}`,
        onErrorCauses,
        resStreamErrors,
      });
    });
  });
}

const TRPC_URL = (base: string) =>
  `${base}/api/trpc/games.list?batch=1&input=${encodeURIComponent('{"0":{"json":null}}')}`;

describe("request timeout — single-writer rule (2026-07 incident regression)", () => {
  it("[SW-1] slow tRPC procedure: adapter writes exactly one TIMEOUT envelope; no second-writer errors", async () => {
    const h = await buildHarness({
      procedureDelayMs: 300,
      procedureTimeoutMs: 100,
      expressTimeoutMs: 120,
    });

    const res = await fetch(TRPC_URL(h.base));
    const body = await res.text();

    // Adapter-written TIMEOUT error (single writer)
    expect(res.status).toBe(408);
    expect(body).toContain("TIMEOUT");
    // [SW-5] client errorUtils CHECK 6 phrasing
    expect(body).toContain("Request timed out");
    // No ETag on the error envelope (legacy 304-bait regression)
    expect(res.headers.get("etag")).toBeNull();

    // Let the slow procedure resolve after the response was written…
    await sleep(400);
    // …and assert no second write happened anywhere in the stack.
    expect(h.onErrorCauses.filter((c) => c === "ERR_HTTP_HEADERS_SENT")).toHaveLength(0);
    expect(h.onErrorCauses.filter((c) => c === "ERR_STREAM_WRITE_AFTER_END")).toHaveLength(0);
    expect(h.resStreamErrors).toHaveLength(0);
  });

  it("[SW-1b] fast tRPC procedure is unaffected", async () => {
    const h = await buildHarness({
      procedureDelayMs: 10,
      procedureTimeoutMs: 500,
      expressTimeoutMs: 500,
    });
    const res = await fetch(TRPC_URL(h.base));
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain("slow-db-result");
    expect(h.onErrorCauses).toHaveLength(0);
  });

  it("[SW-2] express middleware never writes on tRPC paths and detection is mount-safe", async () => {
    // Unit: the legacy defect — inside the /api/trpc mount, req.path has the
    // prefix stripped; originalUrl does not.
    expect(isTrpcRequest({ originalUrl: "/api/trpc/games.list?batch=1" })).toBe(true);
    expect(isTrpcRequest({ originalUrl: "/api/scheduled/fg-lineups" })).toBe(false);

    // Integration: express timeout far shorter than the procedure timeout —
    // if the express layer wrote first (legacy behavior), the response would be
    // its 503; the adapter's 408 proves the express layer stayed silent.
    const h = await buildHarness({
      procedureDelayMs: 300,
      procedureTimeoutMs: 150,
      expressTimeoutMs: 30,
    });
    const res = await fetch(TRPC_URL(h.base));
    expect(res.status).toBe(408);
    await sleep(400);
    expect(h.onErrorCauses.filter((c) => c === "ERR_HTTP_HEADERS_SENT")).toHaveLength(0);
  });

  it("[SW-3] slow non-tRPC route: 503, no-store, no ETag, and no crash when the handler completes late", async () => {
    const h = await buildHarness({
      procedureDelayMs: 250,
      procedureTimeoutMs: 500,
      expressTimeoutMs: 80,
    });
    const res = await fetch(`${h.base}/api/scheduled/slow-heartbeat`);
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body).toEqual({ error: "Request timeout" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("etag")).toBeNull();
    await sleep(350); // handler's late res.json fires; must not emit stream errors
    expect(h.resStreamErrors).toHaveLength(0);
  });

  it("[SW-4] legacy interleaving reproduces ERR_HTTP_HEADERS_SENT (the defect the fix removes)", async () => {
    const h = await buildHarness({
      procedureDelayMs: 250,
      procedureTimeoutMs: 10_000, // procedure timeout out of the picture
      expressTimeoutMs: 60,
      legacyExpressWriter: true,
    });
    const res = await fetch(TRPC_URL(h.base));
    expect(res.status).toBe(503); // legacy writer answered first
    await sleep(400); // adapter then collides with the already-sent response
    expect(
      h.onErrorCauses.filter((c) => c === "ERR_HTTP_HEADERS_SENT").length,
    ).toBeGreaterThan(0);
  });

  it("procedure timeout constant stays under the 60s express guard", () => {
    expect(PROCEDURE_TIMEOUT_MS).toBeLessThan(60_000);
  });
});
