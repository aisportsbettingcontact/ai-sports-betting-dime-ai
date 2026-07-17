import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const routerSource = fs.readFileSync(
  path.join(import.meta.dirname, "routers.ts"),
  "utf8",
);

describe("games.list response lifecycle", () => {
  it("leaves response completion to the tRPC Express adapter", () => {
    const start = routerSource.indexOf("games: router({");
    const end = routerSource.indexOf("getAvailableDates: publicProcedure", start);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const listProcedure = routerSource.slice(start, end);
    expect(listProcedure).toContain("ctx.res.setHeader('ETag'");
    expect(listProcedure).not.toMatch(/ctx\.res\.(?:status|end|send|json)\s*\(/);
  });
});
