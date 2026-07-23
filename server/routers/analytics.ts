/**
 * analytics.ts — browser-facing tRPC entry for the User Activity pipeline.
 *
 * `analytics.track` runs on the STORE/web instance (where the browser talks). It
 * derives the pseudonymous identity server-side (ctx.appUser.id) and routes by
 * role: forward to the back office (forwarder), store locally (store), or no-op
 * (disabled). It NEVER throws — analytics must never break the product workflow.
 * Client-supplied identity/entitlement is ignored; only the validated envelope
 * (event name allowlist + schema version + bounded props) is accepted.
 */
import { appUserProcedure } from "./appUsers";
import { router } from "../_core/trpc";
import { trackInputSchema, sanitizeProps } from "../analytics/events";
import { getAnalyticsRole, isTestUser } from "../analytics/config";
import { forwardEvent } from "../analytics/forward";
import { insertAnalyticsEvent, type StoredEvent } from "../analytics/store";

const TAG = "[tRPC][analytics.track]";

export const analyticsRouter = router({
  track: appUserProcedure.input(trackInputSchema).mutation(async ({ ctx, input }) => {
    // Server-authoritative fields — client claims never trusted.
    const event: StoredEvent = {
      eventId: input.eventId,
      eventName: input.eventName,
      schemaVersion: input.schemaVersion,
      definitionVersion: 1,
      sourceUserId: ctx.appUser.id,
      sessionId: input.sessionId ?? null,
      tabId: input.tabId ?? null,
      featureId: input.featureId ?? null,
      surface: input.surface,
      outcome: input.outcome ?? null,
      occurredAtUtc: input.occurredAtUtc,
      environment: process.env.NODE_ENV ?? "production",
      appVersion: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
      isTest: isTestUser(ctx.appUser.id),
      props: sanitizeProps(input.props),
    };

    const role = getAnalyticsRole();
    try {
      if (role === "forwarder") {
        const r = await forwardEvent(event);
        return { ok: true as const, routed: "forwarded" as const, accepted: r.ok };
      }
      if (role === "store") {
        const r = await insertAnalyticsEvent(event);
        return { ok: true as const, routed: "stored" as const, deduped: r.deduped };
      }
      return { ok: true as const, routed: "disabled" as const };
    } catch (err) {
      // Suppress — analytics failure must never surface to the product.
      console.warn(`${TAG} suppressed: ${(err as Error).message}`);
      return { ok: true as const, routed: "error" as const };
    }
  }),
});
