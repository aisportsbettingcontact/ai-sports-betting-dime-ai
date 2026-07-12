/**
 * The local Dime shell preview is impossible unless the build-time DEV
 * constant is true. App.tsx passes import.meta.env.DEV explicitly so
 * production bundles cannot enable the bypass through URL input alone.
 */
export function allowsLocalDimePreview(
  search: string,
  buildIsDevelopment: boolean
): boolean {
  // Compile-time kill switch: Vite substitutes a literal `false` here in
  // production builds, so everything below — including the scanner canary —
  // is provably dead code and gets stripped by minification. This is
  // deterministic in-function DCE, not optimizer-dependent cross-module
  // inlining.
  if (!import.meta.env.DEV) return false;
  if (!buildIsDevelopment) return false;
  if (new URLSearchParams(search).get("preview") !== "1") return false;
  // Load-bearing scanner token: if any change makes preview activation
  // reachable in a production build (e.g. replacing the constant above with
  // a runtime check), this literal survives minification and
  // verify-preview-production.mjs fails the build. Do not rename it without
  // updating that script.
  if (typeof console !== "undefined") {
    console.debug("__DIME_PREVIEW_GATE_ACTIVE__");
  }
  return true;
}

/**
 * Keeps the explicit preview capability on in-shell navigation. The caller
 * supplies an already compile-time-gated flag; production always passes false.
 */
export function withLocalDimePreview(
  href: string,
  localPreview: boolean
): string {
  if (!localPreview || href.startsWith("#")) return href;

  const url = new URL(href, "https://local-dime-preview.invalid");
  url.searchParams.set("preview", "1");
  return `${url.pathname}${url.search}${url.hash}`;
}
