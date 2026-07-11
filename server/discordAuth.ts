/**
 * Discord Account Linking Routes
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  ARCHITECTURE NOTE — WHY ROUTES ARE UNDER /api/*                       │
 * │                                                                         │
 * │  The Manus production deployment uses a two-layer proxy:               │
 * │    Browser → Edge Proxy → Cloud Run (Express)                           │
 * │                                                                         │
 * │  The Manus edge proxy ONLY forwards /api/* requests to Express.        │
 * │  Everything else is served by the static CDN (returns SPA index.html). │
 * │  Routes outside /api/* never reach Express — they return HTTP 200      │
 * │  with the SPA shell, which looks like a 404 to the user.               │
 * │                                                                         │
 * │  Routes:                                                                │
 * │    GET  /api/auth/discord/connect    — redirect to Discord OAuth       │
 * │    GET  /api/auth/discord/callback   — handle OAuth code exchange      │
 * │    POST /api/auth/discord/disconnect — clear Discord fields from DB    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  ARCHITECTURE NOTE — WHY redirect_uri USES PUBLIC_ORIGIN ENV VAR       │
 * │                                                                         │
 * │  Behind the edge proxy, the x-forwarded-host header received            │
 * │  by Express resolves to the INTERNAL Cloud Run hostname:               │
 * │    cvrl7uon6e-pbhflwecra-uk.a.run.app                                  │
 * │  NOT the public domain: aisportsbettingmodels.com                      │
 * │                                                                         │
 * │  Fix: PUBLIC_ORIGIN env var is the canonical public-facing origin.     │
 * │  Set it to https://aisportsbettingmodels.com in production secrets.    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  ARCHITECTURE NOTE — WHY CSRF STATE IS DB-BACKED                       │
 * │                                                                         │
 * │  Cloud Run can run MULTIPLE INSTANCES simultaneously. If the /connect  │
 * │  request hits instance A (stores state in memory) and the /callback    │
 * │  request hits instance B (empty pendingStates), the state lookup fails │
 * │  with state_mismatch and the OAuth flow breaks silently.               │
 * │                                                                         │
 * │  Fix: State is stored in the discord_oauth_states DB table (TTL 10min).│
 * │  All instances share the same DB, so state is always found.            │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Security:
 *   - Discord access_token is NEVER stored in the DB or logged
 *   - Secrets are read from ENV (server-side only, never exposed to frontend)
 *   - State parameter prevents CSRF on the callback (DB-backed, TTL 10 min)
 *   - discordId uniqueness is enforced before saving (prevents account takeover)
 *
 * Checkpoint logging convention:
 *   [DiscordAuth][CHECKPOINT:<N>] <phase> — <detail>
 *   Every checkpoint logs requestId, all relevant values, and the exact
 *   decision being made so you can trace any failure in production logs.
 */

import type { Express, Request, Response } from "express";
import { parse as parseCookieHeader } from "cookie";
import { ENV } from "./_core/env";
import { verifyAppUserToken } from "./routers/appUsers";
import { getAppUserById, updateAppUser, getDb } from "./db";
import { appUsers, discordOAuthStates } from "../drizzle/schema";
import { eq, lt } from "drizzle-orm";

const APP_USER_COOKIE = "app_session";
const DISCORD_API = "https://discord.com/api/v10";

// ── Route prefix — MUST be under /api/ for Manus production proxy ──────────
// See architecture note above. DO NOT change this to /auth/discord/*.
const ROUTE_PREFIX = "/api/auth/discord";

// ── CSRF state TTL: 10 minutes ─────────────────────────────────────────────
const STATE_TTL_MS = 10 * 60 * 1000;

function getAppCookie(req: Request): string | undefined {
  const cookies = parseCookieHeader(req.headers.cookie ?? "");
  return cookies[APP_USER_COOKIE];
}

function generateState(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

/**
 * Build the canonical public-facing origin for OAuth redirect URIs.
 *
 * PRIORITY ORDER (most reliable → least reliable):
 *   1. ENV.publicOrigin  — hardcoded in production secrets (most reliable)
 * 2. x-forwarded-proto + x-forwarded-host — set by edge proxy (unreliable:
 *      x-forwarded-host may be the internal Cloud Run hostname, not public domain)
 *   3. req.protocol + req.hostname — Express-derived (unreliable behind proxy)
 *
 * In production, PUBLIC_ORIGIN MUST be set to https://aisportsbettingmodels.com.
 */
function buildPublicOrigin(req: Request, requestId: string): string {
  // ── Source 1: Hardcoded PUBLIC_ORIGIN env var (most reliable) ─────────────
  if (ENV.publicOrigin) {
    const origin = ENV.publicOrigin.replace(/\/$/, ""); // strip trailing slash
    console.log(
      `[DiscordAuth][ORIGIN] requestId=${requestId}` +
      ` SOURCE=PUBLIC_ORIGIN_ENV_VAR` +
      ` origin="${origin}"` +
      ` (hardcoded canonical domain — most reliable, immune to proxy header issues)`
    );
    return origin;
  }

  // ── Source 2: x-forwarded-proto + x-forwarded-host (edge proxy) ─────────────
  const fwdProto = req.get("x-forwarded-proto");
  const fwdHost  = req.get("x-forwarded-host");
  const reqProto    = req.protocol;
  const reqHostname = req.hostname;
  const reqHost     = req.get("host");

  console.warn(
    `[DiscordAuth][ORIGIN][WARN] requestId=${requestId}` +
    ` PUBLIC_ORIGIN env var is NOT SET — falling back to request-derived origin.` +
    ` THIS WILL FAIL IN PRODUCTION (Cloud Run internal hostname will be used).` +
    ` Set PUBLIC_ORIGIN=https://aisportsbettingmodels.com in production secrets.` +
    ` | x-forwarded-proto="${fwdProto ?? "none"}"` +
    ` | x-forwarded-host="${fwdHost ?? "none"}"` +
    ` | x-forwarded-for="${req.get("x-forwarded-for") ?? "none"}"` +
    ` | req.protocol="${reqProto}"` +
    ` | req.hostname="${reqHostname}"` +
    ` | host="${reqHost ?? "none"}"` +
    ` | NODE_ENV="${process.env.NODE_ENV ?? "none"}"`
  );

  if (fwdProto && fwdHost) {
    const origin = `${fwdProto}://${fwdHost}`;
    console.log(
      `[DiscordAuth][ORIGIN] requestId=${requestId}` +
      ` SOURCE=X_FORWARDED_HEADERS origin="${origin}"` +
      ` (WARNING: fwdHost may be internal Cloud Run hostname, not public domain)`
    );
    return origin;
  }

  const origin = `${reqProto}://${reqHost ?? reqHostname}`;
  console.log(
    `[DiscordAuth][ORIGIN] requestId=${requestId}` +
    ` SOURCE=EXPRESS_REQ origin="${origin}"` +
    ` (WARNING: may be wrong behind proxy)`
  );
  return origin;
}

export function registerDiscordAuthRoutes(app: Express) {
  // ── Startup confirmation log ─────────────────────────────────────────────
  const publicOriginStatus = ENV.publicOrigin
    ? `SET="${ENV.publicOrigin}"`
    : "NOT_SET (WILL FAIL IN PRODUCTION — set PUBLIC_ORIGIN secret)";

  console.log(
    `[DiscordAuth][STARTUP] Registering Discord OAuth routes` +
    ` | routePrefix="${ROUTE_PREFIX}"` +
    ` | STATE_STORAGE=DB_BACKED (discord_oauth_states table — survives restarts & multi-instance)` +
    ` | PUBLIC_ORIGIN=${publicOriginStatus}` +
    ` | clientId=${ENV.discordClientId ? `${ENV.discordClientId.slice(0,8)}…` : "MISSING"}` +
    ` | clientSecret=${ENV.discordClientSecret ? "SET" : "MISSING"}` +
    ` | guildId=${ENV.discordGuildId || "MISSING"}` +
    ` | roleId=${ENV.discordRoleAiModelSub || "MISSING"}`
  );

  if (!ENV.publicOrigin) {
    console.warn(
      `[DiscordAuth][STARTUP][CRITICAL_WARN] PUBLIC_ORIGIN is not set.` +
      ` In production, the redirect_uri will be built from x-forwarded-host` +
      ` which resolves to the internal Cloud Run hostname (*.a.run.app).` +
      ` Discord will reject this with "Invalid OAuth2 redirect_uri".` +
      ` FIX: Add PUBLIC_ORIGIN=https://aisportsbettingmodels.com to production secrets.`
    );
  }

  // ─── Step 1: Redirect to Discord OAuth ────────────────────────────────────
  //
  // CHECKPOINT 1: Request received — log ALL proxy headers for diagnosis
  // CHECKPOINT 2: Session cookie validated — JWT verified, userId extracted
  // CHECKPOINT 3: DB-backed CSRF state created — redirect_uri constructed
  // CHECKPOINT 4: Redirecting to Discord OAuth consent screen
  app.get(`${ROUTE_PREFIX}/connect`, async (req: Request, res: Response) => {
    const requestId = Math.random().toString(36).slice(2, 8).toUpperCase();

    // ── CHECKPOINT 1: Full request context dump ──────────────────────────────
    console.log(
      `[DiscordAuth][CHECKPOINT:1] /connect — requestId=${requestId}` +
      `\n  → x-forwarded-proto   : "${req.get("x-forwarded-proto") ?? "NOT_SET"}"` +
      `\n  → x-forwarded-host    : "${req.get("x-forwarded-host") ?? "NOT_SET"}"` +
      `\n  → x-forwarded-for     : "${req.get("x-forwarded-for") ?? "NOT_SET"}"` +
      `\n  → host                : "${req.get("host") ?? "NOT_SET"}"` +
      `\n  → origin (header)     : "${req.get("origin") ?? "NOT_SET"}"` +
      `\n  → referer             : "${req.get("referer") ?? "NOT_SET"}"` +
      `\n  → req.protocol        : "${req.protocol}"` +
      `\n  → req.hostname        : "${req.hostname}"` +
      `\n  → ENV.publicOrigin    : "${ENV.publicOrigin || "NOT_SET"}"` +
      `\n  → NODE_ENV            : "${process.env.NODE_ENV ?? "NOT_SET"}"` +
      `\n  → cookie_present      : ${!!(req.headers.cookie)}` +
      `\n  → cookie_keys         : ${JSON.stringify(Object.keys(parseCookieHeader(req.headers.cookie ?? "")))}`
    );

    // ── CHECKPOINT 2: Session cookie validation ──────────────────────────────
    const token = getAppCookie(req);
    if (!token) {
      console.log(
        `[DiscordAuth][CHECKPOINT:2.FAIL] /connect — requestId=${requestId}` +
        ` REJECTED: no app_session cookie present.` +
        ` User must be logged into the site before connecting Discord.` +
        ` Redirecting to /?error=not_logged_in`
      );
      res.redirect(302, "/?error=not_logged_in");
      return;
    }

    console.log(
      `[DiscordAuth][CHECKPOINT:2.COOKIE_FOUND] /connect — requestId=${requestId}` +
      ` app_session cookie found (length=${token.length}) — verifying JWT…`
    );

    const payload = await verifyAppUserToken(token);
    if (!payload) {
      console.log(
        `[DiscordAuth][CHECKPOINT:2.FAIL] /connect — requestId=${requestId}` +
        ` REJECTED: JWT verification failed (expired or tampered token).` +
        ` User must log in again. Redirecting to /?error=invalid_session`
      );
      res.redirect(302, "/?error=invalid_session");
      return;
    }

    console.log(
      `[DiscordAuth][CHECKPOINT:2.OK] /connect — requestId=${requestId}` +
      ` JWT valid: userId=${payload.userId} — proceeding to CSRF state creation`
    );

    // ── CHECKPOINT 3: Build DB-backed CSRF state ─────────────────────────────
    // CRITICAL: State is stored in the DB (not in-memory) so it survives
    // server restarts and is shared across all Cloud Run instances.
    // In-memory state fails when /connect hits instance A and /callback hits
    // instance B — the state is not found and the OAuth flow breaks silently.
    const state     = generateState();
    const now       = Date.now();
    const expiresAt = now + STATE_TTL_MS;

    const db = await getDb();
    if (!db) {
      console.error(
        `[DiscordAuth][CHECKPOINT:3.FAIL] /connect — requestId=${requestId}` +
        ` FATAL: getDb() returned null — cannot store CSRF state in DB.` +
        ` DATABASE_URL may be missing or DB connection failed.` +
        ` Redirecting to /feed/model/mlb?discord_error=db_unavailable`
      );
      res.redirect(302, "/feed/model/mlb?discord_error=db_unavailable");
      return;
    }

    // Clean up expired states before inserting (housekeeping)
    try {
      const deleted = await db.delete(discordOAuthStates).where(lt(discordOAuthStates.expiresAt, now));
      console.log(
        `[DiscordAuth][CHECKPOINT:3.CLEANUP] /connect — requestId=${requestId}` +
        ` Cleaned up expired CSRF states: ${(deleted as { rowsAffected?: number }).rowsAffected ?? 0} rows deleted`
      );
    } catch (cleanErr) {
      // Non-fatal — log and continue
      console.warn(
        `[DiscordAuth][CHECKPOINT:3.CLEANUP_WARN] /connect — requestId=${requestId}` +
        ` Failed to clean expired states (non-fatal):`, cleanErr
      );
    }

    // Insert the new CSRF state into the DB
    await db.insert(discordOAuthStates).values({
      state,
      userId: payload.userId,
      expiresAt,
      createdAt: now,
    });

    // Build the canonical public origin — see buildPublicOrigin() docs above
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
      `[DiscordAuth][CHECKPOINT:3.OK] /connect — requestId=${requestId}` +
      ` userId=${payload.userId}` +
      `\n  → STATE_STORAGE      : DB (discord_oauth_states table)` +
      `\n  → state              : "${state.slice(0, 8)}…" (${state.length} chars)` +
      `\n  → state_expires_at   : ${new Date(expiresAt).toISOString()} (${STATE_TTL_MS/60000} min from now)` +
      `\n  → publicOrigin       : "${publicOrigin}"` +
      `\n  → redirectUri        : "${redirectUri}"` +
      `\n  → Discord Portal must have this URI registered: "${redirectUri}"` +
      `\n  → authorizeUrl       : "${authorizeUrl.slice(0, 140)}…"`
    );

    // ── CHECKPOINT 4: Redirect ───────────────────────────────────────────────
    console.log(
      `[DiscordAuth][CHECKPOINT:4] /connect — requestId=${requestId}` +
      ` → 302 redirect to Discord OAuth consent screen`
    );
    res.redirect(302, authorizeUrl);
  });

  // ─── Step 2: Handle Discord OAuth callback ─────────────────────────────────
  //
  // CHECKPOINT 5: Callback received — validate code + state params
  // CHECKPOINT 6: DB CSRF state lookup — validates state is in DB and not expired
  // CHECKPOINT 7: Token exchange — POST to Discord /oauth2/token
  // CHECKPOINT 8: Profile fetch — GET Discord /users/@me
  // CHECKPOINT 9: Conflict check — ensure discordId not already linked to another user
  // CHECKPOINT 10: DB write — save discordId/username/avatar/connectedAt to app_users
  // CHECKPOINT 11: SUCCESS — redirect to /feed/model/mlb?discord_linked=1
  app.get(`${ROUTE_PREFIX}/callback`, async (req: Request, res: Response) => {
    const requestId = Math.random().toString(36).slice(2, 8).toUpperCase();
    const code  = typeof req.query.code  === "string" ? req.query.code  : null;
    const state = typeof req.query.state === "string" ? req.query.state : null;
    const error = typeof req.query.error === "string" ? req.query.error : null;

    console.log(
      `[DiscordAuth][CHECKPOINT:5] /callback — requestId=${requestId}` +
      `\n  → code_present     : ${!!code}` +
      `\n  → state_present    : ${!!state}` +
      `\n  → state_length     : ${state?.length ?? 0}` +
      `\n  → discord_error    : "${error ?? "none"}"` +
      `\n  → query_keys       : ${JSON.stringify(Object.keys(req.query))}` +
      `\n  → x-forwarded-host : "${req.get("x-forwarded-host") ?? "NOT_SET"}"` +
      `\n  → ENV.publicOrigin : "${ENV.publicOrigin || "NOT_SET"}"`
    );

    if (error) {
      console.log(
        `[DiscordAuth][CHECKPOINT:5.DISCORD_ERROR] /callback — requestId=${requestId}` +
        ` Discord returned error="${error}" (user denied OAuth or Discord-side error).` +
        ` Redirecting to /feed/model/mlb?discord_error=denied`
      );
      res.redirect(302, "/feed/model/mlb?discord_error=denied");
      return;
    }

    if (!code || !state) {
      console.log(
        `[DiscordAuth][CHECKPOINT:5.FAIL] /callback — requestId=${requestId}` +
        ` REJECTED: missing required params.` +
        ` code_missing=${!code} state_missing=${!state}.` +
        ` Redirecting to /feed/model/mlb?discord_error=invalid_request`
      );
      res.redirect(302, "/feed/model/mlb?discord_error=invalid_request");
      return;
    }

    // ── CHECKPOINT 6: DB CSRF state lookup ──────────────────────────────────
    // CRITICAL FIX: State is now looked up from the DB, not from in-memory Map.
    // This ensures the lookup works even if /callback hits a different Cloud Run
    // instance than /connect, or if the server restarted between the two requests.
    const db = await getDb();
    if (!db) {
      console.error(
        `[DiscordAuth][CHECKPOINT:6.FAIL] /callback — requestId=${requestId}` +
        ` FATAL: getDb() returned null — cannot look up CSRF state from DB.` +
        ` Redirecting to /feed/model/mlb?discord_error=db_unavailable`
      );
      res.redirect(302, "/feed/model/mlb?discord_error=db_unavailable");
      return;
    }

    // Clean up expired states (housekeeping)
    const now = Date.now();
    try {
      await db.delete(discordOAuthStates).where(lt(discordOAuthStates.expiresAt, now));
    } catch (_) { /* non-fatal */ }

    // Look up the state in the DB
    const stateRows = await db
      .select()
      .from(discordOAuthStates)
      .where(eq(discordOAuthStates.state, state))
      .limit(1);

    const stateRow = stateRows[0] ?? null;

    console.log(
      `[DiscordAuth][CHECKPOINT:6] /callback — requestId=${requestId}` +
      ` DB CSRF state lookup:` +
      `\n  → state_prefix   : "${state.slice(0, 8)}…"` +
      `\n  → state_found_in_db : ${!!stateRow}` +
      `\n  → state_expired  : ${stateRow ? stateRow.expiresAt < now : "N/A"}` +
      `\n  → state_userId   : ${stateRow?.userId ?? "N/A"}` +
      `\n  → state_createdAt: ${stateRow ? new Date(stateRow.createdAt).toISOString() : "N/A"}` +
      `\n  → state_expiresAt: ${stateRow ? new Date(stateRow.expiresAt).toISOString() : "N/A"}`
    );

    if (!stateRow) {
      console.error(
        `[DiscordAuth][CHECKPOINT:6.FAIL] /callback — requestId=${requestId}` +
        ` REJECTED: state "${state.slice(0, 8)}…" NOT FOUND in discord_oauth_states DB table.` +
        ` POSSIBLE CAUSES:` +
        `\n  1. State expired (TTL=${STATE_TTL_MS/60000} min) — user took too long to authorize` +
        `\n  2. State was already consumed (duplicate callback request)` +
        `\n  3. DB migration not applied (run pnpm db:push)` +
        `\n  4. State was never inserted (DB write failed in /connect)` +
        ` Redirecting to /feed/model/mlb?discord_error=state_mismatch`
      );
      res.redirect(302, "/feed/model/mlb?discord_error=state_mismatch");
      return;
    }

    if (stateRow.expiresAt < now) {
      console.error(
        `[DiscordAuth][CHECKPOINT:6.FAIL] /callback — requestId=${requestId}` +
        ` REJECTED: state "${state.slice(0, 8)}…" EXPIRED at ${new Date(stateRow.expiresAt).toISOString()}` +
        ` (${Math.round((now - stateRow.expiresAt) / 1000)}s ago).` +
        ` User must restart the OAuth flow. Redirecting to /feed/model/mlb?discord_error=state_expired`
      );
      await db.delete(discordOAuthStates).where(eq(discordOAuthStates.state, state));
      res.redirect(302, "/feed/model/mlb?discord_error=state_expired");
      return;
    }

    // Consume the state (delete it so it can't be replayed)
    await db.delete(discordOAuthStates).where(eq(discordOAuthStates.state, state));
    const { userId } = stateRow;

    // Build the redirect_uri — must EXACTLY match what was sent in /connect
    const publicOrigin = buildPublicOrigin(req, requestId);
    const redirectUri  = `${publicOrigin}${ROUTE_PREFIX}/callback`;

    console.log(
      `[DiscordAuth][CHECKPOINT:6.OK] /callback — requestId=${requestId}` +
      ` CSRF state valid and consumed: userId=${userId}` +
      `\n  → publicOrigin : "${publicOrigin}"` +
      `\n  → redirectUri  : "${redirectUri}"` +
      `\n  → Proceeding to Discord token exchange…`
    );

    try {
      // ── CHECKPOINT 7: Token exchange ─────────────────────────────────────
      console.log(
        `[DiscordAuth][CHECKPOINT:7] /callback — requestId=${requestId}` +
        ` POST ${DISCORD_API}/oauth2/token` +
        `\n  → grant_type  : "authorization_code"` +
        `\n  → redirect_uri: "${redirectUri}"` +
        `\n  → code_length : ${code.length}` +
        `\n  → client_id   : "${ENV.discordClientId.slice(0,8)}…"`
      );

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

      console.log(
        `[DiscordAuth][CHECKPOINT:7.RESPONSE] /callback — requestId=${requestId}` +
        ` Discord token exchange: HTTP ${tokenRes.status} ok=${tokenRes.ok}` +
        `\n  → redirectUri used: "${redirectUri}"` +
        `\n  → NOTE: This redirectUri must EXACTLY match the one sent in /connect AND registered in Discord Portal`
      );

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        console.error(
          `[DiscordAuth][CHECKPOINT:7.FAIL] /callback — requestId=${requestId}` +
          ` Token exchange FAILED: HTTP ${tokenRes.status}` +
          `\n  → Discord error body: "${errText.slice(0, 500)}"` +
          `\n  → redirectUri used: "${redirectUri}"` +
          `\n  → LIKELY CAUSE: redirect_uri mismatch between /connect and /callback,` +
          `\n    OR the URI is not registered in Discord Developer Portal → OAuth2 → Redirects.` +
          `\n  → REGISTERED URI must be: "${redirectUri}"` +
          ` Redirecting to /feed/model/mlb?discord_error=token_exchange_failed`
        );
        res.redirect(302, "/feed/model/mlb?discord_error=token_exchange_failed");
        return;
      }

      const tokenData = await tokenRes.json() as {
        access_token:  string;
        token_type:    string;
        expires_in?:   number;
        scope?:        string;
      };

      // NOTE: access_token is intentionally NOT stored anywhere
      const accessToken = tokenData.access_token;

      console.log(
        `[DiscordAuth][CHECKPOINT:7.OK] /callback — requestId=${requestId}` +
        ` Token exchange SUCCESS` +
        `\n  → token_type   : "${tokenData.token_type}"` +
        `\n  → expires_in   : ${tokenData.expires_in ?? "N/A"}s` +
        `\n  → scope        : "${tokenData.scope ?? "N/A"}"` +
        `\n  → access_token : [REDACTED — never stored]` +
        `\n  → Proceeding to fetch Discord user profile…`
      );

      // ── CHECKPOINT 8: Profile fetch ──────────────────────────────────────
      console.log(
        `[DiscordAuth][CHECKPOINT:8] /callback — requestId=${requestId}` +
        ` GET ${DISCORD_API}/users/@me — fetching Discord user profile for userId=${userId}…`
      );

      const profileRes = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      console.log(
        `[DiscordAuth][CHECKPOINT:8.RESPONSE] /callback — requestId=${requestId}` +
        ` Discord profile fetch: HTTP ${profileRes.status} ok=${profileRes.ok}`
      );

      if (!profileRes.ok) {
        const errText = await profileRes.text();
        console.error(
          `[DiscordAuth][CHECKPOINT:8.FAIL] /callback — requestId=${requestId}` +
          ` Profile fetch FAILED: HTTP ${profileRes.status}` +
          `\n  → body: "${errText.slice(0, 300)}"` +
          ` Redirecting to /feed/model/mlb?discord_error=profile_fetch_failed`
        );
        res.redirect(302, "/feed/model/mlb?discord_error=profile_fetch_failed");
        return;
      }

      const profile = await profileRes.json() as {
        id:             string;
        username:       string;
        discriminator?: string;
        avatar?:        string;
        global_name?:   string;
      };

      const discordId = profile.id;
      // Discord new username system: discriminator is "0" for new-style usernames
      const discordUsername = (profile.discriminator && profile.discriminator !== "0")
        ? `${profile.username}#${profile.discriminator}`
        : (profile.global_name || profile.username);
      const discordAvatar = profile.avatar ?? null;

      console.log(
        `[DiscordAuth][CHECKPOINT:8.OK] /callback — requestId=${requestId}` +
        ` Discord profile fetched for userId=${userId}:` +
        `\n  → discordId       : "${discordId}"` +
        `\n  → discordUsername : "${discordUsername}"` +
        `\n  → global_name     : "${profile.global_name ?? "none"}"` +
        `\n  → discriminator   : "${profile.discriminator ?? "none"}"` +
        `\n  → avatar          : ${discordAvatar ? `"${discordAvatar}"` : "none"}` +
        `\n  → Proceeding to conflict check…`
      );

      // ── CHECKPOINT 9: Conflict check ─────────────────────────────────────
      console.log(
        `[DiscordAuth][CHECKPOINT:9] /callback — requestId=${requestId}` +
        ` Checking DB: is discordId="${discordId}" already linked to a DIFFERENT user?`
      );

      const existing = await db
        .select({ id: appUsers.id, username: appUsers.username })
        .from(appUsers)
        .where(eq(appUsers.discordId, discordId))
        .limit(1);

      console.log(
        `[DiscordAuth][CHECKPOINT:9.RESULT] /callback — requestId=${requestId}` +
        ` Conflict check: existing_links=${existing.length}` +
        `\n  → existing_userId   : ${existing[0]?.id ?? "none"}` +
        `\n  → existing_username : "${existing[0]?.username ?? "none"}"` +
        `\n  → requesting_userId : ${userId}` +
        `\n  → is_conflict       : ${existing.length > 0 && existing[0].id !== userId}`
      );

      if (existing.length > 0 && existing[0].id !== userId) {
        console.warn(
          `[DiscordAuth][CHECKPOINT:9.FAIL] /callback — requestId=${requestId}` +
          ` CONFLICT: discordId="${discordId}" (@${discordUsername}) is already linked to` +
          ` userId=${existing[0].id} ("${existing[0].username}").` +
          ` Blocking link from userId=${userId} to prevent account takeover.` +
          ` Redirecting to /feed/model/mlb?discord_error=already_linked`
        );
        res.redirect(302, "/feed/model/mlb?discord_error=already_linked");
        return;
      }

      console.log(
        `[DiscordAuth][CHECKPOINT:9.OK] /callback — requestId=${requestId}` +
        ` No conflict. Proceeding to write Discord fields to DB for userId=${userId}…`
      );

      // ── CHECKPOINT 10: Write to DB ────────────────────────────────────────
      console.log(
        `[DiscordAuth][CHECKPOINT:10] /callback — requestId=${requestId}` +
        ` Writing Discord fields to app_users for userId=${userId}:` +
        `\n  → discordId         : "${discordId}"` +
        `\n  → discordUsername   : "${discordUsername}"` +
        `\n  → discordAvatar     : ${discordAvatar ? `"${discordAvatar}"` : "null"}` +
        `\n  → discordConnectedAt: ${now} (${new Date(now).toISOString()})`
      );

      await updateAppUser(userId, {
        discordId,
        discordUsername,
        discordAvatar,
        discordConnectedAt: now,
      } as Parameters<typeof updateAppUser>[1]);

      // Verify the write succeeded by reading back the user
      const updatedUser = await getAppUserById(userId);
      const writeVerified = updatedUser?.discordId === discordId;

      console.log(
        `[DiscordAuth][CHECKPOINT:10.VERIFY] /callback — requestId=${requestId}` +
        ` DB write verification:` +
        `\n  → write_verified    : ${writeVerified}` +
        `\n  → db_discordId      : "${updatedUser?.discordId ?? "null"}"` +
        `\n  → db_discordUsername: "${updatedUser?.discordUsername ?? "null"}"` +
        `\n  → expected_discordId: "${discordId}"`
      );

      if (!writeVerified) {
        console.error(
          `[DiscordAuth][CHECKPOINT:10.FAIL] /callback — requestId=${requestId}` +
          ` DB write FAILED: discordId not found in DB after updateAppUser().` +
          ` updatedUser.discordId="${updatedUser?.discordId ?? "null"}" expected="${discordId}".` +
          ` This may indicate a schema mismatch or DB write error.` +
          ` Redirecting to /feed/model/mlb?discord_error=db_write_failed`
        );
        res.redirect(302, "/feed/model/mlb?discord_error=db_write_failed");
        return;
      }

      // ── CHECKPOINT 11: SUCCESS ────────────────────────────────────────────
      console.log(
        `[DiscordAuth][CHECKPOINT:11.SUCCESS] /callback — requestId=${requestId}` +
        ` ✅ userId=${userId} ("${updatedUser?.username}") successfully linked to` +
        ` Discord @${discordUsername} (id=${discordId}).` +
        ` DB write verified. Redirecting to /feed/model/mlb?discord_linked=1`
      );

      res.redirect(302, "/feed/model/mlb?discord_linked=1");

    } catch (err) {
      console.error(
        `[DiscordAuth][CHECKPOINT:EXCEPTION] /callback — requestId=${requestId}` +
        ` userId=${userId} UNEXPECTED ERROR:`,
        err
      );
      res.redirect(302, "/feed/model/mlb?discord_error=server_error");
    }
  });

  // ─── Step 3: Disconnect Discord account ───────────────────────────────────
  //
  // CHECKPOINT A: Request received — validate session cookie
  // CHECKPOINT B: JWT verified — clear Discord fields from DB
  // CHECKPOINT C: SUCCESS — return {success: true}
  app.post(`${ROUTE_PREFIX}/disconnect`, async (req: Request, res: Response) => {
    const requestId = Math.random().toString(36).slice(2, 8).toUpperCase();
    console.log(
      `[DiscordAuth][CHECKPOINT:A] /disconnect — requestId=${requestId}` +
      ` cookie_present=${!!(req.headers.cookie)}`
    );

    const token = getAppCookie(req);
    if (!token) {
      console.log(
        `[DiscordAuth][CHECKPOINT:A.FAIL] /disconnect — requestId=${requestId}` +
        ` REJECTED: no app_session cookie`
      );
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const payload = await verifyAppUserToken(token);
    if (!payload) {
      console.log(
        `[DiscordAuth][CHECKPOINT:A.FAIL] /disconnect — requestId=${requestId}` +
        ` REJECTED: JWT verification failed`
      );
      res.status(401).json({ error: "Invalid session" });
      return;
    }

    const user = await getAppUserById(payload.userId);
    if (!user) {
      console.log(
        `[DiscordAuth][CHECKPOINT:B.FAIL] /disconnect — requestId=${requestId}` +
        ` REJECTED: userId=${payload.userId} not found in DB`
      );
      res.status(404).json({ error: "User not found" });
      return;
    }

    console.log(
      `[DiscordAuth][CHECKPOINT:B.OK] /disconnect — requestId=${requestId}` +
      ` userId=${payload.userId} username="${user.username}"` +
      ` current discordId="${user.discordId ?? "none"}"` +
      ` current discordUsername="${user.discordUsername ?? "none"}"` +
      ` → clearing Discord fields from DB…`
    );

    await updateAppUser(payload.userId, {
      discordId:          null,
      discordUsername:    null,
      discordAvatar:      null,
      discordConnectedAt: null,
    } as Parameters<typeof updateAppUser>[1]);

    console.log(
      `[DiscordAuth][CHECKPOINT:C.SUCCESS] /disconnect — requestId=${requestId}` +
      ` userId=${payload.userId} ("${user.username}") Discord account unlinked successfully`
    );

    res.json({ success: true });
  });

  // ── Final confirmation log ────────────────────────────────────────────────
  console.log(
    `[DiscordAuth][STARTUP] All 3 Discord routes registered:` +
    ` GET ${ROUTE_PREFIX}/connect,` +
    ` GET ${ROUTE_PREFIX}/callback,` +
    ` POST ${ROUTE_PREFIX}/disconnect`
  );
}
