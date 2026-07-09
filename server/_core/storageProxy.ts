import type { Express } from "express";
import path from "path";
import fs from "fs";
import { ENV } from "./env";

/**
 * /manus-storage/* asset resolution — LOCAL-FIRST, Forge fallback.
 *
 * The five brand/feature images historically lived only in Manus Forge
 * storage, which made the app depend on the Manus platform at runtime
 * (on Railway the proxy 500'd and every logo broke). They are now vendored
 * into client/public/manus-storage/ and served from the local build on ANY
 * host. The Forge proxy remains as a fallback for keys that are not
 * vendored, so the Manus deployment keeps working unchanged — the two
 * tracks stay separate and parallel.
 *
 * LOGGING:
 *   [StorageProxy][LOCAL]  - served from the vendored build directory
 *   [StorageProxy][FORGE]  - fell back to a signed Forge URL
 *   [StorageProxy][MISS]   - not vendored and Forge not configured (404)
 */
export function registerStorageProxy(app: Express) {
  // Same resolution as serveStatic() in vite.ts — both files live in server/_core.
  const localDir =
    process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public", "manus-storage")
      : path.resolve(import.meta.dirname, "public", "manus-storage");

  app.get("/manus-storage/*", async (req: import("express").Request, res: import("express").Response) => {
    // Extract the key from the path: /manus-storage/{key}
    const key = req.path.replace(/^\/manus-storage\//, "");
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }

    // ── Local-first: vendored assets ship in the build ──────────────────────
    // Traversal guard: resolve and require the result to stay inside localDir.
    const candidate = path.resolve(localDir, key);
    if (candidate.startsWith(localDir + path.sep) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      console.log(`[StorageProxy][LOCAL] ${key} → vendored file`);
      res.set("Cache-Control", "public, max-age=86400");
      res.sendFile(candidate);
      return;
    }

    // ── Forge fallback (Manus-hosted deployments) ────────────────────────────
    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      console.warn(`[StorageProxy][MISS] ${key} — not vendored and Forge not configured`);
      res.status(404).send("Asset not found");
      return;
    }
    try {
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/",
      );
      forgeUrl.searchParams.set("path", key);
      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` },
      });
      if (!forgeResp.ok) {
        const body = await forgeResp.text().catch(() => "");
        console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
        res.status(502).send("Storage backend error");
        return;
      }
      const { url } = (await forgeResp.json()) as { url: string };
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }
      console.log(`[StorageProxy][FORGE] ${key} → signed URL redirect`);
      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}
