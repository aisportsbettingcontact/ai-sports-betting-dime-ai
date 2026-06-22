import https from "https";
import zlib from "zlib";

const options = {
  hostname: "api.actionnetwork.com",
  path: "/web/v2/scoreboard/soccer?bookIds=68&date=20260622&periods=event",
  method: "GET",
  headers: {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "application/json",
    "Accept-Encoding": "gzip",
    "Referer": "https://www.actionnetwork.com/",
  }
};

const req = https.request(options, (res) => {
  const chunks = [];
  res.on("data", c => chunks.push(c));
  res.on("end", () => {
    zlib.gunzip(Buffer.concat(chunks), (err, buf) => {
      if (err) { console.error("gunzip error:", err); return; }
      const data = JSON.parse(buf.toString());

      for (const game of data.games) {
        const t0 = game.teams[0].full_name;
        const t1 = game.teams[1].full_name;
        const markets = game.markets;

        console.log("\n════════════════════════════════════════");
        console.log(`GAME: ${t0} (id=${game.teams[0].id}) vs ${t1} (id=${game.teams[1].id})`);
        console.log(`home_team_id=${game.home_team_id} | away_team_id=${game.away_team_id}`);
        console.log(`markets type: ${typeof markets} | isArray: ${Array.isArray(markets)}`);

        if (!markets) {
          console.log("NO MARKETS");
          continue;
        }

        if (Array.isArray(markets)) {
          console.log(`markets is ARRAY, length=${markets.length}`);
          for (const m of markets.slice(0, 3)) {
            console.log(`  market: ${JSON.stringify(m).slice(0, 300)}`);
          }
        } else if (typeof markets === "object") {
          console.log(`markets is OBJECT, keys: ${Object.keys(markets).join(", ")}`);
          for (const [mtype, mdata] of Object.entries(markets)) {
            if (Array.isArray(mdata) && mdata.length > 0) {
              console.log(`\n  [${mtype}] count=${mdata.length}`);
              const first = mdata[0];
              console.log(`  sample keys: ${Object.keys(first).join(", ")}`);
              const outcomes = first.outcomes ?? first.lines ?? first.selections ?? [];
              console.log(`  outcomes count: ${outcomes.length}`);
              for (const o of outcomes) {
                console.log(`    ${JSON.stringify(o)}`);
              }
            } else if (mdata && typeof mdata === "object") {
              console.log(`\n  [${mtype}] (object): ${JSON.stringify(mdata).slice(0, 200)}`);
            }
          }
        }
      }
    });
  });
});
req.end();
