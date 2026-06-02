# OpenCode Zen Copilot — Multi-Provider Chat Specification

## Overview

Rewrite the OpenCode Zen Copilot extension to support **all OpenCode API formats** (Chat Completions, Responses API, Messages API) across both **external APIs** (Zen, Go, Free) and **local server** connections. Based on VS Code Copilot extension's BYOK architecture patterns.

## Architecture Decision Record

### ADR-001: Three API Formats

OpenCode routes models to different backends. The extension must support:

| Format | Endpoint Pattern | Models (Zen) | Models (Go) |
|--------|-----------------|--------------|-------------|
| Chat Completions | `/chat/completions` | Kimi, DeepSeek, GLM, MiniMax, Grok, Big Pickle, MiMo Free | Kimi, GLM, DeepSeek, MiMo |
| Responses API | `/responses` | GPT 5.x, GPT 5 Nano | — |
| Messages API | `/messages` | Claude Opus/Sonnet/Haiku, Qwen | MiniMax M3/M2.7/M2.5, Qwen3.7 Max, Qwen3.6 Plus |
| Google API | `/models/{id}` | Gemini 3.5 Flash, 3.1 Pro, 3 Flash | — |

### ADR-002: Adapter Pattern (from Copilot BYOK)

Each API format gets a dedicated adapter that converts VS Code's `LanguageModelChatMessage` to the provider's native format and streams responses back as `LanguageModelResponsePart`.

```
VS Code LanguageModelChatMessage
    ↕ (adapter)
Provider-native format (OpenAI, Anthropic, Google)
    ↕ (HTTP)
OpenCode API
```

### ADR-003: Model Registry as Single Source of Truth

A central `modelRegistry.ts` defines per-model:
- Which API format to use (`chatEndpoint`, `apiFormat`)
- Real token limits (`maxInputTokens`, `maxOutputTokens`)
- Capabilities (`imageInput`, `toolCalling`, `reasoning`)

### ADR-004: Server Provider Uses OpenAI-Compatible Format

The local OpenCode server (`opencode serve`) exposes `POST /chat` which accepts OpenAI-compatible format. No adapter needed — use existing `responseStreamer.ts`.

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/client/modelRegistry.ts` | CREATE | Model capabilities + endpoint mapping |
| `src/client/openCodeApiClient.ts` | CREATE | Unified HTTP client for all formats |
| `src/streaming/anthropicAdapter.ts` | CREATE | Messages API adapter |
| `src/streaming/openaiResponsesAdapter.ts` | CREATE | Responses API adapter |
| `src/providers/BaseOpenCodeProvider.ts` | MODIFY | Use modelRegistry, delegate to adapters |
| `src/providers/OpenCodeServerProvider.ts` | MODIFY | Fix streamResponse, auth, use /chat endpoint |
| `src/client/multiServerManager.ts` | MODIFY | Make buildHeaders public |
| `src/client/types.ts` | MODIFY | Add Anthropic/Google response types |

## Dependency Graph

```
[Task 1: modelRegistry] ──→ [Task 3: anthropicAdapter] ──→ [Task 5: BaseProvider] ──→ [Task 8: test]
                          ──→ [Task 4: responsesAdapter] ──→ [Task 5]
[Task 2: apiClient]     ──→ [Task 3]
                          ──→ [Task 4]
[Task 6: serverProvider] ──→ (independent, parallel)
[Task 7: types]         ──→ [Task 3]
                          ──→ [Task 4]
```

## Validation Strategy

Each task has:
- **Input**: Files/code that must exist before starting
- **Output**: Files created/modified
- **Validation**: Bash commands to verify correctness
- **Acceptance Criteria**: Specific checks that must pass

## How to Resume

If context is lost, read `.specs/tasks/draft/` for pending tasks. Each task file contains all context needed to continue. Check `.specs/reports/` for completed task validation reports.
