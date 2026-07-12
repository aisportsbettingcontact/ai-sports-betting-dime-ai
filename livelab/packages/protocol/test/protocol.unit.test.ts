import { describe, expect, it } from 'vitest';
import {
  CreateSessionRequestSchema,
  DEVICE_PRESETS,
  DeviceConfigSchema,
  ERROR_CODES,
  InputEventSchema,
  LiveLabError,
  PROTOCOL_VERSION,
  RuntimeDiscoverySchema,
  WorkspaceConfigSchema,
  errorKind,
  findDevicePreset,
  isCompatibleProtocol,
  redactHeaders,
  redactText,
  redactUrl,
} from '../src';

describe('protocol version negotiation', () => {
  it('accepts same-major versions', () => {
    expect(isCompatibleProtocol(PROTOCOL_VERSION)).toBe(true);
    expect(isCompatibleProtocol('1.99.7')).toBe(true);
  });
  it('rejects different-major and garbage versions', () => {
    expect(isCompatibleProtocol('2.0.0')).toBe(false);
    expect(isCompatibleProtocol('nonsense')).toBe(false);
    expect(isCompatibleProtocol('')).toBe(false);
  });
});

describe('device presets', () => {
  it('ships the ten spec presets with exact viewports', () => {
    const expected: Array<[string, number, number]> = [
      ['iphone-13-mini', 375, 812],
      ['iphone-16', 393, 852],
      ['iphone-16-plus', 430, 932],
      ['android-compact', 360, 800],
      ['android-standard', 412, 915],
      ['ipad-mini-portrait', 744, 1133],
      ['ipad-landscape', 1133, 744],
      ['laptop-1366', 1366, 768],
      ['desktop-1440', 1440, 900],
      ['desktop-1728', 1728, 1117],
    ];
    expect(DEVICE_PRESETS).toHaveLength(expected.length);
    for (const [id, width, height] of expected) {
      const preset = findDevicePreset(id);
      expect(preset, id).toBeDefined();
      expect([preset!.width, preset!.height]).toEqual([width, height]);
      expect(DeviceConfigSchema.safeParse(preset).success).toBe(true);
    }
  });
  it('rejects absurd custom devices', () => {
    expect(DeviceConfigSchema.safeParse({ id: 'x', label: 'x', kind: 'phone', width: 10, height: 10 }).success).toBe(false);
  });
});

describe('session/input schemas', () => {
  it('parses a minimal create-session request with defaults', () => {
    const parsed = CreateSessionRequestSchema.parse({ device: 'iphone-16' });
    expect(parsed.engine).toBe('chromium');
  });
  it('rejects non-URL initial url', () => {
    expect(CreateSessionRequestSchema.safeParse({ device: 'iphone-16', url: 'not a url' }).success).toBe(false);
  });
  it('rejects unknown input event shapes (never executes unrecognized messages)', () => {
    expect(InputEventSchema.safeParse({ inputType: 'shell', event: { cmd: 'rm -rf /' } }).success).toBe(false);
    expect(InputEventSchema.safeParse({ inputType: 'mouse', event: { kind: 'click', x: -5, y: 10 } }).success).toBe(false);
  });
  it('accepts valid mouse input with defaults', () => {
    const parsed = InputEventSchema.parse({ inputType: 'mouse', event: { kind: 'click', x: 10, y: 20 } });
    expect(parsed.inputType).toBe('mouse');
    if (parsed.inputType === 'mouse') expect(parsed.event.button).toBe('left');
  });
});

describe('workspace config', () => {
  it('fills documented defaults', () => {
    const config = WorkspaceConfigSchema.parse({});
    expect(config.routes).toEqual(['/']);
    expect(config.watch.quietWindowMs).toBe(500);
    expect(config.watch.maxSettleMs).toBe(10_000);
    expect(config.visual.threshold).toBeCloseTo(0.15);
  });
  it('rejects routes that do not start with /', () => {
    expect(WorkspaceConfigSchema.safeParse({ routes: ['nope'] }).success).toBe(false);
  });
  it('rejects script names with shell metacharacters', () => {
    expect(WorkspaceConfigSchema.safeParse({ scripts: ['dev && rm -rf /'] }).success).toBe(false);
  });
});

describe('discovery record', () => {
  it('requires loopback host and a strong token', () => {
    const base = {
      protocolVersion: '1.0.0',
      runtimeVersion: '0.1.0',
      runtimeId: 'rt_x',
      workspaceId: 'w',
      workspaceRoot: '/tmp/x',
      pid: 123,
      port: 4242,
      token: 'a'.repeat(64),
      startedAt: Date.now(),
      owner: 'headless' as const,
    };
    expect(RuntimeDiscoverySchema.safeParse({ ...base, host: '127.0.0.1' }).success).toBe(true);
    expect(RuntimeDiscoverySchema.safeParse({ ...base, host: '0.0.0.0' }).success).toBe(false);
    expect(RuntimeDiscoverySchema.safeParse({ ...base, host: '127.0.0.1', token: 'short' }).success).toBe(false);
  });
});

describe('redaction', () => {
  it('redacts sensitive headers case-insensitively and scrubs values', () => {
    const out = redactHeaders(
      { Authorization: 'Bearer abc123456789000', 'X-API-Key': 'k', accept: 'text/html' },
      ['authorization', 'x-api-key'],
    );
    expect(out.Authorization).toBe('[REDACTED]');
    expect(out['X-API-Key']).toBe('[REDACTED]');
    expect(out.accept).toBe('text/html');
  });
  it('redacts sensitive query parameters and credentials in URLs', () => {
    const out = redactUrl('http://user:pass@localhost:3000/a?token=SECRET&x=1', ['token']);
    expect(out).not.toContain('SECRET');
    expect(out).not.toContain('pass@');
    expect(out).toContain('x=1');
  });
  it('scrubs bearer tokens, API keys, and JWTs from free text', () => {
    expect(redactText('Authorization: Bearer sk-abc123def456ghi789')).not.toContain('sk-abc');
    expect(redactText('key sk-ant-abcdefghij1234567890')).not.toContain('sk-ant-abcdefghij');
    // Synthetic JWT assembled at runtime so no token-shaped literal exists in
    // source (keeps secret scanners quiet while still exercising the pattern).
    const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const jwt = [b64({ alg: 'HS256', typ: 'JWT' }), b64({ sub: 'livelab-test', iat: 0 }), 'x'.repeat(43)].join('.');
    expect(redactText(`jwt ${jwt}`)).not.toContain(jwt);
  });
});

describe('error taxonomy', () => {
  it('classifies infrastructure vs validation vs application', () => {
    expect(errorKind(ERROR_CODES.RUNTIME_UNAVAILABLE)).toBe('infrastructure');
    expect(errorKind(ERROR_CODES.HOST_NOT_ALLOWED)).toBe('validation');
    expect(errorKind(ERROR_CODES.NAVIGATION_FAILED)).toBe('application');
    const err = new LiveLabError(ERROR_CODES.SETTLE_TIMEOUT, 'x');
    expect(err.toJSON()).toMatchObject({ code: 'SETTLE_TIMEOUT', kind: 'application' });
  });
});
