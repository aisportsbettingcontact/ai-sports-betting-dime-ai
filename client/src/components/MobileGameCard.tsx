/**
 * MobileGameCard — Extracted from GameCard.tsx mobile IIFE (Phase 12 refactor).
 *
 * Wrapped in React.memo with custom comparison to prevent unnecessary re-renders
 * when only unrelated parent state changes (e.g., desktop panel toggles).
 *
 * All closure variables from the original IIFE are passed as explicit props.
 */

import React from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@/lib/trpc';
import { getEdgeColor, calculateEdge, calculateRoi, formatRoi, getVerdict } from '@/lib/edgeUtils';
import { spreadSign, toNum } from '@/lib/gameUtils';
import { BettingSplitsPanel } from './BettingSplitsPanel';

// ── fmtOddsSign ─────────────────────────────────────────────────────────────
// Ensures positive American odds always display with a leading '+' sign.
// [FIX] Bug: model PL odds (e.g. 214) and model over odds (e.g. 115) were
// stored as positive integers in DB but rendered without '+' prefix on mobile.
const fmtOddsSign = (raw: string | number | null | undefined): string => {
  if (raw == null || raw === '' || raw === '—') return '—';
  const s = String(raw).trim();
  if (s.startsWith('+') || s.startsWith('-')) return s;
  const n = Number(s);
  if (isNaN(n)) return s;
  if (n === 100) return 'EV';
  if (n > 0) return `+${n}`;
  return s;
};

type RouterOutput = inferRouterOutputs<AppRouter>;
type GameRow = RouterOutput['games']['list'][number];
type MobileTab = 'dual' | 'splits';

// TeamLogo component (inline — same as in GameCard.tsx)
function TeamLogo({ slug, name, logoUrl, size = 32 }: { slug: string; name: string; logoUrl?: string; size?: number }) {
  // Enforce minimum 24px — logos can be 28px in the narrow left panel; the 44px row height
  // provides the touch target, so the logo itself doesn't need to be 32px.
  const actualSize = Math.max(24, size);
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={name}
        style={{
          width: actualSize, height: actualSize,
          objectFit: 'contain',
          mixBlendMode: 'screen',
          flexShrink: 0,
          // Enhanced visibility: brightness lifts dark logos, contrast sharpens, saturate keeps vivid
          // brightness(1.7): lifts dark logos (A's green, Padres brown) without blowing out bright logos
          filter: 'brightness(1.7) contrast(1.12) saturate(1.35)',
        }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
    );
  }
  const initials = name.split(/\s+/).map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div style={{
      width: actualSize, height: actualSize, borderRadius: '50%',
      background: '#000000',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: actualSize * 0.35, fontWeight: 700, color: '#FFFFFF',
      flexShrink: 0,
    }}>
      {initials}
    </div>
  );
}

// edgeLabelIsAway — GameCard-specific domain logic (determines if edge is on away team)
function edgeLabelIsAway(label: string, awayAbbr: string, awayDisplayName: string, sport: string): boolean {
  if (!label) return false;
  const upper = label.toUpperCase();
  const awayAbbrUpper = awayAbbr.toUpperCase();
  const awayNameUpper = awayDisplayName.toUpperCase();
  return upper.startsWith(awayAbbrUpper) || upper.startsWith(awayNameUpper);
}

export interface MobileGameCardProps {
  game: GameRow;
  awayAbbr: string;
  homeAbbr: string;
  awayName: string;
  homeName: string;
  awayDisplayName: string;
  homeDisplayName: string;
  awayLogoUrl?: string;
  homeLogoUrl?: string;
  awayNickname: string;
  homeNickname: string;
  awayBookSpread: number;
  homeBookSpread: number;
  bookTotal: number;
  modelTotal: number;
  awayModelSpread: number;
  homeModelSpread: number;
  spreadDiff: number;
  totalDiff: number;
  computedSpreadEdge: string | null;
  computedTotalEdge: string | null;
  authSpreadEdgeIsAway: boolean | null;
  authTotalEdgeIsOver: boolean | null;
  showModel: boolean;
  mobileTab: MobileTab;
  setMobileTab: (tab: MobileTab) => void;
  isLive: boolean;
  isFinal: boolean;
  isUpcoming: boolean;
  hasScores: boolean;
  awayWins: boolean;
  homeWins: boolean;
  awayScoreFlash: boolean;
  homeScoreFlash: boolean;
  time: string;
  isAppAuthed: boolean;
  isFavorited: boolean;
  onStarClick: (e: React.MouseEvent) => void;
  activeMarket: 'spread' | 'total' | 'ml';
  setActiveMarket: (m: 'spread' | 'total' | 'ml') => void;
  isNhlGame: boolean;
  isMlbGame: boolean;
  borderColor: string;
  awayMlbAnSlug?: string | null;
  homeMlbAnSlug?: string | null;
}

export const MobileGameCard = React.memo(function MobileGameCard(props: MobileGameCardProps) {
  const {
    game,
    awayAbbr, homeAbbr,
    awayName, homeName,
    awayDisplayName, homeDisplayName,
    awayLogoUrl, homeLogoUrl,
    awayNickname, homeNickname,
    awayBookSpread, homeBookSpread,
    bookTotal, modelTotal,
    awayModelSpread, homeModelSpread,
    spreadDiff, totalDiff,
    computedSpreadEdge, computedTotalEdge,
    authSpreadEdgeIsAway, authTotalEdgeIsOver,
    showModel,
    mobileTab, setMobileTab,
    isLive, isFinal, isUpcoming,
    hasScores,
    awayWins, homeWins,
    awayScoreFlash, homeScoreFlash,
    time,
    isAppAuthed, isFavorited, onStarClick,
    activeMarket, setActiveMarket,
    isNhlGame, isMlbGame,
    borderColor,
    awayMlbAnSlug, homeMlbAnSlug,
  } = props;

// ── Structured logging: GameCard mobile full render ──────────────
if (process.env.NODE_ENV === 'development') {
  console.groupCollapsed(
    `%c[GameCard:mobile] ${awayAbbr} @ ${homeAbbr} | tab=${mobileTab} | id=${game.id}`,
    'color:#45E0A8;font-weight:700;font-size:11px'
  );
  console.log('[data] spread:', { awayBookSpread, homeBookSpread, awayModelSpread, homeModelSpread, spreadDiff });
  console.log('[data] total:', { bookTotal, modelTotal, totalDiff });
  console.log('[data] ml:', { awayML: game.awayML, homeML: game.homeML, modelAwayML: game.modelAwayML, modelHomeML: game.modelHomeML });
  console.log('[edge] spread:', computedSpreadEdge, '| total:', computedTotalEdge);
  console.log('[state] showModel:', showModel, '| mobileTab:', mobileTab, '| status:', game.gameStatus);
  console.groupEnd();
}

// ── Game clock formatter ──────────────────────────────────────
// Period notation: 1Q/2Q/3Q/4Q, 1H/2H, 1P/2P/3P (never 1st/2nd/3rd/4th)
const formatGameClock = (raw: string | null | undefined): string => {
  if (!raw) return '';
  const s = raw.trim();

  // ── Server-emitted clock strings (already transformed) ──────
  // These come pre-formatted from ncaaScoreboard.ts; pass through directly.
  if (/^END\s+1ST\s+HALF$/i.test(s)) return 'END 1ST HALF';
  if (/^END\s+2ND\s+HALF$/i.test(s)) return 'END 2ND HALF';
  if (/^1ST\s+HALF$/i.test(s)) return '1ST HALF';
  if (/^2ND\s+HALF$/i.test(s)) return '2ND HALF';
  if (/^HALFTIME$/i.test(s)) return 'HALFTIME';

  // ── NHL intermission strings (server-emitted from nhlSchedule.ts) ──
  // "1ST INT", "2ND INT" = intermission after period 1/2
  if (/^1ST\s+INT$/i.test(s)) return '1ST INT';
  if (/^2ND\s+INT$/i.test(s)) return '2ND INT';
  if (/^OT\s+INT$/i.test(s)) return 'OT INT';
  // "END 1P", "END 2P", "END 3P", "END OT" = end of period
  if (/^END\s+(\d+P|OT)$/i.test(s)) return s.toUpperCase();
  // "Final/OT", "Final/SO" — pass through
  if (/^Final\/(OT|SO)$/i.test(s)) return s;
  // "SO" = shootout
  if (/^SO$/i.test(s)) return 'SO';
  // "OT" = overtime
  if (/^OT$/i.test(s)) return 'OT';
  // NHL period labels: "1P", "2P", "3P"
  if (/^[123]P$/i.test(s)) return s.toUpperCase();

  // ── Legacy / NBA / raw NCAA labels (fallback normalization) ───────
  // Raw half labels (in case old DB rows still have these)
  if (/^1st$/i.test(s)) return '1ST HALF';
  if (/^2nd$/i.test(s)) return '2ND HALF';
  if (/^half(time)?$/i.test(s)) return 'HALFTIME';
  // Quarter labels → 1Q/2Q/3Q/4Q (NBA)
  if (/^q?1(st)?$/i.test(s)) return '1Q';
  if (/^q?2(nd)?$/i.test(s)) return '2Q';
  if (/^q?3(rd)?$/i.test(s)) return '3Q';
  if (/^q?4(th)?$/i.test(s)) return '4Q';
  // Period labels (hockey legacy) → 1P/2P/3P
  if (/^1(st)?\s+period$/i.test(s)) return '1P';
  if (/^2(nd)?\s+period$/i.test(s)) return '2P';
  if (/^3(rd)?\s+period$/i.test(s)) return '3P';
  // MM:SS clock — pass through as-is
  if (/^\d{1,2}:\d{2}$/.test(s)) return s;
  // Compound: "09:36 1ST HALF" or "14:32 1P" — normalize period label then keep clock
  // Pattern: clock-first (server format) "MM:SS LABEL"
  const clockFirst = s.match(/^(\d{1,2}:\d{2})\s+(.+)$/);
  if (clockFirst) {
    const [, mm, periodRaw] = clockFirst;
    const periodLabel = formatGameClock(periodRaw);
    // Check for zero clock
    const isZero = /^0?0:00$/.test(mm);
    if (isZero && /half/i.test(periodLabel)) {
      return `END ${periodLabel}`;
    }
    if (isZero && /^[123]P$/i.test(periodLabel)) {
      return `END ${periodLabel.toUpperCase()}`;
    }
    return `${mm} ${periodLabel}`;
  }
  // Pattern: period-first (legacy) "LABEL MM:SS"
  const compound = s.match(/^(q?\d|\d+(?:st|nd|rd|th)?(?:\s+(?:period|half))?|half(?:time)?)\s+(\d{1,2}:\d{2})$/i);
  if (compound) {
    const period = formatGameClock(compound[1]);
    return `${period} ${compound[2]}`;
  }
  return s;
};
const formattedClock = formatGameClock(game.gameClock);

   // ── Derived values for mobile odds table ─────────────────
// Spread odds in parentheses, e.g. "+1.5 (-225)" / "-1.5 (+185)"
const mbAwaySpreadOdds = game.awaySpreadOdds ?? null;
const mbHomeSpreadOdds = game.homeSpreadOdds ?? null;
const mbOverOdds  = game.overOdds ?? null;
const mbUnderOdds = game.underOdds ?? null;
const bkAwaySpreadStr  = !isNaN(awayBookSpread)
  ? (mbAwaySpreadOdds ? `${spreadSign(awayBookSpread)} (${mbAwaySpreadOdds})` : spreadSign(awayBookSpread))
  : '—';
const bkHomeSpreadStr  = !isNaN(homeBookSpread)
  ? (mbHomeSpreadOdds ? `${spreadSign(homeBookSpread)} (${mbHomeSpreadOdds})` : spreadSign(homeBookSpread))
  : '—';
const bkTotalStr       = !isNaN(bookTotal) ? String(bookTotal) : '—';
// Over/Under strings with odds, e.g. "o5.5 (-107)" / "u5.5 (-113)"
const bkOverStr  = !isNaN(bookTotal)
  ? (mbOverOdds  ? `o${bkTotalStr} (${mbOverOdds})`  : `o${bkTotalStr}`)
  : 'o—';
const bkUnderStr = !isNaN(bookTotal)
  ? (mbUnderOdds ? `u${bkTotalStr} (${mbUnderOdds})` : `u${bkTotalStr}`)
  : 'u—';
// For NHL: include puck line / spread odds and total odds in model display strings
// LOG: [GameCard:MobileOdds] trace model odds for each sport
if (process.env.NODE_ENV === 'development') {
  console.log(
    `%c[GameCard:MobileOdds] game=${game.id} sport=${game.sport} ` +
    `mdlAwaySpreadOdds=${game.modelAwaySpreadOdds ?? 'null'} mdlHomeSpreadOdds=${game.modelHomeSpreadOdds ?? 'null'} ` +
    `mdlOverOdds=${game.modelOverOdds ?? 'null'} mdlUnderOdds=${game.modelUnderOdds ?? 'null'} ` +
    `isMlbGame=${isMlbGame} isNhlGame=${isNhlGame}`,
    'color:#FFFFFF;font-size:9px'
  );
}
// ── MLB RL LABEL RULE: model RL label ALWAYS mirrors the book's run line. ──────────────────────
// NEVER use awayModelSpread/homeModelSpread as the label for MLB — it can have wrong sign
// if the model ran before the book's run line was confirmed (sign flip guard may not catch all cases).
// Priority: awayRunLine (VSiN run line, most authoritative) → awayBookSpread (DK NJ spread)
// → awayModelSpread (last resort, only for non-MLB sports).
//
// [INPUT]  game.awayRunLine = "+1.5" (VSiN) or null
// [INPUT]  awayBookSpread = 1.5 (DK NJ) or NaN
// [INPUT]  awayModelSpread = -1.5 (model, may be wrong sign) or NaN
// [OUTPUT] mlbAwayRLLabel = "+1.5" (correct book label) or null
const mlbAwayRLLabel = isMlbGame
  ? (game.awayRunLine != null && game.awayRunLine !== ''
      ? game.awayRunLine                          // VSiN run line (most authoritative)
      : !isNaN(awayBookSpread)
        ? spreadSign(awayBookSpread)              // DK NJ spread fallback
        : null)                                   // no label available
  : null;
const mlbHomeRLLabel = isMlbGame
  ? (game.homeRunLine != null && game.homeRunLine !== ''
      ? game.homeRunLine
      : !isNaN(homeBookSpread)
        ? spreadSign(homeBookSpread)
        : null)
  : null;
if (process.env.NODE_ENV === 'development' && isMlbGame) {
  console.log(
    `[MobileGameCard:MLB_RL_LABEL] game=${game.id} ${game.awayTeam}@${game.homeTeam}` +
    ` | awayRunLine=${game.awayRunLine ?? 'null'} awayBookSpread=${awayBookSpread}` +
    ` | awayModelSpread=${awayModelSpread} (NOT used as label)` +
    ` | mlbAwayRLLabel=${mlbAwayRLLabel ?? 'null'} mlbHomeRLLabel=${mlbHomeRLLabel ?? 'null'}`
  );
}
// ── hasModelData gate: mirrors DesktopGameCard logic ────────────────────────────────────────────
// CRITICAL FIX (2026-06-10): MobileGameCard was rendering stale model odds (e.g. -196 for a
// +157 ML fav) because it had no modelRunAt gate. When RL INVALIDATE fires in mlbModelRunner.ts,
// it now nulls ALL model fields atomically. This gate ensures mobile shows '—' for all model
// columns when modelRunAt=null (model invalidated or not yet run).
// [INPUT]  game.modelRunAt = null (invalidated/not run) or Date (valid run)
// [OUTPUT] hasModelData = false → all model strings render as '—'
const hasModelData = game.modelRunAt != null;
if (process.env.NODE_ENV === 'development' && isMlbGame) {
  console.log(
    `[MobileGameCard:hasModelData] ${game.awayTeam ?? '?'}@${game.homeTeam ?? '?'}` +
    ` modelRunAt=${game.modelRunAt ?? 'null'} hasModelData=${hasModelData}` +
    ` modelAwaySpreadOdds=${game.modelAwaySpreadOdds ?? 'null'} modelHomeSpreadOdds=${game.modelHomeSpreadOdds ?? 'null'}`
  );
}
const mdlAwaySpreadStr = !hasModelData ? '—' : isMlbGame
  ? (mlbAwayRLLabel && game.modelAwaySpreadOdds
      // [FIX] fmtOddsSign ensures positive MLB RL odds display with '+' prefix
      ? `${mlbAwayRLLabel} (${fmtOddsSign(game.modelAwaySpreadOdds)})`
      : mlbAwayRLLabel ?? '—')
  : (!isNaN(awayModelSpread)
      ? (isNhlGame && game.modelAwayPLOdds
          // [FIX] fmtOddsSign ensures positive PL odds (e.g. 214) display as '+214'
          ? `${spreadSign(awayModelSpread)} (${fmtOddsSign(game.modelAwayPLOdds)})`
          : spreadSign(awayModelSpread))
      : '—');
const mdlHomeSpreadStr = !hasModelData ? '—' : isMlbGame
  ? (mlbHomeRLLabel && game.modelHomeSpreadOdds
      ? `${mlbHomeRLLabel} (${fmtOddsSign(game.modelHomeSpreadOdds)})`
      : mlbHomeRLLabel ?? '—')
  : (!isNaN(homeModelSpread)
      ? (isNhlGame && game.modelHomePLOdds
          // [FIX] fmtOddsSign ensures positive PL odds (e.g. 214) display as '+214'
          ? `${spreadSign(homeModelSpread)} (${fmtOddsSign(game.modelHomePLOdds)})`
          : spreadSign(homeModelSpread))
      : '—');
// For NHL: display the BOOK's total line with the model's fair odds at that line
const mdlDisplayTotal = isNhlGame && !isNaN(bookTotal) ? bookTotal : modelTotal;
const mdlTotalStr = !isNaN(mdlDisplayTotal) ? String(mdlDisplayTotal) : '—';
// For NHL/MLB: total display strings include O/U odds at the model's line
// [FIX] fmtOddsSign ensures positive over/under odds (e.g. 115) display as '+115'
const mdlOverTotalStr  = !hasModelData ? '—' : !isNaN(mdlDisplayTotal)
  ? ((isNhlGame || isMlbGame) && game.modelOverOdds  ? `${mdlTotalStr} (${fmtOddsSign(game.modelOverOdds)})`  : mdlTotalStr)
  : '—';
const mdlUnderTotalStr = !hasModelData ? '—' : !isNaN(mdlDisplayTotal)
  ? ((isNhlGame || isMlbGame) && game.modelUnderOdds ? `${mdlTotalStr} (${fmtOddsSign(game.modelUnderOdds)})` : mdlTotalStr)
  : '—';
// ── Split helpers: parse "value (odds)" → { line, odds } for two-line pill rendering ──
// Used by mobile OddsTable to pass mainValue and juiceStr separately to OddsCell
const splitOddsStr = (s: string): { line: string; odds: string | null } => {
  const m = s.match(/^([^(]+?)\s*\(([^)]+)\)\s*$/);
  if (m) return { line: m[1].trim(), odds: m[2].trim() };
  return { line: s, odds: null };
};
const mdlAwaySplit  = splitOddsStr(mdlAwaySpreadStr);
const mdlHomeSplit  = splitOddsStr(mdlHomeSpreadStr);
const mdlOverSplit  = splitOddsStr(mdlOverTotalStr);
const mdlUnderSplit = splitOddsStr(mdlUnderTotalStr);

// ML values — always show + prefix for positive (underdog) values
// +100 displays as 'EV' (even money; -100 does not exist as a valid ML)
// LOG: [GameCard:ML] logs raw→formatted for every game in dev
const formatMl = (raw: string | number | null | undefined): string => {
  if (raw == null || raw === '' || raw === '—') return '—';
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[^\d.-]/g, ''));
  if (isNaN(n)) return String(raw);
  if (n === 100) return 'EV';   // +100 = even money
  if (n > 0) return `+${n}`;
  return String(n);
};
const bkAwayMl  = formatMl(game.awayML);
const bkHomeMl  = formatMl(game.homeML);
// hasModelData gate: show '—' for model ML when modelRunAt=null (invalidated/not run)
const mdlAwayMl = hasModelData ? formatMl(game.modelAwayML) : '—';
const mdlHomeMl = hasModelData ? formatMl(game.modelHomeML) : '—';

if (process.env.NODE_ENV === 'development') {
  console.log(
    `%c[GameCard:ML] game=${game.id} bkAway=${bkAwayMl} bkHome=${bkHomeMl} mdlAway=${mdlAwayMl} mdlHome=${mdlHomeMl}`,
    'color:#45E0A8;font-size:9px'
  );
}

   // ── Edge direction helpers ────────────────────────────────────
// AUTHORITATIVE: use props from GameCard (computed with 3-tier priority including model odds).
// authSpreadEdgeIsAway: Tier 1 = model spread odds prob comparison, Tier 2 = NHL label, Tier 3 = line arithmetic
// authTotalEdgeIsOver:  Tier 1 = model over/under odds prob comparison, Tier 2 = NHL label, Tier 3 = line comparison
// These are the single source of truth — do NOT recompute locally.
const spreadEdgeIsAway: boolean | null = authSpreadEdgeIsAway;
const totalEdgeIsOver: boolean | null  = authTotalEdgeIsOver;

// ── ML edge detection — OPTION B: independent of spread direction ──────────
//
// OPTION B RULE: ML edge exists ONLY when modelImplied(side) > bookImplied(side)
// — both RAW, no vig removal on either side.
//
// This is computed INDEPENDENTLY of spread edge direction.
// A team can have a spread edge without an ML edge and vice versa.
// The ML edge is determined purely by whether the model is more confident
// in that team winning outright than the book is.
//
// FORMULA: edgePP = (modelImplied - bookImplied) * 100
//   modelImplied(-149) = 149/249 = 59.84%
//   bookImplied(-149)  = 149/249 = 59.84%
//   edgePP = 0.00pp → NO EDGE (identical odds)
//
// THRESHOLD: ML_EDGE_THRESHOLD_PP = 0.5pp (half a percentage point)
//   This prevents noise from tiny rounding differences.
const mlImpliedProb = (ml: string | number | null | undefined): number => {
  if (ml == null || ml === '' || ml === '—') return NaN;
  const n = typeof ml === 'number' ? ml : Number(String(ml).replace(/[^\d.-]/g, ''));
  if (isNaN(n)) return NaN;
  if (n === 100) return 0.5;
  if (n > 0) return 100 / (n + 100);
  return Math.abs(n) / (Math.abs(n) + 100);
};
const bkAwayMlProb  = mlImpliedProb(game.awayML);
const mdlAwayMlProb = mlImpliedProb(game.modelAwayML);
const bkHomeMlProb  = mlImpliedProb(game.homeML);
const mdlHomeMlProb = mlImpliedProb(game.modelHomeML);
// OPTION B: edge exists when model implied > book implied (raw vs raw, same side)
// Threshold: 0.5pp minimum to filter noise
const ML_EDGE_THRESHOLD_PP = 0.005; // 0.5pp as decimal
const awayMlEdgePP = (!isNaN(bkAwayMlProb) && !isNaN(mdlAwayMlProb))
  ? (mdlAwayMlProb - bkAwayMlProb)
  : NaN;
const homeMlEdgePP = (!isNaN(bkHomeMlProb) && !isNaN(mdlHomeMlProb))
  ? (mdlHomeMlProb - bkHomeMlProb)
  : NaN;
// [FIX 2026-06-24] Gate ML edge detection on hasModelData.
// game.modelAwayML/modelHomeML hold stale values when modelRunAt=null (RL INVALIDATE).
// Without this gate, awayMlEdgeDetected/homeMlEdgeDetected can be true even when
// hasModelData=false, causing the ML column to render '—' in neon green (#39FF14).
const awayMlEdgeDetected: boolean = hasModelData && !isNaN(awayMlEdgePP) && awayMlEdgePP > ML_EDGE_THRESHOLD_PP;
const homeMlEdgeDetected: boolean = hasModelData && !isNaN(homeMlEdgePP) && homeMlEdgePP > ML_EDGE_THRESHOLD_PP;
if (process.env.NODE_ENV === 'development') {
  console.log(
    `%c[GameCard:MLEdge:OPTION_B] game=${game.id}` +
    ` | away: bkProb=${isNaN(bkAwayMlProb)?'NaN':bkAwayMlProb.toFixed(4)}` +
    ` mdlProb=${isNaN(mdlAwayMlProb)?'NaN':mdlAwayMlProb.toFixed(4)}` +
    ` edgePP=${isNaN(awayMlEdgePP)?'NaN':(awayMlEdgePP*100).toFixed(2)}pp → edge=${awayMlEdgeDetected}` +
    ` | home: bkProb=${isNaN(bkHomeMlProb)?'NaN':bkHomeMlProb.toFixed(4)}` +
    ` mdlProb=${isNaN(mdlHomeMlProb)?'NaN':mdlHomeMlProb.toFixed(4)}` +
    ` edgePP=${isNaN(homeMlEdgePP)?'NaN':(homeMlEdgePP*100).toFixed(2)}pp → edge=${homeMlEdgeDetected}`,
    'color:#45E0A8;font-size:9px'
  );
}

// ── Tab state ─────────────────────────────────────────────────────
// isDualTab: BOOK + MODEL both active simultaneously
// isBookTab / isModelTab: true when that tab is active OR dual is active
const isDualTab  = mobileTab === 'dual';
const isBookTab  = isDualTab; // MODEL PROJECTIONS tab = BOOK+MODEL both active
const isModelTab = isDualTab;

// ── Value style factories (reference image spec) ──────────────────
// The table is ALWAYS visible. Tab controls which column is "primary":
//
// BOOK tab active:
//   book  = white bold full opacity (primary)
//   model = #39FF14 bold if edge, else white 40% opacity (secondary, always visible)
//
// MODEL tab active (default / reference image):
//   book  = gray 50% opacity, unbolded (reference, always visible)
//   model = #39FF14 bold if edge, else white bold full opacity (primary)
//
// Neither tab (SPLITS/EDGE):
//   book  = gray 35% opacity, unbolded
//   model = #39FF14 if edge, else white 40% opacity, unbolded
//
// LOG: [GameCard:OddsStyle] logs active tab + edge flags in dev
if (process.env.NODE_ENV === 'development') {
  console.log(
    `%c[GameCard:OddsStyle] game=${game.id} tab=${mobileTab} spreadEdge=${spreadEdgeIsAway} totalEdge=${totalEdgeIsOver}`,
    'color:#FFFFFF;font-size:9px'
  );
}

// ── Value style factories (matches both reference images exactly) ──
//
// BOOK LINES tab active (ref image 1):
//   book  = white BOLD full opacity     (primary)
//   model = white unbolded 70% opacity  (secondary, visible)
//   model edge = #39FF14 BOLD            (edge highlight always wins)
//
// MODEL LINES tab active (ref image 2):
//   book  = white unbolded 70% opacity  (secondary, visible for reference)
//   model non-edge = light gray BOLD     (primary, not edge)
//   model edge = #39FF14 BOLD            (edge highlight always wins)
//
// SPLITS / EDGE tabs:
//   both dimmed for context
//
// LOG: [GameCard:OddsStyle] logs tab + edge state in dev
if (process.env.NODE_ENV === 'development') {
  console.log(
    `%c[GameCard:OddsStyle] game=${game.id} tab=${mobileTab} spreadEdge=${spreadEdgeIsAway} totalEdge=${totalEdgeIsOver}`,
    'color:#FFFFFF;font-size:9px'
  );
}

const bookStyle = (_isEdge?: boolean): React.CSSProperties => ({
  // unbolded book values: 10.5px; bolded book values: 10.25px (bold appears optically larger)
  fontSize: isDualTab ? '10.5px' : isBookTab ? '10.25px' : '10.5px',
  // DUAL mode: book = light gray unbolded (secondary to model primary)
  // BOOK-only: book = white bold (primary)
  // MODEL-only: book = white unbolded 70% (secondary, visible for reference)
  // SPLITS/EDGE: dimmed
  fontWeight: isDualTab ? 400 : isBookTab ? 700 : 400,
  color: isDualTab
    ? '#FFFFFF'          // DUAL: light gray unbolded
    : isBookTab
      ? '#FFFFFF'           // BOOK-only: white bold (primary)
      : isModelTab
        ? '#FFFFFF'      // MODEL-only: white unbolded (secondary)
        : '#FFFFFF',      // SPLITS/EDGE: dimmed
  letterSpacing: '0.02em',
  fontVariantNumeric: 'tabular-nums',
});

const modelStyle = (isEdge?: boolean): React.CSSProperties => {
  // ── MODEL value color/weight rules ────────────────────────────────
  // BOOK tab active:
  //   model (any)  = white unbolded 70% — secondary, visible but NOT primary
  //   edge does NOT trigger neon green when BOOK tab is active
  //
  // MODEL tab active:
  //   model edge   = #39FF14 BOLD — edge highlight (primary)
  //   model no-edge = white BOLD — primary non-edge (user request: white not gray)
  //
  // SPLITS/EDGE tabs:
  //   model (any)  = dimmed 30%
  //
  // LOG: [GameCard:modelStyle] isEdge + tab in dev
  if (process.env.NODE_ENV === 'development' && isEdge) {
    console.log(
      `%c[GameCard:modelStyle] edge=true tab=${mobileTab} → ${isModelTab ? '#39FF14 bold' : 'white 70% unbolded'}`,
      'color:#FFFFFF;font-size:9px'
    );
  }
  if (isDualTab) {
    // DUAL mode: model is primary — edge = neon green bold, non-edge = white bold
    return {
      fontSize: '10.25px',  // bolded model values: 10.25px
      fontWeight: 700,
      color: isEdge ? '#45E0A8' : '#FFFFFF',
      letterSpacing: '0.02em',
      fontVariantNumeric: 'tabular-nums',
    };
  }
  if (isBookTab) {
    // BOOK-only tab: model is always secondary — white unbolded, no edge highlight
    return {
      fontSize: '10.5px',  // unbolded model values: 10.5px
      fontWeight: 400,
      color: '#FFFFFF',
      letterSpacing: '0.02em',
      fontVariantNumeric: 'tabular-nums',
    };
  }
  if (isModelTab) {
    // MODEL-only tab: edge = neon green bold; non-edge = white bold
    return {
      fontSize: '10.25px',  // bolded model values: 10.25px
      fontWeight: 700,
      color: isEdge ? '#45E0A8' : '#FFFFFF',
      letterSpacing: '0.02em',
      fontVariantNumeric: 'tabular-nums',
    };
  }
  // SPLITS/EDGE tabs: dimmed
  return {
    fontSize: '10.5px',  // unbolded dimmed values: 10.5px
    fontWeight: 400,
    color: '#FFFFFF',
    letterSpacing: '0.02em',
    fontVariantNumeric: 'tabular-nums',
  };
};

// Per-cell edge detection
const awaySpreadIsEdge  = spreadEdgeIsAway === true;
const homeSpreadIsEdge  = spreadEdgeIsAway === false;
const overTotalIsEdge   = totalEdgeIsOver  === true;
const underTotalIsEdge  = totalEdgeIsOver  === false;
// ML edge: unified with spread direction (awayMlEdgeDetected / homeMlEdgeDetected
// are already computed above using spread-first logic with prob fallback)
const awayMlIsEdge      = awayMlEdgeDetected;
const homeMlIsEdge      = homeMlEdgeDetected;

// ── Spec-compliant edge pp calculations (juice-only math, per market) ────────
// RULE: Edge lives in the juice, not the line.
// Each market is independent — never averaged, never combined.
// Recalculate on every render (derived state, not stored state).
// ── ROI % computations (mobile) ──────────────────────────────────────────────
// FORMULA: calculateRoi(modelML, bookML, bookOppML)
//   = (modelImplied / bookNoVigProb - 1) * 100
// This is IDENTICAL to the desktop EdgeVerdict column formula.
// bookNoVigProb = bookML_implied / (bookML_implied + bookOpp_implied)
// This removes the vig from the book price before comparing to the model.
//
// AWAY spread ROI
const awaySpreadEdgePP: number = (() => {
  const bkAway  = toNum(game.awaySpreadOdds);
  const bkHome  = toNum(game.homeSpreadOdds);
  const mdlAway = isNhlGame
    ? toNum(game.modelAwayPLOdds)
    : toNum((game as unknown as Record<string, string | null>).modelAwaySpreadOdds ?? null);
  const roi = calculateRoi(mdlAway, bkAway, bkHome);
  if (process.env.NODE_ENV === 'development') {
    console.log(
      `[ROI:SPREAD:AWAY] game=${game.id} mdlAway=${mdlAway} bkAway=${bkAway} bkHome=${bkHome}` +
      ` → roi=${isNaN(roi) ? 'NaN' : roi.toFixed(2)}%`
    );
  }
  return roi;
})();
// HOME spread ROI
const homeSpreadEdgePP: number = (() => {
  const bkHome  = toNum(game.homeSpreadOdds);
  const bkAway  = toNum(game.awaySpreadOdds);
  const mdlHome = isNhlGame
    ? toNum(game.modelHomePLOdds)
    : toNum((game as unknown as Record<string, string | null>).modelHomeSpreadOdds ?? null);
  const roi = calculateRoi(mdlHome, bkHome, bkAway);
  if (process.env.NODE_ENV === 'development') {
    console.log(
      `[ROI:SPREAD:HOME] game=${game.id} mdlHome=${mdlHome} bkHome=${bkHome} bkAway=${bkAway}` +
      ` → roi=${isNaN(roi) ? 'NaN' : roi.toFixed(2)}%`
    );
  }
  return roi;
})();
// OVER total ROI
const overEdgePP: number = (() => {
  const bkOver  = toNum(game.overOdds);
  const bkUnder = toNum(game.underOdds);
  const mdlOver = toNum(game.modelOverOdds);
  const roi = calculateRoi(mdlOver, bkOver, bkUnder);
  if (process.env.NODE_ENV === 'development') {
    console.log(
      `[ROI:TOTAL:OVER] game=${game.id} mdlOver=${mdlOver} bkOver=${bkOver} bkUnder=${bkUnder}` +
      ` → roi=${isNaN(roi) ? 'NaN' : roi.toFixed(2)}%`
    );
  }
  return roi;
})();
// UNDER total ROI
const underEdgePP: number = (() => {
  const bkUnder = toNum(game.underOdds);
  const bkOver  = toNum(game.overOdds);
  const mdlUnder = toNum(game.modelUnderOdds);
  const roi = calculateRoi(mdlUnder, bkUnder, bkOver);
  if (process.env.NODE_ENV === 'development') {
    console.log(
      `[ROI:TOTAL:UNDER] game=${game.id} mdlUnder=${mdlUnder} bkUnder=${bkUnder} bkOver=${bkOver}` +
      ` → roi=${isNaN(roi) ? 'NaN' : roi.toFixed(2)}%`
    );
  }
  return roi;
})();
// AWAY ML ROI (for EDGE tab display — separate from awayMlEdgePP Option B detection above)
const awayMlRoi: number = (() => {
  const bkAway  = toNum(game.awayML);
  const bkHome  = toNum(game.homeML);
  const mdlAway = toNum(game.modelAwayML);
  const roi = calculateRoi(mdlAway, bkAway, bkHome);
  if (process.env.NODE_ENV === 'development') {
    console.log(
      `[ROI:ML:AWAY] game=${game.id} mdlAway=${mdlAway} bkAway=${bkAway} bkHome=${bkHome}` +
      ` → roi=${isNaN(roi) ? 'NaN' : roi.toFixed(2)}%`
    );
  }
  return roi;
})();
// HOME ML ROI (for EDGE tab display — separate from homeMlEdgePP Option B detection above)
const homeMlRoi: number = (() => {
  const bkHome  = toNum(game.homeML);
  const bkAway  = toNum(game.awayML);
  const mdlHome = toNum(game.modelHomeML);
  const roi = calculateRoi(mdlHome, bkHome, bkAway);
  if (process.env.NODE_ENV === 'development') {
    console.log(
      `[ROI:ML:HOME] game=${game.id} mdlHome=${mdlHome} bkHome=${bkHome} bkAway=${bkAway}` +
      ` → roi=${isNaN(roi) ? 'NaN' : roi.toFixed(2)}%`
    );
  }
  return roi;
})();
// Best spread edge (away or home, whichever is higher)
const spreadEdgePP: number = (() => {
  const a = isNaN(awaySpreadEdgePP) ? -Infinity : awaySpreadEdgePP;
  const h = isNaN(homeSpreadEdgePP) ? -Infinity : homeSpreadEdgePP;
  const best = Math.max(a, h);
  return best === -Infinity ? NaN : best;
})();
// Best total edge (over or under, whichever is higher)
const totalEdgePP: number = (() => {
  const o = isNaN(overEdgePP) ? -Infinity : overEdgePP;
  const u = isNaN(underEdgePP) ? -Infinity : underEdgePP;
  const best = Math.max(o, u);
  return best === -Infinity ? NaN : best;
})();
// Best ML ROI (away or home, whichever is higher) — used for EDGE tab display
const mlEdgePP: number = (() => {
  const a = isNaN(awayMlRoi) ? -Infinity : awayMlRoi;
  const h = isNaN(homeMlRoi) ? -Infinity : homeMlRoi;
  const best = Math.max(a, h);
  return best === -Infinity ? NaN : best;
})();
// Best edge across all 3 markets (for EdgeBadge container styling)
// OPTION B gate: only include a market's ROI in bestEdgePP if Option B confirms an edge.
// Raw ROI can be positive even when Option B says NO EDGE (see edgeUtils.ts line 171-172).
// Spread: gate by authSpreadEdgeIsAway (null = no edge)
// Total: gate by authTotalEdgeIsOver (null = no edge) — already gated in totalEdgePP via overHasEdge/underHasEdge below
// ML: gate by awayMlEdgeDetected/homeMlEdgeDetected
const gatedSpreadEdgePP: number = (() => {
  if (spreadEdgeIsAway === true)  return isNaN(awaySpreadEdgePP) ? NaN : awaySpreadEdgePP;
  if (spreadEdgeIsAway === false) return isNaN(homeSpreadEdgePP) ? NaN : homeSpreadEdgePP;
  return NaN;  // null = no Option B edge
})();
const gatedTotalEdgePP: number = (() => {
  if (totalEdgeIsOver === true)  return isNaN(overEdgePP)  ? NaN : overEdgePP;
  if (totalEdgeIsOver === false) return isNaN(underEdgePP) ? NaN : underEdgePP;
  return NaN;  // null = no Option B edge
})();
const gatedMlEdgePP: number = (() => {
  if (awayMlEdgeDetected) return isNaN(awayMlRoi) ? NaN : awayMlRoi;
  if (homeMlEdgeDetected) return isNaN(homeMlRoi) ? NaN : homeMlRoi;
  return NaN;  // no Option B edge
})();
const bestEdgePP: number = (() => {
  const vals = [gatedSpreadEdgePP, gatedTotalEdgePP, gatedMlEdgePP].filter(v => !isNaN(v));
  return vals.length > 0 ? Math.max(...vals) : NaN;
})();
if (process.env.NODE_ENV === 'development') {
  console.log(
    `%c[GameCard:EdgePP] game=${game.id}` +
    ` spr=${isNaN(spreadEdgePP)?'NaN':spreadEdgePP.toFixed(2)}pp` +
    ` (away=${isNaN(awaySpreadEdgePP)?'NaN':awaySpreadEdgePP.toFixed(2)} home=${isNaN(homeSpreadEdgePP)?'NaN':homeSpreadEdgePP.toFixed(2)})` +
    ` | tot=${isNaN(totalEdgePP)?'NaN':totalEdgePP.toFixed(2)}pp` +
    ` (over=${isNaN(overEdgePP)?'NaN':overEdgePP.toFixed(2)} under=${isNaN(underEdgePP)?'NaN':underEdgePP.toFixed(2)})` +
    ` | ml=${isNaN(mlEdgePP)?'NaN':mlEdgePP.toFixed(2)}pp` +
    ` (awayRoi=${isNaN(awayMlRoi)?'NaN':awayMlRoi.toFixed(2)} homeRoi=${isNaN(homeMlRoi)?'NaN':homeMlRoi.toFixed(2)})` +
    ` (awayEdgePP=${isNaN(awayMlEdgePP)?'NaN':(awayMlEdgePP*100).toFixed(2)} homeEdgePP=${isNaN(homeMlEdgePP)?'NaN':(homeMlEdgePP*100).toFixed(2)})` +
    ` | best=${isNaN(bestEdgePP)?'NaN':bestEdgePP.toFixed(2)}pp → ${getVerdict(bestEdgePP)}`,
    'color:#45E0A8;font-size:9px'
  );
}

// ── Tab bar config ────────────────────────────────────────────────
// Only 2 tabs: MODEL PROJECTIONS (dual) and BETTING SPLITS (splits)
const TABS: { id: MobileTab; label: string }[] = [
  { id: 'dual',   label: 'MODEL PROJECTIONS' },
  { id: 'splits', label: 'BETTING SPLITS' },
];

// ── Shared odds table (used by both BOOK and MODEL tabs) ──────────
// ── Mobile market card helpers ─────────────────────────────────────────
// Spec: flat 2-column grid inside each card. No circles.
// BOOK and MODEL side-by-side. Line on top (9px dim), juice below (14px bold).
// MODEL juice is neon green ONLY when that side has an edge (edgePP >= 1.5).
// Both white when no edge. All 3 market columns are flex-1 (equal width).
// ML card has an empty spacer row above the juice to align height with SPREAD/TOTAL.
const MktCard = ({
  awayBookLine, awayBookJuice,
  awayModelLine, awayModelJuice, awayModelHasEdge,
  homeBookLine, homeBookJuice,
  homeModelLine, homeModelJuice, homeModelHasEdge,
  isML = false,
  roiEdgePP,
  roiLabel,
}: {
  awayBookLine: string; awayBookJuice: string;
  awayModelLine: string; awayModelJuice: string; awayModelHasEdge: boolean;
  homeBookLine: string; homeBookJuice: string;
  homeModelLine: string; homeModelJuice: string; homeModelHasEdge: boolean;
  isML?: boolean;
  roiEdgePP?: number;   // best edge pp for this market (used for ROI footer)
  roiLabel?: string;    // label for the best edge side, e.g. "CGY +1.5", "U5.5"
}) => {
  // SubCol: line row (dim 9px) + juice row (bold 14px)
  // modelJuiceColor: neon green only when this side has an edge, otherwise white
  const SubCol = ({ line, juice, isBook, hasEdge }: { line: string; juice: string; isBook: boolean; hasEdge: boolean }) => {
    const juiceColor = isBook
      ? '#FFFFFF'                      // BOOK: always white
      : hasEdge ? '#45E0A8' : '#FFFFFF'; // MODEL: neon if edge, white if not
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px', minWidth: 0, flex: 1 }}>
        {/* Spacer/line row: always rendered to keep height consistent */}
        {isML
          ? <span style={{ fontSize: '11px', lineHeight: 1, visibility: 'hidden' }}>&nbsp;</span>  // empty spacer for ML
          : <span style={{ fontSize: 'clamp(9px, 2.8vw, 11px)', fontWeight: 400, color: '#FFFFFF', lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{line}</span>
        }
        {/* juice: clamp(11px, 3.5vw, 14px) — scales down on narrow screens (e.g. 360px → 12.6px) so -179 never overflows MktCard */}
        <span style={{ fontSize: 'clamp(11px, 3.5vw, 14px)', fontWeight: 700, color: juiceColor, lineHeight: 1.15, whiteSpace: 'nowrap', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{juice}</span>
      </div>
    );
  };

  const TeamRow = ({ bookLine, bookJuice, modelLine, modelJuice, modelHasEdge }: { bookLine: string; bookJuice: string; modelLine: string; modelJuice: string; modelHasEdge: boolean }) => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px', padding: '4px 3px' }}>
      <SubCol line={bookLine} juice={bookJuice} isBook={true} hasEdge={false} />
      <SubCol line={modelLine} juice={modelJuice} isBook={false} hasEdge={modelHasEdge} />
    </div>
  );

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      background: '#000000', borderRadius: '10px',
      overflow: 'hidden', flex: '1 1 0', minWidth: 0,
    }}>
      {/* BOOK / MODEL header */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid #FFFFFF', padding: '3px 4px 2px' }}>
        <span style={{ fontSize: '6.5px', fontWeight: 700, color: '#FFFFFF', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.05em' }}>BOOK</span>
        <span style={{ fontSize: '6.5px', fontWeight: 700, color: '#FFFFFF', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.05em' }}>MODEL</span>
      </div>
      {/* Away row */}
      <TeamRow bookLine={awayBookLine} bookJuice={awayBookJuice} modelLine={awayModelLine} modelJuice={awayModelJuice} modelHasEdge={awayModelHasEdge} />
      {/* Divider */}
      <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '0 4px' }} />
      {/* Home row */}
      <TeamRow bookLine={homeBookLine} bookJuice={homeBookJuice} modelLine={homeModelLine} modelJuice={homeModelJuice} modelHasEdge={homeModelHasEdge} />
      {/* ROI footer — edge side label + ROI% in neon green, or NO EDGE in gray */}
      {(() => {
        const pp = roiEdgePP ?? NaN;
        const hasEdge = !isNaN(pp) && pp >= 1.5;
        // formatRoi handles sign correctly: +15.71% ROI, -2.10% ROI
        const roiStr = hasEdge ? formatRoi(pp) : 'NO EDGE';
        const roiColor = hasEdge ? getEdgeColor(pp) : 'rgba(200,200,200,0.45)';
        const label = hasEdge && roiLabel ? roiLabel : '';
        return (
          <div style={{
            borderTop: '1px solid rgba(255,255,255,0.07)',
            padding: '3px 4px 3px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1px',
            background: hasEdge ? 'rgba(57,255,20,0.04)' : 'transparent',
          }}>
            {label ? (
              <span style={{ fontSize: '7px', fontWeight: 700, color: roiColor, textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', textAlign: 'center' }}>{label}</span>
            ) : null}
            <span style={{ fontSize: '7.5px', fontWeight: hasEdge ? 800 : 400, color: roiColor, letterSpacing: '0.03em', lineHeight: 1, whiteSpace: 'nowrap', textAlign: 'center' }}>{roiStr}</span>
          </div>
        );
      })()}
    </div>
  );
};

const OddsTable = () => (
  <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'stretch', width: '100%', padding: '4px 6px 4px', gap: '4px' }}>
    {/* Market cards row: SPREAD | TOTAL | ML — all flex-1 equal width, ROI footer inside each card */}
    {/* SPREAD card — edge flags drive MODEL juice color; ROI footer shows best-side edge */}
    {(() => {
      // OPTION B gate: only show ROI and neon green when authSpreadEdgeIsAway confirms the edge.
      // awaySpreadEdgePP/homeSpreadEdgePP (ROI%) can be positive even when Option B says NO EDGE
      // (e.g. CHC -1.5 book=+158 model=+165: ROI=+1.87% but modelImplied 37.74% < bookImplied 38.67%).
      // The authoritative edge flag is authSpreadEdgeIsAway (null=no edge, true=away, false=home).
      // This mirrors the TOTAL card pattern exactly.
      const awayHasEdge = spreadEdgeIsAway === true;   // authSpreadEdgeIsAway === true
      const homeHasEdge = spreadEdgeIsAway === false;  // authSpreadEdgeIsAway === false
      // ROI pp: only use the confirmed edge side's ROI; NaN if no edge
      const spreadRoiPP = awayHasEdge
        ? (isNaN(awaySpreadEdgePP) ? NaN : awaySpreadEdgePP)
        : homeHasEdge
          ? (isNaN(homeSpreadEdgePP) ? NaN : homeSpreadEdgePP)
          : NaN;  // no edge on either side — Option B blocked
      // Label: use the confirmed edge side's team + line
      const spreadRoiLabel = (() => {
        if (!awayHasEdge && !homeHasEdge) return '';
        const isAway = awayHasEdge;
        const abbr = isAway ? awayAbbr : homeAbbr;
        const line = isAway
          ? (!isNaN(awayBookSpread) ? spreadSign(awayBookSpread) : '')
          : (!isNaN(homeBookSpread) ? spreadSign(homeBookSpread) : '');
        return line ? `${abbr} ${line}` : abbr;
      })();
      if (process.env.NODE_ENV === 'development') {
        console.log(
          `[SpreadCard] game=${game.id} authSpreadEdgeIsAway=${authSpreadEdgeIsAway}` +
          ` awayHasEdge=${awayHasEdge} homeHasEdge=${homeHasEdge}` +
          ` awaySpreadEdgePP=${isNaN(awaySpreadEdgePP)?'NaN':awaySpreadEdgePP.toFixed(2)}` +
          ` homeSpreadEdgePP=${isNaN(homeSpreadEdgePP)?'NaN':homeSpreadEdgePP.toFixed(2)}` +
          ` spreadRoiPP=${isNaN(spreadRoiPP)?'NaN':spreadRoiPP.toFixed(2)}` +
          ` label=${spreadRoiLabel}`
        );
      }
      return (
        <MktCard
          awayBookLine={!isNaN(awayBookSpread) ? spreadSign(awayBookSpread) : '—'}
          awayBookJuice={mbAwaySpreadOdds ? String(mbAwaySpreadOdds) : '—110'}
          awayModelLine={mdlAwaySplit.line || '—'}
          awayModelJuice={mdlAwaySplit.odds || '—'}
          awayModelHasEdge={awayHasEdge}   // Option B gate — NOT raw ROI > 0
          homeBookLine={!isNaN(homeBookSpread) ? spreadSign(homeBookSpread) : '—'}
          homeBookJuice={mbHomeSpreadOdds ? String(mbHomeSpreadOdds) : '—110'}
          homeModelLine={mdlHomeSplit.line || '—'}
          homeModelJuice={mdlHomeSplit.odds || '—'}
          homeModelHasEdge={homeHasEdge}   // Option B gate — NOT raw ROI > 0
          roiEdgePP={spreadRoiPP}
          roiLabel={spreadRoiLabel}
        />
      );
    })()}
    {/* TOTAL card */}
    {(() => {
      // Total: best edge side label (e.g. "O5.5" or "U5.5")
      // OPTION B gate: only show ROI and neon green when authTotalEdgeIsOver confirms the edge.
      // overEdgePP/underEdgePP (ROI%) can be positive even when Option B says NO EDGE
      // (e.g. u7.5 book=-122 model=-116: ROI=+1.90% but modelImplied 53.70% < bookImplied 54.95%).
      // The authoritative edge flag is authTotalEdgeIsOver (null=no edge, true=over, false=under).
      const overHasEdge  = overTotalIsEdge;   // authTotalEdgeIsOver === true
      const underHasEdge = underTotalIsEdge;  // authTotalEdgeIsOver === false
      const totalRoiPP = overHasEdge
        ? (isNaN(overEdgePP) ? NaN : overEdgePP)
        : underHasEdge
          ? (isNaN(underEdgePP) ? NaN : underEdgePP)
          : NaN;  // no edge on either side
      const totalRoiLabel = (() => {
        const prefix = overHasEdge ? 'O' : 'U';
        return !isNaN(bookTotal) ? `${prefix}${bkTotalStr}` : prefix;
      })();
      if (process.env.NODE_ENV === 'development') {
        console.log(
          `[TotalCard] game=${game.id} authTotalEdgeIsOver=${authTotalEdgeIsOver}` +
          ` overHasEdge=${overHasEdge} underHasEdge=${underHasEdge}` +
          ` overEdgePP=${isNaN(overEdgePP)?'NaN':overEdgePP.toFixed(2)}` +
          ` underEdgePP=${isNaN(underEdgePP)?'NaN':underEdgePP.toFixed(2)}` +
          ` totalRoiPP=${isNaN(totalRoiPP)?'NaN':totalRoiPP.toFixed(2)}` +
          ` label=${totalRoiLabel}`
        );
      }
      return (
        <MktCard
          awayBookLine={!isNaN(bookTotal) ? `o${bkTotalStr}` : 'o—'}
          awayBookJuice={mbOverOdds ? String(mbOverOdds) : '—110'}
          awayModelLine={`o${mdlOverSplit.line || '—'}`}
          awayModelJuice={mdlOverSplit.odds || '—'}
          awayModelHasEdge={overHasEdge}   // Option B gate
          homeBookLine={!isNaN(bookTotal) ? `u${bkTotalStr}` : 'u—'}
          homeBookJuice={mbUnderOdds ? String(mbUnderOdds) : '—110'}
          homeModelLine={`u${mdlUnderSplit.line || '—'}`}
          homeModelJuice={mdlUnderSplit.odds || '—'}
          homeModelHasEdge={underHasEdge}  // Option B gate
          roiEdgePP={totalRoiPP}
          roiLabel={totalRoiLabel}
        />
      );
    })()}
    {/* ML card — juice IS the value; empty spacer row keeps height aligned */}
    {(() => {
      // OPTION B gate: only show ROI and neon green when awayMlEdgeDetected/homeMlEdgeDetected confirms the edge.
      // awayMlRoi/homeMlRoi (ROI%) can be positive even when Option B says NO EDGE.
      // The authoritative edge flags are awayMlEdgeDetected/homeMlEdgeDetected (Option B).
      // This mirrors the TOTAL card pattern exactly.
      const mlRoiPP = awayMlEdgeDetected
        ? (isNaN(awayMlRoi) ? NaN : awayMlRoi)
        : homeMlEdgeDetected
          ? (isNaN(homeMlRoi) ? NaN : homeMlRoi)
          : NaN;  // no edge on either side — Option B blocked
      const mlRoiLabel = (() => {
        if (!awayMlEdgeDetected && !homeMlEdgeDetected) return '';
        const isAway = awayMlEdgeDetected;
        return `${isAway ? awayAbbr : homeAbbr} ML`;
      })();
      if (process.env.NODE_ENV === 'development') {
        console.log(
          `[MlCard] game=${game.id} awayMlEdgeDetected=${awayMlEdgeDetected} homeMlEdgeDetected=${homeMlEdgeDetected}` +
          ` awayMlRoi=${isNaN(awayMlRoi)?'NaN':awayMlRoi.toFixed(2)}` +
          ` homeMlRoi=${isNaN(homeMlRoi)?'NaN':homeMlRoi.toFixed(2)}` +
          ` mlRoiPP=${isNaN(mlRoiPP)?'NaN':mlRoiPP.toFixed(2)}` +
          ` label=${mlRoiLabel}`
        );
      }
      return (
        <MktCard
          awayBookLine={''}
          awayBookJuice={bkAwayMl || '—'}
          awayModelLine={''}
          awayModelJuice={mdlAwayMl || '—'}
          awayModelHasEdge={awayMlEdgeDetected}  // Option B gate
          homeBookLine={''}
          homeBookJuice={bkHomeMl || '—'}
          homeModelLine={''}
          homeModelJuice={mdlHomeMl || '—'}
          homeModelHasEdge={homeMlEdgeDetected}  // Option B gate
          isML={true}
          roiEdgePP={mlRoiPP}
          roiLabel={mlRoiLabel}
        />
      );
    })()}
  </div>
);

return (
  <div style={{ display: 'flex', flexDirection: 'column', width: '100%', minHeight: 0 }}>

    {/* ── TWO-COLUMN TEAM GRID: frozen left + scrollable right ─────── */}
    {/* Status row (star/LIVE/FINAL/time) is inside the frozen left panel, ABOVE the away team row */}
    {/* LEFT PANEL WIDTH: clamp(96px, 24.4vw, 108px)
         Budget: 6px paddingL + 28px logo + 4px gap + [abbr flex:1] + 22px score_slot + 2px paddingR = 62px fixed
         At 360px: panel=96px → abbr=34px ✓  |  At 390px: panel=96px → abbr=34px ✓
         At 430px: panel=104.9px → abbr=42.9px ✓  |  360px floor guarantees 34px for WSH/NYM (~28px actual)
         Score slot 22px: handles double-digit ("12" at 11px tabular = ~15px) with 7px margin
         CRITICAL: abbr span has NO overflow:hidden — panel container clips at boundary instead */}
    <div style={{ display: 'grid', gridTemplateColumns: 'clamp(96px, 24.4vw, 108px) 1fr', width: '100%', minHeight: 0 }}>

    {/* ── FROZEN LEFT PANEL: status row + team rows ── */}
    {/* overflow:hidden is CRITICAL: prevents LIVE clock text (e.g. "LIVE TOP 4TH") from
         bleeding into the right odds panel. The left panel is clamp(72px,20.4vw,88px) wide;
         without clipping, nowrap text can paint past the panel boundary onto BOOK/MODEL headers. */}
    <div style={{
      gridColumn: '1',
      borderRight: '1px solid hsl(var(--border) / 0.5)',
      background: 'hsl(var(--card))',
      zIndex: 2,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'stretch',
      padding: '0 6px',
      gap: 0,
      alignSelf: 'stretch',
      overflow: 'hidden',  // clip any text that overflows the left panel boundary
    }}>

      {/* Status row: star + LIVE/FINAL/time
           LAYOUT: column flex so LIVE and inning/clock stack vertically.
           - Line 1: star icon + "•LIVE" badge (or FINAL pill, or game time)
           - Line 2 (live only): inning/clock text (e.g. "TOP 4TH", "BOT 2ND")
           This two-line approach ensures neither LIVE nor the clock is ever clipped.
           overflow:hidden on the parent panel clips any content that still exceeds the panel width. */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        paddingLeft: '2px',
        paddingTop: '3px',
        paddingBottom: '3px',
        gap: '1px',
        borderBottom: '1px solid rgba(255,255,255,0.10)',
        minWidth: 0,
        width: '100%',
      }}>
        {/* Line 1: star + status badge */}
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '2px', minWidth: 0, width: '100%' }}>
          {isAppAuthed && (
            <button type="button" onClick={onStarClick}
              aria-label={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px 1px', lineHeight: 1, flexShrink: 0, display: 'flex', alignItems: 'center', color: isFavorited ? '#FFD700' : 'rgba(255,255,255,0.65)', filter: isFavorited ? 'drop-shadow(0 0 4px #FFD700)' : 'none', transition: 'color 0.15s' }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill={isFavorited ? '#FFD700' : 'none'} stroke={isFavorited ? '#FFD700' : 'rgba(255,255,255,0.85)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </button>
          )}
          {isLive ? (
            // "•LIVE" badge — just the dot + LIVE text, no clock here
            <span className="flex items-center gap-0.5 font-black tracking-widest uppercase" style={{ color: '#39FF14', fontSize: '10px', whiteSpace: 'nowrap', flexShrink: 0 }}>
              <span className="w-1.5 h-1.5 rounded-full animate-pulse inline-block" style={{ background: '#39FF14', flexShrink: 0 }} />
              <span>LIVE</span>
            </span>
          ) : isFinal ? (
            <span className="font-bold tracking-wide" style={{ fontSize: '8px', color: '#39FF14', background: 'rgba(255,255,255,0.12)', borderRadius: '999px', padding: '1px 6px', whiteSpace: 'nowrap', letterSpacing: '0.06em' }}>FINAL</span>
          ) : (
            <span style={{ fontSize: '10px', fontWeight: 400, color: 'hsl(var(--foreground))', whiteSpace: 'nowrap' }}>{time}</span>
          )}
        </div>
        {/* Line 2 (live only): inning/clock text — full width, never clipped */}
        {isLive && formattedClock && (
          <span style={{
            fontSize: '9px',
            fontWeight: 600,
            color: 'rgba(255,255,255,0.85)',
            letterSpacing: '0.04em',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
            lineHeight: 1,
            paddingLeft: isAppAuthed ? '14px' : '0px', // indent to align under LIVE text (past star icon)
          }}>{formattedClock}</span>
        )}
      </div>

            {/* Away row: logo (28px) + abbr + score
           ROOT CAUSE FIX v2: Two-part fix.
           PART 1: Score slot is ALWAYS reserved (minWidth:22px, flexShrink:0) regardless of game state.
             Previously conditionally rendered — abbr grabbed all space, score had nowhere to go.
             Now: visibility:hidden when no score keeps the slot but shows nothing.
             22px handles double-digit scores ("12" at 11px tabular-nums = ~15px) with 7px margin.
           PART 2: overflow:hidden REMOVED from abbr span.
             overflow:hidden was clipping WSH→WS, NYM→NY, MIA→MI/ on iOS Safari.
             iOS San Francisco font renders ~10% wider than estimates — abbr needs ~28px actual.
             Panel budget on 390px phone: panel=96px
               6px paddingL + 28px logo + 4px gap + [abbr flex:1] + 22px score_slot + 2px paddingR = 62px fixed
               abbr gets 96-62 = 34px → clear of 28px worst-case (WSH/NYM/HOU/OAK) ✓
             The left panel container (overflow:hidden) is the correct clip boundary — not the abbr span. */}
      <div style={{ display: 'flex', alignItems: 'center', flex: '1 1 0', minHeight: '44px', gap: '4px', paddingLeft: '2px', paddingRight: '2px' }}>
        {/* Logo: 28px fixed — flexShrink:0 so logo never collapses */}
        <div style={{ flexShrink: 0, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <TeamLogo slug={game.awayTeam} name={awayName} logoUrl={awayLogoUrl} size={28} />
        </div>
        {/* Abbreviation — flex:1 fills remaining space; NO overflow:hidden (panel container clips instead)
             minWidth:0 allows flex shrink but abbr has 34px available on 360px phone — no shrink needed */}
        <span style={{ flex: '1 1 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.95)', whiteSpace: 'nowrap', letterSpacing: '0.05em', minWidth: 0 }}>
          {awayAbbr}
        </span>
        {/* Score slot — ALWAYS rendered with fixed minWidth:22px to permanently reserve space.
             22px handles double-digit scores ("12" at 11px tabular-nums ≈ 15px) with 7px margin.
             visibility:hidden when not live/final keeps the slot but shows nothing.
             This is the ONLY bulletproof pattern: hold the space unconditionally. */}
        <span
          className="tabular-nums transition-colors duration-300"
          style={{
            flexShrink: 0,
            minWidth: '22px',
            textAlign: 'right',
            fontSize: 'clamp(11px, 3.2vw, 13px)',
            lineHeight: 1,
            fontWeight: awayScoreFlash ? 900 : awayWins ? 700 : 600,
            color: awayScoreFlash ? '#39FF14' : awayWins ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))',
            textShadow: awayScoreFlash ? '0 0 10px rgba(57,255,20,0.7)' : 'none',
            visibility: (isLive || isFinal) && hasScores ? 'visible' : 'hidden',
          }}
        >
          {game.awayScore ?? '0'}
        </span>
      </div>
      {/* Divider */}
      <div style={{ height: 1, background: 'hsl(var(--border) / 0.4)' }} />
      {/* Home row: same bulletproof always-reserved score slot pattern as away row */}
      <div style={{ display: 'flex', alignItems: 'center', flex: '1 1 0', minHeight: '44px', gap: '4px', paddingLeft: '2px', paddingRight: '2px' }}>
        {/* Logo: 28px fixed — flexShrink:0 so logo never collapses */}
        <div style={{ flexShrink: 0, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <TeamLogo slug={game.homeTeam} name={homeName} logoUrl={homeLogoUrl} size={28} />
        </div>
        {/* Abbreviation — flex:1 fills remaining space; NO overflow:hidden (panel container clips instead)
             minWidth:0 allows flex shrink but abbr has 34px available on 360px phone — no shrink needed */}
        <span style={{ flex: '1 1 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.95)', whiteSpace: 'nowrap', letterSpacing: '0.05em', minWidth: 0 }}>
          {homeAbbr}
        </span>
        {/* Score slot — ALWAYS rendered with fixed minWidth:22px to permanently reserve space.
             22px handles double-digit scores ("12" at 11px tabular-nums ≈ 15px) with 7px margin.
             visibility:hidden when not live/final keeps the slot but shows nothing.
             This is the ONLY bulletproof pattern: hold the space unconditionally. */}
        <span
          className="tabular-nums transition-colors duration-300"
          style={{
            flexShrink: 0,
            minWidth: '22px',
            textAlign: 'right',
            fontSize: 'clamp(11px, 3.2vw, 13px)',
            lineHeight: 1,
            fontWeight: homeScoreFlash ? 900 : homeWins ? 700 : 600,
            color: homeScoreFlash ? '#39FF14' : homeWins ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))',
            textShadow: homeScoreFlash ? '0 0 10px rgba(57,255,20,0.7)' : 'none',
            visibility: (isLive || isFinal) && hasScores ? 'visible' : 'hidden',
          }}
        >
          {game.homeScore ?? '0'}
        </span>
      </div>
    </div>

    {/* ── RIGHT PANEL: content only (tab bar moved to full-width header) ── */}
    <div style={{ gridColumn: '2', display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

      {/* ── OddsTable: visible only when MODEL PROJECTIONS (dual) tab is active ── */}
      {mobileTab === 'dual' && (
        <OddsTable />
      )}

      {/* ── SPLITS tab (additional content below OddsTable) ──────── */}
      {mobileTab === 'splits' && (
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <BettingSplitsPanel
            gameId={game.id}
            game={game}
            awayLabel={awayName}
            homeLabel={homeName}
            awayNickname={awayNickname}
            homeNickname={homeNickname}
            onMarketChange={setActiveMarket}
          />
        </div>
      )}

    </div>
    </div>
  </div>
);

}, (prevProps, nextProps) => {
  // Custom comparison: only re-render if game data, scores, or tab changed
  return (
    prevProps.game.awayScore === nextProps.game.awayScore &&
    prevProps.game.homeScore === nextProps.game.homeScore &&
    prevProps.game.gameStatus === nextProps.game.gameStatus &&
    prevProps.game.gameClock === nextProps.game.gameClock &&
    prevProps.mobileTab === nextProps.mobileTab &&
    prevProps.showModel === nextProps.showModel &&
    prevProps.isFavorited === nextProps.isFavorited &&
    prevProps.authSpreadEdgeIsAway === nextProps.authSpreadEdgeIsAway &&
    prevProps.authTotalEdgeIsOver === nextProps.authTotalEdgeIsOver &&
    prevProps.computedSpreadEdge === nextProps.computedSpreadEdge &&
    prevProps.computedTotalEdge === nextProps.computedTotalEdge &&
    prevProps.awayScoreFlash === nextProps.awayScoreFlash &&
    prevProps.homeScoreFlash === nextProps.homeScoreFlash &&
    prevProps.borderColor === nextProps.borderColor
  );
});
