# + Providers on Copilot Chat

<p align="center">
  <strong>Connect LM Studio, Ollama, and OpenCode to GitHub Copilot Chat — local and remote AI models</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/VS%20Code-1.120+-blue.svg" alt="VS Code Version">
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg" alt="Platform">
  <img src="https://img.shields.io/badge/Version-4.1.0-green.svg" alt="Version">
</p>

<p align="center">
  <a href="https://github.com/SantiagoRoChi/OpenCode-Copilot-Chat/releases/latest">📥 Download VSIX</a>
  ·
  <a href="https://github.com/SantiagoRoChi/OpenCode-Copilot-Chat">GitHub</a>
  ·
  <a href="https://github.com/SantiagoRoChi/OpenCode-Copilot-Chat/issues">Report Bug</a>
</p>

---

VS Code extension that registers **LM Studio**, **Ollama**, and **OpenCode** as Language Model providers for GitHub Copilot Chat. Use your own local or remote AI models directly in Copilot Chat.

## 📁 Architecture

```
src/
├── providers/
│   ├── BaseProvider.ts              # Base class for all providers
│   ├── sdk/
│   │   ├── anthropicChat.ts         # Anthropic SDK handler
│   │   ├── openaiChat.ts            # OpenAI SDK handler
│   │   └── utils.ts                 # Shared message conversion utilities
│   ├── LMStudioProvider.ts          # LM Studio (OpenAI-compatible API)
│   ├── OllamaProvider.ts            # Ollama (OpenAI-compatible API)
│   ├── OpenCodeFreeProvider.ts      # OpenCode Free tier
│   ├── OpenCodeGoProvider.ts        # OpenCode Go tier
│   ├── OpenCodeServerProvider.ts    # OpenCode Server
│   └── OpenCodeZenProvider.ts       # OpenCode Zen tier
├── treeview/
│   ├── infrastructureProvider.ts    # Servers → Models tree
│   └── kpisProvider.ts              # Usage metrics tree
├── client/                          # API clients
├── config/                          # Settings and storage
└── ...
```

**Key Design Decisions:**
- All providers extend `BaseProvider`
- SDK-based handlers use official AI SDK packages
- Shared utilities in `sdk/utils.ts` eliminate code duplication
- LM Studio and Ollama use OpenAI-compatible API (not custom SSE parsing)
- Visual layer is 100% native VS Code TreeView (no webviews)

## ✨ Supported Providers

| Provider | Connection | Models | Features |
|----------|-----------|--------|----------|
| **LM Studio** | Local or Remote | Auto-detected from `/v1/models` | Streaming, Reasoning, Vision, Tools |
| **Ollama** | Local or Remote | Auto-detected from `/api/tags` | Streaming, Reasoning, Vision, Tools |
| **OpenCode Free** | Cloud | 4+ | DeepSeek V4 Flash Free, MiMo V2.5 Free, Nemotron 3 Super Free |
| **OpenCode Go** | Cloud | 16+ | Kimi K2.5/K2.6, DeepSeek V4 Pro/Flash, GLM 5/5.1, MiMo, MiniMax, Qwen |
| **OpenCode Zen** | Cloud | 66+ | GPT 5.x, Claude Opus/Sonnet/Haiku, Gemini 3.x, Kimi, DeepSeek, GLM, Grok |
| **OpenCode Servers** | Local or Remote | ∞ | Any model configured in your OpenCode server |

## 🔌 How to Connect

### LM Studio (Local or Remote)

1. Install [LM Studio](https://lmstudio.ai) and start the local server (default port `1234`)
2. Or use a remote LM Studio instance
3. The extension auto-detects all loaded models with their capabilities

**Configuration**: `settings.json`
```json
{
  "lmstudio.baseUrl": "http://localhost:1234"
}
```

### Ollama (Local or Remote)

1. Install [Ollama](https://ollama.com) and pull models: `ollama pull llama3.1`
2. Start Ollama server (default port `11434`)
3. Or use a remote Ollama instance
4. The extension auto-detects all pulled models with their capabilities

**Configuration**: `settings.json`
```json
{
  "ollama.baseUrl": "http://localhost:11434"
}
```

### OpenCode Servers (Local or Remote)

1. Install [OpenCode CLI](https://opencode.ai): `npm install -g opencode`
2. Start server: `opencode serve` (default port `4096`)
3. Or connect to a remote OpenCode server
4. Add server via command palette: `+ Providers: Add Server`

**Features**:
- Multiple servers simultaneously
- Basic auth support (`OPENCODE_SERVER_PASSWORD`)
- Session-based API: `POST /session` + `POST /session/:id/message`

### OpenCode Cloud (Free/Go/Zen)

1. Get API key at [opencode.ai/auth](https://opencode.ai/auth)
2. Configure via command palette: `+ Providers: Configure Zen/Go/Free`

## 🧠 Model Capabilities Detection

The extension automatically detects model capabilities:

- **Reasoning**: DeepSeek, Qwen3, models with "reasoning" or "think" in name
- **Vision**: LLaVA, models with "vision" or "vl" in name
- **Tools**: Qwen, Llama3, models with "tool" or "function" in name
- **Context Length**: Heuristic based on model size (7B→8K, 13B→32K, 70B→128K)

## 🌐 Remote Servers

All local providers (LM Studio, Ollama, OpenCode Servers) support remote connections:

```json
{
  "lmstudio.baseUrl": "http://192.168.1.100:1234",
  "ollama.baseUrl": "http://my-server:11434"
}
```

## 📦 Installation

### From VS Code Marketplace
Search for "+ Providers on Copilot Chat" in the Extensions panel.

### From VSIX
1. Download `.vsix` from [Releases](https://github.com/SantiagoRoChi/OpenCode-Copilot-Chat/releases)
2. Run: `code --install-extension plus-providers-copilot-chat-*.vsix`

### From Source

```bash
git clone https://github.com/SantiagoRoChi/OpenCode-Copilot-Chat.git
cd OpenCode-Copilot-Chat
npm install
npm run esbuild
npm run package
code --install-extension plus-providers-copilot-chat-*.vsix
```

## 🛠️ Requirements

- VS Code 1.120.0+
- GitHub Copilot Chat extension
- For local models: LM Studio, Ollama, or OpenCode CLI running

## 📝 Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## 🚀 Uso

### Configuración Inicial

1. **Obtén una API key** en [opencode.ai/auth](https://opencode.ai/auth)
2. **OpenCode local detectado automáticamente** — usa tus keys existentes
3. **Configuración manual**: `Ctrl+Shift+P` → `OpenCode Zen: Configure Zen Key`

### En Copilot Chat

1. Abre Copilot Chat
2. Selecciona un modelo del selector
3. Los modelos aparecen agrupados por provider con context size y capabilities

### Servidores Locales

```bash
# Iniciar servidor local
opencode serve --port 4096

# O añadir manualmente
Ctrl+Shift+P → OpenCode Zen: Add Server
```

Los servidores aparecen como proveedores separados en el selector de modelos.

### Comandos

| Comando | Descripción |
|---------|-------------|
| `Configure Zen Key` | Configurar/limpiar Zen API key |
| `Configure Go Key` | Configurar/limpiar Go API key |
| `Add Server` | Añadir servidor OpenCode/LM Studio/Ollama |
| `Edit Server` | Editar servidor existente |
| `Remove Server` | Eliminar servidor |
| `Launch Server` | Lanzar servidor offline |
| `Refresh All Models` | Refrescar catálogo completo |
| `Refresh Servers` | Refrescar conexiones de servidor |
| `Show Output` | Ver logs de debug |

## 🏗️ Architecture

```
extension.ts
├── providers/
│   ├── BaseProvider.ts              # Base class (model caching, events)
│   ├── sdk/
│   │   ├── anthropicChat.ts         # Anthropic SDK handler
│   │   ├── openaiChat.ts            # OpenAI SDK handler  
│   │   └── utils.ts                 # Shared message conversion
│   ├── LMStudioProvider.ts          # LM Studio (OpenAI-compatible)
│   ├── OllamaProvider.ts            # Ollama (OpenAI-compatible)
│   ├── OpenCodeFreeProvider.ts      # Free tier models
│   ├── OpenCodeGoProvider.ts        # Go tier models (Anthropic SDK)
│   ├── OpenCodeZenProvider.ts       # Zen tier models
│   └── OpenCodeServerProvider.ts    # Custom OpenCode servers
├── treeview/
│   ├── infrastructureProvider.ts    # Servers → Models sidebar tree
│   └── kpisProvider.ts              # Usage metrics sidebar tree
├── client/
│   ├── multiServerManager.ts        # Server connection management
│   ├── modelRegistry.ts             # Model capabilities from models.dev
│   └── types.ts
├── config/
│   └── secretStorage.ts             # API key storage
├── integration/
│   ├── opencodeConnector.ts         # Auto-detect local OpenCode
│   └── openCodeUsageService.ts      # Usage data fetching
└── tools/
    └── subagentTool.ts              # opencode_subagent tool
```

**Provider Architecture:**
- All providers extend `BaseProvider` (handles model caching, events, token counting)
- SDK-based handlers (`anthropicChat.ts`, `openaiChat.ts`) use official AI SDK packages
- Shared utilities in `sdk/utils.ts` eliminate code duplication
- LM Studio and Ollama use OpenAI-compatible API endpoints
- Visual layer is 100% native VS Code TreeView — zero webviews

## 🚀 New Features (v4.1.0 — 2026-06-26)

### P2 Performance Optimizations

- **Incremental stats counters**: `getStats()` now O(1) instead of O(n) — no full recompute on every usage event
- **Bounded memory**: UsageTracker caps at 5000 records, prunes to 4000 automatically
- **Cached discovery**: Workspace ID and API keys read from storage once, cached in memory for all subsequent fetches
- **Parallel key validation**: Zen + Go key validation runs concurrently (up to 2× faster activation)
- **Indexed model grouping**: Server→model grouping in O(M+S) instead of O(S×M)

## 🚀 New Features (v4.0.0 — 2026-06-25)

### Complete Visual Layer Redesign

The entire sidebar UI has been rebuilt from scratch using **native VS Code TreeView components**. No more webviews, no more status bar clutter, no more overlapping visual elements.

#### New Infrastructure Tree View
- **Servers → Models hierarchy**: Each server is a collapsible root node with its models as children
- **Semantic icons**: ☁️ cloud providers, 💻 LM Studio, ⚡ Ollama, 🔌 custom servers
- **Online/offline status**: Offline servers shown with muted styling
- **Model capabilities**: Each model shows Chat/Tools/Vision badges + context window size
- **Context menu actions**: Edit, Remove, Launch, Refresh directly from each server node

#### New KPIs Tree View
- **Summary section**: Total requests, tokens in/out, total cost
- **By Server breakdown**: Per-provider usage with local/cloud distinction
- **By Model breakdown**: Per-model usage sorted by total tokens
- **Auto-refresh**: Updates automatically when usage data changes

#### Removed (intentionally)
- Status bar items (moved all info into the sidebar)
- Dashboard webview (replaced by native trees)
- Usage webview panel (replaced by KPIs tree)
- Chat status items (using VS Code native chat APIs instead)
- 6 redundant commands (`showUsage`, `showOutputLog`, `refreshGlobal`, `openUsageWebview`, `openDashboard`, `clearUsage` from palette)

## 🚀 Previous Features (v3.7.0 — 2026-06-25)

### Context Size Configuration
Model configuration now includes a `contextSize` selector — choose **Default** (32K), **Large** (64K), or **Full** for supported models in the Copilot model picker. This gives you fine-grained control over prompt window vs. cost.

### Utility Model Aliases
Each cloud provider now generates smart utility aliases for quick model selection:
- **Zen**: `opencode-cheap-zen` (cheapest), `opencode-fast-zen` (fastest)
- **Go**: `opencode-cheap-go`, `opencode-fast-go`
- **Free**: `opencode-fast-free`
Aliases inherit the target model's API configuration automatically.

### Family-Aware Reasoning Defaults
Reasoning effort is automatically matched to model family — no manual tuning needed:
| Family | Default Reasoning |
|--------|-----------------|
| Claude Opus/Sonnet, DeepSeek | `high` |
| GPT, Claude Haiku, Gemini | `medium` |
| Qwen, MiniMax | `low` |

## 📝 Recent Changes (2026-06-19)

### AI SDK v6 Migration
- **Architecture refactor**: Migrated from custom HTTP streaming to official AI SDK
  - `@ai-sdk/openai` for OpenAI-compatible providers
  - `@ai-sdk/anthropic` for Anthropic API providers
- **Renamed**: `OpenAICompatibleProvider` → `BaseProvider` (reflects multi-provider support)
- **Added**: Shared utilities in `src/providers/sdk/utils.ts`
  - `convertMessages()` - VS Code to AI SDK message format
  - `mapModelOptions()` - Temperature/topP/maxTokens mapping
  - `trackToolNames()` - Tool name tracking by callId

### Code Cleanup
- **Removed** (~1000 lines of dead code):
  - `src/providers/sdk/compatChat.ts` - replaced by SDK handlers
  - `src/tools/toolCallAdapter.ts` - replaced by AI SDK native handling
  - `src/client/opencodeClient.ts` - unused
  - Duplicate message conversion logic
- **Cleaned**: All `.js` and `.js.map` files from `src/` (build only in `out/`)

### Bug Fixes
- Fixed tool schema format (use `jsonSchema()` wrapper)
- Fixed tool call property (`input` instead of `args`)
- Fixed reasoning blocks (`reasoningText` instead of `thinkingText`)
- Fixed auth header caching (pass API key directly to SDK)

## 🚀 Nuevas Funcionalidades (v3.6.0)

### 📊 OpenCode Usage Tracking
- **Datos de uso en tiempo real** desde la API de OpenCode
- **Burn-rate de suscripción Go**: Seguimiento de 5h rolling, semanal y mensual
- **Costo por modelo**: Cálculo automático basado en tokens y precios
- **Status bar mejorado**: Muestra burn-rate con indicadores de advertencia

### 🤖 Agent Window Support
- **Proveedores para Agents Window**: Registra instancias duplicadas con sufijo \-agent\`r
- **Configurable**: \opencode-zen.enableAgentWindow\ (default: true)
- **Copilot CLI**: Modelos disponibles en Agents Window

### 🔐 OpenCode Auth Service
- **Gestión centralizada**: Workspace ID, cookie de auth, API keys
- **Descubrimiento automático**: Extrae workspace ID de páginas OpenCode
- **Server ID dinámico**: Descubre server ID del HTML de la página

### 🌐 OpenCode Usage Panel
- **Simple Browser integrado**: Login OAuth en panel de VS Code
- **Servidor HTTP local**: Captura workspace ID y cookie automáticamente
- **Sin inputs manuales**: Todo el proceso es automático

### 📈 Status Bar Mejorado
- **Burn-rate de Go**: Muestra 5h/weekly/monthly
- **Indicadores de advertencia**: ⚠️ cuando se acerca a límites
- **Costo por request**: Muestra costo estimado

### 🌳 Tree View Mejorado
- **Comandos de registro**: Login, Configure Workspace
- **Datos de burn-rate**: Muestra en dashboard
- **Acceso directo**: A todas las opciones de configuración

## ⚙️ Configuración

| Propiedad | Default | Descripción |
|-----------|---------|-------------|
| `opencode-zen.requestTimeout` | `60000` | Timeout request (ms) |
| `opencode-zen.enableToolCalling` | `true` | Tool calling |
| `opencode-zen.enableImageInput` | `true` | Vision/image input |
| `opencode-zen.agentTemperature` | `0.0` | Temperatura para tools |
| `opencode-zen.verboseLogging` | `false` | Logs detallados |

## 📊 Modelos Disponibles

### OpenCode Zen (66 modelos)
GPT 5.x, GPT 5 Nano, Claude Opus 4.1-4.8, Claude Sonnet 4-4.6, Claude Haiku 4.5, Gemini 3.5 Flash, Gemini 3.1 Pro, Kimi K2.5/K2.6, DeepSeek V4 Flash, GLM 5/5.1, MiniMax M2.5/M2.7, Qwen 3.5/3.6/3.7, Grok Build 0.1, Big Pickle

### OpenCode Go (16 modelos)
Kimi K2.5/K2.6, DeepSeek V4 Pro/Flash, GLM 5/5.1, MiMo V2.5/Pro, MiniMax M2.5/M2.7/M3, Qwen 3.5/3.6/3.7

### OpenCode Free
DeepSeek V4 Flash Free, MiMo V2.5 Free, Nemotron 3 Super Free, Big Pickle

## 🔄 Auto-detección

- Detecta OpenCode local en `~/.local/share/opencode/auth.json`
- FileSystemWatcher detecta nuevas keys
- Servidores OpenCode en ejecución se conectan automáticamente

## 📝 License

MIT

---

Hecho con ❤️ para desarrolladores que usan OpenCode


