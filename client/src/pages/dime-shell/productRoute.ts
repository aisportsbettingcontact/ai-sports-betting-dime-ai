export type DimeProductPane = "chat" | "feed" | "splits" | "tracker";

export type DimeProductRoute =
  | { pane: "chat" }
  | { pane: "tracker" }
  | { pane: "feed"; sportSegment: string; dateSegment?: string }
  | { pane: "splits"; sportSegment?: string; dateSegment?: string };

const decodeSegment = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/**
 * Classifies only the four authenticated product surfaces owned by the
 * tablet/desktop shell. Validation and canonicalization stay with each
 * surface's existing route parser.
 */
export function parseDimeProductRoute(
  location: string
): DimeProductRoute | null {
  const pathname = location.split(/[?#]/, 1)[0] || "/";
  if (pathname === "/chat") return { pane: "chat" };
  if (pathname === "/bet-tracker") return { pane: "tracker" };
  if (pathname === "/betting-splits") return { pane: "splits" };

  const feed = /^\/feed\/model\/([^/]+)(?:\/([^/]+))?$/.exec(pathname);
  if (feed) {
    return {
      pane: "feed",
      sportSegment: decodeSegment(feed[1])!,
      dateSegment: decodeSegment(feed[2]),
    };
  }

  const splits = /^\/betting-splits\/([^/]+)(?:\/([^/]+))?$/.exec(pathname);
  if (splits) {
    return {
      pane: "splits",
      sportSegment: decodeSegment(splits[1]),
      dateSegment: decodeSegment(splits[2]),
    };
  }

  return null;
}

export function isDimeProductLocation(location: string): boolean {
  return parseDimeProductRoute(location) !== null;
}

/**
 * Chat is the one product surface that must own a stable mount at EVERY
 * viewport width (see DimeAppShell's `mode` prop) — an active SSE stream and
 * the composer draft must survive a resize, not just navigation. Every other
 * pane is shell-owned only when the shared >=768px viewport claims it.
 */
export function isChatLocation(location: string): boolean {
  return parseDimeProductRoute(location)?.pane === "chat";
}
