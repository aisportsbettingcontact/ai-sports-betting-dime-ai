/**
 * logSafe — sanitize request-derived values before they reach log lines.
 *
 * Log injection (CodeQL js/log-injection, 63 open findings 2026-08-05): a
 * value an attacker controls (email, path, header, OAuth state, Discord
 * username…) that reaches console output with embedded `\n`/`\r` can forge
 * whole log lines — poisoning the structured `[TAG][LEVEL]` stream that the
 * Discord security-alert pipeline and the ops runbooks parse, or burying a
 * real alert under fake ones.
 *
 * One choke point: CR/LF/TAB become visible escapes, every other C0/C1
 * control character (incl. ANSI ESC — terminal-sequence smuggling) becomes
 * "?", and the value is length-capped so a megabyte payload cannot flood
 * the log transport. The `.replace()` shape is deliberately the pattern
 * CodeQL recognizes as a log-injection sanitizer.
 */

// eslint-disable-next-line no-control-regex
const OTHER_CONTROL_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

export const LOG_SAFE_MAX_LENGTH = 300;

export function logSafe(
  value: unknown,
  maxLength = LOG_SAFE_MAX_LENGTH
): string {
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else if (value instanceof Error) {
    text = value.message;
  } else {
    try {
      text = String(value);
    } catch {
      return "[unstringifiable]";
    }
  }
  const sanitized = text
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(OTHER_CONTROL_CHARS, "?");
  return sanitized.length > maxLength
    ? `${sanitized.slice(0, maxLength)}…[+${sanitized.length - maxLength}]`
    : sanitized;
}
