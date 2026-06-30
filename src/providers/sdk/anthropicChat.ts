import { LanguageModelChatRequestMessage, LanguageModelChatTool, Progress, LanguageModelResponsePart, CancellationToken, LanguageModelTextPart, LanguageModelToolCallPart, LanguageModelDataPart } from 'vscode';
import { createAnthropic } from '@ai-sdk/anthropic';
import { streamText, LanguageModel, tool, Tool } from 'ai';
import { jsonSchema } from '@ai-sdk/provider-utils';
import { convertMessages, mapModelOptions } from './utils';

/**
 * Streams a chat completion using the Anthropic Messages API via @ai-sdk/anthropic.
 */
export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

export async function streamAnthropicChat(
  apiKey: string | undefined,
  baseUrl: string,
  modelId: string,
  maxTokens: number | undefined,
  messages: readonly LanguageModelChatRequestMessage[],
  tools: LanguageModelChatTool[] | undefined,
  modelOptions: Record<string, unknown>,
  progress: Progress<LanguageModelResponsePart>,
  token: CancellationToken,
  onUsage?: (usage: TokenUsage) => void,
): Promise<void> {
  const anthropic = createAnthropic({ apiKey: apiKey || undefined, baseURL: baseUrl });

  const vsCodeMessages = convertMessages(messages);
  const systemMessage = vsCodeMessages.find(m => m.role === 'system');
  const chatMessages = vsCodeMessages.filter(m => m.role !== 'system');

  // Build tool set for the AI SDK
  const sdkTools: Record<string, Tool> = {};
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
    tools: Object.keys(sdkTools).length > 0 ? (sdkTools as unknown as Record<string, Tool>) : undefined,
    abortSignal: abort.signal,
    ...mapModelOptions(modelOptions),
    onError: (event) => { streamError = event.error; },
  });

  let promptTokens = 0;
  let completionTokens = 0;

  try {
    for await (const textPart of result.textStream) {
      if (token.isCancellationRequested) break;
      progress.report(new LanguageModelTextPart(textPart));
      completionTokens += estimateTokens(textPart);
    }

    if (streamError) throw streamError;

    // Report tool calls if any
    const toolCalls = await result.toolCalls;
    if (toolCalls?.length) {
      for (const tc of toolCalls) {
        if (token.isCancellationRequested) break;
        progress.report(
          new LanguageModelToolCallPart(tc.toolCallId, tc.toolName, tc.input as Record<string, unknown>),
        );
      }
    }

    // Report reasoning if available
    const reasoningText = await Promise.resolve(result.reasoningText).catch(() => undefined);
    if (reasoningText) {
      const ThinkingPartClass = (globalThis as unknown as { vscode?: { LanguageModelThinkingPart?: new (...args: unknown[]) => LanguageModelResponsePart } }).vscode?.LanguageModelThinkingPart;
      if (ThinkingPartClass) progress.report(new ThinkingPartClass(reasoningText));
    }

    // Report usage to VS Code for context counter using LanguageModelDataPart
    try {
      const usage = await result.usage as { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined;
      
      if (usage && (usage.promptTokens ?? 0) > 0) {
        // Report to VS Code for context counter using 'usage' mime type
        // VS Code expects this format: { prompt_tokens, completion_tokens, total_tokens }
        const usageData = {
          prompt_tokens: usage.promptTokens ?? 0,
          completion_tokens: usage.completionTokens ?? 0,
          total_tokens: usage.totalTokens ?? ((usage.promptTokens ?? 0) + (usage.completionTokens ?? 0))
        };
        
        // Use the static json() method which is part of the public API
        progress.report(LanguageModelDataPart.json(usageData, 'usage'));
        
        // Callback for internal usage tracking
        if (onUsage) {
          onUsage({ prompt: usage.promptTokens ?? 0, completion: usage.completionTokens ?? 0, total: usage.totalTokens ?? ((usage.promptTokens ?? 0) + (usage.completionTokens ?? 0)) });
        }
      } else {
        // Fallback to estimation if usage not available
        promptTokens = estimatePromptTokens(messages);
        if (onUsage) {
          onUsage({ prompt: promptTokens, completion: completionTokens, total: promptTokens + completionTokens });
        }
      }
    } catch {
      // Fallback to estimation on error
      promptTokens = estimatePromptTokens(messages);
      if (onUsage) {
        onUsage({ prompt: promptTokens, completion: completionTokens, total: promptTokens + completionTokens });
      }
    }
  } catch (err: unknown) {
    const message = extractErrorMessage(err);
    throw new Error(`Anthropic stream error: ${message}`);
  }
}

function extractErrorMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    if ('message' in err && typeof (err as Record<string, unknown>).message === 'string') {
      return (err as Record<string, string>).message;
    }
    if ('error' in err && typeof (err as Record<string, unknown>).error === 'object') {
      const inner = (err as Record<string, { message?: string }>).error;
      if (inner?.message) return inner.message;
    }
    return JSON.stringify(err);
  }
  return String(err);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimatePromptTokens(messages: readonly LanguageModelChatRequestMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    for (const part of msg.content) {
      if (part instanceof LanguageModelTextPart) {
        total += estimateTokens(part.value);
      }
    }
  }
  return total;
}
