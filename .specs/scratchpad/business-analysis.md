# Business Analysis: 3 Multi-Provider Refactor

## User Personas

### Persona 1: Zen-Only User
- Has OpenCode Zen subscription
- Uses premium models (GPT, Claude, Gemini)
- May have OpenCode installed locally
- **Key concern**: Will free models disappear from Zen? Answer: They go to separate `opencode-free` provider.

### Persona 2: Go-Only User
- Has OpenCode Go subscription ($5-$10/month)
- Uses open-source models (GLM, Kimi, DeepSeek)
- **Key concern**: Will models work correctly? Answer: Yes, correct endpoint `/go/v1/`.

### Persona 3: Both Subscriptions
- Has both Zen and Go
- Wants all models available
- **Key concern**: Model duplication? Answer: Each provider shows its own; same model may appear in both if in both APIs.

### Persona 4: Local OpenCode User
- Has OpenCode CLI installed
- Has API keys in `auth.json`
- **Key concern**: Manual configuration? Answer: Auto-detected with FileSystemWatcher.

## User Journeys

### Journey 1: First-time Zen User
1. Install extension
2. Extension activates, shows no providers
3. User opens Command Palette → "Configure OpenCode Zen"
4. Enters Zen API key
5. Extension validates and fetches models
6. Models appear in Copilot model picker
7. **Acceptance**: No errors, models visible in <5s

### Journey 2: First-time Go User
1. Install extension
2. Extension activates, shows no providers
3. User opens Command Palette → "Configure OpenCode Go"
4. Enters Go API key
5. Extension validates and fetches models
6. Models appear in Copilot model picker
7. **Acceptance**: No HTTP 500, models work in chat

### Journey 3: Local OpenCode User
1. Install extension (with OpenCode already installed)
2. Extension reads `auth.json`
3. Detects both zen and go keys
4. Shows prompt: "Use local API keys?"
5. User accepts
6. Keys auto-populated
7. Both providers active
8. **Acceptance**: Prompt appears only if new keys, no spam

### Journey 4: Adding New Key
1. User adds new key to `auth.json` manually
2. FileSystemWatcher detects change
3. Extension prompts: "New key detected, use it?"
4. User accepts
5. Key saved to SecretStorage
6. **Acceptance**: Prompt fires only on actual change

## Edge Cases

| Case | Expected Behavior |
|------|-------------------|
| API key invalid | Show error, don't show models |
| API rate limit | Show error, suggest retry |
| Network failure | Show error, retry button |
| No models returned | Show empty list, log warning |
| auth.json malformed | Skip silently, use SecretStorage |
| auth.json missing | Use SecretStorage only |
| FileSystemWatcher permission denied | Fall back to polling or disable |
| Models endpoint returns 500 | Show error in status bar |
| Same model in Zen and Go | Appears in both providers (correct) |
| User configures Zen but not Go | Only `opencode-zen` and `opencode-free` visible |
| User configures Go but not Zen | Only `opencode-go` visible (Go has its own key) |

## Error Scenarios

### ES1: API Connection Failure
- **Trigger**: Network down or API down
- **Expected**: Status bar shows error, webview shows "Connection failed"
- **Recovery**: User clicks retry, status bar updates

### ES2: Invalid API Key
- **Trigger**: Key revoked or malformed
- **Expected**: Status bar shows "Auth error", webview shows error
- **Recovery**: User configures new key

### ES3: Model Not Found
- **Trigger**: Model ID in chat doesn't exist
- **Expected**: Error in chat, suggest similar models
- **Recovery**: User selects different model

### ES4: Local File Deleted
- **Trigger**: `auth.json` deleted during runtime
- **Trigger**: User uninstalls OpenCode
- **Expected**: Watcher detects, no error
- **Recovery**: Fall back to SecretStorage

## Performance Expectations
- Model fetch: <5s for 50 models
- Status bar update: <100ms
- Webview render: <200ms
- FileSystemWatcher: <1s latency
- Cache TTL: 5 minutes for models, 1 minute for usage

## UX Requirements

### Commands
- `OpenCode Zen: Configure Zen` - Set Zen key
- `OpenCode Zen: Configure Go` - Set Go key
- `OpenCode Zen: Refresh All` - Refresh all 3 providers
- `OpenCode Zen: Show Usage` - Open webview
- `OpenCode Zen: Clear Usage` - Reset stats

### Status Bar
- Single icon showing overall health
- Tooltip with all 3 providers status
- Click opens usage webview

### Webview Sections (in order)
1. **API Keys**: Masked display, edit/clear buttons
2. **Account Balance**: Zen + Go if available
3. **Session Stats**: Requests, tokens (prompt/output)
4. **By Provider**: Breakdown by Zen/Go/Free
5. **By Model**: Top 10 by usage
6. **Recent Requests**: Last 20 with timestamps
7. **Actions**: Refresh, Clear, Export CSV

### Prompts (only when needed)
- Local OpenCode detected: "Use local keys?" (Yes/No)
- New key added: "Use this new key?" (Yes/No)
- API failure: Show error in status bar (no modal)

## Out of Scope (Confirmed)
- BYOK for individual models
- Model fine-tuning
- Custom model addition
- Go rate-limit UI (only if endpoint available)
- Webview model management
- Auto-update extension

## Success Metrics
- 0 hardcoded models in source
- 3 providers register successfully
- All 4 user journeys complete without error
- FileSystemWatcher fires within 1s of change
- Webview updates within 200ms of usage change
- Build passes with 0 TypeScript errors
- Extension package size <100kb
