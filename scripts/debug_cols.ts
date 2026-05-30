import { games } from "../drizzle/schema";

const cols = [
  "id","awayTeam","homeTeam","startTimeEst",
  "awayPitcherName","homePitcherName","awayPitcherConfirmed","homePitcherConfirmed",
  "awayML","homeML","awayRunLine","homeRunLine","awayRunLineOdds","homeRunLineOdds",
  "awayBookSpread","homeBookSpread","overOdds","underOdds","bookTotal",
  "modelAwayML","modelHomeML","publishedToFeed","publishedModel","modelRunAt"
] as const;

for (const col of cols) {
  const val = (games as any)[col];
  console.log(`[COL] ${col}: ${val === undefined ? "❌ UNDEFINED" : "✅ OK"}`);
}
process.exit(0);
