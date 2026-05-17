import { TRPCError } from "@trpc/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { parse as parseCookieHeader } from "cookie";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getSessionCookieOptions } from "../_core/cookies";
import { SignJWT, jwtVerify } from "jose";
import { ENV } from "../_core/env";
import type { Request } from "express";
import { postSecurityAlert } from "../discord/discordSecurityAlert";

import crypto from "crypto";
import {
  createAppUser,
  listAppUsers,
  getAppUserById,
  getAppUserByEmail,
  getAppUserByUsername,
  updateAppUser,
  deleteAppUser,
  updateAppUserLastSignedIn,
  incrementTokenVersion,
  incrementAllTokenVersions,
  insertSecurityEvent,
} from "../db";
import { getDiscordClient } from "../discord/bot";
import { notifyOwner } from "../_core/notification";
import { getCachedAppUser, setCachedAppUser, invalidateCachedAppUser } from "../dbCircuitBreaker";
import { getDb } from "../db";
import { discordInviteTokens } from "../../drizzle/schema";
import { eq, and, isNull, gt } from "drizzle-orm";

const APP_USER_COOKIE = "app_session";

/**
 * retryOnce — retry a DB operation exactly once on transient TiDB cold-start errors.
 *
 * TiDB Serverless drops idle connections after ~5 minutes. When the pool is cold,
 * the first query can take 5-30s and trigger the circuit breaker timeout. A single
 * retry after a 3s delay gives TiDB time to establish a new connection and succeed.
 *
 * Only retries on transient errors. Business logic TRPCErrors are re-thrown immediately.
 */
async function retryOnce<T>(fn: () => Promise<T>, tag: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    const msg = (err as Error)?.message ?? String(err);
    const isTransient =
      msg.includes('timed out') ||
      msg.includes('ETIMEDOUT') ||
      msg.includes('ECONNREFUSED') ||
      msg.includes('ER_CON_COUNT_ERROR') ||
      msg.includes('Circuit is OPEN') ||
      msg.includes('Database not available') ||
      msg.includes('ECONNRESET') ||
      msg.includes('connect EHOSTUNREACH');
    if (!isTransient) throw err;
    console.warn(`${tag} [RETRY] Transient DB error — retrying in 3s: ${msg.substring(0, 120)}`);
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log(`${tag} [RETRY] Executing retry attempt...`);
    return await fn();
  }
}

function getAppCookie(req: Request): string | undefined {
  const cookies = parseCookieHeader(req.headers.cookie ?? "");
  return cookies[APP_USER_COOKIE];
}

// Helper: sign a JWT for an app user session — embeds tokenVersion (tv) for invalidation
async function signAppUserToken(userId: number, role: string, tokenVersion: number) {
  const secret = new TextEncoder().encode(ENV.cookieSecret);
  console.log(`[AppAuth] signAppUserToken: userId=${userId} role=${role} tv=${tokenVersion}`);
  return new SignJWT({ sub: String(userId), role, type: "app_user", tv: tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("90d")
    .sign(secret);
}

// Helper: verify app user JWT from cookie — returns userId, role, tv (tokenVersion), and exp (ms)
export async function verifyAppUserToken(token: string) {
  try {
    const secret = new TextEncoder().encode(ENV.cookieSecret);
    const { payload } = await jwtVerify(token, secret);
    if (payload.type !== "app_user") {
      console.log(`[AppAuth] verifyAppUserToken: rejected — wrong type: ${payload.type}`);
      return null;
    }
    const tv = typeof payload.tv === "number" ? payload.tv : null;
    // Extract exp once here to avoid a second jwtVerify call in callers (e.g. appUsers.me)
    const exp = typeof payload.exp === "number" ? payload.exp * 1000 : null; // convert s → ms
    return { userId: Number(payload.sub), role: payload.role as string, tv, exp };
  } catch (e) {
    console.log(`[AppAuth] verifyAppUserToken: JWT verification failed — ${(e as Error).message}`);
    return null;
  }
}

// Owner-only middleware — validates tokenVersion against DB to support force-logout
// DB-resilient: falls back to in-memory user cache when DB is unavailable
export const ownerProcedure = publicProcedure.use(async ({ ctx, next }) => {
  const token = getAppCookie(ctx.req);
  if (!token) {
    console.log(`[AppAuth] ownerProcedure: REJECTED — no app_session cookie`);
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }
  const payload = await verifyAppUserToken(token);
  if (!payload) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid session" });
  if (payload.role !== "owner") {
    console.log(`[AppAuth] ownerProcedure: REJECTED — role=${payload.role} (not owner)`);
    throw new TRPCError({ code: "FORBIDDEN", message: "Owner access required" });
  }
  let user = await getAppUserById(payload.userId);
  const fromCache = !user;
  if (!user) {
    user = getCachedAppUser(payload.userId);
    if (user) console.log(`[AppAuth] ownerProcedure: DB unavailable — serving userId=${payload.userId} from cache`);
  } else {
    setCachedAppUser(user);
  }
  if (!user || !user.hasAccess) {
    console.log(`[AppAuth] ownerProcedure: REJECTED — user not found or no access`);
    throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
  }
  // tokenVersion check: only enforce when DB is available
  if (!fromCache && payload.tv !== null && payload.tv !== user.tokenVersion) {
    console.log(`[AppAuth] ownerProcedure: REJECTED — tokenVersion mismatch: jwt.tv=${payload.tv} db.tv=${user.tokenVersion} userId=${user.id}`);
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Session invalidated. Please log in again." });
  }
  return next({ ctx: { ...ctx, appUser: user } });
});

// Handicapper procedure — grants access to owner, admin, and handicapper roles
// DB-resilient: falls back to in-memory user cache when DB is unavailable
export const handicapperProcedure = publicProcedure.use(async ({ ctx, next }) => {
  const token = getAppCookie(ctx.req);
  if (!token) {
    console.log(`[AppAuth] handicapperProcedure: REJECTED — no app_session cookie`);
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }
  const payload = await verifyAppUserToken(token);
  if (!payload) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid session" });
  let user = await getAppUserById(payload.userId);
  const fromCache = !user;
  if (!user) {
    user = getCachedAppUser(payload.userId);
    if (user) console.log(`[AppAuth] handicapperProcedure: DB unavailable — serving userId=${payload.userId} from cache`);
  } else {
    setCachedAppUser(user);
  }
  if (!user || !user.hasAccess) {
    console.log(`[AppAuth] handicapperProcedure: REJECTED — user not found or no access`);
    throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
  }
  if (!fromCache && payload.tv !== null && payload.tv !== user.tokenVersion) {
    console.log(`[AppAuth] handicapperProcedure: REJECTED — tokenVersion mismatch: jwt.tv=${payload.tv} db.tv=${user.tokenVersion} userId=${user.id}`);
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Session invalidated. Please log in again." });
  }
  const allowed = ["owner", "admin", "handicapper"] as const;
  if (!allowed.includes(user.role as typeof allowed[number])) {
    console.log(`[AppAuth] handicapperProcedure: REJECTED — role=${user.role} not in [owner, admin, handicapper]`);
    throw new TRPCError({ code: "FORBIDDEN", message: "Handicapper access required" });
  }
  return next({ ctx: { ...ctx, appUser: user } });
});

// Authenticated app user middleware — validates tokenVersion against DB to support force-logout
// DB-resilient: falls back to in-memory user cache when DB is unavailable (circuit open)
export const appUserProcedure = publicProcedure.use(async ({ ctx, next }) => {
  const token = getAppCookie(ctx.req);
  if (!token) {
    console.log(`[AppAuth] appUserProcedure: REJECTED — no app_session cookie`);
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }
  const payload = await verifyAppUserToken(token);
  if (!payload) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid session" });

  // Try DB first; fall back to cache if DB is unavailable
  let user = await getAppUserById(payload.userId);
  const fromCache = !user;
  if (!user) {
    user = getCachedAppUser(payload.userId);
    if (user) {
      console.log(`[AppAuth] appUserProcedure: DB unavailable — serving userId=${payload.userId} from cache`);
    }
  } else {
    // DB succeeded — update cache with fresh data
    setCachedAppUser(user);
  }

  if (!user) {
    console.log(`[AppAuth] appUserProcedure: REJECTED — userId=${payload.userId} not found (DB + cache miss)`);
    throw new TRPCError({ code: "UNAUTHORIZED", message: "User not found" });
  }
  if (!user.hasAccess) {
    console.log(`[AppAuth] appUserProcedure: REJECTED — userId=${user.id} hasAccess=false`);
    throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
  }
  // tokenVersion check: only enforce when DB is available (cache may have stale tv)
  if (!fromCache && payload.tv !== null && payload.tv !== user.tokenVersion) {
    console.log(`[AppAuth] appUserProcedure: REJECTED — tokenVersion mismatch: jwt.tv=${payload.tv} db.tv=${user.tokenVersion} userId=${user.id}`);
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Session invalidated. Please log in again." });
  }
  // Check expiry
  if (user.expiryDate && Date.now() > user.expiryDate) {
    console.log(`[AppAuth] appUserProcedure: REJECTED — userId=${user.id} account expired`);
    throw new TRPCError({ code: "FORBIDDEN", message: "Account expired" });
  }
  return next({ ctx: { ...ctx, appUser: user } });
});

export const appUsersRouter = router({
  // ─── Auth ──────────────────────────────────────────────────────────────────

  login: publicProcedure
    .input(z.object({
      emailOrUsername: z.string().min(1),
      password: z.string().min(1),
      stayLoggedIn: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      // [STEP] Extract client IP for rate limiting
      const clientIp = (ctx.req.headers["x-forwarded-for"] as string | undefined)
        ?.split(",")[0]
        .trim() ?? ctx.req.socket?.remoteAddress ?? "unknown";

      // [STEP] Check login rate limit BEFORE any DB query (prevents timing attacks)
      const rateCheck = checkLoginRateLimit(clientIp);
      if (!rateCheck.allowed) {
        console.warn(`[LoginRateLimit] BLOCKED login attempt | IP=${clientIp}`);
        // Log as security event
        const blockedAt = Date.now();
        insertSecurityEvent({
          eventType: "AUTH_FAIL",
          ip: clientIp,
          blockedOrigin: null,
          trpcPath: "appUsers.login",
          httpMethod: ctx.req.method ?? "POST",
          userAgent: (ctx.req.headers["user-agent"] as string | undefined) ?? null,
          context: "rate_limit_exceeded",
          occurredAt: blockedAt,
        }).catch((err) =>
          console.error(`[LoginRateLimit] DB insert failed: ${(err as Error).message}`)
        );
        postSecurityAlert({
          eventType: "AUTH_FAIL",
          ip: clientIp,
          path: "appUsers.login",
          method: ctx.req.method ?? "POST",
          userAgent: (ctx.req.headers["user-agent"] as string | undefined) ?? null,
          context: "rate_limit_exceeded",
          targetIdentifier: "[rate-limited]",
          occurredAt: blockedAt,
        }).catch((err) =>
          console.error(`[LoginRateLimit] Discord alert failed: ${(err as Error).message}`)
        );
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many failed login attempts. Please wait 15 minutes and try again.",
        });
      }

      // Try email first, then username
      const isEmail = input.emailOrUsername.includes("@");
      const user = isEmail
        ? await getAppUserByEmail(input.emailOrUsername.toLowerCase())
        : await getAppUserByUsername(input.emailOrUsername.replace(/^@/, "").toLowerCase());

      // ── AUTH_FAIL helper — fire-and-forget, never blocks the response ──────
      const fireAuthFailEvent = (reason: string) => {
        const ip = clientIp; // reuse extracted IP
        const ua = (ctx.req.headers["user-agent"] as string | undefined) ?? null;
        const tag = "[AppAuth][AUTH_FAIL]";

        // Sanitize the identifier for logging — show first 3 chars + *** to avoid
        // logging full credentials in plaintext while still being useful for debugging.
        // For emails: show first 3 chars of the local part (before @) + *** + @domain
        // For usernames: show first 3 chars + ***
        const rawId = input.emailOrUsername;
        const isEmailId = rawId.includes("@");
        const sanitizedId = isEmailId
          ? (() => {
              const atIdx = rawId.indexOf("@");
              const local = rawId.substring(0, atIdx);
              const domain = rawId.substring(atIdx); // includes the @
              return `${local.substring(0, 3)}***${domain}`;
            })()
          : `${rawId.replace(/^@/, "").substring(0, 3)}***`;

        console.warn(
          `${tag} BLOCKED | IP=${ip} reason="${reason}"` +
          ` identifier="${sanitizedId}" ua="${ua?.substring(0, 60) ?? "none"}"`
        );
        const authFailAt = Date.now();
        insertSecurityEvent({
          eventType: "AUTH_FAIL",
          ip,
          blockedOrigin: null,
          trpcPath: "appUsers.login",
          httpMethod: ctx.req.method ?? "POST",
          userAgent: ua,
          context: reason,
          occurredAt: authFailAt,
        }).catch((err) =>
          console.error(`${tag} DB insert failed: ${(err as Error).message}`)
        );
        // [STEP] Post structured embed to 🗒️-𝗦𝗘𝗖𝗨𝗥𝗜𝗧𝗬-𝗘𝗩𝗘𝗡𝗧𝗦 Discord channel (async, non-blocking)
        // targetIdentifier: the sanitized login credential the attacker used.
        // Shows WHAT account was targeted without exposing the full credential in logs.
        postSecurityAlert({
          eventType: "AUTH_FAIL",
          ip,
          path: "appUsers.login",
          method: ctx.req.method ?? "POST",
          userAgent: ua,
          context: reason,
          targetIdentifier: sanitizedId,
          occurredAt: authFailAt,
        }).catch((err) =>
          console.error(`${tag} Discord alert failed: ${(err as Error).message}`)
        );
      };

      if (!user) {
        fireAuthFailEvent("user_not_found");
        recordLoginFailure(clientIp); // [RATE_LIMIT] count failure
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid credentials" });
      }
      if (!user.hasAccess) {
        fireAuthFailEvent("account_access_disabled");
        recordLoginFailure(clientIp); // [RATE_LIMIT] count failure
        throw new TRPCError({ code: "FORBIDDEN", message: "Account access disabled" });
      }
      if (user.expiryDate && Date.now() > user.expiryDate) {
        fireAuthFailEvent("account_expired");
        recordLoginFailure(clientIp); // [RATE_LIMIT] count failure
        throw new TRPCError({ code: "FORBIDDEN", message: "Account has expired" });
      }

      const valid = await bcrypt.compare(input.password, user.passwordHash);
      if (!valid) {
        fireAuthFailEvent("invalid_password");
        recordLoginFailure(clientIp); // [RATE_LIMIT] count failure
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid credentials" });
      }

      await updateAppUserLastSignedIn(user.id);

      console.log(`[AppAuth] login: userId=${user.id} username=${user.username} role=${user.role} tv=${user.tokenVersion} stayLoggedIn=${input.stayLoggedIn}`);

      // stayLoggedIn = 90 days; otherwise session cookie (expires on browser close)
      const sessionDays = input.stayLoggedIn ? 90 : 1;
      const token = await signAppUserToken(user.id, user.role, user.tokenVersion);
      const cookieOptions = getSessionCookieOptions(ctx.req);
      if (input.stayLoggedIn) {
        ctx.res.cookie(APP_USER_COOKIE, token, {
          ...cookieOptions,
          maxAge: sessionDays * 24 * 60 * 60 * 1000,
        });
      } else {
        // Session cookie — no maxAge, expires when browser closes
        ctx.res.cookie(APP_USER_COOKIE, token, {
          ...cookieOptions,
          maxAge: undefined,
        });
      }

      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          role: user.role,
          hasAccess: user.hasAccess,
          expiryDate: user.expiryDate,
        },
      };
    }),

  /**
   * getLoginStatus — read-only rate-limit status for the requesting IP.
   *
   * [INPUT]  req.ip (extracted from context)
   * [OUTPUT] { remainingAttempts, lockoutUntil, maxAttempts, isLockedOut }
   * [VERIFY] No side effects — does NOT record a failure attempt
   */
  getLoginStatus: publicProcedure.query(({ ctx }) => {
    const ip =
      (ctx.req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
      (ctx.req.socket as any)?.remoteAddress ??
      (ctx.req as any).ip ??
      'unknown';
    const result = checkLoginRateLimit(ip);
    console.log(
      `[getLoginStatus] IP=${ip} remaining=${result.remainingAttempts} ` +
      `locked=${!result.allowed} lockoutUntil=${result.lockoutUntil}`
    );
    return {
      remainingAttempts: result.remainingAttempts,
      lockoutUntil: result.lockoutUntil,
      maxAttempts: LOGIN_RATE_MAX_FAILURES,
      isLockedOut: !result.allowed,
    };
  }),

    logout: publicProcedure.mutation(async ({ ctx }) => {
    const cookieOptions = getSessionCookieOptions(ctx.req);
    // Invalidate user cache on logout so stale entries don't persist
    const token = getAppCookie(ctx.req);
    if (token) {
      const payload = await verifyAppUserToken(token);
      if (payload) invalidateCachedAppUser(payload.userId);
    }
    ctx.res.clearCookie(APP_USER_COOKIE, { ...cookieOptions, maxAge: -1 });
    return { success: true };
  }),

  me: publicProcedure.query(async ({ ctx }) => {
    const token = getAppCookie(ctx.req);
    if (!token) return null;
    const payload = await verifyAppUserToken(token);
    if (!payload) return null;
    const user = await getAppUserById(payload.userId);
    if (!user || !user.hasAccess) return null;
    if (user.expiryDate && Date.now() > user.expiryDate) return null;
    // [STEP] tokenVersion check — must match appUserProcedure's check.
    // If the session was force-invalidated (admin force-logout, password reset, etc.)
    // the JWT tv will differ from the DB tokenVersion. Returning null here ensures
    // the frontend sees the user as unauthenticated BEFORE firing appUserProcedure
    // queries (e.g. games.list). Without this check, appUsers.me returns a user
    // object (enabling games.list), but games.list then returns UNAUTHORIZED due to
    // the tokenVersion mismatch — causing "No MLB games found" + unexpected logout.
    if (payload.tv !== null && payload.tv !== undefined && payload.tv !== user.tokenVersion) {
      console.log(`[AppAuth] me: session invalidated — jwt.tv=${payload.tv} db.tv=${user.tokenVersion} userId=${user.id}`);
      return null;
    }

    // [STEP] Extract JWT exp claim to surface session expiry to the frontend
    // payload.exp is already extracted by verifyAppUserToken — no second jwtVerify needed.
    // This eliminates a duplicate HMAC-SHA256 verification on every appUsers.me call.
    const sessionExpiresAt: number | null = payload.exp ?? null;

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      hasAccess: user.hasAccess,
      expiryDate: user.expiryDate,
      termsAccepted: user.termsAccepted,
      discordId: user.discordId ?? null,
      discordUsername: user.discordUsername ?? null,
      discordConnectedAt: user.discordConnectedAt ?? null,
      sessionExpiresAt, // null if session cookie (no maxAge), ms timestamp if persistent
    };
  }),

  // ─── Terms acceptance ──────────────────────────────────────────────────────

  acceptTerms: appUserProcedure.mutation(async ({ ctx }) => {
    await updateAppUser(ctx.appUser.id, {
      termsAccepted: true,
      termsAcceptedAt: Date.now(),
    } as Parameters<typeof updateAppUser>[1]);
    return { success: true };
  }),

  // ─── Owner-only User Management ────────────────────────────────────────────

  listUsers: ownerProcedure.query(async () => {
    let users;
    try {
      users = await listAppUsers();
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      console.error(`[AppAdmin][listUsers][FAIL] error=${msg}`);
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to load users. Please refresh the page.' });
    }
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      username: u.username,
      role: u.role,
      hasAccess: u.hasAccess,
      expiryDate: u.expiryDate,
      createdAt: u.createdAt,
      lastSignedIn: u.lastSignedIn,
      termsAccepted: u.termsAccepted,
      termsAcceptedAt: u.termsAcceptedAt,
      discordId: u.discordId ?? null,
      discordUsername: u.discordUsername ?? null,
      discordConnectedAt: u.discordConnectedAt ?? null,
    }));
  }),

  createUser: ownerProcedure
    .input(z.object({
      email: z.string().email(),
      username: z.string().min(2).max(64).regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
      password: z.string().min(8),
      role: z.enum(["owner", "admin", "handicapper", "user"]).default("user"),
      hasAccess: z.boolean().default(true),
      expiryDate: z.number().nullable().default(null), // null = lifetime
    }))
    .mutation(async ({ input }) => {
      console.log(`[AppAdmin][createUser][INPUT] email=${input.email} username=${input.username} role=${input.role}`);
      // ── retryOnce: automatically retry on TiDB cold-start transient errors ──
      return retryOnce(async () => {
        // [STEP 1] Parallel uniqueness checks — run concurrently to halve DB round-trips
        console.log(`[AppAdmin][createUser][STEP] parallel uniqueness checks`);
        const [existingEmail, existingUsername] = await Promise.all([
          getAppUserByEmail(input.email.toLowerCase()),
          getAppUserByUsername(input.username.toLowerCase()),
        ]);
        if (existingEmail) throw new TRPCError({ code: "CONFLICT", message: "Email already in use" });
        if (existingUsername) throw new TRPCError({ code: "CONFLICT", message: "Username already taken" });

        // [STEP 2] Hash password with cost=10 (OWASP-compliant, ~110ms vs ~250ms for cost=12)
        console.log(`[AppAdmin][createUser][STEP] hashing password cost=10`);
        const passwordHash = await bcrypt.hash(input.password, 10);
        console.log(`[AppAdmin][createUser][STATE] password hash OK`);

        // [STEP 3] Insert new user
        console.log(`[AppAdmin][createUser][STEP] inserting user email=${input.email} username=${input.username}`);
        await createAppUser({
          email: input.email.toLowerCase(),
          username: input.username.toLowerCase(),
          passwordHash,
          role: input.role,
          hasAccess: input.hasAccess,
          expiryDate: input.expiryDate ?? undefined,
        });
        console.log(`[AppAdmin][createUser][OUTPUT] SUCCESS username=${input.username}`);
        return { success: true };
      }, '[AppAdmin][createUser]').catch((err) => {
        if (err instanceof TRPCError) throw err;
        const msg = (err as Error)?.message ?? String(err);
        console.error(`[AppAdmin][createUser][FAIL] username=${input.username} error=${msg}`);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create account. Please try again.',
        });
      });
    }),

  updateUser: ownerProcedure
    .input(z.object({
      id: z.number().int().positive(),
      email: z.string().email().optional(),
      username: z.string().min(2).max(64).optional(),
      password: z.string().min(8).optional(),
      role: z.enum(["owner", "admin", "handicapper", "user"]).optional(),
      hasAccess: z.boolean().optional(),
      expiryDate: z.number().nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, password, ...rest } = input;
      console.log(`[AppAdmin][updateUser][INPUT] userId=${id} fields=${JSON.stringify(Object.keys({ ...rest, ...(password ? { password: '***' } : {}) }))}`);
      // ── retryOnce: automatically retry on TiDB cold-start transient errors ──
      return retryOnce(async () => {
        // [STEP 1] Fetch existing user (required for uniqueness checks)
        const existing = await getAppUserById(id);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
        console.log(`[AppAdmin][updateUser][STATE] found userId=${id} username=${existing.username}`);

        // [STEP 2] Parallel uniqueness checks — only if email/username is changing
        const emailChanging = !!(rest.email && rest.email.toLowerCase() !== existing.email);
        const usernameChanging = !!(rest.username && rest.username.toLowerCase() !== existing.username);
        if (emailChanging || usernameChanging) {
          const [emailConflict, usernameConflict] = await Promise.all([
            emailChanging ? getAppUserByEmail(rest.email!.toLowerCase()) : Promise.resolve(null),
            usernameChanging ? getAppUserByUsername(rest.username!.toLowerCase()) : Promise.resolve(null),
          ]);
          if (emailConflict) throw new TRPCError({ code: "CONFLICT", message: "Email already in use" });
          if (usernameConflict) throw new TRPCError({ code: "CONFLICT", message: "Username already taken" });
        }

        // [STEP 3] Build update payload
        const updateData: Record<string, unknown> = {};
        if (rest.email) updateData.email = rest.email.toLowerCase();
        if (rest.username) updateData.username = rest.username.toLowerCase();
        if (rest.role) updateData.role = rest.role;
        if (rest.hasAccess !== undefined) updateData.hasAccess = rest.hasAccess;
        if (rest.expiryDate !== undefined) updateData.expiryDate = rest.expiryDate;

        // [STEP 4] Hash password with cost=10 (OWASP-compliant, ~110ms vs ~250ms for cost=12)
        if (password) {
          console.log(`[AppAdmin][updateUser][STEP] hashing password userId=${id} cost=10`);
          updateData.passwordHash = await bcrypt.hash(password, 10);
          console.log(`[AppAdmin][updateUser][STATE] password hash OK`);
        }

        // [STEP 5] Write to DB
        console.log(`[AppAdmin][updateUser][STEP] writing fields=${JSON.stringify(Object.keys(updateData))} userId=${id}`);
        await updateAppUser(id, updateData as Parameters<typeof updateAppUser>[1]);
        console.log(`[AppAdmin][updateUser][OUTPUT] SUCCESS userId=${id}`);
        return { success: true };
      }, '[AppAdmin][updateUser]').catch((err) => {
        if (err instanceof TRPCError) throw err;
        const msg = (err as Error)?.message ?? String(err);
        console.error(`[AppAdmin][updateUser][FAIL] userId=${id} error=${msg}`);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update account. Please try again.',
        });
      });
    }),

  deleteUser: ownerProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (input.id === ctx.appUser.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot delete your own account" });
      }
      try {
        await deleteAppUser(input.id);
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        console.error(`[AppAdmin] deleteUser: DB error for userId=${input.id}: ${msg}`);
        if (msg.includes('Circuit is OPEN') || msg.includes('Database not available') || msg.includes('timed out')) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database temporarily unavailable. Please try again in a moment.' });
        }
        throw err;
      }
      return { success: true };
    }),

  // ─── Session Invalidation ──────────────────────────────────────────────────

  /**
   * Force-logout a specific user by incrementing their tokenVersion.
   * Their existing JWT will be rejected on next request (tv mismatch).
   * The owner's own session is NOT affected.
   */
  forceLogoutUser: ownerProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (input.id === ctx.appUser.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot force-logout your own account" });
      }
      try {
        const user = await getAppUserById(input.id);
        if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
        const newTv = await incrementTokenVersion(input.id);
        console.log(`[AppAuth] forceLogoutUser: userId=${input.id} username=${user.username} — tokenVersion incremented to ${newTv}`);
        return { success: true, newTokenVersion: newTv };
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        const msg = (err as Error)?.message ?? String(err);
        console.error(`[AppAdmin][forceLogoutUser][FAIL] userId=${input.id} error=${msg}`);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to force logout. Please try again.' });
      }
    }),

  /**
   * Force-logout ALL users EXCEPT the current owner.
   * Increments tokenVersion for every user whose id != ctx.appUser.id.
   * The owner stays logged in; all other sessions are immediately invalidated.
   */
  forceLogoutAll: ownerProcedure
    .mutation(async ({ ctx }) => {
      try {
        const count = await incrementAllTokenVersions(ctx.appUser.id);
        console.log(`[AppAuth] forceLogoutAll: invalidated sessions for ${count} users (excluded owner userId=${ctx.appUser.id})`);
        return { success: true, usersAffected: count };
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        const msg = (err as Error)?.message ?? String(err);
        console.error(`[AppAdmin][forceLogoutAll][FAIL] error=${msg}`);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to force logout all users. Please try again.' });
      }
    }),

  // ─── Discord Admin Controls ────────────────────────────────────────────────
  /**
   * OWNER-ONLY: Disconnect a user's Discord account.
   *
   * POLICY: Users cannot disconnect their own Discord — once linked, it is
   * permanent from the user's perspective. Only the owner (@prez) can unlink
   * a Discord account via the User Management admin panel.
   *
   * CHECKPOINT:ADMIN_DISCORD_DISCONNECT — logs who disconnected whom and when.
   */
  adminDisconnectDiscord: ownerProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      console.log(`[CHECKPOINT:ADMIN_DISCORD_DISCONNECT.1] ` +
        `owner=${ctx.appUser.username}(id=${ctx.appUser.id}) ` +
        `target=userId(${input.id}) ` +
        `action=UNLINK_DISCORD ` +
        `timestamp=${new Date().toISOString()}`);

      const user = await getAppUserById(input.id);
      if (!user) {
        console.log(`[CHECKPOINT:ADMIN_DISCORD_DISCONNECT.ERR] userId=${input.id} NOT_FOUND`);
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      if (!user.discordId) {
        console.log(`[CHECKPOINT:ADMIN_DISCORD_DISCONNECT.SKIP] userId=${input.id} username=${user.username} — no Discord linked, nothing to do`);
        throw new TRPCError({ code: "BAD_REQUEST", message: "This user has no Discord account linked" });
      }

      console.log(`[CHECKPOINT:ADMIN_DISCORD_DISCONNECT.2] ` +
        `unlinking discordId=${user.discordId} discordUsername=${user.discordUsername} ` +
        `from userId=${input.id} username=${user.username}`);

      try {
        await updateAppUser(input.id, {
          discordId: null,
          discordUsername: null,
          discordAvatar: null,
          discordConnectedAt: null,
        });
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        console.error(`[CHECKPOINT:ADMIN_DISCORD_DISCONNECT.DB_FAIL] userId=${input.id} error=${msg}`);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to disconnect Discord. Please try again.' });
      }

      console.log(`[CHECKPOINT:ADMIN_DISCORD_DISCONNECT.SUCCESS] ` +
        `userId=${input.id} username=${user.username} ` +
        `previousDiscordId=${user.discordId} previousDiscordUsername=${user.discordUsername} ` +
        `unlinkedBy=owner(${ctx.appUser.username}) ` +
        `timestamp=${new Date().toISOString()}`);

      return {
        success: true,
        unlinkedDiscordId: user.discordId,
        unlinkedDiscordUsername: user.discordUsername,
      };
    }),

  // ─── Discord Invite Link Generation ───────────────────────────────────────
  /**
   * generateDiscordInvite
   *
   * OWNER-ONLY: Generate a unique, single-use Discord invite link for a user
   * who has no Discord account linked. The link is valid for 7 days.
   *
   * Security invariants:
   *   - Token is 32 random bytes (256-bit entropy) — brute force infeasible
   *   - Single-use: token is marked used on first successful callback
   *   - Expires after 7 days
   *   - Bound to a specific userId (targetUserId)
   *   - Only one active token per user (old tokens revoked on new generation)
   *
   * [INPUT]  userId  — the app_users.id to generate the invite for
   * [INPUT]  origin  — the frontend origin for building the invite URL
   * [OUTPUT] { inviteUrl: string, expiresAt: number }
   */
  generateDiscordInvite: ownerProcedure
    .input(z.object({
      userId: z.number().int().positive(),
      origin: z.string().url(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { userId, origin } = input;
      const requestId = Math.random().toString(36).slice(2, 8).toUpperCase();

      console.log(
        `[DiscordInvite][GENERATE][INPUT] requestId=${requestId}` +
        ` owner=${ctx.appUser.username}(id=${ctx.appUser.id})` +
        ` targetUserId=${userId}`
      );

      // [STEP 1] Verify target user exists
      const user = await getAppUserById(userId);
      if (!user) {
        console.warn(`[DiscordInvite][GENERATE][FAIL] requestId=${requestId} userId=${userId} NOT_FOUND`);
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      // [STEP 2] Check if user already has Discord linked
      if (user.discordId) {
        console.warn(
          `[DiscordInvite][GENERATE][FAIL] requestId=${requestId}` +
          ` userId=${userId} username=${user.username} already has discordId=${user.discordId}`
        );
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This user already has a Discord account linked. Disconnect it first.",
        });
      }

      // [STEP 3] Get DB connection
      const db = await getDb();
      if (!db) {
        console.error(`[DiscordInvite][GENERATE][FAIL] requestId=${requestId} DB unavailable`);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable. Please try again." });
      }

      // [STEP 4] Revoke any existing active tokens for this user (single active token per user)
      await db
        .delete(discordInviteTokens)
        .where(
          and(
            eq(discordInviteTokens.targetUserId, userId),
            isNull(discordInviteTokens.usedAt)
          )
        );
      console.log(
        `[DiscordInvite][GENERATE][STATE] requestId=${requestId}` +
        ` revoked previous active tokens for userId=${userId}`
      );

      // [STEP 5] Generate cryptographically random 32-byte token (64 hex chars)
      const token = crypto.randomBytes(32).toString("hex");
      const now = Date.now();
      const expiresAt = now + 7 * 24 * 60 * 60 * 1000; // 7 days

      // [STEP 6] Insert the new invite token
      await db.insert(discordInviteTokens).values({
        token,
        targetUserId: userId,
        expiresAt,
        createdAt: now,
        usedAt: null,
        linkedDiscordId: null,
        createdBy: ctx.appUser.id,
      });

      // [STEP 7] Build the invite URL
      const cleanOrigin = origin.replace(/\/$/, "");
      const inviteUrl = `${cleanOrigin}/api/auth/discord-invite/connect?token=${token}`;

      console.log(
        `[DiscordInvite][GENERATE][OUTPUT] requestId=${requestId}` +
        ` SUCCESS userId=${userId} username=${user.username}` +
        ` tokenPrefix=${token.slice(0, 8)}... expiresAt=${new Date(expiresAt).toISOString()}`
      );

      return { inviteUrl, expiresAt };
    }),

  // ─── Forgot Password ──────────────────────────────────────────────────────
  /**
   * requestPasswordReset
   *
   * Generates a 30-minute password reset token and delivers it via:
   *   1. Discord DM (if the user has Discord linked and the bot is running)
   *   2. Owner notification (fallback — owner relays the link manually)
   *
   * Security design:
   *   - Token is a 32-byte CSPRNG secret, stored as SHA-256 hex in the DB.
   *   - The raw token (never stored) is sent to the user; the server only
   *     stores the hash. This means a DB breach cannot be used to reset passwords.
   *   - Rate-limited: max 3 requests per email per 15 minutes (in-memory).
   *   - Always returns success=true regardless of whether the email exists
   *     (prevents user enumeration).
   *
   * [INPUT]  emailOrUsername — the user's email or username
   * [INPUT]  origin          — the frontend origin for building the reset URL
   * [OUTPUT] { success: true } always (no enumeration)
   */
  requestPasswordReset: publicProcedure
    .input(z.object({
      emailOrUsername: z.string().min(1).max(320),
      origin: z.string().url(),
    }))
    .mutation(async ({ input }) => {
      const ident = input.emailOrUsername.trim().toLowerCase().replace(/^@/, "");
      console.log(`[PasswordReset] requestPasswordReset | ident=${ident}`);

      // [STEP] Rate-limit: max 3 reset requests per identifier per 15 minutes
      const now = Date.now();
      const RATE_WINDOW_MS = 15 * 60 * 1000;
      const RATE_MAX = 3;
      const existing = resetRateMap.get(ident);
      if (existing) {
        // Prune expired entries
        existing.timestamps = existing.timestamps.filter(t => now - t < RATE_WINDOW_MS);
        if (existing.timestamps.length >= RATE_MAX) {
          console.warn(`[PasswordReset] RATE_LIMIT | ident=${ident} count=${existing.timestamps.length}`);
          // Return success to prevent enumeration — silently drop
          return { success: true };
        }
        existing.timestamps.push(now);
      } else {
        resetRateMap.set(ident, { timestamps: [now] });
      }

      // [STEP] Look up user by email or username
      const isEmail = ident.includes("@");
      const user = isEmail
        ? await getAppUserByEmail(ident)
        : await getAppUserByUsername(ident);

      if (!user) {
        // [VERIFY] User not found — return success to prevent enumeration
        console.log(`[PasswordReset] user not found for ident=${ident} — returning success (anti-enumeration)`);
        return { success: true };
      }

      // [STEP] Generate CSPRNG token (32 bytes = 256 bits of entropy)
      const rawToken = crypto.randomBytes(32).toString("hex"); // 64 hex chars
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const expiresAt = now + 30 * 60 * 1000; // 30 minutes

      console.log(`[PasswordReset] Generated token | userId=${user.id} username=${user.username} expiresAt=${new Date(expiresAt).toISOString()}`);

      // [STEP] Store hash in DB
      await updateAppUser(user.id, {
        passwordResetToken: tokenHash,
        passwordResetExpiresAt: expiresAt,
      });

      // [STEP] Build reset URL with raw token
      const origin = input.origin.replace(/\/$/, "");
      const resetUrl = `${origin}/reset-password?token=${rawToken}&uid=${user.id}`;

      // [STEP] Attempt Discord DM delivery
      let dmDelivered = false;
      if (user.discordId) {
        try {
          const discordClient = getDiscordClient();
          if (discordClient) {
            const dmChannel = await discordClient.users.createDM(user.discordId);
            await dmChannel.send(
              `🔐 **Password Reset Request**\n\n` +
              `A password reset was requested for your account **${user.username}**.\n\n` +
              `Click the link below to reset your password. This link expires in **30 minutes**.\n\n` +
              `${resetUrl}\n\n` +
              `If you did not request this, you can safely ignore this message.`
            );
            dmDelivered = true;
            console.log(`[PasswordReset] Discord DM delivered | userId=${user.id} discordId=${user.discordId}`);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[PasswordReset] Discord DM failed | userId=${user.id} discordId=${user.discordId} error=${msg}`);
        }
      }

      // [STEP] Owner notification (always — provides audit trail; also serves as fallback)
      const deliveryNote = dmDelivered
        ? `Reset link sent via Discord DM to ${user.discordUsername ?? user.discordId}.`
        : user.discordId
          ? `Discord DM FAILED — relay link manually.`
          : `User has no Discord linked — relay link manually.`;

      await notifyOwner({
        title: `[PasswordReset] Reset requested for ${user.username}`,
        content:
          `User: ${user.username} (${user.email})\n` +
          `Delivery: ${deliveryNote}\n` +
          `Expires: ${new Date(expiresAt).toISOString()}\n\n` +
          `Reset URL:\n${resetUrl}`,
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[PasswordReset] Owner notification failed (non-critical) | error=${msg}`);
      });

      console.log(`[PasswordReset] [OUTPUT] success | userId=${user.id} username=${user.username} dmDelivered=${dmDelivered}`);
      return { success: true };
    }),

  /**
   * resetPassword
   *
   * Validates the reset token and sets a new password.
   *
   * Security design:
   *   - Token is validated by SHA-256 hashing the raw input and comparing to the stored hash.
   *   - Token is single-use: cleared from DB immediately after successful reset.
   *   - Expired tokens are rejected.
   *   - After reset, all existing sessions are invalidated (tokenVersion increment).
   *
   * [INPUT]  uid      — app_users.id (from URL param)
   * [INPUT]  token    — raw 64-hex reset token (from URL param)
   * [INPUT]  password — new password (min 8 chars)
   * [OUTPUT] { success: true } on success
   */
  resetPassword: publicProcedure
    .input(z.object({
      uid: z.number().int().positive(),
      token: z.string().length(64).regex(/^[0-9a-f]+$/i, "Invalid token format"),
      password: z.string().min(8, "Password must be at least 8 characters"),
    }))
    .mutation(async ({ input }) => {
      console.log(`[PasswordReset] resetPassword | uid=${input.uid}`);

      // [STEP] Load user
      const user = await getAppUserById(input.uid);
      if (!user) {
        console.warn(`[PasswordReset] resetPassword | user not found | uid=${input.uid}`);
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid or expired reset link." });
      }

      // [STEP] Validate token exists
      if (!user.passwordResetToken || !user.passwordResetExpiresAt) {
        console.warn(`[PasswordReset] resetPassword | no pending reset | uid=${input.uid}`);
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid or expired reset link." });
      }

      // [STEP] Check expiry
      const now = Date.now();
      if (now > user.passwordResetExpiresAt) {
        console.warn(`[PasswordReset] resetPassword | token expired | uid=${input.uid} expiredAt=${new Date(user.passwordResetExpiresAt).toISOString()}`);
        // Clear expired token
        await updateAppUser(input.uid, { passwordResetToken: null, passwordResetExpiresAt: null });
        throw new TRPCError({ code: "BAD_REQUEST", message: "Reset link has expired. Please request a new one." });
      }

      // [STEP] Validate token hash
      const inputHash = crypto.createHash("sha256").update(input.token).digest("hex");
      const tokenValid = inputHash === user.passwordResetToken;
      if (!tokenValid) {
        console.warn(`[PasswordReset] resetPassword | token mismatch | uid=${input.uid}`);
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid or expired reset link." });
      }

      // [STEP] Hash new password (cost=10: OWASP-compliant, ~110ms vs ~250ms for cost=12)
      const passwordHash = await bcrypt.hash(input.password, 10);

      // [STEP] Update password, clear reset token, invalidate all sessions
      await updateAppUser(input.uid, {
        passwordHash,
        passwordResetToken: null,
        passwordResetExpiresAt: null,
      });
      // Invalidate all existing sessions by incrementing tokenVersion
      await incrementTokenVersion(input.uid);
      invalidateCachedAppUser(input.uid);

      console.log(`[PasswordReset] [OUTPUT] success | uid=${input.uid} username=${user.username} sessionsInvalidated=true`);
      return { success: true };
    }),
});

// ─── Password reset rate-limit map ────────────────────────────────────────────
// In-memory map: identifier (email/username) → list of request timestamps
// Pruned on each access; not persisted across restarts (intentional — restart clears limits)
const resetRateMap = new Map<string, { timestamps: number[] }>();

// ─── Login rate-limit map ─────────────────────────────────────────────────────
/**
 * In-memory rate limiter for the login endpoint.
 *
 * Tracks failed login attempts per IP address.
 * Key: IP address string
 * Value: array of UTC timestamps (ms) of failed attempts
 *
 * Limits:
 *   - Max 10 failed attempts per IP per 15-minute window
 *   - On breach: throw TRPCError FORBIDDEN (429-equivalent) and log security event
 *   - Successful login does NOT reset the counter (prevents bypass via success)
 *   - Counter resets naturally as old timestamps fall outside the 15-min window
 *
 * Design notes:
 *   - In-memory only — cleared on server restart (intentional: restarts are rare,
 *     and persistent storage would add latency to every login attempt)
 *   - Per-IP, not per-account — prevents distributed attacks targeting one account
 *     from different IPs, and prevents account enumeration via rate limit responses
 *   - The limit is applied BEFORE password check to prevent timing attacks
 */
export const loginRateMap = new Map<string, { failTimestamps: number[] }>();

export const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const LOGIN_RATE_MAX_FAILURES = 10;           // max failures per window

/**
 * Check and record a login attempt for the given IP.
 *
 * [INPUT]  ip      — client IP address
 * [OUTPUT] boolean — true if the attempt is allowed, false if rate-limited
 *
 * Side effect: appends the current timestamp to the failure list if allowed.
 * Call this BEFORE the password check; call recordLoginFailure() on auth failure.
 */
export function checkLoginRateLimit(ip: string): { allowed: boolean; remainingAttempts: number; lockoutUntil: number | null } {
  const now = Date.now();
  const entry = loginRateMap.get(ip);

  if (!entry) {
    // First attempt from this IP — allow
    return { allowed: true, remainingAttempts: LOGIN_RATE_MAX_FAILURES, lockoutUntil: null };
  }

  // Prune expired timestamps
  entry.failTimestamps = entry.failTimestamps.filter(t => now - t < LOGIN_RATE_WINDOW_MS);

  if (entry.failTimestamps.length >= LOGIN_RATE_MAX_FAILURES) {
    const oldestFailure = Math.min(...entry.failTimestamps);
    const windowResetMs = LOGIN_RATE_WINDOW_MS - (now - oldestFailure);
    const windowResetMin = Math.ceil(windowResetMs / 60_000);
    console.warn(
      `[LoginRateLimit] BLOCKED | IP=${ip} failures=${entry.failTimestamps.length} ` +
      `windowResetIn=${windowResetMin}min`
    );
    const lockoutUntil = oldestFailure + LOGIN_RATE_WINDOW_MS;
    return { allowed: false, remainingAttempts: 0, lockoutUntil };
  }

  return { allowed: true, remainingAttempts: LOGIN_RATE_MAX_FAILURES - entry.failTimestamps.length, lockoutUntil: null };
}

/**
 * Record a failed login attempt for the given IP.
 * Call this after a confirmed auth failure (wrong password, user not found, etc.).
 */
export function recordLoginFailure(ip: string): void {
  const now = Date.now();
  const entry = loginRateMap.get(ip);
  if (entry) {
    entry.failTimestamps.push(now);
  } else {
    loginRateMap.set(ip, { failTimestamps: [now] });
  }
}
