# Research Findings: OpenCode APIs & VSCode Patterns

## OpenCode Zen API
- **Base URL**: `https://opencode.ai/zen/v1`
- **Models endpoint**: `GET /v1/models`
- **Chat endpoint**: `POST /v1/chat/completions` (OpenAI-compatible)
- **Auth**: `Authorization: Bearer <api-key>`
- **Total models**: 45
  - **Free** (6): `big-pickle`, `deepseek-v4-flash-free`, `mimo-v2.5-free`, `qwen3.6-plus-free`, `minimax-m3-free`, `nemotron-3-super-free`
  - **Paid** (39): Claude Opus/Sonnet, GPT 5.x, Gemini, Qwen, DeepSeek, etc.

## OpenCode Go API
- **Base URL**: `https://opencode.ai/zen/go/v1`
- **Models endpoint**: `GET /go/v1/models`
- **Chat endpoint**: `POST /go/v1/chat/completions` (OpenAI-compatible for some, Anthropic-compatible for others)
- **Auth**: `Authorization: Bearer <go-api-key>`
- **Total models**: 17
  - Examples: `mimo-v2.5`, `glm-5`, `kimi-k2.6`, `deepseek-v4-pro`, `qwen3.7-max`, `minimax-m3`

## Models API Response Format
```json
{
  "object": "list",
  "data": [
    {
      "id": "model-id",
      "object": "model",
      "created": 1234567890,
      "owned_by": "opencode"
    }
  ]
}
```

## Local OpenCode Installation
- **Windows**: `%LOCALAPPDATA%\opencode\auth.json`
- **Mac/Linux**: `~/.local/share/opencode/auth.json`
- **Format**:
```json
{
  "opencode": { "type": "api", "apiKey": "oc-..." },
  "opencode-go": { "type": "api", "apiKey": "oc-..." }
}
```

## VSCode LanguageModelChatProvider Interface
```typescript
interface LanguageModelChatProvider {
  provideLanguageModelChatInformation(
    options: { silent: boolean; configuration?: { [key: string]: unknown } },
    token: CancellationToken
  ): Promise<LanguageModelChatInformation[]>;

  provideLanguageModelChatResponse(
    model: LanguageModelChatInformation,
    messages: readonly LanguageModelChatMessage[],
    options: ProvideLanguageModelChatResponseOptions,
    progress: Progress<LanguageModelResponsePart>,
    token: CancellationToken
  ): Promise<void>;

  provideTokenCount(
    model: LanguageModelChatInformation,
    text: string | LanguageModelChatMessage,
    token: CancellationToken
  ): Promise<number>;
}

interface LanguageModelChatInformation {
  id: string;
  name: string;
  family: string;
  version: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  tooltip?: string;
  detail?: string;
  capabilities: {
    imageInput?: boolean;
    toolCalling?: boolean;
  };
}
```

## File System Watcher
```typescript
const watcher = vscode.workspace.createFileSystemWatcher(authPath);
watcher.onDidChange(() => callback());
context.subscriptions.push(watcher);
```
