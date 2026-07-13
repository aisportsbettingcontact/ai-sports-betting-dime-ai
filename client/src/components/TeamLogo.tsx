/**
 * TeamLogo — resolves team logos from the shared registry (nbaTeams / nhlTeams / mlbTeams).
 * Falls back to a colored circle badge with initials if no logo is found.
 */

const PALETTE = [
  "#e63946", "#2a9d8f", "#e9c46a", "#f4a261", "#264653",
  "#6c63ff", "#48cae4", "#f77f00", "#06d6a0", "#ef476f",
  "#118ab2", "#ffd166", "#7209b7", "#3a86ff", "#fb5607",
  "#8338ec", "#ff006e", "#06a77d", "#d62828", "#023e8a",
];

function colorFromName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

/**
 * Black or white ink for initials on a `hex` disc (WCAG relative luminance,
 * threshold 0.5) — light palette discs (#e9c46a, #ffd166, …) need black ink.
 * Duplicated in client/src/pages/DimeModelFeed.tsx (no shared export without
 * a new file) — keep in sync.
 */
function inkFor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#FFFFFF";
  const n = parseInt(m[1], 16);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.5 ? "#000000" : "#FFFFFF";
}

function abbrev(name: string): string {
  const parts = name.replace(/_/g, " ").trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 4).toUpperCase();
  if (parts.length === 2) return (parts[0].slice(0, 2) + parts[1].slice(0, 2)).toUpperCase();
  return parts.map((p) => p[0]).join("").slice(0, 4).toUpperCase();
}

interface TeamLogoProps {
  /** Team DB slug, e.g. "lakers", "bruins" */
  name: string;
  size?: number;
}

export default function TeamLogo({ name, size = 36 }: TeamLogoProps) {
  // Fallback: colored badge with initials
  const bg = colorFromName(name);
  const text = abbrev(name);
  const fontSize = size <= 28 ? 9 : size <= 36 ? 11 : 13;

  return (
    <div
      style={{
        width: size,
        height: size,
        minWidth: size,
        borderRadius: "50%",
        background: bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize,
        color: inkFor(bg),
        letterSpacing: "0.04em",
        userSelect: "none",
      }}
    >
      {text}
    </div>
  );
}
