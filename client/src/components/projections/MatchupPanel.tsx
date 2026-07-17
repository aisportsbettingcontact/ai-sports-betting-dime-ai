import { TeamLogoMark } from "./TeamLogoMark";
import type { ProjectionGame } from "./types";

/**
 * MatchupPanel — the gamecard's identity block (owner directive 2026-07-17).
 * Logos flank a centered three-line stack:
 *
 *   {AWAY TEAM NAME} @ {HOME TEAM NAME}   ← "Giants @ Mariners"
 *   {BALLPARK / STAGE CONTEXT}            ← "T-Mobile Park"
 *   {TIME OF FIRST PITCH ET}              ← "10:10 PM ET"
 *
 * Team names only — no abbreviations, no pitcher names, no raw country codes.
 * The venue is suppressed when the context line already carries it — each fact
 * renders once. Scores stay beside the logos for live/final games.
 *
 * Single rendering ownership (directive §3): for scheduled games the start time
 * is owned by THIS panel's third line; ProjectionCard's header renders the
 * status only for live/final ("LIVE", "FINAL"). See ProjectionCard.test.ts.
 */
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
          <span className="matchup__line" title={`${away.name} @ ${home.name}`}>
            {away.name} <span className="matchup__at" aria-hidden="true">@</span> {home.name}
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
