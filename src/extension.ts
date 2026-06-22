import * as vscode from 'vscode';
import { OpenCodeFreeProvider } from './providers/OpenCodeFreeProvider';
import { OpenCodeGoProvider } from './providers/OpenCodeGoProvider';
import { OpenCodeZenProvider } from './providers/OpenCodeZenProvider';
import { OpenCodeServerProvider } from './providers/OpenCodeServerProvider';
import { LMStudioProvider } from './providers/LMStudioProvider';
import { OllamaProvider } from './providers/OllamaProvider';
import { StatusBarManager } from './status/statusBar';
import { OpenCodeConnector } from './integration/opencodeConnector';
import { SecretStorage } from './config/secretStorage';
import { MultiServerManager, initMultiServerManager } from './client/multiServerManager';
import { OpenCodeTreeProvider } from './treeview/openCodeTreeProvider';
import { OpenCodeSubagentTool } from './tools/subagentTool';
import { registerOpenCodeChatParticipant, ProviderEntry } from './chat/participant';
import { DashboardState, OpenCodeWebviewProvider } from './webview/openCodeWebviewProvider';
import { OpenCodeUsagePanel } from './webview/openCodeUsagePanel';
import { OpenCodeUsageService } from './integration/openCodeUsageService';
import { OpenCodeAuthService } from './integration/openCodeAuthService';
import { initModelRegistry } from './client/modelRegistry';
import { getChatStatusManager, disposeChatStatusManager } from './status/chatStatusItems';
import { showMissingConfigNotification, showConnectedNotification, showConnectionErrorNotification } from './notifications/chatNotifications';
import { UsageTracker, formatUsageOutput } from './usage/UsageTracker';
import { randomUUID } from 'crypto';

let freeProvider: OpenCodeFreeProvider;
let goProvider: OpenCodeGoProvider;
let zenProvider: OpenCodeZenProvider;
let serverProvider: OpenCodeServerProvider;
let lmStudioProvider: LMStudioProvider;
let ollamaProvider: OllamaProvider;
let usageTracker: UsageTracker;
let statusBar: StatusBarManager;
let treeProvider: OpenCodeTreeProvider;
let webviewProvider: OpenCodeWebviewProvider;
let connector: OpenCodeConnector;
let secretStorage: SecretStorage;
let serverManager: MultiServerManager;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('+ Providers: activating...');

  // ── Initialize services ─────────────────────────────────────────────────
  OpenCodeAuthService.init(context);

  // Fetch model capabilities (context sizes, vision, reasoning) from models.dev
  // Must complete before providers try to resolve model capabilities
  await initModelRegistry();
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
  // This will update the status bar and tree view with real data
  setTimeout(() => {
    // Force providers to fetch models if they have API keys
    if (zenProvider.getApiKey()) {
      zenProvider.refreshModels();
    }
    if (goProvider.getApiKey()) {
      goProvider.refreshModels();
    }
    if (freeProvider.getApiKey()) {
      freeProvider.refreshModels();
    }
    // Refresh the UI
    void refreshTreeView();
  }, 1000);

  // ── OpenCode local key auto-detection ─────────────────────────────────────

  connector = new OpenCodeConnector(vscode.window.createOutputChannel('OpenCode Connector'));
  secretStorage = new SecretStorage(context);
  connector.watchAuthFile(context);
  context.subscriptions.push(connector);

  if (await connector.hasLocalKeys()) {
    const choice = await vscode.window.showInformationMessage(
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
      vscode.window.showInformationMessage('+ Providers: Local API keys loaded.');
    }
  }

  context.subscriptions.push(
    connector.onDidChangeLocalKeys(async (newKeys) => {
      const choice = await vscode.window.showInformationMessage(
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
        vscode.window.showInformationMessage('+ Providers: New API keys loaded.');
        void refreshTreeView();
      }
    })
  );

  // ── OpenCode Servers ──────────────────────────────────────────────────────

  serverManager = await initMultiServerManager(secretStorage);
  serverProvider = new OpenCodeServerProvider();

  syncServerProviderFromManager();

  // ── LM Studio ────────────────────────────────────────────────────────────

  lmStudioProvider = new LMStudioProvider(secretStorage);
  await lmStudioProvider.loadPersistedServers();

  if (lmStudioProvider.getServerList().length === 0) {
    try {
      const lmUrl = vscode.workspace.getConfiguration('lmstudio').get<string>('baseUrl') || 'http://localhost:1234';
      const health = await fetch(`${lmUrl}/v1/models`, { signal: AbortSignal.timeout(3000) });
      if (health.ok) {
        lmStudioProvider.addServer('local', 'Local LM Studio', lmUrl);
        console.log(`+ Providers: LM Studio connected at ${lmUrl}`);
      }
    } catch { /* not running */ }
  } else {
    console.log(`+ Providers: LM Studio loaded ${lmStudioProvider.getServerList().length} persisted server(s).`);
  }

  // ── Ollama ────────────────────────────────────────────────────────────────

  ollamaProvider = new OllamaProvider(secretStorage);
  await ollamaProvider.loadPersistedServers();

  if (ollamaProvider.getServerList().length === 0) {
    try {
      const ollamaUrl = vscode.workspace.getConfiguration('ollama').get<string>('baseUrl') || 'http://localhost:11434';
      const health = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (health.ok) {
        ollamaProvider.addServer('local', 'Local Ollama', ollamaUrl);
        console.log(`+ Providers: Ollama connected at ${ollamaUrl}`);
      }
    } catch { /* not running */ }
  } else {
    console.log(`+ Providers: Ollama loaded ${ollamaProvider.getServerList().length} persisted server(s).`);
  }

  // ── Register providers with VS Code LM API ────────────────────────────────

  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider('opencode-free',   freeProvider),
    vscode.lm.registerLanguageModelChatProvider('opencode-go',     goProvider),
    vscode.lm.registerLanguageModelChatProvider('opencode-zen',    zenProvider),
    vscode.lm.registerLanguageModelChatProvider('opencode-server', serverProvider),
    vscode.lm.registerLanguageModelChatProvider('lmstudio',        lmStudioProvider),
    vscode.lm.registerLanguageModelChatProvider('ollama-plus',     ollamaProvider),
    freeProvider, goProvider, zenProvider, serverProvider, lmStudioProvider, ollamaProvider,
  );

  // ── Agent Window providers (for Copilot CLI / Agents Window) ──────────────
  // Register additional providers with '-agent' suffix for the Agents Window.
  // VS Code shows these in the Agents Window model picker.
  const enableAgentWindow = vscode.workspace.getConfiguration('opencode-zen').get<boolean>('enableAgentWindow', true);
  
  if (enableAgentWindow) {
    const agentZenProvider = new OpenCodeZenProvider(context);
    const agentGoProvider = new OpenCodeGoProvider(context);
    const agentFreeProvider = new OpenCodeFreeProvider(context);
    
    // Copy API keys from main providers
    await agentZenProvider.setApiKey(zenProvider.getApiKey());
    await agentGoProvider.setApiKey(goProvider.getApiKey());
    await agentFreeProvider.setApiKey(freeProvider.getApiKey());
    
    context.subscriptions.push(
      vscode.lm.registerLanguageModelChatProvider('opencode-zen-agent',    agentZenProvider),
      vscode.lm.registerLanguageModelChatProvider('opencode-go-agent',     agentGoProvider),
      vscode.lm.registerLanguageModelChatProvider('opencode-free-agent',   agentFreeProvider),
      agentZenProvider, agentGoProvider, agentFreeProvider,
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
  context.subscriptions.push(vscode.lm.registerTool(OpenCodeSubagentTool.toolName, subagentTool));

  // ── Chat participant (@opencode) ──────────────────────────────────────────
  const chatParticipant = registerOpenCodeChatParticipant(context, [
    { vendor: 'opencode-zen', displayName: 'OpenCode Zen', provider: zenProvider },
    { vendor: 'opencode-go', displayName: 'OpenCode Go', provider: goProvider },
    { vendor: 'opencode-free', displayName: 'OpenCode Free', provider: freeProvider },
    { vendor: 'lmstudio', displayName: 'LM Studio', provider: lmStudioProvider },
    { vendor: 'ollama-plus', displayName: 'Ollama+', provider: ollamaProvider },
  ]);
  context.subscriptions.push(chatParticipant);

  // ── Chat status items (proposed API) ─────────────────────────────────────

  const chatStatus = getChatStatusManager();
  context.subscriptions.push({ dispose: () => disposeChatStatusManager() });

  // ── Status bar + Tree view ────────────────────────────────────────────────

  statusBar = new StatusBarManager(() => ({
    host: 'opencode',
    connection: { state: 'ok' },
    models: [],
    sessionStats: { requestCount: 0, totalTokens: { prompt: 0, completion: 0, total: 0 } },
    features: { toolCalling: true, imageInput: false, parallelToolCalling: false, agentTemperature: 0.7 },
    now: Date.now(),
  }));
  statusBar.show();
  context.subscriptions.push(statusBar);

  // ── Usage tracking ────────────────────────────────────────────────────────

  usageTracker = new UsageTracker();
  usageTracker.onDidChangeUsage(stats => {
    statusBar.updateUsage(stats);
    void refreshTreeView(); // Update dashboard when usage changes
  });
  context.subscriptions.push(usageTracker);

  // ── OpenCode API Usage Service ───────────────────────────────────────────
  // Connect OpenCode API usage data to the UI
  const openCodeUsageService = OpenCodeUsageService.getInstance();
  openCodeUsageService.onDidChangeUsage(data => {
    console.log(`[OpenCode] Usage data received: ${data.models.length} models, $${data.totalCost}`);
    void refreshTreeView();
  });
  context.subscriptions.push(openCodeUsageService);

  // Generate a consistent session ID for this extension activation
  const sessionId = randomUUID();
  let requestCounter = 0;

  // Connect provider usage callbacks
  freeProvider.setOnUsageCallback(usage => {
    requestCounter++;
    usageTracker.recordRequest(
      `req-${sessionId}-${requestCounter}`,  // requestId
      sessionId,                              // sessionId
      'free-model',                           // modelId
      'Free Model',                           // modelName
      'opencode-free',                        // provider
      { prompt: usage.prompt, completion: usage.completion, total: usage.total },
      undefined,                              // duration
      undefined                               // meta
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

  // Refresh dashboard when models change - also update status bar
  const handleModelsChanged = () => {
    void refreshTreeView();
    // Update status bar with current model counts
    const zenCount = zenProvider.getCurrentModels().length;
    const goCount = goProvider.getCurrentModels().length;
    const freeCount = freeProvider.getCurrentModels().length;
    const totalModels = zenCount + goCount + freeCount;
    if (totalModels > 0) {
      statusBar.setIdle(totalModels);
    }
  };

  context.subscriptions.push(
    freeProvider.onDidChangeLanguageModelChatInformation(() => handleModelsChanged()),
    goProvider.onDidChangeLanguageModelChatInformation(() => handleModelsChanged()),
    zenProvider.onDidChangeLanguageModelChatInformation(() => handleModelsChanged()),
    serverProvider.onDidChangeLanguageModelChatInformation(() => void refreshTreeView()),
    lmStudioProvider.onDidChangeLanguageModelChatInformation(() => void refreshTreeView()),
    ollamaProvider.onDidChangeLanguageModelChatInformation(() => void refreshTreeView()),
  );

  treeProvider = new OpenCodeTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('opencode-zen-tree', treeProvider)
  );

  // ── Webview dashboard ─────────────────────────────────────────────────────

  webviewProvider = new OpenCodeWebviewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(OpenCodeWebviewProvider.viewType, webviewProvider)
  );

  registerCommands(context);

  const connectedCount = serverManager.getConnectedList().length;
  if (connectedCount > 0) {
    vscode.window.showInformationMessage(`+ Providers: ${connectedCount} OpenCode server(s) connected.`);
  }

  // Initial refresh with delay to allow providers to load
  console.log('[OpenCode] Starting initial refresh...');
  setTimeout(() => {
    console.log('[OpenCode] Refreshing tree view...');
    void refreshTreeView();
  }, 1000);
  setTimeout(() => void refreshTreeView(), 3000);
  setTimeout(() => void refreshTreeView(), 6000);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function syncServerProviderFromManager(): void {
  for (const conn of serverManager.getConnectedList()) {
    serverProvider.addServer(conn.config.id, conn.config.name, conn.info.baseUrl, conn.client);
  }
}

async function refreshTreeView(): Promise<void> {
  console.log('[OpenCode] refreshTreeView called');
  const allServers: DashboardState['servers'] = [];

  for (const conn of serverManager.getConnectedList()) {
    allServers.push({
      id: conn.config.id,
      name: conn.config.name,
      url: conn.config.url,
      port: conn.config.port,
      version: conn.info.version,
      available: conn.info.available,
      models: [],
      providerCount: 0,
      type: 'opencode',
    });
  }

  // Include LM Studio and Ollama servers so they show up in the side panel.
  if (lmStudioProvider) {
    for (const s of lmStudioProvider.getServerList()) {
      allServers.push({ ...s, port: undefined, version: undefined });
    }
  }
  if (ollamaProvider) {
    for (const s of ollamaProvider.getServerList()) {
      allServers.push({ ...s, port: undefined, version: undefined });
    }
  }

  // Get model families from Zen and Go providers
  const zenModels = zenProvider.getCurrentModels();
  const goModels = goProvider.getCurrentModels();
  console.log(`[OpenCode] Zen models: ${zenModels.length}, Go models: ${goModels.length}`);

  // Build family groups
  const zenFamilies = buildModelFamilies(zenModels);
  const goFamilies = buildModelFamilies(goModels);
  console.log(`[OpenCode] Zen families: ${zenFamilies.length}, Go families: ${goFamilies.length}`);

  // Get internal usage stats
  const usageStats = usageTracker.getStats();

  // Get OpenCode API usage data
  const openCodeUsage = OpenCodeUsageService.getInstance().getUsageData();

  // Calculate Zen stats (opencode-free, opencode-zen)
  let zenTotalTokens = 0;
  let zenTotalRequests = 0;
  let zenTotalCost = 0;
  for (const [provider, data] of Object.entries(usageStats.byProvider)) {
    if (provider === 'opencode-free' || provider === 'opencode-zen') {
      zenTotalTokens += data.tokens.total;
      zenTotalRequests += data.requests;
      zenTotalCost += data.cost;
    }
  }

  // Calculate Go stats
  let goTotalTokens = 0;
  let goTotalRequests = 0;
  let goTotalCost = 0;
  for (const [provider, data] of Object.entries(usageStats.byProvider)) {
    if (provider === 'opencode-go') {
      goTotalTokens += data.tokens.total;
      goTotalRequests += data.requests;
      goTotalCost += data.cost;
    }
  }

  // If we have OpenCode API data, use it to enrich the stats
  if (openCodeUsage) {
    // Merge OpenCode API model data with our internal tracking
    for (const model of openCodeUsage.models) {
      goTotalCost += model.cost;
      goTotalTokens += model.inputTokens + model.outputTokens;
    }
  }

  const state: DashboardState = {
    servers: allServers,
    zenKey: zenProvider.getApiKey() ? '***' : '',
    goKey: goProvider.getApiKey() ? '***' : '',
    zenFamilies,
    goFamilies,
    zenStats: { totalRequests: zenTotalRequests, totalTokens: { total: zenTotalTokens }, totalCost: zenTotalCost },
    goStats: { totalRequests: goTotalRequests, totalTokens: { total: goTotalTokens }, totalCost: goTotalCost },
    goBurnRate: openCodeUsage?.goLimits ? {
      session: openCodeUsage.goLimits.rolling,
      weekly: openCodeUsage.goLimits.weekly,
      monthly: openCodeUsage.goLimits.monthly,
    } : usageStats.goUsage ? {
      session: usageStats.goUsage.session,
      weekly: usageStats.goUsage.weekly,
      monthly: usageStats.goUsage.monthly,
    } : undefined,
  };

  treeProvider.refresh(state);
  webviewProvider?.update(state);
  console.log('[OpenCode] Dashboard updated');
}

function buildModelFamilies(models: { id: string; name: string; family: string }[]): Array<{ name: string; count: number; models: string[] }> {
  const families = new Map<string, string[]>();

  for (const model of models) {
    const family = model.family || 'Unknown';
    if (!families.has(family)) {
      families.set(family, []);
    }
    families.get(family)!.push(model.name || model.id);
  }

  const result: Array<{ name: string; count: number; models: string[] }> = [];
  for (const [name, modelList] of families) {
    result.push({ name, count: modelList.length, models: modelList });
  }

  // Sort by count descending
  result.sort((a, b) => b.count - a.count);

  return result;
}

// ── Commands ──────────────────────────────────────────────────────────────────

function registerCommands(context: vscode.ExtensionContext): void {
  const reg = (id: string, fn: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg('opencode-zen.configureZen', async () => {
    const key = await vscode.window.showInputBox({
      title: 'OpenCode Zen — API Key',
      prompt: 'Enter your Zen/Free API key (opencode.ai/auth)',
      password: true, placeHolder: 'oc-...', ignoreFocusOut: true,
    });
    if (key === undefined) return;
    await zenProvider.setApiKey(key);
    await freeProvider.setApiKey(key);
    vscode.window.showInformationMessage(key ? 'API key saved.' : 'API key cleared.');
    void refreshTreeView();
  });

  reg('opencode-zen.configureGo', async () => {
    const key = await vscode.window.showInputBox({
      title: 'OpenCode Go — API Key',
      prompt: 'Enter your Go API key (opencode.ai/auth)',
      password: true, placeHolder: 'oc-...', ignoreFocusOut: true,
    });
    if (key === undefined) return;
    await goProvider.setApiKey(key);
    vscode.window.showInformationMessage(key ? 'Go API key saved.' : 'Go API key cleared.');
    void refreshTreeView();
  });

  reg('opencode-zen.refreshAll', () => {
    zenProvider.refreshModels();
    goProvider.refreshModels();
    freeProvider.refreshModels();
    serverProvider.refreshModels();
    vscode.window.showInformationMessage('All models refreshed.');
    void refreshTreeView();
  });

  reg('opencode-zen.refreshServers', async () => {
    await serverManager.connectAll();
    syncServerProviderFromManager();
    vscode.window.showInformationMessage('Servers refreshed.');
    void refreshTreeView();
  });

  // ── Add Server ────────────────────────────────────────────────────────────

  reg('opencode-zen.addServer', async () => {
    const serverType = await vscode.window.showQuickPick([
      { label: '$(server) OpenCode Server', value: 'opencode' },
      { label: '$(chip) LM Studio',          value: 'lmstudio' },
      { label: '$(zap) Ollama',               value: 'ollama' },
    ], { placeHolder: 'Select server type', ignoreFocusOut: true });
    if (!serverType) return;

    if ((serverType as any).value === 'lmstudio') {
      const name = await vscode.window.showInputBox({ title: 'LM Studio Name', value: 'Local LM Studio', ignoreFocusOut: true });
      if (name === undefined) return;
      const url  = await vscode.window.showInputBox({ title: 'LM Studio URL',  value: 'http://localhost:1234', ignoreFocusOut: true });
      if (url === undefined) return;
      lmStudioProvider.addServer(`lmstudio-${randomUUID().slice(0, 8)}`, name, url);
      vscode.window.showInformationMessage(`LM Studio "${name}" added.`);
      void refreshTreeView();
      return;
    }

    if ((serverType as any).value === 'ollama') {
      const name = await vscode.window.showInputBox({ title: 'Ollama Name', value: 'Local Ollama', ignoreFocusOut: true });
      if (name === undefined) return;
      const url  = await vscode.window.showInputBox({ title: 'Ollama URL',  value: 'http://localhost:11434', ignoreFocusOut: true });
      if (url === undefined) return;
      ollamaProvider.addServer(`ollama-${randomUUID().slice(0, 8)}`, name, url);
      vscode.window.showInformationMessage(`Ollama "${name}" added.`);
      void refreshTreeView();
      return;
    }

    // OpenCode Server
    const name    = await vscode.window.showInputBox({ title: 'Server Name', placeHolder: 'My OpenCode Server', ignoreFocusOut: true });
    if (name === undefined) return;
    const url     = await vscode.window.showInputBox({ title: 'Server URL', placeHolder: 'http://127.0.0.1', ignoreFocusOut: true });
    if (url === undefined) return;
    const portStr = await vscode.window.showInputBox({ title: 'Port', placeHolder: '4096', ignoreFocusOut: true });
    if (portStr === undefined) return;
    const port    = parseInt(portStr, 10) || 4096;
    const username = await vscode.window.showInputBox({ title: 'Username (optional)', ignoreFocusOut: true }) ?? '';
    let password = '';
    if (username) {
      password = await vscode.window.showInputBox({ title: 'Password', password: true, ignoreFocusOut: true }) ?? '';
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
    vscode.window.showInformationMessage(`Server "${name}" added.`);
    void refreshTreeView();
  });

  // ── Edit Server ───────────────────────────────────────────────────────────

  reg('opencode-zen.editServer', async (_: unknown, serverId?: string) => {
    if (!serverId) {
      const servers = await secretStorage.getServerConfigs();
      if (!servers.length) { vscode.window.showInformationMessage('No servers configured.'); return; }
      const pick = await vscode.window.showQuickPick(servers.map(s => ({ label: s.name, id: s.id })), { placeHolder: 'Select server' });
      if (!pick) return;
      serverId = (pick as any).id;
    }
    const configs = await secretStorage.getServerConfigs();
    const config = configs.find(c => c.id === serverId);
    if (!config) return;

    const name    = await vscode.window.showInputBox({ title: 'Server Name', value: config.name, ignoreFocusOut: true });
    if (name === undefined) return;
    const url     = await vscode.window.showInputBox({ title: 'Server URL', value: config.url, ignoreFocusOut: true });
    if (url === undefined) return;
    const portStr = await vscode.window.showInputBox({ title: 'Port', value: String(config.port), ignoreFocusOut: true });
    if (portStr === undefined) return;
    const username = await vscode.window.showInputBox({ title: 'Username (optional)', value: config.username ?? '', ignoreFocusOut: true }) ?? '';
    const currentPwd = config.hasPassword ? await secretStorage.getServerPassword(serverId!) : '';
    const pwd = await vscode.window.showInputBox({ title: 'Password (empty = keep current)', password: true, value: currentPwd, ignoreFocusOut: true });
    if (pwd === undefined) return;

    config.name = name; config.url = url; config.port = parseInt(portStr, 10) || 4096;
    config.username = username || undefined; config.hasPassword = !!(pwd || currentPwd);
    config.isLocal = !!(url.includes('127.0.0.1') || url.includes('localhost'));
    await secretStorage.setServerConfigs(configs);
    if (pwd) await secretStorage.setServerPassword(serverId!, pwd);

    await serverManager.connectAll();
    syncServerProviderFromManager();
    vscode.window.showInformationMessage(`Server "${name}" updated.`);
    void refreshTreeView();
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
      if (!all.length) { vscode.window.showInformationMessage('No servers configured.'); return; }
      const pick = await vscode.window.showQuickPick(all, { placeHolder: 'Select server to remove' });
      if (!pick) return;
      serverId = (pick as any).id;
      const kind = (pick as any).serverKind as 'opencode' | 'lmstudio' | 'ollama';
      const name = (pick as any).name as string;
      const confirm = await vscode.window.showWarningMessage(`Remove "${name}"?`, 'Remove', 'Cancel');
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
      vscode.window.showInformationMessage(`Server "${name}" removed.`);
      void refreshTreeView();
      return;
    }

    // Called with a serverId argument (e.g. from a context menu). Try OpenCode
    // first; fall back to local storage.
    const opencodeConfigs = await secretStorage.getServerConfigs();
    const opencodeMatch = opencodeConfigs.find(c => c.id === serverId);
    if (opencodeMatch) {
      const confirm = await vscode.window.showWarningMessage(`Remove "${opencodeMatch.name}"?`, 'Remove', 'Cancel');
      if (confirm !== 'Remove') return;
      await secretStorage.setServerConfigs(opencodeConfigs.filter(c => c.id !== serverId));
      await secretStorage.setServerPassword(serverId!, '');
      serverProvider.removeServer(serverId!);
      await serverManager.connectAll();
      vscode.window.showInformationMessage(`Server "${opencodeMatch.name}" removed.`);
      void refreshTreeView();
      return;
    }
    const localConfigs = await secretStorage.getLocalServerConfigs();
    const localMatch = localConfigs.find(c => c.id === serverId);
    if (localMatch) {
      const confirm = await vscode.window.showWarningMessage(`Remove "${localMatch.name}"?`, 'Remove', 'Cancel');
      if (confirm !== 'Remove') return;
      if (localMatch.kind === 'lmstudio') lmStudioProvider.removeServer(serverId!);
      else ollamaProvider.removeServer(serverId!);
      await secretStorage.setLocalServerConfigs(localConfigs.filter(c => c.id !== serverId));
      vscode.window.showInformationMessage(`Server "${localMatch.name}" removed.`);
      void refreshTreeView();
      return;
    }
    vscode.window.showInformationMessage('Server not found.');
  });

  // ── Launch Server ─────────────────────────────────────────────────────────

  reg('opencode-zen.launchServer', async (_: unknown, serverId?: string) => {
    if (!serverId) {
      const configs = await secretStorage.getServerConfigs();
      const offline = configs.filter(c => !serverManager.getConnectedList().some(s => s.config.id === c.id));
      if (!offline.length) { vscode.window.showInformationMessage('All servers online or none configured.'); return; }
      const pick = await vscode.window.showQuickPick(offline.map(s => ({ label: s.name, id: s.id })), { placeHolder: 'Select server to launch' });
      if (!pick) return;
      serverId = (pick as any).id;
    }
    const configs = await secretStorage.getServerConfigs();
    const config = configs.find(c => c.id === serverId);
    if (!config) return;

    const mode = await vscode.window.showQuickPick([
      { label: 'Background process' },
      { label: 'VS Code terminal' },
    ], { placeHolder: `Launch "${config.name}"` });
    if (!mode) return;

    if (mode.label === 'VS Code terminal') {
      const host = config.url.replace(/^https?:\/\//, '');
      const terminal = vscode.window.createTerminal({ name: config.name });
      terminal.sendText(`opencode serve --host ${host} --port ${config.port}`);
      terminal.show();
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const reconnected = await serverManager.reconnect(config.id);
        if (reconnected) {
          syncServerProviderFromManager();
          void refreshTreeView();
          return;
        }
      }
      vscode.window.showWarningMessage(`Could not connect to "${config.name}". Check the terminal.`);
    } else {
      const ok = await serverManager.launchServer(config);
      if (ok) { syncServerProviderFromManager(); void refreshTreeView(); }
      vscode.window.showInformationMessage(ok
        ? `Server "${config.name}" launched.`
        : `Could not launch "${config.name}". Is opencode in your PATH?`
      );
    }
  });

  // ── Clear usage ───────────────────────────────────────────────────────────
  reg('opencode-zen.clearUsage', () => {
    usageTracker.clear();
    vscode.window.showInformationMessage('Usage stats cleared.');
    void refreshTreeView();
  });

  // ── Show output ───────────────────────────────────────────────────────────
  reg('opencode-zen.showOutput', () => {
    vscode.window.showInformationMessage('Use the Output panel and select a provider channel.');
  });

  // ── Show usage stats ──────────────────────────────────────────────────────
  reg('opencode-zen.showUsage', () => {
    // Show detailed usage stats in output channel
    const stats = usageTracker.getStats();
    const output = formatUsageOutput(stats);
    
    // Create or reuse output channel
    const usageChannel = vscode.window.createOutputChannel('OpenCode Usage');
    usageChannel.clear();
    usageChannel.appendLine(output);
    usageChannel.show();
    
    // Also focus the dashboard webview
    if (webviewProvider) {
      webviewProvider.focus();
    }
    void refreshTreeView();
  });

  // ── Open OpenCode Usage Webview ──────────────────────────────────────────
  reg('opencode-zen.openUsageWebview', async () => {
    const panel = OpenCodeUsagePanel.initialize(context);
    await panel.openLogin();
  });

  // ── Open Usage Dashboard ─────────────────────────────────────────────────
  reg('opencode-zen.openDashboard', async () => {
    const panel = OpenCodeUsagePanel.initialize(context);
    await panel.openWorkspaceUsage();
  });

  // ── Paste Workspace URL ──────────────────────────────────────────────────
  reg('opencode-zen.pasteWorkspaceUrl', async () => {
    const panel = OpenCodeUsagePanel.initialize(context);
    await panel.promptForWorkspaceUrl();
  });

  // ── Start usage tracking ─────────────────────────────────────────────────
  const usageService = OpenCodeUsageService.getInstance();
  usageService.startAutoRefresh(5 * 60 * 1000); // Refresh every 5 minutes
  context.subscriptions.push(usageService);

  // ── Show output log ───────────────────────────────────────────────────────
  reg('opencode-zen.showOutputLog', () => {
    vscode.commands.executeCommand('workbench.action.output.toggleOutput');
    vscode.window.showInformationMessage('Select "OpenCode" from the output channel list.');
  });

  // ── Refresh global usage ──────────────────────────────────────────────────
  reg('opencode-zen.refreshGlobal', () => {
    const stats = usageTracker.getStats();
    statusBar.updateUsage(stats);
    void refreshTreeView();
    vscode.window.showInformationMessage('Global usage refreshed.');
  });
}

export function deactivate(): void {}

