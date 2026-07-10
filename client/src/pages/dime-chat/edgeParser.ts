/**
 * Deterministic, prefix-stable parser for the fenced [EDGE] verdict block.
 * Visual source of truth: design/frozen/dime-ai-home-{dark,light}.html — do not restyle.
 *
 * Grammar (product blueprint §11 — the ONLY thing this parser recognizes):
 *   [EDGE] verdict=edge_detected|monitor|pass market=<market> model_line=<x>
 *          market_line=<y> edge_pct=<z> confidence=low|medium|high [/EDGE]
 *
 * Contract:
 *  - Parses ONLY the fenced block, never prose.
 *  - Prefix-stable while streaming: a partial "[EDGE" (open marker or unclosed
 *    block) is emitted as a hidden `pending` segment — it must never flash as
 *    visible text and never render as a half-drawn card.
 *  - Once the stream is done, anything unclosed/malformed falls back to plain
 *    text (honest degradation — chat-derivation-spec.md §2.4 streaming rule).
 *  - Pure function: same (content, streamDone) => same segmentation.
 */

export type EdgeVerdict = "edge_detected" | "monitor" | "pass";
export type EdgeConfidence = "low" | "medium" | "high";

export interface EdgeBlock {
  verdict: EdgeVerdict;
  market: string;
  modelLine: string;
  marketLine: string;
  edgePct: string;
  confidence: EdgeConfidence;
}

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "edge"; block: EdgeBlock }
  /** Buffered partial marker/unclosed block while streaming — render nothing. */
  | { kind: "pending"; raw: string };

const OPEN = "[EDGE]";
const CLOSE = "[/EDGE]";

/**
 * Body grammar between the fences. `market` may contain spaces (matched lazily
 * up to ` model_line=`); the numeric-ish fields are single tokens, kept as raw
 * strings so display never reformats the model's numbers.
 */
const BODY_RE =
  /^\s*verdict=(edge_detected|monitor|pass)\s+market=(.+?)\s+model_line=(\S+)\s+market_line=(\S+)\s+edge_pct=(\S+)\s+confidence=(low|medium|high)\s*$/;

function parseBody(body: string): EdgeBlock | null {
  const m = BODY_RE.exec(body);
  if (!m) return null;
  return {
    verdict: m[1] as EdgeVerdict,
    market: m[2],
    modelLine: m[3],
    marketLine: m[4],
    edgePct: m[5],
    confidence: m[6] as EdgeConfidence,
  };
}

/** Length of the longest suffix of `text` that is a proper prefix of OPEN. */
function partialOpenSuffixLength(text: string): number {
  const max = Math.min(text.length, OPEN.length - 1);
  for (let len = max; len > 0; len--) {
    if (text.endsWith(OPEN.slice(0, len))) return len;
  }
  return 0;
}

export function parseAssistantContent(
  content: string,
  streamDone: boolean,
): Segment[] {
  const segments: Segment[] = [];
  const pushText = (text: string) => {
    if (text.length === 0) return;
    const last = segments[segments.length - 1];
    if (last && last.kind === "text") last.text += text;
    else segments.push({ kind: "text", text });
  };

  let cursor = 0;
  while (cursor <= content.length) {
    const open = content.indexOf(OPEN, cursor);
    if (open === -1) {
      const tail = content.slice(cursor);
      if (!streamDone) {
        const partial = partialOpenSuffixLength(tail);
        if (partial > 0) {
          pushText(tail.slice(0, tail.length - partial));
          segments.push({ kind: "pending", raw: tail.slice(tail.length - partial) });
          return segments;
        }
      }
      pushText(tail);
      return segments;
    }

    pushText(content.slice(cursor, open));
    const close = content.indexOf(CLOSE, open + OPEN.length);
    if (close === -1) {
      const raw = content.slice(open);
      if (streamDone) pushText(raw);
      else segments.push({ kind: "pending", raw });
      return segments;
    }

    const body = content.slice(open + OPEN.length, close);
    const block = parseBody(body);
    if (block) segments.push({ kind: "edge", block });
    else pushText(content.slice(open, close + CLOSE.length)); // malformed → honest raw text
    cursor = close + CLOSE.length;
    if (cursor === content.length) return segments;
  }
  return segments;
}

/* ----------------------------------------------------------------------------
 * Numeral segmentation for assistant prose.
 * chat-derivation-spec.md §5: odds, lines, edges, prices, records and
 * percentages render in IBM Plex Mono 500 with tabular-nums. Conservative by
 * design: bare integers (dates, sim counts) stay in the body face.
 * -------------------------------------------------------------------------- */

export type NumeralPart = { kind: "plain" | "num"; text: string };

const NUMERAL_RE =
  /(\$\d+(?:\.\d+)?|[+-]?\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?-\d+(?:\.\d+)?\b|(?<![\w.])[+-]\d+(?:\.\d+)?(?![\d%-]))/g;

export function segmentNumerals(text: string): NumeralPart[] {
  const parts: NumeralPart[] = [];
  let last = 0;
  for (const m of text.matchAll(NUMERAL_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push({ kind: "plain", text: text.slice(last, idx) });
    parts.push({ kind: "num", text: m[0] });
    last = idx + m[0].length;
  }
  if (last < text.length) parts.push({ kind: "plain", text: text.slice(last) });
  return parts;
}
