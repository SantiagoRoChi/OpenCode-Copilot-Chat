# OpenCode Zen for Copilot

VSCode extension that registers [OpenCode Zen](https://opencode.ai) models as a Language Model Provider for GitHub Copilot Chat.

## Features

- **45+ Models** — GPT 5.x, Claude 4.x, Gemini 3.x, Qwen3, DeepSeek, MiniMax, GLM, Kimi, Grok
- **4 Free Models** — `deepseek-v4-flash-free`, `mimo-v2.5-free`, `nemotron-3-super-free`, `big-pickle`
- **Auto-Detection** — Detects OpenCode installation and reads API key automatically
- **Tool Calling** — Full tool calling support with automatic JSON repair
- **Streaming** — Real-time SSE streaming with reasoning content display
- **Vision** — Image input support for multimodal models

## Requirements

- VSCode 1.120.0 or later
- GitHub Copilot extension

## Quick Start

1. Install this extension
2. Get a Zen API key at [opencode.ai/auth](https://opencode.ai/auth)
3. If OpenCode is installed, the key is detected automatically
4. Otherwise, run `OpenCode Zen: Configure OpenCode Zen` from the Command Palette (`Ctrl+Shift+P`)

## Commands

| Command | Description |
|---------|-------------|
| `OpenCode Zen: Configure OpenCode Zen` | Set or clear the API key |
| `OpenCode Zen: Test Connection` | Verify API key and check available models |
| `OpenCode Zen: Refresh Models` | Force refresh the model catalog |
| `OpenCode Zen: Show Output` | Open the output channel with logs |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `opencode-zen.requestTimeout` | `60000` | Request timeout in ms |
| `opencode-zen.enableToolCalling` | `true` | Enable tool calling support |
| `opencode-zen.enableImageInput` | `true` | Enable vision/image support |
| `opencode-zen.parallelToolCalling` | `true` | Enable parallel tool calls |
| `opencode-zen.agentTemperature` | `0.0` | Temperature for tool calls |
| `opencode-zen.verboseLogging` | `false` | Enable verbose logging |
| `opencode-zen.autoDetectOpenCode` | `true` | Auto-detect OpenCode API key |

## Model Sources

Models are fetched from multiple sources:
1. **Local builtin catalog** — 45+ models with full metadata (always available)
2. **models.dev** — Community-maintained model catalog (24h cache)
3. **Zen API** — Live model list from OpenCode (1h cache)

## Architecture

```
src/
├── extension.ts           # Entry point
├── provider.ts            # LanguageModelChatProvider implementation
├── client/
│   ├── types.ts           # TypeScript interfaces
│   ├── zenClient.ts       # HTTP client for Zen API
│   └── modelsDevClient.ts # models.dev catalog fetcher
├── models/
│   ├── modelMetadata.ts   # 45+ model definitions
│   ├── registry.ts        # Model catalog (local + remote)
│   └── modelInfoBuilder.ts# Model → Copilot format mapper
├── integration/
│   ├── authReader.ts      # OpenCode auth.json reader
│   └── opencodeConnector.ts # OpenCode detection
├── streaming/
│   ├── responseStreamer.ts # SSE streaming parser
│   └── messageConverter.ts # VSCode ↔ OpenAI format
├── tools/
│   └── toolCallAdapter.ts # Tool calling + JSON repair
├── config/
│   ├── settings.ts        # VSCode settings reader
│   └── secretStorage.ts   # API key storage
├── status/
│   └── statusBar.ts       # Status bar controller
└── utils/
    └── tokenEstimate.ts   # Token estimation
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run esbuild

# Watch mode
npm run esbuild-watch

# Package VSIX
npm run package
```

## License

MIT
