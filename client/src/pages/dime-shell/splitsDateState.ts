/**
 * A dated URL is authoritative. Server sync supplies a date only to legacy
 * dateless rendering and can never overwrite a URL-selected ISO date.
 */
export function resolveSplitsServerDate(
  currentDate: string,
  serverDate: string | undefined,
  urlDate: string | undefined
): string {
  if (urlDate) return currentDate;
  return serverDate ?? currentDate;
}
