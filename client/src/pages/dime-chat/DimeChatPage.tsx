/**
 * Dime AI — Chat page (home + conversation states of the /chat route).
 * Visual source of truth: design/frozen/dime-ai-home-{dark,light}.html — do not restyle.
 * Styles: frozen-tokens.css (verbatim extraction, D:n/L:n cited) +
 *         conversation.css (derived conversation state, spec-cited).
 * Behavior sources:
 *  - SSE streaming core preserved from the previous DimeChat.tsx
 *    (fetch → reader → `data:` frame parse, AbortController, single send path).
 *  - Conversation anatomy / FLIP transition / scroll policy / chrome copy:
 *    scratchpad chat-derivation-spec.md (§ refs in conversation.css).
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  Fragment,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
} from "react";
import { Link } from "wouter";
import { useTheme } from "../../contexts/ThemeContext";
import {
  chatReducer,
  initialChatState,
  type ChatMessage,
  type DataFreshness,
} from "./chatReducer";
import { parseAssistantContent, segmentNumerals, type EdgeBlock } from "./edgeParser";
import { addSessionRecent, getSessionRecents, type RecentChat } from "./recentChats";
import avatarUrl from "./assets/prez-avatar.jpg";
import "./frozen-tokens.css";
import "./conversation.css";

type Theme = "dark" | "light";

/* ----------------------------------------------------------------- */
/* Frozen copy — labels verbatim from D/L:57-71, 106-109              */
/* ----------------------------------------------------------------- */

const NAV_ROWS: Array<{ label: string; href: string; active?: boolean }> = [
  { label: "New Chat", href: "/chat", active: true }, // D/L:57
  { label: "AI Model Projections", href: "/feed" }, // D/L:58 → existing route
  { label: "Betting Splits + Odds History", href: "/betting-splits" }, // D/L:59
  { label: "Trends", href: "#" }, // D/L:60 — no route exists; frozen href="#"
  { label: "Prop Projections", href: "#" }, // D/L:61 — no route exists
  { label: "Bet Tracker", href: "/bet-tracker" }, // D/L:62
];

// Recent chats are session-only and honest (Ph1): titles derive from the first
// user message of conversations started this session (recentChats.ts). The six
// sample labels at D/L:66-71 are design law and are never rendered to users.

const PILL_LABELS = [
  "World Cup Model Simulations",
  "Player Props with the Most Edge",
  "Best Trends for MLB July 7, 2026",
]; // D/L:107-109

/** Frozen pill emphasis ORDER differs per theme (extraction-mapping §2.24). */
const PILL_VARIANTS: Record<Theme, Array<"contrast" | "outline" | "mint">> = {
  dark: ["contrast", "outline", "mint"], // D:107-109
  light: ["mint", "outline", "contrast"], // L:107-109
};

const ERROR_COPY = "Dime couldn't reach the model. Your message is saved above."; // spec §4
const DISCLAIMER = "Model estimates, not guarantees. 21+ · Gambling problem? 1-800-GAMBLER."; // spec §4

const uid = () => Math.random().toString(36).slice(2, 10);

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Client-side diagnostics behind localStorage.DIME_DEBUG === "1" (preserved)
const DEBUG =
  typeof window !== "undefined" && localStorage.getItem("DIME_DEBUG") === "1";
function dimeDebug(event: string, data?: Record<string, unknown>) {
  if (!DEBUG) return;
  console.log(`[DimeChat:DEBUG] ${event}`, data ?? "");
}

/* ----------------------------------------------------------------- */
/* Glyphs — geometry verbatim from D/L:103 (send), D/L:107-109 (pill), */
/* D/L:94 (gear); colors come from frozen-tokens.css theme scopes      */
/* ----------------------------------------------------------------- */

function SendGlyph() {
  return (
    <svg viewBox="0 0 512 512" width="20" height="20" aria-hidden="true">
      <path
        className="dc-send-chevron"
        d="M96 140 L248 256 L96 372"
        fill="none"
        strokeWidth="64"
        strokeLinecap="square"
      />
      <rect className="dc-send-rect" x="330" y="228" width="150" height="56" />
      <rect className="dc-send-rect" x="377" y="181" width="56" height="150" />
    </svg>
  );
}

/** Stop mark: the authorized mint-rect vocabulary of D/L:103, squared (spec §2.9). */
function StopGlyph() {
  return (
    <svg viewBox="0 0 512 512" width="20" height="20" aria-hidden="true">
      <rect className="dc-send-rect" x="166" y="166" width="180" height="180" />
    </svg>
  );
}

function PillGlyph() {
  return (
    <svg viewBox="0 0 512 512" width="13" height="13" aria-hidden="true">
      <path
        className="dc-pill-chevron"
        d="M96 140 L248 256 L96 372"
        fill="none"
        strokeWidth="64"
        strokeLinecap="square"
      />
      <rect className="dc-pill-rect" x="330" y="228" width="150" height="56" />
      <rect className="dc-pill-rect" x="377" y="181" width="56" height="150" />
    </svg>
  );
}

const GEAR_PATH =
  "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"; // D/L:94

/* ----------------------------------------------------------------- */
/* Sidebar — D/L:54-96                                                */
/* ----------------------------------------------------------------- */

function DimeSidebar({
  onNewChat,
  recentChats,
}: {
  onNewChat: () => void;
  recentChats: RecentChat[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!profileRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const inert = (e: ReactMouseEvent) => e.preventDefault();

  return (
    <div className="dc-sidebar">
      <div className="dc-sidebar-title">AI Sports Betting</div>
      <nav className="dc-nav-group" aria-label="Primary">
        {NAV_ROWS.map((row) =>
          row.href === "#" ? (
            <a key={row.label} href="#" className="dc-sidebar-row" onClick={inert}>
              <span className="dc-sidebar-text">{row.label}</span>
            </a>
          ) : (
            <Link
              key={row.label}
              href={row.href}
              className={`dc-sidebar-row${row.active ? " is-active" : ""}`}
              aria-current={row.active ? "page" : undefined}
              onClick={
                row.active
                  ? (e: ReactMouseEvent) => {
                      // Already on /chat: New Chat resets to the home state
                      // instantly (spec §2.7/§3.4), no navigation.
                      e.preventDefault();
                      onNewChat();
                    }
                  : undefined
              }
            >
              {row.active && <span className="dc-sidebar-icon">＋</span>}
              <span className="dc-sidebar-text">{row.label}</span>
            </Link>
          ),
        )}
      </nav>
      {recentChats.length > 0 ? (
        <>
          <div className="dc-recents-label">Recent Chats</div>
          <div className="dc-recent-list">
            {recentChats.map((rc) => (
              <a key={rc.id} href="#" className="dc-sidebar-row" onClick={inert}>
                <span className="dc-sidebar-text">{rc.title}</span>
              </a>
            ))}
          </div>
        </>
      ) : (
        // No conversations yet this session: hide the whole section (honesty —
        // an empty frozen shell must not render). The spacer takes over the
        // recent list's flex: 1 slot (D/L:65) so the profile row stays pinned.
        <div className="dc-sidebar-spacer" />
      )}
      <div
        ref={profileRef}
        className="dc-sidebar-row dc-profile-row"
        role="button"
        tabIndex={0}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setMenuOpen((o) => !o);
          }
        }}
      >
        <img className="dc-avatar" src={avatarUrl} alt="PREZ BETS" />
        <div className="dc-profile-id">
          <div className="dc-profile-name">PREZ BETS</div>
          <div className="dc-profile-tier">Pro</div>
        </div>
        <div
          className={`dc-settings-menu${menuOpen ? " open" : ""}`}
          role="menu"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="dc-menu-header">
            <img className="dc-avatar--menu" src={avatarUrl} alt="@prez" />
            <div className="dc-menu-id">
              <div className="dc-menu-handle-row">
                <div className="dc-menu-handle">@prez</div>
                <div className="dc-badge-pro">PRO</div>
              </div>
              <div className="dc-menu-expiry">Expires August 8, 2026</div>
            </div>
          </div>
          <div className="dc-menu-cta-row">
            <div role="menuitem" tabIndex={0} className="dc-btn-upgrade dc-hv1 dc-focusable">
              Upgrade Membership
            </div>
            <div role="menuitem" tabIndex={0} className="dc-btn-cancel dc-hv2 dc-focusable">
              Cancel Membership
            </div>
          </div>
          <div className="dc-menu-divider" />
          <div role="menuitem" tabIndex={0} className="dc-menu-item dc-hv2 dc-focusable">
            Edit Profile
          </div>
          <div role="menuitem" tabIndex={0} className="dc-menu-item dc-hv2 dc-focusable">
            Discord Connected: <span className="dc-menu-accent">@prez</span>
          </div>
          <div className="dc-menu-divider" />
          <div
            role="menuitem"
            tabIndex={0}
            className="dc-menu-item dc-menu-item--strong dc-hv2 dc-focusable"
          >
            Log Out
          </div>
        </div>
        <svg
          className="dc-settings-btn dc-focusable"
          tabIndex={0}
          role="button"
          aria-label="Account settings"
          aria-haspopup="menu"
          viewBox="0 0 24 24"
          width="17"
          height="17"
          fill="none"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d={GEAR_PATH} />
        </svg>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- */
/* Hero + pills — D/L:98, 106-109                                     */
/* ----------------------------------------------------------------- */

function BrandHero({ innerRef }: { innerRef?: MutableRefObject<HTMLDivElement | null> }) {
  return (
    <div className="dc-hero" ref={innerRef}>
      <span className="dc-hero-word">
        <span>d</span>
        <span className="dc-hero-i">
          ı<span className="dc-hero-dot" />
        </span>
        <span>me</span>
      </span>
    </div>
  );
}

function PromptPills({
  theme,
  onPick,
  innerRef,
  ghost = false,
}: {
  theme: Theme;
  onPick?: (label: string) => void;
  innerRef?: MutableRefObject<HTMLDivElement | null>;
  ghost?: boolean;
}) {
  return (
    <div className="dc-pills" ref={innerRef}>
      {PILL_LABELS.map((label, i) => {
        const variant = PILL_VARIANTS[theme][i];
        return (
          <button
            key={label}
            type="button"
            className={`dc-pill dc-pill--${variant} dc-hv1 dc-focusable`}
            onClick={onPick ? () => onPick(label) : undefined}
            tabIndex={ghost ? -1 : 0}
          >
            {label}
            <span className={`dc-pill-icon dc-pill-icon--on-${variant}`}>
              <PillGlyph />
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------- */
/* Conversation pieces — chat-derivation-spec.md §2                   */
/* ----------------------------------------------------------------- */

function DataPill({
  state,
  ageMinutes,
}: {
  state: DataFreshness;
  ageMinutes?: number;
}) {
  if (state === "live") {
    return (
      <span className="dc-datapill dc-datapill--live">
        <span className="dc-datapill-dot" />
        LIVE
      </span>
    );
  }
  if (state === "delayed") {
    return (
      <span className="dc-datapill dc-datapill--delayed">
        <span className="dc-datapill-dot" />
        {ageMinutes != null ? `DELAYED · ${ageMinutes}m` : "DELAYED"}
      </span>
    );
  }
  return <span className="dc-datapill dc-datapill--none">NO LIVE DATA</span>;
}

function Stat({ label, value, mint = false }: { label: string; value: string; mint?: boolean }) {
  return (
    <div className="dc-stat">
      <div className="dc-microlabel dc-stat-label">{label}</div>
      <div className={`dc-stat-value${mint ? " dc-stat-value--mint" : ""}`}>{value}</div>
    </div>
  );
}

function EdgeStatBlock({ block, freshness }: { block: EdgeBlock; freshness: DataFreshness }) {
  const pass = block.verdict === "pass";
  const mintEdge = block.verdict === "edge_detected"; // mint ONLY on positive signal (spec §2.4)
  const pct = block.edgePct.endsWith("%") ? block.edgePct : `${block.edgePct}%`;
  return (
    <section className={`dc-edge${pass ? " dc-edge--pass" : ""}`} data-verdict={block.verdict}>
      <div className="dc-edge-header">
        <span className="dc-microlabel dc-edge-label">[EDGE]</span>
        <DataPill state={freshness} />
      </div>
      <div className="dc-edge-pick">{block.market}</div>
      <div className="dc-edge-stats">
        <Stat label="Model line" value={block.modelLine} />
        <Stat label="Market line" value={block.marketLine} />
        <Stat label="Edge" value={pct} mint={mintEdge} />
        <Stat label="Confidence" value={block.confidence} />
      </div>
    </section>
  );
}

function Prose({ text }: { text: string }) {
  return (
    <div className="dc-prose">
      {segmentNumerals(text).map((part, i) =>
        part.kind === "num" ? (
          <span key={i} className="dc-num">
            {part.text}
          </span>
        ) : (
          <Fragment key={i}>{part.text}</Fragment>
        ),
      )}
    </div>
  );
}

function Turn({
  msg,
  freshness,
  fx,
}: {
  msg: ChatMessage;
  freshness: DataFreshness;
  fx: boolean;
}) {
  if (msg.role === "user") {
    return (
      <div className={`dc-turn--user${fx ? " dc-fade-in" : ""}`}>
        <div className="dc-user-capsule">{msg.content}</div>
      </div>
    );
  }
  if (msg.status === "open" && msg.content === "") {
    // Pre-first-delta: dimeTyping dots, the ONLY thinking affordance (spec §2.8)
    return (
      <div className={`dc-turn--assistant${fx ? " dc-fade-in" : ""}`}>
        <div className="dc-typing-row" role="status" aria-label="Dime is thinking">
          <span className="dc-typing-dot" />
          <span className="dc-typing-dot" />
          <span className="dc-typing-dot" />
        </div>
      </div>
    );
  }
  const segments = parseAssistantContent(msg.content, msg.status !== "open");
  return (
    <div className="dc-turn--assistant">
      {segments.map((seg, i) =>
        seg.kind === "text" ? (
          <Prose key={i} text={seg.text} />
        ) : seg.kind === "edge" ? (
          <EdgeStatBlock key={i} block={seg.block} freshness={freshness} />
        ) : null, // "pending": buffered partial [EDGE block — renders nothing until closed
      )}
      {msg.status === "interrupted" && (
        <div className="dc-footnote">
          Response interrupted. What's above is complete as far as it goes.
        </div>
      )}
      {msg.status === "stopped" && <div className="dc-footnote">Stopped.</div>}
    </div>
  );
}

/**
 * Ph3 viewport gate (<1024px): the frozen screens have no sub-desktop spec, so
 * narrow viewports get a full-viewport branded notice instead of the shell.
 * Frozen tokens only: page bg per theme (D/L:46 via .dc-page), hero wordmark
 * (F:98), body copy at composer-input size (F:101), mono micro-label sub (C3)
 * carrying the frozen link colors (F:13-14). Static — reduced-motion-safe.
 */
function ViewportGate({ theme }: { theme: Theme }) {
  return (
    <div className={`dc-page dc-page--app theme-${theme}`} data-theme={theme}>
      <div className="dc-gate">
        <BrandHero />
        <div className="dc-gate-line">Dime chat is built for desktop right now.</div>
        <Link href="/feed" className="dc-microlabel dc-gate-sub dc-link">
          OPEN ON A LARGER SCREEN · THE BOARD LIVES AT /feed
        </Link>
      </div>
    </div>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="dc-error-card">
      <div className="dc-microlabel dc-error-label">Connection</div>
      <div className="dc-error-message">{message}</div>
      <div>
        <button
          type="button"
          className="dc-btn-cancel dc-hv2 dc-focusable"
          onClick={onRetry}
        >
          Retry
        </button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- */
/* Page                                                               */
/* ----------------------------------------------------------------- */

type GhostRects = {
  hero: { left: number; top: number; width: number; height: number };
  pills: { left: number; top: number; width: number; height: number };
  fading: boolean;
};

const rectStyle = (r: { left: number; top: number; width: number; height: number }) => ({
  left: r.left,
  top: r.top,
  width: r.width,
  height: r.height,
});

export default function DimeChatPage({ theme: themeProp }: { theme?: Theme } = {}) {
  const { theme: contextTheme } = useTheme();
  const theme: Theme = themeProp ?? (contextTheme === "light" ? "light" : "dark");

  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [input, setInput] = useState("");
  const [ghost, setGhost] = useState<GhostRects | null>(null);
  const [stuck, setStuck] = useState(true);
  const [firstSendFx, setFirstSendFx] = useState(false);
  const [recentChats, setRecentChats] = useState<RecentChat[]>(() => getSessionRecents());
  const [narrow, setNarrow] = useState(
    () =>
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(max-width: 1023px)").matches,
  );

  const composerRef = useRef<HTMLFormElement>(null);
  const heroRef = useRef<HTMLDivElement | null>(null);
  const pillsRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const flipFromRef = useRef<number | null>(null);
  const stuckRef = useRef(true);
  const programmaticScrollRef = useRef(false);
  const lastScrollTopRef = useRef(0);

  const conversation = state.messages.length > 0;

  useEffect(() => () => abortRef.current?.abort(), []);

  /* --- Ph3: viewport gate listener (matchMedia — no resize-loop thrash) --- */
  useEffect(() => {
    const mq = window.matchMedia?.("(max-width: 1023px)");
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  /* --- SSE streaming core (preserved from the previous DimeChat.tsx) --- */
  const runStream = useCallback(
    async (history: Array<{ role: "user" | "assistant"; content: string }>, assistantId: string) => {
      const controller = new AbortController();
      abortRef.current = controller;

      const streamStart = Date.now();
      let frameCount = 0;
      let settled = false;
      dimeDebug("stream.open", { historyLength: history.length });

      try {
        const res = await fetch("/api/dime/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ messages: history }),
        });

        if (!res.ok || !res.body) {
          throw new Error(`Request failed (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE frames are separated by a blank line
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const line = frame.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            try {
              const event = JSON.parse(line.slice(6));
              frameCount++;
              if (event.type === "delta" && typeof event.text === "string") {
                dispatch({ type: "stream_delta", id: assistantId, text: event.text });
              } else if (
                event.type === "meta" &&
                (event.dataFreshness === "live" ||
                  event.dataFreshness === "delayed" ||
                  event.dataFreshness === "none")
              ) {
                dispatch({ type: "meta", dataFreshness: event.dataFreshness });
              } else if (event.type === "error" && typeof event.message === "string") {
                settled = true;
                dispatch({ type: "stream_error", id: assistantId, message: event.message });
              } else if (event.type === "done") {
                settled = true;
                dispatch({ type: "stream_done", id: assistantId });
              }
            } catch {
              dimeDebug("frame.parse_failure", { raw: line.slice(0, 100) });
            }
          }
        }

        if (!settled) dispatch({ type: "stream_done", id: assistantId });

        const latency = Date.now() - streamStart;
        const fps = frameCount / (latency / 1000);
        dimeDebug("stream.done", { frameCount, latencyMs: latency, fps: fps.toFixed(1) });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          dispatch({ type: "stream_abort", id: assistantId });
        } else {
          dispatch({ type: "stream_error", id: assistantId, message: ERROR_COPY });
          dimeDebug("stream.error", { error: (err as Error).message });
        }
      } finally {
        abortRef.current = null;
      }
    },
    [],
  );

  /* --- Single submit choke point: composer, Enter, chips, all of it --- */
  const submit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || state.streaming) return;

      const wasHome = state.messages.length === 0;
      if (wasHome) {
        // Ph1: a new conversation starts — record its session-only title from
        // this first user message.
        addSessionRecent(trimmed);
        setRecentChats(getSessionRecents());
      }
      if (wasHome && !prefersReducedMotion()) {
        // FLIP first-position capture + ghost rects (spec §3.2)
        flipFromRef.current = composerRef.current?.getBoundingClientRect().top ?? null;
        const hero = heroRef.current?.getBoundingClientRect();
        const pills = pillsRef.current?.getBoundingClientRect();
        if (hero && pills) {
          setGhost({
            hero: { left: hero.left, top: hero.top, width: hero.width, height: hero.height },
            pills: { left: pills.left, top: pills.top, width: pills.width, height: pills.height },
            fading: false,
          });
        }
        setFirstSendFx(true);
      }

      setInput("");
      stuckRef.current = true;
      setStuck(true);

      const userId = uid();
      const assistantId = uid();
      const history = [
        ...state.messages.map(({ role, content }) => ({ role, content })),
        { role: "user" as const, content: trimmed },
      ];
      dispatch({ type: "append_user", id: userId, text: trimmed });
      dispatch({ type: "open_assistant", id: assistantId });
      void runStream(history, assistantId);
    },
    [state.streaming, state.messages, runStream],
  );

  /** Retry re-runs the same history (failed empty row was already removed — spec §2.6). */
  const retry = useCallback(() => {
    if (state.streaming || state.messages.length === 0) return;
    const last = state.messages[state.messages.length - 1];
    if (last.role !== "user") return;
    const assistantId = uid();
    dispatch({ type: "open_assistant", id: assistantId });
    void runStream(
      state.messages.map(({ role, content }) => ({ role, content })),
      assistantId,
    );
  }, [state.streaming, state.messages, runStream]);

  const stop = () => abortRef.current?.abort();

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    dispatch({ type: "reset" });
    setInput("");
    setGhost(null);
    setFirstSendFx(false);
    stuckRef.current = true;
    setStuck(true);
  }, []);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(input);
  };

  /* --- FLIP release: translateY(Δ) → none over the kit's one beat (spec §3.2) --- */
  useLayoutEffect(() => {
    if (!conversation || flipFromRef.current == null) return;
    const el = composerRef.current;
    const from = flipFromRef.current;
    flipFromRef.current = null;
    if (!el) return;
    const delta = from - el.getBoundingClientRect().top;
    el.classList.remove("dc-composer--flip");
    el.style.transform = `translateY(${delta}px)`;
    void el.getBoundingClientRect(); // commit the inverted frame before releasing
    el.classList.add("dc-composer--flip");
    el.style.transform = "";
    const raf = requestAnimationFrame(() =>
      setGhost((g) => (g ? { ...g, fading: true } : g)),
    );
    const timer = setTimeout(() => {
      el.classList.remove("dc-composer--flip");
      el.style.removeProperty("transform");
      setGhost(null);
      setFirstSendFx(false);
    }, 200); // 160ms beat + settle margin
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [conversation]);

  /* --- Scroll policy: stick / release / re-stick on user action (spec §1.b) --- */
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !stuckRef.current) return;
    programmaticScrollRef.current = true;
    el.scrollTop = el.scrollHeight; // same frame, no smooth behavior
  }, [state.messages]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const wasProgrammatic = programmaticScrollRef.current;
    programmaticScrollRef.current = false;
    const top = el.scrollTop;
    if (!wasProgrammatic && top < lastScrollTopRef.current) {
      stuckRef.current = false; // released the instant the user scrolls upward
    }
    if (el.scrollHeight - top - el.clientHeight <= 48) {
      stuckRef.current = true; // at bottom (≤48px slack)
    }
    lastScrollTopRef.current = top;
    setStuck(stuckRef.current);
  };

  const jumpToLatest = () => {
    const el = scrollerRef.current;
    if (!el) return;
    stuckRef.current = true;
    setStuck(true);
    programmaticScrollRef.current = true;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  };

  // Ph3: below the desktop floor the shell is replaced wholesale (the frozen
  // design has no sub-1024px spec). All hooks above still run, so an active
  // stream survives a temporary resize; placed after every hook by design.
  if (narrow) {
    return <ViewportGate theme={theme} />;
  }

  return (
    <div className={`dc-page dc-page--app theme-${theme}`} data-theme={theme}>
      <div className="dc-app">
        <DimeSidebar onNewChat={newChat} recentChats={recentChats} />
        <main className={`dc-main${conversation ? " dc-main--conv" : ""}`}>
          {conversation && (
            <div className="dc-scroller" ref={scrollerRef} onScroll={onScroll}>
              <div className="dc-thread">
                {state.messages.map((m) => (
                  <Turn key={m.id} msg={m} freshness={state.dataFreshness} fx={firstSendFx} />
                ))}
                {state.error && <ErrorCard message={state.error} onRetry={retry} />}
                <div className="dc-footnote">{DISCLAIMER}</div>
              </div>
            </div>
          )}
          {!conversation && <BrandHero innerRef={heroRef} />}
          <div className="dc-composer-zone">
            {conversation && !stuck && state.streaming && (
              <button
                type="button"
                className="dc-btn-cancel dc-hv2 dc-focusable dc-jump"
                onClick={jumpToLatest}
              >
                Jump to latest
              </button>
            )}
            <form className="dc-composer" ref={composerRef} onSubmit={onSubmit}>
              <div className="dc-composer-plus">＋</div>
              <input
                className="dc-composer-input"
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={conversation ? "Reply to dime…" : "Ask dime anything…"}
                enterKeyHint="send"
              />
              {state.streaming ? (
                <button
                  type="button"
                  className="dc-send dc-hv3 dc-focusable"
                  aria-label="Stop response"
                  onClick={stop}
                >
                  <StopGlyph />
                </button>
              ) : (
                <button
                  type="submit"
                  className="dc-send dc-hv3 dc-focusable"
                  aria-label="Submit prompt"
                >
                  <SendGlyph />
                </button>
              )}
            </form>
          </div>
          {!conversation && <PromptPills theme={theme} onPick={submit} innerRef={pillsRef} />}
          {ghost && (
            <div aria-hidden="true">
              <div
                className={`dc-ghost${ghost.fading ? " dc-ghost--fading" : ""}`}
                style={rectStyle(ghost.hero)}
              >
                <BrandHero />
              </div>
              <div
                className={`dc-ghost${ghost.fading ? " dc-ghost--fading" : ""}`}
                style={rectStyle(ghost.pills)}
              >
                <PromptPills theme={theme} ghost />
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
