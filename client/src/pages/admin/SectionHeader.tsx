/**
 * SectionHeader — the consistent rhythm marker between cockpit sections: an IBM
 * Plex Mono uppercase label, a hairline that fills the remaining width, an
 * optional right-aligned meta node, and a loading spinner. Keeps every section
 * on the same visual grid (apple-design: familiarity + wayfinding).
 */
import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";

export default function SectionHeader({
  title,
  meta,
  loading,
}: {
  title: string;
  meta?: ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <span className="text-[11px] sm:text-xs font-mono font-semibold uppercase tracking-[0.14em] text-foreground shrink-0">
        {title}
      </span>
      <div className="flex-1 h-px bg-border min-w-0" />
      {meta && <span className="text-[11px] font-mono text-muted-foreground shrink-0">{meta}</span>}
      {loading && <RefreshCw className="w-3 h-3 text-muted-foreground animate-spin shrink-0" />}
    </div>
  );
}
