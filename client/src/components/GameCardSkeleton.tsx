/**
 * GameCardSkeleton — Loading placeholder that matches the GameCard layout.
 *
 * [PERF] Replaces the Loader2 spinner in ModelProjections during gamesLoading.
 * Eliminates perceived loading time by showing a content-shaped placeholder
 * that matches the actual game card dimensions — no layout shift when data arrives.
 *
 * Renders 4 skeleton cards by default (typical MLB/NHL slate size visible above fold).
 */

import { Skeleton } from "@/components/ui/skeleton";

interface GameCardSkeletonProps {
  count?: number;
}

/** Single skeleton card that mirrors the GameCard desktop+mobile layout */
function SingleGameCardSkeleton() {
  return (
    <div
      className="w-full relative"
      style={{
        background: "hsl(var(--card))",
        borderTop: "1px solid hsl(var(--border))",
        borderBottom: "1px solid hsl(var(--border))",
        borderLeft: "3px solid hsl(var(--border))",
      }}
    >
      {/* ── Desktop layout (≥ md) ── */}
      <div className="hidden md:flex items-stretch w-full" style={{ minHeight: "clamp(160px,14vw,220px)" }}>
        {/* Col 1: Score panel */}
        <div
          style={{
            flex: "0 0 clamp(170px,22vw,260px)",
            width: "clamp(170px,22vw,260px)",
            borderRight: "1px solid hsl(var(--border) / 0.5)",
            padding: "16px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {/* Away team row */}
          <div className="flex items-center gap-2">
            <Skeleton className="w-8 h-8 rounded-full flex-shrink-0" />
            <div className="flex-1 flex flex-col gap-1">
              <Skeleton className="h-3 w-20 rounded" />
              <Skeleton className="h-2.5 w-14 rounded" />
            </div>
            <Skeleton className="h-5 w-8 rounded" />
          </div>
          {/* Home team row */}
          <div className="flex items-center gap-2">
            <Skeleton className="w-8 h-8 rounded-full flex-shrink-0" />
            <div className="flex-1 flex flex-col gap-1">
              <Skeleton className="h-3 w-20 rounded" />
              <Skeleton className="h-2.5 w-14 rounded" />
            </div>
            <Skeleton className="h-5 w-8 rounded" />
          </div>
          {/* Time badge */}
          <Skeleton className="h-4 w-16 rounded mt-auto" />
        </div>

        {/* Col 2: Odds panel */}
        <div
          className="flex-1 min-w-0"
          style={{
            borderLeft: "1px solid hsl(var(--border) / 0.5)",
            padding: "12px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {/* Header row */}
          <div className="flex gap-4">
            <Skeleton className="h-3 w-16 rounded" />
            <Skeleton className="h-3 w-16 rounded" />
            <Skeleton className="h-3 w-16 rounded" />
          </div>
          {/* Away odds row */}
          <div className="flex gap-4">
            <Skeleton className="h-8 flex-1 rounded" />
            <Skeleton className="h-8 flex-1 rounded" />
            <Skeleton className="h-8 flex-1 rounded" />
          </div>
          {/* Home odds row */}
          <div className="flex gap-4">
            <Skeleton className="h-8 flex-1 rounded" />
            <Skeleton className="h-8 flex-1 rounded" />
            <Skeleton className="h-8 flex-1 rounded" />
          </div>
        </div>
      </div>

      {/* ── Mobile layout (< md) ── */}
      <div className="flex md:hidden flex-col w-full">
        {/* Row 1: Score panel */}
        <div
          style={{
            borderBottom: "1px solid hsl(var(--border) / 0.5)",
            padding: "12px 10px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div className="flex items-center gap-2">
            <Skeleton className="w-7 h-7 rounded-full flex-shrink-0" />
            <div className="flex-1 flex flex-col gap-1">
              <Skeleton className="h-3 w-20 rounded" />
              <Skeleton className="h-2.5 w-14 rounded" />
            </div>
            <Skeleton className="h-5 w-8 rounded" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="w-7 h-7 rounded-full flex-shrink-0" />
            <div className="flex-1 flex flex-col gap-1">
              <Skeleton className="h-3 w-20 rounded" />
              <Skeleton className="h-2.5 w-14 rounded" />
            </div>
            <Skeleton className="h-5 w-8 rounded" />
          </div>
        </div>
        {/* Row 2: Odds panel */}
        <div style={{ padding: "10px", display: "flex", gap: 8 }}>
          <Skeleton className="h-14 flex-1 rounded" />
          <Skeleton className="h-14 flex-1 rounded" />
          <Skeleton className="h-14 flex-1 rounded" />
        </div>
      </div>
    </div>
  );
}

/** Renders `count` skeleton cards (default: 4) */
export function GameCardSkeleton({ count = 4 }: GameCardSkeletonProps) {
  return (
    <div className="w-full">
      {Array.from({ length: count }, (_, i) => (
        <SingleGameCardSkeleton key={i} />
      ))}
    </div>
  );
}
