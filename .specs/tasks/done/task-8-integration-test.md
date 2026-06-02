# Task 8: Integration Testing

## Status: pending
## Depends On: Task 1, Task 2, Task 3, Task 4, Task 5, Task 6, Task 7
## Parallel With: none (final step)

## Objective

Verify the complete integration works end-to-end: models appear in Language Models view, chat requests succeed for each API format, and the server provider works.

## Input

- All previous tasks completed
- Running OpenCode server at `http://127.0.0.1:4096` (optional, for server testing)
- Zen/Go API keys configured

## Output

- Verification report in `.specs/reports/task-8-integration-{date}.md`

## Test Matrix

### Test 1: Models Appear in Language Models View

```bash
# Build extension
cd F:\accuro-ias\opencode-chat\opencode-zen-copilot && npm run esbuild

# Check that extension activates without errors
# (Reload VS Code window, check output panel)
```

**Expected**: All configured providers (OpenCode Free, OpenCode Go, OpenCode Zen) appear in Language Models view with correct model counts.

### Test 2: Chat Completions Format (OpenAI-compatible)

Select a model that uses Chat Completions:
- **Zen**: `kimi-k2.6`, `deepseek-v4-flash`, `glm-5.1`
- **Go**: `kimi-k2.6`, `deepseek-v4-flash`, `mimo-v2.5`

**Test prompt**: "What is 2+2? Reply with just the number."

**Expected**: Response received, no "Sorry, no response was returned" error.

### Test 3: Responses API Format (OpenAI)

Select a model that uses Responses API:
- **Zen**: `gpt-5.4`, `gpt-5.4-mini`, `gpt-5-nano`

**Test prompt**: "What is 2+2? Reply with just the number."

**Expected**: Response received via Responses API endpoint.

### Test 4: Messages API Format (Anthropic)

Select a model that uses Messages API:
- **Zen**: `claude-sonnet-4-6`, `claude-haiku-4-5`
- **Go**: `qwen3.7-max`, `minimax-m3`

**Test prompt**: "What is 2+2? Reply with just the number."

**Expected**: Response received via Messages API endpoint.

### Test 5: Server Provider

If local server is running at `http://127.0.0.1:4096`:

**Test prompt**: "Hello"

**Expected**: Response received from local server.

### Test 6: Tool Calling

Select any model with `toolCalling: true`:

**Test prompt**: "List the files in the current directory"

**Expected**: Model attempts to use a tool (may not have tools available in chat, but shouldn't error).

### Test 7: Reasoning Content

Select a model with `reasoning: true` (GPT, Claude, Gemini, DeepSeek):

**Test prompt**: "Think step by step: what is the capital of France?"

**Expected**: Model responds (reasoning content may or may not be visible depending on how VS Code displays it).

## Validation Script

```bash
# Build check
cd F:\accuro-ias\opencode-chat\opencode-zen-copilot && npm run esbuild 2>&1 | tail -3

# No TypeScript errors
npx tsc --noEmit 2>&1 | head -10

# All required files exist
for f in \
  src/client/modelRegistry.ts \
  src/client/openCodeApiClient.ts \
  src/streaming/anthropicAdapter.ts \
  src/streaming/openaiResponsesAdapter.ts; do
  [ -f "$f" ] && echo "OK: $f" || echo "MISSING: $f"
done

# modelRegistry has all expected exports
node -e "
  const m = require('./out/client/modelRegistry');
  const checks = [
    typeof m.getModelEndpoint === 'function',
    typeof m.getModelCapabilities === 'function',
    typeof m.getModelRegistration === 'function',
  ];
  console.log(checks.every(c => c) ? 'PASS: exports' : 'FAIL: exports');
"

# Spot-check endpoint routing
node -e "
  const m = require('./out/client/modelRegistry');
  const tests = [
    [m.getModelEndpoint('zen', 'gpt-5.5').apiFormat, 'openai', 'GPT format'],
    [m.getModelEndpoint('zen', 'claude-sonnet-4-6').apiFormat, 'anthropic', 'Claude format'],
    [m.getModelEndpoint('zen', 'kimi-k2.6').apiFormat, 'openai-compatible', 'Kimi format'],
    [m.getModelEndpoint('go', 'minimax-m3').apiFormat, 'anthropic', 'Go MiniMax format'],
    [m.getModelEndpoint('go', 'kimi-k2.6').apiFormat, 'openai-compatible', 'Go Kimi format'],
  ];
  tests.forEach(([actual, expected, name]) => {
    console.log(actual === expected ? 'PASS: ' + name : 'FAIL: ' + name + ' got ' + actual);
  });
"
```

## Acceptance Criteria

- [ ] Extension builds without errors
- [ ] All models from Zen/Go appear in Language Models view
- [ ] Chat Completions models (Kimi, DeepSeek, GLM) respond correctly
- [ ] Responses API models (GPT 5.x) respond correctly
- [ ] Messages API models (Claude, Qwen, MiniMax) respond correctly
- [ ] Server provider responds correctly (if server running)
- [ ] Tool calling doesn't crash (may not have tools available)
- [ ] Reasoning models don't crash
- [ ] No "Sorry, no response was returned" errors
- [ ] No "This model does not support image input" false positives
- [ ] All validation bash commands pass
- [ ] Verification report written to `.specs/reports/`
