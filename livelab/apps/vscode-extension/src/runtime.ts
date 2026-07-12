import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import { RuntimeDiscovery, RuntimeDiscoverySchema, isCompatibleProtocol } from '@livelab/protocol';

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    return (err as { code?: string })?.code === 'EPERM';
  }
}

/** Canonical workspace root: absolute + symlinks resolved (matches the daemon's discovery record). */
function canonicalWorkspaceRoot(candidate: string): string {
  const absolute = path.resolve(candidate);
  try {
    return fs.realpathSync(absolute);
  } catch {
    return absolute;
  }
}

/**
 * Owns the runtime daemon lifecycle for the extension. Attaches to a live
 * compatible runtime when one exists (e.g. started headless by an agent);
 * otherwise spawns the packaged daemon with `shell: false` and Node inherited
 * from the extension host (ELECTRON_RUN_AS_NODE).
 */
export class RuntimeManager implements vscode.Disposable {
  private child: ChildProcess | null = null;
  private discovery: RuntimeDiscovery | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly workspaceRoot: string,
    private readonly output: vscode.OutputChannel,
  ) {}

  get current(): RuntimeDiscovery | null {
    if (this.discovery && pidAlive(this.discovery.pid)) return this.discovery;
    this.discovery = null;
    return null;
  }

  private readDiscovery(): RuntimeDiscovery | null {
    try {
      const file = path.join(this.workspaceRoot, '.livelab', 'runtime.json');
      const parsed = RuntimeDiscoverySchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
      if (!parsed.success) return null;
      if (!pidAlive(parsed.data.pid)) return null;
      if (!isCompatibleProtocol(parsed.data.protocolVersion)) {
        this.output.appendLine(
          `[runtime] found incompatible runtime (protocol ${parsed.data.protocolVersion}); ignoring`,
        );
        return null;
      }
      if (canonicalWorkspaceRoot(parsed.data.workspaceRoot) !== canonicalWorkspaceRoot(this.workspaceRoot)) {
        return null;
      }
      return parsed.data;
    } catch {
      return null;
    }
  }

  daemonPath(): string {
    return this.context.asAbsolutePath(path.join('dist', 'runtime', 'daemon.cjs'));
  }

  async ensure(): Promise<RuntimeDiscovery> {
    const existing = this.current ?? this.readDiscovery();
    if (existing) {
      this.discovery = existing;
      return existing;
    }

    const daemon = this.daemonPath();
    if (!fs.existsSync(daemon)) {
      throw new Error(`Runtime daemon missing at ${daemon} — reinstall LiveLab`);
    }

    const config = vscode.workspace.getConfiguration('livelab');
    const args = [
      daemon,
      '--workspace', this.workspaceRoot,
      '--owner', 'extension',
      '--parent-pid', String(process.pid),
      '--allowed-hosts', (config.get<string[]>('allowedHosts') ?? []).join(','),
      '--managed-scripts', (config.get<string[]>('managedScripts') ?? []).join(','),
      '--redact-headers', (config.get<string[]>('redactHeaders') ?? []).join(','),
      '--redact-query-params', (config.get<string[]>('redactQueryParameters') ?? []).join(','),
      '--console-max', String(config.get<number>('console.maxEntries') ?? 500),
      '--network-max', String(config.get<number>('network.maxEntries') ?? 1000),
      '--max-fps', String(config.get<number>('frameRate') ?? 10),
    ];
    if (vscode.workspace.isTrusted) args.push('--trusted');

    this.output.appendLine(`[runtime] starting daemon: ${daemon}`);
    this.child = spawn(process.execPath, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    this.child.stdout?.on('data', (buf: Buffer) => this.output.append(`[runtime] ${buf.toString()}`));
    this.child.stderr?.on('data', (buf: Buffer) => this.output.append(buf.toString()));
    this.child.on('exit', (code) => {
      this.output.appendLine(`[runtime] daemon exited (${code})`);
      this.child = null;
      this.discovery = null;
    });

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const found = this.readDiscovery();
      if (found) {
        this.discovery = found;
        this.output.appendLine(`[runtime] ready on 127.0.0.1:${found.port} (pid ${found.pid})`);
        return found;
      }
      if (this.child === null) break;
    }
    throw new Error('LiveLab runtime failed to start — see the LiveLab output channel');
  }

  async api<T = unknown>(method: string, apiPath: string, body?: unknown): Promise<T> {
    const disc = await this.ensure();
    const res = await fetch(`http://127.0.0.1:${disc.port}${apiPath}`, {
      method,
      headers: {
        authorization: `Bearer ${disc.token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok) throw new Error(json?.error?.message ?? `runtime ${res.status}`);
    return json;
  }

  async stop(): Promise<void> {
    const disc = this.current;
    if (disc) {
      try {
        await fetch(`http://127.0.0.1:${disc.port}/shutdown`, {
          method: 'POST',
          headers: { authorization: `Bearer ${disc.token}` },
        });
      } catch {}
    }
    // Only kill processes we spawned ourselves; never someone else's runtime.
    if (this.child) {
      const child = this.child;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 4000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        child.kill('SIGTERM');
      });
      this.child = null;
    }
    this.discovery = null;
  }

  dispose(): void {
    // Owned daemon exits on its own via --parent-pid watching, but be explicit.
    void this.stop();
  }
}
