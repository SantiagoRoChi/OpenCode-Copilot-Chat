# OpenCode Zen for Copilot

<p align="center">
  <strong>Accede a 45+ modelos de IA en GitHub Copilot Chat — con modelos gratuitos incluidos</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/VS%20Code-1.120+-blue.svg" alt="VS Code Version">
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg" alt="Platform">
  <img src="https://img.shields.io/badge/Models-45+-green.svg" alt="Models">
</p>

<p align="center">
  <a href="https://github.com/SantiagoRoChi/OpenCode-Copilot-Chat/releases/latest">📥 Descargar VSIX</a>
  ·
  <a href="https://github.com/SantiagoRoChi/OpenCode-Copilot-Chat">GitHub</a>
  ·
  <a href="https://github.com/SantiagoRoChi/OpenCode-Copilot-Chat/issues">Reportar Bug</a>
</p>

---

Extensión para VS Code que registra los modelos de [OpenCode Zen](https://opencode.ai) como proveedor de Language Model para GitHub Copilot Chat. Usa tus modelos favoritos directamente en el chat de Copilot.

## ✨ Características

- **🆓 Modelos gratuitos** — 4 modelos gratis habilitados por defecto: `deepseek-v4-flash-free`, `mimo-v2.5-free`, `nemotron-3-super-free`, `big-pickle`
- **🤖 45+ modelos** — GPT 5.x, Claude 4.x, Gemini 3.x, Qwen3, DeepSeek, MiniMax, GLM, Kimi, Grok y más
- **🔑 Detección automática** — Detecta tu instalación de OpenCode y usa su API key automáticamente
- **🛠️ Tool calling** — Soporte completo para tool calling con reparación automática de JSON
- **📡 Streaming** — Streaming SSE en tiempo real con visualización de reasoning
- **🖼️ Visión** — Soporte de entrada de imágenes para modelos multimodales
- **📊 Barra de estado** — Indicador de estado con información de conexión y sesiones

## 📦 Instalación

### Descargar VSIX (recomendado)

Descarga el archivo `.vsix` desde la [última release](https://github.com/SantiagoRoChi/OpenCode-Copilot-Chat/releases/latest) e instálalo:

```bash
code --install-extension opencode-zen-*.vsix
```

O desde VS Code: Extensiones → "..." → Install from VSIX...

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

1. **Obtén una API key** de OpenCode Zen en [opencode.ai/auth](https://opencode.ai/auth)

2. **Si tienes OpenCode instalado**, la API key se detecta automáticamente

3. **Si no tienes OpenCode**, configura la API key manualmente:
   - `Ctrl+Shift+P` → `OpenCode Zen: Configure OpenCode Zen`
   - Ingresa tu API key

### Usar en Copilot Chat

1. Abre GitHub Copilot Chat en VS Code

2. En el selector de modelos, busca **OpenCode Zen**

3. Selecciona un modelo (los modelos gratuitos están marcados con ✨)

4. ¡Chatea! Los modelos funcionan igual que los modelos de Copilot

### Comandos disponibles

| Comando | Descripción |
|---------|-------------|
| `OpenCode Zen: Configure OpenCode Zen` | Configurar o limpiar la API key |
| `OpenCode Zen: Test Connection` | Verificar API key y modelos disponibles |
| `OpenCode Zen: Refresh Models` | Forzar actualización del catálogo de modelos |
| `OpenCode Zen: Show Output` | Abrir canal de salida con logs |

## ⚙️ Configuración

| Propiedad | Descripción | Default |
|-----------|-------------|---------|
| `opencode-zen.requestTimeout` | Timeout de requests en ms | `60000` |
| `opencode-zen.enableToolCalling` | Habilitar soporte de tool calling | `true` |
| `opencode-zen.enableImageInput` | Habilitar soporte de imágenes/vision | `true` |
| `opencode-zen.parallelToolCalling` | Permitir tool calls en paralelo | `true` |
| `opencode-zen.agentTemperature` | Temperatura para tool calls | `0.0` |
| `opencode-zen.verboseLogging` | Logging detallado (debug) | `false` |
| `opencode-zen.autoDetectOpenCode` | Auto-detectar API key de OpenCode | `true` |

## 🤖 Modelos soportados

### Gratuitos (siempre disponibles)

| Modelo | Contexto | Capacidades |
|--------|----------|-------------|
| `deepseek-v4-flash-free` | 328K | Tools |
| `mimo-v2.5-free` | 131K | Tools, Reasoning |
| `nemotron-3-super-free` | 131K | Tools |
| `big-pickle` | 232K | Tools |

### Premium (requieren API key con créditos)

- **OpenAI**: GPT-5.2, GPT-5.4, GPT-5.5, GPT-5.4 mini
- **Anthropic**: Claude Opus 4.1-4.8, Claude Sonnet 4-4.6
- **Google**: Gemini 3 Flash, Gemini 3.1 Pro, Gemini 3.5 Flash
- **Otros**: Qwen3, DeepSeek V4, MiniMax, GLM 5, Kimi, Grok

## 🔧 Desarrollo

### Requisitos

- [Node.js](https://nodejs.org/) >= 18
- [VS Code](https://code.visualstudio.com/) >= 1.120

### Compilar

```bash
npm install
npm run esbuild      # Compilar una vez
npm run esbuild-watch # Modo watch
```

### Empaquetar

```bash
npm run package
```

Genera `opencode-zen-<version>.vsix` en la raíz del proyecto.

### Publicar una Release

1. Actualiza la versión en `package.json` siguiendo [semver](https://semver.org/)
2. Actualiza `CHANGELOG.md`
3. Crea un tag y pushea:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
4. El pipeline de GitHub Actions generará automáticamente el `.vsix` y creará una **GitHub Release** con el archivo adjunto

## 🤖 CI/CD

Este repositorio incluye un pipeline de GitHub Actions (`.github/workflows/ci.yml`) que:

- **Compila** la extensión en cada push/PR (Ubuntu + Windows)
- **Genera el `.vsix`** en cada compilación (disponible como artefacto)
- **Crea una Release** automáticamente cuando se pushea un tag `v*`, con el `.vsix` adjunto para descarga directa

## 📁 Estructura del proyecto

```
src/
├── extension.ts           # Punto de entrada
├── provider.ts            # Implementación de LanguageModelChatProvider
├── client/
│   ├── types.ts           # Interfaces TypeScript
│   ├── zenClient.ts       # Cliente HTTP para Zen API
│   └── modelsDevClient.ts # Cliente para catálogo models.dev
├── models/
│   ├── modelMetadata.ts   # 45+ definiciones de modelos
│   ├── registry.ts        # Catálogo de modelos (local + remoto)
│   └── modelInfoBuilder.ts# Mapper modelo → formato Copilot
├── integration/
│   ├── authReader.ts      # Lector de auth.json de OpenCode
│   └── opencodeConnector.ts # Detección de OpenCode
├── streaming/
│   ├── responseStreamer.ts # Parser SSE streaming
│   └── messageConverter.ts # Convertidor VSCode ↔ OpenAI
├── tools/
│   └── toolCallAdapter.ts # Tool calling + reparación JSON
├── config/
│   ├── settings.ts        # Lector de settings de VSCode
│   └── secretStorage.ts   # Almacenamiento de API key
├── status/
│   └── statusBar.ts       # Controlador de barra de estado
└── utils/
    └── tokenEstimate.ts   # Estimación de tokens
```

## 📄 Licencia

MIT

---

Hecho con ❤️ para desarrolladores que usan OpenCode Zen
