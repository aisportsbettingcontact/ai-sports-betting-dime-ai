/**
 * Team Registry — maps DB slugs to display names, abbreviations, colors, and logo URLs.
 * NBA/NHL colors come from the live DB; NCAAM colors come from the shared registry.
 */

import { NCAAM_TEAMS } from "@shared/ncaamTeams";
import { NBA_TEAMS } from "@shared/nbaTeams";
import { NHL_TEAMS } from "@shared/nhlTeams";
import { MLB_TEAMS, MLB_BY_ABBREV } from "@shared/mlbTeams";
import { getDb } from "../db";
import { nbaTeams, nhlTeams } from "../../drizzle/schema";

export interface TeamEntry {
  displayName: string;
  /** City / school name shown on the top line of the card (e.g. "Toronto", "Golden State") */
  city: string;
  /** Nickname shown on the bottom line of the card (e.g. "Maple Leafs", "Warriors") */
  nickname: string;
  abbrev: string;
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  tertiaryColor: string;
}

// ── Static registries (NCAAM + NHL abbreviations from shared) ─────────────────
const ncaamByDbSlug = new Map<string, TeamEntry>();
for (const t of NCAAM_TEAMS) {
  ncaamByDbSlug.set(t.dbSlug, {
    displayName: t.ncaaName,
    city: t.ncaaName,           // For NCAAM, city = full school name (e.g. "Duke")
    nickname: t.ncaaNickname,   // e.g. "Blue Devils"
    abbrev: t.dbSlug.split("_").map((w) => w[0]?.toUpperCase() ?? "").join("").slice(0, 4),
    logoUrl: t.logoUrl,
    primaryColor: (t as any).primaryColor ?? "#4A90D9",
    secondaryColor: (t as any).secondaryColor ?? "#FFFFFF",
    tertiaryColor: (t as any).tertiaryColor ?? "#FFFFFF",
  });
}

// NHL — abbrev from shared, colors loaded from DB at startup
const nhlByDbSlug = new Map<string, TeamEntry>();
for (const t of NHL_TEAMS) {
  nhlByDbSlug.set(t.dbSlug, {
    displayName: t.name,
    city: t.city,               // e.g. "Toronto", "Vegas", "Columbus"
    nickname: t.nickname,       // e.g. "Maple Leafs", "Golden Knights", "Blue Jackets"
    abbrev: t.abbrev,
    logoUrl: t.logoUrl,
    primaryColor: "#003087",
    secondaryColor: "#FFFFFF",
    tertiaryColor: "#FFFFFF",
  });
}

// NBA — all data loaded from DB at startup
const nbaByDbSlug = new Map<string, TeamEntry>();
for (const t of NBA_TEAMS) {
  // Derive abbrev from name until DB load overwrites it
  const words = t.name.split(" ");
  const abbrev = words.length >= 2
    ? words.slice(-2).map((w) => w[0]).join("").toUpperCase()
    : t.name.slice(0, 3).toUpperCase();
  nbaByDbSlug.set(t.dbSlug, {
    displayName: t.name,
    city: t.city,               // e.g. "Golden State", "Oklahoma City"
    nickname: t.nickname,       // e.g. "Warriors", "Thunder"
    abbrev,
    logoUrl: t.logoUrl,
    primaryColor: "#1D428A",
    secondaryColor: "#FFC72C",
    tertiaryColor: "#FFFFFF",
  });
}

// ── DB-backed enrichment (called once at bot startup) ─────────────────────────
export async function enrichTeamRegistryFromDb(): Promise<void> {
  try {
    // NBA
    const db = await getDb();
    if (!db) { console.warn('[DiscordBot] DB not available for team enrichment'); return; }
    const nbaRows = await db.select({
      dbSlug: nbaTeams.dbSlug,
      abbrev: nbaTeams.abbrev,
      primaryColor: nbaTeams.primaryColor,
      secondaryColor: nbaTeams.secondaryColor,
      tertiaryColor: nbaTeams.tertiaryColor,
      name: nbaTeams.name,
      logoUrl: nbaTeams.logoUrl,
    }).from(nbaTeams);

    for (const row of nbaRows) {
      const existing = nbaByDbSlug.get(row.dbSlug);
      if (existing) {
        existing.abbrev = row.abbrev ?? existing.abbrev;
        existing.primaryColor = row.primaryColor ?? existing.primaryColor;
        existing.secondaryColor = row.secondaryColor ?? existing.secondaryColor;
        existing.tertiaryColor = (row as any).tertiaryColor ?? existing.tertiaryColor;
        if (row.logoUrl) existing.logoUrl = row.logoUrl;
      }
    }
    console.log(`[DiscordBot] Enriched ${nbaRows.length} NBA teams from DB`);

    // NHL
    const nhlRows = await db.select({
      dbSlug: nhlTeams.dbSlug,
      abbrev: nhlTeams.abbrev,
      primaryColor: nhlTeams.primaryColor,
      secondaryColor: nhlTeams.secondaryColor,
      tertiaryColor: nhlTeams.tertiaryColor,
      logoUrl: nhlTeams.logoUrl,
    }).from(nhlTeams);

    for (const row of nhlRows) {
      const existing = nhlByDbSlug.get(row.dbSlug);
      if (existing) {
        existing.abbrev = row.abbrev ?? existing.abbrev;
        existing.primaryColor = row.primaryColor ?? existing.primaryColor;
        existing.secondaryColor = row.secondaryColor ?? existing.secondaryColor;
        existing.tertiaryColor = (row as any).tertiaryColor ?? existing.tertiaryColor;
        if (row.logoUrl) existing.logoUrl = row.logoUrl;
      }
    }
    console.log(`[DiscordBot] Enriched ${nhlRows.length} NHL teams from DB`);
  } catch (err) {
    console.error("[DiscordBot] enrichTeamRegistryFromDb failed:", err);
  }
}

function fallback(dbSlug: string): TeamEntry {
  const displayName = dbSlug
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  const parts = displayName.split(" ");
  const city = parts.length > 1 ? parts.slice(0, -1).join(" ") : displayName;
  const nickname = parts.length > 1 ? parts[parts.length - 1]! : displayName;
  return {
    displayName,
    city,
    nickname,
    abbrev: dbSlug.split("_").map((w) => w[0]?.toUpperCase() ?? "").join("").slice(0, 4),
    logoUrl: "",
    primaryColor: "#4A90D9",
    secondaryColor: "#FFFFFF",
    tertiaryColor: "#FFFFFF",
  };
}

// MLB — all data from shared registry
// Keyed by BOTH dbSlug (VSiN slug, e.g. "yankees") AND abbrev (e.g. "NYY").
// The games DB stores team values as abbreviations (e.g. "NYY", "SF"),
// NOT as VSiN slugs — so we must support both lookup paths.
const mlbByDbSlug = new Map<string, TeamEntry>();
for (const t of MLB_TEAMS) {
  const entry: TeamEntry = {
    displayName: t.name,
    city: t.city,               // e.g. "New York", "Los Angeles"
    nickname: t.nickname,       // e.g. "Yankees", "Dodgers"
    abbrev: t.abbrev,
    logoUrl: t.logoUrl,
    primaryColor: t.primaryColor,
    secondaryColor: t.secondaryColor,
    tertiaryColor: t.tertiaryColor ?? t.secondaryColor,
  };
  // Primary key: VSiN slug (e.g. "yankees", "giants")
  mlbByDbSlug.set(t.dbSlug, entry);
  // Secondary key: standard abbreviation (e.g. "NYY", "SF") — this is what the games DB stores
  mlbByDbSlug.set(t.abbrev, entry);
  // Also register brAbbrev if different (e.g. "SFG" for SF Giants, "KCR" for KC Royals)
  if (t.brAbbrev && t.brAbbrev !== t.abbrev) {
    mlbByDbSlug.set(t.brAbbrev, entry);
  }
}

export function resolveTeam(dbSlug: string, sport: string): TeamEntry {
  switch (sport.toUpperCase()) {
    case "NBA":
      return nbaByDbSlug.get(dbSlug) ?? fallback(dbSlug);
    case "NHL":
      return nhlByDbSlug.get(dbSlug) ?? fallback(dbSlug);
    case "MLB":
      return mlbByDbSlug.get(dbSlug) ?? fallback(dbSlug);
    default:
      return ncaamByDbSlug.get(dbSlug) ?? fallback(dbSlug);
  }
}
