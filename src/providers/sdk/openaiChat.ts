import * as vscode from 'vscode';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText, tool } from 'ai';
import { jsonSchema } from '@ai-sdk/provider-utils';
import { convertMessages, mapModelOptions } from './utils';

/**
 * Streams a chat completion using the OpenAI Chat Completions API via @ai-sdk/openai.
 */
export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

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
  onUsage?: (usage: TokenUsage) => void,
): Promise<void> {
  const openai = createOpenAI({ apiKey, baseURL: baseUrl });

  const sdkMessages = convertMessages(messages);

  // Build tool set for the AI SDK
  const sdkTools: Record<string, any> = {};
  if (tools?.length) {
    for (const t of tools) {
      sdkTools[t.name] = tool({
        description: t.description,
        inputSchema: jsonSchema(t.inputSchema ?? { type: 'object', properties: {} }),
        execute: async (input: unknown) => input,
      });
    }
  }

  const abort = new AbortController();
  token.onCancellationRequested(() => abort.abort());

  let streamError: unknown;

  const result = streamText({
    model: openai(modelId),
    messages: sdkMessages as any,
    maxOutputTokens: maxTokens ?? 16384,
    tools: Object.keys(sdkTools).length > 0 ? (sdkTools as any) : undefined,
    abortSignal: abort.signal,
    ...mapModelOptions(modelOptions),
    onError: (event) => { streamError = event.error; },
  });

  let promptTokens = 0;
  let completionTokens = 0;

  try {
    for await (const textPart of result.textStream) {
      if (token.isCancellationRequested) break;
      progress.report(new vscode.LanguageModelTextPart(textPart));
      completionTokens += estimateTokens(textPart);
    }

    if (streamError) throw streamError;

    const toolCalls = await result.toolCalls;
    if (toolCalls?.length) {
      for (const tc of toolCalls) {
        if (token.isCancellationRequested) break;
        progress.report(
          new vscode.LanguageModelToolCallPart(tc.toolCallId, tc.toolName, tc.input as Record<string, unknown>),
        );
      }
    }

    const reasoningText = await Promise.resolve(result.reasoningText).catch(() => undefined);
    if (reasoningText) {
      const ThinkingPart = (vscode as any).LanguageModelThinkingPart;
      if (ThinkingPart) progress.report(new ThinkingPart(reasoningText));
    }

    // Report usage
    promptTokens = estimatePromptTokens(messages);
    if (onUsage) {
      onUsage({ prompt: promptTokens, completion: completionTokens, total: promptTokens + completionTokens });
    }
  } catch (err: any) {
    throw new Error(`OpenAI stream error: ${err.message ?? err}`);
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimatePromptTokens(messages: readonly vscode.LanguageModelChatRequestMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    for (const part of msg.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        total += estimateTokens(part.value);
      }
    }
  }
  return total;
}
