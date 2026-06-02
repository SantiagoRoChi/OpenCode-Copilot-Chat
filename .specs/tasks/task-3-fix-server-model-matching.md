# Task 3: Fix server provider model matching with models.dev

## Status: pending
## Depends On: Task 1
## Parallel With: Task 2

## Objective

Ensure server provider models are matched against models.dev data for accurate capabilities, context sizes, and pricing.

## Input

- Task 1 output: Updated `modelRegistry.ts` with correct field parsing
- Current `src/providers/OpenCodeServerProvider.ts` — uses `getModelCapabilities()` but may not match all models

## Output

Modify file: `src/providers/OpenCodeServerProvider.ts`

## Analysis

Server models come from the local OpenCode server's `/provider` endpoint. The model IDs returned by the server should match the IDs in models.dev (e.g., `deepseek-v4-flash`, `kimi-k2.6`).

The current code already calls `getModelCapabilities(modelId)` which searches the models.dev registry. But there might be mismatches if:
1. The server returns model IDs with prefixes (e.g., `opencode/deepseek-v4-flash`)
2. The server returns model IDs in a different format
3. The model doesn't exist in models.dev (e.g., custom models)

## Specification

### Update `fetchModels()` to handle model ID variations

```typescript
// Try matching with different ID formats
function matchModelId(serverModelId: string): ModelCapabilities | undefined {
  // Direct match
  let caps = getModelCapabilities(serverModelId);
  if (caps.name !== serverModelId) return caps; // Found in registry

  // Try without provider prefix (e.g., "opencode/deepseek-v4-flash" → "deepseek-v4-flash")
  const slashIndex = serverModelId.lastIndexOf('/');
  if (slashIndex >= 0) {
    const shortId = serverModelId.slice(slashIndex + 1);
    caps = getModelCapabilities(shortId);
    if (caps.name !== shortId) return caps;
  }

  // Try with common prefixes removed
  const prefixes = ['opencode/', 'opencode-go/', 'openai/', 'anthropic/', 'google/'];
  for (const prefix of prefixes) {
    if (serverModelId.startsWith(prefix)) {
      const shortId = serverModelId.slice(prefix.length);
      caps = getModelCapabilities(shortId);
      if (caps.name !== shortId) return caps;
    }
  }

  return undefined; // Not found in registry
}
```

### Use matched capabilities for model info

```typescript
// In fetchModels(), when creating models:
const matchedCaps = matchModelId(modelId);
const maxInput = modelData.maxTokens || matchedCaps?.maxInputTokens ?? DEFAULT_INPUT;
const maxOutput = modelData.maxOutputTokens || matchedCaps?.maxOutputTokens ?? DEFAULT_OUTPUT;
const imageInput = matchedCaps?.imageInput ?? false;
const toolCalling = matchedCaps?.toolCalling ?? true;
const reasoning = matchedCaps?.reasoning ?? false;
```

## Validation

```bash
cd F:\accuro-ias\opencode-chat\opencode-zen-copilot && npm run esbuild 2>&1 | tail -3
```

After reload, verify:
- Server models show correct context sizes (not fallback 163K)
- Server models show correct capabilities (Vision, Tools, Reasoning)
- Models not in models.dev use server-provided data or defaults

## Acceptance Criteria

- [ ] Model ID matching handles provider prefixes
- [ ] Capabilities from models.dev used when available
- [ ] Server-provided data used as fallback
- [ ] Unknown models use sensible defaults
- [ ] Build succeeds
