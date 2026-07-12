import {
  lazy,
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

const PANE_HEADINGS: Record<DimeProductPane, string> = {
  chat: "Dime Chat",
  feed: "AI Model Projections",
  splits: "Betting Splits and Odds History",
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

export interface DimeAppShellProps {
  /** Compile-time DEV-gated visual preview capability supplied by App.tsx. */
  previewMode?: boolean;
}

export default function DimeAppShell({
  previewMode = false,
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

  useEffect(() => {
    if (actualRoute.pane !== "splits") return;
    const canonical = canonicalBettingSplitsPath(
      actualRoute.sportSegment,
      actualRoute.dateSegment
    );
    const pathname = location.split(/[?#]/, 1)[0];
    if (pathname !== canonical) {
      navigate(resolveRouteHref(canonical), { replace: true });
    }
  }, [actualRoute, location, navigate, resolveRouteHref]);

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
  }, [renderedRoute]);

  let paneContent = null;
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
        resolveRouteHref={resolveRouteHref}
      />
    );
  } else if (renderedRoute.pane === "tracker") {
    paneContent = <BetTracker previewMode={previewMode} />;
  }

  return (
    <DimeChatPage
      previewMode={previewMode}
      shell={{
        renderedPane: renderedRoute.pane,
        navigationPane: actualRoute.pane,
        paneContent,
        paneHeading: PANE_HEADINGS[renderedRoute.pane],
        onNavigate,
        externalScrollRef,
        chatHeadingRef,
        externalHeadingRef,
        onExternalScroll,
      }}
    />
  );
}
