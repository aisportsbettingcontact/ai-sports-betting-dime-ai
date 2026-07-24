/**
 * IntervalPicker — a controlled <select> that maps a human-readable billing
 * cadence label to the Stripe `{ interval, intervalCount }` pair the
 * subscriptionPlans.create mutation expects.
 *
 * The cadence list lives in planTypes.ts (pure data, unit-tested). This file
 * re-exports INTERVAL_OPTIONS so consumers/tests can reach it through the
 * picker's public surface. Defaults to "Monthly" when `value` matches no known
 * cadence.
 *
 * Design: Dime brand law — semantic tokens only, Familjen Grotesk, 160ms
 * transition, visible focus ring, cursor-pointer.
 */
import { INTERVAL_OPTIONS, DEFAULT_INTERVAL } from "./planTypes";
import type { IntervalOption, IntervalValue } from "./planTypes";

export { INTERVAL_OPTIONS, DEFAULT_INTERVAL };
export type { IntervalOption, IntervalValue };

interface IntervalPickerProps {
  value: IntervalValue;
  onChange: (v: IntervalValue) => void;
  id?: string;
}

/** Resolve the option matching `value`, falling back to Monthly. */
function optionFor(value: IntervalValue): IntervalOption {
  return (
    INTERVAL_OPTIONS.find(
      (o) => o.interval === value.interval && o.intervalCount === value.intervalCount,
    ) ??
    INTERVAL_OPTIONS.find((o) => o.label === "Monthly") ??
    INTERVAL_OPTIONS[0]
  );
}

export function IntervalPicker({ value, onChange, id }: IntervalPickerProps) {
  const selected = optionFor(value);

  return (
    <select
      id={id}
      value={selected.label}
      onChange={(e) => {
        const next = INTERVAL_OPTIONS.find((o) => o.label === e.target.value);
        if (next) onChange({ interval: next.interval, intervalCount: next.intervalCount });
      }}
      className="w-full cursor-pointer rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition-colors duration-150 focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {INTERVAL_OPTIONS.map((o) => (
        <option key={o.label} value={o.label}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export default IntervalPicker;
