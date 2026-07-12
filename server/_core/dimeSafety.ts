export type DimeJurisdiction = "US" | "unknown";

export interface DimeSafetyAssessment {
  risk: "none" | "distress";
  reason?: string;
  resourceText?: string;
}

const distressPattern = /\b(chasing|chase losses|borrow(?:ing)? to bet|rent money|can't stop|cannot stop|unaffordable|lost everything|kill myself|self-harm|suicide)\b/i;

export function assessDimeResponsibleGamblingSafety(text: string, jurisdiction: DimeJurisdiction = "unknown"): DimeSafetyAssessment {
  if (!distressPattern.test(text)) return { risk: "none" };
  return {
    risk: "distress",
    reason: "gambling_distress_language",
    resourceText:
      jurisdiction === "US"
        ? "If gambling is starting to feel out of control, support is available in the US through 1-800-GAMBLER."
        : "If gambling is starting to feel out of control, local support resources are available. Share your country if you want help finding the appropriate resource.",
  };
}

export function containsProhibitedBettingCertainty(text: string): boolean {
  return /\b(lock|free money|guaranteed|risk[- ]?free|can't lose|sure thing)\b/i.test(text);
}
