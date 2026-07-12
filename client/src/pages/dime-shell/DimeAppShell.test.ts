import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const shellSource = fs.readFileSync(
  path.join(import.meta.dirname, "DimeAppShell.tsx"),
  "utf8"
);
const chatSource = fs.readFileSync(
  path.join(import.meta.dirname, "..", "dime-chat", "DimeChatPage.tsx"),
  "utf8"
);
const appSource = fs.readFileSync(
  path.join(import.meta.dirname, "..", "..", "App.tsx"),
  "utf8"
);

describe("DimeAppShell integration contract", () => {
  it("mounts the shell only when the shared >=768 viewport owns a product route", () => {
    expect(appSource).toMatch(/const shellViewport = useDimeShellViewport\(\)/);
    expect(appSource).toMatch(
      /const shellOwnsRoute = shellViewport && isDimeProductLocation\(location\)/
    );
    expect(appSource).toMatch(/if \(shellOwnsRoute\)[\s\S]*<DimeAppShell/);
    expect(appSource).toMatch(
      /<Route path="\/chat">\{\(\) => <DimeChatRoute \/>\}/
    );
  });

  it("derives pane identity from Wouter location and keeps chat mounted", () => {
    expect(shellSource).toMatch(
      /const \[location, navigate\] = useLocation\(\)/
    );
    expect(shellSource).toMatch(/parseDimeProductRoute\(location\)/);
    expect(shellSource).toMatch(/<DimeChatPage[\s\S]*shell=\{\{/);
    expect(chatSource).toMatch(
      /const chatActive = !shell \|\| shell\.renderedPane === "chat"/
    );
    expect(chatSource).toMatch(
      /aria-hidden=\{shell && !chatActive \? true : undefined\}/
    );
  });

  it("retains the outgoing pane while lazy content resolves", () => {
    expect(shellSource).toMatch(/useDeferredValue\(actualRoute\)/);
    expect(shellSource).toMatch(/startTransition\(\(\) => navigate\(href\)\)/);
  });

  it("restores per-pane scroll and focuses the exposed pane heading", () => {
    expect(shellSource).toMatch(/scrollPositionsRef/);
    expect(shellSource).toMatch(/externalScrollRef\.current\.scrollTop/);
    expect(shellSource).toMatch(/target\?\.focus\(\{ preventScroll: true \}\)/);
    expect(chatSource).toMatch(/className="dc-shell-sr-only"/);
    expect(chatSource).toMatch(/aria-hidden=\{!externalActive\}/);
  });

  it("embeds feed with chrome suppression and tracker wholesale", () => {
    expect(shellSource).toMatch(/<DimeModelFeed[\s\S]*embeddedInShell/);
    expect(shellSource).toMatch(/paneContent = <BetTracker \/>/);
    expect(shellSource).not.toMatch(/<BetTracker[^>]+embeddedInShell/);
  });

  it("aborts and disposes an active stream when a breakpoint unmounts chat", () => {
    const cleanupStart = chatSource.indexOf("useEffect(\n    () => () => {");
    const cleanupEnd = chatSource.indexOf("    []", cleanupStart);
    const cleanup = chatSource.slice(cleanupStart, cleanupEnd);
    expect(cleanupStart).toBeGreaterThan(-1);
    expect(cleanup).toMatch(/abortRef\.current\?\.abort\(\)/);
    expect(cleanup).toMatch(/activeBatcherRef\.current\?\.dispose\(\)/);
    expect(cleanup).toMatch(/drawerAnimationRef\.current\?\.stop\(\)/);
  });
});
