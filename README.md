# OpenCode Zen for Copilot

<p align="center">
  <strong>Accede a modelos OpenCode en GitHub Copilot Chat — 4 providers, modelos gratuitos incluidos</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/VS%20Code-1.120+-blue.svg" alt="VS Code Version">
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg" alt="Platform">
  <img src="https://img.shields.io/badge/Providers-4-green.svg" alt="Providers">
</p>

<p align="center">
  <a href="https://github.com/SantiagoRoChi/OpenCode-Copilot-Chat/releases/latest">📥 Descargar VSIX</a>
  ·
  <a href="https://github.com/SantiagoRoChi/OpenCode-Copilot-Chat">GitHub</a>
  ·
  <a href="https://github.com/SantiagoRoChi/OpenCode-Copilot-Chat/issues">Reportar Bug</a>
</p>

---

Extensión para VS Code que registra los modelos de [OpenCode Zen](https://opencode.ai) como proveedores de Language Model para GitHub Copilot Chat.

## ✨ Características

- **4 Proveedores Independientes**:
  - `OpenCode Free` - Modelos gratuitos (DeepSeek, MiMo, Nemotron, Big Pickle)
  - `OpenCode Go` - Suscripción Go ($5-$10/mes, 16 modelos)
  - `OpenCode Zen` - Modelos premium (66 modelos)
  - `OpenCode Servers` - Servidores locales OpenCode
- **Modelos dinámicos desde models.dev** - Context sizes, pricing, capabilities en tiempo real
- **Precios en tooltips** - Hover sobre cualquier modelo muestra `In: $X/M · Out: $Y/M`
- **ThinkingEffort** - Configuración de nivel de razonamiento (low/medium/high)
- **Auto-detección local** - Detecta OpenCode local y usa sus keys automáticamente
- **Servidores locales** - Conecta y usa modelos de `opencode serve`
- **Tool calling** - Soporte completo con JSON repair
- **Streaming** - SSE en tiempo real con reasoning
- **API keys separadas** - Zen key y Go key independientes

## 📦 Instalación

### Descargar VSIX (recomendado)

```bash
code --install-extension opencode-zen-*.vsix
```

### Desde el código fuente

```bash
git clone https://github.com/SantiagoRoChi/OpenCode-Copilot-Chat.git
cd OpenCode-Copilot-Chat
npm install
npm run esbuild
npm run package
code --install-extension opencode-zen-*.vsix
```

## 🚀 Uso

### Configuración inicial

1. **Obtén una API key** en [opencode.ai/auth](https://opencode.ai/auth)
2. **Si tienes OpenCode instalado** - Se detecta automáticamente
3. **Si no** - Configura manualmente:
   - `Ctrl+Shift+P` → `OpenCode Zen: Configure Zen Key`
   - `Ctrl+Shift+P` → `OpenCode Zen: Configure Go Key`

### En Copilot Chat

1. Abre Copilot Chat
2. En el selector de modelos verás:
   - **OpenCode Free** - Modelos gratuitos
   - **OpenCode Go** - Modelos Go (si tienes suscripción)
   - **OpenCode Zen** - Modelos premium
   - **OpenCode Servers** - Modelos de servidores locales
3. Selecciona un modelo y chatea

### Servidores Locales

Para usar modelos de un servidor OpenCode local:

```bash
opencode serve --port 4096
```

Los servidores se detectan automáticamente o se pueden añadir manualmente via `Ctrl+Shift+P` → `OpenCode Zen: Add Server`.

### Comandos

| Comando | Descripción |
|---------|-------------|
| `OpenCode Zen: Configure Zen Key` | Configurar/limpiar Zen API key |
| `OpenCode Zen: Configure Go Key` | Configurar/limpiar Go API key |
| `OpenCode Zen: Add Server` | Añadir servidor OpenCode local/remoto |
| `OpenCode Zen: Edit Server` | Editar servidor existente |
| `OpenCode Zen: Remove Server` | Eliminar servidor |
| `OpenCode Zen: Refresh All Models` | Refrescar catálogo de todos los providers |
| `OpenCode Zen: Show Output` | Ver canal de output con logs |
| `OpenCode Zen: Clear Usage Stats` | Limpiar estadísticas |

## ⚙️ Configuración

| Propiedad | Default | Descripción |
|-----------|---------|-------------|
| `opencode-zen.requestTimeout` | `60000` | Timeout en ms |
| `opencode-zen.enableToolCalling` | `true` | Tool calling |
| `opencode-zen.enableImageInput` | `true` | Vision |
| `opencode-zen.parallelToolCalling` | `true` | Tool calls en paralelo |
| `opencode-zen.agentTemperature` | `0.0` | Temperatura para tools |
| `opencode-zen.verboseLogging` | `false` | Logs detallados |

## 🏗️ Arquitectura

```
extension.ts
├── providers/
│   ├── BaseOpenCodeProvider.ts     (abstract, /chat/completions)
│   ├── OpenCodeFreeProvider.ts     (free models, Zen key)
│   ├── OpenCodeGoProvider.ts       (Go models, Go key)
│   ├── OpenCodeZenProvider.ts      (paid models, Zen key)
│   └── OpenCodeServerProvider.ts   (local servers, session API)
├── client/
│   ├── opencodeClient.ts           (HTTP genérico)
│   ├── multiServerManager.ts       (server connections)
│   ├── modelRegistry.ts            (models.dev live data)
│   ├── endpoints.ts                (URLs)
│   └── types.ts
├── streaming/
│   ├── responseStreamer.ts         (SSE parser)
│   └── messageConverter.ts         (VS Code → OpenAI format)
├── config/
│   └── secretStorage.ts            (API keys)
├── integration/
│   └── opencodeConnector.ts        (auto-detection)
└── treeview/
    └── openCodeTreeProvider.ts     (sidebar)
```

## 📊 Modelos Disponibles

### OpenCode Zen (66 modelos)
GPT 5.x, Claude Opus/Sonnet/Haiku, Gemini 3.x, Kimi, DeepSeek, GLM, MiniMax, Qwen, Grok, Big Pickle

### OpenCode Go (16 modelos)
Kimi K2.5/K2.6, DeepSeek V4 Pro/Flash, GLM 5/5.1, MiMo V2.5/Pro, MiniMax M2.5/M2.7/M3, Qwen 3.5/3.6/3.7

### OpenCode Free
DeepSeek V4 Flash Free, MiMo V2.5 Free, Nemotron 3 Super Free, Big Pickle

## 🔄 Auto-detección de OpenCode Local

Al activar la extensión:
1. Lee `~/.local/share/opencode/auth.json`
2. Si hay keys: pregunta al usuario si quiere usarlas
3. Detecta servidores OpenCode en ejecución
4. Si se añaden nuevas keys: pregunta de nuevo

## 📝 License

MIT

---

Hecho con ❤️ para desarrolladores que usan OpenCode
