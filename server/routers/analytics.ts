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
import { getAnalyticsOverview, disabledOverview, type AnalyticsOverview } from "../analytics/read";
import { forwardOverviewRead } from "../analytics/readForward";
import { isStaffRole } from "../analytics/metricDefinitions";
import { getAppUsersByIds } from "../db";
import type { StoredEvent } from "../analytics/store";

/**
 * Read-time identity join (owner-only). Enriches pseudonymous per-user rows with
 * display identity (username / discord / role) from app_users on the WEB instance
 * — PII is never persisted in the analytics store. Best-effort: any failure just
 * leaves the rows pseudonymous. Never throws.
 */
async function enrichTopUsers(o: AnalyticsOverview): Promise<AnalyticsOverview> {
  if (!o.topUsers?.length) return o;
  try {
    const ids = o.topUsers.map((u) => u.sourceUserId).filter((n) => Number.isFinite(n) && n > 0);
    const users = await getAppUsersByIds(ids);
    if (!users.length) return o;
    const byId = new Map(users.map((u) => [u.id, u]));
    return {
      ...o,
      topUsers: o.topUsers.map((u) => {
        const m = byId.get(u.sourceUserId);
        return m ? { ...u, username: m.username, discordUsername: m.discordUsername, role: m.role } : u;
      }),
    };
  } catch {
    return o;
  }
}

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
      // Exclude staff (owner/admin) AND canary test ids from real metrics — write-time.
      isTest: isTestUser(ctx.appUser.id) || isStaffRole(ctx.appUser.role),
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
      let payload: AnalyticsOverview;
      if (role === "forwarder") payload = await forwardOverviewRead();
      else if (role === "store") payload = await getAnalyticsOverview();
      else return disabledOverview("analytics pipeline disabled");
      // Owner-only read-time identity join (web instance has app_users).
      return await enrichTopUsers(payload);
    } catch {
      return disabledOverview("analytics overview unavailable");
    }
  }),
});
