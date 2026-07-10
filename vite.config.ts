import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";

// =============================================================================
// Manus Debug Collector - Vite Plugin
// Writes browser logs directly to files, trimmed when exceeding size limit
// =============================================================================

const PROJECT_ROOT = import.meta.dirname;
const LOG_DIR = path.join(PROJECT_ROOT, ".manus-logs");
const MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024; // 1MB per log file
const TRIM_TARGET_BYTES = Math.floor(MAX_LOG_SIZE_BYTES * 0.6); // Trim to 60% to avoid constant re-trimming

type LogSource = "browserConsole" | "networkRequests" | "sessionReplay";

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function trimLogFile(logPath: string, maxSize: number) {
  try {
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size <= maxSize) {
      return;
    }

    const lines = fs.readFileSync(logPath, "utf-8").split("\n");
    const keptLines: string[] = [];
    let keptBytes = 0;

    // Keep newest lines (from end) that fit within 60% of maxSize
    const targetSize = TRIM_TARGET_BYTES;
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineBytes = Buffer.byteLength(`${lines[i]}\n`, "utf-8");
      if (keptBytes + lineBytes > targetSize) break;
      keptLines.unshift(lines[i]);
      keptBytes += lineBytes;
    }

    fs.writeFileSync(logPath, keptLines.join("\n"), "utf-8");
  } catch {
    /* ignore trim errors */
  }
}

function writeToLogFile(source: LogSource, entries: unknown[]) {
  if (entries.length === 0) return;

  ensureLogDir();
  const logPath = path.join(LOG_DIR, `${source}.log`);

  // Format entries with timestamps
  const lines = entries.map((entry) => {
    const ts = new Date().toISOString();
    return `[${ts}] ${JSON.stringify(entry)}`;
  });

  // Append to log file
  fs.appendFileSync(logPath, `${lines.join("\n")}\n`, "utf-8");

  // Trim if exceeds max size
  trimLogFile(logPath, MAX_LOG_SIZE_BYTES);
}

/**
 * Vite plugin to collect browser debug logs
 * - POST /__manus__/logs: Browser sends logs, written directly to files
 * - Files: browserConsole.log, networkRequests.log, sessionReplay.log
 * - Auto-trimmed when exceeding 1MB (keeps newest entries)
 */
function vitePluginManusDebugCollector(): Plugin {
  return {
    name: "manus-debug-collector",

    transformIndexHtml(html) {
      if (process.env.NODE_ENV === "production") {
        return html;
      }
      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: {
              src: "/__manus__/debug-collector.js",
              defer: true,
            },
            injectTo: "head",
          },
        ],
      };
    },

    configureServer(server: ViteDevServer) {
      // POST /__manus__/logs: Browser sends logs (written directly to files)
      server.middlewares.use("/__manus__/logs", (req, res, next) => {
        if (req.method !== "POST") {
          return next();
        }

        const handlePayload = (payload: any) => {
          // Write logs directly to files
          if (payload.consoleLogs?.length > 0) {
            writeToLogFile("browserConsole", payload.consoleLogs);
          }
          if (payload.networkRequests?.length > 0) {
            writeToLogFile("networkRequests", payload.networkRequests);
          }
          if (payload.sessionEvents?.length > 0) {
            writeToLogFile("sessionReplay", payload.sessionEvents);
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        };

        const reqBody = (req as { body?: unknown }).body;
        if (reqBody && typeof reqBody === "object") {
          try {
            handlePayload(reqBody);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
          return;
        }

        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });

        req.on("end", () => {
          try {
            const payload = JSON.parse(body);
            handlePayload(payload);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
        });
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  // The Manus previewer runtime + debug collector serve the Manus editor's dev
  // preview (postMessage bridge, element selector, log collector). Baked into a
  // production build they inline ~367KB of dead script into every HTML response
  // (measured on the Railway/Vercel deploys, 2026-07-10) — so they are dev-server
  // only. `command` is "serve" for the dev server, "build" for production builds.
  plugins:
    command === "serve"
      ? [react(), tailwindcss(), jsxLocPlugin(), vitePluginManusRuntime(), vitePluginManusDebugCollector()]
      : [react(), tailwindcss(), jsxLocPlugin()],
  optimizeDeps: {
    include: ["html2canvas"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // chunkSizeWarningLimit — vendor chunks are intentionally large
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // ── PERFORMANCE ARCHITECTURE ───────────────────────────────────────────────────────────────────────────────
          // Critical path (loaded immediately):
          //   vendor-react (386KB) + vendor-trpc (98KB) = 484KB gzip ~145KB
          //   These are the ONLY chunks that block first render.
          //
          // Deferred path (loaded after route resolves):
          //   vendor-radix, vendor-motion, recharts, mlb-panels, analytics
          //   These are only needed AFTER the user is authenticated and on a page.
          // ────────────────────────────────────────────────────────────────────────────────

          // ── Vendor: React core — always needed, cache-stable ──────────────
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'vendor-react';
          }
          // ── Vendor: tRPC + React Query — always needed for auth ────────────
          if (
            id.includes('@trpc/') ||
            id.includes('@tanstack/react-query') ||
            id.includes('superjson')
          ) {
            return 'vendor-trpc';
          }
          // ── Recharts — 406KB, only used in admin pages + BetTracker ─────────
          // Isolated so it does NOT pull into the main feed bundle.
          if (id.includes('recharts') || id.includes('node_modules/recharts')) {
            return 'vendor-recharts';
          }
          // ── Vendor: Framer Motion — only needed after route loads ──────────
          if (id.includes('framer-motion')) {
            return 'vendor-motion';
          }
          // ── Vendor: Radix UI + shadcn — UI primitives ─────────────────────
          if (id.includes('@radix-ui/')) {
            return 'vendor-radix';
          }
          // ── MLB-specific panels — only loaded when user is on MLB tab ─────
          if (
            id.includes('MlbLineupCard') ||
            id.includes('MlbPropsCard') ||
            id.includes('MlbHrPropsCard') ||
            id.includes('MlbF5NrfiCard') ||
            id.includes('MlbLast5Panel')
          ) {
            return 'mlb-panels';
          }
          // ── Vendor: sonner + wouter — used by App.tsx critical path ──────────────
          // These are tiny libs that must be in a stable, named chunk so they
          // don't get merged into a large shared chunk that also contains
          // page-level code (which would pull that page into the critical path).
          if (id.includes('node_modules/sonner') || id.includes('node_modules/wouter')) {
            return 'vendor-ui';
          }
          // NOTE: pages/ModelResults and pages/SecurityEvents are NOT assigned here.
          // Vite will auto-split them into their own chunks, keeping shared code
          // (sonner, wouter) in vendor-ui and page code in page-specific chunks.
          // This prevents shared code from being merged into a large 'analytics'
          // chunk that gets pulled into the critical path.
        },
      },
    },
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1",
    ],
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
}));
