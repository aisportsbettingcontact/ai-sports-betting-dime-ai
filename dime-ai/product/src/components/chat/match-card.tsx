"use client";

import type { MatchAnalysis } from "@/lib/types";
import { TeamLogo } from "@/components/icons";
import { ProbabilityBar } from "@/components/ui/bars";
import { ChevronDownIcon } from "@/components/icons";
import { useTheme } from "@/lib/theme";
import { fmtOdds } from "@/lib/format";

export function MatchCard({
  match,
  evidenceOpen,
  onToggleEvidence,
}: {
  match: MatchAnalysis;
  evidenceOpen: boolean;
  onToggleEvidence: () => void;
}) {
  const { oddsFormat } = useTheme();

  return (
    <section
      aria-label={match.aria}
      className="rounded-2xl border border-border bg-surface overflow-hidden animate-fade-in"
    >
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <span className="text-[11px] font-semibold tracking-wide uppercase text-text-3">{match.comp}</span>
        <span className="text-[11px] text-text-3 tabular-nums-font whitespace-nowrap">{match.sims}</span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 pt-3.5 pb-1">
        <div className="flex flex-col items-center gap-2">
          <TeamLogo src={match.awayLogo} alt={match.awayAlt} size={40} />
          <span className="text-[13px] font-semibold text-text-1 text-center">{match.away}</span>
        </div>
        <div className="flex flex-col items-center gap-0.5 px-2">
          <span className="text-2xl font-semibold tracking-tight text-text-1 tabular-nums-font whitespace-nowrap">
            {match.score}
          </span>
          <span className="text-[10.5px] font-medium tracking-wide uppercase text-text-3">Projected</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <TeamLogo src={match.homeLogo} alt={match.homeAlt} size={40} />
          <span className="text-[13px] font-semibold text-text-1 text-center">{match.home}</span>
        </div>
      </div>

      <div className="flex flex-col gap-2 px-4 pt-3.5 pb-0.5">
        {match.probs.map((p) => (
          <ProbabilityBar key={p.label} label={p.label} pct={p.pct} lead={p.lead} />
        ))}
      </div>

      <div className="mx-4 mt-3.5 border-t border-border pt-3 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold tracking-wide uppercase text-text-3">Model lean</span>
          <span className="text-[11px] text-text-3 tabular-nums-font">{match.totals}</span>
        </div>
        <div className="text-[14.5px] font-semibold text-text-1">{match.marketName}</div>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Best book" value={fmtOdds(match.bookPrice, oddsFormat)} />
          <Stat label="Dime fair" value={fmtOdds(match.fairPrice, oddsFormat)} />
          <Stat label="Est. edge" value={match.edge} mint />
        </div>
      </div>

      <button
        type="button"
        onClick={onToggleEvidence}
        aria-expanded={evidenceOpen}
        className="w-full flex items-center justify-between px-4 py-3 mt-1.5 border-t border-border min-h-11 active:bg-surface-2"
      >
        <span className="text-[13px] font-medium text-text-2">Model evidence</span>
        <ChevronDownIcon
          size={12}
          className="text-text-3 transition-transform"
          style={{ transform: evidenceOpen ? "rotate(180deg)" : "none" }}
        />
      </button>
      {evidenceOpen && (
        <div className="px-4 pb-3.5 flex flex-col gap-2 animate-fade-in">
          {match.drivers.map((d, i) => (
            <div key={i} className="flex gap-2 items-baseline">
              <span aria-hidden className="w-1 h-1 rounded-full bg-text-3 flex-none translate-y-[-3px]" />
              <span className="text-[13px] leading-snug text-text-2">{d}</span>
            </div>
          ))}
          <div className="text-[12.5px] leading-snug text-text-3 border-t border-border pt-2 mt-0.5">
            <span className="font-semibold text-text-2">Uncertainty · </span>
            {match.risk}
          </div>
        </div>
      )}

      <div className="px-4 py-2.5 bg-surface-2 text-[11px] text-text-3 tabular-nums-font">{match.meta}</div>
    </section>
  );
}

function Stat({ label, value, mint = false }: { label: string; value: string; mint?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10.5px] tracking-wide uppercase text-text-3">{label}</span>
      <span
        className={`text-[15px] tabular-nums-font ${mint ? "font-bold text-mint" : "font-semibold text-text-1"}`}
      >
        {value}
      </span>
    </div>
  );
}
