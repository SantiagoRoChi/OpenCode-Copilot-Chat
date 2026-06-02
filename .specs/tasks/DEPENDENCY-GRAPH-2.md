# Task Dependency Graph — Round 2

## Visual Overview

```
Phase 1 (Parallel — No Dependencies):
┌─────────────────────────────────────────────────────────────┐
│  Task 1: fix-model-registry    [Sonnet] ← Fix field names  │
│  Task 2: fix-thinking-effort   [Haiku]  ← Config schema    │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
Phase 2 (Depends on Task 1):
┌─────────────────────────────────────────────────────────────┐
│  Task 3: fix-server-model-matching [Sonnet] ← Match IDs     │
└─────────────────────────────────────────────────────────────┘
```

## Parallel Execution

| Phase | Tasks | Can Run In Parallel? |
|-------|-------|---------------------|
| 1 | Task 1, Task 2 | YES |
| 2 | Task 3 | NO (needs Task 1) |

## What Each Task Fixes

| Task | Problem | Solution |
|------|---------|----------|
| 1 | models.dev fields parsed wrong | Use correct field names (attachment, tool_call, limit.context, cost.input) |
| 2 | ThinkingEffort not configurable | Fix configurationSchema format |
| 3 | Server models show 163K fallback | Match model IDs against models.dev registry |

## Key Findings from Analysis

### models.dev field mapping (WRONG → CORRECT):
- `model.capabilities?.vision` → `model.attachment` OR `model.modalities.input.includes('image')`
- `model.capabilities?.tools` → `model.tool_call`
- `model.context_length` → `model.limit.context`
- `model.max_output_tokens` → `model.limit.output`
- `model.pricing?.prompt * 1e6` → `model.cost.input` (already in $/M)

### Cost column:
- VS Code's Language Models view cost column is INTERNAL to VS Code
- Third-party extensions CANNOT set cost columns directly
- The cost data is used for internal tracking, not display

### ThinkingEffort:
- `configurationSchema` is an undocumented extension point
- Format: `{ properties: { reasoningEffort: { type: 'string', enum: [...] } } }`
- Cast with `(chatInfo as any).configurationSchema`
