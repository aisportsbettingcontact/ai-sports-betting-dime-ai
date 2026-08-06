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
import { appUserProcedure, ownerProcedure } from "./appUsers";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { dimeChatThreads, dimeChatMessages } from "../../drizzle/schema";
import { eq, and, desc, asc, isNull, sql } from "drizzle-orm";
import { DIME_CHAT_MAX_MESSAGE_CHARS } from "../_core/dimeChatModel";
import {
  deriveThreadTitle,
  sanitizeThreadTitle,
  TITLE_MAX,
} from "../dimeChatTitle";

const LIST_LIMIT = 100;

/** New-thread titles come from the deterministic topic-detection engine
 *  (owner directive 2026-07-29 r3) — see server/dimeChatTitle.ts. Re-exported
 *  here because callers and tests import it from the router module. */
export { deriveThreadTitle };

async function requireDb() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database unavailable.",
    });
  return db;
}

/** Load a live (non-deleted) thread owned by userId, or throw NOT_FOUND. */
async function getOwnedThread(
  db: Awaited<ReturnType<typeof requireDb>>,
  threadId: number,
  userId: number
) {
  const rows = await db
    .select()
    .from(dimeChatThreads)
    .where(
      and(
        eq(dimeChatThreads.id, threadId),
        eq(dimeChatThreads.userId, userId),
        isNull(dimeChatThreads.deletedAt)
      )
    )
    .limit(1);
  const thread = rows[0];
  if (!thread)
    throw new TRPCError({ code: "NOT_FOUND", message: "Chat not found." });
  return thread;
}

const messageContent = z.string().min(1).max(DIME_CHAT_MAX_MESSAGE_CHARS);

/**
 * Atomically create a thread and its first settled turn.
 *
 * Drizzle's mysql2 adapter returns insert metadata as a tuple. `$returningId`
 * provides the typed auto-increment id without depending on that driver shape.
 * Keeping both writes in one transaction prevents empty thread shells when a
 * message insert fails.
 */
export async function createDimeChatThread(
  db: Awaited<ReturnType<typeof requireDb>>,
  userId: number,
  firstMessage: string,
  firstAssistantMessage?: string
) {
  const title = deriveThreadTitle(firstMessage);

  return db.transaction(async (tx: Awaited<ReturnType<typeof requireDb>>) => {
    const [inserted] = await tx
      .insert(dimeChatThreads)
      .values({ userId, title })
      .$returningId();
    const threadId = Number(inserted?.id);
    if (!Number.isFinite(threadId) || threadId <= 0) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to create chat.",
      });
    }

    const messages: Array<{
      threadId: number;
      seq: number;
      role: "user" | "assistant";
      content: string;
    }> = [
      {
        threadId,
        seq: 1,
        role: "user",
        content: firstMessage.slice(0, DIME_CHAT_MAX_MESSAGE_CHARS),
      },
    ];
    if (firstAssistantMessage) {
      messages.push({
        threadId,
        seq: 2,
        role: "assistant",
        content: firstAssistantMessage.slice(0, DIME_CHAT_MAX_MESSAGE_CHARS),
      });
    }
    await tx.insert(dimeChatMessages).values(messages);

    return { threadId, title };
  });
}

export const dimeChatsRouter = router({
  /** Own threads, starred first then most-recent; archived hidden by default. */
  list: appUserProcedure
    .input(z.object({ includeArchived: z.boolean().default(false) }).optional())
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const conditions = [
        eq(dimeChatThreads.userId, ctx.appUser.id),
        isNull(dimeChatThreads.deletedAt),
      ];
      if (!input?.includeArchived)
        conditions.push(eq(dimeChatThreads.archived, false));
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
    .input(
      z.object({
        firstMessage: messageContent,
        firstAssistantMessage: messageContent.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      return createDimeChatThread(
        db,
        ctx.appUser.id,
        input.firstMessage,
        input.firstAssistantMessage
      );
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
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: messageContent,
            })
          )
          .min(1)
          .max(2),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      return db.transaction(
        async (tx: Awaited<ReturnType<typeof requireDb>>) => {
          // Serialize legacy compatibility writes with Trace v1 writes. The
          // unique (threadId, seq) constraint remains the final invariant.
          await tx.execute(sql`
            SELECT id
              FROM ${dimeChatThreads}
             WHERE ${dimeChatThreads.id} = ${input.threadId}
               AND ${dimeChatThreads.userId} = ${ctx.appUser.id}
               AND ${dimeChatThreads.deletedAt} IS NULL
             FOR UPDATE
          `);
          const thread = await getOwnedThread(
            tx,
            input.threadId,
            ctx.appUser.id
          );
          const [{ maxSeq }] = await tx
            .select({
              maxSeq: sql<number>`COALESCE(MAX(${dimeChatMessages.seq}), 0)`,
            })
            .from(dimeChatMessages)
            .where(eq(dimeChatMessages.threadId, thread.id));
          let seq = Number(maxSeq);
          await tx.insert(dimeChatMessages).values(
            input.messages.map(m => ({
              threadId: thread.id,
              seq: ++seq,
              role: m.role,
              content: m.content.slice(0, DIME_CHAT_MAX_MESSAGE_CHARS),
            }))
          );
          await tx
            .update(dimeChatThreads)
            .set({ updatedAt: new Date() })
            .where(eq(dimeChatThreads.id, thread.id));
          return { ok: true, lastSeq: seq };
        }
      );
    }),

  /** Rename an owned thread. The user's chosen title is kept verbatim
   *  (whitespace-collapsed + truncated) — the topic engine only ever names
   *  NEW threads, never overrides an explicit rename. */
  rename: appUserProcedure
    .input(
      z.object({
        threadId: z.number().int().positive(),
        title: z
          .string()
          .min(1)
          .max(TITLE_MAX * 2),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const thread = await getOwnedThread(db, input.threadId, ctx.appUser.id);
      const title = sanitizeThreadTitle(input.title);
      if (!title)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Title required.",
        });
      await db
        .update(dimeChatThreads)
        .set({ title, updatedAt: new Date() })
        .where(eq(dimeChatThreads.id, thread.id));
      return { ok: true, title };
    }),

  /** Star/unstar an owned thread. */
  setStarred: appUserProcedure
    .input(
      z.object({ threadId: z.number().int().positive(), starred: z.boolean() })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const thread = await getOwnedThread(db, input.threadId, ctx.appUser.id);
      await db
        .update(dimeChatThreads)
        .set({ starred: input.starred })
        .where(eq(dimeChatThreads.id, thread.id));
      return { ok: true };
    }),

  /** Archive/unarchive an owned thread (hidden from the default list). */
  setArchived: appUserProcedure
    .input(
      z.object({ threadId: z.number().int().positive(), archived: z.boolean() })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const thread = await getOwnedThread(db, input.threadId, ctx.appUser.id);
      await db
        .update(dimeChatThreads)
        .set({ archived: input.archived })
        .where(eq(dimeChatThreads.id, thread.id));
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
      await db
        .update(dimeChatThreads)
        .set({ deletedAt: new Date() })
        .where(eq(dimeChatThreads.id, thread.id));
      return { ok: true };
    }),

  /**
   * OWNER-ONLY global sweep (owner directive 2026-07-21): soft-delete every
   * live thread for EVERY user — the sidebar Recent Chats list clears
   * platform-wide. Same soft-delete contract as softDelete: rows are
   * retained in the database, only deletedAt is stamped.
   */
  clearAllForEveryone: ownerProcedure.mutation(async () => {
    const db = await requireDb();
    const result = await db
      .update(dimeChatThreads)
      .set({ deletedAt: new Date() })
      .where(isNull(dimeChatThreads.deletedAt));
    // mysql2 driver surfaces affectedRows on the raw header; default 0 if a
    // driver swap hides it.
    const header = result as unknown as {
      affectedRows?: number;
      rowsAffected?: number;
    };
    return {
      ok: true,
      cleared: Number(header.affectedRows ?? header.rowsAffected ?? 0),
    };
  }),
});
