import { spawn, ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import {
  DetectedServer,
  ERROR_CODES,
  Framework,
  LiveLabError,
  RunScriptResult,
  ServerStatus,
} from '@livelab/protocol';
import { assertScriptAllowed, assertUrlAllowed } from '../security/allowlist';
import { resolveInside } from '../util/paths';
import { Logger } from '../util/logger';

const FRAMEWORK_HINTS: Array<{ dep: string; framework: Framework; port: number }> = [
  { dep: 'next', framework: 'nextjs', port: 3000 },
  { dep: 'astro', framework: 'astro', port: 4321 },
  { dep: '@remix-run/dev', framework: 'remix', port: 3000 },
  { dep: 'nuxt', framework: 'nuxt', port: 3000 },
  { dep: '@sveltejs/kit', framework: 'sveltekit', port: 5173 },
  { dep: 'vite', framework: 'vite', port: 5173 },
];

const URL_IN_OUTPUT = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{2,5})?[^\s"']*/i;
const MAX_LOG_LINES = 400;

/**
 * Development-server detection and control. Only allowlisted npm scripts run,
 * always with shell:false, and only for processes LiveLab launched itself —
 * unrelated terminals are never monitored.
 */
export class DevServerManager {
  private child: ChildProcess | null = null;
  private state: ServerStatus['state'] = 'stopped';
  private framework: Framework | undefined;
  private script: string | undefined;
  private url: string | undefined;
  private startedAt: number | undefined;
  private exitCode: number | null | undefined;
  private logTail: string[] = [];

  constructor(
    private readonly workspaceRoot: string,
    private readonly managedScripts: () => string[],
    private readonly allowedHosts: () => string[],
    private readonly log: Logger,
  ) {}

  /** Detect candidate dev servers in the workspace (root + common subdirs with package.json). */
  detect(): DetectedServer[] {
    const results: DetectedServer[] = [];
    const candidates = [this.workspaceRoot];
    for (const sub of fs.readdirSync(this.workspaceRoot, { withFileTypes: true })) {
      if (!sub.isDirectory() || sub.name.startsWith('.') || sub.name === 'node_modules') continue;
      if (fs.existsSync(path.join(this.workspaceRoot, sub.name, 'package.json'))) {
        candidates.push(path.join(this.workspaceRoot, sub.name));
      }
      // one more level for monorepos (packages/*, apps/*)
      if (['packages', 'apps'].includes(sub.name)) {
        const nested = path.join(this.workspaceRoot, sub.name);
        for (const inner of fs.readdirSync(nested, { withFileTypes: true })) {
          if (inner.isDirectory() && fs.existsSync(path.join(nested, inner.name, 'package.json'))) {
            candidates.push(path.join(nested, inner.name));
          }
        }
      }
    }
    for (const dir of candidates.slice(0, 30)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        const deps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };
        const scripts: Record<string, string> = pkg.scripts ?? {};
        const hint = FRAMEWORK_HINTS.find((h) => deps[h.dep]);
        const framework: Framework = hint?.framework ?? 'generic';
        for (const scriptName of ['dev', 'start']) {
          if (scripts[scriptName]) {
            results.push({
              framework,
              script: scriptName,
              command: scripts[scriptName]!,
              defaultUrl: `http://localhost:${hint?.port ?? 3000}`,
              packageDir: path.relative(this.workspaceRoot, dir) || '.',
            });
            break;
          }
        }
      } catch {}
    }
    return results;
  }

  private npmBinary(): string {
    return process.platform === 'win32' ? 'npm.cmd' : 'npm';
  }

  private pushLog(line: string): void {
    for (const rawPiece of line.split(/\r?\n/)) {
      // Strip ANSI escapes — Vite/Next embed color codes inside printed URLs.
      // eslint-disable-next-line no-control-regex
      const piece = rawPiece.replace(/\u001b\[[0-9;]*m/g, '');
      if (!piece.trim()) continue;
      this.logTail.push(piece.slice(0, 500));
      if (this.logTail.length > MAX_LOG_LINES) this.logTail.shift();
      if (!this.url) {
        const match = piece.match(URL_IN_OUTPUT);
        if (match) this.url = match[0].replace(/\/$/, '');
      }
    }
  }

  async start(args: { script: string; packageDir?: string; readyTimeoutMs: number; expectedUrl?: string }): Promise<ServerStatus> {
    if (this.child) {
      throw new LiveLabError(ERROR_CODES.INVALID_INPUT, `A managed server is already ${this.state}; stop it first`);
    }
    assertScriptAllowed(args.script, this.managedScripts());
    const cwd = args.packageDir
      ? resolveInside(this.workspaceRoot, args.packageDir)
      : this.workspaceRoot;
    if (!fs.existsSync(path.join(cwd, 'package.json'))) {
      throw new LiveLabError(ERROR_CODES.INVALID_INPUT, `No package.json in ${cwd}`);
    }

    this.state = 'starting';
    this.script = args.script;
    this.url = args.expectedUrl;
    this.logTail = [];
    this.exitCode = undefined;
    const detected = this.detect().find((d) => (args.packageDir ?? '.') === d.packageDir);
    this.framework = detected?.framework;

    this.log.info(`Starting dev server: npm run ${args.script} (cwd=${cwd})`);
    // shell:false — the script name was allowlist-validated; no shell text is ever executed.
    this.child = spawn(this.npmBinary(), ['run', args.script], {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', BROWSER: 'none' },
      detached: process.platform !== 'win32',
    });
    this.startedAt = Date.now();
    this.child.stdout?.on('data', (buf: Buffer) => this.pushLog(buf.toString()));
    this.child.stderr?.on('data', (buf: Buffer) => this.pushLog(buf.toString()));
    this.child.on('exit', (code) => {
      this.exitCode = code;
      this.state = code === 0 || this.state === 'stopped' ? 'stopped' : 'failed';
      this.child = null;
      this.log.info(`Dev server exited with code ${code}`);
    });

    // Wait for the URL to become reachable.
    const deadline = Date.now() + args.readyTimeoutMs;
    while (Date.now() < deadline) {
      if (this.exitCode !== undefined && this.exitCode !== null && this.exitCode !== 0) {
        this.state = 'failed';
        throw new LiveLabError(
          ERROR_CODES.DEV_SERVER_FAILED,
          `Dev server exited (code ${this.exitCode}) before becoming ready`,
          { logTail: this.logTail.slice(-30) },
        );
      }
      const candidate = this.url ?? args.expectedUrl ?? detected?.defaultUrl;
      if (candidate && (await this.reachable(candidate))) {
        this.url = candidate;
        this.state = 'running';
        return this.status();
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    this.state = 'failed';
    throw new LiveLabError(ERROR_CODES.DEV_SERVER_FAILED, `Dev server did not become ready in ${args.readyTimeoutMs}ms`, {
      logTail: this.logTail.slice(-30),
    });
  }

  /** Attach-only mode: verify a URL is reachable; never touch the process serving it. */
  async attach(rawUrl: string): Promise<ServerStatus> {
    const url = assertUrlAllowed(rawUrl, this.allowedHosts());
    if (!(await this.reachable(url.toString()))) {
      throw new LiveLabError(ERROR_CODES.DEV_SERVER_FAILED, `URL not reachable: ${url}`);
    }
    if (!this.child) {
      this.state = 'attached';
      this.url = url.toString().replace(/\/$/, '');
      this.startedAt = Date.now();
    }
    return this.status();
  }

  async stop(): Promise<ServerStatus> {
    if (this.child) {
      this.state = 'stopped';
      const child = this.child;
      try {
        if (process.platform !== 'win32' && child.pid) {
          process.kill(-child.pid, 'SIGTERM'); // process group
        } else {
          child.kill('SIGTERM');
        }
      } catch {}
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          try {
            if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
            else child.kill('SIGKILL');
          } catch {}
          resolve();
        }, 5000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      this.child = null;
    } else {
      this.state = 'stopped';
    }
    this.url = undefined;
    return this.status();
  }

  status(): ServerStatus {
    return {
      state: this.state,
      framework: this.framework,
      script: this.script,
      url: this.url,
      pid: this.child?.pid,
      startedAt: this.startedAt,
      exitCode: this.exitCode ?? null,
      logTail: this.logTail.slice(-50),
    };
  }

  currentUrl(): string | undefined {
    return this.url;
  }

  private reachable(rawUrl: string): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const req = http.get(rawUrl, { timeout: 3000 }, (res) => {
          res.resume();
          resolve((res.statusCode ?? 600) < 600);
        });
        req.on('timeout', () => {
          req.destroy();
          resolve(false);
        });
        req.on('error', () => resolve(false));
      } catch {
        resolve(false);
      }
    });
  }

  /** Run an allowlisted script to completion (tests, lint, typecheck, user Playwright suites). */
  async runScript(args: { script: string; packageDir?: string; timeoutMs: number }): Promise<RunScriptResult> {
    assertScriptAllowed(args.script, this.managedScripts());
    const cwd = args.packageDir ? resolveInside(this.workspaceRoot, args.packageDir) : this.workspaceRoot;
    const started = Date.now();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const push = (arr: string[], data: Buffer) => {
      for (const line of data.toString().split(/\r?\n/)) {
        if (!line.trim()) continue;
        arr.push(line.slice(0, 500));
        if (arr.length > MAX_LOG_LINES) arr.shift();
      }
    };
    return new Promise((resolve) => {
      const child = spawn(this.npmBinary(), ['run', args.script], {
        cwd,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
      });
      let finished = false;
      const timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        child.kill('SIGKILL');
        resolve({
          script: args.script,
          exitCode: null,
          timedOut: true,
          durationMs: Date.now() - started,
          stdoutTail: stdout.slice(-60),
          stderrTail: stderr.slice(-60),
        });
      }, args.timeoutMs);
      child.stdout?.on('data', (d: Buffer) => push(stdout, d));
      child.stderr?.on('data', (d: Buffer) => push(stderr, d));
      child.on('exit', (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve({
          script: args.script,
          exitCode: code,
          timedOut: false,
          durationMs: Date.now() - started,
          stdoutTail: stdout.slice(-60),
          stderrTail: stderr.slice(-60),
        });
      });
      child.on('error', (err) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        stderr.push(String(err));
        resolve({
          script: args.script,
          exitCode: null,
          timedOut: false,
          durationMs: Date.now() - started,
          stdoutTail: stdout.slice(-60),
          stderrTail: stderr.slice(-60),
        });
      });
    });
  }
}
