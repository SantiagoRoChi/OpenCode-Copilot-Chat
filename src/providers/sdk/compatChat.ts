import * as vscode from 'vscode';
import { ToolCallAdapter } from '../../tools/toolCallAdapter';

/**
 * Streams a chat completion for locally-hosted models (LM Studio, Ollama,
 * OpenCode Server) using the OpenAI Chat Completions format over raw HTTP.
 *
 * This is kept separate from the SDK-based handlers because local servers
 * may emit non-standard SSE (e.g. <tool_call> blocks in content, <think> tags)
 * that require custom parsing via ToolCallAdapter.
 */
export async function streamCompatChat(
  url: string,
  headers: Record<string, string>,
  apiModelId: string,
  maxOutputTokens: number | undefined,
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  tools: vscode.LanguageModelChatTool[] | undefined,
  modelOptions: Record<string, unknown>,
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  token: vscode.CancellationToken,
): Promise<void> {
  const body = buildBody(apiModelId, maxOutputTokens, messages, tools, modelOptions);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: token.isCancellationRequested ? AbortSignal.abort() : undefined,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  if (!response.body) throw new Error('No response body');

  await streamSSE(response.body, progress);
}

// ── Body builder ──────────────────────────────────────────────────────────

function buildBody(
  apiModelId: string,
  maxOutputTokens: number | undefined,
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  tools: vscode.LanguageModelChatTool[] | undefined,
  modelOptions: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: apiModelId,
    messages: convertMessages(messages),
    stream: true,
    ...mapModelOptions(modelOptions),
  };
  if (maxOutputTokens) body['max_tokens'] = maxOutputTokens;
  if (tools?.length) {
    body['tools'] = tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema ?? { type: 'object', properties: {} },
      },
    }));
  }
  return body;
}

function mapModelOptions(opts: Record<string, unknown>): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(opts)) {
    if (value === undefined || value === null) continue;
    if (key === 'reasoningEffort') {
      mapped['reasoning_effort'] = value;
    } else {
      mapped[key] = value;
    }
  }
  return mapped;
}

// ── Message conversion ────────────────────────────────────────────────────

function convertMessages(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
): unknown[] {
  const result: unknown[] = [];

  for (const msg of messages) {
    const role =
      msg.role === vscode.LanguageModelChatMessageRole.Assistant ? 'assistant' :
      msg.role === (vscode as any).LanguageModelChatMessageRole.System ? 'system' : 'user';

    const textParts: string[] = [];
    const toolCalls: unknown[] = [];
    const toolResults: unknown[] = [];

    for (const part of msg.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        textParts.push(part.value);
      } else if (part instanceof vscode.LanguageModelToolResultPart) {
        const contentStr = part.content
          .filter((p): p is vscode.LanguageModelTextPart => p instanceof vscode.LanguageModelTextPart)
          .map(p => p.value)
          .join('');
        toolResults.push({ role: 'tool', tool_call_id: part.callId, content: contentStr });
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        toolCalls.push({
          id: part.callId,
          type: 'function',
          function: { name: part.name, arguments: JSON.stringify(part.input) },
        });
      }
    }

    for (const tr of toolResults) result.push(tr);

    if (textParts.length > 0 || toolCalls.length > 0) {
      const msgObj: Record<string, unknown> = { role };
      msgObj['content'] = textParts.length > 0 ? textParts.join('') : null;
      if (toolCalls.length > 0) msgObj['tool_calls'] = toolCalls;
      result.push(msgObj);
    }
  }

  return result;
}

// ── SSE streaming ─────────────────────────────────────────────────────────

async function streamSSE(
  body: ReadableStream<Uint8Array>,
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const toolCalls = new Map<number, { id: string; name: string; args: string }>();
  const inlineAdapter = new ToolCallAdapter();
  let inlineBuffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;

        try {
          const data = JSON.parse(trimmed.slice(6));
          const delta = data.choices?.[0]?.delta;
          if (!delta) continue;

          if (delta.content) {
            const parsed = inlineAdapter.parse(inlineBuffer + delta.content);
            inlineBuffer = parsed.leftover;
            if (parsed.text) progress.report(new vscode.LanguageModelTextPart(parsed.text));
            if (parsed.reasoning) {
              const thinkingPart = new (vscode as any).LanguageModelThinkingPart(parsed.reasoning);
              progress.report(thinkingPart as vscode.LanguageModelResponsePart);
            }
            for (const tc of parsed.toolCalls) {
              const input = typeof tc.input === 'string'
                ? { raw: tc.input }
                : (tc.input as Record<string, unknown>);
              progress.report(new vscode.LanguageModelToolCallPart(tc.callId, tc.name, input));
            }
          }

          if (delta.reasoning_content) {
            const thinkingPart = new (vscode as any).LanguageModelThinkingPart(delta.reasoning_content);
            progress.report(thinkingPart as vscode.LanguageModelResponsePart);
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx: number = tc.index ?? 0;
              let buf = toolCalls.get(idx);
              if (!buf) {
                buf = { id: '', name: '', args: '' };
                toolCalls.set(idx, buf);
              }
              if (tc.id) buf.id = tc.id;
              if (tc.function?.name) buf.name = tc.function.name;
              if (tc.function?.arguments) buf.args += tc.function.arguments;
            }
          }

          if (data.choices?.[0]?.finish_reason === 'tool_calls') {
            for (const [, buf] of toolCalls) {
              if (buf.id && buf.name) {
                let args: unknown;
                try { args = JSON.parse(buf.args); } catch { args = buf.args; }
                progress.report(new vscode.LanguageModelToolCallPart(buf.id, buf.name, args as Record<string, unknown>));
              }
            }
            toolCalls.clear();
          }
        } catch {
          // skip malformed line
        }
      }
    }

    // Flush any remaining tool calls
    for (const [, buf] of toolCalls) {
      if (buf.id && buf.name) {
        let args: unknown;
        try { args = JSON.parse(buf.args); } catch { args = buf.args; }
        progress.report(new vscode.LanguageModelToolCallPart(buf.id, buf.name, args as Record<string, unknown>));
      }
    }
  } finally {
    reader.releaseLock();
  }
}
