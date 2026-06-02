import * as vscode from 'vscode';
import { ChatCompletionChunk, ToolCall } from '../client/types';

export interface StreamReporter {
  requestId: string;
  sessionId: string;
  reportText(text: string): void;
  reportThinking(text: string): void;
  reportThinkingDone(): void;
  reportToolCall(id: string, name: string, args: Record<string, unknown>): void;
  reportUsage(usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }): void;
  reportReasonerStep(stepId: string, label: string, tokens?: number): void;
  reportThinkingBlock(text: string): void;
}

export interface StreamResult {
  totalContentLength: number;
  totalTextParts: number;
  totalToolCalls: number;
}

export interface StreamOptions {
  chunks: ReadableStream<ChatCompletionChunk>;
  reporter: StreamReporter;
  isCancelled: () => boolean;
  resolveToolCallArgs: (toolCall: ToolCall) => Record<string, unknown>;
}

/**
 * Cleans think tags and other internal markers from text content.
 * Some models (like MiMo) emit <think>... blocks in the content stream.
 * We strip these so the user only sees the final answer.
 */
export function cleanContentText(text: string): string {
  if (!text) return text;
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  cleaned = cleaned.replace(/<think>[\s\S]*$/gi, '');
  cleaned = cleaned.replace(/<\/think>/gi, '');
  return cleaned;
}

export async function streamResponse(options: StreamOptions): Promise<StreamResult> {
  const { chunks, reporter, isCancelled, resolveToolCallArgs } = options;
  const reader = chunks.getReader();
  const decoder = new TextDecoder();

  let totalContentLength = 0;
  let totalTextParts = 0;
  let totalToolCalls = 0;
  let isReasoning = false;
  let reasonerStepCount = 0;
  let firstChunk = true;

  const toolCallBuffers = new Map<number, { id: string; name: string; arguments: string }>();

  try {
    while (true) {
      if (isCancelled()) break;

      const { done, value } = await reader.read();
      if (done) break;

      if (firstChunk && value.id) {
        console.log(`[Stream] first chunk: id=${value.id} model=${value.model}`);
        firstChunk = false;
      }

      for (const choice of value.choices) {
        const delta = choice.delta;

        if (delta.reasoning_content !== undefined) {
          if (!isReasoning) {
            isReasoning = true;
            reasonerStepCount++;
            const stepId = `reasoner-${reporter.requestId}-${reasonerStepCount}`;
            reporter.reportReasonerStep(stepId, `Reasoning #${reasonerStepCount}`);
            reporter.reportThinkingBlock('');
            console.log(`[Stream] reasoning start step=${reasonerStepCount}`);
          }
          reporter.reportThinking(delta.reasoning_content);
        } else if (isReasoning) {
          isReasoning = false;
          reporter.reportThinkingDone();
          console.log(`[Stream] reasoning done`);
        }

        if (delta.content !== undefined && delta.content !== null) {
          const cleaned = cleanContentText(delta.content);
          if (cleaned.length > 0) {
            totalContentLength += cleaned.length;
            totalTextParts++;
            reporter.reportText(cleaned);
          } else if (delta.content.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<\/think>/gi, '').trim().length > 0) {
            totalContentLength += delta.content.length;
          }
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            let buffer = toolCallBuffers.get(idx);
            if (!buffer) {
              buffer = { id: tc.id || '', name: tc.function?.name || '', arguments: '' };
              toolCallBuffers.set(idx, buffer);
            }
            if (tc.id) buffer.id = tc.id;
            if (tc.function?.name) buffer.name = tc.function.name;
            if (tc.function?.arguments) buffer.arguments += tc.function.arguments;
          }
        }

        if (choice.finish_reason === 'stop' || choice.finish_reason === 'length') {
          if (isReasoning) {
            isReasoning = false;
            reporter.reportThinkingDone();
          }
        }
      }

      if (value.usage) {
        console.log(`[Stream] usage: prompt=${value.usage.prompt_tokens} completion=${value.usage.completion_tokens} total=${value.usage.total_tokens}`);
        reporter.reportUsage(value.usage);
      }
    }

    if (isReasoning) {
      reporter.reportThinkingDone();
    }

    for (const [, buffer] of toolCallBuffers) {
      if (buffer.id && buffer.name) {
        const args = resolveToolCallArgs({
          id: buffer.id,
          type: 'function',
          function: {
            name: buffer.name,
            arguments: buffer.arguments,
          },
        });
        totalToolCalls++;
        reporter.reportToolCall(buffer.id, buffer.name, args);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { totalContentLength, totalTextParts, totalToolCalls };
}
