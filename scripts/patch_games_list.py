with open("/home/ubuntu/ai-sports-betting/server/routers.ts") as f:
    content = f.read()

# Add crypto import at the top if not present
if "import { createHash }" not in content:
    lines = content.split("\n")
    last_import_idx = 0
    for i, line in enumerate(lines):
        if line.startswith("import "):
            last_import_idx = i
    lines.insert(last_import_idx + 1, "import { createHash } from 'node:crypto';")
    content = "\n".join(lines)
    print("Added crypto import")

# Replace the games.list query handler to add Cache-Control + ETag
old_query = """      .query(async ({ input }) => {
        const games = await listGames(input ?? {});
        // Filter by the appropriate registry based on sport
        let filtered = games.filter(g => isValidGame(g.awayTeam, g.homeTeam, g.sport));
        // Filter by game status if provided
        if (input?.gameStatus) {
          filtered = filtered.filter(g => g.gameStatus === input.gameStatus);
        }
        return filtered;
      }),"""
new_query = """      .query(async ({ input, ctx }) => {
        const games = await listGames(input ?? {});
        // Filter by the appropriate registry based on sport
        let filtered = games.filter(g => isValidGame(g.awayTeam, g.homeTeam, g.sport));
        // Filter by game status if provided
        if (input?.gameStatus) {
          filtered = filtered.filter(g => g.gameStatus === input.gameStatus);
        }
        // Performance: Cache-Control + ETag for public feed (eliminates redundant DB queries)
        try {
          const etag = createHash('md5')
            .update(JSON.stringify(filtered.map(g => ({ id: g.id, modelRunAt: g.modelRunAt, gameStatus: g.gameStatus }))))
            .digest('hex')
            .slice(0, 16);
          ctx.res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
          ctx.res.setHeader('ETag', `"${etag}"`);
          const ifNoneMatch = ctx.req.headers['if-none-match'];
          if (ifNoneMatch === `"${etag}"`) {
            ctx.res.status(304).end();
            return [] as typeof filtered;
          }
        } catch {
          // Non-fatal: header setting can fail in some edge cases
        }
        return filtered;
      }),"""

count = content.count(old_query)
content = content.replace(old_query, new_query, 1)

with open("/home/ubuntu/ai-sports-betting/server/routers.ts", "w") as f:
    f.write(content)
print(f"Added Cache-Control + ETag to games.list: {count} occurrence(s)")
