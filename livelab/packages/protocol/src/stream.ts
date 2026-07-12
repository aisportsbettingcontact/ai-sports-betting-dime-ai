import { z } from 'zod';
import { InputEventSchema } from './input';

/**
 * WebSocket messages between webview/clients and the runtime.
 * Client→runtime messages are strictly validated; unknown types are rejected
 * and logged, never executed.
 */
export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('subscribe'),
    sessionId: z.string(),
    /** Max frames per second the client wants (server clamps). */
    maxFps: z.number().int().min(1).max(30).default(10),
    quality: z.number().int().min(10).max(90).default(60),
  }),
  z.object({ type: z.literal('unsubscribe'), sessionId: z.string() }),
  z.object({
    type: z.literal('input'),
    sessionId: z.string(),
    input: InputEventSchema,
  }),
  z.object({ type: z.literal('ping') }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('frame'),
    sessionId: z.string(),
    /** Base64 JPEG. */
    data: z.string(),
    width: z.number(),
    height: z.number(),
    /** Producer: cdp-screencast or screenshot-poll. */
    mode: z.enum(['cdp-screencast', 'screenshot-poll']),
    timestamp: z.number(),
  }),
  z.object({
    type: z.literal('sessionUpdate'),
    sessionId: z.string(),
    url: z.string().optional(),
    title: z.string().optional(),
    state: z.enum(['starting', 'ready', 'crashed', 'closed']).optional(),
    counters: z
      .object({
        consoleErrors: z.number(),
        consoleWarnings: z.number(),
        pageErrors: z.number(),
        failedRequests: z.number(),
      })
      .optional(),
  }),
  z.object({
    type: z.literal('event'),
    sessionId: z.string(),
    eventType: z.enum(['console', 'pageError', 'network', 'lifecycle', 'websocket']),
    seq: z.number(),
    summary: z.string(),
    level: z.string().optional(),
  }),
  z.object({ type: z.literal('pong') }),
  z.object({
    type: z.literal('error'),
    code: z.string(),
    message: z.string(),
  }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
