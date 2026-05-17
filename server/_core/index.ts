import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import compression from "compression";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import helmet from "helmet";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerDiscordAuthRoutes } from "../discordAuth";
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
import { getCircuitStatus, getCacheStats } from "../dbCircuitBreaker";
import { getDb, listGames, getCacheHealthStats } from "../db";
import { registerRgProxyRoute } from "../rotogrinderProxy";

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
  limitType: "global" | "auth" | "trpc_auth",
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

process.on("uncaughtException", (err) => {
  console.error("[CRASH GUARD] Uncaught exception — server will continue:", err);
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
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  // ─── www → non-www canonical redirect (308) ─────────────────────────────
  // Cloudflare's www redirect uses 301 (which converts POST→GET per HTTP spec),
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
  app.use(compression({ threshold: 512 }));

  // Trust the first proxy (Cloudflare / Manus edge) so req.protocol reflects
  // the original HTTPS scheme and cookies are set correctly (sameSite+secure).
  // Also required for express-rate-limit to read the real client IP from
  // X-Forwarded-For rather than the proxy IP.
  app.set('trust proxy', 1);

  // ─── Security headers (helmet) ────────────────────────────────────────────
  // Sets X-Content-Type-Options, X-Frame-Options, X-XSS-Protection,
  // Strict-Transport-Security, Referrer-Policy, and a Content-Security-Policy
  // that allows our own origin + CDN assets. Vite HMR websocket is allowed in dev.
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // unsafe-eval needed for Vite HMR in dev
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
        connectSrc: ["'self'", "wss:", "ws:", "https:"],
        frameSrc: ["'self'"], // Allow same-origin iframes (Rotogrinders proxy)
        objectSrc: ["'none'"],
        upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false, // Allow embedding external resources (logos, CDN)
  }));

  // ─── Body parser with tight size limits ──────────────────────────────────
  // 10kb for JSON API calls (tRPC procedures never need more than a few KB).
  // 1mb for URL-encoded forms. The previous 50mb limit was a DoS vector.
  // Note: file upload procedures use base64 strings — if needed, raise to 2mb max.
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ limit: "1mb", extended: true }));

  // ─── Health check endpoint ────────────────────────────────────────────────
  // Lightweight endpoint for load balancer health probes and uptime monitoring.
  // Returns 200 immediately without hitting the DB so it never times out.
  app.get("/health", (_req, res) => {
    const circuit = getCircuitStatus();
    const dbOk = circuit.state === 'CLOSED';
    res.status(dbOk ? 200 : 503).json({
      status: dbOk ? 'ok' : 'degraded',
      ts: Date.now(),
      db: { state: circuit.state, consecutiveFailures: circuit.consecutiveFailures },
    });
  });

  // ─── DB status endpoint ───────────────────────────────────────────────────
  // Detailed circuit breaker + user cache stats for operational monitoring.
  app.get("/api/db-status", (_req, res) => {
    const circuit = getCircuitStatus();
    const cache = getCacheStats();
    res.json({
      ts: Date.now(),
      circuit,
      userCache: cache,
    });
  });
  // ─── Performance health endpoint ──────────────────────────────────────────
  // Real-time cache hit rates, invalidation timing, and DB pool stats.
  // Use this to verify the debounced invalidation and memo optimizations are working.
  app.get("/api/perf", (_req, res) => {
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

  // ─── Global API rate limiter ──────────────────────────────────────────────
  // Applied to all /api/* routes. Skips /health (handled above).
  app.use("/api", globalApiLimiter);

  // ─── Auth-specific rate limiters ─────────────────────────────────────────
  // Manus OAuth callback — 5 attempts per 15 min per IP
  app.use("/api/oauth", authLimiter);

  // Discord OAuth routes — 5 attempts per 15 min per IP
  app.use("/api/discord-auth", authLimiter);

  // tRPC login mutation — 5 attempts per 15 min per IP
  // Matches both batch (?batch=1) and direct calls to appUsers.login
  app.use("/api/trpc/appUsers.login", trpcAuthLimiter);
  app.use("/api/trpc/auth.login", trpcAuthLimiter);

  // ─── Request timeout middleware ───────────────────────────────────────────
  // Kill requests that take > 25s to prevent hanging connections from exhausting
  // the server's connection pool under load.
  //
  // CRITICAL: For tRPC batch requests (/api/trpc/*), return a tRPC-formatted
  // error envelope (HTTP 200 + error JSON array) so the client can parse it as
  // a proper TRPCClientError. Returning a raw 503 with {error:".."} causes the
  // tRPC client to throw a JSON parse error, which the frontend maps to the
  // generic "Server temporarily unavailable" toast instead of a specific message.
  app.use((req, res, next) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        const isTrpc = req.path.startsWith('/api/trpc');
        console.error(`[TIMEOUT] Request timed out: ${req.method} ${req.path} isTrpc=${isTrpc}`);
        if (isTrpc) {
          // tRPC batch envelope: HTTP 200 with error in the result array
          // The client will receive a TRPCClientError with code INTERNAL_SERVER_ERROR
          res.status(200).json([{
            error: {
              json: {
                message: 'Request timed out. Please try again in a moment.',
                code: -32603,
                data: {
                  code: 'INTERNAL_SERVER_ERROR',
                  httpStatus: 503,
                  path: req.path.replace('/api/trpc/', ''),
                },
              },
            },
          }]);
        } else {
          res.status(503).json({ error: 'Request timeout' });
        }
      }
    }, 60_000);  // 60s: accommodates TiDB cold-start + retryOnce
    // Worst case with cold-start retry:
    //   Attempt 1: read(8s) + parallel_check(8s) + bcrypt(0.11s) + write(8s) = 24.11s [transient fail]
    //   retryOnce delay: 3s
    //   Attempt 2: read(8s) + parallel_check(8s) + bcrypt(0.11s) + write(8s) = 24.11s [success - TiDB warm]
    //   Total: 51.22s << 60s timeout
    // Normal case (TiDB warm): 24.11s << 60s timeout
    // The keep-alive ping (every 4 min) prevents cold starts in practice;
    // this 60s timeout is the last-resort safety net for edge cases.
    res.on('finish', () => clearTimeout(timeout));
    res.on('close', () => clearTimeout(timeout));
    next();
  });

  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // Discord account linking routes
  registerDiscordAuthRoutes(app);
  // Rotogrinders server-side proxy — restricted to @prez and @lucianobets
  registerRgProxyRoute(app);

  // tRPC API
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

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
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
    // Security digest — daily at 08:00 EST (13:00 UTC), sends 24h threat summary via notifyOwner()
    startSecurityDigestScheduler();
    // Weekly security threat trend digest — every Sunday at 08:00 EST, 7-day bar chart + top IPs
    startWeeklySecurityDigestScheduler();
    // OddsHistory lineSource backfill — sets lineSource on historical rows where it is NULL
    // Uses game.oddsSource as ground truth. Runs once at startup, no-ops if all rows already set.
    import('../db').then(({ backfillOddsHistoryLineSource }) => {
      backfillOddsHistoryLineSource()
        .catch((err: unknown) => console.warn('[Startup] [OddsHistory][BACKFILL] lineSource backfill failed (non-fatal):', err));
    }).catch((err: unknown) => console.warn('[Startup] [OddsHistory][BACKFILL] Import failed (non-fatal):', err));
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

    // K-Props MLBAM ID startup backfill — resolves all historical rows missing pitcher headshot IDs
    // Runs once on server start, non-fatal, no-ops if all rows already resolved
    import('../mlbKPropsModelService').then(({ backfillAllKPropsMlbamIds }) => {
      backfillAllKPropsMlbamIds()
        .then((r: { resolved: number; alreadyHad: number; unresolved: number; errors: number }) =>
          console.log(`[Startup] [MLBAM_BACKFILL] K-Props: resolved=${r.resolved} alreadyHad=${r.alreadyHad} unresolved=${r.unresolved} errors=${r.errors}`)
        )
        .catch((err: unknown) => console.warn('[Startup] [MLBAM_BACKFILL] K-Props startup backfill failed (non-fatal):', err));
    }).catch((err: unknown) => console.warn('[Startup] [MLBAM_BACKFILL] Import failed (non-fatal):', err));

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

    // ── Lineup cache pre-warm ───────────────────────────────────────────────
    // Pre-fetch MLB lineups at startup so the first LINEUPS tab load is instant.
    // Refreshes every 30 minutes to keep the cache warm throughout the day.
    // Non-fatal: if the MLB Stats API is down, the cache stays empty and the
    // next user request will trigger a live fetch.
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
  });
}

startServer().catch(console.error);
