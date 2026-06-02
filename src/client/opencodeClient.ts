import {
  ApiModelsResponse,
  ApiUsageResponse,
  ApiUserResponse,
  ApiOrgsResponse,
  ApiConsoleOrgsResponse,
  ApiConsoleResponse,
  ChatCompletionRequest,
  ChatCompletionChunk,
} from './types';
import { ApiEndpoint } from './endpoints';

export class OpenCodeClient {
  async listModels(apiKey: string, endpoint: ApiEndpoint, signal?: AbortSignal): Promise<ApiModelsResponse> {
    const response = await fetch(`${endpoint}/models`, {
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
    return (await response.json()) as ApiModelsResponse;
  }

  async getUsage(apiKey: string, endpoint: ApiEndpoint, signal?: AbortSignal): Promise<ApiUsageResponse | undefined> {
    const url = `${endpoint}/usage`;
    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal,
      });
      const status = response.status;
      const text = await response.text().catch(() => '');
      if (status === 404 || text === '') {
        console.log(`[OpenCodeClient] /usage returned ${status} — ${text || 'empty body'}`);
        return undefined;
      }
      if (!response.ok) {
        console.log(`[OpenCodeClient] /usage HTTP ${status}: ${text}`);
        return undefined;
      }
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        console.log(`[OpenCodeClient] /usage non-JSON response: ${text.slice(0, 200)}`);
        return undefined;
      }
      console.log(`[OpenCodeClient] /usage response keys: ${Object.keys(parsed).join(', ')}`);
      return parsed as ApiUsageResponse;
    } catch (err) {
      console.log(`[OpenCodeClient] /usage exception: ${err}`);
      return undefined;
    }
  }

  async getUser(apiKey: string, endpoint: ApiEndpoint, signal?: AbortSignal): Promise<ApiUserResponse | undefined> {
    try {
      const response = await fetch(`${endpoint}/api/user`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal,
      });
      if (!response.ok) {
        console.log(`[OpenCodeClient] /api/user HTTP ${response.status}`);
        return undefined;
      }
      return (await response.json()) as ApiUserResponse;
    } catch (err) {
      console.log(`[OpenCodeClient] /api/user exception: ${err}`);
      return undefined;
    }
  }

  async getOrgs(apiKey: string, endpoint: ApiEndpoint, signal?: AbortSignal): Promise<ApiOrgsResponse | undefined> {
    try {
      const response = await fetch(`${endpoint}/api/orgs`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal,
      });
      if (!response.ok) {
        console.log(`[OpenCodeClient] /api/orgs HTTP ${response.status}`);
        return undefined;
      }
      return (await response.json()) as ApiOrgsResponse;
    } catch (err) {
      console.log(`[OpenCodeClient] /api/orgs exception: ${err}`);
      return undefined;
    }
  }

  async getConsoleOrgs(apiKey: string, endpoint: ApiEndpoint, signal?: AbortSignal): Promise<ApiConsoleOrgsResponse | undefined> {
    try {
      const response = await fetch(`${endpoint}/experimental/console/orgs`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal,
      });
      if (!response.ok) {
        console.log(`[OpenCodeClient] /experimental/console/orgs HTTP ${response.status}`);
        return undefined;
      }
      return (await response.json()) as ApiConsoleOrgsResponse;
    } catch (err) {
      console.log(`[OpenCodeClient] /experimental/console/orgs exception: ${err}`);
      return undefined;
    }
  }

  async getConsole(apiKey: string, endpoint: ApiEndpoint, signal?: AbortSignal): Promise<ApiConsoleResponse | undefined> {
    try {
      const response = await fetch(`${endpoint}/experimental/console`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal,
      });
      if (!response.ok) {
        console.log(`[OpenCodeClient] /experimental/console HTTP ${response.status}`);
        return undefined;
      }
      return (await response.json()) as ApiConsoleResponse;
    } catch (err) {
      console.log(`[OpenCodeClient] /experimental/console exception: ${err}`);
      return undefined;
    }
  }

  streamChatCompletion(
    request: ChatCompletionRequest,
    apiKey: string,
    endpoint: ApiEndpoint,
    signal?: AbortSignal
  ): ReadableStream<ChatCompletionChunk> {
    return new ReadableStream({
      start: async (controller) => {
        try {
          const response = await fetch(`${endpoint}/chat/completions`, {
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
