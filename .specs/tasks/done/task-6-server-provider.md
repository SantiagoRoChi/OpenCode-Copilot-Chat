# Task 6: Rewrite OpenCodeServerProvider

## Status: pending
## Depends On: none (independent)
## Parallel With: Task 1, Task 2, Task 7

## Objective

Fix `src/providers/OpenCodeServerProvider.ts` — the local server provider is completely broken due to incorrect `streamResponse()` call signature and missing auth headers.

## Input

- Current `src/providers/OpenCodeServerProvider.ts` — broken code
- Current `src/client/multiServerManager.ts` — `ServerApiClient` with private `buildHeaders()`
- Current `src/streaming/responseStreamer.ts` — correct `streamResponse()` signature
- OpenCode server docs: `POST /chat` accepts OpenAI-compatible format

## Output

Modify files:
- `src/providers/OpenCodeServerProvider.ts` — rewrite chat response handling
- `src/client/multiServerManager.ts` — make `buildHeaders()` public

## Specification

### Bug 1: streamResponse call signature (line 284)

```typescript
// BEFORE (BROKEN):
const result = await streamResponse(
  response,        // ← This is a Response object, not ReadableStream<ChatCompletionChunk>
  progress,        // ← Wrong parameter
  token,           // ← Wrong parameter
  (part) => { ... } // ← Wrong parameter
);

// AFTER (CORRECT):
// The local server uses POST /chat which returns OpenAI-compatible SSE
// Parse the Response body as SSE, create ReadableStream<ChatCompletionChunk>,
// then use streamResponse() with the correct StreamOptions interface

const reader = response.body?.getReader();
if (!reader) throw new Error('No response body');

// Parse SSE from the response
const chunks = this.parseSSEStream(reader);
const reporter = this.createStreamReporter(requestId, progress, token);

const result = await streamResponse({
  chunks,
  reporter,
  isCancelled: () => token.isCancellationRequested,
  resolveToolCallArgs: (tc) => resolveToolCallArgs(tc, schemas),
});
```

### Bug 2: buildHeaders is private (line 272)

```typescript
// BEFORE (BROKEN):
headers: {
  'Content-Type': 'application/json',
  ...(this.serverClient as any).buildHeaders?.() || {},  // ← Always undefined
},

// FIX OPTION A: Make buildHeaders public in ServerApiClient
// In multiServerManager.ts, change:
private buildHeaders(): HeadersInit { ... }
// To:
public buildHeaders(): HeadersInit { ... }

// Then in OpenCodeServerProvider:
headers: {
  ...this.serverClient.buildHeaders(),
},
```

### Bug 3: CancellationToken to AbortSignal (line 275)

```typescript
// BEFORE (may not work):
signal: token ? (token as any) : undefined,

// AFTER (correct bridge):
const abortController = new AbortController();
token.onCancellationRequested(() => abortController.abort());
signal: abortController.signal,
```

### Full rewrite of provideLanguageModelChatResponse

```typescript
async provideLanguageModelChatResponse(
  model: vscode.LanguageModelChatInformation,
  messages: readonly vscode.LanguageModelChatMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions,
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  token: vscode.CancellationToken
): Promise<void> {
  // 1. Image check (keep existing)
  // 2. Convert messages using BaseOpenCodeProvider's convertAllMessages pattern
  // 3. Build request body (OpenAI-compatible format for /chat endpoint)
  // 4. Send POST to {baseUrl}/chat with proper auth headers
  // 5. Parse SSE response into ReadableStream<ChatCompletionChunk>
  // 6. Use streamResponse() with correct StreamOptions
  // 7. Record usage and fire events
}
```

## Validation

```bash
# Must compile
cd F:\accuro-ias\opencode-chat\opencode-zen-copilot && npm run esbuild 2>&1 | tail -5

# buildHeaders must be public
grep -n "public buildHeaders\|private buildHeaders" src/client/multiServerManager.ts

# streamResponse must use StreamOptions interface
grep -n "streamResponse({" src/providers/OpenCodeServerProvider.ts

# No more (this.serverClient as any) hacks
grep -n "as any" src/providers/OpenCodeServerProvider.ts | head -5
```

## Acceptance Criteria

- [ ] `streamResponse()` called with `StreamOptions` object (not positional args)
- [ ] `buildHeaders()` is `public` in `ServerApiClient`
- [ ] Auth headers sent correctly for local server requests
- [ ] CancellationToken properly bridged to AbortSignal
- [ ] SSE response parsed into `ReadableStream<ChatCompletionChunk>`
- [ ] No `(this.serverClient as any)` hacks
- [ ] Build succeeds with `npm run esbuild`
- [ ] All validation bash commands pass
