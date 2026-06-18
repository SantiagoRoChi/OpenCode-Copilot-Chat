// filepath: src/tools/toolCallAdapter.ts
// Inline tool-call and reasoning parser for OpenAI-compatible streams.
//
// Local models (LMStudio, Ollama, Qwen, DeepSeek, Hermes, Llama 3.x, Mistral,
// Command-R, Yi, Phi-3.5/4, Granite, etc.) often emit tool calls and reasoning
// inside text content using model-specific XML-style tags, instead of the
// native `delta.tool_calls` and `delta.reasoning_content` fields.
//
// This module provides a tolerant parser that recognizes a wide variety of
// tag shapes and JSON body formats, emits LanguageModelToolCallPart and
// LanguageModelThinkingPart via a single parse() call, and keeps a stable
// callId for tool calls split across multiple chunks.
//
// It has no `vscode` import and is fully testable with node:test.

export interface ParsedToolCall {
  /** Stable id (auto-generated; same body across chunks → same callId). */
  callId: string;
  /** Tool/function name. */
  name: string;
  /** Parsed arguments (object if JSON, raw string otherwise). */
  input: Record<string, unknown> | string;
}

export interface ParsedDelta {
  /** Plain text to surface to the user (after stripping tool and reasoning blocks). */
  text: string;
  /** Reasoning content (collapsible in the chat UI). */
  reasoning: string;
  /** Tool calls detected in this chunk. */
  toolCalls: ParsedToolCall[];
  /** Buffer remainder that should be prepended to the next chunk. */
  leftover: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Tag families
// ────────────────────────────────────────────────────────────────────────────
//
// A *family* groups several open-tag aliases that share a closing tag.
// The parser uses the OPEN regex to find a block start, then searches for
// the corresponding CLOSE regex after the open position. Pairing is
// enforced: an open `<foo>` always closes with `</foo>` or `<|/foo|>` —
// we do NOT cross-mix families so reasoning tags never swallow a tool call
// or vice-versa.

type TagFamily = {
  kind: 'tool' | 'think';
  /** Regex matching any opening tag in this family. */
  openRe: RegExp;
  /** Build a regex that closes the same tag the open matched. */
  closeRe(tagInner: string): RegExp;
};

const TOOL_FAMILIES: TagFamily[] = [
  // Standard XML: <tool_call>, <tool_call>, <toolcall>, <tool>, etc.
  { kind: 'tool', openRe: /<(?:\/?)tool[_-]?calls?>/gi, closeRe: (t) => closeXmlPair(t) },
  // Llama 3.x / Meta: <|tool_call|> ... </|tool_call|>
  { kind: 'tool', openRe: /<\|tool[_-]?calls?\|>/gi, closeRe: (t) => closeAngleBarPair(t) },
  // Mistral / Anthropic: <antml:function_calls>...</antml:function_calls>
  { kind: 'tool', openRe: /<antml:function_calls?>/gi, closeRe: (t) => closeXmlPair(t) },
  // Granite, Phi-3.5, Hermes: <invoke name="x">...</invoke>, <action>, <function>, <tool>.
  // Allow attributes between the name and the closing `>`.
  { kind: 'tool', openRe: /<(?:\/?)(?:invoke|action|function|tool)\b[^>]*>/gi, closeRe: (t) => closeXmlPair(t) },
  // Cohere / Yi: [TOOL_CALL] ... [/TOOL_CALL]
  { kind: 'tool', openRe: /\[TOOL[_]?CALL(?:S)?\]/gi, closeRe: () => /\[\/TOOL[_]?CALL(?:S)?\]/gi },
];

const THINK_FAMILIES: TagFamily[] = [
  { kind: 'think', openRe: /<think(?:ing)?>/gi, closeRe: (t) => closeXmlPair(t) },
  { kind: 'think', openRe: /<reason(?:ing)?>/gi, closeRe: (t) => closeXmlPair(t) },
  { kind: 'think', openRe: /<reflect(?:ion)?>/gi, closeRe: (t) => closeXmlPair(t) },
  { kind: 'think', openRe: /<analysis>/gi, closeRe: (t) => closeXmlPair(t) },
  { kind: 'think', openRe: /<thought>/gi, closeRe: (t) => closeXmlPair(t) },
  { kind: 'think', openRe: /<solution>/gi, closeRe: (t) => closeXmlPair(t) },
  { kind: 'think', openRe: /<plan>/gi, closeRe: (t) => closeXmlPair(t) },
  { kind: 'think', openRe: /<\|think(?:ing)?\|>/gi, closeRe: (t) => closeAngleBarPair(t) },
  { kind: 'think', openRe: /<\|reason(?:ing)?\|>/gi, closeRe: (t) => closeAngleBarPair(t) },
  { kind: 'think', openRe: /\[THINK(?:ING)?\]/gi, closeRe: () => /\[\/THINK(?:ING)?\]/gi },
];

// Markdown-style headers used by some models to delimit reasoning.
// Examples: "### Reasoning\n... \n### Response" (Llama-3-Instruct variants).
// We only flag a header as a reasoning block if a CLOSE is also present,
// so the model can still write "### Reasoning" inside its user-visible
// answer without it being mis-classified.
const MD_HEADER_OPENS: ReadonlyArray<{ re: RegExp; close: RegExp }> = [
  { re: /(^|\n)###\s*Reason(?:ing)?\b[^\n]*\n/gi, close: /(^|\n)###\s*(?!Reason(?:ing)?\b)[A-Za-z][^\n]*\n/gi },
  { re: /(^|\n)###\s*Thought\b[^\n]*\n/gi, close: /(^|\n)###\s*(?!Thought\b)[A-Za-z][^\n]*\n/gi },
  { re: /(^|\n)###\s*Analysis\b[^\n]*\n/gi, close: /(^|\n)###\s*(?!Analysis\b)[A-Za-z][^\n]*\n/gi },
  { re: /(^|\n)###\s*Plan\b[^\n]*\n/gi, close: /(^|\n)###\s*(?!Plan\b)[A-Za-z][^\n]*\n/gi },
  { re: /(^|\n)###\s*Reflection\b[^\n]*\n/gi, close: /(^|\n)###\s*(?!Reflection\b)[A-Za-z][^\n]*\n/gi },
];

function closeXmlPair(tagInner: string): RegExp {
  // tagInner comes from the matched open tag (e.g. "tool_call", "think").
  // Build a closing regex for the same name, allowing optional `/` prefix
  // and inner whitespace, e.g. "</tool_call>", "</ tool_call >".
  const name = tagInner.replace(/^\/+/, '').replace(/^\s+|\s+$/g, '').split(/\s/)[0];
  return new RegExp(`<\\s*\\/\\s*${escapeRe(name)}\\s*>`, 'gi');
}

function closeAngleBarPair(tagInner: string): RegExp {
  // tagInner is e.g. "tool_call". Llama 3 / Meta close: <|/tool_call|>
  // (the slash comes BEFORE the closing pipe, i.e. `</|name|>`).
  const name = tagInner.replace(/^\/+/, '').replace(/^\s+|\s+$/g, '').split(/\s/)[0];
  return new RegExp(`<\\s*\\/\\s*\\|\\s*${escapeRe(name)}\\s*\\|\\s*>`, 'gi');
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract the tag name (the part used to derive the matching close tag) from
 * an opening tag text. Strips leading brackets/pipes, leading slash, any
 * attributes, and the trailing `>`, `]>`, or `|>`.
 *
 * Examples:
 *   "<tool_call>"       → "tool_call"
 *   "<|tool_call|>"   → "tool_call"
 *   "<tool name=x>"   → "tool"
 *   "[TOOL_CALL]"     → "TOOL_CALL"
 *   "</think>"        → "think"        (defensive: shouldn't happen since
 *                                       opens don't include the slash form)
 */
function extractTagInner(tagText: string): string {
  let s = tagText.trim();
  // Strip leading brackets/pipes: <, [, |, or any combo
  s = s.replace(/^[<\[\|\\\/]+/, '');
  // Strip leading slash variants ("/" by itself)
  s = s.replace(/^\/+/, '');
  // For XML/HTML tags, attributes may follow the name: "tool name=x".
  // Stop at the first whitespace.
  const ws = s.search(/\s/);
  if (ws >= 0) s = s.slice(0, ws);
  // Strip trailing brackets/pipes (closing of the open tag): >, ]>, |>
  s = s.replace(/[\]>\|\s]+$/, '');
  return s;
}

/**
 * Extract the value of a `name="..."` (or `name='...'`) attribute from an
 * opening tag string. Returns undefined if no such attribute exists.
 *
 * Examples:
 *   '<invoke name="lookup">'   → "lookup"
 *   "<function name='f'>"     → "f"
 *   "<tool_call>"               → undefined
 */
function extractOpenTagNameAttribute(tagText: string): string | undefined {
  if (!tagText) return undefined;
  const m = tagText.match(/\bname\s*=\s*["']([^"']+)["']/i);
  return m ? m[1] : undefined;
}

// ────────────────────────────────────────────────────────────────────────────
// Parser
// ────────────────────────────────────────────────────────────────────────────

interface BlockMatch {
  kind: 'tool' | 'think';
  /** Index of the opening tag (start of `<` or `[`). */
  start: number;
  /** Index just after the opening tag. */
  innerStart: number;
  /** Index of the matching closing tag. -1 if unterminated. */
  end: number;
  /** Index just after the closing tag. */
  innerEnd: number;
}

/**
 * Adapter stateful enough to keep tool-call ids stable across chunks even
 * when the model emits the opening tag and the JSON body in separate
 * chunks. One instance per stream.
 */
export class ToolCallAdapter {
  private readonly seenCallIds = new Map<string, string>();
  private readonly callIdCounter = { i: 0 };

  parse(chunk: string): ParsedDelta {
    const result: ParsedDelta = { text: '', reasoning: '', toolCalls: [], leftover: '' };
    if (!chunk) return result;

    let buffer = chunk;

    // Main extraction loop. Each iteration consumes one block or accumulates
    // plain text. We stop when no more complete blocks are present.
    while (buffer.length > 0) {
      const next = this.findEarliestBlock(buffer);

      if (!next) {
        // No more block markers. Emit the rest as text UNLESS it ends with
        // a partial opening tag — keep that in leftover.
        const partial = findPartialMarker(buffer);
        if (partial >= 0) {
          result.text += buffer.slice(0, partial);
          result.leftover = buffer.slice(partial);
        } else {
          result.text += buffer;
        }
        buffer = '';
        break;
      }

      // Emit any plain text before the block.
      if (next.start > 0) result.text += buffer.slice(0, next.start);

      if (next.end < 0) {
        // Unterminated block — keep the rest for the next chunk.
        result.leftover = buffer.slice(next.start);
        buffer = '';
        break;
      }

      const inner = buffer.slice(next.innerStart, next.end);
      if (next.kind === 'tool') {
        // Pass the open tag so the parser can pick up an outer `name="x"`
        // attribute (Hermes / Granite style: <invoke name="x">args</invoke>).
        const openTag = buffer.slice(next.start, next.innerStart);
        const tc = this.parseToolCallBody(inner, openTag);
        if (tc) result.toolCalls.push(tc);
      } else {
        // Trim leading/trailing whitespace and newlines from reasoning.
        result.reasoning += inner.replace(/^\s*\n+|\n+\s*$/g, '');
      }

      buffer = buffer.slice(next.innerEnd);
    }

    return result;
  }

  /**
   * Find the earliest block (tool or think) in `buffer`. Returns the
   * nearest opening tag that has a matching close (or returns end=-1
   * if the opening tag is unterminated so the caller buffers it).
   */
  private findEarliestBlock(buffer: string): BlockMatch | null {
    let best: BlockMatch | null = null;

    for (const family of [...TOOL_FAMILIES, ...THINK_FAMILIES]) {
      family.openRe.lastIndex = 0;
      const m = family.openRe.exec(buffer);
      if (!m) continue;
      const start = m.index;
      const tagText = m[0];
      // Build a close regex for THIS specific tag (so e.g. <think> closes
      // with </think>, not </reasoning>).
      //
      // Extract the inner name from the opening tag. The opening tag can be
      // one of:
      //   <name>          → inner = "name"
      //   <name attr=...> → inner = "name"
      //   <|name|>        → inner = "name"
      //   [NAME]          → inner = "NAME"
      //   ### Header      → handled separately via MD_HEADER_OPENS
      const closeTagInner = extractTagInner(tagText);
      const closeRe = family.closeRe(closeTagInner);
      closeRe.lastIndex = start + tagText.length;
      const close = closeRe.exec(buffer);
      const innerStart = start + tagText.length;
      const end = close ? close.index : -1;
      const innerEnd = close ? close.index + close[0].length : -1;
      const candidate: BlockMatch = {
        kind: family.kind, start, innerStart, end, innerEnd,
      };
      if (!best || start < best.start) best = candidate;
    }

    // Markdown-style headers: only flag if a CLOSE is also present.
    for (const h of MD_HEADER_OPENS) {
      h.re.lastIndex = 0;
      const m = h.re.exec(buffer);
      if (!m) continue;
      h.close.lastIndex = m.index + m[0].length;
      const close = h.close.exec(buffer);
      if (!close) continue; // unterminated — ignore, keep in plain text
      const start = m.index + (m[1] ? m[1].length : 0);
      const innerStart = m.index + m[0].length;
      const end = close.index + (close[1] ? close[1].length : 0);
      const innerEnd = close.index + close[0].length;
      const candidate: BlockMatch = {
        kind: 'think', start, innerStart, end, innerEnd,
      };
      if (!best || start < best.start) best = candidate;
    }

    return best;
  }

  /**
   * Parse the body of a tool call block. Supports:
   *   - JSON: {"name": "...", "arguments": {...}}
   *   - JSON: {"name": "...", "parameters": {...}}
   *   - JSON: {"name": "...", "input": {...}}
   *   - JSON: {"function": {"name": "...", "arguments": "..."}}
   *   - JSON: {"function": {"name": "...", "arguments": {...}}}
   *   - JSON: {"tool": "...", "parameters": {...}}   (Cohere)
   *   - JSON: {"type": "function", "function": {"name": "...", "arguments": ...}}
   *   - XML: <tool name="x">arg-value</tool>  (rare; the open tag carries name)
   *   - Hermes/Granite: <invoke name="x">JSON-args</invoke>
   *     — the open tag carries `name=...`; the body is the JSON args.
   *   - JSON with trailing junk (we extract the first {...} block)
   * Returns null on parse failure.
   */
  private parseToolCallBody(body: string, openTag: string = ''): ParsedToolCall | null {
    const trimmed = body.trim();
    if (!trimmed && !openTag) return null;

    // First, check if the OPEN TAG carries a `name="x"` attribute (Hermes
    // / Granite style). If so, use it as the tool name and parse the body
    // as the arguments.
    const outerName = extractOpenTagNameAttribute(openTag);
    if (outerName) {
      let args: any = trimmed;
      if (trimmed.startsWith('{')) {
        try { args = JSON.parse(trimmed); } catch { /* keep as string */ }
      } else if (trimmed.startsWith('[')) {
        // Some models wrap args in an array: [{"a":1}] — unwrap.
        try {
          const arr = JSON.parse(trimmed);
          if (Array.isArray(arr) && arr.length === 1) args = arr[0];
        } catch { /* keep as string */ }
      }
      return this.makeToolCall(outerName, args);
    }

    // XML form (legacy): <tool name="x">...</tool>, <invoke name="x">...</invoke>,
    // <function name="x">...</function>, <action name="x">...</action>.
    const xmlMatch = trimmed.match(/<((?:tool|invoke|function|action|antml:function_calls?))\b[^>]*\bname\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/\1>/i);
    if (xmlMatch) {
      const name = xmlMatch[2];
      const inner = xmlMatch[3].trim();
      let args: any = inner;
      if (inner.startsWith('{')) {
        try { args = JSON.parse(inner); } catch { /* keep as string */ }
      }
      return this.makeToolCall(name, args);
    }

    if (!trimmed) return null;

    // JSON form
    let parsed: any;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      const match = trimmed.match(/\{[\s\S]*\}/);
      if (!match) return null;
      try { parsed = JSON.parse(match[0]); } catch { return null; }
    }
    if (!parsed || typeof parsed !== 'object') return null;

    let name: string | undefined;
    let args: any;

    if (typeof parsed.name === 'string') {
      name = parsed.name;
      args = parsed.arguments ?? parsed.parameters ?? parsed.input ?? parsed.args ?? {};
    } else if (parsed.function && typeof parsed.function.name === 'string') {
      name = parsed.function.name;
      const raw = parsed.function.arguments ?? parsed.function.parameters;
      if (typeof raw === 'string') {
        try { args = JSON.parse(raw); } catch { args = raw; }
      } else {
        args = raw ?? {};
      }
    } else if (typeof parsed.tool === 'string') {
      // Cohere-style: {"tool": "name", "parameters": {...}}
      name = parsed.tool;
      args = parsed.parameters ?? parsed.arguments ?? {};
    } else if (parsed.type === 'function' && parsed.function && typeof parsed.function.name === 'string') {
      // OpenAI native JSON inside a block
      name = parsed.function.name;
      const raw = parsed.function.arguments;
      if (typeof raw === 'string') {
        try { args = JSON.parse(raw); } catch { args = raw; }
      } else {
        args = raw ?? {};
      }
    }

    if (!name) return null;
    return this.makeToolCall(name, args);
  }

  private makeToolCall(name: string, args: any): ParsedToolCall {
    const idKey = JSON.stringify({ name, args });
    let id = this.seenCallIds.get(idKey);
    if (!id) {
      this.callIdCounter.i += 1;
      id = `call_local_${Date.now().toString(36)}_${this.callIdCounter.i}`;
      this.seenCallIds.set(idKey, id);
    }
    return { callId: id, name, input: args };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Partial-marker detection
// ────────────────────────────────────────────────────────────────────────────
//
// A *partial* opening tag is text at the tail of the buffer that looks like
// the start of any known opening tag, but is not complete yet. We keep that
// tail in `leftover` so the next chunk can finish it.

const ALL_OPEN_PREFIXES: readonly string[] = [
  // XML tool tags
  '<tool_call', '<toolcall', '<tool ', '<tool>', '<tool_', '<invoke', '<action', '<function',
  '<antml:function_calls', '<antml:function_call',
  // Pipe-bar tool tags
  '<|tool_call', '<|toolcall',
  // XML think tags
  '<think', '<reason', '<reflect', '<analysis', '<thought', '<solution', '<plan',
  // Pipe-bar think tags
  '<|think', '<|reason',
  // Bracket tool tags
  '[TOOL_CALL', '[TOOL_CALLS',
  // Bracket think tags
  '[THINK', '[THINKING',
  // Markdown reasoning headers
  '### Reason', '### Thought', '### Analysis', '### Plan', '### Reflection',
];

function findPartialMarker(text: string): number {
  // Strategy: pick the latest position in `text` where the tail is a
  // *strict prefix* of any known opening tag (i.e. the opening tag is
  // being typed out across chunks and is not yet complete).
  let bestIdx = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '<' && ch !== '[') continue;
    const tail = text.slice(i);
    for (const tag of ALL_OPEN_PREFIXES) {
      if (tag.length <= 1) continue;
      if (!tag.startsWith(ch)) continue;
      // Strict prefix: tail is shorter than the full tag AND the tag's
      // beginning matches the tail. This means the model has emitted the
      // first N chars of a known opening tag but not yet the rest.
      if (tail.length < tag.length && tag.startsWith(tail)) {
        if (i > bestIdx) bestIdx = i;
        break;
      }
    }
  }
  return bestIdx;
}
