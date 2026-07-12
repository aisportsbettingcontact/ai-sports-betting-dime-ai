/**
 * One device preview frame: header, live canvas, and the input capture layer
 * that maps frame coordinates → page coordinates (accounting for zoom/scale)
 * before dispatching validated input events.
 */
import type { SessionInfo, ServerMessage } from '@livelab/protocol';
import { WebviewRuntimeClient } from './runtime';

type FrameMsg = Extract<ServerMessage, { type: 'frame' }>;

export interface DeviceFrameCallbacks {
  onClose: (sessionId: string) => void;
  onRotate: (sessionId: string) => void;
  onInspect: (sessionId: string, x: number, y: number) => void;
  onFocus: (sessionId: string) => void;
}

export class DeviceFrame {
  readonly root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private badge: HTMLElement;
  private titleEl: HTMLElement;
  private modeEl: HTMLElement;
  private zoom: 'fit' | number = 'fit';
  private lastImageW = 0;
  private lastImageH = 0;
  inspectMode = false;
  private pointerDown = false;

  constructor(
    public info: SessionInfo,
    private readonly client: WebviewRuntimeClient,
    private readonly callbacks: DeviceFrameCallbacks,
  ) {
    this.root = document.createElement('section');
    this.root.className = 'device-frame';
    this.root.dataset.sessionId = info.sessionId;
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', `${info.device.label} preview`);

    const header = document.createElement('header');
    header.className = 'device-header';

    this.titleEl = document.createElement('span');
    this.titleEl.className = 'device-title';
    this.titleEl.textContent = `${info.device.label} · ${info.device.width}×${info.device.height}`;

    this.badge = document.createElement('span');
    this.badge.className = 'device-badge';
    this.badge.title = 'console errors / page errors / failed requests';
    this.badge.textContent = '0 · 0 · 0';

    this.modeEl = document.createElement('span');
    this.modeEl.className = 'device-mode';
    this.modeEl.textContent = '';

    const mkButton = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
      const button = document.createElement('button');
      button.className = 'icon-button';
      button.textContent = label;
      button.title = title;
      button.setAttribute('aria-label', title);
      button.addEventListener('click', onClick);
      return button;
    };

    const zoomButton = mkButton('fit', 'Cycle zoom (fit → 50% → 100%)', () => {
      this.zoom = this.zoom === 'fit' ? 0.5 : this.zoom === 0.5 ? 1 : 'fit';
      zoomButton.textContent = this.zoom === 'fit' ? 'fit' : `${Math.round((this.zoom as number) * 100)}%`;
      this.layout();
    });

    header.append(
      this.titleEl,
      this.badge,
      this.modeEl,
      zoomButton,
      mkButton('⟳', 'Rotate device', () => this.callbacks.onRotate(this.info.sessionId)),
      mkButton('✕', 'Close device', () => this.callbacks.onClose(this.info.sessionId)),
    );

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'device-canvas';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'application');
    this.canvas.setAttribute(
      'aria-label',
      `Interactive ${info.device.label} browser preview. Focus and use mouse or keyboard to drive the page.`,
    );
    this.ctx = this.canvas.getContext('2d')!;

    const viewport = document.createElement('div');
    viewport.className = 'device-viewport';
    viewport.appendChild(this.canvas);

    this.root.append(header, viewport);
    this.attachInput();
    this.layout();
  }

  /** Map canvas-relative pixel coordinates to page CSS pixels. */
  private toPage(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = rect.width / this.info.device.width;
    const scaleY = rect.height / this.info.device.height;
    return {
      x: Math.max(0, Math.min((clientX - rect.left) / scaleX, this.info.device.width)),
      y: Math.max(0, Math.min((clientY - rect.top) / scaleY, this.info.device.height)),
    };
  }

  private attachInput(): void {
    const canvas = this.canvas;
    canvas.addEventListener('pointerdown', (event) => {
      canvas.focus();
      this.callbacks.onFocus(this.info.sessionId);
      const { x, y } = this.toPage(event.clientX, event.clientY);
      if (this.inspectMode) {
        this.callbacks.onInspect(this.info.sessionId, x, y);
        return;
      }
      this.pointerDown = true;
      canvas.setPointerCapture(event.pointerId);
      this.client.input(this.info.sessionId, {
        inputType: 'mouse',
        event: { kind: 'down', x, y, button: event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left', clickCount: 1, deltaX: 0, deltaY: 0, modifiers: [] },
      });
      event.preventDefault();
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!this.pointerDown && !this.inspectMode) return;
      if (this.inspectMode) return;
      const { x, y } = this.toPage(event.clientX, event.clientY);
      this.client.input(this.info.sessionId, {
        inputType: 'mouse',
        event: { kind: 'move', x, y, button: 'left', clickCount: 1, deltaX: 0, deltaY: 0, modifiers: [] },
      });
    });
    canvas.addEventListener('pointerup', (event) => {
      if (!this.pointerDown) return;
      this.pointerDown = false;
      const { x, y } = this.toPage(event.clientX, event.clientY);
      this.client.input(this.info.sessionId, {
        inputType: 'mouse',
        event: { kind: 'up', x, y, button: event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left', clickCount: 1, deltaX: 0, deltaY: 0, modifiers: [] },
      });
    });
    canvas.addEventListener('wheel', (event) => {
      const { x, y } = this.toPage(event.clientX, event.clientY);
      this.client.input(this.info.sessionId, {
        inputType: 'mouse',
        event: {
          kind: 'wheel',
          x,
          y,
          button: 'left',
          clickCount: 1,
          deltaX: Math.max(-2000, Math.min(2000, event.deltaX)),
          deltaY: Math.max(-2000, Math.min(2000, event.deltaY)),
          modifiers: [],
        },
      });
      event.preventDefault();
    }, { passive: false });

    canvas.addEventListener('keydown', (event) => {
      // Keep VS Code shortcuts working: only swallow keys when canvas has focus.
      const modifiers: string[] = [];
      if (event.ctrlKey) modifiers.push('Control');
      if (event.metaKey) modifiers.push('Meta');
      if (event.altKey) modifiers.push('Alt');
      if (event.shiftKey && event.key.length > 1) modifiers.push('Shift');
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        this.client.input(this.info.sessionId, { inputType: 'text', event: { kind: 'insertText', text: event.key } });
      } else {
        const key = event.key === ' ' ? 'Space' : event.key;
        const combo = modifiers.length > 0 ? `${modifiers.join('+')}+${key}` : key;
        this.client.input(this.info.sessionId, { inputType: 'key', event: { kind: 'press', key: combo.slice(0, 32) } });
      }
      event.preventDefault();
      event.stopPropagation();
    });
  }

  drawFrame(msg: FrameMsg): void {
    const image = new Image();
    image.onload = () => {
      this.lastImageW = image.width;
      this.lastImageH = image.height;
      if (this.canvas.width !== image.width || this.canvas.height !== image.height) {
        this.canvas.width = image.width;
        this.canvas.height = image.height;
        this.layout();
      }
      this.ctx.drawImage(image, 0, 0);
    };
    image.src = `data:image/jpeg;base64,${msg.data}`;
    if (this.modeEl.textContent !== msg.mode) {
      this.modeEl.textContent = msg.mode === 'cdp-screencast' ? 'live' : 'poll';
      this.modeEl.title = msg.mode;
    }
  }

  update(info: Partial<SessionInfo> & { counters?: SessionInfo['counters'] }): void {
    if (info.device) this.info.device = info.device;
    if (info.url) this.info.url = info.url;
    if (info.state) this.info.state = info.state;
    if (info.counters) {
      this.badge.textContent = `${info.counters.consoleErrors} · ${info.counters.pageErrors} · ${info.counters.failedRequests}`;
      const severity = info.counters.pageErrors > 0 || info.counters.consoleErrors > 0;
      this.badge.classList.toggle('badge-error', severity);
    }
    this.titleEl.textContent = `${this.info.device.label} · ${this.info.device.width}×${this.info.device.height}`;
    this.root.classList.toggle('frame-crashed', this.info.state === 'crashed');
    this.layout();
  }

  setInspect(on: boolean): void {
    this.inspectMode = on;
    this.canvas.classList.toggle('inspect-cursor', on);
  }

  layout(): void {
    const { width, height } = this.info.device;
    if (this.zoom === 'fit') {
      this.canvas.style.width = '100%';
      this.canvas.style.height = 'auto';
      this.canvas.style.aspectRatio = `${width} / ${height}`;
    } else {
      this.canvas.style.width = `${width * this.zoom}px`;
      this.canvas.style.height = `${height * this.zoom}px`;
      this.canvas.style.aspectRatio = '';
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
