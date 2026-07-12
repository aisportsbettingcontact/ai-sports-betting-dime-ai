/**
 * Shared redaction helpers. Applied by the runtime before persistence and by
 * the MCP server before returning output — secrets must never reach logs,
 * artifacts, or agent context.
 */
const REDACTED = '[REDACTED]';

/** Value patterns that look like credentials regardless of field name. */
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9\-._~+/]{8,}=*/gi,
  /\bBasic\s+[A-Za-z0-9+/]{8,}=*/gi,
  /\bsk-[A-Za-z0-9\-_]{16,}\b/g, // common API secret key shapes
  /\bsk-ant-[A-Za-z0-9\-_]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, // GitHub tokens
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\beyJ[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{5,}\b/g, // JWT
];

export function redactText(text: string): string {
  let out = text;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

export function redactHeaders(
  headers: Record<string, string>,
  redactList: string[],
): Record<string, string> {
  const lowered = new Set(redactList.map((h) => h.toLowerCase()));
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = lowered.has(key.toLowerCase()) ? REDACTED : redactText(value);
  }
  return out;
}

export function redactUrl(rawUrl: string, redactParams: string[]): string {
  try {
    const url = new URL(rawUrl);
    // Never expose embedded credentials.
    if (url.username) url.username = REDACTED;
    if (url.password) url.password = REDACTED;
    const lowered = new Set(redactParams.map((p) => p.toLowerCase()));
    let changed = false;
    for (const key of [...url.searchParams.keys()]) {
      if (lowered.has(key.toLowerCase())) {
        url.searchParams.set(key, REDACTED);
        changed = true;
      }
    }
    void changed;
    return url.toString();
  } catch {
    // Not parseable as URL — apply generic secret scrubbing.
    return redactText(rawUrl);
  }
}

export { REDACTED };
