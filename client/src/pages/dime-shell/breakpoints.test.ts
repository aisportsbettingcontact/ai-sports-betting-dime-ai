import { describe, expect, it, vi } from "vitest";
import {
  DIME_SHELL_MEDIA_QUERY,
  DIME_SHELL_MIN_WIDTH_PX,
  matchesDimeShellViewport,
  resolvePostLoginPath,
} from "./breakpoints";

describe("Dime shell breakpoint", () => {
  it("uses one inclusive 768px matchMedia boundary", () => {
    const matchMedia = vi.fn(() => ({ matches: true }));

    expect(DIME_SHELL_MIN_WIDTH_PX).toBe(768);
    expect(DIME_SHELL_MEDIA_QUERY).toBe("(min-width: 768px)");
    expect(matchesDimeShellViewport(matchMedia)).toBe(true);
    expect(matchMedia).toHaveBeenCalledTimes(1);
    expect(matchMedia).toHaveBeenCalledWith("(min-width: 768px)");
  });

  it("does not opt into the shell without a matching client viewport", () => {
    expect(matchesDimeShellViewport(() => ({ matches: false }))).toBe(false);
    expect(matchesDimeShellViewport(undefined)).toBe(false);
  });
});

describe("post-login product default", () => {
  it("defaults tablet and desktop clients to chat", () => {
    expect(resolvePostLoginPath(null, () => ({ matches: true }))).toBe("/chat");
  });

  it("retains the existing mobile default below 768px", () => {
    expect(resolvePostLoginPath(null, () => ({ matches: false }))).toBe(
      "/feed/model/mlb"
    );
  });

  it("preserves an explicit returnPath without consulting the viewport", () => {
    const matchMedia = vi.fn(() => ({ matches: true }));

    expect(resolvePostLoginPath("/bet-tracker", matchMedia)).toBe(
      "/bet-tracker"
    );
    expect(resolvePostLoginPath("/chat?preview=1", matchMedia)).toBe(
      "/chat?preview=1"
    );
    expect(matchMedia).not.toHaveBeenCalled();
  });

  it("rejects non-internal returnPath values with the desktop default", () => {
    const desktop = () => ({ matches: true });

    for (const unsafe of [
      "https://evil.example/path",
      "//evil.example/path",
      "javascript:alert(1)",
      "feed/model/mlb",
      "",
      "\\evil.example",
      "/\\evil.example",
    ]) {
      expect(resolvePostLoginPath(unsafe, desktop), unsafe).toBe("/chat");
    }
  });

  it("rejects non-internal returnPath values with the mobile default", () => {
    expect(resolvePostLoginPath("//evil.example", () => ({ matches: false }))).toBe(
      "/feed/model/mlb"
    );
  });
});
