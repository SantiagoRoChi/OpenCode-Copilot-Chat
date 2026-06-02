# Task 5: Refactor BaseOpenCodeProvider

## Status: pending
## Depends On: Task 1 (modelRegistry), Task 2 (apiClient), Task 3 (anthropicAdapter), Task 4 (responsesAdapter)
## Parallel With: none (sequential)

## Objective

Modify `src/providers/BaseOpenCodeProvider.ts` to use the model registry for real capabilities and delegate to the correct adapter based on model's API format.

## Input

- Task 1: `src/client/modelRegistry.ts` — `getModelEndpoint()`, `getModelCapabilities()`
- Task 2: `src/client/openCodeApiClient.ts` — `OpenCodeApiClient`
- Task 3: `src/streaming/anthropicAdapter.ts` — `toAnthropicMessages()`, `streamAnthropicResponse()`
- Task 4: `src/streaming/openaiResponsesAdapter.ts` — `toResponsesRequest()`, `streamResponsesResponse()`
- Current `src/providers/BaseOpenCodeProvider.ts` — to be modified

## Output

Modify file: `src/providers/BaseOpenCodeProvider.ts`

## Specification

### Changes to `toModelInfo()` (lines 166-176)

```typescript
// BEFORE (hardcoded):
protected toModelInfo(m: ApiModel): ModelInfo {
  return {
    id: m.id,
    name: m.id,
    family: this.inferFamily(m.id),
    maxInputTokens: 131072,
    maxOutputTokens: 32000,
    contextLabel: '128K ctx',
    capabilityLabels: ['tools'],
  };
}

// AFTER (from registry):
protected toModelInfo(m: ApiModel): ModelInfo {
  const caps = getModelCapabilities(m.id);
  return {
    id: m.id,
    name: caps.name,
    family: caps.family,
    maxInputTokens: caps.maxInputTokens,
    maxOutputTokens: caps.maxOutputTokens,
    contextLabel: `${Math.round(caps.maxInputTokens / 1024)}K ctx`,
    capabilityLabels: [
      ...(caps.toolCalling ? ['tools'] : []),
      ...(caps.imageInput ? ['vision'] : []),
      ...(caps.reasoning ? ['reasoning'] : []),
    ],
  };
}
```

### Changes to `toChatInformation()` (lines 178-193)

```typescript
// BEFORE (hardcoded capabilities):
capabilities: {
  imageInput: false,
  toolCalling: true,
}

// AFTER (from registry):
protected toChatInformation(m: ApiModel, info: ModelInfo): vscode.LanguageModelChatInformation {
  const caps = getModelCapabilities(m.id);
  return {
    id: m.id,
    name: m.id,
    family: info.family,
    version: m.id,
    maxInputTokens: info.maxInputTokens,
    maxOutputTokens: info.maxOutputTokens,
    tooltip: `${info.name}\n\nContext: ${info.contextLabel}\n\nModel from ${this.displayName}`,
    detail: `${info.contextLabel} · ${this.displayName}`,
    capabilities: {
      imageInput: caps.imageInput,
      toolCalling: caps.toolCalling,
    },
  };
}
```

### Changes to `provideLanguageModelChatResponse()` (lines 234-359)

Replace the streaming section to use adapters:

```typescript
// AFTER: Use OpenCodeApiClient with correct format
async provideLanguageModelChatResponse(
  model: vscode.LanguageModelChatInformation,
  messages: readonly vscode.LanguageModelChatMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions,
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  token: vscode.CancellationToken
): Promise<void> {
  // ... existing image detection code ...

  const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const modelName = this.modelInfoMap.get(model.id)?.name ?? model.id;
  const endpoint = getModelEndpoint(this.providerType, model.id);

  // Build messages using correct adapter
  let requestBody: any;
  if (endpoint.apiFormat === 'anthropic') {
    requestBody = toAnthropicMessages(messages, model.id);
  } else if (endpoint.apiFormat === 'openai') {
    requestBody = toResponsesRequest(messages, model.id, model.maxOutputTokens || 32000);
  } else {
    // openai-compatible: use existing convertAllMessages
    requestBody = {
      model: model.id,
      messages: this.convertAllMessages(messages),
      max_tokens: safeMaxOutputTokens,
      temperature,
      stream: true,
      ...(hasTools && { tools, tool_choice: this.mapToolChoice(options.toolMode) }),
    };
  }

  // Stream using OpenCodeApiClient
  const apiClient = new OpenCodeApiClient(this.endpoint, this.apiKey);
  const abortController = new AbortController();
  token.onCancellationRequested(() => abortController.abort());

  await apiClient.streamChat(
    requestBody,
    endpoint,
    abortController.signal,
    {
      onText: (text) => progress.report(new vscode.LanguageModelTextPart(text)),
      onThinking: (text) => { /* handle thinking */ },
      onThinkingDone: () => { /* handle thinking done */ },
      onToolCall: (id, name, args) => progress.report(new vscode.LanguageModelToolCallPart(id, name, args)),
      onUsage: (usage) => { /* record usage */ },
      onError: (err) => { throw err; },
      onDone: () => { /* record completed request */ },
    }
  );
}
```

### Remove `OpenCodeClient` dependency

The `this.client` (OpenCodeClient) is no longer needed for chat. Keep it only for `listModels()` and `getUsage()`.

## Validation

```bash
# Must compile
cd F:\accuro-ias\opencode-chat\opencode-zen-copilot && npm run esbuild 2>&1 | tail -5

# Must import modelRegistry
grep -n "getModelEndpoint\|getModelCapabilities" src/providers/BaseOpenCodeProvider.ts | head -5

# Must use OpenCodeApiClient for streaming
grep -n "OpenCodeApiClient\|streamChat" src/providers/BaseOpenCodeProvider.ts | head -5

# Must use adapters for anthropic/responses formats
grep -n "toAnthropicMessages\|toResponsesRequest" src/providers/BaseOpenCodeProvider.ts | head -5
```

## Acceptance Criteria

- [ ] `toModelInfo()` uses `getModelCapabilities()` instead of hardcoded values
- [ ] `toChatInformation()` uses real `imageInput` and `toolCalling` from registry
- [ ] `provideLanguageModelChatResponse()` routes to correct adapter by `apiFormat`
- [ ] Anthropic models use `toAnthropicMessages()` + `streamAnthropicResponse()`
- [ ] GPT models use `toResponsesRequest()` + `streamResponsesResponse()`
- [ ] OpenAI-compatible models use existing `convertAllMessages()` + SSE parsing
- [ ] `OpenCodeClient` removed from chat flow (kept for model listing)
- [ ] Build succeeds with `npm run esbuild`
- [ ] All validation bash commands pass
