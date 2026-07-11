export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex gap-0.5 rounded-[11px] bg-surface-2 p-[3px]"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={`rounded-lg px-3 py-1.5 text-[12.5px] ${
              active ? "bg-elev shadow font-semibold text-text-1" : "font-medium text-text-2"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
