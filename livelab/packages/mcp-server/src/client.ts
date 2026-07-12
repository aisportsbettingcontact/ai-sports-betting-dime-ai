import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ERROR_CODES,
  LiveLabError,
  RuntimeDiscovery,
  RuntimeDiscoverySchema,
  isCompatibleProtocol,
} from '@livelab/protocol';

function log(message: string): void {
  // stdio transport: stdout is protocol-only; diagnostics go to stderr.
  process.stderr.write(`[livelab-mcp] ${message}\n`);
}

function discoveryPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.livelab', 'runtime.json');
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    return (err as { code?: string })?.code === 'EPERM';
  }
}

/** Locate the runtime daemon bundle for headless auto-start. */
export function resolveDaemonPath(): string | null {
  const candidates = [
    process.env.LIVELAB_DAEMON_PATH,
    path.join(__dirname, 'daemon.cjs'), // packaged layout (same dist dir)
    path.join(__dirname, '..', '..', 'runtime', 'dist', 'daemon.cjs'), // workspace layout
  ].filter((c): c is string => !!c);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * HTTP client for the runtime daemon. Discovers the per-workspace runtime,
 * validates protocol compatibility, and can auto-start a headless daemon when
 * VS Code is not running (spec: MCP works headlessly).
 */
export class RuntimeClient {
  private discovery: RuntimeDiscovery | null = null;

  constructor(readonly workspaceRoot: string) {}

  private readDiscovery(): RuntimeDiscovery | null {
    try {
      const raw = JSON.parse(fs.readFileSync(discoveryPath(this.workspaceRoot), 'utf8'));
      const parsed = RuntimeDiscoverySchema.safeParse(raw);
      if (!parsed.success) return null;
      if (!pidAlive(parsed.data.pid)) return null;
      if (!isCompatibleProtocol(parsed.data.protocolVersion)) {
        throw new LiveLabError(
          ERROR_CODES.PROTOCOL_MISMATCH,
          `Runtime speaks protocol ${parsed.data.protocolVersion}; this client requires a compatible major version`,
        );
      }
      // Cross-workspace attachment guard.
      if (path.resolve(parsed.data.workspaceRoot) !== path.resolve(this.workspaceRoot)) return null;
      return parsed.data;
    } catch (err) {
      if (err instanceof LiveLabError) throw err;
      return null;
    }
  }

  async connected(): Promise<boolean> {
    try {
      await this.ensure(false);
      return true;
    } catch {
      return false;
    }
  }

  async ensure(autoStart: boolean): Promise<RuntimeDiscovery> {
    if (this.discovery) {
      if (pidAlive(this.discovery.pid)) return this.discovery;
      this.discovery = null;
    }
    const found = this.readDiscovery();
    if (found) {
      this.discovery = found;
      return found;
    }
    if (!autoStart) {
      throw new LiveLabError(
        ERROR_CODES.RUNTIME_UNAVAILABLE,
        `No LiveLab runtime is serving ${this.workspaceRoot}. Use livelab_start, run "livelab start" in a terminal, or open LiveLab in VS Code.`,
      );
    }
    const daemonPath = resolveDaemonPath();
    if (!daemonPath) {
      throw new LiveLabError(
        ERROR_CODES.RUNTIME_UNAVAILABLE,
        'Runtime daemon bundle not found. Set LIVELAB_DAEMON_PATH or reinstall LiveLab.',
      );
    }
    log(`starting headless runtime: ${daemonPath}`);
    const child = spawn(process.execPath, [daemonPath, '--workspace', this.workspaceRoot, '--owner', 'headless', '--trusted'], {
      detached: true,
      stdio: 'ignore',
      shell: false,
    });
    child.unref();

    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 300));
      const disc = this.readDiscovery();
      if (disc) {
        // Confirm it answers.
        try {
          const res = await fetch(`http://127.0.0.1:${disc.port}/health`);
          if (res.ok) {
            this.discovery = disc;
            return disc;
          }
        } catch {}
      }
    }
    throw new LiveLabError(ERROR_CODES.RUNTIME_UNAVAILABLE, 'Headless runtime failed to start within 20s');
  }

  async request<T = unknown>(
    method: 'GET' | 'POST' | 'DELETE',
    pathname: string,
    body?: unknown,
    autoStart = false,
  ): Promise<T> {
    const disc = await this.ensure(autoStart);
    let res: Response;
    try {
      res = await fetch(`http://127.0.0.1:${disc.port}${pathname}`, {
        method,
        headers: {
          authorization: `Bearer ${disc.token}`,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      this.discovery = null;
      throw new LiveLabError(
        ERROR_CODES.RUNTIME_UNAVAILABLE,
        `Runtime did not respond (${String(err)}). It may have stopped; retry or use livelab_start.`,
      );
    }
    const text = await res.text();
    let json: unknown = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new LiveLabError(ERROR_CODES.INTERNAL, `Runtime returned non-JSON (${res.status})`);
    }
    if (!res.ok) {
      const errShape = (json as { error?: { code?: string; message?: string; kind?: string; details?: unknown } }).error;
      throw new LiveLabError(
        (errShape?.code as never) ?? ERROR_CODES.INTERNAL,
        errShape?.message ?? `Runtime error ${res.status}`,
        errShape?.details,
      );
    }
    return json as T;
  }

  async fetchArtifact(artifactId: string): Promise<{ contentType: string; data: Buffer }> {
    const disc = await this.ensure(false);
    const res = await fetch(`http://127.0.0.1:${disc.port}/artifacts/${artifactId}/content`, {
      headers: { authorization: `Bearer ${disc.token}` },
    });
    if (!res.ok) {
      throw new LiveLabError(ERROR_CODES.ARTIFACT_NOT_FOUND, `Artifact content unavailable (${res.status})`);
    }
    return {
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
      data: Buffer.from(await res.arrayBuffer()),
    };
  }
}
