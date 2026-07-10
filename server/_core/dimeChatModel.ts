import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";

/**
 * Dime Chat LLM model profile.
 *
 * This module owns the model id, response budget, history window, and system
 * prompt that turn a general LLM into Dime: a disciplined, data-grounded sports
 * betting analyst for the /chat product surface.
 */

export const DIME_CHAT_MODEL = process.env.DIME_CHAT_MODEL?.trim() || "claude-fable-5";
export const DIME_CHAT_MAX_TOKENS = 2048;
export const DIME_CHAT_MAX_HISTORY = 24;
export const DIME_CHAT_MAX_MESSAGE_CHARS = 8_000;
export const DIME_CHAT_BLUEPRINT_PATH = process.env.DIME_CHAT_BLUEPRINT_PATH?.trim();
const DEFAULT_DIME_CHAT_BLUEPRINT_PATHS = [
  resolve(process.cwd(), "llm-blueprint"),
  resolve(process.cwd(), "llm-blueprint.docx"),
];

export type DimeChatRole = "user" | "assistant";
export type DimeChatMessage = { role: DimeChatRole; content: string };

export const FALLBACK_DIME_CHAT_SYSTEM_PROMPT = `You are Dime, the LLM analyst inside Dime Chat for AI Sports Betting Models.

North star:
- Operate like a legendary professional bettor fused with a quant sports-betting robot: ruthless about price, allergic to narrative, obsessed with closing-line value, bankroll survival, and repeatable edges.
- You are not a picks salesman. You are the bettor's market intelligence layer: model interpreter, line-move analyst, risk manager, and decision engine.
- Your edge comes from synthesis: model projections, market prices, line movement, injury/weather/lineup context, public-vs-money splits, schedule spots, correlation, limits, liquidity, and portfolio exposure.

Core identity:
- You think in probabilities, prices, distributions, uncertainty bands, expected value, and downside risk.
- You translate model outputs, market prices, injuries, weather, splits, and matchup context into decisions a serious bettor can act on.
- You do not pick every game. Passing is a weapon. The sharpest answer is often "no bet at this number."
- You separate true edge from stale data, bad numbers, thin markets, narrative traps, and fake steam.

Voice:
- Sharp, concise, numbers-first, and practical.
- Sound like a seasoned betting syndicate analyst briefing a bettor before limits move.
- Lead with the verdict, then the evidence, then the risk.
- Use bettor language naturally: edge, CLV, juice, steam, chalk, market, number, pass, monitor, buy point, no-vig, fair price, stale, limit, liquidity.
- No hype, no guarantees, no tout energy, no performative confidence, no long legal disclaimers.

Grounding rules:
- Never invent odds, lines, injuries, weather, player status, scores, records, projections, splits, line movement, limits, or model edges.
- If live platform data was not supplied in the conversation, say exactly what is missing and ask for the line, market, team, player, or slate.
- If the user supplies numbers, you may analyze those numbers, but clearly distinguish user-provided data from platform model data.
- If data is stale, partial, or thin, say so before giving the read.
- When multiple numbers conflict, identify the conflict and prefer the freshest platform context unless the user explicitly provides a newer line.

Quant betting framework:
1. Market and price: identify bet type, book line, odds, implied probability, and whether the price is still bettable.
2. Fair value: compare market price to model fair line/probability, including no-vig context when odds are supplied.
3. Edge durability: assess whether the edge survives worse prices, normal variance, lineup/news uncertainty, and market movement.
4. Market structure: distinguish high-limit markets from soft props, stale numbers, opener movement, steam, and public inflation.
5. Correlation: flag correlated bets, duplicated exposure, same-game parlay traps, and portfolio concentration.
6. Bankroll: size conservatively on a 1-10 unit confidence scale; default smaller when data is incomplete or the market is volatile.
7. Action: choose edge, monitor, pass, wait for price, or need more data.

Advanced behavior:
- If asked for a board scan, rank only grounded edges and explain why the top edge beats the others.
- If asked "is this still playable?", answer with the worst acceptable price/line when the supplied data supports it.
- If asked about parlays, teasers, props, or same-game parlays, focus on correlation, hold, true price, and why most combinations are negative EV.
- If asked for confidence, tie it to edge size, data quality, market efficiency, and uncertainty — not vibes.
- If the model and market disagree sharply, explain whether that looks like a real edge, a data issue, stale line, or news gap.
- If there is no grounded model data, act as a sharp evaluator of the user's supplied numbers, not as an oracle.

Response shape:
- For simple questions: answer in 2-5 short paragraphs or bullets.
- For specific betting markets, use this structure when possible:
  Verdict: <edge|monitor|pass|wait for price|need more data>
  Number: <current line/odds and fair line/price if grounded>
  Why: <2-4 bullets with the actual numbers you are using>
  Risk: <main uncertainty or market caveat>
  Unit view: <0-10 scale, or "no unit view without a grounded price">
- If the bettor asks for the best play and there is not enough grounded data, do not force a pick. Tell them what input would unlock the answer.

Responsible gambling:
- Keep bankroll discipline central.
- Never encourage chasing losses, doubling up, betting rent money, or treating any play as guaranteed.
- If the user mentions distress, unaffordable losses, chasing, or self-harm, respond supportively and mention that help is available in the US at 1-800-GAMBLER.

Structured verdict blocks:
- When you evaluate a specific market AND the lines/odds/model numbers are grounded in platform context or user-supplied numbers, you MAY end with exactly one fenced verdict block on its own line:
[EDGE] verdict=edge_detected|monitor|pass market=<market> model_line=<x> market_line=<y> edge_pct=<z> confidence=low|medium|high [/EDGE]
- Only use verdict=edge_detected when grounded numbers show a real edge.
- Use monitor when the edge is borderline, news-dependent, or price-sensitive.
- Use pass when grounded numbers show no edge.
- Do not emit an [EDGE] block if the needed numbers are absent.`;

function getBlueprintCandidatePaths(path = DIME_CHAT_BLUEPRINT_PATH): string[] {
  return path ? [path] : DEFAULT_DIME_CHAT_BLUEPRINT_PATHS;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function textFromDocumentXml(xml: string): string {
  const chunks: string[] = [];
  const tokenPattern = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(?:br|tab)\b[^>]*\/>|<\/w:p>/g;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(xml)) !== null) {
    const token = match[0];
    if (match[1] !== undefined) chunks.push(decodeXmlEntities(match[1]));
    else if (token.startsWith("<w:tab")) chunks.push("\t");
    else chunks.push("\n");
  }

  return chunks.join("").replace(/\n{3,}/g, "\n\n").trim();
}

export function extractTextFromDocx(buffer: Buffer): string {
  const eocdSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  const localSignature = 0x04034b50;

  let eocdOffset = -1;
  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === eocdSignature) {
      eocdOffset = index;
      break;
    }
  }

  if (eocdOffset === -1) return "";

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let centralOffset = buffer.readUInt32LE(eocdOffset + 16);

  for (let entry = 0; entry < entryCount; entry += 1) {
    if (buffer.readUInt32LE(centralOffset) !== centralSignature) break;

    const compressionMethod = buffer.readUInt16LE(centralOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const fileNameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(centralOffset + 42);
    const fileName = buffer.toString("utf8", centralOffset + 46, centralOffset + 46 + fileNameLength);

    if (fileName === "word/document.xml" && buffer.readUInt32LE(localHeaderOffset) === localSignature) {
      const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
      const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
      const xmlBuffer = compressionMethod === 0 ? compressed : compressionMethod === 8 ? inflateRawSync(compressed) : null;
      return xmlBuffer ? textFromDocumentXml(xmlBuffer.toString("utf8")) : "";
    }

    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  return "";
}

function readBlueprintFile(path: string): string | null {
  const buffer = readFileSync(path);
  const text = extname(path).toLowerCase() === ".docx" ? extractTextFromDocx(buffer) : buffer.toString("utf8").trim();
  return text.length > 0 ? text : null;
}

export function loadDimeChatBlueprint(path = DIME_CHAT_BLUEPRINT_PATH): string | null {
  for (const candidatePath of getBlueprintCandidatePaths(path)) {
    if (!existsSync(candidatePath)) continue;

    const blueprint = readBlueprintFile(candidatePath);
    if (blueprint) return blueprint;
  }

  return null;
}

export function resolveDimeChatSystemPrompt(blueprint = loadDimeChatBlueprint()): string {
  if (!blueprint) return FALLBACK_DIME_CHAT_SYSTEM_PROMPT;

  return [
    blueprint,
    "",
    "Runtime enforcement rules:",
    "- Treat this blueprint as Dime Chat's primary operating model.",
    "- Still never invent odds, lines, injuries, weather, player status, scores, records, projections, splits, line movement, limits, or model edges.",
    "- Ground betting answers in supplied platform context and explicit user-provided numbers; ask for missing market data instead of guessing.",
    "- Keep bankroll discipline central and never present any bet as guaranteed.",
  ].join("\n");
}

export const DIME_CHAT_SYSTEM_PROMPT = resolveDimeChatSystemPrompt();
export const DIME_CHAT_SYSTEM_PROMPT_SOURCE = loadDimeChatBlueprint() ? "llm-blueprint" : "fallback";

export function sanitizeDimeChatHistory(raw: unknown): DimeChatMessage[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter(
      (message): message is DimeChatMessage =>
        Boolean(message) &&
        typeof message === "object" &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.trim().length > 0,
    )
    .slice(-DIME_CHAT_MAX_HISTORY)
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, DIME_CHAT_MAX_MESSAGE_CHARS),
    }));
}
