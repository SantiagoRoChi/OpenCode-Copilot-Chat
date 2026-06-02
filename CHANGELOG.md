# Changelog

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
