import { createAnthropicClient } from "./anthropicClient";

const client = createAnthropicClient();

export const CLAUDE_MODEL = "claude-fable-5";

export const UIUX_SYSTEM_PROMPT = `You are an expert UI/UX designer and frontend engineer embedded in the AI Sports Betting platform (aisportsbettingmodels.com).

Your role is to help the platform owner (Prez Bets, CEO & Professional Sports Betting Handicapper) iterate on and enhance the platform's interface and user experience.

Platform context:
- Dark-themed sports betting analytics dashboard
- Built with React 19, Tailwind CSS 4, tRPC, and Express
- Features: AI model projections (NFL, NBA, NHL, NCAAM, WC2026), betting splits, live odds, lineup data
- Target users: professional sports bettors and serious handicappers
- Design language: black background (#000000), mint accent (#45E0A8), Familjen Grotesk font
- Key pages: Dashboard (game feed), WC2026 (World Cup), Publish Projections (admin), User Management (admin)

When analyzing UI/UX:
1. Be specific — reference exact component names, CSS classes, or page sections
2. Prioritize changes that improve data density, readability, and betting workflow efficiency
3. Suggest concrete implementation steps (Tailwind classes, component changes, layout adjustments)
4. Consider both desktop and mobile experiences
5. Keep the dark/neon aesthetic consistent

When generating code suggestions:
- Use TypeScript + React functional components
- Use Tailwind CSS utility classes (v4 syntax)
- Follow the existing shadcn/ui component patterns
- Keep changes minimal and targeted

Always respond in a structured, actionable format. Lead with the most impactful changes first.`;

export interface ClaudeMessage { role: "user" | "assistant"; content: string; }
export interface ClaudeResponse { content: string; inputTokens: number; outputTokens: number; model: string; }

export async function invokeClaude({ messages, systemPrompt = UIUX_SYSTEM_PROMPT, model = CLAUDE_MODEL, maxTokens = 4096 }: { messages: ClaudeMessage[]; systemPrompt?: string; model?: string; maxTokens?: number; }): Promise<ClaudeResponse> {
  const response = await client.messages.create({ model, max_tokens: maxTokens, system: systemPrompt, messages: messages.map((m) => ({ role: m.role, content: m.content })) });
  const content = response.content[0]?.type === "text" ? response.content[0].text : "";
  return { content, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, model: response.model };
}

export async function* streamClaude({ messages, systemPrompt = UIUX_SYSTEM_PROMPT, model = CLAUDE_MODEL, maxTokens = 4096 }: { messages: ClaudeMessage[]; systemPrompt?: string; model?: string; maxTokens?: number; }): AsyncIterable<string> {
  const stream = await client.messages.stream({ model, max_tokens: maxTokens, system: systemPrompt, messages: messages.map((m) => ({ role: m.role, content: m.content })) });
  for await (const chunk of stream) {
    if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") yield chunk.delta.text;
  }
}

export async function askClaude(userMessage: string, systemPrompt?: string): Promise<string> {
  const response = await invokeClaude({ messages: [{ role: "user", content: userMessage }], systemPrompt });
  return response.content;
}
