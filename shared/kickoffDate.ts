/**
 * Kickoff-date convention (project memory, user-critical):
 * concrete kickoff instants derive their date in America/Los_Angeles (keeps
 * post-midnight-ET games on their football day); TBD sentinels are stored by
 * ESPN at midnight ET, so they derive in America/New_York to avoid shifting
 * to the previous day.
 */
export function deriveKickoffDate(kickoffUtcIso: string, timeValid: boolean): string {
  const instant = new Date(kickoffUtcIso);
  const zone = timeValid ? "America/Los_Angeles" : "America/New_York";
  return instant.toLocaleDateString("en-CA", { timeZone: zone });
}
