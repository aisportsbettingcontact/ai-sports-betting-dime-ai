/**
 * useMobileDebug — Production-grade mobile viewport debug hook
 *
 * Logs all critical mobile metrics on mount and every resize:
 *   - Viewport dimensions (innerWidth × innerHeight)
 *   - Visual viewport dimensions (visualViewport, accounts for keyboard/zoom)
 *   - Device pixel ratio (DPR)
 *   - Safe area insets (env(safe-area-inset-*) via getComputedStyle)
 *   - --scale CSS variable value
 *   - Device classification (mobile/tablet/desktop)
 *   - Header height (passed in from the parent component)
 *   - Computed --fs-nav, --fs-header token values
 *
 * Usage:
 *   useMobileDebug({ headerHeight, label: 'ModelProjections' });
 *
 * Output format (dev only, no-op in production):
 *   [MobileDebug:ModelProjections] vw=393 vh=852 dpr=3 scale=1.000
 *     safe: top=59px bottom=34px left=0px right=0px
 *     header: 88px  device: mobile
 *     --fs-nav: 11px  --fs-header: 10px
 *
 * All logs are prefixed with [MobileDebug:LABEL] for easy filtering.
 * Throttled to 200ms on resize to avoid flooding the console.
 */

import { useEffect, useRef } from "react";

interface MobileDebugOptions {
  /** Label for log prefix — use component name for easy filtering */
  label: string;
  /** Current measured header height in px (from ResizeObserver in parent) */
  headerHeight?: number;
  /** Additional key-value pairs to log (e.g. { filterBarHeight, dateRowHeight }) */
  extra?: Record<string, string | number | boolean>;
}

const IS_DEV = process.env.NODE_ENV === "development";
const THROTTLE_MS = 200;

function getSafeAreaInsets(): { top: string; bottom: string; left: string; right: string } {
  // Read CSS env() values via a temporary element — the only reliable way
  // to read env(safe-area-inset-*) values from JavaScript.
  if (typeof document === "undefined") return { top: "0px", bottom: "0px", left: "0px", right: "0px" };
  const el = document.createElement("div");
  el.style.cssText = [
    "position:fixed",
    "top:env(safe-area-inset-top,0px)",
    "bottom:env(safe-area-inset-bottom,0px)",
    "left:env(safe-area-inset-left,0px)",
    "right:env(safe-area-inset-right,0px)",
    "visibility:hidden",
    "pointer-events:none",
    "width:0",
    "height:0",
  ].join(";");
  document.body.appendChild(el);
  const cs = getComputedStyle(el);
  const result = {
    top:    cs.top    || "0px",
    bottom: cs.bottom || "0px",
    left:   cs.left   || "0px",
    right:  cs.right  || "0px",
  };
  document.body.removeChild(el);
  return result;
}

function getCSSVar(name: string): string {
  if (typeof document === "undefined") return "N/A";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "N/A";
}

function logMetrics(label: string, headerHeight?: number, extra?: Record<string, string | number | boolean>) {
  if (!IS_DEV) return;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const dvh = window.visualViewport?.height ?? vh;
  const dvw = window.visualViewport?.width ?? vw;
  const dpr = window.devicePixelRatio ?? 1;
  const scale = Math.min(3.85, Math.max(0.81, vw / 393));
  const device = vw < 768 ? "mobile" : vw <= 1024 ? "tablet" : "desktop";
  const safeInsets = getSafeAreaInsets();
  const fsNav    = getCSSVar("--fs-nav");
  const fsHeader = getCSSVar("--fs-header");
  const fsBase   = getCSSVar("--fs-base");
  const scaleCss = getCSSVar("--scale");

  // Compute filter bar budget: vw minus safe-left and safe-right
  const safeLeftPx  = parseFloat(safeInsets.left)  || 0;
  const safeRightPx = parseFloat(safeInsets.right) || 0;
  const filterBarBudget = vw - safeLeftPx - safeRightPx;

  console.groupCollapsed(
    `%c[MobileDebug:${label}] %cvw=${vw} vh=${vh} dpr=${dpr.toFixed(1)} scale=${scale.toFixed(3)} device=${device}`,
    "color:#45E0A8;font-weight:700;font-size:11px",
    "color:#FFFFFF;font-size:10px"
  );
  console.log(
    `%c  visual viewport: %c${dvw}×${dvh}px`,
    "color:#FFFFFF;font-size:9px", "color:#FFFFFF;font-size:9px"
  );
  console.log(
    `%c  safe insets:     %ctop=${safeInsets.top}  bottom=${safeInsets.bottom}  left=${safeInsets.left}  right=${safeInsets.right}`,
    "color:#FFFFFF;font-size:9px", "color:#FFFFFF;font-size:9px"
  );
  console.log(
    `%c  filter budget:   %c${filterBarBudget}px (vw minus safe-left/right)`,
    "color:#FFFFFF;font-size:9px", "color:#FFFFFF;font-size:9px"
  );
  if (headerHeight !== undefined) {
    console.log(
      `%c  header height:   %c${headerHeight}px  →  feed starts at y=${headerHeight}px`,
      "color:#FFFFFF;font-size:9px", "color:#FFFFFF;font-size:9px"
    );
    const feedHeight = vh - headerHeight - (parseFloat(safeInsets.bottom) || 0);
    console.log(
      `%c  feed height:     %c${feedHeight}px (vh - header - safe-bottom)`,
      "color:#FFFFFF;font-size:9px", "color:#FFFFFF;font-size:9px"
    );
  }
  console.log(
    `%c  CSS tokens:      %c--scale=${scaleCss}  --fs-nav=${fsNav}  --fs-header=${fsHeader}  --fs-base=${fsBase}`,
    "color:#FFFFFF;font-size:9px", "color:#FFFFFF;font-size:9px"
  );
  if (extra && Object.keys(extra).length > 0) {
    const extraStr = Object.entries(extra).map(([k, v]) => `${k}=${v}`).join("  ");
    console.log(
      `%c  extra:           %c${extraStr}`,
      "color:#FFFFFF;font-size:9px", "color:#FFFFFF;font-size:9px"
    );
  }
  // Overflow warning: flag if vw < 375px (tight mobile)
  if (vw < 375) {
    console.warn(
      `%c  ⚠ NARROW SCREEN: ${vw}px < 375px — verify filter bar and date row fit without overflow`,
      "color:#FFFFFF;font-size:9px;font-weight:700"
    );
  }
  console.groupEnd();
}

export function useMobileDebug(options: MobileDebugOptions): void {
  const { label, headerHeight, extra } = options;
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!IS_DEV) return;

    // Initial log on mount
    logMetrics(label, headerHeight, extra);

    const handleResize = () => {
      if (throttleRef.current) clearTimeout(throttleRef.current);
      throttleRef.current = setTimeout(() => {
        logMetrics(label, headerHeight, extra);
      }, THROTTLE_MS);
    };

    window.addEventListener("resize", handleResize, { passive: true });
    window.visualViewport?.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.visualViewport?.removeEventListener("resize", handleResize);
      if (throttleRef.current) clearTimeout(throttleRef.current);
    };
  }, [label, headerHeight, extra]);
}

/**
 * logMobileEvent — One-shot debug log for specific mobile events
 * (e.g., filter bar render, date row render, card render)
 *
 * Usage:
 *   logMobileEvent('FilterBar', 'rendered', { pillCount: 5, totalWidth: 380 });
 */
export function logMobileEvent(
  component: string,
  event: string,
  data?: Record<string, string | number | boolean>
): void {
  if (!IS_DEV) return;
  const dataStr = data ? "  " + Object.entries(data).map(([k, v]) => `${k}=${v}`).join("  ") : "";
  console.log(
    `%c[MobileDebug:${component}] %c${event}${dataStr}`,
    "color:#45E0A8;font-weight:700;font-size:10px",
    "color:#FFFFFF;font-size:10px"
  );
}
