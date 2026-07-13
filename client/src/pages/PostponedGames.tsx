/**
 * PostponedGames.tsx
 * Route: /admin/postponed-games
 *
 * Owner-only admin view for auditing all postponed and suspended MLB games.
 * Provides:
 *   - Full table of all postponed/suspended games with date, teams, gamePk, status
 *   - Status badge (POSTPONED / SUSPENDED) with color coding
 *   - Manual status override via markGameStatus mutation
 *   - Auto-refresh every 60 seconds
 *   - Filter by status (All / Postponed / Suspended)
 *   - Sort by date (newest first by default)
 */

import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { RefreshCw, AlertTriangle, CheckCircle, Clock } from "lucide-react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

type GameStatus = "upcoming" | "live" | "final" | "postponed" | "suspended";

type PostponedGame = {
  id: number;
  awayTeam: string;
  homeTeam: string;
  gameDate: string;
  gameStatus: string;
  mlbGamePk: number | null;
  startTimeEst: string;
  sport: string;
  publishedToFeed: boolean;
  awayML: string | null;
  homeML: string | null;
  bookTotal: string | null;
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === "postponed") {
    return (
      <Badge className="bg-transparent text-white border border-white font-mono text-xs">
        POSTPONED
      </Badge>
    );
  }
  if (status === "suspended") {
    return (
      <Badge className="bg-transparent text-white border border-white font-mono text-xs">
        SUSPENDED
      </Badge>
    );
  }
  return (
    <Badge className="bg-black text-white border border-white font-mono text-xs">
      {status.toUpperCase()}
    </Badge>
  );
}

function MarkStatusDialog({
  game,
  onSuccess,
}: {
  game: PostponedGame;
  onSuccess: () => void;
}) {
  const [targetStatus, setTargetStatus] = useState<GameStatus>("upcoming");
  const utils = trpc.useUtils();
  const markMutation = trpc.games.markGameStatus.useMutation({
    onSuccess: (data) => {
      console.log(
        `[PostponedGames][OUTPUT] markGameStatus: id=${data.id} → status=${data.status}`
      );
      toast.success(`Game #${data.id} (${game.awayTeam}@${game.homeTeam}) → ${data.status}`);
      utils.games.listPostponed.invalidate();
      onSuccess();
    },
    onError: (err) => {
      console.error(`[PostponedGames][ERROR] markGameStatus failed:`, err.message);
      toast.error(`Update Failed: ${err.message}`);
    },
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs border-white text-white"
        >
          Override
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="bg-black border-white">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-white">
            Override Game Status
          </AlertDialogTitle>
          <AlertDialogDescription className="text-white">
            Manually set the status for{" "}
            <span className="text-white font-mono">
              {game.awayTeam}@{game.homeTeam}
            </span>{" "}
            on <span className="text-white">{game.gameDate}</span>.
            <br />
            <span className="text-white text-xs mt-1 block">
              ⚠ The MLB score refresh cycle will overwrite this on the next run
              unless the API also reflects the change.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="py-2">
          <Select
            value={targetStatus}
            onValueChange={(v) => setTargetStatus(v as GameStatus)}
          >
            <SelectTrigger className="bg-black border-white text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-black border-white">
              <SelectItem value="upcoming">upcoming</SelectItem>
              <SelectItem value="live">live</SelectItem>
              <SelectItem value="final">final</SelectItem>
              <SelectItem value="postponed">postponed</SelectItem>
              <SelectItem value="suspended">suspended</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel className="bg-black border-white text-white">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-[#45E0A8] text-black"
            onClick={() =>
              markMutation.mutate({ id: game.id, status: targetStatus })
            }
            disabled={markMutation.isPending}
          >
            {markMutation.isPending ? "Updating…" : "Confirm Override"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PostponedGames() {
  const [, navigate] = useLocation();
  const { appUser, loading: authLoading, isOwner } = useAppAuth();
  const [filterStatus, setFilterStatus] = useState<"all" | "postponed" | "suspended">("all");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // ── All hooks MUST come before conditional returns (Rules of Hooks) ──────────────
  const { data, isLoading, error, refetch, isFetching } =
    trpc.games.listPostponed.useQuery(undefined, {
      refetchInterval: 60_000,
      staleTime: 30_000,
      enabled: !authLoading && !!appUser && isOwner,
    });

  // ── Owner-only auth guard — MUST be useEffect, never render body ─────────────
  useEffect(() => {
    if (!authLoading && (!appUser || !isOwner)) {
      console.warn(`[PostponedGames] Unauthorized: user=${appUser?.username ?? "unauthenticated"} isOwner=${isOwner} → redirecting to /`);
      navigate("/");
    }
  }, [authLoading, appUser, isOwner, navigate]);

  if (authLoading || (!authLoading && (!appUser || !isOwner))) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center gap-3">
        <div className="w-5 h-5 border-2 border-white border-t-white rounded-full animate-spin" />
        <span className="text-white text-sm">{authLoading ? "Verifying access..." : "Redirecting..."}</span>
      </div>
    );
  }

  console.log(
    `[PostponedGames][STATE] loaded=${!isLoading} count=${data?.length ?? 0}` +
      ` filter=${filterStatus} sort=${sortDir}`
  );

  // ── Derived data ──────────────────────────────────────────────────────────
  const filtered = (data ?? [])
    .filter((g) => {
      if (filterStatus === "all") return true;
      return g.gameStatus === filterStatus;
    })
    .sort((a, b) => {
      const cmp = a.gameDate.localeCompare(b.gameDate);
      return sortDir === "asc" ? cmp : -cmp;
    });

  const postponedCount = (data ?? []).filter((g) => g.gameStatus === "postponed").length;
  const suspendedCount = (data ?? []).filter((g) => g.gameStatus === "suspended").length;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-black text-white p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Postponed &amp; Suspended Games
          </h1>
          <p className="text-sm text-white mt-1">
            Owner audit view — all games excluded from the public feed due to
            postponed or suspended status. Auto-refreshes every 60 seconds.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            refetch();
            toast.info("Refreshing… Fetching latest postponed game data");
          }}
          disabled={isFetching}
          className="border-white text-white gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card className="bg-black border-white">
          <CardContent className="pt-4 pb-4">
            <div className="text-xs text-white uppercase tracking-wider mb-1">Total Hidden</div>
            <div className="text-3xl font-bold text-white">{data?.length ?? "—"}</div>
            <div className="text-xs text-white mt-1">games excluded from feed</div>
          </CardContent>
        </Card>
        <Card className="bg-black border-white">
          <CardContent className="pt-4 pb-4">
            <div className="text-xs text-white uppercase tracking-wider mb-1">Postponed</div>
            <div className="text-3xl font-bold text-white">{isLoading ? "—" : postponedCount}</div>
            <div className="text-xs text-white mt-1">not played — awaiting reschedule</div>
          </CardContent>
        </Card>
        <Card className="bg-black border-white">
          <CardContent className="pt-4 pb-4">
            <div className="text-xs text-white uppercase tracking-wider mb-1">Suspended</div>
            <div className="text-3xl font-bold text-white">{isLoading ? "—" : suspendedCount}</div>
            <div className="text-xs text-white mt-1">started but not completed</div>
          </CardContent>
        </Card>
      </div>

      {/* Info panel */}
      <Card className="bg-black border-white mb-6">
        <CardContent className="pt-4 pb-4">
          <div className="flex gap-6 flex-wrap text-sm">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-white mt-0.5 shrink-0" />
              <div>
                <div className="text-white font-medium">Postponed</div>
                <div className="text-white text-xs">
                  Game was never played. Hidden from public feed. The MLB score
                  refresh cycle checks for a new gamePk every 10 minutes — when
                  rescheduled, the new game auto-inserts on its new date.
                </div>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Clock className="w-4 h-4 text-white mt-0.5 shrink-0" />
              <div>
                <div className="text-white font-medium">Suspended</div>
                <div className="text-white text-xs">
                  Game started but was halted (e.g. rain). Hidden from feed.
                  When the MLB API marks it Final, the cycle auto-updates the
                  status to 'final' and sends an owner notification.
                </div>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-[#45E0A8] mt-0.5 shrink-0" />
              <div>
                <div className="text-white font-medium">Override</div>
                <div className="text-white text-xs">
                  Use the Override button to manually correct a game's status.
                  Note: the MLB refresh cycle may overwrite this on the next run
                  if the API still reports the old state.
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex gap-1">
          {(["all", "postponed", "suspended"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilterStatus(f)}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                filterStatus === f
                  ? "bg-[#45E0A8] text-black"
                  : "bg-black text-white"
              }`}
            >
              {f === "all" ? `All (${data?.length ?? 0})` : f === "postponed" ? `Postponed (${postponedCount})` : `Suspended (${suspendedCount})`}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-white">Sort by date:</span>
          <button
            onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}
            className="px-3 py-1.5 text-xs bg-black text-white rounded transition-colors"
          >
            {sortDir === "asc" ? "Oldest First ↑" : "Newest First ↓"}
          </button>
        </div>
      </div>

      {/* Table */}
      <Card className="bg-black border-white">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-40 text-white">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" />
              Loading postponed games…
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-40 text-white">
              <AlertTriangle className="w-5 h-5 mr-2" />
              Error loading data: {error.message}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-white">
              <CheckCircle className="w-8 h-8 text-[#45E0A8] mb-2" />
              <div className="text-sm font-medium text-white">No games found</div>
              <div className="text-xs text-white mt-1">
                {filterStatus === "all"
                  ? "No postponed or suspended games in the database."
                  : `No ${filterStatus} games found.`}
              </div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-white hover:bg-transparent">
                  <TableHead className="text-white text-xs font-medium">Date</TableHead>
                  <TableHead className="text-white text-xs font-medium">Matchup</TableHead>
                  <TableHead className="text-white text-xs font-medium">Sport</TableHead>
                  <TableHead className="text-white text-xs font-medium">Status</TableHead>
                  <TableHead className="text-white text-xs font-medium">MLB GamePk</TableHead>
                  <TableHead className="text-white text-xs font-medium">Start (EST)</TableHead>
                  <TableHead className="text-white text-xs font-medium">Odds (ML)</TableHead>
                  <TableHead className="text-white text-xs font-medium">Total</TableHead>
                  <TableHead className="text-white text-xs font-medium">Feed</TableHead>
                  <TableHead className="text-white text-xs font-medium">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((game) => (
                  <TableRow
                    key={game.id}
                    className="border-white transition-colors"
                  >
                    <TableCell className="font-mono text-xs text-white">
                      {game.gameDate}
                    </TableCell>
                    <TableCell className="font-mono text-sm font-semibold text-white">
                      {game.awayTeam}
                      <span className="text-white mx-1">@</span>
                      {game.homeTeam}
                    </TableCell>
                    <TableCell className="text-xs text-white">{game.sport}</TableCell>
                    <TableCell>
                      <StatusBadge status={game.gameStatus} />
                    </TableCell>
                    <TableCell className="font-mono text-xs text-white">
                      {game.mlbGamePk ?? (
                        <span className="text-white">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-white">
                      {game.startTimeEst
                        ? new Date(game.startTimeEst).toLocaleTimeString("en-US", {
                            timeZone: "America/New_York",
                            hour: "numeric",
                            minute: "2-digit",
                            hour12: true,
                          })
                        : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {game.awayML || game.homeML ? (
                        <span className="text-white">
                          {game.awayML ?? "—"} / {game.homeML ?? "—"}
                        </span>
                      ) : (
                        <span className="text-white">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-white">
                      {game.bookTotal ?? <span className="text-white">—</span>}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={`text-xs font-mono ${
                          game.publishedToFeed
                            ? "bg-transparent text-[#45E0A8] border-[#45E0A8]"
                            : "bg-black text-white border-white"
                        }`}
                      >
                        {game.publishedToFeed ? "LIVE" : "HIDDEN"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <MarkStatusDialog game={game} onSuccess={() => {}} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Footer */}
      {!isLoading && data && (
        <div className="mt-4 text-xs text-white text-center">
          Showing {filtered.length} of {data.length} games · Auto-refreshes every 60s ·
          MLB rescheduled detection runs every 10 minutes (MLB cycle Step 0)
        </div>
      )}
    </div>
  );
}
