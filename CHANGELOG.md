# Changelog

## [3.2.5] - 2026-06-11

### Added
- **Tests reales con datos del servidor**: 24 tests pasando validados contra respuestas reales del servidor opencode (127.0.0.1:4096).
  - `test/OpenCodeServerProvider.test.ts` — 15 tests: extracción de texto/reasoning/tokens de `parts[]`, manejo de errores, respuestas vacías, tool calls, validación de estructura JSON, simulación de orden de eventos streaming
  - `test/OpenCodeServerProvider.streaming.test.ts` — 9 tests: orden reasoning→texto, concatenación de múltiples text parts, cancelación de token, manejo de tool calls, respuesta vacía
  - Framework: `node:test` + `tsx` (sin jest/mocha). Mock de VS Code API en `test/mocks/vscode.mock.ts`

### Fixed
- **Chat se queda "working" infinitamente**: Simplificado `OpenCodeServerProvider` para procesar la respuesta JSON del servidor de forma directa y limpia. Ahora: `fetch()` → `await response.json()` → acumular `parts[]` → emitir `progress.report()` con `yield` al event loop entre cada chunk para que VS Code actualice el UI.
- **Eliminada simulación por delays**: Removido todo el código de parsing multi-formato con delays artificiales de 50ms (`readAllStreamData`, `processAnyFormatResponse`, `parseSSE`, `parseNDJSON`, `processParsedEvents`, `inferEventType`, `safeParseJson`).
- **Eliminada dependencia `@opencode-ai/sdk`**: El intento de usar el SDK para SSE streaming no funcionó porque el servidor no emite eventos de contenido en tiempo real vía `/global/event`. El SDK fue removido del bundle (tree-shaking). Bundle bajó de 177KB a 105KB.
- **Manejo de respuesta limpio**: Acumula reasoning, tool calls y texto por separado, luego los emite en orden (reasoning → tools → text) con `await new Promise(r => setTimeout(r, 0))` entre cada uno para ceder al event loop.
- **Manejo de errores**: Verificación de `messageData.error` a nivel top-level antes de procesar `parts[]`.

## [3.2.4] - 2026-06-11

### Changed
- Intento de integración con SDK `@opencode-ai/sdk` para SSE streaming. Descartado — el servidor no emite eventos de contenido en tiempo real. Solución final en [v3.2.5](#325---2026-06-11).

## [3.2.3] - 2026-06-11

### Fixed
- Parsing multi-formato de respuestas del servidor (SSE, NDJSON, JSON parts[], OpenAI delta). Obsoleto en v3.2.5 — reemplazado por SDK nativo. Ver [v3.2.4](#324---2026-06-11) para contexto.

## [3.2.2] - 2026-06-11

### Fixed
- 11 TypeScript compilation errors que rompían `tsc --noEmit` en CI. Ver release v3.2.2 para el listado completo de archivos corregidos.

## [3.2.1] - 2026-06-11

### Changed
- **Server launch**: Reemplazado `exec()` con `spawn()` para lanzar servidores locales como proceso background sin ventana `cmd.exe` emergente
- **Launch UX**: El usuario puede elegir entre lanzar servidor en terminal VS Code o como proceso background invisible
- **Activation**: Ya no se auto-lanzan servidores locales al activar la extensión

### Added
- **SSE streaming inicial**: Server provider lee respuestas como `text/event-stream` con progreso incremental
- **Server launch command**: Interfaz interactiva con `showQuickPick` para elegir modo de lanzamiento

## [3.2.0] - 2026-06-02

### Added
- **Subagent tool** (`opencode_subagent`): Registered via `vscode.lm.registerTool()`, delegates to first available OpenCode provider
- **Thinking blocks**: Server provider and BaseOpenCodeProvider now use `LanguageModelThinkingPart` for collapsible reasoning content

### Fixed
- Tool registration in `package.json` — requires `modelDescription`, `displayName`, and `inputSchema` fields

## [3.1.0] - 2026-06-02

### Fixed
- **Server provider session API**: Correct request format for OpenCode server (`model` como `{ providerID, modelID }`, solo `model` y `parts` en el body)

## [3.0.0] - 2026-06-02

### BREAKING CHANGES
- **models.dev API integration**: Model capabilities fetched live from `https://models.dev/api.json`
- **Server provider rewrite**: Usa session-based API (`POST /session` + `POST /session/:id/message`)
- **Single server provider**: All connected servers register under one `opencode-server` vendor

### Added
- **Live model registry**: 40+ Zen models + 16 Go models con context sizes, pricing, y capabilities reales
- **Pricing in tooltips**: hover muestra `In: $X/M · Out: $Y/M · Cache: $Z/M`
- **ThinkingEffort configuration**: Reasoning models show `configurationSchema` para low/medium/high

### Fixed
- Image detection, tool schema validation, server auth, model registration

### Removed
- Anthropic Messages adapter, OpenAI Responses adapter, `@vscode-elements/elements` dependency

## [2.4.0] - 2026-06-02

### Added
- SDD task specs for multi-provider architecture (8 tasks)
- `.specs/` directory with task definitions y dependency graph

## [2.3.3] - 2026-06-02

### Fixed
- **`/usage` endpoint returns 404** — Global tree ahora muestra model families como fallback

## [2.3.2] - 2026-06-02

### Changed
- Debug logging en `getUsage` y `streamResponse`

### Fixed
- Config tree command IDs, Global tree state, `fetchApiUsage` timeout de 8s

## [2.3.0] - 2026-06-02

### Added
- **3-tree sidebar layout**: Session, Global, Config
- **Global tree**: fetches real account data from `/usage` endpoint con progress bars
- **Config tree**: one-click buttons para Configure Zen Key, Configure Go Key, Refresh All Models, Clear Usage Stats

## [2.2.0] - 2026-06-02

### Changed
- **Replaced WebviewView with native TreeView**: usa VS Code's native `TreeDataProvider` API

## [2.1.1] - 2026-06-02

### Fixed
- Usage stats blank (Map → Record), thinking rendering interleaved, webview sessions

## [2.1.0] - 2026-06-02

### Changed
- **Sessions and request tracking**: unique `requestId` y `sessionId`, tokens reemplazados en lugar de acumulados
- **Reasoner steps**: streaming tracks `reasoner_step` events
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
