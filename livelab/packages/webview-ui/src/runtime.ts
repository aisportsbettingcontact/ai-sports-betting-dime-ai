/** Typed HTTP + WS client used by the webview against the local runtime. */
import type { ServerMessage, SessionInfo, DetectedServer, RuntimeStatus } from '@livelab/protocol';

export interface RuntimeHandle {
  port: number;
  token: string;
}

export class WebviewRuntimeClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private closed = false;
  onMessage: ((msg: ServerMessage) => void) | null = null;
  onConnectionChange: ((connected: boolean) => void) | null = null;
  private subscribed = new Set<string>();

  constructor(private readonly handle: RuntimeHandle, private readonly maxFps: number) {}

  get base(): string {
    return `http://127.0.0.1:${this.handle.port}`;
  }

  async api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.handle.token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: string } };
    if (!res.ok) {
      const err = new Error(json?.error?.message ?? `runtime ${res.status}`);
      (err as Error & { code?: string }).code = json?.error?.code;
      throw err;
    }
    return json;
  }

  connect(): void {
    if (this.closed) return;
    try {
      this.ws = new WebSocket(`ws://127.0.0.1:${this.handle.port}/ws?token=${encodeURIComponent(this.handle.token)}`);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws.addEventListener('open', () => {
      this.onConnectionChange?.(true);
      for (const sessionId of this.subscribed) {
        this.send({ type: 'subscribe', sessionId, maxFps: this.maxFps, quality: 60 });
      }
    });
    this.ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as ServerMessage;
        this.onMessage?.(msg);
      } catch {}
    });
    this.ws.addEventListener('close', () => {
      this.onConnectionChange?.(false);
      this.scheduleReconnect();
    });
    this.ws.addEventListener('error', () => this.ws?.close());
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1500);
  }

  send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  subscribe(sessionId: string): void {
    this.subscribed.add(sessionId);
    this.send({ type: 'subscribe', sessionId, maxFps: this.maxFps, quality: 60 });
  }

  unsubscribe(sessionId: string): void {
    this.subscribed.delete(sessionId);
    this.send({ type: 'unsubscribe', sessionId });
  }

  input(sessionId: string, input: unknown): void {
    this.send({ type: 'input', sessionId, input });
  }

  dispose(): void {
    this.closed = true;
    this.ws?.close();
  }

  // Convenience wrappers
  listSessions(): Promise<{ sessions: SessionInfo[] }> {
    return this.api('GET', '/sessions');
  }
  createSession(device: string, url?: string): Promise<{ session: SessionInfo }> {
    return this.api('POST', '/sessions', { device, engine: 'chromium', url });
  }
  closeSession(sessionId: string): Promise<unknown> {
    return this.api('DELETE', `/sessions/${sessionId}`);
  }
  navigate(sessionId: string, url: string): Promise<unknown> {
    return this.api('POST', `/sessions/${sessionId}/navigate`, { url });
  }
  status(): Promise<RuntimeStatus> {
    return this.api('GET', '/status');
  }
  detectServers(): Promise<{ servers: DetectedServer[] }> {
    return this.api('GET', '/server/detect');
  }
}
