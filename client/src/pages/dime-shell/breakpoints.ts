/**
 * Single source of truth for the tablet/desktop Dime app-shell boundary.
 *
 * Keep viewport detection behind matchMedia so consumers share the same CSS
 * media-query semantics at the exact 768px boundary. Nothing is evaluated at
 * module load, which keeps server-side imports deterministic.
 */
export const DIME_SHELL_MIN_WIDTH_PX = 768;
export const DIME_SHELL_MEDIA_QUERY = `(min-width: ${DIME_SHELL_MIN_WIDTH_PX}px)`;

export const DIME_SHELL_DEFAULT_PATH = "/chat";
export const MOBILE_DEFAULT_PATH = "/feed/model/mlb";

export type MediaQueryMatcher = (query: string) => { matches: boolean };

function browserMatchMedia(): MediaQueryMatcher | undefined {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return undefined;
  }

  return window.matchMedia.bind(window);
}

export function matchesDimeShellViewport(
  matchMedia: MediaQueryMatcher | undefined = browserMatchMedia()
): boolean {
  return matchMedia?.(DIME_SHELL_MEDIA_QUERY).matches ?? false;
}

function isSafeInternalReturnPath(value: string): boolean {
  return /^\/(?!\/)[^\\\u0000-\u001f\u007f]*$/.test(value);
}

/**
 * Safe internal return paths always win. Missing, external, protocol-relative,
 * backslash-bearing, and malformed values receive the viewport-aware default.
 */
export function resolvePostLoginPath(
  explicitReturnPath: string | null | undefined,
  matchMedia: MediaQueryMatcher | undefined = browserMatchMedia()
): string {
  if (
    explicitReturnPath != null &&
    isSafeInternalReturnPath(explicitReturnPath)
  ) {
    return explicitReturnPath;
  }
  return matchesDimeShellViewport(matchMedia)
    ? DIME_SHELL_DEFAULT_PATH
    : MOBILE_DEFAULT_PATH;
}
