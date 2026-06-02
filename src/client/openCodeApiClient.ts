import { ApiFormat, ModelEndpoint } from './modelRegistry';
import { ChatMessage } from './types';

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  tools?: { type: 'function'; function: { name: string; description?: string; parameters?: unknown } }[];
  tool_choice?: 'auto' | 'required' | 'none';
  stream: boolean;
}

export interface StreamCallbacks {
  onText(text: string): void;
  onThinking(text: string): void;
  onThinkingDone(): void;
  onToolCall(id: string, name: string, args: Record<string, unknown>): void;
  onUsage(usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }): void;
  onError(error: Error): void;
  onDone(): void;
}

export class OpenCodeApiClient {
  constructor(private baseUrl: string, private apiKey?: string) {}

  async streamChat(
    request: ChatRequest,
    endpoint: ModelEndpoint,
    signal?: AbortSignal,
    callbacks?: StreamCallbacks
  ): Promise<void> {
    switch (endpoint.apiFormat) {
      case 'openai-compatible':
        return this.streamChatCompletions(request, endpoint.chatEndpoint, signal, callbacks);
      case 'openai':
        return this.streamResponsesApi(request, endpoint.chatEndpoint, signal, callbacks);
      case 'anthropic':
        return this.streamMessagesApi(request, endpoint.chatEndpoint, signal, callbacks);
      case 'google':
        return this.streamGoogleApi(request, endpoint.chatEndpoint, signal, callbacks);
    }
  }

  async complete(request: ChatRequest, endpoint: ModelEndpoint): Promise<string> {
    let result = '';
    const collect: StreamCallbacks = {
      onText(text) { result += text; },
      onThinking() {},
      onThinkingDone() {},
      onToolCall() {},
      onUsage() {},
      onError(err) { throw err; },
      onDone() {},
    };
    const nonStreaming = { ...request, stream: false };
    await this.streamChat(nonStreaming, endpoint, undefined, collect);
    return result;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private streamChatCompletions(
    request: ChatRequest,
    chatEndpoint: string,
    signal?: AbortSignal,
    callbacks?: StreamCallbacks
  ): Promise<void> {
    return this.sseStream(
      `${this.baseUrl}${chatEndpoint}`,
      { ...request, stream: true },
      this.buildHeaders(),
      signal,
      this.parseChatCompletionEvent(callbacks)
    );
  }

  private streamResponsesApi(
    request: ChatRequest,
    chatEndpoint: string,
    signal?: AbortSignal,
    callbacks?: StreamCallbacks
  ): Promise<void> {
    return this.sseStream(
      `${this.baseUrl}${chatEndpoint}`,
      { ...request, stream: true },
      this.buildHeaders(),
      signal,
      this.parseResponsesEvent(callbacks)
    );
  }

  private async streamMessagesApi(
    request: ChatRequest,
    chatEndpoint: string,
    signal?: AbortSignal,
    callbacks?: StreamCallbacks
  ): Promise<void> {
    const anthropicBody = this.convertToAnthropic(request);
    const headers = {
      ...this.buildHeaders(),
      'anthropic-version': '2023-06-01',
    };
    return this.sseStream(
      `${this.baseUrl}${chatEndpoint}`,
      anthropicBody,
      headers,
      signal,
      this.parseAnthropicEvent(callbacks)
    );
  }

  private async streamGoogleApi(
    request: ChatRequest,
    chatEndpoint: string,
    signal?: AbortSignal,
    callbacks?: StreamCallbacks
  ): Promise<void> {
    const geminiBody = this.convertToGemini(request);
    return this.sseStream(
      `${this.baseUrl}${chatEndpoint}`,
      geminiBody,
      this.buildHeaders(),
      signal,
      this.parseGoogleEvent(callbacks)
    );
  }

  private async sseStream(
    url: string,
    body: unknown,
    headers: Record<string, string>,
    signal: AbortSignal | undefined,
    parseEvent: (event: string, data: string) => void
  ): Promise<void> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Accept': 'text/event-stream' },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`API request failed: HTTP ${response.status} — ${text}`);
    }
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        let currentEvent = '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed === '') {
            currentEvent = '';
            continue;
          }
          if (trimmed.startsWith('event: ')) {
            currentEvent = trimmed.slice(7);
            continue;
          }
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            if (data === '[DONE]') return;
            parseEvent(currentEvent, data);
            currentEvent = '';
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private parseChatCompletionEvent(callbacks?: StreamCallbacks) {
    return (_event: string, data: string) => {
      if (!callbacks) return;
      try {
        const chunk = JSON.parse(data);
        if (chunk.choices) {
          for (const choice of chunk.choices) {
            const delta = choice.delta;
            if (delta.content) {
              callbacks.onText(delta.content);
            }
            if (delta.reasoning_content) {
              callbacks.onThinking(delta.reasoning_content);
            }
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.id && tc.function?.name) {
                  let args: Record<string, unknown> = {};
                  try {
                    args = JSON.parse(tc.function.arguments || '{}');
                  } catch {}
                  callbacks.onToolCall(tc.id, tc.function.name, args);
                }
              }
            }
          }
        }
        if (chunk.usage) {
          callbacks.onUsage(chunk.usage);
        }
      } catch {}
    };
  }

  private parseResponsesEvent(callbacks?: StreamCallbacks) {
    return (event: string, data: string) => {
      if (!callbacks) return;
      try {
        const parsed = JSON.parse(data);
        if (event === 'response.output_text.delta' || parsed.type === 'response.output_text.delta') {
          const delta = parsed.delta;
          if (typeof delta === 'string') {
            callbacks.onText(delta);
          }
        }
        if (event === 'response.function_call_arguments.delta' || parsed.type === 'response.function_call_arguments.delta') {
          const args = parsed.delta;
          if (typeof args === 'string') {
            try {
              const parsedArgs = JSON.parse(args);
              callbacks.onToolCall(parsed.call_id || '', parsed.name || '', parsedArgs);
            } catch {}
          }
        }
        if (event === 'response.completed' || parsed.type === 'response.completed') {
          const usage = parsed.response?.usage;
          if (usage) {
            callbacks.onUsage({
              prompt_tokens: usage.input_tokens || 0,
              completion_tokens: usage.output_tokens || 0,
              total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
            });
          }
        }
      } catch {}
    };
  }

  private parseAnthropicEvent(callbacks?: StreamCallbacks) {
    let thinkingContent = '';
    let isThinking = false;
    let toolCallId = '';
    let toolCallName = '';
    let toolCallArgs = '';

    return (event: string, data: string) => {
      if (!callbacks) return;
      try {
        const parsed = JSON.parse(data);
        switch (parsed.type) {
          case 'content_block_start': {
            const block = parsed.content_block;
            if (block?.type === 'thinking') {
              isThinking = true;
              thinkingContent = '';
            }
            if (block?.type === 'tool_use') {
              toolCallId = block.id || '';
              toolCallName = block.name || '';
              toolCallArgs = '';
            }
            break;
          }
          case 'content_block_delta': {
            const delta = parsed.delta;
            if (delta?.type === 'thinking_delta' && isThinking) {
              thinkingContent += delta.thinking || '';
              callbacks.onThinking(delta.thinking || '');
            }
            if (delta?.type === 'text_delta') {
              callbacks.onText(delta.text || '');
            }
            if (delta?.type === 'input_json_delta') {
              toolCallArgs += delta.partial_json || '';
            }
            break;
          }
          case 'content_block_stop': {
            if (isThinking) {
              isThinking = false;
              callbacks.onThinkingDone();
            }
            if (toolCallId && toolCallName) {
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(toolCallArgs || '{}');
              } catch {}
              callbacks.onToolCall(toolCallId, toolCallName, args);
              toolCallId = '';
              toolCallName = '';
              toolCallArgs = '';
            }
            break;
          }
          case 'message_delta': {
            const usage = parsed.usage;
            if (usage) {
              callbacks.onUsage({
                prompt_tokens: usage.input_tokens || 0,
                completion_tokens: usage.output_tokens || 0,
                total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
              });
            }
            break;
          }
        }
      } catch {}
    };
  }

  private parseGoogleEvent(callbacks?: StreamCallbacks) {
    return (_event: string, data: string) => {
      if (!callbacks) return;
      try {
        const parsed = JSON.parse(data);
        const candidates = parsed.candidates;
        if (candidates?.[0]?.content?.parts) {
          for (const part of candidates[0].content.parts) {
            if (part.text) {
              callbacks.onText(part.text);
            }
            if (part.functionCall) {
              const fc = part.functionCall;
              callbacks.onToolCall(
                fc.id || `tool-${Date.now()}`,
                fc.name || '',
                typeof fc.args === 'object' ? fc.args : {}
              );
            }
          }
        }
        const usage = parsed.usageMetadata;
        if (usage) {
          callbacks.onUsage({
            prompt_tokens: usage.promptTokenCount || 0,
            completion_tokens: usage.candidatesTokenCount || 0,
            total_tokens: usage.totalTokenCount || 0,
          });
        }
      } catch {}
    };
  }

  private convertToAnthropic(request: ChatRequest): Record<string, unknown> {
    let systemText = '';
    const messages: { role: string; content: unknown }[] = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        systemText = typeof msg.content === 'string' ? msg.content : '';
        continue;
      }

      if (msg.role === 'tool') {
        messages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: msg.tool_call_id || '',
            content: typeof msg.content === 'string' ? msg.content : '',
          }],
        });
        continue;
      }

      if (msg.role === 'assistant' && msg.tool_calls?.length) {
        const content: unknown[] = [];
        if (msg.content) {
          const text = typeof msg.content === 'string' ? msg.content : '';
          if (text) content.push({ type: 'text', text });
        }
        for (const tc of msg.tool_calls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: (() => {
              try { return JSON.parse(tc.function.arguments); }
              catch { return {}; }
            })(),
          });
        }
        messages.push({ role: 'assistant', content });
        continue;
      }

      const text = typeof msg.content === 'string'
        ? msg.content
        : (msg.content as { type: string; text: string }[])
            .filter(p => p.type === 'text')
            .map(p => p.text)
            .join('');
      messages.push({ role: msg.role, content: text });
    }

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      max_tokens: request.max_tokens || 8192,
      stream: request.stream,
    };
    if (systemText) {
      body.system = systemText;
    }
    if (request.tools?.length) {
      body.tools = request.tools.map(t => ({
        name: t.function.name,
        description: t.function.description || '',
        input_schema: t.function.parameters || { type: 'object', properties: {} },
      }));
    }
    return body;
  }

  private convertToGemini(request: ChatRequest): Record<string, unknown> {
    let systemInstruction = '';
    const contents: { role: string; parts: unknown[] }[] = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        systemInstruction = typeof msg.content === 'string' ? msg.content : '';
        continue;
      }

      const role = msg.role === 'assistant' ? 'model' : 'user';
      const parts: unknown[] = [];

      if (msg.role === 'tool') {
        parts.push({
          functionResponse: {
            name: msg.tool_call_id || 'unknown',
            response: { result: typeof msg.content === 'string' ? msg.content : '' },
          },
        });
        contents.push({ role: 'user', parts });
        continue;
      }

      if (typeof msg.content === 'string') {
        parts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const p of msg.content) {
          if (p.type === 'text') {
            parts.push({ text: p.text });
          }
        }
      }

      if (msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.function.arguments); } catch {}
          parts.push({
            functionCall: {
              name: tc.function.name,
              args,
            },
          });
        }
      }

      contents.push({ role, parts });
    }

    const body: Record<string, unknown> = { contents };
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }
    if (request.tools?.length) {
      body.tools = [{
        functionDeclarations: request.tools.map(t => ({
          name: t.function.name,
          description: t.function.description || '',
          parameters: t.function.parameters || { type: 'OBJECT', properties: {} },
        })),
      }];
    }
    if (request.max_tokens) {
      body.generationConfig = { maxOutputTokens: request.max_tokens };
    }
    return body;
  }
}
