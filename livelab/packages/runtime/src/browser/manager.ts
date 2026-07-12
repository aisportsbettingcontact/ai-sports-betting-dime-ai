import * as path from 'node:path';
import {
  CreateSessionRequest,
  DeviceConfig,
  DeviceConfigSchema,
  ERROR_CODES,
  InputEvent,
  LiveLabError,
  Locator,
  RuntimeEvent,
  RuntimeOptions,
  SessionInfo,
  findDevicePreset,
  WorkspaceConfig,
} from '@livelab/protocol';
import { EngineManager } from './engines';
import { DeviceSession } from './session';
import { assertUrlAllowed } from '../security/allowlist';
import { resolveInside } from '../util/paths';
import { Logger } from '../util/logger';

export interface SyncState {
  navigation: boolean;
  scroll: boolean;
  interaction: boolean;
}

/**
 * Owns every device session, cross-session synchronization, and the shared
 * engine manager. All URL policy enforcement happens here.
 */
export class SessionManager {
  readonly engines: EngineManager;
  private readonly sessions = new Map<string, DeviceSession>();
  private eventListeners = new Set<(event: RuntimeEvent) => void>();
  readonly sync: SyncState = { navigation: true, scroll: false, interaction: false };
  private syncInProgress = false;

  constructor(
    private readonly options: RuntimeOptions,
    private workspaceConfig: WorkspaceConfig,
    private readonly log: Logger,
  ) {
    this.engines = new EngineManager(log);
  }

  updateWorkspaceConfig(config: WorkspaceConfig): void {
    this.workspaceConfig = config;
  }

  resolveDevice(device: string | DeviceConfig): DeviceConfig {
    if (typeof device !== 'string') return DeviceConfigSchema.parse(device);
    const preset = findDevicePreset(device);
    if (preset) return { ...preset };
    // Workspace-defined presets from .livelab/config.json.
    for (const candidate of this.workspaceConfig.devices) {
      if (typeof candidate !== 'string' && candidate.id === device) {
        return DeviceConfigSchema.parse(candidate);
      }
    }
    throw new LiveLabError(ERROR_CODES.INVALID_INPUT, `Unknown device preset: ${device}`);
  }

  async createSession(request: CreateSessionRequest): Promise<DeviceSession> {
    if (this.sessions.size >= 12) {
      throw new LiveLabError(ERROR_CODES.LIMIT_EXCEEDED, 'Session limit (12) reached; close sessions first');
    }
    const device = this.resolveDevice(request.device);
    const browser = await this.engines.get(request.engine);

    let storageStatePath: string | undefined;
    const configured = request.storageStatePath ?? this.workspaceConfig.auth.storageStatePath;
    if (configured) {
      storageStatePath = resolveInside(this.options.workspaceRoot, configured);
    }

    const session = new DeviceSession(
      browser,
      request.engine,
      device,
      request.label ?? device.label,
      {
        consoleMaxEntries: this.options.consoleMaxEntries,
        networkMaxEntries: this.options.networkMaxEntries,
        maxFrameRate: this.options.maxFrameRate,
      },
      { headers: this.options.redactHeaders, queryParams: this.options.redactQueryParameters },
      this.workspaceConfig.headers,
      this.log,
      request.emulation ?? {},
      storageStatePath,
    );
    await session.init();
    this.sessions.set(session.sessionId, session);
    session.onEvent((event) => {
      for (const listener of this.eventListeners) {
        try {
          listener(event);
        } catch {}
      }
    });

    if (request.url) {
      const url = assertUrlAllowed(request.url, this.options.allowedHosts);
      await session.navigate(url.toString());
    }
    this.log.info(`Session created: ${device.label} (${request.engine})`, { sessionId: session.sessionId });
    return session;
  }

  get(sessionId: string): DeviceSession {
    const session = this.sessions.get(sessionId);
    if (!session || session.state === 'closed') {
      throw new LiveLabError(ERROR_CODES.SESSION_NOT_FOUND, `No such session: ${sessionId}`);
    }
    return session;
  }

  maybeGet(sessionId: string): DeviceSession | undefined {
    return this.sessions.get(sessionId);
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()]
      .filter((s) => s.state !== 'closed')
      .map((s) => s.info());
  }

  all(): DeviceSession[] {
    return [...this.sessions.values()].filter((s) => s.state !== 'closed');
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    await session.close();
    this.sessions.delete(sessionId);
  }

  onEvent(listener: (event: RuntimeEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /** Navigate one session (policy-checked); mirrors to peers when sync.navigation. */
  async navigate(sessionId: string, rawUrl: string, mirror = true): Promise<void> {
    const url = assertUrlAllowed(rawUrl, this.options.allowedHosts);
    const source = this.get(sessionId);
    await source.navigate(url.toString());
    if (mirror && this.sync.navigation) {
      await this.forPeers(sessionId, async (peer) => peer.navigate(url.toString()));
    }
  }

  async reload(sessionId: string, mirror = true): Promise<void> {
    const source = this.get(sessionId);
    await source.reload();
    if (mirror && this.sync.navigation) {
      await this.forPeers(sessionId, async (peer) => peer.reload());
    }
  }

  async goBack(sessionId: string, mirror = true): Promise<boolean> {
    const moved = await this.get(sessionId).goBack();
    if (mirror && this.sync.navigation) {
      await this.forPeers(sessionId, async (peer) => void (await peer.goBack()));
    }
    return moved;
  }

  async goForward(sessionId: string, mirror = true): Promise<boolean> {
    const moved = await this.get(sessionId).goForward();
    if (mirror && this.sync.navigation) {
      await this.forPeers(sessionId, async (peer) => void (await peer.goForward()));
    }
    return moved;
  }

  async reloadAll(): Promise<void> {
    await Promise.allSettled(this.all().map((s) => s.reload()));
  }

  /**
   * Webview input dispatch with optional synchronization. Scroll sync uses
   * percentage replication; interaction sync resolves a stable locator in the
   * source session first and falls back to coordinate replay with an explicit
   * log marker (never silently).
   */
  async dispatchInput(sessionId: string, input: InputEvent): Promise<void> {
    const source = this.get(sessionId);
    await source.dispatchInput(input);
    if (this.syncInProgress) return;

    if (input.inputType === 'scroll' && this.sync.scroll) {
      this.syncInProgress = true;
      try {
        await this.forPeers(sessionId, (peer) => peer.dispatchInput(input));
      } finally {
        this.syncInProgress = false;
      }
    }

    if (
      this.sync.interaction &&
      input.inputType === 'mouse' &&
      input.event.kind === 'click'
    ) {
      this.syncInProgress = true;
      try {
        const inspected = (await source
          .inspect({ x: input.event.x, y: input.event.y })
          .catch(() => null)) as { locators?: Array<{ strategy: string; value: string; name?: string; unique: boolean }> } | null;
        const stable = inspected?.locators?.find(
          (l) => l.unique && ['role', 'label', 'placeholder', 'text', 'testId'].includes(l.strategy),
        );
        await this.forPeers(sessionId, async (peer) => {
          if (stable) {
            await peer.click({
              locator: { strategy: stable.strategy as Locator['strategy'], value: stable.value, name: stable.name },
              button: 'left',
              clickCount: 1,
            });
          } else {
            this.log.warn(
              `Interaction sync: no stable locator at (${input.event.x}, ${input.event.y}); using coordinate replay fallback`,
              { sessionId: peer.sessionId },
            );
            await peer.dispatchInput(input);
          }
        });
      } finally {
        this.syncInProgress = false;
      }
    }
  }

  private async forPeers(sourceId: string, fn: (peer: DeviceSession) => Promise<void>): Promise<void> {
    const peers = this.all().filter((s) => s.sessionId !== sourceId && s.state === 'ready');
    await Promise.allSettled(
      peers.map(async (peer) => {
        try {
          await fn(peer);
        } catch (err) {
          this.log.warn(`Sync to peer failed: ${String(err)}`, { sessionId: peer.sessionId });
        }
      }),
    );
  }

  diagnostics(): { activePages: number; droppedFrames: number; lastCaptureLatencyMs: number | null } {
    const sessions = this.all();
    return {
      activePages: sessions.length,
      droppedFrames: sessions.reduce((sum, s) => sum + s.droppedFrames, 0),
      lastCaptureLatencyMs: sessions.map((s) => s.lastCaptureLatencyMs).find((v) => v !== null) ?? null,
    };
  }

  get allowedHosts(): string[] {
    return this.options.allowedHosts;
  }

  get workspaceRoot(): string {
    return this.options.workspaceRoot;
  }

  get config(): WorkspaceConfig {
    return this.workspaceConfig;
  }

  async closeAll(): Promise<void> {
    for (const id of [...this.sessions.keys()]) {
      await this.closeSession(id).catch(() => {});
    }
    await this.engines.closeAll();
  }
}

export function artifactSubdirFor(sessionId: string): string {
  return path.join('sessions', sessionId);
}
