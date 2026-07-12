import { defineConfig } from 'vite';

/** /api/* returns a real 404 (Vite's SPA fallback would otherwise serve index.html). */
const apiStub = {
  name: 'livelab-api-stub',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.startsWith('/api/')) {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end('{"error":"not found"}');
        return;
      }
      next();
    });
  },
};

export default defineConfig({
  plugins: [apiStub],
  server: {
    port: 5199,
    strictPort: true,
    host: '127.0.0.1',
  },
  preview: {
    port: 5199,
    strictPort: true,
    host: '127.0.0.1',
  },
});
