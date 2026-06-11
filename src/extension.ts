import * as vscode from 'vscode';
import { OpenCodeFreeProvider } from './providers/OpenCodeFreeProvider';
import { OpenCodeGoProvider } from './providers/OpenCodeGoProvider';
import { OpenCodeZenProvider } from './providers/OpenCodeZenProvider';
import { StatusBarManager } from './status/statusBar';
import { formatUsageOutput } from './usage/UsageTracker';
import { OpenCodeConnector } from './integration/opencodeConnector';
import { SecretStorage } from './config/secretStorage';
import { OpenCodeServerProvider } from './providers/OpenCodeServerProvider';
import { LMStudioProvider } from './providers/LMStudioProvider';
import { OllamaProvider } from './providers/OllamaProvider';
import { MultiServerManager, initMultiServerManager } from './client/multiServerManager';
import { OpenCodeTreeProvider } from './treeview/openCodeTreeProvider';
import { initModelRegistry, getRegistrySize } from './client/modelRegistry';
import { OpenCodeSubagentTool } from './tools/subagentTool';
import { DashboardState } from './webview/openCodeWebviewProvider';
import { randomUUID } from 'crypto';

let freeProvider: OpenCodeFreeProvider;
let goProvider: OpenCodeGoProvider;
let zenProvider: OpenCodeZenProvider;
let statusBar: StatusBarManager;
let treeProvider: OpenCodeTreeProvider;
let connector: OpenCodeConnector;
let secretStorage: SecretStorage;
let serverManager: MultiServerManager;
let serverProvider: OpenCodeServerProvider;
let lmStudioProvider: LMStudioProvider;
let ollamaProvider: OllamaProvider;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('OpenCode Zen: activating...');

  // Step 1: Fetch models.dev FIRST — all capabilities, pricing, context sizes
  await initModelRegistry();
  const size = getRegistrySize();
  console.log(`OpenCode Zen: model registry loaded (${size.zen} Zen, ${size.go} Go models)`);

  // Step 2: Create providers
  freeProvider = new OpenCodeFreeProvider(context);
  goProvider = new OpenCodeGoProvider(context);
  zenProvider = new OpenCodeZenProvider(context);

  await Promise.all([
    freeProvider.loadApiKey(),
    goProvider.loadApiKey(),
    zenProvider.loadApiKey(),
  ]);

  connector = new OpenCodeConnector(zenProvider['outputChannel']);
  secretStorage = new SecretStorage(context);
  serverManager = await initMultiServerManager(secretStorage);

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
      vscode.window.showInformationMessage('OpenCode Zen: Local API keys loaded.');
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
        vscode.window.showInformationMessage('OpenCode Zen: New API keys loaded.');
        void updateWebview();
      }
    })
  );

  const connectedList = serverManager.getConnectedList();
  const localConfigs = (await secretStorage.getServerConfigs()).filter(c => c.isLocal && c.enabled);
  const localNotRunning = localConfigs.filter(c => !connectedList.some(conn => conn.config.id === c.id));

  // No auto-lanzamos servidores locales al activar — el usuario debe hacerlo manualmente
  // para evitar abrir ventanas de terminal inesperadas.
  if (localNotRunning.length > 0) {
    console.log(
      `OpenCode Zen: Local server(s) configured but not running: ${localNotRunning.map(c => c.name).join(', ')}. ` +
      `Use "OpenCode Zen: Launch Server" to start them.`
    );
  } else if (connectedList.length > 0) {
    console.log(`OpenCode Zen: ${connectedList.length} server(s) connected.`);
  }

  // Register single server provider for ALL connected servers
  serverProvider = new OpenCodeServerProvider();
  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider('opencode-server', serverProvider)
  );
  context.subscriptions.push(serverProvider);

  for (const conn of serverManager.getConnectedList()) {
    serverProvider.addServer({
      serverId: conn.config.id,
      serverName: conn.config.name,
      baseUrl: conn.info.baseUrl,
      client: conn.client,
      connected: true,
    });
  }

  // Register LM Studio provider
  lmStudioProvider = new LMStudioProvider();
  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider('lmstudio', lmStudioProvider)
  );
  context.subscriptions.push(lmStudioProvider);

  // Auto-connect to local LM Studio (default port 1234)
  try {
    const lmStudioUrl = vscode.workspace.getConfiguration('lmstudio').get<string>('baseUrl') || 'http://localhost:1234';
    const lmStudioHealth = await fetch(`${lmStudioUrl}/v1/models`, { signal: AbortSignal.timeout(3000) });
    if (lmStudioHealth.ok) {
      lmStudioProvider.addServer('local', 'Local LM Studio', lmStudioUrl);
      console.log(`+ Providers: LM Studio connected at ${lmStudioUrl}`);
    } else {
      console.log(`+ Providers: LM Studio not available at ${lmStudioUrl}`);
    }
  } catch {
    console.log('+ Providers: LM Studio not running locally');
  }

  // Register Ollama provider
  ollamaProvider = new OllamaProvider();
  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider('ollama', ollamaProvider)
  );
  context.subscriptions.push(ollamaProvider);

  // Auto-connect to local Ollama (default port 11434)
  try {
    const ollamaUrl = vscode.workspace.getConfiguration('ollama').get<string>('baseUrl') || 'http://localhost:11434';
    const ollamaHealth = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (ollamaHealth.ok) {
      ollamaProvider.addServer('local', 'Local Ollama', ollamaUrl);
      console.log(`+ Providers: Ollama connected at ${ollamaUrl}`);
    } else {
      console.log(`+ Providers: Ollama not available at ${ollamaUrl}`);
    }
  } catch {
    console.log('+ Providers: Ollama not running locally');
  }

  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider('opencode-free', freeProvider),
    vscode.lm.registerLanguageModelChatProvider('opencode-go', goProvider),
    vscode.lm.registerLanguageModelChatProvider('opencode-zen', zenProvider),
  );

  // Register subagent tool and wire up providers
  const subagentTool = new OpenCodeSubagentTool();
  OpenCodeSubagentTool.registerProvider('opencode-free', freeProvider);
  OpenCodeSubagentTool.registerProvider('opencode-go', goProvider);
  OpenCodeSubagentTool.registerProvider('opencode-zen', zenProvider);
  context.subscriptions.push(
    vscode.lm.registerTool(OpenCodeSubagentTool.toolName, subagentTool)
  );

  statusBar = new StatusBarManager(() => zenProvider.getStatusSnapshot());
  statusBar.show();
  context.subscriptions.push(statusBar);

  treeProvider = new OpenCodeTreeProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('opencode-zen-tree', treeProvider)
  );

  registerCommands(context);

  const connectedCount = serverManager.getConnectedList().length;
  if (connectedCount > 0) {
    vscode.window.showInformationMessage(`OpenCode: ${connectedCount} server(s) connected.`).then();
  }

  const initialProbe = setTimeout(() => { void refreshStatusBar(); }, 2000);
  context.subscriptions.push({ dispose: () => clearTimeout(initialProbe) });

  void updateWebview();
}

function registerCommands(context: vscode.ExtensionContext): void {
  const configureZen = async () => {
    const apiKey = await vscode.window.showInputBox({
      title: 'OpenCode Zen — API Key',
      prompt: 'Enter your OpenCode Zen/Go API key. Get one at opencode.ai/auth',
      password: true, placeHolder: 'oc-...', ignoreFocusOut: true,
    });
    if (apiKey === undefined) return;
    await zenProvider.setApiKey(apiKey);
    await freeProvider.setApiKey(apiKey);
    await secretStorage.setZenKey(apiKey);
    vscode.window.showInformationMessage(apiKey ? 'OpenCode Zen: API key saved.' : 'OpenCode Zen: API key cleared.');
    void updateWebview();
  };

  const configureGo = async () => {
    const apiKey = await vscode.window.showInputBox({
      title: 'OpenCode Go — API Key',
      prompt: 'Enter your OpenCode Go API key. Get one at opencode.ai/auth',
      password: true, placeHolder: 'oc-...', ignoreFocusOut: true,
    });
    if (apiKey === undefined) return;
    await goProvider.setApiKey(apiKey);
    await secretStorage.setGoKey(apiKey);
    vscode.window.showInformationMessage(apiKey ? 'OpenCode Go: API key saved.' : 'OpenCode Go: API key cleared.');
    void updateWebview();
  };

  const refreshAll = () => {
    zenProvider.refreshModels();
    goProvider.refreshModels();
    freeProvider.refreshModels();
    serverProvider?.refreshModels();
    vscode.window.showInformationMessage('OpenCode Zen: All models refreshed.');
    void updateWebview();
  };

  const addServer = async () => {
    // Step 1: Select server type
    const serverType = await vscode.window.showQuickPick(
      [
        { label: '$(server) OpenCode Server', description: 'Connect to an OpenCode server instance', value: 'opencode' },
        { label: '$(chip) LM Studio', description: 'Connect to LM Studio local server', value: 'lmstudio' },
        { label: '$(zap) Ollama', description: 'Connect to Ollama local server', value: 'ollama' },
      ],
      { placeHolder: 'Select the type of server to add', ignoreFocusOut: true }
    );
    if (!serverType) return;

    const type = (serverType as any).value;

    if (type === 'lmstudio') {
      const name = await vscode.window.showInputBox({
        title: 'LM Studio Server Name',
        prompt: 'Display name for this LM Studio server',
        placeHolder: 'My LM Studio',
        value: 'Local LM Studio',
        ignoreFocusOut: true,
      });
      if (name === undefined) return;

      const url = await vscode.window.showInputBox({
        title: 'LM Studio URL',
        prompt: 'Base URL for LM Studio API',
        placeHolder: 'http://localhost:1234',
        value: 'http://localhost:1234',
        ignoreFocusOut: true,
      });
      if (url === undefined) return;

      const baseUrl = (url || 'http://localhost:1234').replace(/\/$/, '');
      const serverId = `lmstudio-${randomUUID().slice(0, 8)}`;

      lmStudioProvider.addServer(serverId, name, baseUrl);
      vscode.window.showInformationMessage(`LM Studio server "${name}" added.`);
      return;
    }

    if (type === 'ollama') {
      const name = await vscode.window.showInputBox({
        title: 'Ollama Server Name',
        prompt: 'Display name for this Ollama server',
        placeHolder: 'My Ollama',
        value: 'Local Ollama',
        ignoreFocusOut: true,
      });
      if (name === undefined) return;

      const url = await vscode.window.showInputBox({
        title: 'Ollama URL',
        prompt: 'Base URL for Ollama API',
        placeHolder: 'http://localhost:11434',
        value: 'http://localhost:11434',
        ignoreFocusOut: true,
      });
      if (url === undefined) return;

      const baseUrl = (url || 'http://localhost:11434').replace(/\/$/, '');
      const serverId = `ollama-${randomUUID().slice(0, 8)}`;

      ollamaProvider.addServer(serverId, name, baseUrl);
      vscode.window.showInformationMessage(`Ollama server "${name}" added.`);
      return;
    }

    // OpenCode Server (default)
    const name = await vscode.window.showInputBox({
      title: 'Server Name', prompt: 'Display name for this server', placeHolder: 'My OpenCode Server', ignoreFocusOut: true,
    });
    if (name === undefined) return;

    const url = await vscode.window.showInputBox({
      title: 'Server URL', prompt: 'Base URL (e.g. http://127.0.0.1)', placeHolder: 'http://127.0.0.1', ignoreFocusOut: true,
    });
    if (url === undefined) return;

    const portStr = await vscode.window.showInputBox({
      title: 'Port', prompt: 'Server port', placeHolder: '4096', ignoreFocusOut: true,
    });
    if (portStr === undefined) return;
    const port = parseInt(portStr, 10) || 4096;

    const username = await vscode.window.showInputBox({
      title: 'Username (optional)', prompt: 'Basic auth username', placeHolder: '', ignoreFocusOut: true,
    });

    let password = '';
    if (username) {
      const pwd = await vscode.window.showInputBox({
        title: 'Password', prompt: 'Basic auth password', password: true, placeHolder: '', ignoreFocusOut: true,
      });
      if (pwd !== undefined) password = pwd;
    }

    const newConfig = {
      id: randomUUID(),
      name,
      url: url || 'http://127.0.0.1',
      port,
      username: username || undefined,
      password: !!password,
      enabled: true,
      isLocal: url?.includes('127.0.0.1') || url?.includes('localhost'),
    };

    const configs = await secretStorage.getServerConfigs();
    configs.push(newConfig as any);
    await secretStorage.setServerConfigs(configs);

    if (password) {
      await secretStorage.setServerPassword(newConfig.id, password);
    }

    await serverManager.connectAll();
    vscode.window.showInformationMessage(`Server "${name}" added.`);
    void updateWebview();
  };

  const editServer = async (serverId?: string) => {
    if (!serverId) {
      const servers = await secretStorage.getServerConfigs();
      if (servers.length === 0) {
        vscode.window.showInformationMessage('No servers to edit.');
        return;
      }
      const selected = await vscode.window.showQuickPick(
        servers.map(s => ({ label: s.name, id: s.id })),
        { placeHolder: 'Select server to edit' }
      );
      if (!selected) return;
      serverId = (selected as any).id;
    }

    const configs = await secretStorage.getServerConfigs();
    const config = configs.find(c => c.id === serverId);
    if (!config) return;

    const name = await vscode.window.showInputBox({
      title: 'Server Name', prompt: 'Display name', value: config.name, ignoreFocusOut: true,
    });
    if (name === undefined) return;

    const url = await vscode.window.showInputBox({
      title: 'Server URL', prompt: 'Base URL', value: config.url, ignoreFocusOut: true,
    });
    if (url === undefined) return;

    const portStr = await vscode.window.showInputBox({
      title: 'Port', prompt: 'Server port', value: String(config.port), ignoreFocusOut: true,
    });
    if (portStr === undefined) return;
    const port = parseInt(portStr, 10) || 4096;

    const username = await vscode.window.showInputBox({
      title: 'Username (optional)', prompt: 'Basic auth username', value: config.username || '', ignoreFocusOut: true,
    });

    let newPassword = '';
    const currentPwd = config.hasPassword ? await secretStorage.getServerPassword(serverId!) : '';
    const pwd = await vscode.window.showInputBox({
      title: 'Password', prompt: 'Password (empty to keep current)', password: true, value: currentPwd, ignoreFocusOut: true,
    });
    if (pwd !== undefined) newPassword = pwd;

    config.name = name;
    config.url = url;
    config.port = port;
    config.username = username || undefined;
    config.hasPassword = !!(newPassword || currentPwd);
    config.isLocal = url?.includes('127.0.0.1') || url?.includes('localhost');

    await secretStorage.setServerConfigs(configs);
    if (newPassword) {
      await secretStorage.setServerPassword(serverId!, newPassword);
    }

    await serverManager.connectAll();
    vscode.window.showInformationMessage(`Server "${name}" updated.`);
    void updateWebview();
  };

  const removeServer = async (serverId?: string) => {
    if (!serverId) {
      const servers = await secretStorage.getServerConfigs();
      if (servers.length === 0) {
        vscode.window.showInformationMessage('No servers to remove.');
        return;
      }
      const selected = await vscode.window.showQuickPick(
        servers.map(s => ({ label: s.name, id: s.id })),
        { placeHolder: 'Select server to remove' }
      );
      if (!selected) return;
      serverId = (selected as any).id;
    }

    const configs = await secretStorage.getServerConfigs();
    const config = configs.find(c => c.id === serverId);
    if (!config) return;

    const choice = await vscode.window.showWarningMessage(
      `Remove server "${config.name}"? This cannot be undone.`,
      'Remove', 'Cancel'
    );
    if (choice !== 'Remove') return;

    const filtered = configs.filter(c => c.id !== serverId);
    await secretStorage.setServerConfigs(filtered);
    await secretStorage.setServerPassword(serverId!, '');

    await serverManager.connectAll();
    vscode.window.showInformationMessage(`Server "${config.name}" removed.`);
    void updateWebview();
  };

  const launchServer = async (serverId?: string) => {
    if (!serverId) {
      const configs = await secretStorage.getServerConfigs();
      const offline = configs.filter(c => !serverManager.getConnectedList().some(conn => conn.config.id === c.id));
      if (offline.length === 0) {
        vscode.window.showInformationMessage('All servers are online or no servers configured.');
        return;
      }
      const selected = await vscode.window.showQuickPick(
        offline.map(s => ({ label: s.name, id: s.id })),
        { placeHolder: 'Select server to launch' }
      );
      if (!selected) return;
      serverId = (selected as any).id;
    }

    const configs = await secretStorage.getServerConfigs();
    const config = configs.find(c => c.id === serverId);
    if (!config) return;

    // Ofrecer elegir entre terminal VS Code o proceso background
    const mode = await vscode.window.showQuickPick(
      [
        { label: 'Background process (no visible terminal)', description: 'Recomendado' },
        { label: 'VS Code terminal', description: 'Visible en el panel de terminal' },
      ],
      { placeHolder: `How to launch "${config.name}"?` }
    );
    if (!mode) return;

    if (mode.label === 'VS Code terminal') {
      const host = config.url.replace(/^https?:\/\//, '');
      const terminal = vscode.window.createTerminal({
        name: config.name,
        message: `opencode serve --host ${host} --port ${config.port}`,
      });
      terminal.sendText(`opencode serve --host ${host} --port ${config.port}`);
      terminal.show();
      // Esperar a que arranque
      for (let i = 0; i < 15; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const reconnected = await serverManager.reconnect(config.id);
        if (reconnected) {
          vscode.window.showInformationMessage(`Server "${config.name}" launched in terminal.`);
          void updateWebview();
          return;
        }
      }
      vscode.window.showWarningMessage(`Could not connect to "${config.name}". Check the terminal for errors.`);
    } else {
      const launched = await serverManager.launchServer(config);
      if (launched) {
        vscode.window.showInformationMessage(`Server "${config.name}" launched (background process).`);
      } else {
        vscode.window.showWarningMessage(`Could not launch "${config.name}". Make sure opencode is in your PATH.`);
      }
    }
    void updateWebview();
  };

  const registeredCommands = new Set<string>();
  const safeRegister = (command: string, callback: (...args: any[]) => any) => {
    if (registeredCommands.has(command)) {
      console.log(`Command ${command} already registered in this session, skipping`);
      return;
    }
    registeredCommands.add(command);
    const disposable = vscode.commands.registerCommand(command, callback);
    context.subscriptions.push(disposable);
  };

  safeRegister('opencode-zen.configureZen', configureZen);
  safeRegister('opencode-zen.configureGo', configureGo);
  safeRegister('opencode-zen.refreshAll', refreshAll);
  safeRegister('opencode-zen.refreshGlobal', async () => {
    zenProvider.refreshModels();
    goProvider.refreshModels();
    await updateWebview();
    vscode.window.showInformationMessage('Global usage refreshed.');
  });
  safeRegister('opencode-zen.clearUsage', () => {
    zenProvider.getUsageTracker().clear();
    goProvider.getUsageTracker().clear();
    freeProvider.getUsageTracker().clear();
    serverProvider?.getUsageTracker().clear();
    vscode.window.showInformationMessage('OpenCode Zen: Usage stats cleared.');
    void updateWebview();
  });
  safeRegister('opencode-zen.addServer', addServer);
  safeRegister('opencode-zen.editServer', (_, serverId?: string) => editServer(serverId));
  safeRegister('opencode-zen.removeServer', (_, serverId?: string) => removeServer(serverId));
  safeRegister('opencode-zen.launchServer', (_, serverId?: string) => launchServer(serverId));
  safeRegister('opencode-zen.refreshServers', () => {
    void serverManager.connectAll();
    void updateWebview();
    vscode.window.showInformationMessage('Servers refreshed.');
  });
  safeRegister('opencode-zen.showOutput', () => zenProvider.showOutput());
  safeRegister('opencode-zen.showOutputLog', () => {
    const stats = aggregateUsageStats([
      zenProvider.getUsageTracker().getStats(),
      goProvider.getUsageTracker().getStats(),
      freeProvider.getUsageTracker().getStats(),
    ]);
    zenProvider.showOutput();
    zenProvider.appendOutput(formatUsageOutput(stats));
  });
}

async function updateWebview(): Promise<void> {
  const [zenKeyFromStorage, goKeyFromStorage] = await Promise.all([
    secretStorage.getZenKey(),
    secretStorage.getGoKey(),
  ]);

  const zenKey = zenProvider.getApiKey() || zenKeyFromStorage;
  const goKey = goProvider.getApiKey() || goKeyFromStorage;

  const connectedServers: any[] = [];
  for (const conn of serverManager.getConnectedList()) {
    const connectedProviders = await conn.client.getProvidersInfo();
    const allModels: string[] = [];

    for (const p of connectedProviders) {
      if (p.connected) {
        allModels.push(...Object.keys(p.models || {}));
      }
    }

    connectedServers.push({
      id: conn.config.id,
      name: conn.config.name,
      url: conn.config.url,
      port: conn.config.port,
      version: conn.info.version,
      available: conn.info.available,
      models: [...new Set(allModels)],
      providerCount: connectedProviders.filter((p: any) => p.connected).length,
    });
  }

  const configs = await secretStorage.getServerConfigs();
  const allServers = configs.map(c => {
    const conn = connectedServers.find((s: any) => s.id === c.id);
    return {
      id: c.id,
      name: c.name,
      url: c.url,
      port: c.port,
      version: conn?.version,
      available: conn?.available || false,
      models: conn?.models || [],
      providerCount: conn?.providerCount || 0,
    };
  });

  // Add LM Studio and Ollama servers to dashboard
  const lmStudioServers = lmStudioProvider?.getServerStatus() || [];
  const ollamaServers = ollamaProvider?.getServerStatus() || [];

  const allServersWithExtras: ServerData[] = [
    ...allServers.map(s => ({ ...s, type: 'opencode' as const })),
    ...lmStudioServers.map(s => ({
      id: s.id,
      name: s.name,
      url: s.url,
      available: s.available,
      models: s.models,
      providerCount: 1,
      type: 'lmstudio' as const,
    })),
    ...ollamaServers.map(s => ({
      id: s.id,
      name: s.name,
      url: s.url,
      available: s.available,
      models: s.models,
      providerCount: 1,
      type: 'ollama' as const,
    })),
  ];

  const state: DashboardState = {
    servers: allServersWithExtras,
    zenKey,
    goKey,
    zenFamilies: zenProvider.getModelFamilies(),
    goFamilies: goProvider.getModelFamilies(),
    zenStats: zenProvider.getUsageTracker().getStats(),
    goStats: goProvider.getUsageTracker().getStats(),
  };

  treeProvider.refresh(state);
}

function aggregateUsageStats(statsList: any[]): any {
  const totalRequests = statsList.reduce((s: number, x: any) => s + x.totalRequests, 0);
  const totalTokens = statsList.reduce(
    (acc: any, st: any) => ({ prompt: acc.prompt + st.totalTokens.prompt, completion: acc.completion + st.totalTokens.completion, total: acc.total + st.totalTokens.total }),
    { prompt: 0, completion: 0, total: 0 }
  );
  return { totalRequests, totalTokens };
}

async function refreshStatusBar(): Promise<void> {
  const cts = new vscode.CancellationTokenSource();
  try {
    const models = await zenProvider.provideLanguageModelChatInformation({ silent: true }, cts.token);
    if (models.length > 0) statusBar.setIdle(models.length);
    else statusBar.setNoModels();
  } catch (err) {
    statusBar.setError(err instanceof Error ? err.message : String(err));
  } finally {
    cts.dispose();
  }
}

export function deactivate(): void {}