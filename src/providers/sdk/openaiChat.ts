import {
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelDataPart,
  LanguageModelChatRequestMessage,
  LanguageModelChatTool,
  LanguageModelResponsePart,
  CancellationToken,
  Progress,
} from 'vscode';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText, tool, Tool } from 'ai';
import { jsonSchema } from '@ai-sdk/provider-utils';
import { convertMessages, mapModelOptions } from './utils';
import { UsageTracker } from '../../usage/UsageTracker';
import { getModelRegistration } from '../../client/modelRegistry';

/**
 * Streams a chat completion using the OpenAI Chat Completions API via @ai-sdk/openai.
 */
export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

export async function streamOpenAIChat(
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
  const openai = createOpenAI({ apiKey: apiKey || undefined, baseURL: baseUrl });
  const tracker = new UsageTracker();

  const sdkMessages = convertMessages(messages);

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
    model: openai(modelId),
    messages: sdkMessages as any,
    maxOutputTokens: maxTokens ?? 16384,
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

    const toolCalls = await result.toolCalls;
    if (toolCalls?.length) {
      for (const tc of toolCalls) {
        if (token.isCancellationRequested) break;
        progress.report(
          new LanguageModelToolCallPart(tc.toolCallId, tc.toolName, tc.input as Record<string, unknown>),
        );
      }
    }

    const reasoningText = await Promise.resolve(result.reasoningText).catch(() => undefined);
    if (reasoningText) {
      const ThinkingPartClass = (globalThis as unknown as { vscode?: { LanguageModelThinkingPart?: new (text: string) => LanguageModelResponsePart } }).vscode?.LanguageModelThinkingPart;
      if (ThinkingPartClass) progress.report(new ThinkingPartClass(reasoningText));
    }

    // Report usage to VS Code for context counter using LanguageModelDataPart
    try {
      const usage = await result.usage;
      
      const promptTok = usage?.inputTokens ?? 0;
      const completionTok = usage?.outputTokens ?? 0;
      const totalTok = usage?.totalTokens ?? (promptTok + completionTok);
      
      if (promptTok > 0 || completionTok > 0) {
        // Report to VS Code for context counter using 'usage' mime type
        const usageData = {
          prompt_tokens: promptTok,
          completion_tokens: completionTok,
          total_tokens: totalTok
        };
        const encoder = new TextEncoder();
        progress.report(new LanguageModelDataPart(
          encoder.encode(JSON.stringify(usageData)),
          'usage'
        ));
        
        // Callback for internal usage tracking
        if (onUsage) {
          onUsage({ prompt: promptTok, completion: completionTok, total: totalTok });
        }

        // Track in internal tracker — use provider hint from modelId prefix if available
        const providerHint = modelId.startsWith('go:') ? 'go' : 'zen';
        const registration = getModelRegistration(providerHint, modelId);
        tracker.recordRequest(
          `req-${Date.now()}`,
          'session-default',
          modelId,
          registration.name,
          'zen',
          { prompt: promptTok, completion: completionTok, total: totalTok }
        );

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
    throw new Error(`OpenAI stream error: ${message}`);
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
