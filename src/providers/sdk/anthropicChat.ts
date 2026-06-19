import * as vscode from 'vscode';
import { createAnthropic } from '@ai-sdk/anthropic';
import { streamText, LanguageModel, tool } from 'ai';
import { jsonSchema } from '@ai-sdk/provider-utils';
import { convertMessages, mapModelOptions } from './utils';

/**
 * Streams a chat completion using the Anthropic Messages API via @ai-sdk/anthropic.
 */
export async function streamAnthropicChat(
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
  const anthropic = createAnthropic({ apiKey, baseURL: baseUrl });

  const vsCodeMessages = convertMessages(messages);
  const systemMessage = vsCodeMessages.find(m => m.role === 'system');
  const chatMessages = vsCodeMessages.filter(m => m.role !== 'system');

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
    model: anthropic(modelId) as unknown as LanguageModel,
    messages: chatMessages as any,
    ...(systemMessage ? { system: systemMessage.content as string } : {}),
    maxOutputTokens: maxTokens ?? 8192,
    tools: Object.keys(sdkTools).length > 0 ? (sdkTools as any) : undefined,
    abortSignal: abort.signal,
    ...mapModelOptions(modelOptions),
    onError: (event) => { streamError = event.error; },
  });

  try {
    for await (const textPart of result.textStream) {
      if (token.isCancellationRequested) break;
      progress.report(new vscode.LanguageModelTextPart(textPart));
    }

    if (streamError) throw streamError;

    // Report tool calls if any
    const toolCalls = await result.toolCalls;
    if (toolCalls?.length) {
      for (const tc of toolCalls) {
        if (token.isCancellationRequested) break;
        progress.report(
          new vscode.LanguageModelToolCallPart(tc.toolCallId, tc.toolName, tc.input as Record<string, unknown>),
        );
      }
    }

    // Report reasoning if available
    const reasoningText = await Promise.resolve(result.reasoningText).catch(() => undefined);
    if (reasoningText) {
      const ThinkingPart = (vscode as any).LanguageModelThinkingPart;
      if (ThinkingPart) progress.report(new ThinkingPart(reasoningText));
    }
  } catch (err: any) {
    throw new Error(`Anthropic stream error: ${err.message ?? err}`);
  }
}
