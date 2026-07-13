import type { ProjectionTeam } from "./types";

/**
 * TeamLogoMark — renders the ORIGINAL transparent logo asset directly, with no
 * interface-generated circle, frame, mask, or background (Law v3 §logos).
 * Every mark gets the same optical bounding box so differently-shaped logos
 * appear balanced without distorting proportions. When no logo asset exists,
 * falls back to a monogram disc using the team's own color (the Three-Color
 * Law's team-logo exception), which is the ONLY place a non-palette color renders.
 * Explicit width/height prevent layout shift (no next/image in this Vite app).
 */
export function TeamLogoMark({ team }: { team: ProjectionTeam }) {
  if (team.logo) {
    return (
      <span className="team-logo-box">
        <img className="team-logo" src={team.logo} alt="" width={40} height={40} loading="lazy" decoding="async" />
      </span>
    );
  }
  return (
    <span className="team-logo-box" aria-hidden="true">
      <span className="team-logo team-logo--mono" style={{ background: team.color || "#333" }}>
        {team.abbr.slice(0, 2)}
      </span>
    </span>
  );
}
