# Shared Context: OpenCode Zen Copilot Extension

## Codebase Structure

```
src/
├── client/
│   ├── endpoints.ts          # ZEN_BASE_URL, GO_BASE_URL constants
│   ├── opencodeClient.ts     # HTTP client for model listing + chat completions
│   ├── types.ts              # All TypeScript types
│   ├── multiServerManager.ts # Server connection management
│   └── modelRegistry.ts      # [TASK 1] NEW: Model capabilities + endpoints
├── providers/
│   ├── BaseOpenCodeProvider.ts  # [TASK 5] MODIFY: Use registry + adapters
│   ├── OpenCodeFreeProvider.ts  # vendor: opencode-free, endpoint: ZEN_BASE_URL
│   ├── OpenCodeGoProvider.ts    # vendor: opencode-go, endpoint: GO_BASE_URL
│   ├── OpenCodeZenProvider.ts   # vendor: opencode-zen, endpoint: ZEN_BASE_URL
│   └── OpenCodeServerProvider.ts # [TASK 6] MODIFY: Fix streamResponse + auth
├── streaming/
│   ├── responseStreamer.ts    # StreamOptions, StreamReporter, streamResponse()
│   ├── messageConverter.ts   # convertMessage(), NormalizedMessage
│   ├── anthropicAdapter.ts   # [TASK 3] NEW: Messages API adapter
│   └── openaiResponsesAdapter.ts # [TASK 4] NEW: Responses API adapter
├── tools/
│   └── toolCallAdapter.ts    # resolveToolCallArgs()
├── usage/
│   └── UsageTracker.ts       # Request/token tracking
├── config/
│   └── secretStorage.ts      # API key storage
├── integration/
│   └── opencodeConnector.ts  # Local OpenCode CLI detection
├── treeview/
│   └── openCodeTreeProvider.ts # Sidebar TreeView
└── extension.ts              # Entry point, provider registration
```

## Provider Registration Flow (extension.ts)

```typescript
// 1. Create providers
freeProvider = new OpenCodeFreeProvider(context);
goProvider = new OpenCodeGoProvider(context);
zenProvider = new OpenCodeZenProvider(context);

// 2. Register with VS Code LM API
vscode.lm.registerLanguageModelChatProvider('opencode-free', freeProvider);
vscode.lm.registerLanguageModelChatProvider('opencode-go', goProvider);
vscode.lm.registerLanguageModelChatProvider('opencode-zen', zenProvider);

// 3. Server providers (dynamic vendor IDs)
for (const conn of serverManager.getConnectedList()) {
  const vendorId = `opencode-server-${conn.config.id}`;
  const provider = new OpenCodeServerProvider(context, ...);
  vscode.lm.registerLanguageModelChatProvider(vendorId, provider);
}
```

## Key Interfaces

### LanguageModelChatProvider (VS Code API)

```typescript
interface LanguageModelChatProvider {
  onDidChangeLanguageModelChatInformation?: Event<void>;
  provideLanguageModelChatInformation(options, token): ProviderResult<LanguageModelChatInformation[]>;
  provideLanguageModelChatResponse(model, messages, options, progress, token): Thenable<void>;
  provideTokenCount(model, text, token): Thenable<number>;
}
```

### LanguageModelChatInformation

```typescript
interface LanguageModelChatInformation {
  id: string;                    // Model ID (e.g., 'kimi-k2.6')
  name: string;                  // Display name
  family: string;                // Family (e.g., 'kimi', 'openai')
  version: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  tooltip?: string;
  detail?: string;
  capabilities: {
    imageInput?: boolean;
    toolCalling?: boolean | number;
  };
}
```

### StreamOptions (responseStreamer.ts)

```typescript
interface StreamOptions {
  chunks: ReadableStream<ChatCompletionChunk>;
  reporter: StreamReporter;
  isCancelled: () => boolean;
  resolveToolCallArgs: (toolCall: ToolCall) => Record<string, unknown>;
}
```

## OpenCode API Formats

### Chat Completions (`/chat/completions`)
- Standard OpenAI SSE format
- `data: {"choices":[{"delta":{"content":"text"}}]}` lines
- `data: [DONE]` terminator
- Used by: Kimi, DeepSeek, GLM, MiMo, Grok, Big Pickle

### Responses API (`/responses`)
- OpenAI newer format
- `data: {"type":"response.output_text.delta","delta":"text"}` events
- Used by: GPT 5.x, GPT 5 Nano

### Messages API (`/messages`)
- Anthropic format
- `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"text"}}` events
- System messages separate from message array
- Used by: Claude, Qwen (Go), MiniMax (Go)

### Google API (`/models/{id}`)
- Gemini format
- `{"candidates":[{"content":{"parts":[{"text":"text"}]}}]}` response
- Used by: Gemini 3.5 Flash, 3.1 Pro, 3 Flash

## OpenCode Server API

```
POST /chat              # OpenAI-compatible chat completions
GET  /provider          # List all providers + models
GET  /global/health     # Health check
GET  /session           # List sessions
POST /session/:id/message  # Send message to session
```

Auth: Basic auth via `OPENCODE_SERVER_PASSWORD` env var.
