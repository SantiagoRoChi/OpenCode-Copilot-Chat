import * as vscode from 'vscode';
import { ResponsesSSEEvent } from '../client/types';

// --- Request Format ---

export interface ResponsesRequest {
  model: string;
  input: ResponsesInputPart[];
  max_output_tokens?: number;
  tools?: ResponsesTool[];
  temperature?: number;
  stream: boolean;
  previous_response_id?: string;
}

export type ResponsesInputPart =
  | { role: 'user'; content: string | ResponsesContentPart[] }
  | { role: 'assistant'; content: string | ResponsesContentPart[] }
  | { type: 'function_call_output'; call_id: string; output: string };

export type ResponsesContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string };

export interface ResponsesTool {
  type: 'function';
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export function toResponsesRequest(
  messages: readonly vscode.LanguageModelChatMessage[],
  modelId: string,
  maxOutputTokens: number
): ResponsesRequest {
  const input: ResponsesInputPart[] = [];

  for (const msg of messages) {
    const role: 'user' | 'assistant' =
      msg.role === vscode.LanguageModelChatMessageRole.Assistant
        ? 'assistant'
        : 'user';

    const parts: ResponsesContentPart[] = [];

    for (const part of msg.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        parts.push({ type: 'input_text', text: part.value });
      } else if (part instanceof vscode.LanguageModelDataPart) {
        if (part.mimeType.startsWith('image/')) {
          const base64 = uint8ArrayToBase64(part.data);
          parts.push({
            type: 'input_image',
            image_url: `data:${part.mimeType};base64,${base64}`,
          });
        }
      }
      // ToolCallPart and ToolResultPart are handled separately below
    }

    // Extract tool calls from assistant messages
    if (role === 'assistant') {
      for (const part of msg.content) {
        if (part instanceof vscode.LanguageModelToolCallPart) {
          input.push({
            type: 'function_call_output' as const,
            call_id: part.callId,
            output: JSON.stringify(part.input),
          });
        }
      }
    }

    // Extract tool results from user messages
    if (role === 'user') {
      for (const part of msg.content) {
        if (part instanceof vscode.LanguageModelToolResultPart) {
          const textContent = part.content
            .filter((c): c is vscode.LanguageModelTextPart => c instanceof vscode.LanguageModelTextPart)
            .map(c => c.value)
            .join('');
          input.push({
            type: 'function_call_output',
            call_id: part.callId,
            output: textContent,
          });
        }
      }
    }

    // Add the text/image content
    if (parts.length === 1 && parts[0].type === 'input_text') {
      input.push({ role, content: parts[0].text });
    } else if (parts.length > 0) {
      input.push({ role, content: parts });
    } else if (role === 'user') {
      // Fallback: empty user message to avoid empty input array
      input.push({ role: 'user', content: '' });
    }
  }

  return {
    model: modelId,
    input,
    max_output_tokens: maxOutputTokens,
    stream: true,
  };
}

// --- Response Streaming ---

export interface ResponsesStreamCallbacks {
  onText(text: string): void;
  onThinking(text: string): void;
  onThinkingDone(): void;
  onToolCall(id: string, name: string, args: Record<string, unknown>): void;
  onUsage(usage: { input_tokens: number; output_tokens: number; total_tokens: number }): void;
  onError(error: Error): void;
  onDone(): void;
}

interface PendingToolCall {
  call_id: string;
  name: string;
  arguments: string;
}

export async function streamResponsesResponse(
  response: Response,
  callbacks: ResponsesStreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  if (!response.body) {
    throw new Error('Response body is null');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const pendingToolCalls = new Map<number, PendingToolCall>();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) {
        throw new Error('Request aborted');
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE events (separated by double newline)
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const rawEvent of events) {
        if (signal?.aborted) {
          throw new Error('Request aborted');
        }

        const parsed = parseSSEEvent(rawEvent);
        if (!parsed) continue;

        const evt = parsed as ResponsesSSEEvent;

        switch (evt.type) {
          case 'response.created':
            break;

          case 'response.output_text.delta':
            callbacks.onText(evt.delta);
            break;

          case 'response.function_call_arguments.delta': {
            const idx = evt.item_index ?? evt.output_index ?? 0;
            let pending = pendingToolCalls.get(idx);
            if (!pending) {
              pending = { call_id: '', name: '', arguments: '' };
              pendingToolCalls.set(idx, pending);
            }
            pending.arguments += evt.delta;
            break;
          }

          case 'response.output_item.added': {
            if (evt.item.type === 'function_call') {
              const idx = evt.output_index ?? 0;
              let pending = pendingToolCalls.get(idx);
              if (!pending) {
                pending = { call_id: '', name: '', arguments: '' };
                pendingToolCalls.set(idx, pending);
              }
              pending.call_id = evt.item.call_id;
              pending.name = evt.item.name;
            }
            break;
          }

          case 'response.output_item.done': {
            if (evt.item.type === 'function_call') {
              const idx = evt.output_index ?? 0;
              const pending = pendingToolCalls.get(idx);
              if (pending) {
                try {
                  const args = JSON.parse(pending.arguments) as Record<string, unknown>;
                  callbacks.onToolCall(pending.call_id, pending.name, args);
                } catch {
                  callbacks.onToolCall(pending.call_id, pending.name, { raw: pending.arguments });
                }
                pendingToolCalls.delete(idx);
              }
            }
            break;
          }

          case 'response.completed': {
            const resp = evt.response;
            if (resp.usage) {
              callbacks.onUsage({
                input_tokens: resp.usage.input_tokens,
                output_tokens: resp.usage.output_tokens,
                total_tokens: resp.usage.total_tokens,
              });
            }
            callbacks.onDone();
            break;
          }
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      const parsed = parseSSEEvent(buffer);
      if (parsed) {
        const evt = parsed as ResponsesSSEEvent;
        if (evt.type === 'response.completed' && evt.response.usage) {
          callbacks.onUsage({
            input_tokens: evt.response.usage.input_tokens,
            output_tokens: evt.response.usage.output_tokens,
            total_tokens: evt.response.usage.total_tokens,
          });
          callbacks.onDone();
        }
      }
    }
  } catch (err) {
    if (err instanceof Error) {
      callbacks.onError(err);
    } else {
      callbacks.onError(new Error(String(err)));
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSSEEvent(raw: string): unknown | null {
  let dataLine = '';

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('data:')) {
      dataLine = trimmed.slice(5).trim();
    }
  }

  if (!dataLine) return null;

  try {
    return JSON.parse(dataLine) as unknown;
  } catch {
    return null;
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
