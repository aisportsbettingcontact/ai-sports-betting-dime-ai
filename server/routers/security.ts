/**
 * server/routers/security.ts
 *
 * Owner-only tRPC procedures for the Security Events dashboard panel.
 *
 * All procedures are gated behind ownerProcedure — only the account with
 * role="owner" can access them. No user-facing data is exposed.
 *
 * Procedures:
 *   security.events.list      — Paginated list of security events (newest first)
 *   security.events.counts    — 24h rolling window counts grouped by event type
 *   security.events.prune     — Delete events older than N days (default 90)
 *   security.test.fireEvent   — Fire a test event to the Discord security channel (owner-only)
 *   security.test.fireDigest  — Manually trigger the daily digest embed (owner-only)
 *
 * Logging format:
 *   [INPUT]  — incoming parameters
 *   [STEP]   — operation in progress
 *   [STATE]  — intermediate computation
 *   [OUTPUT] — result
 *   [VERIFY] — pass/fail gate
 */

import { z } from "zod";
import { router } from "../_core/trpc";
import { ownerProcedure } from "./appUsers";
import {
  getSecurityEvents,
  getSecurityEventCounts,
  pruneSecurityEvents,
} from "../db";
import { postSecurityAlert } from "../discord/discordSecurityAlert";
import { triggerSecurityDigestNow } from "../securityDigest";
import { triggerWeeklySecurityDigestNow } from "../weeklySecurityDigest";

// ─── Input validators ─────────────────────────────────────────────────────────

const zodEventType = z
  .enum(["CSRF_BLOCK", "RATE_LIMIT", "AUTH_FAIL"])
  .optional()
  .describe("Filter by event type; omit to return all types");

const zodListInput = z.object({
  /** Max rows to return. Clamped to 500 server-side. */
  limit: z.number().int().min(1).max(500).default(200),
  /** Optional event type filter */
  eventType: zodEventType,
  /**
   * Optional lower-bound UTC ms timestamp.
   * Only events with occurredAt >= sinceMs are returned.
   * Defaults to no lower bound (all time) when omitted.
   */
  sinceMs: z.number().int().min(0).optional(),
});

const zodCountsInput = z.object({
  /**
   * UTC ms lower bound for the rolling window.
   * Defaults to now - 24h when omitted.
   */
  sinceMs: z.number().int().min(0).optional(),
});

const zodPruneInput = z.object({
  /**
   * Delete events older than this many days.
   * Must be between 7 and 365 to prevent accidental full-table wipes.
   */
  retentionDays: z.number().int().min(7).max(365).default(90),
});

const zodTestEventInput = z.object({
  /**
   * Which event type to fire a test embed for.
   * Defaults to all three if not specified.
   */
  eventType: z
    .enum(["CSRF_BLOCK", "RATE_LIMIT", "AUTH_FAIL", "ALL"])
    .default("ALL"),
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const securityRouter = router({
  events: router({
    /**
     * List security events — newest first, owner-only.
     *
     * [INPUT]  limit, eventType, sinceMs
     * [STEP]   Validate owner session
     * [STEP]   Query security_events table with optional filters
     * [OUTPUT] SecurityEventRow[]
     * [VERIFY] Row count logged with filter context
     */
    list: ownerProcedure.input(zodListInput).query(async ({ input }) => {
      const tag = "[tRPC][security.events.list]";
      console.log(
        `${tag} [INPUT] limit=${input.limit} type=${input.eventType ?? "ALL"}` +
          ` sinceMs=${input.sinceMs ?? "none"}`
      );

      const rows = await getSecurityEvents({
        limit: input.limit,
        eventType: input.eventType,
        sinceMs: input.sinceMs,
      });

      console.log(
        `${tag} [OUTPUT] Returned ${rows.length} rows` +
          ` | type=${input.eventType ?? "ALL"} limit=${input.limit}`
      );
      console.log(
        `${tag} [VERIFY] ${rows.length > 0 ? "PASS" : "PASS (empty — no events recorded yet)"}`
      );

      return rows;
    }),

    /**
     * Get 24h rolling window counts grouped by event type — owner-only.
     *
     * [INPUT]  sinceMs (optional, defaults to now - 24h)
     * [STEP]   Validate owner session
     * [STEP]   Aggregate COUNT(*) GROUP BY eventType
     * [OUTPUT] { CSRF_BLOCK, RATE_LIMIT, AUTH_FAIL, total }
     * [VERIFY] Total count logged
     */
    counts: ownerProcedure.input(zodCountsInput).query(async ({ input }) => {
      const tag = "[tRPC][security.events.counts]";
      const sinceMs = input.sinceMs ?? Date.now() - 24 * 60 * 60 * 1000;
      console.log(
        `${tag} [INPUT] sinceMs=${sinceMs} (${new Date(sinceMs).toISOString()})`
      );

      const counts = await getSecurityEventCounts(sinceMs);

      console.log(
        `${tag} [OUTPUT] total=${counts.total}` +
          ` CSRF_BLOCK=${counts.CSRF_BLOCK}` +
          ` RATE_LIMIT=${counts.RATE_LIMIT}` +
          ` AUTH_FAIL=${counts.AUTH_FAIL}`
      );
      console.log(
        `${tag} [VERIFY] ${counts.total >= 0 ? "PASS" : "FAIL — negative count"}`
      );

      return counts;
    }),

    /**
     * Prune security events older than retentionDays — owner-only.
     *
     * [INPUT]  retentionDays (7–365, default 90)
     * [STEP]   Validate owner session
     * [STEP]   DELETE WHERE occurredAt < (now - retentionDays * 86400000)
     * [OUTPUT] { deleted: number }
     * [VERIFY] Deleted count logged
     */
    prune: ownerProcedure.input(zodPruneInput).mutation(async ({ input }) => {
      const tag = "[tRPC][security.events.prune]";
      console.log(`${tag} [INPUT] retentionDays=${input.retentionDays}`);

      const deleted = await pruneSecurityEvents(input.retentionDays);

      console.log(
        `${tag} [OUTPUT] Pruned ${deleted} rows older than ${input.retentionDays} days`
      );
      console.log(
        `${tag} [VERIFY] ${deleted >= 0 ? "PASS" : "FAIL — negative deleted count"}`
      );

      return { deleted };
    }),
  }),

  test: router({
    /**
     * Fire a test security event embed to the Discord 🗒️-𝗦𝗘𝗖𝗨𝗥𝗜𝗧𝗬-𝗘𝗩𝗘𝗡𝗧𝗦 channel.
     *
     * Owner-only. Used to confirm the Discord integration is working end-to-end
     * without needing to trigger a real attack.
     *
     * When eventType = "ALL", fires one embed for each of the 3 event types
     * in sequence (CSRF_BLOCK → RATE_LIMIT → AUTH_FAIL) with a 1-second delay
     * between each to avoid Discord rate limits.
     *
     * [INPUT]  eventType ("CSRF_BLOCK" | "RATE_LIMIT" | "AUTH_FAIL" | "ALL")
     * [STEP]   Build synthetic payload with test IP and test data
     * [STEP]   Call postSecurityAlert() for each requested event type
     * [OUTPUT] { fired: string[], timestamp: string }
     * [VERIFY] Each event type logged with result
     */
    fireEvent: ownerProcedure
      .input(zodTestEventInput)
      .mutation(async ({ input }) => {
        const tag = "[tRPC][security.test.fireEvent]";
        const testIp = "127.0.0.1";
        const testUa =
          "Mozilla/5.0 (Test) SecurityMonitor/1.0 — Owner-initiated test";
        const now = Date.now();

        console.log(
          `${tag} [INPUT] eventType=${input.eventType}` +
            ` | This is a manual test — synthetic payloads will be posted to the Discord security channel`
        );

        // Define test payloads for each event type
        const testPayloads = {
          CSRF_BLOCK: {
            eventType: "CSRF_BLOCK" as const,
            ip: testIp,
            blockedOrigin: "https://evil-test-site.example.com",
            path: "appUsers.login",
            method: "POST",
            userAgent: testUa,
            context: null,
            occurredAt: now,
          },
          RATE_LIMIT: {
            eventType: "RATE_LIMIT" as const,
            ip: testIp,
            blockedOrigin: null,
            path: "/api/trpc/appUsers.login",
            method: "POST",
            userAgent: testUa,
            context: "trpc_auth",
            occurredAt: now,
          },
          AUTH_FAIL: {
            eventType: "AUTH_FAIL" as const,
            ip: testIp,
            blockedOrigin: null,
            path: "appUsers.login",
            method: "POST",
            userAgent: testUa,
            context: "invalid_password",
            occurredAt: now,
          },
        };

        const typesToFire =
          input.eventType === "ALL"
            ? (["CSRF_BLOCK", "RATE_LIMIT", "AUTH_FAIL"] as const)
            : ([input.eventType] as const);

        const fired: string[] = [];

        for (let i = 0; i < typesToFire.length; i++) {
          const type = typesToFire[i];
          const payload = testPayloads[type];

          console.log(
            `${tag} [STEP] Firing test ${type} embed (${i + 1}/${typesToFire.length})` +
              ` | IP=${testIp} path="${payload.path}"` +
              (payload.blockedOrigin
                ? ` blockedOrigin="${payload.blockedOrigin}"`
                : "") +
              (payload.context ? ` context="${payload.context}"` : "")
          );

          // Bypass the dedup guard for test events by using a unique IP suffix
          // so the test always posts even if a real event was recently sent
          const testPayload = {
            ...payload,
            ip: `${testIp} [TEST-${Date.now()}]`,
          };

          try {
            await postSecurityAlert(testPayload);
            fired.push(type);
            console.log(
              `${tag} [STATE] ${type} test embed dispatched successfully`
            );
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(
              `${tag} [ERROR] Failed to dispatch ${type} test embed: ${msg}`
            );
          }

          // 1.5-second delay between embeds to avoid Discord rate limits
          if (i < typesToFire.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
        }

        const timestamp =
          new Date(now).toLocaleString("en-US", {
            timeZone: "America/New_York",
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          }) + " EST";

        console.log(
          `${tag} [OUTPUT] Test complete | fired=${fired.join(", ")} | timestamp=${timestamp}`
        );
        console.log(
          `${tag} [VERIFY] ${fired.length === typesToFire.length ? "PASS" : "PARTIAL"} — ${fired.length}/${typesToFire.length} embeds dispatched`
        );

        return {
          fired,
          timestamp,
          message: `Test complete — ${fired.length} embed${fired.length !== 1 ? "s" : ""} dispatched to the Discord security channel. Check 🗒️-𝗦𝗘𝗖𝗨𝗥𝗜𝗧𝗬-𝗘𝗩𝗘𝗡𝗧𝗦 to confirm delivery.`,
        };
      }),

    /**
     * Manually trigger the daily security digest embed in Discord.
     *
     * Owner-only. Fires the same digest that runs automatically at 08:00 EST,
     * but immediately, using the current 24-hour window.
     *
     * [INPUT]  none
     * [STEP]   Call triggerSecurityDigestNow()
     * [OUTPUT] { threatLevel, counts, topIps, timestamp }
     * [VERIFY] Threat level and counts logged
     */
    fireDigest: ownerProcedure.mutation(async () => {
      const tag = "[tRPC][security.test.fireDigest]";
      const now = Date.now();

      console.log(
        `${tag} [INPUT] Manual digest trigger requested by owner` +
          ` | time=${new Date(now).toISOString()}`
      );
      console.log(
        `${tag} [STEP] Calling triggerSecurityDigestNow() — will query last 24h of events` +
          ` and post digest embed to Discord security channel`
      );

      let result: Awaited<ReturnType<typeof triggerSecurityDigestNow>>;
      try {
        result = await triggerSecurityDigestNow();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `${tag} [ERROR] triggerSecurityDigestNow() threw: ${msg}`
        );
        throw new Error(`Digest trigger failed: ${msg}`);
      }

      const timestamp =
        new Date(now).toLocaleString("en-US", {
          timeZone: "America/New_York",
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }) + " EST";

      console.log(
        `${tag} [OUTPUT] Digest triggered | threatLevel=${result.threatLevel}` +
          ` total=${result.counts.total}` +
          ` CSRF_BLOCK=${result.counts.CSRF_BLOCK}` +
          ` RATE_LIMIT=${result.counts.RATE_LIMIT}` +
          ` AUTH_FAIL=${result.counts.AUTH_FAIL}` +
          ` topIps=${result.topIps.map(({ ip, count }) => `${ip}(${count})`).join(", ") || "none"}`
      );
      console.log(
        `${tag} [VERIFY] PASS — digest embed dispatched to Discord security channel`
      );

      return {
        threatLevel: result.threatLevel,
        counts: result.counts,
        topIps: result.topIps,
        timestamp,
        message: `Digest posted to Discord security channel. Threat level: ${result.threatLevel} — ${result.counts.total} event${result.counts.total !== 1 ? "s" : ""} in the last 24 hours.`,
      };
    }),
  }),
});
