/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  DISCORD INVITE LINK — Admin-generated per-user Discord connect flow        ║
 * ╠══════════════════════════════════════════════════════════════════════════════╣
 * ║  Routes:                                                                    ║
 * ║    GET /api/auth/discord-invite/connect?token=<hex>                         ║
 * ║      → Validates invite token → redirects to Discord OAuth                  ║
 * ║    GET /api/auth/discord-invite/callback?code=...&state=...                 ║
 * ║      → Exchanges code → fetches Discord profile → links to user → session   ║
 * ╠══════════════════════════════════════════════════════════════════════════════╣
 * ║  Security invariants:                                                       ║
 * ║    - Token is 32 random bytes (256-bit entropy) — brute force infeasible    ║
 * ║    - Token is single-use: usedAt set on first successful callback           ║
 * ║    - Token expires after 7 days                                             ║
 * ║    - Token is bound to a specific userId (targetUserId)                     ║
 * ║    - State is a signed JWT (HS256) embedding token + userId + nonce         ║
 * ║    - AbortSignal.timeout(8000) on all Discord API fetch calls               ║
 * ║    - 15-second total callback deadline timer                                ║
 * ║    - Express 4 async safety: entire callback wrapped in try/catch           ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

import type { Express, Request, Response } from "express";
import { SignJWT, jwtVerify } from "jose";
import { ENV } from "./_core/env";
import { getSessionCookieOptions } from "./_core/cookies";
import { getDb, getAppUserById, updateAppUser, updateAppUserLastSignedIn } from "./db";
import { discordInviteTokens } from "../drizzle/schema";
import { eq, and, isNull, gt } from "drizzle-orm";
import { invalidateCachedAppUser } from "./dbCircuitBreaker";

// ── Constants ─────────────────────────────────────────────────────────────────
const ROUTE_PREFIX   = "/api/auth/discord-invite";
const OAUTH_SCOPES   = "identify";
const STATE_TTL_MS   = 10 * 60 * 1000;  // 10 minutes — JWT state lifetime
const CALLBACK_DEADLINE_MS = 15_000;    // 15 seconds — total callback deadline

// ── Helpers ───────────────────────────────────────────────────────────────────

function getStateSecret(): Uint8Array {
  return new TextEncoder().encode(ENV.cookieSecret + ":discord_invite");
}

/**
 * Create a signed JWT state for the invite OAuth flow.
 * Embeds: inviteToken, targetUserId, nonce (CSRF protection).
 */
async function createInviteStateToken(inviteToken: string, targetUserId: number): Promise<string> {
  const nonce = Math.random().toString(36).slice(2) +
                Math.random().toString(36).slice(2) +
                Math.random().toString(36).slice(2);
  return new SignJWT({
    type:         "discord_invite_state",
    inviteToken,
    targetUserId,
    nonce,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${STATE_TTL_MS / 1000}s`)
    .sign(getStateSecret());
}

/**
 * Verify the invite state JWT and extract inviteToken + targetUserId.
 */
async function verifyInviteStateToken(
  token: string,
  requestId: string
): Promise<
  | { ok: true; inviteToken: string; targetUserId: number }
  | { ok: false; reason: string }
> {
  try {
    const { payload } = await jwtVerify(token, getStateSecret(), {
      algorithms: ["HS256"],
    });
    if (payload.type !== "discord_invite_state") {
      return { ok: false, reason: "wrong_token_type" };
    }
    const inviteToken  = typeof payload.inviteToken  === "string" ? payload.inviteToken  : null;
    const targetUserId = typeof payload.targetUserId === "number" ? payload.targetUserId : null;
    if (!inviteToken || !targetUserId) {
      return { ok: false, reason: "missing_payload_fields" };
    }
    console.log(
      `[DiscordInvite][STATE_JWT][OK] requestId=${requestId} targetUserId=${targetUserId}`
    );
    return { ok: true, inviteToken, targetUserId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[DiscordInvite][STATE_JWT][FAIL] requestId=${requestId} JWT verification failed: "${msg}"`
    );
    if (msg.includes("expired")) return { ok: false, reason: "state_expired" };
    return { ok: false, reason: "state_mismatch" };
  }
}

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
    const proto  = fwdProto.split(",")[0]!.trim();
    const origin = `${proto}://${fwdHost}`;
    console.warn(
      `[DiscordInvite][ORIGIN][WARN] requestId=${requestId}` +
      ` PUBLIC_ORIGIN not set — using x-forwarded headers: "${origin}"`
    );
    return origin;
  }
  const fallback = `${req.protocol}://${req.get("host") ?? "localhost"}`;
  console.warn(
    `[DiscordInvite][ORIGIN][WARN] requestId=${requestId}` +
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

export function registerDiscordInviteRoutes(app: Express): void {
  console.log(
    `[DiscordInvite][STARTUP] Discord invite routes registered:` +
    `\n  → routes      : GET ${ROUTE_PREFIX}/connect, GET ${ROUTE_PREFIX}/callback` +
    `\n  → scopes      : "${OAUTH_SCOPES}"` +
    `\n  → publicOrigin: ${ENV.publicOrigin ? `SET="${ENV.publicOrigin}"` : "NOT_SET"}` +
    `\n  → clientId    : ${ENV.discordClientId ? `${ENV.discordClientId.slice(0,8)}…` : "MISSING"}` +
    `\n  → clientSecret: ${ENV.discordClientSecret ? "SET" : "MISSING"}`
  );

  // ─── Step 1: Validate invite token → redirect to Discord OAuth ──────────────
  //
  // CRITICAL PATH: 1 DB read (validate token), then 302 redirect to Discord.
  // Total latency: <50ms (DB read + JWT sign + URL construction).
  app.get(`${ROUTE_PREFIX}/connect`, async (req: Request, res: Response) => {
    const t0        = Date.now();
    const requestId = Math.random().toString(36).slice(2, 8).toUpperCase();
    const rawToken  = typeof req.query.token === "string" ? req.query.token.trim() : "";

    console.log(
      `[DiscordInvite][CONNECT] requestId=${requestId} tokenPrefix="${rawToken.slice(0,8)}…"`
    );

    // [VALIDATE] Discord client credentials must be set
    if (!ENV.discordClientId || !ENV.discordClientSecret) {
      console.error(
        `[DiscordInvite][CONNECT][FAIL] requestId=${requestId}` +
        ` DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET not set.`
      );
      res.redirect(302, `/?discord_error=discord_not_configured`);
      return;
    }

    // [VALIDATE] Token must be present and 64 hex chars
    if (!rawToken || !/^[0-9a-f]{64}$/.test(rawToken)) {
      console.warn(
        `[DiscordInvite][CONNECT][FAIL] requestId=${requestId} invalid token format`
      );
      res.redirect(302, `/?discord_error=invalid_invite`);
      return;
    }

    try {
      const db = await getDb();
      if (!db) {
        console.error(`[DiscordInvite][CONNECT][FAIL] requestId=${requestId} DB unavailable`);
        res.redirect(302, `/?discord_error=db_unavailable`);
        return;
      }

      // [STEP] Look up the invite token — must exist, be unused, and not expired
      const now = Date.now();
      const [row] = await db
        .select()
        .from(discordInviteTokens)
        .where(
          and(
            eq(discordInviteTokens.token, rawToken),
            isNull(discordInviteTokens.usedAt),
            gt(discordInviteTokens.expiresAt, now)
          )
        )
        .limit(1);

      if (!row) {
        console.warn(
          `[DiscordInvite][CONNECT][FAIL] requestId=${requestId}` +
          ` token not found, already used, or expired`
        );
        res.redirect(302, `/?discord_error=invite_invalid`);
        return;
      }

      // [STEP] Verify the target user still exists and has access
      const user = await getAppUserById(row.targetUserId);
      if (!user) {
        console.warn(
          `[DiscordInvite][CONNECT][FAIL] requestId=${requestId}` +
          ` targetUserId=${row.targetUserId} not found`
        );
        res.redirect(302, `/?discord_error=user_not_found`);
        return;
      }
      if (!user.hasAccess) {
        console.warn(
          `[DiscordInvite][CONNECT][FAIL] requestId=${requestId}` +
          ` targetUserId=${row.targetUserId} hasAccess=false`
        );
        res.redirect(302, `/?discord_error=access_revoked`);
        return;
      }

      // [STEP] Build OAuth redirect URL with signed JWT state
      const state       = await createInviteStateToken(rawToken, row.targetUserId);
      const publicOrigin = buildPublicOrigin(req, requestId);
      const redirectUri  = `${publicOrigin}${ROUTE_PREFIX}/callback`;

      const params = new URLSearchParams({
        client_id:     ENV.discordClientId,
        redirect_uri:  redirectUri,
        response_type: "code",
        scope:         OAUTH_SCOPES,
        state,
        prompt:        "consent",
      });
      const authorizeUrl = `https://discord.com/oauth2/authorize?${params.toString()}`;

      console.log(
        `[DiscordInvite][CONNECT][OK] requestId=${requestId}` +
        ` targetUserId=${row.targetUserId} username=${user.username}` +
        ` redirectUri="${redirectUri}" totalMs=${Date.now() - t0}`
      );
      res.redirect(302, authorizeUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[DiscordInvite][CONNECT][EXCEPTION] requestId=${requestId}`, msg);
      res.redirect(302, `/?discord_error=invite_connect_failed`);
    }
  });

  // ─── Step 2: Handle Discord OAuth callback → link Discord to user ───────────
  //
  // CRITICAL PATH optimizations:
  //   CP-1: State validated via JWT (CPU-only, no DB read for CSRF check)
  //   CP-2: Token re-validated in DB (single-use enforcement)
  //   CP-3: Discord profile fetched with access_token
  //   CP-4: discordId/username/avatar written to app_users row
  //   CP-5: Token marked as used (single-use enforcement)
  //   CP-6: App session cookie issued → redirect to /feed
  //
  // SAFETY: The entire handler is wrapped in a top-level try/catch.
  // Express 4.x does NOT automatically catch async errors.
  app.get(`${ROUTE_PREFIX}/callback`, async (req: Request, res: Response) => {
    const t0        = Date.now();
    const requestId = Math.random().toString(36).slice(2, 8).toUpperCase();

    // 15-second total deadline — prevents hanging if Discord API stalls
    let deadlineTriggered = false;
    const deadlineTimer = setTimeout(() => {
      deadlineTriggered = true;
      if (!res.headersSent) {
        console.error(
          `[DiscordInvite][CALLBACK][DEADLINE] requestId=${requestId}` +
          ` 15s deadline exceeded — force redirecting`
        );
        res.redirect(302, `/?discord_error=timeout`);
      }
    }, CALLBACK_DEADLINE_MS);

    try {
      const { code, state, error: discordError } = req.query as Record<string, string | undefined>;

      // [VALIDATE] Discord returned an error (e.g. user clicked Cancel)
      if (discordError) {
        clearTimeout(deadlineTimer);
        console.warn(
          `[DiscordInvite][CALLBACK][DISCORD_ERROR] requestId=${requestId}` +
          ` discordError="${discordError}"`
        );
        res.redirect(302, `/?discord_error=${discordError === "access_denied" ? "cancelled" : "discord_error"}`);
        return;
      }

      // [VALIDATE] code and state must be present
      if (!code || !state) {
        clearTimeout(deadlineTimer);
        console.warn(
          `[DiscordInvite][CALLBACK][FAIL] requestId=${requestId}` +
          ` missing code=${!!code} state=${!!state}`
        );
        res.redirect(302, `/?discord_error=state_mismatch`);
        return;
      }

      // [VALIDATE] Verify the signed JWT state
      const stateResult = await verifyInviteStateToken(state, requestId);
      if (!stateResult.ok) {
        clearTimeout(deadlineTimer);
        console.warn(
          `[DiscordInvite][CALLBACK][FAIL] requestId=${requestId}` +
          ` state verification failed: ${stateResult.reason}`
        );
        res.redirect(302, `/?discord_error=${stateResult.reason}`);
        return;
      }
      const { inviteToken, targetUserId } = stateResult;

      // [VALIDATE] Re-validate the invite token in DB (single-use enforcement)
      const db = await getDb();
      if (!db) {
        clearTimeout(deadlineTimer);
        console.error(`[DiscordInvite][CALLBACK][FAIL] requestId=${requestId} DB unavailable`);
        res.redirect(302, `/?discord_error=db_unavailable`);
        return;
      }

      const now = Date.now();
      const [tokenRow] = await db
        .select()
        .from(discordInviteTokens)
        .where(
          and(
            eq(discordInviteTokens.token, inviteToken),
            isNull(discordInviteTokens.usedAt),
            gt(discordInviteTokens.expiresAt, now)
          )
        )
        .limit(1);

      if (!tokenRow) {
        clearTimeout(deadlineTimer);
        console.warn(
          `[DiscordInvite][CALLBACK][FAIL] requestId=${requestId}` +
          ` invite token already used or expired during callback`
        );
        res.redirect(302, `/?discord_error=invite_already_used`);
        return;
      }

      // [VALIDATE] Target user must still exist and have access
      const user = await getAppUserById(targetUserId);
      if (!user || !user.hasAccess) {
        clearTimeout(deadlineTimer);
        console.warn(
          `[DiscordInvite][CALLBACK][FAIL] requestId=${requestId}` +
          ` targetUserId=${targetUserId} not found or no access`
        );
        res.redirect(302, `/?discord_error=access_revoked`);
        return;
      }

      // [STEP] Exchange authorization code for access token
      // AbortSignal.timeout(8000): hard 8-second timeout on the token exchange.
      const publicOrigin = buildPublicOrigin(req, requestId);
      const redirectUri  = `${publicOrigin}${ROUTE_PREFIX}/callback`;

      console.log(
        `[DiscordInvite][CALLBACK][STEP] requestId=${requestId}` +
        ` exchanging code for access_token targetUserId=${targetUserId}`
      );

      let tokenData: { access_token?: string; token_type?: string; error?: string };
      try {
        const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
          method:  "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          signal:  AbortSignal.timeout(8_000),
          body: new URLSearchParams({
            client_id:     ENV.discordClientId,
            client_secret: ENV.discordClientSecret,
            grant_type:    "authorization_code",
            code,
            redirect_uri:  redirectUri,
          }),
        });
        tokenData = await tokenRes.json() as typeof tokenData;
      } catch (fetchErr) {
        clearTimeout(deadlineTimer);
        if (deadlineTriggered) return;
        const isTimeout = fetchErr instanceof Error && fetchErr.name === "TimeoutError";
        console.error(
          `[DiscordInvite][CALLBACK][TOKEN_FETCH_FAIL] requestId=${requestId}` +
          ` isTimeout=${isTimeout} error=${(fetchErr as Error).message}`
        );
        res.redirect(302, isTimeout ? `/?discord_error=timeout` : `/?discord_error=token_exchange_failed`);
        return;
      }

      if (!tokenData.access_token) {
        clearTimeout(deadlineTimer);
        if (deadlineTriggered) return;
        console.error(
          `[DiscordInvite][CALLBACK][TOKEN_FAIL] requestId=${requestId}` +
          ` Discord token exchange failed: ${JSON.stringify(tokenData)}`
        );
        res.redirect(302, `/?discord_error=token_exchange_failed`);
        return;
      }

      console.log(
        `[DiscordInvite][CALLBACK][STATE] requestId=${requestId}` +
        ` access_token acquired (${tokenData.token_type})`
      );

      // [STEP] Fetch Discord user profile
      // AbortSignal.timeout(8000): hard 8-second timeout on the profile fetch.
      let discordProfile: {
        id?: string;
        username?: string;
        global_name?: string;
        avatar?: string;
      };
      try {
        const profileRes = await fetch("https://discord.com/api/users/@me", {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
          signal:  AbortSignal.timeout(8_000),
        });
        if (!profileRes.ok) {
          throw new Error(`Discord profile HTTP ${profileRes.status}`);
        }
        discordProfile = await profileRes.json() as typeof discordProfile;
      } catch (fetchErr) {
        clearTimeout(deadlineTimer);
        if (deadlineTriggered) return;
        const isTimeout = fetchErr instanceof Error && fetchErr.name === "TimeoutError";
        console.error(
          `[DiscordInvite][CALLBACK][PROFILE_FETCH_FAIL] requestId=${requestId}` +
          ` isTimeout=${isTimeout} error=${(fetchErr as Error).message}`
        );
        res.redirect(302, isTimeout ? `/?discord_error=timeout` : `/?discord_error=profile_fetch_failed`);
        return;
      }

      if (!discordProfile.id) {
        clearTimeout(deadlineTimer);
        if (deadlineTriggered) return;
        console.error(
          `[DiscordInvite][CALLBACK][PROFILE_FAIL] requestId=${requestId}` +
          ` Discord profile missing id: ${JSON.stringify(discordProfile)}`
        );
        res.redirect(302, `/?discord_error=profile_fetch_failed`);
        return;
      }

      const discordId       = discordProfile.id;
      const discordUsername = discordProfile.global_name ?? discordProfile.username ?? discordId;
      const discordAvatar   = discordProfile.avatar ?? null;

      console.log(
        `[DiscordInvite][CALLBACK][STATE] requestId=${requestId}` +
        ` discordId=${discordId} discordUsername="${discordUsername}"` +
        ` targetUserId=${targetUserId} username=${user.username}`
      );

      // [STEP] Link Discord account to the target user row
      try {
        await updateAppUser(targetUserId, {
          discordId,
          discordUsername,
          discordAvatar,
          discordConnectedAt: now,
        });
        invalidateCachedAppUser(targetUserId);
      } catch (dbErr) {
        clearTimeout(deadlineTimer);
        if (deadlineTriggered) return;
        const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
        console.error(
          `[DiscordInvite][CALLBACK][DB_FAIL] requestId=${requestId}` +
          ` failed to update user discordId: ${msg}`
        );
        res.redirect(302, `/?discord_error=db_unavailable`);
        return;
      }

      // [STEP] Mark invite token as used (single-use enforcement)
      // Fire-and-forget — do not block the session cookie on this
      db.update(discordInviteTokens)
        .set({ usedAt: now, linkedDiscordId: discordId })
        .where(eq(discordInviteTokens.token, inviteToken))
        .catch((err: unknown) => {
          console.error(
            `[DiscordInvite][CALLBACK][TOKEN_MARK_USED_FAIL] requestId=${requestId}`,
            (err as Error).message
          );
        });

      // [STEP] Update lastSignedIn (fire-and-forget)
      updateAppUserLastSignedIn(targetUserId).catch(() => {});

      // [STEP] Issue app session cookie and redirect to /feed
      const sessionToken = await signAppUserToken(
        targetUserId,
        user.role,
        user.tokenVersion
      );

      clearTimeout(deadlineTimer);
      if (deadlineTriggered) return;

      res.cookie("app_session", sessionToken, getSessionCookieOptions(req));

      console.log(
        `[DiscordInvite][CALLBACK][OUTPUT] requestId=${requestId}` +
        ` SUCCESS userId=${targetUserId} username=${user.username}` +
        ` discordId=${discordId} discordUsername="${discordUsername}"` +
        ` totalMs=${Date.now() - t0}`
      );
      res.redirect(302, "/feed");
    } catch (err) {
      clearTimeout(deadlineTimer);
      if (deadlineTriggered) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[DiscordInvite][CALLBACK][UNHANDLED_EXCEPTION] requestId=${requestId}` +
        ` error="${msg}"`
      );
      if (!res.headersSent) {
        res.redirect(302, `/?discord_error=server_error`);
      }
    }
  });
}
