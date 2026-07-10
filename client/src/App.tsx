import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, Redirect, useLocation } from "wouter";
import { lazy, Suspense, useEffect } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { RequireAuth } from "./components/RequireAuth";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useAppAuth } from "./_core/hooks/useAppAuth";
// [PERF/FIX] The landing page is EAGER (not lazy) — it's the first thing unauthenticated
// users see. Making it lazy would add a Suspense gap (fallback=null → #root empty) while
// the chunk downloads, which keeps the HTML loading shell visible. Eager import =
// synchronous render on first paint.
// [SWAP 2026-07-09] "/" now renders Dime landing v2 (spec:
// docs/superpowers/specs/2026-07-08-dime-landing-v2-design.md — this is the approved
// route-swap step). The legacy LandingPage import is gone; v1 remains at /landingpage.
import DimeLandingV2 from './pages/dime/landing/DimeLandingV2';
// [PERF] NotFound is lazy: it imports ui/button + ui/card which share clsx with recharts.
// Making it lazy removes recharts (409KB) from the critical path.
const NotFound = lazy(() => import("@/pages/NotFound"));
// ── ALL routes are lazy-loaded — zero page code in the initial bundle ────────
// [PERF] ModelProjections was previously eager — it pulled in 531KB of deps
// (GameCard, BettingSplitsPanel, MlbLineupCard, MlbCheatSheetCard,
// framer-motion, all MLB components). Now lazy: loads in parallel with auth check.
const ModelProjections = lazy(() => import("./pages/ModelProjections"));
const BettingSplits    = lazy(() => import("./pages/BettingSplits"));
const Home = lazy(() => import("./pages/Home"));
const UserManagement = lazy(() => import("./pages/UserManagement"));
const PublishProjections = lazy(() => import("./pages/PublishProjections"));
const IngestAnOdds = lazy(() => import("./pages/IngestAnOdds"));
const TheModelResults = lazy(() => import("./pages/TheModelResults"));
const SecurityEvents = lazy(() => import("./pages/SecurityEvents"));
const MlbTeamSchedule = lazy(() => import("./pages/MlbTeamSchedule"));
const NbaTeamSchedule = lazy(() => import("./pages/NbaTeamSchedule"));
const NhlTeamSchedule = lazy(() => import("./pages/NhlTeamSchedule"));
const BetTracker = lazy(() => import("@/pages/BetTracker"));
const AdminModelStatus = lazy(() => import("@/pages/AdminModelStatus"));
const PostponedGames = lazy(() => import("@/pages/PostponedGames"));
const Resources = lazy(() => import("@/pages/Resources"));
const MlbBacktest = lazy(() => import("@/pages/MlbBacktest"));
const ResetPassword = lazy(() => import('@/pages/ResetPassword'));

const SubscribeSuccess = lazy(() => import('./pages/SubscribeSuccess'));
const SubscribeCancel = lazy(() => import('./pages/SubscribeCancel'));
const ManageAccount = lazy(() => import('./pages/ManageAccount'));
const Pricing = lazy(() => import('./pages/Pricing'));
const WorldCup2026 = lazy(() => import('./pages/WorldCup2026'));
const ClaudeAssistant = lazy(() => import('./pages/ClaudeAssistant'));
const DimeChat = lazy(() => import('./pages/DimeChat'));
const DimeLanding = lazy(() => import('./pages/dime/DimeLanding'));
const CheckoutPage = lazy(() => import('./pages/dime/CheckoutPage'));
const Profile = lazy(() => import('./pages/Profile'));
const WaitlistAdmin   = lazy(() => import('./pages/WaitlistAdmin'));
const Privacy = lazy(() => import('./pages/Privacy'));
const Terms = lazy(() => import('./pages/Terms'));

// ── Mobile Owner Tabs (owner-only bottom nav experience) ────────────────────
const MobileOwnerLayout = lazy(() => import('./features/mobileOwnerTabs/MobileOwnerLayout'));
import { GlobalMobileOwnerTabs } from './features/mobileOwnerTabs/GlobalMobileOwnerTabs';

/**
 * RootRoute — auth-aware landing/redirect component for the "/" path.
 *
 * Execution flow (OPTIMISTIC RENDER — zero loading shell on landing page):
 *   1. IMMEDIATE: Render <LandingPage /> without waiting for auth.
 *      The landing page is public — there is no reason to gate it behind an auth check.
 *      This eliminates the loading shell entirely for unauthenticated users.
 *   2. Auth resolves as authenticated → redirect to /feed (imperceptible for logged-in users).
 *   3. Auth resolves as unauthenticated → LandingPage stays visible (already rendered).
 *
 * [FIX] Optimistic render pattern:
 *   OLD: loading=true → return null → shell visible for 200-800ms → auth resolves → LandingPage
 *   NEW: return LandingPage immediately → auth resolves → redirect if authenticated
 *   Result: Loading shell dismissed the moment React mounts (0ms after JS executes).
 *
 * [FIX] Uses useAppAuth (Discord JWT) instead of useAuth (Manus OAuth) so that
 * Discord-logged-in users are correctly detected and redirected to /feed.
 *
 * [FIX] Reads sessionStorage.pendingCheckout after login to auto-trigger checkout.
 * Flow: unauthenticated user clicks pricing → login → auto-checkout.
 *
 * [LOG] All branches log their state to the console for traceability.
 */
function RootRoute() {
  const { appUser, loading } = useAppAuth();
  const [, navigate] = useLocation();

  // [CRITICAL FIX] Redirect authenticated users AFTER LandingPage is already rendered.
  // useEffect runs after paint — by then the shell is already dismissed.
  // This replaces the old "return null while loading" pattern that kept the shell visible.
  useEffect(() => {
    if (loading) {
      console.log("[RootRoute] [STATE] Auth loading — LandingPage already visible, waiting for auth");
      return;
    }
    if (appUser) {
      // Handle pending checkout from a pre-login pricing button click.
      const pendingCheckout = sessionStorage.getItem("pendingCheckout");
      if (pendingCheckout === "monthly" || pendingCheckout === "annual") {
        sessionStorage.removeItem("pendingCheckout");
        console.log(`[RootRoute] [OUTPUT] Authenticated + pendingCheckout=${pendingCheckout} — redirecting to /checkout?plan=${pendingCheckout}`);
        navigate(`/checkout?plan=${pendingCheckout}`);
        return;
      }
      console.log(`[RootRoute] [OUTPUT] Authenticated userId=${appUser.id} — redirecting to /feed`);
      navigate("/feed");
    } else {
      console.log("[RootRoute] [OUTPUT] Unauthenticated — LandingPage stays visible");
    }
  }, [loading, appUser]);

  // [OPTIMISTIC] Always render the landing page immediately — no null return, no loading gap.
  // DimeLandingV2 is an eager import — no Suspense needed, renders synchronously.
  // The HTML loading shell dismisses the moment this component renders into #root.
  console.log(`[RootRoute] [RENDER] Rendering DimeLandingV2 immediately (loading=${loading}, authed=${!!appUser})`);
  return <DimeLandingV2 />;
}

function Router() {
  return (
    // [PERF] fallback=null: the HTML loading shell in index.html covers all loading states.
    // It hides via MutationObserver the moment React renders ANY child into #root.
    // Using a React component as fallback causes a visual flash between the HTML shell
    // and the React component — two separate loading states visible to the user.
    // With null: HTML shell → direct render of real content. Zero flash.
    <Suspense fallback={null}>
    <Switch>
      {/* ── Public routes (no auth required) ───────────────────────────────── */}
      {/* / → auth-aware root:
           - Authenticated users → /feed (skip landing page, go straight to dashboard)
           - Unauthenticated users → LandingPage (public marketing page)
           - While auth is loading → render nothing (HTML shell covers this state)
      */}
      <Route path="/">{() => <RootRoute />}</Route>
      {/* /home → redirect to landing */}
      <Route path="/home">{() => <Redirect to="/" />}</Route>
      {/* Legacy redirects */}
      <Route path="/dashboard">{() => <Redirect to="/feed" />}</Route>
      <Route path="/projections">{() => <Redirect to="/feed" />}</Route>
      <Route path="/splits">{() => <Redirect to="/feed" />}</Route>
      {/* Legal pages — public, no auth required */}
      <Route path="/privacy" component={Privacy} />
      <Route path="/terms" component={Terms} />
      {/* Stripe checkout result pages — public, no auth required */}
      <Route path="/subscribe/success" component={SubscribeSuccess} />
      <Route path="/subscribe/cancel" component={SubscribeCancel} />
      {/* Login page — public, no auth required */}
      <Route path="/login" component={Home} />
      {/* Standalone pricing page — public */}
      <Route path="/pricing" component={Pricing} />
      {/* Password reset — public, accessed via reset link */}
      <Route path="/reset-password" component={ResetPassword} />
      {/* Dime AI landing v1 — kept as a comparison hook (E1) */}
      <Route path="/landingpage" component={DimeLanding} />
      {/* Landing v2 is now the root landing page — redirect the old test route
          so existing links and the checkout back-links keep working. */}
      <Route path="/landingpage-v2">{() => <Redirect to="/" />}</Route>
      {/* In-domain Stripe checkout (Embedded Checkout w/ hosted fallback) */}
      <Route path="/checkout" component={CheckoutPage} />
      {/* ── Protected routes (RequireAuth redirects to /login if not authed) ── */}
      {/* Main feed */}
      <Route path="/feed">{() => <RequireAuth><ModelProjections /></RequireAuth>}</Route>
      {/* Betting splits */}
      <Route path="/betting-splits">{() => <RequireAuth><BettingSplits /></RequireAuth>}</Route>
      {/* Admin pages */}
      <Route path="/admin/users">{() => <RequireAuth><UserManagement /></RequireAuth>}</Route>
      <Route path="/admin/publish">{() => <RequireAuth><PublishProjections /></RequireAuth>}</Route>
      <Route path="/admin/ingest-an">{() => <RequireAuth><IngestAnOdds /></RequireAuth>}</Route>
      <Route path="/admin/model-results">{() => <RequireAuth><TheModelResults /></RequireAuth>}</Route>
      <Route path="/admin/f5-edge">{() => <Redirect to="/admin/model-results" />}</Route>
      <Route path="/admin/security">{() => <RequireAuth><SecurityEvents /></RequireAuth>}</Route>
      <Route path="/admin/model-status">{() => <RequireAuth><AdminModelStatus /></RequireAuth>}</Route>
      <Route path="/admin/postponed-games">{() => <RequireAuth><PostponedGames /></RequireAuth>}</Route>
      <Route path="/admin/backtest">{() => <RequireAuth><MlbBacktest /></RequireAuth>}</Route>
      {/* Waitlist management — owner-only, enforced inside WaitlistAdmin */}
      <Route path="/admin/waitlist">{() => <RequireAuth><WaitlistAdmin /></RequireAuth>}</Route>
      {/* Team schedules — params are read via useParams() inside each component */}
      <Route path="/mlb/team/:slug">{() => <RequireAuth><MlbTeamSchedule /></RequireAuth>}</Route>
      <Route path="/nba/team/:slug">{() => <RequireAuth><NbaTeamSchedule /></RequireAuth>}</Route>
      <Route path="/nhl/team/:slug">{() => <RequireAuth><NhlTeamSchedule /></RequireAuth>}</Route>
      {/* User pages */}
      <Route path="/bet-tracker">{() => <RequireAuth><BetTracker /></RequireAuth>}</Route>
      <Route path="/resources">{() => <RequireAuth><Resources /></RequireAuth>}</Route>
      {/* Manage Account page */}
      <Route path="/account">{() => <RequireAuth><ManageAccount /></RequireAuth>}</Route>
      {/* Claude UI/UX Assistant */}
      <Route path="/admin/claude">{() => <RequireAuth><ClaudeAssistant /></RequireAuth>}</Route>
      {/* Profile page — identity and standing */}
      <Route path="/profile">{() => <RequireAuth><Profile /></RequireAuth>}</Route>
      {/* Dime AI Chat — streaming Claude Fable 5 chat */}
      <Route path="/chat">{() => <RequireAuth><DimeChat /></RequireAuth>}</Route>
      {/* FIFA World Cup 2026 — Group Stage Feed */}
      <Route path="/wc2026">{() => <RequireAuth><WorldCup2026 /></RequireAuth>}</Route>
      {/* ── Mobile Owner Tabs (owner-only) ──────────────────────────────────── */}
      <Route path="/m/:rest*">{() => <RequireAuth><MobileOwnerLayout /></RequireAuth>}</Route>
      {/* 404 */}
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
          {/* Global mobile owner bottom tabs — appears on ALL pages for owner users on mobile */}
          <GlobalMobileOwnerTabs />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
