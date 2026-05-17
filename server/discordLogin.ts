/**
 * discordLogin.ts — Discord OAuth as the PRIMARY login method
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  FLOW OVERVIEW                                                          │
 * │                                                                         │
 * │  1. GET  /api/auth/discord-login/connect                               │
 * │     → Generate CSRF state (no existing session required)               │
 * │     → Store state in discord_login_states DB table (TTL 10 min)        │
 * │     → Redirect to Discord OAuth consent screen                         │
 * │       Scopes: identify  guilds.members.read                            │
 * │                                                                         │
 * │  2. GET  /api/auth/discord-login/callback                              │
 * │     → Validate CSRF state from DB                                      │
 * │     → Exchange code for access_token with Discord                      │
 * │     → Fetch Discord user profile (/users/@me)                          │
 * │     → [ROLE CHECK] Fetch guild member via /users/@me/guilds/{id}/member│
 * │       → If user is NOT in guild OR missing AI_MODEL_SUB role: deny     │
 * │     → Find existing appUser by discordId                               │
 * │       → If found + hasAccess: issue session cookie, redirect           │
 * │       → If NOT found: redirect /?discord_error=no_account              │
 * │                                                                         │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * SECURITY:
 *   - No self-registration. Only accounts pre-created by the owner can log in.
 *   - Guild role check uses the user's own OAuth access_token (guilds.members.read
 *     scope) — does NOT require the bot token.
 *   - Discord access_token is NEVER stored in the DB or logged.
 *   - CSRF state is DB-backed (survives multi-instance Cloud Run restarts).
 *   - State TTL: 10 minutes.
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
import { SignJWT } from "jose";
import { ENV } from "./_core/env";
import { getSessionCookieOptions } from "./_core/cookies";
import { getDb, getAppUserById, updateAppUserLastSignedIn } from "./db";
import { discordLoginStates, appUsers } from "../drizzle/schema";
import { eq, lt } from "drizzle-orm";

const APP_USER_COOKIE = "app_session";
const DISCORD_API     = "https://discord.com/api/v10";
const ROUTE_PREFIX    = "/api/auth/discord-login";
const STATE_TTL_MS    = 10 * 60 * 1000; // 10 minutes

// OAuth scopes:
//   identify          — read user id, username, avatar
//   guilds.members.read — read user's roles in specific guilds (no bot token needed)
const OAUTH_SCOPES = "identify guilds.members.read";

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateState(): string {
  return (
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2)
  );
}

/**
 * Build the canonical public-facing origin for OAuth redirect URIs.
 * Priority: ENV.publicOrigin → x-forwarded headers → Express-derived
 */
function buildPublicOrigin(req: Request, requestId: string): string {
  if (ENV.publicOrigin) {
    const origin = ENV.publicOrigin.replace(/\/$/, "");
    console.log(
      `[DiscordLogin][ORIGIN] requestId=${requestId} SOURCE=PUBLIC_ORIGIN_ENV_VAR origin="${origin}"`
    );
    return origin;
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
 *
 * Discord API: GET /users/@me/guilds/{guild.id}/member
 *   Requires: Bearer token with guilds.members.read scope
 *   Returns: GuildMember object with roles array
 *   Docs: https://discord.com/developers/docs/resources/user#get-current-user-guild-member
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
  console.log(
    `[DiscordLogin][ROLE_CHECK] requestId=${requestId}` +
    `\n  → guildId        : "${guildId}"` +
    `\n  → requiredRoleId : "${requiredRoleId}"` +
    `\n  → endpoint       : GET ${DISCORD_API}/users/@me/guilds/${guildId}/member`
  );

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
      ` fetch threw: "${detail}"`
    );
    return { ok: false, reason: "api_error", detail };
  }

  console.log(
    `[DiscordLogin][ROLE_CHECK][HTTP] requestId=${requestId}` +
    ` status=${fetchRes.status}`
  );

  // 404 = user is not a member of the guild
  if (fetchRes.status === 404) {
    console.warn(
      `[DiscordLogin][ROLE_CHECK][NOT_IN_GUILD] requestId=${requestId}` +
      ` User is not a member of guild ${guildId}.`
    );
    return { ok: false, reason: "not_in_guild" };
  }

  // 403 = bot not in guild OR scope not granted
  if (fetchRes.status === 403) {
    const body = await fetchRes.text().catch(() => "");
    console.error(
      `[DiscordLogin][ROLE_CHECK][FORBIDDEN] requestId=${requestId}` +
      ` 403 Forbidden — bot may not be in guild, or guilds.members.read scope was not granted.` +
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

  // Parse the GuildMember object
  let member: { roles?: string[]; nick?: string | null };
  try {
    member = await fetchRes.json() as { roles?: string[]; nick?: string | null };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(
      `[DiscordLogin][ROLE_CHECK][PARSE_ERROR] requestId=${requestId}` +
      ` JSON parse failed: "${detail}"`
    );
    return { ok: false, reason: "api_error", detail: `JSON parse: ${detail}` };
  }

  const roles = member.roles ?? [];
  const nick  = member.nick ?? null;
  const hasRole = roles.includes(requiredRoleId);

  console.log(
    `[DiscordLogin][ROLE_CHECK][RESULT] requestId=${requestId}` +
    `\n  → roles     : [${roles.join(", ")}]` +
    `\n  → nick      : ${nick ?? "(none)"}` +
    `\n  → hasRole   : ${hasRole}` +
    `\n  → roleId    : "${requiredRoleId}"`
  );

  if (!hasRole) {
    console.warn(
      `[DiscordLogin][ROLE_CHECK][MISSING_ROLE] requestId=${requestId}` +
      ` User is in guild but does NOT have required role "${requiredRoleId}".` +
      ` They must have the AI MODEL SUB role in the Prez Bets Discord server.`
    );
    return { ok: false, reason: "missing_role" };
  }

  return { ok: true, roles, nick };
}

// ── Route registration ────────────────────────────────────────────────────────

export function registerDiscordLoginRoutes(app: Express): void {
  // ── Startup confirmation log ──────────────────────────────────────────────
  const guildId      = ENV.discordGuildId;
  const roleId       = ENV.discordRoleAiModelSub;
  const guildStatus  = guildId  ? `SET="${guildId}"`  : "NOT_SET (role check will be SKIPPED)";
  const roleStatus   = roleId   ? `SET="${roleId}"`   : "NOT_SET (role check will be SKIPPED)";
  const originStatus = ENV.publicOrigin ? `SET="${ENV.publicOrigin}"` : "NOT_SET (will use x-forwarded headers)";

  console.log(
    `[DiscordLogin][STARTUP] Discord login routes registered:` +
    `\n  → routes      : GET ${ROUTE_PREFIX}/connect, GET ${ROUTE_PREFIX}/callback` +
    `\n  → scopes      : "${OAUTH_SCOPES}"` +
    `\n  → guildId     : ${guildStatus}` +
    `\n  → roleId      : ${roleStatus}` +
    `\n  → publicOrigin: ${originStatus}` +
    `\n  → clientId    : ${ENV.discordClientId ? `${ENV.discordClientId.slice(0,8)}…` : "MISSING"}` +
    `\n  → clientSecret: ${ENV.discordClientSecret ? "SET" : "MISSING"}`
  );

  if (!guildId || !roleId) {
    console.warn(
      `[DiscordLogin][STARTUP][WARN] DISCORD_GUILD_ID or DISCORD_ROLE_AI_MODEL_SUB not set.` +
      ` Guild role check will be BYPASSED — any Discord user with a linked account can log in.` +
      ` Set both env vars to enforce the AI MODEL SUB role requirement.`
    );
  }

  // ─── Step 1: Initiate Discord OAuth (no existing session required) ─────────
  //
  // CHECKPOINT 1: Request received — log all context
  // CHECKPOINT 2: DB state created — redirect to Discord consent screen
  app.get(`${ROUTE_PREFIX}/connect`, async (req: Request, res: Response) => {
    const requestId  = Math.random().toString(36).slice(2, 8).toUpperCase();
    const returnPath = typeof req.query.returnPath === "string"
      ? req.query.returnPath
      : "/";

    console.log(
      `[DiscordLogin][CHECKPOINT:1] /connect — requestId=${requestId}` +
      `\n  → returnPath   : "${returnPath}"` +
      `\n  → ENV.discordClientId present: ${!!ENV.discordClientId}` +
      `\n  → ENV.discordClientSecret present: ${!!ENV.discordClientSecret}`
    );

    if (!ENV.discordClientId || !ENV.discordClientSecret) {
      console.error(
        `[DiscordLogin][CHECKPOINT:1.FAIL] requestId=${requestId}` +
        ` FATAL: DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET not set in ENV.` +
        ` Cannot initiate Discord OAuth.`
      );
      res.redirect(302, `/?error=discord_not_configured`);
      return;
    }

    // Store CSRF state in DB (survives multi-instance restarts)
    const state     = generateState();
    const now       = Date.now();
    const expiresAt = now + STATE_TTL_MS;

    const db = await getDb();
    if (!db) {
      console.error(
        `[DiscordLogin][CHECKPOINT:2.FAIL] requestId=${requestId}` +
        ` FATAL: DB unavailable — cannot store CSRF state.`
      );
      res.redirect(302, `/?error=db_unavailable`);
      return;
    }

    // Housekeeping: delete expired states
    try {
      await db.delete(discordLoginStates).where(lt(discordLoginStates.expiresAt, now));
    } catch (e) {
      console.warn(`[DiscordLogin][CHECKPOINT:2.CLEANUP_WARN] requestId=${requestId}`, e);
    }

    await db.insert(discordLoginStates).values({ state, returnPath, expiresAt, createdAt: now });

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
      `[DiscordLogin][CHECKPOINT:2.OK] /connect — requestId=${requestId}` +
      `\n  → state         : "${state.slice(0, 8)}…"` +
      `\n  → redirectUri   : "${redirectUri}"` +
      `\n  → scopes        : "${OAUTH_SCOPES}"` +
      `\n  → authorizeUrl  : "${authorizeUrl.slice(0, 140)}…"`
    );

    res.redirect(302, authorizeUrl);
  });

  // ─── Step 2: Handle Discord OAuth callback ─────────────────────────────────
  //
  // CHECKPOINT 3: Callback received — validate code + state
  // CHECKPOINT 4: DB state lookup — validate CSRF state
  // CHECKPOINT 5: Token exchange with Discord
  // CHECKPOINT 6: Profile fetch from Discord (/users/@me)
  // CHECKPOINT 6.5: Guild role check (/users/@me/guilds/{id}/member)
  // CHECKPOINT 7: Find user by discordId in DB
  // CHECKPOINT 8: Issue session cookie + redirect
  app.get(`${ROUTE_PREFIX}/callback`, async (req: Request, res: Response) => {
    const requestId = Math.random().toString(36).slice(2, 8).toUpperCase();
    const { code, state, error: discordError } = req.query as Record<string, string | undefined>;

    console.log(
      `[DiscordLogin][CHECKPOINT:3] /callback — requestId=${requestId}` +
      `\n  → code present  : ${!!code}` +
      `\n  → state present : ${!!state}` +
      `\n  → discord_error : ${discordError ?? "none"}`
    );

    // Discord denied access (user clicked "Cancel" on consent screen)
    if (discordError) {
      console.warn(
        `[DiscordLogin][CHECKPOINT:3.DISCORD_ERROR] requestId=${requestId}` +
        ` Discord returned error="${discordError}" — user likely cancelled.`
      );
      res.redirect(302, `/?discord_error=discord_cancelled`);
      return;
    }

    if (!code || !state) {
      console.error(
        `[DiscordLogin][CHECKPOINT:3.FAIL] requestId=${requestId}` +
        ` Missing code or state. code=${!!code} state=${!!state}`
      );
      res.redirect(302, `/?discord_error=invalid_callback`);
      return;
    }

    // ── CHECKPOINT 4: DB state lookup ─────────────────────────────────────────
    const db = await getDb();
    if (!db) {
      console.error(`[DiscordLogin][CHECKPOINT:4.FAIL] requestId=${requestId} DB unavailable`);
      res.redirect(302, `/?discord_error=db_unavailable`);
      return;
    }

    const now = Date.now();
    const stateRows = await db
      .select()
      .from(discordLoginStates)
      .where(eq(discordLoginStates.state, state))
      .limit(1);

    const stateRow = stateRows[0];
    if (!stateRow) {
      console.error(
        `[DiscordLogin][CHECKPOINT:4.FAIL] requestId=${requestId}` +
        ` CSRF state not found in DB: "${state.slice(0, 8)}…"`
      );
      res.redirect(302, `/?discord_error=state_mismatch`);
      return;
    }
    if (stateRow.expiresAt < now) {
      console.error(
        `[DiscordLogin][CHECKPOINT:4.FAIL] requestId=${requestId}` +
        ` CSRF state expired at ${new Date(stateRow.expiresAt).toISOString()}`
      );
      await db.delete(discordLoginStates).where(eq(discordLoginStates.state, state));
      res.redirect(302, `/?discord_error=state_expired`);
      return;
    }

    const returnPath = stateRow.returnPath || "/";
    console.log(
      `[DiscordLogin][CHECKPOINT:4.OK] requestId=${requestId}` +
      ` CSRF state valid. returnPath="${returnPath}" — deleting state row…`
    );

    // Delete the used state row (one-time use)
    await db.delete(discordLoginStates).where(eq(discordLoginStates.state, state));

    // ── CHECKPOINT 5: Token exchange ──────────────────────────────────────────
    const publicOrigin = buildPublicOrigin(req, requestId);
    const redirectUri  = `${publicOrigin}${ROUTE_PREFIX}/callback`;

    console.log(
      `[DiscordLogin][CHECKPOINT:5] requestId=${requestId}` +
      ` Exchanging code for access_token. redirectUri="${redirectUri}"`
    );

    let accessToken: string;
    try {
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
          `[DiscordLogin][CHECKPOINT:5.FAIL] requestId=${requestId}` +
          ` Token exchange HTTP ${tokenRes.status}: "${errText.slice(0, 300)}"`
        );
        res.redirect(302, `/?discord_error=token_exchange_failed`);
        return;
      }

      const tokenData = await tokenRes.json() as { access_token: string };
      accessToken = tokenData.access_token;
      console.log(`[DiscordLogin][CHECKPOINT:5.OK] requestId=${requestId} Token exchange SUCCESS`);
    } catch (err) {
      console.error(`[DiscordLogin][CHECKPOINT:5.EXCEPTION] requestId=${requestId}`, err);
      res.redirect(302, `/?discord_error=token_exchange_failed`);
      return;
    }

    // ── CHECKPOINT 6: Profile fetch ───────────────────────────────────────────
    console.log(`[DiscordLogin][CHECKPOINT:6] requestId=${requestId} Fetching Discord profile…`);

    let discordId: string;
    let discordUsername: string;
    let discordAvatar: string | null;

    try {
      const profileRes = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!profileRes.ok) {
        const errText = await profileRes.text();
        console.error(
          `[DiscordLogin][CHECKPOINT:6.FAIL] requestId=${requestId}` +
          ` Profile fetch HTTP ${profileRes.status}: "${errText.slice(0, 300)}"`
        );
        res.redirect(302, `/?discord_error=profile_fetch_failed`);
        return;
      }

      const profile = await profileRes.json() as {
        id: string;
        username: string;
        discriminator?: string;
        avatar?: string;
        global_name?: string;
      };

      discordId = profile.id;
      // Discord new username system: discriminator "0" = new-style username
      discordUsername = (profile.discriminator && profile.discriminator !== "0")
        ? `${profile.username}#${profile.discriminator}`
        : (profile.global_name || profile.username);
      discordAvatar = profile.avatar ?? null;

      console.log(
        `[DiscordLogin][CHECKPOINT:6.OK] requestId=${requestId}` +
        `\n  → discordId       : "${discordId}"` +
        `\n  → discordUsername : "${discordUsername}"` +
        `\n  → avatar          : ${discordAvatar ? `"${discordAvatar}"` : "none"}`
      );
    } catch (err) {
      console.error(`[DiscordLogin][CHECKPOINT:6.EXCEPTION] requestId=${requestId}`, err);
      res.redirect(302, `/?discord_error=profile_fetch_failed`);
      return;
    }

    // ── CHECKPOINT 6.5: Guild role check ─────────────────────────────────────
    //
    // Verify the user has the AI MODEL SUB role in the Prez Bets Discord server.
    // Uses guilds.members.read scope — no bot token required.
    //
    // If DISCORD_GUILD_ID or DISCORD_ROLE_AI_MODEL_SUB is not configured,
    // the check is BYPASSED with a warning (fail-open to avoid locking out
    // the owner during initial setup).
    if (ENV.discordGuildId && ENV.discordRoleAiModelSub) {
      console.log(
        `[DiscordLogin][CHECKPOINT:6.5] requestId=${requestId}` +
        ` Checking guild role for discordId="${discordId}" (@${discordUsername})…`
      );

      const roleCheck = await checkGuildRole(
        accessToken,
        ENV.discordGuildId,
        ENV.discordRoleAiModelSub,
        requestId
      );

      if (!roleCheck.ok) {
        switch (roleCheck.reason) {
          case "not_in_guild":
            console.warn(
              `[DiscordLogin][CHECKPOINT:6.5.DENIED] requestId=${requestId}` +
              ` discordId="${discordId}" (@${discordUsername}) is not in the guild.` +
              ` Redirecting to /?discord_error=not_in_guild`
            );
            res.redirect(302, `/?discord_error=not_in_guild&discord_user=${encodeURIComponent(discordUsername)}`);
            return;

          case "missing_role":
            console.warn(
              `[DiscordLogin][CHECKPOINT:6.5.DENIED] requestId=${requestId}` +
              ` discordId="${discordId}" (@${discordUsername}) is in the guild but` +
              ` does NOT have the AI MODEL SUB role (${ENV.discordRoleAiModelSub}).` +
              ` Redirecting to /?discord_error=missing_role`
            );
            res.redirect(302, `/?discord_error=missing_role&discord_user=${encodeURIComponent(discordUsername)}`);
            return;

          case "api_error":
            // Fail-open on API errors to avoid locking out users due to Discord outages.
            // Log prominently but allow login to proceed.
            console.error(
              `[DiscordLogin][CHECKPOINT:6.5.API_ERROR] requestId=${requestId}` +
              ` Guild role check failed with API error: "${roleCheck.detail}".` +
              ` FAILING OPEN — allowing login to proceed. Monitor for abuse.`
            );
            break;
        }
      } else {
        console.log(
          `[DiscordLogin][CHECKPOINT:6.5.OK] requestId=${requestId}` +
          ` ✅ Guild role check PASSED for discordId="${discordId}" (@${discordUsername}).` +
          ` roles=[${roleCheck.roles.join(", ")}]`
        );
      }
    } else {
      console.warn(
        `[DiscordLogin][CHECKPOINT:6.5.BYPASS] requestId=${requestId}` +
        ` DISCORD_GUILD_ID or DISCORD_ROLE_AI_MODEL_SUB not configured.` +
        ` Guild role check BYPASSED for discordId="${discordId}" (@${discordUsername}).`
      );
    }

    // ── CHECKPOINT 7: Find user by discordId ──────────────────────────────────
    console.log(
      `[DiscordLogin][CHECKPOINT:7] requestId=${requestId}` +
      ` Looking up appUser by discordId="${discordId}"…`
    );

    const userRows = await db
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(eq(appUsers.discordId, discordId))
      .limit(1);

    if (userRows.length === 0) {
      console.warn(
        `[DiscordLogin][CHECKPOINT:7.NOT_FOUND] requestId=${requestId}` +
        ` No appUser found with discordId="${discordId}" (@${discordUsername}).` +
        ` User passed role check but has no account — owner must create one.` +
        ` Redirecting to /?discord_error=no_account`
      );
      res.redirect(302, `/?discord_error=no_account&discord_user=${encodeURIComponent(discordUsername)}`);
      return;
    }

    const userId = userRows[0]!.id;
    const user   = await getAppUserById(userId);

    if (!user) {
      console.error(
        `[DiscordLogin][CHECKPOINT:7.FAIL] requestId=${requestId}` +
        ` getAppUserById(${userId}) returned null after discordId lookup. DB inconsistency.`
      );
      res.redirect(302, `/?discord_error=user_not_found`);
      return;
    }

    if (!user.hasAccess) {
      console.warn(
        `[DiscordLogin][CHECKPOINT:7.NO_ACCESS] requestId=${requestId}` +
        ` userId=${userId} (@${user.username}) hasAccess=false — access disabled.`
      );
      res.redirect(302, `/?discord_error=access_disabled`);
      return;
    }

    if (user.expiryDate && Date.now() > user.expiryDate) {
      console.warn(
        `[DiscordLogin][CHECKPOINT:7.EXPIRED] requestId=${requestId}` +
        ` userId=${userId} (@${user.username}) account expired at ${new Date(user.expiryDate).toISOString()}.`
      );
      res.redirect(302, `/?discord_error=account_expired`);
      return;
    }

    // ── CHECKPOINT 8: Issue session cookie ────────────────────────────────────
    console.log(
      `[DiscordLogin][CHECKPOINT:8] requestId=${requestId}` +
      ` Issuing session cookie for userId=${userId} (@${user.username}) role=${user.role}…`
    );

    // Update Discord profile fields (keeps them fresh on each login)
    try {
      await db.update(appUsers)
        .set({
          discordUsername,
          discordAvatar,
          discordConnectedAt: Date.now(),
        })
        .where(eq(appUsers.id, userId));
    } catch (e) {
      // Non-fatal — log and continue
      console.warn(
        `[DiscordLogin][CHECKPOINT:8.UPDATE_WARN] requestId=${requestId}` +
        ` Failed to update Discord profile fields (non-fatal):`, e
      );
    }

    await updateAppUserLastSignedIn(userId);

    const token = await signAppUserToken(userId, user.role, user.tokenVersion);
    const cookieOptions = getSessionCookieOptions(req);

    res.cookie(APP_USER_COOKIE, token, {
      ...cookieOptions,
      maxAge: 90 * 24 * 60 * 60 * 1000, // 90 days
    });

    console.log(
      `[DiscordLogin][CHECKPOINT:8.SUCCESS] requestId=${requestId}` +
      ` ✅ Session issued for userId=${userId} (@${user.username}).` +
      ` Redirecting to "${returnPath}"`
    );

    res.redirect(302, returnPath);
  });
}
