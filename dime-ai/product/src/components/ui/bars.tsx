/** Single-outcome probability row: label — thin track — percentage. */
export function ProbabilityBar({
  label,
  pct,
  lead,
}: {
  label: string;
  pct: number;
  lead: boolean;
}) {
  return (
    <div className="grid grid-cols-[76px_1fr_42px] items-center gap-2.5">
      <span className="text-[12.5px] font-medium text-text-2 truncate">{label}</span>
      <div className="h-1 rounded-full bg-track overflow-hidden" aria-hidden>
        <div
          className={`h-full rounded-full ${lead ? "bg-mint" : "bg-text-3"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[13px] font-semibold text-text-1 tabular-nums-font text-right">
        {pct}%
      </span>
    </div>
  );
}

/**
 * One shared two-segment split bar (tickets or money distribution) used by
 * the Splits tab. Single outer track, single border, single clip radius,
 * one filled segment + one neutral segment, one internal separator — no
 * per-segment borders or doubled seams.
 *
 * The filled segment uses a neutral emphasis token (--sp-bar-fill), NOT the
 * mint signal color. Tickets/money split bars show the public betting
 * distribution, which is not a model signal; painting side A mint here made
 * mint mean "side A of the crowd" in the same column where the mint model-
 * highlight pill meant "the side the model favors" — often the opposite team.
 * Keeping mint reserved for the model signal removes that contradiction. The
 * two segments are distinguished by their in-bar percentages (and the
 * aria-label), so the bar does not rely on color alone.
 */
export function SplitBar({
  heading,
  aLabel,
  bLabel,
  aPct,
  bPct,
}: {
  heading: string;
  aLabel: string;
  bLabel: string;
  aPct: number;
  bPct: number;
}) {
  // Guarantee a readable minimum width for narrow segments (e.g. 3/97).
  const aFlex = Math.max(aPct, 10);
  const bFlex = Math.max(bPct, 10);

  return (
    <div>
      <div className="flex items-center justify-between text-[11px] font-medium text-sp-text-2 mb-1 px-0.5">
        <span className="truncate">{aLabel}</span>
        <span className="truncate">{bLabel}</span>
      </div>
      <div className="text-center text-[10px] font-semibold tracking-wider uppercase text-sp-text-3 mb-1">
        {heading}
      </div>
      <div
        className="flex h-8 rounded-lg overflow-hidden border border-sp-border bg-sp-track"
        role="img"
        aria-label={`${heading}: ${aLabel} ${aPct}%, ${bLabel} ${bPct}%`}
      >
        <div
          className="flex items-center justify-center text-[12.5px] font-semibold tabular-nums-font"
          style={{
            flexGrow: aFlex,
            flexBasis: 0,
            minWidth: 46,
            background: "var(--sp-bar-fill)",
            color: "var(--sp-bar-ink)",
          }}
        >
          {aPct}%
        </div>
        <div className="w-px bg-sp-surface" aria-hidden />
        <div
          className="flex items-center justify-center text-[12.5px] font-semibold tabular-nums-font text-sp-text-1"
          style={{ flexGrow: bFlex, flexBasis: 0, minWidth: 46 }}
        >
          {bPct}%
        </div>
      </div>
    </div>
  );
}
