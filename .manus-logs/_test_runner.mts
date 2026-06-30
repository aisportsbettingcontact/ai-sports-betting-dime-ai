
import { scrapeEspnMatchPage } from "/home/ubuntu/ai-sports-betting/server/wc2026/espnPageScraper.ts";
import { writeFileSync } from "fs";
const data = await scrapeEspnMatchPage("760487", { logDir: "/home/ubuntu/ai-sports-betting/.manus-logs", saveHtml: true });
writeFileSync("/home/ubuntu/ai-sports-betting/.manus-logs/espn-page-scraper-result.json", JSON.stringify(data, null, 2));
process.stderr.write("[RUNNER] Done\n");
