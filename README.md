# OpenCode Zen for Copilot

<p align="center">
  <strong>Access OpenCode Zen models in GitHub Copilot Chat — 3 providers, free models included</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/VS%20Code-1.120+-blue.svg" alt="VS Code Version">
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg" alt="Platform">
  <img src="https://img.shields.io/badge/Providers-3-green.svg" alt="Providers">
</p>

<p align="center">
  <a href="https://github.com/SantiagoRoChi/OpenCode-Copilot-Chat/releases/latest">📥 Descargar VSIX</a>
  ·
  <a href="https://github.com/SantiagoRoChi/OpenCode-Copilot-Chat">GitHub</a>
  ·
  <a href="https://github.com/SantiagoRoChi/OpenCode-Copilot-Chat/issues">Reportar Bug</a>
</p>

---

Extensión para VS Code que registra los modelos de [OpenCode Zen](https://opencode.ai) como 3 proveedores independientes de Language Model para GitHub Copilot Chat.

## ✨ Características

- **3 Proveedores Independientes**:
  - `OpenCode Free` - Modelos gratuitos (6 modelos)
  - `OpenCode Go` - Suscripción Go ($5-$10/mes, 17 modelos)
  - `OpenCode Zen` - Modelos premium (39 modelos)
- **Modelos dinámicos** - Sin hardcoded metadata, siempre desde la API
- **Auto-detección local** - Detecta OpenCode local y usa sus keys automáticamente
- **FileSystemWatcher** - Detecta nuevas keys en `auth.json`
- **Webview de uso** - Stats detallados, balance, by provider/model
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
   - **OpenCode Free** - Solo modelos gratuitos
   - **OpenCode Go** - Solo modelos Go (si tienes suscripción)
   - **OpenCode Zen** - Solo modelos premium
3. Selecciona un modelo y chatea

### Comandos

| Comando | Descripción |
|---------|-------------|
| `OpenCode Zen: Configure Zen Key` | Configurar/limpiar Zen API key |
| `OpenCode Zen: Configure Go Key` | Configurar/limpiar Go API key |
| `OpenCode Zen: Refresh All Models` | Refrescar catálogo de los 3 providers |
| `OpenCode Zen: Show Output` | Ver canal de output con logs |
| `OpenCode Zen: Show Usage Stats` | Ver stats en output |
| `OpenCode Zen: Clear Usage Stats` | Limpiar estadísticas |

## 📊 Panel de Usage

Abre el panel desde la barra de actividad (Activity Bar) o ejecuta `Show Usage Stats`.

El panel muestra:
- **🔑 API Keys** - Estado y keys enmascaradas
- **💰 Account Balance** - Balance desde API (si está disponible)
- **📈 Session Statistics** - Requests, tokens, latencia
- **📊 By Provider** - Desglose por Zen/Go/Free
- **🤖 By Model** - Top 10 modelos por uso
- **📝 Recent Requests** - Últimas 20 requests
- **🔄 Refresh / 🗑️ Clear** - Acciones

## ⚙️ Configuración

| Propiedad | Default | Descripción |
|-----------|---------|-------------|
| `opencode-zen.requestTimeout` | `60000` | Timeout en ms |
| `opencode-zen.enableToolCalling` | `true` | Tool calling |
| `opencode-zen.enableImageInput` | `true` | Vision |
| `opencode-zen.parallelToolCalling` | `true` | Tool calls en paralelo |
| `opencode-zen.agentTemperature` | `0.0` | Temperatura para tools |
| `opencode-zen.verboseLogging` | `false` | Logs detallados |
| `opencode-zen.autoDetectOpenCode` | `true` | Auto-detectar OpenCode local |

## 🏗️ Arquitectura

3 providers independientes que extienden `BaseOpenCodeProvider`:

```
extension.ts
├── providers/
│   ├── BaseOpenCodeProvider.ts (abstract)
│   ├── OpenCodeFreeProvider.ts   (free models, Zen key)
│   ├── OpenCodeGoProvider.ts     (Go models, Go key)
│   └── OpenCodeZenProvider.ts    (paid models, Zen key)
├── client/
│   ├── opencodeClient.ts         (HTTP genérico)
│   ├── endpoints.ts              (URLs)
│   └── types.ts
├── config/
│   └── secretStorage.ts          (2 keys)
├── integration/
│   ├── authReader.ts             (lee auth.json)
│   └── opencodeConnector.ts      (FileSystemWatcher)
├── status/
│   ├── statusBar.ts
│   └── usageWebview.ts           (UI mejorada)
└── usage/
    └── UsageTracker.ts
```

## 🔄 Auto-detección de OpenCode Local

Al activar la extensión:
1. Lee `~/.local/share/opencode/auth.json`
2. Si hay keys: pregunta al usuario si quiere usarlas
3. Activa FileSystemWatcher en `auth.json`
4. Si se añaden nuevas keys: pregunta de nuevo

## 📝 License

MIT

---

Hecho con ❤️ para desarrolladores que usan OpenCode Zen
