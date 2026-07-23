import type { Express } from "express";
import path from "path";
import fs from "fs";

/**
 * /dime-storage/* asset resolution — LOCAL, vendored-only.
 *
 * The brand/feature images are vendored into client/public/dime-storage/ and
 * served from the local build on ANY host. Non-vendored keys 404 — the app has
 * no runtime dependency on any third-party asset host.
 *
 * LOGGING:
 *   [StorageProxy][LOCAL]  - served from the vendored build directory
 *   [StorageProxy][MISS]   - not vendored (404)
 */
export function registerStorageProxy(app: Express) {
  // Same resolution as serveStatic() in vite.ts — both files live in server/_core.
  const localDir =
    process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public", "dime-storage")
      : path.resolve(import.meta.dirname, "public", "dime-storage");

  app.get("/dime-storage/*", (req: import("express").Request, res: import("express").Response) => {
    // Extract the key from the path: /dime-storage/{key}
    const key = req.path.replace(/^\/dime-storage\//, "");
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }

    // Traversal guard: resolve and require the result to stay inside localDir.
    const candidate = path.resolve(localDir, key);
    if (
      candidate.startsWith(localDir + path.sep) &&
      fs.existsSync(candidate) &&
      fs.statSync(candidate).isFile()
    ) {
      console.log(`[StorageProxy][LOCAL] ${key} → vendored file`);
      res.set("Cache-Control", "public, max-age=86400");
      res.sendFile(candidate);
      return;
    }

    console.warn(`[StorageProxy][MISS] ${key} — not vendored`);
    res.status(404).send("Asset not found");
  });
}
