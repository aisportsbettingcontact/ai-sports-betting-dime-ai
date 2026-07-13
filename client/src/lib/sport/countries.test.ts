import { describe, it, expect } from "vitest";
import {
  countryFlag,
  countryName,
  countryIdentity,
  flagEmojiFromIso2,
  iso2ForFifa,
  isRawCountryCode,
} from "./countries";

describe("flagEmojiFromIso2", () => {
  it("builds regional-indicator flags from alpha-2 codes", () => {
    expect(flagEmojiFromIso2("ES")).toBe("🇪🇸");
    expect(flagEmojiFromIso2("fr")).toBe("🇫🇷");
    expect(flagEmojiFromIso2("US")).toBe("🇺🇸");
  });
  it("returns a neutral flag for invalid input, never the code", () => {
    expect(flagEmojiFromIso2("ESP")).toBe("🏳️");
    expect(flagEmojiFromIso2("")).toBe("🏳️");
  });
});

describe("countryName", () => {
  it("maps FIFA codes to real country names", () => {
    expect(countryName("ESP")).toBe("Spain");
    expect(countryName("FRA")).toBe("France");
    expect(countryName("GER")).toBe("Germany");
    expect(countryName("KOR")).toBe("South Korea");
  });
  it("resolves non-ISO FIFA members", () => {
    expect(countryName("ENG")).toBe("England");
    expect(countryName("SCO")).toBe("Scotland");
    expect(countryName("WAL")).toBe("Wales");
  });
  it("never returns a raw abbreviation for an unknown code", () => {
    expect(countryName("ZZZ")).toBe("");
    expect(countryName("ZZZ", "Neverland")).toBe("Neverland");
    // a raw-looking fallback is rejected, not passed through
    expect(countryName("ZZZ", "ZZ")).toBe("");
    expect(isRawCountryCode(countryName("ESP"))).toBe(false);
  });
});

describe("countryFlag / iso2ForFifa", () => {
  it("returns the flag bound to the code's ISO identity", () => {
    expect(countryFlag("ESP")).toBe("🇪🇸");
    expect(countryFlag("FRA")).toBe("🇫🇷");
    expect(iso2ForFifa("ESP")).toBe("ES");
    expect(iso2ForFifa("FRA")).toBe("FR");
  });
  it("uses explicit emoji for non-ISO members", () => {
    expect(countryFlag("ENG")).toContain("🏴");
    expect(iso2ForFifa("ENG")).toBeNull();
  });
  it("returns a neutral flag (never the code) for unknowns", () => {
    expect(countryFlag("ZZZ")).toBe("🏳️");
    expect(countryFlag(null)).toBe("🏳️");
  });
});

describe("countryIdentity — name, flag, and iso2 come from ONE code", () => {
  it("binds all three fields to the same source code", () => {
    const spain = countryIdentity("ESP", "Spain");
    expect(spain).toEqual({ iso2: "ES", name: "Spain", flag: "🇪🇸" });
    // the flag is derivable from the same iso2 the name was resolved from
    expect(spain.flag).toBe(flagEmojiFromIso2(spain.iso2 as string));

    const france = countryIdentity("FRA", "France");
    expect(france.flag).toBe(flagEmojiFromIso2(france.iso2 as string));
    expect(france.name).toBe("France");
  });
});

describe("isRawCountryCode", () => {
  it("flags 2–3 letter all-caps tokens", () => {
    expect(isRawCountryCode("ESP")).toBe(true);
    expect(isRawCountryCode("FR")).toBe(true);
    expect(isRawCountryCode("Spain")).toBe(false);
    expect(isRawCountryCode("")).toBe(false);
    expect(isRawCountryCode(null)).toBe(false);
  });
});
