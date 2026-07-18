import { useRef, useState } from "react";
import type { MarketInsight } from "@/lib/gameInsight";
import { ProjectionSummary } from "./ProjectionSummary";
import type { ProjectionTeam } from "./types";

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
 * trackpad/scroll on desktop, interruptible by design), dot + count
 * navigation with real <button> elements, mint reserved for the active dot
 * (position = active-state signal), 160ms brand curve, and
 * prefers-reduced-motion collapses smooth scrolling to an instant jump.
 */
export function SummaryCarousel({
  insights,
  teams = [],
}: {
  insights: MarketInsight[];
  teams?: ProjectionTeam[];
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);

  const onScroll = () => {
    const el = trackRef.current;
    if (!el || el.clientWidth === 0) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    setActive(Math.max(0, Math.min(insights.length - 1, i)));
  };

  const goTo = (i: number) => {
    const el = trackRef.current;
    if (!el) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: i * el.clientWidth, behavior: reduce ? "auto" : "smooth" });
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
            <ProjectionSummary insight={ins} teams={teams} />
          </div>
        ))}
      </div>
      <div className="summary-carousel__nav">
        <span className="summary-carousel__count ds-label" aria-live="polite">
          Edge {active + 1} of {insights.length}
        </span>
        <div className="summary-carousel__dots">
          {insights.map((ins, i) => (
            <button
              key={`${ins.marketKey}-${ins.sideLabel}`}
              type="button"
              className="summary-carousel__dot"
              aria-label={`Go to edge ${i + 1}: ${ins.sideLabel}`}
              aria-current={i === active ? "true" : undefined}
              onClick={() => goTo(i)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
