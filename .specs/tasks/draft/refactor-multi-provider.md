---
title: Refactor to 3 Multi-Providers with Webview Usage UI
type: refactor
priority: high
depends_on: []
status: draft
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
- [ ] **Test**: Free provider shows exactly 6 models (big-pickle, deepseek-v4-flash-free, mimo-v2.5-free, qwen3.6-plus-free, minimax-m3-free, nemotron-3-super-free)

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

## Definition of Done

- [ ] All 10 acceptance criteria met
- [ ] All 4 user scenarios tested
- [ ] Build passes (TypeScript + esbuild)
- [ ] README updated
- [ ] CHANGELOG entry added
- [ ] Version bumped to 2.0.0
- [ ] No hardcoded model metadata in source
- [ ] Tag `v2.0.0` created and pushed
