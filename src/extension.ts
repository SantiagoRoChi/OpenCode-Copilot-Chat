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
import { DashboardState } from './webview/openCodeWebviewProvider';
import { initModelRegistry } from './client/modelRegistry';
import { getChatStatusManager, disposeChatStatusManager } from './status/chatStatusItems';
import { showMissingConfigNotification, showConnectedNotification, showConnectionErrorNotification } from './notifications/chatNotifications';
import { randomUUID } from 'crypto';

let freeProvider: OpenCodeFreeProvider;
let goProvider: OpenCodeGoProvider;
let zenProvider: OpenCodeZenProvider;
let serverProvider: OpenCodeServerProvider;
let lmStudioProvider: LMStudioProvider;
let ollamaProvider: OllamaProvider;
let statusBar: StatusBarManager;
let treeProvider: OpenCodeTreeProvider;
let connector: OpenCodeConnector;
let secretStorage: SecretStorage;
let serverManager: MultiServerManager;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('+ Providers: activating...');
  // Fetch model capabilities (context sizes, vision, reasoning) from models.dev
  void initModelRegistry();
  // ── Providers ────────────────────────────────────────────────────────────

  freeProvider = new OpenCodeFreeProvider(context);
  goProvider   = new OpenCodeGoProvider(context);
  zenProvider  = new OpenCodeZenProvider(context);

  await Promise.all([
    freeProvider.loadApiKey(),
    goProvider.loadApiKey(),
    zenProvider.loadApiKey(),
  ]);

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

  lmStudioProvider = new LMStudioProvider();

  try {
    const lmUrl = vscode.workspace.getConfiguration('lmstudio').get<string>('baseUrl') || 'http://localhost:1234';
    const health = await fetch(`${lmUrl}/v1/models`, { signal: AbortSignal.timeout(3000) });
    if (health.ok) {
      lmStudioProvider.addServer('local', 'Local LM Studio', lmUrl);
      console.log(`+ Providers: LM Studio connected at ${lmUrl}`);
    }
  } catch { /* not running */ }

  // ── Ollama ────────────────────────────────────────────────────────────────

  ollamaProvider = new OllamaProvider();

  try {
    const ollamaUrl = vscode.workspace.getConfiguration('ollama').get<string>('baseUrl') || 'http://localhost:11434';
    const health = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (health.ok) {
      ollamaProvider.addServer('local', 'Local Ollama', ollamaUrl);
      console.log(`+ Providers: Ollama connected at ${ollamaUrl}`);
    }
  } catch { /* not running */ }

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

  // ── Subagent tool ─────────────────────────────────────────────────────────

  const subagentTool = new OpenCodeSubagentTool();
  OpenCodeSubagentTool.registerProvider('opencode-free', freeProvider);
  OpenCodeSubagentTool.registerProvider('opencode-go',   goProvider);
  OpenCodeSubagentTool.registerProvider('opencode-zen',  zenProvider);
  context.subscriptions.push(vscode.lm.registerTool(OpenCodeSubagentTool.toolName, subagentTool));

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

  treeProvider = new OpenCodeTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('opencode-zen-tree', treeProvider)
  );

  registerCommands(context);

  const connectedCount = serverManager.getConnectedList().length;
  if (connectedCount > 0) {
    vscode.window.showInformationMessage(`+ Providers: ${connectedCount} OpenCode server(s) connected.`);
  }

  void refreshTreeView();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function syncServerProviderFromManager(): void {
  for (const conn of serverManager.getConnectedList()) {
    serverProvider.addServer(conn.config.id, conn.config.name, conn.info.baseUrl, conn.client);
  }
}

async function refreshTreeView(): Promise<void> {
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

  const state: DashboardState = {
    servers: allServers,
    zenKey: zenProvider.getApiKey() ? '***' : '',
    goKey: goProvider.getApiKey() ? '***' : '',
    zenFamilies: [],
    goFamilies: [],
    zenStats: { totalRequests: 0, totalTokens: { total: 0 } },
    goStats: { totalRequests: 0, totalTokens: { total: 0 } },
  };

  treeProvider.refresh(state);
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
      return;
    }

    if ((serverType as any).value === 'ollama') {
      const name = await vscode.window.showInputBox({ title: 'Ollama Name', value: 'Local Ollama', ignoreFocusOut: true });
      if (name === undefined) return;
      const url  = await vscode.window.showInputBox({ title: 'Ollama URL',  value: 'http://localhost:11434', ignoreFocusOut: true });
      if (url === undefined) return;
      ollamaProvider.addServer(`ollama-${randomUUID().slice(0, 8)}`, name, url);
      vscode.window.showInformationMessage(`Ollama "${name}" added.`);
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
      const servers = await secretStorage.getServerConfigs();
      if (!servers.length) { vscode.window.showInformationMessage('No servers configured.'); return; }
      const pick = await vscode.window.showQuickPick(servers.map(s => ({ label: s.name, id: s.id })), { placeHolder: 'Select server to remove' });
      if (!pick) return;
      serverId = (pick as any).id;
    }
    const configs = await secretStorage.getServerConfigs();
    const config = configs.find(c => c.id === serverId);
    if (!config) return;
    const confirm = await vscode.window.showWarningMessage(`Remove "${config.name}"?`, 'Remove', 'Cancel');
    if (confirm !== 'Remove') return;

    await secretStorage.setServerConfigs(configs.filter(c => c.id !== serverId));
    await secretStorage.setServerPassword(serverId!, '');
    serverProvider.removeServer(serverId!);
    await serverManager.connectAll();
    vscode.window.showInformationMessage(`Server "${config.name}" removed.`);
    void refreshTreeView();
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

  // ── Clear usage (no-op kept for backwards compat with keybindings) ─────────
  reg('opencode-zen.clearUsage', () => {
    vscode.window.showInformationMessage('Usage tracking removed in this version.');
  });

  // ── Show output ───────────────────────────────────────────────────────────
  reg('opencode-zen.showOutput', () => {
    vscode.window.showInformationMessage('Use the Output panel and select a provider channel.');
  });
}

export function deactivate(): void {}

