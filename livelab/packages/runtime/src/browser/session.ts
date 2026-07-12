import * as fs from 'node:fs';
import type { Browser, BrowserContext, CDPSession, Page } from 'playwright-core';
import {
  BrowserEngine,
  ConsoleRecord,
  DeviceConfig,
  Emulation,
  ERROR_CODES,
  EventQuery,
  InputEvent,
  LifecycleRecord,
  LiveLabError,
  Locator,
  NetworkRecord,
  PageErrorRecord,
  RuntimeEvent,
  SessionInfo,
  SettleResult,
  WebSocketRecord,
  redactHeaders,
  redactText,
  redactUrl,
} from '@livelab/protocol';
import { EventRing } from '../util/ring';
import { newId } from '../util/ids';
import { Logger } from '../util/logger';
import { resolveLocator } from './locators';
import {
  DOM_SNAPSHOT,
  FOCUS_INDICATOR_CHECK,
  INSPECT_AT,
  LAYOUT_FACTS,
  SCROLL_TO_PERCENT,
  VISIBLE_TEXT_DIGEST,
} from './pageScripts';

export interface SessionRedaction {
  headers: string[];
  queryParams: string[];
}

export interface FrameListener {
  (frame: {
    sessionId: string;
    data: string;
    width: number;
    height: number;
    mode: 'cdp-screencast' | 'screenshot-poll';
    timestamp: number;
  }): void;
}

export interface SessionEventListener {
  (event: RuntimeEvent): void;
}

interface SessionLimits {
  consoleMaxEntries: number;
  networkMaxEntries: number;
  maxFrameRate: number;
}

/**
 * One interactive device session = one isolated BrowserContext + Page.
 * Owns telemetry rings, live frame production (CDP screencast with a
 * screenshot-polling fallback), validated input dispatch, and evidence capture.
 */
export class DeviceSession {
  readonly sessionId = newId('sess');
  readonly createdAt = Date.now();

  private context!: BrowserContext;
  private page!: Page;
  private cdp: CDPSession | null = null;

  state: 'starting' | 'ready' | 'crashed' | 'closed' = 'starting';
  streamMode: 'cdp-screencast' | 'screenshot-poll' | 'none' = 'none';
  orientation: 'portrait' | 'landscape';
  navigationId: string | undefined;
  lastUrl: string | undefined;
  tracing = false;

  private seq = 0;
  private readonly consoleRing: EventRing<ConsoleRecord | PageErrorRecord>;
  private readonly networkRing: EventRing<NetworkRecord | WebSocketRecord>;
  private readonly lifecycleRing: EventRing<LifecycleRecord>;

  readonly counters = { consoleErrors: 0, consoleWarnings: 0, pageErrors: 0, failedRequests: 0 };

  private frameListeners = new Set<FrameListener>();
  private eventListeners = new Set<SessionEventListener>();
  private pollTimer: NodeJS.Timeout | null = null;
  private screencastActive = false;
  private lastFrameAt = 0;
  private frameMinIntervalMs: number;
  private frameQuality = 60;
  droppedFrames = 0;
  lastCaptureLatencyMs: number | null = null;

  private inflightRequests = 0;
  private lastActivityAt = Date.now();
  private requestStarts = new Map<string, number>();

  private log: Logger;

  constructor(
    private readonly browser: Browser,
    readonly engine: BrowserEngine,
    readonly device: DeviceConfig,
    readonly label: string,
    private readonly limits: SessionLimits,
    private readonly redaction: SessionRedaction,
    private readonly extraHeaders: Record<string, string>,
    parentLog: Logger,
    public emulation: Emulation = {},
    private readonly storageStatePath?: string,
  ) {
    this.orientation = device.width <= device.height ? 'portrait' : 'landscape';
    this.consoleRing = new EventRing(limits.consoleMaxEntries);
    this.networkRing = new EventRing(limits.networkMaxEntries);
    this.lifecycleRing = new EventRing(200);
    this.frameMinIntervalMs = Math.floor(1000 / limits.maxFrameRate);
    this.log = parentLog.child({ sessionId: this.sessionId });
  }

  private nextSeq(): number {
    return ++this.seq;
  }

  get cursor(): number {
    return this.seq;
  }

  async init(): Promise<void> {
    const { device, emulation } = this;
    this.context = await this.browser.newContext({
      viewport: { width: device.width, height: device.height },
      deviceScaleFactor: device.deviceScaleFactor,
      isMobile: this.engine === 'chromium' ? device.isMobile : undefined,
      hasTouch: device.hasTouch,
      userAgent: device.userAgent,
      locale: emulation.locale,
      timezoneId: emulation.timezoneId,
      geolocation: emulation.geolocation,
      permissions: emulation.geolocation ? ['geolocation'] : undefined,
      colorScheme: emulation.colorScheme,
      reducedMotion: emulation.reducedMotion,
      offline: emulation.offline,
      extraHTTPHeaders: Object.keys(this.extraHeaders).length ? this.extraHeaders : undefined,
      storageState: this.storageStatePath && fs.existsSync(this.storageStatePath) ? this.storageStatePath : undefined,
      serviceWorkers: 'allow',
    });

    // Activity binding: DOM mutations bump the settle clock (installed pre-navigation).
    await this.context.exposeBinding('__livelabActivity', () => {
      this.lastActivityAt = Date.now();
    });
    await this.context.addInitScript(`
      (function() {
        try {
          var pending = false;
          var report = function() {
            if (pending) return;
            pending = true;
            setTimeout(function() {
              pending = false;
              try { window.__livelabActivity(); } catch (e) {}
            }, 120);
          };
          var obs = new MutationObserver(report);
          var attach = function() {
            if (document.body) obs.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
          };
          if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
          else attach();
        } catch (e) {}
      })();
    `);

    this.page = await this.context.newPage();
    this.attachTelemetry();

    if (this.engine === 'chromium') {
      try {
        this.cdp = await this.context.newCDPSession(this.page);
        if (this.emulation.networkThrottle) await this.applyThrottle(this.emulation.networkThrottle);
        if (this.emulation.cacheDisabled) await this.applyCacheDisabled(true);
      } catch (err) {
        this.log.warn(`CDP session unavailable, falling back to polling capture: ${String(err)}`);
        this.cdp = null;
      }
    }
    this.state = 'ready';
    this.pushLifecycle('created', undefined, `${this.device.label} (${this.engine})`);
  }

  // ---------------------------------------------------------------- telemetry

  private emit(event: RuntimeEvent): void {
    this.lastActivityAt = Date.now();
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch {}
    }
  }

  private pushLifecycle(
    event: LifecycleRecord['event'],
    url?: string,
    detail?: string,
  ): void {
    const record = this.lifecycleRing.push({
      type: 'lifecycle' as const,
      seq: this.nextSeq(),
      sessionId: this.sessionId,
      navigationId: this.navigationId,
      event,
      url,
      detail,
      timestamp: Date.now(),
    });
    this.emit(record);
  }

  private attachTelemetry(): void {
    const page = this.page;

    page.on('console', (msg) => {
      // Playwright reports console.warn as 'warning'.
      const rawType = msg.type() === 'warning' ? 'warn' : msg.type();
      const level = (['log', 'info', 'warn', 'error', 'debug'].includes(rawType)
        ? rawType
        : 'log') as ConsoleRecord['level'];
      const loc = msg.location();
      const text = redactText(msg.text()).slice(0, 4000);
      // Fold consecutive identical records into a count instead of new entries.
      const last = this.consoleRing.snapshot()[this.consoleRing.size - 1];
      if (
        last &&
        last.type === 'console' &&
        last.level === level &&
        last.text === text &&
        last.url === (loc.url || undefined)
      ) {
        last.count += 1;
        last.timestamp = Date.now();
        this.lastActivityAt = Date.now();
        return;
      }
      if (level === 'error') this.counters.consoleErrors++;
      if (level === 'warn') this.counters.consoleWarnings++;
      const record = this.consoleRing.push({
        type: 'console' as const,
        seq: this.nextSeq(),
        sessionId: this.sessionId,
        navigationId: this.navigationId,
        level,
        text,
        url: loc.url ? redactUrl(loc.url, this.redaction.queryParams) : undefined,
        line: loc.lineNumber,
        column: loc.columnNumber,
        timestamp: Date.now(),
        count: 1,
      });
      this.emit(record);
    });

    page.on('pageerror', (err) => {
      this.counters.pageErrors++;
      const message = redactText(err.message ?? String(err)).slice(0, 4000);
      const record = this.consoleRing.push({
        type: 'pageError' as const,
        seq: this.nextSeq(),
        sessionId: this.sessionId,
        navigationId: this.navigationId,
        message,
        stack: err.stack ? redactText(err.stack).slice(0, 6000) : undefined,
        errorType: /unhandled.*rejection/i.test(message) ? ('rejection' as const) : ('exception' as const),
        timestamp: Date.now(),
        count: 1,
      });
      this.emit(record);
    });

    page.on('request', (req) => {
      this.inflightRequests++;
      this.lastActivityAt = Date.now();
      this.requestStarts.set(req.url() + '#' + Date.now(), Date.now());
    });

    const finishRequest = async (req: import('playwright-core').Request, failed: string | null) => {
      this.inflightRequests = Math.max(0, this.inflightRequests - 1);
      let status: number | undefined;
      let ok: boolean | undefined;
      let responseHeaders: Record<string, string> | undefined;
      let fromCache: boolean | undefined;
      let transferSize: number | undefined;
      try {
        const res = failed ? null : await req.response();
        if (res) {
          status = res.status();
          ok = status < 400;
          responseHeaders = redactHeaders(await res.allHeaders(), this.redaction.headers);
          const sizes = await req.sizes().catch(() => null);
          if (sizes) transferSize = sizes.responseBodySize + sizes.responseHeadersSize;
        }
      } catch {}
      if (failed || (status !== undefined && status >= 400)) this.counters.failedRequests++;
      const timing = req.timing();
      const record = this.networkRing.push({
        type: 'network' as const,
        seq: this.nextSeq(),
        sessionId: this.sessionId,
        navigationId: this.navigationId,
        method: req.method(),
        url: redactUrl(req.url(), this.redaction.queryParams).slice(0, 2048),
        resourceType: req.resourceType(),
        status,
        ok: failed ? false : ok,
        failureText: failed ?? undefined,
        durationMs: timing.responseEnd > 0 ? Math.round(timing.responseEnd) : undefined,
        transferSize,
        fromCache,
        initiator: undefined,
        requestHeaders: redactHeaders(req.headers(), this.redaction.headers),
        responseHeaders,
        timestamp: Date.now(),
      });
      this.emit(record);
    };

    page.on('requestfinished', (req) => void finishRequest(req, null));
    page.on('requestfailed', (req) => void finishRequest(req, req.failure()?.errorText ?? 'failed'));

    page.on('websocket', (ws) => {
      const pushWs = (event: WebSocketRecord['event'], detail?: string) => {
        const record = this.networkRing.push({
          type: 'websocket' as const,
          seq: this.nextSeq(),
          sessionId: this.sessionId,
          url: redactUrl(ws.url(), this.redaction.queryParams),
          event,
          detail: detail ? redactText(detail).slice(0, 300) : undefined,
          timestamp: Date.now(),
        });
        this.emit(record);
      };
      pushWs('open');
      ws.on('close', () => pushWs('close'));
      ws.on('socketerror', (e) => pushWs('error', String(e)));
      ws.on('framereceived', (frame) => {
        const payload = typeof frame.payload === 'string' ? frame.payload : '';
        // HMR signal detection (Vite/Next emit JSON over WS during updates).
        if (/"type":\s*"(update|full-reload|hmr)/.test(payload) || /hot-update/.test(payload)) {
          this.pushLifecycle('hmr', undefined, payload.slice(0, 160));
        } else {
          this.lastActivityAt = Date.now();
        }
      });
    });

    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      this.navigationId = newId('nav');
      this.lastUrl = frame.url();
      this.pushLifecycle('navigation', redactUrl(frame.url(), this.redaction.queryParams));
    });
    page.on('load', () => this.pushLifecycle('load', this.page.url()));
    page.on('domcontentloaded', () => this.pushLifecycle('domcontentloaded'));
    page.on('crash', () => {
      this.state = 'crashed';
      this.pushLifecycle('crash', this.page.url());
    });
    page.on('close', () => {
      if (this.state !== 'closed') {
        this.state = 'closed';
        this.pushLifecycle('close');
      }
    });
    page.on('dialog', (dialog) => {
      this.pushLifecycle('dialog', undefined, `${dialog.type()}: ${dialog.message().slice(0, 200)}`);
      void dialog.dismiss().catch(() => {});
    });
  }

  onEvent(listener: SessionEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  // ------------------------------------------------------------------ queries

  queryConsole(query: EventQuery): ReturnType<EventRing<ConsoleRecord | PageErrorRecord>['query']> {
    return this.consoleRing.query(query.since ?? 0, query.limit, (item) => {
      if (query.levels && item.type === 'console' && !query.levels.includes(item.level)) return false;
      if (query.levels && item.type === 'pageError' && !query.levels.includes('error')) return false;
      return true;
    });
  }

  queryNetwork(query: EventQuery): ReturnType<EventRing<NetworkRecord | WebSocketRecord>['query']> {
    return this.networkRing.query(query.since ?? 0, query.limit, (item) => {
      if (item.type === 'network') {
        if (query.failedOnly && item.ok !== false) return false;
        if (query.urlFilter && !item.url.includes(query.urlFilter)) return false;
        return true;
      }
      return !query.failedOnly;
    });
  }

  queryPageErrors(query: EventQuery): { items: PageErrorRecord[]; cursor: number; truncated: boolean; totalMatched: number } {
    const res = this.consoleRing.query(query.since ?? 0, query.limit, (i) => i.type === 'pageError');
    return { ...res, items: res.items.filter((i): i is PageErrorRecord => i.type === 'pageError') };
  }

  queryLifecycle(query: EventQuery): ReturnType<EventRing<LifecycleRecord>['query']> {
    return this.lifecycleRing.query(query.since ?? 0, query.limit);
  }

  info(): SessionInfo {
    return {
      sessionId: this.sessionId,
      label: this.label,
      engine: this.engine,
      device: this.device,
      url: this.lastUrl ? redactUrl(this.lastUrl, this.redaction.queryParams) : undefined,
      title: undefined,
      createdAt: this.createdAt,
      navigationId: this.navigationId,
      state: this.state,
      orientation: this.orientation,
      emulation: this.emulation,
      counters: { ...this.counters },
      streamMode: this.frameListeners.size > 0 ? this.streamMode : 'none',
    };
  }

  async title(): Promise<string | undefined> {
    try {
      return await this.page.title();
    } catch {
      return undefined;
    }
  }

  // ------------------------------------------------------------------ actions

  get currentPage(): Page {
    return this.page;
  }

  async navigate(url: string): Promise<void> {
    this.assertOpen();
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      this.lastUrl = this.page.url();
    } catch (err) {
      throw new LiveLabError(ERROR_CODES.NAVIGATION_FAILED, `Navigation to ${url} failed: ${String(err)}`);
    }
  }

  async reload(): Promise<void> {
    this.assertOpen();
    await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch((err) => {
      throw new LiveLabError(ERROR_CODES.NAVIGATION_FAILED, `Reload failed: ${String(err)}`);
    });
  }

  async goBack(): Promise<boolean> {
    this.assertOpen();
    const res = await this.page.goBack({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => null);
    return res !== null;
  }

  async goForward(): Promise<boolean> {
    this.assertOpen();
    const res = await this.page.goForward({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => null);
    return res !== null;
  }

  async setViewport(width: number, height: number, deviceScaleFactor?: number): Promise<void> {
    this.assertOpen();
    void deviceScaleFactor; // scale factor changes require context recreation; viewport resize is live
    await this.page.setViewportSize({ width, height });
    this.device.width = width;
    this.device.height = height;
    this.orientation = width <= height ? 'portrait' : 'landscape';
    await this.restartScreencastIfActive();
  }

  async rotate(): Promise<void> {
    await this.setViewport(this.device.height, this.device.width);
  }

  async applyEmulation(emulation: Emulation): Promise<{ applied: string[]; unsupported: string[] }> {
    this.assertOpen();
    const applied: string[] = [];
    const unsupported: string[] = [];
    if (emulation.colorScheme !== undefined || emulation.reducedMotion !== undefined) {
      await this.page.emulateMedia({
        colorScheme: emulation.colorScheme ?? undefined,
        reducedMotion: emulation.reducedMotion ?? undefined,
      });
      if (emulation.colorScheme) applied.push(`colorScheme=${emulation.colorScheme}`);
      if (emulation.reducedMotion) applied.push(`reducedMotion=${emulation.reducedMotion}`);
    }
    if (emulation.offline !== undefined) {
      await this.context.setOffline(emulation.offline);
      applied.push(`offline=${emulation.offline}`);
    }
    if (emulation.networkThrottle !== undefined) {
      if (this.cdp) {
        await this.applyThrottle(emulation.networkThrottle);
        applied.push('networkThrottle');
      } else {
        unsupported.push('networkThrottle (Chromium CDP only)');
      }
    }
    if (emulation.cacheDisabled !== undefined) {
      if (this.cdp) {
        await this.applyCacheDisabled(emulation.cacheDisabled);
        applied.push(`cacheDisabled=${emulation.cacheDisabled}`);
      } else {
        unsupported.push('cacheDisabled (Chromium CDP only)');
      }
    }
    for (const key of ['locale', 'timezoneId', 'geolocation'] as const) {
      if (emulation[key] !== undefined) {
        unsupported.push(`${key} (requires new session; set it when creating the session)`);
      }
    }
    this.emulation = { ...this.emulation, ...emulation };
    return { applied, unsupported };
  }

  private async applyThrottle(t: NonNullable<Emulation['networkThrottle']>): Promise<void> {
    await this.cdp!.send('Network.enable');
    await this.cdp!.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: t.latencyMs,
      downloadThroughput: (t.downloadKbps * 1024) / 8,
      uploadThroughput: (t.uploadKbps * 1024) / 8,
    });
  }

  private async applyCacheDisabled(disabled: boolean): Promise<void> {
    await this.cdp!.send('Network.enable');
    await this.cdp!.send('Network.setCacheDisabled', { cacheDisabled: disabled });
  }

  async clearState(opts: { storage: boolean; cookies: boolean; serviceWorkers: boolean }): Promise<void> {
    this.assertOpen();
    if (opts.cookies) await this.context.clearCookies();
    if (opts.storage) {
      await this.page
        .evaluate(`(function(){ try { localStorage.clear(); sessionStorage.clear(); } catch(e) {} })()`)
        .catch(() => {});
    }
    if (opts.serviceWorkers) {
      await this.page
        .evaluate(
          `navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister()))) : Promise.resolve()`,
        )
        .catch(() => {});
    }
  }

  // -------------------------------------------------------------------- input

  async dispatchInput(input: InputEvent): Promise<void> {
    this.assertOpen();
    const page = this.page;
    const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max));
    switch (input.inputType) {
      case 'mouse': {
        const e = input.event;
        const x = clamp(e.x, this.device.width);
        const y = clamp(e.y, this.device.height);
        switch (e.kind) {
          case 'move':
            await page.mouse.move(x, y);
            break;
          case 'down':
            await page.mouse.move(x, y);
            await page.mouse.down({ button: e.button });
            break;
          case 'up':
            await page.mouse.up({ button: e.button });
            break;
          case 'click':
            await page.mouse.click(x, y, { button: e.button, clickCount: e.clickCount });
            break;
          case 'dblclick':
            await page.mouse.dblclick(x, y, { button: e.button });
            break;
          case 'wheel':
            await page.mouse.move(x, y);
            await page.mouse.wheel(e.deltaX, e.deltaY);
            break;
        }
        break;
      }
      case 'touch': {
        if (!this.device.hasTouch) {
          // Fall back to a click when the device has no touch emulation.
          await page.mouse.click(clamp(input.event.x, this.device.width), clamp(input.event.y, this.device.height));
        } else {
          await page.touchscreen.tap(
            clamp(input.event.x, this.device.width),
            clamp(input.event.y, this.device.height),
          );
        }
        break;
      }
      case 'key': {
        const e = input.event;
        if (e.kind === 'down') await page.keyboard.down(e.key);
        else if (e.kind === 'up') await page.keyboard.up(e.key);
        else await page.keyboard.press(e.key);
        break;
      }
      case 'text':
        await page.keyboard.insertText(input.event.text);
        break;
      case 'scroll': {
        await page.evaluate(`(${SCROLL_TO_PERCENT})(${JSON.stringify({ xPercent: input.event.xPercent, yPercent: input.event.yPercent })})`);
        break;
      }
      case 'focus':
        await page.bringToFront().catch(() => {});
        break;
    }
  }

  // ------------------------------------------------------------- live frames

  onFrame(listener: FrameListener, opts?: { maxFps?: number; quality?: number }): () => void {
    if (opts?.maxFps) {
      this.frameMinIntervalMs = Math.max(
        Math.floor(1000 / Math.min(opts.maxFps, this.limits.maxFrameRate)),
        Math.floor(1000 / this.limits.maxFrameRate),
      );
    }
    if (opts?.quality) this.frameQuality = Math.min(90, Math.max(10, opts.quality));
    this.frameListeners.add(listener);
    void this.ensureStreaming();
    return () => {
      this.frameListeners.delete(listener);
      if (this.frameListeners.size === 0) void this.stopStreaming();
    };
  }

  private emitFrame(data: string, width: number, height: number, mode: 'cdp-screencast' | 'screenshot-poll'): void {
    const now = Date.now();
    if (now - this.lastFrameAt < this.frameMinIntervalMs) {
      this.droppedFrames++;
      return;
    }
    this.lastFrameAt = now;
    for (const listener of this.frameListeners) {
      try {
        listener({ sessionId: this.sessionId, data, width, height, mode, timestamp: now });
      } catch {}
    }
  }

  private async ensureStreaming(): Promise<void> {
    if (this.state !== 'ready') return;
    if (this.screencastActive || this.pollTimer) return;
    if (this.cdp) {
      try {
        this.cdp.on('Page.screencastFrame', (params: { data: string; metadata: { deviceWidth: number; deviceHeight: number }; sessionId: number }) => {
          this.emitFrame(params.data, params.metadata.deviceWidth, params.metadata.deviceHeight, 'cdp-screencast');
          void this.cdp?.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {});
        });
        await this.cdp.send('Page.startScreencast', {
          format: 'jpeg',
          quality: this.frameQuality,
          maxWidth: Math.min(this.device.width * 2, 2560),
          maxHeight: Math.min(this.device.height * 2, 2560),
          everyNthFrame: 1,
        });
        this.screencastActive = true;
        this.streamMode = 'cdp-screencast';
        return;
      } catch (err) {
        this.log.warn(`CDP screencast failed, using screenshot polling: ${String(err)}`);
      }
    }
    // Fallback: bounded screenshot polling.
    this.streamMode = 'screenshot-poll';
    const interval = Math.max(this.frameMinIntervalMs, 200);
    this.pollTimer = setInterval(async () => {
      if (this.state !== 'ready' || this.frameListeners.size === 0) return;
      const started = Date.now();
      try {
        const buf = await this.page.screenshot({ type: 'jpeg', quality: this.frameQuality, timeout: 5_000 });
        this.lastCaptureLatencyMs = Date.now() - started;
        this.emitFrame(buf.toString('base64'), this.device.width, this.device.height, 'screenshot-poll');
      } catch {
        this.droppedFrames++;
      }
    }, interval);
  }

  private async stopStreaming(): Promise<void> {
    if (this.screencastActive && this.cdp) {
      await this.cdp.send('Page.stopScreencast').catch(() => {});
      this.screencastActive = false;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.streamMode = 'none';
  }

  private async restartScreencastIfActive(): Promise<void> {
    if (this.screencastActive && this.cdp) {
      await this.cdp.send('Page.stopScreencast').catch(() => {});
      this.screencastActive = false;
      await this.ensureStreaming();
    }
  }

  // ------------------------------------------------------------------ evidence

  async screenshot(opts: { fullPage?: boolean; format?: 'png' | 'jpeg'; quality?: number }): Promise<Buffer> {
    this.assertOpen();
    const started = Date.now();
    const buf = await this.page.screenshot({
      fullPage: opts.fullPage ?? false,
      type: opts.format ?? 'png',
      quality: opts.format === 'jpeg' ? (opts.quality ?? 80) : undefined,
      timeout: 15_000,
      animations: 'disabled',
    });
    this.lastCaptureLatencyMs = Date.now() - started;
    return buf;
  }

  async startTrace(): Promise<void> {
    this.assertOpen();
    if (this.tracing) throw new LiveLabError(ERROR_CODES.INVALID_INPUT, 'Trace already running for this session');
    await this.context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    this.tracing = true;
  }

  async stopTrace(outPath: string): Promise<void> {
    if (!this.tracing) throw new LiveLabError(ERROR_CODES.INVALID_INPUT, 'No trace running for this session');
    await this.context.tracing.stop({ path: outPath });
    this.tracing = false;
  }

  async domSnapshot(args: { selector: string; maxDepth: number; maxNodes: number; includeText: boolean }): Promise<unknown> {
    this.assertOpen();
    return this.page.evaluate(`(${DOM_SNAPSHOT})(${JSON.stringify(args)})`);
  }

  async ariaSnapshot(maxChars = 20_000): Promise<{ snapshot: string; truncated: boolean }> {
    this.assertOpen();
    const snapshot = await this.page.locator('body').ariaSnapshot();
    return { snapshot: snapshot.slice(0, maxChars), truncated: snapshot.length > maxChars };
  }

  async visibleTextDigest(): Promise<string> {
    this.assertOpen();
    return (await this.page.evaluate(`(${VISIBLE_TEXT_DIGEST})()`)) as string;
  }

  async layoutFacts(): Promise<{
    overflowX: number;
    hasLandmark: boolean;
    landmarkVisible: boolean;
    interactiveCount: number;
    visibleInteractive: number;
    coveredControls: string[];
    scroll: { x: number; y: number; maxX: number; maxY: number };
  }> {
    this.assertOpen();
    return (await this.page.evaluate(`(${LAYOUT_FACTS})()`)) as any;
  }

  async focusIndicatorCheck(): Promise<{ checked: boolean; hasIndicator?: boolean; tag?: string; reason?: string }> {
    this.assertOpen();
    return (await this.page.evaluate(`(${FOCUS_INDICATOR_CHECK})()`)) as any;
  }

  async inspect(args: { x?: number; y?: number; locator?: Locator }): Promise<unknown | null> {
    this.assertOpen();
    let evalArgs: { x?: number; y?: number; selector?: string };
    if (args.locator) {
      const pwLocator = resolveLocator(this.page, args.locator);
      const handle = await pwLocator.first().elementHandle({ timeout: 5000 }).catch(() => null);
      if (!handle) throw new LiveLabError(ERROR_CODES.TARGET_NOT_FOUND, 'Locator matched no element');
      const box = await handle.boundingBox();
      await handle.dispose();
      if (!box) throw new LiveLabError(ERROR_CODES.TARGET_NOT_FOUND, 'Element has no visible box');
      evalArgs = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    } else if (args.x !== undefined && args.y !== undefined) {
      evalArgs = { x: args.x, y: args.y };
    } else {
      throw new LiveLabError(ERROR_CODES.INVALID_INPUT, 'inspect requires x/y or a locator');
    }
    const raw = (await this.page.evaluate(`(${INSPECT_AT})(${JSON.stringify(evalArgs)})`)) as any;
    if (!raw) return null;
    const hints = raw._hints ?? {};
    delete raw._hints;

    // Build locator candidates in stable-first order and verify uniqueness.
    const candidates: Array<{ strategy: string; value: string; name?: string; expression: string }> = [];
    const role = raw.role ?? hints.implicitRole;
    const accessibleName = raw.accessibleName ?? hints.labelText ?? (raw.text && raw.text.length <= 60 ? raw.text : undefined);
    if (role && accessibleName) {
      candidates.push({
        strategy: 'role',
        value: role,
        name: accessibleName,
        expression: `getByRole('${role}', { name: '${accessibleName.replace(/'/g, "\\'")}' })`,
      });
    }
    if (hints.labelText) {
      candidates.push({ strategy: 'label', value: hints.labelText, expression: `getByLabel('${hints.labelText.replace(/'/g, "\\'")}')` });
    }
    if (hints.placeholder) {
      candidates.push({ strategy: 'placeholder', value: hints.placeholder, expression: `getByPlaceholder('${hints.placeholder.replace(/'/g, "\\'")}')` });
    }
    if (raw.text && raw.text.length > 0 && raw.text.length <= 60) {
      candidates.push({ strategy: 'text', value: raw.text, expression: `getByText('${raw.text.replace(/'/g, "\\'")}')` });
    }
    if (hints.testId) {
      candidates.push({ strategy: 'testId', value: hints.testId, expression: `getByTestId('${hints.testId}')` });
    }
    const cssSelector = hints.id
      ? `#${hints.id}`
      : `${raw.tag}${hints.testId ? `[data-testid="${hints.testId}"]` : ''}`;
    candidates.push({ strategy: 'css', value: cssSelector, expression: `locator('${cssSelector.replace(/'/g, "\\'")}')` });

    const withUniqueness = [] as Array<Record<string, unknown>>;
    for (const c of candidates.slice(0, 6)) {
      let unique = false;
      try {
        const loc = resolveLocator(this.page, { strategy: c.strategy as Locator['strategy'], value: c.value, name: c.name });
        unique = (await loc.count()) === 1;
      } catch {}
      withUniqueness.push({ ...c, unique });
    }
    return { ...raw, locators: withUniqueness };
  }

  // -------------------------------------------------------------------- settle

  async waitForSettle(quietWindowMs: number, maxSettleMs: number): Promise<SettleResult> {
    this.assertOpen();
    const start = Date.now();
    // Any current activity counts from now.
    while (Date.now() - start < maxSettleMs) {
      const quietFor = Date.now() - this.lastActivityAt;
      if (this.inflightRequests === 0 && quietFor >= quietWindowMs) {
        return { settled: true, waitedMs: Date.now() - start, timedOut: false, unresolvedActivity: [] };
      }
      await new Promise((r) => setTimeout(r, Math.min(60, quietWindowMs / 4)));
    }
    const unresolved: string[] = [];
    if (this.inflightRequests > 0) unresolved.push(`${this.inflightRequests} in-flight network request(s)`);
    if (Date.now() - this.lastActivityAt < quietWindowMs) unresolved.push('continuous page activity (DOM mutations/console/network)');
    return { settled: false, waitedMs: Date.now() - start, timedOut: true, unresolvedActivity: unresolved };
  }

  /** Locator-based high-level actions used by MCP tools. */
  async click(args: { locator?: Locator; x?: number; y?: number; button: 'left' | 'middle' | 'right'; clickCount: number }): Promise<string> {
    this.assertOpen();
    if (args.locator) {
      const loc = resolveLocator(this.page, args.locator);
      await loc.first().click({ button: args.button, clickCount: args.clickCount, timeout: 10_000 });
      return `clicked ${args.locator.strategy}=${args.locator.value}`;
    }
    if (args.x !== undefined && args.y !== undefined) {
      await this.page.mouse.click(args.x, args.y, { button: args.button, clickCount: args.clickCount });
      return `clicked at (${args.x}, ${args.y}) [coordinate fallback]`;
    }
    throw new LiveLabError(ERROR_CODES.INVALID_INPUT, 'click requires a locator or x/y');
  }

  async hover(args: { locator?: Locator; x?: number; y?: number }): Promise<string> {
    this.assertOpen();
    if (args.locator) {
      await resolveLocator(this.page, args.locator).first().hover({ timeout: 10_000 });
      return `hovered ${args.locator.strategy}=${args.locator.value}`;
    }
    if (args.x !== undefined && args.y !== undefined) {
      await this.page.mouse.move(args.x, args.y);
      return `hovered at (${args.x}, ${args.y}) [coordinate fallback]`;
    }
    throw new LiveLabError(ERROR_CODES.INVALID_INPUT, 'hover requires a locator or x/y');
  }

  async type(args: { locator?: Locator; text: string; clear: boolean; delayMs: number }): Promise<string> {
    this.assertOpen();
    if (args.locator) {
      const loc = resolveLocator(this.page, args.locator).first();
      if (args.clear) await loc.fill('', { timeout: 10_000 });
      if (args.delayMs > 0) await loc.pressSequentially(args.text, { delay: args.delayMs, timeout: 30_000 });
      else if (args.clear) await loc.fill(args.text, { timeout: 10_000 });
      else await loc.pressSequentially(args.text, { timeout: 30_000 });
      return `typed into ${args.locator.strategy}=${args.locator.value}`;
    }
    await this.page.keyboard.insertText(args.text);
    return 'typed into focused element';
  }

  async press(args: { locator?: Locator; key: string }): Promise<string> {
    this.assertOpen();
    if (args.locator) {
      await resolveLocator(this.page, args.locator).first().press(args.key, { timeout: 10_000 });
      return `pressed ${args.key} on ${args.locator.strategy}=${args.locator.value}`;
    }
    await this.page.keyboard.press(args.key);
    return `pressed ${args.key}`;
  }

  async select(args: { locator: Locator; values: string[] }): Promise<string> {
    this.assertOpen();
    await resolveLocator(this.page, args.locator).first().selectOption(args.values, { timeout: 10_000 });
    return `selected [${args.values.join(', ')}] in ${args.locator.strategy}=${args.locator.value}`;
  }

  async scroll(args: { locator?: Locator; x?: number; y?: number; yPercent?: number; deltaY?: number }): Promise<string> {
    this.assertOpen();
    if (args.locator) {
      await resolveLocator(this.page, args.locator).first().scrollIntoViewIfNeeded({ timeout: 10_000 });
      return `scrolled ${args.locator.strategy}=${args.locator.value} into view`;
    }
    if (args.yPercent !== undefined) {
      await this.page.evaluate(`(${SCROLL_TO_PERCENT})(${JSON.stringify({ xPercent: 0, yPercent: args.yPercent })})`);
      return `scrolled to ${Math.round(args.yPercent * 100)}%`;
    }
    if (args.deltaY !== undefined) {
      await this.page.mouse.wheel(0, args.deltaY);
      return `scrolled by ${args.deltaY}px`;
    }
    if (args.x !== undefined || args.y !== undefined) {
      await this.page.evaluate(`window.scrollTo(${args.x ?? 0}, ${args.y ?? 0})`);
      return `scrolled to (${args.x ?? 0}, ${args.y ?? 0})`;
    }
    throw new LiveLabError(ERROR_CODES.INVALID_INPUT, 'scroll requires a target');
  }

  /** Attempt to recover a crashed session by recreating the page in place. */
  async recover(): Promise<boolean> {
    if (this.state !== 'crashed') return false;
    try {
      await this.page.close().catch(() => {});
      this.page = await this.context.newPage();
      this.attachTelemetry();
      if (this.cdp) {
        this.cdp = await this.context.newCDPSession(this.page).catch(() => null);
      }
      this.state = 'ready';
      if (this.lastUrl) await this.navigate(this.lastUrl).catch(() => {});
      this.pushLifecycle('created', this.lastUrl, 'recovered after crash');
      return true;
    } catch (err) {
      this.log.error(`Crash recovery failed: ${String(err)}`);
      return false;
    }
  }

  private assertOpen(): void {
    if (this.state === 'closed') {
      throw new LiveLabError(ERROR_CODES.SESSION_NOT_FOUND, `Session ${this.sessionId} is closed`);
    }
    if (this.state === 'crashed') {
      throw new LiveLabError(ERROR_CODES.NAVIGATION_FAILED, `Session ${this.sessionId} crashed; call recover`, {
        recoverable: true,
      });
    }
  }

  async close(): Promise<void> {
    if (this.state === 'closed') return;
    this.state = 'closed';
    await this.stopStreaming();
    if (this.tracing) {
      await this.context.tracing.stop().catch(() => {});
      this.tracing = false;
    }
    await this.context.close().catch(() => {});
    this.pushLifecycle('close');
    this.frameListeners.clear();
    this.eventListeners.clear();
  }
}
