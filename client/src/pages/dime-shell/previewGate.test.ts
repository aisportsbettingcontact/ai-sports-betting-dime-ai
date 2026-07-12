import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  allowsLocalDimePreview,
  withLocalDimePreview,
} from "./previewGate";

const appSource = fs.readFileSync(
  path.join(import.meta.dirname, "..", "..", "App.tsx"),
  "utf8"
);

describe("local Dime preview gate", () => {
  it("is inert in a production build even when the preview query is present", () => {
    expect(allowsLocalDimePreview("?preview=1", false)).toBe(false);
    expect(appSource).toMatch(
      /allowsLocalDimePreview\([\s\S]*?import\.meta\.env\.DEV[\s\S]*?\)/
    );
  });

  it("allows the explicit query only in a development build", () => {
    expect(allowsLocalDimePreview("?preview=1", true)).toBe(true);
    expect(allowsLocalDimePreview("?preview=0", true)).toBe(false);
    expect(allowsLocalDimePreview("", true)).toBe(false);
  });

  it("preserves the capability across shell paths without duplicating it", () => {
    expect(withLocalDimePreview("/chat", true)).toBe("/chat?preview=1");
    expect(
      withLocalDimePreview("/feed/model/mlb-07-11-2026?theme=dark", true)
    ).toBe("/feed/model/mlb-07-11-2026?theme=dark&preview=1");
    expect(
      withLocalDimePreview("/betting-splits/mlb-07-11-2026?preview=1", true)
    ).toBe("/betting-splits/mlb-07-11-2026?preview=1");
    expect(withLocalDimePreview("/bet-tracker#bets", true)).toBe(
      "/bet-tracker?preview=1#bets"
    );
  });

  it("does not alter navigation when preview is inactive", () => {
    expect(withLocalDimePreview("/bet-tracker", false)).toBe("/bet-tracker");
    expect(withLocalDimePreview("#", true)).toBe("#");
  });
});
