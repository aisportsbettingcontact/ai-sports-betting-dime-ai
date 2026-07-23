/**
 * ingestRoute.ts — the back office's PRIVATE, secret-gated ingestion endpoint.
 *
 * `POST /api/internal/analytics/ingest` is served ONLY on the store instance
 * (returns 404 elsewhere) and only accepts a request carrying the shared secret
 * (constant-time check). On first use it lazily creates the analytics schema in
 * MySQL: Dime AI, then stores the already-derived event idempotently. The web
 * (forwarder) posts here over private networking; the browser never reaches it.
 */
import type { Express, Request, Response } from "express";
import { getIngestSecret, isAnalyticsStore, secretsMatch } from "./config";
import { ensureAnalyticsSchema, insertAnalyticsEvent, type StoredEvent } from "./store";

const TAG = "[analytics][ingest]";
let schemaEnsured = false;

export function registerAnalyticsIngestRoute(app: Express): void {
  app.post("/api/internal/analytics/ingest", async (req: Request, res: Response) => {
    // Only the back office serves this; the web (forwarder) never does.
    if (!isAnalyticsStore()) {
      res.status(404).json({ ok: false });
      return;
    }
    const secret = getIngestSecret();
    if (!secret || !secretsMatch(req.header("x-analytics-secret"), secret)) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }
    try {
      if (!schemaEnsured) {
        await ensureAnalyticsSchema();
        schemaEnsured = true;
      }
      const e = req.body as StoredEvent;
      if (!e?.eventId || !e?.eventName || typeof e?.sourceUserId !== "number" || typeof e?.occurredAtUtc !== "number") {
        res.status(400).json({ ok: false, error: "bad_event" });
        return;
      }
      const r = await insertAnalyticsEvent(e);
      res.status(202).json({ ok: true, deduped: r.deduped });
    } catch (err) {
      console.error(`${TAG} ${(err as Error).message}`);
      res.status(500).json({ ok: false });
    }
  });
  console.log(`${TAG} route registered (store-role gated)`);
}
