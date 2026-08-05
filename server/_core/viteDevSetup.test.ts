import express from "express";
import { createServer } from "http";
import { afterEach, describe, expect, it, vi } from "vitest";

// setupVite lazy-loads its dev-only dependencies (vite + vite.config) via
// dynamic imports — a static import would crash the production image at ESM
// link time, because the multi-stage Dockerfile ships prod deps only (the
// 2026-08-05 09-gate boot failure). This suite executes that lazy path with
// "vite" mocked, proving the wiring works without the real dev server.
const createViteServerMock = vi.fn(async () => ({
  middlewares: (_req: unknown, _res: unknown, next: () => void) => next(),
  transformIndexHtml: async (_url: string, html: string) => html,
  ssrFixStacktrace: () => {},
}));

vi.mock("vite", () => ({
  createServer: createViteServerMock,
  createLogger: () => ({ info() {}, warn() {}, error() {} }),
  // vite.config.ts (lazy-loaded by setupVite) calls defineConfig at import
  // time — the identity passthrough mirrors the real one.
  defineConfig: (config: unknown) => config,
}));

describe("setupVite — dev-only lazy loading", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("boots the dev middleware through dynamic imports and mounts the catch-all", async () => {
    const { setupVite } = await import("./vite");
    const app = express();
    const httpServer = createServer(app);
    const mountedBefore = app._router?.stack?.length ?? 0;

    await setupVite(app, httpServer);

    expect(createViteServerMock).toHaveBeenCalledTimes(1);
    const config = createViteServerMock.mock.calls[0]?.[0] as
      Record<string, unknown> | undefined;
    expect(config).toBeDefined();
    // middlewareMode + custom appType are what make this an embedded dev
    // server instead of a standalone one — regressions here break `pnpm dev`.
    expect(config?.server).toMatchObject({ middlewareMode: true });
    expect(config?.appType).toBe("custom");
    // vite.config was lazy-loaded and spread into the dev-server config —
    // the real config always carries plugins.
    expect(Array.isArray(config?.plugins)).toBe(true);

    const mountedAfter = app._router?.stack?.length ?? 0;
    expect(mountedAfter).toBeGreaterThan(mountedBefore);

    await new Promise<void>(resolve => httpServer.close(() => resolve()));
  }, 30_000);
});
