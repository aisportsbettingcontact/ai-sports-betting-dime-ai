import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

/** Local-only HTTP fixture app for integration tests (no external websites). */
export function startFixtureServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const pages: Record<string, string> = {
    '/': `<!doctype html><html><head><title>fixture</title></head><body>
      <main>
        <h1>Fixture home</h1>
        <button id="btn" data-testid="counter" onclick="this.querySelector('span').textContent = String(1 + Number(this.querySelector('span').textContent)); window.__count = Number(this.querySelector('span').textContent)">Count: <span>0</span></button>
        <label for="field">Field</label><input id="field" placeholder="Type here">
        <a href="/second">second</a>
      </main></body></html>`,
    '/second': `<!doctype html><html><body><main><h1>Second page</h1><a href="/">home</a></main></body></html>`,
    '/console-error': `<!doctype html><html><body><main><h1>Errors</h1></main>
      <script>console.error('fixture console error'); console.warn('fixture warning');</script></body></html>`,
    '/page-error': `<!doctype html><html><body><main><h1>Boom</h1></main>
      <script>setTimeout(function(){ throw new Error('fixture uncaught'); }, 10);</script></body></html>`,
    '/network-fail': `<!doctype html><html><body><main><h1>Net</h1></main>
      <script>fetch('/api/missing').catch(function(){});</script></body></html>`,
    '/secret-headers': `<!doctype html><html><body><main><h1>Secrets</h1></main>
      <script>fetch('/api/echo', { headers: { authorization: 'Bearer super-secret-token-123456', 'x-api-key': 'key-abcdef' } });</script></body></html>`,
    '/slow': `<!doctype html><html><body><main><h1>Slow</h1></main>
      <script>setInterval(function(){ fetch('/api/tick').catch(function(){}); }, 200);</script></body></html>`,
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/echo' || url.pathname === '/api/tick') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }
    if (url.pathname === '/api/missing') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"error":"missing"}');
      return;
    }
    const page = pages[url.pathname];
    if (page) {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(page);
    } else {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<h1>404</h1>');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

export function makeTmpWorkspace(prefix = 'livelab-it-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function rmDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

export const REPO_ROOT = path.resolve(__dirname, '..');
