export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className="relative flex-none w-11 h-[26px] rounded-full transition-colors"
      style={{ background: checked ? "var(--mint-strong)" : "var(--track)" }}
    >
      <span
        className="absolute top-[3px] w-5 h-5 rounded-full bg-white shadow transition-[left]"
        style={{ left: checked ? 21 : 3 }}
      />
    </button>
  );
}
