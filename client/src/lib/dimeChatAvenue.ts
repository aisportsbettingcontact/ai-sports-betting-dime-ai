/**
 * Dime Chat — avenue scoping (spec: docs/specs/chat-avenue-toggle-spec.md)
 * ════════════════════════════════════════════════════════════════════════
 * Shared model for the 3-segment chat avenue toggle (AI MODEL PROJECTIONS /
 * BETTING SPLITS / ODDS + LINE MOVEMENT). Owns:
 *   • the avenue union + display metadata (full label, compact label,
 *     scope suffix),
 *   • localStorage persistence (`dime.chat.avenue`, SSR/no-storage safe),
 *   • message scoping — the suffix is appended to the OUTGOING text and is
 *     visible in the user's sent bubble (transparency requirement: never
 *     silently send something different from what the user appears to have
 *     said),
 *   • the POST /api/dime/chat body shape, which carries a forward-compatible
 *     `avenue` field the server currently ignores (native per-avenue
 *     retrievers ship separately — server/ and ml/ are governance-pinned).
 */

export type DimeChatAvenue =
  | "model_projections"
  | "betting_splits"
  | "odds_line_movement";

export interface DimeChatAvenueMeta {
  id: DimeChatAvenue;
  /** Full uppercase segment label (desktop/tablet widths). */
  label: string;
  /** Compressed label for narrow widths — segments never wrap to two lines. */
  compactLabel: string;
  /**
   * Appended verbatim to the outgoing message text. Wording is chosen to
   * engage the existing server-side answer router's text classification
   * today, before the native `avenue` channel is honored.
   */
  scopeSuffix: string;
}

export const DIME_CHAT_AVENUE_STORAGE_KEY = "dime.chat.avenue";

export const DEFAULT_DIME_CHAT_AVENUE: DimeChatAvenue = "model_projections";

export const DIME_CHAT_AVENUES: readonly DimeChatAvenueMeta[] = [
  {
    id: "model_projections",
    label: "AI MODEL PROJECTIONS",
    compactLabel: "PROJECTIONS",
    scopeSuffix: " — scope: today's model projections slate",
  },
  {
    id: "betting_splits",
    label: "BETTING SPLITS",
    compactLabel: "SPLITS",
    scopeSuffix: " — scope: betting splits (bets % and money %)",
  },
  {
    id: "odds_line_movement",
    label: "ODDS + LINE MOVEMENT",
    compactLabel: "ODDS + LINES",
    scopeSuffix: " — scope: odds history and line movement",
  },
];

/** Minimal storage surface so tests can stub without a DOM. */
export interface DimeAvenueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): DimeAvenueStorage | null {
  try {
    // `typeof` guard keeps this safe under SSR / node test environments;
    // the try/catch covers browsers that throw on localStorage access.
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function isDimeChatAvenue(value: unknown): value is DimeChatAvenue {
  return DIME_CHAT_AVENUES.some(meta => meta.id === value);
}

export function getDimeChatAvenueMeta(
  avenue: DimeChatAvenue
): DimeChatAvenueMeta {
  const meta = DIME_CHAT_AVENUES.find(entry => entry.id === avenue);
  // The union type makes a miss impossible; the fallback keeps the lookup
  // total without a non-null assertion under strict indexing.
  return meta ?? DIME_CHAT_AVENUES[0];
}

/** Reads the persisted avenue; falls back to the default on SSR, missing
 *  storage, unreadable storage, or an unrecognized stored value. */
export function loadDimeChatAvenue(
  storage: DimeAvenueStorage | null = defaultStorage()
): DimeChatAvenue {
  try {
    const raw = storage?.getItem(DIME_CHAT_AVENUE_STORAGE_KEY);
    return isDimeChatAvenue(raw) ? raw : DEFAULT_DIME_CHAT_AVENUE;
  } catch {
    return DEFAULT_DIME_CHAT_AVENUE;
  }
}

/** Persists the avenue; silently a no-op on SSR or unwritable storage. */
export function saveDimeChatAvenue(
  avenue: DimeChatAvenue,
  storage: DimeAvenueStorage | null = defaultStorage()
): void {
  try {
    storage?.setItem(DIME_CHAT_AVENUE_STORAGE_KEY, avenue);
  } catch {
    // Quota/security errors are non-fatal — the toggle just won't persist.
  }
}

/**
 * Appends the avenue's scope suffix to the outgoing message text. Idempotent:
 * a message that already carries the suffix (e.g. a retried send) is returned
 * unchanged, so the suffix never stacks.
 */
export function applyDimeAvenueScope(
  messageText: string,
  avenue: DimeChatAvenue
): string {
  // Idempotent across ALL avenues: a retried message that already carries any
  // known scope suffix is returned unchanged, even if the toggle moved
  // between attempts — suffixes never stack or mix.
  if (DIME_CHAT_AVENUES.some(meta => messageText.endsWith(meta.scopeSuffix))) {
    return messageText;
  }
  return `${messageText}${getDimeChatAvenueMeta(avenue).scopeSuffix}`;
}

export interface DimeChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface DimeChatRequestBody {
  messages: DimeChatMessage[];
  /** Forward-compatible native channel — ignored by the server today. */
  avenue: DimeChatAvenue;
}

/** POST /api/dime/chat body: BOTH `messages` and the `avenue` field. */
export function buildDimeChatRequestBody(
  messages: readonly DimeChatMessage[],
  avenue: DimeChatAvenue
): DimeChatRequestBody {
  return { messages: [...messages], avenue };
}
