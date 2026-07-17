import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import compression from "compression";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import helmet from "helmet";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { registerDiscordAuthRoutes } from "../discordAuth";
import { registerDiscordLoginRoutes } from "../discordLogin";
import { registerDiscordInviteRoutes } from "../discordInvite";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { startDailyPurgeSchedule } from "../dailyPurge";
import { startVsinAutoRefresh } from "../vsinAutoRefresh";
import { startNbaModelSyncScheduler } from "../nbaModelSync";
import { startNhlModelSyncScheduler } from "../nhlModelSync";
import { startNhlGoalieWatcher } from "../nhlGoalieWatcher";
import { startDiscordBot } from "../discord/bot";
import { startMlbPlayerSyncScheduler } from "../mlbPlayerSync";
import { insertSecurityEvent } from "../db";
import { startSecurityDigestScheduler } from "../securityDigest";
import { startWeeklySecurityDigestScheduler } from "../weeklySecurityDigest";
import { postSecurityAlert } from "../discord/discordSecurityAlert";
import { startMlbScheduleHistoryScheduler } from "../mlbScheduleHistoryScheduler";
import { startNbaScheduleHistoryScheduler } from "../nbaScheduleHistoryScheduler";
import { startNhlScheduleHistoryScheduler } from "../nhlScheduleHistoryScheduler";
import { startMlbNightlyTrendsScheduler } from "../mlbNightlyTrendsRefresh";
import { prewarmSlateCache } from "../actionNetwork";
import { startBetAutoGradeScheduler } from "../betAutoGradeScheduler";
import { startMlbOutcomeAndDriftScheduler } from "../mlbOutcomeAndDriftScheduler";
import { startMlbModelSyncScheduler } from "../mlbModelRunner";
// startJackMacScheduler removed — Jack Mac tab purged
import { getCircuitStatus, getCacheStats } from "../dbCircuitBreaker";
import { getDb, listGames, getCacheHealthStats, getAvailableDates, forceInvalidateGamesCache } from "../db";
import { ensureDebugLogsTable } from "./debugLogger";
import { registerRgProxyRoute } from "../rotogrinderProxy";
import { registerStripeWebhookRoute } from "../stripeWebhook";
import { registerFgLineupsHeartbeat } from "../fangraphsLineupHeartbeat";
import { registerRotoLineupsHeartbeat } from "../rotowireLineupHeartbeat";
import { registerWc2026Heartbeats } from "../wc2026/wc2026Heartbeat";
import { registerCronRoutes } from "../cron/cronRoutes";
import { registerDimeChatRoute } from "../dime-chat.route";
import { registerDimeWC2026Route } from "../dime-wc2026.route";
import { jwtVerify } from "jose";
import { parse as parseCookieHeader } from "cookie";
import { ENV } from "./env";
import { invalidateAppUserByIdCache, lookupAppUserByIdFresh } from "../db";
import { getCachedAppUserEntry, setCachedAppUser } from "../dbCircuitBreaker";
import { resolveOwnerIdentity } from "../ownerAuth";
import { installFatalErrorHandler } from "./fatalErrorHandler";
import { createRequestTimeoutMiddleware } from "./requestTimeout";

// ─── Owner-only app_session auth (Railway-native) ──────────────────────────────
// The legacy owner debug endpoints authenticated via the Manus SDK request-auth
// helper + an OWNER_OPEN_ID comparison against the Manus OAuth server — permanently
// dead off Manus. This mirrors ownerProcedure() in routers/appUsers.ts: verify the
// app_session JWT with ENV.cookieSecret, require type === "app_user", load the user
// row (DB-authoritative — NEVER trust payload.role, a JWT is signed at login and a
// later demotion must take effect immediately), enforce the tokenVersion check, then
// gate on DB role === "owner" (hasAccess/JWT role are NOT enough).
//
// DB-unavailability: these are debug endpoints (e.g. /api/db-status exists to report
// DB health), so a hard-down DB must not lock an owner out entirely. We reuse the
// same reviewed in-memory cache fallback as ownerProcedure (getCachedAppUser) — never
// a bespoke one. The cached row, not the JWT, still supplies the role. If there is no
// cache hit either, we fail closed (401) — a locked-out owner beats an open debug
// endpoint.
// Returns "unauthenticated" (→401) vs "forbidden" (→403) vs an authorized userId.
type OwnerAuthResult =
  | { ok: true; userId: number }
  | { ok: false; status: 401 | 403 };

async function authenticateOwnerRequest(req: express.Request): Promise<OwnerAuthResult> {
  const cookies = parseCookieHeader(req.headers.cookie ?? "");
  const token = cookies["app_session"];
  if (!token) return { ok: false, status: 401 };
  try {
    const secret = new TextEncoder().encode(ENV.cookieSecret);
    const { payload } = await jwtVerify(token, secret);
    if (payload.type !== "app_user") return { ok: false, status: 401 };

    const userId = Number(payload.sub);
    const tv = payload.tv as number | null | undefined;

    const fallback = getCachedAppUserEntry(userId);
    invalidateAppUserByIdCache(userId);
    const lookup = await lookupAppUserByIdFresh(userId);
    if (lookup.status === "found") setCachedAppUser(lookup.user);
    const resolved = resolveOwnerIdentity({ lookup, fallback, tokenVersion: tv });
    if (!resolved.ok) {
      console.log(`[OwnerAuth] REJECTED — reason=${resolved.reason} userId=${userId}`);
      const status = resolved.reason.startsWith("token_version") ? 401 : 403;
      return { ok: false, status };
    }
    return { ok: true, userId };
  } catch {
    return { ok: false, status: 401 };
  }
}

// ─── Background-jobs kill switch ───────────────────────────────────────────────
// Treat both "1" and "true" (case-insensitive, whitespace-tolerant) as disabled.
// The previous exact-"1" check silently ignored DISABLE_BACKGROUND_JOBS=true.
function isBackgroundJobsDisabled(): boolean {
  const v = (process.env.DISABLE_BACKGROUND_JOBS ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

// ─── Rate limit event helper ─────────────────────────────────────────────────
// Fire-and-forget: writes a RATE_LIMIT row to security_events.
// Never awaited — the 429 response is always sent synchronously first.
// In-memory dedup: at most 1 DB write per IP per 60s to prevent DB flooding
// when a single attacker hammers the endpoint repeatedly.
const rateLimitLastPersisted = new Map<string, number>();
const RATE_LIMIT_DEDUP_MS = 60_000; // 1 minute

function fireRateLimitEvent(
  ip: string,
  path: string,
  method: string,
  limitType: "global" | "auth" | "trpc_auth" | "stripe_checkout" | "waitlist_submit",
  ua: string | null,
) {
  const now = Date.now();
  const dedupKey = `${ip}:${path}:${limitType}`;
  const lastSent = rateLimitLastPersisted.get(dedupKey) ?? 0;

  // Prune stale entries to prevent unbounded map growth
  if (rateLimitLastPersisted.size > 5000) {
    const cutoff = now - RATE_LIMIT_DEDUP_MS;
    Array.from(rateLimitLastPersisted.entries()).forEach(([k, v]) => {
      if (v < cutoff) rateLimitLastPersisted.delete(k);
    });
  }

  const tag = `[RateLimit][${limitType.toUpperCase()}]`;
  console.warn(
    `${tag} BLOCKED | IP=${ip} path=${path} method=${method}` +
    ` ua="${ua?.substring(0, 60) ?? "none"}"` +
    (now - lastSent < RATE_LIMIT_DEDUP_MS ? " [DB_DEDUP_SKIP]" : "")
  );

  if (now - lastSent < RATE_LIMIT_DEDUP_MS) return; // deduplicated
  rateLimitLastPersisted.set(dedupKey, now);

  insertSecurityEvent({
    eventType: "RATE_LIMIT",
    ip,
    blockedOrigin: null,
    trpcPath: path,
    httpMethod: method,
    userAgent: ua,
    context: limitType,
    occurredAt: now,
  }).catch((err) =>
    console.error(`${tag} DB insert failed: ${(err as Error).message}`)
  );
  // [STEP] Post structured embed to 🗒️-𝗦𝗘𝗖𝗨𝗥𝗜𝗧𝗬-𝗘𝗩𝗘𝗡𝗧𝗦 Discord channel (async, non-blocking)
  postSecurityAlert({
    eventType: "RATE_LIMIT",
    ip,
    path,
    method,
    userAgent: ua,
    context: limitType,
    occurredAt: now,
  }).catch((err) =>
    console.error(`${tag} Discord alert failed: ${(err as Error).message}`)
  );
}

// ─── Global crash protection ─────────────────────────────────────────────────
// Prevent unhandled promise rejections and uncaught exceptions from killing the
// process. Log them instead so the server stays alive and serves requests.
process.on("unhandledRejection", (reason, promise) => {
  console.error("[CRASH GUARD] Unhandled promise rejection:", reason, "at:", promise);
});

// ─── Rate limiters ────────────────────────────────────────────────────────────
// Global limiter: 200 requests per minute per IP across all API routes.
// Generous enough for legitimate use; blocks automated scraping/flooding.
const globalApiLimiter = rateLimit({
  windowMs: 60 * 1000,          // 1 minute window
  max: 200,                      // max 200 requests per window per IP
  standardHeaders: "draft-7",    // Return rate limit info in RateLimit-* headers
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
  skip: (req) => req.path === "/health", // never throttle health probes
  handler: (req, res, _next, options) => {
    const ip = (req.headers["x-forwarded-for"] as string | undefined)
      ?.split(",")[0].trim() ?? req.ip ?? "unknown";
    const ua = (req.headers["user-agent"] as string | undefined) ?? null;
    fireRateLimitEvent(ip, req.path, req.method, "global", ua);
    res.status(options.statusCode).json(options.message);
  },
});

// Auth limiter: max 5 login/auth attempts per 15 minutes per IP.
// Prevents brute-force credential stuffing on login and OAuth routes.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,     // 15-minute window
  max: 5,                        // max 5 attempts per window per IP
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many authentication attempts. Please wait 15 minutes before trying again." },
  handler: (req, res, _next, options) => {
    const ip = (req.headers["x-forwarded-for"] as string | undefined)
      ?.split(",")[0].trim() ?? req.ip ?? "unknown";
    const ua = (req.headers["user-agent"] as string | undefined) ?? null;
    fireRateLimitEvent(ip, req.path, req.method, "auth", ua);
    res.status(options.statusCode).json(options.message);
  },
});

// tRPC auth procedure limiter: 5 login mutations per 15 minutes per IP.
// Applied specifically to /api/trpc/appUsers.login and /api/trpc/auth.* paths.
const trpcAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please wait 15 minutes." },
  keyGenerator: (req) => {
    // Key by IP + procedure path for precise per-procedure limiting.
    // MUST use ipKeyGenerator helper to normalize IPv6 addresses — express-rate-limit v8
    // throws ERR_ERL_KEY_GEN_IPV6 (fatal ValidationError) if req.ip is used directly.
    const path = req.path.replace(/^\//, "");
    return `${ipKeyGenerator(req.ip ?? "")}:${path}`;
  },
  handler: (req, res, _next, options) => {
    const ip = (req.headers["x-forwarded-for"] as string | undefined)
      ?.split(",")[0].trim() ?? req.ip ?? "unknown";
    const ua = (req.headers["user-agent"] as string | undefined) ?? null;
    fireRateLimitEvent(ip, req.path, req.method, "trpc_auth", ua);
    res.status(options.statusCode).json(options.message);
  },
});

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  console.log(`[PORT_CHECK] Scanning for available port starting at ${startPort}`);
  for (let port = startPort; port < startPort + 20; port++) {
    console.log(`[PORT_CHECK] Testing port ${port}...`);
    const available = await isPortAvailable(port);
    if (available) {
      console.log(`[PORT_CHECK] Port ${port} is available ✓`);
      return port;
    }
    console.log(`[PORT_CHECK] Port ${port} is in use, trying next`);
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  console.log(`[SERVER_STARTUP] startServer() invoked — NODE_ENV=${process.env.NODE_ENV} PORT_ENV=${process.env.PORT ?? "(unset)"} pid=${process.pid}`);

  const app = express();
  console.log(`[SERVER_STARTUP] Express app created`);

  const server = createServer(app);
  installFatalErrorHandler({ server });
  console.log(`[SERVER_STARTUP] HTTP server created`);

  // ─── Server-level error handlers ─────────────────────────────────────────
  // Catch binding errors (EADDRINUSE, EACCES) and connection-level errors
  // that would otherwise surface silently or crash the process.
  server.on("error", (err: NodeJS.ErrnoException) => {
    console.error(`[ERROR] HTTP server error event: code=${err.code} message=${err.message}`, err);
  });
  server.on("clientError", (err: NodeJS.ErrnoException, socket) => {
    console.error(`[ERROR] HTTP client error: code=${err.code} message=${err.message}`);
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });
  server.on("connection", (socket) => {
    console.log(`[SERVER_STARTUP] New TCP connection from ${socket.remoteAddress}:${socket.remotePort}`);
  });

  // ─── Top-level request logger ────────────────────────────────────────────
  // Installed FIRST so every request — including those rejected by later
  // middleware — is captured. Logs method, path, key headers, and final status.
  //
  // Sampling: only 10% of normal requests are logged to stay well under
  // Railway's 500 logs/sec rate limit. Errors (5xx) and slow requests
  // (>1000ms) are ALWAYS logged regardless of the sample decision so that
  // production visibility into problems is fully preserved.
  console.log(`[SERVER_STARTUP] Registering top-level request logging middleware`);
  app.use((req, res, next) => {
    const start = Date.now();
    const ts = new Date().toISOString();
    const ip =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0].trim() ??
      req.socket?.remoteAddress ??
      "unknown";
    // Decide at request-time whether this request falls in the 10% sample.
    // The same flag is reused on the response so both log lines are emitted
    // together or suppressed together for normal requests.
    const sampled = Math.random() < 0.1;
    if (sampled) {
      console.log(
        `[HTTP_REQUEST] → ${req.method} ${req.originalUrl} | ts=${ts} ip=${ip}` +
        ` host=${req.headers["host"] ?? "-"}` +
        ` x-forwarded-for=${req.headers["x-forwarded-for"] ?? "-"}` +
        ` x-forwarded-proto=${req.headers["x-forwarded-proto"] ?? "-"}` +
        ` user-agent=${(req.headers["user-agent"] ?? "-").substring(0, 80)}`
      );
    }
    res.on("finish", () => {
      const ms = Date.now() - start;
      const isError = res.statusCode >= 500;
      const isSlow = ms > 1000;
      if (sampled || isError || isSlow) {
        console.log(
          `[HTTP_REQUEST] ← ${req.method} ${req.originalUrl} | status=${res.statusCode} duration=${ms}ms ip=${ip}` +
          (isError ? " [ERROR]" : "") +
          (isSlow ? " [SLOW]" : "")
        );
      }
    });
    // Response-stream error hardening: a stream 'error' with no listener (e.g.
    // a write-after-end from a rogue second writer) escalates to
    // uncaughtException, which fatalErrorHandler turns into process.exit(1) —
    // killing every in-flight request over one broken response. Log it loudly
    // instead; the failed response is already unrecoverable. ALWAYS logged
    // (never sampled) so any recurrence of the 2026-07 incident is visible.
    res.on("error", (err: NodeJS.ErrnoException) => {
      console.error(
        `[RES_STREAM_ERROR] ${req.method} ${req.originalUrl} code=${err.code ?? "?"} message=${err.message}`
      );
    });
    next();
  });

  // ─── www → non-www canonical redirect (308) ─────────────────────────────
  // The edge proxy www redirect uses 301 (which converts POST→GET per HTTP spec),
  // silently dropping the request body. This middleware intercepts www requests
  // at the Express level first and issues a 308 Permanent Redirect, which
  // preserves the HTTP method and body. This fixes login and all API mutations
  // when users access www.aisportsbettingmodels.com.
  app.use((req, res, next) => {
    const host = req.headers.host ?? "";
    if (host.startsWith("www.")) {
      const canonical = host.slice(4); // strip "www."
      const redirectUrl = `${req.protocol}://${canonical}${req.originalUrl}`;
      console.log(`[www→canonical] 308 redirect: ${host}${req.originalUrl} → ${redirectUrl}`);
      return res.redirect(308, redirectUrl);
    }
    next();
  });

  // ─── Gzip/Brotli response compression ───────────────────────────────────────
  // Compresses all JSON/HTML responses. tRPC payloads (often 50-200KB for large
  // bet lists) shrink 70-85% — dramatically reducing network transfer time.
  // threshold=512: skip compression for tiny responses where overhead > benefit.
  console.log(`[SERVER_STARTUP] Registering compression middleware`);
  app.use(compression({ threshold: 512 }));

  // Trust the first proxy (Manus edge) so req.protocol reflects
  // the original HTTPS scheme and cookies are set correctly (sameSite+secure).
  // Also required for express-rate-limit to read the real client IP from
  // X-Forwarded-For rather than the proxy IP.
  app.set('trust proxy', 1);

  // ─── Security headers (helmet) ────────────────────────────────────────────
  // Sets X-Content-Type-Options, X-Frame-Options, X-XSS-Protection,
  // Strict-Transport-Security, Referrer-Policy, and a Content-Security-Policy
  // that allows our own origin + CDN assets. Vite HMR websocket is allowed in dev.
  console.log(`[SERVER_STARTUP] Registering helmet security headers middleware`);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Stripe Embedded Checkout (/checkout, MUST stay on-domain — owner
        // directive): Stripe.js loads from js.stripe.com and mounts an iframe.
        // Without these CSP allowances the browser blocks the script and the
        // page shows "Failed to load Stripe.js" (observed live 2026-07-10).
        // Per https://docs.stripe.com/security/guide#content-security-policy
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://js.stripe.com",
          "https://*.js.stripe.com",
          ...(process.env.NODE_ENV !== "production" ? ["'unsafe-eval'"] : []), // unsafe-eval only in dev (Vite HMR)
        ],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
        connectSrc: ["'self'", "wss:", "ws:", "https:"],
        frameSrc: [
          "'self'", // same-origin iframes (Rotogrinders proxy)
          "https://js.stripe.com",
          "https://*.js.stripe.com",
          "https://checkout.stripe.com", // Embedded Checkout session iframe
          "https://hooks.stripe.com",    // 3DS / bank-redirect auth frames
        ],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false, // Allow embedding external resources (logos, CDN)
  }));

  // ─── Stripe webhook — MUST be registered BEFORE express.json() ────────────
  // Uses express.raw() to preserve the raw buffer for HMAC-SHA256 signature
  // verification. Placed here so it intercepts /api/stripe/webhook before the
  // JSON body parser consumes and discards the raw body.
  console.log(`[SERVER_STARTUP] Registering Stripe webhook route`);
  registerStripeWebhookRoute(app);

  // ─── Body parser with tight size limits ──────────────────────────────────
  // 10kb for JSON API calls (tRPC procedures never need more than a few KB).
  // 1mb for URL-encoded forms. The previous 50mb limit was a DoS vector.
  // Note: file upload procedures use base64 strings — if needed, raise to 2mb max.
  console.log(`[SERVER_STARTUP] Registering JSON + URL-encoded body parsers`);
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ limit: "1mb", extended: true }));

  // ─── Health check endpoint ────────────────────────────────────────────────
  // Lightweight endpoint for load balancer health probes and uptime monitoring.
  // Returns 200 immediately without hitting the DB so it never times out.
  console.log(`[SERVER_STARTUP] Registering /health endpoint`);
  app.get("/health", (req, res) => {
    const circuit = getCircuitStatus();
    const dbOk = circuit.state === 'CLOSED';
    const ip =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0].trim() ??
      req.socket?.remoteAddress ??
      "unknown";
    console.log(`[HEALTH_CHECK] GET /health | ip=${ip} db.state=${circuit.state} dbOk=${dbOk}`);
    res.status(dbOk ? 200 : 503).json({
      status: dbOk ? 'ok' : 'degraded',
      ts: Date.now(),
      db: { state: circuit.state, consecutiveFailures: circuit.consecutiveFailures },
    });
  });

  // ─── DB status endpoint (owner-only, rate-limited) ─────────────────────────────
  // BE-006: Protected behind globalApiLimiter + owner auth.
  app.get("/api/db-status", globalApiLimiter, async (req, res) => {
    const auth = await authenticateOwnerRequest(req);
    if (!auth.ok) {
      return res.status(auth.status).json({ error: auth.status === 401 ? "unauthorized" : "owner-only" });
    }
    const circuit = getCircuitStatus();
    const cache = getCacheStats();
    res.json({
      ts: Date.now(),
      circuit,
      userCache: cache,
    });
  });
  // ─── Performance health endpoint (owner-only, rate-limited) ────────────────────────
  // BE-006: Protected behind globalApiLimiter + owner auth.
  app.get("/api/perf", globalApiLimiter, async (req, res) => {
    const auth = await authenticateOwnerRequest(req);
    if (!auth.ok) {
      return res.status(auth.status).json({ error: auth.status === 401 ? "unauthorized" : "owner-only" });
    }
    const cacheHealth = getCacheHealthStats();
    const circuit = getCircuitStatus();
    const uptime = process.uptime();
    const mem = process.memoryUsage();
    res.json({
      ts: Date.now(),
      uptime: `${Math.round(uptime)}s`,
      memory: {
        heapUsedMB: (mem.heapUsed / 1024 / 1024).toFixed(1),
        heapTotalMB: (mem.heapTotal / 1024 / 1024).toFixed(1),
        rssMB: (mem.rss / 1024 / 1024).toFixed(1),
      },
      cache: cacheHealth,
      db: { state: circuit.state, consecutiveFailures: circuit.consecutiveFailures },
    });
  });

  // ─── Debug logs endpoint (owner-only, rate-limited) ────────────────────────
  // Returns recent background job logs from the debug_logs table.
  // Supports ?source=ANApiOdds&level=warn&limit=100 query params.
  // Replaces stdout log inspection for background job debugging.
  app.get("/api/debug-logs", globalApiLimiter, async (req, res) => {
    const auth = await authenticateOwnerRequest(req);
    if (!auth.ok) {
      return res.status(auth.status).json({ error: auth.status === 401 ? "unauthorized" : "owner-only" });
    }

    const db = await getDb();
    if (!db) return res.status(503).json({ error: "db-unavailable" });

    try {
      const source = typeof req.query.source === "string" ? req.query.source : null;
      const level  = typeof req.query.level  === "string" ? req.query.level  : null;
      const limit  = Math.min(parseInt(String(req.query.limit ?? "200"), 10) || 200, 1000);

      // Build WHERE clause dynamically
      let whereClause = "WHERE 1=1";
      const params: (string | number)[] = [];
      if (source) { whereClause += " AND source = ?"; params.push(source); }
      if (level)  { whereClause += " AND level = ?";  params.push(level); }
      params.push(limit);

      const [rows] = await db.execute(
        `SELECT id, source, level, message, context, created_at FROM debug_logs ${whereClause} ORDER BY created_at DESC LIMIT ?`,
        params
      );

      res.json({
        ts: Date.now(),
        count: (rows as unknown[]).length,
        filters: { source, level, limit },
        logs: rows,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Table may not exist yet — return helpful error
      if (msg.includes("doesn't exist") || msg.includes("Table") || msg.includes("ER_NO_SUCH_TABLE")) {
        return res.status(404).json({ error: "debug_logs table not found — restart server to auto-create it" });
      }
      console.error("[DebugLogs] Query failed:", err);
      res.status(500).json({ error: "query-failed", message: msg });
    }
  });

  // ─── Global API rate limiter ──────────────────────────────────────────────
  // Applied to all /api/* routes. Skips /health (handled above).
  console.log(`[SERVER_STARTUP] Registering global API rate limiter on /api`);
  app.use("/api", globalApiLimiter);

  // ─── Auth-specific rate limiters ─────────────────────────────────────────
  // Manus OAuth callback — 5 attempts per 15 min per IP
  app.use("/api/oauth", authLimiter);

  // Discord OAuth routes — 5 attempts per 15 min per IP
  app.use("/api/discord-auth", authLimiter);
  app.use("/api/auth/discord-invite", authLimiter);
  app.use("/api/auth/discord-login", authLimiter);
  app.use("/api/auth/discord", authLimiter);

  // tRPC login mutation — 5 attempts per 15 min per IP
  // Matches both batch (?batch=1) and direct calls to appUsers.login
  app.use("/api/trpc/appUsers.login", trpcAuthLimiter);
  app.use("/api/trpc/auth.login", trpcAuthLimiter);

  // ─── Stripe checkout rate limiter ────────────────────────────────────────
  // Dedicated limiter for the unauthenticated publicCreateCheckoutSession endpoint.
  // Forensic analysis (2026-05-24) confirmed 3 coordinated automated probes from
  // Google Cloud Run (AS15169) targeting this exact procedure within 8.6 hours.
  // Each probe used a unique *.run.app subdomain and IPv6 address — classic
  // rotating-origin evasion to bypass per-IP CSRF dedup guards.
  // Limit: 10 checkout attempts per 15 minutes per IP — generous for any real user
  // (who clicks once), but stops automated probers that rotate IPs.
  const stripeCheckoutLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many checkout requests. Please wait 15 minutes before trying again." },
    keyGenerator: (req) => {
      const path = req.path.replace(/^\//, "");
      return `${ipKeyGenerator(req.ip ?? "")}:${path}`;
    },
    handler: (req, res, _next, options) => {
      const ip = (req.headers["x-forwarded-for"] as string | undefined)
        ?.split(",")[0].trim() ?? req.ip ?? "unknown";
      const ua = (req.headers["user-agent"] as string | undefined) ?? null;
      console.warn(`[STRIPE_CHECKOUT_RATE_LIMIT] IP=${ip} path=${req.path} ua=${ua ?? "none"}`);
      fireRateLimitEvent(ip, req.path, req.method, "stripe_checkout", ua);
      res.status(options.statusCode).json(options.message);
    },
  });
  // Apply to both direct and batch tRPC calls
  app.use("/api/trpc/stripe.publicCreateCheckoutSession", stripeCheckoutLimiter);
  // Embedded (in-domain) checkout variant — same abuse surface, same limiter
  app.use("/api/trpc/stripe.publicCreateEmbeddedCheckoutSession", stripeCheckoutLimiter);
  // Identity attach (elements-mode username metadata) — public + hits Stripe API,
  // same limiter class (per-path buckets via keyGenerator).
  app.use("/api/trpc/stripe.publicAttachCheckoutIdentity", stripeCheckoutLimiter);

  // ─── Waitlist submit rate limiter (DB-006 remediation) ────────────────────
  // Public form endpoint — 5 submissions per 15 minutes per IP.
  // Prevents automated spam/enumeration on the waitlist join endpoint.
  const waitlistSubmitLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many waitlist submissions. Please wait 15 minutes before trying again." },
    keyGenerator: (req) => {
      return `waitlist:${ipKeyGenerator(req.ip ?? "")}`;
    },
    handler: (req, res, _next, options) => {
      const ip = (req.headers["x-forwarded-for"] as string | undefined)
        ?.split(",")[0].trim() ?? req.ip ?? "unknown";
      const ua = (req.headers["user-agent"] as string | undefined) ?? null;
      console.warn(`[WAITLIST_RATE_LIMIT] IP=${ip} path=${req.path} ua=${ua ?? "none"}`);
      fireRateLimitEvent(ip, req.path, req.method, "waitlist_submit", ua);
      res.status(options.statusCode).json(options.message);
    },
  });
  app.use("/api/trpc/waitlist.submit", waitlistSubmitLimiter);

  // ─── Request timeout middleware (non-tRPC only — single-writer rule) ──────
  // The previous inline version raced the tRPC adapter for response ownership:
  // when a /api/trpc request exceeded 60s it wrote its own body, and the
  // adapter's later setHeader()/end() produced ERR_HTTP_HEADERS_SENT (the
  // recurring 2026-07 production incident — see INCIDENTS.md 2026-07-17 and
  // server/_core/requestTimeout.ts for the full mechanism). tRPC requests are
  // now bounded by the procedure-level timeout in _core/trpc.ts instead, so the
  // adapter is the only writer on /api/trpc. This middleware still guards
  // non-tRPC routes (heartbeats, proxies) with a 503.
  app.use(createRequestTimeoutMiddleware());

  // Storage proxy — serves /manus-storage/* paths via signed Forge URLs
  console.log(`[SERVER_STARTUP] Registering storage proxy routes`);
  registerStorageProxy(app);
  // OAuth callback under /api/oauth/callback
  console.log(`[SERVER_STARTUP] Registering OAuth routes`);
  registerOAuthRoutes(app);
  // Discord account linking routes
  console.log(`[SERVER_STARTUP] Registering Discord auth/login/invite routes`);
  registerDiscordAuthRoutes(app);
  registerDiscordLoginRoutes(app);
  registerDiscordInviteRoutes(app);
  // Rotogrinders server-side proxy — PAUSED (set ROTOGRINDERS_PAUSED=false in jackMac.ts to re-enable scheduler too)
  // registerRgProxyRoute(app);  // PAUSED

  // ─── Fangraphs lineup Heartbeat ─────────────────────────────────────────
  // POST /api/scheduled/fg-lineups — called every 10 min by Manus Heartbeat
  // Writes today + tomorrow MLB lineup tabs. Zero RotoGrinders code.
  console.log(`[SERVER_STARTUP] Registering Fangraphs lineup heartbeat route`);
  registerFgLineupsHeartbeat(app);

  // ─── Rotowire lineup Heartbeat ──────────────────────────────────────────
  // POST /api/scheduled/roto-lineups — called every 10 min by Manus Heartbeat
  // Scrapes Rotowire today + tomorrow lineups → writes MM-DD-YYYY LINEUPS tabs.
  // Schema: BATTING_ORDER (J) | BATTER_NAME (K) | BAT_HAND (L) | POSITION (M)
  console.log(`[SERVER_STARTUP] Registering Rotowire lineup heartbeat route`);
  registerRotoLineupsHeartbeat(app);

  // ─── WC2026 Heartbeats ───────────────────────────────────────────────────
  // POST /api/scheduled/wc2026-odds    — every 30 min (5 min near kickoff)
  // POST /api/scheduled/wc2026-splits  — every 10 min
  // POST /api/scheduled/wc2026-lineups — every 10 min
  console.log(`[SERVER_STARTUP] Registering WC2026 heartbeat routes`);
  registerWc2026Heartbeats(app);

  // ─── GitHub Actions cron endpoints (off-Manus data freshness) ────────────
  // POST /api/cron/vsin-odds · /api/cron/scores — fired by GitHub Actions on a
  // timer, shared-secret authed (CRON_SECRET). These replace the always-on
  // in-process schedulers gated off via DISABLE_BACKGROUND_JOBS on Railway.
  console.log(`[SERVER_STARTUP] Registering GitHub Actions cron routes`);
  registerCronRoutes(app);

  // ─── Dime AI Chat — SSE streaming endpoint ──────────────────────────────
  // POST /api/dime/chat — Claude Fable 5 streaming chat for the Chat tab.
  // Plain Express SSE route (not tRPC) for optimal streaming performance.
  console.log(`[SERVER_STARTUP] Registering Dime AI chat SSE route`);
  registerDimeChatRoute(app);

  // ─── Dime WC2026 Intelligence — Tier 4 authenticated, credit-gated, source-grounded
  // POST /api/dime/wc2026 — 14-step enforcement, 22-path validated
  console.log(`[SERVER_STARTUP] Registering Dime WC2026 intelligence route`);
  registerDimeWC2026Route(app);

  // tRPC API
  console.log(`[SERVER_STARTUP] Registering tRPC middleware on /api/trpc`);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
      onError: ({ error, path }) => {
        // Log server-side errors (not client errors like UNAUTHORIZED/NOT_FOUND)
        if (error.code === "INTERNAL_SERVER_ERROR") {
          console.error(`[tRPC ERROR] ${path}:`, error);
        }
      },
    })
  );

  // ─── Legacy slug eradication — permanent redirects (308) ────────────────
  // [NAV RECONSTRUCTION 2026-07-11] The pre-Dime navigation slugs (/feed with
  // its ?tab=… query hooks, the public /splits page, /projections, /dashboard)
  // are permanently routed to the canonical surfaces:
  //   /feed/model/{mlb|wc}-MM-DD-YYYY  (AI Model Projections)
  //   /betting-splits/MLB              (Betting Splits)
  // Client-side <Redirect>s in App.tsx cover SPA navigations; this middleware
  // covers full-page loads (bookmarks, Discord links, crawlers) with a real
  // HTTP 308 so the legacy URLs drop out of caches and search indexes.
  // 308 (method-preserving) mirrors the www→canonical middleware above.
  // Matches are EXACT paths — /feed/model/* never enters this handler.
  const feedSlugDate = (): string => {
    // Mirrors client CalendarPicker todayUTC(): the feed advances at
    // 07:00 UTC (00:01 PT) — NOT tRPC getCurrentDate's 11:00 cutoff — so the
    // redirect lands on the same slate DimeModelFeed defaults to.
    const FEED_CUTOFF_UTC_HOUR = 7;
    const now = new Date();
    const ms = now.getUTCHours() < FEED_CUTOFF_UTC_HOUR
      ? now.getTime() - 24 * 60 * 60 * 1000
      : now.getTime();
    const d = new Date(ms);
    const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
    const da = String(d.getUTCDate()).padStart(2, "0");
    return `${mo}-${da}-${d.getUTCFullYear()}`;
  };
  console.log(`[SERVER_STARTUP] Registering legacy slug 308 redirects (/feed, /splits, /projections, /dashboard)`);
  const firstQueryValue = (v: unknown): string =>
    typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : "";
  app.get(["/feed", "/splits", "/projections", "/dashboard"], (req, res) => {
    const tab = firstQueryValue(req.query.tab);
    let target: string;
    if (req.path === "/splits" || tab === "splits") {
      target = "/betting-splits/MLB";
    } else {
      const sport = firstQueryValue(req.query.sport).toUpperCase() === "WC" ? "wc" : "mlb";
      const legacyDate = firstQueryValue(req.query.date);
      const slugDate = /^\d{4}-\d{2}-\d{2}$/.test(legacyDate)
        ? `${legacyDate.slice(5, 7)}-${legacyDate.slice(8, 10)}-${legacyDate.slice(0, 4)}`
        : feedSlugDate();
      target = `/feed/model/${sport}-${slugDate}`;
    }
    // Forward every query param the redirect itself doesn't consume — e.g.
    // discord_linked / discord_error state from OAuth callbacks must survive
    // the hop instead of being silently stripped.
    const passthrough = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) {
      if (key === "tab" || key === "sport" || key === "date") continue;
      const v = firstQueryValue(value);
      if (v !== "" || value === "") passthrough.set(key, v);
    }
    const qs = passthrough.toString();
    if (qs) target += `?${qs}`;
    // The /feed target varies with the 07:00 UTC rollover — a cached 308
    // would pin repeat visitors to a stale date, so forbid caching.
    res.set("Cache-Control", "no-store");
    console.log(`[legacy→canonical] 308 redirect: ${req.originalUrl} → ${target}`);
    res.redirect(308, target);
  });

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    console.log(`[SERVER_STARTUP] Setting up Vite dev middleware`);
    await setupVite(app, server);
    console.log(`[SERVER_STARTUP] Vite dev middleware ready`);
  } else {
    console.log(`[SERVER_STARTUP] Registering static file serving (production)`);
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  console.log(`[SERVER_STARTUP] Preferred port from env: ${preferredPort} (PORT="${process.env.PORT ?? "(unset)"}")`);
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`[SERVER_STARTUP] Port ${preferredPort} is busy, using port ${port} instead`);
  }

  // Registered via server.once("listening") — NOT as a listen() callback — so it
  // runs exactly once (a listen(cb) callback stays armed across re-listens and
  // would double-start every scheduler below).
  const onListening = () => {
    const addr = server.address();
    console.log(`[SERVER_STARTUP] ✓ Server listening — bound=${JSON.stringify(addr)} url=http://localhost:${port}/`);
    console.log(`Server running on http://localhost:${port}/`);
    // Ensure debug_logs table exists — idempotent, non-fatal
    ensureDebugLogsTable().catch((err: unknown) => console.warn('[Startup] [DebugLogger] Table creation failed (non-fatal):', err));
    // ── Recurring background jobs (metered-host credit control) ──────────────
    // Every job below is an in-process 24/7 loop (VSiN scrapers, model runs,
    // schedule-history refreshes, bet auto-grading, security digests). On a
    // metered host like Railway these loops dominate CPU cost and log volume.
    // Set DISABLE_BACKGROUND_JOBS=1 to run this instance web-only: it still
    // serves pages, DB reads/writes, checkout and Dime Chat — it just stops
    // refreshing odds/lineups/scores/models (and the Discord bot) until the
    // flag is removed or the jobs are moved to a dedicated worker service.
    // Unset (the default) preserves current behavior — every job runs.
    if (isBackgroundJobsDisabled()) {
      console.log('[SCHEDULERS] DISABLE_BACKGROUND_JOBS set — web-only mode: recurring background jobs skipped');
    } else {
    // Start daily 6am EST game purge (removes previous day's games)
    startDailyPurgeSchedule();
    // Auto-refresh VSiN book odds every 30 minutes (6am–midnight PST)
    startVsinAutoRefresh();
    // Auto-sync NBA model projections from Google Sheet every 3 hours (9AM–midnight PST)
    startNbaModelSyncScheduler();
    // NHL model sync — runs every 30 min (9AM–9PM PST), models unmodeled NHL games
    startNhlModelSyncScheduler();
    // NHL goalie watcher — checks RotoWire every 10 min for goalie changes, re-runs model on scratch
    startNhlGoalieWatcher();
    // Discord bot — listens for /splits slash command
    startDiscordBot();
    // MLB player sync — nightly at 08:00 UTC, updates active rosters from MLB Stats API
    startMlbPlayerSyncScheduler();
    // MLB schedule history — startup 7-day backfill + refresh every 4h (6AM–midnight EST)
    startMlbScheduleHistoryScheduler();
    // MLB TRENDS nightly refresh — fires at 2:59 AM EST (11:59 PM PST) every night
    // Re-ingests yesterday + today, runs 30-team cross-validation, notifies owner
    startMlbNightlyTrendsScheduler();
    // NBA schedule history — startup 7-day backfill + refresh every 4h (6AM–midnight EST)
    startNbaScheduleHistoryScheduler();
    // NHL schedule history — startup 7-day backfill + refresh every 4h (6AM–midnight EST)
    startNhlScheduleHistoryScheduler();
    // Pre-warm Action Network slate cache for today — eliminates cold-start latency on first BetTracker load
    prewarmSlateCache().catch(err => console.error("[AN][PREWARM] Failed:", err));
    // Automated bet grading — 15-min polling during game hours + nightly 11:30 PM EST sweep
    startBetAutoGradeScheduler();
    // MLB outcome ingestion + f5_share drift detection + auto-recalibration
    // Nightly at 12:30 AM PST: ingest final game outcomes → compute Brier scores → check f5_share drift
    // Monthly on 1st at 3:00 AM PST: full recalibration regardless of drift
    startMlbOutcomeAndDriftScheduler();
    // MLB model sync — standalone 5-min heartbeat for today+tomorrow, 24/7, no time gates
    // Catch-all safety net: models any game with pitchers+lines but modelRunAt=null
    // Idempotent: modelRunAt IS NULL guard prevents re-running already-modeled games
    startMlbModelSyncScheduler();
    // Jack Mac scheduler removed — tab purged
    // Security digest — daily at 08:00 EST (13:00 UTC), sends 24h threat summary via notifyOwner()
    startSecurityDigestScheduler();
    // Weekly security threat trend digest — every Sunday at 08:00 EST, 7-day bar chart + top IPs
    startWeeklySecurityDigestScheduler();

    // ── Startup DB backfills + Fangraphs scrape loop (MOVED inside the guard) ──
    // These write to the DB / scrape an upstream feed on a timer. Previously they
    // ran outside the DISABLE_BACKGROUND_JOBS guard, so every web replica executed
    // them — double-writing the backfills and duplicating the 30-min scrape. They
    // are background jobs and belong behind the kill switch.
    // OddsHistory lineSource backfill — sets lineSource on historical rows where it is NULL
    // Uses game.oddsSource as ground truth. Runs once at startup, no-ops if all rows already set.
    import('../db').then(({ backfillOddsHistoryLineSource }) => {
      backfillOddsHistoryLineSource()
        .catch((err: unknown) => console.warn('[Startup] [OddsHistory][BACKFILL] lineSource backfill failed (non-fatal):', err));
    }).catch((err: unknown) => console.warn('[Startup] [OddsHistory][BACKFILL] Import failed (non-fatal):', err));

    // K-Props MLBAM ID startup backfill — resolves all historical rows missing pitcher headshot IDs
    // Runs once on server start, non-fatal, no-ops if all rows already resolved
    import('../mlbKPropsModelService').then(({ backfillAllKPropsMlbamIds }) => {
      backfillAllKPropsMlbamIds()
        .then((r: { resolved: number; alreadyHad: number; unresolved: number; errors: number }) =>
          console.log(`[Startup] [MLBAM_BACKFILL] K-Props: resolved=${r.resolved} alreadyHad=${r.alreadyHad} unresolved=${r.unresolved} errors=${r.errors}`)
        )
        .catch((err: unknown) => console.warn('[Startup] [MLBAM_BACKFILL] K-Props startup backfill failed (non-fatal):', err));
    }).catch((err: unknown) => console.warn('[Startup] [MLBAM_BACKFILL] Import failed (non-fatal):', err));

    // ── Lineup cache pre-warm + recurring 30-min Fangraphs scrape loop ─────────
    // Pre-fetch MLB lineups at startup so the first LINEUPS tab load is instant,
    // then refresh every 30 minutes. This scrapes an upstream feed on a timer, so
    // a web-only replica must skip it (the next user request triggers a live fetch).
    import('../fangraphsScraper').then(({ scrapeFangraphsLineups }) => {
      // Initial pre-fetch: 3 seconds after startup (avoids blocking the listen callback)
      setTimeout(() => {
        scrapeFangraphsLineups()
          .then(r => console.log(`[Startup] [LINEUP_CACHE] Pre-warmed: today=${r.today.games.length} tomorrow=${r.tomorrow.games.length}`))
          .catch((err: unknown) => console.warn('[Startup] [LINEUP_CACHE] Pre-fetch failed (non-fatal):', err));
      }, 3000);
      // Recurring refresh: every 30 minutes (force-refresh to bypass cache)
      const lineupRefreshInterval = setInterval(() => {
        scrapeFangraphsLineups(true)
          .then(r => console.log(`[Scheduler] [LINEUP_CACHE] Refreshed: today=${r.today.games.length} tomorrow=${r.tomorrow.games.length}`))
          .catch((err: unknown) => console.warn('[Scheduler] [LINEUP_CACHE] Refresh failed (non-fatal):', err));
      }, 30 * 60 * 1000);
      lineupRefreshInterval.unref();
      console.log('[Startup] [LINEUP_CACHE] Lineup cache pre-warm scheduled (startup + every 30 min)');
    }).catch((err: unknown) => console.warn('[Startup] [LINEUP_CACHE] Import failed (non-fatal):', err));
    } // ── end recurring background jobs (DISABLE_BACKGROUND_JOBS guard) ──
    // ── DB keep-alive ping ──────────────────────────────────────────────────
    // TiDB Serverless drops idle connections after ~5 minutes. Without a
    // recurring keep-alive, the second password update (or any mutation that
    // comes minutes after the last DB activity) hits a cold TiDB and the
    // connection establishment takes 5-30s — exceeding the circuit breaker
    // timeout and surfacing as "Server temporarily unavailable".
    //
    // Fix: fire SELECT 1 immediately on startup AND every 4 minutes thereafter.
    // This keeps the connection pool warm at all times, eliminating cold-start
    // latency for all UserManagement mutations.
    const runDbKeepAlive = () => {
      getDb()
        .then((db) => db!.execute('SELECT 1 AS keepalive'))
        .then(() => console.log('[DB_KEEPALIVE] TiDB connection pool kept warm ✓'))
        .catch((err: unknown) => console.warn('[DB_KEEPALIVE] Ping failed (non-fatal):', err));
    };
    // Initial warm-up: 500ms after startup
    setTimeout(runDbKeepAlive, 500);
    // Recurring keep-alive: every 4 minutes (240s) — well under TiDB's 5-min idle timeout
    // unref() prevents this interval from keeping the process alive during tests
    const keepAliveInterval = setInterval(runDbKeepAlive, 4 * 60 * 1000);
    keepAliveInterval.unref();
    console.log('[DB_KEEPALIVE] Recurring TiDB keep-alive scheduled (every 4 min)');

    // ── Games list cache pre-warm ─────────────────────────────────────────────
    // Pre-warm the games.list cache for all active sports at startup.
    // Without this, the first user after a deploy pays the full DB cost (~150ms).
    // With this, the cache is hot before any user hits the server.
    // Non-fatal: if DB is unavailable, the first user request will populate the cache.
    setTimeout(() => {
      // Compute the effective feed date using the same isBeforeCutoff logic as the client (todayUTC()).
      // The client sends { sport, gameDate: todayUTC() } — we MUST pre-warm THAT exact cache key.
      // Without this, the startup pre-warm populates MLB:ROLLING but the client requests MLB:2026-05-16,
      // which is a different cache key → first user always pays full DB cost → loading delay + potential
      // empty result if the DB is slow or temporarily unavailable.
      const FEED_CUTOFF_UTC_HOUR = 11;
      const nowMs = Date.now();
      const nowUtc = new Date(nowMs);
      const isBeforeCutoff = nowUtc.getUTCHours() < FEED_CUTOFF_UTC_HOUR;
      const effectiveMs = isBeforeCutoff ? nowMs - 24 * 60 * 60 * 1000 : nowMs;
      const effectiveDate = new Date(effectiveMs);
      const todayStr = [
        effectiveDate.getUTCFullYear(),
        String(effectiveDate.getUTCMonth() + 1).padStart(2, '0'),
        String(effectiveDate.getUTCDate()).padStart(2, '0'),
      ].join('-');
      // Also pre-warm yesterday and tomorrow to cover the 11:00 UTC boundary window.
      const yesterdayStr = new Date(effectiveMs - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const tomorrowStr = new Date(effectiveMs + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      console.log(`[Startup] [GAMES_CACHE] Effective date=${todayStr} (utcHour=${nowUtc.getUTCHours()}, beforeCutoff=${isBeforeCutoff}) — pre-warming MLB:${yesterdayStr}, MLB:${todayStr}, MLB:${tomorrowStr}`);
      Promise.all([
        // MLB: pre-warm today + yesterday + tomorrow (covers the 11:00 UTC boundary window)
        listGames({ sport: 'MLB', gameDate: todayStr }).then(r => console.log(`[Startup] [GAMES_CACHE] MLB:${todayStr} pre-warmed: ${r.length} games`)),
        listGames({ sport: 'MLB', gameDate: yesterdayStr }).then(r => console.log(`[Startup] [GAMES_CACHE] MLB:${yesterdayStr} pre-warmed: ${r.length} games`)),
        listGames({ sport: 'MLB', gameDate: tomorrowStr }).then(r => console.log(`[Startup] [GAMES_CACHE] MLB:${tomorrowStr} pre-warmed: ${r.length} games`)),
        // Non-MLB: no gameDate filter (VSiN-driven, small dataset, rolling window is correct)
        listGames({ sport: 'NHL' }).then(r => console.log(`[Startup] [GAMES_CACHE] NHL pre-warmed: ${r.length} games`)),
        listGames({ sport: 'NBA' }).then(r => console.log(`[Startup] [GAMES_CACHE] NBA pre-warmed: ${r.length} games`)),
        listGames({ sport: 'NCAAM' }).then(r => console.log(`[Startup] [GAMES_CACHE] NCAAM pre-warmed: ${r.length} games`)),
      ]).catch((err: unknown) => console.warn('[Startup] [GAMES_CACHE] Pre-warm failed (non-fatal):', err));
    }, 1000); // 1s after startup — before lineup pre-warm, after DB keep-alive
    console.log('[Startup] [GAMES_CACHE] Games list cache pre-warm scheduled (1s after startup)');

    // ── 11:00 UTC boundary cache invalidation ─────────────────────────────────
    // The feed rolls over to the new day's slate at 11:00 UTC. The games cache
    // and availableDates cache must be invalidated at this exact moment so that
    // clients immediately see the new day's games without waiting for the 60s TTL.
    // We schedule a one-shot invalidation to fire at the next 11:00 UTC boundary.
    const scheduleNextCutoffInvalidation = () => {
      const nowMs = Date.now();
      const nowUtc = new Date(nowMs);
      const CUTOFF_HOUR = 11;
      // Compute ms until next 11:00:00 UTC
      let nextCutoffMs: number;
      if (nowUtc.getUTCHours() < CUTOFF_HOUR) {
        // Before cutoff today — fire at 11:00 UTC today (+5s buffer)
        nextCutoffMs = Date.UTC(
          nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate(),
          CUTOFF_HOUR, 0, 5
        ) - nowMs;
      } else {
        // After cutoff today — fire at 11:00 UTC tomorrow (+5s buffer)
        const tomorrow = new Date(nowMs + 24 * 60 * 60 * 1000);
        nextCutoffMs = Date.UTC(
          tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(),
          CUTOFF_HOUR, 0, 5
        ) - nowMs;
      }
      const nextCutoffDate = new Date(nowMs + nextCutoffMs).toISOString();
      console.log(`[Startup] [CUTOFF_INVALIDATION] Next 11:00 UTC boundary invalidation scheduled in ${Math.round(nextCutoffMs / 60000)}min (at ${nextCutoffDate})`);
      const cutoffTimer = setTimeout(() => {
        console.log('[Scheduler] [CUTOFF_INVALIDATION] 11:00 UTC boundary reached — force-invalidating all caches');
        forceInvalidateGamesCache();
        // Re-warm the cache immediately after invalidation with the new effective date
        const newNowMs = Date.now();
        const newNowUtc = new Date(newNowMs);
        const newIsBeforeCutoff = newNowUtc.getUTCHours() < CUTOFF_HOUR;
        const newEffectiveMs = newIsBeforeCutoff ? newNowMs - 24 * 60 * 60 * 1000 : newNowMs;
        const newTodayStr = new Date(newEffectiveMs).toISOString().slice(0, 10);
        const newYesterdayStr = new Date(newEffectiveMs - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const newTomorrowStr = new Date(newEffectiveMs + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        console.log(`[Scheduler] [CUTOFF_INVALIDATION] Re-warming cache for effectiveDate=${newTodayStr}`);
        Promise.all([
          listGames({ sport: 'MLB', gameDate: newTodayStr }).then(r => console.log(`[Scheduler] [CUTOFF_INVALIDATION] MLB:${newTodayStr} re-warmed: ${r.length} games`)),
          listGames({ sport: 'MLB', gameDate: newYesterdayStr }).then(r => console.log(`[Scheduler] [CUTOFF_INVALIDATION] MLB:${newYesterdayStr} re-warmed: ${r.length} games`)),
          listGames({ sport: 'MLB', gameDate: newTomorrowStr }).then(r => console.log(`[Scheduler] [CUTOFF_INVALIDATION] MLB:${newTomorrowStr} re-warmed: ${r.length} games`)),
          getAvailableDates('MLB').then(r => console.log(`[Scheduler] [CUTOFF_INVALIDATION] MLB availableDates re-warmed: ${r.length} dates`)),
        ]).catch((err: unknown) => console.warn('[Scheduler] [CUTOFF_INVALIDATION] Re-warm failed (non-fatal):', err));
        // Schedule the next day's boundary invalidation
        scheduleNextCutoffInvalidation();
      }, nextCutoffMs);
      cutoffTimer.unref();
    };
    scheduleNextCutoffInvalidation();
  };

  // Host omitted → Node binds dual-stack "::" (IPv6 + IPv4-mapped) when IPv6
  // exists and natively falls back to "0.0.0.0" on any IPv6 handle failure.
  // Railway's edge proxy dials the container over IPv6, so the previous explicit
  // IPv4-only "0.0.0.0" bind made every request 502 at the edge ("connection dial
  // timeout") before it ever reached Express. Fail fast on a bind error so the
  // platform restarts the container instead of leaving a zombie that serves nothing.
  const onBindError = (err: NodeJS.ErrnoException) => {
    console.error(`[SERVER_STARTUP] ✗ Could not bind port ${port} (${err.code ?? "?"}) — exiting so the platform restarts`);
    process.exit(1);
  };
  server.once("error", onBindError);
  server.once("listening", () => {
    server.removeListener("error", onBindError);
    onListening();
  });
  console.log(`[SERVER_STARTUP] Calling server.listen(${port}) — host omitted for dual-stack bind with IPv4 fallback ...`);
  server.listen(port);
}

startServer().catch(console.error);
