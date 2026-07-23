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
import { appUserProcedure, ownerProcedure } from "./appUsers";
import { router } from "../_core/trpc";
import { trackInputSchema, sanitizeProps } from "../analytics/events";
import { isTestUser, getAnalyticsRole } from "../analytics/config";
import { deriveDeviceFromUA, reconcileDeviceType } from "../analytics/device";
import { sanitizeRoutePattern } from "../analytics/routePattern";
import { dispatchStoredEvent } from "../analytics/dispatch";
import { getAnalyticsOverview, disabledOverview } from "../analytics/read";
import { forwardOverviewRead } from "../analytics/readForward";
import type { StoredEvent } from "../analytics/store";

export const analyticsRouter = router({
  track: appUserProcedure.input(trackInputSchema).mutation(async ({ ctx, input }) => {
    const ua = ctx.req?.headers?.["user-agent"];
    const uaDevice = deriveDeviceFromUA(Array.isArray(ua) ? ua[0] : ua);
    const reconciled = reconcileDeviceType(uaDevice.deviceType, uaDevice.osFamily, input.pointerType, input.viewportClass);
    const event: StoredEvent = {
      eventId: input.eventId,
      eventName: input.eventName,
      schemaVersion: input.schemaVersion,
      definitionVersion: 1,
      sourceUserId: ctx.appUser.id,
      sessionId: input.sessionId ?? null,
      tabId: input.tabId ?? null,
      featureId: input.featureId ?? null,
      actionName: input.actionName ?? null,
      route: sanitizeRoutePattern(input.route),
      surface: input.surface,
      outcome: input.outcome ?? null,
      deviceType: reconciled.deviceType,
      osFamily: uaDevice.osFamily,
      browserFamily: uaDevice.browserFamily,
      appSurface: input.appSurface ?? null,
      viewportClass: input.viewportClass ?? null,
      orientation: input.orientation ?? null,
      isTouch: input.isTouch ?? null,
      isStandalone: input.isStandalone ?? null,
      connectionClass: input.connectionClass ?? null,
      occurredAtUtc: input.occurredAtUtc,
      environment: process.env.NODE_ENV ?? "production",
      appVersion: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
      isTest: isTestUser(ctx.appUser.id),
      props: reconciled.conflict
        ? { ...(sanitizeProps(input.props) ?? {}), device_conflict: true }
        : sanitizeProps(input.props),
    };
    const r = await dispatchStoredEvent(event);
    return { ok: true as const, routed: r.routed };
  }),

  // Owner-only device-aware overview. Role-routes: forwarder proxies to the back
  // office, store queries MySQL: Dime AI, disabled returns honest not_measured.
  // Never throws — analytics reads must not break the admin page.
  overview: ownerProcedure.query(async () => {
    const role = getAnalyticsRole();
    try {
      if (role === "forwarder") return await forwardOverviewRead();
      if (role === "store") return await getAnalyticsOverview();
      return disabledOverview("analytics pipeline disabled");
    } catch {
      return disabledOverview("analytics overview unavailable");
    }
  }),
});
