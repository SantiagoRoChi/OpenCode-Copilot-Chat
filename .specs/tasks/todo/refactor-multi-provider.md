---
title: Refactor to 3 Multi-Providers with Webview Usage UI
type: refactor
priority: high
depends_on: []
status: todo
---

# Refactor: 3 OpenCode Providers + Usage Webview

## Description

Refactor the OpenCode Zen Copilot extension to support 3 independent Language Model Providers (opencode-free, opencode-go, opencode-zen) fetched dynamically from the OpenCode APIs. Eliminate all hardcoded model metadata, add local OpenCode detection with FileSystemWatcher, and redesign the usage webview with API key status, balance, and detailed session statistics.

## Background

The current codebase has spaghetti architecture with hardcoded model metadata in `src/models/modelMetadata.ts` containing 45+ model definitions. The extension supports a single provider (`opencode-zen`) plus a newly added `opencode-go` but both share the same models list. The Go API uses a different endpoint (`/go/v1/`) than Zen (`/v1/`), causing HTTP 500 errors when models are routed incorrectly. The usage webview is basic and doesn't show API key status or real balance from the APIs.

## Goals

1. **3 Independent Providers**: opencode-free, opencode-go, opencode-zen
2. **No Hardcoded Models**: All models fetched dynamically from APIs
3. **Local Detection**: Auto-detect OpenCode installation and use local API keys with FileSystemWatcher
4. **Enhanced Webview**: Show API key status (masked), balance from API, session statistics
5. **No SDK**: Use direct HTTP fetch to OpenCode APIs (SDK is for local server control)
6. **Separate API Keys**: Zen key and Go key stored independently

## Acceptance Criteria (Refined)

### AC1: Three Independent Providers
- [ ] `opencode-free` registered as separate vendor in `package.json`
- [ ] `opencode-go` registered as separate vendor in `package.json`
- [ ] `opencode-zen` registered as separate vendor in `package.json`
- [ ] Each shows only its own models in Copilot model picker
- [ ] Each uses correct endpoint (Zen → `/v1/`, Go → `/go/v1/`)
- [ ] **Test**: Run `vsce package` and verify 3 entries in manifest

### AC2: Dynamic Model Loading
- [ ] No hardcoded model arrays in source code (grep returns 0 for `BUILTIN_MODELS`, `modelMetadata.ts`)
- [ ] Models fetched from `/v1/models` for Zen/Free
- [ ] Models fetched from `/go/v1/models` for Go
- [ ] Cache with 5-minute TTL
- [ ] Refresh on config change
- [ ] **Test**: `npx tsc --noEmit` passes, no `modelMetadata.ts` in build output

### AC3: Free Provider Filtering
- [ ] Only models with `pricing.input === 0 && pricing.output === 0`
- [ ] Uses Zen API key (no separate key needed)
- [ ] Endpoint: `https://opencode.ai/zen/v1`
- [ ] **Test**: Free provider shows exactly 6 models

### AC4: Go Provider
- [ ] All 17 models from Go endpoint visible
- [ ] Uses Go API key (separate from Zen)
- [ ] Endpoint: `https://opencode.ai/zen/go/v1`
- [ ] Models like `mimo-v2.5` work without HTTP 500
- [ ] **Test**: Go provider has its own API key in SecretStorage

### AC5: Zen Provider Filtering
- [ ] Excludes free models (those go to `opencode-free`)
- [ ] Uses Zen API key
- [ ] Endpoint: `https://opencode.ai/zen/v1`
- [ ] **Test**: Zen provider shows 39 models (45 total - 6 free)

### AC6: Local OpenCode Detection
- [ ] Read `~/.local/share/opencode/auth.json` on activation
- [ ] Detect both `opencode` (zen) and `opencode-go` keys
- [ ] FileSystemWatcher on auth.json
- [ ] Prompt user when new keys detected (not on every change)
- [ ] **Test**: Modify auth.json with new key, prompt appears

### AC7: SecretStorage
- [ ] Two separate keys: `zenKey` and `goKey`
- [ ] Methods: `getZenKey()`, `setZenKey()`, `clearZenKey()`, `getGoKey()`, `setGoKey()`, `clearGoKey()`
- [ ] **Test**: `getZenKey()` and `getGoKey()` return different values

### AC8: Usage Webview
- [ ] Section: API Keys (with masked display like `sk-oc-...abc1`)
- [ ] Section: Account Balance (from API if endpoint available)
- [ ] Section: Session Statistics (requests, tokens, latency)
- [ ] Section: By Provider breakdown
- [ ] Section: By Model (top 10 by usage)
- [ ] Section: Recent Requests (last 20)
- [ ] Buttons: Refresh, Clear, Export CSV
- [ ] **Test**: Webview renders without errors, updates on usage change

### AC9: No SDK
- [ ] Use `fetch` directly to OpenCode APIs
- [ ] No dependency on `@opencode-ai/sdk` in `package.json`
- [ ] **Test**: `grep -r "@opencode-ai/sdk" src/` returns 0

### AC10: Build & Tests
- [ ] `npx tsc --noEmit` passes (0 errors)
- [ ] `npm run esbuild` passes
- [ ] `npm run package` produces valid VSIX
- [ ] Extension size <100kb
- [ ] All 3 providers work in Extension Development Host

## User Scenarios

### Scenario 1: User with Zen only
1. Install extension
2. Configure Zen API key
3. See Zen models in Copilot model picker
4. Free models NOT visible (separate provider)
5. Go models NOT visible (separate provider)

### Scenario 2: User with Zen + Go
1. Install extension
2. Configure Zen API key
3. Configure Go API key
4. See all 3 providers in Copilot
5. Models don't duplicate between providers

### Scenario 3: User with local OpenCode
1. Install extension
2. OpenCode detected locally
3. Prompt: "Use local API keys?"
4. Accept → keys auto-populated
5. Extension uses local keys

### Scenario 4: New key added to auth.json
1. User adds new key to OpenCode auth.json
2. FileSystemWatcher detects change
3. Prompt: "New key detected, use it?"
4. Accept → key saved to SecretStorage

## Out of Scope

- BYOK for individual models
- Model fine-tuning support
- Custom model addition via UI
- OpenCode Go rate-limit UI
- Webview for model management

## Architecture Overview

### Component Architecture

```
extension.ts (Entry Point)
├── Creates 3 provider instances
├── Registers with vscode.lm
├── Initializes UsageTracker (shared)
├── Initializes StatusBarManager
├── Initializes UsageWebviewProvider
└── Watches auth.json for new keys

providers/
├── BaseOpenCodeProvider.ts (abstract)
│   • provideLanguageModelChatInformation()
│   • provideLanguageModelChatResponse()
│   • provideTokenCount()
│   • fetchModels() with cache (5min TTL)
│   • fetchApiUsage() with cache (1min TTL)
├── OpenCodeFreeProvider.ts
│   • endpoint: /v1/ | key: zenKey | filter: price=0
├── OpenCodeGoProvider.ts
│   • endpoint: /go/v1/ | key: goKey | filter: all
└── OpenCodeZenProvider.ts
    • endpoint: /v1/ | key: zenKey | filter: price>0

client/opencodeClient.ts
├── listModels(apiKey, endpoint)
├── getUsage(apiKey, endpoint)
└── streamChatCompletion(request, apiKey, endpoint)
```

### Key Decisions

1. **Abstract base class** - 3 providers share 80% of logic
2. **One provider class per vendor** - Clear separation
3. **Generic HTTP client** - One client, multiple endpoints
4. **No SDK** - Direct `fetch` to HTTP APIs
5. **Separate API keys** - `zenKey` and `goKey`
6. **FileSystemWatcher** - Detect new keys in auth.json
7. **Filter in provider** - Single source of truth

## Implementation Process

### Step 1: Delete Hardcoded Model Files
- **Goal**: Remove all hardcoded model metadata
- **Files to delete**: `src/models/modelMetadata.ts`, `src/models/registry.ts`, `src/client/modelsDevClient.ts`, `src/client/zenClient.ts`, `src/provider.ts`
- **Output**: Empty `src/models/` directory removed
- **Success criteria**: `ls src/models/` returns "not found", grep for BUILTIN_MODELS returns 0
- **Risks**: Breaks imports in `extension.ts` and other files

### Step 2: Create Generic HTTP Client (Parallel with Step 3, 4)
- **Goal**: Replace `zenClient.ts` with generic `opencodeClient.ts`
- **Files to create**: `src/client/opencodeClient.ts`, `src/client/endpoints.ts`
- **Output**: Working HTTP client with listModels, getUsage, streamChatCompletion
- **Success criteria**: `npx tsc --noEmit` passes, client can list models from both endpoints
- **Agent**: sonnet

### Step 3: Refactor SecretStorage (Parallel with Step 2, 4)
- **Goal**: Support 2 separate API keys
- **Files to modify**: `src/config/secretStorage.ts`
- **Output**: Methods for zenKey and goKey
- **Success criteria**: `getZenKey()` and `getGoKey()` work independently
- **Agent**: haiku

### Step 4: Refactor OpenCodeConnector (Parallel with Step 2, 3)
- **Goal**: Add FileSystemWatcher for auth.json
- **Files to modify**: `src/integration/authReader.ts`, `src/integration/opencodeConnector.ts`
- **Output**: `watchAuthFile()` method, prompt on new keys
- **Success criteria**: Modify auth.json triggers prompt
- **Agent**: sonnet

### Step 5: Create BaseOpenCodeProvider
- **Goal**: Abstract base class for 3 providers
- **Files to create**: `src/providers/BaseOpenCodeProvider.ts`
- **Output**: Working abstract class with all shared logic
- **Success criteria**: Extends `vscode.LanguageModelChatProvider`, has abstract methods
- **Agent**: opus
- **Depends on**: Step 2, 3, 4

### Step 6: Create 3 Concrete Providers (Parallel)
- **Goal**: Free, Go, Zen providers
- **Files to create**: `src/providers/OpenCodeFreeProvider.ts`, `src/providers/OpenCodeGoProvider.ts`, `src/providers/OpenCodeZenProvider.ts`
- **Output**: 3 working providers
- **Success criteria**: Each shows correct models, uses correct endpoint
- **Agent**: sonnet
- **Depends on**: Step 5

### Step 7: Refactor Usage Webview
- **Goal**: New UI with all sections
- **Files to modify**: `src/status/usageWebview.ts`
- **Output**: Webview with API Keys, Balance, Stats, By Provider, By Model, Recent, Actions
- **Success criteria**: Webview renders all sections without errors
- **Agent**: opus
- **Depends on**: Step 2 (needs opencodeClient for usage fetch)

### Step 8: Update extension.ts
- **Goal**: Register 3 providers, integrate everything
- **Files to modify**: `src/extension.ts`
- **Output**: Extension creates 3 provider instances, registers them
- **Success criteria**: All 3 providers appear in Copilot
- **Agent**: sonnet
- **Depends on**: Step 5, 6, 7

### Step 9: Update package.json
- **Goal**: Configure 3 providers in manifest
- **Files to modify**: `package.json`
- **Output**: 3 entries in `languageModelChatProviders`
- **Success criteria**: `npx vsce package` succeeds
- **Agent**: haiku
- **Depends on**: Step 8

### Step 10: Documentation & Version Bump
- **Goal**: Update README, CHANGELOG, bump to 2.0.0
- **Files to modify**: `README.md`, `CHANGELOG.md`, `package.json`
- **Output**: Documentation reflects new architecture, version 2.0.0
- **Success criteria**: Tag v2.0.0 created and pushed
- **Agent**: haiku
- **Depends on**: Step 9

## Parallelization Diagram

```
Step 1: Delete hardcoded files (Sequential - must be first)
   ↓
┌──────────────────┬──────────────────┬──────────────────┐
Step 2: Client    Step 3: Secrets   Step 4: Connector  ← PARALLEL
   ↓                  ↓                  ↓
   └──────────────────┼──────────────────┘
                      ↓
              Step 5: BaseProvider (depends on 2, 3, 4)
                      ↓
        ┌─────────────┴─────────────┐
   Step 6a: Free Provider   Step 6b: Go Provider   Step 6c: Zen Provider  ← PARALLEL
        └─────────────┬─────────────┘
                      ↓
              Step 7: Usage Webview (depends on 2)
                      ↓
              Step 8: extension.ts (depends on 5, 6, 7)
                      ↓
              Step 9: package.json (depends on 8)
                      ↓
              Step 10: Docs & Release (depends on 9)
```

## Implementation Summary

| Step | Agent | Files | Dependencies | Time |
|------|-------|-------|--------------|------|
| 1 | haiku | delete 5 | none | 5 min |
| 2 | sonnet | create 2 | none | 15 min |
| 3 | haiku | modify 1 | none | 10 min |
| 4 | sonnet | modify 2 | none | 15 min |
| 5 | opus | create 1 | 2, 3, 4 | 20 min |
| 6a | sonnet | create 1 | 5 | 10 min |
| 6b | sonnet | create 1 | 5 | 10 min |
| 6c | sonnet | create 1 | 5 | 10 min |
| 7 | opus | modify 1 | 2 | 20 min |
| 8 | sonnet | modify 1 | 5, 6, 7 | 15 min |
| 9 | haiku | modify 1 | 8 | 5 min |
| 10 | haiku | modify 3 | 9 | 10 min |

**Total**: ~2.5 hours with parallelization

## Verification Summary

| Step | Level | Rubric Focus | Threshold |
|------|-------|--------------|-----------|
| 1 | None | - | - |
| 2 | MEDIUM | HTTP client correctness | 3.5/5.0 |
| 3 | LOW | Secret storage independence | 3.0/5.0 |
| 4 | MEDIUM | FileSystemWatcher integration | 3.5/5.0 |
| 5 | HIGH | Abstract class design | 4.0/5.0 |
| 6a | MEDIUM | Free filter logic | 3.5/5.0 |
| 6b | MEDIUM | Go endpoint routing | 3.5/5.0 |
| 6c | MEDIUM | Zen filter logic | 3.5/5.0 |
| 7 | HIGH | Webview UI completeness | 4.0/5.0 |
| 8 | MEDIUM | Provider registration | 3.5/5.0 |
| 9 | LOW | Package.json correctness | 3.0/5.0 |
| 10 | LOW | Documentation quality | 3.0/5.0 |

## Definition of Done

- [ ] All 10 acceptance criteria met
- [ ] All 4 user scenarios tested
- [ ] Build passes (TypeScript + esbuild)
- [ ] README updated
- [ ] CHANGELOG entry added
- [ ] Version bumped to 2.0.0
- [ ] No hardcoded model metadata in source
- [ ] Tag `v2.0.0` created and pushed
