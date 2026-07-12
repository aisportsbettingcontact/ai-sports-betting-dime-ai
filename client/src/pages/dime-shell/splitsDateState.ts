/**
 * A dated URL is authoritative. Server sync supplies a date only to legacy
 * dateless rendering and can never overwrite a URL-selected ISO date.
 */
export function resolveSplitsServerDate(
  currentDate: string,
  serverDate: string | undefined,
  urlDate: string | undefined,
  wasUserSelected = false
): string {
  if (urlDate || wasUserSelected) return currentDate;
  return serverDate ?? currentDate;
}

/**
 * Where the currently selected splits date came from. Canonical redirects
 * stamp every URL with a date, so the URL shape alone cannot distinguish a
 * deliberate deep link from an application-generated default — callers must
 * carry this provenance explicitly.
 */
export type SplitsDateSource = "url-explicit" | "app-default";

/**
 * Auto-advance is recovery for an application-guessed date that turned out to
 * have no games. It must never override a date a person chose — via deep link
 * or the calendar — and it must not fire into a stale rolling window.
 */
export function shouldAutoAdvance(args: {
  dateSource: SplitsDateSource;
  userSelected: boolean;
  datesLoaded: boolean;
  hasGamesOnSelectedDate: boolean;
  blockedByEffectiveWindow: boolean;
}): boolean {
  return (
    args.dateSource === "app-default" &&
    !args.userSelected &&
    args.datesLoaded &&
    !args.hasGamesOnSelectedDate &&
    !args.blockedByEffectiveWindow
  );
}
