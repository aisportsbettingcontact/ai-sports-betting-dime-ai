import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";

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

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  // [FIX] Apply no-store headers so iOS Safari never serves a stale cached page.
  app.use("*", (_req, res) => {
    res.set({ ...NO_CACHE_HEADERS });
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
