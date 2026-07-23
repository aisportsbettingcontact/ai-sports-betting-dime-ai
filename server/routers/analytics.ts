/**
 * analytics.ts — tRPC router for the analytics event-ingestion seam.
 *
 * Procedures:
 *   analytics.track — accept ONE product-analytics event from an authenticated
 *                     app user. Ingestion-only; emitters are a future phase.
 *
 * SECURITY / IDENTITY CONTRACT:
 *   - `appUserProcedure` — only authenticated app users may emit.
 *   - `subjectId` is derived SERVER-SIDE from `ctx.appUser.id`. Any client-supplied
 *     subjectId / userId / role / entitlement / consent / payment field is stripped
 *     by the zod schema (`parseTrackInput`) and never reaches the store.
 *   - `environment` is derived SERVER-SIDE from NODE_ENV, not from the client.
 *   - Event name must be in the hardcoded ALLOWLIST; `schemaVersion` is required.
 *   - Payload is bounded (short strings, allowlisted scalar props).
 *
 * See docs/superpowers/evidence/2026-07-23-event-dictionary.md for the contract.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router } from "../_core/trpc";
import { appUserProcedure } from "./appUsers";
import { parseTrackInput, insertAnalyticsEvent } from "../analytics/eventStore";

export const analyticsRouter = router({
  /**
   * Authenticated app user: record a single analytics event.
   * Idempotent by client-supplied `eventId`. Returns { ok, deduped }.
   */
  track: appUserProcedure
    // Loose input boundary — the authoritative allowlist/shape check happens in
    // parseTrackInput. `.passthrough()` lets forged identity keys arrive so we can
    // demonstrably STRIP them there rather than trust the client boundary.
    .input(z.object({}).passthrough())
    .mutation(async ({ ctx, input }) => {
      const tag = "[tRPC][analytics.track]";

      // Pure, server-authoritative validation + sanitization. Throws ZodError on
      // unknown event name or missing schemaVersion; strips forged/sensitive fields.
      let sanitized;
      try {
        sanitized = parseTrackInput(input);
      } catch (err) {
        console.log(`${tag} [REJECT] invalid payload | userId=${ctx.appUser.id}`);
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid analytics event",
          cause: err,
        });
      }

      // Identity + environment are ALWAYS server-derived here — never from client.
      const subjectId = ctx.appUser.id;
      const environment = process.env.NODE_ENV ?? "development";

      const result = await insertAnalyticsEvent({
        ...sanitized,
        subjectId,
        environment,
      });

      console.log(
        `${tag} [OK] event=${sanitized.eventName} v=${sanitized.schemaVersion} ` +
          `subjectId=${subjectId} deduped=${result.deduped}`,
      );
      return { ok: true as const, deduped: result.deduped };
    }),
});
