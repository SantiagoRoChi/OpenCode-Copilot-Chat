# Task 2: Create Unified API Client

## Status: pending
## Depends On: Task 1 (modelRegistry)
## Parallel With: Task 6, Task 7

## Objective

Create `src/client/openCodeApiClient.ts` — a unified HTTP client that handles all three OpenCode API formats (Chat Completions, Responses, Messages) with proper auth, streaming, and error handling.

## Input

- Task 1 output: `src/client/modelRegistry.ts` — `ApiFormat`, `ModelEndpoint` types
- Current `src/client/opencodeClient.ts` — existing `streamChatCompletion()` for Chat Completions
- Current `src/client/endpoints.ts` — `ZEN_BASE_URL`, `GO_BASE_URL`
- OpenCode server docs: `POST /chat` accepts OpenAI-compatible format

## Output

Create file: `src/client/openCodeApiClient.ts`

## Specification

```typescript
// src/client/openCodeApiClient.ts

import { ApiFormat, ModelEndpoint } from './modelRegistry';

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];
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

  // Main entry point — routes to correct format handler
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

  // Chat Completions — existing SSE format (data: {...})
  private async streamChatCompletions(
    request: ChatRequest,
    chatEndpoint: string,
    signal?: AbortSignal,
    callbacks?: StreamCallbacks
  ): Promise<void> {
    // SSE parsing: lines prefixed with "data: ", "[DONE]" terminates
    // Parse ChatCompletionChunk format
    // Handle delta.content, delta.reasoning_content, delta.tool_calls
  }

  // Responses API — OpenAI newer format
  private async streamResponsesApi(
    request: ChatRequest,
    chatEndpoint: string,
    signal?: AbortSignal,
    callbacks?: StreamCallbacks
  ): Promise<void> {
    // POST {baseUrl}/responses with stream: true
    // SSE events: response.output_text.delta, response.function_call_arguments.delta
    // response.completed with usage
  }

  // Messages API — Anthropic format
  private async streamMessagesApi(
    request: ChatRequest,
    chatEndpoint: string,
    signal?: AbortSignal,
    callbacks?: StreamCallbacks
  ): Promise<void> {
    // Convert messages to Anthropic format:
    //   system messages → separate "system" field
    //   user/assistant alternating (merge adjacent same-role)
    //   tool_calls → tool_use blocks
    //   tool results → tool_result blocks
    // POST {baseUrl}/messages with anthropic-version header
    // SSE events: content_block_start, content_block_delta, content_block_stop, message_delta
  }

  // Google API — Gemini format
  private async streamGoogleApi(
    request: ChatRequest,
    chatEndpoint: string,
    signal?: AbortSignal,
    callbacks?: StreamCallbacks
  ): Promise<void> {
    // Convert messages to Gemini format:
    //   system → systemInstruction
    //   assistant → model role
    //   tool calls → functionCall parts
    // POST to model-specific endpoint
    // Parse streaming response
  }

  // Non-streaming completion (for token counting)
  async complete(request: ChatRequest, endpoint: ModelEndpoint): Promise<string> {
    // Calls streamChat with stream: false, collects full response
  }
}
```

## Auth Handling

```typescript
// For external APIs (Zen/Go):
headers['Authorization'] = `Bearer ${apiKey}`;

// For local server:
headers['Content-Type'] = 'application/json';
// Basic auth if configured via OPENCODE_SERVER_PASSWORD
```

## Validation

```bash
# Must compile
cd F:\accuro-ias\opencode-chat\opencode-zen-copilot && npx tsc --noEmit src/client/openCodeApiClient.ts 2>&1 | head -20

# Must export class
node -e "const c = require('./out/client/openCodeApiClient'); console.log(typeof c.OpenCodeApiClient === 'function' ? 'PASS' : 'FAIL')"

# Must have streamChat method
node -e "const c = require('./out/client/openCodeApiClient'); const i = new c.OpenCodeApiClient('http://localhost:4096'); console.log(typeof i.streamChat === 'function' ? 'PASS' : 'FAIL')"
```

## Acceptance Criteria

- [ ] File `src/client/openCodeApiClient.ts` exists
- [ ] Exports `OpenCodeApiClient` class
- [ ] Has `streamChat()` method that routes by `ApiFormat`
- [ ] Chat Completions handler parses SSE `data: {...}` lines
- [ ] Responses API handler parses `response.output_text.delta` events
- [ ] Messages API handler converts messages to Anthropic format and parses SSE
- [ ] Google API handler converts messages to Gemini format
- [ ] Auth: Bearer token for external, Basic for local server
- [ ] Cancellation via AbortSignal
- [ ] StreamCallbacks for text, thinking, tool calls, usage, errors
- [ ] Compiles without TypeScript errors
- [ ] All validation bash commands pass
