/**
 * SecurityEvents.tsx
 *
 * Owner-only Security Events dashboard panel.
 *
 * Displays:
 *   - 24h rolling window summary cards (CSRF_BLOCK, RATE_LIMIT, AUTH_FAIL, Total)
 *   - Filterable, sortable event log table (newest first)
 *   - Prune control to delete events older than N days
 *   - Discord Test Controls: fire test embeds + manual digest trigger
 *
 * Access: owner role only — redirects to home if not owner.
 */

import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ArrowLeft,
  RefreshCw,
  ShieldAlert,
  ShieldOff,
  Activity,
  Trash2,
  AlertTriangle,
  FlaskConical,
  Send,
  BookOpen,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type EventType = "CSRF_BLOCK" | "RATE_LIMIT" | "AUTH_FAIL";

interface SecurityEventRow {
  id: number;
  eventType: string;
  ip: string;
  blockedOrigin: string | null;
  trpcPath: string | null;
  httpMethod: string | null;
  userAgent: string | null;
  context: string | null;
  occurredAt: number;
  createdAt: Date;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const EST_OPTS: Intl.DateTimeFormatOptions = { timeZone: "America/New_York" };

function formatTs(ms: number): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString("en-US", {
    ...EST_OPTS,
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", {
    ...EST_OPTS,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  return `${date} ${time} EST`;
}

const EVENT_TYPE_CONFIG: Record<
  string,
  { label: string; color: string; icon: React.ReactNode }
> = {
  CSRF_BLOCK: {
    label: "CSRF Block",
    color: "bg-transparent text-white border-white",
    icon: <ShieldOff className="w-3 h-3" />,
  },
  RATE_LIMIT: {
    label: "Rate Limit",
    color: "bg-transparent text-white border-white",
    icon: <Activity className="w-3 h-3" />,
  },
  AUTH_FAIL: {
    label: "Auth Fail",
    color: "bg-transparent text-white border-white",
    icon: <ShieldAlert className="w-3 h-3" />,
  },
};

// ─── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  count,
  icon,
}: {
  label: string;
  count: number;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 flex flex-col gap-1">
      <div className="flex items-center gap-2 text-zinc-200 text-xs font-medium uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <div className={`text-2xl font-bold tabular-nums ${count > 0 ? "text-white" : "text-zinc-300"}`}>
        {count}
      </div>
      <div className="text-zinc-300 text-xs">last 24 hours</div>
    </div>
  );
}

// ─── Discord Test Controls Panel ──────────────────────────────────────────────

function DiscordTestPanel() {
  const [testEventType, setTestEventType] = useState<"CSRF_BLOCK" | "RATE_LIMIT" | "AUTH_FAIL" | "ALL">("ALL");

  const fireEventMutation = trpc.security.test.fireEvent.useMutation({
    onSuccess: (data) => {
      toast.success(data.message, { duration: 6000 });
    },
    onError: (err) => {
      toast.error(`Test failed: ${err.message}`);
    },
  });

  const fireDigestMutation = trpc.security.test.fireDigest.useMutation({
    onSuccess: (data) => {
      toast.success(data.message, { duration: 6000 });
    },
    onError: (err) => {
      toast.error(`Digest trigger failed: ${err.message}`);
    },
  });

  const isTestPending = fireEventMutation.isPending;
  const isDigestPending = fireDigestMutation.isPending;

  return (
    <div className="rounded-lg border border-zinc-700/60 bg-zinc-900/40 p-4 space-y-4">
      {/* Panel header */}
      <div className="flex items-center gap-2">
        <FlaskConical className="w-4 h-4 text-white" />
        <span className="text-sm font-semibold text-zinc-200">Discord Security Channel — Live Test Controls</span>
        <Badge className="bg-transparent text-white border-white text-xs px-1.5 py-0 ml-1">
          Owner Only
        </Badge>
      </div>

      <p className="text-zinc-200 text-xs leading-relaxed">
        Use these controls to confirm that the Discord{" "}
        <span className="text-zinc-200 font-mono">🗒️-𝗦𝗘𝗖𝗨𝗥𝗜𝗧𝗬-𝗘𝗩𝗘𝗡𝗧𝗦</span> channel is
        receiving alerts correctly. Test embeds use a synthetic IP and are clearly
        labeled as tests — they will not affect event counts in the database.
      </p>

      {/* Row 1: Fire test event embed */}
      <div className="flex flex-wrap items-center gap-3 p-3 rounded-md bg-zinc-950/60 border border-zinc-800">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Send className="w-3.5 h-3.5 text-zinc-200 shrink-0" />
          <div>
            <div className="text-xs font-medium text-zinc-200">Fire Test Event Embed</div>
            <div className="text-xs text-zinc-300 mt-0.5">
              Posts a synthetic embed to the Discord security channel to confirm delivery.
              Choose a specific event type or fire all three at once.
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Select
            value={testEventType}
            onValueChange={(v) => setTestEventType(v as typeof testEventType)}
            disabled={isTestPending}
          >
            <SelectTrigger className="h-8 w-36 bg-zinc-900 border-zinc-700 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-700">
              <SelectItem value="ALL" className="text-xs">All 3 Types</SelectItem>
              <SelectItem value="CSRF_BLOCK" className="text-xs">🚫 CSRF Block</SelectItem>
              <SelectItem value="RATE_LIMIT" className="text-xs">⚡ Rate Limit</SelectItem>
              <SelectItem value="AUTH_FAIL" className="text-xs">🔐 Auth Fail</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="bg-[#45E0A8] hover:bg-[#45E0A8] text-black gap-1.5 h-8 text-xs"
            disabled={isTestPending}
            onClick={() => fireEventMutation.mutate({ eventType: testEventType })}
          >
            {isTestPending ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <Send className="w-3 h-3" />
            )}
            {isTestPending ? "Sending..." : "Send Test"}
          </Button>
        </div>
      </div>

      {/* Row 2: Fire daily digest */}
      <div className="flex flex-wrap items-center gap-3 p-3 rounded-md bg-zinc-950/60 border border-zinc-800">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <BookOpen className="w-3.5 h-3.5 text-zinc-200 shrink-0" />
          <div>
            <div className="text-xs font-medium text-zinc-200">Trigger Daily Digest Now</div>
            <div className="text-xs text-zinc-300 mt-0.5">
              Manually runs the daily security summary that normally posts at 08:00 EST.
              Uses the last 24 hours of real event data — threat level, counts, and top IPs.
            </div>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="border-white text-white hover:bg-transparent gap-1.5 h-8 text-xs shrink-0"
          disabled={isDigestPending}
          onClick={() => fireDigestMutation.mutate()}
        >
          {isDigestPending ? (
            <RefreshCw className="w-3 h-3 animate-spin" />
          ) : (
            <BookOpen className="w-3 h-3" />
          )}
          {isDigestPending ? "Posting..." : "Post Digest"}
        </Button>
      </div>

      {/* Status indicators */}
      {(fireEventMutation.isSuccess || fireDigestMutation.isSuccess) && (
        <div className="text-xs text-[#45E0A8] flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#45E0A8] inline-block" />
          Last action completed — check the Discord channel to confirm delivery.
        </div>
      )}
      {(fireEventMutation.isError || fireDigestMutation.isError) && (
        <div className="text-xs text-white flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-white inline-block" />
          Action failed — check server logs for details.
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SecurityEvents() {
  const [, navigate] = useLocation();
  const { appUser: user, loading: authLoading, isOwner } = useAppAuth();

  // ── Filter state ──────────────────────────────────────────────────────────
  const [eventTypeFilter, setEventTypeFilter] = useState<EventType | "ALL">("ALL");
  const [windowHours, setWindowHours] = useState<number>(24);

  // ── Prune dialog state ────────────────────────────────────────────────────
  const [pruneOpen, setPruneOpen] = useState(false);
  const [retentionDays, setRetentionDays] = useState<number>(90);

  // ── Computed sinceMs ──────────────────────────────────────────────────────
  const sinceMs = useMemo(
    () => Date.now() - windowHours * 60 * 60 * 1000,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [windowHours]
  );

  // ── tRPC queries ──────────────────────────────────────────────────────────
  const countsQuery = trpc.security.events.counts.useQuery(
    { sinceMs },
    { enabled: !authLoading && isOwner, refetchInterval: 30_000 }
  );

  const eventsQuery = trpc.security.events.list.useQuery(
    {
      limit: 200,
      eventType: eventTypeFilter === "ALL" ? undefined : eventTypeFilter,
      sinceMs,
    },
    { enabled: !authLoading && isOwner, refetchInterval: 30_000 }
  );

  // ── Prune mutation ────────────────────────────────────────────────────────
  const utils = trpc.useUtils();
  const pruneMutation = trpc.security.events.prune.useMutation({
    onSuccess: (data) => {
      toast.success(`Pruned ${data.deleted} events older than ${retentionDays} days`);
      setPruneOpen(false);
      utils.security.events.list.invalidate();
      utils.security.events.counts.invalidate();
    },
    onError: (err) => {
      toast.error(`Prune failed: ${err.message}`);
    },
  });

  // ── Auth guard — MUST be useEffect, never render body (render-phase navigate crashes React 19) ──
  useEffect(() => {
    if (!authLoading && (!user || !isOwner)) {
      console.warn(`[SECURITY] Unauthorized: user=${user?.username ?? "unauthenticated"} isOwner=${isOwner} → redirecting to /`);
      navigate("/");
    }
  }, [authLoading, user, isOwner, navigate]);

  if (authLoading || (!authLoading && (!user || !isOwner))) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center gap-3">
        <div className="w-5 h-5 border-2 border-white border-t-[#45E0A8] rounded-full animate-spin" />
        <span className="text-zinc-200 text-sm">{authLoading ? "Verifying access..." : "Redirecting..."}</span>
      </div>
    );
  }

  // ── Derived data ──────────────────────────────────────────────────────────
  const counts = countsQuery.data ?? {
    CSRF_BLOCK: 0,
    RATE_LIMIT: 0,
    AUTH_FAIL: 0,
    total: 0,
  };
  const events: SecurityEventRow[] = (eventsQuery.data as SecurityEventRow[] | undefined) ?? [];
  const isLoading = eventsQuery.isLoading || countsQuery.isLoading;
  const isRefetching = eventsQuery.isFetching || countsQuery.isFetching;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* ── Header ── */}
      <div className="border-b border-zinc-800 bg-zinc-900/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="text-zinc-200 hover:text-zinc-100 gap-1.5"
              onClick={() => navigate("/admin/users")}
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
            <div className="h-4 w-px bg-white" />
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-white" />
              <span className="font-semibold text-sm">Security Events</span>
              {counts.total > 0 && (
                <Badge className="bg-transparent text-white border-white text-xs px-1.5 py-0">
                  {counts.total} in window
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-zinc-200 hover:text-zinc-100 gap-1.5"
              onClick={() => {
                eventsQuery.refetch();
                countsQuery.refetch();
              }}
              disabled={isRefetching}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-white border-white hover:bg-transparent gap-1.5"
              onClick={() => setPruneOpen(true)}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Prune Old Events
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* ── Summary Cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryCard
            label="Total"
            count={counts.total}
            color=""
            icon={<Activity className="w-3 h-3" />}
          />
          <SummaryCard
            label="CSRF Blocks"
            count={counts.CSRF_BLOCK}
            color="text-white"
            icon={<ShieldOff className="w-3 h-3" />}
          />
          <SummaryCard
            label="Rate Limits"
            count={counts.RATE_LIMIT}
            color="text-white"
            icon={<Activity className="w-3 h-3" />}
          />
          <SummaryCard
            label="Auth Fails"
            count={counts.AUTH_FAIL}
            color="text-white"
            icon={<ShieldAlert className="w-3 h-3" />}
          />
        </div>

        {/* ── Discord Test Controls ── */}
        <DiscordTestPanel />

        {/* ── Filters ── */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-zinc-200 text-xs font-medium">Event Type</span>
            <Select
              value={eventTypeFilter}
              onValueChange={(v) => setEventTypeFilter(v as EventType | "ALL")}
            >
              <SelectTrigger className="h-8 w-36 bg-zinc-900 border-zinc-700 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-700">
                <SelectItem value="ALL" className="text-xs">All Types</SelectItem>
                <SelectItem value="CSRF_BLOCK" className="text-xs">CSRF Block</SelectItem>
                <SelectItem value="RATE_LIMIT" className="text-xs">Rate Limit</SelectItem>
                <SelectItem value="AUTH_FAIL" className="text-xs">Auth Fail</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-zinc-200 text-xs font-medium">Window</span>
            <Select
              value={String(windowHours)}
              onValueChange={(v) => setWindowHours(Number(v))}
            >
              <SelectTrigger className="h-8 w-28 bg-zinc-900 border-zinc-700 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-700">
                <SelectItem value="1" className="text-xs">Last 1 hour</SelectItem>
                <SelectItem value="6" className="text-xs">Last 6 hours</SelectItem>
                <SelectItem value="24" className="text-xs">Last 24 hours</SelectItem>
                <SelectItem value="72" className="text-xs">Last 3 days</SelectItem>
                <SelectItem value="168" className="text-xs">Last 7 days</SelectItem>
                <SelectItem value="720" className="text-xs">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto text-zinc-300 text-xs">
            {isLoading ? "Loading..." : `${events.length} event${events.length !== 1 ? "s" : ""}`}
          </div>
        </div>

        {/* ── Event Table ── */}
        <div className="rounded-lg border border-zinc-800 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-200 text-xs w-36">Timestamp (EST)</TableHead>
                <TableHead className="text-zinc-200 text-xs w-28">Type</TableHead>
                <TableHead className="text-zinc-200 text-xs w-36">IP Address</TableHead>
                <TableHead className="text-zinc-200 text-xs">Blocked Origin</TableHead>
                <TableHead className="text-zinc-200 text-xs">tRPC Path</TableHead>
                <TableHead className="text-zinc-200 text-xs w-16">Method</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-zinc-300 text-sm py-12">
                    <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-2" />
                    Loading events...
                  </TableCell>
                </TableRow>
              ) : events.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12">
                    <div className="flex flex-col items-center gap-2 text-zinc-300">
                      <ShieldAlert className="w-8 h-8 text-zinc-700" />
                      <span className="text-sm">No security events in this window</span>
                      <span className="text-xs text-zinc-300">
                        Events appear here when CSRF blocks, rate limits, or auth failures occur
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                events.map((event) => {
                  const config = EVENT_TYPE_CONFIG[event.eventType] ?? {
                    label: event.eventType,
                    color: "bg-transparent text-white border-white",
                    icon: <AlertTriangle className="w-3 h-3" />,
                  };
                  return (
                    <TableRow
                      key={event.id}
                      className="border-white hover:bg-transparent transition-colors"
                    >
                      <TableCell className="text-zinc-300 text-xs font-mono whitespace-nowrap">
                        {formatTs(event.occurredAt)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={`${config.color} border text-xs px-1.5 py-0 gap-1 font-medium`}
                        >
                          {config.icon}
                          {config.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-zinc-300 text-xs font-mono">
                        {event.ip}
                      </TableCell>
                      <TableCell
                        className="text-zinc-200 text-xs font-mono max-w-xs truncate"
                        title={event.blockedOrigin ?? "—"}
                      >
                        {event.blockedOrigin ?? (
                          <span className="text-zinc-300">—</span>
                        )}
                      </TableCell>
                      <TableCell
                        className="text-zinc-200 text-xs font-mono max-w-xs truncate"
                        title={event.trpcPath ?? "—"}
                      >
                        {event.trpcPath ?? (
                          <span className="text-zinc-300">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-zinc-200 text-xs font-mono">
                        {event.httpMethod ?? "—"}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* ── Auto-refresh notice ── */}
        <div className="text-zinc-300 text-xs text-center">
          Auto-refreshes every 30 seconds &nbsp;·&nbsp; Showing newest {events.length} events
        </div>
      </div>

      {/* ── Prune Dialog ── */}
      <Dialog open={pruneOpen} onOpenChange={setPruneOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-700 text-zinc-100 max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Trash2 className="w-4 h-4" />
              Prune Security Events
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-zinc-200 text-sm">
              Delete all security events older than the selected retention period.
              This action cannot be undone.
            </p>
            <div className="flex items-center gap-3">
              <span className="text-zinc-300 text-sm">Keep last</span>
              <Select
                value={String(retentionDays)}
                onValueChange={(v) => setRetentionDays(Number(v))}
              >
                <SelectTrigger className="h-8 w-28 bg-zinc-800 border-zinc-600 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-600">
                  <SelectItem value="7">7 days</SelectItem>
                  <SelectItem value="14">14 days</SelectItem>
                  <SelectItem value="30">30 days</SelectItem>
                  <SelectItem value="60">60 days</SelectItem>
                  <SelectItem value="90">90 days</SelectItem>
                  <SelectItem value="180">180 days</SelectItem>
                  <SelectItem value="365">365 days</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-zinc-200 text-sm">of events</span>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPruneOpen(false)}
              className="text-zinc-200"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-white hover:bg-white text-black gap-1.5"
              disabled={pruneMutation.isPending}
              onClick={() => pruneMutation.mutate({ retentionDays })}
            >
              {pruneMutation.isPending ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
              Prune Events
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
