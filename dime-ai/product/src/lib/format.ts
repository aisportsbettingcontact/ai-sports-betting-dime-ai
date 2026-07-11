import type { OddsFormat } from "@/lib/theme";

/** Thousands-separated integer, e.g. 2480 -> "2,480". */
export function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

const ODDS_TOKEN = /([+\-−–])(\d{3,4})\b(?!\.)/g;

/**
 * Converts American odds tokens (e.g. "+142", "−110") embedded in a
 * string to decimal odds when the user's odds format preference is
 * "decimal". A no-op for "american" (the values are already authored in
 * American format). Only touches sign+3-4-digit tokens, so percentages,
 * scores, and simulation counts pass through untouched.
 */
export function fmtOdds(value: string, format: OddsFormat): string {
  if (format === "american") return value;
  return value.replace(ODDS_TOKEN, (_match, sign: string, digits: string) => {
    const n = parseInt(digits, 10);
    const decimal = sign === "+" ? n / 100 + 1 : 100 / n + 1;
    return decimal.toFixed(2);
  });
}
