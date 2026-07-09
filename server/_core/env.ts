export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: (() => {
    const v = process.env.JWT_SECRET;
    if (!v) throw new Error("[BOOT] JWT_SECRET is not set — server cannot start");
    return v;
  })(),
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  vsinEmail: process.env.VSIN_EMAIL ?? "",
  vsinPassword: process.env.VSIN_PASSWORD ?? "",
  // ── Canonical public origin for OAuth redirect URIs ────────────────────────
  // CRITICAL: Never derive this from x-forwarded-host or req.host.
  // Behind the edge proxy, x-forwarded-host resolves to the internal
  // Cloud Run hostname (*.a.run.app), NOT the public domain. Discord (and any
  // other OAuth provider) will reject the redirect_uri if it doesn't exactly
  // match a registered URI. Set PUBLIC_ORIGIN to https://aisportsbettingmodels.com
  // in production secrets, or leave empty to fall back to request-derived origin
  // (safe for local dev where there is no proxy).
  publicOrigin: process.env.PUBLIC_ORIGIN ?? "",
  // Discord integration
  discordBotToken: process.env.DISCORD_BOT_TOKEN ?? "",
  discordClientId: process.env.DISCORD_CLIENT_ID ?? "",
  discordClientSecret: process.env.DISCORD_CLIENT_SECRET ?? "",
  discordPublicKey: process.env.DISCORD_PUBLIC_KEY ?? "",
  discordGuildId: process.env.DISCORD_GUILD_ID ?? "",
  discordRoleAiModelSub: process.env.DISCORD_ROLE_AI_MODEL_SUB ?? "",
  // Google Sheets IDs — non-secret but kept in env for configurability
  // Must be set via NBA_SHEET_ID env var — no hardcoded fallback permitted
  nbaSheetId: process.env.NBA_SHEET_ID ?? "",
  // ─── Stripe ──────────────────────────────────────────────────────────────────
  stripeSecretKey: (() => {
    const v = process.env.STRIPE_SECRET_KEY;
    if (!v) throw new Error("[BOOT] STRIPE_SECRET_KEY is not set — server cannot start");
    return v;
  })(),
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  // Stripe Price IDs — must be created in Stripe Dashboard and set as env vars
  // STRIPE_PRICE_MONTHLY: $49/month recurring price ID (price_xxx)
  // STRIPE_PRICE_ANNUAL:  $399/year recurring price ID (price_xxx)
  stripePriceMonthly: process.env.STRIPE_PRICE_MONTHLY ?? "",
  stripePriceAnnual: process.env.STRIPE_PRICE_ANNUAL ?? "",
};
