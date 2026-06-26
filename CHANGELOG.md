# Changelog

## [4.1.0] - 2026-06-26

### Performance Optimizations (P2)

All four remaining P2 performance improvements from the v4.0 redesign.

#### Added
- **Bounded memory in UsageTracker**: `MAX_RECORDS` (5000) with `PRUNE_TARGET` (4000) prevents unbounded memory growth from long-running sessions
- **Incremental counters**: `getStats()` now O(1) instead of O(n) — `totalTokens`, `totalCost`, `byModel`, and `byProvider` updated incrementally in `recordRequest()` instead of recomputing from all records on every call

#### Changed
- **Indexed model grouping** (`extension.ts`): `buildInfrastructureData()` uses `groupByServerPrefix<T>()` — single pass over all models per provider (O(M+S) instead of O(S×M)). Eliminated the empty `getCurrentModels()` loop in the OpenCode servers section
- **In-memory discovery cache** (`OpenCodeUsageService`): `ensureDiscoveryCache()` loads `workspaceId`, `goKey`, and `zenKey` once from storage; subsequent `fetchUsageData()` calls skip IPC reads
- **Parallel key validation** (`OpenCodeConnector.detect()`): Zen + Go key validation runs concurrently via `Promise.all()` instead of sequentially (~10s → ~5s worst case)

#### Files
- **Modified**: `src/usage/UsageTracker.ts`, `src/extension.ts`, `src/integration/openCodeUsageService.ts`, `src/integration/opencodeConnector.ts`

## [4.0.0] - 2026-06-25

### Complete Visual Layer Redesign

Complete rewrite of the visual layer from scratch. Eliminated all webviews, status bar items, and custom chat UI in favor of 100% native VS Code TreeView components.

#### Added
- **Infrastructure Tree View** (`opencode-zen-infrastructure`): Native VS Code TreeView showing servers → models hierarchy
  - Servers as collapsible root nodes with semantic icons (cloud, chip, zap, server)
  - Models as leaf nodes showing capabilities (Chat, Tools, Vision) and context window size
  - Online/offline status with visual distinction
  - Context menu actions per server: Edit, Remove, Launch, Refresh
- **KPIs Tree View** (`opencode-zen-kpis`): Native VS Code TreeView showing usage metrics
  - Summary section: total requests, tokens in/out, total cost
  - By Server breakdown: per-provider usage with local/cloud distinction
  - By Model breakdown: per-model usage sorted by total tokens
  - Auto-refreshes when usage data changes
- **Shared types** (`src/types/serverTypes.ts`): Extracted `ServerData` interface to eliminate webview dependencies

#### Performance Improvements
- **Persistent model registry cache**: `modelRegistry` now caches to `ExtensionContext.workspaceState`
  - Warm startup: 2–4s → <200ms (90% improvement)
  - Loads from disk instantly, refreshes from network in background
- **Parallel server initialization**: LM Studio + Ollama load and health-check concurrently
  - Reduces worst-case activation from 6s to 3s
- **Parallel server connections**: `MultiServerManager.connectAll()` uses `Promise.allSettled()`
  - N sequential connections → O(1) parallel connections
  - 5-server connect: 1–3s → 200–500ms
- **Debounced tree refresh**: `refreshViews()` batches rapid-fire model changes with 150ms debounce
  - Eliminates 5–6 redundant refreshes on startup
  - Initial staggered timeouts reduced from 3 to 2

#### Removed
- `src/status/statusBar.ts` — StatusBarManager and all status bar items
- `src/status/chatStatusItems.ts` — Custom chat status items (using native VS Code APIs instead)
- `src/notifications/chatNotifications.ts` — Dashboard toast notifications
- `src/webview/openCodeWebviewProvider.ts` — Dashboard webview (replaced by native trees)
- `src/webview/openCodeUsagePanel.ts` — Usage webview panel (replaced by KPIs tree)
- `src/webview/openCodeDashboardPanel.ts` — Dashboard panel helper
- `src/treeview/openCodeTreeProvider.ts` — Old flat tree view (replaced by hierarchical Infrastructure tree)
- 6 commands from public palette: `showUsage`, `showOutputLog`, `refreshGlobal`, `openUsageWebview`, `openDashboard`
- `chatStatusItem` from `enabledApiProposals`

#### Changed
- `package.json` views: replaced `opencode-zen-tree` + `opencode-zen-dashboard` with `opencode-zen-infrastructure` + `opencode-zen-kpis`
- `package.json` commands: reduced from 15 to 9 public commands
- `package.json` menus: updated `view/title` and added `view/item/context` for server actions
- `extension.ts` rewritten: removed all UI component imports, added tree provider data builders (`buildInfrastructureData`, `buildKpiData`)
- `LMStudioProvider.ts` and `OllamaProvider.ts`: updated `ServerData` import to new shared types file

#### Fixed
- Type compatibility: `RoutedModelInfo.capabilities` now properly typed as `LanguageModelChatCapabilities`
- Casing issue: unified `treeView` → `treeview` directory naming

## [3.7.0] - 2026-06-25

### 🚀 Fase 1: Model Management & Configuration Improvements

#### Added
- **Context Size Configuration**: Model configuration UI now exposes `contextSize` — choose Default (32K), Large (64K), or Full for supported models
- **Utility Model Aliases**: Each cloud provider generates smart aliases:
  - Zen: `opencode-cheap-zen` (cheapest model), `opencode-fast-zen` (fastest by context size)
  - Go: `opencode-cheap-go` (cheapest), `opencode-fast-go` (fastest)
  - Free: `opencode-fast-free` (fastest free model)
  - Aliases route to the correct API ID automatically
- **Family-Aware Reasoning Defaults**: Reasoning effort automatically matched to model family:
  - Claude/Sonnet/Opus/DeepSeek → `high`
  - GPT/Haiku/Gemini → `medium`
  - Qwen/MiniMax → `low`
- **Configuration documentation**: New "Model Configuration" section in README

#### Changed
- `BaseProvider.buildConfigurationSchema()` now accepts `caps.family` + `maxInputTokens` to generate richer model config options
- All cloud providers (`Zen`, `Go`, `Free`) pass model family and context window to their base for proper defaults
- LM Studio and Ollama providers pass architecture and context window metadata

### 🐛 Fixed

- **Compilation errors in CI pipeline**: Fixed several TypeScript errors that broke the build
  - `src/chat/participant.ts`: Fixed `chatContext` → `_chatContext` parameter name, `ChatRequestMarkdownPart` → `ChatResponseMarkdownPart`, added required `toolMode` property, replaced `stream.toolCall()` with `stream.markdown()`
  - `src/extension.ts`: Fixed type mismatch between `GoLimits` (with `resetsAt`) and `DashboardState.goBurnRate` (expects `spent`/`limit`/`percent`)
  - `src/providers/BaseProvider.ts`: Defined local `LanguageModelConfigurationSchema` interface to avoid missing VS Code API export
  - `src/providers/OpenCodeFreeProvider.ts`: Added missing `ApiModel` import
  - `src/providers/sdk/anthropicChat.ts` & `src/providers/sdk/openaiChat.ts`: Properly typed AI SDK `result.usage` and used null-coalescing for optional `promptTokens`/`completionTokens`; removed duplicate `onUsage` callback call

## [3.6.0] - 2026-06-22

### 🚀 Major Feature: OpenCode Usage Tracking & Agent Windows

#### Added
- **OpenCode Usage Tracking Integration**: Real-time usage data from OpenCode API
  - Fetches usage data via OpenCode's _server endpoint with dynamic server ID discovery
  - Automatically discovers workspace ID from OpenCode pages
  - Uses API key from uth.json for authentication (no manual cookie required)
  - Displays usage metrics: requests, tokens, cost per model
  - Go subscription burn-rate tracking (5h rolling, weekly, monthly)

- **Agent Window Support**: Register providers for VS Code Agents Window
  - Creates duplicate provider instances with -agent suffix vendors
  - Enables OpenCode models in Copilot CLI / Agents Window
  - Configurable via opencode-zen.enableAgentWindow setting

- **OpenCode Usage Panel**: New webview panel for OpenCode login
  - Simple Browser integration for OAuth login flow
  - Local HTTP server for capturing workspace ID and auth cookie
  - Automatic workspace discovery from OpenCode pages

- **OpenCode Auth Service**: Centralized authentication management
  - Stores workspace ID, auth cookie, and API keys
  - Auto-discovers workspace ID from OpenCode pages
  - Extracts server ID dynamically from page HTML

- **Enhanced Status Bar**: Real-time usage metrics
  - Go subscription burn-rate display (5h/weekly/monthly)
  - Warning indicators when approaching limits
  - Cost tracking per provider

- **Enhanced Tree View**: Registration commands in sidebar
  - Login with OpenCode button
  - Configure Workspace URL button
  - Direct access to all configuration options

- **OpenCode Usage Service**: Background usage data fetching
  - Periodic refresh every 5 minutes
  - Dynamic server ID discovery from page HTML
  - Automatic workspace ID extraction

#### Changed
- **UsageTracker enhanced with cost calculation**
  - Added ModelPricing interface for token pricing
  - Added stimateCost() function for request cost calculation
  - Added PeriodUsage for burn-rate tracking
  - Added GO_LIMITS constant for subscription limits

- **Status bar improved**
  - Shows Go burn-rate with warning indicators
  - Displays cost per request
  - Enhanced tooltip with detailed breakdown

- **Tree view improved**
  - Added registration commands (Login, Configure Workspace)
  - Shows burn-rate data in dashboard

#### Fixed
- **OpenCode API key handling**
  - Fixed stale API key caching issue
  - Now passes API key directly to SDK on every call
  - No more "Missing API key" errors

- **Server ID discovery**
  - Dynamic discovery from page HTML instead of hardcoded values
  - Handles OpenCode deployments that change server IDs

---

## [3.5.0] - 2026-06-17 - 2026-06-17

### Fixed
- **Tool calling broken on LM Studio and Ollama**: Local models emit tool calls as inline `<tool_call>{...}</tool_call>` blocks inside `delta.content` instead of native `delta.tool_calls`. The SSE parser now runs every text chunk through a new `ToolCallAdapter` (`src/tools/toolCallAdapter.ts`) that detects these XML-style blocks, generates a stable `callId`, and emits a `LanguageModelToolCallPart`. Native `delta.tool_calls` is still honored (OpenCode / Zen / Go unchanged).
- **Tool-calls and reasoning tags from many model families**: The parser recognizes the full range of XML/pipe-bar/bracket/markdown tag variants used by Qwen, DeepSeek, Hermes, Llama 3.x, Mistral (`<antml:function_calls>`), Phi-3.5, Granite, Cohere, Yi, and any local model that emits reasoning or tool blocks inside `delta.content`. Tool-call tags: `<tool_call>`, `<toolcall>`, `<tool>`, `<invoke name="x">`, `<action>`, `<function>`, `<antml:function_calls>`, `<|tool_call|>` (Llama 3), `[TOOL_CALL]` / `[TOOL_CALLS]` (Cohere/Yi). Reasoning tags: `<think>`, `<thinking>`, `<reasoning>`, `<reflection>`, `<analysis>`, `<thought>`, `<solution>`, `<plan>`, `<|thinking|>` / `<|reasoning|>`, `[THINK]`, and markdown-style `### Reasoning` / `### Thought` / `### Plan` blocks. Body parsing supports the common JSON shapes (`{name, arguments|parameters|input|args}`, `{function: {name, arguments}}`, Cohere `{tool, parameters}`) and the Hermes/Granite XML form `<invoke name="x">JSON-args</invoke>`.
- **Reasoning blocks missing on LM Studio and Ollama**: `` blocks inside `delta.content` are now parsed and emitted as `LanguageModelThinkingPart`, so reasoning models show their thinking as a collapsible block. Native `delta.reasoning_content` is still honored.
- **LM Studio / Ollama servers invisible in the side panel**: `OpenCodeTreeProvider` only received OpenCode servers in its state. The two local providers now expose `getServerList()` and `refreshTreeView()` aggregates them under the same `Dashboard` header with a per-type icon (LM Studio = `$(chip)`, Ollama = `$(zap)`).
- **LM Studio / Ollama servers lost on reload**: Servers added via the "Add Server" command were kept only in memory. They are now persisted to `SecretStorage` (workspace state) under a new `LocalServerConfig` schema and re-hydrated on `activate()`.

### Added
- **Per-device LM Studio model entries**: Newer LM Studio versions expose the same model `key` once per device (`GPU0`, `GPU1`, `CPU`, `MPS`). The provider now reads `loaded_instances[]` and emits one `RoutedModelInfo` per `(model, device)` pair, with the device id suffixed in the display name and embedded in the composite id (`${serverId}:${key}@${device}`). Single-device installations keep the original naming.
- **Unified "Remove Server" picker**: `opencode-zen.removeServer` now lists OpenCode, LM Studio and Ollama entries together, dispatching to the right backend (`MultiServerManager` vs `LMStudioProvider` vs `OllamaProvider`) and persisting accordingly.
- **`ToolCallAdapter` unit tests** in `test/tool-call-adapter.test.ts`: 46 cases covering complete blocks, split chunks, partial opening tags, nested JSON shape, malformed bodies, interleaved reasoning + tool calls, and every supported tag family (Qwen, DeepSeek, Hermes, Llama 3.x, Mistral, Cohere, Yi, markdown headers).

### Files
- **Added**: `src/tools/toolCallAdapter.ts`, `test/tool-call-adapter.test.ts`
- **Modified**: `src/providers/OpenAICompatibleProvider.ts`, `src/providers/LMStudioProvider.ts`, `src/providers/OllamaProvider.ts`, `src/config/secretStorage.ts`, `src/extension.ts`

## [3.4.0] - 2026-06-16

### Added
- **VS Code Proposed APIs Integration**: Activadas 6 APIs propuestas de VS Code para mejorar la experiencia de chat
  - `chatProvider` (v5): Provider de chat con firma actualizada
  - `languageModelThinkingPart` (v1): Thinking blocks colapsables en el UI
  - `chatInputNotification`: Notificaciones en el área de input del chat
  - `chatStatusItem`: Items de estado en la vista de chat
  - `languageModelPricing`: Información de precios por token
  - `languageModelSystem` (v3): Mensajes de sistema nativos
- **Thinking Blocks Colapsables**: Emisión de `LanguageModelThinkingPart` para reasoning content
  - Soporte en streaming SSE OpenAI/LM Studio (`delta.reasoning_content`)
  - Soporte en streaming SSE Anthropic (`thinking_delta`)
  - Los bloques de thinking se renderizan como elementos colapsables en VS Code
- **Chat Input Notifications**: Sistema de notificaciones en el input del chat
  - `showMissingConfigNotification()`: Aviso cuando un provider no está configurado
  - `showConnectionErrorNotification()`: Aviso de errores de conexión
  - `showConnectedNotification()`: Confirmación de conexión exitosa
  - Fallback a mensajes estándar de VS Code cuando la API propuesta no está disponible
- **Chat Status Items**: Manager de estado para providers
  - `ChatStatusItemManager`: Crea items de estado usando la API propuesta
  - Fallback a `StatusBarItem` cuando la API no está disponible
- **Model Pricing**: Información de precios integrada en los modelos
  - Campo `_pricing` en `RoutedModelInfo` con `inputTokenPrice`, `outputTokenPrice`, `currency`
  - Precios populados desde `models.dev` para providers OpenCode (Free, Go)
  - Conversión automática de $/M tokens a $/token
- **System Messages Nativas**: Reemplazo del hack numérico por API propuesta
  - Eliminado `(msg.role as number) === 2`
  - Usa `(vscode as any).LanguageModelChatMessageRole.System` en `convertMessages()` y `convertMessagesAnthropic()`

### Changed
- **Refactor de Providers**: Unificación de providers bajo `OpenAICompatibleProvider`
  - Eliminados `BaseLocalProvider.ts`, `BaseOpenCodeProvider.ts`
  - Nuevo `OpenAICompatibleProvider.ts` como clase base para todos los providers
  - Soporte unificado para formatos: OpenAI, Anthropic, OpenAI Responses
- **Firma de método actualizada**: `provideLanguageModelChatResponse` usa `LanguageModelChatRequestMessage[]` en lugar de `LanguageModelChatMessage[]`
- **Eliminados archivos obsoletos**: `openCodeApiClient.ts`, `anthropicAdapter.ts`, `messageConverter.ts`, `openaiResponsesAdapter.ts`, `responseStreamer.ts`, `toolCallAdapter.ts`

## [3.3.0] - 2026-06-11

### Added
- **LM Studio Provider**: Nuevo provider para conectar LM Studio local o remoto
  - Auto-detección de modelos vía `/v1/models`
  - Detección de capacidades: Reasoning, Vision, Tools
  - Streaming SSE real con chunks progresivos
  - Soporte para múltiples servidores LM Studio
  - Heurísticas de context length basadas en tamaño del modelo
- **Ollama Provider**: Nuevo provider para conectar Ollama local o remoto
  - Auto-detección de modelos vía `/api/tags`
  - Detección de capacidades: Reasoning, Vision, Tools
  - Streaming NDJSON con chunks progresivos
  - Soporte para múltiples servidores Ollama
  - Heurísticas de context length basadas en parameter_size
- **Rebranding**: Extensión renombrada a "+ Providers on Copilot Chat"
  - Nuevo nombre: `plus-providers-copilot-chat`
  - Nuevas keywords: lmstudio, ollama, local-ai, self-hosted, remote-server
  - README actualizado con documentación de todos los providers
  - Soporte para conexiones remotas en todos los providers locales

### Changed
- **package.json**: Actualizado displayName, description, keywords
- **README.md**: Documentación completa de LM Studio, Ollama, OpenCode Servers, y OpenCode Cloud

## [3.2.5] - 2026-06-11

### Added
- **Tests reales con datos del servidor**: 30 tests pasando validados contra respuestas reales.
  - `test/OpenCodeServerProvider.test.ts` — 15 tests: extracción de texto/reasoning/tokens de `parts[]`, manejo de errores, respuestas vacías, tool calls, validación de estructura JSON, simulación de orden de eventos streaming
  - `test/OpenCodeServerProvider.streaming.test.ts` — 9 tests: orden reasoning→texto, concatenación de múltiples text parts, cancelación de token, manejo de tool calls, respuesta vacía
  - `test/opencode-server.integration.test.ts` — 6 tests de integración REAL con servidor opencode + LMStudio:
    - Verifica health del servidor, crea sesión, envía mensajes
    - Tarea pesada: genera 900+ chars con 28K tokens en 22s
    - Verifica reasoning en respuesta compleja (matemáticas)
    - Valida estructura JSON: step-start → reasoning → text → step-finish
    - Usa provider `lm-studiolocal` configurado en opencode → http://localhost:1234/v1
  - `test/provider-behavior.test.ts` — 4 tests HONESTOS del comportamiento REAL:
    - Documenta que el servidor opencode devuelve JSON completo (NO SSE/streaming)
    - El provider acumula parts[] y emite al final con yield al event loop
    - 100 parts se procesan en ~165ms (si fuera streaming real tardaría 10-20s)
    - Valida estructura JSON real del servidor: step-start → reasoning → text → step-finish
    - Documenta la diferencia: opencode (JSON completo) vs LMStudio (SSE real)
  - Framework: `node:test` + `tsx` (sin jest/mocha)

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



