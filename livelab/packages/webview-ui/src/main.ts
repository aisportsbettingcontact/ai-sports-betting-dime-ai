/**
 * LiveLab webview entry. Renders the toolbar, responsive device grid, and the
 * diagnostics drawer. Talks to the runtime directly over 127.0.0.1 (HTTP + WS)
 * using the token handed over by the extension host; talks to VS Code for
 * quick-picks, notifications, and report opening.
 *
 * Everything rendered from page-derived data (console text, URLs, inspector
 * output) is inserted via textContent — never innerHTML — because page content
 * is untrusted.
 */
import type { DetectedServer, ServerMessage, SessionInfo } from '@livelab/protocol';
import { WebviewRuntimeClient } from './runtime';
import { DeviceFrame } from './deviceFrame';

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

interface InitMessage {
  type: 'init';
  runtime: { port: number; token: string };
  settings: {
    defaultUrl: string;
    defaultDevices: string[];
    syncNavigation: boolean;
    syncScroll: boolean;
    syncInteraction: boolean;
    frameRate: number;
  };
  workspaceTrusted: boolean;
}

const vscode = acquireVsCodeApi();

let client: WebviewRuntimeClient | null = null;
const frames = new Map<string, DeviceFrame>();
let focusedSessionId: string | null = null;
let inspectMode = false;
const tracingSessions = new Set<string>();
let settings: InitMessage['settings'] | null = null;
let workspaceTrusted = true;

const app = document.getElementById('app')!;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, title: string, onClick: () => void, className = 'toolbar-button'): HTMLButtonElement {
  const b = el('button', className, label);
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('click', onClick);
  return b;
}

function toast(message: string, isError = false): void {
  const node = el('div', `toast${isError ? ' toast-error' : ''}`, message);
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 4000);
}

// --------------------------------------------------------------------- layout

const toolbar = el('div', 'toolbar');
toolbar.setAttribute('role', 'toolbar');
toolbar.setAttribute('aria-label', 'LiveLab controls');
const grid = el('div', 'device-grid');
grid.setAttribute('aria-label', 'Device previews');
const drawer = el('div', 'drawer');
drawer.hidden = true;
const statusLine = el('div', 'status-line');
statusLine.setAttribute('role', 'status');

app.append(toolbar, grid, drawer, statusLine);

// URL controls
const urlInput = el('input') as HTMLInputElement;
urlInput.type = 'text';
urlInput.className = 'url-input';
urlInput.placeholder = 'http://localhost:3000';
urlInput.setAttribute('aria-label', 'Preview URL');

const serverSelect = el('select', 'server-select') as HTMLSelectElement;
serverSelect.setAttribute('aria-label', 'Detected development servers');
serverSelect.append(new Option('detected servers…', ''));

const engineIndicator = el('span', 'indicator', 'chromium');
engineIndicator.title = 'Interactive live-preview engine (WebKit runs as separate on-demand verification)';
const healthIndicator = el('span', 'indicator indicator-health', '● connecting');

const drawerToggle = button('▤ details', 'Toggle diagnostics drawer', () => {
  drawer.hidden = !drawer.hidden;
});

function navigateAll(url: string): void {
  if (!client) return;
  const targets = [...frames.keys()];
  void (async () => {
    for (const sessionId of targets) {
      try {
        await client!.navigate(sessionId, url);
        break; // runtime mirrors to peers when navigation sync is on
      } catch (err) {
        toast(String((err as Error).message), true);
        return;
      }
    }
    if (!settingsSync.navigation) {
      for (const sessionId of targets.slice(1)) {
        await client!.navigate(sessionId, url).catch(() => {});
      }
    }
  })();
}

const settingsSync = { navigation: true, scroll: false, interaction: false };

function syncToggle(key: keyof typeof settingsSync, label: string, title: string): HTMLElement {
  const wrap = el('label', 'sync-toggle');
  const box = el('input') as HTMLInputElement;
  box.type = 'checkbox';
  box.setAttribute('aria-label', title);
  wrap.title = title;
  box.addEventListener('change', () => {
    settingsSync[key] = box.checked;
    void client?.api('POST', '/sync', { [key]: box.checked }).catch((err) => toast(String(err.message), true));
  });
  wrap.append(box, el('span', undefined, label));
  (wrap as HTMLElement & { _box?: HTMLInputElement })._box = box;
  return wrap;
}

const navSync = syncToggle('navigation', 'nav', 'Sync navigation across devices');
const scrollSync = syncToggle('scroll', 'scroll', 'Sync scroll percentage across devices');
const interactSync = syncToggle('interaction', 'input', 'Sync clicks across devices (stable locators, coordinate fallback)');

toolbar.append(
  serverSelect,
  button('start', 'Start the selected development server', () => onStartServer()),
  button('attach', 'Attach to the URL without managing a server', () => onAttach()),
  button('stop', 'Stop the managed development server', () => onStopServer()),
  urlInput,
  button('go', 'Navigate all devices', () => navigateAll(urlInput.value.trim())),
  button('◀', 'Back', () => focused()?.sessionId && void client?.api('POST', `/sessions/${focused()!.sessionId}/back`, {})),
  button('▶', 'Forward', () => focused()?.sessionId && void client?.api('POST', `/sessions/${focused()!.sessionId}/forward`, {})),
  button('⟳', 'Reload all', () => void client?.api('POST', '/reload-all', {})),
  el('span', 'toolbar-sep'),
  button('+ device', 'Add a device preview', () => vscode.postMessage({ type: 'pickDevice' })),
  button('rotate', 'Rotate focused device', () => focused() && rotate(focused()!.sessionId)),
  navSync,
  scrollSync,
  interactSync,
  el('span', 'toolbar-sep'),
  button('inspect', 'Toggle inspect mode (click an element for details)', () => toggleInspect()),
  button('📷', 'Capture screenshots of all devices', () => captureAll()),
  button('trace', 'Start/stop trace for the focused device', () => toggleTrace()),
  button('smoke', 'Run responsive smoke test', () => vscode.postMessage({ type: 'runSmoke' })),
  button('watch', 'Start/stop agent watch', () => toggleWatch()),
  el('span', 'toolbar-sep'),
  engineIndicator,
  healthIndicator,
  drawerToggle,
);

// Drawer: tabs
const tabsBar = el('div', 'tabs');
tabsBar.setAttribute('role', 'tablist');
const panels: Record<string, HTMLElement> = {
  console: el('div', 'tab-panel'),
  network: el('div', 'tab-panel'),
  inspector: el('div', 'tab-panel'),
  reports: el('div', 'tab-panel'),
};
let activeTab = 'console';
for (const name of Object.keys(panels)) {
  const tab = el('button', 'tab', name);
  tab.setAttribute('role', 'tab');
  tab.addEventListener('click', () => {
    activeTab = name;
    for (const [key, panel] of Object.entries(panels)) {
      panel.hidden = key !== name;
      tabsBar.querySelectorAll('.tab').forEach((t) => t.classList.toggle('tab-active', t.textContent === name));
    }
    if (name === 'reports') void refreshReports();
  });
  tabsBar.appendChild(tab);
}
drawer.appendChild(tabsBar);
for (const [name, panel] of Object.entries(panels)) {
  panel.hidden = name !== activeTab;
  drawer.appendChild(panel);
}
tabsBar.querySelector('.tab')?.classList.add('tab-active');

const consoleList = el('ul', 'event-list');
consoleList.setAttribute('aria-label', 'Console events');
const consoleFilter = el('select') as HTMLSelectElement;
for (const level of ['all', 'error', 'warn', 'info', 'log']) consoleFilter.append(new Option(level, level));
consoleFilter.addEventListener('change', () => {
  consoleList.querySelectorAll('li').forEach((li) => {
    li.hidden = consoleFilter.value !== 'all' && li.dataset.level !== consoleFilter.value;
  });
});
panels.console!.append(consoleFilter, consoleList);

const networkList = el('ul', 'event-list');
networkList.setAttribute('aria-label', 'Network events');
const failedOnlyToggle = el('label', 'sync-toggle');
const failedBox = el('input') as HTMLInputElement;
failedBox.type = 'checkbox';
failedOnlyToggle.append(failedBox, el('span', undefined, 'failures only'));
failedBox.addEventListener('change', () => {
  networkList.querySelectorAll('li').forEach((li) => {
    li.hidden = failedBox.checked && li.dataset.failed !== 'true';
  });
});
panels.network!.append(failedOnlyToggle, networkList);

const inspectorOutput = el('pre', 'inspector-output', 'Enable inspect mode and click an element.');
panels.inspector!.appendChild(inspectorOutput);

const reportsList = el('ul', 'event-list');
panels.reports!.appendChild(reportsList);

function appendEvent(list: HTMLElement, text: string, dataset: Record<string, string> = {}): void {
  const li = el('li', 'event-item', text);
  for (const [key, value] of Object.entries(dataset)) li.dataset[key] = value;
  if (dataset.level && consoleFilter.value !== 'all' && list === consoleList) {
    li.hidden = dataset.level !== consoleFilter.value;
  }
  if (list === networkList && failedBox.checked) li.hidden = dataset.failed !== 'true';
  list.appendChild(li);
  while (list.children.length > 300) list.firstElementChild?.remove();
  list.scrollTop = list.scrollHeight;
}

// ------------------------------------------------------------------ sessions

function focused(): SessionInfo | null {
  if (focusedSessionId && frames.has(focusedSessionId)) return frames.get(focusedSessionId)!.info;
  const first = frames.values().next();
  return first.done ? null : first.value.info;
}

function addFrame(info: SessionInfo): void {
  if (frames.has(info.sessionId)) return;
  const frame = new DeviceFrame(info, client!, {
    onClose: (sessionId) => {
      void client?.closeSession(sessionId).then(() => removeFrame(sessionId));
    },
    onRotate: (sessionId) => rotate(sessionId),
    onInspect: (sessionId, x, y) => void inspectAt(sessionId, x, y),
    onFocus: (sessionId) => {
      focusedSessionId = sessionId;
      grid.querySelectorAll('.device-frame').forEach((node) => {
        node.classList.toggle('frame-focused', (node as HTMLElement).dataset.sessionId === sessionId);
      });
    },
  });
  frame.setInspect(inspectMode);
  frames.set(info.sessionId, frame);
  grid.appendChild(frame.root);
  client!.subscribe(info.sessionId);
  updateGridColumns();
}

function removeFrame(sessionId: string): void {
  client?.unsubscribe(sessionId);
  frames.get(sessionId)?.dispose();
  frames.delete(sessionId);
  updateGridColumns();
}

function updateGridColumns(): void {
  grid.style.setProperty('--frame-count', String(Math.max(frames.size, 1)));
}

function rotate(sessionId: string): void {
  void client
    ?.api('POST', `/sessions/${sessionId}/rotate`, {})
    .then(async () => {
      const { session } = await client!.api<{ session: SessionInfo }>('GET', `/sessions/${sessionId}`);
      frames.get(sessionId)?.update(session);
    })
    .catch((err) => toast(String(err.message), true));
}

async function inspectAt(sessionId: string, x: number, y: number): Promise<void> {
  try {
    const res = await client!.api<{ element: unknown }>('POST', `/sessions/${sessionId}/inspect`, { x, y });
    inspectorOutput.textContent = JSON.stringify(res.element, null, 2) ?? 'nothing at that point';
    drawer.hidden = false;
    activeTab = 'inspector';
    for (const [key, panel] of Object.entries(panels)) panel.hidden = key !== 'inspector';
    tabsBar.querySelectorAll('.tab').forEach((t) => t.classList.toggle('tab-active', t.textContent === 'inspector'));
  } catch (err) {
    toast(String((err as Error).message), true);
  }
}

function toggleInspect(): void {
  inspectMode = !inspectMode;
  for (const frame of frames.values()) frame.setInspect(inspectMode);
  statusLine.textContent = inspectMode ? 'Inspect mode: click an element in any preview' : '';
}

async function captureAll(): Promise<void> {
  for (const frame of frames.values()) {
    try {
      const res = await client!.api<{ artifact: { path: string } }>(
        'POST',
        `/sessions/${frame.info.sessionId}/screenshot`,
        { fullPage: false, format: 'png' },
      );
      toast(`saved ${res.artifact.path}`);
      vscode.postMessage({ type: 'artifactSaved', path: res.artifact.path });
    } catch (err) {
      toast(String((err as Error).message), true);
    }
  }
}

async function toggleTrace(): Promise<void> {
  const target = focused();
  if (!target || !client) return;
  try {
    if (tracingSessions.has(target.sessionId)) {
      const res = await client.api<{ artifact: { path: string } }>('POST', `/sessions/${target.sessionId}/trace/stop`, {});
      tracingSessions.delete(target.sessionId);
      toast(`trace saved: ${res.artifact.path}`);
      vscode.postMessage({ type: 'artifactSaved', path: res.artifact.path });
    } else {
      await client.api('POST', `/sessions/${target.sessionId}/trace/start`, {});
      tracingSessions.add(target.sessionId);
      toast(`trace recording on ${target.device.label}`);
    }
  } catch (err) {
    toast(String((err as Error).message), true);
  }
}

let watchActive = false;
async function toggleWatch(): Promise<void> {
  if (!client) return;
  try {
    if (watchActive) {
      await client.api('POST', '/watch/stop', {});
      watchActive = false;
      statusLine.textContent = 'Agent watch stopped';
    } else {
      if (!workspaceTrusted) {
        toast('Workspace is untrusted — watch requires trust', true);
        return;
      }
      await client.api('POST', '/watch/start', {});
      watchActive = true;
      statusLine.textContent = 'Agent watch active — reports appear in the reports tab';
    }
  } catch (err) {
    toast(String((err as Error).message), true);
  }
}

async function refreshReports(): Promise<void> {
  if (!client) return;
  try {
    const res = await client.api<{ reports: Array<{ reportId: string; status: string; kind: string; completedAt: number }> }>(
      'GET',
      '/watch/changes?limit=20',
    );
    reportsList.textContent = '';
    if (res.reports.length === 0) {
      appendEvent(reportsList, 'No change reports yet. Start agent watch and edit a source file.');
      return;
    }
    for (const report of res.reports) {
      const li = el('li', 'event-item report-item', `${new Date(report.completedAt).toLocaleTimeString()} · ${report.reportId} · ${report.status.toUpperCase()}`);
      li.tabIndex = 0;
      li.addEventListener('click', () => vscode.postMessage({ type: 'openReport', reportId: report.reportId }));
      reportsList.appendChild(li);
    }
  } catch (err) {
    appendEvent(reportsList, `reports unavailable: ${String((err as Error).message)}`);
  }
}

// ------------------------------------------------------------------ servers

async function refreshServers(): Promise<void> {
  if (!client) return;
  try {
    const res = await client.detectServers();
    serverSelect.textContent = '';
    serverSelect.append(new Option(res.servers.length ? 'select a server…' : 'no servers detected', ''));
    for (const server of res.servers) {
      serverSelect.append(new Option(`${server.framework}: npm run ${server.script} (${server.packageDir})`, JSON.stringify(server)));
    }
  } catch {}
}

function onStartServer(): void {
  if (!workspaceTrusted) {
    toast('Workspace is untrusted — starting servers requires trust', true);
    return;
  }
  const raw = serverSelect.value;
  if (!raw) {
    toast('Select a detected server first, or use attach with a URL', true);
    return;
  }
  const server = JSON.parse(raw) as DetectedServer;
  statusLine.textContent = `starting npm run ${server.script}…`;
  void client!
    .api<{ url?: string }>('POST', '/server/start', { script: server.script, packageDir: server.packageDir })
    .then((res) => {
      statusLine.textContent = `server running at ${res.url}`;
      if (res.url) {
        urlInput.value = res.url;
        navigateAll(res.url);
      }
    })
    .catch((err) => {
      statusLine.textContent = '';
      toast(`server failed: ${String(err.message)}`, true);
    });
}

function onAttach(): void {
  const url = urlInput.value.trim() || settings?.defaultUrl || '';
  if (!url) {
    toast('Enter a URL first', true);
    return;
  }
  void client!
    .api('POST', '/server/attach', { url })
    .then(() => {
      statusLine.textContent = `attached to ${url}`;
      navigateAll(url);
    })
    .catch((err) => toast(String(err.message), true));
}

function onStopServer(): void {
  void client!
    .api('POST', '/server/stop', {})
    .then(() => (statusLine.textContent = 'server stopped'))
    .catch((err) => toast(String(err.message), true));
}

// --------------------------------------------------------------- init + wire

async function boot(init: InitMessage): Promise<void> {
  settings = init.settings;
  workspaceTrusted = init.workspaceTrusted;
  settingsSync.navigation = init.settings.syncNavigation;
  settingsSync.scroll = init.settings.syncScroll;
  settingsSync.interaction = init.settings.syncInteraction;
  ((navSync as HTMLElement & { _box?: HTMLInputElement })._box!).checked = settingsSync.navigation;
  ((scrollSync as HTMLElement & { _box?: HTMLInputElement })._box!).checked = settingsSync.scroll;
  ((interactSync as HTMLElement & { _box?: HTMLInputElement })._box!).checked = settingsSync.interaction;
  urlInput.value = init.settings.defaultUrl;

  client = new WebviewRuntimeClient(init.runtime, init.settings.frameRate);
  client.onConnectionChange = (connected) => {
    healthIndicator.textContent = connected ? '● runtime' : '○ reconnecting';
    healthIndicator.classList.toggle('indicator-bad', !connected);
  };
  client.onMessage = (msg: ServerMessage) => {
    switch (msg.type) {
      case 'frame':
        frames.get(msg.sessionId)?.drawFrame(msg);
        break;
      case 'sessionUpdate': {
        const frame = frames.get(msg.sessionId);
        if (frame) {
          frame.update({ url: msg.url, state: msg.state, counters: msg.counters });
          if (msg.url && frames.size > 0 && msg.sessionId === (focused()?.sessionId ?? '')) {
            urlInput.value = msg.url;
          }
        }
        break;
      }
      case 'event': {
        const stamp = new Date().toLocaleTimeString();
        const device = frames.get(msg.sessionId)?.info.device.label ?? msg.sessionId;
        if (msg.eventType === 'console' || msg.eventType === 'pageError') {
          appendEvent(consoleList, `${stamp} [${device}] ${msg.eventType === 'pageError' ? 'EXCEPTION' : msg.level}: ${msg.summary}`, {
            level: msg.eventType === 'pageError' ? 'error' : (msg.level ?? 'log'),
          });
        } else if (msg.eventType === 'network' || msg.eventType === 'websocket') {
          const failed = /→ (4\d\d|5\d\d|[a-z_]*failed|net::)/i.test(msg.summary);
          appendEvent(networkList, `${stamp} [${device}] ${msg.summary}`, { failed: String(failed) });
        }
        break;
      }
      case 'error':
        toast(`${msg.code}: ${msg.message}`, true);
        break;
    }
  };
  client.connect();
  await client.api('POST', '/sync', settingsSync).catch(() => {});

  // Adopt existing sessions or create defaults.
  try {
    const { sessions } = await client.listSessions();
    if (sessions.length > 0) {
      for (const session of sessions) addFrame(session);
    } else {
      for (const device of init.settings.defaultDevices) {
        try {
          const { session } = await client.createSession(device);
          addFrame(session);
        } catch (err) {
          toast(`could not create ${device}: ${String((err as Error).message)}`, true);
        }
      }
    }
  } catch (err) {
    toast(String((err as Error).message), true);
  }
  void refreshServers();
  vscode.postMessage({ type: 'booted', sessionCount: frames.size });
}

window.addEventListener('message', (event) => {
  const msg = event.data as { type: string } & Record<string, unknown>;
  switch (msg.type) {
    case 'init':
      void boot(msg as unknown as InitMessage);
      break;
    case 'addDevice':
      void client?.createSession(String(msg.device)).then(({ session }) => addFrame(session));
      break;
    case 'removeDevice':
      if (typeof msg.sessionId === 'string') removeFrame(msg.sessionId);
      else if (focused()) {
        const sessionId = focused()!.sessionId;
        void client?.closeSession(sessionId).then(() => removeFrame(sessionId));
      }
      break;
    case 'toggleInspect':
      toggleInspect();
      break;
    case 'captureScreenshots':
      void captureAll();
      break;
    case 'navigate':
      if (typeof msg.url === 'string') {
        urlInput.value = msg.url;
        navigateAll(msg.url);
      }
      break;
    case 'reloadAll':
      void client?.api('POST', '/reload-all', {});
      break;
    case 'trustChanged':
      workspaceTrusted = Boolean(msg.trusted);
      break;
    case 'smokeResult':
      statusLine.textContent = String(msg.summary ?? '');
      break;
    case 'watchStateChanged':
      watchActive = Boolean(msg.active);
      break;
  }
});

vscode.postMessage({ type: 'ready' });
