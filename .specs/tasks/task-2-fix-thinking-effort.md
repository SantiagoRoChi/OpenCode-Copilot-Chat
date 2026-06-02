# Task 2: Fix ThinkingEffort configuration in BaseOpenCodeProvider

## Status: pending
## Depends On: none
## Parallel With: Task 1, Task 3

## Objective

Fix the ThinkingEffort configuration so users can actually change the reasoning effort level from the chat input.

## Input

- Current `src/providers/BaseOpenCodeProvider.ts` — `configurationSchema` set via `(chatInfo as any)`
- VS Code Copilot extension pattern: `configurationSchema` with `properties.reasoningEffort`
- The "High" badge appears but clicking doesn't open config dialog

## Output

Modify file: `src/providers/BaseOpenCodeProvider.ts`

## Analysis

The `configurationSchema` is an undocumented extension point. The current implementation sets it via `(chatInfo as any).configurationSchema`. The VS Code Copilot extension uses the same pattern.

The issue might be that:
1. The schema format is wrong
2. VS Code doesn't support inline configuration editing for this schema
3. The proposed API isn't enabled

Looking at the VS Code Copilot extension, they use `configurationSchema` with:
```typescript
configurationSchema: {
    properties: {
        reasoningEffort: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            default: 'medium',
            description: 'Controls reasoning depth.',
        },
    },
}
```

And they also use `supportsReasoningEffort` in the model capabilities to indicate which models support this.

## Specification

### Update `toChatInformation()` in BaseOpenCodeProvider

```typescript
protected toChatInformation(m: ApiModel, info: ModelInfo): vscode.LanguageModelChatInformation {
  const caps = getModelCapabilities(m.id);
  const chatInfo: vscode.LanguageModelChatInformation = {
    id: m.id,
    name: m.id,
    family: info.family,
    version: m.id,
    maxInputTokens: info.maxInputTokens,
    maxOutputTokens: info.maxOutputTokens,
    tooltip: `${info.name}\n\nContext: ${info.contextLabel}\n\nModel from ${this.displayName}`,
    detail: `${info.contextLabel} · ${this.displayName}`,
    capabilities: {
      imageInput: caps.imageInput,
      toolCalling: caps.toolCalling,
    },
  };

  // Add thinking effort configuration for reasoning models
  if (caps.reasoning) {
    (chatInfo as any).configurationSchema = {
      properties: {
        reasoningEffort: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          default: caps.thinkingEffort || 'medium',
          description: 'Controls reasoning depth. Higher = more thorough but slower.',
        },
      },
    };
  }

  return chatInfo;
}
```

### Also update server provider models

In `OpenCodeServerProvider.ts`, add the same `configurationSchema` for server models that have reasoning capability.

## Validation

```bash
cd F:\accuro-ias\opencode-chat\opencode-zen-copilot && npm run esbuild 2>&1 | tail -3
```

After reload, verify:
- Models with reasoning show "High" badge
- Clicking the badge should show a dropdown with low/medium/high options

## Acceptance Criteria

- [ ] `configurationSchema` set for all reasoning models
- [ ] Schema format matches VS Code Copilot extension pattern
- [ ] Both BaseOpenCodeProvider and OpenCodeServerProvider set the schema
- [ ] Build succeeds
