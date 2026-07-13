import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // 2026-07-13 audit P0-7: `bg-accent` filled every skeleton with mint, so a
      // loading slate rendered ~15 pulsing "edge signals" per card. Skeletons are
      // scaffolding, never signal: bordered frames in the theme ink, pulsing.
      className={cn(
        "animate-pulse rounded-md border border-border bg-transparent",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
