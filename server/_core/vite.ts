import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";
import { landingPrerenderMiddleware } from "../landingPrerender";

/**
 * [FIX] Cache-Control headers applied to every HTML response.
 *
 * Root cause: iOS Safari aggressively caches SPA HTML in its back/forward cache
 * and page cache. When we deploy a fix (e.g., form→div for iOS Safari validation),
 * users with a cached page never receive the update — they keep seeing the old
 * broken version indefinitely, even after a hard reload.
 *
 * Solution: Set Cache-Control: no-store on every HTML response. This forces
 * Safari (and all browsers) to always fetch a fresh copy of the HTML shell.
 * Static assets (JS/CSS) are still cached via their content-hash filenames.
 */
const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "Pragma": "no-cache",
  "Expires": "0",
  "Surrogate-Control": "no-store",
};

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);

  // ── SSR prerender for bots/crawlers ────────────────────────────────────────
  // Must be registered AFTER vite.middlewares (so Vite handles HMR/assets)
  // but BEFORE the catch-all that serves the SPA shell.
  app.use(landingPrerenderMiddleware);

  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res
        .status(200)
        .set({ "Content-Type": "text/html", ...NO_CACHE_HEADERS })
        .end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public")
      : path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  // ── Hashed static assets: cache for 1 year (immutable) ──────────────────────
  // Vite appends a content hash to every JS/CSS filename (e.g. index-BrGTUamC.js).
  // These files NEVER change for a given hash — safe to cache for 1 year.
  // [PERF] On repeat visits: 0 bytes downloaded for all JS/CSS chunks.
  app.use(
    "/assets",
    express.static(path.resolve(distPath, "assets"), {
      maxAge: "1y",
      immutable: true,
      setHeaders: (res: import('http').ServerResponse) => {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.setHeader("Vary", "Accept-Encoding");
      },
    })
  );

  // ── SSR prerender for bots/crawlers (prod) ────────────────────────────────
  // MUST be mounted BEFORE express.static: static serves index.html for "/"
  // (index option defaults on), which shadows the bot prerender entirely —
  // crawlers would index the SPA shell instead of the landing snapshot.
  app.use(landingPrerenderMiddleware);

  // ── Other static files (favicon, robots.txt, etc.) ───────────────────────────
  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  // [FIX] Apply no-store headers so iOS Safari never serves a stale cached page.
  app.use("*", (_req, res) => {
    res.set({ ...NO_CACHE_HEADERS });
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
