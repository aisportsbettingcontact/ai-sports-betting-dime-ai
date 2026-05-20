import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const db = await createConnection(process.env.DATABASE_URL!);

  // Get tracked_bets column names
  const [cols] = await db.execute(
    "SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tracked_bets' ORDER BY ORDINAL_POSITION"
  ) as any[];
  console.log("[STATE] tracked_bets columns:", cols.map((c: any) => c.COLUMN_NAME).join(", "));

  // Get all Prez bets on 2026-05-20 using only safe column names
  const [prezBets] = await db.execute(
    "SELECT * FROM tracked_bets WHERE userId = 1 AND gameDate = '2026-05-20' ORDER BY id ASC"
  ) as any[];
  console.log("[STATE] Prez bets on 2026-05-20 count:", prezBets.length);
  for (const b of prezBets) {
    console.log("[STATE] bet:", JSON.stringify(b));
  }

  // Check the auto-grader: find all server files that reference auto-grading
  // Check games table for the BAL@TB game specifically
  const [baltb] = await db.execute(
    "SELECT * FROM games WHERE id = 2250690"
  ) as any[];
  console.log("[STATE] BAL@TB game row keys:", Object.keys((baltb as any[])[0] || {}).join(", "));
  const g = (baltb as any[])[0];
  if (g) {
    console.log(`[STATE] BAL@TB: status=${g.gameStatus} awayScore=${g.awayScore} homeScore=${g.homeScore} gamePk=${g.mlbGamePk}`);
  }

  await db.end();
  console.log("[OUTPUT] Done.");
}

main().catch(err => { console.error("[ERROR]", err); process.exit(1); });
