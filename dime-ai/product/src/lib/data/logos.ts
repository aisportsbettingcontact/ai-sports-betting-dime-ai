/**
 * Team/flag image sources. Per the design handoff these come from public CDN
 * image services (ESPN team logos, flagcdn country flags) rather than
 * self-hosted assets. The <TeamLogo> primitive falls back to initials if an
 * image fails to load, so a CDN hiccup never renders a broken-image icon.
 */
export const LOGO = {
  argentina: "https://flagcdn.com/w80/ar.png",
  france: "https://flagcdn.com/w80/fr.png",
  yankees: "https://a.espncdn.com/i/teamlogos/mlb/500/nyy.png",
  redsox: "https://a.espncdn.com/i/teamlogos/mlb/500/bos.png",
  dodgers: "https://a.espncdn.com/i/teamlogos/mlb/500/lad.png",
  rockies: "https://a.espncdn.com/i/teamlogos/mlb/500/col.png",
  braves: "https://a.espncdn.com/i/teamlogos/mlb/500/atl.png",
  pirates: "https://a.espncdn.com/i/teamlogos/mlb/500/pit.png",
  celtics: "https://a.espncdn.com/i/teamlogos/nba/500/bos.png",
  knicks: "https://a.espncdn.com/i/teamlogos/nba/500/ny.png",
  thunder: "https://a.espncdn.com/i/teamlogos/nba/500/okc.png",
  nuggets: "https://a.espncdn.com/i/teamlogos/nba/500/den.png",
} as const;
