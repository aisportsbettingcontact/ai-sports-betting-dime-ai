/**
 * dispatch.ts — the single place that routes a fully server-derived analytics
 * event by instance role: forward to the back office, store in MySQL: Dime AI,
 * or no-op. Used by BOTH the browser-facing tRPC mutation and server-side
 * emitters (login). Never throws — analytics must not break the product.
 */
import { getAnalyticsRole } from "./config";
import { forwardEvent } from "./forward";
import { insertAnalyticsEvent, type StoredEvent } from "./store";

const TAG = "[analytics][dispatch]";

export async function dispatchStoredEvent(
  event: StoredEvent,
): Promise<{ routed: "forwarded" | "stored" | "disabled" | "error" }> {
  const role = getAnalyticsRole();
  try {
    if (role === "forwarder") {
      await forwardEvent(event);
      return { routed: "forwarded" };
    }
    if (role === "store") {
      await insertAnalyticsEvent(event);
      return { routed: "stored" };
    }
    return { routed: "disabled" };
  } catch (err) {
    console.warn(`${TAG} suppressed: ${(err as Error).message}`);
    return { routed: "error" };
  }
}
