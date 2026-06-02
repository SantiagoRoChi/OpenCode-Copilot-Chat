# Changelog

## [3.2.0] - 2026-06-02

### Added
- **Subagent tool** (`opencode_subagent`): Registered via `vscode.lm.registerTool()`, delegates to first available OpenCode provider. Accepts `query` and `description` parameters. Runs with temperature 0, no additional tools.
- **Thinking blocks**: Server provider and BaseOpenCodeProvider now use `LanguageModelThinkingPart` for collapsible reasoning content. Falls back to text markers if API unavailable.

### Fixed
- Tool registration in `package.json` — requires `modelDescription`, `displayName`, and `inputSchema` fields

## [3.1.0] - 2026-06-02

### Fixed
- **Server provider session API**: Correct request format for OpenCode server
  - `model` must be `{ providerID, modelID }` object (not string)
  - `providerID` comes from server's actual provider data (e.g., `"opencode"`)
  - Session API only accepts `model` and `parts` — no tools, temperature, etc.
  - Filter user/assistant messages only (ignore system/tool messages)

## [3.0.0] - 2026-06-02

### BREAKING CHANGES
- **models.dev API integration**: Model capabilities (context size, pricing, vision, reasoning) now fetched live from `https://models.dev/api.json` instead of hardcoded metadata
- **Server provider rewrite**: OpenCode Server now uses session-based API (`POST /session` + `POST /session/:id/message`) instead of non-existent `/chat/completions` endpoint
- **Single server provider**: All connected servers register under one `opencode-server` vendor instead of one per server

### Added
- **Live model registry**: `modelRegistry.ts` fetches from models.dev on activation with 30-minute cache
- **40+ Zen models + 16 Go models** with real context sizes, pricing, and capabilities
- **Pricing in tooltips**: hover over any model shows `In: $X/M · Out: $Y/M · Cache: $Z/M`
- **Server provider models**: Local servers now appear in Language Models view with correct capabilities
- **ThinkingEffort configuration**: Reasoning models show `configurationSchema` for low/medium/high
- **Partial model ID matching**: Handles prefixed IDs (e.g., `opencode/deepseek-v4-flash`)
- **Debug logging**: Detailed SSE parsing logs in Output panel for troubleshooting

### Fixed
- **Image detection too aggressive**: Was matching ANY message part with `mimeType` as image, causing "Image input not supported" for all models. Now only detects actual `LanguageModelImagePart` and `LanguageModelDataPart` with image/* mime types
- **Tool schema validation**: Filters out tools with empty/undefined schemas that cause 400 errors from strict providers (MiniMax, etc.)
- **Server provider auth**: `buildHeaders()` made public, auth headers properly sent
- **Server provider streamResponse**: Fixed ReadableStream vs ReadableStreamDefaultController mismatch
- **Server provider model registration**: Models now appear in Language Models view after registration
- **models.dev data loading**: Now blocking (`await`) before provider registration so data is available when VS Code queries models

### Removed
- Anthropic Messages adapter (`anthropicAdapter.ts`) — all models use `/chat/completions` via OpenCode routing
- OpenAI Responses adapter (`openaiResponsesAdapter.ts`) — all models use `/chat/completions` via OpenCode routing
- `@vscode-elements/elements` dependency — not usable in webviews

## [2.4.0] - 2026-06-02

### Added
- SDD task specs for multi-provider architecture (8 tasks)
- `.specs/` directory with task definitions and dependency graph

### Changed
- TreeView sidebar with Dashboard + Config sections
- Model registry with fallback static data

## [2.3.3] - 2026-06-02

### Fixed
- **`/usage` endpoint returns 404** — confirmed locally: `GET /zen/v1/usage` → 404, `/zen/go/v1/usage` → 404. Global tree now gracefully handles missing endpoint and falls back to showing model families instead of hanging
- **Global tree now shows model families**: when usage API is unavailable, the Global tree still displays available models grouped by family (minimax, kimi, glm, deepseek, qwen, mimo, hy3) with model counts — making the view useful even without billing data
- `getModelFamilies()` added to `BaseOpenCodeProvider` to expose model group info
- `refreshGlobal` command now refreshes models + re-fetches global data instead of a separate refresh method

## [2.3.2] - 2026-06-02

### Changed
- Added debug logging to `getUsage`: logs URL, HTTP status, response body (or empty/JSON parse error) so we can see exactly what the API returns
- Added debug logging to `streamResponse`: logs first chunk id/model, reasoning start/done, usage tokens

### Fixed
- Config tree now uses correct command IDs (was using `opencodeConfigureZen` instead of `opencode-zen.configureZen`)
- Global tree shows pending/error/ok state per provider instead of hanging
- `fetchApiUsage` has 8s timeout to prevent tree from hanging forever

## [2.3.0] - 2026-06-02

### Added
- **3-tree sidebar layout**: Session (local session stats), Global (API account data from server), Config (quick actions)
- **Global tree**: fetches real account data from `/usage` endpoint — balance, used, remaining, quota limits per time period (hour/day/week/month). Shows progress bars with percentages and reset timestamps
- **Config tree**: one-click buttons for Configure Zen Key, Configure Go Key, Refresh All Models, Clear Usage Stats — each as a native tree item with command binding
- **ApiQuota interface**: `id`, `name`, `unit`, `limit`, `used`, `remaining`, `reset_at`, `period` for granular rate limit display
- **Context menus**: right-click items in Config/Global trees for relevant actions

### Changed
- Session tree renamed from `UsageTreeProvider` → `SessionTreeProvider` with cleaner helper methods

## [2.2.0] - 2026-06-02

### Changed
- **Replaced WebviewView with native TreeView**: usage sidebar now uses VS Code's native `TreeDataProvider` API (like Explorer/Timeline/Outline). No custom HTML/CSS — all rendering uses VS Code's native tree components with proper labels, icons, and collapse states
- **Sidebar sections**: API Keys, Balance, Session Summary (expandable), By Provider, By Model, Sessions (grouped by sessionId with nested requests), Recent Requests

## [2.1.1] - 2026-06-02

### Fixed
- **Usage stats blank**: `byModel` and `byProvider` changed from `Map` to plain `Record<string, ...>` so they serialize properly over webview postMessage (Maps were invisible to JSON.stringify)
- **Thinking rendering**: thinking content is now buffered and emitted as a single block with `[reasoning]...[/reasoning]` markers when reasoning ends, preventing interleaved text output
- **Webview sessions**: new "Sessions" section groups requests by sessionId with nested request details

## [2.1.0] - 2026-06-02

### Changed
- **Sessions and request tracking**: every request now has a unique `requestId` and belongs to a `sessionId`. Tokens reported for the same requestId are replaced (not accumulated), fixing the token overcount bug where the API reports total tokens per session, not per message
- **Reasoner steps**: streaming now tracks `reasoner_step` events so the provider collects reasoning steps (label, id, timestamps) per request
- **Usage tracker keyed by requestId**: `recordRequest(requestId, ...)` finds existing records by requestId and replaces them instead of appending duplicates

### Fixed
- Thinking content no longer renders as HTML — `reportThinking` sends `LanguageModelTextPart` directly to progress (no more <think> literal tags)
- Tokens no longer summed incorrectly across requests — each request's total is reported once and replaced if the same requestId fires again

## [2.0.1] - 2026-06-01

### Fixed
- Strip `<think>` tags from streaming content so they no longer render as literal HTML
- Auto-refresh models when API key is configured (set, changed, or cleared)
- Status bar button now opens the usage sidebar (not the output channel)
- Models endpoint queried even without API key (fails gracefully if auth required)

### Changed
- Webview redesigned with collapsible tree structure and VSCode-style aesthetics
- Each model entry expands to show requests, prompt, completion breakdown
- Each recent request expands to show full details
- Usage stats bars with percentages
- New command `OpenCode Zen: Show Output Log` for terminal-style stats view

## [2.0.0] - 2026-06-01

### BREAKING CHANGES
- **3 Independent Providers**: Now registers `opencode-free`, `opencode-go`, and `opencode-zen` as separate vendors
- **No More Hardcoded Models**: All models fetched dynamically from OpenCode APIs
- **Separate API Keys**: `zenKey` and `goKey` stored independently in SecretStorage
- **Removed Files**: `modelMetadata.ts`, `registry.ts`, `modelsDevClient.ts`, `zenClient.ts`, `provider.ts` deleted

### Added
- `BaseOpenCodeProvider` abstract class for shared logic
- `OpenCodeFreeProvider` - free models only (uses Zen key)
- `OpenCodeGoProvider` - Go models with `/go/v1/` endpoint
- `OpenCodeZenProvider` - paid Zen models only
- `OpenCodeClient` - generic HTTP client with endpoint parameter
- `FileSystemWatcher` on local `auth.json` for new key detection
- New `usageWebview` with API keys status, balance, and detailed stats
- Commands: `configureZen`, `configureGo`, `refreshAll`
- Auto-detection of local OpenCode installation at activation

### Changed
- SecretStorage now manages 2 keys: `zenKey` and `goKey`
- Model caching with 5-minute TTL
- API usage caching with 1-minute TTL
- Models endpoint: `GET /v1/models` for Zen/Free, `GET /go/v1/models` for Go
- No SDK dependency (direct fetch to HTTP APIs)

## [1.0.2] - 2026-06-01

### Added
- New project logo combining OpenCode and Copilot branding

### Fixed
- PNG icon instead of SVG (VSCode requirement)
- readonly sessionStats TypeScript error

## [1.0.1] - 2026-06-01

### Fixed
- PNG icon instead of SVG (VSCode requirement)
- readonly sessionStats TypeScript error

## [1.0.0] - 2026-06-01

### Added
- Initial release
- 45+ OpenCode Zen models registered as Copilot Language Model Provider
- 4 free models enabled by default
- Auto-detection of OpenCode installation and API key
- Tool calling support with automatic JSON repair
- SSE streaming with reasoning content display
- Vision/image input for multimodal models
- Status bar indicator with connection state
- Settings: timeout, tool calling, image input, temperature, verbose logging
- Model catalog from builtin metadata, models.dev, and Zen API
