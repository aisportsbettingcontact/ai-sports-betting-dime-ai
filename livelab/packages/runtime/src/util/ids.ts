import { randomBytes, createHash } from 'node:crypto';

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString('base64url')}`;
}

export function newToken(): string {
  return randomBytes(32).toString('hex');
}

/** Deterministic workspace identity derived from its absolute path. */
export function workspaceIdFor(workspaceRoot: string): string {
  return createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 16);
}
