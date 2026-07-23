/**
 * Shared Anthropic client factory — direct API or an Anthropic-compatible gateway.
 *
 * Credential resolution (first match wins):
 *   ANTHROPIC_AUTH_TOKEN → Authorization: Bearer …   (gateway API key)
 *   ANTHROPIC_API_KEY    → x-api-key: …              (direct Anthropic)
 *
 * ANTHROPIC_BASE_URL overrides the API host (e.g. an Anthropic-compatible gateway).
 * When unset, the SDK talks to api.anthropic.com directly.
 *
 * Only one credential is ever sent — the API rejects requests that carry
 * both an x-api-key header and an Authorization bearer token.
 */
import Anthropic from "@anthropic-ai/sdk";

export interface AnthropicConnectionConfig {
  /** null (not undefined) when authToken wins — undefined would let the SDK
   *  fall back to process.env.ANTHROPIC_API_KEY and send both auth headers. */
  apiKey?: string | null;
  authToken?: string;
  baseURL?: string;
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function resolveAnthropicConfig(): AnthropicConnectionConfig {
  const authToken = readEnv("ANTHROPIC_AUTH_TOKEN");
  return {
    authToken,
    apiKey: authToken ? null : readEnv("ANTHROPIC_API_KEY"),
    baseURL: readEnv("ANTHROPIC_BASE_URL"),
  };
}

export function hasAnthropicCredentials(): boolean {
  const { apiKey, authToken } = resolveAnthropicConfig();
  return Boolean(apiKey || authToken);
}

export function createAnthropicClient(): Anthropic {
  return new Anthropic(resolveAnthropicConfig());
}
