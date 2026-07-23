/**
 * metrics.ts — tRPC router for platform metrics
 *
 * Procedures:
 *   metrics.getSessionMetrics  — DAU / WAU / MAU / avg session duration (each as {state,value,reason})
 *   metrics.getMemberMetrics   — reconciled membership (lifetime + recurring + no-access = total; discord cross-cuts)
 *   metrics.sessionHeartbeat   — client heartbeat ping (every 5 min while logged in)
 *   metrics.openSession        — create session row on login
 *   metrics.closeSession       — close session rows on logout
 */
import { ownerProcedure, appUserProcedure } from "./appUsers";
import { router } from "../_core/trpc";
import {
  getSessionMetrics,
  getMemberMetrics,
  getDurationHistogram,
  heartbeatUserSession,
  createUserSession,
  closeUserSessions,
} from "../db";

export const metricsRouter = router({
  /** Owner-only: DAU / WAU / MAU / avg session duration */
  getSessionMetrics: ownerProcedure.query(async () => {
    const tag = "[tRPC][metrics.getSessionMetrics]";
    console.log(`${tag} [STEP] Fetching session metrics (DAU/WAU/MAU/avgDuration)`);
    const result = await getSessionMetrics();
    console.log(`${tag} [OUTPUT] dau=${result.dau.state}:${result.dau.value} wau=${result.wau.state}:${result.wau.value} mau=${result.mau.state}:${result.mau.value} avgDur=${result.avgSessionDurationMs.state}:${result.avgSessionDurationMs.value}`);
    return result;
  }),

  /** Owner-only: session duration distribution histogram (last 30 days) */
  getDurationHistogram: ownerProcedure.query(async () => {
    const tag = "[tRPC][metrics.getDurationHistogram]";
    console.log(`${tag} [STEP] Fetching session duration histogram`);
    const result = await getDurationHistogram();
    console.log(`${tag} [OUTPUT] under5m=${result.under5m} m5to30=${result.m5to30} m30to120=${result.m30to120} h2to4=${result.h2to4} total=${result.total}`);
    return result;
  }),

  /** Owner-only: member tier counts + Discord connection count */
  getMemberMetrics: ownerProcedure.query(async () => {
    const tag = "[tRPC][metrics.getMemberMetrics]";
    console.log(`${tag} [STEP] Fetching member metrics`);
    const result = await getMemberMetrics();
    console.log(`${tag} [OUTPUT] total=${result.totalMembers} lifetime=${result.lifetime} recurring=${result.recurringPaid} noAccess=${result.noAccess} discord=${result.discordConnected}`);
    return result;
  }),

  /** Authenticated app user: heartbeat ping every 5 min */
  sessionHeartbeat: appUserProcedure.mutation(async ({ ctx }) => {
    const tag = "[tRPC][metrics.sessionHeartbeat]";
    const userId = ctx.appUser.id;
    console.log(`${tag} [INPUT] userId=${userId}`);
    await heartbeatUserSession(userId);
    console.log(`${tag} [OUTPUT] Heartbeat recorded | userId=${userId}`);
    return { ok: true };
  }),

  /** Authenticated app user: open a new session row on login */
  openSession: appUserProcedure.mutation(async ({ ctx }) => {
    const tag = "[tRPC][metrics.openSession]";
    const userId = ctx.appUser.id;
    console.log(`${tag} [INPUT] userId=${userId}`);
    const sessionId = await createUserSession(userId);
    console.log(`${tag} [OUTPUT] sessionId=${sessionId} | userId=${userId}`);
    return { sessionId };
  }),

  /** Authenticated app user: close all open sessions on logout */
  closeSession: appUserProcedure.mutation(async ({ ctx }) => {
    const tag = "[tRPC][metrics.closeSession]";
    const userId = ctx.appUser.id;
    console.log(`${tag} [INPUT] userId=${userId}`);
    await closeUserSessions(userId);
    console.log(`${tag} [OUTPUT] Sessions closed | userId=${userId}`);
    return { ok: true };
  }),
});
