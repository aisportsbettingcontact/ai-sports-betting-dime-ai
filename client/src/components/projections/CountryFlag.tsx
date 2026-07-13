import "./CountryFlag.css";

/**
 * CountryFlag — a Unicode regional-indicator flag rendered as a bare glyph.
 *
 * No circular wrapper, mask, framed background, or grid cell (directive §World
 * Cup). The dimensional feel comes entirely from the emoji's own shading plus a
 * layered drop-shadow and a slight perspective tilt — never from an added disc.
 * The accessible label uses the resolved country NAME, so screen readers hear
 * "Spain flag", never "ESP". The flag and name must originate from the same
 * participant/country identity (see lib/sport/countries.ts).
 */
export function CountryFlag({
  flag,
  countryName,
  size,
}: {
  flag: string;
  countryName: string;
  /** optical box size in px; defaults to the matchup logo box */
  size?: number;
}) {
  const label = countryName ? `${countryName} flag` : "flag";
  return (
    <span
      className="country-flag"
      role="img"
      aria-label={label}
      style={size ? { inlineSize: size, minInlineSize: size, fontSize: Math.round(size * 0.8) } : undefined}
    >
      {flag}
    </span>
  );
}
