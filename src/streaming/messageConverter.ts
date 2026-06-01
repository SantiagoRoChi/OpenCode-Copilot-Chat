import * as vscode from 'vscode';
import { ChatMessage, ContentPart, ToolCall } from '../client/types';

export type NormalizedRole = 'user' | 'assistant' | 'system' | 'tool';

export interface NormalizedPart {
  kind: 'text' | 'toolResult' | 'toolCall' | 'image' | 'unknown';
  value?: string;
  callId?: string;
  name?: string;
  input?: unknown;
  content?: string;
  mimeType?: string;
  data?: Uint8Array;
}

export interface NormalizedMessage {
  role: NormalizedRole;
  parts: NormalizedPart[];
}

export function convertMessage(
  normalized: NormalizedMessage,
  enableImageInput: boolean
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  if (normalized.role === 'system') {
    const text = extractText(normalized.parts);
    if (text) {
      messages.push({ role: 'system', content: text });
    }
    return messages;
  }

  const textParts: string[] = [];
  const contentParts: ContentPart[] = [];
  const toolCalls: ToolCall[] = [];
  const toolResults: { callId: string; content: string }[] = [];

  for (const part of normalized.parts) {
    switch (part.kind) {
      case 'text':
        if (part.value) {
          textParts.push(part.value);
          contentParts.push({ type: 'text', text: part.value });
        }
        break;
      case 'toolCall':
        if (part.callId && part.name) {
          toolCalls.push({
            id: part.callId,
            type: 'function',
            function: {
              name: part.name,
              arguments: typeof part.input === 'string' ? part.input : JSON.stringify(part.input ?? {}),
            },
          });
        }
        break;
      case 'toolResult':
        if (part.callId) {
          toolResults.push({
            callId: part.callId,
            content: part.content ?? '',
          });
        }
        break;
      case 'image':
        if (enableImageInput && part.mimeType && part.data) {
          if (isValidImageMimeType(part.mimeType)) {
            if (part.data.length > 0) {
              const base64 = uint8ArrayToBase64(part.data);
              if (base64.length > 0) {
                contentParts.push({
                  type: 'image_url',
                  image_url: { url: `data:${part.mimeType};base64,${base64}` },
                });
              }
            }
          }
        }
        break;
    }
  }

  // Tool results go as separate messages
  for (const tr of toolResults) {
    messages.push({
      role: 'tool',
      content: tr.content,
      tool_call_id: tr.callId,
    });
  }

  // Regular message with optional tool calls
  if (textParts.length > 0 || contentParts.length > 0 || toolCalls.length > 0) {
    const msg: ChatMessage = {
      role: normalized.role as 'user' | 'assistant',
      content: toolCalls.length > 0 && textParts.length === 0 ? '' : (contentParts.length === 1 && contentParts[0].type === 'text' ? textParts[0] : contentParts),
    };
    if (toolCalls.length > 0) {
      msg.tool_calls = toolCalls;
    }
    messages.push(msg);
  } else if (normalized.parts.length > 0 && toolResults.length === 0) {
    // Fallback: all parts were unknown, send empty text to avoid empty messages array
    messages.push({
      role: normalized.role as 'user' | 'assistant',
      content: '',
    });
  }

  return messages;
}

export function normalizeVsCodeMessages(
  messages: readonly vscode.LanguageModelChatMessage[],
  mapRole: (role: vscode.LanguageModelChatMessageRole) => NormalizedRole,
  classifyPart: (part: unknown) => NormalizedPart
): NormalizedMessage[] {
  return messages.map(msg => ({
    role: mapRole(msg.role),
    parts: msg.content.map(part => classifyPart(part)),
  }));
}

function extractText(parts: NormalizedPart[]): string {
  return parts
    .filter(p => p.kind === 'text' && p.value)
    .map(p => p.value!)
    .join('\n');
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

const VALID_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

function isValidImageMimeType(mimeType: string): boolean {
  return VALID_IMAGE_MIMES.has(mimeType.toLowerCase());
}
