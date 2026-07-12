import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { allowsLocalChatPreview } from "./previewGate";

const appSource = fs.readFileSync(
  path.join(import.meta.dirname, "..", "..", "App.tsx"),
  "utf8"
);

describe("allowsLocalChatPreview", () => {
  it("is inert in a production build even when the preview query is present", () => {
    expect(allowsLocalChatPreview("?preview=1", false)).toBe(false);
    expect(appSource).toMatch(
      /allowsLocalChatPreview\([\s\S]*?import\.meta\.env\.DEV[\s\S]*?\)/
    );
  });

  it("allows the explicit query only in a development build", () => {
    expect(allowsLocalChatPreview("?preview=1", true)).toBe(true);
    expect(allowsLocalChatPreview("?preview=0", true)).toBe(false);
    expect(allowsLocalChatPreview("", true)).toBe(false);
  });
});
