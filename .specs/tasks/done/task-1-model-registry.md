# Task 1: Create Model Registry

## Status: pending
## Depends On: none
## Parallel With: Task 2, Task 6, Task 7

## Objective

Create `src/client/modelRegistry.ts` — a central registry mapping OpenCode model IDs to their API format, endpoint, token limits, and capabilities. This is the single source of truth for all model metadata.

## Input

- OpenCode Zen docs: models at `https://opencode.ai/zen/v1/models` — GPT uses `/responses`, Claude uses `/messages`, Gemini uses `/models/{id}`, others use `/chat/completions`
- OpenCode Go docs: models at `https://opencode.ai/zen/go/v1/models` — MiniMax/Qwen use `/messages`, others use `/chat/completions`
- Current `src/client/endpoints.ts` — existing endpoint constants
- Current `src/providers/BaseOpenCodeProvider.ts` lines 166-193 — hardcoded `toModelInfo()` and `toChatInformation()`

## Output

Create file: `src/client/modelRegistry.ts`

## Specification

```typescript
// src/client/modelRegistry.ts

export type ApiFormat = 'openai' | 'openai-compatible' | 'anthropic' | 'google';

export interface ModelEndpoint {
  chatEndpoint: string;     // e.g., '/chat/completions', '/responses', '/messages'
  apiFormat: ApiFormat;
}

export interface ModelCapabilities {
  name: string;
  family: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  imageInput: boolean;
  toolCalling: boolean;
  reasoning: boolean;       // Supports reasoning_content / thinking blocks
}

export interface ModelRegistration extends ModelEndpoint, ModelCapabilities {
  id: string;               // Model ID as returned by API
}

// Main lookup functions:
export function getModelEndpoint(provider: 'zen' | 'go' | 'free', modelId: string): ModelEndpoint;
export function getModelCapabilities(modelId: string): ModelCapabilities;
export function getModelRegistration(provider: 'zen' | 'go' | 'free', modelId: string): ModelRegistration;

// Registry data (all models from OpenCode docs):
// Zen models:
//   gpt-5.5, gpt-5.5-pro, gpt-5.4, gpt-5.4-pro, gpt-5.4-mini, gpt-5.4-nano,
//   gpt-5.3-codex, gpt-5.3-codex-spark, gpt-5.2, gpt-5.2-codex,
//   gpt-5.1, gpt-5.1-codex, gpt-5.1-codex-max, gpt-5.1-codex-mini,
//   gpt-5, gpt-5-codex, gpt-5-nano → apiFormat: 'openai', endpoint: '/responses'
//
//   claude-opus-4-8, claude-opus-4-7, claude-opus-4-6, claude-opus-4-5, claude-opus-4-1,
//   claude-sonnet-4-6, claude-sonnet-4-5, claude-sonnet-4,
//   claude-haiku-4-5, claude-3-5-haiku → apiFormat: 'anthropic', endpoint: '/messages'
//
//   gemini-3.5-flash, gemini-3.1-pro, gemini-3-flash → apiFormat: 'google', endpoint: '/models/{id}'
//
//   kimi-k2.6, kimi-k2.5, deepseek-v4-flash, glm-5.1, glm-5,
//   minimax-m2.7, minimax-m2.5, grok-build-0.1, big-pickle,
//   mimo-v2.5-free, nemotron-3-super-free, deepseek-v4-flash-free,
//   qwen3.7-max, qwen3.6-plus, qwen3.5-plus → apiFormat: 'openai-compatible', endpoint: '/chat/completions'
//
// Go models:
//   kimi-k2.6, kimi-k2.5, deepseek-v4-pro, deepseek-v4-flash,
//   glm-5.1, glm-5, mimo-v2.5, mimo-v2.5-pro → apiFormat: 'openai-compatible', endpoint: '/chat/completions'
//
//   minimax-m3, minimax-m2.7, minimax-m2.5,
//   qwen3.7-max, qwen3.6-plus → apiFormat: 'anthropic', endpoint: '/messages'
//
// Free models (subset of Zen free-tier models):
//   mimo-v2.5-free, nemotron-3-super-free, deepseek-v4-flash-free, big-pickle
//   → apiFormat: 'openai-compatible', endpoint: '/chat/completions'
//
// Capabilities per model (from OpenCode pricing/docs):
//   imageInput: true for GPT, Claude, Gemini; false for others
//   toolCalling: true for most; false for mimo-v2.5-free, nemotron-3-super-free
//   reasoning: true for GPT, Claude, Gemini, deepseek; false for kimi, glm, minimax, qwen
//   maxInputTokens/maxOutputTokens: from docs or fallback 128000/32000
```

## Validation

```bash
# Must compile without errors
cd F:\accuro-ias\opencode-chat\opencode-zen-copilot && npx tsc --noEmit src/client/modelRegistry.ts 2>&1 | head -20

# Must export all required functions
node -e "const m = require('./out/client/modelRegistry'); console.log(typeof m.getModelEndpoint, typeof m.getModelCapabilities, typeof m.getModelRegistration)"

# Spot checks:
node -e "const m = require('./out/client/modelRegistry'); const e = m.getModelEndpoint('zen', 'gpt-5.5'); console.log(e.apiFormat === 'openai' && e.chatEndpoint === '/responses' ? 'PASS' : 'FAIL: GPT endpoint')"
node -e "const m = require('./out/client/modelRegistry'); const e = m.getModelEndpoint('zen', 'claude-sonnet-4-6'); console.log(e.apiFormat === 'anthropic' && e.chatEndpoint === '/messages' ? 'PASS' : 'FAIL: Claude endpoint')"
node -e "const m = require('./out/client/modelRegistry'); const e = m.getModelEndpoint('go', 'minimax-m3'); console.log(e.apiFormat === 'anthropic' && e.chatEndpoint === '/messages' ? 'PASS' : 'FAIL: Go minimax endpoint')"
node -e "const m = require('./out/client/modelRegistry'); const c = m.getModelCapabilities('gpt-5.5'); console.log(c.imageInput === true && c.reasoning === true ? 'PASS' : 'FAIL: GPT capabilities')"
node -e "const m = require('./out/client/modelRegistry'); const c = m.getModelCapabilities('mimo-v2.5-free'); console.log(c.toolCalling === false && c.imageInput === false ? 'PASS' : 'FAIL: MiMo capabilities')"
```

## Acceptance Criteria

- [ ] File `src/client/modelRegistry.ts` exists
- [ ] Exports `getModelEndpoint`, `getModelCapabilities`, `getModelRegistration`
- [ ] All Zen models from docs are registered with correct `apiFormat`
- [ ] All Go models from docs are registered with correct `apiFormat`
- [ ] Free models use `openai-compatible` format
- [ ] GPT models → `openai` + `/responses`
- [ ] Claude models → `anthropic` + `/messages`
- [ ] Gemini models → `google` + `/models/{id}`
- [ ] Kimi/DeepSeek/GLM → `openai-compatible` + `/chat/completions`
- [ ] Go MiniMax/Qwen → `anthropic` + `/messages`
- [ ] `imageInput` correct (true for GPT/Claude/Gemini)
- [ ] `reasoning` correct (true for GPT/Claude/Gemini/DeepSeek)
- [ ] Compiles without TypeScript errors
- [ ] All validation bash commands pass
