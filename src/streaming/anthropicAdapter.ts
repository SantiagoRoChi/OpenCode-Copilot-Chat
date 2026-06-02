import * as vscode from 'vscode';
import { AnthropicSSEEvent } from '../client/types';

// --- Request Conversion Types ---

export interface AnthropicRequestContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string | AnthropicRequestContentBlock[];
  source?: { type: 'base64'; media_type: string; data: string };
}

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicRequestContentBlock[];
}

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  temperature?: number;
  stream: boolean;
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

// --- Response Streaming Types ---

export interface AnthropicStreamCallbacks {
  onText(text: string): void;
  onThinking(text: string): void;
  onThinkingDone(): void;
  onToolCall(id: string, name: string, args: Record<string, unknown>): void;
  onUsage(usage: { input_tokens: number; output_tokens: number }): void;
  onError(error: Error): void;
  onDone(): void;
}

// --- Request Conversion ---

export function toAnthropicMessages(
  messages: readonly vscode.LanguageModelChatMessage[],
  modelId: string
): AnthropicRequest {
  let systemText: string | undefined;
  const anthropicMessages: AnthropicMessage[] = [];

  for (const msg of messages) {
    const blocks: AnthropicRequestContentBlock[] = [];

    for (const part of msg.content) {
      const converted = convertPart(part);
      if (converted) {
        blocks.push(converted);
      }
    }

    const filtered = blocks.filter(b => !(b.type === 'text' && !b.text));

    if (filtered.length > 0) {
      const role: 'user' | 'assistant' =
        msg.role === vscode.LanguageModelChatMessageRole.Assistant
          ? 'assistant'
          : 'user';
      anthropicMessages.push({ role, content: filtered });
    }
  }

  return {
    model: modelId,
    max_tokens: 4096,
    system: systemText,
    messages: mergeAdjacentMessages(anthropicMessages),
    stream: true,
  };
}

// --- Response Streaming ---

interface BlockState {
  type: string;
  id?: string;
  name?: string;
  jsonParts: string[];
}

export async function streamAnthropicResponse(
  response: Response,
  callbacks: AnthropicStreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  if (!response.body) {
    callbacks.onError(new Error('No response body'));
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let pendingEvent: string | undefined;
  const blocks = new Map<number, BlockState>();

  try {
    while (true) {
      if (signal?.aborted) {
        break;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          pendingEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6);
          try {
            processSSEEvent(pendingEvent, jsonStr, callbacks, blocks);
          } catch (err) {
            callbacks.onError(err instanceof Error ? err : new Error(String(err)));
          }
          pendingEvent = undefined;
        } else if (line.trim() === '') {
          pendingEvent = undefined;
        }
      }
    }

    callbacks.onDone();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return;
    }
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
  } finally {
    reader.releaseLock();
  }
}

// --- Internal Helpers ---

function convertPart(
  part: vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart | vscode.LanguageModelToolResultPart | vscode.LanguageModelDataPart
): AnthropicRequestContentBlock | undefined {
  if (part instanceof vscode.LanguageModelTextPart) {
    return { type: 'text', text: part.value };
  }

  if (part instanceof vscode.LanguageModelToolCallPart) {
    return {
      type: 'tool_use',
      id: part.callId,
      name: part.name,
      input: (part.input as Record<string, unknown>) ?? {},
    };
  }

  if (part instanceof vscode.LanguageModelToolResultPart) {
    const textParts: string[] = [];
    for (const c of part.content) {
      if (c instanceof vscode.LanguageModelTextPart) {
        textParts.push(c.value);
      }
    }
    const content = textParts.join('');
    if (content) {
      return { type: 'tool_result', content };
    }
    return undefined;
  }

  if (part instanceof vscode.LanguageModelDataPart) {
    if (part.mimeType.startsWith('image/')) {
      const base64 = uint8ArrayToBase64(part.data);
      if (base64) {
        return {
          type: 'image',
          source: { type: 'base64', media_type: part.mimeType, data: base64 },
        };
      }
    }
  }

  return undefined;
}

function mergeAdjacentMessages(messages: AnthropicMessage[]): AnthropicMessage[] {
  if (messages.length === 0) return messages;

  const result: AnthropicMessage[] = [messages[0]];

  for (let i = 1; i < messages.length; i++) {
    const prev = result[result.length - 1];
    const curr = messages[i];
    if (prev.role === curr.role) {
      prev.content = [...prev.content, ...curr.content];
    } else {
      result.push(curr);
    }
  }

  return result;
}

function processSSEEvent(
  eventType: string | undefined,
  jsonStr: string,
  callbacks: AnthropicStreamCallbacks,
  blocks: Map<number, BlockState>
): void {
  if (!eventType) return;

  const event = JSON.parse(jsonStr);

  switch (event.type) {
    case 'message_start':
      break;

    case 'content_block_start':
      blocks.set(event.index, {
        type: event.content_block.type,
        id: event.content_block.id,
        name: event.content_block.name,
        jsonParts: [],
      });
      break;

    case 'content_block_delta': {
      const delta = event.delta;
      if (delta.type === 'text_delta') {
        callbacks.onText(delta.text);
      } else if (delta.type === 'thinking_delta') {
        callbacks.onThinking(delta.thinking);
      } else if (delta.type === 'input_json_delta') {
        const state = blocks.get(event.index);
        if (state) {
          state.jsonParts.push(delta.partial_json);
        }
      }
      break;
    }

    case 'content_block_stop': {
      const state = blocks.get(event.index);
      if (state?.type === 'tool_use' && state.id && state.name) {
        const json = state.jsonParts.join('');
        if (json) {
          const input = safeParseJson(json);
          callbacks.onToolCall(state.id, state.name, input);
        }
      }
      if (state?.type === 'thinking') {
        callbacks.onThinkingDone();
      }
      blocks.delete(event.index);
      break;
    }

    case 'message_delta':
      callbacks.onUsage({
        input_tokens: 0,
        output_tokens: event.usage?.output_tokens ?? 0,
      });
      break;

    case 'message_stop':
      break;
  }
}

function safeParseJson(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  try {
    return btoa(binary);
  } catch {
    return '';
  }
}
