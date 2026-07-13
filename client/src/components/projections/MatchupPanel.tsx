import { TeamLogoMark } from "./TeamLogoMark";
import type { ProjectionGame } from "./types";

/**
 * MatchupPanel — a structured CSS-Grid matchup (Law v3 §matchup). Teams, scores,
 * logos, pitchers, venue, and status each occupy their own semantic element, so
 * the compressed "Brewers 5 Gasser vs Skenes 14 Pirates" line can never re-form.
 * Away team + score on the left, status/context in the center, home score + team
 * on the right; pitchers + venue in a secondary row. Scores use tabular-nums.
 */
export function MatchupPanel({ game }: { game: ProjectionGame }) {
  const { away, home, status, statusLabel, matchupContext, awayPitcher, homePitcher, venue } = game;
  const showScore = away.score != null && home.score != null;

  return (
    <div className="matchup">
      <div className="matchup__grid">
        <div className="matchup__team matchup__team--away">
          <TeamLogoMark team={away} />
          <span className="matchup__name ds-truncate" title={away.name}>{away.name}</span>
          {showScore && <span className="matchup__score score-value">{away.score}</span>}
        </div>

        <div className="matchup__center">
          <span className={`matchup__status matchup__status--${status}`}>{statusLabel}</span>
          {matchupContext && <span className="matchup__context ds-truncate" title={matchupContext}>{matchupContext}</span>}
        </div>

        <div className="matchup__team matchup__team--home">
          {showScore && <span className="matchup__score score-value">{home.score}</span>}
          <span className="matchup__name ds-truncate" title={home.name}>{home.name}</span>
          <TeamLogoMark team={home} />
        </div>
      </div>

      {(awayPitcher || homePitcher || venue) && (
        <div className="matchup__meta">
          {(awayPitcher || homePitcher) && (
            <span className="matchup__pitchers ds-truncate">
              {awayPitcher && <span>{awayPitcher}</span>}
              {awayPitcher && homePitcher && <span aria-hidden="true"> vs </span>}
              {homePitcher && <span>{homePitcher}</span>}
            </span>
          )}
          {venue && <span className="matchup__venue ds-truncate" title={venue}>{venue}</span>}
        </div>
      )}
    </div>
  );
}
