export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Generate login URL at runtime so redirect URI reflects the current origin.
// On Railway VITE_OAUTH_PORTAL_URL/VITE_APP_ID are unset, and
// `new URL("undefined/app-auth")` throws. useAuth() evaluates this as a default
// parameter on every call, so that throw crashes every page calling useAuth.
export const getLoginUrl = () => {
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;
  if (!oauthPortalUrl || !appId) return "/login";

  // useAuth() evaluates this as a default parameter on every render, so this
  // function must NEVER throw. A malformed VITE_OAUTH_PORTAL_URL would make
  // `new URL()` throw and crash every page calling useAuth — guard against it.
  try {
    const redirectUri = `${window.location.origin}/api/oauth/callback`;
    const state = btoa(redirectUri);

    const url = new URL(`${oauthPortalUrl}/app-auth`);
    url.searchParams.set("appId", appId);
    url.searchParams.set("redirectUri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("type", "signIn");

    return url.toString();
  } catch {
    return "/login";
  }
};
