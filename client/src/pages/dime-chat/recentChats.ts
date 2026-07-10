/**
 * Session-only recent chats (Ph1 — honesty).
 * Titles are derived from the FIRST user message of each conversation started
 * this session (module lifetime, in-memory). No backend, no persistence, no
 * invented data: when nothing has been asked yet, the sidebar renders no
 * RECENT CHATS section at all. The six sample labels in
 * design/frozen/dime-ai-home-{dark,light}.html are design law, never user UI.
 */

export interface RecentChat {
  id: string;
  title: string;
}

const TITLE_MAX = 40;

/** Pure: collapse whitespace and truncate to ~40 chars with a trailing ellipsis. */
export function deriveChatTitle(text: string, max: number = TITLE_MAX): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1).trimEnd()}…`;
}

let sessionRecents: RecentChat[] = [];
let counter = 0;

/** Record a conversation started this session; newest first. */
export function addSessionRecent(firstUserMessage: string): RecentChat {
  const entry: RecentChat = {
    id: `rc-${++counter}`,
    title: deriveChatTitle(firstUserMessage),
  };
  sessionRecents = [entry, ...sessionRecents];
  return entry;
}

export function getSessionRecents(): RecentChat[] {
  return [...sessionRecents];
}

/** Test hook / explicit wipe. Not called by UI flows. */
export function clearSessionRecents(): void {
  sessionRecents = [];
  counter = 0;
}
