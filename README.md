# + Providers on Copilot Chat

<p align="center">
  <strong>Connect LM Studio, Ollama, and OpenCode to GitHub Copilot Chat — local and remote AI models</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/VS%20Code-1.120+-blue.svg" alt="VS Code Version">
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg" alt="Platform">
  <img src="https://img.shields.io/badge/Version-3.3.0-green.svg" alt="Version">
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
2. Run: `code --install-extension plus-providers-copilot-chat-3.3.0.vsix`

## 🛠️ Requirements

- VS Code 1.120.0+
- GitHub Copilot Chat extension
- For local models: LM Studio, Ollama, or OpenCode CLI running

## 📝 Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

### ThinkingEffort

- Modelos de razonamiento (GPT, Claude, Gemini, DeepSeek) muestran badge de configuración
- Niveles: low / medium / high
- Se configura desde el selector de modelos

### Streaming y Tool Calling

- SSE streaming en tiempo real
- Tool calling con JSON repair automático
- Reasoning content como bloques colapsables (`LanguageModelThinkingPart`)
- Soporte para `reasoning_content` (DeepSeek, MiMo, Kimi)

### Subagent Tool

Herramienta `opencode_subagent` registrada para que Copilot Chat pueda delegar tareas a un provider OpenCode:

```json
{
  "name": "opencode_subagent",
  "query": "Ejecuta ls -la en la terminal",
  "description": "Listando archivos del directorio actual"
}
```

- Delega al primer provider disponible (Free → Go → Zen)
- Temperature 0, sin tools adicionales
- Retorna resultado con metadata

## 📦 Instalación

### Descargar VSIX

```bash
code --install-extension opencode-zen-*.vsix
```

### Desde código fuente

```bash
git clone https://github.com/SantiagoRoChi/OpenCode-Copilot-Chat.git
cd OpenCode-Copilot-Chat
npm install
npm run esbuild
npm run package
code --install-extension opencode-zen-*.vsix
```

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
| `Add Server` | Añadir servidor OpenCode |
| `Edit Server` | Editar servidor existente |
| `Remove Server` | Eliminar servidor |
| `Refresh All Models` | Refrescar catálogo completo |
| `Show Output` | Ver logs de debug |
| `Clear Usage Stats` | Limpiar estadísticas |

## 🏗️ Arquitectura

```
extension.ts
├── providers/
│   ├── BaseOpenCodeProvider.ts     (abstract, /chat/completions)
│   ├── OpenCodeFreeProvider.ts     (free models, Zen key)
│   ├── OpenCodeGoProvider.ts       (Go models, Go key)
│   ├── OpenCodeZenProvider.ts      (paid models, Zen key)
│   └── OpenCodeServerProvider.ts   (servers, session API)
├── client/
│   ├── opencodeClient.ts           (HTTP streaming)
│   ├── multiServerManager.ts       (server connections)
│   ├── modelRegistry.ts            (models.dev live data)
│   └── types.ts
├── streaming/
│   ├── responseStreamer.ts         (SSE parser)
│   └── messageConverter.ts         (format conversion)
├── config/
│   └── secretStorage.ts            (API keys)
├── integration/
│   └── opencodeConnector.ts        (auto-detection)
└── treeview/
    └── openCodeTreeProvider.ts     (sidebar)
```

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
