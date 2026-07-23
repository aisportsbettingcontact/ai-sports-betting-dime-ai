/**
 * forward.ts — the store/web instance forwards a fully-derived event to the back
 * office over the PRIVATE line (USER_ACTIVITY_BACKEND_URL), authenticated with
 * the shared secret. Server-to-server only; the browser never does this. Never
 * throws — analytics delivery must never break the product.
 */
import { getBackendUrl, getIngestSecret } from "./config";
import type { StoredEvent } from "./store";

const TAG = "[analytics][forward]";

export async function forwardEvent(
  event: StoredEvent,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; reason?: string }> {
  const base = getBackendUrl();
  const secret = getIngestSecret();
  if (!base || !secret) {
    console.warn(`${TAG} not configured (backend URL / secret missing)`);
    return { ok: false, reason: "not_configured" };
  }
  try {
    const res = await fetchImpl(`${base}/api/internal/analytics/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-analytics-secret": secret },
      body: JSON.stringify(event),
    });
    if (!res.ok) console.warn(`${TAG} back office returned ${res.status}`);
    return { ok: res.ok, reason: res.ok ? undefined : `status_${res.status}` };
  } catch (err) {
    console.warn(`${TAG} forward failed: ${(err as Error).message}`);
    return { ok: false, reason: "network" };
  }
}
