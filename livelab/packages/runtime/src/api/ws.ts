import type * as http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { ClientMessageSchema, ServerMessage } from '@livelab/protocol';
import type { RuntimeCore } from '../core';

/**
 * WebSocket hub: streams screencast frames + event digests to subscribed
 * clients (the webview) and accepts validated input events. Token-gated at
 * upgrade time; malformed messages are rejected, never executed.
 */
export function attachWebSocket(server: http.Server, core: RuntimeCore): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    const token = url.searchParams.get('token') ?? (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!token || !core.checkToken(token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket) => {
    const subscriptions = new Map<string, () => void>();
    const sendMsg = (msg: ServerMessage) => {
      if (ws.readyState === WebSocket.OPEN) {
        // Backpressure guard: drop frames rather than queueing unbounded data.
        if (msg.type === 'frame' && ws.bufferedAmount > 2 * 1024 * 1024) return;
        ws.send(JSON.stringify(msg));
      }
    };

    // Session lifecycle/event digests for any subscribed session.
    const unsubscribeEvents = core.sessions.onEvent((event) => {
      if (!subscriptions.has(event.sessionId)) return;
      const summary =
        event.type === 'console'
          ? event.text.slice(0, 160)
          : event.type === 'pageError'
            ? event.message.slice(0, 160)
            : event.type === 'network'
              ? `${event.method} ${event.url.slice(0, 120)} → ${event.status ?? event.failureText ?? '…'}`
              : event.type === 'websocket'
                ? `${event.event} ${event.url.slice(0, 100)}`
                : `${event.event}${event.url ? ` ${event.url.slice(0, 100)}` : ''}`;
      sendMsg({
        type: 'event',
        sessionId: event.sessionId,
        eventType: event.type,
        seq: event.seq,
        summary,
        level: event.type === 'console' ? event.level : undefined,
      });
      if (event.type === 'lifecycle' && (event.event === 'navigation' || event.event === 'load')) {
        const session = core.sessions.maybeGet(event.sessionId);
        if (session) {
          sendMsg({
            type: 'sessionUpdate',
            sessionId: event.sessionId,
            url: session.lastUrl,
            state: session.state,
            counters: { ...session.counters },
          });
        }
      }
    });

    ws.on('message', async (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(raw));
      } catch {
        sendMsg({ type: 'error', code: 'INVALID_INPUT', message: 'not JSON' });
        return;
      }
      const message = ClientMessageSchema.safeParse(parsed);
      if (!message.success) {
        sendMsg({ type: 'error', code: 'INVALID_INPUT', message: 'unrecognized message' });
        return;
      }
      const msg = message.data;
      try {
        switch (msg.type) {
          case 'ping':
            sendMsg({ type: 'pong' });
            break;
          case 'subscribe': {
            if (subscriptions.has(msg.sessionId)) break;
            const session = core.sessions.get(msg.sessionId);
            const unsubscribe = session.onFrame(
              (frame) =>
                sendMsg({
                  type: 'frame',
                  sessionId: frame.sessionId,
                  data: frame.data,
                  width: frame.width,
                  height: frame.height,
                  mode: frame.mode,
                  timestamp: frame.timestamp,
                }),
              { maxFps: msg.maxFps, quality: msg.quality },
            );
            subscriptions.set(msg.sessionId, unsubscribe);
            sendMsg({
              type: 'sessionUpdate',
              sessionId: msg.sessionId,
              url: session.lastUrl,
              state: session.state,
              counters: { ...session.counters },
            });
            break;
          }
          case 'unsubscribe': {
            subscriptions.get(msg.sessionId)?.();
            subscriptions.delete(msg.sessionId);
            break;
          }
          case 'input':
            await core.sessions.dispatchInput(msg.sessionId, msg.input);
            break;
        }
      } catch (err) {
        sendMsg({
          type: 'error',
          code: (err as { code?: string }).code ?? 'INTERNAL',
          message: String((err as Error).message ?? err).slice(0, 300),
        });
      }
    });

    ws.on('close', () => {
      for (const unsubscribe of subscriptions.values()) unsubscribe();
      subscriptions.clear();
      unsubscribeEvents();
    });
  });

  return wss;
}
