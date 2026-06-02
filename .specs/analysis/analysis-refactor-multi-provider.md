# Codebase Analysis: OpenCode Zen Copilot

## File Inventory (19 files)

| File | Lines | Purpose | Action |
|------|-------|---------|--------|
| `src/extension.ts` | 188 | Entry point | REFACTOR |
| `src/provider.ts` | 564 | Main provider (Zen + Go) | SPLIT into 3 |
| `src/client/types.ts` | 224 | TypeScript interfaces | KEEP + extend |
| `src/client/zenClient.ts` | 109 | HTTP client for Zen | REPLACE with `opencodeClient.ts` |
| `src/client/modelsDevClient.ts` | ~50 | models.dev fetcher (unused) | DELETE |
| `src/config/secretStorage.ts` | - | API key storage | REFACTOR for 2 keys |
| `src/config/settings.ts` | - | VSCode settings | KEEP |
| `src/integration/authReader.ts` | - | OpenCode auth.json reader | REFACTOR for 2 keys |
| `src/integration/opencodeConnector.ts` | - | OpenCode detection | REFACTOR with watcher |
| `src/models/modelMetadata.ts` | 154 | **HARDCODED MODELS** | **DELETE** |
| `src/models/registry.ts` | 181 | Model registry | **DELETE** |
| `src/models/modelInfoBuilder.ts` | 94 | Model → Copilot format | REFACTOR (remove hardcoded deps) |
| `src/status/statusBar.ts` | - | Status bar | KEEP + add usage |
| `src/status/usageTracker.ts` | - | Token tracking | KEEP |
| `src/status/usageWebview.ts` | 219 | Usage webview | REFACTOR (new UI) |
| `src/streaming/messageConverter.ts` | - | Message format converter | KEEP |
| `src/streaming/responseStreamer.ts` | - | SSE parser | KEEP |
| `src/tools/toolCallAdapter.ts` | - | Tool calling | KEEP |
| `src/utils/tokenEstimate.ts` | - | Token estimation | KEEP |

## Hardcoded Model References (TO ELIMINATE)
- `BUILTIN_MODELS` in `src/models/modelMetadata.ts:62` (45+ models)
- `BUILTIN_MODELS` referenced in `src/models/registry.ts:3, 10, 29`

## Delete Targets
1. `src/models/modelMetadata.ts` - Hardcoded models
2. `src/models/registry.ts` - Depends on hardcoded
3. `src/client/modelsDevClient.ts` - Unused
4. `src/client/zenClient.ts` - Replace with generic client
5. `src/provider.ts` - Split into 3 providers

## Refactor Targets
1. `src/extension.ts` - Register 3 providers instead of 2
2. `src/models/modelInfoBuilder.ts` - Remove hardcoded family inference
3. `src/config/secretStorage.ts` - 2 keys: `zenKey` + `goKey`
4. `src/integration/authReader.ts` - Read both keys
5. `src/integration/opencodeConnector.ts` - FileSystemWatcher
6. `src/status/usageWebview.ts` - New UI

## New Files to Create
1. `src/providers/BaseOpenCodeProvider.ts` - Abstract base class
2. `src/providers/OpenCodeFreeProvider.ts` - Free models only
3. `src/providers/OpenCodeGoProvider.ts` - Go models
4. `src/providers/OpenCodeZenProvider.ts` - Zen models (excl. free)
5. `src/client/opencodeClient.ts` - Generic HTTP client
6. `src/client/endpoints.ts` - URL constants
7. `src/usage/ApiUsageClient.ts` - Fetch usage from APIs

## Dependency Graph (Current)

```
extension.ts
├── provider.ts (ZenProvider)
│   ├── client/zenClient.ts
│   ├── models/registry.ts
│   │   ├── models/modelMetadata.ts (BUILTIN_MODELS)
│   │   └── client/modelsDevClient.ts
│   ├── models/modelInfoBuilder.ts
│   ├── client/types.ts
│   ├── streaming/responseStreamer.ts
│   ├── streaming/messageConverter.ts
│   ├── tools/toolCallAdapter.ts
│   ├── config/secretStorage.ts
│   ├── config/settings.ts
│   ├── integration/opencodeConnector.ts
│   │   └── integration/authReader.ts
│   ├── status/statusBar.ts
│   ├── status/usageTracker.ts
│   └── status/usageWebview.ts
```

## Dependency Graph (Target)

```
extension.ts
├── providers/
│   ├── BaseOpenCodeProvider.ts
│   │   ├── client/opencodeClient.ts
│   │   │   └── client/endpoints.ts
│   │   ├── client/types.ts
│   │   ├── config/secretStorage.ts
│   │   ├── config/settings.ts
│   │   ├── integration/opencodeConnector.ts
│   │   │   └── integration/authReader.ts
│   │   ├── streaming/responseStreamer.ts
│   │   ├── streaming/messageConverter.ts
│   │   ├── tools/toolCallAdapter.ts
│   │   ├── status/statusBar.ts
│   │   ├── status/usageTracker.ts
│   │   └── status/usageWebview.ts
│   ├── OpenCodeFreeProvider.ts (extends Base)
│   ├── OpenCodeGoProvider.ts (extends Base)
│   └── OpenCodeZenProvider.ts (extends Base)
```

## Risk Areas
1. **High coupling**: `provider.ts` is 564 lines with too many responsibilities
2. **State management**: Session stats, cache, models all mixed
3. **API key handling**: Currently single key, need to split
4. **Build order**: `BaseOpenCodeProvider` must be created before the 3 concrete providers
5. **Package.json**: 3 providers means 3 entries in `languageModelChatProviders`

## Code Patterns to Preserve
- Streaming with `ReadableStream` and SSE parser
- `LanguageModelDataPart` for usage reporting
- `MarkdownString` for tooltips
- SecretStorage pattern for API keys
- FileSystemWatcher pattern for auth.json (to be added)
- Status bar state machine
- Webview CSP with nonce
