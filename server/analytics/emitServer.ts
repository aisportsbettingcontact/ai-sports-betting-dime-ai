/**
 * emitServer.ts — emit an analytics event from SERVER code (no browser round
 * trip), e.g. the authoritative `login`. Device is derived from the request UA
 * only (no client viewport). Server-derives identity/received_at/environment.
 * Routes by role via dispatchStoredEvent. Fire-and-forget; never throws.
 */
import { randomUUID } from "node:crypto";
import { deriveDeviceFromUA } from "./device";
import { dispatchStoredEvent } from "./dispatch";
import { isTestUser } from "./config";
import type { StoredEvent } from "./store";

export async function emitServerEvent(opts: {
  eventName: string;
  userId: number;
  userAgent?: string | null;
  sessionId?: string | null;
  props?: Record<string, string | number | boolean> | null;
}): Promise<void> {
  try {
    if (!Number.isFinite(opts.userId)) return;
    const ua = deriveDeviceFromUA(opts.userAgent);
    const event: StoredEvent = {
      eventId: randomUUID(),
      eventName: opts.eventName,
      schemaVersion: 1,
      definitionVersion: 1,
      sourceUserId: opts.userId,
      sessionId: opts.sessionId ?? null,
      surface: "server",
      deviceType: ua.deviceType,
      osFamily: ua.osFamily,
      browserFamily: ua.browserFamily,
      occurredAtUtc: Date.now(),
      environment: process.env.NODE_ENV ?? "production",
      appVersion: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
      isTest: isTestUser(opts.userId),
      props: opts.props ?? null,
    };
    await dispatchStoredEvent(event);
  } catch {
    /* analytics must never break auth */
  }
}
