import express from "express";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Log-safety coverage for two request-driven log paths that sit on hot,
 * unauthenticated surfaces: the CSRF allowed-origin decision (attacker chooses
 * the Origin header) and the static-asset 404 (attacker chooses the URL path).
 */

const FORGERY_HOST = "x%0A%5BCRITICAL%5D%5BFORGED%5D-owned";

function captureConsole() {
  const lines: string[] = [];
  const sink = (...args: unknown[]) =>
    lines.push(args.map(a => String(a)).join(" "));
  vi.spyOn(console, "log").mockImplementation(sink);
  vi.spyOn(console, "warn").mockImplementation(sink);
  vi.spyOn(console, "error").mockImplementation(sink);
  return lines;
}

function assertNoForgedLines(lines: string[]) {
  for (const line of lines) {
    expect(line).not.toMatch(/[\r\n]/);
  }
}

function selfGet(port: number, urlPath: string): Promise<void> {
  return new Promise(resolve => {
    const req = http.get({ host: "127.0.0.1", port, path: urlPath }, res => {
      res.resume();
      res.on("end", () => resolve());
    });
    req.on("error", () => resolve());
    req.setTimeout(8000, () => {
      req.destroy();
      resolve();
    });
  });
}

describe("origin + static 404 log paths are injection-safe", () => {
  let lines: string[];

  beforeEach(() => {
    lines = captureConsole();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("CSRF suffix-allow logging sanitizes the accepted origin", async () => {
    // ALLOWED_ORIGIN_SUFFIXES is read at module load, so stub before import.
    vi.stubEnv("ALLOWED_ORIGIN_SUFFIXES", ".trusted-suffix.example");
    vi.resetModules();
    const { isOriginAllowed } = await import("./trpc");
    const hostile = `https://evil\n[CRITICAL][FORGED].trusted-suffix.example`;
    isOriginAllowed(hostile);
    assertNoForgedLines(lines);
  }, 20_000);

  it("missing build asset 404 sanitizes the requested path", async () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), "dime-static-"));
    fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
    fs.writeFileSync(path.join(dist, "index.html"), "<!doctype html>");
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test-static";

    const app = express();
    const { serveStatic } = await import("./vite");
    // serveStatic resolves dist relative to import.meta.dirname; point the
    // handler at our temp tree by serving it first, then letting the real
    // 404 guard run for a missing hashed asset.
    app.use(express.static(dist, { index: false }));
    serveStatic(app);
    const server = app.listen(0);
    try {
      const port = (server.address() as { port: number }).port;
      await selfGet(port, `/assets/${FORGERY_HOST}.js`);
      assertNoForgedLines(lines);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      process.env.NODE_ENV = prevEnv;
      fs.rmSync(dist, { recursive: true, force: true });
    }
  }, 20_000);
});
