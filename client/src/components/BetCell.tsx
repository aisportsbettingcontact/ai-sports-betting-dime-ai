/**
 * BetCell — Universal atomic bet display component.
 *
 * Replaces: MktCard IIFE inside GameCard mobile IIFE, inline cells in DesktopMergedPanel.
 * Canonical: one implementation for all card types.
 *
 * Layout:
 *   ┌──────────────────────────────┐
 *   │  BOOK          │  MODEL      │  ← header
 *   ├──────────────────────────────┤
 *   │  [rowLabel]    │  [rowLabel] │  ← optional row label (dim)
 *   │  bookJuice     │  modelJuice │  ← away/over row
 *   ├──────────────────────────────┤  ← hidden when singleRow=true (DRAW)
 *   │  [rowLabel]    │  [rowLabel] │  ← optional row label (dim)
 *   │  bookJuice     │  modelJuice │  ← home/under row
 *   ├──────────────────────────────┤
 *   │  edgeLabel  +X.XX% ROI      │  ← footer
 *   └──────────────────────────────┘
 *
 * singleRow=true: hides the home row and divider (used for DRAW in soccer).
 * roiPct: pre-computed ROI % from caller (3-way for ML/DRAW, 2-way for TOTAL).
 *         When provided and hasEdge, displayed as "+X.XX% ROI" in footer.
 *         Falls back to "+X.XXpp" display if not provided.
 *
 * [FIX] ML centering: when bookLine/modelLine is empty, the odds value is
 *       perfectly vertically centered in the row with equal top/bottom padding.
 *       No hidden spacer spans — pure flexbox centering.
 * [FIX] Long odds (5+ chars like +1000, +2200): font shrinks to clamp(8px,2.4vw,10px)
 *       and cell gets minWidth:0 + overflow:visible to prevent wrapping.
 */
import React from 'react';
import { getEdgeColor, EDGE_THRESHOLD_PP } from '@/lib/edgeUtils';

export interface BetCellSide {
  /** Line display string, e.g. "-1.5", "O8.5", "DRAW", "HOME W/D". Empty string for ML (no line). */
  bookLine: string;
  bookJuice: string;
  modelLine: string;
  modelJuice: string;
  /** Edge in percentage points for this specific side. NaN = no edge data. */
  edgePP: number;
}

interface BetCellProps {
  /** Market title: "SPREAD" | "TOTAL" | "ML" | "DRAW" */
  title: string;
  away: BetCellSide;
  home: BetCellSide;
  /** Best edge side label, e.g. "EDM -1.5", "U6.5", "CGY ML" */
  edgeLabel?: string;
  /** Best edge PP across away/home for this market. Used for footer color tier. */
  bestEdgePP?: number;
  /**
   * Pre-computed ROI % from caller.
   * - ML/DRAW: use calculate3WayResult (3-way no-vig)
   * - TOTAL: use calculateRoi (2-way no-vig)
   * When provided and hasEdge, displayed as "+X.XX% ROI" in footer.
   * Falls back to "+X.XXpp" if NaN.
   */
  roiPct?: number;
  /** Visual size: 'sm' = mobile compressed, 'md' = tablet/desktop */
  size?: 'sm' | 'md';
  /**
   * singleRow=true: hides the home row and divider.
   * Used for DRAW in soccer — only one odds line to display.
   */
  singleRow?: boolean;
}

export const BetCell = React.memo(function BetCell({
  away,
  home,
  edgeLabel,
  bestEdgePP = NaN,
  roiPct,
  size = 'sm',
  singleRow = false,
}: BetCellProps) {
  const hasEdge = !isNaN(bestEdgePP) && bestEdgePP >= EDGE_THRESHOLD_PP;
  const edgeColor = hasEdge ? getEdgeColor(bestEdgePP) : undefined;

  // [LOG] BetCell: responsive font sizes matching MLB MobileGameCard exactly
  // [FIX] Dynamic font scaling: if any juice value is 5+ chars (e.g. +1000), shrink more aggressively
  // [FIX] 6+ chars (e.g. +2200, -1000) shrink to minimum to prevent wrapping
  const allJuices = [
    away.bookJuice, away.modelJuice,
    ...(singleRow ? [] : [home.bookJuice, home.modelJuice])
  ].filter(v => v && v !== '—');

  const maxJuiceLen = allJuices.reduce((max, v) => Math.max(max, v?.length ?? 0), 0);
  const hasVeryLongOdds = maxJuiceLen >= 6; // e.g. +2200, -1000
  const hasLongOdds = maxJuiceLen >= 5;     // e.g. +1000, -900

  const juiceSizeStr = hasVeryLongOdds
    ? (size === 'sm' ? 'clamp(8px, 2.4vw, 10px)' : 'clamp(10px, 0.9vw, 12px)')
    : hasLongOdds
    ? (size === 'sm' ? 'clamp(9px, 2.8vw, 11px)' : 'clamp(11px, 1.0vw, 13px)')
    : (size === 'sm' ? 'clamp(11px, 3.5vw, 14px)' : 'clamp(13px, 1.2vw, 16px)');

  const lineSize = size === 'sm' ? 8.5 : 10;
  const headerSize = size === 'sm' ? 6.5 : 8;
  const footerSize = size === 'sm' ? 7 : 8;
  const borderRadius = size === 'sm' ? 8 : 10;
  const padding = size === 'sm' ? '4px 3px' : '5px 7px';

  const awayEdge = !isNaN(away.edgePP) && away.edgePP >= EDGE_THRESHOLD_PP;
  const homeEdge = !singleRow && !isNaN(home.edgePP) && home.edgePP >= EDGE_THRESHOLD_PP;

  // [LOG] BetCell:EdgeDetect — per-side edge flags
  console.log(
    `[BetCell:EdgeDetect] title=${edgeLabel ?? 'N/A'}` +
    ` | [STATE] awayEdgePP=${isNaN(away.edgePP) ? 'NaN' : away.edgePP.toFixed(2)}pp` +
    ` homeEdgePP=${singleRow ? 'SINGLE_ROW' : (isNaN(home.edgePP) ? 'NaN' : home.edgePP.toFixed(2) + 'pp')}` +
    ` bestEdgePP=${isNaN(bestEdgePP) ? 'NaN' : bestEdgePP.toFixed(2)}pp` +
    ` threshold=${EDGE_THRESHOLD_PP}pp` +
    ` | [STATE] roiPct=${roiPct != null && !isNaN(roiPct) ? roiPct.toFixed(2) + '%' : 'NaN'}` +
    ` | [STATE] maxJuiceLen=${maxJuiceLen} hasLongOdds=${hasLongOdds} hasVeryLongOdds=${hasVeryLongOdds}` +
    ` | [OUTPUT] hasEdge=${hasEdge} awayEdge=${awayEdge} homeEdge=${homeEdge}`
  );

  // [STEP] ROI footer text — prefer pre-computed roiPct, fall back to bestEdgePP pp display
  const roiFooterText = hasEdge
    ? (roiPct != null && !isNaN(roiPct)
        ? `+${roiPct.toFixed(2)}% ROI`
        : `+${bestEdgePP.toFixed(2)}pp`)
    : 'NO EDGE';

  // [FIX] TeamRow: pure flexbox centering for ML (no line label) and line+juice for TOTAL/RL
  // When bookLine is empty, the juice value is perfectly centered with equal vertical padding.
  // No hidden spacer spans — flex justifyContent:'center' handles vertical centering.
  const TeamRow = ({ side, isEdge }: { side: BetCellSide; isEdge: boolean }) => {
    const hasLine = !!(side.bookLine || side.modelLine);
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 2,
          padding,
          // [FIX] When no line label, use flex centering for the row itself
          alignItems: 'center',
        }}
      >
        {/* Book column */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: hasLine ? 1 : 0,
            minWidth: 0,
          }}
        >
          {side.bookLine && (
            <span
              style={{
                fontSize: lineSize,
                color: 'rgba(255,255,255,0.45)',
                lineHeight: 1,
                whiteSpace: 'nowrap',
                textAlign: 'center',
                fontVariantNumeric: 'tabular-nums',
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {side.bookLine}
            </span>
          )}
          <span
            style={{
              fontSize: juiceSizeStr,
              fontWeight: 700,
              color: 'rgba(255,255,255,0.90)',
              lineHeight: 1,
              whiteSpace: 'nowrap',
              textAlign: 'center',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {side.bookJuice || '—'}
          </span>
        </div>
        {/* Model column */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: hasLine ? 1 : 0,
            minWidth: 0,
          }}
        >
          {side.modelLine && (
            <span
              style={{
                fontSize: lineSize,
                color: 'rgba(255,255,255,0.45)',
                lineHeight: 1,
                whiteSpace: 'nowrap',
                textAlign: 'center',
                fontVariantNumeric: 'tabular-nums',
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {side.modelLine}
            </span>
          )}
          <span
            style={{
              fontSize: juiceSizeStr,
              fontWeight: 700,
              lineHeight: 1,
              whiteSpace: 'nowrap',
              textAlign: 'center',
              fontVariantNumeric: 'tabular-nums',
              color: isEdge ? getEdgeColor(side.edgePP) : 'rgba(255,255,255,0.90)',
            }}
          >
            {side.modelJuice || '—'}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-start',
        background: '#2a2a2e',
        borderRadius,
        overflow: 'hidden',
        flex: '1 1 0',
        minWidth: 0,
      }}
    >
      {/* BOOK / MODEL header — opacity 0.75 matches MLB MobileGameCard exactly */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          borderBottom: '0.5px solid rgba(255,255,255,0.08)',
          padding: '3px 4px 2px',
        }}
      >
        <span
          style={{
            fontSize: headerSize,
            fontWeight: 700,
            color: 'rgba(255,255,255,0.75)',
            textAlign: 'center',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          BOOK
        </span>
        <span
          style={{
            fontSize: headerSize,
            fontWeight: 700,
            color: 'rgba(255,255,255,0.70)',
            textAlign: 'center',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          MODEL
        </span>
      </div>

      {/* Away / Over row */}
      <TeamRow side={away} isEdge={awayEdge} />

      {/* Divider + Home row — hidden for singleRow (DRAW) */}
      {!singleRow && (
        <>
          <div style={{ height: 0.5, background: 'rgba(255,255,255,0.07)', margin: '0 4px' }} />
          <TeamRow side={home} isEdge={homeEdge} />
        </>
      )}

      {/* ROI Footer — pinned to bottom via marginTop:auto */}
      <div
        style={{
          marginTop: 'auto',
          borderTop: '0.5px solid rgba(255,255,255,0.07)',
          padding: '3px 4px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 1,
          background: hasEdge ? 'rgba(57,255,20,0.04)' : 'transparent',
        }}
      >
        {hasEdge && edgeLabel && (
          <span
            style={{
              fontSize: footerSize,
              fontWeight: 700,
              color: edgeColor,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              lineHeight: 1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '100%',
              textAlign: 'center',
            }}
          >
            {edgeLabel}
          </span>
        )}
        <span
          style={{
            fontSize: footerSize + 0.5,
            fontWeight: hasEdge ? 800 : 400,
            color: hasEdge ? edgeColor : 'rgba(200,200,200,0.40)',
            letterSpacing: '0.03em',
            lineHeight: 1,
            whiteSpace: 'nowrap',
            textAlign: 'center',
          }}
        >
          {roiFooterText}
        </span>
      </div>
    </div>
  );
});
