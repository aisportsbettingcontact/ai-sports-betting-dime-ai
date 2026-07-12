/**
 * dimeChats.ts — tRPC router for persistent Dime Chat history.
 *
 * Every procedure runs on appUserProcedure and is ownership-checked: a user
 * can only see or mutate threads where thread.userId === ctx.appUser.id.
 *
 * Deletion is SOFT (product decision 2026-07-12): softDelete sets deletedAt,
 * which hides the thread from every user-facing query, but the rows stay in
 * the database. Star/Archive are per-thread flags surfaced in the chat's
 * "⋯" settings menu.
 */

import { z } from "zod";
import { router } from "../_core/trpc";
import { appUserProcedure } from "./appUsers";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { dimeChatThreads, dimeChatMessages } from "../../drizzle/schema";
import { eq, and, desc, asc, isNull, sql } from "drizzle-orm";
import { DIME_CHAT_MAX_MESSAGE_CHARS } from "../_core/dimeChatModel";

const TITLE_MAX = 80;
const LIST_LIMIT = 100;

/** Collapse whitespace and truncate to TITLE_MAX chars with an ellipsis. */
export function deriveThreadTitle(text: string, max: number = TITLE_MAX): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1).trimEnd()}…`;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable." });
  return db;
}

/** Load a live (non-deleted) thread owned by userId, or throw NOT_FOUND. */
async function getOwnedThread(db: Awaited<ReturnType<typeof requireDb>>, threadId: number, userId: number) {
  const rows = await db
    .select()
    .from(dimeChatThreads)
    .where(and(eq(dimeChatThreads.id, threadId), eq(dimeChatThreads.userId, userId), isNull(dimeChatThreads.deletedAt)))
    .limit(1);
  const thread = rows[0];
  if (!thread) throw new TRPCError({ code: "NOT_FOUND", message: "Chat not found." });
  return thread;
}

const messageContent = z.string().min(1).max(DIME_CHAT_MAX_MESSAGE_CHARS);

export const dimeChatsRouter = router({
  /** Own threads, starred first then most-recent; archived hidden by default. */
  list: appUserProcedure
    .input(z.object({ includeArchived: z.boolean().default(false) }).optional())
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const conditions = [eq(dimeChatThreads.userId, ctx.appUser.id), isNull(dimeChatThreads.deletedAt)];
      if (!input?.includeArchived) conditions.push(eq(dimeChatThreads.archived, false));
      const rows = await db
        .select({
          id: dimeChatThreads.id,
          title: dimeChatThreads.title,
          starred: dimeChatThreads.starred,
          archived: dimeChatThreads.archived,
          updatedAt: dimeChatThreads.updatedAt,
        })
        .from(dimeChatThreads)
        .where(and(...conditions))
        .orderBy(desc(dimeChatThreads.starred), desc(dimeChatThreads.updatedAt))
        .limit(LIST_LIMIT);
      return rows;
    }),

  /** One owned thread with its full message history, oldest first. */
  get: appUserProcedure
    .input(z.object({ threadId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const thread = await getOwnedThread(db, input.threadId, ctx.appUser.id);
      const messages = await db
        .select({
          role: dimeChatMessages.role,
          content: dimeChatMessages.content,
          seq: dimeChatMessages.seq,
        })
        .from(dimeChatMessages)
        .where(eq(dimeChatMessages.threadId, thread.id))
        .orderBy(asc(dimeChatMessages.seq));
      return {
        id: thread.id,
        title: thread.title,
        starred: thread.starred,
        archived: thread.archived,
        messages,
      };
    }),

  /** Start a thread from the first user message. Returns the new thread id. */
  create: appUserProcedure
    .input(z.object({ firstMessage: messageContent }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const title = deriveThreadTitle(input.firstMessage);
      const inserted = await db
        .insert(dimeChatThreads)
        .values({ userId: ctx.appUser.id, title });
      const threadId = Number((inserted as unknown as { insertId: number }).insertId);
      if (!Number.isFinite(threadId) || threadId <= 0) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create chat." });
      }
      await db.insert(dimeChatMessages).values({
        threadId,
        seq: 1,
        role: "user",
        content: input.firstMessage.slice(0, DIME_CHAT_MAX_MESSAGE_CHARS),
      });
      return { threadId, title };
    }),

  /**
   * Append one turn (a user message, an assistant reply, or both in order)
   * to an owned thread and bump its recency.
   */
  appendMessages: appUserProcedure
    .input(
      z.object({
        threadId: z.number().int().positive(),
        messages: z
          .array(z.object({ role: z.enum(["user", "assistant"]), content: messageContent }))
          .min(1)
          .max(2),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const thread = await getOwnedThread(db, input.threadId, ctx.appUser.id);
      const [{ maxSeq }] = await db
        .select({ maxSeq: sql<number>`COALESCE(MAX(${dimeChatMessages.seq}), 0)` })
        .from(dimeChatMessages)
        .where(eq(dimeChatMessages.threadId, thread.id));
      let seq = Number(maxSeq);
      await db.insert(dimeChatMessages).values(
        input.messages.map((m) => ({
          threadId: thread.id,
          seq: ++seq,
          role: m.role,
          content: m.content.slice(0, DIME_CHAT_MAX_MESSAGE_CHARS),
        })),
      );
      await db
        .update(dimeChatThreads)
        .set({ updatedAt: new Date() })
        .where(eq(dimeChatThreads.id, thread.id));
      return { ok: true, lastSeq: seq };
    }),

  /** Star/unstar an owned thread. */
  setStarred: appUserProcedure
    .input(z.object({ threadId: z.number().int().positive(), starred: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const thread = await getOwnedThread(db, input.threadId, ctx.appUser.id);
      await db.update(dimeChatThreads).set({ starred: input.starred }).where(eq(dimeChatThreads.id, thread.id));
      return { ok: true };
    }),

  /** Archive/unarchive an owned thread (hidden from the default list). */
  setArchived: appUserProcedure
    .input(z.object({ threadId: z.number().int().positive(), archived: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const thread = await getOwnedThread(db, input.threadId, ctx.appUser.id);
      await db.update(dimeChatThreads).set({ archived: input.archived }).where(eq(dimeChatThreads.id, thread.id));
      return { ok: true };
    }),

  /**
   * SOFT delete (product decision): hides the thread from the user everywhere;
   * the rows are retained in the database.
   */
  softDelete: appUserProcedure
    .input(z.object({ threadId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const thread = await getOwnedThread(db, input.threadId, ctx.appUser.id);
      await db.update(dimeChatThreads).set({ deletedAt: new Date() }).where(eq(dimeChatThreads.id, thread.id));
      return { ok: true };
    }),
});
