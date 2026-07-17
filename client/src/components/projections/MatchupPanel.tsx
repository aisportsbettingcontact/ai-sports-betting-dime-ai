import { TeamLogoMark } from "./TeamLogoMark";
import type { ProjectionGame, ProjectionTeam } from "./types";

/**
 * MatchupPanel — the gamecard's identity block (owner directive 2026-07-17).
 * Logos flank a centered three-line stack:
 *
 *   {AWAY ABBR} {AWAY NAME} @ {HOME ABBR} {HOME NAME}   ← "SF Giants @ SEA Mariners"
 *   {BALLPARK / STAGE CONTEXT}                          ← "T-Mobile Park"
 *   {TIME OF FIRST PITCH ET}                            ← "10:10 PM ET"
 *
 * Pitcher names are no longer rendered anywhere on the card, and the venue is
 * suppressed when the context line already carries it — each fact renders once.
 * Countries show their name only (never a raw FIFA code); teams show ABBR NAME.
 * Scores stay beside the logos for live/final games.
 *
 * Single rendering ownership (directive §3): for scheduled games the start time
 * is owned by THIS panel's third line; ProjectionCard's header renders the
 * status only for live/final ("LIVE", "FINAL"). See ProjectionCard.test.ts.
 */
function teamLabel(t: ProjectionTeam): string {
  if (t.kind === "country" || !t.abbr || t.abbr === t.name) return t.name;
  return `${t.abbr} ${t.name}`;
}

export function MatchupPanel({ game }: { game: ProjectionGame }) {
  const { away, home, matchupContext, venue, startTime } = game;
  const showScore = away.score != null && home.score != null;
  // No duplicate ballpark: drop the venue line when the context already has it.
  const showVenue = !!venue && !(matchupContext ?? "").includes(venue);

  return (
    <div className="matchup">
      <div className="matchup__grid">
        <div className="matchup__team matchup__team--away">
          <TeamLogoMark team={away} />
          {showScore && <span className="matchup__score score-value">{away.score}</span>}
        </div>

        <div className="matchup__center">
          <span className="matchup__line" title={`${teamLabel(away)} @ ${teamLabel(home)}`}>
            {teamLabel(away)} <span className="matchup__at" aria-hidden="true">@</span> {teamLabel(home)}
          </span>
          {matchupContext && (
            <span className="matchup__context ds-truncate" title={matchupContext}>{matchupContext}</span>
          )}
          {showVenue && <span className="matchup__venue ds-truncate" title={venue}>{venue}</span>}
          {startTime && <span className="matchup__time">{startTime}</span>}
        </div>

        <div className="matchup__team matchup__team--home">
          {showScore && <span className="matchup__score score-value">{home.score}</span>}
          <TeamLogoMark team={home} />
        </div>
      </div>
    </div>
  );
}
