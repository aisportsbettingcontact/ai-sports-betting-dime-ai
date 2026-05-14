import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import UserManagement from "./pages/UserManagement";
import PublishProjections from "./pages/PublishProjections";
import IngestAnOdds from "./pages/IngestAnOdds";
import ModelProjections from "./pages/ModelProjections";
import TheModelResults from "./pages/TheModelResults";
import SecurityEvents from "./pages/SecurityEvents";
import MlbTeamSchedule from "./pages/MlbTeamSchedule";
import NbaTeamSchedule from "./pages/NbaTeamSchedule";
import NhlTeamSchedule from "./pages/NhlTeamSchedule";
import BetTracker from "@/pages/BetTracker";
import AdminModelStatus from "@/pages/AdminModelStatus";
import PostponedGames from "@/pages/PostponedGames";
import Resources from "@/pages/Resources";
import MlbBacktest from "@/pages/MlbBacktest";
import ResetPassword from "@/pages/ResetPassword";

function Router() {
  return (
    <Switch>
      {/* Feed is the public default — / and /home both go directly to the feed */}
      <Route path="/">{() => <Redirect to="/feed" />}</Route>
      <Route path="/home">{() => <Redirect to="/feed" />}</Route>
      {/* Legacy redirects */}
      <Route path="/dashboard">{() => <Redirect to="/feed" />}</Route>
      <Route path="/projections">{() => <Redirect to="/feed" />}</Route>
      {/* /splits → redirect to feed (splits are in-card tabs) */}
      <Route path="/splits">{() => <Redirect to="/feed" />}</Route>
      {/* Unified feed page (AI Model Projections) */}
      <Route path="/feed" component={ModelProjections} />
      {/* /login → feed (login is hidden) */}
      <Route path="/login">{() => <Redirect to="/feed" />}</Route>
      <Route path="/admin/users" component={UserManagement} />
      <Route path="/admin/publish" component={PublishProjections} />
      <Route path="/admin/ingest-an" component={IngestAnOdds} />
      {/* MLB Team Schedule — click team logo on MLB matchup cards to navigate here */}
      <Route path="/mlb/team/:slug" component={MlbTeamSchedule} />
      {/* NBA Team Schedule — click team logo on NBA matchup cards to navigate here */}
      <Route path="/nba/team/:slug" component={NbaTeamSchedule} />
      {/* NHL Team Schedule — click team logo on NHL matchup cards to navigate here */}
      <Route path="/nhl/team/:slug" component={NhlTeamSchedule} />
      {/* Owner-only: Unified model results dashboard (all 5 markets) */}
      <Route path="/admin/model-results" component={TheModelResults} />
      {/* Legacy redirect: old F5 edge board → unified model results */}
      <Route path="/admin/f5-edge">{() => <Redirect to="/admin/model-results" />}</Route>
      {/* Owner-only: Security Events dashboard */}
      <Route path="/admin/security" component={SecurityEvents} />
      <Route path="/bet-tracker" component={BetTracker} />
      {/* Owner-only: Real-time model pipeline health dashboard (MLB + NHL) */}
      <Route path="/admin/model-status" component={AdminModelStatus} />
      {/* Owner-only: Postponed and suspended game audit view */}
      <Route path="/admin/postponed-games" component={PostponedGames} />
      {/* Private: Rotogrinders THE BAT X projections — @prez and @lucianobets only */}
      <Route path="/resources" component={Resources} />
      {/* Owner-only: Multi-market backtest dashboard — 2026 live data validation */}
      <Route path="/admin/backtest" component={MlbBacktest} />
      {/* Public: Password reset — accessed via reset link sent to Discord DM or owner */}
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
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
