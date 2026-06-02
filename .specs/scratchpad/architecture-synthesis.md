# Architecture Overview: 3 Multi-Provider Refactor

## Solution Strategy

Replace the monolithic `provider.ts` (564 lines) with 3 independent providers that all extend a shared abstract base class. Eliminate hardcoded model metadata by fetching models dynamically from the OpenCode APIs. The Zen/Go endpoints differ (`/v1/` vs `/go/v1/`), so each provider uses its own base URL. The Free provider reuses the Zen key but filters models with `pricing.input === 0`.

Key architectural decisions:
1. **Abstract base class** (`BaseOpenCodeProvider`) - encapsulates shared logic
2. **3 concrete providers** - differ only in endpoint, key name, and filter
3. **Generic HTTP client** (`opencodeClient.ts`) - replaces `zenClient.ts`
4. **No SDK** - direct `fetch` to OpenCode HTTP APIs
5. **Separate API keys** - `zenKey` and `goKey` in SecretStorage
6. **FileSystemWatcher** - monitors `auth.json` for new keys

## Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    VSCode Extension Host                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  extension.ts (Entry Point)                                 │
│  ├── Creates 3 provider instances                            │
│  ├── Registers with vscode.lm                                │
│  ├── Initializes UsageTracker (shared)                       │
│  ├── Initializes StatusBarManager                            │
│  ├── Initializes UsageWebviewProvider                        │
│  └── Watches auth.json for new keys                         │
│                                                              │
│  ┌──────────────────────┐  ┌──────────────────────┐         │
│  │ OpenCodeFreeProvider │  │ OpenCodeGoProvider   │         │
│  │ vendor: opencode-free│  │ vendor: opencode-go  │         │
│  │ endpoint: /v1/      │  │ endpoint: /go/v1/   │         │
│  │ filter: price=0      │  │ filter: all          │         │
│  │ key: zenKey          │  │ key: goKey           │         │
│  └──────────┬───────────┘  └──────────┬───────────┘         │
│             │                            │                   │
│  ┌──────────┴────────────────────────────┴───────────┐      │
│  │           OpenCodeZenProvider                      │      │
│  │           vendor: opencode-zen                    │      │
│  │           endpoint: /v1/                          │      │
│  │           filter: price>0 (excl. free)            │      │
│  │           key: zenKey                             │      │
│  └──────────────────────┬──────────────────────────────┘      │
│                         │                                     │
│  ┌──────────────────────┴──────────────────────────────┐     │
│  │           BaseOpenCodeProvider (abstract)           │     │
│  │  • provideLanguageModelChatInformation()             │     │
│  │  • provideLanguageModelChatResponse()               │     │
│  │  • provideTokenCount()                              │     │
│  │  • fetchModels() with cache                         │     │
│  │  • fetchApiUsage() with cache                       │     │
│  └──────────────────────┬──────────────────────────────┘     │
│                         │                                     │
│  ┌──────────────────────┴──────────────────────────────┐     │
│  │              OpenCodeClient (HTTP)                   │     │
│  │  • listModels(apiKey, endpoint)                      │     │
│  │  • getUsage(apiKey, endpoint)                        │     │
│  │  • streamChatCompletion(request, apiKey, endpoint)   │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                              │
│  ┌──────────────────────┐  ┌──────────────────────┐         │
│  │   SecretStorage     │  │ OpenCodeConnector    │         │
│  │  • getZenKey()      │  │  • getLocalKeys()    │         │
│  │  • setZenKey()      │  │  • hasLocalKeys()    │         │
│  │  • getGoKey()       │  │  • watchAuthFile()   │         │
│  │  • setGoKey()       │  │                      │         │
│  └──────────────────────┘  └──────────────────────┘         │
│                                                              │
│  ┌──────────────────────┐  ┌──────────────────────┐         │
│  │   UsageTracker      │  │ UsageWebviewProvider │         │
│  │  (shared)           │  │  (enhanced UI)       │         │
│  └──────────────────────┘  └──────────────────────┘         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Key Decisions & Trade-offs

### Decision 1: Abstract Base Class vs Composition
- **Choice**: Abstract base class
- **Rationale**: 3 providers share 80% of logic (model fetch, chat completion, token counting). Inheritance is cleaner than composition here.
- **Trade-off**: Tight coupling to base class, but VSCode's `LanguageModelChatProvider` interface forces this.

### Decision 2: One Provider Class per Vendor
- **Choice**: Separate classes (`OpenCodeFreeProvider`, `OpenCodeGoProvider`, `OpenCodeZenProvider`)
- **Rationale**: Each has different endpoint, key, and filter. Clear separation of concerns.
- **Trade-off**: More files, but each is small (~50 lines) and focused.

### Decision 3: Generic HTTP Client
- **Choice**: `opencodeClient.ts` with base URL parameter
- **Rationale**: Zen and Go use same API shape (OpenAI-compatible). One client, multiple endpoints.
- **Trade-off**: If endpoints diverge in future, may need splitting.

### Decision 4: No SDK
- **Choice**: Direct `fetch` to HTTP APIs
- **Rationale**: SDK (`@opencode-ai/sdk`) is for local server control, not Zen/Go HTTP APIs.
- **Trade-off**: Less type safety from SDK, but simpler and works.

### Decision 5: Separate API Keys
- **Choice**: `zenKey` and `goKey` in SecretStorage
- **Rationale**: Zen and Go are separate subscriptions. Free reuses Zen key.
- **Trade-off**: User must configure 2 keys if they have both subscriptions.

### Decision 6: FileSystemWatcher
- **Choice**: Watch `auth.json` with `vscode.workspace.createFileSystemWatcher`
- **Rationale**: Detect when user adds new keys to OpenCode locally.
- **Trade-off**: Path differs by OS, need cross-platform handling.

### Decision 7: Filter Logic
- **Choice**: Filter in provider, not in client
- **Rationale**: Each provider decides what models to show. Single source of truth.
- **Trade-off**: Each provider has its own filter logic, but it's simple (1-2 lines).

## Expected Changes

### Files to Delete
1. `src/models/modelMetadata.ts` - Hardcoded models
2. `src/models/registry.ts` - Depends on hardcoded
3. `src/client/modelsDevClient.ts` - Unused
4. `src/client/zenClient.ts` - Replace with generic
5. `src/provider.ts` - Split into 3 providers

### Files to Create
1. `src/providers/BaseOpenCodeProvider.ts` - Abstract base
2. `src/providers/OpenCodeFreeProvider.ts` - Free models
3. `src/providers/OpenCodeGoProvider.ts` - Go models
4. `src/providers/OpenCodeZenProvider.ts` - Zen models
5. `src/client/opencodeClient.ts` - Generic HTTP client
6. `src/client/endpoints.ts` - URL constants

### Files to Refactor
1. `src/extension.ts` - Register 3 providers, add watcher
2. `src/models/modelInfoBuilder.ts` - Remove hardcoded family inference (or keep standalone)
3. `src/config/secretStorage.ts` - 2 keys
4. `src/integration/authReader.ts` - Read both keys
5. `src/integration/opencodeConnector.ts` - FileSystemWatcher
6. `src/status/usageWebview.ts` - New UI with all sections
7. `package.json` - 3 languageModelChatProviders entries
