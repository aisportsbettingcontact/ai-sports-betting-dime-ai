"use client";

import type { PropProjection } from "@/lib/types";
import { TeamLogo } from "@/components/icons";
import { ConfidenceBadge } from "@/components/ui/badge";
import { ChevronDownIcon } from "@/components/icons";
import { useTheme } from "@/lib/theme";
import { fmtOdds } from "@/lib/format";

/** Single ranked prop row — shared by the in-chat Prop Cards section and the Props tab list. */
export function PropRow({
  prop,
  rank,
  whyOpen,
  onToggleWhy,
  bordered = true,
}: {
  prop: PropProjection;
  rank: number;
  whyOpen: boolean;
  onToggleWhy: () => void;
  bordered?: boolean;
}) {
  const { oddsFormat } = useTheme();

  return (
    <div className={`${bordered && rank > 1 ? "border-t border-border" : ""} px-4 pt-3.5 pb-1.5`} role="group" aria-label={`${prop.player}, ${prop.confidence} confidence`}>
      <div className="flex items-center gap-2.5">
        <span className="text-[12px] font-semibold text-text-3 tabular-nums-font w-3.5 flex-none">{rank}</span>
        <span className="text-[15px] font-semibold text-text-1 flex-1 min-w-0 truncate">{prop.player}</span>
        <ConfidenceBadge confidence={prop.confidence} />
      </div>
      <div className="flex items-center gap-2 mt-2 pl-6">
        <TeamLogo src={prop.teamLogo} alt={prop.teamAlt} size={18} />
        <span className="text-[12.5px] text-text-3">{prop.vs}</span>
        <TeamLogo src={prop.oppLogo} alt={prop.oppAlt} size={18} />
        <span className="text-[13px] text-text-2 truncate">{prop.market}</span>
      </div>
      <div className="grid grid-cols-4 gap-1.5 mt-3 pl-6">
        <PropStat label="Book" value={fmtOdds(prop.bookPrice, oddsFormat)} />
        <PropStat label="Dime proj." value={prop.projection} />
        <PropStat label="Fair" value={fmtOdds(prop.fairPrice, oddsFormat)} />
        <PropStat label="Est. edge" value={prop.edge} mint />
      </div>
      <button
        type="button"
        onClick={onToggleWhy}
        aria-expanded={whyOpen}
        className="flex items-center gap-1.5 py-2.5 pl-6 min-h-10 w-full"
      >
        <span className="text-[12.5px] font-medium text-text-2">Why this edge?</span>
        <ChevronDownIcon
          size={11}
          className="text-text-3"
          style={{ transform: whyOpen ? "rotate(180deg)" : "none" }}
        />
      </button>
      {whyOpen && (
        <div className="pb-3 pl-6 flex flex-col gap-1.5 animate-fade-in">
          {prop.evidence.map((e, i) => (
            <div key={i} className="flex gap-2 items-baseline">
              <span aria-hidden className="w-1 h-1 rounded-full bg-text-3 flex-none translate-y-[-3px]" />
              <span className="text-[12.5px] leading-snug text-text-2">{e}</span>
            </div>
          ))}
          <div className="text-[12px] leading-snug text-text-3">
            <span className="font-semibold text-text-2">Risk · </span>
            {prop.risk}
          </div>
        </div>
      )}
    </div>
  );
}

function PropStat({ label, value, mint = false }: { label: string; value: string; mint?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] tracking-wide uppercase text-text-3">{label}</span>
      <span className={`text-[14px] tabular-nums-font truncate ${mint ? "font-bold text-mint" : "font-semibold text-text-1"}`}>
        {value}
      </span>
    </div>
  );
}
