# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
