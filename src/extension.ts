import { ExtensionContext, window, workspace, lm, commands, QuickPickItem, Disposable } from 'vscode';
import { OpenCodeFreeProvider } from './providers/OpenCodeFreeProvider';
import { OpenCodeGoProvider } from './providers/OpenCodeGoProvider';
import { OpenCodeZenProvider } from './providers/OpenCodeZenProvider';
import { OpenCodeServerProvider } from './providers/OpenCodeServerProvider';
import { LMStudioProvider } from './providers/LMStudioProvider';
import { OllamaProvider } from './providers/OllamaProvider';
import { OpenCodeConnector } from './integration/opencodeConnector';
import { SecretStorage } from './config/secretStorage';
import { MultiServerManager, initMultiServerManager } from './client/multiServerManager';
import { OpenCodeSubagentTool } from './tools/subagentTool';
import { registerOpenCodeChatParticipant, ProviderEntry, setContextManager } from './chat/participant';
import { ContextManager } from './context/contextManager';
import { DiagnosticsProvider } from './context/diagnosticsProvider';
import { ScmProvider } from './context/scmProvider';
import { WorkspaceSearchProvider } from './context/workspaceSearch';
import { SystemPromptProvider } from './providers/SystemPromptProvider';
import { OpenCodeUsageService } from './integration/openCodeUsageService';
import { OpenCodeAuthService } from './integration/openCodeAuthService';
import { initModelRegistry } from './client/modelRegistry';
import { UsageTracker } from './usage/UsageTracker';
import { InfrastructureTreeProvider } from './treeview/infrastructureProvider';
import { KpisTreeProvider } from './treeview/kpisProvider';
import { randomUUID } from 'crypto';

let freeProvider: OpenCodeFreeProvider;
let goProvider: OpenCodeGoProvider;
let zenProvider: OpenCodeZenProvider;
let serverProvider: OpenCodeServerProvider;
let lmStudioProvider: LMStudioProvider;
let ollamaProvider: OllamaProvider;
let usageTracker: UsageTracker;
let infraProvider: InfrastructureTreeProvider;
let kpisProvider: KpisTreeProvider;
let connector: OpenCodeConnector;
let secretStorage: SecretStorage;
let serverManager: MultiServerManager;

export async function activate(context: ExtensionContext): Promise<void> {
  console.log('+ Providers: activating...');

  // ── Initialize services ─────────────────────────────────────────────────
  OpenCodeAuthService.init(context);

  // Fetch model capabilities (context sizes, vision, reasoning) from models.dev
  // Uses persistent cache for instant startup; refreshes in background if stale
  await initModelRegistry(context);

  // ── Context Providers ──────────────────────────────────────────────────────
  const contextManager = new ContextManager();
  const diagProvider = new DiagnosticsProvider();
  const scmProvider = new ScmProvider();
  const wsSearchProvider = new WorkspaceSearchProvider();
  contextManager.addProvider(diagProvider);
  contextManager.addProvider(scmProvider);
  contextManager.addProvider(wsSearchProvider);
  context.subscriptions.push({ dispose: () => contextManager.dispose() });
  setContextManager(contextManager);

  // ── Providers ────────────────────────────────────────────────────────────

  freeProvider = new OpenCodeFreeProvider(context);
  goProvider   = new OpenCodeGoProvider(context);
  zenProvider  = new OpenCodeZenProvider(context);

  await Promise.all([
    freeProvider.loadApiKey(),
    goProvider.loadApiKey(),
    zenProvider.loadApiKey(),
  ]);

  // Trigger initial model fetch after loading API keys
  setTimeout(() => {
    if (zenProvider.getApiKey()) { zenProvider.refreshModels(); }
    if (goProvider.getApiKey()) { goProvider.refreshModels(); }
    if (freeProvider.getApiKey()) { freeProvider.refreshModels(); }
    void refreshViews();
  }, 1000);

  // ── OpenCode local key auto-detection ─────────────────────────────────────

  connector = new OpenCodeConnector(window.createOutputChannel('OpenCode Connector'));
  secretStorage = new SecretStorage(context);
  connector.watchAuthFile(context);
  context.subscriptions.push(connector);

  if (await connector.hasLocalKeys()) {
    const choice = await window.showInformationMessage(
      'OpenCode local installation detected. Use local API keys?',
      'Yes', 'No'
    );
    if (choice === 'Yes') {
      const localKeys = await connector.getLocalKeys();
      if (localKeys.zenKey) {
        await zenProvider.setApiKey(localKeys.zenKey);
        await freeProvider.setApiKey(localKeys.zenKey);
      }
      if (localKeys.goKey) {
        await goProvider.setApiKey(localKeys.goKey);
      }
      window.showInformationMessage('+ Providers: Local API keys loaded.');
    }
  }

  context.subscriptions.push(
    connector.onDidChangeLocalKeys(async (newKeys) => {
      const choice = await window.showInformationMessage(
        'New API keys detected in local OpenCode installation. Use them?',
        'Yes', 'No'
      );
      if (choice === 'Yes') {
        if (newKeys.zenKey) {
          await zenProvider.setApiKey(newKeys.zenKey);
          await freeProvider.setApiKey(newKeys.zenKey);
        }
        if (newKeys.goKey) {
          await goProvider.setApiKey(newKeys.goKey);
        }
        window.showInformationMessage('+ Providers: New API keys loaded.');
        void refreshViews();
      }
    })
  );

  // ── OpenCode Servers ──────────────────────────────────────────────────────

  serverManager = await initMultiServerManager(secretStorage);
  serverProvider = new OpenCodeServerProvider();

  syncServerProviderFromManager();

  // ── LM Studio + Ollama (parallel initialization) ─────────────────────────

  lmStudioProvider = new LMStudioProvider(secretStorage);
  ollamaProvider = new OllamaProvider(secretStorage);

  await Promise.all([
    lmStudioProvider.loadPersistedServers(),
    ollamaProvider.loadPersistedServers(),
  ]);

  // Parallel health checks for auto-detection
  await Promise.all([
    (async () => {
      if (lmStudioProvider.getServerList().length === 0) {
        try {
          const lmUrl = workspace.getConfiguration('lmstudio').get<string>('baseUrl') || 'http://localhost:1234';
          const health = await fetch(`${lmUrl}/v1/models`, { signal: AbortSignal.timeout(3000) });
          if (health.ok) {
            lmStudioProvider.addServer('local', 'Local LM Studio', lmUrl);
            console.log(`+ Providers: LM Studio connected at ${lmUrl}`);
          }
        } catch { /* not running */ }
      } else {
        console.log(`+ Providers: LM Studio loaded ${lmStudioProvider.getServerList().length} persisted server(s).`);
      }
    })(),
    (async () => {
      if (ollamaProvider.getServerList().length === 0) {
        try {
          const ollamaUrl = workspace.getConfiguration('ollama').get<string>('baseUrl') || 'http://localhost:11434';
          const health = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
          if (health.ok) {
            ollamaProvider.addServer('local', 'Local Ollama', ollamaUrl);
            console.log(`+ Providers: Ollama connected at ${ollamaUrl}`);
          }
        } catch { /* not running */ }
      } else {
        console.log(`+ Providers: Ollama loaded ${ollamaProvider.getServerList().length} persisted server(s).`);
      }
    })(),
  ]);

  // ── Wrap providers with system prompt interceptor ─────────────────────────
  const wrappedFree = new SystemPromptProvider(freeProvider);
  const wrappedGo = new SystemPromptProvider(goProvider);
  const wrappedZen = new SystemPromptProvider(zenProvider);
  const wrappedServer = new SystemPromptProvider(serverProvider);
  const wrappedLMStudio = new SystemPromptProvider(lmStudioProvider);
  const wrappedOllama = new SystemPromptProvider(ollamaProvider);

  const wrappedDisposables: Disposable[] = [
    wrappedFree, wrappedGo, wrappedZen, wrappedServer, wrappedLMStudio, wrappedOllama,
  ];

  // ── Register providers with VS Code LM API ────────────────────────────────

  context.subscriptions.push(
    lm.registerLanguageModelChatProvider('opencode-free',   wrappedFree),
    lm.registerLanguageModelChatProvider('opencode-go',     wrappedGo),
    lm.registerLanguageModelChatProvider('opencode-zen',    wrappedZen),
    lm.registerLanguageModelChatProvider('opencode-server', wrappedServer),
    lm.registerLanguageModelChatProvider('lmstudio',        wrappedLMStudio),
    lm.registerLanguageModelChatProvider('ollama-plus',     wrappedOllama),
    freeProvider, goProvider, zenProvider, serverProvider, lmStudioProvider, ollamaProvider,
    ...wrappedDisposables,
  );

  // ── Agent Window providers (for Copilot CLI / Agents Window) ──────────────
  const enableAgentWindow = workspace.getConfiguration('opencode-zen').get<boolean>('enableAgentWindow', true);

  if (enableAgentWindow) {
    const agentZenProvider = new OpenCodeZenProvider(context);
    const agentGoProvider = new OpenCodeGoProvider(context);
    const agentFreeProvider = new OpenCodeFreeProvider(context);

    await agentZenProvider.setApiKey(zenProvider.getApiKey());
    await agentGoProvider.setApiKey(goProvider.getApiKey());
    await agentFreeProvider.setApiKey(freeProvider.getApiKey());

    const wrappedAgentZen = new SystemPromptProvider(agentZenProvider);
    const wrappedAgentGo = new SystemPromptProvider(agentGoProvider);
    const wrappedAgentFree = new SystemPromptProvider(agentFreeProvider);

    context.subscriptions.push(
      lm.registerLanguageModelChatProvider('opencode-zen-agent',    wrappedAgentZen),
      lm.registerLanguageModelChatProvider('opencode-go-agent',     wrappedAgentGo),
      lm.registerLanguageModelChatProvider('opencode-free-agent',   wrappedAgentFree),
      agentZenProvider, agentGoProvider, agentFreeProvider,
      wrappedAgentZen, wrappedAgentGo, wrappedAgentFree,
    );

    // Sync API keys when main providers change
    context.subscriptions.push(
      zenProvider.onDidChangeLanguageModelChatInformation(() => {
        void agentZenProvider.setApiKey(zenProvider.getApiKey());
      }),
      goProvider.onDidChangeLanguageModelChatInformation(() => {
        void agentGoProvider.setApiKey(goProvider.getApiKey());
      }),
      freeProvider.onDidChangeLanguageModelChatInformation(() => {
        void agentFreeProvider.setApiKey(freeProvider.getApiKey());
      }),
    );

    console.log('[OpenCode] Agent Window providers registered (opencode-*-agent)');
  }

  // ── Subagent tool ─────────────────────────────────────────────────────────

  const subagentTool = new OpenCodeSubagentTool();
  OpenCodeSubagentTool.registerProvider('opencode-free', freeProvider);
  OpenCodeSubagentTool.registerProvider('opencode-go',   goProvider);
  OpenCodeSubagentTool.registerProvider('opencode-zen',  zenProvider);
  context.subscriptions.push(lm.registerTool(OpenCodeSubagentTool.toolName, subagentTool));

  // ── Chat participant (@opencode) ──────────────────────────────────────────
  const chatParticipant = registerOpenCodeChatParticipant(context, [
    { vendor: 'opencode-zen', displayName: 'OpenCode Zen', provider: wrappedZen },
    { vendor: 'opencode-go', displayName: 'OpenCode Go', provider: wrappedGo },
    { vendor: 'opencode-free', displayName: 'OpenCode Free', provider: wrappedFree },
    { vendor: 'lmstudio', displayName: 'LM Studio', provider: wrappedLMStudio },
    { vendor: 'ollama-plus', displayName: 'Ollama+', provider: wrappedOllama },
  ]);
  context.subscriptions.push(chatParticipant);

  // ── Usage tracking ────────────────────────────────────────────────────────

  usageTracker = new UsageTracker();
  usageTracker.onDidChangeUsage(() => {
    void refreshViews();
  });
  context.subscriptions.push(usageTracker);

  // ── OpenCode API Usage Service ───────────────────────────────────────────
  const openCodeUsageService = OpenCodeUsageService.getInstance();
  openCodeUsageService.onDidChangeUsage(() => {
    void refreshViews();
  });
  context.subscriptions.push(openCodeUsageService);

  // Generate a consistent session ID for this extension activation
  const sessionId = randomUUID();
  let requestCounter = 0;

  // Connect provider usage callbacks
  freeProvider.setOnUsageCallback(usage => {
    requestCounter++;
    usageTracker.recordRequest(
      `req-${sessionId}-${requestCounter}`,
      sessionId,
      'free-model',
      'Free Model',
      'opencode-free',
      { prompt: usage.prompt, completion: usage.completion, total: usage.total },
      undefined,
      undefined
    );
  });

  goProvider.setOnUsageCallback(usage => {
    requestCounter++;
    usageTracker.recordRequest(
      `req-${sessionId}-${requestCounter}`,
      sessionId,
      'go-model',
      'Go Model',
      'opencode-go',
      { prompt: usage.prompt, completion: usage.completion, total: usage.total },
      undefined,
      undefined
    );
  });

  zenProvider.setOnUsageCallback(usage => {
    requestCounter++;
    usageTracker.recordRequest(
      `req-${sessionId}-${requestCounter}`,
      sessionId,
      'zen-model',
      'Zen Model',
      'opencode-zen',
      { prompt: usage.prompt, completion: usage.completion, total: usage.total },
      undefined,
      undefined
    );
  });

  // Refresh tree views when models change
  const handleModelsChanged = () => {
    void refreshViews();
  };

  context.subscriptions.push(
    freeProvider.onDidChangeLanguageModelChatInformation(() => handleModelsChanged()),
    goProvider.onDidChangeLanguageModelChatInformation(() => handleModelsChanged()),
    zenProvider.onDidChangeLanguageModelChatInformation(() => handleModelsChanged()),
    serverProvider.onDidChangeLanguageModelChatInformation(() => handleModelsChanged()),
    lmStudioProvider.onDidChangeLanguageModelChatInformation(() => handleModelsChanged()),
    ollamaProvider.onDidChangeLanguageModelChatInformation(() => handleModelsChanged()),
  );

  // ── Tree view providers ───────────────────────────────────────────────────

  infraProvider = new InfrastructureTreeProvider();
  context.subscriptions.push(
    window.registerTreeDataProvider('opencode-zen-infrastructure', infraProvider)
  );

  kpisProvider = new KpisTreeProvider();
  context.subscriptions.push(
    window.registerTreeDataProvider('opencode-zen-kpis', kpisProvider)
  );

  registerCommands(context);

  const connectedCount = serverManager.getConnectedList().length;
  if (connectedCount > 0) {
    window.showInformationMessage(`+ Providers: ${connectedCount} OpenCode server(s) connected.`);
  }

  // Initial refresh with staggered delays to allow providers to load
  console.log('[OpenCode] Starting initial refresh...');
  setTimeout(() => void refreshViews(), 500);
  setTimeout(() => void refreshViews(), 3000);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function syncServerProviderFromManager(): void {
  for (const conn of serverManager.getConnectedList()) {
    serverProvider.addServer(conn.config.id, conn.config.name, conn.info.baseUrl, conn.client);
  }
}

function extractCapabilities(m: { capabilities?: { imageInput?: boolean; toolCalling?: boolean | number } }): string[] {
  const caps: string[] = [];
  if (!m.capabilities) return caps;
  const c = m.capabilities;
  if (c.toolCalling) caps.push('Tools');
  if (c.imageInput) caps.push('Vision');
  return caps;
}

function buildInfrastructureData() {
  const servers: import('./treeview/infrastructureProvider').ServerItem[] = [];

  // Cloud providers
  for (const [provider, name, type, vendorName] of [
    [zenProvider, 'OpenCode Zen', 'opencode-zen', 'OpenCode'] as const,
    [goProvider, 'OpenCode Go', 'opencode-go', 'OpenCode'] as const,
    [freeProvider, 'OpenCode Free', 'opencode-free', 'OpenCode'] as const,
  ]) {
    const key = provider.getApiKey();
    const models = provider.getCurrentModels();
    servers.push({
      id: type,
      name,
      type,
      url: 'opencode.ai',
      online: models.length > 0 && !!key,
      keyConfigured: !!key,
      models: models.map(m => ({
        id: m.id,
        name: m.name || m.id,
        vendor: vendorName,
        capabilities: extractCapabilities(m),
        contextSize: m.maxInputTokens || 0,
      })),
    });
  }

  // ── Indexed model grouping: O(M+S) instead of O(S×M) ──────────────────
  function groupByServerPrefix<T extends { id: string }>(models: T[], serverId: string): T[] {
    const prefix = `${serverId}:`;
    const result: T[] = [];
    for (const m of models) {
      if (m.id.startsWith(prefix)) result.push(m);
    }
    return result;
  }

  // LM Studio servers
  const lmModels = lmStudioProvider.getCurrentModels();
  for (const s of lmStudioProvider.getServerList()) {
    const serverModels = groupByServerPrefix(lmModels, s.id);
    servers.push({
      id: s.id,
      name: s.name,
      type: 'lmstudio',
      url: s.url,
      online: s.available,
      keyConfigured: true,
      models: serverModels.map(m => ({
        id: m.id,
        name: m.name || m.id.replace(`${s.id}:`, ''),
        vendor: 'LM Studio',
        capabilities: extractCapabilities(m),
        contextSize: m.maxInputTokens || 0,
      })),
    });
  }

  // Ollama servers
  const ollamaModels = ollamaProvider.getCurrentModels();
  for (const s of ollamaProvider.getServerList()) {
    const serverModels = groupByServerPrefix(ollamaModels, s.id);
    servers.push({
      id: s.id,
      name: s.name,
      type: 'ollama',
      url: s.url,
      online: s.available,
      keyConfigured: true,
      models: serverModels.map(m => ({
        id: m.id,
        name: m.name || m.id.replace(`${s.id}:`, ''),
        vendor: 'Ollama',
        capabilities: extractCapabilities(m),
        contextSize: m.maxInputTokens || 0,
      })),
    });
  }

  // OpenCode custom servers
  const serverModels = serverProvider.getCurrentModels();
  for (const conn of serverManager.getConnectedList()) {
    const connModels = groupByServerPrefix(serverModels, conn.config.id);
    servers.push({
      id: conn.config.id,
      name: conn.config.name,
      type: 'opencode-server',
      url: conn.info.baseUrl,
      online: true,
      keyConfigured: true,
      models: connModels.map(m => ({
        id: m.id,
        name: m.name || m.id.replace(`${conn.config.id}:`, ''),
        vendor: 'OpenCode Server',
        capabilities: extractCapabilities(m),
        contextSize: m.maxInputTokens || 0,
      })),
    });
  }

  // Sort: online first, then by name
  servers.sort((a, b) => {
    if (a.online !== b.online) return b.online ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  return servers;
}

function buildKpiData(): import('./treeview/kpisProvider').KpiSummary {
  const stats = usageTracker.getStats();
  const openCodeUsage = OpenCodeUsageService.getInstance().getUsageData();

  const byServer: Array<{ name: string; requests: number; cost: number; isLocal: boolean }> = [];
  const byModel: Array<{ name: string; requests: number; cost: number; tokens: number }> = [];

  for (const [provider, data] of Object.entries(stats.byProvider)) {
    const isLocal = provider === 'lmstudio' || provider === 'ollama-plus';
    const name = provider === 'opencode-go' ? 'OpenCode Go'
               : provider === 'opencode-free' ? 'OpenCode Free'
               : provider === 'opencode-zen' ? 'OpenCode Zen'
               : provider === 'lmstudio' ? 'LM Studio'
               : provider === 'ollama-plus' ? 'Ollama'
               : provider;
    byServer.push({
      name,
      requests: data.requests,
      cost: data.cost,
      isLocal,
    });
  }

  for (const [modelId, data] of Object.entries(stats.byModel)) {
    byModel.push({
      name: modelId,
      requests: data.requests,
      cost: data.cost,
      tokens: data.tokens.total,
    });
  }

  // Sort by tokens desc
  byModel.sort((a, b) => b.tokens - a.tokens);

  return {
    totalRequests: stats.totalRequests,
    totalTokensIn: stats.totalTokens.prompt,
    totalTokensOut: stats.totalTokens.completion,
    totalCost: stats.totalCost,
    byServer,
    byModel,
  };
}

let refreshDebounceTimer: ReturnType<typeof setTimeout> | undefined;

async function refreshViews(): Promise<void> {
  if (refreshDebounceTimer) {
    clearTimeout(refreshDebounceTimer);
  }

  refreshDebounceTimer = setTimeout(() => {
    refreshDebounceTimer = undefined;
    doRefreshViews();
  }, 150); // 150ms debounce — batches rapid-fire updates
}

async function doRefreshViews(): Promise<void> {
  console.log('[OpenCode] refreshViews called');

  const infra = buildInfrastructureData();
  infraProvider.refresh(infra);

  const kpis = buildKpiData();
  kpisProvider.refresh(kpis);

  console.log('[OpenCode] Views refreshed');
}

interface ServerTypeQuickPickItem extends QuickPickItem {
  value: string;
}

interface ServerQuickPickItem extends QuickPickItem {
  id: string;
  serverKind?: 'opencode' | 'lmstudio' | 'ollama';
  name: string;
}

// ── Commands ──────────────────────────────────────────────────────────────────

function registerCommands(context: ExtensionContext): void {
  const reg = (id: string, fn: (...args: any[]) => any) =>
    context.subscriptions.push(commands.registerCommand(id, fn));

  reg('opencode-zen.configureZen', async () => {
    const key = await window.showInputBox({
      title: 'OpenCode Zen — API Key',
      prompt: 'Enter your Zen/Free API key (opencode.ai/auth)',
      password: true, placeHolder: 'oc-...', ignoreFocusOut: true,
    });
    if (key === undefined) return;
    await zenProvider.setApiKey(key);
    await freeProvider.setApiKey(key);
    window.showInformationMessage(key ? 'API key saved.' : 'API key cleared.');
    void refreshViews();
  });

  reg('opencode-zen.configureGo', async () => {
    const key = await window.showInputBox({
      title: 'OpenCode Go — API Key',
      prompt: 'Enter your Go API key (opencode.ai/auth)',
      password: true, placeHolder: 'oc-...', ignoreFocusOut: true,
    });
    if (key === undefined) return;
    await goProvider.setApiKey(key);
    window.showInformationMessage(key ? 'Go API key saved.' : 'Go API key cleared.');
    void refreshViews();
  });

  reg('opencode-zen.refreshAll', () => {
    zenProvider.refreshModels();
    goProvider.refreshModels();
    freeProvider.refreshModels();
    serverProvider.refreshModels();
    window.showInformationMessage('All models refreshed.');
    void refreshViews();
  });

  reg('opencode-zen.refreshServers', async () => {
    await serverManager.connectAll();
    syncServerProviderFromManager();
    window.showInformationMessage('Servers refreshed.');
    void refreshViews();
  });

  // ── Add Server ────────────────────────────────────────────────────────────

  reg('opencode-zen.addServer', async () => {
    const serverType = await window.showQuickPick<ServerTypeQuickPickItem>([
      { label: '$(server) OpenCode Server', value: 'opencode' },
      { label: '$(chip) LM Studio',          value: 'lmstudio' },
      { label: '$(zap) Ollama',               value: 'ollama' },
    ], { placeHolder: 'Select server type', ignoreFocusOut: true });
    if (!serverType) return;

    if (serverType.value === 'lmstudio') {
      const name = await window.showInputBox({ title: 'LM Studio Name', value: 'Local LM Studio', ignoreFocusOut: true });
      if (name === undefined) return;
      const url  = await window.showInputBox({ title: 'LM Studio URL',  value: 'http://localhost:1234', ignoreFocusOut: true });
      if (url === undefined) return;
      lmStudioProvider.addServer(`lmstudio-${randomUUID().slice(0, 8)}`, name, url);
      window.showInformationMessage(`LM Studio "${name}" added.`);
      void refreshViews();
      return;
    }

    if (serverType.value === 'ollama') {
      const name = await window.showInputBox({ title: 'Ollama Name', value: 'Local Ollama', ignoreFocusOut: true });
      if (name === undefined) return;
      const url  = await window.showInputBox({ title: 'Ollama URL',  value: 'http://localhost:11434', ignoreFocusOut: true });
      if (url === undefined) return;
      ollamaProvider.addServer(`ollama-${randomUUID().slice(0, 8)}`, name, url);
      window.showInformationMessage(`Ollama "${name}" added.`);
      void refreshViews();
      return;
    }

    // OpenCode Server
    const name    = await window.showInputBox({ title: 'Server Name', placeHolder: 'My OpenCode Server', ignoreFocusOut: true });
    if (name === undefined) return;
    const url     = await window.showInputBox({ title: 'Server URL', placeHolder: 'http://127.0.0.1', ignoreFocusOut: true });
    if (url === undefined) return;
    const portStr = await window.showInputBox({ title: 'Port', placeHolder: '4096', ignoreFocusOut: true });
    if (portStr === undefined) return;
    const port    = parseInt(portStr, 10) || 4096;
    const username = await window.showInputBox({ title: 'Username (optional)', ignoreFocusOut: true }) ?? '';
    let password = '';
    if (username) {
      password = await window.showInputBox({ title: 'Password', password: true, ignoreFocusOut: true }) ?? '';
    }

    const newConfig = {
      id: randomUUID(), name, url: url || 'http://127.0.0.1', port,
      username: username || undefined, hasPassword: !!password, enabled: true,
      isLocal: !!(url?.includes('127.0.0.1') || url?.includes('localhost')),
    };

    const configs = await secretStorage.getServerConfigs();
    configs.push(newConfig);
    await secretStorage.setServerConfigs(configs);
    if (password) await secretStorage.setServerPassword(newConfig.id, password);

    await serverManager.connectAll();
    syncServerProviderFromManager();
    window.showInformationMessage(`Server "${name}" added.`);
    void refreshViews();
  });

  // ── Edit Server ───────────────────────────────────────────────────────────

  reg('opencode-zen.editServer', async (_: unknown, serverId?: string) => {
    if (!serverId) {
      const servers = await secretStorage.getServerConfigs();
      if (!servers.length) { window.showInformationMessage('No servers configured.'); return; }
      const pick = await window.showQuickPick<{ label: string; id: string }>(servers.map(s => ({ label: s.name, id: s.id })), { placeHolder: 'Select server' });
      if (!pick) return;
      serverId = pick.id;
    }
    const configs = await secretStorage.getServerConfigs();
    const config = configs.find(c => c.id === serverId);
    if (!config) return;

    const name    = await window.showInputBox({ title: 'Server Name', value: config.name, ignoreFocusOut: true });
    if (name === undefined) return;
    const url     = await window.showInputBox({ title: 'Server URL', value: config.url, ignoreFocusOut: true });
    if (url === undefined) return;
    const portStr = await window.showInputBox({ title: 'Port', value: String(config.port), ignoreFocusOut: true });
    if (portStr === undefined) return;
    const username = await window.showInputBox({ title: 'Username (optional)', value: config.username ?? '', ignoreFocusOut: true }) ?? '';
    const currentPwd = config.hasPassword ? await secretStorage.getServerPassword(serverId!) : '';
    const pwd = await window.showInputBox({ title: 'Password (empty = keep current)', password: true, value: currentPwd, ignoreFocusOut: true });
    if (pwd === undefined) return;

    config.name = name; config.url = url; config.port = parseInt(portStr, 10) || 4096;
    config.username = username || undefined; config.hasPassword = !!(pwd || currentPwd);
    config.isLocal = !!(url.includes('127.0.0.1') || url.includes('localhost'));
    await secretStorage.setServerConfigs(configs);
    if (pwd) await secretStorage.setServerPassword(serverId!, pwd);

    await serverManager.connectAll();
    syncServerProviderFromManager();
    window.showInformationMessage(`Server "${name}" updated.`);
    void refreshViews();
  });

  // ── Remove Server ─────────────────────────────────────────────────────────

  reg('opencode-zen.removeServer', async (_: unknown, serverId?: string) => {
    if (!serverId) {
      // Aggregate OpenCode + LMStudio + Ollama servers into a single picker.
      const opencode = await secretStorage.getServerConfigs();
      const local = await secretStorage.getLocalServerConfigs();
      const all = [
        ...opencode.map(s => ({ label: `${s.name} (OpenCode)`, id: s.id, serverKind: 'opencode' as const, name: s.name })),
        ...local.map(s => ({ label: `${s.name} (${s.kind === 'lmstudio' ? 'LM Studio' : 'Ollama'})`, id: s.id, serverKind: s.kind, name: s.name })),
      ];
      if (!all.length) { window.showInformationMessage('No servers configured.'); return; }
      const pick = await window.showQuickPick<{ label: string; id: string; serverKind: 'opencode' | 'lmstudio' | 'ollama'; name: string }>(all, { placeHolder: 'Select server to remove' });
      if (!pick) return;
      serverId = pick.id;
      const kind = pick.serverKind;
      const name = pick.name;
      const confirm = await window.showWarningMessage(`Remove "${name}"?`, 'Remove', 'Cancel');
      if (confirm !== 'Remove') return;

      if (kind === 'opencode') {
        const configs = await secretStorage.getServerConfigs();
        await secretStorage.setServerConfigs(configs.filter(c => c.id !== serverId));
        await secretStorage.setServerPassword(serverId!, '');
        serverProvider.removeServer(serverId!);
        await serverManager.connectAll();
      } else {
        if (kind === 'lmstudio') lmStudioProvider.removeServer(serverId!);
        else ollamaProvider.removeServer(serverId!);
        const configs = await secretStorage.getLocalServerConfigs();
        await secretStorage.setLocalServerConfigs(configs.filter(c => c.id !== serverId));
      }
      window.showInformationMessage(`Server "${name}" removed.`);
      void refreshViews();
      return;
    }

    // Called with a serverId argument (e.g. from a context menu). Try OpenCode
    // first; fall back to local storage.
    const opencodeConfigs = await secretStorage.getServerConfigs();
    const opencodeMatch = opencodeConfigs.find(c => c.id === serverId);
    if (opencodeMatch) {
      const confirm = await window.showWarningMessage(`Remove "${opencodeMatch.name}"?`, 'Remove', 'Cancel');
      if (confirm !== 'Remove') return;
      await secretStorage.setServerConfigs(opencodeConfigs.filter(c => c.id !== serverId));
      await secretStorage.setServerPassword(serverId!, '');
      serverProvider.removeServer(serverId!);
      await serverManager.connectAll();
      window.showInformationMessage(`Server "${opencodeMatch.name}" removed.`);
      void refreshViews();
      return;
    }
    const localConfigs = await secretStorage.getLocalServerConfigs();
    const localMatch = localConfigs.find(c => c.id === serverId);
    if (localMatch) {
      const confirm = await window.showWarningMessage(`Remove "${localMatch.name}"?`, 'Remove', 'Cancel');
      if (confirm !== 'Remove') return;
      if (localMatch.kind === 'lmstudio') lmStudioProvider.removeServer(serverId!);
      else ollamaProvider.removeServer(serverId!);
      await secretStorage.setLocalServerConfigs(localConfigs.filter(c => c.id !== serverId));
      window.showInformationMessage(`Server "${localMatch.name}" removed.`);
      void refreshViews();
      return;
    }
    window.showInformationMessage('Server not found.');
  });

  // ── Launch Server ─────────────────────────────────────────────────────────

  reg('opencode-zen.launchServer', async (_: unknown, serverId?: string) => {
    if (!serverId) {
      const configs = await secretStorage.getServerConfigs();
      const offline = configs.filter(c => !serverManager.getConnectedList().some(s => s.config.id === c.id));
      if (!offline.length) { window.showInformationMessage('All servers online or none configured.'); return; }
      const pick = await window.showQuickPick<{ label: string; id: string }>(offline.map(s => ({ label: s.name, id: s.id })), { placeHolder: 'Select server to launch' });
      if (!pick) return;
      serverId = pick.id;
    }
    const configs = await secretStorage.getServerConfigs();
    const config = configs.find(c => c.id === serverId);
    if (!config) return;

    const mode = await window.showQuickPick([
      { label: 'Background process' },
      { label: 'VS Code terminal' },
    ], { placeHolder: `Launch "${config.name}"` });
    if (!mode) return;

    if (mode.label === 'VS Code terminal') {
      const host = config.url.replace(/^https?:\/\//, '');
      const terminal = window.createTerminal({ name: config.name });
      terminal.sendText(`opencode serve --host ${host} --port ${config.port}`);
      terminal.show();
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const reconnected = await serverManager.reconnect(config.id);
        if (reconnected) {
          syncServerProviderFromManager();
          void refreshViews();
          return;
        }
      }
      window.showWarningMessage(`Could not connect to "${config.name}". Check the terminal.`);
    } else {
      const ok = await serverManager.launchServer(config);
      if (ok) { syncServerProviderFromManager(); void refreshViews(); }
      window.showInformationMessage(ok
        ? `Server "${config.name}" launched.`
        : `Could not launch "${config.name}". Is opencode in your PATH?`
      );
    }
  });

  // ── Clear usage ───────────────────────────────────────────────────────────
  reg('opencode-zen.clearUsage', () => {
    usageTracker.clear();
    window.showInformationMessage('Usage stats cleared.');
    void refreshViews();
  });

  // ── Show output ───────────────────────────────────────────────────────────
  reg('opencode-zen.showOutput', () => {
    window.showInformationMessage('Use the Output panel and select a provider channel.');
  });

  // ── Paste Workspace URL ──────────────────────────────────────────────────
  reg('opencode-zen.pasteWorkspaceUrl', async () => {
    // Legacy command — kept for compatibility. Prompts user for workspace URL.
    const url = await window.showInputBox({
      title: 'Workspace URL',
      prompt: 'Enter your OpenCode workspace URL',
      placeHolder: 'https://opencode.ai/workspace/...',
      ignoreFocusOut: true,
    });
    if (!url) return;
    // Store in workspace state
    await context.workspaceState.update('opencodeWorkspaceUrl', url);
    window.showInformationMessage(`Workspace URL saved: ${url}`);
  });

  // ── Start usage tracking ─────────────────────────────────────────────────
  const usageService = OpenCodeUsageService.getInstance();
  usageService.startAutoRefresh(5 * 60 * 1000); // Refresh every 5 minutes
  context.subscriptions.push(usageService);
}

export function deactivate(): void {}
