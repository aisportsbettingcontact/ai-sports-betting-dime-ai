/**
 * ModelProjections page
 *
 * Shows matchup/score + ODDS/LINES for every game.
 * Betting Splits are intentionally hidden — use the Betting Splits page for those.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useUrlState, type Sport } from "@/hooks/useUrlState";
import { User, LogOut, LogIn, BarChart3, Loader2, Crown, Send, Search, X, Clock, Star, Link2, FlaskConical, ShieldAlert, BarChart2, TrendingUp, AlertTriangle } from "lucide-react";
import { CalendarPicker, todayUTC } from "@/components/CalendarPicker";
import { AnimatePresence, motion } from "framer-motion";

// CDN icon URLs
const CDN_NBA = "https://d2xsxph8kpxj0f.cloudfront.net/310519663397752079/MW3FicTy7ae3qrm8dx8Lua/icon-nba_3fa4f508.png";
import { GameCard } from "@/components/GameCard";
import { MlbLineupCard } from "@/components/MlbLineupCard";
import MlbPropsCard, { type StrikeoutPropRow } from "@/components/MlbPropsCard";
import MlbF5NrfiCard, { type F5NrfiGame } from "@/components/MlbF5NrfiCard";
import MlbCheatSheetCard, { type CheatSheetGame, CheatSheetView, type CheatSheetLineup } from "@/components/MlbCheatSheetCard";
import MlbHrPropsCard, { type HrPropRow } from "@/components/MlbHrPropsCard";
import JackMacView from "@/components/JackMacView";
import { AgeModal } from "@/components/AgeModal";
import { LoginModal } from "@/components/LoginModal";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { getNbaTeamByDbSlug } from "@shared/nbaTeams";
import { useMobileDebug, logMobileEvent } from "@/hooks/useMobileDebug";
import { formatGameTime, timeToMinutes, formatDateHeader, formatDateShort } from '@/lib/gameUtils';
// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Alias: formatMilitaryTime → shared formatGameTime */
const formatMilitaryTime = formatGameTime;

/** Games starting at midnight (00:00 ET) are stored under their correct calendar
 * date by the backend. No frontend date adjustment needed. */
function effectiveGameDate(gameDate: string, _startTimeEst: string | null | undefined): string {
  return gameDate;
}

/** Sort key: midnight (00:00) sorts first (beginning of day = 0 minutes) */
function sortableMinutes(time: string | null | undefined): number {
  return timeToMinutes(time);
}

/**
 * Returns true if a favorited game with the given gameDate has NOT yet expired.
 * A favorited game expires at 11:00 UTC on the calendar day AFTER the game date.
 * e.g. game on 2026-03-08 → expires at 2026-03-09T11:00:00Z
 */
function isFavoriteStillActive(gameDate: string): boolean {
  if (!gameDate) return false;
  // Parse game date as YYYY-MM-DD, advance by 1 day, set to 11:00 UTC
  const [year, month, day] = gameDate.split("-").map(Number);
  if (!year || !month || !day) return false;
  const expiryUtc = Date.UTC(year, month - 1, day + 1, 11, 0, 0, 0);
  return Date.now() < expiryUtc;
}

// ─── Team Logo Badge ──────────────────────────────────────────────────────────
function TeamBadge({ slug, size = 22 }: { slug: string; size?: number }) {
  const nba = getNbaTeamByDbSlug(slug);
  const logo = nba?.logoUrl;
  const initials = (nba?.name ?? slug.replace(/_/g, " ")).slice(0, 2).toUpperCase();
  return (
    <div
      className="rounded overflow-hidden bg-secondary flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size }}
    >
      {logo ? (
        <img src={logo} alt={initials} className="w-full h-full object-contain" />
      ) : (
        <span style={{ fontSize: 7 }} className="font-bold text-muted-foreground">{initials}</span>
      )}
    </div>
  );
}

// ─── Search Result Row ────────────────────────────────────────────────────────
type GameRow = { id: number; awayTeam: string; homeTeam: string; gameDate: string; startTimeEst: string | null; awayBookSpread?: string | null };

function SearchResultRow({ game, onClick }: { game: GameRow; onClick: () => void }) {
  const awayNba = getNbaTeamByDbSlug(game.awayTeam);
  const homeNba = getNbaTeamByDbSlug(game.homeTeam);
  const awaySchool = awayNba?.city ?? game.awayTeam.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const awayNick = awayNba?.nickname ?? "";
  const homeSchool = homeNba?.city ?? game.homeTeam.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const homeNick = homeNba?.nickname ?? "";
  const time = formatMilitaryTime(game.startTimeEst);
  const dateShort = formatDateShort(game.gameDate);

  return (
    <button type="button" onClick={onClick}
      className="w-full hover:bg-white/5 active:bg-white/10 transition-colors text-left border-b border-white/8 last:border-0"
    >
      <div className="flex items-center px-3 py-2.5 gap-2">
        <div className="flex items-center gap-1.5 sm:gap-2" style={{ flex: "1 1 0", minWidth: 0, overflow: "hidden" }}>
          <TeamBadge slug={game.awayTeam} size={22} />
          <div className="flex flex-col" style={{ minWidth: 0, overflow: "hidden" }}>
            <span className="font-bold text-white leading-tight sm:text-sm" style={{ fontSize: "clamp(9px, 2.6vw, 12px)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{awaySchool}</span>
            {awayNick && <span className="font-normal text-zinc-200 leading-tight sm:text-sm" style={{ fontSize: "clamp(8px, 2.2vw, 10px)", whiteSpace: "nowrap", display: "block" }}>{awayNick}</span>}
          </div>
        </div>
        <div className="flex flex-col items-center flex-shrink-0" style={{ minWidth: 66 }}>
          <span className="text-sm text-zinc-300 font-medium leading-tight">@</span>
          <span className="text-xs text-zinc-300 leading-tight text-center whitespace-nowrap mt-0.5">{dateShort}</span>
          <span className="text-xs text-zinc-300 leading-tight text-center whitespace-nowrap">{time}</span>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 justify-end" style={{ flex: "1 1 0", minWidth: 0, overflow: "hidden" }}>
          <div className="flex flex-col items-end" style={{ minWidth: 0, overflow: "hidden" }}>
            <span className="font-bold text-white leading-tight sm:text-sm" style={{ fontSize: "clamp(9px, 2.6vw, 12px)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{homeSchool}</span>
            {homeNick && <span className="font-normal text-zinc-200 leading-tight sm:text-sm" style={{ fontSize: "clamp(8px, 2.2vw, 10px)", whiteSpace: "nowrap", display: "block" }}>{homeNick}</span>}
          </div>
          <TeamBadge slug={game.homeTeam} size={22} />
        </div>
      </div>
    </button>
  );
}

// ─── In-page Favorite Notification ───────────────────────────────────────────
interface FavNotification {
  id: number;
  gameId: number;
  awayTeam: string;
  homeTeam: string;
}

function FavNotificationBanner({ notif, onDismiss }: { notif: FavNotification; onDismiss: (id: number) => void }) {
  const awayNba = getNbaTeamByDbSlug(notif.awayTeam);
  const homeNba = getNbaTeamByDbSlug(notif.homeTeam);
  const awayName = awayNba?.city ?? notif.awayTeam.replace(/_/g, " ");
  const homeName = homeNba?.city ?? notif.homeTeam.replace(/_/g, " ");

  useEffect(() => {
    const t = setTimeout(() => onDismiss(notif.id), 4000);
    return () => clearTimeout(t);
  }, [notif.id, onDismiss]);

  return (
    <motion.div
      initial={{ opacity: 0, y: -12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.96 }}
      transition={{ duration: 0.2 }}
      style={{
        background: "rgba(10,10,10,0.97)",
        border: "1px solid rgba(255,215,0,0.5)",
        borderRadius: 8,
        boxShadow: "0 4px 24px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,215,0,0.15)",
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        minWidth: 220,
        maxWidth: 320,
        pointerEvents: "auto",
      }}
    >
      <Star className="flex-shrink-0" style={{ width: 14, height: 14, color: "#FFD700", fill: "#FFD700" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: "#FFD700", margin: 0, lineHeight: 1.3 }}>Added to Favorites</p>
        <p style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", margin: "2px 0 0", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {awayName} @ {homeName}
        </p>
      </div>
      <button type="button" onClick={() => onDismiss(notif.id)}
        style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "rgba(255,255,255,0.4)", flexShrink: 0 }}
      >
        <X style={{ width: 12, height: 12 }} />
      </button>
    </motion.div>
  );
}

// ─── Stable sort helpers (defined outside component to avoid infinite useMemo loops) ───
const parseLiveSortKey = (gameClock: string | null): [number, number] => {
  if (!gameClock) return [-1, 9999];
  const upper = gameClock.trim().toUpperCase();
  if (upper === "HALF" || upper === "HALFTIME") return [2, 0];
  const bareOtMatch = upper.match(/^(\d*)OT$/);
  if (bareOtMatch) { const otNum = bareOtMatch[1] ? parseInt(bareOtMatch[1]) : 1; return [50 + otNum, 0]; }
  const clockOtMatch = upper.match(/^(\d{1,2}):(\d{2})\s+(\d*)OT$/);
  if (clockOtMatch) {
    const mins = parseInt(clockOtMatch[1]!); const secs = parseInt(clockOtMatch[2]!);
    const otNum = clockOtMatch[3] ? parseInt(clockOtMatch[3]) : 1;
    return [50 + otNum, mins * 60 + secs];
  }
  const clockMatch = upper.match(/^(\d{1,2}):(\d{2})\s+(\d+)(ST|ND|RD|TH)?$/);
  if (clockMatch) {
    const mins = parseInt(clockMatch[1]!); const secs = parseInt(clockMatch[2]!);
    const period = parseInt(clockMatch[3]!);
    return [period, mins * 60 + secs];
  }
  return [-1, 9999];
};

type AnyGame = { gameStatus?: string | null; gameClock?: string | null; startTimeEst?: string | null };
const compareGames = (a: AnyGame, b: AnyGame): number => {
  const statusOrder = (s: string | null | undefined) => s === "live" ? 0 : s === "upcoming" ? 1 : s === "final" ? 2 : 3;
  const sSortA = statusOrder(a?.gameStatus); const sSortB = statusOrder(b?.gameStatus);
  if (sSortA !== sSortB) return sSortA - sSortB;
  if (a?.gameStatus === "live" && b?.gameStatus === "live") {
    const [periodA, clockA] = parseLiveSortKey(a?.gameClock ?? null);
    const [periodB, clockB] = parseLiveSortKey(b?.gameClock ?? null);
    if (periodA !== periodB) return periodB - periodA;
    return clockA - clockB;
  }
  return sortableMinutes(a?.startTimeEst) - sortableMinutes(b?.startTimeEst);
};

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ModelProjections() {
  const [, setLocation] = useLocation();
  const [showAgeModal, setShowAgeModal] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  // Architecture: URL query params for feed state (sport, date, tab, statuses)
  // Enables browser back/forward and bookmarkable URLs
  const {
    selectedSport, setSelectedSport,
    selectedDate, setSelectedDate,
    feedMobileTab: urlFeedMobileTab, setFeedMobileTab: setUrlFeedMobileTab,
    selectedStatuses, setSelectedStatuses,
    resetFilters: resetUrlFilters,
  } = useUrlState();

  // Query which sports have games today or tomorrow (UTC) — hides pills with no games
  const { data: activeSports } = trpc.games.activeSports.useQuery(undefined, {
    staleTime: 5 * 60 * 1000, // re-check every 5 minutes
    refetchOnWindowFocus: false, // server cache (60s TTL) makes window-focus refetch wasteful
  });
  // Auto-switch away from a sport with no games once activeSports loads
  useEffect(() => {
    if (!activeSports) return;
    const sportActive = activeSports[selectedSport as 'NBA' | 'NHL' | 'MLB'];
    if (!sportActive) {
      // Pick the first active sport in display order: MLB → NHL → NBA
      const fallback = (['MLB', 'NHL', 'NBA'] as const).find(s => activeSports[s]);
      if (fallback) setSelectedSport(fallback, true); // isAutoSwitch=true → replace, don't push history
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSports]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(88);
  const [showModel, setShowModel] = useState(true);
  const toggleModel = () => setShowModel((v) => !v);
  // ── Tab bar scroll fade indicator ─────────────────────────────────────────
  // tabsShowFade: true when the tab bar has overflowing content AND user hasn't
  // scrolled to the end. Drives the fade-right gradient mask in the tab bar wrapper.
  const tabsScrollRef = useRef<HTMLDivElement>(null);
  const [tabsShowFade, setTabsShowFade] = useState(false);

  // ── Main page tab: projections | splits ───────────────────────────────────

  // ── Feed-wide mobile tab filter ───────────────────────────────────────────
  // Tabs: MODEL PROJECTIONS (dual) | BETTING SPLITS (splits) | LINEUPS (lineups, MLB only)
  //       K PROPS (props, MLB only) | F5/NRFI (f5nrfi, MLB only) | HR PROPS (hrprops, MLB only)
  //       JACK MAC (jackmac, MLB only, whitelist: prez/sippi/lucianobets)
  type FeedMobileTab = 'dual' | 'splits' | 'lineups' | 'props' | 'f5nrfi' | 'hrprops' | 'jackmac';
  // feedMobileTab now comes from URL params (via useUrlState), with localStorage fallback
  const feedMobileTab = urlFeedMobileTab;
  const handleFeedTabChange = (next: FeedMobileTab) => {
    setUrlFeedMobileTab(next);
  };
  const feedIsDual = feedMobileTab === 'dual';
  // FEED_TABS is built after appUser is declared (see below — canSeeJackMac depends on appUser)

  // ── Favorites tab ──────────────────────────────────────────────────────────
  const [showFavoritesTab, setShowFavoritesTab] = useState(false);

  // Auto-dismiss Favorites tab when activeFavCount drops to 0 (user unfavorited all games)
  // This runs after activeFavCount is computed (defined later via useMemo), so we use useEffect
  // to react to its changes and return the user to the main feed automatically.

  // ── In-page favorite notifications ────────────────────────────────────────
  const [favNotifications, setFavNotifications] = useState<FavNotification[]>([]);
  const notifCounterRef = useRef(0);
  const dismissNotif = useCallback((id: number) => {
    setFavNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  useEffect(() => {
    if (!headerRef.current) return;
    const obs = new ResizeObserver(() => {
      const h = Math.ceil(headerRef.current?.getBoundingClientRect().height ?? 88);
      setHeaderHeight(h);
      // Set CSS variable so sticky column header can position itself below the main header
      document.documentElement.style.setProperty('--prez-header-h', `${h}px`);
    });
    obs.observe(headerRef.current);
    const initialH = Math.ceil(headerRef.current.getBoundingClientRect().height);
    setHeaderHeight(initialH);
    document.documentElement.style.setProperty('--prez-header-h', `${initialH}px`);
    return () => obs.disconnect();
  }, []);

  // ── Tab bar scroll fade: show right-edge gradient when content overflows ───────────
  // Logic: fade is visible when (scrollWidth > clientWidth) AND (not scrolled to end).
  // Updates on: mount, scroll, resize, and FEED_TABS change (sport switch).
  useEffect(() => {
    const el = tabsScrollRef.current;
    if (!el) return;
    const update = () => {
      // scrollWidth > clientWidth means content overflows
      const hasOverflow = el.scrollWidth > el.clientWidth + 1; // +1 for sub-pixel rounding
      // atEnd: within 4px of the right edge (accounts for fractional pixel rounding)
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
      setTabsShowFade(hasOverflow && !atEnd);
    };
    update(); // initial check
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  // Re-run when FEED_TABS changes (sport switch changes tab count)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSport]);

  // ── Scroll active tab into view on sport switch ─────────────────────────────
  // When selectedSport changes, the FEED_TABS array changes length (MLB=6, NHL/NBA=2).
  // The active tab (feedMobileTab) may be off-screen if the previous sport had more tabs.
  // Use requestAnimationFrame to wait for the DOM to reflect the new tab list before scrolling.
  useEffect(() => {
    const el = tabsScrollRef.current;
    if (!el) return;
    // rAF: wait one paint cycle so the new tab buttons are rendered before measuring
    const raf = requestAnimationFrame(() => {
      const activeBtn = el.querySelector<HTMLElement>('[data-active="true"]');
      if (activeBtn) {
        activeBtn.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
      } else {
        // Fallback: scroll to start when no active tab found (e.g. tab not in new sport)
        el.scrollTo({ left: 0, behavior: 'smooth' });
      }
    });
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSport]);

  // ── Mobile debug logging ──────────────────────────────────────────────────────
  // Logs viewport, scale, safe-area insets, header height, and feed budget
  // on every mount and resize. No-op in production. Filter by [MobileDebug:ModelProjections]
  useMobileDebug({
    label: 'ModelProjections',
    headerHeight,
    extra: {
      selectedSport,
      showFavoritesTab,
    },
  });

  const { user, isAuthenticated } = useAuth();
  const { appUser, isOwner, loading: appAuthLoading, refetch: refetchAppUser } = useAppAuth();

  // ── JACK MAC whitelist + FEED_TABS (requires appUser) ─────────────────────
  // JACK MAC tab is MLB-only and visible only to @prez, @sippi, @lucianobets.
  // Must be defined after appUser to avoid TS2448 block-scoped-before-declaration.
  const JACK_MAC_WHITELIST = new Set(['prez', 'sippi', 'lucianobets']);
  const canSeeJackMac = Boolean(appUser && JACK_MAC_WHITELIST.has(appUser.username));
  // Tabs: MODEL PROJECTIONS | BETTING SPLITS | LINEUPS (MLB only) | K PROPS (MLB only)
  //       F5/NRFI (MLB only) | HR PROPS (MLB only) | JACK MAC (MLB only, whitelist)
  // For @lucianobets: JACK MAC is the FIRST tab (leftmost) in MLB.
  // For @prez and @sippi: JACK MAC appears after HR PROPS (standard order).
  const isLuciano = canSeeJackMac && appUser?.username === 'lucianobets';
  const MLB_STANDARD_TABS: { id: FeedMobileTab; label: string }[] = [
    { id: 'dual',    label: 'PROJECTIONS' },
    { id: 'splits',  label: 'SPLITS' },
    { id: 'lineups', label: 'LINEUPS' },
    { id: 'props',   label: 'K PROPS' },
    { id: 'f5nrfi',  label: 'CHEAT SHEETS' },
    { id: 'hrprops', label: 'HR PROPS' },
    ...(canSeeJackMac ? [{ id: 'jackmac' as FeedMobileTab, label: 'JACK MAC' }] : []),
  ];
  const MLB_LUCIANO_TABS: { id: FeedMobileTab; label: string }[] = [
    { id: 'jackmac', label: 'JACK MAC' },
    { id: 'dual',    label: 'PROJECTIONS' },
    { id: 'splits',  label: 'SPLITS' },
    { id: 'lineups', label: 'LINEUPS' },
    { id: 'props',   label: 'K PROPS' },
    { id: 'f5nrfi',  label: 'CHEAT SHEETS' },
    { id: 'hrprops', label: 'HR PROPS' },
  ];
  const FEED_TABS: { id: FeedMobileTab; label: string }[] = selectedSport === 'MLB'
    ? (isLuciano ? MLB_LUCIANO_TABS : MLB_STANDARD_TABS)
    : [
        { id: 'dual',   label: 'MODEL PROJECTIONS' },
        { id: 'splits', label: 'BETTING SPLITS' },
      ];

  // Age modal shown for logged-in users who haven't accepted terms.
  // NOTE: No auth guard redirect — the feed is fully public. Unauthenticated users see the feed.
  useEffect(() => {
    if (!appAuthLoading && appUser && !appUser.termsAccepted) setShowAgeModal(true);
  }, [appAuthLoading, appUser]);

  // ── Discord OAuth callback handler ─────────────────────────────────────────
  // After Discord OAuth completes, the server redirects to /dashboard?discord_linked=1
  // (or ?discord_error=<reason>). We detect these URL params, show a toast, force-
  // refetch appUsers.me (bypassing the 5-min stale cache), and clean the URL.
  // CHECKPOINT:DISCORD_CALLBACK_HANDLER — fires once on mount if discord_linked/error present
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linked = params.get("discord_linked");
    const error  = params.get("discord_error");

    if (linked === "1") {
      console.log("[CHECKPOINT:DISCORD_CALLBACK_HANDLER] discord_linked=1 detected in URL — forcing appUsers.me refetch to show connected username");
      // Force-refetch bypasses the 5-min stale cache so the header button updates immediately
      refetchAppUser();
      toast.success("Discord account connected!", {
        description: "Your Discord username will now appear in the header.",
        duration: 5000,
      });
      // Clean the URL so a page refresh doesn't re-trigger the toast
      const clean = new URL(window.location.href);
      clean.searchParams.delete("discord_linked");
      window.history.replaceState({}, "", clean.pathname + (clean.search || ""));
    } else if (error) {
      const errorMessages: Record<string, string> = {
        // User-facing policy errors
        not_logged_in:       "You must be signed in to connect Discord.",
        denied:              "Discord authorization was cancelled.",
        already_linked:      "This Discord account is already linked to another account on this site. Each Discord account can only be connected to one account. Please use a different Discord account.",
        // OAuth flow errors
        invalid_request:     "Discord OAuth request was invalid. Please try again.",
        state_mismatch:      "Discord OAuth state mismatch. Please try again.",
        state_expired:       "Discord OAuth session expired. Please try again.",
        token_exchange_failed: "Discord token exchange failed. Please try again.",
        profile_fetch_failed:  "Could not fetch your Discord profile. Please try again.",
        // Server/DB errors
        db_unavailable:      "Database temporarily unavailable. Please try again in a moment.",
        db_write_failed:     "Failed to save Discord connection. Please try again.",
        server_error:        "An unexpected server error occurred. Please try again.",
        unknown:             "An unknown error occurred. Please try again.",
      };
      const msg = errorMessages[error] ?? `Discord connection failed: ${error}`;
      console.warn(`[CHECKPOINT:DISCORD_CALLBACK_HANDLER] discord_error="${error}" detected in URL — ${msg}`);
      toast.error("Discord connection failed", { description: msg, duration: 7000 });
      // Clean the URL
      const clean = new URL(window.location.href);
      clean.searchParams.delete("discord_error");
      window.history.replaceState({}, "", clean.pathname + (clean.search || ""));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount only

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const acceptTermsMutation = trpc.appUsers.acceptTerms.useMutation({
    onSuccess: () => { refetchAppUser(); setShowAgeModal(false); },
  });

  const closeSessionMutation = trpc.metrics.closeSession.useMutation();
  const heartbeatMutation = trpc.metrics.sessionHeartbeat.useMutation();
  const appLogoutMutation = trpc.appUsers.logout.useMutation({
    onSuccess: () => { setLocation("/"); toast.success("Signed out"); },
  });
  const appLogout = () => { closeSessionMutation.mutate(); appLogoutMutation.mutate(); };
  // Heartbeat every 5 minutes to track active session duration
  // [PUBLIC MODE] Only fire heartbeat for authenticated users — prevents UNAUTHORIZED noise for public viewers
  useEffect(() => {
    if (!appUser) return;
    const interval = setInterval(() => { heartbeatMutation.mutate(); }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(appUser)]);

  useEffect(() => {
    resetUrlFilters();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSport]);

  // isAppAuthedForFav gates ONLY favorites queries (requires login).
  // games.list and all public feed queries are always enabled — feed is fully public.
  const isAppAuthedForFav = !appAuthLoading && Boolean(appUser);

  // CRITICAL: Pass selectedDate as gameDate explicitly so the server does an exact date match.
  // Without this, the server returns a 7-day rolling window and the client filters by selectedDate.
  // If the server cache was populated at a different UTC boundary (before vs after 11:00 UTC cutoff)
  // than when the client reads it, the dates don't match → all games filtered out → "No games found".
  // With explicit gameDate: server cache key is MLB:{date}, exact eq() match, zero boundary mismatch.
  const { data: allGames, isLoading: gamesLoading } = trpc.games.list.useQuery(
    { sport: selectedSport, gameDate: selectedDate },
    { enabled: true, refetchOnWindowFocus: false, refetchInterval: 60 * 1000, staleTime: 30 * 1000 }
  );

  // Separate lightweight query for available dates (calendar picker).
  // This uses the 7-day rolling window on the server to return all dates that have games,
  // independent of the selectedDate. This way the calendar always shows the full range
  // of available dates even though allGames only contains the selected date's games.
  const { data: availableDatesData } = trpc.games.getAvailableDates.useQuery(
    { sport: selectedSport },
    { refetchOnWindowFocus: false, refetchInterval: 5 * 60 * 1000, staleTime: 2 * 60 * 1000 }
  );

  // Cross-sport game lists for the Favorites tab (needs ALL sports regardless of selectedSport).
  // Only fire when NBA has games (activeSports.NBA) or the Favorites tab is open.
  // This eliminates a redundant 100ms DB round-trip on page load when NBA is off-season.
  const nbaQueryEnabled = activeSports?.NBA === true || showFavoritesTab;
  const { data: allNbaGames } = trpc.games.list.useQuery(
    { sport: "NBA" },
    { enabled: nbaQueryEnabled, refetchOnWindowFocus: false, refetchInterval: 60 * 1000, staleTime: 30 * 1000 }
  );

  const liveCount = useMemo(() =>
    (allGames ?? []).filter(g => g?.gameStatus === "live").length,
    [allGames]
  );

  // ── MLB Lineups ──────────────────────────────────────────────────────────────
  // Fetch lineups for all MLB games in the current window when MLB is selected.
  // Only fires when selectedSport === 'MLB' to avoid unnecessary queries.
  const mlbGameIds = useMemo(() => {
    if (selectedSport !== 'MLB' || !allGames) return [];
    return allGames.filter(g => g?.id).map(g => g!.id);
  }, [selectedSport, allGames]);

  const { data: mlbLineupsRaw } = trpc.games.mlbLineups.useQuery(
    { gameIds: mlbGameIds },
    {
      enabled: selectedSport === 'MLB' && mlbGameIds.length > 0,
      refetchOnWindowFocus: false,
      refetchInterval: 5 * 60 * 1000, // re-fetch every 5 minutes
      staleTime: 2 * 60 * 1000,
    }
  );

  // Map of gameId → lineup row for fast lookup
  const mlbLineupsMap = useMemo(() => {
    if (!mlbLineupsRaw) return new Map();
    return new Map(Object.entries(mlbLineupsRaw).map(([k, v]) => [Number(k), v]));
  }, [mlbLineupsRaw]);

  // ── MLB Strikeout Props ──────────────────────────────────────────────────────
  // Fetch K props for all MLB games when Props tab is active.
  const { data: mlbPropsRaw } = trpc.strikeoutProps.getByGames.useQuery(
    { gameIds: mlbGameIds },
    {
      enabled: selectedSport === 'MLB' && feedMobileTab === 'props' && mlbGameIds.length > 0,
      refetchOnWindowFocus: false,
      refetchInterval: 10 * 60 * 1000, // re-fetch every 10 minutes
      staleTime: 5 * 60 * 1000,
    }
  );

  // Map of gameId → StrikeoutPropRow[] for fast lookup
  const mlbPropsMap = useMemo(() => {
    if (!mlbPropsRaw?.propsByGame) return new Map<number, StrikeoutPropRow[]>();
    return new Map(
      Object.entries(mlbPropsRaw.propsByGame).map(([k, v]) => [Number(k), v as StrikeoutPropRow[]])
    );
  }, [mlbPropsRaw]);

  // ── MLB F5/NRFI — games data already in listGames, no extra query needed ─────
  // F5/NRFI fields are returned as part of the games.list query (all columns selected).
  // We just cast the game rows to F5NrfiGame for the card component.

  // ── MLB HR Props ─────────────────────────────────────────────────────────────
  // Fetch HR props for all MLB games when HR Props tab is active.
  const { data: mlbHrPropsRaw } = trpc.hrProps.getByGames.useQuery(
    { gameIds: mlbGameIds },
    {
      enabled: selectedSport === 'MLB' && feedMobileTab === 'hrprops' && mlbGameIds.length > 0,
      refetchOnWindowFocus: false,
      refetchInterval: 10 * 60 * 1000,
      staleTime: 5 * 60 * 1000,
    }
  );

  // Map of gameId → HrPropRow[] for fast lookup
  const mlbHrPropsMap = useMemo(() => {
    if (!mlbHrPropsRaw?.propsByGame) return new Map<number, HrPropRow[]>();
    return new Map(
      Object.entries(mlbHrPropsRaw.propsByGame).map(([k, v]) => [Number(k), v as HrPropRow[]])
    );
  }, [mlbHrPropsRaw]);

  const toggleStatus = (status: "upcoming" | "live" | "final") => {
    const next = new Set(selectedStatuses);
    if (next.has(status)) next.delete(status); else next.add(status);
    if (next.size === 3) setSelectedStatuses(new Set());
    else setSelectedStatuses(next);
  };

  // All unique dates available for the current sport (sorted ascending).
  // IMPORTANT: This now comes from the dedicated games.getAvailableDates query (7-day rolling window)
  // rather than being computed from allGames. This is necessary because allGames now only contains
  // the selected date's games (exact gameDate filter), so computing allDates from allGames would
  // always return a single-element array, breaking the calendar date navigation.
  const allDates = useMemo(() => {
    if (availableDatesData?.dates && availableDatesData.dates.length > 0) {
      return availableDatesData.dates.slice().sort();
    }
    // Fallback: compute from allGames if the dedicated query hasn't loaded yet
    if (!allGames) return [];
    const dateSet = new Set<string>();
    for (const g of allGames) if (g) dateSet.add(effectiveGameDate(g.gameDate, g.startTimeEst));
    return Array.from(dateSet).sort();
  }, [availableDatesData, allGames]);

  // Auto-advance to the first available date when the current selectedDate has no games.
  // This handles MLB opening day: today is March 24 but first game is March 25.
  // NOTE: Since allGames now only contains games for selectedDate (exact filter), we check
  // allDates (from the rolling window query) to determine if selectedDate is valid.
  // If selectedDate is not in allDates, advance to the first available date.
  useEffect(() => {
    if (allDates.length === 0) return; // still loading
    const hasGamesOnDate = allDates.includes(selectedDate);
    if (!hasGamesOnDate) {
      console.log(`[Feed] No games on ${selectedDate} for ${selectedSport} — advancing to ${allDates[0]}`);
      setSelectedDate(allDates[0]!);
    }
  }, [allDates, selectedDate, selectedSport]);

  const games = useMemo(() => {
    if (!allGames) return allGames;
    let working = selectedStatuses.size === 0 ? allGames : allGames.filter(g => selectedStatuses.has(g?.gameStatus as "upcoming" | "live" | "final"));
    working = working.filter(g => g && effectiveGameDate(g.gameDate, g.startTimeEst) === selectedDate);
    const byDate: Record<string, NonNullable<typeof allGames>[number][]> = {};
    for (const g of working) { const d = effectiveGameDate(g!.gameDate, g!.startTimeEst); if (!byDate[d]) byDate[d] = []; byDate[d]!.push(g!); }
    const result: NonNullable<typeof allGames>[number][] = [];
    for (const d of Object.keys(byDate).sort()) result.push(...byDate[d]!.sort(compareGames));
    return result;
  }, [allGames, selectedStatuses, selectedDate]);

  const { data: lastRefresh } = trpc.games.lastRefresh.useQuery(undefined, { refetchInterval: 60_000 });

    // ── Favorites ──────────────────────────────────────────────────────────────
  // NOTE: isAppAuthedForFav is declared above near games.list queries (line ~477)
  // to gate ALL sensitive queries from the same auth check.
  const { data: favData } = trpc.favorites.getMyFavorites.useQuery(undefined, {
    enabled: isAppAuthedForFav,
    refetchOnWindowFocus: false,
    retry: false,
  });

  // Favorites with game dates — for the Favorites tab and 11:00 UTC expiry
  const { data: favWithDatesData } = trpc.favorites.getMyFavoritesWithDates.useQuery(undefined, {
    enabled: isAppAuthedForFav,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const [optimisticFavIds, setOptimisticFavIds] = useState<Set<number>>(new Set());
  const favIds = useMemo(() => {
    const base = new Set(favData?.favoriteGameIds ?? []);
    Array.from(optimisticFavIds).forEach(id => {
      if (base.has(id)) base.delete(id); else base.add(id);
    });
    return base;
  }, [favData, optimisticFavIds]);

  const utils = trpc.useUtils();
  const toggleFavMutation = trpc.favorites.toggle.useMutation({
    onSuccess: () => {
      utils.favorites.getMyFavorites.invalidate();
      utils.favorites.getMyFavoritesWithDates.invalidate();
      setOptimisticFavIds(new Set());
    },
    onError: () => { setOptimisticFavIds(new Set()); },
  });

  const handleToggleFavorite = (gameId: number) => {
    setOptimisticFavIds(prev => { const next = new Set(prev); if (next.has(gameId)) next.delete(gameId); else next.add(gameId); return next; });
    toggleFavMutation.mutate({ gameId });
  };

  // Called by GameCard when user favorites (not unfavorites) a game
  const handleFavoriteNotify = useCallback((gameId: number) => {
    const game = allGames?.find(g => g?.id === gameId);
    if (!game) return;
    notifCounterRef.current += 1;
    const notifId = notifCounterRef.current;
    setFavNotifications(prev => [...prev, {
      id: notifId,
      gameId,
      awayTeam: game.awayTeam,
      homeTeam: game.homeTeam,
    }]);
  }, [allGames]);

  // Active favorites for the Favorites tab: filter by 11:00 UTC expiry
  const activeFavGameIds = useMemo(() => {
    if (!favWithDatesData?.favorites) return new Set<number>();
    const active = new Set<number>();
    for (const fav of favWithDatesData.favorites) {
      if (isFavoriteStillActive(fav.gameDate)) {
        active.add(fav.gameId);
      }
    }
    return active;
  }, [favWithDatesData]);

  // Merged pool of all games across all sports — used exclusively for the Favorites tab
  type GameItem = NonNullable<NonNullable<typeof allGames>[number]>;
  const allGamesPool = useMemo((): GameItem[] => {
    const pool: GameItem[] = [];
    if (allNbaGames) for (const g of allNbaGames) { if (g) pool.push(g as GameItem); }
    return pool;
  }, [allNbaGames]);

  // Games to show in the Favorites tab (all sports, all dates, filtered by active favs)
  const favoritesTabGames = useMemo((): GameItem[] => {
    if (activeFavGameIds.size === 0) return [];
    const pool: GameItem[] = allGamesPool.length > 0 ? allGamesPool : (allGames ?? []).filter((g): g is GameItem => !!g);
    return pool.filter(g => activeFavGameIds.has(g.id)).sort(compareGames);
  }, [allGamesPool, allGames, activeFavGameIds]);

  // Count of active favorites for the badge
  const activeFavCount = activeFavGameIds.size;

  // Auto-dismiss Favorites tab when count drops to 0 — return user to main feed immediately
  useEffect(() => {
    if (showFavoritesTab && activeFavCount === 0) {
      setShowFavoritesTab(false);
    }
  }, [activeFavCount, showFavoritesTab]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const splitsAgoLabel = useMemo(() => {
    if (!lastRefresh?.refreshedAt) return "—";
    const diffMs = now - new Date(lastRefresh.refreshedAt).getTime();
    const diffMin = Math.round(diffMs / 60_000);
    if (diffMin < 1) return "just now";
    if (diffMin === 1) return "1 min ago";
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHr = Math.round(diffMin / 60);
    return diffHr === 1 ? "1 hr ago" : `${diffHr} hrs ago`;
  }, [lastRefresh, now]);

  const q = searchQuery.trim().toLowerCase();
  const dropdownResults = useMemo(() => {
    if (!games || !q) return [];
    return [...games.filter(game => {
      if (!game) return false;
      const awayNba = getNbaTeamByDbSlug(game.awayTeam);
      const homeNba = getNbaTeamByDbSlug(game.homeTeam);
      const terms = [awayNba?.name ?? "", awayNba?.nickname ?? "", game.awayTeam.replace(/_/g, " "), homeNba?.name ?? "", homeNba?.nickname ?? "", game.homeTeam.replace(/_/g, " ")].map(s => s.toLowerCase());
      return terms.some(t => t.includes(q));
    })].sort((a, b) => {
      const dateCmp = (a!.gameDate ?? "").localeCompare(b!.gameDate ?? "");
      if (dateCmp !== 0) return dateCmp;
      return timeToMinutes(a!.startTimeEst) - timeToMinutes(b!.startTimeEst);
    });
  }, [games, q]);

  const showDropdown = searchFocused && q.length > 0;

  const gamesByDate = useMemo(() =>
    (games ?? []).reduce<Record<string, NonNullable<typeof games>[number][]>>((acc, game) => {
      const date = effectiveGameDate(game!.gameDate, game!.startTimeEst);
      if (!acc[date]) acc[date] = [];
      acc[date]!.push(game!);
      return acc;
    }, {}), [games]);
  const sortedDates = useMemo(() => Object.keys(gamesByDate).sort((a, b) => a.localeCompare(b)), [gamesByDate]);

  const scrollToGame = (gameId: number) => {
    setSearchFocused(false); setSearchQuery("");
    setTimeout(() => {
      const el = document.getElementById(`game-card-${gameId}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // Use CSS animation class instead of setInterval — zero style leak risk
      el.classList.remove('prez-game-pulse');
      // Force reflow to restart animation if already applied
      void el.offsetWidth;
      el.classList.add('prez-game-pulse');
      el.addEventListener('animationend', () => {
        el.classList.remove('prez-game-pulse');
      }, { once: true });
    }, 120);
  };

  return (
    <div className="bg-background">
      {showAgeModal && <AgeModal onAccept={() => acceptTermsMutation.mutate()} onClose={appLogout} />}
      {showLoginModal && <LoginModal onClose={() => setShowLoginModal(false)} onSuccess={() => { setShowLoginModal(false); refetchAppUser(); }} />}

      {/* ── In-page favorite notifications (top-right corner) ── */}
      <div
        style={{
          position: "fixed",
          top: 60,
          right: 12,
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          pointerEvents: "none",
        }}
      >
        <AnimatePresence>
          {favNotifications.map(notif => (
            <FavNotificationBanner key={notif.id} notif={notif} onDismiss={dismissNotif} />
          ))}
        </AnimatePresence>
      </div>

      {/* ── Sticky Header ── */}
      <header ref={headerRef} className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm sticky-header-safe">

        {/* Row 1: brand + user icon
         * LAYOUT: flex row — brand LEFT, discord + user RIGHT.
         * MOBILE FIX: removed absolute centering (absolute left-1/2 -translate-x-1/2)
         * which caused PREZ BETS to physically overlap the Discord button on narrow
         * screens. Now brand is a normal flex item on the left; Discord button and
         * user icon are flex-shrink-0 on the right. Gap between them is handled by
         * flex-1 spacer. This guarantees zero overlap at every viewport width.
         */}
        <div className="flex items-center gap-2 px-4 pt-2 pb-1 md:pt-3 md:pb-2 w-full min-w-0">
          {/* ── Brand: left-aligned, shrinks gracefully on narrow screens ── */}
          <div className="flex items-center gap-1.5 flex-shrink-0 min-w-0">
            <BarChart3 className="flex-shrink-0 text-primary" style={{ width: "clamp(14px, 3.5vw, 20px)", height: "clamp(14px, 3.5vw, 20px)" }} />
            <span className="font-black text-white whitespace-nowrap" style={{ fontSize: "clamp(12px, 3.5vw, 18px)", letterSpacing: "0.08em" }}>PREZ BETS</span>
          </div>
          {/* ── Spacer: pushes Discord + user icon to the right ── */}
          <div className="flex-1 min-w-0" />
          {/* ─── Discord Button ─────────────────────────────────────────────────────
           * DESIGN: Official Discord branding — solid #3238a9 background, white text,
           *         GG Sans font, Discord logo SVG. No opacity/transparency.
           *         Color: #3238a9 (deep Discord blue — richer, easier to read than #738ADB)
           *
           * STATES:
           *   Connected    → read-only pill showing Discord logo + @displayName
           *                  (no click action — users CANNOT disconnect their own Discord)
           *   Not connected → clickable link to /api/auth/discord/connect
           *
           * MOBILE: Text always visible on all screen sizes (no hidden sm:inline).
           *         Button shrinks gracefully via min-width:0 and text truncation.
           *
           * POLICY: One-time-only connection. Once a user links their Discord account,
           *         it is permanent from their perspective. Only @prez (owner) can
           *         disconnect accounts via the User Management admin panel.
           *         Server enforces uniqueness: one Discord ID → one site account, ever.
           * ─────────────────────────────────────────────────────────────────────── */}
          {appUser && (
            <div className="flex-shrink-0 mr-2">
              {appUser.discordId ? (
                // ── CONNECTED STATE: read-only, no click, no disconnect ──
                // Shows Discord logo + @displayName in GG Sans white on #738ADB
                <div
                  title={`Discord connected: @${appUser.discordUsername ?? appUser.discordId}`}
                  className="flex items-center gap-[6px] px-3 py-1.5 rounded-full select-none cursor-default min-w-0"
                  style={{
                    background: "#3238a9",
                    color: "#ffffff",
                    fontFamily: "'GG Sans', 'Noto Sans', sans-serif",
                    fontWeight: 600,
                    fontSize: "13px",
                    letterSpacing: "0.01em",
                    lineHeight: 1,
                    border: "none",
                    outline: "none",
                    boxShadow: "none",
                    opacity: 1,
                    whiteSpace: "nowrap",
                  }}
                >
                  {/* Official Discord logo SVG — white fill */}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="#ffffff" className="flex-shrink-0" aria-hidden="true">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.08.11 18.1.132 18.115a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                  </svg>
                  {/* Always visible on all screen sizes including mobile */}
                  <span style={{ whiteSpace: "nowrap" }}>
                    @{appUser.discordUsername ?? appUser.discordId}
                  </span>
                </div>
              ) : (
                // ── NOT CONNECTED STATE: clickable link to Discord OAuth ──
                // Shows Discord logo + "CONNECT DISCORD" in GG Sans white on #738ADB
                <a
                  href="/api/auth/discord/connect"
                  title="Link your Discord account to verify membership"
                  className="flex items-center gap-[6px] px-3 py-1.5 rounded-full no-underline min-w-0"
                  style={{
                    background: "#3238a9",
                    color: "#ffffff",
                    fontFamily: "'GG Sans', 'Noto Sans', sans-serif",
                    fontWeight: 600,
                    fontSize: "13px",
                    letterSpacing: "0.01em",
                    lineHeight: 1,
                    border: "none",
                    outline: "none",
                    boxShadow: "none",
                    opacity: 1,
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  {/* Official Discord logo SVG — white fill */}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="#ffffff" className="flex-shrink-0" aria-hidden="true">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.08.11 18.1.132 18.115a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                  </svg>
                  {/* Always visible on all screen sizes including mobile */}
                  <span style={{ whiteSpace: "nowrap" }}>CONNECT DISCORD</span>
                </a>
              )}
            </div>
          )}
          {/* User menu */}
          <div className="flex-shrink-0 relative">
            <button type="button" onClick={() => setShowUserMenu(!showUserMenu)} className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center hover:bg-accent transition-colors" title={user ? user.name ?? "Account" : "Sign in"}>
              <User className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
            {showUserMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                <div className="absolute right-0 top-9 z-50 w-48 bg-card border border-border rounded-lg shadow-xl overflow-hidden">
                  {appUser ? (
                    <>
                      <div className="px-3 py-2.5 border-b border-border">
                        <div className="flex items-center gap-1.5">
                          {appUser.role === "owner" && <Crown className="w-3 h-3 text-yellow-400 flex-shrink-0" />}
                          <p className="text-xs font-semibold text-foreground truncate">@{appUser.username}</p>
                        </div>
                        <p className="text-sm text-muted-foreground truncate">{appUser.email}</p>
                        {/* Session duration badge */}
                        {(() => {
                          const exp = (appUser as { sessionExpiresAt?: number | null }).sessionExpiresAt;
                          if (!exp) return (
                            <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/5 text-white/40">
                              <span className="w-1.5 h-1.5 rounded-full bg-white/30 inline-block" />
                              Session: browser
                            </span>
                          );
                          const daysLeft = Math.max(0, Math.ceil((exp - Date.now()) / 86_400_000));
                          const color = daysLeft <= 3 ? "text-red-400 bg-red-400/10" : daysLeft <= 14 ? "text-amber-400 bg-amber-400/10" : "text-emerald-400 bg-emerald-400/10";
                          const dot = daysLeft <= 3 ? "bg-red-400" : daysLeft <= 14 ? "bg-amber-400" : "bg-emerald-400";
                          return (
                            <span className={`inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${color}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${dot} inline-block`} />
                              Session: {daysLeft}d remaining
                            </span>
                          );
                        })()}
                      </div>
                      {(isOwner || appUser.role === "admin" || appUser.role === "handicapper") && (
                        <button type="button" onClick={() => { setShowUserMenu(false); setLocation("/bet-tracker"); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                          <BarChart2 className="w-3.5 h-3.5 text-emerald-400" /> Bet Tracker
                        </button>
                      )}
                      {/* RESOURCES removed — content migrated to JACK MAC tab in main feed */}
                      {isOwner && (
                        <>
                          <button type="button" onClick={() => { setShowUserMenu(false); setLocation("/admin/publish"); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                            <Send className="w-3.5 h-3.5 text-green-400" /> Publish Projections
                          </button>
                          <button type="button" onClick={() => { setShowUserMenu(false); setLocation("/admin/users"); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                            <Crown className="w-3.5 h-3.5 text-yellow-400" /> User Management
                          </button>
                          <button type="button" onClick={() => { setShowUserMenu(false); setLocation("/admin/model-results"); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                            <FlaskConical className="w-3.5 h-3.5 text-blue-400" /> THE MODEL RESULTS
                          </button>
                          <button type="button" onClick={() => { setShowUserMenu(false); setLocation("/admin/security"); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                            <ShieldAlert className="w-3.5 h-3.5 text-red-400" /> Security Events
                          </button>
                          <button type="button" onClick={() => { setShowUserMenu(false); setLocation("/admin/postponed-games"); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> Postponed Games
                          </button>
                        </>
                      )}
                      <button type="button" onClick={() => { setShowUserMenu(false); appLogout(); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                        <LogOut className="w-3.5 h-3.5" /> Sign out
                      </button>
                    </>
                  ) : user ? (
                    <>
                      <div className="px-3 py-2.5 border-b border-border">
                        <p className="text-xs font-semibold text-foreground truncate">{user.name ?? "User"}</p>
                        <p className="text-sm text-muted-foreground truncate">{user.email ?? ""}</p>
                      </div>
                      <button type="button" onClick={() => { setShowUserMenu(false); appLogout(); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                        <LogOut className="w-3.5 h-3.5" /> Sign out
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setShowUserMenu(false); setShowLoginModal(true); }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                    >
                      <LogIn className="w-3.5 h-3.5 text-emerald-400" /> Sign In
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>


        {/* Row 3: Unified filter bar — FAVORITES | DATE | MLB | NHL | NBA | Search */}
        {/* Mobile: gap-1 px-2 to keep all pills + search on one row within 375-430px screens */}
        {/* sm+: gap-2 px-3 (unchanged from original) */}
        <div ref={searchRef} className="relative px-2 sm:px-3 md:px-4 pt-1 pb-0 md:pt-2 md:pb-1 flex items-center gap-1 sm:gap-2 md:gap-3">

          {/* FAVORITES tab — shown when user is authenticated AND has ≥1 active favorite */}
          {/* NOTE: must use isAppAuthedForFav (Boolean(appUser)) — NOT isAuthenticated (Manus OAuth always null) */}
          {isAppAuthedForFav && activeFavCount >= 1 && (
            <button type="button" onClick={() => setShowFavoritesTab(v => !v)}
              className="flex items-center gap-1 sm:gap-1.5 md:gap-2 px-1.5 sm:px-2.5 md:px-3 py-1 sm:py-1.5 md:py-2 rounded-full text-sm sm:text-sm md:text-[13px] font-bold tracking-wide transition-all flex-shrink-0"
              style={showFavoritesTab
                ? { background: "rgba(255,215,0,0.18)", color: "#FFD700", border: "1px solid rgba(255,215,0,0.55)", boxShadow: "0 0 8px rgba(255,215,0,0.15)" }
                : { background: "hsl(var(--card))", color: "rgba(255,215,0,0.75)", border: "1px solid rgba(255,215,0,0.35)" }
              }
              title={`Favorites (${activeFavCount})`}
            >
              <Star style={{ width: 11, height: 11, fill: showFavoritesTab ? "#FFD700" : "rgba(255,215,0,0.75)", color: showFavoritesTab ? "#FFD700" : "rgba(255,215,0,0.75)", flexShrink: 0 }} />
              <span>Favorites</span>
            </button>
          )}

          {/* DATE picker — always visible, even in favorites tab */}
          <CalendarPicker
            selectedDate={selectedDate}
            onSelect={setSelectedDate}
            availableDates={new Set(allDates)}
            isAdmin={isOwner || user?.role === "admin"}
          />

          {/* MLB pill — only shown when MLB has games today or tomorrow */}
          {(!activeSports || activeSports.MLB) && (
            <button type="button" onClick={() => setSelectedSport("MLB")} className="flex items-center gap-0.5 sm:gap-1 md:gap-1.5 px-1.5 sm:px-2 md:px-3 py-1 md:py-2 min-h-[44px] rounded-full font-bold tracking-wide transition-all flex-shrink-0"
              style={{ fontSize: 'clamp(10px, 1.7vw, 13px)', ...(selectedSport === "MLB" ? { background: "transparent", color: "#ffffff", border: "1px solid rgba(255,255,255,0.6)" } : { background: "hsl(var(--card))", color: "rgba(255,255,255,0.45)", border: "1px solid hsl(var(--border))" }) }}>
              <img src="https://www.mlbstatic.com/team-logos/league-on-dark/1.svg" alt="MLB" className="w-[10px] h-[10px] md:w-[14px] md:h-[14px]" style={{ objectFit: "contain", opacity: selectedSport === "MLB" ? 1 : 0.5, flexShrink: 0 }} />
              MLB
            </button>
          )}

          {/* NHL pill — only shown when NHL has games today or tomorrow */}
          {(!activeSports || activeSports.NHL) && (
            <button type="button" onClick={() => setSelectedSport("NHL")} className="flex items-center gap-0.5 sm:gap-1 md:gap-1.5 px-1.5 sm:px-2 md:px-3 py-1 md:py-2 min-h-[44px] rounded-full font-bold tracking-wide transition-all flex-shrink-0"
              style={{ fontSize: 'clamp(10px, 1.7vw, 13px)', ...(selectedSport === "NHL" ? { background: "transparent", color: "#ffffff", border: "1px solid rgba(255,255,255,0.6)" } : { background: "hsl(var(--card))", color: "rgba(255,255,255,0.45)", border: "1px solid hsl(var(--border))" }) }}>
              <img src="https://media.d3.nhle.com/image/private/t_q-best/prd/assets/nhl/logos/nhl_shield_wm_on_dark_fqkbph" alt="NHL" className="w-[10px] h-[10px] md:w-[14px] md:h-[14px]" style={{ objectFit: "contain", opacity: selectedSport === "NHL" ? 1 : 0.5, flexShrink: 0 }} />
              NHL
            </button>
          )}

          {/* NBA pill — only shown when NBA has games today or tomorrow */}
          {(!activeSports || activeSports.NBA) && (
            <button type="button" onClick={() => setSelectedSport("NBA")} className="flex items-center gap-0.5 sm:gap-1 md:gap-1.5 px-1.5 sm:px-2 md:px-3 py-1 md:py-2 min-h-[44px] rounded-full font-bold tracking-wide transition-all flex-shrink-0"
              style={{ fontSize: 'clamp(10px, 1.7vw, 13px)', ...(selectedSport === "NBA" ? { background: "transparent", color: "#ffffff", border: "1px solid rgba(255,255,255,0.6)" } : { background: "hsl(var(--card))", color: "rgba(255,255,255,0.45)", border: "1px solid hsl(var(--border))" }) }}>
              <img src={CDN_NBA} alt="NBA" className="w-[10px] h-[10px] md:w-[14px] md:h-[14px]" style={{ objectFit: "contain", opacity: selectedSport === "NBA" ? 1 : 0.5, flexShrink: 0 }} />
              NBA
            </button>
          )}



          {/* Search bar — always visible, shrinks when Favorites button is present */}
          {/* Mobile: min-w-[28px] so it always shows at least the icon; flex-1 fills remaining space */}
          <div className="flex-1 min-w-0" style={{ minWidth: 28 }}>
            <div className="flex items-center gap-1.5 sm:gap-2 md:gap-2.5 px-2 sm:px-2.5 md:px-3 py-1 sm:py-1.5 md:py-2 rounded-full border transition-all duration-150"
              style={{ background: "hsl(var(--secondary))", borderColor: searchFocused ? "rgba(34,197,94,0.5)" : "hsl(var(--border))", boxShadow: searchFocused ? "0 0 0 1px rgba(34,197,94,0.15)" : "none" }}>
              <Search className="w-3 h-3 md:w-4 md:h-4 text-muted-foreground flex-shrink-0" />
              <input ref={inputRef} type="text" placeholder="Search…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onFocus={() => setSearchFocused(true)} className="flex-1 min-w-0 bg-transparent text-xs md:text-[13px] text-foreground placeholder:text-muted-foreground outline-none" />
              {searchQuery && <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setSearchQuery(""); inputRef.current?.focus(); }} className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"><X className="w-3 h-3 md:w-4 md:h-4" /></button>}
            </div>
          </div>



          {/* Search dropdown */}
          {showDropdown && (
            <div className="absolute left-3 right-3 top-full mt-0.5 z-50 rounded-xl border border-white/10 shadow-2xl overflow-hidden" style={{ background: "#0f0f0f", maxHeight: "calc(3 * 68px + 44px)", overflowY: "auto" }}>
              <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 sticky top-0" style={{ background: "#0f0f0f", zIndex: 10 }}>
                <span className="text-sm text-zinc-300 uppercase tracking-widest">{dropdownResults.length === 0 ? "No results" : `${dropdownResults.length} game${dropdownResults.length !== 1 ? "s" : ""}`}</span>
                {dropdownResults.length > 0 && <span className="text-sm text-zinc-300">tap to jump</span>}
              </div>
              {dropdownResults.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 gap-2">
                  <Search className="w-5 h-5 text-zinc-300" />
                  <p className="text-xs text-zinc-300">No games found for "{searchQuery}"</p>
                </div>
              ) : dropdownResults.map((game) => <SearchResultRow key={game!.id} game={game!} onClick={() => scrollToGame(game!.id)} />)}
            </div>
          )}
        </div>

        {/* Row 4: Date header — shown when games are loaded and NOT in favorites tab */}
        {/* Mobile fix: single non-wrapping line, fully centered, font sizes tuned so the longest
            string ("THURSDAY, MARCH 12, 2026 · MEN'S COLLEGE BASKETBALL") fits within 375px.
            At 375px: date ≈ 11px × ~26 chars = ~286px, dot = 5px, league ≈ 9px × ~24 chars = ~216px
            Total ≈ 507px — too wide at fixed sizes, so we use a single-line flex container that
            shrinks proportionally via font-size: clamp(9px, 2.4vw, ...) for the league label.
            sm+ breakpoints are unchanged from the original design. */}
        {!showFavoritesTab && !gamesLoading && sortedDates.length > 0 && (
          <div className="w-full flex items-center justify-center px-2 py-1 md:py-2 border-b border-border bg-background/95 sm:px-4" style={{ overflow: 'hidden' }}>
            {/* Single-line pill: all three spans in one nowrap flex row, centered in full width */}
            <div
              className="flex items-center justify-center"
              style={{
                gap: 'clamp(3px, 1vw, 8px)',
                maxWidth: '100%',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
              }}
            >
              <span
                className="font-bold tracking-widest uppercase"
                style={{
                  /* Mobile: shrinks from 11px at 375px up to 19px at 640px+ */
                  fontSize: 'clamp(9px, 2.9vw, 19px)',
                  color: '#ffffff',
                  whiteSpace: 'nowrap',
                  flexShrink: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >{formatDateHeader(selectedDate)}</span>
              <span style={{
                fontSize: 'clamp(11px, 3vw, 22px)',
                color: '#ffffff',
                fontWeight: 800,
                lineHeight: 1,
                flexShrink: 0,
              }}>·</span>
              <span
                className="font-semibold"
                style={{
                  color: '#a3a3a3',
                  letterSpacing: '0.04em',
                  /* Mobile: 8px at 375px keeps "MEN'S COLLEGE BASKETBALL" fully visible */
                  /* Tablet: clamp hits 12px at 571px; bump max to 14px for 768px readability */
                  fontSize: 'clamp(8px, 2.1vw, 14px)',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >{selectedSport === 'NBA' ? 'NBA BASKETBALL' : selectedSport === 'MLB' ? 'MLB BASEBALL' : 'NHL HOCKEY'}</span>
            </div>
          </div>
        )}

        {/* Row 4 (favorites mode): Favorites header */}
        {showFavoritesTab && (
          <div className="flex items-center px-4 py-1 md:py-2 border-b border-border bg-background/95 gap-2">
            <div className="flex-1" />
            <span className="font-bold tracking-widest uppercase" style={{ fontSize: "clamp(11px, 2vw, 15px)", color: "#FFD700" }}>
              FAVORITED GAMES
            </span>
            <div className="flex-1" />
          </div>
        )}

        {/* Row 5: Feed-wide mobile tab filter — MODEL PROJECTIONS | BETTING SPLITS | LINEUPS (MLB) */}
        {/* Tab bar: Fix #9 — flex + overflow-x:auto + scroll-snap for 6-tab MLB row */}
        {/* Fade wrapper: position:relative so the ::after pseudo-element can be absolutely */}
        {/* positioned over the right edge. tabsShowFade drives the CSS class. */}
        <div className="feed-tabs-wrapper" style={{ position: 'relative' }}>
        <div ref={tabsScrollRef} className="feed-tabs-scroll" style={{
            display: 'flex',
            overflowX: 'auto',
            overflowY: 'hidden',
            scrollSnapType: 'x mandatory',
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none',
            // Prevent vertical scroll from propagating to the page when swiping horizontally.
            // overscrollBehaviorX: contain — stops the horizontal swipe from triggering
            // the parent page's vertical scroll chain on iOS/Android.
            // touchAction: pan-x — tells the browser this element only scrolls horizontally,
            // so vertical swipes are immediately handed off to the page scroll handler.
            overscrollBehaviorX: 'contain',
            touchAction: 'pan-x',
            borderBottom: '2px solid hsl(var(--border) / 0.5)',
            background: 'hsl(var(--card))',
          }}>
            {FEED_TABS.map(tab => {
              const isActive = feedMobileTab === tab.id;
              const handleClick = () => {
                handleFeedTabChange(tab.id);
              };
              return (
                <button type="button" key={tab.id}
                  onClick={handleClick}
                  className="feed-tab"
                  data-active={isActive ? "true" : undefined}
                  style={{
                    flex: '0 0 auto',
                    scrollSnapAlign: 'start',
                    padding: '7px 12px',
                    minHeight: 44,
                    fontSize: '13px',
                    fontWeight: isActive ? 800 : 500,
                    letterSpacing: '0.06em',
                    color: isActive ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.45)',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: isActive ? '2px solid #39FF14' : '2px solid transparent',
                    marginBottom: '-2px',
                    cursor: 'pointer',
                    transition: 'color 0.15s, border-color 0.15s',
                    textTransform: 'uppercase',
                    lineHeight: 1.2,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
          {/* Fade-right gradient overlay: visible when tabsShowFade=true (scroll needed) */}
          {/* Pointer-events:none so clicks pass through to the tab buttons beneath */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              width: 48,
              background: 'linear-gradient(to right, transparent, hsl(var(--card)))',
              pointerEvents: 'none',
              opacity: tabsShowFade ? 1 : 0,
              transition: 'opacity 0.2s ease',
            }}
          />
        </div>{/* end feed-tabs-wrapper */}
      </header>

      {/* ── Sticky global column header (mobile only) — MATCHUP | SPREAD/PUCK LINE | TOTAL | ML ── */}
      {/* Only shown when MODEL PROJECTIONS tab is active. Hidden for BETTING SPLITS tab. */}
      {feedMobileTab === 'dual' && (
        <div className="lg:hidden" style={{
          position: 'sticky', top: 'var(--prez-header-h, 88px)', zIndex: 10,
          display: 'grid',
          gridTemplateColumns: 'clamp(170px, 14vw, 220px) 1fr',
          background: 'hsl(var(--card))',
          borderBottom: '1px solid rgba(255,255,255,0.10)',
          borderTop: '1px solid rgba(255,255,255,0.06)',
        }}>
          {/* Left: MATCHUP label */}
          <div style={{ padding: '5px 8px', display: 'flex', alignItems: 'center', borderRight: '1px solid rgba(255,255,255,0.10)' }}>
            <span style={{ fontSize: 'clamp(10px, 2.2vw, 12px)', fontWeight: 700, color: 'rgba(255,255,255,0.65)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>MATCHUP</span>
          </div>
          {/* Right: SPREAD/PUCK LINE | TOTAL | ML labels aligned to card columns */}
          <div style={{ padding: '5px 8px', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <div style={{ display: 'flex', gap: '5px', flex: '1 1 0', minWidth: 0 }}>
              {[selectedSport === 'NHL' ? 'PUCK LINE' : selectedSport === 'MLB' ? 'RUN LINE' : 'SPREAD', 'TOTAL', 'ML'].map(h => (
                <div key={h} style={{ flex: '1 1 0', textAlign: 'center' }}>
                  <span style={{ fontSize: 'clamp(10px, 2.2vw, 12px)', fontWeight: 700, color: 'rgba(255,255,255,0.75)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Main Feed ── */}
      {/* touch-action: pan-y — allows vertical scrolling while blocking horizontal
           interference from the frozen panel scroll containers inside GameCard.
           -webkit-overflow-scrolling: touch — enables iOS momentum scrolling. */}
      <main className="w-full feed-pb-safe" style={{ touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>

        {/* ── UNIFIED FEED (projections + splits always shown) ── */}
        {true && (
          <>
            {/* FAVORITES TAB FEED */}
            {showFavoritesTab ? (
              favoritesTabGames.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 gap-4 text-center px-4">
                  <Star className="w-10 h-10" style={{ color: "rgba(255,215,0,0.3)" }} />
                  <div>
                    <p className="text-sm font-semibold text-foreground mb-1">No favorited games</p>
                    <p className="text-xs text-muted-foreground">
                      Tap the ⭐ star on any game card to add it to your favorites.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="bg-card mx-0">
                  {favoritesTabGames.map((game) => (
                    <div key={game!.id} id={`game-card-${game!.id}`}>
                      <GameCard
                        game={game!}
                        mode="full"
                        showModel={showModel}
                        onToggleModel={toggleModel}
                        favoriteGameIds={favIds}
                        onToggleFavorite={handleToggleFavorite}
                        onFavoriteNotify={handleFavoriteNotify}
                        isAppAuthed={Boolean(appUser)}
                        mobileTab={(feedMobileTab === 'lineups' || feedMobileTab === 'props') ? 'dual' : feedMobileTab as 'dual' | 'splits'}
                        onMobileTabChange={(t) => handleFeedTabChange(t)}
                      />
                    </div>
                  ))}
                </div>
              )
            ) : (
              /* NORMAL PROJECTIONS FEED — or LINEUPS/PROPS tab for MLB */
              feedMobileTab === 'lineups' && selectedSport === 'MLB' ? (
                /* ── LINEUPS VIEW ── */
                gamesLoading ? (
                  <div className="flex flex-col items-center justify-center py-24 gap-3">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    <p className="text-sm text-muted-foreground">Loading lineups…</p>
                  </div>
                ) : sortedDates.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-24 gap-4 text-center px-4">
                    <BarChart3 className="w-10 h-10 text-muted-foreground/40" />
                    <div>
                      <p className="text-sm font-semibold text-foreground mb-1">No MLB games found</p>
                      <p className="text-xs text-muted-foreground">Check back closer to Opening Day.</p>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '10px 10px 0' }}>
                    {sortedDates.map((date) => (
                      <div key={date}>
                        {gamesByDate[date]!.map((game) => (
                          <MlbLineupCard
                            key={game!.id}
                            awayTeam={game!.awayTeam}
                            homeTeam={game!.homeTeam}
                            startTime={game!.startTimeEst ? formatMilitaryTime(game!.startTimeEst) : 'TBD'}
                            lineup={mlbLineupsMap.get(game!.id) as Parameters<typeof MlbLineupCard>[0]['lineup']}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                )
              ) : feedMobileTab === 'props' && selectedSport === 'MLB' ? (
                /* ── K PROPS VIEW ── */
                gamesLoading ? (
                  <div className="flex flex-col items-center justify-center py-24 gap-3">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    <p className="text-sm text-muted-foreground">Loading K props…</p>
                  </div>
                ) : sortedDates.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-24 gap-4 text-center px-4">
                    <BarChart3 className="w-10 h-10 text-muted-foreground/40" />
                    <div>
                      <p className="text-sm font-semibold text-foreground mb-1">No MLB games found</p>
                      <p className="text-xs text-muted-foreground">Check back closer to Opening Day.</p>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '10px 10px 0' }}>
                    {sortedDates.map((date) => (
                      <div key={date}>
                        {gamesByDate[date]!.map((game) => (
                          <MlbPropsCard
                            key={game!.id}
                            awayTeam={game!.awayTeam}
                            homeTeam={game!.homeTeam}
                            startTime={game!.startTimeEst ? formatMilitaryTime(game!.startTimeEst) : 'TBD'}
                            props={mlbPropsMap.get(game!.id) as StrikeoutPropRow[] | undefined}
                            lineup={mlbLineupsMap.get(game!.id) as { awayPitcherConfirmed?: boolean | null; homePitcherConfirmed?: boolean | null } | undefined}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                )
              ) : feedMobileTab === 'f5nrfi' && selectedSport === 'MLB' ? (
                /* ── F5 / NRFI VIEW ── */
                gamesLoading ? (
                  <div className="flex flex-col items-center justify-center py-24 gap-3">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    <p className="text-sm text-muted-foreground">Loading Cheat Sheets…</p>
                  </div>
                ) : sortedDates.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-24 gap-4 text-center px-4">
                    <BarChart3 className="w-10 h-10 text-muted-foreground/40" />
                    <div>
                      <p className="text-sm font-semibold text-foreground mb-1">No MLB games found</p>
                      <p className="text-xs text-muted-foreground">Check back on game day.</p>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '10px 10px 0' }}>
                    {sortedDates.map((date) => (
                      <CheatSheetView
                        key={date}
                        games={gamesByDate[date]!.map(g => g as unknown as CheatSheetGame)}
                        lineupsMap={mlbLineupsMap as unknown as Map<number, CheatSheetLineup>}
                        dateLabel={formatDateHeader(date)}
                      />
                    ))}
                  </div>
                )
              ) : feedMobileTab === 'hrprops' && selectedSport === 'MLB' ? (
                /* ── HR PROPS VIEW ── */
                gamesLoading ? (
                  <div className="flex flex-col items-center justify-center py-24 gap-3">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    <p className="text-sm text-muted-foreground">Loading HR props…</p>
                  </div>
                ) : sortedDates.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-24 gap-4 text-center px-4">
                    <BarChart3 className="w-10 h-10 text-muted-foreground/40" />
                    <div>
                      <p className="text-sm font-semibold text-foreground mb-1">No MLB games found</p>
                      <p className="text-xs text-muted-foreground">Check back on game day.</p>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '10px 10px 0' }}>
                    {sortedDates.map((date) => (
                      <div key={date}>
                        {gamesByDate[date]!.map((game) => (
                          <MlbHrPropsCard
                            key={game!.id}
                            awayTeam={game!.awayTeam}
                            homeTeam={game!.homeTeam}
                            startTime={game!.startTimeEst ?? ''}
                            props={mlbHrPropsMap.get(game!.id) as HrPropRow[] | undefined}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                )
              ) : feedMobileTab === 'jackmac' && selectedSport === 'MLB' && canSeeJackMac ? (
                /* ── JACK MAC VIEW (whitelist: prez/sippi/lucianobets) ── */
                <JackMacView appUser={appUser} />
              ) : (
                /* ── PROJECTIONS / SPLITS VIEW ── */
                gamesLoading ? (
                  <div className="flex flex-col items-center justify-center py-24 gap-3">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    <p className="text-sm text-muted-foreground">Loading projections…</p>
                  </div>
                ) : sortedDates.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-24 gap-4 text-center px-4">
                    <BarChart3 className="w-10 h-10 text-muted-foreground/40" />
                    <div>
                      <p className="text-sm font-semibold text-foreground mb-1">No games found</p>
                      <p className="text-xs text-muted-foreground">
                        {selectedStatuses.size > 0 ? `No ${Array.from(selectedStatuses).join(" or ")} ${selectedSport} games right now.` : `No ${selectedSport} games found.`}
                      </p>
                    </div>
                  </div>
                ) : (
                  sortedDates.map((date) => (
                    <div key={date}>
                      <div className="bg-card mx-0">
                        {gamesByDate[date]!.map((game) => (
                          <div key={game!.id} id={`game-card-${game!.id}`}>
                            <GameCard
                              game={game!}
                              mode="full"
                              showModel={showModel}
                              onToggleModel={toggleModel}
                              favoriteGameIds={favIds}
                              onToggleFavorite={handleToggleFavorite}
                              onFavoriteNotify={handleFavoriteNotify}
                              isAppAuthed={Boolean(appUser)}
                              mobileTab={(['lineups', 'props', 'f5nrfi', 'hrprops'].includes(feedMobileTab)) ? 'dual' : feedMobileTab as 'dual' | 'splits'}
                              onMobileTabChange={(t) => handleFeedTabChange(t)}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )
              )
            )}
          </>
        )}
      </main>
    </div>
  );
}
