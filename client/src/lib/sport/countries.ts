/**
 * countries.ts — Country identity for soccer surfaces.
 *
 * The World Cup feed identifies teams by FIFA 3-letter codes (ESP, FRA, ENG).
 * Those codes are NOT ISO 3166-1 and must NEVER reach the interface. This module
 * is the single source that turns a FIFA code into a real country name and a
 * Unicode flag, so a participant's name, flag, and ISO code are always derived
 * together from one identifier and can never drift apart.
 *
 * Name resolution:
 *   1. explicit dictionary name (authoritative, deterministic across engines)
 *   2. Intl.DisplayNames(iso2) for any ISO country not in the dictionary
 *   3. a caller-supplied canonical name (e.g. the DB `name`) when it is not a
 *      raw abbreviation
 *   never the raw 3-letter code.
 *
 * Flag resolution:
 *   ISO countries → regional-indicator emoji derived from the alpha-2 code
 *   non-ISO FIFA members (England/Scotland/Wales) → explicit tag-sequence emoji
 *   unknown → neutral white flag (never the raw code)
 */

/** iso2 present ⇒ ISO country; iso2 null ⇒ non-ISO FIFA member with explicit flag. */
type CountryEntry =
  | { iso2: string; name: string; flag?: string }
  | { iso2: null; name: string; flag: string };

/**
 * FIFA 3-letter code → country. Covers all confederations broadly (well beyond
 * the 48-team field) so any qualifier resolves. Names are stored explicitly so
 * output is stable regardless of the runtime's ICU/CLDR version.
 */
const FIFA_COUNTRIES: Record<string, CountryEntry> = {
  // ── UEFA ──
  ESP: { iso2: "ES", name: "Spain" },
  FRA: { iso2: "FR", name: "France" },
  GER: { iso2: "DE", name: "Germany" },
  ENG: { iso2: null, name: "England", flag: "🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}" },
  SCO: { iso2: null, name: "Scotland", flag: "🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}" },
  WAL: { iso2: null, name: "Wales", flag: "🏴\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}" },
  NIR: { iso2: "GB", name: "Northern Ireland" }, // no standard emoji flag → union flag
  IRL: { iso2: "IE", name: "Ireland" },
  POR: { iso2: "PT", name: "Portugal" },
  NED: { iso2: "NL", name: "Netherlands" },
  BEL: { iso2: "BE", name: "Belgium" },
  ITA: { iso2: "IT", name: "Italy" },
  CRO: { iso2: "HR", name: "Croatia" },
  SUI: { iso2: "CH", name: "Switzerland" },
  DEN: { iso2: "DK", name: "Denmark" },
  POL: { iso2: "PL", name: "Poland" },
  SRB: { iso2: "RS", name: "Serbia" },
  SWE: { iso2: "SE", name: "Sweden" },
  NOR: { iso2: "NO", name: "Norway" },
  AUT: { iso2: "AT", name: "Austria" },
  TUR: { iso2: "TR", name: "Türkiye" },
  GRE: { iso2: "GR", name: "Greece" },
  UKR: { iso2: "UA", name: "Ukraine" },
  CZE: { iso2: "CZ", name: "Czechia" },
  RUS: { iso2: "RU", name: "Russia" },
  ROU: { iso2: "RO", name: "Romania" },
  HUN: { iso2: "HU", name: "Hungary" },
  BUL: { iso2: "BG", name: "Bulgaria" },
  SVK: { iso2: "SK", name: "Slovakia" },
  SVN: { iso2: "SI", name: "Slovenia" },
  FIN: { iso2: "FI", name: "Finland" },
  ISL: { iso2: "IS", name: "Iceland" },
  ALB: { iso2: "AL", name: "Albania" },
  GEO: { iso2: "GE", name: "Georgia" },
  ARM: { iso2: "AM", name: "Armenia" },
  AZE: { iso2: "AZ", name: "Azerbaijan" },
  BIH: { iso2: "BA", name: "Bosnia and Herzegovina" },
  MKD: { iso2: "MK", name: "North Macedonia" },
  MNE: { iso2: "ME", name: "Montenegro" },
  LUX: { iso2: "LU", name: "Luxembourg" },
  CYP: { iso2: "CY", name: "Cyprus" },
  ISR: { iso2: "IL", name: "Israel" },
  KVX: { iso2: "XK", name: "Kosovo" },
  BLR: { iso2: "BY", name: "Belarus" },
  MDA: { iso2: "MD", name: "Moldova" },
  LVA: { iso2: "LV", name: "Latvia" },
  LTU: { iso2: "LT", name: "Lithuania" },
  EST: { iso2: "EE", name: "Estonia" },
  MLT: { iso2: "MT", name: "Malta" },
  FRO: { iso2: "FO", name: "Faroe Islands" },

  // ── CONMEBOL ──
  BRA: { iso2: "BR", name: "Brazil" },
  ARG: { iso2: "AR", name: "Argentina" },
  URU: { iso2: "UY", name: "Uruguay" },
  COL: { iso2: "CO", name: "Colombia" },
  CHI: { iso2: "CL", name: "Chile" },
  PER: { iso2: "PE", name: "Peru" },
  ECU: { iso2: "EC", name: "Ecuador" },
  PAR: { iso2: "PY", name: "Paraguay" },
  VEN: { iso2: "VE", name: "Venezuela" },
  BOL: { iso2: "BO", name: "Bolivia" },

  // ── CONCACAF ──
  USA: { iso2: "US", name: "United States" },
  MEX: { iso2: "MX", name: "Mexico" },
  CAN: { iso2: "CA", name: "Canada" },
  CRC: { iso2: "CR", name: "Costa Rica" },
  PAN: { iso2: "PA", name: "Panama" },
  HON: { iso2: "HN", name: "Honduras" },
  JAM: { iso2: "JM", name: "Jamaica" },
  SLV: { iso2: "SV", name: "El Salvador" },
  GUA: { iso2: "GT", name: "Guatemala" },
  HAI: { iso2: "HT", name: "Haiti" },
  TRI: { iso2: "TT", name: "Trinidad and Tobago" },
  CUB: { iso2: "CU", name: "Cuba" },
  CUW: { iso2: "CW", name: "Curaçao" },
  SUR: { iso2: "SR", name: "Suriname" },

  // ── CAF ──
  MAR: { iso2: "MA", name: "Morocco" },
  SEN: { iso2: "SN", name: "Senegal" },
  NGA: { iso2: "NG", name: "Nigeria" },
  GHA: { iso2: "GH", name: "Ghana" },
  CMR: { iso2: "CM", name: "Cameroon" },
  CIV: { iso2: "CI", name: "Côte d’Ivoire" },
  ALG: { iso2: "DZ", name: "Algeria" },
  TUN: { iso2: "TN", name: "Tunisia" },
  EGY: { iso2: "EG", name: "Egypt" },
  RSA: { iso2: "ZA", name: "South Africa" },
  MLI: { iso2: "ML", name: "Mali" },
  BFA: { iso2: "BF", name: "Burkina Faso" },
  CPV: { iso2: "CV", name: "Cape Verde" },
  GUI: { iso2: "GN", name: "Guinea" },
  COD: { iso2: "CD", name: "DR Congo" },
  CGO: { iso2: "CG", name: "Congo" },
  GAB: { iso2: "GA", name: "Gabon" },
  ANG: { iso2: "AO", name: "Angola" },
  ZAM: { iso2: "ZM", name: "Zambia" },
  ZIM: { iso2: "ZW", name: "Zimbabwe" },
  UGA: { iso2: "UG", name: "Uganda" },
  KEN: { iso2: "KE", name: "Kenya" },
  TAN: { iso2: "TZ", name: "Tanzania" },
  BEN: { iso2: "BJ", name: "Benin" },
  TOG: { iso2: "TG", name: "Togo" },
  MTN: { iso2: "MR", name: "Mauritania" },
  GAM: { iso2: "GM", name: "Gambia" },
  NAM: { iso2: "NA", name: "Namibia" },
  MOZ: { iso2: "MZ", name: "Mozambique" },
  MAD: { iso2: "MG", name: "Madagascar" },
  GNB: { iso2: "GW", name: "Guinea-Bissau" },
  NIG: { iso2: "NE", name: "Niger" },
  LBY: { iso2: "LY", name: "Libya" },
  SUD: { iso2: "SD", name: "Sudan" },
  COM: { iso2: "KM", name: "Comoros" },

  // ── AFC ──
  JPN: { iso2: "JP", name: "Japan" },
  KOR: { iso2: "KR", name: "South Korea" },
  AUS: { iso2: "AU", name: "Australia" },
  IRN: { iso2: "IR", name: "Iran" },
  KSA: { iso2: "SA", name: "Saudi Arabia" },
  QAT: { iso2: "QA", name: "Qatar" },
  UAE: { iso2: "AE", name: "United Arab Emirates" },
  IRQ: { iso2: "IQ", name: "Iraq" },
  JOR: { iso2: "JO", name: "Jordan" },
  UZB: { iso2: "UZ", name: "Uzbekistan" },
  CHN: { iso2: "CN", name: "China" },
  KPR: { iso2: "KP", name: "North Korea" },
  PRK: { iso2: "KP", name: "North Korea" },
  THA: { iso2: "TH", name: "Thailand" },
  VIE: { iso2: "VN", name: "Vietnam" },
  IDN: { iso2: "ID", name: "Indonesia" },
  IND: { iso2: "IN", name: "India" },
  BHR: { iso2: "BH", name: "Bahrain" },
  KUW: { iso2: "KW", name: "Kuwait" },
  OMA: { iso2: "OM", name: "Oman" },
  SYR: { iso2: "SY", name: "Syria" },
  LBN: { iso2: "LB", name: "Lebanon" },
  PLE: { iso2: "PS", name: "Palestine" },
  TKM: { iso2: "TM", name: "Turkmenistan" },
  TJK: { iso2: "TJ", name: "Tajikistan" },
  KGZ: { iso2: "KG", name: "Kyrgyzstan" },
  MAS: { iso2: "MY", name: "Malaysia" },

  // ── OFC ──
  NZL: { iso2: "NZ", name: "New Zealand" },
  FIJ: { iso2: "FJ", name: "Fiji" },
  SOL: { iso2: "SB", name: "Solomon Islands" },
  VAN: { iso2: "VU", name: "Vanuatu" },
  PNG: { iso2: "PG", name: "Papua New Guinea" },
  NCL: { iso2: "NC", name: "New Caledonia" },
  TAH: { iso2: "PF", name: "Tahiti" },
};

const NEUTRAL_FLAG = "🏳️";

/** English region names for any ISO alpha-2 not covered explicitly above. */
let _regionNames: Intl.DisplayNames | null = null;
function regionNames(): Intl.DisplayNames | null {
  if (_regionNames) return _regionNames;
  try {
    _regionNames = new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    _regionNames = null;
  }
  return _regionNames;
}

/** A 2- or 3-letter all-caps token — the shape of a raw code we must never show. */
export function isRawCountryCode(s: string | null | undefined): boolean {
  return !!s && /^[A-Z]{2,3}$/.test(s.trim());
}

/** Regional-indicator flag emoji for an ISO 3166-1 alpha-2 code (e.g. "ES" → 🇪🇸). */
export function flagEmojiFromIso2(iso2: string): string {
  const cc = iso2.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return NEUTRAL_FLAG;
  const A = 0x1f1e6; // regional indicator "A"
  return String.fromCodePoint(A + (cc.charCodeAt(0) - 65), A + (cc.charCodeAt(1) - 65));
}

/** ISO 3166-1 alpha-2 for a FIFA code, or null for non-ISO members / unknowns. */
export function iso2ForFifa(fifaCode: string | null | undefined): string | null {
  if (!fifaCode) return null;
  return FIFA_COUNTRIES[fifaCode.trim().toUpperCase()]?.iso2 ?? null;
}

/** Flag emoji for a FIFA code. Bound to the same entry as {@link countryName}. */
export function countryFlag(fifaCode: string | null | undefined): string {
  if (!fifaCode) return NEUTRAL_FLAG;
  const entry = FIFA_COUNTRIES[fifaCode.trim().toUpperCase()];
  if (!entry) return NEUTRAL_FLAG;
  if (entry.iso2 == null) return entry.flag;
  return entry.flag ?? flagEmojiFromIso2(entry.iso2);
}

/**
 * Real country name for a FIFA code. Falls back to a caller-supplied canonical
 * name (the DB `name`) when the code is unknown, then to Intl.DisplayNames —
 * but never returns the raw abbreviation.
 */
export function countryName(
  fifaCode: string | null | undefined,
  fallbackName?: string | null,
): string {
  const code = fifaCode?.trim().toUpperCase();
  const entry = code ? FIFA_COUNTRIES[code] : undefined;
  if (entry) return entry.name;

  // Prefer a real canonical name from the source over any code.
  if (fallbackName && !isRawCountryCode(fallbackName)) return fallbackName;

  // Last resort: if the code is itself a valid ISO alpha-2, resolve it.
  if (code && /^[A-Z]{2}$/.test(code)) {
    const resolved = regionNames()?.of(code);
    if (resolved && resolved !== code) return resolved;
  }
  // Never surface the raw code — an empty name lets the flag stand alone.
  return fallbackName && !isRawCountryCode(fallbackName) ? fallbackName : "";
}

/** Convenience: name + flag + iso2 resolved together from one FIFA code. */
export interface CountryIdentity {
  iso2: string | null;
  name: string;
  flag: string;
}
export function countryIdentity(
  fifaCode: string | null | undefined,
  fallbackName?: string | null,
): CountryIdentity {
  return {
    iso2: iso2ForFifa(fifaCode),
    name: countryName(fifaCode, fallbackName),
    flag: countryFlag(fifaCode),
  };
}
