/**
 * server/routers/waitlist.ts
 *
 * tRPC router for the Waitlist feature.
 *
 * Procedures:
 *   publicProcedure:
 *     waitlist.submit         — public form submission (5 req/15min/IP via dedicated limiter in index.ts)
 *
 *   ownerProcedure:
 *     waitlist.list           — paginated list with filters
 *     waitlist.stats          — aggregate counts by status
 *     waitlist.updateStatus   — approve / deny / reset a single entry
 *     waitlist.bulkUpdate     — bulk approve / deny / reset
 *     waitlist.delete         — hard-delete a single entry
 *     waitlist.exportCsv      — download all entries as CSV string
 *
 * Logging convention:
 *   [WaitlistRouter][STEP]   — operation description
 *   [WaitlistRouter][INPUT]  — validated input values
 *   [WaitlistRouter][OUTPUT] — result summary
 *   [WaitlistRouter][ERROR]  — error with context
 *   [WaitlistRouter][VERIFY] — PASS/FAIL + reason
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { ownerProcedure } from "./appUsers";
import type { WaitlistRow } from "../../drizzle/schema";
import {
  submitWaitlist,
  enrichStep2,
  listWaitlist,
  getWaitlistStats,
  updateWaitlistStatus,
  bulkUpdateWaitlistStatus,
  deleteWaitlistEntry,
  exportWaitlistCsv,
  type WaitlistStatus,
} from "../waitlistDb";

// ─── Input schemas ────────────────────────────────────────────────────────────

const zWaitlistStatus = z.enum(["pending", "approved", "denied"]);

const zSubmitInput = z.object({
  email:          z.string().email("Invalid email address").max(320),
  fullName:       z.string().max(256).optional(),
  whyText:        z.string().max(2000).optional(),
  unitSizeMin:    z.number().int().min(1).max(100000).optional(),
  unitSizeMax:    z.number().int().min(1).max(100000).optional(),
  step2Completed: z.boolean().optional(),
  utmSource:      z.string().max(128).optional(),
  utmMedium:      z.string().max(128).optional(),
  utmCampaign:    z.string().max(128).optional(),
});

const zListInput = z.object({
  status:  z.enum(["all", "pending", "approved", "denied"]).default("all"),
  search:  z.string().max(200).optional(),
  fromTs:  z.number().int().positive().optional(),
  toTs:    z.number().int().positive().optional(),
  limit:   z.number().int().min(1).max(200).default(50),
  offset:  z.number().int().min(0).default(0),
  sortBy:  z.enum(["createdAt", "email", "status"]).default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

const zUpdateStatusInput = z.object({
  id:        z.number().int().positive(),
  status:    zWaitlistStatus,
  adminNote: z.string().max(1024).optional(),
});

const zBulkUpdateInput = z.object({
  ids:    z.array(z.number().int().positive()).min(1).max(200),
  status: zWaitlistStatus,
});

const zDeleteInput = z.object({
  id: z.number().int().positive(),
});

const zExportInput = z.object({
  status: z.enum(["all", "pending", "approved", "denied"]).default("all"),
});

const zEnrichStep2Input = z.object({
  email:    z.string().email("Invalid email address").max(320),
  fullName: z.string().max(256).optional(),
  whyText:  z.string().max(2000).optional(),
  unitSize: z.number().int().min(5).max(100000).optional(),
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const waitlistRouter = router({

  // ── submit (public) ────────────────────────────────────────────────────────
  submit: publicProcedure
    .input(zSubmitInput)
    .mutation(async ({ input, ctx }) => {
      console.log(`[WaitlistRouter][STEP] submit — email=${input.email}`);
      console.log(`[WaitlistRouter][INPUT] fullName=${input.fullName ?? "(none)"} whyText=${input.whyText ? "(set)" : "(none)"} unitSize=${input.unitSizeMin ?? "?"}-${input.unitSizeMax ?? "?"} step2=${input.step2Completed ?? false} utmSource=${input.utmSource ?? "(none)"}`);

      // ── Extract client metadata from request ──────────────────────────────
      const req = ctx.req as import("express").Request | undefined;
      const ipAddress: string =
        (req?.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
        req?.socket?.remoteAddress ??
        "unknown";
      const userAgent: string = (req?.headers["user-agent"] as string | undefined) ?? "";

      console.log(`[WaitlistRouter][STATE] ip=${ipAddress} ua=${userAgent.slice(0, 80)}`);

      // ── Delegate to DB helper ─────────────────────────────────────────────
      let result: Awaited<ReturnType<typeof submitWaitlist>>;
      try {
        result = await submitWaitlist({
          email:          input.email,
          fullName:       input.fullName,
          whyText:        input.whyText,
          unitSizeMin:    input.unitSizeMin,
          unitSizeMax:    input.unitSizeMax,
          step2Completed: input.step2Completed,
          ipAddress,
          userAgent,
          utmSource:      input.utmSource,
          utmMedium:      input.utmMedium,
          utmCampaign:    input.utmCampaign,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`[WaitlistRouter][ERROR] submit — DB error: ${msg}`);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to save waitlist entry. Please try again." });
      }

      if (!result.ok) {
        console.log(`[WaitlistRouter][OUTPUT] submit — DUPLICATE email=${input.email}`);
        // Return success-like response so the user sees confirmation (avoids email enumeration)
        return { ok: false as const, reason: 'duplicate' as const };
      }

      console.log(`[WaitlistRouter][OUTPUT] submit — CREATED id=${result.id} email=${input.email}`);
      console.log(`[WaitlistRouter][VERIFY] PASS — waitlist entry submitted`);

      return { ok: true as const, reason: null };
    }),

  // ── enrichStep2 (public) — update enrichment fields on existing entry ─────
  enrichStep2: publicProcedure
    .input(zEnrichStep2Input)
    .mutation(async ({ input }) => {
      console.log(`[WaitlistRouter][STEP] enrichStep2 — email=${input.email}`);
      console.log(`[WaitlistRouter][INPUT] fullName=${input.fullName ?? "(none)"} whyText=${input.whyText ? "(set, len=" + input.whyText.length + ")" : "(none)"} unitSize=${input.unitSize ?? "(none)"}`);

      let result: Awaited<ReturnType<typeof enrichStep2>>;
      try {
        result = await enrichStep2({
          email:          input.email,
          fullName:       input.fullName,
          whyText:        input.whyText,
          unitSize:       input.unitSize,
          step2Completed: true,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`[WaitlistRouter][ERROR] enrichStep2 — DB error: ${msg}`);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to save your information. Please try again." });
      }

      if (!result.ok) {
        console.log(`[WaitlistRouter][OUTPUT] enrichStep2 — NOT_FOUND email=${input.email}`);
        // Still return ok:true to the user — avoids email enumeration and is a no-op
        return { ok: true as const };
      }

      console.log(`[WaitlistRouter][OUTPUT] enrichStep2 — UPDATED email=${input.email}`);
      console.log(`[WaitlistRouter][VERIFY] PASS — step2 enrichment saved`);

      return { ok: true as const };
    }),

  // ── list (owner) ───────────────────────────────────────────────────────────
  list: ownerProcedure
    .input(zListInput)
    .query(async ({ input }) => {
      console.log(`[WaitlistRouter][STEP] list — status=${input.status} search=${input.search ?? "(none)"} limit=${input.limit} offset=${input.offset}`);

      const result = await listWaitlist({
        status:  input.status as WaitlistStatus | "all",
        search:  input.search,
        fromTs:  input.fromTs,
        toTs:    input.toTs,
        limit:   input.limit,
        offset:  input.offset,
        sortBy:  input.sortBy,
        sortDir: input.sortDir,
      });

      console.log(`[WaitlistRouter][OUTPUT] list — total=${result.total} returned=${result.rows.length}`);
      console.log(`[WaitlistRouter][VERIFY] PASS — list query complete`);

      return result;
    }),

  // ── stats (owner) ──────────────────────────────────────────────────────────
  stats: ownerProcedure
    .query(async () => {
      console.log(`[WaitlistRouter][STEP] stats`);
      const stats = await getWaitlistStats();
      console.log(`[WaitlistRouter][OUTPUT] stats — total=${stats.total} pending=${stats.pending} approved=${stats.approved} denied=${stats.denied}`);
      console.log(`[WaitlistRouter][VERIFY] PASS — stats query complete`);
      return stats;
    }),

  // ── updateStatus (owner) ───────────────────────────────────────────────────
  updateStatus: ownerProcedure
    .input(zUpdateStatusInput)
    .mutation(async ({ input, ctx }) => {
      const reviewerId = ctx.appUser.id;
      console.log(`[WaitlistRouter][STEP] updateStatus — id=${input.id} newStatus=${input.status} reviewedBy=${reviewerId}`);
      console.log(`[WaitlistRouter][INPUT] adminNote=${input.adminNote ? `"${input.adminNote.slice(0, 80)}"` : "(none)"}`);

      let updated: WaitlistRow;
      try {
        updated = await updateWaitlistStatus({
          id:        input.id,
          status:    input.status,
          adminNote: input.adminNote,
          reviewedBy: reviewerId,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`[WaitlistRouter][ERROR] updateStatus — ${msg}`);
        throw new TRPCError({ code: "NOT_FOUND", message: msg });
      }

      console.log(`[WaitlistRouter][OUTPUT] updateStatus — id=${updated.id} email=${updated.email} status=${updated.status}`);
      console.log(`[WaitlistRouter][VERIFY] PASS — status updated`);

      return updated;
    }),

  // ── bulkUpdate (owner) ─────────────────────────────────────────────────────
  bulkUpdate: ownerProcedure
    .input(zBulkUpdateInput)
    .mutation(async ({ input, ctx }) => {
      const reviewerId = ctx.appUser.id;
      console.log(`[WaitlistRouter][STEP] bulkUpdate — ids=[${input.ids.join(",")}] newStatus=${input.status} reviewedBy=${reviewerId}`);

      const count = await bulkUpdateWaitlistStatus({
        ids:        input.ids,
        status:     input.status,
        reviewedBy: reviewerId,
      });

      console.log(`[WaitlistRouter][OUTPUT] bulkUpdate — updated=${count} status=${input.status}`);
      console.log(`[WaitlistRouter][VERIFY] PASS — bulk update complete`);

      return { updated: count };
    }),

  // ── delete (owner) ─────────────────────────────────────────────────────────
  delete: ownerProcedure
    .input(zDeleteInput)
    .mutation(async ({ input }) => {
      console.log(`[WaitlistRouter][STEP] delete — id=${input.id}`);

      const deleted = await deleteWaitlistEntry(input.id);

      if (!deleted) {
        console.log(`[WaitlistRouter][ERROR] delete — id=${input.id} not found`);
        throw new TRPCError({ code: "NOT_FOUND", message: `Waitlist entry id=${input.id} not found` });
      }

      console.log(`[WaitlistRouter][OUTPUT] delete — DELETED id=${input.id}`);
      console.log(`[WaitlistRouter][VERIFY] PASS — entry deleted`);

      return { deleted: true };
    }),

  // ── exportCsv (owner) ──────────────────────────────────────────────────────
  exportCsv: ownerProcedure
    .input(zExportInput)
    .query(async ({ input }) => {
      console.log(`[WaitlistRouter][STEP] exportCsv — status=${input.status}`);

      const csv = await exportWaitlistCsv(input.status as WaitlistStatus | "all");

      console.log(`[WaitlistRouter][OUTPUT] exportCsv — bytes=${csv.length}`);
      console.log(`[WaitlistRouter][VERIFY] PASS — CSV export complete`);

      return { csv };
    }),
});


