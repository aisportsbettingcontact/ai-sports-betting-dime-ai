import {
  lazy,
  Suspense,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { useLocation } from "wouter";
import DimeChatPage from "../dime-chat/DimeChatPage";
import {
  bettingSplitsPath,
  canonicalBettingSplitsPath,
  parseBettingSplitsPath,
  type SplitsSport,
} from "@/lib/feedRoutes";
import { parseDimeProductRoute, type DimeProductPane } from "./productRoute";
import { withLocalDimePreview } from "./previewGate";
import "./shell.css";

const DimeModelFeed = lazy(() => import("../DimeModelFeed"));
const BettingSplits = lazy(() => import("../BettingSplits"));
const BetTracker = lazy(() => import("../BetTracker"));
const TrendsPage = lazy(() => import("../TrendsPage"));
// Background engagement-session tracking, lazy-loaded so it never weighs down
// chat's critical-path bundle (it is not needed for first paint).
const SessionTracker = lazy(() => import("@/components/SessionTracker"));

const PANE_HEADINGS: Record<DimeProductPane, string> = {
  chat: "Dime Chat",
  feed: "AI Model Projections",
  splits: "Betting Splits and Odds History",
  trends: "Trends",
  tracker: "Bet Tracker",
};

function defaultSplitsState(): { sport: SplitsSport; isoDate: string } {
  const segment = bettingSplitsPath().split("/").pop();
  const parsed = parseBettingSplitsPath(segment);
  if (!parsed?.isoDate) {
    throw new Error(
      "Canonical betting splits builder did not produce a dated path"
    );
  }
  return { sport: parsed.sport, isoDate: parsed.isoDate };
}

/**
 * "shell" — full tablet/desktop shell chrome: sidebar navigation, the
 * currently-selected pane content, scroll restoration, focus management.
 * "chat-only" — renders bare chat, nothing else: no lazy panes, no
 * splits/feed URL-canonicalization effects, no shell chrome. This is how
 * /chat (and any shellViewport-owned product route) renders below the
 * 768px shell boundary. The two modes render the SAME <DimeChatPage>
 * element at the SAME position — only props differ — so crossing 768px
 * never remounts chat (see productRoute.ts `isChatLocation` + App.tsx
 * Router()).
 */
export type DimeAppShellMode = "shell" | "chat-only";

export interface DimeAppShellProps {
  /** Compile-time DEV-gated visual preview capability supplied by App.tsx. */
  previewMode?: boolean;
  mode?: DimeAppShellMode;
}

export default function DimeAppShell({
  previewMode = false,
  mode = "shell",
}: DimeAppShellProps) {
  const [location, navigate] = useLocation();
  const actualRoute = useMemo(
    () => parseDimeProductRoute(location) ?? ({ pane: "chat" } as const),
    [location]
  );
  // A deferred URL route keeps the current pane painted if a newly selected
  // lazy chunk suspends. The address bar and sidebar still update immediately.
  const renderedRoute = useDeferredValue(actualRoute);
  const externalScrollRef = useRef<HTMLDivElement | null>(null);
  const chatHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const externalHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const renderedPaneRef = useRef<DimeProductPane>(renderedRoute.pane);
  const scrollPositionsRef = useRef<Partial<Record<DimeProductPane, number>>>(
    {}
  );
  const resolveRouteHref = useCallback(
    (href: string) => withLocalDimePreview(href, previewMode),
    [previewMode]
  );

  // Hooks always run in the same order regardless of `mode` (Rules of
  // Hooks) — chat-only mode no-ops inside the effect body instead of
  // skipping the hook call. This is also why the shell-only splits
  // URL-canonicalization effect must not run in chat-only mode: there is no
  // splits pane to canonicalize below 768px.
  useEffect(() => {
    if (mode !== "shell") return;
    if (actualRoute.pane !== "splits") return;
    const canonical = canonicalBettingSplitsPath(
      actualRoute.sportSegment,
      actualRoute.dateSegment
    );
    const pathname = location.split(/[?#]/, 1)[0];
    if (pathname !== canonical) {
      navigate(resolveRouteHref(canonical), { replace: true });
    }
  }, [mode, actualRoute, location, navigate, resolveRouteHref]);

  const onNavigate = useCallback(
    (href: string) => {
      startTransition(() => navigate(resolveRouteHref(href)));
    },
    [navigate, resolveRouteHref]
  );

  const onExternalScroll = useCallback(() => {
    const pane = renderedPaneRef.current;
    if (pane === "chat" || !externalScrollRef.current) return;
    scrollPositionsRef.current[pane] = externalScrollRef.current.scrollTop;
  }, []);

  useLayoutEffect(() => {
    if (mode !== "shell") return;
    renderedPaneRef.current = renderedRoute.pane;
    if (renderedRoute.pane !== "chat" && externalScrollRef.current) {
      externalScrollRef.current.scrollTop =
        scrollPositionsRef.current[renderedRoute.pane] ?? 0;
    }
    const frame = requestAnimationFrame(() => {
      const target =
        renderedRoute.pane === "chat"
          ? chatHeadingRef.current
          : externalHeadingRef.current;
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [mode, renderedRoute]);

  // chat-only mode never mounts a lazy pane, never runs pane-switch focus/
  // scroll bookkeeping, and never renders shell chrome — it renders bare
  // chat, identically to the pre-shell standalone /chat route.
  let paneContent = null;
  if (mode === "shell") {
    if (renderedRoute.pane === "feed") {
      paneContent = (
        <DimeModelFeed
          sport={renderedRoute.sportSegment}
          date={renderedRoute.dateSegment}
          embeddedInShell
          resolveRouteHref={resolveRouteHref}
        />
      );
    } else if (renderedRoute.pane === "splits") {
      const parsed = parseBettingSplitsPath(
        renderedRoute.sportSegment,
        renderedRoute.dateSegment
      );
      const state = parsed?.isoDate
        ? { sport: parsed.sport, isoDate: parsed.isoDate }
        : defaultSplitsState();
      paneContent = (
        <BettingSplits
          initialSport={state.sport}
          initialDate={state.isoDate}
          initialDateSource={parsed?.isoDate ? "url-explicit" : "app-default"}
          resolveRouteHref={resolveRouteHref}
        />
      );
    } else if (renderedRoute.pane === "trends") {
      paneContent = <TrendsPage />;
    } else if (renderedRoute.pane === "tracker") {
      paneContent = <BetTracker previewMode={previewMode} />;
    }
  }

  // The SAME <DimeChatPage> element at the SAME position in both modes —
  // only the `shell` prop changes. This is what keeps DimeChatPage mounted
  // (conversation state, in-flight SSE stream, composer draft intact) across
  // an 768px viewport crossing: React reconciles by element type + position,
  // never by `mode`.
  return (
    <>
      {/* Background engagement-session tracking. A lazy, render-null island (no
          layout impact) so it stays off chat's critical-path bundle. Kept as a
          STABLE first sibling so <DimeChatPage> never changes position across a
          768px mode switch — preserving its mount (see the note above). */}
      <Suspense fallback={null}>
        <SessionTracker />
      </Suspense>
      <DimeChatPage
        previewMode={previewMode}
        shell={
          mode !== "shell"
            ? undefined
            : {
                renderedPane: renderedRoute.pane,
                navigationPane: actualRoute.pane,
                paneContent,
                paneHeading: PANE_HEADINGS[renderedRoute.pane],
                onNavigate,
                externalScrollRef,
                chatHeadingRef,
                externalHeadingRef,
                onExternalScroll,
              }
        }
      />
    </>
  );
}
