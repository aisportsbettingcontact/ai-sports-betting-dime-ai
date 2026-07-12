import * as http from 'node:http';
import * as path from 'node:path';
import {
  DEFAULT_ALLOWED_HOSTS,
  DEFAULT_MANAGED_SCRIPTS,
  DEFAULT_REDACT_HEADERS,
  DEFAULT_REDACT_QUERY_PARAMS,
  PROTOCOL_VERSION,
} from '@livelab/protocol';
import { RuntimeCore, RUNTIME_VERSION } from './core';
import { createHttpHandler } from './api/http';
import { attachWebSocket } from './api/ws';
import { acquireLock, pidAlive, readDiscovery, removeDiscovery, writeDiscovery } from './discovery';
import { resolveRuntimeOptions } from './config';
import { canonicalWorkspaceRoot } from './util/paths';
import { newToken, workspaceIdFor } from './util/ids';
import { Logger } from './util/logger';

export interface DaemonArgs {
  workspaceRoot: string;
  owner: 'extension' | 'headless';
  workspaceTrusted: boolean;
  parentPid?: number;
  port?: number;
  allowedHosts?: string[];
  managedScripts?: string[];
  redactHeaders?: string[];
  redactQueryParameters?: string[];
  consoleMaxEntries?: number;
  networkMaxEntries?: number;
  maxFrameRate?: number;
  jsonLogs?: boolean;
}

export interface RunningDaemon {
  core: RuntimeCore;
  port: number;
  token: string;
  close: () => Promise<void>;
}

/**
 * Start the runtime daemon: acquire the per-workspace lock, bind the API to
 * 127.0.0.1 with a random bearer token, write the discovery record, and wire
 * lifecycle cleanup (signals, orphan detection, heartbeat).
 */
export async function startDaemon(args: DaemonArgs): Promise<RunningDaemon> {
  const workspaceRoot = canonicalWorkspaceRoot(args.workspaceRoot);
  const log = new Logger(
    { workspaceId: workspaceIdFor(workspaceRoot) },
    args.jsonLogs === false ? undefined : path.join(workspaceRoot, '.livelab', 'logs'),
  );

  // One compatible runtime per workspace.
  const existing = readDiscovery(workspaceRoot);
  if (existing) {
    throw new Error(
      `A LiveLab runtime (pid ${existing.pid}, ${existing.owner}) is already serving this workspace on port ${existing.port}. ` +
        `Attach to it instead, or stop it first.`,
    );
  }
  const releaseLock = acquireLock(workspaceRoot);
  if (!releaseLock) {
    throw new Error('Could not acquire the workspace runtime lock (another runtime is starting).');
  }

  const token = newToken();
  const core = new RuntimeCore({
    options: resolveRuntimeOptions({
      workspaceRoot,
      allowedHosts: args.allowedHosts ?? DEFAULT_ALLOWED_HOSTS,
      managedScripts: args.managedScripts ?? DEFAULT_MANAGED_SCRIPTS,
      redactHeaders: args.redactHeaders ?? DEFAULT_REDACT_HEADERS,
      redactQueryParameters: args.redactQueryParameters ?? DEFAULT_REDACT_QUERY_PARAMS,
      consoleMaxEntries: args.consoleMaxEntries,
      networkMaxEntries: args.networkMaxEntries,
      maxFrameRate: args.maxFrameRate,
    }),
    token,
    owner: args.owner,
    workspaceTrusted: args.workspaceTrusted,
    log,
  });

  const server = http.createServer((req, res) => void createHttpHandler(core)(req, res));
  attachWebSocket(server, core);

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    // 127.0.0.1 only — never 0.0.0.0.
    server.listen(args.port ?? 0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });

  writeDiscovery({
    protocolVersion: PROTOCOL_VERSION,
    runtimeVersion: RUNTIME_VERSION,
    runtimeId: core.runtimeId,
    workspaceId: core.workspaceId,
    workspaceRoot,
    pid: process.pid,
    host: '127.0.0.1',
    port,
    token,
    startedAt: core.startedAt,
    owner: args.owner,
  });
  log.info(`LiveLab runtime ${RUNTIME_VERSION} listening on 127.0.0.1:${port} (owner: ${args.owner})`);

  let heartbeat: NodeJS.Timeout | null = null;
  let orphanWatch: NodeJS.Timeout | null = null;

  const close = async () => {
    if (heartbeat) clearInterval(heartbeat);
    if (orphanWatch) clearInterval(orphanWatch);
    await core.shutdown('daemon close');
    await new Promise<void>((resolve) => server.close(() => resolve()));
    removeDiscovery(workspaceRoot);
    releaseLock();
  };
  core.onShutdown(() => {
    removeDiscovery(workspaceRoot);
    releaseLock();
    if (heartbeat) clearInterval(heartbeat);
    if (orphanWatch) clearInterval(orphanWatch);
    server.close();
  });

  // Heartbeat: refresh the discovery record so clients can spot a live runtime.
  heartbeat = setInterval(() => {
    try {
      writeDiscovery({
        protocolVersion: PROTOCOL_VERSION,
        runtimeVersion: RUNTIME_VERSION,
        runtimeId: core.runtimeId,
        workspaceId: core.workspaceId,
        workspaceRoot,
        pid: process.pid,
        host: '127.0.0.1',
        port,
        token,
        startedAt: core.startedAt,
        owner: args.owner,
      });
    } catch {}
  }, 15_000);
  heartbeat.unref();

  // Orphan safety: if the owning process disappears, shut down cleanly.
  if (args.parentPid) {
    orphanWatch = setInterval(() => {
      if (!pidAlive(args.parentPid!)) {
        log.warn(`Parent process ${args.parentPid} is gone; shutting down orphaned runtime`);
        void close().then(() => process.exit(0));
      }
    }, 5_000);
    orphanWatch.unref();
  }

  return { core, port, token, close };
}

/** CLI entry: `node daemon.cjs --workspace <dir> [--owner extension|headless] …` */
export async function daemonMain(argv: string[]): Promise<void> {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };
  const getList = (flag: string): string[] | undefined => get(flag)?.split(',').filter(Boolean);

  const workspaceRoot = get('--workspace') ?? process.cwd();
  const daemon = await startDaemon({
    workspaceRoot,
    owner: (get('--owner') as 'extension' | 'headless') ?? 'headless',
    workspaceTrusted: argv.includes('--trusted'),
    parentPid: get('--parent-pid') ? Number(get('--parent-pid')) : undefined,
    port: get('--port') ? Number(get('--port')) : undefined,
    allowedHosts: getList('--allowed-hosts'),
    managedScripts: getList('--managed-scripts'),
    redactHeaders: getList('--redact-headers'),
    redactQueryParameters: getList('--redact-query-params'),
    consoleMaxEntries: get('--console-max') ? Number(get('--console-max')) : undefined,
    networkMaxEntries: get('--network-max') ? Number(get('--network-max')) : undefined,
    maxFrameRate: get('--max-fps') ? Number(get('--max-fps')) : undefined,
  });

  // Structured readiness line for parents that spawned us (stdout, single line).
  process.stdout.write(
    JSON.stringify({ event: 'ready', port: daemon.port, pid: process.pid, runtimeId: daemon.core.runtimeId }) + '\n',
  );

  const stop = (signal: string) => {
    void daemon.close().then(() => {
      process.stderr.write(`[livelab] stopped (${signal})\n`);
      process.exit(0);
    });
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('uncaughtException', (err) => {
    process.stderr.write(`[livelab] uncaught: ${err.stack ?? err}\n`);
    void daemon.close().then(() => process.exit(1));
  });
}
