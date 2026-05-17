/**
 * discordLogin.ts — Discord OAuth as the PRIMARY login method
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  FLOW OVERVIEW                                                          │
 * │                                                                         │
 * │  1. GET  /api/auth/discord-login/connect                               │
 * │     → Generate CSRF state as a SIGNED JWT (zero DB operations)         │
 * │     → Redirect to Discord OAuth consent screen immediately             │
 * │       Scopes: identify  guilds.members.read                            │
 * │                                                                         │
 * │  2. GET  /api/auth/discord-login/callback                              │
 * │     → Validate CSRF state JWT (cryptographic, no DB read)              │
 * │     → Exchange code for access_token with Discord                      │
 * │     → PARALLEL: Fetch Discord profile + guild member in one shot       │
 * │     → [ROLE CHECK] Verify AI_MODEL_SUB role                            │
 * │       → If user is NOT in guild OR missing role: deny                  │
 * │     → Find existing appUser by discordId (single indexed query)        │
 * │       → If found + hasAccess: issue session cookie, redirect           │
 * │       → If NOT found: redirect /?discord_error=no_account              │
 * │     → Fire-and-forget: update Discord profile fields + lastSignedIn    │
 * │                                                                         │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * PERFORMANCE ARCHITECTURE:
 *   /connect critical path: 0 DB operations, 0 network calls → pure CPU → <1ms
 *   /callback critical path:
 *     - 1 DB read (CSRF state JWT validation is CPU-only)
 *     - 1 Discord token exchange (unavoidable)
 *     - 2 Discord API calls IN PARALLEL (profile + guild member)
 *     - 1 DB read (user lookup by discordId)
 *     - Profile update + lastSignedIn are fire-and-forget (non-blocking)
 *
 * SECURITY:
 *   - CSRF state is a signed JWT (HS256, JWT_SECRET) with 10-min TTL.
 *   - No self-registration. Only accounts pre-created by the owner can log in.
 *   - Guild role check uses the user's own OAuth access_token (guilds.members.read
 *     scope) — does NOT require the bot token.
 *   - Discord access_token is NEVER stored in the DB or logged.
 *   - Session cookie: httpOnly, sameSite=none (prod) / lax (dev), 90-day JWT.
 *
 * ROUTE PREFIX: /api/auth/discord-login
 *   MUST be under /api/ — the Manus production proxy only forwards /api/* to Express.
 *
 * DISCORD APP SETUP REQUIRED:
 *   - Redirect URI: https://aisportsbettingmodels.com/api/auth/discord-login/callback
 *   - Scopes: identify, guilds.members.read
 *   - The guilds.members.read scope requires the bot to be in the guild.
 */

import type { Express, Request, Response } from "express";
import { SignJWT, jwtVerify } from "jose";
import { ENV } from "./_core/env";
import { getSessionCookieOptions } from "./_core/cookies";
import { getDb, getAppUserById, updateAppUserLastSignedIn } from "./db";
import { appUsers } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const APP_USER_COOKIE = "app_session";
const DISCORD_API     = "https://discord.com/api/v10";
const ROUTE_PREFIX    = "/api/auth/discord-login";
const STATE_TTL_MS    = 10 * 60 * 1000; // 10 minutes

// OAuth scopes:
//   identify            — read user id, username, avatar
//   guilds.members.read — read user's roles in specific guilds (no bot token needed)
const OAUTH_SCOPES = "identify guilds.members.read";

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
    const returnPath = typeof payload.returnPath === "string" ? payload.returnPath : "/";
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

/**
 * checkGuildRole — Verify the user has the AI_MODEL_SUB role in the guild.
 *
 * Uses the user's own OAuth access_token with guilds.members.read scope.
 * This does NOT require the bot token.
 *
 * Returns:
 *   { ok: true,  roles: string[], nick: string | null }  — user is in guild and has role
 *   { ok: false, reason: "not_in_guild" | "missing_role" | "api_error", detail?: string }
 */
async function checkGuildRole(
  accessToken: string,
  guildId: string,
  requiredRoleId: string,
  requestId: string
): Promise<
  | { ok: true;  roles: string[]; nick: string | null }
  | { ok: false; reason: "not_in_guild" | "missing_role" | "api_error"; detail?: string }
> {
  const t0 = Date.now();
  let fetchRes: globalThis.Response;
  try {
    fetchRes = await fetch(`${DISCORD_API}/users/@me/guilds/${guildId}/member`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "PressBets/1.0 (https://aisportsbettingmodels.com)",
      },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(
      `[DiscordLogin][ROLE_CHECK][NETWORK_ERROR] requestId=${requestId}` +
      ` fetch threw: "${detail}" in ${Date.now() - t0}ms`
    );
    return { ok: false, reason: "api_error", detail };
  }

  console.log(
    `[DiscordLogin][ROLE_CHECK][HTTP] requestId=${requestId}` +
    ` status=${fetchRes.status} in ${Date.now() - t0}ms`
  );

  if (fetchRes.status === 404) {
    return { ok: false, reason: "not_in_guild" };
  }

  if (fetchRes.status === 403) {
    const body = await fetchRes.text().catch(() => "");
    console.error(
      `[DiscordLogin][ROLE_CHECK][FORBIDDEN] requestId=${requestId}` +
      ` 403 — bot may not be in guild, or guilds.members.read scope not granted.` +
      ` body="${body.slice(0, 200)}"`
    );
    return { ok: false, reason: "api_error", detail: `403: ${body.slice(0, 100)}` };
  }

  if (!fetchRes.ok) {
    const body = await fetchRes.text().catch(() => "");
    console.error(
      `[DiscordLogin][ROLE_CHECK][HTTP_ERROR] requestId=${requestId}` +
      ` HTTP ${fetchRes.status}: "${body.slice(0, 200)}"`
    );
    return { ok: false, reason: "api_error", detail: `HTTP ${fetchRes.status}` };
  }

  let member: { roles?: string[]; nick?: string | null };
  try {
    member = await fetchRes.json() as { roles?: string[]; nick?: string | null };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "api_error", detail: `JSON parse: ${detail}` };
  }

  const roles   = member.roles ?? [];
  const nick    = member.nick ?? null;
  const hasRole = roles.includes(requiredRoleId);

  console.log(
    `[DiscordLogin][ROLE_CHECK][RESULT] requestId=${requestId}` +
    ` hasRole=${hasRole} roleCount=${roles.length} in ${Date.now() - t0}ms`
  );

  if (!hasRole) {
    return { ok: false, reason: "missing_role" };
  }
  return { ok: true, roles, nick };
}

// ── Route registration ────────────────────────────────────────────────────────

export function registerDiscordLoginRoutes(app: Express): void {
  const guildId = ENV.discordGuildId;
  const roleId  = ENV.discordRoleAiModelSub;

  console.log(
    `[DiscordLogin][STARTUP] Discord login routes registered:` +
    `\n  → routes      : GET ${ROUTE_PREFIX}/connect, GET ${ROUTE_PREFIX}/callback` +
    `\n  → scopes      : "${OAUTH_SCOPES}"` +
    `\n  → guildId     : ${guildId ? `SET="${guildId}"` : "NOT_SET (role check SKIPPED)"}` +
    `\n  → roleId      : ${roleId  ? `SET="${roleId}"`  : "NOT_SET (role check SKIPPED)"}` +
    `\n  → publicOrigin: ${ENV.publicOrigin ? `SET="${ENV.publicOrigin}"` : "NOT_SET"}` +
    `\n  → clientId    : ${ENV.discordClientId ? `${ENV.discordClientId.slice(0,8)}…` : "MISSING"}` +
    `\n  → clientSecret: ${ENV.discordClientSecret ? "SET" : "MISSING"}` +
    `\n  → stateMode   : JWT (zero DB operations on /connect)`
  );

  if (!guildId || !roleId) {
    console.warn(
      `[DiscordLogin][STARTUP][WARN] DISCORD_GUILD_ID or DISCORD_ROLE_AI_MODEL_SUB not set.` +
      ` Guild role check will be BYPASSED.`
    );
  }

  // ─── Step 1: Initiate Discord OAuth ─────────────────────────────────────────
  //
  // CRITICAL PATH: 0 DB operations, 0 network calls.
  // State is a signed JWT — generated in pure CPU, embedded in the OAuth URL.
  // Total latency: <2ms (JWT sign + URL construction + 302 redirect).
  app.get(`${ROUTE_PREFIX}/connect`, async (req: Request, res: Response) => {
    const t0        = Date.now();
    const requestId = Math.random().toString(36).slice(2, 8).toUpperCase();
    const returnPath = typeof req.query.returnPath === "string"
      ? req.query.returnPath
      : "/";

    console.log(
      `[DiscordLogin][CONNECT] requestId=${requestId} returnPath="${returnPath}"`
    );

    if (!ENV.discordClientId || !ENV.discordClientSecret) {
      console.error(
        `[DiscordLogin][CONNECT][FAIL] requestId=${requestId}` +
        ` DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET not set.`
      );
      res.redirect(302, `/?error=discord_not_configured`);
      return;
    }

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
    });
    const authorizeUrl = `https://discord.com/oauth2/authorize?${params.toString()}`;

    console.log(
      `[DiscordLogin][CONNECT][OK] requestId=${requestId}` +
      ` redirectUri="${redirectUri}" totalMs=${Date.now() - t0}`
    );

    res.redirect(302, authorizeUrl);
  });

  // ─── Step 2: Handle Discord OAuth callback ─────────────────────────────────
  //
  // CRITICAL PATH optimizations:
  //   CP-1: CSRF state validated via JWT (CPU-only, no DB read)
  //   CP-2: Discord profile + guild member fetched IN PARALLEL (saves ~200ms)
  //   CP-3: Profile update + lastSignedIn are fire-and-forget (non-blocking)
  app.get(`${ROUTE_PREFIX}/callback`, async (req: Request, res: Response) => {
    const t0        = Date.now();
    const requestId = Math.random().toString(36).slice(2, 8).toUpperCase();
    const { code, state, error: discordError } = req.query as Record<string, string | undefined>;

    console.log(
      `[DiscordLogin][CALLBACK] requestId=${requestId}` +
      ` code=${!!code} state=${!!state} discordError=${discordError ?? "none"}`
    );

    // Discord denied access (user clicked "Cancel")
    if (discordError) {
      res.redirect(302, `/?discord_error=discord_cancelled`);
      return;
    }

    if (!code || !state) {
      res.redirect(302, `/?discord_error=invalid_callback`);
      return;
    }

    // ── CP-1: Validate CSRF state JWT (CPU-only, no DB) ───────────────────────
    const stateResult = await verifyStateToken(state, requestId);
    if (!stateResult.ok) {
      console.error(
        `[DiscordLogin][CALLBACK][STATE_FAIL] requestId=${requestId}` +
        ` reason="${stateResult.reason}"`
      );
      res.redirect(302, `/?discord_error=${stateResult.reason}`);
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

    let accessToken: string;
    try {
      const t1 = Date.now();
      const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id:     ENV.discordClientId,
          client_secret: ENV.discordClientSecret,
          grant_type:    "authorization_code",
          code,
          redirect_uri:  redirectUri,
        }),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        console.error(
          `[DiscordLogin][CALLBACK][TOKEN_FAIL] requestId=${requestId}` +
          ` HTTP ${tokenRes.status}: "${errText.slice(0, 300)}"`
        );
        res.redirect(302, `/?discord_error=token_exchange_failed`);
        return;
      }

      const tokenData = await tokenRes.json() as { access_token: string };
      accessToken = tokenData.access_token;
      console.log(
        `[DiscordLogin][CALLBACK][TOKEN_OK] requestId=${requestId}` +
        ` tokenMs=${Date.now() - t1}`
      );
    } catch (err) {
      console.error(`[DiscordLogin][CALLBACK][TOKEN_EXCEPTION] requestId=${requestId}`, err);
      res.redirect(302, `/?discord_error=token_exchange_failed`);
      return;
    }

    // ── CP-2b: PARALLEL fetch — Discord profile + guild member ────────────────
    //
    // Both API calls are independent — fire them simultaneously.
    // This saves ~150-300ms vs sequential fetching.
    const t2 = Date.now();
    const [profileResult, guildResult] = await Promise.allSettled([
      fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }).then(r => r.json() as Promise<{
        id: string;
        username: string;
        discriminator?: string;
        avatar?: string;
        global_name?: string;
      }>),
      // Only fetch guild member if role check is configured
      (guildId && roleId)
        ? fetch(`${DISCORD_API}/users/@me/guilds/${guildId}/member`, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "User-Agent": "PressBets/1.0 (https://aisportsbettingmodels.com)",
            },
          }).then(async r => {
            if (r.status === 404) return { __status: 404 };
            if (r.status === 403) return { __status: 403, __body: await r.text().catch(() => "") };
            if (!r.ok)            return { __status: r.status };
            return r.json() as Promise<{ roles?: string[]; nick?: string | null }>;
          })
        : Promise.resolve(null),
    ]);

    console.log(
      `[DiscordLogin][CALLBACK][PARALLEL_FETCH_DONE] requestId=${requestId}` +
      ` parallelMs=${Date.now() - t2}` +
      ` profileStatus=${profileResult.status}` +
      ` guildStatus=${guildResult.status}`
    );

    // ── Process profile result ────────────────────────────────────────────────
    if (profileResult.status === "rejected") {
      console.error(
        `[DiscordLogin][CALLBACK][PROFILE_FAIL] requestId=${requestId}`,
        profileResult.reason
      );
      res.redirect(302, `/?discord_error=profile_fetch_failed`);
      return;
    }

    const profile = profileResult.value;
    if (!profile?.id) {
      console.error(
        `[DiscordLogin][CALLBACK][PROFILE_INVALID] requestId=${requestId}` +
        ` profile missing id field: ${JSON.stringify(profile).slice(0, 200)}`
      );
      res.redirect(302, `/?discord_error=profile_fetch_failed`);
      return;
    }

    const discordId = profile.id;
    const discordUsername = (profile.discriminator && profile.discriminator !== "0")
      ? `${profile.username}#${profile.discriminator}`
      : (profile.global_name || profile.username);
    const discordAvatar = profile.avatar ?? null;

    console.log(
      `[DiscordLogin][CALLBACK][PROFILE_OK] requestId=${requestId}` +
      ` discordId="${discordId}" username="${discordUsername}"`
    );

    // ── Process guild role result ─────────────────────────────────────────────
    if (guildId && roleId) {
      if (guildResult.status === "rejected") {
        // Fail-open on network errors to avoid locking out users during Discord outages
        console.error(
          `[DiscordLogin][CALLBACK][GUILD_FETCH_ERROR] requestId=${requestId}` +
          ` Guild fetch threw — FAILING OPEN:`,
          guildResult.reason
        );
      } else {
        const guildData = guildResult.value as Record<string, unknown> | null;

        if (guildData === null) {
          // Should not happen (guildId+roleId are set), but treat as bypass
        } else if (guildData.__status === 404) {
          console.warn(
            `[DiscordLogin][CALLBACK][NOT_IN_GUILD] requestId=${requestId}` +
            ` discordId="${discordId}" is not in guild ${guildId}`
          );
          res.redirect(302, `/?discord_error=not_in_guild&discord_user=${encodeURIComponent(discordUsername)}`);
          return;
        } else if (guildData.__status === 403) {
          // Fail-open: bot may not be in guild yet, or scope not granted
          console.error(
            `[DiscordLogin][CALLBACK][GUILD_403] requestId=${requestId}` +
            ` 403 from guild endpoint — FAILING OPEN. body="${String(guildData.__body ?? "").slice(0, 100)}"`
          );
        } else if (typeof guildData.__status === "number") {
          // Other HTTP error — fail-open
          console.error(
            `[DiscordLogin][CALLBACK][GUILD_HTTP_ERROR] requestId=${requestId}` +
            ` HTTP ${guildData.__status} — FAILING OPEN`
          );
        } else {
          // Valid GuildMember object
          const roles   = (guildData.roles as string[] | undefined) ?? [];
          const hasRole = roles.includes(roleId);
          console.log(
            `[DiscordLogin][CALLBACK][ROLE_CHECK] requestId=${requestId}` +
            ` hasRole=${hasRole} roleCount=${roles.length}`
          );
          if (!hasRole) {
            console.warn(
              `[DiscordLogin][CALLBACK][MISSING_ROLE] requestId=${requestId}` +
              ` discordId="${discordId}" lacks role "${roleId}"`
            );
            res.redirect(302, `/?discord_error=missing_role&discord_user=${encodeURIComponent(discordUsername)}`);
            return;
          }
        }
      }
    }

    // ── CP-3: DB user lookup (single indexed query) ───────────────────────────
    const db = await getDb();
    if (!db) {
      console.error(`[DiscordLogin][CALLBACK][DB_FAIL] requestId=${requestId} DB unavailable`);
      res.redirect(302, `/?discord_error=db_unavailable`);
      return;
    }

    const t3 = Date.now();
    const userRows = await db
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(eq(appUsers.discordId, discordId))
      .limit(1);

    if (userRows.length === 0) {
      console.warn(
        `[DiscordLogin][CALLBACK][NO_ACCOUNT] requestId=${requestId}` +
        ` No appUser found with discordId="${discordId}" (@${discordUsername}).` +
        ` dbMs=${Date.now() - t3}`
      );
      res.redirect(302, `/?discord_error=no_account&discord_user=${encodeURIComponent(discordUsername)}`);
      return;
    }

    const userId = userRows[0]!.id;
    const user   = await getAppUserById(userId);

    if (!user) {
      console.error(
        `[DiscordLogin][CALLBACK][USER_NOT_FOUND] requestId=${requestId}` +
        ` getAppUserById(${userId}) returned null. DB inconsistency.`
      );
      res.redirect(302, `/?discord_error=user_not_found`);
      return;
    }

    if (!user.hasAccess) {
      console.warn(
        `[DiscordLogin][CALLBACK][NO_ACCESS] requestId=${requestId}` +
        ` userId=${userId} hasAccess=false`
      );
      res.redirect(302, `/?discord_error=access_disabled`);
      return;
    }

    if (user.expiryDate && Date.now() > user.expiryDate) {
      console.warn(
        `[DiscordLogin][CALLBACK][EXPIRED] requestId=${requestId}` +
        ` userId=${userId} expired at ${new Date(user.expiryDate).toISOString()}`
      );
      res.redirect(302, `/?discord_error=account_expired`);
      return;
    }

    console.log(
      `[DiscordLogin][CALLBACK][DB_OK] requestId=${requestId}` +
      ` userId=${userId} role=${user.role} dbMs=${Date.now() - t3}`
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
    res.redirect(302, returnPath);

    // ── CP-3: Fire-and-forget — update Discord profile + lastSignedIn ─────────
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
  });
}
