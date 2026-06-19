import * as vscode from 'vscode';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText, tool } from 'ai';
import { jsonSchema } from '@ai-sdk/provider-utils';

/**
 * Streams a chat completion using the OpenAI Chat Completions API via @ai-sdk/openai.
 *
 * Handles text output, tool calls, and reasoning content,
 * reporting each as the appropriate vscode.LanguageModelResponsePart.
 *
 * The API key and base URL are passed explicitly on every call — no stale cache.
 */
export async function streamOpenAIChat(
  apiKey: string,
  baseUrl: string,
  modelId: string,
  maxTokens: number | undefined,
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  tools: vscode.LanguageModelChatTool[] | undefined,
  modelOptions: Record<string, unknown>,
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  token: vscode.CancellationToken,
): Promise<void> {
  const openai = createOpenAI({
    apiKey,
    baseURL: baseUrl,
  });

  const sdkMessages = convertMessages(messages);

  // Build tool set for the AI SDK
  const sdkTools: Record<string, any> = {};
  if (tools?.length) {
    for (const t of tools) {
      sdkTools[t.name] = tool({
        description: t.description,
        inputSchema: jsonSchema(t.inputSchema ?? { type: 'object', properties: {} }),
        execute: async (input: unknown) => {
          // Tool execution is handled by VS Code's tool system
          // This is a placeholder that returns the input
          return input;
        },
      });
    }
  }

  // Map modelOptions to SDK settings
  const sdkSettings: Record<string, unknown> = {};
  if (modelOptions.temperature !== undefined) sdkSettings.temperature = modelOptions.temperature;
  if (modelOptions.topP !== undefined) sdkSettings.topP = modelOptions.topP;
  if (modelOptions.maxOutputTokens !== undefined) sdkSettings.maxOutputTokens = modelOptions.maxOutputTokens;

  const abort = new AbortController();
  token.onCancellationRequested(() => abort.abort());

  let streamError: unknown;

  const result = streamText({
    model: openai(modelId),
    messages: sdkMessages as any,
    maxOutputTokens: maxTokens ?? 16384,
    tools: Object.keys(sdkTools).length > 0 ? (sdkTools as any) : undefined,
    abortSignal: abort.signal,
    ...sdkSettings,
    onError: (event) => {
      streamError = event.error;
      console.error('[OpenAIChat] stream error:', event.error);
    },
  });

  try {
    for await (const textPart of result.textStream) {
      if (token.isCancellationRequested) break;
      progress.report(new vscode.LanguageModelTextPart(textPart));
    }

    if (streamError) {
      throw streamError instanceof Error ? streamError : new Error(String(streamError));
    }

    const toolCalls = await result.toolCalls;
    if (toolCalls?.length) {
      for (const tc of toolCalls) {
        if (token.isCancellationRequested) break;
        progress.report(
          new vscode.LanguageModelToolCallPart(
            tc.toolCallId,
            tc.toolName,
            tc.input as Record<string, unknown>,
          ),
        );
      }
    }

    const reasoningText = await result.reasoningText.then(v => v, () => undefined);
    if (reasoningText && typeof reasoningText === 'string') {
      const ThinkingPart = (vscode as any).LanguageModelThinkingPart;
      if (ThinkingPart) {
        progress.report(new ThinkingPart(reasoningText) as vscode.LanguageModelResponsePart);
      }
    }
  } catch (err: any) {
    throw new Error(`OpenAI stream error: ${err.message ?? err}`);
  }
}

// ── Message conversion ─────────────────────────────────────────────────────

function convertMessages(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
): Array<{ role: string; content: any }> {
  const result: Array<{ role: string; content: any }> = [];
  
  // Track tool names by callId from ToolCallParts to use in ToolResultParts
  const toolNameByCallId = new Map<string, string>();

  // First pass: collect all tool call names
  for (const msg of messages) {
    for (const part of msg.content) {
      if (part instanceof vscode.LanguageModelToolCallPart) {
        toolNameByCallId.set(part.callId, part.name);
      }
    }
  }

  for (const msg of messages) {
    const isAssistant = msg.role === vscode.LanguageModelChatMessageRole.Assistant;
    const isSystem = msg.role === (vscode as any).LanguageModelChatMessageRole.System;

    if (isSystem) {
      const text = msg.content
        .filter((p): p is vscode.LanguageModelTextPart => p instanceof vscode.LanguageModelTextPart)
        .map(p => p.value)
        .join('\n\n');
      result.push({ role: 'system', content: text });
      continue;
    }

    const role = isAssistant ? 'assistant' : 'user';
    const textParts: vscode.LanguageModelTextPart[] = [];
    const toolCallParts: vscode.LanguageModelToolCallPart[] = [];
    const toolResultParts: vscode.LanguageModelToolResultPart[] = [];

    for (const part of msg.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        textParts.push(part);
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        toolCallParts.push(part);
      } else if (part instanceof vscode.LanguageModelToolResultPart) {
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
        .filter((p): p is vscode.LanguageModelTextPart => p instanceof vscode.LanguageModelTextPart)
        .map(p => p.value)
        .join('');
      // Get the tool name from our tracking map, fallback to 'unknown' if not found
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
