/**
 * Cliente para LMStudio local (API compatible con OpenAI)
 * Endpoint: http://localhost:1234/v1/
 */

export interface LMStudioMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LMStudioResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    completion_tokens_details?: {
      reasoning_tokens: number;
    };
  };
}

export interface LMStudioStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }>;
}

const BASE_URL = 'http://localhost:1234/v1';

export async function chatCompletion(
  model: string,
  messages: LMStudioMessage[],
  temperature: number = 0.7,
  max_tokens: number = 500
): Promise<LMStudioResponse> {
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens,
      stream: false
    })
  });

  if (!response.ok) {
    throw new Error(`LMStudio error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export async function* streamChatCompletion(
  model: string,
  messages: LMStudioMessage[],
  temperature: number = 0.7,
  max_tokens: number = 500
): AsyncGenerator<LMStudioStreamChunk, void, unknown> {
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens,
      stream: true
    })
  });

  if (!response.ok) {
    throw new Error(`LMStudio error: ${response.status} ${response.statusText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            yield data;
          } catch {
            // skip malformed lines
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function listModels(): Promise<string[]> {
  const response = await fetch(`${BASE_URL}/models`);
  if (!response.ok) {
    throw new Error(`LMStudio error: ${response.status}`);
  }
  const data = await response.json();
  return data.data.map((m: any) => m.id);
}
