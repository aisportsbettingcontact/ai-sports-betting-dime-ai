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
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Link, useLocation } from "wouter";
import {
  AnimatePresence,
  LazyMotion,
  animate,
  domAnimation,
  m,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type AnimationPlaybackControls,
  type MotionStyle,
} from "framer-motion";
import { useTheme } from "../../contexts/ThemeContext";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { trpc } from "@/lib/trpc";
import {
  chatReducer,
  initialChatState,
  type ChatMessage,
  type DataFreshness,
} from "./chatReducer";
import {
  parseAssistantContent,
  segmentNumerals,
  type EdgeBlock,
} from "./edgeParser";
import {
  classifyPointerIntent,
  resolveDrawerTarget,
  rubberBand,
} from "./drawerMotion";
import { createRafDeltaBatcher, type RafDeltaBatcher } from "./streamBatcher";
import { bettingSplitsPath, feedModelPath } from "@/lib/feedRoutes";
import type { DimeProductPane } from "../dime-shell/productRoute";
import avatarUrl from "./assets/prez-avatar.jpg";
import "./frozen-tokens.css";
import "./conversation.css";

type Theme = "dark" | "light";

/* ----------------------------------------------------------------- */
/* Frozen copy — labels verbatim from D/L:57-71, 106-109              */
/* ----------------------------------------------------------------- */

const NAV_ROWS: Array<{
  label: string;
  pane?: DimeProductPane;
  href: () => string;
}> = [
  { label: "New Chat", pane: "chat", href: () => "/chat" }, // D/L:57
  { label: "AI Model Projections", pane: "feed", href: () => feedModelPath() }, // D/L:58
  {
    label: "Betting Splits + Odds History",
    pane: "splits",
    href: () => bettingSplitsPath(),
  }, // D/L:59
  { label: "Trends", href: () => "#" }, // D/L:60 — no route exists; frozen href="#"
  { label: "Prop Projections", href: () => "#" }, // D/L:61 — no route exists
  { label: "Bet Tracker", pane: "tracker", href: () => "/bet-tracker" }, // D/L:62
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

const ERROR_COPY =
  "Dime couldn't reach the model. Your message is saved above."; // spec §4
const DISCLAIMER =
  "Model estimates, not guarantees. 21+ · Gambling problem? 1-800-GAMBLER."; // spec §4
// Non-owners never see the composer or prompt pills — only this copy under the
// Dime wordmark (product requirement 2026-07-12).
const CHAT_COMING_SOON_COPY = "AI MODEL CHAT COMING SOON";

/* ----------------------------------------------------------------- */
/* Session identity — real logged-in user (replaces the frozen sample) */
/* ----------------------------------------------------------------- */

/** Minimal slice of appUsers.me consumed by the sidebar identity UI. */
interface SessionIdentity {
  username: string;
  role: string;
  expiryDate: number | null;
  stripePlanId: string | null;
  discordId: string | null;
  discordUsername: string | null;
  discordAvatar: string | null;
}

/** Repo convention (ManageAccount.tsx): null expiry or 'lifetime' plan = Lifetime. */
function isLifetimeMember(u: SessionIdentity): boolean {
  return !u.expiryDate || u.stripePlanId === "lifetime";
}

function tierLabel(u: SessionIdentity): string {
  if (u.role === "owner") return "Owner";
  if (isLifetimeMember(u)) return "Lifetime";
  if (u.stripePlanId) return "Pro";
  return "Member";
}

/** Blank silhouette avatar (generic gray profile) for users with no Discord avatar. */
const BLANK_AVATAR_URI =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#B9BFC9"/><circle cx="32" cy="24" r="11" fill="#FFFFFF"/><path d="M10 58c3-13 12-19 22-19s19 6 22 19v6H10z" fill="#FFFFFF"/></svg>',
  );

/**
 * Avatar priority: prez keeps his real photo; everyone else gets their Discord
 * avatar when connected, otherwise the blank silhouette.
 */
function resolveAvatarSrc(u: SessionIdentity): string {
  if (u.username.toLowerCase() === "prez") return avatarUrl;
  if (u.discordId && u.discordAvatar) {
    return `https://cdn.discordapp.com/avatars/${u.discordId}/${u.discordAvatar}.png?size=96`;
  }
  return BLANK_AVATAR_URI;
}

function formatExpiry(expiryDate: number): string {
  return new Date(expiryDate).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** Stored-thread summary rendered in the sidebar Recent Chats list. */
interface ThreadSummary {
  id: number;
  title: string;
  starred: boolean;
}

function ChatComingSoon({ theme }: { theme: Theme }) {
  return (
    <div className="dc-coming-soon" data-testid="chat-coming-soon">
      <img
        className="dc-coming-soon-mark"
        src={theme === "light" ? "/brand/dime-wordmark-on-light.svg" : "/brand/dime-wordmark-on-dark.svg"}
        alt="Dime"
      />
      <p className="dc-coming-soon-copy">{CHAT_COMING_SOON_COPY}</p>
    </div>
  );
}

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
  onOpenChat,
  activeChatId,
  appUser,
  compact,
  drawerOpen,
  drawerStyle,
  sidebarRef,
  onClose,
  onNavigate,
  activePane = "chat",
  onShellNavigate,
}: {
  onNewChat: () => void;
  recentChats: ThreadSummary[];
  onOpenChat: (threadId: number) => void;
  activeChatId: number | null;
  appUser: SessionIdentity | null;
  compact: boolean;
  drawerOpen: boolean;
  drawerStyle?: MotionStyle;
  sidebarRef: MutableRefObject<HTMLElement | null>;
  onClose: () => void;
  onNavigate: () => void;
  activePane?: DimeProductPane;
  onShellNavigate?: (href: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const [, navigate] = useLocation();

  const logoutMutation = trpc.appUsers.logout.useMutation({
    onSettled: () => {
      // Hard reload: clears every cached query so the next session starts clean.
      window.location.href = "/";
    },
  });

  const goTo = (href: string) => {
    setMenuOpen(false);
    onNavigate();
    navigate(href);
  };

  const lifetime = appUser ? isLifetimeMember(appUser) : false;
  const avatarSrc = appUser ? resolveAvatarSrc(appUser) : BLANK_AVATAR_URI;
  const displayName = appUser ? appUser.username.toUpperCase() : "—";

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

  return (
    <m.aside
      ref={sidebarRef}
      className={`dc-sidebar${compact ? " dc-drawer" : ""}`}
      style={drawerStyle}
      role={compact && drawerOpen ? "dialog" : undefined}
      aria-modal={compact && drawerOpen ? true : undefined}
      aria-label={compact ? "Dime navigation" : undefined}
      aria-hidden={compact && !drawerOpen ? true : undefined}
    >
      <div className="dc-sidebar-head">
        <div className="dc-sidebar-title">AI Sports Betting</div>
        {compact && (
          <button
            type="button"
            className="dc-drawer-close dc-pressable dc-focusable"
            aria-label="Close navigation"
            onClick={onClose}
          >
            ×
          </button>
        )}
      </div>
      <nav className="dc-nav-group" aria-label="Primary">
        {NAV_ROWS.map(row => {
          const href = row.href();
          const active = row.pane === activePane;
          return href === "#" ? (
            <button
              key={row.label}
              type="button"
              className="dc-sidebar-row dc-nav-disabled"
              aria-disabled="true"
            >
              <span className="dc-sidebar-text">{row.label}</span>
            </button>
          ) : (
            <Link
              key={row.label}
              href={href}
              className={`dc-sidebar-row${active ? " is-active" : ""}`}
              aria-current={active ? "page" : undefined}
              onClick={(event: ReactMouseEvent) => {
                if (row.pane === "chat") {
                  event.preventDefault();
                  onNewChat();
                  onShellNavigate?.(href);
                } else if (onShellNavigate) {
                  event.preventDefault();
                  onShellNavigate(href);
                }
                onNavigate();
              }}
            >
              {row.pane === "chat" && (
                <span className="dc-sidebar-icon">＋</span>
              )}
              <span className="dc-sidebar-text">{row.label}</span>
            </Link>
          );
        })}
      </nav>
      {recentChats.length > 0 ? (
        <>
          <div className="dc-recents-label">Recent Chats</div>
          <div className="dc-recent-list">
            {recentChats.map(rc => (
              <a
                key={rc.id}
                href="#"
                className={`dc-sidebar-row${rc.id === activeChatId ? " is-active" : ""}`}
                aria-current={rc.id === activeChatId ? "true" : undefined}
                onClick={event => {
                  event.preventDefault();
                  onOpenChat(rc.id);
                  onNavigate();
                }}
              >
                {rc.starred && (
                  <span className="dc-recent-star" aria-label="Starred">
                    ★
                  </span>
                )}
                <span className="dc-sidebar-text">{rc.title}</span>
              </a>
            ))}
          </div>
        </>
      ) : (
        // No stored conversations: hide the whole section (honesty — an empty
        // frozen shell must not render). The spacer takes over the recent
        // list's flex: 1 slot (D/L:65) so the profile row stays pinned.
        <div className="dc-sidebar-spacer" />
      )}
      <div ref={profileRef} className="dc-sidebar-row dc-profile-row">
        {/* Live session identity — wired to appUsers.me via useAppAuth. */}
        <img className="dc-avatar" src={avatarSrc} alt={displayName} />
        <div className="dc-profile-id">
          <div className="dc-profile-name">{displayName}</div>
          <div className="dc-profile-tier">{appUser ? tierLabel(appUser) : ""}</div>
        </div>
        <AnimatePresence initial={false}>
          {menuOpen && appUser && (
            <m.div
              key="settings-menu"
              className="dc-settings-menu open"
              role="menu"
              initial={reduceMotion ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 4 }}
              transition={{
                duration: reduceMotion ? 0 : 0.16,
                ease: [0.16, 1, 0.3, 1],
              }}
              onClick={e => e.stopPropagation()}
            >
              <div className="dc-menu-header">
                <img className="dc-avatar--menu" src={avatarSrc} alt={`@${appUser.username}`} />
                <div className="dc-menu-id">
                  <div className="dc-menu-handle-row">
                    <div className="dc-menu-handle">@{appUser.username}</div>
                    <div className="dc-badge-pro">{tierLabel(appUser).toUpperCase()}</div>
                  </div>
                  <div className="dc-menu-expiry">
                    {lifetime
                      ? "Lifetime access"
                      : appUser.expiryDate
                        ? `Expires ${formatExpiry(appUser.expiryDate)}`
                        : ""}
                  </div>
                </div>
              </div>
              {/* Lifetime members have nothing to upgrade or cancel. */}
              {!lifetime && (
                <div className="dc-menu-cta-row">
                  <button
                    type="button"
                    role="menuitem"
                    className="dc-btn-upgrade dc-hv1 dc-focusable dc-pressable"
                    onClick={() => goTo("/checkout")}
                  >
                    Upgrade Membership
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="dc-btn-cancel dc-hv2 dc-focusable dc-pressable"
                    onClick={() => goTo("/account")}
                  >
                    Cancel Membership
                  </button>
                </div>
              )}
              <div className="dc-menu-divider" />
              <button
                type="button"
                role="menuitem"
                className="dc-menu-item dc-hv2 dc-focusable dc-pressable"
                onClick={() => goTo("/profile")}
              >
                Edit Profile
              </button>
              <button
                type="button"
                role="menuitem"
                className="dc-menu-item dc-hv2 dc-focusable dc-pressable"
                onClick={() => goTo("/profile")}
              >
                {appUser.discordUsername ? (
                  <>
                    Discord Connected:{" "}
                    <span className="dc-menu-accent">@{appUser.discordUsername}</span>
                  </>
                ) : (
                  "Connect Discord"
                )}
              </button>
              <div className="dc-menu-divider" />
              <button
                type="button"
                role="menuitem"
                className="dc-menu-item dc-menu-item--strong dc-hv2 dc-focusable dc-pressable"
                disabled={logoutMutation.isPending}
                onClick={() => logoutMutation.mutate()}
              >
                {logoutMutation.isPending ? "Logging out…" : "Log Out"}
              </button>
            </m.div>
          )}
        </AnimatePresence>
        <button
          type="button"
          className="dc-settings-trigger dc-pressable dc-focusable"
          aria-label="Account settings"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(open => !open)}
        >
          <svg
            className="dc-settings-btn"
            viewBox="0 0 24 24"
            width="17"
            height="17"
            fill="none"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path d={GEAR_PATH} />
          </svg>
        </button>
      </div>
    </m.aside>
  );
}

/* ----------------------------------------------------------------- */
/* Hero + pills — D/L:98, 106-109                                     */
/* ----------------------------------------------------------------- */

function BrandHero({
  innerRef,
}: {
  innerRef?: MutableRefObject<HTMLDivElement | null>;
}) {
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
            className={`dc-pill dc-pill--${variant} dc-hv1 dc-focusable dc-pressable`}
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

function Stat({
  label,
  value,
  mint = false,
}: {
  label: string;
  value: string;
  mint?: boolean;
}) {
  return (
    <div className="dc-stat">
      <div className="dc-microlabel dc-stat-label">{label}</div>
      <div className={`dc-stat-value${mint ? " dc-stat-value--mint" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function EdgeStatBlock({
  block,
  freshness,
}: {
  block: EdgeBlock;
  freshness: DataFreshness;
}) {
  const pass = block.verdict === "pass";
  const mintEdge = block.verdict === "edge_detected"; // mint ONLY on positive signal (spec §2.4)
  const pct = block.edgePct.endsWith("%") ? block.edgePct : `${block.edgePct}%`;
  return (
    <section
      className={`dc-edge${pass ? " dc-edge--pass" : ""}`}
      data-verdict={block.verdict}
    >
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
        )
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
        <div
          className="dc-typing-row"
          role="status"
          aria-label="Dime is thinking"
        >
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
      {segments.map(
        (seg, i) =>
          seg.kind === "text" ? (
            <Prose key={i} text={seg.text} />
          ) : seg.kind === "edge" ? (
            <EdgeStatBlock key={i} block={seg.block} freshness={freshness} />
          ) : null // "pending": buffered partial [EDGE block — renders nothing until closed
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

function ErrorCard({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="dc-error-card">
      <div className="dc-microlabel dc-error-label">Connection</div>
      <div className="dc-error-message">{message}</div>
      <div>
        <button
          type="button"
          className="dc-btn-cancel dc-hv2 dc-focusable dc-pressable"
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

type DrawerGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  grabOffset: number;
  lastX: number;
  lastTime: number;
  velocityX: number;
  lastDirection: -1 | 0 | 1;
  claimed: boolean;
  rejected: boolean;
};

const DRAWER_FALLBACK_WIDTH = 293;
const DRAWER_SPRING = {
  type: "spring" as const,
  stiffness: 520,
  damping: 43,
  mass: 0.9,
};
const BRAND_EASE = [0.16, 1, 0.3, 1] as const;

const rectStyle = (r: {
  left: number;
  top: number;
  width: number;
  height: number;
}) => ({
  left: r.left,
  top: r.top,
  width: r.width,
  height: r.height,
});

export interface DimeChatShellState {
  /** Pane currently painted; may lag the URL while a lazy chunk resolves. */
  renderedPane: DimeProductPane;
  /** URL-owned active item, updated immediately for sidebar semantics. */
  navigationPane: DimeProductPane;
  paneContent: ReactNode;
  paneHeading: string;
  onNavigate: (href: string) => void;
  externalScrollRef: MutableRefObject<HTMLDivElement | null>;
  chatHeadingRef: MutableRefObject<HTMLHeadingElement | null>;
  externalHeadingRef: MutableRefObject<HTMLHeadingElement | null>;
  onExternalScroll: () => void;
}

export interface DimeChatPageProps {
  theme?: Theme;
  shell?: DimeChatShellState;
}

export default function DimeChatPage({
  theme: themeProp,
  shell,
}: DimeChatPageProps = {}) {
  const { theme: contextTheme } = useTheme();
  const theme: Theme =
    themeProp ?? (contextTheme === "light" ? "light" : "dark");
  const reduceMotion = useReducedMotion();

  // Session identity + owner gate. While auth resolves we fail closed: no
  // composer, no pills — non-owners only ever see the coming-soon state.
  const { appUser, isOwner, loading: authLoading } = useAppAuth();
  const chatUiReady = !!appUser && isOwner;

  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [input, setInput] = useState("");
  const [ghost, setGhost] = useState<GhostRects | null>(null);
  const [stuck, setStuck] = useState(true);
  const [firstSendFx, setFirstSendFx] = useState(false);

  // ── Persistent chat history (dimeChats router) ──────────────────────────
  const utils = trpc.useUtils();
  const threadsQuery = trpc.dimeChats.list.useQuery(undefined, {
    enabled: chatUiReady,
    staleTime: 15_000,
  });
  const recentChats: ThreadSummary[] = (threadsQuery.data ?? []).map(
    (t: { id: number; title: string; starred: boolean }) => ({
      id: t.id,
      title: t.title,
      starred: t.starred,
    })
  );
  const [threadId, setThreadId] = useState<number | null>(null);
  const [threadMenuOpen, setThreadMenuOpen] = useState(false);
  const threadMenuRef = useRef<HTMLDivElement | null>(null);
  const pendingUserTextRef = useRef<string | null>(null);
  const prevStreamingRef = useRef(false);
  const createThreadMut = trpc.dimeChats.create.useMutation();
  const appendMut = trpc.dimeChats.appendMessages.useMutation();
  const setStarredMut = trpc.dimeChats.setStarred.useMutation();
  const setArchivedMut = trpc.dimeChats.setArchived.useMutation();
  const softDeleteMut = trpc.dimeChats.softDelete.useMutation();
  const activeThreadMeta = recentChats.find(t => t.id === threadId);
  const [compact, setCompact] = useState(
    () =>
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(max-width: 1023px)").matches
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMoving, setDrawerMoving] = useState(false);

  const pageRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const heroRef = useRef<HTMLDivElement | null>(null);
  const pillsRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const chatPaneRef = useRef<HTMLElement | null>(null);
  const externalPaneRef = useRef<HTMLElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeBatcherRef = useRef<RafDeltaBatcher | null>(null);
  const flipFromRef = useRef<number | null>(null);
  const flipControlsRef = useRef<AnimationPlaybackControls | null>(null);
  const flipGenerationRef = useRef(0);
  const stuckRef = useRef(true);
  const programmaticScrollRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const mobileBarRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerAnimationRef = useRef<AnimationPlaybackControls | null>(null);
  const drawerAnimationGenerationRef = useRef(0);
  const drawerTargetRef = useRef(-DRAWER_FALLBACK_WIDTH);
  const drawerRestoreFocusRef = useRef(false);
  const drawerWidthRef = useRef(DRAWER_FALLBACK_WIDTH);
  const gestureRef = useRef<DrawerGesture | null>(null);
  const viewportFrameRef = useRef<number | null>(null);
  const drawerX = useMotionValue(-DRAWER_FALLBACK_WIDTH);
  const scrimOpacity = useTransform(
    drawerX,
    [-DRAWER_FALLBACK_WIDTH, 0],
    [0, 0.46]
  );

  const conversation = state.messages.length > 0;

  useEffect(
    () => () => {
      abortRef.current?.abort();
      activeBatcherRef.current?.dispose();
      flipControlsRef.current?.stop();
      drawerAnimationRef.current?.stop();
      if (viewportFrameRef.current != null)
        cancelAnimationFrame(viewportFrameRef.current);
    },
    []
  );

  /* --- Responsive shell listener (matchMedia — no resize-loop thrash) --- */
  useEffect(() => {
    const mq = window.matchMedia?.("(max-width: 1023px)");
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setCompact(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  /* --- Mobile visual viewport: one read + one rAF write, no layout reads. --- */
  useEffect(() => {
    if (!compact || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const schedule = () => {
      if (viewportFrameRef.current != null) return;
      const height = viewport.height;
      const top = viewport.offsetTop;
      viewportFrameRef.current = requestAnimationFrame(() => {
        viewportFrameRef.current = null;
        pageRef.current?.style.setProperty("--dc-visual-height", `${height}px`);
        pageRef.current?.style.setProperty("--dc-visual-top", `${top}px`);
      });
    };
    schedule();
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    return () => {
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      if (viewportFrameRef.current != null)
        cancelAnimationFrame(viewportFrameRef.current);
      viewportFrameRef.current = null;
    };
  }, [compact]);

  useLayoutEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    drawerWidthRef.current =
      sidebar.getBoundingClientRect().width || DRAWER_FALLBACK_WIDTH;
    pageRef.current?.style.setProperty(
      "--dc-drawer-width",
      `${drawerWidthRef.current}px`
    );
    if (compact) drawerX.set(drawerOpen ? 0 : -drawerWidthRef.current);
    else {
      drawerAnimationRef.current?.stop();
      drawerX.set(0);
      setDrawerOpen(false);
      setDrawerMoving(false);
    }
  }, [compact, drawerX]);

  const settleDrawer = useCallback(
    (target: number, velocityX = 0, restoreFocus = false) => {
      const generation = ++drawerAnimationGenerationRef.current;
      drawerTargetRef.current = target;
      drawerRestoreFocusRef.current = restoreFocus;
      drawerAnimationRef.current?.stop();
      setDrawerMoving(true);

      const finish = () => {
        if (generation !== drawerAnimationGenerationRef.current) return;
        drawerAnimationRef.current = null;
        setDrawerMoving(false);
        if (target < 0) {
          setDrawerOpen(false);
          if (restoreFocus) menuButtonRef.current?.focus();
        } else {
          setDrawerOpen(true);
        }
      };

      if (reduceMotion) {
        drawerX.set(target);
        finish();
        return;
      }

      const controls = animate(drawerX, target, {
        ...DRAWER_SPRING,
        velocity: velocityX,
      });
      drawerAnimationRef.current = controls;
      void controls.then(finish);
    },
    [drawerX, reduceMotion]
  );

  useEffect(() => {
    if (!reduceMotion || !drawerAnimationRef.current) return;
    drawerAnimationGenerationRef.current++;
    drawerAnimationRef.current.stop();
    drawerAnimationRef.current = null;
    drawerX.set(drawerTargetRef.current);
    setDrawerMoving(false);
    const closed = drawerTargetRef.current < 0;
    setDrawerOpen(!closed);
    if (closed && drawerRestoreFocusRef.current) menuButtonRef.current?.focus();
  }, [drawerX, reduceMotion]);

  const openDrawer = useCallback(() => {
    setDrawerOpen(true);
    settleDrawer(0);
  }, [settleDrawer]);

  const closeDrawer = useCallback(
    (restoreFocus = true) => {
      settleDrawer(-drawerWidthRef.current, 0, restoreFocus);
    },
    [settleDrawer]
  );

  /* --- Modal drawer semantics: inert background, focus trap, Escape, restore. --- */
  useEffect(() => {
    const sidebar = sidebarRef.current;
    const main = mainRef.current;
    const mobileBar = mobileBarRef.current;
    if (!compact) {
      if (sidebar) sidebar.inert = false;
      if (main) main.inert = false;
      if (mobileBar) mobileBar.inert = false;
      return;
    }

    if (sidebar) sidebar.inert = !drawerOpen;
    if (main) main.inert = drawerOpen;
    if (mobileBar) mobileBar.inert = drawerOpen;
    if (!drawerOpen || drawerMoving || !sidebar) return;

    const focusables = () =>
      Array.from(
        sidebar.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([aria-disabled="true"]), a[href], [tabindex]:not([tabindex="-1"])'
        )
      ).filter(el => !el.hasAttribute("aria-hidden"));
    const frame = requestAnimationFrame(() => focusables()[0]?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer(true);
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
    };
  }, [compact, drawerOpen, drawerMoving, closeDrawer]);

  useEffect(() => {
    if (!shell) return;
    const chatActive = shell.renderedPane === "chat";
    if (chatPaneRef.current) chatPaneRef.current.inert = !chatActive;
    if (externalPaneRef.current) externalPaneRef.current.inert = chatActive;
  }, [shell?.renderedPane]);

  const beginDrawerGesture = useCallback(
    (event: ReactPointerEvent<HTMLElement>, requireIntent: boolean) => {
      if (event.button !== 0) return;
      drawerAnimationGenerationRef.current++;
      drawerAnimationRef.current?.stop();
      drawerAnimationRef.current = null;
      const currentX = drawerX.get();
      gestureRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        grabOffset: event.clientX - currentX,
        lastX: event.clientX,
        lastTime: event.timeStamp,
        velocityX: 0,
        lastDirection: 0,
        claimed: !requireIntent,
        rejected: false,
      };
      if (!requireIntent) {
        event.currentTarget.setPointerCapture(event.pointerId);
        setDrawerMoving(true);
      }
    },
    [drawerX]
  );

  const moveDrawerGesture = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId || gesture.rejected)
        return;
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;

      if (!gesture.claimed) {
        const intent = classifyPointerIntent(dx, dy);
        if (intent === "pending") return;
        if (intent === "vertical") {
          gesture.rejected = true;
          gestureRef.current = null;
          return;
        }
        gesture.claimed = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDrawerOpen(true);
        setDrawerMoving(true);
      }

      event.preventDefault();
      const elapsed = Math.max(1, event.timeStamp - gesture.lastTime);
      const step = event.clientX - gesture.lastX;
      gesture.velocityX = (step / elapsed) * 1000;
      if (Math.abs(step) >= 0.25) gesture.lastDirection = step > 0 ? 1 : -1;
      gesture.lastX = event.clientX;
      gesture.lastTime = event.timeStamp;

      if (!reduceMotion) {
        const raw = event.clientX - gesture.grabOffset;
        drawerX.set(rubberBand(raw, -drawerWidthRef.current, 0));
      }
    },
    [drawerX, reduceMotion]
  );

  const endDrawerGesture = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      gestureRef.current = null;
      if (!gesture.claimed || gesture.rejected) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const target = resolveDrawerTarget({
        velocityX: gesture.velocityX,
        lastDirection: gesture.lastDirection,
        closedX: -drawerWidthRef.current,
      });
      settleDrawer(target, gesture.velocityX, target < 0);
    },
    [settleDrawer]
  );

  /* --- SSE streaming core (preserved from the previous DimeChat.tsx) --- */
  const runStream = useCallback(
    async (
      history: Array<{ role: "user" | "assistant"; content: string }>,
      assistantId: string
    ) => {
      const controller = new AbortController();
      abortRef.current = controller;

      const streamStart = Date.now();
      let frameCount = 0;
      let settled = false;
      const batcher = createRafDeltaBatcher(text => {
        dispatch({ type: "stream_delta", id: assistantId, text });
      });
      activeBatcherRef.current?.dispose();
      activeBatcherRef.current = batcher;
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
            const line = frame.split("\n").find(l => l.startsWith("data: "));
            if (!line) continue;
            try {
              const event = JSON.parse(line.slice(6));
              frameCount++;
              if (event.type === "delta" && typeof event.text === "string") {
                batcher.push(event.text);
              } else if (
                event.type === "meta" &&
                (event.dataFreshness === "live" ||
                  event.dataFreshness === "delayed" ||
                  event.dataFreshness === "none")
              ) {
                dispatch({ type: "meta", dataFreshness: event.dataFreshness });
              } else if (
                event.type === "error" &&
                typeof event.message === "string"
              ) {
                settled = true;
                batcher.flushBeforeTerminal(() =>
                  dispatch({
                    type: "stream_error",
                    id: assistantId,
                    message: event.message,
                  })
                );
              } else if (event.type === "done") {
                settled = true;
                batcher.flushBeforeTerminal(() =>
                  dispatch({ type: "stream_done", id: assistantId })
                );
              }
            } catch {
              dimeDebug("frame.parse_failure", { raw: line.slice(0, 100) });
            }
          }
        }

        if (!settled) {
          batcher.flushBeforeTerminal(() =>
            dispatch({ type: "stream_done", id: assistantId })
          );
        }

        const latency = Date.now() - streamStart;
        const fps = frameCount / (latency / 1000);
        dimeDebug("stream.done", {
          frameCount,
          latencyMs: latency,
          fps: fps.toFixed(1),
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          batcher.flushBeforeTerminal(() =>
            dispatch({ type: "stream_abort", id: assistantId })
          );
        } else {
          batcher.flushBeforeTerminal(() =>
            dispatch({
              type: "stream_error",
              id: assistantId,
              message: ERROR_COPY,
            })
          );
          dimeDebug("stream.error", { error: (err as Error).message });
        }
      } finally {
        batcher.dispose();
        if (activeBatcherRef.current === batcher)
          activeBatcherRef.current = null;
        abortRef.current = null;
      }
    },
    []
  );

  const captureComposerPresentation = useCallback(() => {
    const composer = composerRef.current;
    if (!composer) return;
    flipGenerationRef.current++;
    flipControlsRef.current?.stop();
    flipControlsRef.current = null;
    flipFromRef.current = composer.getBoundingClientRect().top;
  }, []);

  /* --- Single submit choke point: composer, Enter, chips, all of it --- */
  const submit = useCallback(
    (text: string) => {
      // Owner-only chat: non-owners have no composer, but keep the gate as a
      // second line of defense for any programmatic call path.
      if (!chatUiReady) return;
      const trimmed = text.trim();
      if (!trimmed || state.streaming) return;

      // Persist this turn once the stream settles (see the effect below).
      pendingUserTextRef.current = trimmed;

      const wasHome = state.messages.length === 0;
      if (wasHome) captureComposerPresentation();
      if (wasHome && !reduceMotion) {
        // FLIP first-position capture + ghost rects (spec §3.2)
        const hero = heroRef.current?.getBoundingClientRect();
        const pills = pillsRef.current?.getBoundingClientRect();
        if (hero && pills) {
          setGhost({
            hero: {
              left: hero.left,
              top: hero.top,
              width: hero.width,
              height: hero.height,
            },
            pills: {
              left: pills.left,
              top: pills.top,
              width: pills.width,
              height: pills.height,
            },
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
    [
      chatUiReady,
      state.streaming,
      state.messages,
      runStream,
      reduceMotion,
      captureComposerPresentation,
    ]
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
      assistantId
    );
  }, [state.streaming, state.messages, runStream]);

  const stop = () => abortRef.current?.abort();

  const newChat = useCallback(() => {
    if (state.messages.length > 0) captureComposerPresentation();
    abortRef.current?.abort();
    activeBatcherRef.current?.dispose();
    activeBatcherRef.current = null;
    dispatch({ type: "reset" });
    setThreadId(null);
    setThreadMenuOpen(false);
    pendingUserTextRef.current = null;
    setInput("");
    setGhost(null);
    setFirstSendFx(false);
    stuckRef.current = true;
    setStuck(true);
  }, [state.messages.length, captureComposerPresentation]);

  /* --- Persist each settled turn to the dimeChats history (fire-and-forget:
         storage failures never block the visible conversation). --- */
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = state.streaming;
    if (!wasStreaming || state.streaming) return; // only on stream settle
    if (!chatUiReady) return;

    const last = state.messages[state.messages.length - 1];
    if (!last || last.role !== "assistant" || last.content === "") return;

    const userText = pendingUserTextRef.current;
    pendingUserTextRef.current = null;
    const assistantText = last.content;
    const refreshList = () => void utils.dimeChats.list.invalidate();

    if (threadId == null) {
      if (!userText) return;
      createThreadMut.mutate(
        { firstMessage: userText },
        {
          onSuccess: ({ threadId: newId }) => {
            setThreadId(newId);
            appendMut.mutate(
              { threadId: newId, messages: [{ role: "assistant", content: assistantText }] },
              { onSettled: refreshList },
            );
          },
        },
      );
    } else {
      const turn = userText
        ? [
            { role: "user" as const, content: userText },
            { role: "assistant" as const, content: assistantText },
          ]
        : [{ role: "assistant" as const, content: assistantText }];
      appendMut.mutate({ threadId, messages: turn }, { onSettled: refreshList });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.streaming, state.messages, threadId, chatUiReady]);

  /* --- Resume a stored conversation from the sidebar. --- */
  const openChat = useCallback(
    async (id: number) => {
      abortRef.current?.abort();
      activeBatcherRef.current?.dispose();
      activeBatcherRef.current = null;
      try {
        const data = await utils.dimeChats.get.fetch({ threadId: id });
        dispatch({
          type: "hydrate",
          messages: data.messages.map(
            (m: { role: "user" | "assistant"; content: string }) => ({
              role: m.role,
              content: m.content,
            })
          ),
        });
        setThreadId(id);
        setThreadMenuOpen(false);
        pendingUserTextRef.current = null;
        setInput("");
        stuckRef.current = true;
        setStuck(true);
      } catch (err) {
        dimeDebug("history.open_failed", { error: (err as Error).message });
      }
    },
    [utils]
  );

  /* --- "⋯" chat settings: Star / Archive / Delete for the open thread. --- */
  useEffect(() => {
    if (!threadMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!threadMenuRef.current?.contains(e.target as Node)) setThreadMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setThreadMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [threadMenuOpen]);

  const refreshThreads = useCallback(
    () => void utils.dimeChats.list.invalidate(),
    [utils]
  );

  const toggleStar = useCallback(() => {
    if (threadId == null) return;
    setThreadMenuOpen(false);
    setStarredMut.mutate(
      { threadId, starred: !activeThreadMeta?.starred },
      { onSettled: refreshThreads }
    );
  }, [threadId, activeThreadMeta?.starred, setStarredMut, refreshThreads]);

  const archiveThread = useCallback(() => {
    if (threadId == null) return;
    setThreadMenuOpen(false);
    setArchivedMut.mutate(
      { threadId, archived: true },
      {
        onSettled: () => {
          refreshThreads();
          newChat();
        },
      }
    );
  }, [threadId, setArchivedMut, refreshThreads, newChat]);

  const deleteThread = useCallback(() => {
    if (threadId == null) return;
    if (!window.confirm("Delete this chat? It will be removed from your history.")) return;
    setThreadMenuOpen(false);
    softDeleteMut.mutate(
      { threadId },
      {
        onSettled: () => {
          refreshThreads();
          newChat();
        },
      }
    );
  }, [threadId, softDeleteMut, refreshThreads, newChat]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(input);
  };

  /* --- Interruptible FLIP: measured presentation → final layout, no timer ownership. --- */
  useLayoutEffect(() => {
    if (flipFromRef.current == null) return;
    const el = composerRef.current;
    const from = flipFromRef.current;
    flipFromRef.current = null;
    if (!el) return;
    const delta = from - el.getBoundingClientRect().top;
    el.style.transform = `translateY(${delta}px)`;
    if (reduceMotion) {
      el.style.removeProperty("transform");
      setGhost(null);
      setFirstSendFx(false);
      return;
    }

    const generation = ++flipGenerationRef.current;
    const controls = animate(
      el,
      { transform: "translateY(0px)" },
      { duration: 0.16, ease: BRAND_EASE }
    );
    flipControlsRef.current = controls;
    const frame = requestAnimationFrame(() =>
      setGhost(current => (current ? { ...current, fading: true } : current))
    );
    void controls.then(() => {
      if (generation !== flipGenerationRef.current) return;
      flipControlsRef.current = null;
      el.style.removeProperty("transform");
      setGhost(null);
      setFirstSendFx(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [conversation, reduceMotion]);

  useEffect(() => {
    if (!reduceMotion || !flipControlsRef.current) return;
    flipGenerationRef.current++;
    flipControlsRef.current.stop();
    flipControlsRef.current = null;
    composerRef.current?.style.removeProperty("transform");
    setGhost(null);
    setFirstSendFx(false);
  }, [reduceMotion]);

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

  return (
    <LazyMotion features={domAnimation} strict>
      <div
        ref={pageRef}
        className={`dc-page dc-page--app theme-${theme}${drawerMoving ? " dc-drawer-is-moving" : ""}`}
        data-theme={theme}
      >
        <div className="dc-app">
          {compact && (
            <div className="dc-mobile-bar" ref={mobileBarRef}>
              <button
                ref={menuButtonRef}
                type="button"
                className="dc-mobile-menu dc-focusable dc-pressable"
                aria-haspopup="dialog"
                aria-expanded={drawerOpen}
                onClick={openDrawer}
              >
                Menu
              </button>
              <span className="dc-mobile-title">AI Sports Betting</span>
              <span className="dc-mobile-balance" aria-hidden="true" />
            </div>
          )}

          <DimeSidebar
            onNewChat={newChat}
            recentChats={recentChats}
            onOpenChat={openChat}
            activeChatId={threadId}
            appUser={appUser as SessionIdentity | null}
            compact={compact}
            drawerOpen={drawerOpen}
            drawerStyle={compact ? { x: drawerX } : undefined}
            sidebarRef={sidebarRef}
            onClose={() => closeDrawer(true)}
            onNavigate={() => {
              if (compact) closeDrawer(true);
            }}
            activePane={shell?.navigationPane}
            onShellNavigate={shell?.onNavigate}
          />

          {compact && drawerOpen && (
            <m.button
              type="button"
              className="dc-drawer-scrim"
              style={{ opacity: scrimOpacity }}
              aria-label="Close navigation"
              tabIndex={-1}
              onPointerDown={() => closeDrawer(true)}
            />
          )}

          {compact && !drawerOpen && (
            <div
              className="dc-edge-capture"
              aria-hidden="true"
              onPointerDown={event => beginDrawerGesture(event, true)}
              onPointerMove={moveDrawerGesture}
              onPointerUp={endDrawerGesture}
              onPointerCancel={endDrawerGesture}
            />
          )}

          {compact && drawerOpen && (
            <m.div
              className="dc-drawer-grab"
              style={{ x: drawerX }}
              aria-hidden="true"
              onPointerDown={event => beginDrawerGesture(event, false)}
              onPointerMove={moveDrawerGesture}
              onPointerUp={endDrawerGesture}
              onPointerCancel={endDrawerGesture}
            />
          )}

          {(() => {
            const chatActive = !shell || shell.renderedPane === "chat";
            const transition = {
              duration: reduceMotion ? 0 : 0.16,
              ease: BRAND_EASE,
            };
            const chatPane = (
              <m.main
                ref={shell ? chatPaneRef : mainRef}
                className={`dc-main${conversation ? " dc-main--conv" : ""}${shell ? " dc-shell-chat-layer" : ""}`}
                aria-hidden={shell && !chatActive ? true : undefined}
                animate={
                  shell
                    ? { opacity: chatActive ? 1 : 0, y: chatActive ? 0 : -4 }
                    : undefined
                }
                transition={transition}
                style={
                  shell
                    ? { pointerEvents: chatActive ? "auto" : "none" }
                    : undefined
                }
              >
                {shell && (
                  <h1
                    ref={shell.chatHeadingRef}
                    className="dc-shell-sr-only"
                    tabIndex={-1}
                  >
                    Dime Chat
                  </h1>
                )}
                {/* Owner gate: non-owners get only the wordmark + coming-soon
                    copy — no composer, no pills, on every viewport. While auth
                    is still resolving nothing chat-like renders (fail closed). */}
                {!chatUiReady && !authLoading && <ChatComingSoon theme={theme} />}
                {chatUiReady && conversation && threadId != null && (
                  <div className="dc-thread-actions" ref={threadMenuRef}>
                    <button
                      type="button"
                      className="dc-thread-menu-trigger dc-focusable dc-pressable"
                      aria-label="Chat settings"
                      aria-haspopup="menu"
                      aria-expanded={threadMenuOpen}
                      onClick={() => setThreadMenuOpen(open => !open)}
                    >
                      ⋯
                    </button>
                    {threadMenuOpen && (
                      <div className="dc-thread-menu" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          className="dc-thread-menu-item dc-focusable dc-pressable"
                          onClick={toggleStar}
                        >
                          {activeThreadMeta?.starred ? "Unstar" : "Star"}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="dc-thread-menu-item dc-focusable dc-pressable"
                          onClick={archiveThread}
                        >
                          Archive
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="dc-thread-menu-item dc-thread-menu-item--danger dc-focusable dc-pressable"
                          onClick={deleteThread}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {chatUiReady && conversation && (
                  <div
                    className="dc-scroller"
                    ref={scrollerRef}
                    onScroll={onScroll}
                  >
                    <div
                      className="dc-thread"
                      role="log"
                      aria-live="polite"
                      aria-relevant="additions text"
                      aria-atomic="false"
                      aria-label="Dime chat conversation"
                    >
                      {state.messages.map(m => (
                        <Turn
                          key={m.id}
                          msg={m}
                          freshness={state.dataFreshness}
                          fx={firstSendFx}
                        />
                      ))}
                      {state.error && (
                        <ErrorCard message={state.error} onRetry={retry} />
                      )}
                      <div className="dc-footnote">{DISCLAIMER}</div>
                    </div>
                  </div>
                )}
                {chatUiReady && !conversation && <BrandHero innerRef={heroRef} />}
                {chatUiReady && (
                <div className="dc-composer-zone">
                  {conversation && !stuck && state.streaming && (
                    <button
                      type="button"
                      className="dc-btn-cancel dc-hv2 dc-focusable dc-pressable dc-jump"
                      onClick={jumpToLatest}
                    >
                      Jump to latest
                    </button>
                  )}
                  <form
                    className="dc-composer"
                    ref={composerRef}
                    onSubmit={onSubmit}
                  >
                    <div className="dc-composer-plus">＋</div>
                    <input
                      className="dc-composer-input"
                      type="text"
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      placeholder={
                        conversation ? "Reply to dime…" : "Ask dime anything…"
                      }
                      enterKeyHint="send"
                    />
                    {state.streaming ? (
                      <button
                        type="button"
                        className="dc-send dc-hv3 dc-focusable dc-pressable"
                        aria-label="Stop response"
                        onClick={stop}
                      >
                        <StopGlyph />
                      </button>
                    ) : (
                      <button
                        type="submit"
                        className="dc-send dc-hv3 dc-focusable dc-pressable"
                        aria-label="Submit prompt"
                      >
                        <SendGlyph />
                      </button>
                    )}
                  </form>
                </div>
                )}
                {chatUiReady && !conversation && (
                  <PromptPills
                    theme={theme}
                    onPick={submit}
                    innerRef={pillsRef}
                  />
                )}
                {chatUiReady && ghost && (
                  <div aria-hidden="true">
                    <m.div
                      className={`dc-ghost${ghost.fading ? " dc-ghost--fading" : ""}`}
                      style={rectStyle(ghost.hero)}
                      animate={{ opacity: ghost.fading ? 0 : 1 }}
                      transition={{
                        duration: reduceMotion ? 0 : 0.16,
                        ease: BRAND_EASE,
                      }}
                    >
                      <BrandHero />
                    </m.div>
                    <m.div
                      className={`dc-ghost${ghost.fading ? " dc-ghost--fading" : ""}`}
                      style={rectStyle(ghost.pills)}
                      animate={{ opacity: ghost.fading ? 0 : 1 }}
                      transition={{
                        duration: reduceMotion ? 0 : 0.16,
                        ease: BRAND_EASE,
                      }}
                    >
                      <PromptPills theme={theme} ghost />
                    </m.div>
                  </div>
                )}
              </m.main>
            );

            if (!shell) return chatPane;

            const externalActive = shell.renderedPane !== "chat";
            return (
              <div
                ref={mainRef as MutableRefObject<HTMLDivElement | null>}
                className="dc-shell-stack"
              >
                {chatPane}
                <m.section
                  ref={externalPaneRef}
                  className="dc-shell-external-layer"
                  aria-hidden={!externalActive}
                  animate={{
                    opacity: externalActive ? 1 : 0,
                    y: externalActive ? 0 : 4,
                  }}
                  transition={transition}
                  style={{ pointerEvents: externalActive ? "auto" : "none" }}
                >
                  <div
                    ref={shell.externalScrollRef}
                    className="dc-shell-external-scroll"
                    onScroll={shell.onExternalScroll}
                  >
                    <h1
                      ref={shell.externalHeadingRef}
                      className="dc-shell-sr-only"
                      tabIndex={-1}
                    >
                      {shell.paneHeading}
                    </h1>
                    {shell.paneContent}
                  </div>
                </m.section>
              </div>
            );
          })()}
        </div>
      </div>
    </LazyMotion>
  );
}
