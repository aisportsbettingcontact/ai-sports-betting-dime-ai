import { useRef, useState } from "react";
import type { MarketInsight } from "@/lib/gameInsight";
import { ProjectionSummary } from "./ProjectionSummary";
import type { ProjectionTeam } from "./types";

export function clampActiveEdgeIndex(active: number, count: number): number {
  return Math.max(0, Math.min(active, Math.max(0, count - 1)));
}

/**
 * SummaryCarousel — a game with MORE THAN ONE model edge cycles them in a
 * swipeable, ranked strip (owner directive 2026-07-18). One slide per edge in
 * the exact ProjectionSummary format (uniform readout: MODEL EDGE / BOOK /
 * MODEL + the mint edge cell); slides arrive pre-ranked strongest → weakest,
 * so the first visible edge is always the largest % and the strip ends on the
 * smallest. Markets without an edge NEVER populate a slide — the caller
 * filters to real edges before rendering this.
 *
 * Mechanics per brand law: native scroll-snap (momentum swipe on touch,
 * trackpad/scroll on desktop, interruptible by design) plus one compact,
 * accessible next-edge arrow immediately after the edge pill. The last
 * edge wraps to the strongest edge. Prefers-reduced-motion collapses smooth
 * scrolling to an instant jump.
 */
export function SummaryCarousel({
  insights,
  teams = [],
}: {
  insights: MarketInsight[];
  teams?: ProjectionTeam[];
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const nextButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [active, setActive] = useState(0);
  const activeIndex = clampActiveEdgeIndex(active, insights.length);

  const onScroll = () => {
    const el = trackRef.current;
    if (!el || el.clientWidth === 0) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    setActive(clampActiveEdgeIndex(i, insights.length));
  };

  const goTo = (i: number, moveFocus = false) => {
    const el = trackRef.current;
    if (!el) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    setActive(i);
    el.scrollTo({ left: i * el.clientWidth, behavior: reduce ? "auto" : "smooth" });
    if (moveFocus) {
      requestAnimationFrame(() => nextButtonRefs.current[i]?.focus({ preventScroll: true }));
    }
  };

  return (
    <section
      className="summary-carousel"
      role="group"
      aria-roledescription="carousel"
      aria-label={`${insights.length} model edges, ranked strongest first`}
    >
      <div
        className="summary-carousel__track"
        ref={trackRef}
        onScroll={onScroll}
        tabIndex={0}
        aria-label="Swipe through this game's model edges"
      >
        {insights.map((ins, i) => (
          <div
            key={`${ins.marketKey}-${ins.sideLabel}`}
            className="summary-carousel__slide"
            role="group"
            aria-roledescription="slide"
            aria-label={`Edge ${i + 1} of ${insights.length}: ${ins.sideLabel}`}
          >
            <ProjectionSummary
              insight={ins}
              teams={teams}
              onNextEdge={() => goTo((i + 1) % insights.length, true)}
              nextEdgeLabel={`View next model edge: ${
                insights[(i + 1) % insights.length]?.sideLabel
              } (${(i + 1) % insights.length + 1} of ${insights.length})`}
              nextEdgeTabIndex={i === activeIndex ? 0 : -1}
              nextEdgeButtonRef={(element) => {
                nextButtonRefs.current[i] = element;
              }}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
