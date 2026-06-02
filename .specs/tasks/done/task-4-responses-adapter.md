# Task 4: Create OpenAI Responses API Adapter

## Status: pending
## Depends On: Task 1 (modelRegistry), Task 7 (types)
## Parallel With: Task 3

## Objective

Create `src/streaming/openaiResponsesAdapter.ts` — converts VS Code `LanguageModelChatMessage[]` to OpenAI Responses API format and streams responses back as VS Code `LanguageModelResponsePart`.

## Input

- Task 7 output: `src/client/types.ts` — Responses API response types
- Current `src/streaming/responseStreamer.ts` — existing SSE parsing patterns
- OpenAI Responses API docs: uses `response.output_text.delta` events

## Output

Create file: `src/streaming/openaiResponsesAdapter.ts`

## Specification

```typescript
// src/streaming/openaiResponsesAdapter.ts

import * as vscode from 'vscode';

// --- Request Format ---

export interface ResponsesRequest {
  model: string;
  input: ResponsesInputPart[];       // Messages in Responses format
  max_output_tokens?: number;
  tools?: ResponsesTool[];
  temperature?: number;
  stream: boolean;
  previous_response_id?: string;     // For stateful conversations
}

export type ResponsesInputPart =
  | { role: 'user'; content: string | ResponsesContentPart[] }
  | { role: 'assistant'; content: string | ResponsesContentPart[] }
  | { type: 'function_call_output'; call_id: string; output: string };

export type ResponsesContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string };

export interface ResponsesTool {
  type: 'function';
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

// Convert VS Code messages to Responses API format
export function toResponsesRequest(
  messages: readonly vscode.LanguageModelChatMessage[],
  modelId: string,
  maxOutputTokens: number
): ResponsesRequest;

// --- Response Streaming ---

export interface ResponsesStreamCallbacks {
  onText(text: string): void;
  onThinking(text: string): void;
  onThinkingDone(): void;
  onToolCall(id: string, name: string, args: Record<string, unknown>): void;
  onUsage(usage: { input_tokens: number; output_tokens: number; total_tokens: number }): void;
  onError(error: Error): void;
  onDone(): void;
}

// Parse Responses API SSE stream
// Event types:
//   response.created → initial response object
//   response.output_item.added → new output item (text, function_call, etc.)
//   response.content_part.added → content part within text item
//   response.output_text.delta → text content delta
//   response.function_call_arguments.delta → tool call arguments delta
//   response.output_item.done → output item complete
//   response.completed → final response with usage
export async function streamResponsesResponse(
  response: Response,
  callbacks: ResponsesStreamCallbacks,
  signal?: AbortSignal
): Promise<void>;
```

## Responses API SSE Event Format

```
event: response.created
data: {"type":"response.created","response":{"id":"resp_...","model":"gpt-5.4","output":[]}}

event: response.output_item.added
data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","role":"assistant","content":[]}}

event: response.content_part.added
data: {"type":"response.content_part.added","output_index":0,"content_index":0,"part":{"type":"output_text","text":""}}

event: response.output_text.delta
data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"Hello"}

event: response.content_part.done
data: {"type":"response.content_part.done","output_index":0,"content_index":0,"part":{"type":"output_text","text":"Hello world"}}

event: response.completed
data: {"type":"response.completed","response":{"id":"resp_...","usage":{"input_tokens":100,"output_tokens":50,"total_tokens":150}}}
```

## Validation

```bash
# Must compile
cd F:\accuro-ias\opencode-chat\opencode-zen-copilot && npx tsc --noEmit src/streaming/openaiResponsesAdapter.ts 2>&1 | head -20

# Must export functions
node -e "const a = require('./out/streaming/openaiResponsesAdapter'); console.log(typeof a.toResponsesRequest === 'function' && typeof a.streamResponsesResponse === 'function' ? 'PASS' : 'FAIL')"
```

## Acceptance Criteria

- [ ] File `src/streaming/openaiResponsesAdapter.ts` exists
- [ ] Exports `toResponsesRequest()` — converts VS Code messages to Responses format
- [ ] Exports `streamResponsesResponse()` — parses Responses API SSE events
- [ ] User messages → `role: 'user'` with `input_text` content parts
- [ ] Assistant messages → `role: 'assistant'` with text content
- [ ] Tool calls → `function_call` output items
- [ ] Tool results → `function_call_output` input items
- [ ] Text deltas parsed from `response.output_text.delta` events
- [ ] Tool call arguments accumulated from `response.function_call_arguments.delta`
- [ ] Usage reported from `response.completed` event
- [ ] Compiles without TypeScript errors
