# Task 7: Add Anthropic/Google Response Types

## Status: pending
## Depends On: none (independent)
## Parallel With: Task 1, Task 2, Task 6

## Objective

Extend `src/client/types.ts` with response types for Anthropic Messages API and OpenAI Responses API formats.

## Input

- Current `src/client/types.ts` — existing OpenAI Chat Completion types
- Anthropic Messages API response format documentation
- OpenAI Responses API response format documentation

## Output

Modify file: `src/client/types.ts`

## Specification

### Add Anthropic types

```typescript
// --- Anthropic Messages API ---

export interface AnthropicMessageResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
  usage: { input_tokens: number; output_tokens: number };
}

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicThinkingBlock;

export interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

export interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AnthropicThinkingBlock {
  type: 'thinking';
  thinking: string;
}

// Anthropic SSE event types
export type AnthropicSSEEvent =
  | { type: 'message_start'; message: AnthropicMessageResponse }
  | { type: 'content_block_start'; index: number; content_block: AnthropicContentBlock }
  | { type: 'content_block_delta'; index: number; delta: AnthropicDelta }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason: string }; usage: { output_tokens: number } }
  | { type: 'message_stop' };

export type AnthropicDelta =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; thinking: string }
  | { type: 'input_json_delta'; partial_json: string };
```

### Add OpenAI Responses API types

```typescript
// --- OpenAI Responses API ---

export interface ResponsesAPIResponse {
  id: string;
  object: 'response';
  model: string;
  output: ResponsesOutputItem[];
  usage: ResponsesUsage;
}

export type ResponsesOutputItem =
  | ResponsesMessageOutput
  | ResponsesFunctionCallOutput;

export interface ResponsesMessageOutput {
  type: 'message';
  role: 'assistant';
  content: ResponsesContentPart[];
}

export interface ResponsesContentPart {
  type: 'output_text';
  text: string;
}

export interface ResponsesFunctionCallOutput {
  type: 'function_call';
  id: string;
  call_id: string;
  name: string;
  arguments: string;
}

export interface ResponsesUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  output_tokens_details?: { reasoning_tokens?: number };
}

// Responses API SSE event types
export type ResponsesSSEEvent =
  | { type: 'response.created'; response: ResponsesAPIResponse }
  | { type: 'response.output_item.added'; output_index: number; item: ResponsesOutputItem }
  | { type: 'response.content_part.added'; output_index: number; content_index: number; part: ResponsesContentPart }
  | { type: 'response.output_text.delta'; output_index: number; content_index: number; delta: string }
  | { type: 'response.function_call_arguments.delta'; output_index: number; item_index: number; delta: string }
  | { type: 'response.output_item.done'; output_index: number; item: ResponsesOutputItem }
  | { type: 'response.completed'; response: ResponsesAPIResponse };
```

### Add Google Gemini types (minimal)

```typescript
// --- Google Gemini API ---

export interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content: {
      parts: GeminiPart[];
      role: string;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
    thoughtsTokenCount?: number;
  };
}

export type GeminiPart =
  | { text: string }
  | { thought: boolean; text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { thoughtSignature: string };
```

## Validation

```bash
# Must compile
cd F:\accuro-ias\opencode-chat\opencode-zen-copilot && npx tsc --noEmit src/client/types.ts 2>&1 | head -20

# Must export new types
grep -n "AnthropicMessageResponse\|ResponsesAPIResponse\|GeminiGenerateContentResponse" src/client/types.ts | head -5
```

## Acceptance Criteria

- [ ] `AnthropicMessageResponse`, `AnthropicContentBlock`, `AnthropicSSEEvent` types defined
- [ ] `ResponsesAPIResponse`, `ResponsesOutputItem`, `ResponsesSSEEvent` types defined
- [ ] `GeminiGenerateContentResponse`, `GeminiPart` types defined
- [ ] All types are `export interface` or `export type`
- [ ] Compiles without TypeScript errors
- [ ] All validation bash commands pass
