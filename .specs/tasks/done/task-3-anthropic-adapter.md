# Task 3: Create Anthropic Messages API Adapter

## Status: pending
## Depends On: Task 1 (modelRegistry), Task 7 (types)
## Parallel With: Task 4

## Objective

Create `src/streaming/anthropicAdapter.ts` — converts VS Code `LanguageModelChatMessage[]` to Anthropic Messages API format and streams Anthropic SSE responses back as VS Code `LanguageModelResponsePart`.

## Input

- Task 7 output: `src/client/types.ts` — Anthropic response types
- Current `src/streaming/messageConverter.ts` — existing `convertMessage()` function
- VS Code Copilot BYOK pattern: `anthropicMessageConverter.ts`

## Output

Create file: `src/streaming/anthropicAdapter.ts`

## Specification

Based on VS Code Copilot's `anthropicMessageConverter.ts` pattern:

```typescript
// src/streaming/anthropicAdapter.ts

import * as vscode from 'vscode';

// --- Request Conversion ---

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContentBlock[];
}

export interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string | AnthropicContentBlock[];
  source?: { type: 'base64'; media_type: string; data: string };
}

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system?: string;                    // System prompt extracted from messages
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  temperature?: number;
  stream: boolean;
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

// Convert VS Code messages to Anthropic format
// Key rules (from Copilot BYOK):
// 1. System messages → extracted to separate `system` field
// 2. Adjacent same-role messages → merge (Anthropic enforces alternation)
// 3. Empty text parts → filter out
// 4. LanguageModelToolCallPart → tool_use blocks
// 5. LanguageModelToolResultPart → tool_result blocks
export function toAnthropicMessages(
  messages: readonly vscode.LanguageModelChatMessage[],
  modelId: string
): AnthropicRequest;

// --- Response Streaming ---

export interface AnthropicStreamCallbacks {
  onText(text: string): void;
  onThinking(text: string): void;
  onThinkingDone(): void;
  onToolCall(id: string, name: string, args: Record<string, unknown>): void;
  onUsage(usage: { input_tokens: number; output_tokens: number }): void;
  onError(error: Error): void;
  onDone(): void;
}

// Parse Anthropic SSE stream
// Event types:
//   message_start → model info
//   content_block_start → begin text/tool_use/thinking block
//   content_block_delta → text_delta, thinking_delta, input_json_delta
//   content_block_stop → end of block (emit thinking signature if applicable)
//   message_delta → stop_reason, usage (output tokens)
//   message_stop → stream complete
export async function streamAnthropicResponse(
  response: Response,
  callbacks: AnthropicStreamCallbacks,
  signal?: AbortSignal
): Promise<void>;
```

## Anthropic SSE Event Format

```
event: message_start
data: {"type":"message_start","message":{"id":"msg_...","model":"claude-sonnet-4-6","role":"assistant","content":[],"usage":{"input_tokens":100,"output_tokens":0}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":50}}

event: message_stop
data: {"type":"message_stop"}
```

## Validation

```bash
# Must compile
cd F:\accuro-ias\opencode-chat\opencode-zen-copilot && npx tsc --noEmit src/streaming/anthropicAdapter.ts 2>&1 | head -20

# Must export functions
node -e "const a = require('./out/streaming/anthropicAdapter'); console.log(typeof a.toAnthropicMessages === 'function' && typeof a.streamAnthropicResponse === 'function' ? 'PASS' : 'FAIL')"
```

## Acceptance Criteria

- [ ] File `src/streaming/anthropicAdapter.ts` exists
- [ ] Exports `toAnthropicMessages()` — converts VS Code messages to Anthropic format
- [ ] Exports `streamAnthropicResponse()` — parses Anthropic SSE events
- [ ] System messages extracted to separate `system` field
- [ ] Adjacent same-role messages merged
- [ ] Empty text parts filtered out
- [ ] Tool calls converted to `tool_use` blocks
- [ ] Tool results converted to `tool_result` blocks
- [ ] Thinking blocks handled (content_block_start with type=thinking)
- [ ] Input JSON streaming handled (partial JSON accumulated until valid)
- [ ] Usage reported from message_start + message_delta
- [ ] Compiles without TypeScript errors
