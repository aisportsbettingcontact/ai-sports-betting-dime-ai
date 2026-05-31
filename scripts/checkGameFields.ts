import { games } from "../drizzle/schema.ts";

const fieldsToCheck = [
  'awayML', 'homeML', 'awayRunLine', 'homeRunLine',
  'awayRunLineOdds', 'homeRunLineOdds', 'bookTotal',
  'overOdds', 'underOdds', 'awayStartingPitcher', 'homeStartingPitcher',
  'awayPitcherConfirmed', 'homePitcherConfirmed',
  'modelTotal', 'modelAwayScore', 'modelHomeScore',
  'modelAwayWinPct', 'modelHomeWinPct',
  'awayModelSpread', 'homeModelSpread',
  'publishedModel', 'venue', 'mlbGamePk',
  'awayTeam', 'homeTeam', 'gameDate', 'gameTime', 'sport', 'id',
];

for (const f of fieldsToCheck) {
  const val = (games as any)[f];
  if (val === undefined || val === null) {
    console.log(`MISSING: ${f}`);
  } else {
    console.log(`OK: ${f}`);
  }
}
process.exit(0);
