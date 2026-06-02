import { ChatCompletionRequest, ChatCompletionChunk, ZenModelsResponse } from './types';

export class ZenClient {
  private baseUrl: string;

  constructor(baseUrl: string = 'https://opencode.ai/zen/v1') {
    this.baseUrl = baseUrl;
  }

  async listModels(apiKey: string, signal?: AbortSignal): Promise<ZenModelsResponse> {
    const response = await fetch(`${this.baseUrl}/models`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Failed to list models: HTTP ${response.status} — ${body}`);
    }

    return response.json() as Promise<ZenModelsResponse>;
  }

  async testConnection(apiKey: string): Promise<{ ok: boolean; modelCount: number; error?: string }> {
    try {
      const result = await this.listModels(apiKey);
      return { ok: true, modelCount: result.data.length };
    } catch (err) {
      return {
        ok: false,
        modelCount: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  streamChatCompletion(
    request: ChatCompletionRequest,
    apiKey: string,
    signal?: AbortSignal,
    baseUrl?: string
  ): ReadableStream<ChatCompletionChunk> {
    const url = baseUrl || this.baseUrl;
    return new ReadableStream({
      start: async (controller) => {
        try {
          const response = await fetch(`${url}/chat/completions`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'Accept': 'text/event-stream',
            },
            body: JSON.stringify({ ...request, stream: true }),
            signal,
          });

          if (!response.ok) {
            const body = await response.text().catch(() => '');
            controller.error(new Error(`Chat completion failed: HTTP ${response.status} — ${body}`));
            return;
          }

          const reader = response.body?.getReader();
          if (!reader) {
            controller.error(new Error('No response body'));
            return;
          }

          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith(':')) continue;

              if (trimmed.startsWith('data: ')) {
                const data = trimmed.slice(6);
                if (data === '[DONE]') {
                  controller.close();
                  return;
                }
                try {
                  const chunk = JSON.parse(data) as ChatCompletionChunk;
                  controller.enqueue(chunk);
                } catch {
                  // Skip malformed chunks
                }
              }
            }
          }

          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });
  }
}
