# Task 1: Fix modelRegistry to use correct models.dev fields

## Status: pending
## Depends On: none
## Parallel With: Task 2, Task 3

## Objective

Update `src/client/modelRegistry.ts` to correctly parse models.dev API data using the exact field names discovered in analysis.

## Input

- Current `src/client/modelRegistry.ts` — uses wrong field names
- models.dev API response structure (from analysis):
  - `model.attachment` → vision (NOT `model.capabilities?.vision`)
  - `model.tool_call` → tools (NOT `model.capabilities?.tools`)
  - `model.reasoning` → reasoning
  - `model.limit.context` → context window (NOT `model.context_length`)
  - `model.limit.output` → max output (NOT `model.max_output_tokens`)
  - `model.cost.input` → input cost per M tokens (already in $/M, NOT $/token)
  - `model.cost.output` → output cost per M tokens
  - `model.cost.cache_read` → cache read cost per M tokens
  - `model.modalities.input` → array including "image" for vision
  - `model.interleaved` → `{ "field": "reasoning_content" }` for interleaved reasoning

## Output

Modify file: `src/client/modelRegistry.ts`

## Specification

### Fix `modelsDevToRegistry()` function

```typescript
function modelsDevToRegistry(id: string, model: ModelsDevModel): RegistryEntry {
  const fmt = inferApiFormat(id);

  // Vision = modalities.input includes "image" OR "pdf"
  const hasVision = model.modalities?.input?.some(m => m === 'image' || m === 'pdf') ?? false;

  return {
    chatEndpoint: fmt.endpoint,
    apiFormat: fmt.apiFormat,
    name: model.name || id,
    family: inferFamily(id),
    maxInputTokens: model.limit?.context ?? DEFAULT_INPUT,
    maxOutputTokens: model.limit?.output ?? DEFAULT_OUTPUT,
    imageInput: model.attachment ?? hasVision,  // Use attachment OR modalities
    toolCalling: model.tool_call ?? true,
    reasoning: model.reasoning ?? false,
    thinkingEffort: model.reasoning ? 'high' : undefined,
    // Cost is already in $/M tokens from models.dev
    pricePerMillionInput: model.cost?.input,
    pricePerMillionOutput: model.cost?.output,
    pricePerMillionCacheRead: model.cost?.cache_read,
  };
}
```

### Fix ModelsDevModel interface

```typescript
interface ModelsDevModel {
  id: string;
  name: string;
  family?: string;
  attachment?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  temperature?: boolean;
  interleaved?: boolean | { field: string };
  limit?: { context?: number; output?: number; input?: number };
  cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number };
  modalities?: { input?: string[]; output?: string[] };
  status?: string;
  structured_output?: boolean;
}
```

## Validation

```bash
cd F:\accuro-ias\opencode-chat\opencode-zen-copilot && npm run esbuild 2>&1 | tail -3
node -e "
const https = require('https');
https.get('https://models.dev/api.json', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const json = JSON.parse(data);
    const go = json['opencode-go'];
    const mimo = go?.models?.['mimo-v2.5'];
    if (mimo) {
      console.log('mimo-v2.5:');
      console.log('  attachment:', mimo.attachment);
      console.log('  reasoning:', mimo.reasoning);
      console.log('  tool_call:', mimo.tool_call);
      console.log('  limit.context:', mimo.limit?.context);
      console.log('  limit.output:', mimo.limit?.output);
      console.log('  cost.input:', mimo.cost?.input);
      console.log('  cost.output:', mimo.cost?.output);
      console.log('  modalities.input:', mimo.modalities?.input);
    }
  });
});
"
```

## Acceptance Criteria

- [ ] `ModelsDevModel` interface matches actual models.dev JSON structure
- [ ] `imageInput` uses `attachment` field OR `modalities.input` includes "image"
- [ ] `toolCalling` uses `tool_call` field
- [ ] `limit.context` used for maxInputTokens
- [ ] `limit.output` used for maxOutputTokens
- [ ] Cost values used directly (already in $/M)
- [ ] All models from models.dev parsed correctly
- [ ] Build succeeds
