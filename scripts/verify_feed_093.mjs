import http from 'http';

// tRPC batch query format
const input = JSON.stringify({0: {json: {date: "2026-07-06"}}});
const url = `http://localhost:3000/api/trpc/wc2026.matchesByDate?batch=1&input=${encodeURIComponent(input)}`;

http.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      const result = parsed[0]?.result?.data?.json || parsed[0]?.result?.data;
      if (!result) {
        console.log('[FAIL] No result data');
        console.log(data.slice(0, 1000));
        process.exit(1);
      }
      console.log(`[PASS] Feed returned ${result.length} matches for 2026-07-06`);
      result.forEach(m => {
        console.log('─'.repeat(60));
        console.log(`  matchId: ${m.matchId}`);
        console.log(`  teams: ${m.homeTeam?.name || m.homeTeam} vs ${m.awayTeam?.name || m.awayTeam}`);
        console.log(`  status: ${m.status} | kickoff: ${m.kickoffUtc}`);
        if (m.dkOdds) console.log(`  bookOdds: ${JSON.stringify(m.dkOdds).slice(0,150)}`);
        if (m.modelOdds) console.log(`  modelOdds: ${JSON.stringify(m.modelOdds).slice(0,150)}`);
        if (m.projection) console.log(`  projection: homeLambda=${m.projection.homeLambda} awayLambda=${m.projection.awayLambda}`);
        if (m.matchOdds) console.log(`  matchOdds(book): homeMl=${m.matchOdds.home} draw=${m.matchOdds.draw} awayMl=${m.matchOdds.away}`);
      });
    } catch(e) {
      console.log('[FAIL] Parse error:', e.message);
      console.log(data.slice(0, 500));
      process.exit(1);
    }
    process.exit(0);
  });
}).on('error', e => { console.log('[FAIL] HTTP error:', e.message); process.exit(1); });
