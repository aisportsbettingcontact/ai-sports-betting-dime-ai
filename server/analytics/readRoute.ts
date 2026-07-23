/**
 * readRoute.ts — PRIVATE backend read endpoint for the admin overview. Called
 * only by the web instance's owner-gated proxy over the private line. 404s
 * unless this instance is the store; 401s unless the shared secret matches.
 */
import type { Express, Request, Response } from "express";
import { isAnalyticsStore, getIngestSecret, secretsMatch } from "./config";
import { getAnalyticsOverview } from "./read";

const TAG = "[analytics][readRoute]";

export function registerAnalyticsReadRoute(app: Express): void {
  app.get("/api/internal/analytics/overview", async (req: Request, res: Response) => {
    if (!isAnalyticsStore()) return res.status(404).json({ error: "not_found" });
    const secret = getIngestSecret();
    if (!secret || !secretsMatch(req.header("x-analytics-secret"), secret)) {
      return res.status(401).json({ error: "unauthorized" });
    }
    try {
      const overview = await getAnalyticsOverview();
      return res.status(200).json(overview);
    } catch (err) {
      console.warn(`${TAG} failed: ${(err as Error).message}`);
      return res
        .status(200)
        .json({ state: "error", reason: "overview failed", asOf: Date.now(), deviceMix: [] });
    }
  });
}
