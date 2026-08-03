import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

/**
 * fontColorLaw.test.ts — the typography & text-color law ratchet
 * (owner directive 2026-08-01: every font on the platform matches the
 * wordmark's form — Familjen Grotesk, white/black ink, mint as the only hue).
 *
 * Site-wide audit findings this test freezes (static sweep + live
 * computed-style sampling of production routes, 2026-08-01):
 *   • Familjen Grotesk is the single typeface — global loader in index.html,
 *     Tailwind `--font-sans`/`--font-mono` both resolve to it, and the
 *     `--dime-font-*` tokens agree.
 *   • Zero chromatic Tailwind text-color classes anywhere in pages,
 *     features, or components (mint rides tokens, not utility classes).
 *   • Approved exceptions, and ONLY these: GG Sans for Discord-affiliated
 *     controls (THREE-COLOR-LAW.md §Discord platform exception) and emoji
 *     fallback stacks for country-flag glyphs.
 *
 * Rules: new-file/new-declaration violations fail immediately. Loosening
 * requires an owner-approved law change, not a test edit.
 */

const CLIENT_SRC = path.resolve(import.meta.dirname);
const INDEX_CSS = path.join(CLIENT_SRC, "index.css");
const INDEX_HTML = path.resolve(CLIENT_SRC, "..", "index.html");

/** Files allowed to declare non-Familjen font-family values, and why. */
const FONT_FAMILY_EXCEPTIONS = new Set([
  // Emoji glyph stacks: country-flag emoji need platform emoji fonts.
  "components/projections/CountryFlag.css",
  "components/projections/ProjectionCard.css",
]);

const CHROMATIC_TEXT_CLASS =
  /text-(blue|red|orange|purple|pink|indigo|violet|cyan|teal|lime|rose|fuchsia|sky|emerald|green|amber|yellow)-[0-9]+/g;

function walk(dir: string, exts: string[], out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.some(ext => entry.name.endsWith(ext))) out.push(full);
  }
}

describe("single-font mandate — Familjen Grotesk everywhere", () => {
  it("index.html loads Familjen Grotesk and no other text font (GG Sans excepted)", () => {
    const html = fs.readFileSync(INDEX_HTML, "utf8");
    expect(html).toMatch(
      /fonts\.googleapis\.com\/css2\?family=Familjen\+Grotesk/
    );
    // The retired faces must never return.
    expect(html).not.toMatch(
      /family=(Inter|IBM\+Plex|JetBrains|Roboto|Open\+Sans)/
    );
  });

  it("Tailwind font tokens resolve to Familjen Grotesk for BOTH sans and mono", () => {
    const css = fs.readFileSync(INDEX_CSS, "utf8");
    expect(css).toMatch(/--font-sans:\s*"Familjen Grotesk"/);
    expect(css).toMatch(/--font-mono:\s*"Familjen Grotesk"/);
  });

  it("the --dime-font tokens agree with the mandate", () => {
    const css = fs.readFileSync(
      path.join(CLIENT_SRC, "styles", "dime-mobile.css"),
      "utf8"
    );
    expect(css).toMatch(/--dime-font-sans:\s*"Familjen Grotesk"/);
  });

  it("every custom font token defined anywhere resolves to Familjen Grotesk", () => {
    // Aliasing guard: `font-family: var(--anything)` is sanctioned below, so
    // every token whose name says it carries a font must resolve to the brand
    // face — a rogue face can't hide behind a custom property.
    const files: string[] = [];
    walk(CLIENT_SRC, [".css", ".tsx", ".ts"], files);
    const offenders: string[] = [];
    const tokenDef =
      /(--[a-z0-9-]*(?:font|sans|mono)[a-z0-9-]*)\s*:\s*([^;]+);/gi;
    for (const file of files) {
      const rel = path.relative(CLIENT_SRC, file).split(path.sep).join("/");
      if (rel === "fontColorLaw.test.ts") continue;
      const src = fs.readFileSync(file, "utf8");
      for (const match of src.matchAll(tokenDef)) {
        const [, name, value] = match;
        if (name === undefined || value === undefined) continue;
        // Non-family tokens (sizes, weights, features) carry no quoted face.
        if (!/["']/.test(value)) continue;
        const sanctioned =
          /Familjen/.test(value) ||
          /GG Sans/.test(value) || // Discord exception token
          /var\(--/.test(value);
        if (!sanctioned)
          offenders.push(`${rel}: ${name}: ${value.trim().slice(0, 70)}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("no source file declares a non-Familjen font-family outside the approved exceptions", () => {
    const files: string[] = [];
    walk(CLIENT_SRC, [".css", ".tsx", ".ts"], files);
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(CLIENT_SRC, file).split(path.sep).join("/");
      if (rel === "fontColorLaw.test.ts") continue;
      const src = fs.readFileSync(file, "utf8");
      for (const line of src.split("\n")) {
        if (!/font-family\s*:/.test(line)) continue;
        const value = line.slice(line.indexOf("font-family"));
        const sanctioned =
          /Familjen/.test(value) ||
          // Any custom-property indirection: the token-resolution test above
          // proves every font token resolves to the brand face.
          /font-family\s*:\s*var\(--/.test(value) ||
          /font-family:\s*inherit/.test(value) ||
          /--font-discord/.test(value) ||
          /GG Sans/.test(value);
        if (!sanctioned && !FONT_FAMILY_EXCEPTIONS.has(rel)) {
          offenders.push(`${rel}: ${value.trim().slice(0, 80)}`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

describe("text-color law — mint is the only hue, via tokens", () => {
  it("zero chromatic Tailwind text-color classes in pages/features/components", () => {
    const files: string[] = [];
    for (const dir of ["pages", "features", "components"]) {
      const full = path.join(CLIENT_SRC, dir);
      if (fs.existsSync(full)) walk(full, [".tsx"], files);
    }
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(CLIENT_SRC, file).split(path.sep).join("/");
      const src = fs.readFileSync(file, "utf8");
      const matches = src.match(CHROMATIC_TEXT_CLASS);
      if (matches)
        offenders.push(`${rel}: ${[...new Set(matches)].join(", ")}`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
