/**
 * DimeAvenueToggle — 3-segment chat avenue control (owner directive 2026-08-01).
 *
 * Top-middle of the Dime Chat header on every breakpoint. Element language
 * follows the floating tab menu (MobileFloatingNav pill idiom): pill
 * geometry, Familjen Grotesk, 160ms brand motion. Colors are owner-specified
 * and intentionally invert per theme:
 *   • inactive — light mode: black bg / bold white text;
 *               dark mode: white bg / bold black text;
 *   • active  — the mint token (--dime-mint) / bold black text in both modes.
 *
 * Accessibility: tablist/tab semantics with roving tabindex and arrow-key
 * navigation. Labels compress (PROJECTIONS / SPLITS / ODDS + LINES) at
 * narrow widths via CSS — segments never wrap to two lines.
 */
import { useRef } from "react";
import { DIME_CHAT_AVENUES, type DimeChatAvenue } from "../lib/dimeChatAvenue";
import "./dimeAvenueToggle.css";

export interface DimeAvenueToggleProps {
  value: DimeChatAvenue;
  onChange: (avenue: DimeChatAvenue) => void;
  /** Extra class hook for surface-specific layout (bar centering etc.). */
  className?: string;
}

export function DimeAvenueToggle({
  value,
  onChange,
  className,
}: DimeAvenueToggleProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusAndSelect = (index: number) => {
    const count = DIME_CHAT_AVENUES.length;
    const next = (index + count) % count;
    const meta = DIME_CHAT_AVENUES[next];
    if (!meta) return;
    tabRefs.current[next]?.focus();
    onChange(meta.id);
  };

  return (
    <div
      role="tablist"
      aria-label="Chat data avenue"
      className={`dime-avenue-toggle${className ? ` ${className}` : ""}`}
    >
      {DIME_CHAT_AVENUES.map((meta, index) => {
        const active = meta.id === value;
        return (
          <button
            key={meta.id}
            ref={element => {
              tabRefs.current[index] = element;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={`dime-avenue-segment${active ? " is-active" : ""}`}
            onClick={() => onChange(meta.id)}
            onKeyDown={event => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                focusAndSelect(index + 1);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                focusAndSelect(index - 1);
              } else if (event.key === "Home") {
                event.preventDefault();
                focusAndSelect(0);
              } else if (event.key === "End") {
                event.preventDefault();
                focusAndSelect(DIME_CHAT_AVENUES.length - 1);
              }
            }}
          >
            <span className="dime-avenue-label-full">{meta.label}</span>
            <span className="dime-avenue-label-compact" aria-hidden="true">
              {meta.compactLabel}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default DimeAvenueToggle;
