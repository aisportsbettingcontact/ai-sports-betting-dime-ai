/**
 * Stable machine-readable error codes for every boundary.
 * `kind` distinguishes infrastructure failures (LiveLab's fault / environment)
 * from application failures (the page under test misbehaving) so agents can
 * report accurately.
 */
export const ERROR_CODES = {
  // Infrastructure
  RUNTIME_UNAVAILABLE: 'RUNTIME_UNAVAILABLE',
  RUNTIME_STARTING: 'RUNTIME_STARTING',
  PROTOCOL_MISMATCH: 'PROTOCOL_MISMATCH',
  UNAUTHORIZED: 'UNAUTHORIZED',
  BROWSER_LAUNCH_FAILED: 'BROWSER_LAUNCH_FAILED',
  BROWSER_NOT_INSTALLED: 'BROWSER_NOT_INSTALLED',
  CAPABILITY_UNSUPPORTED: 'CAPABILITY_UNSUPPORTED',
  INTERNAL: 'INTERNAL',
  // Validation / policy
  INVALID_INPUT: 'INVALID_INPUT',
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  ARTIFACT_NOT_FOUND: 'ARTIFACT_NOT_FOUND',
  REPORT_NOT_FOUND: 'REPORT_NOT_FOUND',
  HOST_NOT_ALLOWED: 'HOST_NOT_ALLOWED',
  SCRIPT_NOT_ALLOWED: 'SCRIPT_NOT_ALLOWED',
  PATH_NOT_ALLOWED: 'PATH_NOT_ALLOWED',
  WORKSPACE_UNTRUSTED: 'WORKSPACE_UNTRUSTED',
  LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',
  // Application-side
  NAVIGATION_FAILED: 'NAVIGATION_FAILED',
  TARGET_NOT_FOUND: 'TARGET_NOT_FOUND',
  SETTLE_TIMEOUT: 'SETTLE_TIMEOUT',
  ASSERTION_FAILED: 'ASSERTION_FAILED',
  BASELINE_MISSING: 'BASELINE_MISSING',
  BASELINE_INVALIDATED: 'BASELINE_INVALIDATED',
  DEV_SERVER_FAILED: 'DEV_SERVER_FAILED',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export type ErrorKind = 'infrastructure' | 'validation' | 'application';

export interface LiveLabErrorShape {
  code: ErrorCode;
  kind: ErrorKind;
  message: string;
  details?: unknown;
}

const KIND_BY_CODE: Record<ErrorCode, ErrorKind> = {
  RUNTIME_UNAVAILABLE: 'infrastructure',
  RUNTIME_STARTING: 'infrastructure',
  PROTOCOL_MISMATCH: 'infrastructure',
  UNAUTHORIZED: 'infrastructure',
  BROWSER_LAUNCH_FAILED: 'infrastructure',
  BROWSER_NOT_INSTALLED: 'infrastructure',
  CAPABILITY_UNSUPPORTED: 'infrastructure',
  INTERNAL: 'infrastructure',
  INVALID_INPUT: 'validation',
  SESSION_NOT_FOUND: 'validation',
  ARTIFACT_NOT_FOUND: 'validation',
  REPORT_NOT_FOUND: 'validation',
  HOST_NOT_ALLOWED: 'validation',
  SCRIPT_NOT_ALLOWED: 'validation',
  PATH_NOT_ALLOWED: 'validation',
  WORKSPACE_UNTRUSTED: 'validation',
  LIMIT_EXCEEDED: 'validation',
  NAVIGATION_FAILED: 'application',
  TARGET_NOT_FOUND: 'application',
  SETTLE_TIMEOUT: 'application',
  ASSERTION_FAILED: 'application',
  BASELINE_MISSING: 'application',
  BASELINE_INVALIDATED: 'application',
  DEV_SERVER_FAILED: 'application',
};

export function errorKind(code: ErrorCode): ErrorKind {
  return KIND_BY_CODE[code];
}

export class LiveLabError extends Error {
  readonly code: ErrorCode;
  readonly kind: ErrorKind;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'LiveLabError';
    this.code = code;
    this.kind = errorKind(code);
    this.details = details;
  }

  toJSON(): LiveLabErrorShape {
    return { code: this.code, kind: this.kind, message: this.message, details: this.details };
  }
}
