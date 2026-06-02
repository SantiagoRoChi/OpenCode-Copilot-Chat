# OpenCode Zen for Copilot

<p align="center">
  <strong>Accede a modelos OpenCode en GitHub Copilot Chat — 4 providers, 80+ modelos, precios en tiempo real</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/VS%20Code-1.120+-blue.svg" alt="VS Code Version">
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg" alt="Platform">
  <img src="https://img.shields.io/badge/Version-3.1.0-green.svg" alt="Version">
</p>

<p align="center">
  <a href="https://github.com/SantiagoRoChi/OpenCode-Copilot-Chat/releases/latest">📥 Descargar VSIX</a>
  ·
  <a href="https://github.com/SantiagoRoChi/OpenCode-Copilot-Chat">GitHub</a>
  ·
  <a href="https://github.com/SantiagoRoChi/OpenCode-Copilot-Chat/issues">Reportar Bug</a>
</p>

---

Extensión para VS Code que registra modelos de [OpenCode Zen](https://opencode.ai) como proveedores de Language Model para GitHub Copilot Chat.

## ✨ Características Principales

### 4 Proveedores Independientes

| Provider | Modelos | Descripción |
|----------|---------|-------------|
| **OpenCode Free** | 4+ | DeepSeek V4 Flash Free, MiMo V2.5 Free, Nemotron 3 Super Free, Big Pickle |
| **OpenCode Go** | 16 | Kimi K2.5/K2.6, DeepSeek V4 Pro/Flash, GLM 5/5.1, MiMo, MiniMax, Qwen |
| **OpenCode Zen** | 66 | GPT 5.x, Claude Opus/Sonnet/Haiku, Gemini 3.x, Kimi, DeepSeek, GLM, Grok |
| **OpenCode Servers** | ∞ | Modelos de servidores OpenCode locales o remotos |

### Modelos en Tiempo Real desde models.dev

- **Context sizes reales**: GPT-5.5 (1.05M), Claude Opus (1M), DeepSeek V4 (1M)
- **Pricing en tooltips**: hover sobre cualquier modelo muestra `In: $X/M · Out: $Y/M · Cache: $Z/M`
- **Capabilities**: Vision, Tools, Reasoning detectados automáticamente
- **Cache TTL 30 minutos**: datos frescos sin recargar la extensión

### Servidores OpenCode Locales

- Detección automática de `opencode serve`
- Conexión a múltiples servidores simultáneamente
- Cada servidor aparece como "Model Name (ServerName)" en el selector
- Auth básica soportada (`OPENCODE_SERVER_PASSWORD`)
- API session-based: `POST /session` + `POST /session/:id/message`

### ThinkingEffort

- Modelos de razonamiento (GPT, Claude, Gemini, DeepSeek) muestran badge de configuración
- Niveles: low / medium / high
- Se configura desde el selector de modelos

### Streaming y Tool Calling

- SSE streaming en tiempo real
- Tool calling con JSON repair automático
- Reasoning content bufferizado
- Soporte para `reasoning_content` (DeepSeek, MiMo, Kimi)

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
