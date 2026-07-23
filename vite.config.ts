import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss(), jsxLocPlugin()],
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
    allowedHosts: ["localhost", "127.0.0.1"],
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
