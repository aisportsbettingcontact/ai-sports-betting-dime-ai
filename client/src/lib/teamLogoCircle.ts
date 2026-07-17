/**
 * teamLogoCircle.ts
 *
 * Logo circle background logic for MLB team logos (originally ported from the
 * retired Discord lineup card renderer; this is now the canonical copy).
 * Produces a radial-gradient background for every MLB team logo circle.
 *
 * Algorithm:
 *   1. pickLogoBg — selects the highest-contrast color from primary/secondary/tertiary
 *      against the primary color. Falls back to #1a1a2e when contrast < 1.5.
 *   2. darkShade  — subtracts 60 from each RGB channel for the gradient end stop.
 *   3. Result: radial-gradient(circle at 35% 35%, logoBg, logoBgDark)
 */

/** WCAG relative luminance (0–1) for a hex color string. */
function luminance(hex: string): number {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  const lin = (v: number) =>
    v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Pick the highest-contrast background color for the logo circle.
 */
export function pickLogoBg(
  primary: string,
  secondary?: string | null,
  tertiary?: string | null
): string {
  const candidates = [primary, secondary, tertiary].filter(
    (c): c is string => !!c && c.length >= 4
  );
  let bestColor = primary;
  let bestContrast = 0;
  for (const bg of candidates) {
    const lumLogo = luminance(primary);
    const lumBg = luminance(bg);
    const lighter = Math.max(lumLogo, lumBg);
    const darker = Math.min(lumLogo, lumBg);
    const cr = (lighter + 0.05) / (darker + 0.05);
    if (cr > bestContrast) {
      bestContrast = cr;
      bestColor = bg;
    }
  }
  // Fall back to near-black when no color provides enough contrast
  return bestContrast < 1.5 ? "#1a1a2e" : bestColor;
}

/**
 * Darken a hex color by subtracting 60 from each RGB channel.
 */
export function darkShade(hex: string): string {
  const c = hex.replace("#", "");
  const r = Math.max(0, parseInt(c.slice(0, 2), 16) - 60);
  const g = Math.max(0, parseInt(c.slice(2, 4), 16) - 60);
  const b = Math.max(0, parseInt(c.slice(4, 6), 16) - 60);
  return (
    "#" +
    [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")
  );
}

/**
 * Returns the CSS radial-gradient string for a team logo circle.
 * Identical output to the Discord /lineups image renderer.
 *
 * Usage:
 *   background: teamLogoGradient(team.primaryColor, team.secondaryColor, team.tertiaryColor)
 */
export function teamLogoGradient(
  primaryColor: string,
  secondaryColor?: string | null,
  tertiaryColor?: string | null
): string {
  const bg = pickLogoBg(primaryColor, secondaryColor, tertiaryColor);
  const bgDark = darkShade(bg);
  return `radial-gradient(circle at 35% 35%, ${bg}, ${bgDark})`;
}
