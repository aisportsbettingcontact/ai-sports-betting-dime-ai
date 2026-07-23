/**
 * readForward.ts — the web (forwarder) fetches the admin overview from the back
 * office over the PRIVATE line, authenticated with the shared secret. Server-to-
 * server only; never throws — a failed read degrades to an honest not_measured.
 */
import { getBackendUrl, getIngestSecret } from "./config";
import { disabledOverview, type AnalyticsOverview } from "./read";

const TAG = "[analytics][readForward]";

export async function forwardOverviewRead(
  fetchImpl: typeof fetch = fetch,
): Promise<AnalyticsOverview> {
  const base = getBackendUrl();
  const secret = getIngestSecret();
  if (!base || !secret) return disabledOverview("analytics backend not configured");
  try {
    const res = await fetchImpl(`${base}/api/internal/analytics/overview`, {
      method: "GET",
      headers: { "x-analytics-secret": secret },
    });
    if (!res.ok) {
      console.warn(`${TAG} back office returned ${res.status}`);
      return disabledOverview(`analytics backend returned ${res.status}`);
    }
    return (await res.json()) as AnalyticsOverview;
  } catch (err) {
    console.warn(`${TAG} read failed: ${(err as Error).message}`);
    return { ...disabledOverview("analytics backend unreachable"), state: "error" };
  }
}
