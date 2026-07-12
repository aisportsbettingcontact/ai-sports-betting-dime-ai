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
const feedSource = fs.readFileSync(
  path.join(import.meta.dirname, "..", "DimeModelFeed.tsx"),
  "utf8"
);
const splitsSource = fs.readFileSync(
  path.join(import.meta.dirname, "..", "BettingSplits.tsx"),
  "utf8"
);
const trackerSource = fs.readFileSync(
  path.join(import.meta.dirname, "..", "BetTracker.tsx"),
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
    expect(shellSource).toMatch(
      /startTransition\(\(\) => navigate\(resolveRouteHref\(href\)\)\)/
    );
  });

  it("keeps the compile-time-gated preview capability across every shell pane", () => {
    expect(appSource).toMatch(
      /const localPreview = allowsLocalDimePreview\([\s\S]*import\.meta\.env\.DEV/
    );
    expect(appSource).not.toMatch(
      /location === "\/chat" &&[\s\S]*allowsLocalDimePreview/
    );
    expect(appSource).toMatch(
      /localPreview \?[\s\S]*<DimeAppShell previewMode \/>[\s\S]*:[\s\S]*<RequireAuth>[\s\S]*<DimeAppShell \/>[\s\S]*<\/RequireAuth>/
    );
    expect(shellSource).toMatch(/withLocalDimePreview\(href, previewMode\)/);
    expect(shellSource).toMatch(
      /navigate\(resolveRouteHref\(canonical\), \{ replace: true \}\)/
    );
    expect(feedSource).toMatch(
      /navigate\(resolveRouteHref\(feedModelPath\(nextSport, nextIso\)\)\)/
    );
    expect(splitsSource).toMatch(
      /setLocation\(resolveRouteHref\(bettingSplitsPath\(sport, selectedDate\)\)\)/
    );
  });

  it("shares one stable dated splits canonicalizer between standalone and shell owners", () => {
    expect(appSource).toMatch(
      /const canonical = canonicalBettingSplitsPath\(sportSegment, dateSegment\)/
    );
    expect(shellSource).toMatch(
      /const canonical = canonicalBettingSplitsPath\(\s*actualRoute\.sportSegment,\s*actualRoute\.dateSegment\s*\)/
    );
    expect(appSource).toMatch(/<Redirect to=\{canonical\} replace \/>/);
    expect(shellSource).toMatch(
      /navigate\(resolveRouteHref\(canonical\), \{ replace: true \}\)/
    );
  });

  it("carries the selected date on sport pushes and retains a sport-specific empty state", () => {
    const sportSwitchStart = splitsSource.indexOf(
      "const setSelectedSport = useCallback"
    );
    const sportSwitchEnd = splitsSource.indexOf(
      "const setSelectedDate = useCallback",
      sportSwitchStart
    );
    const sportSwitch = splitsSource.slice(sportSwitchStart, sportSwitchEnd);

    expect(sportSwitchStart).toBeGreaterThan(-1);
    expect(sportSwitch).toMatch(
      /setLocation\(resolveRouteHref\(bettingSplitsPath\(sport, selectedDate\)\)\)/
    );
    expect(sportSwitch).not.toMatch(/setSelectedDateState/);
    expect(sportSwitch).not.toMatch(/replace:\s*true/);
    expect(splitsSource).toMatch(/sortedDates\.length === 0 \?/);
    expect(splitsSource).toContain("`No ${selectedSport} games found.`");
  });

  it("restores per-pane scroll and focuses the exposed pane heading", () => {
    expect(shellSource).toMatch(/scrollPositionsRef/);
    expect(shellSource).toMatch(/externalScrollRef\.current\.scrollTop/);
    expect(shellSource).toMatch(/target\?\.focus\(\{ preventScroll: true \}\)/);
    expect(chatSource).toMatch(/className="dc-shell-sr-only"/);
    expect(chatSource).toMatch(
      /<m\.main[\s\S]*ref=\{shell\.chatHeadingRef\}[\s\S]*>\s*Dime Chat\s*<\/h1>/
    );
    expect(chatSource).toMatch(/aria-hidden=\{!externalActive\}/);
  });

  it.each([768, 1024, 1440])(
    "exposes exactly one h1 for every pane at %ipx",
    width => {
      expect(width).toBeGreaterThanOrEqual(768);
      expect(chatSource.match(/<h1\b/g)).toHaveLength(2);
      expect(chatSource).toMatch(
        /<m\.main[\s\S]*?aria-hidden=\{shell && !chatActive \? true : undefined\}[\s\S]*?<h1[\s\S]*?>\s*Dime Chat\s*<\/h1>/
      );
      expect(chatSource).toMatch(
        /<m\.section[\s\S]*?aria-hidden=\{!externalActive\}[\s\S]*?<h1[\s\S]*?>[\s\S]*?\{shell\.paneHeading\}[\s\S]*?<\/h1>/
      );

      for (const pane of ["chat", "feed", "splits", "tracker"] as const) {
        const exposedHeadings = [pane === "chat", pane !== "chat"].filter(
          Boolean
        );
        expect(exposedHeadings, `${width}px ${pane}`).toHaveLength(1);
      }
    }
  );

  it("embeds feed with chrome suppression and tracker wholesale", () => {
    expect(shellSource).toMatch(/<DimeModelFeed[\s\S]*embeddedInShell/);
    expect(shellSource).toMatch(
      /paneContent = <BetTracker previewMode=\{previewMode\} \/>/
    );
    expect(shellSource).not.toMatch(/<BetTracker[^>]+embeddedInShell/);
  });

  it("renders tracker chrome in preview without granting protected query access", () => {
    expect(trackerSource).toMatch(
      /if \(!previewMode && !authLoading && !appUser\) navigate\("\/"\)/
    );
    expect(trackerSource).toMatch(
      /const canLoadProtectedData = canAccess && !!appUser/
    );
    expect(trackerSource).toMatch(
      /\{canLoadProtectedData && \(\s*<BetCalendar/
    );
    expect(trackerSource).toMatch(/if \(authLoading && !previewMode\)/);
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
