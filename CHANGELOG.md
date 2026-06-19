# Changelog

## [Unreleased] - 2026-06-19

### 🏗️ Architecture Refactor: AI SDK v6 Migration

**Major refactor of the provider architecture to use official AI SDK packages (`@ai-sdk/openai`, `@ai-sdk/anthropic`).**

#### Changed
- **BREAKING**: `OpenAICompatibleProvider` renamed to `BaseProvider` (reflects multi-provider support: OpenAI, Anthropic, and compatible)
- **BREAKING**: Removed custom HTTP streaming implementation in favor of official AI SDK
  - `streamOpenAIChat()` now uses `@ai-sdk/openai` with `streamText()`
  - `streamAnthropicChat()` now uses `@ai-sdk/anthropic` with `streamText()`
  - Both handlers use shared utilities in `src/providers/sdk/utils.ts`

#### Removed
- **Dead code elimination (~1000 lines)**:
  - `src/providers/sdk/compatChat.ts` - replaced by SDK-based handlers
  - `src/tools/toolCallAdapter.ts` - replaced by AI SDK's native tool handling
  - `src/client/opencodeClient.ts` - unused HTTP client
  - Duplicate message conversion logic in both SDK handlers
- **Compiled artifacts**: Removed all `.js` and `.js.map` files from `src/` (build output now only in `out/`)

#### Added
- `src/providers/sdk/utils.ts` - Shared utilities:
  - `convertMessages()` - VS Code to AI SDK message format conversion
  - `mapModelOptions()` - Temperature/topP/maxTokens mapping
  - `trackToolNames()` - Tool name tracking by callId
- `.gitignore` rules for `src/**/*.js` and `src/**/*.js.map`

#### Fixed
- **Tool schema format**: Now uses `jsonSchema()` wrapper from `@ai-sdk/provider-utils` instead of raw JSON
- **Tool call property**: Changed from `args` to `input` (AI SDK v6 standard)
- **Reasoning blocks**: Changed from `thinkingText` to `reasoningText` (AI SDK v6 standard)
- **Auth header caching**: Fixed by passing API key directly to SDK on every call (no stale cache)

#### Files Changed
- Renamed: `src/providers/OpenAICompatibleProvider.ts` → `src/providers/BaseProvider.ts`
- Updated: All 6 provider imports to use new `BaseProvider` name
- All providers (LM Studio, Ollama, OpenCode Server) now use `streamOpenAIChat()`

---

## [3.5.0] - 2026-06-17

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
