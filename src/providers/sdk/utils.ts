import { LanguageModelChatTool, LanguageModelChatRequestMessage, LanguageModelToolCallPart, LanguageModelTextPart, LanguageModelToolResultPart } from 'vscode';
import { jsonSchema } from '@ai-sdk/provider-utils';

/**
 * Shared utilities for SDK-based chat handlers.
 */

/**
 * Build tool set for the AI SDK from VS Code tools.
 * Returns a record mapping tool names to SDK tool definitions.
 */
export function buildSdkTools(
  tools: LanguageModelChatTool[] | undefined,
  toolFactory: (config: {
    description: string;
    inputSchema: any;
    execute: (input: unknown) => Promise<unknown>;
  }) => any
): Record<string, any> {
  const sdkTools: Record<string, any> = {};
  if (tools?.length) {
    for (const t of tools) {
      sdkTools[t.name] = toolFactory({
        description: t.description,
        inputSchema: jsonSchema(t.inputSchema ?? { type: 'object', properties: {} }),
        execute: async (input: unknown) => input,
      });
    }
  }
  return sdkTools;
}

/**
 * Map VS Code model options to AI SDK settings.
 */
export function mapModelOptions(opts: Record<string, unknown>): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  if (opts.temperature !== undefined) mapped.temperature = opts.temperature;
  if (opts.topP !== undefined) mapped.topP = opts.topP;
  if (opts.maxOutputTokens !== undefined) mapped.maxOutputTokens = opts.maxOutputTokens;
  return mapped;
}

/**
 * Track tool names by callId from messages.
 * Returns a map of callId -> toolName.
 */
export function trackToolNames(
  messages: readonly LanguageModelChatRequestMessage[]
): Map<string, string> {
  const toolNameByCallId = new Map<string, string>();
  for (const msg of messages) {
    for (const part of msg.content) {
      if (part instanceof LanguageModelToolCallPart) {
        toolNameByCallId.set(part.callId, part.name);
      }
    }
  }
  return toolNameByCallId;
}

/**
 * Convert VS Code messages to AI SDK format.
 * This handles text parts, tool calls, and tool results.
 */
export function convertMessages(
  messages: readonly LanguageModelChatRequestMessage[],
): Array<{ role: string; content: any }> {
  const result: Array<{ role: string; content: any }> = [];
  const toolNameByCallId = trackToolNames(messages);

  for (const msg of messages) {
    const isAssistant = msg.role === 1;
    const isSystem = msg.role === 2;

    if (isSystem) {
      const text = msg.content
        .filter((p): p is LanguageModelTextPart => p instanceof LanguageModelTextPart)
        .map(p => p.value)
        .join('\n\n');
      result.push({ role: 'system', content: text });
      continue;
    }

    const role = isAssistant ? 'assistant' : 'user';

    // If the first non-system message is an assistant response, prepend a
    // placeholder user query so the Jinja template finds a "user" message.
    if (result.length === 0 && role === 'assistant') {
      result.push({ role: 'user', content: [{ type: 'text', text: 'Continue.' }] });
    }

    const textParts: LanguageModelTextPart[] = [];
    const toolCallParts: LanguageModelToolCallPart[] = [];
    const toolResultParts: LanguageModelToolResultPart[] = [];

    for (const part of msg.content) {
      if (part instanceof LanguageModelTextPart) {
        textParts.push(part);
      } else if (part instanceof LanguageModelToolCallPart) {
        toolCallParts.push(part);
      } else if (part instanceof LanguageModelToolResultPart) {
        toolResultParts.push(part);
      }
    }

    // Build content array in AI SDK v6 format
    const contentArray: any[] = [];

    for (const tp of textParts) {
      contentArray.push({ type: 'text', text: tp.value });
    }

    for (const tc of toolCallParts) {
      contentArray.push({
        type: 'tool-call',
        toolCallId: tc.callId,
        toolName: tc.name,
        input: tc.input,
      });
    }

    // Tool results go in a separate 'tool' role message
    const toolResults: any[] = [];
    for (const tr of toolResultParts) {
      const text = tr.content
        .filter((p): p is LanguageModelTextPart => p instanceof LanguageModelTextPart)
        .map(p => p.value)
        .join('');
      const toolName = toolNameByCallId.get(tr.callId) ?? 'unknown';
      toolResults.push({
        type: 'tool-result',
        toolCallId: tr.callId,
        toolName: toolName,
        output: { type: 'text', value: text },
      });
    }

    if (toolResults.length > 0) {
      result.push({ role: 'tool', content: toolResults });
    }
    if (contentArray.length > 0) {
      result.push({ role, content: contentArray });
    }
  }

  return result;
}
