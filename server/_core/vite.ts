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
  // MUST be mounted BEFORE express.static: static's default `index` option
  // would otherwise auto-serve index.html for "/" (shadowing the bot
  // prerender entirely — crawlers would index the SPA shell instead of the
  // landing snapshot). `index: false` below closes that hole too, but keep
  // the ordering regardless — this middleware must stay first.
  app.use(landingPrerenderMiddleware);

  // ── Other static files (favicon, robots.txt, etc.) ───────────────────────────
  // [FIX 2026-07-22 stale-bfcache incident] `index: false` stops this
  // middleware from auto-serving index.html for "/" with its own weak
  // `Cache-Control: public, max-age=0` — that request now falls through to
  // the no-store catch-all below, same as every other SPA route.
  //
  // Root cause: express.static's default `index: 'index.html'` made "/" the
  // one HTML-serving route in the app that stayed bfcache-eligible (every
  // other route already got NO_CACHE_HEADERS below). A tab that last loaded
  // the bare domain root before a deploy, then restored via browser
  // back/forward or tab/session restore after the deploy shipped, could get
  // served a frozen pre-deploy page straight from bfcache — old JS, zero
  // network requests, nothing in server logs. `index: false` only disables
  // the directory-index auto-serve; a literal "/index.html" request still
  // matches this middleware by filename, so `setHeaders` guards that path
  // explicitly too.
  app.use(
    express.static(distPath, {
      index: false,
      setHeaders: (res: import('http').ServerResponse, filePath: string) => {
        if (path.basename(filePath) === "index.html") {
          for (const [key, value] of Object.entries(NO_CACHE_HEADERS)) {
            res.setHeader(key, value);
          }
        }
      },
    })
  );

  // ── Missing build assets must 404, never fall through to index.html ─────────
  // [FIX 2026-07-31 stale-chunk incident]
  //
  // Vite code-splits routes into content-hashed chunks. A deploy replaces those
  // filenames wholesale, so a browser that loaded the app BEFORE the deploy still
  // holds references to the old ones. When it lazily imports a route, it requests
  // a chunk that no longer exists — and the SPA catch-all below answered with
  // `200 text/html` (index.html). The browser then tried to parse HTML as an ES
  // module and threw:
  //
  //   TypeError: Failed to fetch dynamically imported module: /assets/Home-<hash>.js
  //
  // which surfaced to users as a hard "Something broke on this screen." That is
  // the catch-all lying: the asset is genuinely gone, so say so. A truthful 404
  // (a) stops the browser mis-parsing HTML as JavaScript, and (b) gives the
  // client a signal it can actually recognise and recover from — see the
  // stale-chunk reload guard in client/src/main.tsx.
  //
  // Scoped to build-output paths only. HTML routes must still fall through, or
  // deep links like /admin/users would 404 instead of booting the SPA.
  const BUILD_ASSET_PATH = /^\/assets\//;
  const STATIC_FILE_EXT = /\.(?:js|mjs|cjs|css|map|json|wasm|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|webp|avif|ico|mp4|webm)$/i;

  app.use("*", (req, res) => {
    const pathname = req.originalUrl.split("?")[0];
    if (BUILD_ASSET_PATH.test(pathname) || STATIC_FILE_EXT.test(pathname)) {
      console.warn(`[Static] 404 missing asset ${pathname} — stale client chunk or bad reference`);
      res.status(404).type("text/plain").send("Not found");
      return;
    }
    // SPA route: serve the shell. no-store so iOS Safari never restores a stale
    // pre-deploy page from bfcache.
    res.set({ ...NO_CACHE_HEADERS });
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
