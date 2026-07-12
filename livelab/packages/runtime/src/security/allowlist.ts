import { LiveLabError, ERROR_CODES } from '@livelab/protocol';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);

/**
 * URL policy: default-deny remote hosts. Only http(s) URLs whose hostname is
 * on the allowlist may be navigated to. `about:blank` is permitted.
 */
export function assertUrlAllowed(rawUrl: string, allowedHosts: string[]): URL {
  if (rawUrl === 'about:blank') return new URL('about:blank');
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new LiveLabError(ERROR_CODES.INVALID_INPUT, `Not a valid URL: ${rawUrl}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new LiveLabError(
      ERROR_CODES.HOST_NOT_ALLOWED,
      `Protocol ${url.protocol} is not allowed. Only http/https URLs can be previewed.`,
    );
  }
  const host = url.hostname.toLowerCase();
  const allowed = new Set(allowedHosts.map((h) => h.toLowerCase()));
  for (const local of LOCAL_HOSTS) allowed.add(local);
  // Explicit remote allow requires exact hostname match (no wildcard implicit trust).
  if (!allowed.has(host)) {
    throw new LiveLabError(
      ERROR_CODES.HOST_NOT_ALLOWED,
      `Host "${host}" is not on the allowlist. Add it to livelab.allowedHosts to preview non-local URLs.`,
      { host, allowedHosts: [...allowed] },
    );
  }
  return url;
}

const SCRIPT_NAME_RE = /^[a-zA-Z0-9:_-]+$/;

/** Script policy: only allowlisted npm script names, never shell strings. */
export function assertScriptAllowed(script: string, allowlist: string[]): void {
  if (!SCRIPT_NAME_RE.test(script)) {
    throw new LiveLabError(
      ERROR_CODES.INVALID_INPUT,
      `Invalid script name: ${JSON.stringify(script)}`,
    );
  }
  if (!allowlist.includes(script)) {
    throw new LiveLabError(
      ERROR_CODES.SCRIPT_NOT_ALLOWED,
      `Script "${script}" is not on the managed-scripts allowlist (${allowlist.join(', ')}).`,
      { script, allowlist },
    );
  }
}
