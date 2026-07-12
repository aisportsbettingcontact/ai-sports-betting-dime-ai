/**
 * The local chat preview is impossible unless the build-time DEV constant is
 * true. App.tsx passes import.meta.env.DEV explicitly so production bundles
 * cannot enable the bypass through URL input alone.
 */
export function allowsLocalChatPreview(
  search: string,
  buildIsDevelopment: boolean
): boolean {
  return (
    buildIsDevelopment && new URLSearchParams(search).get("preview") === "1"
  );
}
