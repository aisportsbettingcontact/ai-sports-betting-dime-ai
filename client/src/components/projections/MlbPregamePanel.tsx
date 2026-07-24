import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { TeamLogoMark } from "./TeamLogoMark";
import type {
  ProjectionLineupPlayer,
  ProjectionPitcher,
  ProjectionPregameLineups,
  ProjectionTeam,
  ProjectionTeamLineup,
} from "./types";

const mlbHeadshotUrl = (mlbamId: number): string =>
  `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_180,q_auto:best,e_background_removal,f_png/v1/people/${mlbamId}/headshot/67/current`;

const rotowireHeadshotUrl = (rotowireId: number): string =>
  `https://www.rotowire.com/images/photos/${rotowireId}.jpg`;

function initials(name: string | null): string {
  if (!name) return "TBD";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function PitcherHeadshot({
  pitcher,
  className = "",
}: {
  pitcher: ProjectionPitcher;
  className?: string;
}) {
  const sources = [
    pitcher.mlbamId
      ? { kind: "mlb" as const, url: mlbHeadshotUrl(pitcher.mlbamId) }
      : null,
    pitcher.rotowireId
      ? { kind: "rotowire" as const, url: rotowireHeadshotUrl(pitcher.rotowireId) }
      : null,
  ].filter((source): source is NonNullable<typeof source> => source != null);
  const [sourceIndex, setSourceIndex] = useState(0);
  const currentSource = sources[sourceIndex];

  return (
    <span className={`pregame-pitcher__photo ${className}`.trim()} aria-hidden="true">
      {currentSource ? (
        <img
          src={currentSource.url}
          data-headshot-source={currentSource.kind}
          alt=""
          width={80}
          height={80}
          loading="lazy"
          decoding="async"
          onError={() => setSourceIndex((index) => index + 1)}
        />
      ) : (
        <span className="pregame-pitcher__fallback">{initials(pitcher.name)}</span>
      )}
    </span>
  );
}

function pitcherStatus(pitcher: ProjectionPitcher): string {
  if (!pitcher.name) return "Pending";
  return pitcher.confirmed ? "Confirmed" : "Expected";
}

function lineupStatus(lineup: ProjectionTeamLineup): string {
  if (lineup.battingOrder.length === 0) return "Lineup pending";
  return lineup.confirmed ? "Confirmed lineup" : "Expected lineup";
}

function PitcherPreview({
  pitcher,
  side,
}: {
  pitcher: ProjectionPitcher;
  side: "away" | "home";
}) {
  const status = pitcherStatus(pitcher);
  return (
    <div className={`pregame-pitcher pregame-pitcher--${side}`}>
      <span className={`pregame-pitcher__status pregame-pitcher__status--${status.toLowerCase()}`}>
        {status}
      </span>
      <PitcherHeadshot
        key={`${pitcher.mlbamId ?? "x"}-${pitcher.rotowireId ?? "x"}-${pitcher.name ?? "tbd"}`}
        pitcher={pitcher}
      />
      <strong className="pregame-pitcher__name">{pitcher.name ?? "Pitcher TBD"}</strong>
      <span className="pregame-pitcher__stats">
        {pitcher.seasonStats ?? "W–L / ERA pending"}
      </span>
    </div>
  );
}

function LineupRows({ players }: { players: ProjectionLineupPlayer[] }) {
  if (players.length === 0) {
    return <p className="lineups-dialog__pending">Batting order not posted yet.</p>;
  }

  return (
    <ol className="lineups-dialog__order" aria-label="Batting order">
      {players.map((player) => (
        <li
          className="lineups-dialog__player"
          key={`${player.mlbamId ?? player.rotowireId ?? "player"}-${player.battingOrder}-${player.name}`}
        >
          <span className="lineups-dialog__number">{player.battingOrder}</span>
          <span className="lineups-dialog__player-name">{player.name}</span>
          <span className="lineups-dialog__player-meta">
            {player.position}
            {player.bats ? ` · ${player.bats}` : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}

function TeamLineupColumn({
  team,
  side,
  lineup,
}: {
  team: ProjectionTeam;
  side: "Away" | "Home";
  lineup: ProjectionTeamLineup;
}) {
  const starterStatus = pitcherStatus(lineup.pitcher);
  return (
    <section className="lineups-dialog__team" aria-labelledby={`lineup-team-${side}-${team.abbr}`}>
      <header className="lineups-dialog__team-head">
        <TeamLogoMark team={team} />
        <div>
          <span className="lineups-dialog__side">{side}</span>
          <h3 id={`lineup-team-${side}-${team.abbr}`}>{team.name}</h3>
        </div>
        <span className="lineups-dialog__lineup-status">{lineupStatus(lineup)}</span>
      </header>

      <div className="lineups-dialog__starter">
        <PitcherHeadshot
          key={`dialog-${lineup.pitcher.mlbamId ?? "x"}-${lineup.pitcher.rotowireId ?? "x"}-${lineup.pitcher.name ?? "tbd"}`}
          pitcher={lineup.pitcher}
          className="pregame-pitcher__photo--dialog"
        />
        <div className="lineups-dialog__starter-copy">
          <span className="lineups-dialog__starter-label">{starterStatus} starting pitcher</span>
          <strong>{lineup.pitcher.name ?? "Pitcher TBD"}</strong>
          <span>
            {lineup.pitcher.seasonStats ?? "W–L / ERA pending"}
            {lineup.pitcher.hand ? ` · ${lineup.pitcher.hand}HP` : ""}
          </span>
        </div>
      </div>

      <LineupRows players={lineup.battingOrder} />
    </section>
  );
}

export function MlbPregamePanel({
  away,
  home,
  lineups,
}: {
  away: ProjectionTeam;
  home: ProjectionTeam;
  lineups: ProjectionPregameLineups;
}) {
  return (
    <section className="pregame-pitchers" aria-label="Probable pitchers">
      <PitcherPreview pitcher={lineups.away.pitcher} side="away" />

      <Dialog>
        <DialogTrigger asChild>
          <button
            type="button"
            className="pregame-pitchers__lineups"
            aria-label={`View lineups for ${away.name} at ${home.name}`}
          >
            Lineups
          </button>
        </DialogTrigger>
        <DialogContent className="projection-lineups-dialog">
          <DialogHeader className="projection-lineups-dialog__header">
            <DialogTitle>{away.name} at {home.name} lineups</DialogTitle>
            <DialogDescription>
              Expected and confirmed starters and batting orders from Rotowire.
            </DialogDescription>
          </DialogHeader>

          <div className="lineups-dialog__teams">
            <TeamLineupColumn team={away} side="Away" lineup={lineups.away} />
            <TeamLineupColumn team={home} side="Home" lineup={lineups.home} />
          </div>
        </DialogContent>
      </Dialog>

      <PitcherPreview pitcher={lineups.home.pitcher} side="home" />
    </section>
  );
}
