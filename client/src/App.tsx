import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, Redirect } from "wouter";
import { lazy, Suspense } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { RequireAuth } from "./components/RequireAuth";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useAppAuth } from "./_core/hooks/useAppAuth";
// [PERF] NotFound is lazy: it imports ui/button + ui/card which share clsx with recharts.
// Making it lazy removes recharts (409KB) from the critical path.
const NotFound = lazy(() => import("@/pages/NotFound"));
// ── ALL routes are lazy-loaded — zero page code in the initial bundle ────────
// [PERF] ModelProjections was previously eager — it pulled in 531KB of deps
// (GameCard, BettingSplitsPanel, MlbLineupCard, MlbCheatSheetCard, JackMacView,
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
const LandingPage = lazy(() => import('./pages/landing/LandingPage'));
const SubscribeSuccess = lazy(() => import('./pages/SubscribeSuccess'));
const SubscribeCancel = lazy(() => import('./pages/SubscribeCancel'));
const ManageAccount = lazy(() => import('./pages/ManageAccount'));
const Pricing = lazy(() => import('./pages/Pricing'));
const WorldCup2026 = lazy(() => import('./pages/WorldCup2026'));

/**
 * RootRoute — auth-aware landing/redirect component for the "/" path.
 *
 * Execution flow:
 *   1. Auth state loading  → render null (HTML loading shell stays visible)
 *   2. Authenticated (Discord/app session) → handle pending checkout or redirect to /feed
 *   3. Unauthenticated     → render <LandingPage /> (public marketing page)
 *
 * [FIX] Uses useAppAuth (Discord JWT) instead of useAuth (Manus OAuth) so that
 * Discord-logged-in users are correctly detected and redirected to /feed.
 * The old useAuth() checked Manus OAuth state — irrelevant to this app's auth system.
 *
 * [FIX] Reads sessionStorage.pendingCheckout after login to auto-trigger checkout.
 * Flow: unauthenticated user clicks pricing → login → auto-checkout.
 *
 * [LOG] All three branches log their state to the console for traceability.
 */
function RootRoute() {
  const { appUser, loading } = useAppAuth();

  if (loading) {
    // Auth check in flight — HTML loading shell covers this gap.
    console.log("[RootRoute] [STATE] Auth loading — holding render");
    return null;
  }

  if (appUser) {
    // [FIX] Check for pending checkout from a pre-login pricing button click.
    // When an unauthenticated user clicks Start Monthly/Annual, PricingCTA stores
    // pendingCheckout=monthly|annual in sessionStorage and redirects to /login.
    // After Discord login, the user lands back here. We read the pending checkout
    // and pass it as a URL param to LandingPage so it can auto-trigger checkout.
    const pendingCheckout = sessionStorage.getItem("pendingCheckout");
    if (pendingCheckout === "monthly" || pendingCheckout === "annual") {
      sessionStorage.removeItem("pendingCheckout");
      console.log(`[RootRoute] [OUTPUT] Authenticated + pendingCheckout=${pendingCheckout} — redirecting to /?checkout=${pendingCheckout}`);
      return <Redirect to={`/?checkout=${pendingCheckout}`} />;
    }
    console.log(`[RootRoute] [OUTPUT] Authenticated userId=${appUser.id} — redirecting to /feed`);
    return <Redirect to="/feed" />;
  }

  console.log("[RootRoute] [OUTPUT] Unauthenticated — rendering LandingPage");
  return (
    <Suspense fallback={null}>
      <LandingPage />
    </Suspense>
  );
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
      {/* Stripe checkout result pages — public, no auth required */}
      <Route path="/subscribe/success" component={SubscribeSuccess} />
      <Route path="/subscribe/cancel" component={SubscribeCancel} />
      {/* Login page — public, no auth required */}
      <Route path="/login" component={Home} />
      {/* Standalone pricing page — public */}
      <Route path="/pricing" component={Pricing} />
      {/* Password reset — public, accessed via reset link */}
      <Route path="/reset-password" component={ResetPassword} />
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
      {/* Team schedules — params are read via useParams() inside each component */}
      <Route path="/mlb/team/:slug">{() => <RequireAuth><MlbTeamSchedule /></RequireAuth>}</Route>
      <Route path="/nba/team/:slug">{() => <RequireAuth><NbaTeamSchedule /></RequireAuth>}</Route>
      <Route path="/nhl/team/:slug">{() => <RequireAuth><NhlTeamSchedule /></RequireAuth>}</Route>
      {/* User pages */}
      <Route path="/bet-tracker">{() => <RequireAuth><BetTracker /></RequireAuth>}</Route>
      <Route path="/resources">{() => <RequireAuth><Resources /></RequireAuth>}</Route>
      {/* Manage Account page */}
      <Route path="/account">{() => <RequireAuth><ManageAccount /></RequireAuth>}</Route>
      {/* FIFA World Cup 2026 — Group Stage Feed */}
      <Route path="/wc2026">{() => <RequireAuth><WorldCup2026 /></RequireAuth>}</Route>
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
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
