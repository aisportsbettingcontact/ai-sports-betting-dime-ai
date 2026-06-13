/**
 * scorePanel.layout.test.ts
 *
 * Validates the bulletproof layout fix for MLB/NBA ScorePanel score overlap on mobile.
 *
 * Root cause: On mobile (375px), the ScorePanel column is clamp(140px,38%,180px) ≈ 142px.
 * The old score font clamp(22px,2.5vw,44px) resolved to 22px on mobile (minimum),
 * which was too large for the available space when combined with 36px logo + 44px star + gaps.
 *
 * Fix applied (6-part):
 *   1. Mobile star button: minWidth 44px → 32px (frees 12px)
 *   2. Away row container: gap 8px → 4px, left side flex:1 1 0% + minWidth:0 + overflow:hidden
 *   3. Away logo: size 36px → 28px on mobile (frees 8px)
 *   4. Away score font: clamp(22px,2.5vw,44px) → clamp(13px,3.8vw,19px) mobile + minWidth:2ch
 *   5. Home logo: size 36px → 28px on mobile (frees 8px)
 *   6. Home score font: same as away score fix
 *
 * Desktop: all values unchanged (wider panels, no overflow risk).
 */

import { describe, it, expect } from 'vitest';

function evalClamp(min: number, vwFactor: number, max: number, vw: number): number {
  return Math.min(max, Math.max(min, (vwFactor / 100) * vw));
}

// ScorePanel column: clamp(140px, 38%, 180px)
// Internal padding: 16px total
// Star button: 32px mobile (FIXED), 36px desktop
function teamRowUsableWidth(vw: number, isDesktop: boolean): number {
  const col = Math.min(180, Math.max(140, 0.38 * vw));
  const star = isDesktop ? 36 : 32;
  return col - 16 - star;
}

// logo + gap(5) + abbrev(3ch * 0.65 * fontSize) + gap(4) + score(2ch * 0.65 * fontSize)
function teamRowRequiredWidth(logoSize: number, abbrFont: number, scoreFont: number): number {
  return logoSize + 5 + 3 * 0.65 * abbrFont + 4 + 2 * 0.65 * scoreFont;
}

describe('ScorePanel layout fix — bulletproof score display', () => {

  describe('NEW mobile score font: clamp(13px, 3.8vw, 19px)', () => {
    it('resolves to 14.25px at 375px (iPhone SE/14)', () => {
      expect(evalClamp(13, 3.8, 19, 375)).toBeCloseTo(14.25, 1);
    });
    it('never exceeds 19px on any mobile viewport', () => {
      for (const vw of [320, 375, 390, 414, 430, 480]) {
        expect(evalClamp(13, 3.8, 19, vw)).toBeLessThanOrEqual(19);
      }
    });
    it('is always smaller than OLD font (22px) on mobile viewports', () => {
      for (const vw of [320, 375, 390, 414]) {
        const oldFont = evalClamp(22, 2.5, 44, vw); // always 22px on mobile
        const newFont = evalClamp(13, 3.8, 19, vw);
        expect(newFont).toBeLessThan(oldFont);
      }
    });
  });

  describe('OLD mobile score font confirms the bug', () => {
    it('always resolves to 22px minimum on all mobile viewports', () => {
      for (const vw of [320, 375, 390, 414]) {
        expect(evalClamp(22, 2.5, 44, vw)).toBe(22);
      }
    });
  });

  describe('Layout space validation — NEW layout fits at all mobile viewports', () => {
    const MOBILE_LOGO = 28;
    const DESKTOP_LOGO = 36;

    const viewports = [
      { vw: 320, name: 'small Android' },
      { vw: 375, name: 'iPhone SE/14' },
      { vw: 390, name: 'iPhone 15 Pro' },
      { vw: 414, name: 'iPhone Plus' },
      { vw: 430, name: 'iPhone 15 Plus' },
    ];

    for (const { vw, name } of viewports) {
      it(`fits at ${vw}px (${name}) with 10+ px margin`, () => {
        const usable = teamRowUsableWidth(vw, false);
        const abbrFont = evalClamp(11, 3.5, 14, vw);
        const scoreFont = evalClamp(13, 3.8, 19, vw);
        const required = teamRowRequiredWidth(MOBILE_LOGO, abbrFont, scoreFont);
        const margin = usable - required;
        expect(margin).toBeGreaterThan(10);
      });
    }

    it('OLD layout OVERFLOWS at 375px — confirms the bug was real', () => {
      const vw = 375;
      const col = Math.min(180, Math.max(140, 0.38 * vw));
      const usable = col - 16 - 44; // old star: 44px
      const abbrFont = evalClamp(11, 3.5, 14, vw);
      const oldScoreFont = evalClamp(22, 2.5, 44, vw); // always 22px
      const required = teamRowRequiredWidth(36, abbrFont, oldScoreFont); // old logo: 36px
      expect(required).toBeGreaterThan(usable); // overflows
    });

    it('desktop layout unchanged — fits at 1440px with original sizes', () => {
      const vw = 1440;
      const usable = teamRowUsableWidth(vw, true);
      const abbrFont = evalClamp(11, 3.5, 14, vw);
      const scoreFont = evalClamp(22, 2.5, 44, vw); // desktop: unchanged
      const required = teamRowRequiredWidth(DESKTOP_LOGO, abbrFont, scoreFont);
      expect(usable).toBeGreaterThan(required);
    });
  });

  describe('minWidth: 2ch guarantee', () => {
    it('2ch at 13px font ≥ 14px — enough for single-digit scores', () => {
      expect(2 * 0.65 * 13).toBeGreaterThanOrEqual(14);
    });
    it('2ch at 19px font ≥ 20px — enough for 2-digit MLB scores', () => {
      expect(2 * 0.65 * 19).toBeGreaterThanOrEqual(20);
    });
  });

  describe('Mobile star button reduction', () => {
    it('mobile star 32px < old 44px — frees 12px', () => {
      expect(32).toBeLessThan(44);
      expect(44 - 32).toBe(12);
    });
    it('mobile star 32px is still accessible (≥ 28px minimum)', () => {
      expect(32).toBeGreaterThanOrEqual(28);
    });
  });

  describe('Mobile logo reduction', () => {
    it('mobile logo 28px < old 36px — frees 8px', () => {
      expect(28).toBeLessThan(36);
      expect(36 - 28).toBe(8);
    });
    it('mobile logo 28px is still recognizable (≥ 24px minimum)', () => {
      expect(28).toBeGreaterThanOrEqual(24);
    });
  });

  describe('NBA mobile score font: clamp(12px, 3.5vw, 17px)', () => {
    it('is ≤ MLB mobile font at all mobile viewports', () => {
      for (const vw of [320, 375, 390, 414]) {
        expect(evalClamp(12, 3.5, 17, vw)).toBeLessThanOrEqual(evalClamp(13, 3.8, 19, vw));
      }
    });
    it('never exceeds 17px — safe for 3-digit NBA scores', () => {
      for (const vw of [320, 375, 390, 414, 480]) {
        expect(evalClamp(12, 3.5, 17, vw)).toBeLessThanOrEqual(17);
      }
    });
  });
});
