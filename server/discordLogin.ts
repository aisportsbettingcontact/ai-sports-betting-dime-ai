/**
 * discordLogin.ts — Discord OAuth as the PRIMARY login method
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  FLOW OVERVIEW                                                          │
 * │                                                                         │
 * │  1. GET  /api/auth/discord-login/connect                               │
 * │     → Generate CSRF state as a SIGNED JWT (zero DB operations)         │
 * │     → Redirect to Discord OAuth consent screen immediately             │
 * │       Scopes: identify                                                  │
 * │                                                                         │
 * │  2. GET  /api/auth/discord-login/callback                              │
 * │     → Validate CSRF state JWT (cryptographic, no DB read)              │
 * │     → Exchange code for access_token with Discord                      │
 * │     → Fetch Discord profile (id, username, avatar)                     │
 * │     → Find existing appUser by discordId (single indexed query)        │
 * │       → If found + hasAccess + not expired: issue session cookie       │
 * │       → If NOT found: redirect /login?discord_error=no_account         │
 * │     → Fire-and-forget: update Discord profile fields + lastSignedIn    │
 * │                                                                         │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * PERFORMANCE ARCHITECTURE:
 *   /connect critical path: 0 DB operations, 0 network calls → pure CPU → <1ms
 *   /callback critical path:
 *     - CSRF state JWT validation is CPU-only (no DB)
 *     - 1 Discord token exchange (unavoidable)
 *     - 1 Discord profile fetch
 *     - 1 DB read (user lookup by discordId)
 *     - Profile update + lastSignedIn are fire-and-forget (non-blocking)
 *
 * SECURITY:
 *   - CSRF state is a signed JWT (HS256, JWT_SECRET) with 10-min TTL.
 *   - No self-registration. Only accounts pre-created by the owner can log in.
 *   - Access is controlled by: discordId in DB + hasAccess=true + expiryDate check.
 *   - Discord access_token is NEVER stored in the DB or logged.
 *   - Session cookie: httpOnly, sameSite=none (prod) / lax (dev), 90-day JWT.
 *
 * ROUTE PREFIX: /api/auth/discord-login
 *   MUST be under /api/ — the Manus production proxy only forwards /api/* to Express.
 *
 * DISCORD APP SETUP REQUIRED:
 *   - Redirect URI: https://aisportsbettingmodels.com/api/auth/discord-login/callback
 *   - Scopes: identify
 *
 * NOTE: guilds.members.read scope has been intentionally removed.
 *   That scope requires the Discord bot to be present in the guild AND the scope
 *   to be explicitly enabled in the Discord Developer Portal. When the bot is not
 *   in the guild, Discord shows "Server Error" on the authorize page — blocking ALL
 *   users from logging in. Access control is enforced at the DB level instead:
 *   only users whose discordId is pre-registered with hasAccess=true can log in.
 */

import type { Express, Request, Response } from "express";
import { SignJWT, jwtVerify } from "jose";
import { ENV } from "./_core/env";
import { getSessionCookieOptions } from "./_core/cookies";
import { getDb, getAppUserById, updateAppUser, updateAppUserLastSignedIn } from "./db";
import { appUsers } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { syncDiscordRole } from "./discord/discordRoleSync";

const APP_USER_COOKIE = "app_session";
const DISCORD_API     = "https://discord.com/api/v10";
const ROUTE_PREFIX    = "/api/auth/discord-login";
const STATE_TTL_MS    = 10 * 60 * 1000; // 10 minutes

// OAuth scopes:
//   identify — read user id, username, avatar, discriminator, global_name
//
// NOTE: guilds.members.read is intentionally NOT included.
// That scope requires the Discord bot to be in the guild and explicitly enabled
// in the Discord Developer Portal. Without it, Discord shows "Server Error" on
// the authorize page. Access control is enforced at the DB level instead.
const OAUTH_SCOPES = "identify";

// ── CSRF State JWT ─────────────────────────────────────────────────────────────
//
// The CSRF state is a signed JWT containing { returnPath, nonce }.
// This eliminates ALL DB operations from the /connect critical path.
// Validation at /callback is pure CPU (signature verification + expiry check).
//
// JWT payload: { type: "discord_login_state", returnPath: string, nonce: string }
// Algorithm: HS256 using JWT_SECRET
// TTL: 10 minutes

function getStateSecret(): Uint8Array {
  return new TextEncoder().encode(ENV.cookieSecret);
}

async function createStateToken(returnPath: string): Promise<string> {
  const nonce = Math.random().toString(36).slice(2) +
                Math.random().toString(36).slice(2) +
                Math.random().toString(36).slice(2);
  return new SignJWT({ type: "discord_login_state", returnPath, nonce })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${STATE_TTL_MS / 1000}s`)
    .sign(getStateSecret());
}

/**
 * Restricts returnPath to same-site relative paths. Anything absolute
 * (https://evil.example), protocol-relative (//evil.example), or otherwise
 * malformed falls back to the canonical feed — closes the open-redirect
 * where the OAuth callback 302s to an attacker-supplied URL.
 */
function sanitizeReturnPath(p: unknown): string {
  if (
    typeof p === "string" &&
    p.startsWith("/") &&
    !p.startsWith("//") &&
    !p.includes("://") &&
    !p.includes("\\")
  ) {
    return p;
  }
  return "/feed/model/mlb";
}

async function verifyStateToken(
  token: string,
  requestId: string
): Promise<{ ok: true; returnPath: string } | { ok: false; reason: string }> {
  try {
    const { payload } = await jwtVerify(token, getStateSecret(), {
      algorithms: ["HS256"],
    });
    if (payload.type !== "discord_login_state") {
      return { ok: false, reason: "wrong_token_type" };
    }
    const returnPath = sanitizeReturnPath(payload.returnPath);
    console.log(
      `[DiscordLogin][STATE_JWT][OK] requestId=${requestId} returnPath="${returnPath}"`
    );
    return { ok: true, returnPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[DiscordLogin][STATE_JWT][FAIL] requestId=${requestId} JWT verification failed: "${msg}"`
    );
    if (msg.includes("expired")) return { ok: false, reason: "state_expired" };
    return { ok: false, reason: "state_mismatch" };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build the canonical public-facing origin for OAuth redirect URIs.
 * Priority: ENV.publicOrigin → x-forwarded headers → Express-derived
 */
function buildPublicOrigin(req: Request, requestId: string): string {
  if (ENV.publicOrigin) {
    return ENV.publicOrigin.replace(/\/$/, "");
  }
  const fwdProto = req.get("x-forwarded-proto");
  const fwdHost  = req.get("x-forwarded-host");
  if (fwdProto && fwdHost) {
    const proto = fwdProto.split(",")[0]!.trim();
    const origin = `${proto}://${fwdHost}`;
    console.warn(
      `[DiscordLogin][ORIGIN][WARN] requestId=${requestId}` +
      ` PUBLIC_ORIGIN not set — using x-forwarded headers: "${origin}"`
    );
    return origin;
  }
  const fallback = `${req.protocol}://${req.get("host") ?? "localhost"}`;
  console.warn(
    `[DiscordLogin][ORIGIN][WARN] requestId=${requestId}` +
    ` PUBLIC_ORIGIN not set, no x-forwarded headers — falling back to: "${fallback}"`
  );
  return fallback;
}

/** Sign a JWT for an app user session (90-day expiry) */
async function signAppUserToken(
  userId: number,
  role: string,
  tokenVersion: number
): Promise<string> {
  const secret = new TextEncoder().encode(ENV.cookieSecret);
  return new SignJWT({ sub: String(userId), role, type: "app_user", tv: tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("90d")
    .sign(secret);
}

// ── Route registration ────────────────────────────────────────────────────────

export function registerDiscordLoginRoutes(app: Express): void {
  console.log(
    `[DiscordLogin][STARTUP] Discord login routes registered:` +
    `\n  → routes      : GET ${ROUTE_PREFIX}/connect, GET ${ROUTE_PREFIX}/callback` +
    `\n  → scopes      : "${OAUTH_SCOPES}"` +
    `\n  → publicOrigin: ${ENV.publicOrigin ? `SET="${ENV.publicOrigin}"` : "NOT_SET"}` +
    `\n  → clientId    : ${ENV.discordClientId ? `${ENV.discordClientId.slice(0,8)}…` : "MISSING"}` +
    `\n  → clientSecret: ${ENV.discordClientSecret ? "SET" : "MISSING"}` +
    `\n  → stateMode   : JWT (zero DB operations on /connect)` +
    `\n  → accessControl: DB-level (discordId + hasAccess + expiryDate)`
  );

  // ─── Step 1: Initiate Discord OAuth ─────────────────────────────────────────
  //
  // CRITICAL PATH: 0 DB operations, 0 network calls.
  // State is a signed JWT — generated in pure CPU, embedded in the OAuth URL.
  // Total latency: <2ms (JWT sign + URL construction + 302 redirect).
  app.get(`${ROUTE_PREFIX}/connect`, async (req: Request, res: Response) => {
    const t0        = Date.now();
    const requestId = Math.random().toString(36).slice(2, 8).toUpperCase();
    const returnPath = sanitizeReturnPath(req.query.returnPath);

    // prompt=consent: always show consent screen (forces re-auth, most compatible).
    // prompt=none: skip consent if user already authorized this app in this browser.
    // We default to "consent" for reliability; client can pass prompt=none to skip.
    const discordPrompt = req.query.prompt === "none" ? "none" : "consent";

    console.log(
      `[DiscordLogin][CONNECT] requestId=${requestId} returnPath="${returnPath}" prompt=${discordPrompt}`
    );

    if (!ENV.discordClientId || !ENV.discordClientSecret) {
      console.error(
        `[DiscordLogin][CONNECT][FAIL] requestId=${requestId}` +
        ` DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET not set.`
      );
      res.redirect(302, `/login?error=discord_not_configured`);
      return;
    }

    try {
      // Generate CSRF state as a signed JWT — NO DB write, NO network call
      const state = await createStateToken(returnPath);

      const publicOrigin = buildPublicOrigin(req, requestId);
      const redirectUri  = `${publicOrigin}${ROUTE_PREFIX}/callback`;

      const params = new URLSearchParams({
        client_id:     ENV.discordClientId,
        redirect_uri:  redirectUri,
        response_type: "code",
        scope:         OAUTH_SCOPES,
        state,
        prompt:        discordPrompt,
      });

      const authorizeUrl = `https://discord.com/oauth2/authorize?${params.toString()}`;

      console.log(
        `[DiscordLogin][CONNECT][OK] requestId=${requestId}` +
        ` redirectUri="${redirectUri}" prompt=${discordPrompt} totalMs=${Date.now() - t0}`
      );

      res.redirect(302, authorizeUrl);
    } catch (err) {
      console.error(`[DiscordLogin][CONNECT][EXCEPTION] requestId=${requestId}`, err);
      res.redirect(302, `/login?error=discord_connect_failed`);
    }
  });

  // ─── Step 2: Handle Discord OAuth callback ─────────────────────────────────
  //
  // CRITICAL PATH optimizations:
  //   CP-1: CSRF state validated via JWT (CPU-only, no DB read)
  //   CP-2: Discord profile fetched with access_token
  //   CP-3: Profile update + lastSignedIn are fire-and-forget (non-blocking)
  //
  // SAFETY: The entire handler is wrapped in a top-level try/catch.
  // Express 4.x does NOT automatically catch async errors — an unhandled throw
  // inside an async route handler causes a 500 "Server Error" page instead of
  // a clean redirect. The outer try/catch ensures ALL errors redirect gracefully.
  app.get(`${ROUTE_PREFIX}/callback`, async (req: Request, res: Response) => {
    const t0        = Date.now();
    const requestId = Math.random().toString(36).slice(2, 8).toUpperCase();

    try {
      const { code, state, error: discordError } = req.query as Record<string, string | undefined>;

      console.log(
        `[DiscordLogin][CALLBACK] requestId=${requestId}` +
        ` code=${!!code} state=${!!state} discordError=${discordError ?? "none"}`
      );

      // Discord denied access (user clicked "Cancel")
      if (discordError) {
        console.warn(
          `[DiscordLogin][CALLBACK][DISCORD_ERROR] requestId=${requestId}` +
          ` discordError="${discordError}"`
        );
        res.redirect(302, `/login?discord_error=discord_cancelled`);
        return;
      }

      if (!code || !state) {
        console.warn(
          `[DiscordLogin][CALLBACK][MISSING_PARAMS] requestId=${requestId}` +
          ` code=${!!code} state=${!!state}`
        );
        res.redirect(302, `/login?discord_error=invalid_callback`);
        return;
      }

      // ── CP-1: Validate CSRF state JWT (CPU-only, no DB) ───────────────────────
      const stateResult = await verifyStateToken(state, requestId);
      if (!stateResult.ok) {
        console.error(
          `[DiscordLogin][CALLBACK][STATE_FAIL] requestId=${requestId}` +
          ` reason="${stateResult.reason}"`
        );
        res.redirect(302, `/login?discord_error=${stateResult.reason}`);
        return;
      }

      const returnPath = stateResult.returnPath;
      console.log(
        `[DiscordLogin][CALLBACK][STATE_OK] requestId=${requestId}` +
        ` returnPath="${returnPath}" stateMs=${Date.now() - t0}`
      );

      // ── CP-2a: Token exchange with Discord ────────────────────────────────────
      const publicOrigin = buildPublicOrigin(req, requestId);
      const redirectUri  = `${publicOrigin}${ROUTE_PREFIX}/callback`;

      // ── TOTAL CALLBACK DEADLINE ─────────────────────────────────────────────
      // Guard against the entire callback exceeding 15s (platform proxy kills at ~120s).
      // If we haven't redirected within 15s, force a clean error redirect.
      const CALLBACK_DEADLINE_MS = 15_000;
      const deadlineTimer = setTimeout(() => {
        if (!res.headersSent) {
          console.error(
            `[DiscordLogin][CALLBACK][DEADLINE_EXCEEDED] requestId=${requestId}` +
            ` totalMs=${Date.now() - t0} — forcing redirect to prevent Service Unavailable`
          );
          res.redirect(302, `/login?discord_error=timeout`);
        }
      }, CALLBACK_DEADLINE_MS);
      // Ensure the deadline timer never prevents Node from exiting
      deadlineTimer.unref();

      let accessToken: string;
      try {
        const t1 = Date.now();
        // AbortSignal.timeout(8000): hard 8-second timeout on the token exchange.
        // Without this, a stalled Discord API connection hangs indefinitely (2+ min)
        // until the platform proxy kills the request with "Service Unavailable".
        const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          signal: AbortSignal.timeout(8_000),
          body: new URLSearchParams({
            client_id:     ENV.discordClientId,
            client_secret: ENV.discordClientSecret,
            grant_type:    "authorization_code",
            code,
            redirect_uri:  redirectUri,
          }),
        });

        if (!tokenRes.ok) {
          const errText = await tokenRes.text().catch(() => "");
          console.error(
            `[DiscordLogin][CALLBACK][TOKEN_FAIL] requestId=${requestId}` +
            ` HTTP ${tokenRes.status}: "${errText.slice(0, 300)}"`
          );
          res.redirect(302, `/login?discord_error=token_exchange_failed`);
          return;
        }

        const tokenData = await tokenRes.json() as { access_token?: string };
        if (!tokenData.access_token) {
          console.error(
            `[DiscordLogin][CALLBACK][TOKEN_MISSING] requestId=${requestId}` +
            ` Discord token response missing access_token field`
          );
          res.redirect(302, `/login?discord_error=token_exchange_failed`);
          return;
        }
        accessToken = tokenData.access_token;
        console.log(
          `[DiscordLogin][CALLBACK][TOKEN_OK] requestId=${requestId}` +
          ` tokenMs=${Date.now() - t1}`
        );
      } catch (err) {
        const isTimeout = err instanceof Error && err.name === "TimeoutError";
        console.error(
          `[DiscordLogin][CALLBACK][TOKEN_EXCEPTION] requestId=${requestId}` +
          ` isTimeout=${isTimeout}`,
          err
        );
        clearTimeout(deadlineTimer);
        if (!res.headersSent) {
          res.redirect(302, isTimeout
            ? `/login?discord_error=timeout`
            : `/login?discord_error=token_exchange_failed`);
        }
        return;
      }

      // ── CP-2b: Fetch Discord profile ──────────────────────────────────────────
      const t2 = Date.now();
      let profile: {
        id: string;
        username: string;
        discriminator?: string;
        avatar?: string | null;
        global_name?: string | null;
      };

      try {
        // AbortSignal.timeout(8000): hard 8-second timeout on the profile fetch.
        const profileRes = await fetch(`${DISCORD_API}/users/@me`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(8_000),
        });

        if (!profileRes.ok) {
          const errText = await profileRes.text().catch(() => "");
          console.error(
            `[DiscordLogin][CALLBACK][PROFILE_HTTP_FAIL] requestId=${requestId}` +
            ` HTTP ${profileRes.status}: "${errText.slice(0, 200)}"`
          );
          res.redirect(302, `/login?discord_error=profile_fetch_failed`);
          return;
        }

        profile = await profileRes.json() as typeof profile;
      } catch (err) {
        const isTimeout = err instanceof Error && err.name === "TimeoutError";
        console.error(
          `[DiscordLogin][CALLBACK][PROFILE_EXCEPTION] requestId=${requestId}` +
          ` isTimeout=${isTimeout}`,
          err
        );
        clearTimeout(deadlineTimer);
        if (!res.headersSent) {
          res.redirect(302, isTimeout
            ? `/login?discord_error=timeout`
            : `/login?discord_error=profile_fetch_failed`);
        }
        return;
      }

      if (!profile?.id) {
        console.error(
          `[DiscordLogin][CALLBACK][PROFILE_INVALID] requestId=${requestId}` +
          ` profile missing id field: ${JSON.stringify(profile).slice(0, 200)}`
        );
        res.redirect(302, `/login?discord_error=profile_fetch_failed`);
        return;
      }

      const discordId = profile.id;
      const discordUsername = (profile.discriminator && profile.discriminator !== "0")
        ? `${profile.username}#${profile.discriminator}`
        : (profile.global_name || profile.username);
      const discordAvatar = profile.avatar ?? null;

      console.log(
        `[DiscordLogin][CALLBACK][PROFILE_OK] requestId=${requestId}` +
        ` discordId="${discordId}" username="${discordUsername}" profileMs=${Date.now() - t2}`
      );

      // ── CP-3: DB user lookup (single indexed query) ───────────────────────────
      const db = await getDb();
      if (!db) {
        console.error(`[DiscordLogin][CALLBACK][DB_FAIL] requestId=${requestId} DB unavailable`);
        res.redirect(302, `/login?discord_error=db_unavailable`);
        return;
      }

      const t3 = Date.now();
      const userRows = await db
        .select({ id: appUsers.id })
        .from(appUsers)
        .where(eq(appUsers.discordId, discordId))
        .limit(1);

      // ── CP-3b: Fallback — check manualDiscordId pre-registration ───────────
      // Owner may have pre-registered this Discord ID in User Management before
      // the user completed OAuth. If found, atomically promote manualDiscordId
      // to discordId and clear it so it is never reused.
      let userId: number;
      let user: Awaited<ReturnType<typeof getAppUserById>>;

      if (userRows.length === 0) {
        console.log(
          `[DiscordLogin][CALLBACK][CP3B_FALLBACK] requestId=${requestId}` +
          ` No live discordId match for "${discordId}" — checking manualDiscordId pre-registration`
        );
        const manualRows = await db
          .select({ id: appUsers.id })
          .from(appUsers)
          .where(eq(appUsers.manualDiscordId, discordId))
          .limit(1);

        if (manualRows.length === 0) {
          console.warn(
            `[DiscordLogin][CALLBACK][NO_ACCOUNT] requestId=${requestId}` +
            ` No appUser found with discordId="${discordId}" OR manualDiscordId="${discordId}"` +
            ` (@${discordUsername}). dbMs=${Date.now() - t3}`
          );
          res.redirect(302, `/login?discord_error=no_account&discord_user=${encodeURIComponent(discordUsername)}`);
          return;
        }

        // Found via manualDiscordId — promote to live discordId atomically
        const manualUserId = manualRows[0]!.id;
        console.log(
          `[DiscordLogin][CALLBACK][CP3B_MATCH] requestId=${requestId}` +
          ` manualDiscordId match: userId=${manualUserId}` +
          ` discordId="${discordId}" (@${discordUsername})` +
          ` action=PROMOTE_manualDiscordId_to_discordId`
        );
        try {
          await updateAppUser(manualUserId, {
            discordId,
            discordUsername,
            discordAvatar: null,
            discordConnectedAt: Date.now(),
            manualDiscordId: null,
          });
          console.log(
            `[DiscordLogin][CALLBACK][CP3B_PROMOTED] requestId=${requestId}` +
            ` userId=${manualUserId} manualDiscordId promoted to live discordId="${discordId}"` +
            ` manualDiscordId cleared. dbMs=${Date.now() - t3}`
          );
        } catch (promoteErr) {
          const msg = (promoteErr as Error)?.message ?? String(promoteErr);
          console.error(
            `[DiscordLogin][CALLBACK][CP3B_PROMOTE_FAIL] requestId=${requestId}` +
            ` userId=${manualUserId} error=${msg}`
          );
          res.redirect(302, `/login?discord_error=server_error`);
          return;
        }
        userId = manualUserId;
        user = await getAppUserById(userId);
      } else {
        userId = userRows[0]!.id;
        user = await getAppUserById(userId);
      }

      if (!user) {
        console.error(
          `[DiscordLogin][CALLBACK][USER_NOT_FOUND] requestId=${requestId}` +
          ` getAppUserById(${userId}) returned null. DB inconsistency.`
        );
        res.redirect(302, `/login?discord_error=user_not_found`);
        return;
      }

      if (!user.hasAccess) {
        console.warn(
          `[DiscordLogin][CALLBACK][NO_ACCESS] requestId=${requestId}` +
          ` userId=${userId} hasAccess=false`
        );
        res.redirect(302, `/login?discord_error=access_disabled`);
        return;
      }

      if (user.expiryDate && Date.now() > user.expiryDate) {
        console.warn(
          `[DiscordLogin][CALLBACK][EXPIRED] requestId=${requestId}` +
          ` userId=${userId} expired at ${new Date(user.expiryDate).toISOString()}`
        );
        res.redirect(302, `/login?discord_error=account_expired`);
        return;
      }

      console.log(
        `[DiscordLogin][CALLBACK][DB_OK] requestId=${requestId}` +
        ` userId=${userId} role=${user.role} dbMs=${Date.now() - t3}`
      );

      // A manual Discord ID promotion is a verified link; synchronize entitlement now.
      // This is safe to run for existing links too and remains non-blocking.
      void syncDiscordRole(userId, user.hasAccess).catch((syncErr: unknown) =>
        console.warn(`[DiscordLogin][CALLBACK][ROLE_SYNC_WARN] requestId=${requestId} userId=${userId}`, syncErr)
      );

      // ── Issue session cookie ──────────────────────────────────────────────────
      const token = await signAppUserToken(userId, user.role, user.tokenVersion);
      const cookieOptions = getSessionCookieOptions(req);

      res.cookie(APP_USER_COOKIE, token, {
        ...cookieOptions,
        maxAge: 90 * 24 * 60 * 60 * 1000, // 90 days
      });

      console.log(
        `[DiscordLogin][CALLBACK][SUCCESS] requestId=${requestId}` +
        ` ✅ Session issued for userId=${userId} (@${user.username}).` +
        ` totalMs=${Date.now() - t0} → redirecting to "${returnPath}"`
      );

      // Redirect immediately — do NOT await profile update or lastSignedIn
      clearTimeout(deadlineTimer);
      res.redirect(302, returnPath);

      // ── Fire-and-forget — update Discord profile + lastSignedIn ──────────────
      //
      // These are non-critical updates that happen AFTER the redirect is sent.
      // The user's browser is already navigating to returnPath.
      // Errors here are logged but do not affect the user experience.
      setImmediate(() => {
        Promise.all([
          db.update(appUsers)
            .set({ discordUsername, discordAvatar, discordConnectedAt: Date.now() })
            .where(eq(appUsers.id, userId))
            .catch((e: unknown) => console.warn(
              `[DiscordLogin][CALLBACK][PROFILE_UPDATE_WARN] requestId=${requestId}`, e
            )),
          updateAppUserLastSignedIn(userId)
            .catch((e: unknown) => console.warn(
              `[DiscordLogin][CALLBACK][LAST_SIGNED_IN_WARN] requestId=${requestId}`, e
            )),
        ]).catch(() => {/* already handled above */});
      });

    } catch (err) {
      // ── TOP-LEVEL SAFETY NET ─────────────────────────────────────────────────
      // Express 4.x does NOT forward async errors to the error handler.
      // Any unhandled exception above would produce a raw "Server Error" 500 page.
      // This catch block ensures the user always gets a clean redirect, never a crash page.
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(
        `[DiscordLogin][CALLBACK][UNHANDLED_EXCEPTION] requestId=${requestId}` +
        ` totalMs=${Date.now() - t0} error="${errMsg}"`,
        err
      );
      if (!res.headersSent) {
        res.redirect(302, `/login?discord_error=server_error`);
      }
    }
  });
}
