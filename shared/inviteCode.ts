/**
 * shared/inviteCode.ts
 *
 * Compact invite-link codec, shared by the server (builds the URL in
 * appUsers.createUser) and the client (/invite/:code route parses it).
 *
 * Format: `<uid base36>.<token base64url>`
 *   e.g.  10096p.Ab3xK9fQ2mZpLr8TnVwYg  →  uid 1680001 + 22-char token
 *
 * The "." separator is URL-safe and appears in neither alphabet
 * (base36: [0-9a-z], base64url: [A-Za-z0-9_-]), so parsing is unambiguous.
 *
 * This encodes ADDRESSING only — the security still lives entirely in the
 * token (128-bit CSPRNG, sha256 at rest, single-use, 7-day TTL) exactly as
 * with the long-form /reset-password links, which remain valid unchanged.
 */

/** 16 CSPRNG bytes → 22 base64url chars. */
export const INVITE_TOKEN_LENGTH = 22;

const CODE_RE = /^([0-9a-z]+)\.([A-Za-z0-9_-]{20,64})$/;

export function buildInviteCode(userId: number, rawToken: string): string {
  return `${userId.toString(36)}.${rawToken}`;
}

export function parseInviteCode(
  code: string
): { uid: number; token: string } | null {
  const m = CODE_RE.exec(code.trim());
  if (!m) return null;
  const uid = parseInt(m[1], 36);
  if (!Number.isSafeInteger(uid) || uid <= 0) return null;
  return { uid, token: m[2] };
}
