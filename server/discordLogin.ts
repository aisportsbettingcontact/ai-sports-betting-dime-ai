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
 * │                                                                         │
 * │  2. GET  /api/auth/discord-login/callback                              │
 * │     → Validate CSRF state from DB                                      │
 * │     → Exchange code for access_token with Discord                      │
 * │     → Fetch Discord user profile (/users/@me)                          │
 * │     → Find existing appUser by discordId                               │
 * │       → If found: issue session cookie, redirect to returnPath         │
 * │       → If NOT found: redirect to /login?discord_error=no_account      │
 * │         (Owner must create the account first — no self-registration)   │
 * │                                                                         │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * SECURITY:
 *   - No self-registration. Only accounts pre-created by the owner can log in.
 *   - Discord access_token is NEVER stored in the DB or logged.
 *   - CSRF state is DB-backed (survives multi-instance Cloud Run restarts).
 *   - State TTL: 10 minutes.
 *   - Session cookie: httpOnly, sameSite=none (prod) / lax (dev), 90-day JWT.
 *
 * ROUTE PREFIX: /api/auth/discord-login
 *   MUST be under /api/ — the Manus production proxy only forwards /api/* to Express.
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

// ── Route registration ────────────────────────────────────────────────────────

export function registerDiscordLoginRoutes(app: Express): void {
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
      scope:         "identify",
      state,
    });
    const authorizeUrl = `https://discord.com/oauth2/authorize?${params.toString()}`;

    console.log(
      `[DiscordLogin][CHECKPOINT:2.OK] /connect — requestId=${requestId}` +
      `\n  → state         : "${state.slice(0, 8)}…"` +
      `\n  → redirectUri   : "${redirectUri}"` +
      `\n  → authorizeUrl  : "${authorizeUrl.slice(0, 120)}…"`
    );

    res.redirect(302, authorizeUrl);
  });

  // ─── Step 2: Handle Discord OAuth callback ─────────────────────────────────
  //
  // CHECKPOINT 3: Callback received — validate code + state
  // CHECKPOINT 4: DB state lookup — validate CSRF state
  // CHECKPOINT 5: Token exchange with Discord
  // CHECKPOINT 6: Profile fetch from Discord
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
      res.redirect(302, `/?error=discord_cancelled`);
      return;
    }

    if (!code || !state) {
      console.error(
        `[DiscordLogin][CHECKPOINT:3.FAIL] requestId=${requestId}` +
        ` Missing code or state. code=${!!code} state=${!!state}`
      );
      res.redirect(302, `/?error=invalid_callback`);
      return;
    }

    // ── CHECKPOINT 4: DB state lookup ─────────────────────────────────────────
    const db = await getDb();
    if (!db) {
      console.error(`[DiscordLogin][CHECKPOINT:4.FAIL] requestId=${requestId} DB unavailable`);
      res.redirect(302, `/?error=db_unavailable`);
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
      res.redirect(302, `/?error=state_mismatch`);
      return;
    }
    if (stateRow.expiresAt < now) {
      console.error(
        `[DiscordLogin][CHECKPOINT:4.FAIL] requestId=${requestId}` +
        ` CSRF state expired at ${new Date(stateRow.expiresAt).toISOString()}`
      );
      await db.delete(discordLoginStates).where(eq(discordLoginStates.state, state));
      res.redirect(302, `/?error=state_expired`);
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
        res.redirect(302, `/?error=token_exchange_failed`);
        return;
      }

      const tokenData = await tokenRes.json() as { access_token: string };
      accessToken = tokenData.access_token;
      console.log(`[DiscordLogin][CHECKPOINT:5.OK] requestId=${requestId} Token exchange SUCCESS`);
    } catch (err) {
      console.error(`[DiscordLogin][CHECKPOINT:5.EXCEPTION] requestId=${requestId}`, err);
      res.redirect(302, `/?error=token_exchange_failed`);
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
        res.redirect(302, `/?error=profile_fetch_failed`);
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
      res.redirect(302, `/?error=profile_fetch_failed`);
      return;
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
        ` Owner must pre-create the account and link their Discord ID.` +
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
      res.redirect(302, `/?error=user_not_found`);
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

  console.log(
    `[DiscordLogin][STARTUP] Discord login routes registered:` +
    ` GET ${ROUTE_PREFIX}/connect,` +
    ` GET ${ROUTE_PREFIX}/callback`
  );
}
