/**
 * PowerUsersPanel — the Power Users focal panel of the admin Customer Profiling
 * Cockpit. Ranks qualifying users by power score (identity joined at read time,
 * owner-only) and surfaces the shape of the distribution above the leaderboard.
 *
 * Self-contained: takes one optional `onSelect(row)` prop so the parent can open
 * a profile drawer on row click. Honest states (owner directive): renders "Not
 * measured" with the exact `reason` when the pipeline is off, and "No qualifying
 * users yet." when measured but empty — never a fabricated leaderboard.
 *
 * Design: Dime brand law — semantic tokens only, font-mono numerals, one-accent
 * mint on the score/bar focal marks, 160ms color transitions, no gradients or
 * heavy shadows. Mirrors DeviceActivityPanel's mini-leaderboard treatment, fuller.
 */
import { trpc } from "@/lib/trpc";
import { RefreshCw } from "lucide-react";
import {
  type UserProfileRow,
  TIER_LABEL,
  TIER_CLASS,
  SEGMENT_LABEL,
  displayName,
  fmtAgo,
} from "@/pages/admin/profilingTypes";

/** Row cap for the leaderboard — the feed is pre-sorted by score desc. */
const MAX_ROWS = 25;

/** Five score buckets, low → high. Upper bound inclusive. */
const BUCKETS: Array<{ label: string; lo: number; hi: number }> = [
  { label: "0–19", lo: 0, hi: 19 },
  { label: "20–39", lo: 20, hi: 39 },
  { label: "40–59", lo: 40, hi: 59 },
  { label: "60–79", lo: 60, hi: 79 },
  { label: "80–100", lo: 80, hi: 100 },
];

function bucketize(rows: UserProfileRow[]): number[] {
  const counts = [0, 0, 0, 0, 0];
  for (const r of rows) {
    const s = r.score;
    const i = s >= 80 ? 4 : s >= 60 ? 3 : s >= 40 ? 2 : s >= 20 ? 1 : 0;
    counts[i] += 1;
  }
  return counts;
}

export default function PowerUsersPanel({
  onSelect,
}: {
  onSelect?: (u: UserProfileRow) => void;
}) {
  const { data, isLoading } = trpc.analytics.overview.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const notOk = !!data && data.state !== "ok";
  const topUsers = (data?.topUsers ?? []) as UserProfileRow[];
  const rows = topUsers.slice(0, MAX_ROWS);
  const bucketCounts = bucketize(topUsers);
  const maxBucket = Math.max(...bucketCounts, 1);

  return (
    <div className="bg-card border border-border rounded-lg px-2.5 sm:px-4 py-2.5 sm:py-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] sm:text-xs font-semibold tracking-wider text-foreground uppercase font-mono">
          Power Users · by score
        </div>
        {isLoading && <RefreshCw className="w-3 h-3 text-foreground animate-spin shrink-0" />}
      </div>

      {/* Not measured — honest state with the exact reason. */}
      {notOk ? (
        <div className="border border-border rounded-md px-4 py-6 text-center">
          <div className="text-sm font-semibold text-muted-foreground">Not measured</div>
          <div className="text-[10px] sm:text-xs text-muted-foreground mt-1 max-w-md mx-auto leading-snug">
            {data!.reason ?? "The profiling pipeline has produced no data yet."}
          </div>
        </div>
      ) : topUsers.length === 0 ? (
        !isLoading && (
          <div className="border border-border rounded-md px-4 py-6 text-center">
            <div className="text-[10px] sm:text-xs text-muted-foreground">
              No qualifying users yet.
            </div>
          </div>
        )
      ) : (
        <>
          {/* 1) Score-distribution histogram — five mint bars scaled to the max bucket. */}
          <div>
            <div className="text-[9px] sm:text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1.5">
              Score distribution · {topUsers.length} users
            </div>
            <div className="flex items-end gap-1.5 sm:gap-2 h-16">
              {BUCKETS.map((b, i) => {
                const count = bucketCounts[i];
                const pct = (count / maxBucket) * 100;
                return (
                  <div key={b.label} className="flex-1 flex flex-col items-center justify-end h-full gap-1">
                    <span className="text-[9px] sm:text-[10px] font-mono text-foreground leading-none">
                      {count}
                    </span>
                    <div className="w-full flex-1 flex items-end">
                      <div
                        className="w-full bg-primary rounded-sm transition-all duration-150"
                        style={{ height: `${count > 0 ? Math.max(pct, 6) : 2}%`, minHeight: count > 0 ? 3 : 1 }}
                        title={`${b.label}: ${count} users`}
                      />
                    </div>
                    <span className="text-[9px] font-mono text-muted-foreground leading-none whitespace-nowrap">
                      {b.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 2) Leaderboard table — one row per user, capped. Own horizontal scroll. */}
          <div className="overflow-x-auto -mx-2.5 sm:-mx-4 px-2.5 sm:px-4">
            <div style={{ minWidth: 560 }}>
              {/* Column header */}
              <div className="flex items-center gap-2 sm:gap-3 px-1.5 pb-1.5 border-b border-border text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                <span className="w-5 text-right shrink-0">#</span>
                <span className="flex-1 min-w-0">User</span>
                <span className="w-24 shrink-0">Segment</span>
                <span className="w-14 shrink-0">Tier</span>
                <span className="w-14 text-right shrink-0">Score</span>
                <span className="w-12 text-right shrink-0">Value</span>
                <span className="w-10 text-right shrink-0">Days</span>
                <span className="w-12 text-right shrink-0">Seen</span>
              </div>

              {/* Rows */}
              <div>
                {rows.map((u, i) => (
                  <button
                    key={u.sourceUserId}
                    type="button"
                    onClick={() => onSelect?.(u)}
                    className="w-full flex items-center gap-2 sm:gap-3 px-1.5 py-1.5 text-left border-b border-border/60 last:border-b-0 cursor-pointer transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                  >
                    {/* rank */}
                    <span className="w-5 text-right shrink-0 text-[10px] sm:text-xs font-mono text-muted-foreground">
                      {i + 1}
                    </span>

                    {/* display name */}
                    <span className="flex-1 min-w-0 truncate text-[11px] sm:text-xs font-mono text-foreground">
                      {displayName(u)}
                    </span>

                    {/* segment chip */}
                    <span className="w-24 shrink-0">
                      <span className="inline-block max-w-full truncate align-middle text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border border-border text-muted-foreground">
                        {SEGMENT_LABEL[u.segment] ?? u.segment}
                      </span>
                    </span>

                    {/* tier chip */}
                    <span className="w-14 shrink-0">
                      <span
                        className={`inline-block text-[9px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded border border-border ${TIER_CLASS[u.tier] ?? "text-muted-foreground"}`}
                      >
                        {TIER_LABEL[u.tier] ?? u.tier}
                      </span>
                    </span>

                    {/* score + thin mint under-bar */}
                    <span className="w-14 text-right shrink-0">
                      <span className="block text-[11px] sm:text-xs font-mono font-bold text-primary leading-tight">
                        {u.score}
                      </span>
                      <span className="block mt-0.5 h-0.5 bg-muted/60 rounded-full overflow-hidden">
                        <span
                          className="block h-0.5 bg-primary rounded-full transition-all duration-150"
                          style={{ width: `${Math.max(0, Math.min(100, u.score))}%` }}
                        />
                      </span>
                    </span>

                    {/* value events */}
                    <span className="w-12 text-right shrink-0 text-[10px] sm:text-xs font-mono text-foreground">
                      {u.valueEvents}
                    </span>

                    {/* active days */}
                    <span className="w-10 text-right shrink-0 text-[10px] sm:text-xs font-mono text-foreground">
                      {u.activeDays}
                    </span>

                    {/* last seen */}
                    <span className="w-12 text-right shrink-0 text-[10px] sm:text-xs font-mono text-muted-foreground">
                      {fmtAgo(u.lastActive)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Provenance caption — staff excluded upstream, identity joined at read time. */}
          <div className="text-[9px] sm:text-[10px] font-mono text-muted-foreground">
            Staff excluded; identity joined at read time.
          </div>
        </>
      )}
    </div>
  );
}
