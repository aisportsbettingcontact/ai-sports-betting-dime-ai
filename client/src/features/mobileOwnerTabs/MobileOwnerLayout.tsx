/**
 * MobileOwnerLayout
 * ═════════════════
 * Top-level layout for /m/* routes.
 * Wraps content in MobileOwnerTabsShell (access gate + bottom tabs).
 * Internal routing for each tab screen.
 */

import { Route, Switch, Redirect } from "wouter";
import { MobileOwnerTabsShell } from "./MobileOwnerTabsShell";
import { MobileOwnerDebugPanel } from "./MobileOwnerDebugPanel";
import { MobileFeed } from "./screens/MobileFeed";
import { MobileSplits } from "./screens/MobileSplits";
import { MobileChat } from "./screens/MobileChat";
import { MobileProps } from "./screens/MobileProps";
import { MobileProfile } from "./screens/MobileProfile";

export default function MobileOwnerLayout() {
  return (
    <MobileOwnerTabsShell>
      <Switch>
        <Route path="/m/feed" component={MobileFeed} />
        <Route path="/m/splits" component={MobileSplits} />
        <Route path="/m/chat" component={MobileChat} />
        <Route path="/m/props" component={MobileProps} />
        <Route path="/m/profile" component={MobileProfile} />
        {/* Default: redirect /m to /m/feed */}
        <Route path="/m">{() => <Redirect to="/m/feed" />}</Route>
        <Route>{() => <Redirect to="/m/feed" />}</Route>
      </Switch>
      {/* Debug panel — owner-only floating overlay */}
      <MobileOwnerDebugPanel />
    </MobileOwnerTabsShell>
  );
}
