/**
 * The local Dime shell preview is impossible unless the build-time DEV
 * constant is true. App.tsx passes import.meta.env.DEV explicitly so
 * production bundles cannot enable the bypass through URL input alone.
 */
export function allowsLocalDimePreview(
  search: string,
  buildIsDevelopment: boolean
): boolean {
  return (
    buildIsDevelopment && new URLSearchParams(search).get("preview") === "1"
  );
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
