/**
 * adminNav.ts — single source of truth for the Admin Dashboard's destinations.
 *
 * Previously only 3 of the ~12 owner/admin pages were linked (AdminShell's
 * hard-coded tabs); the rest were reachable only by typing the URL. This
 * registry drives BOTH the shared AdminShell nav and the `/admin` dashboard
 * hub, so every admin tool is discoverable from one place and adding a page is
 * a one-line change here.
 *
 * Access: every destination is owner/admin-gated at the route layer
 * (RequireOwner / RequireAuth) and at the data layer (ownerProcedure). This
 * file is presentational metadata only — it is NOT a security boundary.
 */
import {
  Users,
  Activity,
  Send,
  BarChart3,
  FlaskConical,
  HeartPulse,
  TrendingUp,
  Download,
  CalendarX,
  ClipboardList,
  ShieldAlert,
  Bot,
  type LucideIcon,
} from "lucide-react";

export type AdminNavKey =
  | "dashboard"
  | "users"
  | "activity"
  | "publish"
  | "model-results"
  | "backtest"
  | "model-status"
  | "f5-edge"
  | "ingest"
  | "postponed"
  | "waitlist"
  | "security"
  | "claude";

export type AdminGroup =
  | "People & Access"
  | "Projections & Models"
  | "Data & Ingest"
  | "System";

export interface AdminNavItem {
  key: AdminNavKey;
  label: string;
  short: string;
  path: string;
  group: AdminGroup;
  description: string;
  icon: LucideIcon;
}

/** Every admin destination. Order within a group is display order. */
export const ADMIN_NAV: AdminNavItem[] = [
  // People & Access
  { key: "users", label: "User Management", short: "Users", path: "/admin/users", group: "People & Access", description: "Accounts, roles, access, and membership.", icon: Users },
  { key: "activity", label: "User Activity", short: "Activity", path: "/admin/activity", group: "People & Access", description: "Engagement, session, and device analytics.", icon: Activity },
  { key: "waitlist", label: "Waitlist", short: "Waitlist", path: "/admin/waitlist", group: "People & Access", description: "Signups and waitlist management.", icon: ClipboardList },

  // Projections & Models
  { key: "publish", label: "Publish Projections", short: "Publish", path: "/admin/publish", group: "Projections & Models", description: "Review and publish model projections.", icon: Send },
  { key: "model-results", label: "Model Results", short: "Results", path: "/admin/model-results", group: "Projections & Models", description: "Rolling model accuracy and results.", icon: TrendingUp },
  { key: "backtest", label: "Backtest", short: "Backtest", path: "/admin/backtest", group: "Projections & Models", description: "Run and review historical backtests.", icon: FlaskConical },
  { key: "model-status", label: "Model Status", short: "Status", path: "/admin/model-status", group: "Projections & Models", description: "Model run health and freshness.", icon: HeartPulse },
  { key: "f5-edge", label: "F5 Edge", short: "F5 Edge", path: "/admin/f5-edge", group: "Projections & Models", description: "First-5-innings edge leaderboard.", icon: BarChart3 },

  // Data & Ingest
  { key: "ingest", label: "Ingest AN Odds", short: "Ingest", path: "/admin/ingest-an", group: "Data & Ingest", description: "Ingest Action Network odds.", icon: Download },
  { key: "postponed", label: "Postponed Games", short: "Postponed", path: "/admin/postponed-games", group: "Data & Ingest", description: "Manage postponed and suspended games.", icon: CalendarX },

  // System
  { key: "security", label: "Security Events", short: "Security", path: "/admin/security", group: "System", description: "CSRF, rate-limit, and auth events.", icon: ShieldAlert },
  { key: "claude", label: "Claude Assistant", short: "Claude", path: "/admin/claude", group: "System", description: "Owner AI assistant.", icon: Bot },
];

/** Ordered, de-duplicated group list for grid/section rendering. */
export const ADMIN_GROUPS: AdminGroup[] = [
  "People & Access",
  "Projections & Models",
  "Data & Ingest",
  "System",
];

export function adminItemsByGroup(group: AdminGroup): AdminNavItem[] {
  return ADMIN_NAV.filter((i) => i.group === group);
}
